import test from "node:test";
import assert from "node:assert/strict";
import { redactValue } from "../src/redaction/redact.js";

test("redacts sensitive-looking keys recursively", () => {
  const result = redactValue({
    token: "secret",
    token_present: true,
    nested: {
      Authorization: "Bearer abc",
      authorization_details: { value: "Bearer nested-secret" },
      value: "kept"
    },
    tokens: [ "one", "two" ],
    records: [{ email: "person@example.com", message: "hello" }]
  });

  assert.equal(result.token, "[REDACTED]");
  assert.equal(result.token_present, true);
  assert.equal(result.nested.Authorization, "[REDACTED]");
  assert.equal(result.nested.authorization_details, "[REDACTED]");
  assert.equal(result.nested.value, "kept");
  assert.equal(result.tokens, "[REDACTED]");
  assert.equal(result.records[0].email, "[REDACTED]");
  assert.equal(result.records[0].message, "hello");
});

test("redaction normalizes separator and camel-case secret keys without matching safe words", () => {
  const payload = redactValue({
    nested: {
      "x-api-key": "one",
      "api-key": "two",
      "private.key": "three",
      privateKey: "four",
      monkey: "visible",
      tokenizer_version: "visible",
      secretary_name: "visible"
    }
  });

  assert.equal(payload.nested["x-api-key"], "[REDACTED]");
  assert.equal(payload.nested["api-key"], "[REDACTED]");
  assert.equal(payload.nested["private.key"], "[REDACTED]");
  assert.equal(payload.nested.privateKey, "[REDACTED]");
  assert.equal(payload.nested.monkey, "visible");
  assert.equal(payload.nested.tokenizer_version, "visible");
  assert.equal(payload.nested.secretary_name, "visible");
});
