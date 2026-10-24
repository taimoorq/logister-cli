const SENSITIVE_IDENTITIES = Object.freeze([
  "password",
  "passwd",
  "email",
  "secret",
  "token",
  "apikey",
  "authorization",
  "cookie",
  "setcookie",
  "crypt",
  "salt",
  "certificate",
  "otp",
  "ssn",
  "cvv",
  "cvc",
  "useridentifier",
  "userip",
  "ipaddress",
  "phonenumber",
  "privatekey",
  "secretkey",
  "accesskey",
  "signingkey",
  "encryptionkey",
  "masterkey",
  "clientkey",
  "authkey"
]);
const SENSITIVE_SEGMENTS = new Set([
  "password", "passwd", "email", "secret", "token", "authorization", "cookie",
  "crypt", "salt", "certificate", "otp", "ssn", "cvv", "cvc"
]);
// A bare `key` names metric, cache, and grouping keys; only a secret-ish qualifier makes it sensitive.
const KEY_QUALIFIERS = new Set(["api", "private", "secret", "access", "signing", "encryption", "master", "client", "auth"]);
const REDACTED = "[REDACTED]";
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic)(\s+)([A-Za-z0-9._~+/-]+=*)/gi;
const VALUE_PATTERNS = Object.freeze([
  /-----BEGIN ([A-Z0-9 ]{1,64})-----[\s\S]*?(?:-----END \1-----|$)/g,
  /\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*){2,4}/g,
  /\blgst_[A-Za-z0-9_-]{8,}/g,
  /\blogister_(?:cli_|mobile_)?[0-9a-f]{40,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g
]);

export function redactValue(value) {
  return redactNode(value);
}

// The CLI session payload names its metadata object `token`; redact inside it instead of masking it whole.
export function redactSessionDiagnostics(session) {
  if (!session || typeof session !== "object" || Array.isArray(session)) return redactNode(session);
  return Object.fromEntries(Object.entries(session).map(([key, value]) => [
    key,
    key === "token" && value && typeof value === "object" && !Array.isArray(value) ? redactNode(value) : redactNode({ [key]: value })[key]
  ]));
}

export function redactString(value) {
  let text = value.replace(AUTH_SCHEME_PATTERN, (match, scheme, space, credential) => (
    looksLikeCredential(scheme, credential) ? `${scheme}${space}${REDACTED}` : match
  ));
  for (const pattern of VALUE_PATTERNS) text = text.replace(pattern, REDACTED);
  return text;
}

function redactNode(value) {
  if (Array.isArray(value)) {
    if (sensitiveHeaderTuple(value)) return [redactNode(value[0]), REDACTED];
    return value.map((item) => redactNode(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        sensitiveKey(key) && shouldRedact(nestedValue) ? REDACTED : redactNode(nestedValue)
      ])
    );
  }
  if (typeof value === "string") return redactString(value);
  return value;
}

// Header lists such as [["Authorization", "Bearer …"], ["Accept", "…"]] carry the name beside the value.
function sensitiveHeaderTuple(value) {
  return value.length === 2 &&
    typeof value[0] === "string" &&
    (typeof value[1] === "string" || typeof value[1] === "number") &&
    sensitiveKey(value[0]);
}

// "Basic setup" or "Bearer authentication" in prose should survive; real credentials are
// long and mix case, digits, or base64 punctuation, and Basic credentials decode to user:pass.
function looksLikeCredential(scheme, credential) {
  if (credential.length < 8) return false;
  if (scheme.toLowerCase() === "basic") {
    return /^[A-Za-z0-9+/]+=*$/.test(credential) && Buffer.from(credential, "base64").toString("latin1").includes(":");
  }
  return /\d/.test(credential) || /[+/=_.~-]/.test(credential) || (/[a-z]/.test(credential) && /[A-Z]/.test(credential.slice(1)));
}

function shouldRedact(value) {
  if (value === null || value === undefined || typeof value === "boolean") return false;
  return true;
}

function sensitiveKey(key) {
  const text = String(key);
  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (SENSITIVE_IDENTITIES.some((identity) => normalized.endsWith(identity) || normalized.endsWith(`${identity}s`))) return true;

  const segments = text
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (segments.at(-1) === "key" && KEY_QUALIFIERS.has(segments.at(-2))) return true;
  return segments.some((segment) => SENSITIVE_SEGMENTS.has(segment));
}
