import { validateListEnvelope } from "./pagination.js";

export async function followEvents({ path, query, context, columns }) {
  const format = context.parsed.options.format || "ndjson";
  const pollIntervalMs = Number(context.parsed.options.pollIntervalMs || 2_000);
  const seen = new BoundedIdentifiers(10_000);

  const initial = await context.client.get(path, query, { signal: context.signal });
  validateListEnvelope(initial, path);
  let pollCursor = initial.poll_cursor;
  if (!pollCursor) {
    const error = new Error([
      "This Logister server does not provide the event high-water cursor required by --follow.",
      "Run the command without --follow, or upgrade the Logister server."
    ].join("\n"));
    error.exitCode = 4;
    throw error;
  }
  await writeUnique(initial, seen, context, format, columns);

  let polls = 0;
  while (!context.signal?.aborted) {
    if (context.followMaxPolls !== undefined && polls >= context.followMaxPolls) break;
    const continued = await wait(pollIntervalMs, context.signal);
    if (!continued) break;

    let page;
    try {
      page = await context.client.get(path, { ...withoutListCursor(query), after_cursor: pollCursor }, { signal: context.signal });
    } catch (error) {
      if (error?.interrupted || context.signal?.aborted) break;
      throw error;
    }
    validateListEnvelope(page, path);
    await writeUnique(page, seen, context, format, columns);
    if (page.poll_cursor) pollCursor = page.poll_cursor;
    polls += 1;
  }
}

async function writeUnique(page, seen, context, format, columns) {
  const items = page.items.filter((item) => {
    const identifier = item?.uuid;
    if (!identifier) return true;
    return seen.add(identifier);
  });
  if (items.length === 0) return;
  await context.write({ ...page, items }, { format, columns });
}

function withoutListCursor(query) {
  const { cursor: _cursor, ...rest } = query;
  return rest;
}

function wait(ms, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => finish(true), ms);
    const abort = () => finish(false);
    const finish = (value) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

class BoundedIdentifiers {
  constructor(limit) {
    this.limit = limit;
    this.values = new Set();
    this.queue = [];
  }

  add(value) {
    if (this.values.has(value)) return false;
    this.values.add(value);
    this.queue.push(value);
    if (this.queue.length > this.limit) this.values.delete(this.queue.shift());
    return true;
  }
}
