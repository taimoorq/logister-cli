import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { installProcessGuards, writeProcessError } from "../src/system/process-guards.js";

test("EPIPE aborts ongoing work and exits without an error", () => {
  const runtimeProcess = new EventEmitter();
  const stdout = new EventEmitter();
  const controller = new AbortController();
  const guards = installProcessGuards({ runtimeProcess, stdout, controller });
  const error = new Error("pipe closed");
  error.code = "EPIPE";
  stdout.emit("error", error);

  assert.equal(guards.brokenPipe, true);
  assert.equal(runtimeProcess.exitCode, 0);
  assert.equal(controller.signal.aborted, true);
  assert.equal(controller.signal.reason, "EPIPE");
  guards.dispose();
});

test("SIGINT aborts ongoing work with the conventional exit code", () => {
  const runtimeProcess = new EventEmitter();
  const stdout = new EventEmitter();
  const controller = new AbortController();
  const guards = installProcessGuards({ runtimeProcess, stdout, controller });
  runtimeProcess.emit("SIGINT");

  assert.equal(runtimeProcess.exitCode, 130);
  assert.equal(controller.signal.aborted, true);
  assert.equal(controller.signal.reason, "SIGINT");
  guards.dispose();
});

test("process error output strips terminal sequences while preserving useful lines", () => {
  const stderr = { output: "", write(chunk) { this.output += chunk; } };
  writeProcessError(stderr, new Error("first\u001b[31mRED\u001b[0m\nsecond\u001b]0;owned\u0007\u0007"));
  assert.equal(stderr.output, "firstRED\nsecond\n");
  assert.doesNotMatch(stderr.output, /\u001b|\u0007|owned/);
});
