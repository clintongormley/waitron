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
