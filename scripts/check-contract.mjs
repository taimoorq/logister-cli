#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyCliOperations, verifyContractVersion, verifyCanonicalSource, verifyArtifactSecurity } from "./contract-check-lib.mjs";

const lockPath = resolve("contracts/logister-api.lock");
const lock = parseLock(await readFile(lockPath, "utf8"));
try { verifyCanonicalSource(lock.source); } catch (error) { fail(error.message); }
if (lock.file !== "contracts/logister-openapi.yaml") fail("contract lock file must be contracts/logister-openapi.yaml");
if (!lock.api_line) fail("contract lock must declare the reviewed api_line");
if (!/^[a-f0-9]{64}$/.test(lock.sha256 || "")) fail("contract lock sha256 is invalid");

const contract = await readFile(resolve(lock.file), "utf8");
const actualSha = createHash("sha256").update(contract).digest("hex");
if (actualSha !== lock.sha256) fail(`contract SHA mismatch: lock=${lock.sha256} actual=${actualSha}`);

try {
  verifyCliOperations(contract);
  verifyContractVersion(contract, lock.api_line);
  verifyArtifactSecurity(contract);
} catch (error) {
  fail(error.message);
}

for (const feature of ["traces", "monitors", "deployments", "insights", "metrics", "mobile_artifacts"]) {
  if (!new RegExp(`^\\s+${feature}:`, "m").test(contract)) fail(`contract is missing CLI capability ${feature}`);
}

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
