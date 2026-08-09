export async function runPaginatedRequest({ path, query, context, columns }) {
  const { options } = context.parsed;
  if (!options.all) {
    const payload = await context.client.get(path, query, { signal: context.signal });
    validateListEnvelope(payload, path);
    await context.write(payload, { columns });
    return payload;
  }

  const format = options.format || context.runtime.format || "table";
  const accumulated = [];
  const accumulationLimit = context.maxAccumulatedRecords || 100_000;
  const accumulationByteLimit = context.maxAccumulatedBytes || 32 * 1024 * 1024;
  let accumulatedBytes = 0;
  const seenCursors = new Set();
  let cursor = query.cursor;
  let firstPage = null;
  let lastPage = null;

  for (let pageNumber = 0; pageNumber < 10_000; pageNumber += 1) {
    const pageQuery = { ...query, cursor };
    const page = await context.client.get(path, pageQuery, { signal: context.signal });
    validateListEnvelope(page, path);
    firstPage ||= page;
    lastPage = page;

    if (format === "ndjson") await context.write(page, { format, columns });
    else {
      const nextRecordCount = accumulated.length + page.items.length;
      const pageBytes = Buffer.byteLength(JSON.stringify(page.items), "utf8");
      if (nextRecordCount > accumulationLimit || accumulatedBytes + pageBytes > accumulationByteLimit) {
        const error = new Error([
          `Logister API pagination exceeded the in-memory output limit for ${path} (${accumulationLimit} records or ${accumulationByteLimit} serialized bytes).`,
          "Narrow the query or use --format ndjson --all to stream large exports."
        ].join("\n"));
        error.exitCode = 1;
        throw error;
      }
      accumulated.push(...page.items);
      accumulatedBytes += pageBytes;
    }

    if (!page.next_cursor) break;
    if (seenCursors.has(page.next_cursor)) {
      const error = new Error(`Logister API repeated a pagination cursor for ${path}; refusing an infinite loop.`);
      error.exitCode = 1;
      throw error;
    }
    seenCursors.add(page.next_cursor);
    cursor = page.next_cursor;
  }

  if (lastPage?.next_cursor) {
    const error = new Error(`Logister API pagination exceeded 10000 pages for ${path}. Narrow the query range.`);
    error.exitCode = 1;
    throw error;
  }

  if (format === "ndjson") return { items: [], next_cursor: null, generated_at: lastPage?.generated_at };

  const payload = {
    ...(firstPage || {}),
    items: accumulated,
    next_cursor: null,
    generated_at: lastPage?.generated_at || firstPage?.generated_at
  };
  await context.write(payload, { format, columns });
  return payload;
}

export function validateListEnvelope(payload, path) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) {
    const error = new Error(`Logister API returned an invalid list response for ${path}: expected an items array.`);
    error.exitCode = 1;
    throw error;
  }
  for (const key of ["next_cursor", "poll_cursor"]) {
    if (payload[key] !== undefined && payload[key] !== null && typeof payload[key] !== "string") {
      const error = new Error(`Logister API returned an invalid ${key} for ${path}.`);
      error.exitCode = 1;
      throw error;
    }
  }
}
