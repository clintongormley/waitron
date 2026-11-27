import { tableExists } from "@waitron/db";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { backupKey, loadKeyRing, masterKeyId, sealingPublicKey } from "@waitron/credentials";
import { openVenueDatabase, readVenue, taxpayer, type VenueDatabase } from "@waitron/db";
import { manifestSets } from "@waitron/migrations";
import { assertNotAhead } from "@waitron/provisioning";
import { AppError, decodeMasterKeyCode, hasCode, isAppError } from "@waitron/shared";
import { SCRATCH_DIR, VENUE_FILE } from "@waitron/store";
import {
  PROBE_PREFIX,
  bucketClockOffset,
  createS3FolderStore,
  createS3ObjectStore,
  newestUpload,
  normalisePrefix,
  parseGenerationName,
  readBucketConfig,
  readPointer,
  restoreGeneration,
  verifyPointer,
  type BucketConfig,
  type ObjectStore,
  type S3ObjectStore,
} from "@waitron/stream";
import type { ArchiveEntry } from "./backup-archive.js";
import { parseEnvFile } from "./env-file.js";
import { checkCopyIntegrity } from "./handover-integrity.js";
import type { Logger } from "./logger.js";
import {
  openStagedCopy,
  validateDatabaseEntries,
  writeStagedNodeCopy,
  writeValidated,
  type PlacementDeps,
  type RestoreOperationRunner,
  type ValidatedArtifact,
} from "./restore.js";
import { readSealedStateRow, unsealNodeStateAsync } from "./sealed-state.js";
import { STREAM_RESTORE_PREFIX } from "./restore-staging-dirs.js";
import { readStreamSettings } from "./stream-host.js";
import { deriveStreamKey } from "./stream-key.js";
import "./errors.js";

/** A change newer than this, on the bucket's clock, means the old box may still be selling. */
export const LIVE_WINDOW_MS = 10 * 60_000;

/** What the operator must recognise before a restored copy is placed. */
export interface RestoredVenue {
  legalName: string;
  taxId: string;
  venueName: string;
}

/** A copy that names no tax id can never be confirmed, whatever the operator typed. */
export function confirmsVenue(venue: RestoredVenue, confirmedTaxId: string | null | undefined) {
  return venue.taxId !== "" && confirmedTaxId === venue.taxId;
}

/** A fresh folder keeps concurrent preparations from removing each other's copy. */
const SCRATCH = STREAM_RESTORE_PREFIX;

type RecoveryStore = ObjectStore & Partial<Pick<S3ObjectStore, "listFolders">>;

type BucketRecoveryInput = { bucket: BucketConfig; masterKey: string };

export type PrepareStreamDeps = BucketRecoveryInput & {
  stateDir: string;
  migrationsRoot: string | null;
  litestreamBin: string;
  /** The operator confirmed the old box is gone; skips only the liveness refusal. */
  oldBoxGone: boolean;
  now: () => Date;
  log: Logger;
  openStore?: (bucket: BucketConfig) => RecoveryStore;
  restoreGeneration?: typeof restoreGeneration;
  signal?: AbortSignal;
  checkIntegrity?: (databasePath: string, options: { signal?: AbortSignal }) => Promise<boolean>;
};

export interface PreparedStream {
  /** The restored `venue.db`, inside the scratch folder. */
  databasePath: string;
  /** The unlocked row's entries: an archive's entries without `db.dump`. */
  entries: ArchiveEntry[];
  nodeId: string;
  generation: string;
  sourceId: string;
  venue: RestoredVenue;
  /** Removes this preparation's scratch folder. */
  discard(): Promise<void>;
}

/**
 * Whether the copy at `databasePath` passes SQLite's integrity and foreign-key checks, run on a
 * thread of its own so the main thread's timers, and with them the venue watchdog, keep turning.
 * A copy whose rows name a missing parent is refused like any other damage.
 */
export function checkIntegrity(
  databasePath: string,
  options: { signal?: AbortSignal } = {},
): Promise<boolean> {
  return checkCopyIntegrity(databasePath, options);
}

function integrityFailed(log: Logger, reason?: "timeout"): never {
  log("warn", "restore.stream_integrity_failed", reason === undefined ? {} : { reason });
  throw new AppError("restore.stream_integrity_failed", {});
}

/**
 * The bucket's clock minus this box's, in milliseconds, from the `LastModified` of a probe object
 * written and listed back; null when that cannot be done. A probe whose delete is refused is left
 * in the bucket.
 */
export async function measureBucketSkew(
  store: ObjectStore,
  now: () => Date,
): Promise<number | null> {
  const key = `${PROBE_PREFIX}clock-${randomUUID()}`;
  try {
    const started = now().getTime();
    await store.put(key, new Uint8Array([1]), { ifNoneMatch: "*" });
    return await bucketClockOffset(store, key, started, now().getTime());
  } catch {
    return null;
  } finally {
    await store.delete(key).catch(() => {});
  }
}

/**
 * Refuses a generation whose newest object is younger than {@link LIVE_WINDOW_MS} on the bucket's
 * clock, unless the operator confirmed the old box is gone. This box's clock is corrected by the
 * measured difference first; when that cannot be measured, the operator must confirm.
 */
export async function refuseIfSourceLive(args: {
  store: ObjectStore;
  streamId: string;
  generation: string;
  now: () => Date;
  oldBoxGone: boolean;
}): Promise<void> {
  if (args.oldBoxGone) return;
  // Every level, not only the two the supervisor reads: compaction to higher levels and the weekly
  // full copy run on their own schedules, and nothing here has established that a live
  // generation's newest file is always at level 0 or 1.
  const newest = await newestUpload(args.store, args.generation);
  if (newest === null) return;
  const skewMs = await measureBucketSkew(args.store, args.now);
  if (skewMs === null) throw new AppError("restore.stream_source_unchecked", { reason: "clock" });
  if (args.now().getTime() + skewMs - newest.getTime() < LIVE_WINDOW_MS) {
    throw new AppError("restore.stream_source_live", { lastChangeAt: newest.toISOString() });
  }
}

/**
 * An archive whose database holds bucket settings may be a copy of a box still streaming, and
 * selling: its bucket's live generation gets the same check as a bucket rebuild. The settings are
 * read from validation's database file, with the archive's own vault key.
 */
export async function refuseIfArchiveSourceLive(args: {
  validated: ValidatedArtifact;
  stateDir: string;
  oldBoxGone: boolean;
  now: () => Date;
  openStore?: (bucket: BucketConfig) => ObjectStore;
}): Promise<void> {
  if (args.oldBoxGone) return;
  const secrets = args.validated.secretEntries.find(
    (entry) => entry.name === "secrets/secrets.env",
  );
  if (secrets === undefined) return;
  const copy = await openStagedCopy(dirname(args.validated.databasePath));
  let settings;
  try {
    const ring = loadKeyRing(parseEnvFile(Buffer.from(secrets.bytes).toString("utf8")));
    settings = await readStreamSettings(copy.venue, ring);
  } catch (error) {
    if (isAppError(error) && hasCode(error, "credentials.unusable")) {
      throw new AppError("restore.stream_source_unchecked", { reason: "bucket" });
    }
    throw error;
  } finally {
    await copy.close();
  }
  if (settings === null) return;
  const { bucket, streamId } = settings;
  try {
    const store = (args.openStore ?? createS3ObjectStore)(bucket);
    const read = await readPointer(store, streamId);
    if (read === null) return;
    await refuseIfSourceLive({
      store,
      streamId,
      generation: read.pointer.body.generation,
      now: args.now,
      oldBoxGone: false,
    });
  } catch (error) {
    if (
      isAppError(error) &&
      (hasCode(error, "restore.stream_source_live") ||
        hasCode(error, "restore.stream_source_unchecked"))
    ) {
      throw error;
    }
    throw new AppError("restore.stream_source_unchecked", { reason: "bucket" });
  }
}

async function scratchFolder(stateDir: string, prefix: string): Promise<string> {
  const parent = join(stateDir, SCRATCH_DIR);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  return mkdtemp(join(parent, prefix));
}

async function readRestoredVenue(store: VenueDatabase, nodeId: string): Promise<RestoredVenue> {
  const [taxpayerRow] = await store.venue
    .select({ legalName: taxpayer.legalName, taxId: taxpayer.taxId })
    .from(taxpayer)
    .where(eq(taxpayer.id, 1));
  if (taxpayerRow === undefined) throw new AppError("restore.identity_unknown", { nodeId });
  let venue;
  try {
    if (!(await tableExists(store.venue, "settings")))
      throw new AppError("restore.identity_unknown", { nodeId });
    venue = await readVenue(store.venue);
  } catch (error) {
    if (
      isAppError(error) &&
      (hasCode(error, "venue.not_found") ||
        hasCode(error, "provisioning.second_venue") ||
        hasCode(error, "settings.invalid"))
    ) {
      throw new AppError("restore.identity_unknown", { nodeId });
    }
    throw error;
  }
  return {
    legalName: taxpayerRow.legalName,
    taxId: taxpayerRow.taxId,
    venueName: venue.name,
  };
}

/** From the restored copy alone: refuse a damaged file, then a schema ahead of this
 * software, then read the node's locked row and whose copy it is. */
async function readRestoredCopy(args: {
  directory: string;
  nodeId: string;
  migrationsRoot: string | null;
  signal?: AbortSignal;
  checkIntegrity: (databasePath: string, options: { signal?: AbortSignal }) => Promise<boolean>;
  log: Logger;
}): Promise<{ sealed: Uint8Array; venue: RestoredVenue }> {
  const { nodeId } = args;
  try {
    if (!(await args.checkIntegrity(join(args.directory, VENUE_FILE), { signal: args.signal })))
      integrityFailed(args.log);
  } catch (error) {
    args.signal?.throwIfAborted();
    if (
      isAppError(error) &&
      hasCode(error, "handover.copy_check_failed") &&
      error.reason === "timeout"
    )
      integrityFailed(args.log, "timeout");
    throw error;
  }
  let store: VenueDatabase;
  try {
    store = await openVenueDatabase(args.directory);
  } catch {
    integrityFailed(args.log);
  }
  try {
    await assertNotAhead(store, manifestSets(), args.migrationsRoot);
    const sealed = (await tableExists(store.venue, "node_sealed_state"))
      ? await readSealedStateRow(store.venue, nodeId)
      : null;
    if (sealed === null) throw new AppError("restore.stream_state_missing", { nodeId });
    return { sealed, venue: await readRestoredVenue(store, nodeId) };
  } finally {
    await store.close();
  }
}

const DISCOVERY_LIMIT = 24;
const LIST_LIMIT = 2 * DISCOVERY_LIMIT + 1;

function checkedRestoreBucket(bucket: BucketConfig): BucketConfig {
  return readBucketConfig(bucket, (field) => {
    throw new AppError("setup.request_invalid", { field });
  });
}

async function locateBucketCopy(
  bucket: BucketConfig,
  openStore: (bucket: BucketConfig) => RecoveryStore,
  signal?: AbortSignal,
) {
  const call = { signal, requireRecovery: true };
  const store = openStore(bucket);
  const exact = await readPointer(store, undefined, call);
  if (exact !== null) return { bucket, store, pointer: exact.pointer };

  const listed = (await store.listFolders?.("", { signal, limit: LIST_LIMIT })) ?? [];
  const folders = listed.filter(
    (folder) => `${folder}/` !== PROBE_PREFIX && parseGenerationName(folder) === null,
  );
  // A truncated listing cannot establish that a copy is the only one.
  if (listed.length >= LIST_LIMIT || folders.length > DISCOVERY_LIMIT) {
    throw new AppError("restore.stream_folder_required", { folders: [] });
  }
  const copies = [];
  let childRefusal: AppError | undefined;
  for (const folder of folders) {
    try {
      const candidate = checkedRestoreBucket({
        ...bucket,
        prefix: `${normalisePrefix(bucket.prefix)}${folder}`,
      });
      const child = openStore(candidate);
      const read = await readPointer(child, undefined, call);
      if (read !== null) copies.push({ bucket: candidate, store: child, pointer: read.pointer });
    } catch (error) {
      if (signal?.aborted || !isAppError(error)) throw error;
      if (hasCode(error, "setup.request_invalid") && error.params.field === "prefix") continue;
      if (
        !hasCode(error, "backup.stream_pointer_invalid") &&
        !(hasCode(error, "backup.stream_request_failed") && error.params.status === 403)
      )
        throw error;
      childRefusal ??= error;
    }
  }
  if (copies.length > 1) {
    throw new AppError("restore.stream_folder_required", {
      folders: copies.map((copy) => copy.bucket.prefix),
    });
  }
  if (copies[0] === undefined)
    throw childRefusal ?? new AppError("restore.stream_pointer_missing", {});
  return copies[0];
}

async function openBucketCopy(
  input: BucketRecoveryInput,
  openStore: (bucket: BucketConfig) => RecoveryStore,
  signal?: AbortSignal,
) {
  const bucket = checkedRestoreBucket(input.bucket);
  const selected = await locateBucketCopy(bucket, openStore, signal);
  const { pointer } = selected;
  const recovery = pointer.body.recovery!;
  if (!verifyPointer(pointer, recovery.signerPublicKey)) {
    throw new AppError("restore.stream_pointer_unverified", { reason: "signature" });
  }
  const wrongKey = new AppError("promotion.break_glass_invalid", {
    masterKeyId: recovery.masterKeyId,
    keyNumber: recovery.keyNumber,
  });
  let masterKey: Uint8Array;
  try {
    masterKey = decodeMasterKeyCode(input.masterKey);
  } catch (error) {
    if (isAppError(error) && hasCode(error, "master_key.code_invalid")) throw wrongKey;
    throw error;
  }
  if (masterKeyId(sealingPublicKey(masterKey)).toString("hex") !== recovery.masterKeyId)
    throw wrongKey;
  const { endpoint, region, bucket: name, prefix } = selected.bucket;
  const { streamId, generation } = pointer.body;
  const source = createHash("sha256")
    .update(
      JSON.stringify([
        endpoint,
        region,
        name,
        normalisePrefix(prefix),
        recovery.signerPublicKey,
        streamId,
        generation,
      ]),
    )
    .digest("hex");
  return {
    bucket: selected.bucket,
    store: selected.store,
    body: pointer.body,
    recoveryKey: backupKey(masterKey, recovery.keyNumber).toString("base64url"),
    sourceId: `stream:${source}`,
  };
}

/**
 * Verify, download and unlock the selected copy before placement. Each attempt owns its scratch
 * folder so a failed preparation can discard it.
 */
export async function prepareStreamRestore(deps: PrepareStreamDeps): Promise<PreparedStream> {
  const { bucket, store, body, recoveryKey, sourceId } = await openBucketCopy(
    deps,
    deps.openStore ?? createS3FolderStore,
    deps.signal,
  );
  const { streamId, generation, nodeId } = body;
  await refuseIfSourceLive({
    store,
    streamId,
    generation,
    now: deps.now,
    oldBoxGone: deps.oldBoxGone,
  });

  const scratch = await scratchFolder(deps.stateDir, SCRATCH);
  const discard = () => rm(scratch, { recursive: true, force: true });
  const databasePath = join(scratch, VENUE_FILE);
  try {
    try {
      await (deps.restoreGeneration ?? restoreGeneration)({
        litestreamBin: deps.litestreamBin,
        bucket,
        streamKey: deriveStreamKey(recoveryKey, streamId),
        streamId,
        generation,
        outPath: databasePath,
        configDir: join(scratch, "litestream"),
      });
    } catch (error) {
      if (isAppError(error) && hasCode(error, "backup.stream_request_failed")) {
        deps.log("warn", "restore.stream_key_check_failed", {
          errorCode: error.code,
          status: error.params.status,
          failureKind: error.params.name,
        });
        throw new AppError("restore.stream_pointer_unverified", { reason: "key_or_access" });
      }
      if (
        isAppError(error) &&
        hasCode(error, "backup.stream_restore_failed") &&
        error.params.diskFull
      ) {
        throw new AppError("restore.stream_disk_full", {});
      }
      throw error;
    }
    const { sealed, venue } = await readRestoredCopy({
      directory: scratch,
      nodeId,
      migrationsRoot: deps.migrationsRoot,
      signal: deps.signal,
      checkIntegrity: deps.checkIntegrity ?? checkIntegrity,
      log: deps.log,
    });
    const entries = await unsealNodeStateAsync(sealed, recoveryKey);
    // A sealed state with no node copy is refused when its entries are validated.
    await writeStagedNodeCopy(
      databasePath,
      entries.find((entry) => entry.name === "node.dump")?.bytes,
    );
    deps.log("info", "restore.stream_prepared", { generation });
    return { databasePath, entries, nodeId, generation, sourceId, venue, discard };
  } catch (error) {
    await discard();
    throw error;
  }
}

export interface WriteStreamArgs extends PlacementDeps {
  databasePath: string;
  entries: ArchiveEntry[];
}

/** The archive restore's own validation and write, over the restored database and the unlocked
 * row's entries, with the first-start record naming the stream. */
export async function writeStreamRestore(
  args: WriteStreamArgs,
  prepareModuleOperations?: (copy: ValidatedArtifact) => Promise<RestoreOperationRunner>,
): Promise<void> {
  const { databasePath, entries, ...deps } = args;
  const validated = await validateDatabaseEntries(entries, databasePath, deps);
  try {
    const withModuleOperations = await prepareModuleOperations?.(validated);
    await writeValidated(validated, {
      ...deps,
      ...(withModuleOperations === undefined ? {} : { withModuleOperations }),
      rebuildSource: "stream",
    });
  } finally {
    await validated.discard();
  }
}

/**
 * Prepare, show the operator whose copy it is, then write, in one process. The venue folder, the
 * box's identity and its secrets are left unchanged unless `confirmVenue` accepts the restored venue.
 */
export async function restoreFromStream(
  deps: PrepareStreamDeps &
    PlacementDeps & {
      confirmVenue: (venue: RestoredVenue) => boolean;
      prepareModuleOperations?: (
        copy: ValidatedArtifact,
        sourceId: string,
      ) => Promise<RestoreOperationRunner>;
    },
): Promise<void> {
  const prepared = await prepareStreamRestore(deps);
  const prepareModuleOperations = deps.prepareModuleOperations;
  try {
    if (!deps.confirmVenue(prepared.venue)) {
      throw new AppError("restore.stream_venue_unconfirmed", { ...prepared.venue });
    }
    await writeStreamRestore(
      { ...deps, databasePath: prepared.databasePath, entries: prepared.entries },
      prepareModuleOperations === undefined
        ? undefined
        : (copy) => prepareModuleOperations(copy, prepared.sourceId),
    );
  } finally {
    await prepared.discard();
  }
}
