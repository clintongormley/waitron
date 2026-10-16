import { AppError, isUuid } from "@waitron/shared";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, chmod, realpath, open, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readDurableHostJson, writeDurableHostJson } from "./durable-host-json.js";
import type { FirstSetupCoordinator } from "./first-setup-state.js";
import "./errors.js";

export type RegisterAnswer =
  | {
      kind: "current-master";
      status: "Consumed" | "Not consumed" | "Unknown";
      custodian: string;
      reference: string;
      consultedAt: string;
    }
  | { kind: "no-current-master"; confirmed: true };
export interface WorkspaceBinding {
  workspaceId: string;
  anchorVenueDir: string;
  anchorStateDir: string;
  venueDir: string;
  stateDir: string;
  resolutionId: string;
  selectionGeneration: number;
}
interface ResolutionMetadata {
  version: 1;
  resolutionId: string;
  sequence: number;
  previousRecordDigest: string | null;
  attemptId: string | null;
  observedRevision: number | null;
  observedOwnerGeneration: number | null;
  evidenceDigest: string;
  evidenceReferences: string[];
  database: "empty-preactivation" | "missing" | "committed-exact" | "unknown-or-nonempty";
  authority: "original-password" | "local-empty-no-custodian";
  phase: "prepared" | "applied";
  nextWorkspace: WorkspaceBinding | null;
  recordedAt: string;
}
export type ResolutionRecord = ResolutionMetadata &
  (
    | { action: "marker-repair" | "ownership-rebind"; register: RegisterAnswer | null }
    | { action: "retire" | "select-workspace" | "finish-publication"; register: RegisterAnswer }
  );
export interface FirstSetupOriginal {
  name: string;
  bytes: Uint8Array | null;
}
type InputFor<Record> = Omit<
  Record,
  | "version"
  | "sequence"
  | "previousRecordDigest"
  | "evidenceDigest"
  | "evidenceReferences"
  | "phase"
  | "recordedAt"
>;
export type ResolutionInput = ResolutionRecord extends infer Record
  ? Record extends ResolutionRecord
    ? InputFor<Record>
    : never
  : never;
const LIMIT = 65536;
const HASH = /^[a-f0-9]{64}$/;
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
function invalid(): never {
  throw new AppError("setup.attempt_invalid", {});
}
function conflict(): never {
  throw new AppError("setup.attempt_conflict", {});
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return (
    object(value) &&
    Object.keys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name))
  );
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && isUuid(value);
}
function digest(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}
export async function canonicalFirstSetupDirectory(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    const info = await lstat(absolute);
    if (!info.isDirectory() || info.isSymbolicLink()) invalid();
    return await realpath(absolute);
  } catch (error) {
    if (!(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ))
      throw error;
    return join(await canonicalFirstSetupDirectory(dirname(absolute)), basename(absolute));
  }
}
export async function firstSetupDirectory(path: string, create = false): Promise<void> {
  if (resolve(path) !== path) invalid();
  const parent = dirname(path);
  if (parent !== path) await firstSetupDirectory(parent);
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) invalid();
  } catch (error) {
    if (!(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ))
      throw error;
    if (!create) return;
    if (parent !== path) await firstSetupDirectory(parent, true);
    await mkdir(path, { mode: 0o700 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) invalid();
    await chmod(path, 0o700);
  }
  if (create) {
    for (const folder of new Set([path, parent])) {
      const handle = await open(
        folder,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
  }
}
export function validateWorkspaceBinding(value: unknown): asserts value is WorkspaceBinding {
  if (
    !exact(value, [
      "workspaceId",
      "anchorVenueDir",
      "anchorStateDir",
      "venueDir",
      "stateDir",
      "resolutionId",
      "selectionGeneration",
    ]) ||
    !uuid(value.workspaceId) ||
    !uuid(value.resolutionId) ||
    !integer(value.selectionGeneration) ||
    ![value.anchorVenueDir, value.anchorStateDir, value.venueDir, value.stateDir].every(
      (path) => typeof path === "string" && resolve(path) === path,
    )
  )
    invalid();
  const base = join(
    String(value.anchorStateDir),
    "first-setup-workspaces",
    String(value.workspaceId),
  );
  if (value.venueDir !== join(base, "venue") || value.stateDir !== join(base, "state")) invalid();
}
const INPUT_KEYS = [
  "resolutionId",
  "attemptId",
  "observedRevision",
  "observedOwnerGeneration",
  "database",
  "authority",
  "register",
  "action",
  "nextWorkspace",
];
function validateInput(value: unknown): asserts value is ResolutionInput {
  if (
    !exact(value, INPUT_KEYS) ||
    !uuid(value.resolutionId) ||
    !(value.attemptId === null || uuid(value.attemptId)) ||
    !(value.observedRevision === null || integer(value.observedRevision)) ||
    !(value.observedOwnerGeneration === null || integer(value.observedOwnerGeneration)) ||
    (value.attemptId === null) !== (value.observedRevision === null) ||
    (value.observedRevision === null) !== (value.observedOwnerGeneration === null) ||
    !["empty-preactivation", "missing", "committed-exact", "unknown-or-nonempty"].includes(
      String(value.database),
    ) ||
    !["original-password", "local-empty-no-custodian"].includes(String(value.authority)) ||
    ![
      "marker-repair",
      "ownership-rebind",
      "retire",
      "select-workspace",
      "finish-publication",
    ].includes(String(value.action))
  )
    invalid();
  const answer = value.register;
  if (
    answer === null &&
    value.authority === "original-password" &&
    ["marker-repair", "ownership-rebind"].includes(String(value.action))
  ) {
    // These password-authorised actions do not consult the current register.
  } else if (
    exact(answer, ["kind", "confirmed"]) &&
    answer.kind === "no-current-master" &&
    answer.confirmed === true
  ) {
    // Absence is a separately established fact; this declaration alone grants no authority.
  } else if (
    !exact(answer, ["kind", "status", "custodian", "reference", "consultedAt"]) ||
    answer.kind !== "current-master" ||
    !["Consumed", "Not consumed", "Unknown"].includes(String(answer.status)) ||
    typeof answer.custodian !== "string" ||
    !answer.custodian.trim() ||
    answer.custodian.length > 256 ||
    !digest(answer.reference) ||
    !timestamp(answer.consultedAt)
  )
    invalid();
  if (
    value.authority === "local-empty-no-custodian" &&
    (value.database !== "empty-preactivation" ||
      !object(answer) ||
      answer.kind !== "no-current-master" ||
      !["retire", "select-workspace"].includes(String(value.action)))
  )
    invalid();
  if (value.nextWorkspace !== null) {
    validateWorkspaceBinding(value.nextWorkspace);
    if (value.nextWorkspace.resolutionId !== value.resolutionId) invalid();
  }
}
function validateRecord(value: unknown): asserts value is ResolutionRecord {
  if (
    !exact(value, [
      ...INPUT_KEYS,
      "version",
      "sequence",
      "previousRecordDigest",
      "evidenceDigest",
      "evidenceReferences",
      "phase",
      "recordedAt",
    ])
  )
    invalid();
  validateInput(Object.fromEntries(INPUT_KEYS.map((key) => [key, value[key]])));
  if (
    value.version !== 1 ||
    !integer(value.sequence) ||
    Number(value.sequence) > 128 ||
    !(value.previousRecordDigest === null || digest(value.previousRecordDigest)) ||
    !digest(value.evidenceDigest) ||
    !Array.isArray(value.evidenceReferences) ||
    value.evidenceReferences.length > 1024 ||
    !value.evidenceReferences.every(
      (name) => typeof name === "string" && name.length > 0 && name.length <= 512,
    ) ||
    !["prepared", "applied"].includes(String(value.phase)) ||
    !timestamp(value.recordedAt)
  )
    invalid();
}
interface OriginalManifest {
  name: string;
  size: number | null;
  digest: string | null;
  chunks: string[];
}
interface Manifest {
  version: 1;
  originals: OriginalManifest[];
}
function pack(originals: readonly FirstSetupOriginal[]) {
  if (!Array.isArray(originals) || originals.length === 0 || originals.length > 1024) invalid();
  const names = new Set<string>();
  const chunks = new Map<string, { bytes: string }>();
  let total = 0;
  const manifest: Manifest = {
    version: 1,
    originals: originals.map((original, index) => {
      if (
        !exact(original, ["name", "bytes"]) ||
        typeof original.name !== "string" ||
        !original.name ||
        original.name.length > 512 ||
        names.has(original.name) ||
        !(original.bytes === null || original.bytes instanceof Uint8Array)
      )
        invalid();
      names.add(original.name);
      const bytes = original.bytes;
      if (bytes === null) return { name: original.name, size: null, digest: null, chunks: [] };
      total += bytes.length;
      if (total > 128 * 1024 * 1024) invalid();
      const files: string[] = [];
      for (let offset = 0; offset < bytes.length; offset += 32000) {
        const name = `original-${index}-${files.length}.json`;
        files.push(name);
        chunks.set(name, {
          bytes: Buffer.from(bytes.subarray(offset, offset + 32000)).toString("base64"),
        });
      }
      return { name: original.name, size: bytes.length, digest: hash(bytes), chunks: files };
    }),
  };
  if (Buffer.byteLength(JSON.stringify(manifest)) > LIMIT) invalid();
  return { manifest, chunks };
}
export function createFirstSetupResolutionStore(options: {
  stateDir: string;
  venueDir: string;
  coordinator: FirstSetupCoordinator;
}) {
  const roots = async () => ({
    stateDir: await canonicalFirstSetupDirectory(options.stateDir),
    venueDir: await canonicalFirstSetupDirectory(options.venueDir),
  });
  const folder = async (id: string, create = false) => {
    if (!uuid(id)) invalid();
    const path = join((await roots()).stateDir, "first-setup-resolutions", id);
    try {
      await firstSetupDirectory(path, create);
    } catch {
      invalid();
    }
    return path;
  };
  const immutable = async (path: string, value: unknown) => {
    const old = await readDurableHostJson(path, LIMIT);
    if (old !== null) {
      if (!isDeepStrictEqual(old, value)) conflict();
      return;
    }
    await writeDurableHostJson(path, value, LIMIT);
  };
  const originalsAt = async (path: string) => {
    await firstSetupDirectory(path);
    const manifest = await readDurableHostJson(join(path, "manifest.json"), LIMIT);
    if (
      !exact(manifest, ["version", "originals"]) ||
      manifest.version !== 1 ||
      !Array.isArray(manifest.originals) ||
      manifest.originals.length === 0 ||
      manifest.originals.length > 1024
    )
      invalid();
    const originals: { name: string; bytes: Buffer | null }[] = [];
    for (const [index, entry] of manifest.originals.entries()) {
      if (
        !exact(entry, ["name", "size", "digest", "chunks"]) ||
        typeof entry.name !== "string" ||
        !entry.name ||
        !Array.isArray(entry.chunks)
      )
        invalid();
      if (entry.size === null) {
        if (entry.digest !== null || entry.chunks.length !== 0) invalid();
        originals.push({ name: entry.name, bytes: null });
        continue;
      }
      if (
        !Number.isSafeInteger(entry.size) ||
        Number(entry.size) < 0 ||
        Number(entry.size) > 128 * 1024 * 1024 ||
        !digest(entry.digest) ||
        entry.chunks.length !== Math.ceil(Number(entry.size) / 32000)
      )
        invalid();
      const chunks: Buffer[] = [];
      for (const [part, name] of entry.chunks.entries()) {
        if (name !== `original-${index}-${part}.json`) invalid();
        const chunk = await readDurableHostJson(join(path, name), LIMIT);
        if (
          !exact(chunk, ["bytes"]) ||
          typeof chunk.bytes !== "string" ||
          chunk.bytes.length > 42668
        )
          invalid();
        const bytes = Buffer.from(chunk.bytes, "base64");
        if (bytes.toString("base64") !== chunk.bytes) invalid();
        chunks.push(bytes);
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.length !== entry.size || hash(bytes) !== entry.digest) invalid();
      originals.push({ name: entry.name, bytes });
    }
    const checked = pack(originals).manifest;
    if (!isDeepStrictEqual(manifest, checked)) invalid();
    return { originals, manifest: checked };
  };
  const filename = (sequence: number) => `${String(sequence).padStart(6, "0")}.json`;
  const evidenceFolder = (path: string, sequence: number) =>
    sequence === 1 ? path : join(path, `step-${String(sequence).padStart(6, "0")}`);
  const read = async (id: string): Promise<ResolutionRecord[]> => {
    const path = await folder(id);
    const names = (await readdir(path)).filter((name) => /^\d+\.json$/.test(name)).sort();
    if (names.length > 128) invalid();
    const records: ResolutionRecord[] = [];
    for (const [index, name] of names.entries()) {
      const sequence = index + 1;
      if (name !== filename(sequence)) invalid();
      const record = await readDurableHostJson(join(path, name), LIMIT);
      validateRecord(record);
      const previous = records[index - 1];
      if (
        record.resolutionId !== id ||
        record.sequence !== sequence ||
        record.previousRecordDigest !==
          (previous === undefined ? null : hash(JSON.stringify(previous)))
      )
        invalid();
      if (sequence % 2 === 1) {
        const { manifest } = await originalsAt(evidenceFolder(path, sequence));
        if (
          record.phase !== "prepared" ||
          record.evidenceDigest !== hash(JSON.stringify(manifest)) ||
          !isDeepStrictEqual(
            record.evidenceReferences,
            manifest.originals.map((original) => original.name),
          )
        )
          invalid();
      } else if (
        !isDeepStrictEqual(record, {
          ...previous,
          sequence,
          previousRecordDigest: hash(JSON.stringify(previous)),
          phase: "applied",
          recordedAt: record.recordedAt,
        })
      )
        invalid();
      records.push(record);
    }
    if (
      records.length === 0 &&
      (await readDurableHostJson(join(path, "manifest.json"), LIMIT)) !== null
    )
      invalid();
    return records;
  };
  return {
    read,
    async readOriginals(id: string, sequence = 1) {
      if (!integer(sequence) || sequence > 127 || sequence % 2 !== 1) invalid();
      return (await originalsAt(evidenceFolder(await folder(id), sequence))).originals;
    },
    prepare(input: unknown, originals: readonly FirstSetupOriginal[]): Promise<ResolutionRecord> {
      return options.coordinator.run(async () => {
        validateInput(input);
        const packed = pack(originals),
          path = await folder(input.resolutionId, true);
        const anchor = await roots();
        if (
          input.nextWorkspace !== null &&
          (input.nextWorkspace.anchorVenueDir !== anchor.venueDir ||
            input.nextWorkspace.anchorStateDir !== anchor.stateDir)
        )
          invalid();
        const existing = await readDurableHostJson(join(path, "000001.json"), LIMIT);
        const records = existing === null ? [] : await read(input.resolutionId);
        const last = records[records.length - 1];
        if (last !== undefined) {
          const prepared =
            records[last.phase === "prepared" ? records.length - 1 : records.length - 2]!;
          if (
            isDeepStrictEqual(
              Object.fromEntries(
                INPUT_KEYS.map((key) => [key, prepared[key as keyof ResolutionRecord]]),
              ),
              input,
            ) &&
            prepared.evidenceDigest === hash(JSON.stringify(packed.manifest))
          )
            return prepared;
          if (last.phase === "prepared") conflict();
        }
        const sequence = records.length + 1;
        if (sequence > 127) invalid();
        const evidence = evidenceFolder(path, sequence);
        await firstSetupDirectory(evidence, true);
        for (const [name, bytes] of packed.chunks) await immutable(join(evidence, name), bytes);
        await immutable(join(evidence, "manifest.json"), packed.manifest);
        const record: ResolutionRecord = {
          ...structuredClone(input),
          version: 1,
          sequence,
          previousRecordDigest: last === undefined ? null : hash(JSON.stringify(last)),
          evidenceDigest: hash(JSON.stringify(packed.manifest)),
          evidenceReferences: packed.manifest.originals.map((original) => original.name),
          phase: "prepared",
          recordedAt: new Date().toISOString(),
        };
        await immutable(join(path, filename(sequence)), record);
        return record;
      });
    },
    apply(prepared: ResolutionRecord): Promise<ResolutionRecord> {
      return options.coordinator.run(async () => {
        validateRecord(prepared);
        const records = await read(prepared.resolutionId);
        if (
          prepared.phase !== "prepared" ||
          !isDeepStrictEqual(records[prepared.sequence - 1], prepared)
        )
          conflict();
        const existing = records[prepared.sequence];
        if (existing !== undefined) {
          // A prior rename can be visible after its directory sync failed.
          await folder(prepared.resolutionId, true);
          return existing;
        }
        const record: ResolutionRecord = {
          ...prepared,
          sequence: prepared.sequence + 1,
          previousRecordDigest: hash(JSON.stringify(prepared)),
          phase: "applied",
          recordedAt: new Date().toISOString(),
        };
        await immutable(
          join(await folder(prepared.resolutionId), filename(record.sequence)),
          record,
        );
        return record;
      });
    },
  };
}
