const SENSITIVE_KEY_PATTERN = /(passw|email|secret|token|_key|apikey|api_key|authorization|cookie|set-cookie|crypt|salt|certificate|otp|ssn|cvv|cvc)/i;

export function redactValue(value) {
  return redactNode(value);
}

function redactNode(value) {
  if (Array.isArray(value)) return value.map((item) => redactNode(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) && shouldRedact(nestedValue) ? "[REDACTED]" : redactNode(nestedValue)
      ])
    );
  }
  return value;
}

function shouldRedact(value) {
  if (value === null || value === undefined || typeof value === "boolean") return false;
  if (Array.isArray(value)) {
    return value.some((item) => item !== null && item !== undefined && typeof item !== "boolean");
  }
  return typeof value === "string" || typeof value === "number";
}
