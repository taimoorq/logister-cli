import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/main.js";

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

test("rejects missing option values", () => {
  assert.throws(
    () => parseArgs(["events", "list", "--project", "--since", "24h"]),
    /Missing value for --project/
  );
});
