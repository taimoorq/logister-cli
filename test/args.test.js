import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/main.js";
import { validateInvocation } from "../src/commands/specs.js";

test("parses global options and command args", () => {
  const parsed = parseArgs(["events", "list", "--project", "api", "--since=24h", "--format", "json", "--no-redact", "--no-browser"]);

  assert.equal(parsed.command, "events");
  assert.deepEqual(parsed.args, ["list"]);
  assert.equal(parsed.options.project, "api");
  assert.equal(parsed.options.since, "24h");
  assert.equal(parsed.options.format, "json");
  assert.equal(parsed.options.redact, false);
  assert.equal(parsed.options.noBrowser, true);
});

test("parses explicit insecure HTTP acknowledgement only where global options are valid", () => {
  const parsed = parseArgs(["doctor", "--host", "http://dev.internal:3000", "--allow-insecure-http"]);
  validateInvocation(parsed);
  assert.equal(parsed.options.allowInsecureHttp, true);
  assert.throws(
    () => validateInvocation(parseArgs(["version", "--allow-insecure-http"])),
    /not valid for version/
  );
});

test("rejects missing option values", () => {
  assert.throws(
    () => parseArgs(["events", "list", "--project", "--since", "24h"]),
    /Missing value for --project/
  );
});

test("collects repeatable filters without overwriting values", () => {
  const parsed = parseArgs([
    "insights", "summary", "--project", "api",
    "--metric", "transactions.p95", "--metric", "errors.count",
    "--attribute", "region=us-east", "--attribute", "tier=paid"
  ]);

  validateInvocation(parsed);
  assert.deepEqual(parsed.options.metrics, ["transactions.p95", "errors.count"]);
  assert.deepEqual(parsed.options.attributes, ["region=us-east", "tier=paid"]);
});

test("rejects unknown, repeated, and irrelevant options", () => {
  assert.throws(() => parseArgs(["events", "list", "--mystery", "value"]), /Unknown option: --mystery/);
  assert.throws(() => parseArgs(["events", "list", "--limit", "10", "--limit", "20"]), /may only be specified once/);
  assert.throws(
    () => validateInvocation(parseArgs(["projects", "show", "api", "--since", "24h"])),
    /--since is not valid for projects show/
  );
  assert.throws(
    () => validateInvocation(parseArgs(["overview", "--project", "api", "--window", "24h"])),
    /--window is not valid for overview/
  );
});

test("project identifiers reject dot segments and characters outside the slug alphabet", () => {
  for (const project of [".", "..", "-api", "_api", ".hidden", "a/b", "a b", "a%2e", "x".repeat(256)]) {
    assert.throws(() => validateInvocation(parseArgs(["events", "list", "--project", project])), /Project identifiers must start|between 1 and 255/, project);
  }
  for (const project of ["api", "my-app", "My.App_2", "0f8fad5b-d9cb-469f-a165-70867728950e", "x".repeat(255)]) {
    assert.doesNotThrow(() => validateInvocation(parseArgs(["events", "list", "--project", project])), project);
  }
  assert.throws(() => validateInvocation(parseArgs(["projects", "show", ".."])), /must not be '\.' or '\.\.'/);
  assert.throws(() => validateInvocation(parseArgs(["projects", "show", "a/b"])), /Project identifiers must start/);
  assert.throws(() => validateInvocation(parseArgs(["deployments", "show", "."])), /must not be '\.' or '\.\.'/);
});

test("rejects unknown subcommands, extra identifiers, and invalid values", () => {
  assert.throws(() => validateInvocation(parseArgs(["traces", "destroy", "abc"])), /Unknown traces subcommand/);
  assert.throws(() => validateInvocation(parseArgs(["traces", "show", "one", "two"])), /Unexpected argument/);
  assert.throws(() => validateInvocation(parseArgs(["events", "list", "--type", "made-up"])), /Invalid --type/);
  assert.throws(() => validateInvocation(parseArgs(["traces", "list", "--status", "failed"])), /Invalid --status/);
  assert.throws(() => validateInvocation(parseArgs(["monitors", "list", "--status", "unknown"])), /Invalid --status/);
  assert.throws(() => validateInvocation(parseArgs(["events", "list", "--limit", "101"])), /between 1 and 100/);
  assert.throws(() => validateInvocation(parseArgs(["metrics", "query", "m", "--window", "30d"])), /Invalid --window/);
  assert.throws(() => validateInvocation(parseArgs(["metrics", "query", "m", "--attribute", "invalid"])), /Expected key=value/);
  assert.throws(() => validateInvocation(parseArgs(["events", "list", "--type", "log", "--event-type", "error"])), /either --type or --event-type/);
  assert.throws(() => validateInvocation(parseArgs(["auth", "login", "--token", "one", "--token-stdin"])), /either --token or --token-stdin/);
  assert.throws(() => validateInvocation(parseArgs(["update", "--check", "--apply"])), /either --check or --apply/);
  assert.doesNotThrow(() => validateInvocation(parseArgs(["metrics", "query", "metric:cpu usage"])));
  assert.throws(() => validateInvocation(parseArgs(["metrics", "query", "bad\nmetric"])), /Invalid metric name|Identifiers/);
  assert.throws(() => validateInvocation(parseArgs(["events", "list", "--since", "91d"])), /Invalid --since/);
  assert.throws(() => validateInvocation(parseArgs(["traces", "show", "trace/invalid"])), /Trace IDs must use/);
  assert.throws(() => validateInvocation(parseArgs(["monitors", "show", "not-a-uuid"])), /requires a UUID/);
  assert.throws(() => validateInvocation(parseArgs(["events", "show", "not-a-uuid"])), /requires a UUID/);
  assert.throws(() => validateInvocation(parseArgs(["issues", "context", "not-a-uuid"])), /requires a UUID/);
  assert.throws(() => validateInvocation(parseArgs(["issues", "list", "--status", "unresolved", "--introduced-today"])), /either --status or --introduced-today/);
  assert.throws(() => validateInvocation(parseArgs(["issues", "list", "--assigned", "me", "--assignee", "abc"])), /either --assigned or --assignee/);
});

test("rejects incompatible follow and pagination options", () => {
  assert.throws(
    () => validateInvocation(parseArgs(["logs", "tail", "--follow", "--all"])),
    /--follow cannot be combined with --all/
  );
  assert.throws(
    () => validateInvocation(parseArgs(["events", "tail", "--follow", "--cursor", "opaque"])),
    /high-water cursor/
  );
  for (const format of ["json", "table", "markdown"]) {
    assert.throws(
      () => validateInvocation(parseArgs(["events", "tail", "--follow", "--format", format])),
      /only --format ndjson/
    );
  }
});
