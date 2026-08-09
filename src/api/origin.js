export function normalizeLogisterOrigin(host, { allowInsecureHttp = false } = {}) {
  if (!host) return "";
  const value = String(host).trim();
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    usageError(`Invalid Logister host URL: ${value}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) usageError(`Invalid Logister host protocol: ${url.protocol}. Use http:// or https://.`);
  if (url.username || url.password) usageError("Invalid Logister host URL: embedded usernames and passwords are not supported.");
  if (url.search || url.hash) usageError("Invalid Logister host URL: query strings and fragments are not supported.");
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  if (normalizedPath) usageError("Invalid Logister host URL: path prefixes are not supported; configure the server origin only.");
  if (url.protocol === "http:" && !allowInsecureHttp && !isLoopbackHostname(url.hostname)) {
    usageError("Refusing to send Logister credentials over insecure HTTP. Use HTTPS, a loopback host, or explicitly pass --allow-insecure-http for a trusted development server.");
  }
  return url.origin;
}

export function isLoopbackHostname(hostname) {
  const value = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "localhost" || value === "::1") return true;
  const match = /^(\d{1,3})(?:\.(\d{1,3})){3}$/.exec(value);
  return Boolean(match && Number(match[1]) === 127 && value.split(".").every((octet) => Number(octet) <= 255));
}

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  throw error;
}
