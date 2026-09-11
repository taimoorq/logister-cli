import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXPECTED_CLI_OPERATIONS, verifyCliOperations, verifyContractVersion, verifyCanonicalSource, verifyArtifactSecurity } from "../scripts/contract-check-lib.mjs";

test("contract accepts reviewed 3.6 patches but requires explicit review for a new API line", () => {
  for (const version of ["3.6", "3.6.7", "3.6.11"]) {
    assert.equal(verifyContractVersion(`info:\n  version: \"${version}\"\npaths:\n`), version);
  }
  for (const version of ["3.5", "3.7.0", "4.0", "3.6.11-rc.1"]) {
    assert.throws(() => verifyContractVersion(`info:\n  version: ${version}\npaths:\n`), /outside reviewed/);
  }
  assert.throws(() => verifyContractVersion("paths:\n  version: 3.6\n"), /missing/);
});

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
