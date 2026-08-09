import { readFile, writeFile, mkdir, chmod, rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { packageInfo } from "../version/package.js";
import { normalizeLogisterOrigin } from "../api/origin.js";
import { deleteStoredToken, legacyStoredTokenStatus, readStoredToken, writeStoredToken } from "./credential-store.js";
import { isPrintableToken, MAX_TOKEN_BYTES } from "./token.js";

const DEFAULT_CREDENTIAL_STORE = Object.freeze({ deleteStoredToken, legacyStoredTokenStatus, readStoredToken, writeStoredToken });

export async function loadRuntime(options, env, credentialStore = DEFAULT_CREDENTIAL_STORE) {
  const config = await readConfig(env);
  const profileName = options.profile || env.LOGISTER_PROFILE || config.defaultProfile || "default";
  validateProfileName(profileName, "active profile");
  const profile = config.profiles?.[profileName] || {};
  validateActiveProfile(profile, profileName);
  const allowInsecureHttp = options.allowInsecureHttp || env.LOGISTER_ALLOW_INSECURE_HTTP === "1";
  const requestedHost = options.host || env.LOGISTER_HOST || profile.host || "";
  validateRuntimeString(requestedHost, "host", { maximum: 2048, allowEmpty: true });
  const host = normalizeLogisterOrigin(requestedHost, { allowInsecureHttp });
  const savedOrigin = safeStoredOrigin(profile.host);
  const explicitToken = options.token || env.LOGISTER_TOKEN || "";
  const mayUseProfileCredential = !explicitToken && Boolean(host) && host === savedOrigin;
  let storedCredential = { token: "", source: "" };
  if (mayUseProfileCredential) {
    storedCredential = await credentialStore.readStoredToken(profileName, host);
    if (profile.token) {
      const migratedStore = await credentialStore.writeStoredToken(profileName, host, profile.token);
      if (migratedStore) {
        storedCredential = { token: profile.token, source: migratedStore };
        await removePlaintextProfileToken(config, profileName, env);
      } else {
        // A host-bound plaintext fallback is newer and authoritative over any
        // stale value that remains in the secure store after a failed update.
        storedCredential = { token: "", source: "" };
      }
    }
  }
  const fallbackToken = mayUseProfileCredential ? profile.token || "" : "";
  const token = explicitToken || storedCredential.token || fallbackToken;
  if (!isPrintableToken(token, { allowEmpty: true })) {
    configurationError(`token must be empty or a printable string no longer than ${MAX_TOKEN_BYTES} bytes`);
  }
  const project = options.project || env.LOGISTER_PROJECT || (host === savedOrigin ? profile.project : "") || "";
  validateRuntimeString(project, "project", { maximum: 255, allowEmpty: true });

  const format = options.format || env.LOGISTER_FORMAT || profile.format || "table";
  if (!["table", "json", "ndjson", "markdown"].includes(format)) {
    const error = new Error(`Invalid Logister output format '${format}' in the active environment or profile.`);
    error.exitCode = 2;
    throw error;
  }
  const timeoutMs = runtimeInteger(options.timeoutMs || env.LOGISTER_TIMEOUT_MS || profile.timeout_ms || 15_000, "request timeout", 100, 120_000);
  const retries = runtimeInteger(options.retries ?? env.LOGISTER_RETRIES ?? profile.retries ?? 2, "retry count", 0, 5);
  const legacyCredentialStatus = !token && credentialStore.legacyStoredTokenStatus
    ? await credentialStore.legacyStoredTokenStatus(profileName)
    : "not-checked";

  return {
    version: packageInfo.version,
    profileName,
    config,
    configPath: configPath(env),
    host,
    token,
    tokenSource: token ? tokenSource(options, env, storedCredential, fallbackToken) : "",
    project,
    format,
    timeoutMs,
    retries,
    scopes: mayUseProfileCredential && Array.isArray(profile.scopes) ? profile.scopes : [],
    expiresAt: mayUseProfileCredential ? profile.expires_at || null : null,
    allowInsecureHttp,
    legacyCredentialStatus,
    legacyCredentialPending: legacyCredentialStatus === "present"
  };
}

export function loadPublicRuntime(options, env) {
  const format = options.format || env.LOGISTER_FORMAT || "table";
  if (!["table", "json", "ndjson", "markdown"].includes(format)) {
    const error = new Error(`Invalid Logister output format '${format}' in the active environment.`);
    error.exitCode = 2;
    throw error;
  }
  return {
    version: packageInfo.version,
    format,
    timeoutMs: runtimeInteger(options.timeoutMs || env.LOGISTER_TIMEOUT_MS || 15_000, "request timeout", 100, 120_000),
    retries: runtimeInteger(options.retries ?? env.LOGISTER_RETRIES ?? 2, "retry count", 0, 5),
    host: "",
    token: "",
    allowInsecureHttp: false,
    legacyCredentialPending: false
  };
}

export async function loadCleanupRuntime(options, env) {
  const config = await readConfig(env);
  const profileName = options.profile || env.LOGISTER_PROFILE || config.defaultProfile || "default";
  validateProfileName(profileName, "active profile");
  const profile = config.profiles?.[profileName] || {};
  validateActiveProfile(profile, profileName);
  const host = safeStoredOrigin(profile.host);
  return {
    version: packageInfo.version,
    profileName,
    config,
    configPath: configPath(env),
    host,
    token: "",
    tokenSource: "",
    project: "",
    format: "table",
    timeoutMs: 15_000,
    retries: 0,
    scopes: [],
    expiresAt: null,
    allowInsecureHttp: true,
    legacyCredentialStatus: "not-checked",
    legacyCredentialPending: false
  };
}

export async function readConfig(env = process.env) {
  const path = configPath(env);
  if (!existsSync(path)) return { defaultProfile: "default", profiles: {} };

  const raw = await readFile(path, "utf8");
  try {
    const config = JSON.parse(raw);
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("root must be an object");
    if (config.profiles !== undefined && (!config.profiles || typeof config.profiles !== "object" || Array.isArray(config.profiles))) {
      throw new Error("profiles must be an object");
    }
    if (config.defaultProfile !== undefined) validateProfileName(config.defaultProfile, "defaultProfile");
    return config;
  } catch (error) {
    const configError = new Error(`Invalid Logister config at ${path}: ${error.message}`);
    configError.exitCode = 2;
    throw configError;
  }
}

export async function writeProfile(profileName, profile, env = process.env) {
  const path = configPath(env);
  const config = await readConfig(env);
  const profiles = { ...(config.profiles || {}) };
  profiles[profileName] = { ...(profiles[profileName] || {}), ...profile };
  const nextConfig = {
    defaultProfile: config.defaultProfile || profileName,
    ...config,
    profiles
  };

  await writeConfigAtomic(path, nextConfig);
  return nextConfig;
}

export async function saveProfileLogin(
  profileName,
  login,
  env = process.env,
  credentialStore = DEFAULT_CREDENTIAL_STORE,
  configWriter = writeConfigAtomic
) {
  validateProfileName(profileName, "active profile");
  if (!isPrintableToken(login.token)) configurationError(`token must be a printable string no longer than ${MAX_TOKEN_BYTES} bytes`);
  const allowInsecureHttp = login.allowInsecureHttp || env.LOGISTER_ALLOW_INSECURE_HTTP === "1";
  const origin = normalizeLogisterOrigin(login.host, { allowInsecureHttp });
  if (!origin) configurationError("login host is required");

  const path = configPath(env);
  const config = await readConfig(env);
  const previousProfile = config.profiles?.[profileName] || {};
  const previousOrigin = safeStoredOrigin(previousProfile.host);
  let previousBoundToken = previousProfile.token || "";
  if (!previousBoundToken && previousOrigin === origin) {
    previousBoundToken = (await credentialStore.readStoredToken(profileName, origin)).token || "";
  }

  // Persist the new credential before changing the profile's host metadata.
  // A failure or interruption therefore leaves the old host/credential pair intact.
  const credentialStoreName = await credentialStore.writeStoredToken(profileName, origin, login.token);
  const nextProfile = {
    ...previousProfile,
    host: origin,
    project: login.project || undefined,
    scopes: login.scopes || [],
    expires_at: login.expiresAt || null,
    token_type: login.tokenType || "Bearer"
  };
  if (credentialStoreName) delete nextProfile.token;
  else nextProfile.token = login.token;
  const profiles = { ...(config.profiles || {}), [profileName]: nextProfile };
  const nextConfig = {
    ...config,
    defaultProfile: config.defaultProfile || profileName,
    profiles
  };

  try {
    await configWriter(path, nextConfig);
  } catch (error) {
    if (credentialStoreName) {
      let restored = false;
      if (previousOrigin === origin && previousBoundToken) {
        restored = Boolean(await credentialStore.writeStoredToken(profileName, origin, previousBoundToken).catch(() => ""));
      } else {
        const rollback = await credentialStore.deleteStoredToken(
          profileName,
          origin,
          { includeOrigin: true, includeLegacy: false }
        ).catch(() => ({ status: "failed" }));
        restored = ["deleted", "not-found", "not-applicable"].includes(rollback?.status);
      }
      if (!restored) {
        await credentialStore.deleteStoredToken(
          profileName,
          origin,
          { includeOrigin: true, includeLegacy: false }
        ).catch(() => {});
        const rollbackError = new Error("Logister profile update failed and the previous Keychain credential could not be restored. Run `logister auth login` again before using this profile.");
        rollbackError.exitCode = 1;
        rollbackError.cause = error;
        throw rollbackError;
      }
    }
    throw error;
  }

  let cleanupResult = { status: "not-found" };
  if (credentialStoreName && previousOrigin === origin) {
    cleanupResult = await credentialStore.deleteStoredToken(profileName, origin, { includeOrigin: false, includeLegacy: true });
  } else {
    cleanupResult = await credentialStore.deleteStoredToken(profileName, previousOrigin, { includeOrigin: Boolean(previousOrigin), includeLegacy: true });
  }

  return {
    config: nextConfig,
    tokenStore: credentialStoreName || "config-file",
    cleanupResult
  };
}

export async function writeProfileToken(profileName, token, env = process.env, credentialStore = DEFAULT_CREDENTIAL_STORE) {
  const config = await readConfig(env);
  const origin = normalizeLogisterOrigin(config.profiles?.[profileName]?.host || "", { allowInsecureHttp: true });
  if (!origin) configurationError(`profile '${profileName}' must have a host before saving a token`);
  const credentialStoreName = await credentialStore.writeStoredToken(profileName, origin, token);
  if (credentialStoreName) {
    await removePlaintextProfileToken(config, profileName, env);
    return credentialStoreName;
  }

  const path = configPath(env);
  const profiles = { ...(config.profiles || {}) };
  profiles[profileName] = { ...(profiles[profileName] || {}), token };
  await writeConfigAtomic(path, { ...config, profiles });
  return "config-file";
}

export async function deleteProfileToken(profileName, env = process.env, credentialStore = DEFAULT_CREDENTIAL_STORE) {
  const path = configPath(env);
  const config = await readConfig(env);
  const origin = safeStoredOrigin(config.profiles?.[profileName]?.host);
  const storedResult = await credentialStore.deleteStoredToken(profileName, origin);
  const hadConfigToken = Object.hasOwn(config.profiles?.[profileName] || {}, "token");
  if (storedResult?.status === "disabled") {
    if (hadConfigToken) {
      delete config.profiles[profileName].token;
      await writeConfigAtomic(path, config);
      const partialError = new Error("Removed the config-file token, but macOS Keychain access is disabled and could not be checked. Enable Keychain access and run logout again.");
      partialError.exitCode = 1;
      partialError.partial = true;
      throw partialError;
    }
    const error = new Error("Could not verify or remove the Logister token because macOS Keychain access is disabled. Enable Keychain access and retry logout.");
    error.exitCode = 1;
    throw error;
  }
  if (storedResult?.status === "failed") {
    const error = new Error("Could not remove the Logister token from macOS Keychain. Unlock Keychain or allow access, then retry logout.");
    error.exitCode = 1;
    throw error;
  }

  if (!config.profiles?.[profileName]) {
    return { config, removed: storedResult?.status === "deleted", storedResult };
  }

  delete config.profiles[profileName].token;
  await writeConfigAtomic(path, config);
  return {
    config,
    removed: hadConfigToken || storedResult?.status === "deleted",
    storedResult
  };
}

export function configPath(env = process.env) {
  if (env.LOGISTER_CONFIG) return env.LOGISTER_CONFIG;
  const root = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(root, "logister", "config.json");
}

function tokenSource(options, env, storedCredential, fallbackToken) {
  if (options.token) return "option";
  if (env.LOGISTER_TOKEN) return "environment";
  if (storedCredential.token) return storedCredential.source;
  if (fallbackToken) return "config-file";
  return "";
}

async function removePlaintextProfileToken(config, profileName, env) {
  if (!config.profiles?.[profileName] || !Object.hasOwn(config.profiles[profileName], "token")) return config;

  const path = configPath(env);
  const profiles = { ...config.profiles };
  profiles[profileName] = { ...profiles[profileName] };
  delete profiles[profileName].token;
  const nextConfig = { ...config, profiles };
  await writeConfigAtomic(path, nextConfig);
  return nextConfig;
}

async function writeConfigAtomic(path, config) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function runtimeInteger(value, label, min, max) {
  if (!/^\d+$/.test(String(value))) {
    const error = new Error(`Invalid Logister ${label} '${value}'; expected an integer from ${min} to ${max}.`);
    error.exitCode = 2;
    throw error;
  }
  const number = Number(value);
  if (number < min || number > max) {
    const error = new Error(`Invalid Logister ${label} '${value}'; expected an integer from ${min} to ${max}.`);
    error.exitCode = 2;
    throw error;
  }
  return number;
}

function validateActiveProfile(profile, profileName) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    configurationError(`profile '${profileName}' must be an object`);
  }
  for (const [key, maximum] of [["host", 2048], ["token", 8192], ["project", 255], ["format", 20]]) {
    if (profile[key] !== undefined) validateRuntimeString(profile[key], `profile ${key}`, { maximum });
  }
  if (profile.scopes !== undefined) {
    if (!Array.isArray(profile.scopes) || profile.scopes.length > 100 || !profile.scopes.every((scope) => typeof scope === "string" && /^[a-z_]+:(?:read|write)$/.test(scope))) {
      configurationError(`profile '${profileName}' scopes must be an array of valid scope names`);
    }
  }
  if (profile.expires_at !== undefined && profile.expires_at !== null) {
    if (typeof profile.expires_at !== "string" || !Number.isFinite(Date.parse(profile.expires_at))) {
      configurationError(`profile '${profileName}' expires_at must be an ISO-8601 timestamp or null`);
    }
  }
  for (const key of ["timeout_ms", "retries"]) {
    if (profile[key] !== undefined && !["string", "number"].includes(typeof profile[key])) {
      configurationError(`profile '${profileName}' ${key} must be an integer`);
    }
  }
}

function validateProfileName(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value) || ["__proto__", "constructor", "prototype"].includes(value)) {
    configurationError(`${label} must use 1 to 100 letters, numbers, dots, underscores, or hyphens`);
  }
}

function validateRuntimeString(value, label, { maximum, allowEmpty = false }) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > maximum || /[\u0000-\u001F\u007F]/.test(value)) {
    configurationError(`${label} must be ${allowEmpty ? "empty or " : ""}a printable string no longer than ${maximum} characters`);
  }
}

function configurationError(message) {
  const error = new Error(`Invalid Logister configuration: ${message}.`);
  error.exitCode = 2;
  throw error;
}

function safeStoredOrigin(value) {
  if (!value) return "";
  try {
    return normalizeLogisterOrigin(value, { allowInsecureHttp: true });
  } catch {
    return "";
  }
}
