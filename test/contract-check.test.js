import test from "node:test";
import assert from "node:assert/strict";
import { EXPECTED_CLI_OPERATIONS, verifyCliOperations } from "../scripts/contract-check-lib.mjs";

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
