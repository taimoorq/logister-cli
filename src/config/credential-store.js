import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const SERVICE = "logister-cli";
const SECURITY_BINARY = "/usr/bin/security";

export async function readStoredToken(profileName, origin) {
  const keychain = await readMacosKeychain(profileName, origin);
  if (keychain) return { token: keychain, source: "macos-keychain" };

  return { token: "", source: "" };
}

export async function writeStoredToken(profileName, origin, token) {
  if (await writeMacosKeychain(profileName, origin, token)) return "macos-keychain";
  return "";
}

export async function deleteStoredToken(profileName, origin, options) {
  return deleteMacosKeychain(profileName, origin, options);
}

export async function legacyStoredTokenStatus(profileName) {
  if (process.platform !== "darwin") return "not-applicable";
  if (keychainDisabled()) return "disabled";
  return inspectLegacyMacosKeychainItem(profileName);
}

async function readMacosKeychain(profileName, origin) {
  if (keychainDisabled()) return "";
  if (process.platform !== "darwin") return "";
  if (!origin) return "";

  try {
    const result = await execFile(SECURITY_BINARY, [
      "find-generic-password",
      "-a",
      account(profileName, origin),
      "-s",
      SERVICE,
      "-w"
    ]);
    return result.stdout.toString("utf8").trim();
  } catch {
    return "";
  }
}

async function writeMacosKeychain(profileName, origin, token) {
  if (keychainDisabled()) return false;
  if (process.platform !== "darwin") return false;
  if (!origin) return false;

  return writeMacosKeychainToken(profileName, origin, token);
}

export async function writeMacosKeychainToken(profileName, origin, token, spawnImpl = spawn) {
  const args = [
    "add-generic-password",
    "-a",
    account(profileName, origin),
    "-s",
    SERVICE,
    "-U",
    "-w"
  ];

  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(SECURITY_BINARY, args, { stdio: ["pipe", "ignore", "ignore"] });
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
    child.stdin.once("error", () => finish(false));
    child.stdin.end(`${token}\n`);
  });
}

async function deleteMacosKeychain(profileName, origin, { includeOrigin = true, includeLegacy = true } = {}) {
  if (process.platform !== "darwin") return { store: "macos-keychain", status: "not-applicable" };
  if (keychainDisabled()) return { store: "macos-keychain", status: "disabled" };

  const accounts = [];
  if (includeOrigin && origin) accounts.push(account(profileName, origin));
  if (includeLegacy) accounts.push(legacyAccount(profileName));
  if (accounts.length === 0) return { store: "macos-keychain", status: "not-found" };

  const results = [];
  for (const accountName of accounts) results.push(await deleteMacosKeychainAccount(accountName));
  if (results.includes("failed")) return { store: "macos-keychain", status: "failed" };
  if (results.includes("deleted")) return { store: "macos-keychain", status: "deleted" };
  return { store: "macos-keychain", status: "not-found" };
}

export async function deleteMacosKeychainToken(profileName, origin, execImpl = execFile) {
  const status = await deleteMacosKeychainAccount(account(profileName, origin), execImpl);
  return { store: "macos-keychain", status };
}

export async function inspectLegacyMacosKeychainItem(profileName, execImpl = execFile) {
  try {
    await execImpl(SECURITY_BINARY, [
      "find-generic-password",
      "-a",
      legacyAccount(profileName),
      "-s",
      SERVICE
    ]);
    return "present";
  } catch (error) {
    return keychainItemNotFound(error) ? "not-found" : "failed";
  }
}

async function deleteMacosKeychainAccount(accountName, execImpl = execFile) {
  try {
    await execImpl(SECURITY_BINARY, [
      "delete-generic-password",
      "-a",
      accountName,
      "-s",
      SERVICE
    ]);
    return "deleted";
  } catch (error) {
    if (keychainItemNotFound(error)) return "not-found";
    return "failed";
  }
}

function account(profileName, origin) {
  const originHash = createHash("sha256").update(origin).digest("hex");
  return `profile:${profileName}:origin:${originHash}`;
}

function legacyAccount(profileName) {
  return `profile:${profileName}`;
}

function keychainDisabled() {
  return process.env.LOGISTER_DISABLE_KEYCHAIN === "1" || process.env.LOGISTER_KEYCHAIN === "0";
}

function keychainItemNotFound(error) {
  const detail = `${error?.stderr || ""}\n${error?.message || ""}`;
  return /specified item could not be found|errSecItemNotFound/i.test(detail);
}
