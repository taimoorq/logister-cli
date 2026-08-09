import { sanitizeTerminalText } from "../output/sanitize.js";

export function installProcessGuards({ runtimeProcess, stdout, controller }) {
  const state = { brokenPipe: false };
  const handleBrokenPipe = () => {
    state.brokenPipe = true;
    runtimeProcess.exitCode = 0;
    controller.abort("EPIPE");
  };
  const onSigint = () => {
    runtimeProcess.exitCode = 130;
    controller.abort("SIGINT");
  };
  const onStdoutError = (error) => {
    if (error.code === "EPIPE") {
      handleBrokenPipe();
      return;
    }
    throw error;
  };

  runtimeProcess.once("SIGINT", onSigint);
  stdout.on("error", onStdoutError);
  return {
    get brokenPipe() { return state.brokenPipe; },
    handleBrokenPipe,
    dispose() {
      runtimeProcess.removeListener("SIGINT", onSigint);
      stdout.removeListener("error", onStdoutError);
    }
  };
}

export function writeProcessError(stderr, error) {
  const message = sanitizeTerminalText(error?.message || error, { preserveNewlines: true });
  stderr.write(`${message}\n`);
}
