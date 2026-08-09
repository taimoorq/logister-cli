#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { releaseMetadataForVersion } from "./release-metadata.mjs";
import { parseExactChecksum } from "./check-npm-release-state.mjs";

export function updatePackageManagerRepos(args) {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const version = args.version || packageJson.version;
  const releaseMetadata = releaseMetadataForVersion(version);

  if (releaseMetadata.is_prerelease === "true") {
    const error = new Error(
      `Refusing to update stable Homebrew or Scoop metadata for prerelease ${version}; ` +
      "prereleases publish only to npm next and a GitHub prerelease."
    );
    error.exitCode = 2;
    throw error;
  }

  const sha256 = validateSha256(args.sha256 || checksumFromFile(args.checksumFile, version));
  const homebrewDir = resolve(args.homebrewDir || "../homebrew-logister");
  const scoopDir = resolve(args.scoopDir || "../scoop-logister");

  run("node", ["scripts/update-formula.mjs", "--version", version, "--sha256", sha256], homebrewDir);
  run("node", ["scripts/update-manifest.mjs", "--version", version, "--sha256", sha256], scoopDir);

  process.stdout.write(`updated package-manager repos for logister-cli ${version}\n`);
}

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

export function checksumFromFile(path, version) {
  if (!path) throw usageError("Missing --sha256 or --checksum-file for the canonical release artifact");
  const checksumPath = resolve(path);
  if (!existsSync(checksumPath)) throw new Error(`Checksum file not found: ${checksumPath}`);
  return parseExactChecksum(readFileSync(checksumPath, "utf8"), `logister-cli-${version}.tgz`);
}

export function validateSha256(value) {
  if (!/^[a-f0-9]{64}$/.test(String(value || ""))) throw usageError("Release SHA256 must be exactly 64 lowercase hexadecimal characters");
  return value;
}

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  return error;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    updatePackageManagerRepos(parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode || 1;
  }
}
