import { TextDecoder, TextEncoder } from "node:util";
import { exactRecord } from "./upgrades/contracts.mjs";

/**
 * @typedef {{ name: string, live: boolean }} VenueTag  frozen; display only (spec §7.6)
 */

export const NAME_TAG_TYPE = "waitron-name-tag";
export const NAME_TAG_VERSION = 1;
/** The longest venue name a tag holds, in code points after NFC. */
export const NAME_TAG_MAX_CODE_POINTS = 256;
/** 76 bytes of fixed text plus 256 four-byte characters. */
export const NAME_TAG_MAX_BYTES = 1100;
/** cryptsetup v2.7.5 lib/luks2/luks2.h:28. */
export const LUKS2_TOKENS_MAX = 32;

const KEYS = ["type", "keyslots", "version", "name", "live"];
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

/** @param {string} code @param {string} reason */
function refusal(code, reason) {
  return Object.assign(new Error(code), { code, reason });
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function sameBytes(a, b) {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** @param {string} name @param {boolean} live */
function canonicalBytes(name, live) {
  return new TextEncoder().encode(
    JSON.stringify({ type: NAME_TAG_TYPE, keyslots: [], version: NAME_TAG_VERSION, name, live }),
  );
}

/**
 * Pure. The name's NFC form, or null when a tag cannot hold it. Never throws.
 * @param {unknown} value @returns {string|null}
 */
export function usableVenueName(value) {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC");
  if (!name.isWellFormed() || CONTROL.test(name)) return null;
  const length = [...name].length;
  return length >= 1 && length <= NAME_TAG_MAX_CODE_POINTS ? name : null;
}

/**
 * Pure. Encodes usableVenueName(tag.name), so a decomposed name is stored composed.
 * Throws name_tag.tag_invalid: reason "tag-invalid" unless tag is exactly {name: string, live:
 * boolean}; reason "name-unusable" when the name is unusable.
 * @param {VenueTag} tag @returns {Uint8Array} a fresh array
 */
export function encodeNameTag(tag) {
  if (
    !exactRecord(tag, ["name", "live"]) ||
    typeof tag.name !== "string" ||
    typeof tag.live !== "boolean"
  )
    throw refusal("name_tag.tag_invalid", "tag-invalid");
  const name = usableVenueName(tag.name);
  if (name === null) throw refusal("name_tag.tag_invalid", "name-unusable");
  return canonicalBytes(name, tag.live);
}

/**
 * Pure. Null for anything but the one canonical byte form. Throws name_tag.input_invalid
 * (input-invalid) unless bytes is a Uint8Array.
 * @param {Uint8Array} bytes @returns {VenueTag|null}
 */
export function decodeNameTag(bytes) {
  if (!(bytes instanceof Uint8Array)) throw refusal("name_tag.input_invalid", "input-invalid");
  if (bytes.length > NAME_TAG_MAX_BYTES) return null;

  let value;
  try {
    // ignoreBOM keeps a byte-order mark in the text, so JSON.parse refuses it.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !exactRecord(value, KEYS) ||
    value.type !== NAME_TAG_TYPE ||
    !Array.isArray(value.keyslots) ||
    value.keyslots.length !== 0 ||
    value.version !== NAME_TAG_VERSION ||
    typeof value.live !== "boolean" ||
    usableVenueName(value.name) !== value.name
  )
    return null;

  const { name, live } = value;
  // Bytes, not values: an escaped character or a reordered key parses to the same value.
  if (!sameBytes(canonicalBytes(name, live), bytes)) return null;
  return Object.freeze({ name, live });
}
