#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isValidVersion } from "../src/version/semver.js";

const args = new Set(process.argv.slice(2));
const packageJson = readJson("../package.json");
const packageLock = readJson("../package-lock.json");
const expectedTag = `v${packageJson.version}`;

if (!isValidVersion(packageJson.version, { allowVPrefix: false })) {
  fail(`package.json version must be strict SemVer without a leading v: ${packageJson.version}`);
}

if (packageLock.name !== packageJson.name) {
  fail(`package-lock.json name ${packageLock.name} does not match package.json name ${packageJson.name}`);
}

if (packageLock.version !== packageJson.version) {
  fail(`package-lock.json version ${packageLock.version} does not match package.json version ${packageJson.version}`);
}

const rootPackage = packageLock.packages?.[""];
if (!rootPackage) fail("package-lock.json is missing packages[\"\"] root package metadata");
if (rootPackage.version !== packageJson.version) {
  fail(`package-lock.json packages[\"\"].version ${rootPackage.version} does not match package.json version ${packageJson.version}`);
}

const versionTags = gitTagsPointingAtHead().filter((tag) => /^v\d+\.\d+\.\d+/.test(tag));
if (args.has("--tag-required") && !versionTags.includes(expectedTag)) {
  fail(`release tag must be ${expectedTag}; found ${versionTags.join(", ") || "no v* tag on HEAD"}`);
}

const mismatchedTags = versionTags.filter((tag) => tag !== expectedTag);
if (mismatchedTags.length > 0) {
  fail(`HEAD has release tag(s) that do not match package.json version ${packageJson.version}: ${mismatchedTags.join(", ")}`);
}

process.stdout.write(`version ok ${packageJson.version}\n`);

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function gitTagsPointingAtHead() {
  try {
    return execFileSync("git", ["tag", "--points-at", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim().split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
