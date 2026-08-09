const RELEASE_URL = "https://api.github.com/repos/taimoorq/logister-cli/releases/latest";
const MAX_RELEASE_BYTES = 256 * 1024;

export async function latestRelease({
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = 10_000,
  maxResponseBytes = MAX_RELEASE_BYTES
} = {}) {
  if (signal?.aborted) throw interruptedError();
  const controller = new AbortController();
  let timedOut = false;
  const relayAbort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", relayAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort("timeout");
  }, boundedTimeout(timeoutMs));

  try {
    const response = await fetchImpl(RELEASE_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "logister-cli"
      },
      signal: controller.signal
    });
    if (response.status === 404) {
      await cancelBody(response);
      return { version: null, published: false };
    }
    if (!response.ok) {
      await cancelBody(response);
      throw releaseError(`GitHub release check failed with HTTP ${response.status}`);
    }

    const contentType = response.headers?.get?.("content-type") || "";
    if (!/(?:application\/json|\+json)(?:\s*;|$)/i.test(contentType)) {
      await cancelBody(response);
      throw releaseError(`GitHub release check returned unexpected content type '${contentType || "missing"}'`);
    }
    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
      await cancelBody(response);
      throw releaseError(`GitHub release response exceeds the ${maxResponseBytes}-byte limit`);
    }

    const text = await readBoundedBody(response, maxResponseBytes, controller.signal);
    let release;
    try {
      release = JSON.parse(text);
    } catch {
      throw releaseError("GitHub release check returned malformed JSON");
    }
    if (!release || typeof release !== "object" || Array.isArray(release)) throw releaseError("GitHub release check returned an invalid object");
    return {
      version: safeReleaseField(release.tag_name)?.replace(/^v/, "") || null,
      tag: safeReleaseField(release.tag_name),
      url: safeReleaseUrl(release.html_url),
      published_at: safeTimestamp(release.published_at)
    };
  } catch (error) {
    if (signal?.aborted) throw interruptedError();
    if (timedOut) throw releaseError(`GitHub release check timed out after ${boundedTimeout(timeoutMs)}ms`);
    if (error?.exitCode) throw error;
    throw releaseError(`GitHub release check failed: ${error?.message || "network error"}`);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", relayAbort);
  }
}

async function readBoundedBody(response, maximum, signal) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await readWithAbort(reader, signal);
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel("release response too large").catch(() => {});
      throw releaseError(`GitHub release response exceeds the ${maximum}-byte limit`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

function readWithAbort(reader, signal) {
  if (!signal) return reader.read();
  if (signal.aborted) return Promise.reject(interruptedError());
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      Promise.resolve(reader.cancel("release check aborted")).catch(() => {});
      reject(interruptedError());
    };
    signal.addEventListener("abort", abort, { once: true });
    reader.read().then(
      (result) => { signal.removeEventListener("abort", abort); resolve(result); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); }
    );
    if (signal.aborted) abort();
  });
}

async function cancelBody(response) {
  if (response.body && !response.body.locked) await response.body.cancel("release response unused").catch(() => {});
}

function safeReleaseField(value) {
  if (typeof value !== "string" || value.length > 200 || /[\u0000-\u001F\u007F-\u009F]/.test(value)) return null;
  return value;
}

function safeReleaseUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function boundedTimeout(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 100 && number <= 30_000 ? number : 10_000;
}

function releaseError(message) {
  const error = new Error(message);
  error.exitCode = 1;
  return error;
}

function interruptedError() {
  const error = new Error("Logister release check interrupted.");
  error.name = "AbortError";
  error.exitCode = 130;
  error.interrupted = true;
  return error;
}
