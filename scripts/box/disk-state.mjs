import { exactRecord } from "./upgrades/contracts.mjs";

/**
 * @typedef {{ state: 'valid'|'damaged'|'absent', subsystem: string|null, uuid: string|null }} HeaderObservation
 *   subsystem/uuid are non-null exactly when state === 'valid'; uuid is lowercase canonical.
 * @typedef {'none'|'ntfs'|'bitlocker'|'vfat'|'luks2'|'other'|'unreadable'} ContentKind   ext4 is 'other'
 * @typedef {{ content: ContentKind, luks: readonly [HeaderObservation, HeaderObservation]|null }} SignatureObservation
 *   luks (primary, secondary) is non-null exactly when content === 'luks2'.
 * @typedef {SignatureObservation & { typeGuid: string|null, name: string }} PartitionObservation
 *   typeGuid is lowercase canonical for GPT and null for MBR.
 * @typedef {object} DiskObservation
 * @property {string} diskId  a /dev/disk/by-id basename, never a path
 * @property {'internal'|'external'|'installer'|'unknown'} attachment
 * @property {'gpt'|'mbr'|'none'|'unreadable'} table
 * @property {readonly PartitionObservation[]} partitions  empty when table is none or unreadable
 * @property {SignatureObservation} whole  signature of the whole device (a disk with no partition table)
 * @property {Uint8Array|null} nameTag  raw name-tag bytes, display only
 * @typedef {object} MachineObservation
 * @property {'enabled'|'disabled'|'absent'|'unknown'} tpm
 * @property {'user-mode'|'setup-mode'|'off'|'unknown'} secureBoot
 * @property {readonly DiskObservation[]} disks
 * @typedef {object} DiskClassification
 * @property {'waitron'|'recognised-other'|'unknown'|'multiple'|'none'} kind
 * @property {string|null} diskId  null for multiple and none
 * @property {'no-tpm'|'secure-boot-off'|null} hardware  independent of kind; no-tpm wins when both fail
 * @property {number|null} layoutVersion  waitron only
 * @property {'blank'|'windows'|'bitlocker'|null} recognised  recognised-other only
 */

/** Waitron's own markers per layout version; every layout an installer ever wrote stays listed. */
export const WAITRON_LAYOUTS = Object.freeze([
  Object.freeze({
    version: 1,
    typeGuid: "a8aaea61-baef-47f4-9cff-c4c967ee12c7",
    partitionName: "waitron-box",
    subsystem: "waitron-box-1",
  }),
]);
export const MICROSOFT_RESERVED_TYPE = "e3c9e316-0b5c-4db8-817d-f92df00215ae";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// systemd v257 src/shared/device-nodes.c:13-19 plus its \xNN escapes; non-ASCII is refused.
const DISK_ID = /^(?:[A-Za-z0-9#+.:=@_-]|\\x[0-9a-f]{2})+$/;

/** @param {unknown} value */
function canonicalUuid(value) {
  return typeof value === "string" && CANONICAL_UUID.test(value);
}
const CONTENT_KINDS = ["none", "ntfs", "bitlocker", "vfat", "luks2", "other", "unreadable"];

function invalid() {
  return Object.assign(new Error("disk.observation_invalid"), {
    code: "disk.observation_invalid",
    reason: "observation-invalid",
  });
}

/** @param {unknown} value */
function checkHeader(value) {
  if (!exactRecord(value, ["state", "subsystem", "uuid"])) throw invalid();
  if (value.state === "valid") {
    if (typeof value.subsystem !== "string" || !canonicalUuid(value.uuid)) throw invalid();
  } else if (
    !["damaged", "absent"].includes(value.state) ||
    value.subsystem !== null ||
    value.uuid !== null
  ) {
    throw invalid();
  }
}

/** @param {any} value */
function checkSignature(value) {
  if (!CONTENT_KINDS.includes(value.content)) throw invalid();
  if (value.content === "luks2") {
    if (!Array.isArray(value.luks) || value.luks.length !== 2) throw invalid();
    for (const header of value.luks) checkHeader(header);
  } else if (value.luks !== null) {
    throw invalid();
  }
}

/** @param {unknown} value @param {'gpt'|'mbr'} table */
function checkPartition(value, table) {
  if (!exactRecord(value, ["content", "luks", "typeGuid", "name"])) throw invalid();
  checkSignature(value);
  if (typeof value.name !== "string") throw invalid();
  if (table === "gpt" ? !canonicalUuid(value.typeGuid) : value.typeGuid !== null) throw invalid();
}

/** @param {unknown} value */
function checkDisk(value) {
  if (
    !exactRecord(value, ["diskId", "attachment", "table", "partitions", "whole", "nameTag"]) ||
    typeof value.diskId !== "string" ||
    !DISK_ID.test(value.diskId) ||
    value.diskId.length > 255 ||
    value.diskId === "." ||
    value.diskId === ".." ||
    !["internal", "external", "installer", "unknown"].includes(value.attachment) ||
    !["gpt", "mbr", "none", "unreadable"].includes(value.table) ||
    !Array.isArray(value.partitions) ||
    !exactRecord(value.whole, ["content", "luks"]) ||
    (value.nameTag !== null && !(value.nameTag instanceof Uint8Array))
  )
    throw invalid();
  if ((value.table === "none" || value.table === "unreadable") && value.partitions.length > 0)
    throw invalid();
  checkSignature(value.whole);
  for (const partition of value.partitions) checkPartition(partition, value.table);
}

/** @param {unknown} input @returns {asserts input is MachineObservation} */
function checkMachine(input) {
  if (
    !exactRecord(input, ["tpm", "secureBoot", "disks"]) ||
    !["enabled", "disabled", "absent", "unknown"].includes(input.tpm) ||
    !["user-mode", "setup-mode", "off", "unknown"].includes(input.secureBoot) ||
    !Array.isArray(input.disks)
  )
    throw invalid();
  // for…of, not forEach: a hole in a sparse array visits as undefined and is refused.
  for (const disk of input.disks) checkDisk(disk);
  const ids = new Set(input.disks.map((disk) => disk.diskId));
  if (ids.size !== input.disks.length) throw invalid();
}

/** @param {SignatureObservation} signature */
function validHeaders(signature) {
  return (signature.luks ?? []).filter((header) => header.state === "valid");
}

/** @param {SignatureObservation} signature */
function hasWaitronSubsystem(signature) {
  return validHeaders(signature).some((header) =>
    WAITRON_LAYOUTS.some((layout) => layout.subsystem === header.subsystem),
  );
}

/** @param {PartitionObservation} partition */
function hasMarker(partition) {
  return (
    WAITRON_LAYOUTS.some(
      (layout) => layout.typeGuid === partition.typeGuid || layout.partitionName === partition.name,
    ) || hasWaitronSubsystem(partition)
  );
}

/** @param {DiskObservation} disk @returns {number|null} the layout version when complete */
function completeLayout(disk) {
  const marked = disk.partitions.filter(hasMarker);
  if (marked.length !== 1 || hasWaitronSubsystem(disk.whole)) return null;
  const [partition] = marked;
  const layout = WAITRON_LAYOUTS.find(
    (candidate) =>
      candidate.typeGuid === partition.typeGuid &&
      candidate.partitionName === partition.name &&
      partition.content === "luks2",
  );
  if (!layout) return null;
  const headers = validHeaders(partition);
  if (headers.length === 0 || headers.some((header) => header.subsystem !== layout.subsystem))
    return null;
  if (headers.length === 2 && headers[0].uuid !== headers[1].uuid) return null;
  return layout.version;
}

/** @param {DiskObservation} disk */
function classifyOne(disk) {
  const unknown = { kind: "unknown", layoutVersion: null, recognised: null };
  const signatures = [disk.whole, ...disk.partitions];
  if (disk.table === "unreadable" || signatures.some((s) => s.content === "unreadable"))
    return unknown;
  if (disk.partitions.some(hasMarker) || hasWaitronSubsystem(disk.whole)) {
    const layoutVersion = completeLayout(disk);
    return layoutVersion === null ? unknown : { kind: "waitron", layoutVersion, recognised: null };
  }
  // The blank and Windows rules below also refuse these; this stays so a wider Windows rule
  // cannot let foreign encryption through.
  if (signatures.some((s) => s.content === "luks2")) return unknown;
  if (disk.table === "none" && disk.whole.content === "none")
    return { kind: "recognised-other", layoutVersion: null, recognised: "blank" };
  const windowsShaped = disk.partitions.every(
    (p) =>
      ["ntfs", "bitlocker", "vfat"].includes(p.content) ||
      (p.content === "none" && p.typeGuid === MICROSOFT_RESERVED_TYPE),
  );
  if (
    disk.whole.content === "none" &&
    disk.partitions.length > 0 &&
    windowsShaped &&
    disk.partitions.some((p) => p.content === "ntfs" || p.content === "bitlocker")
  ) {
    const bitlocker = disk.partitions.some((p) => p.content === "bitlocker");
    return {
      kind: "recognised-other",
      layoutVersion: null,
      recognised: bitlocker ? "bitlocker" : "windows",
    };
  }
  return unknown;
}

/** @param {MachineObservation} input @returns {DiskClassification} frozen */
export function classifyDisk(input) {
  checkMachine(input);
  const hardware =
    input.tpm !== "enabled"
      ? "no-tpm"
      : input.secureBoot !== "user-mode"
        ? "secure-boot-off"
        : null;
  // Unknown counts as internal so an unclear second disk gives multiple rather than a guess.
  const internal = input.disks.filter(
    (disk) => disk.attachment === "internal" || disk.attachment === "unknown",
  );
  if (internal.length !== 1) {
    const kind = internal.length === 0 ? "none" : "multiple";
    return Object.freeze({ kind, diskId: null, hardware, layoutVersion: null, recognised: null });
  }
  const [disk] = internal;
  const { kind, layoutVersion, recognised } = classifyOne(disk);
  return Object.freeze({ kind, diskId: disk.diskId, hardware, layoutVersion, recognised });
}
