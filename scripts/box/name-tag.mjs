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
/** Four times the largest JSON area LUKS2 lists. */
export const NAME_TAG_METADATA_MAX_BYTES = 16 * 1024 * 1024;

const KEYS = ["type", "keyslots", "version", "name", "live"];
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

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
  if (!name.isWellFormed() || CONTROL_CHARACTERS.test(name)) return null;
  const length = [...name].length;
  return length >= 1 && length <= NAME_TAG_MAX_CODE_POINTS ? name : null;
}

/** Throws name_tag.tag_invalid (tag-invalid) unless tag is exactly {name: string, live: boolean}. */
function assertTagShape(/** @type {unknown} */ tag) {
  if (
    !exactRecord(tag, ["name", "live"]) ||
    typeof (/** @type {VenueTag} */ (tag).name) !== "string" ||
    typeof (/** @type {VenueTag} */ (tag).live) !== "boolean"
  )
    throw refusal("name_tag.tag_invalid", "tag-invalid");
}

/**
 * Pure. Encodes usableVenueName(tag.name), so a decomposed name is stored composed.
 * Throws name_tag.tag_invalid: reason "tag-invalid" unless tag is exactly {name: string, live:
 * boolean}; reason "name-unusable" when the name is unusable.
 * @param {VenueTag} tag @returns {Uint8Array} a fresh array
 */
export function encodeNameTag(tag) {
  assertTagShape(tag);
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
    typeof value.name !== "string" ||
    typeof value.live !== "boolean" ||
    usableVenueName(value.name) !== value.name
  )
    return null;

  const { name, live } = value;
  // Bytes, not values: an escaped character or a reordered key parses to the same value.
  if (!sameBytes(canonicalBytes(name, live), bytes)) return null;
  return Object.freeze({ name, live });
}

/** @param {unknown} value */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} token */
function isWaitronToken(token) {
  return isPlainObject(token) && /** @type {{type?: unknown}} */ (token).type === NAME_TAG_TYPE;
}

/**
 * The header's `tokens` object, or null when metadata is too large, not UTF-8 JSON, or has none.
 * @param {Uint8Array} metadata @returns {Record<string, unknown>|null}
 */
function readTokens(metadata) {
  if (!(metadata instanceof Uint8Array)) throw refusal("name_tag.input_invalid", "input-invalid");
  if (metadata.length > NAME_TAG_METADATA_MAX_BYTES) return null;
  let value;
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(metadata);
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return isPlainObject(value) && isPlainObject(value.tokens) ? value.tokens : null;
}

/**
 * Pure. metadata is what `cryptsetup luksDump --dump-json-metadata` prints. Answers the one token of
 * type NAME_TAG_TYPE as JSON.stringify writes it (its own key order kept), or null for none, two or
 * more, or metadata that is not UTF-8 JSON with a `tokens` object. Throws name_tag.input_invalid
 * (input-invalid) unless metadata is a Uint8Array.
 * @param {Uint8Array} metadata @returns {Uint8Array|null} a fresh array
 */
export function findNameTag(metadata) {
  const tokens = readTokens(metadata);
  if (tokens === null) return null;
  const tags = Object.values(tokens).filter(isWaitronToken);
  return tags.length === 1 ? new TextEncoder().encode(JSON.stringify(tags[0])) : null;
}

/**
 * @typedef {{op: "import", tokenId: number, json: Uint8Array}
 *   | {op: "replace", tokenId: number, json: Uint8Array}
 *   | {op: "remove", tokenId: number}} NameTagStep  frozen; json is a fresh array.
 *   import: `cryptsetup token import --token-id <tokenId>`; replace: the same with --token-replace;
 *   remove: `cryptsetup token remove --token-id <tokenId>`. Never --key-slot.
 * @typedef {object} NameTagWritePlan  frozen
 * @property {"unchanged"|"write"|"remove"|"refused"} kind
 * @property {null|"name-unusable"|"no-free-token"|"metadata-unreadable"} reason
 * @property {readonly NameTagStep[]} steps  frozen; run in order; empty for unchanged and refused
 */

/**
 * Pure. tag null means "this box has no tag" (spec §7.6). Only tokens of type NAME_TAG_TYPE, or a
 * free token number, are ever named. Throws name_tag.input_invalid unless metadata is a Uint8Array;
 * name_tag.tag_invalid (tag-invalid) unless tag is null or exactly {name: string, live: boolean}.
 * @param {Uint8Array} metadata @param {VenueTag|null} tag @returns {NameTagWritePlan}
 */
export function planNameTagWrite(metadata, tag) {
  if (tag !== null) assertTagShape(tag);
  const tokens = readTokens(metadata);
  const numbers = tokens === null ? null : Object.keys(tokens).map(tokenNumber);
  if (numbers === null || numbers.includes(null)) return plan("refused", "metadata-unreadable", []);

  const ours = Object.entries(tokens)
    .filter(([, token]) => isWaitronToken(token))
    .map(([key]) => Number(key))
    .sort((a, b) => a - b);
  const name = tag === null ? null : usableVenueName(tag.name);
  const reason = tag !== null && name === null ? "name-unusable" : null;

  if (name === null) {
    return ours.length === 0
      ? plan("unchanged", reason, [])
      : plan("remove", reason, ours.map(removeStep));
  }
  const json = encodeNameTag({ name, live: tag.live });
  if (ours.length === 0) {
    const free = Array.from({ length: LUKS2_TOKENS_MAX }, (_, i) => i).find(
      (n) => !numbers.includes(n),
    );
    if (free === undefined) return plan("refused", "no-free-token", []);
    return plan("write", null, [Object.freeze({ op: "import", tokenId: free, json })]);
  }
  if (ours.length === 1) {
    const current = new TextEncoder().encode(JSON.stringify(tokens[String(ours[0])]));
    if (sameBytes(current, json)) return plan("unchanged", null, []);
  }
  return plan("write", null, [
    Object.freeze({ op: "replace", tokenId: ours[0], json }),
    ...ours.slice(1).map(removeStep),
  ]);
}

/** The token number a key names: "0" to "31" exactly, or null. @param {string} key */
function tokenNumber(key) {
  return /^(0|[1-9][0-9]?)$/.test(key) && Number(key) < LUKS2_TOKENS_MAX ? Number(key) : null;
}

/** @param {number} tokenId @returns {NameTagStep} */
function removeStep(tokenId) {
  return Object.freeze({ op: "remove", tokenId });
}

/**
 * @param {NameTagWritePlan["kind"]} kind @param {NameTagWritePlan["reason"]} reason
 * @param {NameTagStep[]} steps @returns {NameTagWritePlan}
 */
function plan(kind, reason, steps) {
  return Object.freeze({ kind, reason, steps: Object.freeze(steps) });
}
