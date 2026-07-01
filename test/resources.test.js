import test from "node:test";
import assert from "node:assert/strict";
import { runResourceCommand } from "../src/commands/resources.js";

test("fails resource commands when server feature is not available", async () => {
  const client = {
    async capabilities() {
      return {
        server_version: "2.9",
        recommended_cli_version: "0.1.0",
        features: { events: false }
      };
    },
    async get() {
      throw new Error("get should not be called");
    }
  };

  await assert.rejects(
    () => runResourceCommand("events", ["list"], {
      client,
      parsed: { options: { project: "api", redact: true } },
      runtime: { project: "" },
      write() {}
    }),
    (error) => {
      assert.equal(error.exitCode, 4);
      assert.match(error.message, /does not support CLI feature 'events'/);
      return true;
    }
  );
});

test("calls resource endpoint when server feature is available", async () => {
  const calls = [];
  const client = {
    async capabilities() {
      return { features: { events: true } };
    },
    async get(path, query) {
      calls.push({ path, query });
      return { items: [] };
    }
  };

  let written;
  await runResourceCommand("events", ["list"], {
    client,
    parsed: { options: { project: "api", type: "log", redact: true, format: "json" } },
    runtime: { project: "" },
    write(payload) {
      written = payload;
    }
  });

  assert.deepEqual(calls, [
    {
      path: "/api/v1/cli/projects/api/events",
      query: {
        type: "log",
        event_type: undefined,
        level: undefined,
        status: undefined,
        assigned: undefined,
        assignee: undefined,
        environment: undefined,
        release: undefined,
        since: undefined,
        until: undefined,
        limit: undefined,
        q: undefined,
        trace_id: undefined,
        request_id: undefined,
        min_duration_ms: undefined,
        window: undefined,
        include_occurrences: undefined,
        related_logs: undefined,
        token_budget: undefined
      }
    }
  ]);
  assert.deepEqual(written, { items: [] });
});

test("maps transactions list onto the event read endpoint", async () => {
  const calls = [];
  const client = {
    async capabilities() {
      return { features: { events: true } };
    },
    async get(path, query) {
      calls.push({ path, query });
      return { items: [] };
    }
  };

  await runResourceCommand("transactions", ["list"], {
    client,
    parsed: { options: { project: "api", minDurationMs: "500", redact: true, format: "json" } },
    runtime: { project: "" },
    write() {}
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/v1/cli/projects/api/events");
  assert.equal(calls[0].query.type, "transaction");
  assert.equal(calls[0].query.min_duration_ms, "500");
});
