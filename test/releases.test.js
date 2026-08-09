import test from "node:test";
import assert from "node:assert/strict";
import { latestRelease } from "../src/update/releases.js";

test("release check validates bounded JSON and returns safe release metadata", async () => {
  const release = await latestRelease({
    fetchImpl: async (_url, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      return new Response(JSON.stringify({
        tag_name: "v1.2.3",
        html_url: "https://github.com/taimoorq/logister-cli/releases/tag/v1.2.3",
        published_at: "2026-08-09T00:00:00Z"
      }), { headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(release.version, "1.2.3");
  assert.equal(release.tag, "v1.2.3");
});

test("release check rejects wrong content types and declared or streamed oversized bodies", async () => {
  await assert.rejects(
    () => latestRelease({ fetchImpl: async () => new Response("html", { headers: { "content-type": "text/html" } }) }),
    /unexpected content type/
  );
  await assert.rejects(
    () => latestRelease({
      maxResponseBytes: 10,
      fetchImpl: async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "11" } })
    }),
    /exceeds the 10-byte limit/
  );
  await assert.rejects(
    () => latestRelease({
      maxResponseBytes: 10,
      fetchImpl: async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode("{\"value\":\"too-large\"}")); controller.close(); }
      }), { headers: { "content-type": "application/json" } })
    }),
    /exceeds the 10-byte limit/
  );
});

test("release check timeout and caller abort also interrupt stalled response bodies", async () => {
  const stalledResponse = () => new Response(new ReadableStream({ start() {} }), {
    headers: { "content-type": "application/json" }
  });
  const started = Date.now();
  await assert.rejects(
    () => latestRelease({ timeoutMs: 100, fetchImpl: async () => stalledResponse() }),
    /timed out after 100ms/
  );
  assert.ok(Date.now() - started < 500);

  const controller = new AbortController();
  const pending = latestRelease({ signal: controller.signal, fetchImpl: async () => stalledResponse() });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, (error) => error.interrupted === true && error.exitCode === 130);
});
