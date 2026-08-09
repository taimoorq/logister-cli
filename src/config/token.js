export const MAX_TOKEN_BYTES = 8192;

export function isPrintableToken(value, { allowEmpty = false } = {}) {
  if (typeof value !== "string") return false;
  if (!allowEmpty && value.length === 0) return false;
  return Buffer.byteLength(value, "utf8") <= MAX_TOKEN_BYTES && !/[\u0000-\u001F\u007F]/.test(value);
}
