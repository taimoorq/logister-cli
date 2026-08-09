import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deleteProfileToken, loadPublicRuntime, loadRuntime, readConfig, saveProfileLogin } from "../src/config/runtime.js";

test("runtime rejects invalid environment and persisted output formats", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-runtime-"));
  const configPath = join(temp, "config.json");
  const prior = process.env.LOGISTER_DISABLE_KEYCHAIN;
  process.env.LOGISTER_DISABLE_KEYCHAIN = "1";
  try {
    await assert.rejects(
      () => loadRuntime({}, { LOGISTER_CONFIG: configPath, LOGISTER_FORMAT: "xml" }),
      /Invalid Logister output format 'xml'/
    );
    await writeFile(configPath, JSON.stringify({ profiles: { default: { format: "yaml" } } }));
    await assert.rejects(
      () => loadRuntime({}, { LOGISTER_CONFIG: configPath }),
      /Invalid Logister output format 'yaml'/
    );
    await writeFile(configPath, JSON.stringify({ profiles: { default: {} } }));
    await assert.rejects(
      () => loadRuntime({}, { LOGISTER_CONFIG: configPath, LOGISTER_RETRIES: "many" }),
      /Invalid Logister retry count/
    );
  } finally {
    if (prior === undefined) delete process.env.LOGISTER_DISABLE_KEYCHAIN;
    else process.env.LOGISTER_DISABLE_KEYCHAIN = prior;
    await rm(temp, { recursive: true, force: true });
  }
});

test("runtime reports malformed config safely", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-runtime-"));
  const configPath = join(temp, "config.json");
  try {
    await writeFile(configPath, "{not-json");
    await assert.rejects(() => readConfig({ LOGISTER_CONFIG: configPath }), /Invalid Logister config/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("version/update public runtime ignores config and credentials while validating public settings", () => {
  assert.deepEqual(
    loadPublicRuntime({ format: "json", timeoutMs: "1000", retries: "1" }, {
      LOGISTER_CONFIG: "/malformed/or/private/config.json"
    }),
    {
      version: "1.0.0", format: "json", timeoutMs: 1000, retries: 1,
      host: "", token: "", allowInsecureHttp: false, legacyCredentialPending: false
    }
  );
  assert.throws(() => loadPublicRuntime({}, { LOGISTER_FORMAT: "xml" }), /Invalid Logister output format/);
});

test("runtime validates default profile, active profile, and credential metadata types", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-runtime-shape-"));
  const configPath = join(temp, "config.json");
  const prior = process.env.LOGISTER_DISABLE_KEYCHAIN;
  process.env.LOGISTER_DISABLE_KEYCHAIN = "1";
  const invalidConfigs = [
    [{ defaultProfile: { bad: true }, profiles: {} }, /defaultProfile/],
    [{ defaultProfile: "default", profiles: { default: "bad" } }, /profile 'default' must be an object/],
    [{ profiles: { default: { host: { bad: true } } } }, /profile host/],
    [{ profiles: { default: { token: ["secret"] } } }, /profile token/],
    [{ profiles: { default: { scopes: "projects:read" } } }, /scopes must be an array/],
    [{ profiles: { default: { expires_at: "tomorrow" } } }, /expires_at/],
    [{ profiles: { default: { timeout_ms: {} } } }, /timeout_ms must be an integer/]
  ];
  try {
    for (const [config, expected] of invalidConfigs) {
      await writeFile(configPath, JSON.stringify(config));
      await assert.rejects(() => loadRuntime({}, { LOGISTER_CONFIG: configPath }), expected);
    }
    await writeFile(configPath, JSON.stringify({ profiles: {} }));
    await assert.rejects(
      () => loadRuntime({}, { LOGISTER_CONFIG: configPath, LOGISTER_PROFILE: "bad\nprofile" }),
      /active profile/
    );
  } finally {
    if (prior === undefined) delete process.env.LOGISTER_DISABLE_KEYCHAIN;
    else process.env.LOGISTER_DISABLE_KEYCHAIN = prior;
    await rm(temp, { recursive: true, force: true });
  }
});

test("plaintext fallback token remains authoritative when replacing a stale secure-store token fails", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-runtime-credential-precedence-"));
  const configPath = join(temp, "config.json");
  await writeFile(configPath, JSON.stringify({ profiles: { default: { host: "https://logister.example", token: "new-fallback-token" } } }));
  const credentialStore = {
    async readStoredToken() { return { token: "stale-keychain-token", source: "macos-keychain" }; },
    async writeStoredToken() { return ""; },
    async deleteStoredToken() { return { status: "not-found" }; }
  };
  try {
    const runtime = await loadRuntime({}, { LOGISTER_CONFIG: configPath }, credentialStore);
    assert.equal(runtime.token, "new-fallback-token");
    assert.equal(runtime.tokenSource, "config-file");
    assert.equal((await readConfig({ LOGISTER_CONFIG: configPath })).profiles.default.token, "new-fallback-token");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("host overrides never reuse a saved profile credential across origins", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-runtime-origin-binding-"));
  const configPath = join(temp, "config.json");
  await writeFile(configPath, JSON.stringify({
    profiles: { default: { host: "https://a.example", project: "project-a", token: "token-a", scopes: ["events:read"] } }
  }));
  const credentialStore = {
    async readStoredToken() { throw new Error("cross-origin secure-store read"); },
    async writeStoredToken() { throw new Error("cross-origin secure-store write"); },
    async deleteStoredToken() { return { status: "not-found" }; }
  };
  try {
    const overridden = await loadRuntime({ host: "https://b.example" }, { LOGISTER_CONFIG: configPath }, credentialStore);
    assert.equal(overridden.host, "https://b.example");
    assert.equal(overridden.token, "");
    assert.equal(overridden.project, "");
    assert.deepEqual(overridden.scopes, []);

    const explicit = await loadRuntime(
      { host: "https://b.example", token: "token-b" },
      { LOGISTER_CONFIG: configPath },
      credentialStore
    );
    assert.equal(explicit.token, "token-b");
    assert.equal(explicit.tokenSource, "option");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("legacy unbound secure credentials are detected but never activated", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-runtime-legacy-credential-"));
  const configPath = join(temp, "config.json");
  await writeFile(configPath, JSON.stringify({ profiles: { default: { host: "https://logister.example" } } }));
  let secretReads = 0;
  const credentialStore = {
    async readStoredToken() { secretReads += 1; return { token: "", source: "" }; },
    async writeStoredToken() { throw new Error("must not migrate an unbound secret"); },
    async legacyStoredTokenStatus() { return "present"; },
    async deleteStoredToken() { return { status: "not-found" }; }
  };
  try {
    const runtime = await loadRuntime({}, { LOGISTER_CONFIG: configPath }, credentialStore);
    assert.equal(runtime.token, "");
    assert.equal(runtime.legacyCredentialPending, true);
    assert.equal(secretReads, 1);

    const client = new (await import("../src/api/client.js")).ApiClient({
      host: runtime.host,
      token: runtime.token,
      userAgent: "test",
      legacyCredentialPending: runtime.legacyCredentialPending,
      fetchImpl: async () => { throw new Error("must not send"); }
    });
    await assert.rejects(() => client.get("/api/v1/cli/session"), /legacy unbound macOS Keychain credential/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("profile login switches host and fallback token together only after credential persistence", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-runtime-login-switch-"));
  const configPath = join(temp, "config.json");
  const env = { LOGISTER_CONFIG: configPath };
  await writeFile(configPath, JSON.stringify({ profiles: { default: { host: "https://a.example", token: "token-a" } } }));
  const cleanupCalls = [];
  const fallbackStore = {
    async writeStoredToken(profile, origin, token) {
      assert.deepEqual([profile, origin, token], ["default", "https://b.example", "token-b"]);
      return "";
    },
    async deleteStoredToken(...args) { cleanupCalls.push(args); return { status: "not-found" }; }
  };
  try {
    const result = await saveProfileLogin("default", {
      host: "https://b.example", token: "token-b", scopes: ["events:read"]
    }, env, fallbackStore);
    const config = await readConfig(env);
    assert.equal(result.tokenStore, "config-file");
    assert.equal(config.profiles.default.host, "https://b.example");
    assert.equal(config.profiles.default.token, "token-b");
    assert.deepEqual(cleanupCalls[0].slice(0, 2), ["default", "https://a.example"]);

    await writeFile(configPath, JSON.stringify({ profiles: { default: { host: "https://a.example", token: "token-a" } } }));
    const interruptedStore = {
      async writeStoredToken() { throw new Error("keychain interrupted"); },
      async deleteStoredToken() { throw new Error("must not clean old credential"); }
    };
    await assert.rejects(
      () => saveProfileLogin("default", { host: "https://b.example", token: "token-b" }, env, interruptedStore),
      /keychain interrupted/
    );
    assert.equal((await readConfig(env)).profiles.default.host, "https://a.example");
    assert.equal((await readConfig(env)).profiles.default.token, "token-a");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("profile login rolls back only the new host credential when config persistence fails", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-runtime-login-config-failure-"));
  const configPath = join(temp, "config.json");
  const env = { LOGISTER_CONFIG: configPath };
  await writeFile(configPath, JSON.stringify({ profiles: { default: { host: "https://a.example" } } }));
  const deletes = [];
  const credentialStore = {
    async writeStoredToken() { return "macos-keychain"; },
    async deleteStoredToken(...args) { deletes.push(args); return { status: "deleted" }; }
  };
  try {
    await assert.rejects(
      () => saveProfileLogin(
        "default",
        { host: "https://b.example", token: "token-b" },
        env,
        credentialStore,
        async () => { throw new Error("disk full"); }
      ),
      /disk full/
    );
    assert.equal((await readConfig(env)).profiles.default.host, "https://a.example");
    assert.deepEqual(deletes, [["default", "https://b.example", { includeOrigin: true, includeLegacy: false }]]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("same-origin profile update restores the prior bound credential when config persistence fails", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-runtime-login-same-origin-"));
  const configPath = join(temp, "config.json");
  const env = { LOGISTER_CONFIG: configPath };
  await writeFile(configPath, JSON.stringify({ profiles: { default: { host: "https://a.example" } } }));
  const writes = [];
  const deletes = [];
  const store = {
    async readStoredToken() { return { token: "token-a", source: "macos-keychain" }; },
    async writeStoredToken(_profile, _origin, token) { writes.push(token); return "macos-keychain"; },
    async deleteStoredToken(...args) { deletes.push(args); return { status: "deleted" }; }
  };
  try {
    await assert.rejects(
      () => saveProfileLogin(
        "default",
        { host: "https://a.example", token: "token-b" },
        env,
        store,
        async () => { throw new Error("disk full"); }
      ),
      /disk full/
    );
    assert.deepEqual(writes, ["token-b", "token-a"]);
    assert.deepEqual(deletes, []);
    assert.equal((await readConfig(env)).profiles.default.host, "https://a.example");

    writes.length = 0;
    const failedRestoreStore = {
      ...store,
      async writeStoredToken(_profile, _origin, token) {
        writes.push(token);
        return token === "token-b" ? "macos-keychain" : "";
      }
    };
    await assert.rejects(
      () => saveProfileLogin(
        "default",
        { host: "https://a.example", token: "token-b" },
        env,
        failedRestoreStore,
        async () => { throw new Error("disk full"); }
      ),
      /previous Keychain credential could not be restored/
    );
    assert.deepEqual(writes, ["token-b", "token-a"]);
    assert.equal(deletes.length, 1);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("logout preserves fallback state and reports failure when secure-store deletion is denied", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-runtime-credential-delete-"));
  const configPath = join(temp, "config.json");
  await writeFile(configPath, JSON.stringify({ profiles: { default: { token: "fallback-token" } } }));
  try {
    await assert.rejects(
      () => deleteProfileToken("default", { LOGISTER_CONFIG: configPath }, {
        async deleteStoredToken() { return { store: "macos-keychain", status: "failed" }; }
      }),
      /Could not remove.*macOS Keychain/
    );
    assert.equal((await readConfig({ LOGISTER_CONFIG: configPath })).profiles.default.token, "fallback-token");

    const absent = await deleteProfileToken("default", { LOGISTER_CONFIG: configPath }, {
      async deleteStoredToken() { return { store: "macos-keychain", status: "not-found" }; }
    });
    assert.equal(absent.removed, true);
    assert.equal(Object.hasOwn((await readConfig({ LOGISTER_CONFIG: configPath })).profiles.default, "token"), false);

    const nothing = await deleteProfileToken("default", { LOGISTER_CONFIG: configPath }, {
      async deleteStoredToken() { return { store: "macos-keychain", status: "not-found" }; }
    });
    assert.equal(nothing.removed, false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("logout removes a config fallback but exits partial when Keychain is disabled", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-runtime-disabled-keychain-delete-"));
  const configPath = join(temp, "config.json");
  const env = { LOGISTER_CONFIG: configPath };
  await writeFile(configPath, JSON.stringify({ profiles: { default: { host: "https://logister.example", token: "fallback" } } }));
  const disabledStore = {
    async deleteStoredToken() { return { store: "macos-keychain", status: "disabled" }; }
  };
  try {
    await assert.rejects(
      () => deleteProfileToken("default", env, disabledStore),
      (error) => error.partial === true && /Removed the config-file token.*could not be checked/.test(error.message)
    );
    assert.equal(Object.hasOwn((await readConfig(env)).profiles.default, "token"), false);

    await assert.rejects(
      () => deleteProfileToken("default", env, disabledStore),
      /Could not verify or remove/
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
