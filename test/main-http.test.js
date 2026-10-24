import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../src/main.js";
import { startHttpFixture } from "./helpers/http-fixture.js";

test("packed command architecture works end-to-end against a local HTTP API fixture", async () => {
  const fixture = await startHttpFixture(({ url }) => {
    if (url.pathname === "/api/v1/cli/capabilities") {
      return {
        body: {
          minimum_cli_version: "0.1.0",
          recommended_cli_version: "1.0.0",
          features: { traces: true }
        }
      };
    }
    if (url.pathname === "/api/v1/cli/projects/api/traces") {
      return {
        body: {
          items: [{ trace_id: "trace-1", service: "checkout", status: "error" }],
          next_cursor: null,
          generated_at: "2026-08-09T12:00:00Z"
        }
      };
    }
    return { status: 404, body: { code: "not_found", message: "Not found" } };
  });
  const temp = await mkdtemp(join(tmpdir(), "logister-main-http-"));
  const stdout = captureStream();
  const stderr = captureStream();
  try {
    await main([
      "traces", "list", "--project", "api", "--service", "checkout",
      "--status", "error", "--format", "json"
    ], {
      env: {
        LOGISTER_HOST: fixture.host,
        LOGISTER_TOKEN: "cli-secret",
        LOGISTER_CONFIG: join(temp, "config.json")
      },
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout,
      stderr,
      fetchImpl: globalThis.fetch
    });

    assert.equal(JSON.parse(stdout.output).items[0].trace_id, "trace-1");
    const traceRequest = fixture.requests.find((request) => request.path.endsWith("/traces"));
    assert.equal(traceRequest.query.get("service"), "checkout");
    assert.equal(traceRequest.query.get("status"), "error");
    assert.equal(traceRequest.headers.authorization, "Bearer cli-secret");
    assert.equal(stderr.output, "");
  } finally {
    await fixture.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("version command does not read or migrate private profile credentials", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-public-version-"));
  const configPath = join(temp, "config.json");
  const stdout = captureStream();
  try {
    await writeFile(configPath, "{malformed-private-config");
    await main(["version", "--format", "json"], {
      env: { LOGISTER_CONFIG: configPath },
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout,
      stderr: captureStream()
    });
    assert.equal(JSON.parse(stdout.output).version, "1.3.0");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("plain auth logout clears an insecure-development profile without activating its credential", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-local-logout-"));
  const configPath = join(temp, "config.json");
  const stdout = captureStream();
  try {
    await writeFile(configPath, JSON.stringify({
      profiles: { default: { host: "http://dev.internal:3000", token: "local-fallback" } }
    }));
    await main(["auth", "logout"], {
      env: { LOGISTER_CONFIG: configPath },
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout,
      stderr: captureStream(),
      credentialStore: {
        async deleteStoredToken(_profile, origin) {
          assert.equal(origin, "http://dev.internal:3000");
          return { store: "test", status: "not-found" };
        }
      }
    });
    const config = JSON.parse(await (await import("node:fs/promises")).readFile(configPath, "utf8"));
    assert.equal(Object.hasOwn(config.profiles.default, "token"), false);
    assert.match(stdout.output, /Removed token/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("explicit safe re-login replaces an invalid legacy host without activating its old credential", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-invalid-host-relogin-"));
  const configPath = join(temp, "config.json");
  const stdout = captureStream();
  let secureReads = 0;
  const credentialStore = {
    async readStoredToken() { secureReads += 1; throw new Error("must not activate old credential"); },
    async writeStoredToken() { return ""; },
    async deleteStoredToken(_profile, origin, options) {
      assert.equal(origin, "");
      assert.equal(options.includeOrigin, false);
      return { status: "not-found" };
    }
  };
  try {
    await writeFile(configPath, JSON.stringify({
      profiles: { default: { host: "https://old.example/logister", token: "old-token", project: "old-project" } }
    }));
    await main(["auth", "login", "--host", "https://new.example", "--token", "new-token"], {
      env: { LOGISTER_CONFIG: configPath, CI: "1" },
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout,
      stderr: captureStream(),
      credentialStore
    });
    const config = JSON.parse(await (await import("node:fs/promises")).readFile(configPath, "utf8"));
    assert.equal(config.profiles.default.host, "https://new.example");
    assert.equal(config.profiles.default.token, "new-token");
    assert.equal(config.profiles.default.project, undefined);
    assert.equal(secureReads, 0);

    config.profiles.default = { host: "https://old.example/logister", token: "old-token" };
    await writeFile(configPath, JSON.stringify(config));
    await main(["auth", "logout"], {
      env: { LOGISTER_CONFIG: configPath },
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: captureStream(),
      stderr: captureStream(),
      credentialStore: {
        async deleteStoredToken(_profile, origin) { assert.equal(origin, ""); return { status: "not-found" }; }
      }
    });
    const loggedOut = JSON.parse(await (await import("node:fs/promises")).readFile(configPath, "utf8"));
    assert.equal(Object.hasOwn(loggedOut.profiles.default, "token"), false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("doctor warns about --token outside auth login and redacts the server session payload", async () => {
  const fixture = await startHttpFixture(({ url }) => {
    if (url.pathname === "/api/v1/cli/capabilities") {
      return { body: { server: "logister", minimum_cli_version: "0.1.0", recommended_cli_version: "1.0.0", features: { capabilities: true } } };
    }
    if (url.pathname === "/api/v1/cli/session") {
      return { body: { token: { uuid: "safe", name: "ci Bearer abcDEF123456", scopes: ["projects:read"] }, accessible_project_count: 1 } };
    }
    return { status: 404, body: { code: "not_found", message: "Not found" } };
  });
  const temp = await mkdtemp(join(tmpdir(), "logister-doctor-token-"));
  const stdout = captureStream();
  const stderr = captureStream();
  try {
    await main(["doctor", "--host", fixture.host, "--token", "argv-secret", "--format", "json"], {
      env: { LOGISTER_CONFIG: join(temp, "config.json"), LOGISTER_DISABLE_KEYCHAIN: "1" },
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout,
      stderr,
      fetchImpl: globalThis.fetch
    });
    assert.match(stderr.output, /--token is deprecated outside `logister auth login`/);
    assert.equal(stderr.output.trim().split("\n").length, 1);
    const payload = JSON.parse(stdout.output);
    assert.equal(payload.session.token.uuid, "safe");
    assert.equal(payload.session.token.name, "ci Bearer [REDACTED]");
    assert.equal(stdout.output.includes("argv-secret"), false);
    assert.equal(fixture.requests.find((request) => request.path === "/api/v1/cli/session").headers.authorization, "Bearer argv-secret");
  } finally {
    await fixture.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("auth login --token does not print the argv deprecation warning", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-login-token-"));
  const stderr = captureStream();
  try {
    await main(["auth", "login", "--host", "https://new.example", "--token", "new-token"], {
      env: { LOGISTER_CONFIG: join(temp, "config.json"), LOGISTER_DISABLE_KEYCHAIN: "1", CI: "1" },
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: captureStream(),
      stderr,
      credentialStore: {
        async readStoredToken() { return { token: "", source: "" }; },
        async writeStoredToken() { return ""; },
        async deleteStoredToken() { return { status: "not-found" }; }
      }
    });
    assert.equal(stderr.output, "");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

function captureStream() {
  return { output: "", write(chunk) { this.output += chunk; } };
}
