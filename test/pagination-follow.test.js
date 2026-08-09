import test from "node:test";
import assert from "node:assert/strict";
import { runPaginatedRequest } from "../src/commands/pagination.js";
import { followEvents } from "../src/commands/follow.js";
import { writeResult } from "../src/output/result.js";

test("--all follows opaque cursors and returns one stable JSON envelope", async () => {
  const calls = [];
  const pages = [
    { items: [{ uuid: "one" }], next_cursor: "cursor-2", generated_at: "first" },
    { items: [{ uuid: "two" }], next_cursor: null, generated_at: "second" }
  ];
  let written;
  const context = {
    parsed: { options: { all: true, format: "json" } },
    runtime: { format: "table" },
    client: {
      async get(path, query) {
        calls.push({ path, query });
        return pages.shift();
      }
    },
    write(payload) { written = payload; }
  };

  await runPaginatedRequest({ path: "/items", query: { limit: "1" }, context });
  assert.deepEqual(calls.map((call) => call.query.cursor), [undefined, "cursor-2"]);
  assert.deepEqual(written.items.map((item) => item.uuid), ["one", "two"]);
  assert.equal(written.next_cursor, null);
  assert.equal(written.generated_at, "second");
});

test("--format ndjson --all writes each page without accumulating it", async () => {
  const writes = [];
  const pages = [
    { items: [{ uuid: "one" }], next_cursor: "next" },
    { items: [{ uuid: "two" }], next_cursor: null }
  ];
  const context = {
    parsed: { options: { all: true, format: "ndjson" } },
    runtime: { format: "table" },
    client: { async get() { return pages.shift(); } },
    write(payload, options) { writes.push({ payload, options }); }
  };

  const result = await runPaginatedRequest({ path: "/items", query: {}, context });
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map((entry) => entry.payload.items[0].uuid), ["one", "two"]);
  assert.deepEqual(result.items, []);
});

test("pagination rejects malformed envelopes and repeated cursors", async () => {
  await assert.rejects(
    () => runPaginatedRequest({
      path: "/items",
      query: {},
      context: {
        parsed: { options: {} }, runtime: {},
        client: { async get() { return { records: [] }; } }, write() {}
      }
    }),
    /expected an items array/
  );

  let call = 0;
  await assert.rejects(
    () => runPaginatedRequest({
      path: "/items",
      query: {},
      context: {
        parsed: { options: { all: true } }, runtime: {},
        client: { async get() { call += 1; return { items: [], next_cursor: "same" }; } }, write() {}
      }
    }),
    /repeated a pagination cursor/
  );
  assert.equal(call, 2);
});

test("non-NDJSON --all output has a bounded in-memory record cap", async () => {
  await assert.rejects(
    () => runPaginatedRequest({
      path: "/items",
      query: {},
      context: {
        parsed: { options: { all: true, format: "json" } }, runtime: {}, maxAccumulatedRecords: 1,
        client: { async get() { return { items: [{ uuid: "one" }, { uuid: "two" }], next_cursor: null }; } },
        write() {}
      }
    }),
    /use --format ndjson --all/
  );
});

test("non-NDJSON --all rejects oversized rows before retaining the page", async () => {
  let writes = 0;
  await assert.rejects(
    () => runPaginatedRequest({
      path: "/events",
      query: {},
      context: {
        parsed: { options: { all: true, format: "json" } },
        runtime: { format: "json" },
        maxAccumulatedBytes: 64,
        client: {
          async get() {
            return { items: [{ uuid: "one", message: "x".repeat(100) }], next_cursor: null, generated_at: "now" };
          }
        },
        async write() { writes += 1; }
      }
    }),
    /serialized bytes.*--format ndjson --all/s
  );
  assert.equal(writes, 0);
});

test("follow seeds from poll_cursor, polls after_cursor, and deduplicates UUIDs", async () => {
  const calls = [];
  const writes = [];
  const pages = [
    { items: [{ uuid: "one" }, { uuid: "two" }], next_cursor: "older", poll_cursor: "high-1" },
    { items: [{ uuid: "two" }, { uuid: "three" }], next_cursor: "high-2", poll_cursor: "high-2" }
  ];
  const context = {
    parsed: { options: { follow: true, pollIntervalMs: 1 } },
    runtime: {},
    followMaxPolls: 1,
    client: {
      async get(path, query) {
        calls.push({ path, query });
        return pages.shift();
      }
    },
    write(payload, options) { writes.push({ payload, options }); }
  };

  await followEvents({ path: "/events", query: { type: "log", cursor: undefined }, context });
  assert.equal(calls[1].query.after_cursor, "high-1");
  assert.equal(calls[1].query.type, "log");
  assert.equal(Object.hasOwn(calls[1].query, "cursor"), false);
  assert.deepEqual(writes.map((entry) => entry.payload.items.map((item) => item.uuid)), [["one", "two"], ["three"]]);
  assert.ok(writes.every((entry) => entry.options.format === "ndjson"));
});

test("follow refuses servers without a high-water polling cursor", async () => {
  let writes = 0;
  await assert.rejects(
    () => followEvents({
      path: "/events",
      query: {},
      context: {
        parsed: { options: { follow: true } }, runtime: {},
        client: { async get() { return { items: [], next_cursor: null }; } },
        write() { writes += 1; }, followMaxPolls: 0
      }
    }),
    (error) => error.exitCode === 4 && /high-water cursor/.test(error.message)
  );
  assert.equal(writes, 0);
});

test("follow stops cleanly when its signal is aborted", async () => {
  const controller = new AbortController();
  const context = {
    parsed: { options: { follow: true, pollIntervalMs: 60_000 } }, runtime: {}, signal: controller.signal,
    client: { async get() { return { items: [], poll_cursor: "high" }; } }, write() {}
  };
  const running = followEvents({ path: "/events", query: {}, context });
  controller.abort();
  await running;
});

test("default follow output remains parseable NDJSON across multiple polls", async () => {
  const pages = [
    { items: [{ uuid: "one" }], poll_cursor: "high-1" },
    { items: [{ uuid: "two" }], poll_cursor: "high-2" },
    { items: [{ uuid: "three" }], poll_cursor: "high-3" }
  ];
  const stdout = { output: "", write(chunk) { this.output += chunk; return true; } };
  const context = {
    parsed: { options: { follow: true, pollIntervalMs: 1 } },
    runtime: { format: "json" },
    followMaxPolls: 2,
    client: { async get() { return pages.shift(); } },
    write(payload, options) { return writeResult(payload, { stdout, ...options, redact: false }); }
  };

  await followEvents({ path: "/events", query: {}, context });
  const records = stdout.output.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(records.map((record) => record.uuid), ["one", "two", "three"]);
});
