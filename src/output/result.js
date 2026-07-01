import { redactValue } from "../redaction/redact.js";

export function writeResult(payload, { stdout, format = "table", redact = true }) {
  const safePayload = redact ? redactValue(payload) : payload;

  if (format === "json") {
    stdout.write(`${JSON.stringify(safePayload, null, 2)}\n`);
    return;
  }

  if (format === "ndjson") {
    for (const row of rowsFor(safePayload)) stdout.write(`${JSON.stringify(row)}\n`);
    return;
  }

  if (format === "markdown") {
    stdout.write(markdownFor(safePayload));
    return;
  }

  stdout.write(tableFor(safePayload));
}

export function rowsFor(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.records)) return payload.records;
  return [payload].filter((value) => value !== null && value !== undefined);
}

function tableFor(payload) {
  const rows = rowsFor(payload);
  if (rows.length === 0) return "No records found.\n";
  if (rows.length === 1 && !Array.isArray(payload) && !Array.isArray(payload?.items) && !Array.isArray(payload?.records)) {
    return Object.entries(flatten(rows[0]))
      .map(([key, value]) => `${key.padEnd(28)} ${formatCell(value)}`)
      .join("\n") + "\n";
  }

  const flattened = rows.map((row) => flatten(row));
  const columns = preferredColumns(flattened);
  const widths = columns.map((column) => Math.min(Math.max(column.length, ...flattened.map((row) => formatCell(row[column]).length)), 40));
  const header = columns.map((column, index) => column.padEnd(widths[index])).join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  const body = flattened.map((row) => columns.map((column, index) => truncate(formatCell(row[column]), widths[index]).padEnd(widths[index])).join("  "));
  return [header, divider, ...body].join("\n") + "\n";
}

function markdownFor(payload) {
  const rows = rowsFor(payload);
  if (rows.length === 0) return "No records found.\n";
  const flattened = rows.map((row) => flatten(row));
  const columns = preferredColumns(flattened);
  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = flattened.map((row) => `| ${columns.map((column) => markdownCell(row[column])).join(" | ")} |`);
  return [header, divider, ...body].join("\n") + "\n";
}

function preferredColumns(rows) {
  const all = [...new Set(rows.flatMap((row) => Object.keys(row)))];
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
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function markdownCell(value) {
  return formatCell(value).replace(/\|/g, "\\|");
}

function truncate(value, width) {
  return value.length <= width ? value : `${value.slice(0, Math.max(width - 1, 0))}…`;
}
