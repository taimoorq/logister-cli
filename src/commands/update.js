import { spawnSync } from "node:child_process";
import { latestRelease } from "../update/releases.js";

export async function runUpdateCommand(_args, context) {
  const latest = await latestRelease().catch((error) => ({ error: error.message }));
  const packageManager = detectPackageManager();
  const command = packageManager === "npm"
    ? "npm install -g @logister/cli@latest"
    : "Install the latest @logister/cli package from npm or GitHub Releases.";

  if (context.parsed.options.apply && packageManager === "npm") {
    const result = spawnSync("npm", ["install", "-g", "@logister/cli@latest"], {
      stdio: "inherit"
    });
    if (result.status !== 0) {
      const error = new Error("npm self-update failed.");
      error.exitCode = result.status || 1;
      throw error;
    }
    return;
  }

  context.write({
    current_version: context.runtime.version,
    latest,
    package_manager: packageManager,
    update_command: command,
    apply_available: packageManager === "npm"
  }, { format: context.parsed.options.format || "table", redact: false });
}

function detectPackageManager() {
  const execPath = process.env.npm_execpath || "";
  if (execPath.includes("npm")) return "npm";
  return "unknown";
}
