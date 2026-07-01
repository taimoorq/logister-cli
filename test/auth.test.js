import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAuthCommand } from "../src/commands/auth.js";

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
    assert.match(stdout.output, /Code: ABCD-EFGH/);
    assert.match(stdout.output, /Saved Logister profile 'default'/);

    const config = JSON.parse(await readFile(env.LOGISTER_CONFIG, "utf8"));
    assert.equal(config.profiles.default.host, "https://logister.example.com");
    assert.equal(config.profiles.default.token, "logister_cli_returned");
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
