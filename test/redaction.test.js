import test from "node:test";
import assert from "node:assert/strict";
import { redactSessionDiagnostics, redactValue } from "../src/redaction/redact.js";

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

test("a bare key field stays visible; only secret-qualified keys are redacted", () => {
  const payload = redactValue({
    key: "errors.count",
    metric_key: "transactions.p95",
    cache_key: "visible",
    idempotencyKey: "visible",
    public_key: "visible",
    api_key: "one",
    private_key: "two",
    secret_key: "three",
    "x-api-key": "four",
    access_key: "five",
    AccessKey: "six",
    accesskey: "seven",
    signing_key: "eight",
    encryption_key: "nine"
  });

  for (const field of ["key", "metric_key", "cache_key", "idempotencyKey", "public_key"]) assert.notEqual(payload[field], "[REDACTED]", field);
  for (const field of ["api_key", "private_key", "secret_key", "x-api-key", "access_key", "AccessKey", "accesskey", "signing_key", "encryption_key"]) {
    assert.equal(payload[field], "[REDACTED]", field);
  }
});

test("redaction masks credential-shaped values inside strings", () => {
  const basic = Buffer.from("deploy:hunter22").toString("base64");
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  // Fixtures are assembled at runtime so the publication safety scan never sees a literal key.
  const pemLabel = ["RSA", "PRIVATE", "KEY"].join(" ");
  const pem = `-----BEGIN ${pemLabel}-----\nMIIEowIBAAKCAQEA\n-----END ${pemLabel}-----`;
  const awsKeyId = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
  const payload = redactValue({
    message: `upstream rejected Bearer abcDEF123.xyz and Basic ${basic} after retry`,
    jwt: `session=${jwt}; path=/`,
    keys: ["lgst_0123456789abcdef", `logister_cli_${"a1".repeat(32)}`, awsKeyId],
    detail: `key material: ${pem} end`,
    truncated: `-----BEGIN ${["PRIVATE", "KEY"].join(" ")}-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC`,
    prose: "Bearer authentication failed; see the Basic setup guide."
  });

  assert.equal(payload.message, "upstream rejected Bearer [REDACTED] and Basic [REDACTED] after retry");
  assert.equal(payload.jwt, "session=[REDACTED]; path=/");
  assert.deepEqual(payload.keys, ["[REDACTED]", "[REDACTED]", "[REDACTED]"]);
  assert.equal(payload.detail, "key material: [REDACTED] end");
  assert.equal(payload.truncated, "[REDACTED]");
  assert.equal(payload.prose, "Bearer authentication failed; see the Basic setup guide.");
});

test("redaction masks sensitive header tuples and leaves other pairs alone", () => {
  const payload = redactValue({
    headers: [["Authorization", "opaque"], ["X-Api-Key", 12345], ["Cookie", "sid=1"], ["Accept", "application/json"]],
    pair: ["region", "us-east-1"],
    flags: ["token", true]
  });

  assert.deepEqual(payload.headers, [
    ["Authorization", "[REDACTED]"],
    ["X-Api-Key", "[REDACTED]"],
    ["Cookie", "[REDACTED]"],
    ["Accept", "application/json"]
  ]);
  assert.deepEqual(payload.pair, ["region", "us-east-1"]);
  assert.deepEqual(payload.flags, ["token", true]);
});

test("session diagnostics redaction keeps token metadata but masks secrets inside it", () => {
  const session = redactSessionDiagnostics({
    token: { uuid: "safe", name: "ci Bearer abcDEF123456", scopes: ["projects:read"], access_token: "raw" },
    accessible_project_count: 1,
    refresh_token: "raw"
  });

  assert.equal(session.token.uuid, "safe");
  assert.equal(session.token.name, "ci Bearer [REDACTED]");
  assert.deepEqual(session.token.scopes, ["projects:read"]);
  assert.equal(session.token.access_token, "[REDACTED]");
  assert.equal(session.accessible_project_count, 1);
  assert.equal(session.refresh_token, "[REDACTED]");
  assert.equal(redactSessionDiagnostics({ token: "raw" }).token, "[REDACTED]");
});
