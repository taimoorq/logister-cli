#!/usr/bin/env node
import { main } from "../src/main.js";

main(process.argv.slice(2), {
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr
}).catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = error.exitCode || 1;
});
