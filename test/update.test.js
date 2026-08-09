import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canApplyUpdate,
  detectInstallSource,
  normalizeInstallSource,
  updateCommandFor
} from "../src/commands/update.js";

test("detects install source from explicit environment override", () => {
  assert.equal(detectInstallSource({ env: { LOGISTER_INSTALL_SOURCE: "brew" } }), "homebrew");
  assert.equal(detectInstallSource({ env: { LOGISTER_INSTALL_SOURCE: "scoop" } }), "scoop");
});

test("detects npm-family install sources from package manager context", () => {
  assert.equal(detectInstallSource({ env: { npm_config_user_agent: "pnpm/9.0.0 npm/? node/v22" } }), "pnpm");
  assert.equal(detectInstallSource({ env: {}, execPath: "/usr/local/bin/yarn" }), "yarn");
  assert.equal(detectInstallSource({ env: {}, scriptPath: "/usr/local/lib/node_modules/logister-cli/bin/logister.js" }), "npm");
});

test("detects package-manager install paths", () => {
  assert.equal(detectInstallSource({ env: {}, scriptPath: "/opt/homebrew/Cellar/logister/0.1.0/bin/logister" }), "homebrew");
  assert.equal(detectInstallSource({ env: {}, scriptPath: "C:\\Users\\me\\scoop\\apps\\logister\\current\\bin\\logister.js" }), "scoop");
  assert.equal(detectInstallSource({ env: {}, scriptPath: "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\logister.exe" }), "winget");
  assert.equal(detectInstallSource({ env: {}, scriptPath: "/Users/me/dev/logister-cli/bin/logister.js" }), "source");
});

test("maps update commands and automatic update support", () => {
  assert.equal(normalizeInstallSource("brew"), "homebrew");
  assert.equal(updateCommandFor("npm"), "npm install -g logister-cli@latest");
  assert.equal(updateCommandFor("homebrew"), "brew upgrade logister");
  assert.equal(canApplyUpdate("npm"), true);
  assert.equal(canApplyUpdate("homebrew"), false);
  assert.equal(canApplyUpdate("unknown"), false);
});

test("README documents every published package-manager update command", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  for (const source of ["npm", "yarn", "pnpm", "homebrew", "scoop"]) {
    assert.ok(readme.includes(updateCommandFor(source)), `README is missing the ${source} update command`);
  }
  assert.match(readme, /Use the same package manager that installed the CLI/);
  assert.match(readme, /logister version --check/);
  assert.match(readme, /logister version/);
});
