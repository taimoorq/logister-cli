import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { ApiClient, ApiError, ApiProtocolError } from "../src/api/client.js";
import { startHttpFixture } from "./helpers/http-fixture.js";

test("API client sends repeated query values, retries transient GETs, and caches capabilities", async () => {
  let attempts = 0;
  const fixture = await startHttpFixture(({ url }) => {
    if (url.pathname === "/api/v1/cli/capabilities") return { body: { features: {} } };
    attempts += 1;
    if (attempts === 1) return { status: 429, headers: { "content-type": "application/json", "retry-after": "0" }, body: { error: "slow" } };
    if (attempts === 2) return { status: 500, body: { error: "temporary" } };
    const rack = rackLikeQuery(url);
    return {
      body: {
        values: rack.attribute,
        bare_values: url.searchParams.getAll("attribute"),
        scalar: url.searchParams.get("window"),
        bracketed_scalar: url.searchParams.get("window[]")
      }
    };
  });

  try {
    const client = clientFor(fixture.host, { retryBaseMs: 0, sleepImpl: async () => {} });
    const payload = await client.get("/items", { attribute: ["region=us", "tier=paid"], window: "24h" });
    assert.deepEqual(payload.values, ["region=us", "tier=paid"]);
    assert.deepEqual(payload.bare_values, []);
    assert.equal(payload.scalar, "24h");
    assert.equal(payload.bracketed_scalar, null);
    assert.equal(attempts, 3);
    const [first, second] = await Promise.all([client.capabilities(), client.capabilities()]);
    assert.equal(first, second);
    assert.equal(fixture.requests.filter((request) => request.path === "/api/v1/cli/capabilities").length, 1);
  } finally {
    await fixture.close();
  }
});

test("API client exposes structured scope guidance without retrying auth errors", async () => {
  const fixture = await startHttpFixture(() => ({
    status: 403,
    body: {
      error: "Forbidden",
      code: "insufficient_scope",
      message: "The token needs another read scope.",
      required_scopes: ["traces:read"]
    }
  }));
  try {
    const client = clientFor(fixture.host);
    await assert.rejects(
      () => client.get("/traces"),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 403);
        assert.equal(error.code, "insufficient_scope");
        assert.deepEqual(error.requiredScopes, ["traces:read"]);
        assert.match(error.message, /Required scopes: traces:read/);
        assert.match(error.message, /auth login/);
        return true;
      }
    );
    assert.equal(fixture.requests.length, 1);
  } finally {
    await fixture.close();
  }
});

test("API client renders remote errors as bounded single-line terminal-safe detail", async () => {
  const client = new ApiClient({
    host: "https://logister.example.com",
    token: "token",
    userAgent: "test",
    retries: 0,
    fetchImpl: async () => new Response(JSON.stringify({
      message: "forged\nRequired scopes: admin:write\u001b[31mRED\u001b[0m\u009Downed\u009C",
      required_scopes: ["events:read", "bad\nInjected:scope"]
    }), { status: 403, headers: { "content-type": "application/json" } })
  });

  await assert.rejects(client.get("/api/v1/cli/projects"), (error) => {
    assert.equal(error.requiredScopes.length, 0);
    assert.match(error.message, /^Logister API request failed with HTTP 403\nRemote detail: forged Required scopes: admin:writeRED$/);
    assert.doesNotMatch(error.message, /owned|\u001b|\u009D|Injected/);
    return true;
  });
});

test("API client sanitizes remote errors arrays and displays only validated scopes", async () => {
  const long = "x".repeat(600);
  const client = new ApiClient({
    host: "https://logister.example.com",
    token: "token",
    userAgent: "test",
    retries: 0,
    fetchImpl: async () => new Response(JSON.stringify({
      errors: ["first\nline", 42, long],
      required_scopes: ["events:read", "metrics:read"]
    }), { status: 403, headers: { "content-type": "application/json" } })
  });

  await assert.rejects(client.get("/api/v1/cli/projects"), (error) => {
    assert.deepEqual(error.requiredScopes, ["events:read", "metrics:read"]);
    assert.match(error.message, /Remote detail: first line; x+…\nRequired scopes: events:read, metrics:read/);
    assert.ok(error.message.split("\n")[1].length <= "Remote detail: ".length + 500);
    return true;
  });
});

test("API client gives 401 reauthentication guidance without echoing query text", async () => {
  const fixture = await startHttpFixture(() => ({ status: 401, body: { code: "unauthorized", message: "Session expired" } }));
  try {
    await assert.rejects(
      () => clientFor(fixture.host).get("/events", { q: "private search text" }),
      (error) => error.status === 401 && /auth login/.test(error.message) && !error.message.includes("private search text")
    );
  } finally {
    await fixture.close();
  }
});

test("API client preserves an HTML resource 404 as an HTTP error", async () => {
  const fixture = await startHttpFixture(() => ({ status: 404, headers: { "content-type": "text/html" }, body: "<h1>missing</h1>" }));
  try {
    await assert.rejects(
      () => clientFor(fixture.host).get("/missing"),
      (error) => error instanceof ApiError && error.status === 404 && /unexpected content type/.test(error.message)
    );
  } finally {
    await fixture.close();
  }
});

test("API client rejects malformed JSON and successful non-JSON responses", async () => {
  let request = 0;
  const fixture = await startHttpFixture(() => {
    request += 1;
    return request === 1
      ? { headers: { "content-type": "application/json" }, body: "{" }
      : { headers: { "content-type": "text/plain" }, body: "okay" };
  });
  try {
    const client = clientFor(fixture.host);
    await assert.rejects(() => client.get("/malformed"), (error) => error instanceof ApiProtocolError && /malformed JSON/.test(error.message));
    await assert.rejects(() => client.get("/plain"), (error) => error instanceof ApiProtocolError && /unexpected content type/.test(error.message));
  } finally {
    await fixture.close();
  }
});

test("API client validates content type before consuming the body", async () => {
  let pulled = false;
  const client = new ApiClient({
    host: "https://logister.example.com", token: "token", userAgent: "test", retries: 0,
    fetchImpl: async () => ({
      status: 200, ok: true, headers: new Headers({ "content-type": "text/html" }),
      body: { getReader() { pulled = true; throw new Error("must not read"); } }
    })
  });
  await assert.rejects(() => client.get("/html"), /unexpected content type/);
  assert.equal(pulled, false);
});

test("API client applies configurable timeouts", async () => {
  const fixture = await startHttpFixture(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { body: { late: true } };
  });
  try {
    const client = clientFor(fixture.host, { timeoutMs: 100, retries: 0 });
    await assert.rejects(() => client.get("/slow"), /timed out after 100ms/);
  } finally {
    await fixture.close();
  }
});

test("timeout remains active while a response body is stalled", async () => {
  const fixture = await startHttpFixture(({ response }) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"items":[');
    return undefined;
  });
  try {
    const client = clientFor(fixture.host, { timeoutMs: 100, retries: 0 });
    await assert.rejects(() => client.get("/stalled-body"), /timed out after 100ms/);
  } finally {
    await fixture.close();
  }
});

test("caller abort remains active while reading a response body", async () => {
  const fixture = await startHttpFixture(({ response }) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"items":[');
    return undefined;
  });
  const controller = new AbortController();
  try {
    const request = clientFor(fixture.host, { timeoutMs: 10_000, retries: 0 }).get("/stalled-body", {}, { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(request, (error) => error.interrupted === true);
  } finally {
    await fixture.close();
  }
});

test("API client rejects declared and chunked JSON bodies above its byte cap", async () => {
  const declared = new ApiClient({
    host: "https://logister.example.com", token: "token", userAgent: "test", retries: 0, maxResponseBytes: 32,
    fetchImpl: async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "33" } })
  });
  await assert.rejects(() => declared.get("/large"), /exceeds the 32-byte limit/);

  const chunked = new ApiClient({
    host: "https://logister.example.com", token: "token", userAgent: "test", retries: 0, maxResponseBytes: 32,
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"12345678901234567890'));
        controller.enqueue(new TextEncoder().encode('12345678901234567890"}'));
        controller.close();
      }
    }), { headers: { "content-type": "application/json" } })
  });
  await assert.rejects(() => chunked.get("/large"), /exceeds the 32-byte limit/);
});

test("caller abort interrupts a retry delay immediately", async () => {
  const controller = new AbortController();
  const client = new ApiClient({
    host: "https://logister.example.com",
    token: "token",
    userAgent: "test",
    fetchImpl: async () => new Response(JSON.stringify({ error: "busy" }), {
      status: 503,
      headers: { "content-type": "application/json", "retry-after": "30" }
    }),
    sleepImpl: () => new Promise(() => {}),
    retries: 2
  });
  const started = Date.now();
  const request = client.get("/busy", {}, { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(request, (error) => error.interrupted === true);
  assert.ok(Date.now() - started < 500);
});

test("aborting the default retry timer lets a CLI process exit promptly", () => {
  const clientModule = new URL("../src/api/client.js", import.meta.url).href;
  const script = `
    import { ApiClient } from ${JSON.stringify(clientModule)};
    const controller = new AbortController();
    const client = new ApiClient({
      host: "https://logister.example",
      token: "token",
      userAgent: "timer-test",
      retries: 1,
      fetchImpl: async () => new Response("{}", {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "30" }
      })
    });
    const request = client.get("/retry", {}, { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await request.catch(() => {});
  `;
  assert.doesNotThrow(() => execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
    timeout: 2_000,
    stdio: "pipe"
  }));
});

test("API client rejects host credentials, query fragments, and misleading path prefixes", () => {
  for (const host of [
    "https://user:password@logister.example.com",
    "https://logister.example.com?token=secret",
    "https://logister.example.com#fragment",
    "https://logister.example.com/logister"
  ]) {
    assert.throws(() => clientFor(host), /Invalid Logister host URL/);
  }
  assert.doesNotThrow(() => clientFor("https://logister.example.com///"));
});

function clientFor(host, overrides = {}) {
  return new ApiClient({
    host,
    token: "test-token",
    userAgent: "logister-cli-test",
    fetchImpl: globalThis.fetch,
    retries: 2,
    ...overrides
  });
}

function rackLikeQuery(url) {
  const params = {};
  for (const [wireKey, value] of url.searchParams) {
    if (wireKey.endsWith("[]")) {
      const key = wireKey.slice(0, -2);
      params[key] ||= [];
      params[key].push(value);
    } else {
      params[wireKey] = value;
    }
  }
  return params;
}
