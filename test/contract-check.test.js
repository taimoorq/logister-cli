import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_CLI_OPERATIONS, verifyCliOperations, verifyContractVersion, verifyCanonicalSource, verifyArtifactSecurity } from "../scripts/contract-check-lib.mjs";

test("contract accepts reviewed 4.1 patches but requires explicit review for a new API line", () => {
  for (const version of ["4.1", "4.1.0", "4.1.1"]) {
    assert.equal(verifyContractVersion(`info:\n  version: \"${version}\"\npaths:\n`), version);
  }
  for (const version of ["3.8", "4.0.0", "4.2.0", "5.0", "4.1.1-rc.1"]) {
    assert.throws(() => verifyContractVersion(`info:\n  version: ${version}\npaths:\n`), /outside reviewed/);
  }
  assert.throws(() => verifyContractVersion("paths:\n  version: 3.6\n"), /missing/);
});

test("sync writes a verified 4.1 snapshot and matching lock metadata", () => {
  withSyncFixture((directory, source, target, lock, mockFetch) => {
    const result = runSync(directory, source, target, lock, mockFetch);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(target, "utf8"), readFileSync(source, "utf8"));
    assert.match(readFileSync(lock, "utf8"), /^api_line=4\.1$/m);
  });
});

test("sync rejects an unreviewed API line before replacing the snapshot or lock", () => {
  withSyncFixture((directory, source, target, lock, mockFetch) => {
    writeFileSync(source, readFileSync(source, "utf8").replace('version: "4.1.0"', 'version: "4.2.0"'));
    writeFileSync(target, "existing snapshot");
    writeFileSync(lock, "existing lock");
    const result = runSync(directory, source, target, lock, mockFetch);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside reviewed API line 4\.1/);
    assert.equal(readFileSync(target, "utf8"), "existing snapshot");
    assert.equal(readFileSync(lock, "utf8"), "existing lock");
  });
});

function withSyncFixture(callback) {
  const directory = mkdtempSync(join(tmpdir(), "logister-contract-sync-"));
  const source = join(directory, "source.yaml");
  const mockFetch = join(directory, "mock-fetch.mjs");
  writeFileSync(source, readFileSync(new URL("../contracts/logister-openapi.yaml", import.meta.url)));
  writeFileSync(mockFetch, `import { readFileSync } from "node:fs"; globalThis.fetch = async () => new Response(readFileSync(${JSON.stringify(source)}));`);
  try {
    callback(directory, source, join(directory, "snapshot.yaml"), join(directory, "contract.lock"), mockFetch);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runSync(directory, source, target, lock, mockFetch) {
  return spawnSync(process.execPath, [
    "--import", mockFetch,
    fileURLToPath(new URL("../scripts/sync-contract.mjs", import.meta.url)),
    source, target, lock,
    `https://raw.githubusercontent.com/taimoorq/logister/${"a".repeat(40)}/docs/openapi.yaml`
  ], { cwd: directory, encoding: "utf8" });
}

test("contract source pins the owned canonical file to an immutable commit", () => {
  const prefix = "https://raw.githubusercontent.com/taimoorq/logister/";
  assert.doesNotThrow(() => verifyCanonicalSource(`${prefix}${"a".repeat(40)}/docs/openapi.yaml`));
  for (const source of [`${prefix}main/docs/openapi.yaml`, `${prefix}aaaa/docs/openapi.yaml`, "https://example.com/openapi.yaml"]) {
    assert.throws(() => verifyCanonicalSource(source), /full commit SHA/);
  }
});

test("artifact contract preserves explicit write scope, bearer identity and multipart form", () => {
  const contract = readFileSync(new URL("../contracts/logister-openapi.yaml", import.meta.url), "utf8");
  assert.doesNotThrow(() => verifyArtifactSecurity(contract));
  for (const mutation of [
    contract.replace("x-logister-required-scopes: [artifacts:write]", "x-logister-required-scopes: [events:read]"),
    contract.replace(/(x-logister-required-scopes: \[artifacts:write\][\s\S]*?)cliBearerAuth/, "$1bearerAuth"),
    contract.replace("multipart/form-data:", "application/json:")
  ]) assert.throws(() => verifyArtifactSecurity(mutation), /artifact contract/);
});

test("contract gate requires every CLI path, method, and operationId", () => {
  const valid = contractFixture(EXPECTED_CLI_OPERATIONS);
  assert.doesNotThrow(() => verifyCliOperations(valid));

  const [firstPath, firstMethod, firstOperation] = EXPECTED_CLI_OPERATIONS[0];
  assert.throws(
    () => verifyCliOperations(valid.replace(firstOperation, "renamedOperation")),
    new RegExp(`operationId mismatch.*${firstMethod.toUpperCase()} ${escapeRegExp(firstPath)}`)
  );
  assert.throws(
    () => verifyCliOperations(valid.replace(`    ${firstMethod}:`, "    put:")),
    new RegExp(`missing ${firstMethod.toUpperCase()} ${escapeRegExp(firstPath)}`)
  );
});

function contractFixture(operations) {
  return [
    "openapi: 3.1.0",
    "paths:",
    ...operations.flatMap(([path, method, operationId]) => [
      `  ${path}:`,
      `    ${method}:`,
      `      operationId: ${operationId}`,
      "      responses: {}"
    ]),
    "components:",
    "  schemas: {}"
  ].join("\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
