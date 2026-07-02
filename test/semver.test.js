import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, isNewerVersion, isValidVersion, normalizeVersion } from "../src/version/semver.js";

test("validates strict package versions", () => {
  assert.equal(isValidVersion("0.1.0", { allowVPrefix: false }), true);
  assert.equal(isValidVersion("1.2.3-rc.1", { allowVPrefix: false }), true);
  assert.equal(isValidVersion("v1.2.3", { allowVPrefix: false }), false);
  assert.equal(isValidVersion("1.02.3", { allowVPrefix: false }), false);
});

test("normalizes release tag prefixes", () => {
  assert.equal(normalizeVersion("v1.2.3"), "1.2.3");
});

test("compares semver versions and prereleases", () => {
  assert.equal(compareVersions("1.2.4", "1.2.3"), 1);
  assert.equal(compareVersions("1.3.0", "1.2.9"), 1);
  assert.equal(compareVersions("2.0.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0-beta.2"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compareVersions("1.0.0+build.2", "1.0.0+build.1"), 0);
});

test("returns nullable update availability for invalid versions", () => {
  assert.equal(isNewerVersion("1.0.1", "1.0.0"), true);
  assert.equal(isNewerVersion("1.0.0", "1.0.1"), false);
  assert.equal(isNewerVersion("not-a-release", "1.0.0"), null);
});
