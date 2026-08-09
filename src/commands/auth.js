import { deleteProfileToken, saveProfileLogin } from "../config/runtime.js";
import { isPrintableToken, MAX_TOKEN_BYTES } from "../config/token.js";
import { openBrowser, shouldOpenBrowser } from "../system/browser.js";
import { isLoopbackHostname } from "../api/origin.js";

export const DEFAULT_READ_SCOPES = Object.freeze([
  "projects:read",
  "project_summary:read",
  "events:read",
  "errors:read",
  "ai_context:read",
  "traces:read",
  "monitors:read",
  "deployments:read",
  "insights:read",
  "metrics:read"
]);
export const ARTIFACT_WRITE_SCOPE = "artifacts:write";

export async function runAuthCommand(args, context) {
  const subcommand = args[0] || "status";
  if (subcommand === "login") return login(context);
  if (subcommand === "status") return status(context);
  if (subcommand === "logout") return logout(context);

  const error = new Error(`Unknown auth subcommand: ${subcommand}`);
  error.exitCode = 2;
  throw error;
}

async function login({ parsed, runtime, stdout, stderr, env, stdin, client, signal, credentialStore }) {
  const host = parsed.options.host || runtime.host;
  const token = parsed.options.tokenStdin ? await readTokenFromStdin(stdin, signal) : parsed.options.token || env.LOGISTER_TOKEN;
  if (!host) {
    const error = new Error("Usage: logister auth login --host <url>\n   or: logister auth login --host <url> --token <cli-access-token>");
    error.exitCode = 2;
    throw error;
  }

  if (token) return saveLogin({ runtime, parsed, env, stdout, stderr, host, token, tokenMetadata: {}, credentialStore });

  return deviceLogin({ parsed, runtime, stdout, stderr, env, client, signal, credentialStore });
}

async function saveLogin({ runtime, parsed, env, stdout, stderr, host, token, tokenMetadata, credentialStore }) {
  const result = await saveProfileLogin(runtime.profileName, {
    host,
    project: parsed.options.project || runtime.project || undefined,
    scopes: tokenMetadata.scopes,
    expiresAt: tokenMetadata.expiresAt,
    tokenType: tokenMetadata.tokenType,
    token,
    allowInsecureHttp: runtime.allowInsecureHttp
  }, env, credentialStore);
  stdout.write(`Saved Logister profile '${runtime.profileName}' for ${host} using ${result.tokenStore} token storage.\n`);
  if (result.cleanupResult?.status === "failed") {
    stderr?.write("Warning: the previous local Keychain credential could not be removed; the new host-bound credential is active.\n");
  }
}

async function deviceLogin({ parsed, runtime, stdout, stderr, env, client, signal, credentialStore }) {
  const scopes = parsed.options.artifactWrite ? [...DEFAULT_READ_SCOPES, ARTIFACT_WRITE_SCOPE] : DEFAULT_READ_SCOPES;
  const challenge = await client.post(
    "/api/v1/cli/device_authorizations",
    { client_name: "Logister CLI", scopes },
    { auth: false, signal }
  );
  const verificationUrl = validateChallenge(challenge, { allowInsecureHttp: runtime.allowInsecureHttp });
  if (shouldOpenBrowser(parsed.options, env)) openBrowser(verificationUrl);

  stdout.write([
    "Approve this Logister CLI login in your browser.",
    `Code: ${challenge.user_code}`,
    `URL: ${verificationUrl}`,
    ""
  ].join("\n"));

  const tokenPayload = await pollForDeviceToken({
    client,
    deviceCode: challenge.device_code,
    expiresIn: Number(challenge.expires_in || 600),
    intervalSeconds: Number(challenge.interval || 3),
    env,
    signal
  });

  await saveLogin({
    runtime,
    parsed,
    env,
    stdout,
    stderr,
    host: parsed.options.host || runtime.host,
    token: tokenPayload.access_token,
    tokenMetadata: validateTokenPayload(tokenPayload),
    credentialStore
  });
}

async function readTokenFromStdin(stdin, signal) {
  const chunks = [];
  let size = 0;
  const iterator = stdin[Symbol.asyncIterator]();
  while (true) {
    const { done, value: chunk } = await nextWithAbort(iterator, signal);
    if (done) break;
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_TOKEN_BYTES) usageError(`CLI token from stdin exceeds the ${MAX_TOKEN_BYTES}-byte limit.`);
    chunks.push(buffer);
  }
  let raw;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
  } catch {
    usageError("CLI token from stdin must be valid UTF-8 text.");
  }
  const token = raw.endsWith("\r\n") ? raw.slice(0, -2) : raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  if (!token) usageError("CLI token from stdin is empty.");
  if (!isPrintableToken(token)) {
    usageError(`CLI token from stdin must contain at most ${MAX_TOKEN_BYTES} printable bytes with no embedded control characters.`);
  }
  return token;
}

function nextWithAbort(iterator, signal) {
  if (!signal) return iterator.next();
  if (signal.aborted) throw interruptedError();
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      Promise.resolve(iterator.return?.()).catch(() => {});
      reject(interruptedError());
    };
    signal.addEventListener("abort", abort, { once: true });
    iterator.next().then(
      (result) => {
        signal.removeEventListener("abort", abort);
        resolve(result);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
    if (signal.aborted) abort();
  });
}

async function pollForDeviceToken({ client, deviceCode, expiresIn, intervalSeconds, env, signal }) {
  const deadline = Date.now() + Math.max(expiresIn, 1) * 1000;
  let intervalMs = pollIntervalMs(intervalSeconds, env);

  while (Date.now() < deadline) {
    await abortableSleep(intervalMs, signal);

    try {
      const payload = await client.post("/api/v1/cli/device_authorizations/token", { device_code: deviceCode }, { auth: false, signal });
      validateTokenPayload(payload);
      return payload;
    } catch (error) {
      const errorCode = error?.body?.error;
      if (errorCode === "authorization_pending") continue;
      if (errorCode === "slow_down") {
        intervalMs += 5000;
        continue;
      }

      throw deviceLoginError(errorCode, error);
    }
  }

  const error = new Error("Logister CLI login expired before browser approval completed. Run `logister auth login` again.");
  error.exitCode = 3;
  throw error;
}

function pollIntervalMs(intervalSeconds, env) {
  const override = Number(env.LOGISTER_AUTH_POLL_INTERVAL_MS);
  if (Number.isFinite(override) && override >= 0) return override;
  return Math.max(intervalSeconds, 1) * 1000;
}

function deviceLoginError(errorCode, originalError) {
  const messages = {
    access_denied: "Logister CLI login was denied in the browser.",
    expired_token: "Logister CLI login expired. Run `logister auth login` again.",
    invalid_grant: "Logister CLI login is no longer valid. Run `logister auth login` again."
  };
  const error = new Error(messages[errorCode] || originalError.message);
  error.exitCode = 3;
  return error;
}

function abortableSleep(ms, signal) {
  if (signal?.aborted) throw interruptedError();
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(resolve), ms);
    const abort = () => finish(() => reject(interruptedError()));
    const finish = (complete) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      complete();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

async function status({ runtime, client, parsed, write, signal }) {
  const payload = {
    profile: runtime.profileName,
    config_path: runtime.configPath,
    host: runtime.host || null,
    token_present: Boolean(runtime.token),
    token_source: runtime.tokenSource || null,
    project: runtime.project || null,
    saved_scopes: runtime.scopes,
    saved_expiry: runtime.expiresAt,
    legacy_credential: runtime.legacyCredentialPending ? {
      status: "unbound",
      action: "Run `logister auth login --host <url>` to replace this legacy credential safely."
    } : null
  };

  if (runtime.token && runtime.host) {
    try {
      payload.server_session = await client.get("/api/v1/cli/session", {}, { signal });
    } catch (error) {
      if (error?.interrupted || signal?.aborted) throw error;
      payload.server_session = null;
      payload.server_session_error = {
        status: error.status || null,
        code: error.code || error.name,
        message: error.status === 404 ? "Session diagnostics are not available on this Logister server." : error.message
      };
    }
  }

  await write(payload, { format: parsed.options.format || "json", redact: false });
}

async function logout({ runtime, stdout, env, credentialStore }) {
  const result = await deleteProfileToken(runtime.profileName, env, credentialStore);
  stdout.write(result.removed
    ? `Removed token from Logister profile '${runtime.profileName}'.\n`
    : `No saved token was found for Logister profile '${runtime.profileName}'.\n`);
}

function validateChallenge(challenge, { allowInsecureHttp = false } = {}) {
  if (!challenge || typeof challenge !== "object") protocolError("Device authorization response must be a JSON object.");
  for (const field of ["device_code", "user_code"]) {
    if (typeof challenge[field] !== "string" || challenge[field].length === 0 || challenge[field].length > 1024 || /[\u0000-\u001F\u007F]/.test(challenge[field])) {
      protocolError(`Device authorization response contains invalid ${field}.`);
    }
  }
  if (!/^[A-Za-z0-9-]{4,32}$/.test(challenge.user_code)) protocolError("Device authorization response contains an invalid user_code.");
  const verificationUrl = challenge.verification_uri_complete || challenge.verification_uri;
  let url;
  try {
    url = new URL(verificationUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("invalid protocol");
    if (url.username || url.password) throw new Error("embedded credentials");
    if (url.protocol === "http:" && !allowInsecureHttp && !isLoopbackHostname(url.hostname)) throw new Error("insecure verification URL");
  } catch {
    protocolError("Device authorization response contains an invalid verification URL.");
  }
  boundedPositiveNumber(challenge.expires_in, "expires_in", 3600);
  boundedPositiveNumber(challenge.interval, "interval", 60);
  return url.toString();
}

function validateTokenPayload(payload) {
  if (!payload || typeof payload !== "object") protocolError("Device token response must be a JSON object.");
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0 || Buffer.byteLength(payload.access_token) > 8192 || /[\u0000-\u001F\u007F]/.test(payload.access_token)) {
    protocolError("Device token response contains an invalid access_token.");
  }
  const tokenType = payload.token_type || "Bearer";
  if (String(tokenType).toLowerCase() !== "bearer") protocolError(`Unsupported device token type '${tokenType}'.`);

  const expiresAt = payload.expires_at || null;
  if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) protocolError("Device token response contains an invalid expires_at timestamp.");
  const rawScopes = payload.scopes ?? payload.scope ?? [];
  const scopes = Array.isArray(rawScopes)
    ? rawScopes
    : String(rawScopes).split(/[ ,]+/).filter(Boolean);
  if (scopes.length > 100 || !scopes.every((scope) => typeof scope === "string" && /^[a-z_]+:(?:read|write)$/.test(scope))) {
    protocolError("Device token response contains invalid scope metadata.");
  }

  return { scopes, expiresAt, tokenType: "Bearer" };
}

function boundedPositiveNumber(value, field, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max) protocolError(`Device authorization response contains invalid ${field}.`);
}

function protocolError(message) {
  const error = new Error(`Invalid Logister device-flow response: ${message}`);
  error.exitCode = 1;
  throw error;
}

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  throw error;
}

function interruptedError() {
  const error = new Error("Logister login interrupted.");
  error.name = "AbortError";
  error.exitCode = 130;
  error.interrupted = true;
  return error;
}
