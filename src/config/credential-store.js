import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const SERVICE = "logister-cli";

export async function readStoredToken(profileName) {
  const keychain = await readMacosKeychain(profileName);
  if (keychain) return { token: keychain, source: "macos-keychain" };

  return { token: "", source: "" };
}

export async function writeStoredToken(profileName, token) {
  if (await writeMacosKeychain(profileName, token)) return "macos-keychain";
  return "";
}

export async function deleteStoredToken(profileName) {
  await deleteMacosKeychain(profileName);
}

async function readMacosKeychain(profileName) {
  if (keychainDisabled()) return "";
  if (process.platform !== "darwin") return "";

  try {
    const result = await execFile("security", [
      "find-generic-password",
      "-a",
      account(profileName),
      "-s",
      SERVICE,
      "-w"
    ]);
    return result.stdout.toString("utf8").trim();
  } catch {
    return "";
  }
}

async function writeMacosKeychain(profileName, token) {
  if (keychainDisabled()) return false;
  if (process.platform !== "darwin") return false;

  try {
    await execFile("security", [
      "add-generic-password",
      "-a",
      account(profileName),
      "-s",
      SERVICE,
      "-w",
      token,
      "-U"
    ]);
    return true;
  } catch {
    return false;
  }
}

async function deleteMacosKeychain(profileName) {
  if (keychainDisabled()) return;
  if (process.platform !== "darwin") return;

  try {
    await execFile("security", [
      "delete-generic-password",
      "-a",
      account(profileName),
      "-s",
      SERVICE
    ]);
  } catch {
    // The item may not exist; logout should still clear config fallback state.
  }
}

function account(profileName) {
  return `profile:${profileName}`;
}

function keychainDisabled() {
  return process.env.LOGISTER_DISABLE_KEYCHAIN === "1" || process.env.LOGISTER_KEYCHAIN === "0";
}
