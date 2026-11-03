import { types } from "node:util";

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

// Read through the built-in getter, never the key's own `length`, which a subclass or proxy can fake.
const typedArrayLength = /** @type {(this: Uint8Array) => number} */ (
  /** @type {PropertyDescriptor} */ (
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "length")
  ).get
);

/** @param {unknown} key @returns {Uint8Array} */
function checkedKey(key) {
  if (!types.isUint8Array(key)) throw refusal("disk_recovery_key.invalid", "not-bytes");
  if (typedArrayLength.call(key) !== DISK_KEY_BYTES)
    throw refusal("disk_recovery_key.invalid", "wrong-length");
  return key;
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
 * The text printed on the recovery sheet: 8 groups of 8 lower-case letters joined by "-".
 * @param {Uint8Array} key @returns {string}
 */
export function formatDiskRecoveryKey(key) {
  const codes = formattedCodes(key);
  const text = String.fromCharCode(...codes);
  codes.fill(0);
  return text;
}

/**
 * The exact passphrase `systemd-cryptenroll --recovery-key` puts in the key slot: the formatted
 * text as 71 ASCII bytes, in a new array the caller zeroes.
 * @param {Uint8Array} key @returns {Uint8Array}
 */
export function diskRecoveryKeyPassphrase(key) {
  return formattedCodes(key);
}
