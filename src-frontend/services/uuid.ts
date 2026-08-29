/**
 * UUID v4 generation safe for Safari 13 (macOS 10.15).
 *
 * `crypto.randomUUID()` was only added in Safari 16.4, so it is absent on the
 * macOS 10.15 webview (Safari 13) and throws at runtime. This helper degrades
 * gracefully:
 *   1. Use the native `crypto.randomUUID()` when available.
 *   2. Otherwise build a v4 UUID from `crypto.getRandomValues()` (available on
 *      Safari 13) and fall back to `Math.random` if that is missing too.
 */
export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return getValuesUuid();
  }
  return fallbackUuid();
}

/** v4 UUID using the Web Crypto CSPRNG (`crypto.getRandomValues`, Safari 13+). */
function getValuesUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // RFC 4122: set version to 4 and variant bits (10xx).
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let hex = "";
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) hex += "-";
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/** Last-resort v4 UUID using `Math.random` when crypto is unavailable. */
function fallbackUuid(): string {
  const rnd = () => Math.floor(Math.random() * 256);
  const h = (n: number) => n.toString(16).padStart(2, "0");
  const bytes = Array.from({ length: 16 }, rnd) as number[];
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let hex = "";
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) hex += "-";
    hex += h(bytes[i]);
  }
  return hex;
}
