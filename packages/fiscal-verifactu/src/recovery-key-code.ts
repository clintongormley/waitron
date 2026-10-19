import { normaliseTypedCode } from "./paper-register-compact.js";

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function refuse(): never {
  throw new Error("Recovery key refused");
}
function residue(value: string): number {
  let result = 0;
  for (const symbol of value) result = (result * 32 + alphabet.indexOf(symbol)) % 1021;
  return result;
}
export function encodeRecoveryKey(secret: string): string {
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(secret)) refuse();
  const bytes = atob(secret.replaceAll("-", "+").replaceAll("_", "/"));
  let buffer = 0,
    bits = 0,
    value = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte.charCodeAt(0);
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      value += alphabet[(buffer >> bits) & 31]!;
    }
    buffer &= (1 << bits) - 1;
  }
  value += alphabet[buffer << 3]!;
  // A base-32 value divisible by prime 1021 detects single-symbol changes and unequal adjacent swaps.
  const check = (1021 - ((residue(value) * 1024) % 1021)) % 1021;
  value += alphabet[check >> 5]! + alphabet[check & 31]!;
  return value.match(/.{1,4}/g)!.join(" ");
}
export function decodeRecoveryKey(printed: string): string {
  let value: string;
  try {
    value = normaliseTypedCode(printed);
  } catch {
    return refuse();
  }
  if (value.length !== 41 || residue(value) !== 0) refuse();
  let buffer = 0,
    bits = 0,
    bytes = "";
  for (const symbol of value.slice(0, 39)) {
    buffer = (buffer << 5) | alphabet.indexOf(symbol);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes += String.fromCharCode(buffer >> bits);
      buffer &= (1 << bits) - 1;
    }
  }
  if (buffer !== 0) refuse();
  return btoa(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
