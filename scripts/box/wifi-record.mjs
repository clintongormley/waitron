import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { TextDecoder, TextEncoder } from "node:util";
import { exactRecord, safeInteger } from "./upgrades/contracts.mjs";

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
// NetworkManager's g_ascii_isxdigit accepts both letter cases (1.52.0,
// src/libnm-core-impl/nm-utils.c:1249-1255).
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
  if (typeof psk !== "string") return false;
  const characters = [...psk].length;
  return characters >= 8 && characters <= 63 && !PRINTABLE_ASCII.test(psk);
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

const NETWORK_CODE = "wifi_record.network_invalid";
const NETWORK_KEYS = ["ssidHex", "keyMgmt", "psk", "hidden"];

/** @param {string} reason */
function networkInvalid(reason) {
  return Object.assign(new Error(NETWORK_CODE), { code: NETWORK_CODE, reason });
}

/**
 * The canonical version-1 bytes and the reader's answer for them.
 * @param {{ssidHex:string, keyMgmt:string, psk:string, hidden:boolean}} network
 * @returns {{bytes: Uint8Array, result: WifiParseResult}}
 */
function canonicalRecord({ ssidHex, keyMgmt, psk, hidden }) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ version: 1, ssidHex, keyMgmt, psk, hidden }) + "\n",
  );
  return { bytes, result: parseWifiRecord(bytes) };
}

/**
 * Pure. network is exactly {ssidHex, keyMgmt, psk, hidden}. Returns the canonical version-1 bytes
 * once parseWifiRecord answers loaded for them. Throws code "wifi_record.network_invalid" with
 * reason "network-invalid" (wrong shape) or the reason parseWifiRecord gives those bytes; the
 * error holds no field value.
 * @param {{ssidHex:string, keyMgmt:string, psk:string, hidden:boolean}} network
 * @returns {Uint8Array} a fresh array
 */
export function formatWifiRecord(network) {
  const { ssidHex, keyMgmt, psk, hidden } = /** @type {any} */ (network ?? {});
  if (
    !exactRecord(network, NETWORK_KEYS) ||
    typeof ssidHex !== "string" ||
    typeof keyMgmt !== "string" ||
    typeof psk !== "string" ||
    typeof hidden !== "boolean"
  ) {
    throw networkInvalid("network-invalid");
  }
  const { bytes, result } = canonicalRecord({ ssidHex, keyMgmt, psk, hidden });
  if (result.kind !== "loaded") throw networkInvalid(result.reason);
  return bytes;
}

/**
 * @typedef {{kind:'cable-only'}
 *   | {kind:'wifi', ssidHex:string, keyMgmt:string|null, psk:string|null, hidden:boolean}} WifiSettings
 *   the box's normal network settings as the network adapter reads them from NetworkManager:
 *   keyMgmt is 802-11-wireless-security.key-mgmt, null when the connection has no security
 *   setting; psk is null when NetworkManager holds no password the host can read
 * @typedef {'cable-only'|'open'|'open-or-wep'|'dynamic-wep'|'owe'|'enterprise'
 *   |'unsupported-security'|'password-unavailable'|'password-not-printable'|'password-too-long'
 *   |'password-invalid'} WifiNoCopyReason
 * @typedef {{kind:'write', bytes:Uint8Array} | {kind:'remove', reason:WifiNoCopyReason}} WifiCopyDecision
 *   frozen; remove: no copy should exist, so any copy present is obsolete
 */

/** Every reason decideWifiBootCopy gives for no copy. Frozen. */
export const WIFI_NO_COPY_REASONS = Object.freeze([
  "cable-only",
  "open",
  "open-or-wep",
  "dynamic-wep",
  "owe",
  "enterprise",
  "unsupported-security",
  "password-unavailable",
  "password-not-printable",
  "password-too-long",
  "password-invalid",
]);

const SETTINGS_CODE = "wifi_record.settings_invalid";
const WIFI_SETTINGS_KEYS = ["kind", "ssidHex", "keyMgmt", "psk", "hidden"];
/** @type {Map<string, WifiNoCopyReason>} NetworkManager's key-mgmt values that have no copy */
const SECURITY_REASONS = new Map([
  ["none", "open-or-wep"],
  ["ieee8021x", "dynamic-wep"],
  ["owe", "owe"],
  ["wpa-eap", "enterprise"],
  ["wpa-eap-suite-b-192", "enterprise"],
]);

/** @type {Record<'record-oversized'|'record-corrupt'|'record-unsupported', WifiNoCopyReason>} */
const PASSWORD_REASONS = {
  "record-unsupported": "password-not-printable",
  "record-corrupt": "password-invalid",
  "record-oversized": "password-invalid",
};

/** @param {WifiNoCopyReason} reason @returns {WifiCopyDecision} */
function noCopy(reason) {
  return Object.freeze({ kind: "remove", reason });
}

/** A WPA3 password the reader would accept but for its size. @param {string} psk */
function saeTooLong(psk) {
  return (
    psk.isWellFormed() && !hasControl(psk) && new TextEncoder().encode(psk).length > SAE_MAX_BYTES
  );
}

/**
 * Pure (spec §7.5). Throws code "wifi_record.settings_invalid", reason "settings-invalid", for
 * settings of the wrong shape.
 * @param {WifiSettings} settings @returns {WifiCopyDecision}
 */
export function decideWifiBootCopy(settings) {
  if (exactRecord(settings, ["kind"]) && /** @type {any} */ (settings).kind === "cable-only") {
    return noCopy("cable-only");
  }
  const { kind, ssidHex, keyMgmt, psk, hidden } = /** @type {any} */ (settings ?? {});
  if (
    !exactRecord(settings, WIFI_SETTINGS_KEYS) ||
    kind !== "wifi" ||
    typeof ssidHex !== "string" ||
    !SSID_HEX.test(ssidHex) ||
    (keyMgmt !== null && typeof keyMgmt !== "string") ||
    (psk !== null && typeof psk !== "string") ||
    typeof hidden !== "boolean"
  ) {
    throw Object.assign(new Error(SETTINGS_CODE), {
      code: SETTINGS_CODE,
      reason: "settings-invalid",
    });
  }

  if (keyMgmt === null) return noCopy("open");
  if (!KEY_MANAGEMENT.includes(keyMgmt)) {
    return noCopy(SECURITY_REASONS.get(keyMgmt) ?? "unsupported-security");
  }
  if (psk === null) return noCopy("password-unavailable");
  // The reader cannot tell a too-long WPA3 password from a damaged one (`record-corrupt` or
  // `record-oversized`).
  if (keyMgmt === "sae" && saeTooLong(psk)) return noCopy("password-too-long");
  // The shape is already checked, so the reader's refusal can only be about the password.
  const { bytes, result } = canonicalRecord({ ssidHex, keyMgmt, psk, hidden });
  if (result.kind !== "loaded") return noCopy(PASSWORD_REASONS[result.reason]);
  return /** @type {WifiCopyDecision} */ (Object.freeze({ kind: "write", bytes }));
}

/**
 * @typedef {{ bootRoot: string, rootId: string }} BootMountIdentity  rootId is "<dev>:<ino>" of bootRoot
 * @typedef {object} WifiReaderDeps
 * @property {string} bootRoot  absolute and equal to its own path.resolve (checked at construction);
 *   being equal to its realpath is the caller's duty, not checked
 * @property {number} ownerUid  0 in production; tests pass process.getuid()
 * @property {() => Promise<BootMountIdentity>} inspectBootMount
 * @property {{ lstat: typeof fs.lstat, open: typeof fs.open }} [io]  the publisher passes its own,
 *   and tests pass one to count or fail calls; leave the key out for node:fs/promises. The reader
 *   has no other file operation.
 * @typedef {{kind:'loaded', network: WifiNetwork} | {kind:'absent'}
 *   | {kind:'refused', reason: string}} WifiReadResult  frozen
 */

// The Linux pull request confirms where the startup image mounts the boot partition.
export const BOOT_ROOT = "/boot";

const DEPS_CODE = "wifi_record.deps_invalid";
const FOLDER = "waitron-recovery";
const RECORD = "wifi.json";
const ROOT_ID = /^\d+:\d+$/;
// Without O_NONBLOCK, opening a FIFO waits for a writer that may never come; with it, the open
// returns and the handle's stat shows what the path really is.
const OPEN_RECORD = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

const ABSENT = Object.freeze({ kind: "absent" });
// A read ends early with its thrown value only when that value is in this set; anything else
// thrown becomes "io-failed".
const answers = new WeakSet([ABSENT]);

/** @param {string} reason */
function refusedRead(reason) {
  const answer = Object.freeze({ kind: "refused", reason });
  answers.add(answer);
  return answer;
}

/** @param {unknown} error */
function errnoCode(error) {
  return Object(error).code;
}

/** @param {unknown} io */
function validIo(io) {
  return (
    io !== null &&
    typeof io === "object" &&
    typeof (/** @type {any} */ (io).lstat) === "function" &&
    typeof (/** @type {any} */ (io).open) === "function"
  );
}

/** @param {unknown} deps */
function validDeps(deps) {
  const keys = ["bootRoot", "ownerUid", "inspectBootMount"];
  const withIo = exactRecord(deps, [...keys, "io"]);
  if (!withIo && !exactRecord(deps, keys)) return false;
  const { bootRoot, ownerUid, inspectBootMount, io } = /** @type {any} */ (deps);
  return (
    typeof bootRoot === "string" &&
    resolve(bootRoot) === bootRoot &&
    safeInteger(ownerUid) &&
    typeof inspectBootMount === "function" &&
    (!withIo || validIo(io))
  );
}

/**
 * Throws code "wifi_record.deps_invalid", reason "deps-invalid", at construction when deps is not
 * exactly these keys (io optional): bootRoot an absolute path equal to its own path.resolve,
 * ownerUid a non-negative safe integer, inspectBootMount a function, io (if given) an object whose
 * lstat and open are functions. Nothing is read first.
 * @param {WifiReaderDeps} deps @returns {{ read(): Promise<WifiReadResult> }}
 */
export function createWifiRecordReader(deps) {
  if (!validDeps(deps)) {
    throw Object.assign(new Error(DEPS_CODE), { code: DEPS_CODE, reason: "deps-invalid" });
  }
  const { bootRoot, ownerUid, inspectBootMount } = deps;
  const { lstat, open } = deps.io ?? fs;
  const folder = join(bootRoot, FOLDER);
  const recordPath = join(folder, RECORD);

  /** @param {{uid:number|bigint, mode:number|bigint}} stats @param {number} forbidden */
  function owned(stats, forbidden) {
    return Number(stats.uid) === ownerUid && (Number(stats.mode) & forbidden) === 0;
  }

  /** @param {{isSymbolicLink():boolean, isDirectory():boolean, uid:bigint, mode:bigint}} stats @param {number} forbidden */
  function checkFolder(stats, forbidden) {
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw refusedRead("path-unsafe");
    if (!owned(stats, forbidden)) throw refusedRead("permissions-unsafe");
  }

  async function checkMount() {
    let seenRoot;
    let rootId;
    // Every read of the answer is inside the try, so an answer that throws when read is unverified.
    try {
      const seen = await inspectBootMount();
      if (exactRecord(seen, ["bootRoot", "rootId"])) ({ bootRoot: seenRoot, rootId } = seen);
    } catch {
      throw refusedRead("mount-unverified");
    }
    if (seenRoot !== bootRoot || typeof rootId !== "string" || !ROOT_ID.test(rootId))
      throw refusedRead("mount-unverified");

    let root;
    try {
      root = await lstat(bootRoot, { bigint: true });
    } catch (error) {
      if (errnoCode(error) === "ENOENT") throw refusedRead("mount-unverified");
      throw error;
    }
    if (`${root.dev}:${root.ino}` !== rootId) throw refusedRead("root-changed");
    // Others may read the boot root, so only group and other writes are refused here.
    checkFolder(root, 0o022);
  }

  /** @param {import("node:fs/promises").FileHandle} handle */
  async function readBytes(handle) {
    const record = await handle.stat();
    if (!record.isFile() || record.nlink !== 1) throw refusedRead("path-unsafe");
    if (!owned(record, 0o077)) throw refusedRead("permissions-unsafe");
    if (record.size > WIFI_RECORD_MAX_BYTES) throw refusedRead("record-oversized");
    // One byte over the limit, so a file that grew after the stat is seen without reading more.
    const buffer = new Uint8Array(WIFI_RECORD_MAX_BYTES + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, null);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    if (filled > WIFI_RECORD_MAX_BYTES) throw refusedRead("record-oversized");
    return buffer.subarray(0, filled);
  }

  async function readRecord() {
    await checkMount();
    let stats;
    try {
      stats = await lstat(folder, { bigint: true });
    } catch (error) {
      if (errnoCode(error) === "ENOENT") throw ABSENT;
      throw error;
    }
    checkFolder(stats, 0o077);

    // Only root can write in a root-only folder, so only root could swap it between these checks
    // and the open below, and root is already trusted (spec §7.5).
    let handle;
    try {
      handle = await open(recordPath, OPEN_RECORD);
    } catch (error) {
      if (errnoCode(error) === "ENOENT") throw ABSENT;
      if (errnoCode(error) === "ELOOP") throw refusedRead("path-unsafe");
      throw error;
    }
    try {
      return parseWifiRecord(await readBytes(handle));
    } finally {
      await handle.close();
    }
  }

  return {
    async read() {
      try {
        return await readRecord();
      } catch (error) {
        // The error itself is never kept: an injected io's message may hold the password.
        return answers.has(/** @type {object} */ (error)) ? error : refusedRead("io-failed");
      }
    },
  };
}

const fixedReader = createWifiRecordReader({
  bootRoot: BOOT_ROOT,
  ownerUid: 0,
  inspectBootMount: async () => {
    throw new Error("no boot mount check exists yet");
  },
});

/**
 * Fixed production entry point. No boot-mount check exists until the Linux pull request, so it
 * answers refused "mount-unverified" with no file call.
 * @returns {Promise<WifiReadResult>}
 */
export async function readActiveWifiRecord() {
  return fixedReader.read();
}
