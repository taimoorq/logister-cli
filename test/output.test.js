import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeResult } from "../src/output/result.js";
import { columnsFor } from "../src/output/presenters.js";

test("human table output uses resource columns and strips terminal controls", () => {
  const stdout = captureStream();
  writeResult({
    items: [{ uuid: "one", message: "first\nsecond\u001b[31mRED\u001b[0m\u0007", ignored: "hidden" }]
  }, { stdout, format: "table", redact: false, columns: ["uuid", "message"] });

  assert.match(stdout.output, /uuid\s+message/);
  assert.match(stdout.output, /first secondRED/);
  assert.doesNotMatch(stdout.output, /\u001b|\u0007|ignored|hidden/);
});

test("Markdown output escapes pipes, backslashes, and multiline injection", () => {
  const stdout = captureStream();
  writeResult({ items: [{ name: "a|b\\c\nnext" }] }, {
    stdout,
    format: "markdown",
    redact: false,
    columns: ["name"]
  });
  assert.match(stdout.output, /a\\\|b\\\\c next/);
  assert.equal(stdout.output.trim().split("\n").length, 3);
});

test("Markdown cells render hostile HTML, links, code, and emphasis as literal text", async () => {
  const stdout = captureStream();
  await writeResult({
    items: [{ message: "<img src=x onerror=alert(1)> ![alt](https://evil) [link](https://evil) `code` *bold* _italics_" }]
  }, { stdout, format: "markdown", redact: false, columns: ["message"] });

  assert.ok(stdout.output.includes("&lt;img src=x onerror=alert\\(1\\)&gt;"));
  assert.ok(stdout.output.includes("\\!\\[alt\\]\\(https\\:\\/\\/evil\\)"));
  assert.ok(stdout.output.includes("\\[link\\]\\(https\\:\\/\\/evil\\)"));
  assert.ok(stdout.output.includes("\\`code\\` \\*bold\\* \\_italics\\_"));
  assert.doesNotMatch(stdout.output, /<img|!\[alt\]\(|\[link\]\(|`code`|\*bold\*/);
});

test("human output sanitizes server-controlled keys and literalizes fallback Markdown headers", async () => {
  const maliciousKey = "bad\n|<b>*key*\u009B31m";
  const table = captureStream();
  await writeResult({ [maliciousKey]: "value" }, { stdout: table, format: "table", redact: false });
  assert.equal(table.output.trim().split("\n").length, 1);
  assert.doesNotMatch(table.output, /[\u0080-\u009F]/u);

  const markdown = captureStream();
  await writeResult({ items: [{ [maliciousKey]: "one" }, { [maliciousKey]: "two" }] }, {
    stdout: markdown, format: "markdown", redact: false
  });
  assert.equal(markdown.output.trim().split("\n").length, 4);
  assert.ok(markdown.output.includes("bad \\|&lt;b&gt;\\*key\\*"));
  assert.doesNotMatch(markdown.output, /31m/);
  assert.doesNotMatch(markdown.output, /<b>|\| bad \|/);
});

test("JSON preserves structure while applying semantic local redaction", () => {
  const stdout = captureStream();
  writeResult({ uuid: "event", user_identifier: "customer-42", nested: { message: "line\nline" } }, {
    stdout,
    format: "json"
  });
  const payload = JSON.parse(stdout.output);
  assert.equal(payload.uuid, "event");
  assert.equal(payload.user_identifier, "[REDACTED]");
  assert.equal(payload.nested.message, "line\nline");
});

test("output becomes a no-op for closed streams and swallows synchronous EPIPE", () => {
  let writes = 0;
  writeResult({ ok: true }, {
    stdout: { destroyed: true, write() { writes += 1; } },
    format: "json"
  });
  assert.equal(writes, 0);

  let brokenPipe = false;
  assert.doesNotThrow(() => writeResult({ ok: true }, {
    stdout: { write() { const error = new Error("closed"); error.code = "EPIPE"; throw error; } },
    format: "json",
    onBrokenPipe() { brokenPipe = true; }
  }));
  assert.equal(brokenPipe, true);
});

test("metrics presenter matches the production catalog field names", () => {
  assert.deepEqual(columnsFor("metrics"), ["key", "label", "unit", "kind", "source", "category", "events"]);
  const stdout = captureStream();
  writeResult({ items: [{ key: "errors.count", label: "Errors", unit: "count", kind: "count", source: "Inbox", category: "health", events: 3 }] }, {
    stdout, format: "table", redact: false, columns: columnsFor("metrics")
  });
  assert.match(stdout.output, /key\s+label\s+unit\s+kind\s+source\s+category\s+events/);
});

test("NDJSON output waits for writable backpressure and aborts pending drain waits", async () => {
  class SlowStream extends EventEmitter {
    constructor() { super(); this.chunks = []; this.calls = 0; }
    write(chunk) {
      this.chunks.push(chunk);
      this.calls += 1;
      return this.calls !== 1;
    }
  }

  const stdout = new SlowStream();
  const writing = writeResult({ items: [{ uuid: "one" }, { uuid: "two" }] }, { stdout, format: "ndjson", redact: false });
  assert.equal(stdout.chunks.length, 1);
  stdout.emit("drain");
  await writing;
  assert.equal(stdout.chunks.length, 2);

  const blocked = new SlowStream();
  const controller = new AbortController();
  const aborting = writeResult({ items: [{ uuid: "one" }, { uuid: "two" }] }, {
    stdout: blocked, format: "ndjson", redact: false, signal: controller.signal
  });
  controller.abort();
  await aborting;
  assert.equal(blocked.chunks.length, 1);
});

test("all output formats neutralize C1 terminal sequences and bidi controls without changing machine data", async () => {
  const hostile = "pre\u009B31mRED\u009B0m post\u009Downed\u009C end\u202Ertl\u2066isolate\u2069";

  for (const format of ["table", "markdown"]) {
    const stdout = captureStream();
    await writeResult({ items: [{ message: hostile }] }, { stdout, format, redact: false, columns: ["message"] });
    assert.doesNotMatch(stdout.output, /[\u0080-\u009F\u202A-\u202E\u2066-\u2069]/u);
    assert.doesNotMatch(stdout.output, /31m|0m|owned/);
    assert.match(stdout.output, /preRED post endrtlisolate/);
  }

  for (const format of ["json", "ndjson"]) {
    const stdout = captureStream();
    const payload = format === "json" ? { message: hostile } : { items: [{ message: hostile }] };
    await writeResult(payload, { stdout, format, redact: false });
    assert.doesNotMatch(stdout.output, /[\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u);
    assert.match(stdout.output, /\\u009b/);
    assert.match(stdout.output, /\\u009d/);
    assert.match(stdout.output, /\\u202e/);
    assert.match(stdout.output, /\\u2066/);
    assert.equal(JSON.parse(stdout.output).message, hostile);
  }
});

function captureStream() {
  return {
    output: "",
    write(chunk) { this.output += chunk; }
  };
}
