import { spawn } from "node:child_process";

export function shouldOpenBrowser(options, env) {
  if (options.noBrowser) return false;
  if (env.LOGISTER_NO_BROWSER === "1") return false;
  if (env.CI === "true" || env.CI === "1") return false;
  return true;
}

export function openBrowser(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  const { command, args } = browserCommand(url, platform);
  const child = spawnImpl(command, args, {
    detached: true,
    stdio: "ignore",
    shell: false
  });
  child.on("error", () => {});
  child.unref();
}

export function browserCommand(url, platform = process.platform) {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "explorer.exe", args: [url] };
  return { command: "xdg-open", args: [url] };
}
