#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const version = args.version || packageJson.version;
const sha256 = args.sha256 || checksumFromFile(args.checksumFile, version) || await checksumFromNpm(version);
const homebrewDir = resolve(args.homebrewDir || "../homebrew-logister");
const scoopDir = resolve(args.scoopDir || "../scoop-logister");

if (!sha256) {
  process.stderr.write("Missing --sha256, --checksum-file, or a published npm tarball for logister-cli X.Y.Z\n");
  process.exit(2);
}

run("node", [
  "scripts/update-formula.mjs",
  "--version",
  version,
  "--sha256",
  sha256
], homebrewDir);

run("node", [
  "scripts/update-manifest.mjs",
  "--version",
  version,
  "--sha256",
  sha256
], scoopDir);

process.stdout.write(`updated package-manager repos for logister-cli ${version}\n`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    parsed[toCamelCase(key.slice(2))] = value;
    index += 1;
  }
  return parsed;
}

function checksumFromFile(path, version) {
  if (!path) return "";
  const checksumPath = resolve(path);
  if (!existsSync(checksumPath)) throw new Error(`Checksum file not found: ${checksumPath}`);

  const filename = `logister-cli-${version}.tgz`;
  const lines = readFileSync(checksumPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const [hash, file] = line.trim().split(/\s+/, 2);
    if (file === filename) return hash;
  }
  return "";
}

async function checksumFromNpm(version) {
  const url = `https://registry.npmjs.org/logister-cli/-/logister-cli-${version}.tgz`;
  const response = await fetch(url);
  if (response.status === 404) return "";
  if (!response.ok) throw new Error(`Failed to download npm tarball ${url}: HTTP ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  return createHash("sha256").update(buffer).digest("hex");
}

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}
