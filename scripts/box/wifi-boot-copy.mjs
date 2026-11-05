import { join, resolve } from "node:path";
import { hostFileIo } from "./disk-key.mjs";
import { exactRecord, safeInteger } from "./upgrades/contracts.mjs";
import {
  BOOT_ROOT,
  WIFI_NO_COPY_REASONS,
  createWifiRecordReader,
  formatWifiRecord,
  parseWifiRecord,
} from "./wifi-record.mjs";

export const WIFI_COPY_STATES = Object.freeze(["pending", "current", "absent", "failed"]);
export const WIFI_COPY_FAILURES = Object.freeze([
  "mount-unverified",
  "root-changed",
  "path-unsafe",
  "permissions-unsafe",
  "io-failed",
  "publication-unverified",
]);

/**
 * @typedef {'pending'|'current'|'absent'|'failed'} WifiCopyState
 * @typedef {'mount-unverified'|'root-changed'|'path-unsafe'|'permissions-unsafe'|'io-failed'
 *   |'publication-unverified'} WifiCopyFailure
 * @typedef {object} WifiCopyStatus  frozen; exactly these keys; says nothing about live connectivity
 * @property {WifiCopyState} state
 * @property {import("./wifi-record.mjs").WifiNoCopyReason|null} reason  when the decision is a
 *   remove, its reason: from publish, its own decision's; from status(), the most recently called
 *   one's
 * @property {WifiCopyFailure|null} failure  set exactly when state is failed
 * @typedef {import("./disk-key.mjs").DiskRecoveryIo} WifiCopyIo
 * @typedef {object} WifiCopyDeps
 * @property {string} bootRoot  absolute and equal to its own path.resolve; equal to its realpath is
 *   the caller's duty
 * @property {number} ownerUid  0 in production; tests pass process.getuid()
 * @property {() => Promise<{bootRoot: string, rootId: string}>} inspectBootMount
 * @property {WifiCopyIo} [io]  test-only override; leave the key out for disk-key.mjs's hostFileIo
 *   (undefined is refused)
 * @typedef {{kind:'write', bytes:Uint8Array}
 *   | {kind:'remove', reason:import("./wifi-record.mjs").WifiNoCopyReason}} CheckedDecision
 */

const DEPS_CODE = "wifi_copy.deps_invalid";
const DECISION_CODE = "wifi_copy.decision_invalid";
const FOLDER = "waitron-recovery";
const RECORD = "wifi.json";
const NEXT = "wifi.json.next";
const IO_OPS = [
  "lstat",
  "open",
  "mkdir",
  "writeFile",
  "rename",
  "unlink",
  "syncFile",
  "syncDirectory",
];
// The reader's refusals that end a publication with no write. Its other refusals are about the
// bytes of a regular, root-only file, so they do not.
const UNSAFE = new Set([
  "mount-unverified",
  "root-changed",
  "path-unsafe",
  "permissions-unsafe",
  "io-failed",
]);

// Only refusals built here end a publication with their own failure; anything else thrown is
// io-failed, so an injected io's error that merely carries a failure's name cannot pass through.
const refusals = new WeakSet();

/** @param {WifiCopyFailure} failure */
function refusal(failure) {
  const answer = { state: /** @type {WifiCopyState} */ ("failed"), failure };
  refusals.add(answer);
  return answer;
}

/** @param {unknown} error */
function errnoCode(error) {
  return Object(error).code;
}

/** @param {string} code @param {string} reason */
function programmingError(code, reason) {
  return Object.assign(new Error(code), { code, reason });
}

/** @param {unknown} io */
function validIo(io) {
  return (
    exactRecord(io, IO_OPS) &&
    IO_OPS.every((name) => typeof (/** @type {any} */ (io)[name]) === "function")
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
 * The decision as checked, with its bytes copied, or null. Every read of the decision is inside
 * the try, so a getter or proxy trap that throws is a refusal, and its error is never kept.
 * @param {unknown} decision @returns {CheckedDecision | null}
 */
function checkDecision(decision) {
  try {
    if (exactRecord(decision, ["kind", "bytes"])) {
      const { kind, bytes } = /** @type {any} */ (decision);
      if (kind !== "write" || !(bytes instanceof Uint8Array)) return null;
      const copy = Uint8Array.from(bytes);
      return parseWifiRecord(copy).kind === "loaded" ? { kind, bytes: copy } : null;
    }
    if (exactRecord(decision, ["kind", "reason"])) {
      const { kind, reason } = /** @type {any} */ (decision);
      return kind === "remove" && WIFI_NO_COPY_REASONS.includes(reason) ? { kind, reason } : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * @param {WifiCopyState} state
 * @param {import("./wifi-record.mjs").WifiNoCopyReason|null} reason
 * @param {WifiCopyFailure|null} failure
 * @returns {WifiCopyStatus}
 */
function statusOf(state, reason, failure) {
  return Object.freeze({ state, reason, failure });
}

/**
 * Test seam and the future host service's constructor; publish never takes a path.
 * Throws code "wifi_copy.deps_invalid", reason "deps-invalid", at construction, before any io or
 * inspectBootMount call, when deps is not exactly WifiCopyDeps's keys (io optional, and then
 * exactly the eight file operations). publish rejects with code "wifi_copy.decision_invalid",
 * reason "decision-invalid", when the decision is not exactly a write whose bytes parseWifiRecord
 * loads or a remove whose reason is on WIFI_NO_COPY_REASONS; it makes no file call and changes no
 * status.
 * @param {WifiCopyDeps} deps
 * @returns {{ publish(decision: import("./wifi-record.mjs").WifiCopyDecision): Promise<WifiCopyStatus>,
 *   status(): WifiCopyStatus }}
 */
export function createWifiBootCopyPublisher(deps) {
  if (!validDeps(deps)) throw programmingError(DEPS_CODE, "deps-invalid");
  const { bootRoot, ownerUid, inspectBootMount } = deps;
  const folder = join(bootRoot, FOLDER);
  const recordPath = join(folder, RECORD);
  const nextPath = join(folder, NEXT);
  const io = Object.hasOwn(deps, "io") ? /** @type {WifiCopyIo} */ (deps.io) : hostFileIo;
  const reader = createWifiRecordReader({
    bootRoot,
    ownerUid,
    inspectBootMount,
    io: { lstat: io.lstat, open: io.open },
  });

  let tail = Promise.resolve();
  let running = 0;
  /** @type {import("./wifi-record.mjs").WifiNoCopyReason|null} */
  let latestReason = null;
  /** @type {{state: WifiCopyState, failure: WifiCopyFailure|null}} */
  let finished = { state: "pending", failure: null };

  /** @template T @param {() => Promise<T>} run @returns {Promise<T>} */
  function inTurn(run) {
    const result = tail.then(run);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** @param {{uid:number|bigint, mode:number|bigint}} stats */
  function owned(stats) {
    return Number(stats.uid) === ownerUid && (Number(stats.mode) & 0o077) === 0;
  }

  /** @param {string} path @returns {Promise<import("node:fs").BigIntStats | null>} null when absent */
  async function lstatIfPresent(path) {
    try {
      return await io.lstat(path, { bigint: true });
    } catch (error) {
      if (errnoCode(error) === "ENOENT") return null;
      throw error;
    }
  }

  /**
   * Checked on every publication, not only after a mkdir: the folder may have changed since the
   * reader's check. @returns {Promise<boolean>} whether the folder exists
   */
  async function checkFolder() {
    const stats = await lstatIfPresent(folder);
    if (stats === null) return false;
    folderRules(stats);
    return true;
  }

  /** @param {import("node:fs").BigIntStats} stats */
  function folderRules(stats) {
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw refusal("path-unsafe");
    if (!owned(stats)) throw refusal("permissions-unsafe");
  }

  // Only root can put a name in a root-only folder, so a staging name that is not a regular,
  // single-link, owner-only file is a fault, refused before any write rather than removed.
  /** @returns {Promise<boolean>} whether a leftover staging file exists */
  async function checkNext() {
    const stats = await lstatIfPresent(nextPath);
    if (stats === null) return false;
    if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1n) {
      throw refusal("path-unsafe");
    }
    if (!owned(stats)) throw refusal("permissions-unsafe");
    return true;
  }

  /** @param {import("./wifi-record.mjs").WifiReadResult} found @param {Uint8Array} bytes */
  function holds(found, bytes) {
    if (found.kind !== "loaded") return false;
    const loaded = formatWifiRecord(found.network);
    return loaded.length === bytes.length && loaded.every((byte, at) => byte === bytes[at]);
  }

  /**
   * @param {Uint8Array} bytes
   * @param {import("./wifi-record.mjs").WifiReadResult} found  the reader's answer before any write
   * @param {boolean} folderExists @param {boolean} nextExists
   */
  async function writeCopy(bytes, found, folderExists, nextExists) {
    if (!folderExists) {
      await io.mkdir(folder, { mode: 0o700 });
      folderRules(await io.lstat(folder, { bigint: true }));
    }
    // Flushed on every write that gets this far, an unchanged copy included: an earlier one may
    // have made the folder or written the copy and then failed to flush, and a later call cannot
    // tell.
    await io.syncDirectory(bootRoot);
    if (!nextExists && holds(found, bytes)) {
      await io.syncDirectory(folder);
      return;
    }
    if (nextExists) await io.unlink(nextPath);
    await io.writeFile(nextPath, bytes, { flag: "wx", mode: 0o600 });
    await io.syncFile(nextPath);
    await io.rename(nextPath, recordPath);
    await io.syncDirectory(folder);
    if (!holds(await reader.read(), bytes)) throw refusal("publication-unverified");
  }

  /**
   * Only the two fixed names are removed; the folder stays, as other recovery files share it.
   * @param {import("./wifi-record.mjs").WifiReadResult} found  the reader's answer before any write
   * @param {boolean} folderExists @param {boolean} nextExists
   */
  async function removeCopy(found, folderExists, nextExists) {
    if (!folderExists) return;
    // The active copy goes first, so preboot stops trying an obsolete network as early as possible.
    if (found.kind !== "absent") await io.unlink(recordPath);
    if (nextExists) await io.unlink(nextPath);
    // Flushed even when nothing was removed: an earlier removal may have failed to flush.
    await io.syncDirectory(folder);
    let gone;
    try {
      gone = (await reader.read()).kind === "absent" && (await lstatIfPresent(nextPath)) === null;
    } catch {
      gone = false;
    }
    if (!gone) throw refusal("publication-unverified");
  }

  /**
   * @param {CheckedDecision} decision
   * @returns {Promise<{state: WifiCopyState, failure: WifiCopyFailure|null}>}
   */
  async function publishChecked(decision) {
    const found = await reader.read();
    if (found.kind === "refused" && UNSAFE.has(found.reason)) {
      return { state: "failed", failure: /** @type {WifiCopyFailure} */ (found.reason) };
    }
    try {
      const folderExists = await checkFolder();
      const nextExists = folderExists && (await checkNext());
      if (decision.kind === "remove") {
        await removeCopy(found, folderExists, nextExists);
        return { state: "absent", failure: null };
      }
      await writeCopy(decision.bytes, found, folderExists, nextExists);
      return { state: "current", failure: null };
    } catch (error) {
      if (refusals.has(/** @type {object} */ (error))) return /** @type {any} */ (error);
      throw error;
    }
  }

  return {
    async publish(decision) {
      const checked = checkDecision(decision);
      if (checked === null) throw programmingError(DECISION_CODE, "decision-invalid");
      const reason = checked.kind === "remove" ? checked.reason : null;
      latestReason = reason;
      running++;
      try {
        finished = await inTurn(() => publishChecked(checked));
      } catch {
        // The error itself is never kept: an injected io's message may hold the password.
        finished = { state: "failed", failure: "io-failed" };
      } finally {
        running--;
      }
      return statusOf(finished.state, reason, finished.failure);
    },

    status() {
      if (running > 0) return statusOf("pending", latestReason, null);
      return statusOf(finished.state, latestReason, finished.failure);
    },
  };
}

const fixedPublisher = createWifiBootCopyPublisher({
  bootRoot: BOOT_ROOT,
  ownerUid: 0,
  inspectBootMount: async () => {
    throw new Error("no boot mount check exists yet");
  },
});

/**
 * Fixed production entry point. No boot-mount check exists until the Linux pull request, so a
 * valid decision answers failed / mount-unverified with no file call. Rejects with code
 * "wifi_copy.decision_invalid", reason "decision-invalid", as publish does.
 * @param {import("./wifi-record.mjs").WifiCopyDecision} decision
 * @returns {Promise<WifiCopyStatus>}
 */
export async function publishWifiBootCopy(decision) {
  return fixedPublisher.publish(decision);
}

/** @returns {WifiCopyStatus} */
export function wifiBootCopyStatus() {
  return fixedPublisher.status();
}
