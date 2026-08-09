#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isValidVersion } from "../src/version/semver.js";

export function releaseMetadataForVersion(version) {
  const normalizedVersion = String(version || "").trim();
  if (!isValidVersion(normalizedVersion, { allowVPrefix: false })) {
    throw new Error(`Release version must be strict SemVer without a leading v: ${normalizedVersion || "(empty)"}`);
  }

  const versionWithoutBuildMetadata = normalizedVersion.split("+", 1)[0];
  const isPrerelease = versionWithoutBuildMetadata.includes("-");

  return {
    version: normalizedVersion,
    is_prerelease: String(isPrerelease),
    npm_dist_tag: isPrerelease ? "next" : "latest"
  };
}

export function packageVersion() {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return packageJson.version;
}

function main() {
  const metadata = releaseMetadataForVersion(packageVersion());
  const githubOutput = process.env.GITHUB_OUTPUT;

  if (githubOutput) {
    const lines = Object.entries(metadata).map(([key, value]) => `${key}=${value}`).join("\n");
    appendFileSync(githubOutput, `${lines}\n`, "utf8");
  }

  process.stdout.write(`${JSON.stringify(metadata)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
