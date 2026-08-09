#!/usr/bin/env node
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isValidVersion } from "../src/version/semver.js";
import { validateSha256 } from "./update-package-manager-repos.mjs";

const repositories = {
  release: "https://api.github.com/repos/taimoorq/logister-cli/releases/tags/",
  homebrew: "https://raw.githubusercontent.com/taimoorq/homebrew-logister/main/Formula/logister.rb",
  scoop: "https://raw.githubusercontent.com/taimoorq/scoop-logister/main/bucket/logister.json"
};

export async function reconcileDistributions({ version, expectedSha256, fetchImpl = fetch }) {
  if (!isValidVersion(version, { allowVPrefix: false }) || version.includes("-")) {
    throw new Error(`Distribution reconciliation requires a stable semantic version: ${version || "(empty)"}`);
  }

  const npmMetadata = await fetchJson(`https://registry.npmjs.org/logister-cli/${version}`, fetchImpl);
  const tarballUrl = npmMetadata?.dist?.tarball;
  if (npmMetadata.version !== version || typeof tarballUrl !== "string") {
    throw new Error(`npm does not expose logister-cli ${version}`);
  }
  const tarball = await fetchBytes(tarballUrl, fetchImpl);
  const sha256 = createHash("sha256").update(tarball).digest("hex");
  if (expectedSha256 && validateSha256(expectedSha256) !== sha256) {
    throw new Error(`Callback SHA256 does not match npm for ${version}`);
  }

  const release = await fetchJson(`${repositories.release}v${version}`, fetchImpl, githubHeaders());
  if (release.tag_name !== `v${version}` || release.draft || release.prerelease) {
    throw new Error(`GitHub Release v${version} is missing or not a public stable release`);
  }

  const formula = await fetchText(repositories.homebrew, fetchImpl);
  const formulaUrl = formula.match(/^\s*url\s+"([^"]+)"/m)?.[1];
  const formulaSha = formula.match(/^\s*sha256\s+"([a-f0-9]{64})"/m)?.[1];
  if (formulaUrl !== tarballUrl || formulaSha !== sha256) {
    throw new Error(`Homebrew metadata has not converged to logister-cli ${version}`);
  }

  const scoop = await fetchJson(repositories.scoop, fetchImpl);
  if (scoop.version !== version || scoop.url !== tarballUrl || scoop.hash !== sha256) {
    throw new Error(`Scoop metadata has not converged to logister-cli ${version}`);
  }

  return {
    schema_version: 1,
    version,
    sha256,
    channels: {
      npm: { version, url: tarballUrl },
      github_release: { tag: `v${version}`, url: release.html_url },
      homebrew: { version, metadata_url: repositories.homebrew },
      scoop: { version, metadata_url: repositories.scoop }
    }
  };
}

async function fetchJson(url, fetchImpl, headers = {}) {
  const response = await fetchImpl(url, { headers: { Accept: "application/json", ...headers } });
  if (!response.ok) throw new Error(`Lookup failed with HTTP ${response.status}: ${url}`);
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("json")) throw new Error(`Lookup did not return JSON: ${url}`);
  return response.json();
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Lookup failed with HTTP ${response.status}: ${url}`);
  const body = await response.text();
  if (body.length > 1_000_000) throw new Error(`Metadata response is too large: ${url}`);
  return body;
}

async function fetchBytes(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Artifact lookup failed with HTTP ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 25_000_000) throw new Error(`Artifact size is invalid: ${url}`);
  return bytes;
}

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  return token ? { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" } : {};
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument: ${key || "(empty)"}`);
    values[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const receipt = await reconcileDistributions({ version: args.version, expectedSha256: args.sha256 });
  const output = `${JSON.stringify(receipt, null, 2)}\n`;
  if (args.output) writeFileSync(args.output, output, "utf8");
  process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
