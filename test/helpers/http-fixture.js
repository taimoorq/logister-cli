import { createServer } from "node:http";

export async function startHttpFixture(handler) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(request.url, "http://fixture.local");
    requests.push({
      method: request.method,
      path: url.pathname,
      query: url.searchParams,
      headers: request.headers,
      body
    });

    const result = await handler({ request, response, url, body, requests });
    if (response.writableEnded || result === undefined) return;
    response.statusCode = result.status || 200;
    for (const [key, value] of Object.entries(result.headers || { "content-type": "application/json" })) response.setHeader(key, value);
    response.end(typeof result.body === "string" ? result.body : JSON.stringify(result.body ?? null));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    host: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}
