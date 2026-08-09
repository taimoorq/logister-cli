import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/api/client.js";
import { capabilitiesFor, checkCompatibility, ensureFeature, validateCapabilities } from "../src/api/capabilities.js";
import { runResourceCommand } from "../src/commands/resources.js";

test("compatibility rejects CLIs below minimum and warns once below recommended", async () => {
  assert.throws(
    () => checkCompatibility({ minimum_cli_version: "1.1.0" }, "1.0.0", null),
    (error) => error.exitCode === 4 && /minimum supported CLI 1.1.0/.test(error.message)
  );

  const stderr = captureStream();
  const context = {
    runtime: { version: "1.0.0" }, stderr,
    client: { async capabilities() { return { minimum_cli_version: "0.1.0", recommended_cli_version: "1.1.0" }; } }
  };
  await capabilitiesFor(context);
  await capabilitiesFor(context);
  assert.equal(stderr.output.match(/recommended/g)?.length, 1);
});

test("feature gating gives old self-hosted servers actionable guidance", async () => {
  await assert.rejects(
    () => ensureFeature({
      runtime: { version: "1.0.0" }, stderr: captureStream(),
      client: { async capabilities() { const error = new Error("missing"); error.status = 404; throw error; } }
    }, "traces"),
    (error) => error.exitCode === 4 && /does not expose CLI capability negotiation/.test(error.message)
  );

  await assert.rejects(
    () => ensureFeature({
      runtime: { version: "1.0.0" }, stderr: captureStream(),
      client: { async capabilities() { return { server_version: "3.4", features: { traces: false } }; } }
    }, "traces"),
    (error) => error.exitCode === 4 && /does not support CLI feature 'traces'/.test(error.message)
  );
});

test("a resource 404 remains a resource error when capabilities advertise the endpoint", async () => {
  const missing = new ApiError("Not found", {
    status: 404,
    method: "GET",
    path: "/api/v1/cli/projects/api/traces/missing",
    body: { code: "not_found", message: "Not found" }
  });
  await assert.rejects(
    () => runResourceCommand("traces", ["show", "missing"], {
      parsed: { options: { project: "api" } }, runtime: { version: "1.0.0" }, stderr: captureStream(),
      client: {
        async capabilities() { return { features: { traces: true } }; },
        async get() { throw missing; }
      },
      write() {}
    }),
    (error) => error === missing && error.status === 404 && error.message === "Not found"
  );
});

test("capability envelopes reject hostile display fields and malformed feature/version metadata", () => {
  for (const payload of [
    { server_version: "3.5\nInjected: yes", features: {} },
    { api_contract_version: "3.5\u001b[31m", features: {} },
    { minimum_cli_version: "1.0", features: {} },
    { recommended_cli_version: "v1.0.0", features: {} },
    { server_version: "3.5", features: { traces: "yes" } },
    { server_version: "3.5", features: { "bad\nkey": true } }
  ]) {
    assert.throws(() => validateCapabilities(payload), /Invalid Logister capability response/);
  }
  assert.deepEqual(validateCapabilities({
    server_version: "3.5", api_contract_version: "3.5",
    minimum_cli_version: "0.1.0", recommended_cli_version: "1.0.0",
    features: { traces: true }
  }).features, { traces: true });
});

test("capability negotiation passes the shared abort signal", async () => {
  const controller = new AbortController();
  let observed;
  await capabilitiesFor({
    signal: controller.signal,
    runtime: { version: "1.0.0" },
    stderr: captureStream(),
    client: {
      async capabilities(options) { observed = options.signal; return { features: {} }; }
    }
  });
  assert.equal(observed, controller.signal);
});

function captureStream() {
  return { output: "", write(chunk) { this.output += chunk; } };
}
