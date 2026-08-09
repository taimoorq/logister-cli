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
  "privatekey"
]);
const SENSITIVE_SEGMENTS = new Set([
  "password", "passwd", "email", "secret", "token", "authorization", "cookie",
  "crypt", "salt", "certificate", "otp", "ssn", "cvv", "cvc"
]);

export function redactValue(value) {
  return redactNode(value);
}

function redactNode(value) {
  if (Array.isArray(value)) return value.map((item) => redactNode(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        sensitiveKey(key) && shouldRedact(nestedValue) ? "[REDACTED]" : redactNode(nestedValue)
      ])
    );
  }
  return value;
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
  return segments.at(-1) === "key" || segments.some((segment) => SENSITIVE_SEGMENTS.has(segment));
}
