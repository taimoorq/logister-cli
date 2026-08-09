import { spawnSync } from "node:child_process";
import { latestRelease } from "../update/releases.js";
import { isNewerVersion } from "../version/semver.js";

const UPDATE_COMMANDS = {
  npm: "npm install -g logister-cli@latest",
  yarn: "yarn global upgrade logister-cli",
  pnpm: "pnpm add -g logister-cli@latest",
  homebrew: "brew upgrade logister",
  scoop: "scoop update logister",
  winget: "winget upgrade Logister.CLI",
  source: "git pull && npm install",
  unknown: "Install the latest logister-cli package from npm, Homebrew, Scoop, winget, or GitHub Releases."
};

const APPLY_COMMANDS = {
  npm: ["npm", ["install", "-g", "logister-cli@latest"]],
  yarn: ["yarn", ["global", "upgrade", "logister-cli"]],
  pnpm: ["pnpm", ["add", "-g", "logister-cli@latest"]]
};

export async function runUpdateCommand(_args, context) {
  let latest;
  try {
    latest = await latestRelease({
      fetchImpl: context.fetchImpl || globalThis.fetch,
      signal: context.signal,
      timeoutMs: context.runtime.timeoutMs
    });
  } catch (error) {
    if (error?.interrupted || context.signal?.aborted) throw error;
    latest = { error: error.message };
  }
  const installSource = detectInstallSource({
    env: context.env || process.env,
    execPath: process.env.npm_execpath,
    scriptPath: process.argv[1]
  });
  const updateAvailable = isNewerVersion(latest.version, context.runtime.version);

  if (context.parsed.options.apply) {
    applyPackageManagerUpdate(installSource);
    return;
  }

  return context.write({
    current_version: context.runtime.version,
    latest,
    update_available: updateAvailable,
    install_source: installSource,
    update_command: updateCommandFor(installSource),
    apply_available: canApplyUpdate(installSource)
  }, { format: context.parsed.options.format || "table", redact: false });
}

export function detectInstallSource({ env = process.env, execPath = "", scriptPath = "" } = {}) {
  const override = normalizeInstallSource(env.LOGISTER_INSTALL_SOURCE);
  if (override) return override;

  const userAgent = String(env.npm_config_user_agent || "").toLowerCase();
  const exec = String(execPath || env.npm_execpath || "").toLowerCase();
  const script = String(scriptPath || "").replace(/\\/g, "/").toLowerCase();

  if (userAgent.includes("pnpm") || exec.includes("pnpm")) return "pnpm";
  if (userAgent.includes("yarn") || exec.includes("yarn")) return "yarn";
  if (userAgent.includes("npm") || exec.includes("npm")) return "npm";
  if (script.includes("/node_modules/logister-cli/")) return "npm";
  if (script.includes("/cellar/logister/") || script.includes("/homebrew/opt/logister/") || script.includes("/linuxbrew/")) return "homebrew";
  if (script.includes("/scoop/apps/logister/")) return "scoop";
  if (script.includes("/windowsapps/")) return "winget";
  if (script.includes("/logister-cli/")) return "source";
  return "unknown";
}

export function normalizeInstallSource(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "brew") return "homebrew";
  if (normalized === "npm" || normalized === "yarn" || normalized === "pnpm") return normalized;
  if (normalized === "homebrew" || normalized === "scoop" || normalized === "winget") return normalized;
  if (normalized === "source" || normalized === "unknown") return normalized;
  return "";
}

export function updateCommandFor(installSource) {
  return UPDATE_COMMANDS[normalizeInstallSource(installSource) || "unknown"];
}

export function canApplyUpdate(installSource) {
  return Boolean(APPLY_COMMANDS[normalizeInstallSource(installSource)]);
}

function applyPackageManagerUpdate(installSource) {
  const source = normalizeInstallSource(installSource) || "unknown";
  const spec = APPLY_COMMANDS[source];
  if (!spec) {
    const error = new Error(`Automatic update is not available for install source '${source}'. Run: ${updateCommandFor(source)}`);
    error.exitCode = 3;
    throw error;
  }

  const [command, args] = spec;
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    const error = new Error(`${command} self-update failed: ${result.error.message}`);
    error.exitCode = 1;
    throw error;
  }
  if (result.status !== 0) {
    const error = new Error(`${command} self-update failed.`);
    error.exitCode = result.status || 1;
    throw error;
  }
}
