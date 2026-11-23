import { AppError } from "./errors.js";

/** The 32 symbols of every printed code: digits and capitals without I, L, O and U. */
export const TYPED_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const alphabet = TYPED_CODE_ALPHABET;
function refuse(): never {
  throw new AppError("shared.invalid_key_code", {});
}
/** Reads typed text as code symbols: drops spaces, tabs, line breaks and hyphens, upper-cases, and
 * reads O as 0 and I or L as 1. Refuses any other character. */
export function normaliseTypedCode(text: string): string {
  if (typeof text !== "string" || /[^0-9A-Za-z \t\r\n-]/.test(text)) refuse();
  const value = text
    .replace(/[ \t\r\n-]/g, "")
    .toUpperCase()
    .replaceAll("O", "0")
    .replace(/[IL]/g, "1");
  if (/[^0-9ABCDEFGHJKMNPQRSTVWXYZ]/.test(value)) refuse();
  return value;
}
function residue(value: string): number {
  let result = 0;
  for (const symbol of value) result = (result * 32 + alphabet.indexOf(symbol)) % 1021;
  return result;
}
/** Prints 24 bytes, given as base64url text, as 41 grouped symbols: 39 for the bytes, 2 to check. */
export function encodeMasterKeyCode(secret: string): string {
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
/** Reads a printed code, in any case and spacing, back to its 24 bytes as base64url text. */
export function decodeMasterKeyCode(printed: string): string {
  const value = normaliseTypedCode(printed);
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
  return btoa(bytes).replaceAll("+", "-").replaceAll("/", "_");
}
