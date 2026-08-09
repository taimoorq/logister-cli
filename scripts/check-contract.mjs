#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyCliOperations } from "./contract-check-lib.mjs";

const lockPath = resolve("contracts/logister-api.lock");
const lock = parseLock(await readFile(lockPath, "utf8"));
if (!/^https:\/\//.test(lock.source || "")) fail("contract lock source must be a canonical HTTPS URL");
if (lock.file !== "contracts/logister-openapi.yaml") fail("contract lock file must be contracts/logister-openapi.yaml");
if (!/^[a-f0-9]{64}$/.test(lock.sha256 || "")) fail("contract lock sha256 is invalid");

const contract = await readFile(resolve(lock.file), "utf8");
const actualSha = createHash("sha256").update(contract).digest("hex");
if (actualSha !== lock.sha256) fail(`contract SHA mismatch: lock=${lock.sha256} actual=${actualSha}`);

try {
  verifyCliOperations(contract);
} catch (error) {
  fail(error.message);
}

for (const feature of ["traces", "monitors", "deployments", "insights", "metrics"]) {
  if (!new RegExp(`^\\s+${feature}:`, "m").test(contract)) fail(`contract is missing CLI capability ${feature}`);
}

if (!/^\s*version:\s*["']?3\.5["']?\s*$/m.test(contract)) fail("CLI v1.0.0 requires API contract version 3.5");
process.stdout.write(`Contract verified: ${lock.file}\nsha256=${actualSha}\n`);

function parseLock(body) {
  return Object.fromEntries(body.trim().split("\n").map((line) => {
    const index = line.indexOf("=");
    if (index < 1) fail(`invalid contract lock line: ${line}`);
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

function fail(message) {
  process.stderr.write(`Contract check failed: ${message}\n`);
  process.exit(1);
}
