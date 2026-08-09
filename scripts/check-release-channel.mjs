#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { compareVersions, isValidVersion } from "../src/version/semver.js";

export function verifyStableReleaseOrder({ releaseVersion, currentLatest }) {
  const result = verifyReleaseChannelOrder({
    releaseVersion,
    currentVersion: currentLatest,
    channel: "latest",
    allowMissing: false
  });
  return { releaseVersion: result.releaseVersion, currentLatest: result.currentVersion };
}

export function verifyReleaseChannelOrder({ releaseVersion, currentVersion, channel, allowMissing = true }) {
  const candidate = String(releaseVersion || "").trim();
  const current = String(currentVersion || "").trim();
  const normalizedChannel = String(channel || "").trim();

  if (!isValidVersion(candidate, { allowVPrefix: false })) {
    throw new Error(`Release version must be strict SemVer without a leading v: ${candidate || "(empty)"}`);
  }
  if (!/^[a-z][a-z0-9._-]{0,31}$/.test(normalizedChannel)) {
    throw new Error(`Invalid npm distribution channel: ${normalizedChannel || "(empty)"}`);
  }
  if (!current && allowMissing) {
    return { releaseVersion: candidate, currentVersion: null, channel: normalizedChannel, firstRelease: true };
  }
  if (!isValidVersion(current, { allowVPrefix: false })) {
    throw new Error(`Current npm ${normalizedChannel} version must be strict SemVer: ${current || "(empty)"}`);
  }

  if (compareVersions(candidate, current) < 0) {
    throw new Error(
      `Refusing to move npm ${normalizedChannel} backward from ${current} to ${candidate}. ` +
      "Use a newer version, or define a separate release channel with an explicit policy."
    );
  }

  return { releaseVersion: candidate, currentVersion: current, channel: normalizedChannel, firstRelease: false };
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function main() {
  const args = process.argv.slice(2);
  verifyReleaseChannelOrder({
    releaseVersion: valueAfter(args, "--release-version"),
    currentVersion: valueAfter(args, "--current-version") ?? valueAfter(args, "--current-latest"),
    channel: valueAfter(args, "--channel") || "latest",
    allowMissing: args.includes("--allow-missing")
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
