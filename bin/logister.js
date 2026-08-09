#!/usr/bin/env node
import { main } from "../src/main.js";
import { installProcessGuards, writeProcessError } from "../src/system/process-guards.js";

const controller = new AbortController();
const guards = installProcessGuards({ runtimeProcess: process, stdout: process.stdout, controller });

main(process.argv.slice(2), {
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  signal: controller.signal,
  onBrokenPipe: guards.handleBrokenPipe
}).catch((error) => {
  if (guards.brokenPipe) return;
  if (error?.interrupted) {
    process.exitCode = 130;
    return;
  }
  writeProcessError(process.stderr, error);
  process.exitCode = error.exitCode || 1;
});
