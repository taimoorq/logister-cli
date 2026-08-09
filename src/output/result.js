import { redactValue } from "../redaction/redact.js";
import { sanitizeTerminalText, stringifyMachineSafe } from "./sanitize.js";

export async function writeResult(payload, { stdout, format = "table", redact = true, columns, signal, onBrokenPipe }) {
  const safePayload = redact ? redactValue(payload) : payload;

  if (format === "json") {
    await writeChunk(stdout, `${stringifyMachineSafe(safePayload, 2)}\n`, signal, onBrokenPipe);
    return;
  }

  if (format === "ndjson") {
    for (const row of rowsFor(safePayload)) {
      if (!await writeChunk(stdout, `${stringifyMachineSafe(row)}\n`, signal, onBrokenPipe)) break;
    }
    return;
  }

  if (format === "markdown") {
    await writeChunk(stdout, markdownFor(safePayload, columns), signal, onBrokenPipe);
    return;
  }

  await writeChunk(stdout, tableFor(safePayload, columns), signal, onBrokenPipe);
}

export function rowsFor(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.records)) return payload.records;
  return [payload].filter((value) => value !== null && value !== undefined);
}

function tableFor(payload, requestedColumns) {
  const rows = rowsFor(payload);
  if (rows.length === 0) return "No records found.\n";
  if (rows.length === 1 && !Array.isArray(payload) && !Array.isArray(payload?.items) && !Array.isArray(payload?.records)) {
    return Object.entries(flatten(rows[0]))
      .map(([key, value]) => `${humanText(key).padEnd(28)} ${formatCell(value)}`)
      .join("\n") + "\n";
  }

  const flattened = rows.map((row) => flatten(row));
  const columns = preferredColumns(flattened, requestedColumns);
  const headers = columns.map(humanText);
  const widths = columns.map((column, index) => Math.min(Math.max(headers[index].length, ...flattened.map((row) => formatCell(row[column]).length)), 40));
  const header = headers.map((column, index) => truncate(column, widths[index]).padEnd(widths[index])).join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  const body = flattened.map((row) => columns.map((column, index) => truncate(formatCell(row[column]), widths[index]).padEnd(widths[index])).join("  "));
  return [header, divider, ...body].join("\n") + "\n";
}

function markdownFor(payload, requestedColumns) {
  const rows = rowsFor(payload);
  if (rows.length === 0) return "No records found.\n";
  const flattened = rows.map((row) => flatten(row));
  const columns = preferredColumns(flattened, requestedColumns);
  const header = `| ${columns.map(markdownLiteral).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = flattened.map((row) => `| ${columns.map((column) => markdownCell(row[column])).join(" | ")} |`);
  return [header, divider, ...body].join("\n") + "\n";
}

function preferredColumns(rows, requestedColumns = []) {
  const all = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const requested = requestedColumns.filter((key) => all.includes(key));
  if (requested.length > 0) return requested;
  const preferred = [
    "uuid",
    "id",
    "name",
    "slug",
    "status",
    "event_type",
    "level",
    "message",
    "title",
    "environment",
    "release",
    "occurred_at",
    "last_seen_at",
    "updated_at"
  ];
  return [...preferred.filter((key) => all.includes(key)), ...all.filter((key) => !preferred.includes(key))].slice(0, 8);
}

function flatten(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { [prefix || "value"]: value };
  return Object.entries(value).reduce((memo, [key, nested]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      Object.assign(memo, flatten(nested, nextKey));
    } else {
      memo[nextKey] = nested;
    }
    return memo;
  }, {});
}

function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return humanText(value.join(", "));
  if (typeof value === "object") return humanText(JSON.stringify(value));
  return humanText(String(value));
}

function markdownCell(value) {
  return markdownLiteral(formatCell(value));
}

function truncate(value, width) {
  return value.length <= width ? value : `${value.slice(0, Math.max(width - 1, 0))}…`;
}

function humanText(value) {
  return sanitizeTerminalText(value);
}

function markdownLiteral(value) {
  return humanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_[\]{}()#+\-.!|~:/])/g, "\\$1");
}

async function writeChunk(stdout, chunk, signal, onBrokenPipe) {
  if (stdout.destroyed || stdout.writableEnded) return false;
  try {
    const accepted = stdout.write(chunk);
    if (accepted === false) return waitForDrain(stdout, signal, onBrokenPipe);
    return true;
  } catch (error) {
    if (error?.code === "EPIPE") {
      onBrokenPipe?.();
      return false;
    }
    throw error;
  }
}

function waitForDrain(stdout, signal, onBrokenPipe) {
  if (signal?.aborted || stdout.destroyed || stdout.writableEnded) return Promise.resolve(false);
  if (typeof stdout.once !== "function") return Promise.resolve(true);

  return new Promise((resolve, reject) => {
    const finish = (callback) => {
      stdout.removeListener?.("drain", onDrain);
      stdout.removeListener?.("error", onError);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onDrain = () => finish(() => resolve(true));
    const onAbort = () => finish(() => resolve(false));
    const onError = (error) => finish(() => {
      if (error?.code === "EPIPE") {
        onBrokenPipe?.();
        resolve(false);
      } else {
        reject(error);
      }
    });
    stdout.once("drain", onDrain);
    stdout.once("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
