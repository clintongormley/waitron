import { constants } from "node:fs";
import { lstat, open, readdir, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AppError, isUuid, isAppError } from "@waitron/shared";
import type { OperationBinding } from "@waitron/module";
import type { FirstSetupRoots } from "./first-setup-resolution-inspection.js";
import { createFirstSetupCoordinator } from "./first-setup-state.js";
import { canonicalFirstSetupDirectory, firstSetupDirectory } from "./first-setup-resolution.js";
import { readDurableHostJson, writeDurableHostJson } from "./durable-host-json.js";
import { isEmptiedTombstone } from "./first-setup-backup-discard.js";
import { START_AGAIN_SET_ASIDE_DIR } from "./first-setup-start-again-names.js";
import {
  SPARE_SPACE_FILE,
  SPARE_SPACE_RELEASED_FILE,
  isBackupRoomFileName,
} from "./spare-space-name.js";
import "./errors.js";

export interface BackupRepairTarget {
  recoveryId: string;
  anchor: FirstSetupRoots;
  source: FirstSetupRoots;
  target: FirstSetupRoots;
  generation: number;
}
export interface BackupRepairObservation {
  inspectionId: string;
  revision: number | null;
  ownerGeneration: number | null;
  originalsDigest: string;
}
export type BackupRepairPhase =
  "prepared" | "placement-started" | "restored" | "selected" | "abandoned";
export interface BackupRepairRecord {
  version: 2;
  sequence: number;
  previousRecordDigest: string | null;
  target: BackupRepairTarget;
  observation: BackupRepairObservation;
  sourceId: string;
  activationSourceId: string;
  binding: OperationBinding;
  input: unknown;
  retainedEvidenceDigest: string;
  phase: BackupRepairPhase;
  recordedAt: string;
}
type RecordInput = Omit<
  BackupRepairRecord,
  "version" | "sequence" | "previousRecordDigest" | "recordedAt"
>;
interface Witness {
  version: 2;
  target: BackupRepairTarget;
  initialRecordDigest: string;
  initialRecord: BackupRepairRecord;
}
interface Original {
  path: string;
  kind: "directory" | "file";
  size: number;
  digest: string | null;
}
const NAMESPACE = join("first-setup-resolutions", "backup-recovery");
const LIMIT = 131072;
const HASH = /^[a-f0-9]{64}$/;
const PHASES: BackupRepairPhase[] = [
  "prepared",
  "placement-started",
  "restored",
  "selected",
  "abandoned",
];
/** The phases a recovery can be abandoned from: a stopped recovery Start again would discard. */
export const ABANDONABLE: readonly BackupRepairPhase[] = [
  "prepared",
  "placement-started",
  "restored",
];
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const missing = (error: unknown) =>
  error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
function invalid(): never {
  throw new AppError("setup.attempt_invalid", {});
}
function conflict(): never {
  throw new AppError("setup.attempt_conflict", {});
}
function writeFailure(error: unknown): never {
  if (isAppError(error)) throw error;
  invalid();
}
function uncertain(): never {
  throw new AppError("setup.attempt_uncertain", {});
}
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}
function sourceIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024;
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function roots(value: unknown): value is FirstSetupRoots {
  return (
    exact(value, ["venueDir", "stateDir"]) &&
    [value.venueDir, value.stateDir].every(
      (path) => typeof path === "string" && path.length > 1 && resolve(path) === path,
    )
  );
}
async function canonical(value: FirstSetupRoots): Promise<FirstSetupRoots> {
  if (!roots(value)) invalid();
  return {
    venueDir: await canonicalFirstSetupDirectory(value.venueDir),
    stateDir: await canonicalFirstSetupDirectory(value.stateDir),
  };
}
function targetValid(value: unknown): asserts value is BackupRepairTarget {
  if (
    !exact(value, ["recoveryId", "anchor", "source", "target", "generation"]) ||
    typeof value.recoveryId !== "string" ||
    !isUuid(value.recoveryId) ||
    !roots(value.anchor) ||
    !roots(value.source) ||
    !roots(value.target) ||
    value.generation !== 1
  )
    invalid();
  const base = join(value.anchor.stateDir, NAMESPACE, value.recoveryId, "target");
  if (
    value.target.venueDir !== join(base, "venue") ||
    value.target.stateDir !== join(base, "state")
  )
    invalid();
}
function publicJson(value: unknown, seen = new Set<unknown>(), depth = 0): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || seen.has(value) || depth > 64) invalid();
  seen.add(value);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) invalid();
  if (Array.isArray(value)) {
    if (
      Object.keys(value).length !== value.length ||
      Reflect.ownKeys(value).length !== value.length + 1
    )
      invalid();
  } else if (Reflect.ownKeys(value).length !== Object.keys(value).length) invalid();
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))
    if (descriptor.get !== undefined || descriptor.set !== undefined) invalid();
  for (const child of Object.values(value)) publicJson(child, seen, depth + 1);
  seen.delete(value);
}
const INPUT_KEYS = [
  "target",
  "observation",
  "sourceId",
  "activationSourceId",
  "binding",
  "input",
  "retainedEvidenceDigest",
  "phase",
];
function inputValid(value: unknown): asserts value is RecordInput {
  if (!exact(value, INPUT_KEYS)) invalid();
  targetValid(value.target);
  const observation = value.observation,
    binding = value.binding;
  if (
    !exact(observation, ["inspectionId", "revision", "ownerGeneration", "originalsDigest"]) ||
    !hash(observation.inspectionId) ||
    !hash(observation.originalsDigest) ||
    !(observation.revision === null || positive(observation.revision)) ||
    !(observation.ownerGeneration === null || positive(observation.ownerGeneration)) ||
    (observation.revision === null) !== (observation.ownerGeneration === null) ||
    !sourceIdentifier(value.sourceId) ||
    !sourceIdentifier(value.activationSourceId) ||
    !hash(value.retainedEvidenceDigest) ||
    !PHASES.includes(value.phase as BackupRepairPhase) ||
    !exact(binding, ["module", "action", "eventId", "sourceId", "targetNodeId"]) ||
    !Object.values(binding).every(
      (part) => typeof part === "string" && part.length > 0 && part.length <= 256,
    ) ||
    binding.sourceId !== value.activationSourceId ||
    !isUuid(String(binding.eventId)) ||
    !isUuid(String(binding.targetNodeId))
  )
    invalid();
  publicJson(value.input);
  if (Buffer.byteLength(JSON.stringify(value)) > LIMIT) invalid();
  if (!["prepared", "abandoned"].includes(value.phase as string) && value.input === null) invalid();
}
function recordInput(record: BackupRepairRecord): RecordInput {
  return Object.fromEntries(
    INPUT_KEYS.map((key) => [key, record[key as keyof BackupRepairRecord]]),
  ) as unknown as RecordInput;
}
function recordValid(value: unknown): asserts value is BackupRepairRecord {
  if (!exact(value, [...INPUT_KEYS, "version", "sequence", "previousRecordDigest", "recordedAt"]))
    invalid();
  inputValid(Object.fromEntries(INPUT_KEYS.map((key) => [key, value[key]])));
  if (
    value.version !== 2 ||
    !positive(value.sequence) ||
    value.sequence > 128 ||
    !(value.previousRecordDigest === null || hash(value.previousRecordDigest)) ||
    typeof value.recordedAt !== "string" ||
    !Number.isFinite(Date.parse(value.recordedAt)) ||
    new Date(value.recordedAt).toISOString() !== value.recordedAt
  )
    invalid();
}
function transition(previous: BackupRepairRecord | undefined, next: RecordInput): void {
  if (previous === undefined) {
    if (next.phase !== "prepared") conflict();
    return;
  }
  const old = recordInput(previous);
  if (!isDeepStrictEqual({ ...old, phase: next.phase, input: next.input }, next)) conflict();
  if (next.phase === "abandoned") {
    if (!ABANDONABLE.includes(previous.phase) || !isDeepStrictEqual(previous.input, next.input))
      conflict();
    return;
  }
  if (previous.phase === "abandoned") conflict();
  const before = PHASES.indexOf(previous.phase),
    after = PHASES.indexOf(next.phase);
  if (after !== before + 1 && !(before === 0 && after === 0)) conflict();
  if (before > 0 && !isDeepStrictEqual(previous.input, next.input)) conflict();
}
async function read(path: string): Promise<unknown> {
  await firstSetupDirectory(dirname(path));
  return readDurableHostJson(path, LIMIT);
}
async function immutable(path: string, value: unknown): Promise<void> {
  const old = await read(path);
  if (old !== null) {
    if (!isDeepStrictEqual(old, value)) conflict();
    await firstSetupDirectory(dirname(path), true);
    return;
  }
  await firstSetupDirectory(dirname(path), true);
  await writeDurableHostJson(path, value, LIMIT);
}
function currentPaths(anchor: FirstSetupRoots) {
  return [...new Set(Object.values(anchor).map((root) => join(root, NAMESPACE, "current.json")))];
}
function backlinkPaths(target: BackupRepairTarget) {
  return Object.values(target.target).map((root) => join(root, NAMESPACE, "backlink.json"));
}
function folder(target: BackupRepairTarget) {
  return join(target.anchor.stateDir, NAMESPACE, target.recoveryId);
}
async function witness(anchor: FirstSetupRoots): Promise<Witness | null> {
  const values = await Promise.all(currentPaths(anchor).map(read));
  const found = values.filter((value) => value !== null);
  if (found.length === 0) {
    for (const root of new Set(Object.values(anchor))) {
      try {
        await lstat(join(root, NAMESPACE));
        uncertain();
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    return null;
  }
  const first = found[0];
  if (
    !exact(first, ["version", "target", "initialRecordDigest", "initialRecord"]) ||
    first.version !== 2 ||
    !hash(first.initialRecordDigest)
  )
    uncertain();
  targetValid(first.target);
  recordValid(first.initialRecord);
  if (
    digest(first.initialRecord) !== first.initialRecordDigest ||
    !isDeepStrictEqual(first.initialRecord.target, first.target) ||
    first.initialRecord.sequence !== 1 ||
    first.initialRecord.phase !== "prepared"
  )
    uncertain();
  if (
    !isDeepStrictEqual(first.target.anchor, anchor) ||
    found.some((value) => !isDeepStrictEqual(value, first))
  )
    uncertain();
  return first as unknown as Witness;
}
async function originals(
  anchor: FirstSetupRoots,
  source: FirstSetupRoots,
  id: string,
): Promise<Original[]> {
  const entries = new Map<string, Original>();
  const output = join(anchor.stateDir, NAMESPACE, id);
  const containers = new Set(
    Object.values(anchor).flatMap((root) => [
      join(root, "first-setup-resolutions"),
      join(root, NAMESPACE),
    ]),
  );
  const pointers = new Set(currentPaths(anchor));
  const recoveries = join(anchor.stateDir, NAMESPACE);
  const spareFiles = new Set(
    [SPARE_SPACE_FILE, SPARE_SPACE_RELEASED_FILE].map((name) => join(anchor.stateDir, name)),
  );
  const leftOut = (path: string) =>
    spareFiles.has(path) ||
    (dirname(path) === anchor.stateDir && isBackupRoomFileName(basename(path)));
  const rootsToRead = [...new Set([...Object.values(anchor), ...Object.values(source)])].sort();
  async function walk(path: string, isRoot = false): Promise<void> {
    if (path === output || pointers.has(path)) return;
    // A discarded recovery is not one of the box's originals, and emptying it changes its folder.
    if (dirname(path) === recoveries && (await abandonedJournal(anchor, basename(path)))) return;
    // Lock journals and holder heartbeats carry no setup or recovery authority.
    if (
      rootsToRead.some(
        (root) =>
          path === join(root, "venue.holder.json") ||
          path === join(root, "venue.holder.json.partial") ||
          path === join(root, "venue.lock-journal"),
      )
    )
      return;
    // Moved files are never a recovery's input, and the box may be unable to read one.
    if (rootsToRead.some((root) => path === join(root, START_AGAIN_SET_ASIDE_DIR))) return;
    if (entries.has(path)) return;
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if (missing(error) && (isRoot || leftOut(path))) return;
      throw error;
    }
    // The spare file, its marker and the backup room's files come and go; they hold no venue data.
    if (leftOut(path) && !isRoot && info.isFile()) return;
    if (info.isSymbolicLink()) invalid();
    if (info.isDirectory()) {
      if (!isRoot && !containers.has(path))
        entries.set(path, { path, kind: "directory", size: 0, digest: null });
      for (const name of (await readdir(path)).sort()) await walk(join(path, name));
      return;
    }
    if (!info.isFile()) invalid();
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat();
      if (!before.isFile() || before.ino !== info.ino || before.dev !== info.dev) conflict();
      const hasher = createHash("sha256"),
        buffer = Buffer.alloc(65536);
      let size = 0;
      for (;;) {
        const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        hasher.update(buffer.subarray(0, bytesRead));
        size += bytesRead;
      }
      const after = await file.stat(),
        now = await lstat(path);
      if (
        size !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs ||
        now.ino !== before.ino ||
        now.dev !== before.dev ||
        now.isSymbolicLink()
      )
        conflict();
      entries.set(path, { path, kind: "file", size, digest: hasher.digest("hex") });
    } finally {
      await file.close();
    }
  }
  for (const root of rootsToRead) {
    await firstSetupDirectory(root);
    await walk(root, true);
  }
  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path, "en"));
}
async function abandonedJournal(anchor: FirstSetupRoots, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  try {
    const path = join(anchor.stateDir, NAMESPACE, id);
    const names = (await readdir(path)).filter((name) => /^\d+\.json$/.test(name)).sort();
    let previous: BackupRepairRecord | undefined;
    for (const [index, name] of names.entries()) {
      const record = await read(join(path, name));
      recordValid(record);
      if (
        name !== `${String(index + 1).padStart(6, "0")}.json` ||
        record.sequence !== index + 1 ||
        record.previousRecordDigest !== (previous === undefined ? null : digest(previous)) ||
        record.target.recoveryId !== id ||
        !isDeepStrictEqual(record.target.anchor, anchor)
      )
        return false;
      transition(previous, recordInput(record));
      previous = record;
    }
    return previous?.phase === "abandoned";
  } catch {
    return false;
  }
}
async function stableOriginals(anchor: FirstSetupRoots, source: FirstSetupRoots, id: string) {
  const first = await originals(anchor, source, id),
    second = await originals(anchor, source, id);
  if (!isDeepStrictEqual(first, second)) conflict();
  return second;
}
function archived(original: Original): boolean {
  return (
    original.kind === "file" &&
    !["venue.db", "venue.db-wal", "venue.db-shm", "venue.lock"].includes(basename(original.path)) &&
    !original.path.split("/").includes(".venue.db-litestream")
  );
}
async function fingerprint(path: string): Promise<{ size: number; digest: string }> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await file.stat()).isFile()) invalid();
    const hasher = createHash("sha256"),
      buffer = Buffer.alloc(65536);
    let size = 0;
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      size += bytesRead;
      hasher.update(buffer.subarray(0, bytesRead));
    }
    return { size, digest: hasher.digest("hex") };
  } finally {
    await file.close();
  }
}
async function archiveControls(base: string, entries: Original[]): Promise<void> {
  const directory = join(base, "evidence");
  await firstSetupDirectory(directory, true);
  for (const [index, original] of entries.entries()) {
    if (!archived(original)) continue;
    const path = join(directory, `${index}.bin`);
    try {
      if (
        !isDeepStrictEqual(await fingerprint(path), {
          size: original.size,
          digest: original.digest,
        })
      )
        conflict();
      await firstSetupDirectory(directory, true);
      continue;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const temporary = join(directory, `.first-setup-${randomUUID()}.tmp`);
    try {
      const source = await open(
        original.path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        if (!(await source.stat()).isFile()) invalid();
        const destination = await open(
          temporary,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          const buffer = Buffer.alloc(65536);
          for (;;) {
            const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
            if (bytesRead === 0) break;
            await destination.writeFile(buffer.subarray(0, bytesRead));
          }
          await destination.sync();
        } finally {
          await destination.close();
        }
      } finally {
        await source.close();
      }
      if (
        !isDeepStrictEqual(await fingerprint(temporary), {
          size: original.size,
          digest: original.digest,
        })
      )
        conflict();
      await rename(temporary, path);
      await firstSetupDirectory(directory, true);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}
async function checkedRecords(
  anchor: FirstSetupRoots,
  selection: Witness,
  chainOnly = false,
): Promise<BackupRepairRecord[]> {
  const path = folder(selection.target);
  await firstSetupDirectory(path);
  const names = (await readdir(path)).filter((name) => /^\d+\.json$/.test(name)).sort();
  if (names.length === 0 || names.length > 128) uncertain();
  const records: BackupRepairRecord[] = [];
  for (const [index, name] of names.entries()) {
    if (name !== `${String(index + 1).padStart(6, "0")}.json`) uncertain();
    const record = await read(join(path, name));
    recordValid(record);
    const previous = records.at(-1);
    if (
      record.sequence !== index + 1 ||
      record.previousRecordDigest !== (previous === undefined ? null : digest(previous)) ||
      !isDeepStrictEqual(record.target, selection.target)
    )
      uncertain();
    transition(previous, recordInput(record));
    records.push(record);
  }
  if (digest(records[0]) !== selection.initialRecordDigest) uncertain();
  // An abandoned recovery is a tombstone; the attempt it was taken against may be deleted.
  // Abandoning checks only the chain too: Start again writes its confirmation
  // into the box's state folder before it abandons.
  if (chainOnly || records.at(-1)!.phase === "abandoned") return records;
  const manifest = await read(join(path, "originals.json"));
  if (
    !exact(manifest, ["version", "entries"]) ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.entries) ||
    digest(manifest.entries) !== records[0]!.observation.originalsDigest
  )
    uncertain();
  for (const [index, original] of (manifest.entries as Original[]).entries()) {
    if (
      archived(original) &&
      !isDeepStrictEqual(await fingerprint(join(path, "evidence", `${index}.bin`)), {
        size: original.size,
        digest: original.digest,
      })
    )
      uncertain();
  }
  if (
    !isDeepStrictEqual(
      manifest.entries,
      await stableOriginals(anchor, selection.target.source, selection.target.recoveryId),
    )
  )
    conflict();
  if (!isDeepStrictEqual(anchor, selection.target.source)) conflict();
  return records;
}
const coordinators = new Map<string, ReturnType<typeof createFirstSetupCoordinator>>();
export function createFirstSetupBackupWorkspace(anchorInput: FirstSetupRoots) {
  const key = JSON.stringify(anchorInput);
  let coordinator = coordinators.get(key);
  if (coordinator === undefined) {
    coordinator = createFirstSetupCoordinator();
    coordinators.set(key, coordinator);
  }
  const turn = coordinator;
  async function inspect(id: string): Promise<string> {
    if (!isUuid(id)) invalid();
    const anchor = await canonical(anchorInput);
    return digest(await stableOriginals(anchor, anchor, id));
  }
  async function readRecords(chainOnly = false): Promise<BackupRepairRecord[]> {
    const anchor = await canonical(anchorInput),
      selected = await witness(anchor);
    return selected === null ? [] : checkedRecords(anchor, selected, chainOnly);
  }
  async function append(input: RecordInput, selecting = false): Promise<BackupRepairRecord> {
    inputValid(input);
    if (input.phase === "selected" && !selecting) conflict();
    if (input.phase === "abandoned") conflict();
    const anchor = await canonical(anchorInput);
    if (
      !isDeepStrictEqual(anchor, input.target.anchor) ||
      !isDeepStrictEqual(await canonical(input.target.source), input.target.source) ||
      !isDeepStrictEqual(anchor, input.target.source)
    )
      conflict();
    let selected: Witness | null;
    try {
      selected = await witness(anchor);
    } catch (error) {
      const values = await Promise.all(currentPaths(anchor).map(read));
      if (values.some((value) => value !== null)) throw error;
      selected = null;
    }
    let replacing = false;
    if (selected !== null && !isDeepStrictEqual(selected.target, input.target)) {
      if (
        input.phase !== "prepared" ||
        (await checkedRecords(anchor, selected, true)).at(-1)!.phase !== "abandoned"
      )
        conflict();
      // Start again finishes the emptying; once the pointers move, nothing could reach it.
      if (!(await isEmptiedTombstone(anchor, selected.target.recoveryId)))
        throw new AppError("setup.start_again_incomplete", {});
      selected = null;
      replacing = true;
    }
    const path = folder(input.target);
    let previous: BackupRepairRecord | undefined;
    if (selected !== null) {
      try {
        previous = (await checkedRecords(anchor, selected)).at(-1);
      } catch (error) {
        const names = await readdir(path).catch((readError: unknown) => {
          if (missing(readError)) return [];
          throw readError;
        });
        if (
          (await read(join(path, "000001.json"))) !== null ||
          names.some((name) => /^\d+\.json$/.test(name))
        )
          throw error;
      }
    }
    if (previous !== undefined && isDeepStrictEqual(recordInput(previous), input)) {
      for (const pointer of currentPaths(anchor)) await immutable(pointer, selected);
      await immutable(join(path, `${String(previous.sequence).padStart(6, "0")}.json`), previous);
      for (const backlink of backlinkPaths(input.target)) await immutable(backlink, selected);
      return previous;
    }
    transition(previous, input);
    if (selected === null) {
      for (const directory of Object.values(input.target.target)) {
        await firstSetupDirectory(directory);
        try {
          if ((await readdir(directory)).length !== 0) conflict();
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
    }
    const entries = await stableOriginals(anchor, input.target.source, input.target.recoveryId);
    if (digest(entries) !== input.observation.originalsDigest) conflict();
    let record: BackupRepairRecord = {
      ...structuredClone(input),
      version: 2,
      sequence: (previous?.sequence ?? 0) + 1,
      previousRecordDigest: previous === undefined ? null : digest(previous),
      recordedAt: new Date().toISOString(),
    };
    recordValid(record);
    if (previous === undefined && selected !== null) {
      if (!isDeepStrictEqual(recordInput(selected.initialRecord), input)) conflict();
      record = selected.initialRecord;
    }
    selected ??= {
      version: 2,
      target: input.target,
      initialRecordDigest: digest(record),
      initialRecord: record,
    };
    if (replacing) {
      // A discarded recovery's pointer gives way to the next one; its records stay as a tombstone.
      // The state folder's goes first: the venue folder's is already gone, so a cut leaves one.
      for (const pointer of currentPaths(anchor).reverse()) {
        await firstSetupDirectory(dirname(pointer), true);
        await writeDurableHostJson(pointer, selected, LIMIT);
      }
    } else for (const pointer of currentPaths(anchor)) await immutable(pointer, selected);
    await archiveControls(path, entries);
    await immutable(join(path, "originals.json"), { version: 1, entries });
    await immutable(join(path, `${String(record.sequence).padStart(6, "0")}.json`), record);
    for (const directory of Object.values(input.target.target))
      await firstSetupDirectory(directory, true);
    for (const backlink of backlinkPaths(input.target)) await immutable(backlink, selected);
    return record;
  }
  return {
    inspect,
    read: () => readRecords(),
    // The recovery's own records, as abandon reads them: the attempt it was taken against may
    // have changed since.
    readChain: () => readRecords(true),
    // The authenticated host holds anchor/source exclusion before entering this independent turn.
    append: async (input: RecordInput) => {
      inputValid(input);
      const copy = structuredClone(input);
      return turn.run(() => append(copy)).catch(writeFailure);
    },
    select: (restored: BackupRepairRecord) =>
      turn
        .run(async () => {
          recordValid(restored);
          const records = await readRecords(),
            last = records.at(-1);
          if (
            restored.phase !== "restored" ||
            !isDeepStrictEqual(records[restored.sequence - 1], restored) ||
            last === undefined ||
            !["restored", "selected"].includes(last.phase)
          )
            conflict();
          await append({ ...recordInput(restored), phase: "selected" }, true);
          return structuredClone(restored.target);
        })
        .catch(writeFailure),
    abandon: (id: string) =>
      turn
        .run(async () => {
          const anchor = await canonical(anchorInput),
            selected = await witness(anchor);
          if (selected === null) conflict();
          const last = (await checkedRecords(anchor, selected, true)).at(-1)!;
          if (last.target.recoveryId !== id) conflict();
          if (last.phase === "abandoned") return last;
          const input: RecordInput = { ...recordInput(last), phase: "abandoned" };
          if (!isDeepStrictEqual(anchor, input.target.source)) conflict();
          transition(last, input);
          const record: BackupRepairRecord = {
            ...structuredClone(input),
            version: 2,
            sequence: last.sequence + 1,
            previousRecordDigest: digest(last),
            recordedAt: new Date().toISOString(),
          };
          recordValid(record);
          const name = `${String(record.sequence).padStart(6, "0")}.json`;
          await immutable(join(folder(input.target), name), record);
          return record;
        })
        .catch(writeFailure),
  };
}
export function insideBackupRepairTarget(dir: string): boolean {
  return (
    basename(dirname(dir)) === "target" &&
    basename(dirname(dirname(dirname(dir)))) === "backup-recovery"
  );
}
export async function resolveFirstSetupBackupWorkspace(
  anchorInput: FirstSetupRoots,
): Promise<{ kind: "absent" } | { kind: "repair" | "selected"; target: BackupRepairTarget }> {
  try {
    let anchor = await canonical(anchorInput);
    const backlinks = await Promise.all(
      Object.values(anchor).map((root) => read(join(root, NAMESPACE, "backlink.json"))),
    );
    if (backlinks.some((value) => value !== null)) {
      const backlink = backlinks[0];
      if (
        !exact(backlink, ["version", "target", "initialRecordDigest", "initialRecord"]) ||
        backlink.version !== 2
      )
        uncertain();
      targetValid(backlink.target);
      if (
        !isDeepStrictEqual(backlink.target.target, anchor) ||
        !backlinks.every((value) => isDeepStrictEqual(value, backlink))
      )
        uncertain();
      anchor = backlink.target.anchor;
      if (!isDeepStrictEqual(await witness(anchor), backlink)) uncertain();
    }
    const selected = await witness(anchor);
    if (selected === null) return { kind: "absent" };
    const records = await checkedRecords(anchor, selected),
      last = records.at(-1)!;
    if (last.phase === "abandoned") return { kind: "absent" };
    let paired = true;
    for (const path of [...currentPaths(anchor), ...backlinkPaths(selected.target)])
      paired &&= isDeepStrictEqual(await read(path), selected);
    return {
      kind: paired && last.phase === "selected" ? "selected" : "repair",
      target: selected.target,
    };
  } catch {
    uncertain();
  }
}
export async function assertFirstSetupBackupBootTarget(input: FirstSetupRoots): Promise<void> {
  try {
    const target = await canonical(input),
      backlinks = await Promise.all(
        Object.values(target).map((root) => read(join(root, NAMESPACE, "backlink.json"))),
      );
    if (backlinks.every((value) => value === null)) {
      const location = await resolveFirstSetupBackupWorkspace(target);
      if (location.kind !== "absent" || Object.values(target).some(insideBackupRepairTarget))
        uncertain();
      return;
    }
    const backlink = backlinks[0];
    if (
      !exact(backlink, ["version", "target", "initialRecordDigest", "initialRecord"]) ||
      backlink.version !== 2 ||
      !hash(backlink.initialRecordDigest)
    )
      uncertain();
    targetValid(backlink.target);
    if (
      !backlinks.every((value) => isDeepStrictEqual(value, backlink)) ||
      !isDeepStrictEqual(backlink.target.target, target)
    )
      uncertain();
    const resolved = await resolveFirstSetupBackupWorkspace(backlink.target.anchor);
    if (resolved.kind !== "selected" || !isDeepStrictEqual(resolved.target, backlink.target))
      uncertain();
  } catch {
    uncertain();
  }
}
