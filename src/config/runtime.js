import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { packageInfo } from "../version/package.js";
import { deleteStoredToken, readStoredToken, writeStoredToken } from "./credential-store.js";

export async function loadRuntime(options, env) {
  const config = await readConfig(env);
  const profileName = options.profile || env.LOGISTER_PROFILE || config.defaultProfile || "default";
  const profile = config.profiles?.[profileName] || {};
  const storedCredential = await readStoredToken(profileName);
  const token = options.token || env.LOGISTER_TOKEN || storedCredential.token || profile.token || "";

  return {
    version: packageInfo.version,
    profileName,
    config,
    configPath: configPath(env),
    host: options.host || env.LOGISTER_HOST || profile.host || "",
    token,
    tokenSource: token ? tokenSource(options, env, storedCredential, profile) : "",
    project: options.project || env.LOGISTER_PROJECT || profile.project || "",
    format: options.format || env.LOGISTER_FORMAT || "table"
  };
}

export async function readConfig(env = process.env) {
  const path = configPath(env);
  if (!existsSync(path)) return { defaultProfile: "default", profiles: {} };

  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
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

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(nextConfig, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return nextConfig;
}

export async function writeProfileToken(profileName, token, env = process.env) {
  const credentialStore = await writeStoredToken(profileName, token);
  if (credentialStore) return credentialStore;

  const path = configPath(env);
  const config = await readConfig(env);
  const profiles = { ...(config.profiles || {}) };
  profiles[profileName] = { ...(profiles[profileName] || {}), token };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ ...config, profiles }, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return "config-file";
}

export async function deleteProfileToken(profileName, env = process.env) {
  const path = configPath(env);
  const config = await readConfig(env);
  await deleteStoredToken(profileName);
  if (!config.profiles?.[profileName]) return config;

  delete config.profiles[profileName].token;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return config;
}

export function configPath(env = process.env) {
  if (env.LOGISTER_CONFIG) return env.LOGISTER_CONFIG;
  const root = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(root, "logister", "config.json");
}

function tokenSource(options, env, storedCredential, profile) {
  if (options.token) return "option";
  if (env.LOGISTER_TOKEN) return "environment";
  if (storedCredential.token) return storedCredential.source;
  if (profile.token) return "config-file";
  return "";
}
