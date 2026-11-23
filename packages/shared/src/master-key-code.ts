import { AppError } from "./errors.js";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const BASE = 31n;
const KEY_BYTES = 16;
const KEY_SYMBOLS = 26;
// Divisibility by this prime is what makes every single changed symbol and every swap of two
// different neighbours detectable (checked for all 28 positions, A1323 plan §3).
const CHECK_PRIME = 953n;

function refuse(): never {
  throw new AppError("shared.invalid_key_code", {});
}

function toNumber(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function toSymbols(value: bigint, width: number): string {
  let text = "";
  for (let i = 0; i < width; ++i) {
    text = ALPHABET[Number(value % BASE)]! + text;
    value /= BASE;
  }
  return text;
}

/** Bytes as one unsigned big-endian number in base 31, padded with leading `2`s to the fewest
 * symbols that hold any value of that many bytes. */
export function keySymbols(bytes: Uint8Array): string {
  // Exact: no power of 31 is a power of 2, so the quotient is never a whole number.
  return toSymbols(toNumber(bytes), Math.ceil((8 * bytes.length) / Math.log2(31)));
}

/** Prints 16 bytes as 28 symbols in seven groups of four: 26 for the bytes, then 2 that make the
 * whole number divisible by 953. */
export function encodeMasterKeyCode(key: Uint8Array): string {
  if (key.length !== KEY_BYTES) refuse();
  const value = toNumber(key);
  const check = (CHECK_PRIME - ((value * BASE * BASE) % CHECK_PRIME)) % CHECK_PRIME;
  const code = toSymbols(value, KEY_SYMBOLS) + toSymbols(check, 2);
  return code.match(/.{4}/g)!.join(" ");
}

/** Reads a printed code back to its 16 bytes, in any case, with spaces and dashes anywhere. */
export function decodeMasterKeyCode(printed: string): Uint8Array {
  // Checked before upper-casing, which turns some other letters (such as `ſ`) into alphabet ones.
  if (typeof printed !== "string" || /[^2-9A-HJKMNP-Za-hjkmnp-z -]/.test(printed)) refuse();
  const code = printed.replace(/[ -]/g, "").toUpperCase();
  if (code.length !== KEY_SYMBOLS + 2) refuse();
  let whole = 0n;
  for (const symbol of code) whole = whole * BASE + BigInt(ALPHABET.indexOf(symbol));
  if (whole % CHECK_PRIME !== 0n) refuse();
  let value = whole / (BASE * BASE);
  if (value >> 128n !== 0n) refuse();
  const key = new Uint8Array(KEY_BYTES);
  for (let i = KEY_BYTES - 1; i >= 0; --i) {
    key[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return key;
}
