import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { browserCommand, openBrowser } from "../src/system/browser.js";

test("Windows browser launch passes metacharacter URLs directly without a command shell", () => {
  const url = "https://logister.example/approve?code=ABCD&next=%7Ccalc.exe%26whoami";
  const command = browserCommand(url, "win32");

  assert.deepEqual(command, { command: "explorer.exe", args: [url] });
  assert.equal(command.args.includes("/c"), false);
  assert.equal(command.args.includes("start"), false);
});

test("browser launch explicitly disables shell interpretation", () => {
  const observed = {};
  const child = new EventEmitter();
  child.unref = () => { observed.unref = true; };
  const spawnImpl = (command, args, options) => {
    observed.command = command;
    observed.args = args;
    observed.options = options;
    return child;
  };
  const url = "https://logister.example/approve?a=1&b=2|ignored";

  openBrowser(url, { platform: "win32", spawnImpl });

  assert.equal(observed.command, "explorer.exe");
  assert.deepEqual(observed.args, [url]);
  assert.deepEqual(observed.options, { detached: true, stdio: "ignore", shell: false });
  assert.equal(observed.unref, true);
});
