import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { deleteMacosKeychainToken, inspectLegacyMacosKeychainItem, writeMacosKeychainToken } from "../src/config/credential-store.js";

test("macOS Keychain writes pass secrets over stdin instead of process arguments", async () => {
  const secret = "cli-secret-that-must-not-appear-in-argv";
  const observed = { input: "" };
  const spawnImpl = (command, args, options) => {
    observed.command = command;
    observed.args = args;
    observed.options = options;

    const child = new EventEmitter();
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        observed.input += chunk.toString("utf8");
        callback();
      },
      final(callback) {
        queueMicrotask(() => child.emit("close", 0));
        callback();
      }
    });
    return child;
  };

  assert.equal(await writeMacosKeychainToken("default", "https://logister.example", secret, spawnImpl), true);
  assert.equal(observed.command, "/usr/bin/security");
  assert.deepEqual(observed.options, { stdio: ["pipe", "ignore", "ignore"] });
  assert.equal(observed.args.at(-1), "-w");
  assert.equal(observed.args.includes(secret), false);
  assert.equal(JSON.stringify(observed.args).includes(secret), false);
  assert.equal(observed.input, `${secret}\n`);
});

test("macOS Keychain writes fail closed when the security process cannot start", async () => {
  const spawnImpl = () => {
    throw new Error("unavailable");
  };

  assert.equal(await writeMacosKeychainToken("default", "https://logister.example", "secret", spawnImpl), false);
});

test("macOS Keychain deletion distinguishes an absent item from access failure", async () => {
  const absent = Object.assign(new Error("security failed"), {
    stderr: "security: The specified item could not be found in the keychain."
  });
  const denied = Object.assign(new Error("security failed"), {
    stderr: "security: User interaction is not allowed."
  });

  assert.deepEqual(
    await deleteMacosKeychainToken("default", "https://logister.example", async () => { throw absent; }),
    { store: "macos-keychain", status: "not-found" }
  );
  assert.deepEqual(
    await deleteMacosKeychainToken("default", "https://logister.example", async () => { throw denied; }),
    { store: "macos-keychain", status: "failed" }
  );
});

test("legacy Keychain detection checks item existence without reading its secret", async () => {
  let observedArgs;
  const status = await inspectLegacyMacosKeychainItem("default", async (_command, args) => {
    observedArgs = args;
    return { stdout: "metadata only" };
  });
  assert.equal(status, "present");
  assert.equal(observedArgs.includes("-w"), false);
  assert.deepEqual(observedArgs, ["find-generic-password", "-a", "profile:default", "-s", "logister-cli"]);
});
