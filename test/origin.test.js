import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLogisterOrigin } from "../src/api/origin.js";
import { ApiClient } from "../src/api/client.js";

test("credential origins require HTTPS except for IPv4, IPv6, and localhost loopback", () => {
  assert.equal(normalizeLogisterOrigin("https://logister.example/path/../"), "https://logister.example");
  assert.equal(normalizeLogisterOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeLogisterOrigin("http://127.42.0.1:3000"), "http://127.42.0.1:3000");
  assert.equal(normalizeLogisterOrigin("http://[::1]:3000"), "http://[::1]:3000");
  assert.throws(() => normalizeLogisterOrigin("http://logister.example"), /Refusing to send Logister credentials/);
  assert.throws(() => normalizeLogisterOrigin("http://10.0.0.2"), /Refusing to send Logister credentials/);
  assert.throws(() => normalizeLogisterOrigin("http://128.0.0.1"), /Refusing to send Logister credentials/);
  assert.equal(
    normalizeLogisterOrigin("http://dev.internal:3000", { allowInsecureHttp: true }),
    "http://dev.internal:3000"
  );
});

test("API client cannot send a bearer token to non-loopback HTTP without explicit opt-in", () => {
  let calls = 0;
  assert.throws(() => new ApiClient({
    host: "http://dev.internal:3000",
    token: "secret",
    userAgent: "test",
    fetchImpl: async () => { calls += 1; }
  }), /--allow-insecure-http/);
  assert.equal(calls, 0);

  assert.doesNotThrow(() => new ApiClient({
    host: "http://dev.internal:3000",
    token: "secret",
    userAgent: "test",
    allowInsecureHttp: true,
    fetchImpl: async () => { calls += 1; }
  }));
});
