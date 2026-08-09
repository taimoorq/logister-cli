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
        summary: true
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

test("maps --event-type alias onto the documented type query without dropping it", async () => {
  const calls = [];
  await runResourceCommand("events", ["list"], {
    client: {
      async capabilities() { return { features: { events: true } }; },
      async get(path, query) { calls.push({ path, query }); return { items: [] }; }
    },
    parsed: { options: { project: "api", eventType: "check_in" } },
    runtime: { project: "", version: "1.0.0" },
    write() {}
  });
  assert.equal(calls[0].query.type, "check_in");
  assert.equal(Object.hasOwn(calls[0].query, "event_type"), false);
});

test("maps production parity resources and repeatable query filters", async () => {
  const uuid = "11111111-1111-4111-8111-111111111111";
  const cases = [
    ["traces", ["list"], { service: "checkout", operation: "GET /pay", status: "error" }, "/traces", { service: "checkout", operation: "GET /pay", status: "error" }],
    ["traces", ["show", "trace:one"], { since: "24h" }, "/traces/trace%3Aone", { since: "24h" }],
    ["monitors", ["list"], { status: "missed", environment: "prod" }, "/monitors", { environment: "prod", status: "missed" }],
    ["monitors", ["show", uuid], {}, `/monitors/${uuid}`, {}],
    ["deployments", ["list"], { repository: "org/repo", source: "api" }, "/deployments", { repository: "org/repo", source: "api" }],
    ["deployments", ["show", uuid], {}, `/deployments/${uuid}`, {}],
    ["insights", ["summary"], { window: "24h", metrics: ["a", "b"], attributes: ["region=us", "tier=paid"] }, "/insights", { window: "24h", metric: ["a", "b"], attribute: ["region=us", "tier=paid"] }],
    ["metrics", ["catalog"], { window: "7d" }, "/metrics/catalog", { window: "7d" }],
    ["metrics", ["query", "transactions.p95"], { window: "1h", attributes: ["region=us"] }, "/metrics/query", { metric: "transactions.p95", window: "1h", attribute: ["region=us"] }]
  ];

  for (const [resource, args, resourceOptions, suffix, expectedQuery] of cases) {
    const calls = [];
    const client = {
      async capabilities() { return { features: { [resource === "insights" ? "insights" : resource]: true } }; },
      async get(path, query) {
        calls.push({ path, query });
        return args[0] === "list" || args[0] === "catalog" ? { items: [] } : {};
      }
    };
    await runResourceCommand(resource, args, {
      client,
      parsed: { options: { project: "api", ...resourceOptions } },
      runtime: { project: "", version: "1.0.0", format: "json" },
      write() {}
    });
    assert.equal(calls[0].path, `/api/v1/cli/projects/api${suffix}`);
    assert.deepEqual(calls[0].query, expectedQuery);
  }
});

test("maps every established read command to its strict API route", async () => {
  const uuid = "22222222-2222-4222-8222-222222222222";
  const cases = [
    ["projects", ["list"], { includeArchived: true, limit: "25", cursor: "next" }, "projects", "/api/v1/cli/projects", { include_archived: true, limit: "25", cursor: "next" }, true],
    ["projects", ["show", "checkout"], {}, "projects", "/api/v1/cli/projects/checkout", {}, false],
    ["overview", [], { project: "api", since: "24h", until: "2026-08-09T12:00:00Z" }, "project_summary", "/api/v1/cli/projects/api/summary", { since: "24h", until: "2026-08-09T12:00:00Z" }, false],
    ["events", ["show", uuid], { project: "api" }, "events", `/api/v1/cli/projects/api/events/${uuid}`, {}, false],
    ["events", ["tail"], { project: "api", level: "error" }, "events", "/api/v1/cli/projects/api/events", { level: "error", summary: true }, true],
    ["logs", ["list"], { project: "api", level: "warn" }, "logs", "/api/v1/cli/projects/api/events", { level: "warn", summary: true, type: "log" }, true],
    ["logs", ["tail"], { project: "api", traceId: "trace" }, "logs", "/api/v1/cli/projects/api/events", { trace_id: "trace", summary: true, type: "log" }, true],
    ["issues", ["list"], { project: "api", introducedToday: true, assignee: "me", sort: "last_seen", query: "boom", limit: "20", cursor: "next" }, "error_groups", "/api/v1/cli/projects/api/error_groups", { assignee: "me", sort: "last_seen", q: "boom", introduced_today: true, limit: "20", cursor: "next" }, true],
    ["issues", ["show", uuid], { project: "api", relatedLogs: true }, "error_groups", `/api/v1/cli/projects/api/error_groups/${uuid}`, { related_logs: true }, false],
    ["issues", ["export", uuid], { project: "api", includeOccurrences: true }, "error_groups", `/api/v1/cli/projects/api/error_groups/${uuid}/export`, { include_occurrences: true }, false],
    ["issues", ["context", uuid], { project: "api", tokenBudget: "12000" }, "ai_context_bundles", `/api/v1/cli/projects/api/error_groups/${uuid}/context`, { token_budget: "12000" }, false]
  ];

  for (const [resource, args, options, feature, expectedPath, expectedQuery, list] of cases) {
    const calls = [];
    await runResourceCommand(resource, args, {
      parsed: { options }, runtime: { project: "", version: "1.0.0" },
      client: {
        async capabilities() { return { features: { [feature]: true } }; },
        async get(path, query) { calls.push({ path, query }); return list ? { items: [] } : {}; }
      },
      write() {}
    });
    assert.deepEqual(calls, [{ path: expectedPath, query: expectedQuery }], `${resource} ${args.join(" ")}`);
  }
});
