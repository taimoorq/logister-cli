#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function verifyReleaseRef({ tagRef, expectedTag, mainRef, cwd = process.cwd() }) {
  if (!String(tagRef || "").startsWith("refs/tags/v")) {
    throw new Error(`Release ref must be a v* tag ref; received ${tagRef || "(empty)"}`);
  }
  if (!expectedTag) throw new Error("The package-version release tag is required");
  if (tagRef !== `refs/tags/${expectedTag}`) {
    throw new Error(`Release ref must be refs/tags/${expectedTag}; received ${tagRef}`);
  }
  if (!mainRef) throw new Error("A protected main ref is required");

  const tagCommit = gitOutput(["rev-parse", "--verify", `${tagRef}^{commit}`], cwd);
  const mainCommit = gitOutput(["rev-parse", "--verify", `${mainRef}^{commit}`], cwd);
  const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", tagCommit, mainCommit], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (ancestry.error) throw ancestry.error;
  if (ancestry.status !== 0) {
    throw new Error(`Release tag commit ${tagCommit} is not reachable from protected main ${mainCommit}`);
  }

  return { tagCommit, mainCommit };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument: ${key || "(empty)"}`);
    values[key.slice(2).replace(/-([a-z])/g, (_, character) => character.toUpperCase())] = value;
  }
  return values;
}

function gitOutput(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = verifyReleaseRef({ tagRef: args.tagRef, expectedTag: args.expectedTag, mainRef: args.mainRef });
  process.stdout.write(`release ref ok ${result.tagCommit}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
