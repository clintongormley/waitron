import { TextDecoder, TextEncoder } from "node:util";
import { exactRecord } from "./upgrades/contracts.mjs";

/**
 * @typedef {object} WifiNetwork  frozen
 * @property {string} ssidHex  the network name's bytes as lowercase hex, 1-32 bytes
 * @property {'wpa-psk'|'sae'} keyMgmt
 * @property {string} psk  the password
 * @property {boolean} hidden
 * @typedef {{kind:'loaded', network: WifiNetwork}
 *   | {kind:'refused', reason:'record-oversized'|'record-corrupt'|'record-unsupported'}} WifiParseResult  frozen
 */

export const WIFI_RECORD_MAX_BYTES = 1024;

const CODE = "wifi_record.input_invalid";
const KEYS = ["version", "ssidHex", "keyMgmt", "psk", "hidden"];
const KEY_MANAGEMENT = ["wpa-psk", "sae"];
// A network name is up to 32 arbitrary bytes and need not be UTF-8, so it travels as hex.
const SSID_HEX = /^(?:[0-9a-f]{2}){1,32}$/;
const PRINTABLE_ASCII = /^[ -~]*$/;
// NetworkManager's g_ascii_isxdigit accepts both letter cases (nm-utils.c:1249-1254).
const PSK_HEX = /^[0-9a-fA-F]{64}$/;
const SAE_MAX_BYTES = 256;

/** @param {'record-oversized'|'record-corrupt'|'record-unsupported'} reason */
function refused(reason) {
  return /** @type {WifiParseResult} */ (Object.freeze({ kind: "refused", reason }));
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function sameBytes(a, b) {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** @param {unknown} psk */
function wpaPskOutsidePrintable(psk) {
  if (typeof psk !== "string" || PSK_HEX.test(psk)) return false;
  return psk.length >= 8 && psk.length <= 63 && !PRINTABLE_ASCII.test(psk);
}

/** @param {unknown} psk */
function validWpaPsk(psk) {
  if (typeof psk !== "string") return false;
  if (PSK_HEX.test(psk)) return true;
  return psk.length >= 8 && psk.length <= 63 && PRINTABLE_ASCII.test(psk);
}

/** @param {string} text  U+0000-U+001F or U+007F */
function hasControl(text) {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x20 || unit === 0x7f) return true;
  }
  return false;
}

/** @param {unknown} psk */
function validSae(psk) {
  if (typeof psk !== "string" || !psk.isWellFormed() || hasControl(psk)) return false;
  const size = new TextEncoder().encode(psk).length;
  return size >= 1 && size <= SAE_MAX_BYTES;
}

/**
 * Pure. Throws code "wifi_record.input_invalid", reason "input-invalid", when bytes is not a
 * Uint8Array.
 * @param {Uint8Array} bytes @returns {WifiParseResult}
 */
export function parseWifiRecord(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw Object.assign(new Error(CODE), { code: CODE, reason: "input-invalid" });
  }
  if (bytes.length > WIFI_RECORD_MAX_BYTES) return refused("record-oversized");

  let value;
  try {
    // ignoreBOM keeps a byte-order mark in the text, so JSON.parse refuses it.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    return refused("record-corrupt");
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isInteger(value.version)
  ) {
    return refused("record-corrupt");
  }
  if (value.version !== 1) return refused("record-unsupported");
  if (!exactRecord(value, KEYS)) return refused("record-corrupt");

  const { ssidHex, keyMgmt, psk, hidden } = value;
  // Bytes, not strings: a decoder that replaced a bad byte would still match its own string.
  const canonical = new TextEncoder().encode(
    JSON.stringify({ version: 1, ssidHex, keyMgmt, psk, hidden }) + "\n",
  );
  if (!sameBytes(canonical, bytes)) return refused("record-corrupt");

  if (typeof keyMgmt !== "string") return refused("record-corrupt");
  if (!KEY_MANAGEMENT.includes(keyMgmt)) return refused("record-unsupported");
  if (keyMgmt === "wpa-psk" && wpaPskOutsidePrintable(psk)) return refused("record-unsupported");

  const pskFits = keyMgmt === "wpa-psk" ? validWpaPsk(psk) : validSae(psk);
  if (
    typeof ssidHex !== "string" ||
    !SSID_HEX.test(ssidHex) ||
    !pskFits ||
    typeof hidden !== "boolean"
  ) {
    return refused("record-corrupt");
  }
  return Object.freeze({
    kind: "loaded",
    network: Object.freeze({ ssidHex, keyMgmt, psk, hidden }),
  });
}
