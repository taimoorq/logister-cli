import test from "node:test";
import assert from "node:assert/strict";
import { redactValue } from "../src/redaction/redact.js";

test("redacts sensitive-looking keys recursively", () => {
  const result = redactValue({
    token: "secret",
    token_present: true,
    nested: {
      Authorization: "Bearer abc",
      value: "kept"
    },
    tokens: [ "one", "two" ],
    records: [{ email: "person@example.com", message: "hello" }]
  });

  assert.equal(result.token, "[REDACTED]");
  assert.equal(result.token_present, true);
  assert.equal(result.nested.Authorization, "[REDACTED]");
  assert.equal(result.nested.value, "kept");
  assert.equal(result.tokens, "[REDACTED]");
  assert.equal(result.records[0].email, "[REDACTED]");
  assert.equal(result.records[0].message, "hello");
});
