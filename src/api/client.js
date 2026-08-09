import { sanitizeTerminalText } from "../output/sanitize.js";
import { normalizeLogisterOrigin } from "./origin.js";

export class ApiError extends Error {
  constructor(message, { status, method, path, body, headers }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
    this.code = body && typeof body === "object" ? body.code : undefined;
    this.requiredScopes = validatedScopes(body?.required_scopes);
    this.retryAfter = retryAfterMs(headers?.get?.("retry-after"));
    this.exitCode = status === 401 || status === 403 ? 3 : 1;
  }
}

export class ApiProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ApiProtocolError";
    this.exitCode = 1;
  }
}

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export class ApiClient {
  constructor({
    host,
    token,
    userAgent,
    fetchImpl,
    timeoutMs = 15_000,
    retries = 2,
    retryBaseMs = 250,
    maxResponseBytes = MAX_RESPONSE_BYTES,
    sleepImpl = sleep,
    randomImpl = Math.random,
    allowInsecureHttp = false,
    legacyCredentialPending = false
  }) {
    this.host = normalizeLogisterOrigin(host, { allowInsecureHttp });
    this.token = token;
    this.userAgent = userAgent;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = boundedInteger(timeoutMs, 15_000, 100, 120_000);
    this.retries = boundedInteger(retries, 2, 0, 5);
    this.retryBaseMs = retryBaseMs;
    this.maxResponseBytes = maxResponseBytes;
    this.sleepImpl = sleepImpl;
    this.randomImpl = randomImpl;
    this.legacyCredentialPending = legacyCredentialPending;
    this.capabilitiesPromise = null;
  }

  async capabilities({ signal } = {}) {
    if (!this.capabilitiesPromise) {
      this.capabilitiesPromise = this.get("/api/v1/cli/capabilities", {}, { auth: false, signal })
        .catch((error) => {
          this.capabilitiesPromise = null;
          throw error;
        });
    }
    return this.capabilitiesPromise;
  }

  async get(path, query = {}, options = {}) {
    return this.request("GET", path, { query, ...options });
  }

  async post(path, body = {}, options = {}) {
    return this.request("POST", path, { body, ...options });
  }

  async request(method, path, { query = {}, body, auth = true, signal } = {}) {
    if (!this.host) usageError("Missing Logister host. Run `logister auth login --host <url>` or set LOGISTER_HOST.");

    const url = buildUrl(this.host, path, query);
    const headers = {
      Accept: "application/json",
      "User-Agent": this.userAgent
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    if (auth && !this.token) {
      authError(this.legacyCredentialPending
        ? "A legacy unbound macOS Keychain credential was found, but its server origin cannot be proven safely. Run `logister auth login --host <url>` to replace it with an origin-bound credential."
        : "Missing Logister token. Run `logister auth login --host <url>` or set LOGISTER_TOKEN.");
    }

    const retryableMethod = method === "GET";
    let attempt = 0;

    while (true) {
      if (signal?.aborted) throw abortedError();

      const attemptController = new AbortController();
      const abortFromCaller = () => attemptController.abort(signal.reason);
      signal?.addEventListener("abort", abortFromCaller, { once: true });
      const timeout = setTimeout(() => attemptController.abort("timeout"), this.timeoutMs);
      let cleanedUp = false;
      const cleanupAttempt = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortFromCaller);
      };

      try {
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: attemptController.signal
        });

        if (retryableMethod && retryableStatus(response.status) && attempt < this.retries) {
          await cancelBody(response);
          cleanupAttempt();
          await this.waitBeforeRetry(attempt, response.headers, signal);
          attempt += 1;
          continue;
        }

        let payload;
        try {
          payload = await parsePayload(response, method, url, this.maxResponseBytes);
        } catch (error) {
          if (!response.ok && error instanceof ApiProtocolError) {
            throw new ApiError(`${error.message}\nHTTP status: ${response.status}`, {
              status: response.status,
              method,
              path,
              body: null,
              headers: response.headers
            });
          }
          throw error;
        }
        cleanupAttempt();

        if (!response.ok) {
          throw new ApiError(apiErrorMessage(response, payload), {
            status: response.status,
            method,
            path,
            body: payload,
            headers: response.headers
          });
        }

        return payload;
      } catch (error) {
        cleanupAttempt();
        if (signal?.aborted) throw abortedError();
        if (error instanceof ApiError || error instanceof ApiProtocolError) throw error;

        const timedOut = attemptController.signal.aborted;
        if (retryableMethod && attempt < this.retries) {
          await this.waitBeforeRetry(attempt, null, signal);
          attempt += 1;
          continue;
        }
        if (timedOut) {
          const timeoutError = new Error(`Logister API request timed out after ${this.timeoutMs}ms: ${method} ${url.pathname}`);
          timeoutError.exitCode = 1;
          throw timeoutError;
        }

        const networkError = new Error(`Could not reach Logister at ${this.host}: ${error.message}`);
        networkError.exitCode = 1;
        throw networkError;
      }
    }
  }

  async waitBeforeRetry(attempt, headers, signal) {
    const retryAfter = retryAfterMs(headers?.get?.("retry-after"));
    const exponential = Math.min(this.retryBaseMs * (2 ** attempt), 5_000);
    const jitter = Math.floor(exponential * 0.25 * this.randomImpl());
    const delay = Math.min(retryAfter ?? exponential + jitter, 30_000);
    if (signal?.aborted) throw abortedError();
    await abortableSleep(delay, this.sleepImpl, signal);
  }
}

function buildUrl(host, path, query) {
  const url = new URL(path, host);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    const values = Array.isArray(value) ? value : [value];
    const wireKey = Array.isArray(value) ? `${key}[]` : key;
    for (const item of values) url.searchParams.append(wireKey, String(item));
  }
  return url;
}

async function parsePayload(response, method, url, maximumBytes) {
  const contentType = response.headers?.get?.("content-type") || "";
  if (!/(?:application\/json|\+json)(?:\s*;|$)/i.test(contentType)) {
    await cancelBody(response).catch(() => {});
    throw new ApiProtocolError(`Logister API returned unexpected content type '${contentType || "missing"}' for ${method} ${url.pathname}. Expected JSON.`);
  }
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await cancelBody(response).catch(() => {});
    throw new ApiProtocolError(`Logister API response exceeds the ${maximumBytes}-byte limit for ${method} ${url.pathname}.`);
  }

  const text = await readBoundedText(response, maximumBytes, method, url.pathname);
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiProtocolError(`Logister API returned malformed JSON for ${method} ${url.pathname}.`);
  }
}

async function readBoundedText(response, maximum, method, path) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel("response too large").catch(() => {});
      throw new ApiProtocolError(`Logister API response exceeds the ${maximum}-byte limit for ${method} ${path}.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

async function cancelBody(response) {
  if (response.body && !response.body.locked) await response.body.cancel("retrying request");
}

function apiErrorMessage(response, payload) {
  let message = `Logister API request failed with HTTP ${response.status}`;
  if (payload && typeof payload === "object") {
    const detail = remoteErrorDetail(payload);
    if (detail) message += `\nRemote detail: ${detail}`;

    const scopes = validatedScopes(payload.required_scopes);
    if (scopes.length > 0) {
      message += `\nRequired scopes: ${scopes.join(", ")}`;
      message += "\nRun `logister auth login` again and approve the requested read scopes.";
    }
  }
  if (response.status === 401) message += "\nRun `logister auth login` again to refresh your CLI session.";
  return message;
}

function remoteErrorDetail(payload) {
  let values = [];
  if (typeof payload.message === "string") values = [payload.message];
  else if (typeof payload.error === "string") values = [payload.error];
  else if (Array.isArray(payload.errors)) values = payload.errors.filter((value) => typeof value === "string").slice(0, 5);
  if (values.length === 0) return "";

  const detail = values.map((value) => sanitizeTerminalText(value).trim()).filter(Boolean).join("; ");
  return detail.length <= 500 ? detail : `${detail.slice(0, 499)}…`;
}

function validatedScopes(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return [];
  if (!value.every((scope) => typeof scope === "string" && /^[a-z_]+:(?:read|write)$/.test(scope))) return [];
  return [...value];
}

function retryableStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryAfterMs(value) {
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.max(0, Number(value) * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortedError());
  return new Promise((resolve, reject) => {
    const finish = (callback) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const timeout = setTimeout(() => finish(resolve), ms);
    const abort = () => finish(() => reject(abortedError()));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function abortableSleep(ms, sleepImpl, signal) {
  if (!signal) return sleepImpl(ms);
  if (signal.aborted) throw abortedError();
  if (sleepImpl === sleep) return sleepImpl(ms, signal);

  let abortListener;
  const interrupted = new Promise((_, reject) => {
    abortListener = () => reject(abortedError());
    signal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    await Promise.race([sleepImpl(ms), interrupted]);
  } finally {
    signal.removeEventListener("abort", abortListener);
  }
}

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  throw error;
}

function authError(message) {
  const error = new Error(message);
  error.exitCode = 3;
  throw error;
}

function abortedError() {
  const error = new Error("Logister command interrupted.");
  error.name = "AbortError";
  error.exitCode = 130;
  error.interrupted = true;
  return error;
}
