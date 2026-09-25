import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { loadKeyRing } from "@waitron/credentials";
import { locations, openVenueDatabase, tenants, type VenueDatabase } from "@waitron/db";
import { manifestSets } from "@waitron/migrations";
import { assertNotAhead } from "@waitron/provisioning";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import {
  PROBE_PREFIX,
  createS3ObjectStore,
  generationPrefix,
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
  type RestoreDeps,
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

/** The download folder, inside the state folder so a later move stays on one filesystem. */
const SCRATCH = "stream-restore";
const ARCHIVE_SCRATCH = "archive-source-check";
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
  checkIntegrity?: (directory: string) => Promise<string[]>;
}

export interface PreparedStream {
  /** The restored `venue.db`, inside the scratch folder. */
  databasePath: string;
  /** The unlocked row's entries: an archive's entries without `db.dump`. */
  entries: ArchiveEntry[];
  nodeId: string;
  generation: string;
  venue: RestoredVenue;
  /** Removes the scratch folder. */
  discard(): Promise<void>;
}

/**
 * SQLite's `integrity_check` over `<directory>/venue.db`: `[]` when healthy, else its lines. A file
 * that cannot be opened or read is reported as a problem, never thrown.
 */
export async function checkIntegrity(directory: string): Promise<string[]> {
  let store: VenueDatabase | undefined;
  try {
    store = await openVenueDatabase(directory);
    const result = await store.venue.execute<Record<string, unknown>>(sql`pragma integrity_check`);
    const lines = result.rows.map((row) => String(Object.values(row)[0]));
    return lines.length === 1 && lines[0] === "ok" ? [] : lines;
  } catch {
    return [UNREADABLE];
  } finally {
    await store?.close();
  }
}

async function newestChange(
  store: ObjectStore,
  venueId: string,
  generation: string,
): Promise<Date | null> {
  let newest: Date | null = null;
  for (const object of await store.list(generationPrefix(venueId, generation))) {
    if (newest === null || object.lastModified > newest) newest = object.lastModified;
  }
  return newest;
}

/**
 * The bucket's clock minus this box's, in milliseconds, from the `LastModified` of a probe object
 * written and listed back; null when that cannot be done. The probe is deleted afterwards.
 */
export async function measureBucketSkew(
  store: ObjectStore,
  now: () => Date,
): Promise<number | null> {
  const key = `${PROBE_PREFIX}clock-${randomUUID()}`;
  try {
    const started = now().getTime();
    await store.put(key, new Uint8Array([1]), { ifNoneMatch: "*" });
    const ended = now().getTime();
    const listed = (await store.list(key)).find((object) => object.key === key);
    return listed === undefined ? null : listed.lastModified.getTime() - (started + ended) / 2;
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
  const newest = await newestChange(args.store, args.venueId, args.generation);
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
  const scratch = join(args.stateDir, ARCHIVE_SCRATCH);
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true, mode: 0o700 });
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
    const store = (args.openStore ?? createS3ObjectStore)(settings.bucket);
    let read;
    try {
      read = await readPointer(store, settings.venueId);
    } catch {
      throw new AppError("restore.stream_source_unchecked", { reason: "bucket" });
    }
    if (read === null) return;
    await refuseIfSourceLive({
      store,
      venueId: settings.venueId,
      generation: read.pointer.body.generation,
      now: args.now,
      oldBoxGone: false,
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
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

/** From the restored copy alone: refuse a schema ahead of this software, then read the node's
 * locked row and whose copy it is. */
async function readRestoredCopy(
  directory: string,
  nodeId: string,
  venueId: string,
  migrationsRoot: string | null,
): Promise<{ sealed: Uint8Array; venue: RestoredVenue }> {
  const store = await openVenueDatabase(directory);
  try {
    await assertNotAhead(store.venue, manifestSets(), migrationsRoot);
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

  const scratch = join(deps.stateDir, SCRATCH);
  const discard = () => rm(scratch, { recursive: true, force: true });
  await discard();
  await mkdir(scratch, { recursive: true, mode: 0o700 });
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
    const problems = await (deps.checkIntegrity ?? checkIntegrity)(scratch);
    if (problems.length > 0) {
      deps.log("warn", "restore.stream_integrity_failed", { problems: problems.length });
      throw new AppError("restore.stream_integrity_failed", {});
    }
    const { sealed, venue } = await readRestoredCopy(
      scratch,
      nodeId,
      kit.venueId,
      deps.migrationsRoot,
    );
    const entries = unsealNodeState(sealed, kit.recoveryKey);
    deps.log("info", "restore.stream_prepared", { generation });
    return { databasePath, entries, nodeId, generation, venue, discard };
  } catch (error) {
    await discard();
    throw error;
  }
}

export interface WriteStreamArgs extends Omit<RestoreDeps, "artifact" | "recoveryKey"> {
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
    Omit<RestoreDeps, "artifact" | "recoveryKey" | "stagingDir"> & {
      stagingDir?: string;
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
      stagingDir: deps.stagingDir ?? join(deps.stateDir, "restore-staging"),
      databaseBytes: await readFile(prepared.databasePath),
      entries: prepared.entries,
    });
  } finally {
    await prepared.discard();
  }
}
