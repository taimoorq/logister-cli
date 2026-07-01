export class ApiError extends Error {
  constructor(message, { status, method, path, body }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
    this.exitCode = status === 401 || status === 403 ? 3 : 1;
  }
}

export class ApiClient {
  constructor({ host, token, userAgent, fetchImpl, timeoutMs = 15_000 }) {
    this.host = normalizeHost(host);
    this.token = token;
    this.userAgent = userAgent;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async capabilities() {
    return this.get("/api/v1/cli/capabilities", {}, { auth: false });
  }

  async get(path, query = {}, options = {}) {
    return this.request("GET", path, { query, ...options });
  }

  async post(path, body = {}, options = {}) {
    return this.request("POST", path, { body, ...options });
  }

  async request(method, path, { query = {}, body, auth = true } = {}) {
    if (!this.host) {
      const error = new Error("Missing Logister host. Run `logister auth login --host <url> --token <token>` or set LOGISTER_HOST.");
      error.exitCode = 2;
      throw error;
    }

    const url = new URL(path, this.host);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = {
      Accept: "application/json",
      "User-Agent": this.userAgent
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    if (auth && !this.token) {
      const error = new Error("Missing Logister token. Run `logister auth login --host <url> --token <token>` or set LOGISTER_TOKEN.");
      error.exitCode = 3;
      throw error;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    let payload;

    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      payload = await parsePayload(response);
    } catch (error) {
      if (error.name === "AbortError") {
        const timeoutError = new Error(`Logister API request timed out after ${this.timeoutMs}ms: ${method} ${url}`);
        timeoutError.exitCode = 1;
        throw timeoutError;
      }

      const networkError = new Error(`Could not reach Logister at ${this.host}: ${error.message}`);
      networkError.exitCode = 1;
      throw networkError;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new ApiError(errorMessage(response, payload), {
        status: response.status,
        method,
        path,
        body: payload
      });
    }

    return payload;
  }
}

function normalizeHost(host) {
  if (!host) return "";
  const value = String(host).trim();
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    const error = new Error(`Invalid Logister host URL: ${value}`);
    error.exitCode = 2;
    throw error;
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    const error = new Error(`Invalid Logister host protocol: ${url.protocol}. Use http:// or https://.`);
    error.exitCode = 2;
    throw error;
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

async function parsePayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(response, payload) {
  if (payload && typeof payload === "object") {
    if (payload.error) return String(payload.error);
    if (Array.isArray(payload.errors)) return payload.errors.join(", ");
  }
  return `Logister API request failed with HTTP ${response.status}`;
}
