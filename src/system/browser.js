import { spawn } from "node:child_process";

export function shouldOpenBrowser(options, env) {
  if (options.noBrowser) return false;
  if (env.LOGISTER_NO_BROWSER === "1") return false;
  if (env.CI === "true" || env.CI === "1") return false;
  return true;
}

export function openBrowser(url) {
  const { command, args } = browserCommand(url);
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.on("error", () => {});
  child.unref();
}

function browserCommand(url) {
  if (process.platform === "darwin") return { command: "open", args: [url] };
  if (process.platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}
