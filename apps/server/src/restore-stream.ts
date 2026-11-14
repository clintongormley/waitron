import { tableExists } from "@waitron/db";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { loadKeyRing } from "@waitron/credentials";
import { openVenueDatabase, readVenue, tenants, type VenueDatabase } from "@waitron/db";
import { manifestSets } from "@waitron/migrations";
import { assertNotAhead } from "@waitron/provisioning";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import { SCRATCH_DIR, VENUE_FILE } from "@waitron/store";
import {
  PROBE_PREFIX,
  bucketClockOffset,
  createS3ObjectStore,
  newestUpload,
  readPointer,
  restoreGeneration,
  verifyPointer,
  type BucketConfig,
  type ObjectStore,
  type RecoveryKit,
} from "@waitron/stream";
import type { ArchiveEntry } from "./backup-archive.js";
import { parseEnvFile } from "./env-file.js";
import { isCopyIntact } from "./handover-integrity.js";
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
import { readSealedStateRow, unsealNodeState } from "./sealed-state.js";
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

export interface PrepareStreamDeps {
  kit: RecoveryKit;
  stateDir: string;
  migrationsRoot: string | null;
  litestreamBin: string;
  /** The operator confirmed the old box is gone; skips only the liveness refusal. */
  oldBoxGone: boolean;
  now: () => Date;
  log: Logger;
  openStore?: (bucket: BucketConfig) => ObjectStore;
  restoreGeneration?: typeof restoreGeneration;
  checkIntegrity?: (databasePath: string) => Promise<boolean>;
}

export interface PreparedStream {
  /** The restored `venue.db`, inside the scratch folder. */
  databasePath: string;
  /** The unlocked row's entries: an archive's entries without `db.dump`. */
  entries: ArchiveEntry[];
  nodeId: string;
  generation: string;
  venue: RestoredVenue;
  /** Removes this preparation's scratch folder. */
  discard(): Promise<void>;
}

/**
 * Whether the copy at `databasePath` passes SQLite's integrity and foreign-key checks, run on a
 * thread of its own so the main thread's timers, and with them the venue watchdog, keep turning.
 * A copy whose rows name a missing parent is refused like any other damage.
 */
export function checkIntegrity(databasePath: string): Promise<boolean> {
  return isCopyIntact(databasePath);
}

function integrityFailed(log: Logger): never {
  log("warn", "restore.stream_integrity_failed", {});
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
  // Every level, not only the two the supervisor reads: compaction to higher levels and the daily
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
    if (isAppError(error) && hasCode(error, "server.credential_unusable")) {
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
  const [tenant] = await store.venue
    .select({ legalName: tenants.legalName, taxId: tenants.taxId })
    .from(tenants)
    .where(eq(tenants.id, 1));
  if (tenant === undefined) throw new AppError("restore.identity_unknown", { nodeId });
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
    legalName: tenant.legalName,
    taxId: tenant.taxId,
    venueName: venue.name,
  };
}

/** From the restored copy alone: refuse a damaged file, then a schema ahead of this
 * software, then read the node's locked row and whose copy it is. */
async function readRestoredCopy(args: {
  directory: string;
  nodeId: string;
  migrationsRoot: string | null;
  checkIntegrity: (databasePath: string) => Promise<boolean>;
  log: Logger;
}): Promise<{ sealed: Uint8Array; venue: RestoredVenue }> {
  const { nodeId } = args;
  if (!(await args.checkIntegrity(join(args.directory, VENUE_FILE)))) integrityFailed(args.log);
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

async function readVerifiedPointer(store: ObjectStore, kit: RecoveryKit) {
  let read;
  try {
    read = await readPointer(store, kit.streamId);
  } catch (error) {
    if (
      isAppError(error) &&
      hasCode(error, "backup.stream_pointer_invalid") &&
      error.params.reason === "other_venue"
    ) {
      throw new AppError("restore.stream_pointer_unverified", { reason: "venue_mismatch" });
    }
    throw error;
  }
  if (read === null) throw new AppError("restore.stream_pointer_missing", {});
  // The kit's key, never one found in the bucket.
  if (!verifyPointer(read.pointer, kit.pointerSignerPublicKey)) {
    throw new AppError("restore.stream_pointer_unverified", { reason: "signature" });
  }
  return read.pointer.body;
}

/**
 * Everything a bucket rebuild decides before it changes the venue folder, the box's identity or its
 * secrets: the pointer, verified with the kit's key; the old-box check; the download into a scratch
 * folder; its integrity and schema; the node's locked row, unlocked with the kit's recovery key; and
 * whose copy it is. The scratch folder is removed on every failure.
 */
export async function prepareStreamRestore(deps: PrepareStreamDeps): Promise<PreparedStream> {
  const { kit } = deps;
  const store = (deps.openStore ?? createS3ObjectStore)(kit.bucket);
  const { generation, nodeId } = await readVerifiedPointer(store, kit);
  await refuseIfSourceLive({
    store,
    streamId: kit.streamId,
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
        bucket: kit.bucket,
        streamKey: deriveStreamKey(kit.recoveryKey, kit.streamId),
        streamId: kit.streamId,
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
      checkIntegrity: deps.checkIntegrity ?? checkIntegrity,
      log: deps.log,
    });
    const entries = unsealNodeState(sealed, kit.recoveryKey);
    // A sealed state with no node copy is refused when its entries are validated.
    await writeStagedNodeCopy(
      databasePath,
      entries.find((entry) => entry.name === "node.dump")?.bytes,
    );
    deps.log("info", "restore.stream_prepared", { generation });
    return { databasePath, entries, nodeId, generation, venue, discard };
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
        : (copy) =>
            prepareModuleOperations(copy, `stream:${deps.kit.streamId}:${prepared.generation}`),
    );
  } finally {
    await prepared.discard();
  }
}
