import { genuineLength } from "./preboot.mjs";

/** systemd v257 src/shared/recovery-key.c:7-9; the index is the half-byte value. */
export const DISK_KEY_LETTERS = "cbdefghijklnrtuv";
export const DISK_KEY_BYTES = 32;
export const DISK_KEY_TEXT_LENGTH = 71;

const HYPHEN = 0x2d;
const LETTER_CODES = Array.from(DISK_KEY_LETTERS, (letter) => letter.charCodeAt(0));

/** @param {string} code @param {string} reason */
function refusal(code, reason) {
  return Object.assign(new Error(code), { code, reason });
}

/** @param {unknown} key @returns {Uint8Array} */
function checkedKey(key) {
  const length = genuineLength(key);
  if (length === null) throw refusal("disk_recovery_key.invalid", "not-bytes");
  if (length !== DISK_KEY_BYTES) throw refusal("disk_recovery_key.invalid", "wrong-length");
  return /** @type {Uint8Array} */ (key);
}

/**
 * The 71 character codes of the formatted key, high half of each byte first, a hyphen after every
 * fourth byte but the last (systemd v257 src/shared/recovery-key.c:95-105).
 * @param {unknown} key @returns {Uint8Array}
 */
function formattedCodes(key) {
  const bytes = checkedKey(key);
  const codes = new Uint8Array(DISK_KEY_TEXT_LENGTH);
  let j = 0;
  for (let i = 0; i < DISK_KEY_BYTES; i++) {
    const byte = bytes[i];
    codes[j++] = LETTER_CODES[byte >> 4];
    codes[j++] = LETTER_CODES[byte & 0xf];
    if (i % 4 === 3 && i !== DISK_KEY_BYTES - 1) codes[j++] = HYPHEN;
  }
  return codes;
}

/**
 * The text printed on the recovery sheet: 8 groups of 8 lower-case letters joined by "-". Pure.
 * Throws disk_recovery_key.invalid: reason "not-bytes" unless key is a genuine Uint8Array,
 * "wrong-length" unless it holds exactly 32 bytes.
 * @param {Uint8Array} key @returns {string}
 */
export function formatDiskRecoveryKey(key) {
  const codes = formattedCodes(key);
  const text = String.fromCharCode(...codes);
  codes.fill(0);
  return text;
}

/**
 * The exact passphrase `systemd-cryptenroll --recovery-key` puts in the key slot (systemd v257
 * src/cryptenroll/cryptenroll-recovery.c:28, :36-42): the formatted text as 71 ASCII bytes, in a
 * new array the caller zeroes. Pure. Throws disk_recovery_key.invalid as `formatDiskRecoveryKey`
 * does.
 * @param {Uint8Array} key @returns {Uint8Array}
 */
export function diskRecoveryKeyPassphrase(key) {
  return formattedCodes(key);
}

/**
 * Far above any sensible typing (71 characters plus whitespace), so a longer paste is refused
 * unread.
 */
export const DISK_KEY_TEXT_MAX = 4096;

const SEPARATORS = new Set(["-", " ", "\t", "\r", "\n"]);
const HALF_BYTES = DISK_KEY_BYTES * 2;

/**
 * Only ASCII is lower-cased: `toLowerCase()` turns the Kelvin sign U+212A into `k`, and Turkish
 * lower-casing turns U+0130 into `i`, so a stray character could read as a key letter.
 * @param {string} character @returns {number} the half-byte, or -1
 */
function halfByte(character) {
  const code = character.charCodeAt(0);
  const lower = code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 0x20) : character;
  return DISK_KEY_LETTERS.indexOf(lower);
}

/**
 * Reads what a person typed or pasted. Letters in either case; hyphen-minus, ASCII space, tab,
 * carriage return and line feed are ignored anywhere; any other character is refused. No answer
 * holds a typed character. Pure. Throws disk_recovery_key.invalid (not-text) unless text is a
 * string.
 * @param {string} text
 * @returns {{ ok: true, key: Uint8Array } | { ok: false, reason: "letter", position: number } | { ok: false, reason: "length", letters: number | null }}
 */
export function parseDiskRecoveryKey(text) {
  if (typeof text !== "string") throw refusal("disk_recovery_key.invalid", "not-text");
  if (text.length > DISK_KEY_TEXT_MAX) return { ok: false, reason: "length", letters: null };
  const halves = new Uint8Array(HALF_BYTES);
  try {
    let letters = 0;
    let position = 0;
    for (const character of text) {
      position++;
      if (SEPARATORS.has(character)) continue;
      const value = character.length === 1 ? halfByte(character) : -1;
      if (value < 0) return { ok: false, reason: "letter", position };
      if (letters < HALF_BYTES) halves[letters] = value;
      letters++;
    }
    if (letters !== HALF_BYTES) return { ok: false, reason: "length", letters };
    const key = new Uint8Array(DISK_KEY_BYTES);
    for (let i = 0; i < DISK_KEY_BYTES; i++) key[i] = (halves[2 * i] << 4) | halves[2 * i + 1];
    return { ok: true, key };
  } finally {
    halves.fill(0);
  }
}
