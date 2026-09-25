import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { loadKeyRing } from "@waitron/credentials";
import { locations, openVenueDatabase, tenants, type VenueDatabase } from "@waitron/db";
import { manifestSets } from "@waitron/migrations";
import { assertNotAhead } from "@waitron/provisioning";
import { AppError, hasCode, isAppError } from "@waitron/shared";
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
import type { Logger } from "./logger.js";
import {
  validateEntries,
  writeValidated,
  type PlacementDeps,
  type ValidatedArtifact,
} from "./restore.js";
import { readSealedStateRow, unsealNodeState } from "./sealed-state.js";
import { readStreamSettings } from "./stream-host.js";
import "./errors.js";

/** A change newer than this, on the bucket's clock, means the old box may still be selling. */
export const LIVE_WINDOW_MS = 10 * 60_000;

/** What the operator must recognise before a restored copy is staged. */
export interface RestoredVenue {
  legalName: string;
  taxId: string;
  locationName: string;
}

/**
 * Scratch folders are made fresh per run, inside the state folder so a later move stays on one
 * filesystem; a fixed name would let two runs remove each other's copy.
 */
const SCRATCH = "stream-restore-";
const ARCHIVE_SCRATCH = "archive-source-check-";
const UNREADABLE = "the file could not be opened or read as a database";

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
  checkIntegrity?: (store: VenueDatabase) => Promise<string[]>;
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
 * SQLite's `integrity_check` over an open venue database: `[]` when healthy, else its lines. A
 * failure to read the file is reported as a problem rather than thrown.
 */
export async function checkIntegrity(store: VenueDatabase): Promise<string[]> {
  try {
    const result = await store.venue.execute<Record<string, unknown>>(sql`pragma integrity_check`);
    const lines = result.rows.map((row) => String(Object.values(row)[0]));
    return lines.length === 1 && lines[0] === "ok" ? [] : lines;
  } catch {
    return [UNREADABLE];
  }
}

function integrityFailed(log: Logger, problems: readonly string[]): never {
  log("warn", "restore.stream_integrity_failed", { problems: problems.length });
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
  venueId: string;
  generation: string;
  now: () => Date;
  oldBoxGone: boolean;
}): Promise<void> {
  if (args.oldBoxGone) return;
  // Every level, not only the two the supervisor reads: compaction to higher levels and the daily
  // full copy run on their own schedules (spec §4.4), and nothing here has established that a live
  // generation's newest file is always at level 0 or 1.
  const newest = await newestUpload(args.store, args.venueId, args.generation);
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
 * read from a scratch copy of the archive's database, with the archive's own vault key.
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
  const scratch = await scratchFolder(args.stateDir, ARCHIVE_SCRATCH);
  try {
    await writeFile(join(scratch, "venue.db"), args.validated.dumpEntry.bytes, { mode: 0o600 });
    const copy = await openVenueDatabase(scratch);
    let settings;
    try {
      const ring = loadKeyRing(parseEnvFile(Buffer.from(secrets.bytes).toString("utf8")));
      settings = await readStreamSettings(copy.venue, ring);
    } finally {
      await copy.close();
    }
    if (settings === null) return;
    const { bucket, venueId } = settings;
    try {
      const store = (args.openStore ?? createS3ObjectStore)(bucket);
      const read = await readPointer(store, venueId);
      if (read === null) return;
      await refuseIfSourceLive({
        store,
        venueId,
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
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function scratchFolder(stateDir: string, prefix: string): Promise<string> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  return mkdtemp(join(stateDir, prefix));
}

async function readRestoredVenue(store: VenueDatabase, venueId: string): Promise<RestoredVenue> {
  const [tenant] = await store.venue
    .select({ legalName: tenants.legalName, taxId: tenants.taxId })
    .from(tenants)
    .where(eq(tenants.id, 1));
  const [location] = await store.venue
    .select({ name: locations.name })
    .from(locations)
    .where(eq(locations.id, venueId));
  return {
    legalName: tenant?.legalName ?? "",
    taxId: tenant?.taxId ?? "",
    locationName: location?.name ?? "",
  };
}

/** From the restored copy alone, opened once: refuse a damaged file, then a schema ahead of this
 * software, then read the node's locked row and whose copy it is. */
async function readRestoredCopy(args: {
  directory: string;
  nodeId: string;
  venueId: string;
  migrationsRoot: string | null;
  checkIntegrity: (store: VenueDatabase) => Promise<string[]>;
  log: Logger;
}): Promise<{ sealed: Uint8Array; venue: RestoredVenue }> {
  const { nodeId, venueId } = args;
  let store: VenueDatabase;
  try {
    store = await openVenueDatabase(args.directory);
  } catch {
    integrityFailed(args.log, [UNREADABLE]);
  }
  try {
    const problems = await args.checkIntegrity(store);
    if (problems.length > 0) integrityFailed(args.log, problems);
    await assertNotAhead(store.venue, manifestSets(), args.migrationsRoot);
    const table = await store.venue.execute<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name = ${"node_sealed_state"}`,
    );
    const sealed = table.rows.length === 0 ? null : await readSealedStateRow(store.venue, nodeId);
    if (sealed === null) throw new AppError("restore.stream_state_missing", { nodeId });
    return { sealed, venue: await readRestoredVenue(store, venueId) };
  } finally {
    await store.close();
  }
}

async function readVerifiedPointer(store: ObjectStore, kit: RecoveryKit) {
  let read;
  try {
    read = await readPointer(store, kit.venueId);
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
 * Everything a bucket rebuild decides before it changes anything on the box: the pointer, verified
 * with the kit's key; the old-box check; the download into a scratch folder; its integrity and
 * schema; the node's locked row, unlocked with the kit's recovery key; and whose copy it is. The
 * scratch folder is removed on every failure.
 */
export async function prepareStreamRestore(deps: PrepareStreamDeps): Promise<PreparedStream> {
  const { kit } = deps;
  const store = (deps.openStore ?? createS3ObjectStore)(kit.bucket);
  const { generation, nodeId } = await readVerifiedPointer(store, kit);
  await refuseIfSourceLive({
    store,
    venueId: kit.venueId,
    generation,
    now: deps.now,
    oldBoxGone: deps.oldBoxGone,
  });

  const scratch = await scratchFolder(deps.stateDir, SCRATCH);
  const discard = () => rm(scratch, { recursive: true, force: true });
  const databasePath = join(scratch, "venue.db");
  try {
    try {
      await (deps.restoreGeneration ?? restoreGeneration)({
        litestreamBin: deps.litestreamBin,
        bucket: kit.bucket,
        venueId: kit.venueId,
        generation,
        outPath: databasePath,
        configDir: join(scratch, "litestream"),
      });
    } catch (error) {
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
      venueId: kit.venueId,
      migrationsRoot: deps.migrationsRoot,
      checkIntegrity: deps.checkIntegrity ?? checkIntegrity,
      log: deps.log,
    });
    const entries = unsealNodeState(sealed, kit.recoveryKey);
    deps.log("info", "restore.stream_prepared", { generation });
    return { databasePath, entries, nodeId, generation, venue, discard };
  } catch (error) {
    await discard();
    throw error;
  }
}

export interface WriteStreamArgs extends PlacementDeps {
  databaseBytes: Uint8Array;
  entries: ArchiveEntry[];
}

/** The archive restore's own validation and write, over the restored database and the unlocked
 * row's entries, with the first-start marker naming the stream. */
export async function writeStreamRestore(args: WriteStreamArgs): Promise<void> {
  const { databaseBytes, entries, ...deps } = args;
  const validated = await validateEntries(
    [...entries, { name: "db.dump", bytes: databaseBytes }],
    deps,
  );
  await writeValidated(validated, { ...deps, rebuildSource: "stream" });
}

/**
 * Prepare, show the operator whose copy it is, then write, in one process. Nothing on the box
 * changes unless `confirmVenue` accepts the restored venue.
 */
export async function restoreFromStream(
  deps: PrepareStreamDeps &
    PlacementDeps & {
      confirmVenue: (venue: RestoredVenue) => boolean;
    },
): Promise<void> {
  const prepared = await prepareStreamRestore(deps);
  try {
    if (!deps.confirmVenue(prepared.venue)) {
      throw new AppError("restore.stream_venue_unconfirmed", { ...prepared.venue });
    }
    await writeStreamRestore({
      ...deps,
      databaseBytes: await readFile(prepared.databasePath),
      entries: prepared.entries,
    });
  } finally {
    await prepared.discard();
  }
}
