import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_READ_SCOPES, runAuthCommand } from "../src/commands/auth.js";

test("auth login uses device authorization when no token is supplied", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "logister-cli-auth-"));
  const previousDisableKeychain = process.env.LOGISTER_DISABLE_KEYCHAIN;
  process.env.LOGISTER_DISABLE_KEYCHAIN = "1";

  try {
    const calls = [];
    const client = {
      async post(path, body, options) {
        calls.push({ path, body, options });

        if (path === "/api/v1/cli/device_authorizations") {
          return {
            device_code: "device-secret",
            user_code: "ABCD-EFGH",
            verification_uri_complete: "https://logister.example.com/cli/device?user_code=ABCD-EFGH",
            expires_in: 30,
            interval: 3
          };
        }

        const pending = calls.filter((call) => call.path === "/api/v1/cli/device_authorizations/token").length === 1;
        if (pending) {
          const error = new Error("Waiting for browser approval.");
          error.body = { error: "authorization_pending" };
          throw error;
        }

        return {
          access_token: "logister_cli_returned",
          token_type: "Bearer",
          expires_at: "2026-07-02T00:00:00Z",
          scope: "projects:read"
        };
      }
    };
    const stdout = captureStream();
    const env = {
      LOGISTER_CONFIG: join(tempDir, "config.json"),
      LOGISTER_DISABLE_KEYCHAIN: "1",
      LOGISTER_AUTH_POLL_INTERVAL_MS: "0",
      CI: "1"
    };

    await runAuthCommand(["login"], {
      client,
      parsed: { options: { host: "https://logister.example.com", noBrowser: true } },
      runtime: {
        profileName: "default",
        host: "https://logister.example.com",
        project: "",
        configPath: env.LOGISTER_CONFIG
      },
      stdout,
      stdin: emptyStdin(),
      env
    });

    assert.deepEqual(calls.map((call) => call.path), [
      "/api/v1/cli/device_authorizations",
      "/api/v1/cli/device_authorizations/token",
      "/api/v1/cli/device_authorizations/token"
    ]);
    assert.deepEqual(calls[0].body.scopes, DEFAULT_READ_SCOPES);
    assert.equal(calls[0].options.signal, undefined);
    assert.match(stdout.output, /Code: ABCD-EFGH/);
    assert.match(stdout.output, /Saved Logister profile 'default'/);

    const config = JSON.parse(await readFile(env.LOGISTER_CONFIG, "utf8"));
    assert.equal(config.profiles.default.host, "https://logister.example.com");
    assert.equal(config.profiles.default.token, "logister_cli_returned");
    assert.deepEqual(config.profiles.default.scopes, ["projects:read"]);
    assert.equal(config.profiles.default.expires_at, "2026-07-02T00:00:00Z");
  } finally {
    if (previousDisableKeychain === undefined) delete process.env.LOGISTER_DISABLE_KEYCHAIN;
    else process.env.LOGISTER_DISABLE_KEYCHAIN = previousDisableKeychain;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("auth login validates every terminal device-flow state", async () => {
  for (const [state, message] of [
    ["access_denied", /denied in the browser/],
    ["expired_token", /login expired/],
    ["invalid_grant", /no longer valid/]
  ]) {
    const tempDir = await mkdtemp(join(tmpdir(), "logister-cli-auth-state-"));
    const previousDisableKeychain = process.env.LOGISTER_DISABLE_KEYCHAIN;
    process.env.LOGISTER_DISABLE_KEYCHAIN = "1";
    try {
      const env = {
        LOGISTER_CONFIG: join(tempDir, "config.json"),
        LOGISTER_DISABLE_KEYCHAIN: "1",
        LOGISTER_AUTH_POLL_INTERVAL_MS: "0",
        CI: "1"
      };
      const client = {
        async post(path) {
          if (path.endsWith("device_authorizations")) {
            return {
              device_code: "device", user_code: "CODE",
              verification_uri: "https://logister.example.com/cli/device",
              expires_in: 30, interval: 1
            };
          }
          const error = new Error(state);
          error.body = { error: state };
          throw error;
        }
      };
      await assert.rejects(
        () => runAuthCommand(["login"], authContext({ client, env })),
        (error) => error.exitCode === 3 && message.test(error.message)
      );
    } finally {
      if (previousDisableKeychain === undefined) delete process.env.LOGISTER_DISABLE_KEYCHAIN;
      else process.env.LOGISTER_DISABLE_KEYCHAIN = previousDisableKeychain;
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

test("auth login rejects malformed challenge and token responses", async () => {
  const env = { LOGISTER_CONFIG: "/unused/config.json", LOGISTER_AUTH_POLL_INTERVAL_MS: "0", CI: "1" };
  await assert.rejects(
    () => runAuthCommand(["login"], authContext({ client: { async post() { return { device_code: "only" }; } }, env })),
    /Invalid Logister device-flow response/
  );

  let call = 0;
  await assert.rejects(
    () => runAuthCommand(["login"], authContext({
      client: {
        async post() {
          call += 1;
          if (call === 1) return {
            device_code: "device", user_code: "CODE", verification_uri: "https://logister.example.com/cli/device",
            expires_in: 30, interval: 1
          };
          return { access_token: "token", token_type: "MAC", scope: "projects:read" };
        }
      }, env
    })),
    /Unsupported device token type/
  );

  await assert.rejects(
    () => runAuthCommand(["login"], authContext({
      client: {
        async post() {
          return {
            device_code: "device", user_code: "CODE", verification_uri: "http://attacker.example/cli/device",
            expires_in: 30, interval: 1
          };
        }
      }, env
    })),
    /invalid verification URL/
  );
});

test("auth status includes safe server session diagnostics", async () => {
  let written;
  const controller = new AbortController();
  await runAuthCommand(["status"], {
    runtime: {
      profileName: "default", configPath: "/config", host: "https://logister.example.com",
      token: "secret", tokenSource: "environment", project: "api", scopes: ["projects:read"], expiresAt: null
    },
    client: { async get(path, query, options) {
      assert.equal(path, "/api/v1/cli/session");
      assert.deepEqual(query, {});
      assert.equal(options.signal, controller.signal);
      return { token: { uuid: "safe", scopes: ["projects:read"] } };
    } },
    parsed: { options: {} },
    signal: controller.signal,
    write(payload) { written = payload; }
  });
  assert.equal(written.token_present, true);
  assert.equal(written.server_session.token.uuid, "safe");
  assert.equal(JSON.stringify(written).includes("secret"), false);
});

test("device polling stops promptly on caller abort and passes the signal to requests", async () => {
  const controller = new AbortController();
  const calls = [];
  const env = { LOGISTER_CONFIG: "/unused/config.json", LOGISTER_AUTH_POLL_INTERVAL_MS: "60000", CI: "1" };
  const context = authContext({
    client: {
      async post(path, body, options) {
        calls.push({ path, body, options });
        return {
          device_code: "device", user_code: "CODE", verification_uri: "https://logister.example.com/cli/device",
          expires_in: 600, interval: 1
        };
      }
    },
    env
  });
  context.signal = controller.signal;
  const started = Date.now();
  const login = runAuthCommand(["login"], context);
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(login, (error) => error.interrupted === true);
  assert.ok(Date.now() - started < 500);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.signal, controller.signal);
});

test("--token-stdin rejects empty, oversized, invalid UTF-8, and embedded control input", async () => {
  const env = { LOGISTER_CONFIG: "/unused/config.json", CI: "1" };
  for (const [chunks, expected] of [
    [[], /token from stdin is empty/],
    [[Buffer.alloc(8193, "x")], /8192-byte limit/],
    [[Buffer.from([0xff])], /valid UTF-8/],
    [[Buffer.from("first\nsecond")], /no embedded control characters/],
    [[Buffer.from("first\0second")], /no embedded control characters/],
    [[Buffer.from("token\n\n")], /no embedded control characters/]
  ]) {
    const context = authContext({ client: { async post() { throw new Error("must not call API"); } }, env });
    context.parsed.options.tokenStdin = true;
    context.stdin = { async *[Symbol.asyncIterator]() { yield* chunks; } };
    await assert.rejects(() => runAuthCommand(["login"], context), expected);
  }
});

test("--token-stdin accepts one trailing newline and stores the exact printable token", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "logister-cli-token-stdin-"));
  const previousDisableKeychain = process.env.LOGISTER_DISABLE_KEYCHAIN;
  process.env.LOGISTER_DISABLE_KEYCHAIN = "1";
  const env = { LOGISTER_CONFIG: join(tempDir, "config.json"), LOGISTER_DISABLE_KEYCHAIN: "1", CI: "1" };
  try {
    const context = authContext({ client: { async post() { throw new Error("must not call API"); } }, env });
    context.parsed.options.tokenStdin = true;
    context.stdin = { async *[Symbol.asyncIterator]() { yield Buffer.from("printable-token\r\n"); } };

    await runAuthCommand(["login"], context);

    const config = JSON.parse(await readFile(env.LOGISTER_CONFIG, "utf8"));
    assert.equal(config.profiles.default.token, "printable-token");
  } finally {
    if (previousDisableKeychain === undefined) delete process.env.LOGISTER_DISABLE_KEYCHAIN;
    else process.env.LOGISTER_DISABLE_KEYCHAIN = previousDisableKeychain;
    await rm(tempDir, { recursive: true, force: true });
  }
});

function captureStream() {
  return {
    output: "",
    write(chunk) {
      this.output += chunk;
    }
  };
}

function emptyStdin() {
  return {
    async *[Symbol.asyncIterator]() {}
  };
}

function authContext({ client, env }) {
  return {
    client,
    parsed: { options: { host: "https://logister.example.com", noBrowser: true } },
    runtime: {
      profileName: "default", host: "https://logister.example.com", project: "", configPath: env.LOGISTER_CONFIG
    },
    stdout: captureStream(),
    stdin: emptyStdin(),
    env
  };
}
