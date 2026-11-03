import { WAITRON_LAYOUTS, classifyDisk } from "./disk-state.mjs";
import { exactRecord } from "./upgrades/contracts.mjs";

/**
 * @typedef {object} UnlockObservation  taken once, before any listener starts
 * @property {string} expectedDiskUuid  lowercase canonical; from the measured startup configuration (Linux seam)
 * @property {'complete'|'pending'|'unknown'} firstStart  spec §7.3; only 'complete' allows a key
 * @property {import("./disk-state.mjs").MachineObservation} machine  PR 1's whole-machine observation
 * @typedef {{ diskId: string, diskUuid: string, layoutVersion: number }} UnlockHandle  frozen
 * @typedef {{ kind: 'ready', handle: UnlockHandle } | { kind: 'refused', reason: UnlockTargetRefusal }} UnlockTarget  frozen
 * @typedef {'observation-invalid'|'disk-missing'|'disk-multiple'|'disk-not-waitron'|'disk-mismatch'|'disk-duplicate'|'first-start-pending'} UnlockTargetRefusal
 */

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FIRST_START = ["complete", "pending", "unknown"];

/** @param {UnlockTargetRefusal} reason @returns {UnlockTarget} */
function refused(reason) {
  return Object.freeze({ kind: "refused", reason });
}

/** @param {import("./disk-state.mjs").SignatureObservation} signature */
function validHeaders(signature) {
  return (signature.luks ?? []).filter((header) => header.state === "valid");
}

/**
 * Pure. Never throws for a bad observation: it answers refused "observation-invalid".
 * @param {unknown} observation @returns {UnlockTarget}
 */
export function freezeUnlockTarget(observation) {
  // Every later read is of this copy, so a getter or a caller's later change cannot alter
  // what was checked.
  /** @type {any} */
  let copy;
  try {
    copy = globalThis.structuredClone(observation);
  } catch {
    return refused("observation-invalid");
  }
  if (
    !exactRecord(copy, ["expectedDiskUuid", "firstStart", "machine"]) ||
    typeof copy.expectedDiskUuid !== "string" ||
    !CANONICAL_UUID.test(copy.expectedDiskUuid) ||
    !FIRST_START.includes(copy.firstStart)
  )
    return refused("observation-invalid");
  const { expectedDiskUuid, firstStart, machine } = copy;

  let classification;
  try {
    classification = classifyDisk(machine);
  } catch {
    return refused("observation-invalid");
  }
  if (classification.kind === "none") return refused("disk-missing");
  if (classification.kind === "multiple") return refused("disk-multiple");
  if (classification.kind !== "waitron") return refused("disk-not-waitron");

  /** @type {import("./disk-state.mjs").DiskObservation[]} */
  const disks = machine.disks;
  const disk = disks.find((candidate) => candidate.diskId === classification.diskId);
  const layout = WAITRON_LAYOUTS.find((c) => c.version === classification.layoutVersion);
  const partition = disk.partitions.find(
    (p) =>
      p.typeGuid === layout.typeGuid && p.name === layout.partitionName && p.content === "luks2",
  );
  const diskUuid = validHeaders(partition)[0].uuid;
  if (diskUuid !== expectedDiskUuid) return refused("disk-mismatch");

  // Every attachment counts: classifyDisk ignores external disks, so a clone on USB shows only here.
  const carriers = disks
    .flatMap((d) => [d.whole, ...d.partitions])
    .filter((signature) => validHeaders(signature).some((h) => h.uuid === expectedDiskUuid));
  if (carriers.length !== 1) return refused("disk-duplicate");

  if (firstStart !== "complete") return refused("first-start-pending");

  return Object.freeze({
    kind: "ready",
    handle: Object.freeze({ diskId: disk.diskId, diskUuid, layoutVersion: layout.version }),
  });
}

/** Proposed in spec §7.5, not chosen by the owner. */
export const UNLOCK_DELAYS_MS = Object.freeze([2000, 4000, 8000, 16000, 32000, 60000]);
const KEY_BYTES = 32;
const OPTIONS_CODE = "unlock.options_invalid";

/**
 * @typedef {object} UnlockGateOptions
 * @property {unknown} observation  handed to freezeUnlockTarget; a refusal makes a refused gate, not a throw
 * @property {() => number} now  milliseconds on a clock that never jumps; production uses performance.now()
 * @property {(handle: UnlockHandle, key: Uint8Array) => Promise<boolean>} verify  must finish with key before it settles
 * @property {(handle: UnlockHandle, key: Uint8Array) => Promise<void>} open  must finish with key before it settles
 * @typedef {object} UnlockResult  frozen
 * @property {'opened'|'wrong-key'|'wait'|'refused-state'} kind
 * @property {number|null} retryAt  wrong-key and wait: the deadline on now()'s clock, which is monotonic, so an HTTP answer sends the time remaining, never this number; null while verify or open runs
 * @property {string|null} reason  refused-state only
 * @typedef {object} UnlockStatus  frozen
 * @property {'ready'|'waiting'|'verifying'|'opened'|'closed'|'refused'} state  'verifying' while verify or open runs
 * @property {number|null} retryAt  waiting only
 * @property {string|null} reason  refused only
 * @typedef {{ submit(key: unknown): Promise<UnlockResult>, status(): UnlockStatus }} UnlockGate
 */

/** @param {UnlockResult['kind']} kind @param {number|null} retryAt @param {string|null} reason */
function result(kind, retryAt = null, reason = null) {
  return Object.freeze({ kind, retryAt, reason });
}

/**
 * Every route that accepts a key must hold the same gate, so the wait is shared; a new gate
 * (a restart) starts the wait afresh.
 * @param {UnlockGateOptions} options @returns {UnlockGate}
 */
export function createUnlockGate(options) {
  if (
    !exactRecord(options, ["observation", "now", "verify", "open"]) ||
    typeof options.now !== "function" ||
    typeof options.verify !== "function" ||
    typeof options.open !== "function"
  )
    throw Object.assign(new Error(OPTIONS_CODE), {
      code: OPTIONS_CODE,
      reason: "options-invalid",
    });
  const { observation, now, verify, open } = options;
  const target = freezeUnlockTarget(observation);
  // Null only when the target is refused, and then `ended` stops every submission first.
  const handle = /** @type {UnlockHandle} */ (target.kind === "ready" ? target.handle : null);

  /** @type {{ state: 'opened'|'closed'|'refused', reason: string } | null} */
  let ended = target.kind === "refused" ? { state: "refused", reason: target.reason } : null;
  let running = false;
  let failures = 0;
  /** @type {number|null} */
  let retryAt = null;

  /** @param {string} reason */
  function refuse(reason) {
    ended = { state: "refused", reason };
    return result("refused-state", null, reason);
  }

  function fail() {
    failures += 1;
    retryAt = now() + UNLOCK_DELAYS_MS[Math.min(failures, UNLOCK_DELAYS_MS.length) - 1];
    return result("wrong-key", retryAt);
  }

  /** @param {Uint8Array} key */
  async function check(key) {
    let accepted;
    try {
      accepted = await verify(handle, key);
    } catch {
      return refuse("verifier-failed");
    }
    if (accepted === false) return fail();
    if (accepted !== true) return refuse("verifier-failed");
    try {
      await open(handle, key);
    } catch {
      return refuse("open-failed");
    }
    ended = { state: "opened", reason: "opened" };
    return result("opened");
  }

  return Object.freeze({
    /** @param {unknown} key */
    async submit(key) {
      if (ended) return result("refused-state", null, ended.reason);
      if (running) return result("wait");
      if (retryAt !== null && now() < retryAt) return result("wait", retryAt);
      if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) return fail();
      running = true;
      try {
        return await check(key);
      } finally {
        running = false;
      }
    },
    status() {
      if (ended)
        return Object.freeze({
          state: ended.state,
          retryAt: null,
          reason: ended.state === "refused" ? ended.reason : null,
        });
      if (running) return Object.freeze({ state: "verifying", retryAt: null, reason: null });
      if (retryAt !== null && now() < retryAt)
        return Object.freeze({ state: "waiting", retryAt, reason: null });
      return Object.freeze({ state: "ready", retryAt: null, reason: null });
    },
  });
}
