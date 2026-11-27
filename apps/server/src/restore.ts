import {
  connectionPair,
  drizzleNodeSqlite,
  immutableFileUrl,
  TRADING_ENV_REPLACED_SUFFIX,
  TRADING_ENV_FILE,
  NODE_FILE,
  openBackupQuery,
  SIDE_FILE_SUFFIXES,
  VENUE_FILE,
  type BackupQuery,
} from "@waitron/store";

import { assertVenueFirstSetupAllowed, isFirstSetupHostPath } from "@waitron/provisioning";
import { lstatSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { AppError, isAppError, nodeId as brandNodeId, readVariable } from "@waitron/shared";
import {
  insertNodeSeriesTx,
  readLiveSeriesIdTx,
  lockVenueDatabase,
  nodes,
  openVenueDatabase,
  readStandardSeriesIdTx,
  retireNodeSeriesTx,
  withTransaction,
  workingOrders,
  readVenueSettings,
  readCurrentMasterKey,
  type Database,
  type NodeDatabase,
  type Transaction,
  type VenueDatabase,
  type VenueLock,
} from "@waitron/db";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import {
  applyMigrations,
  expectedSchemaVersion,
  manifestSets,
  migrationOptionsFor,
} from "@waitron/migrations";

import {
  modulesWithSets,
  orderedMigrationSets,
  type ProvisionedNode,
  type WaitronModule,
} from "@waitron/module";
import { assertNotAhead, quoteIdent } from "@waitron/provisioning";
import {
  moduleOperationFor,
  snapshotModuleOperations,
  withPreparedModuleOperations,
  type ModuleOperations,
} from "@waitron/module";
import { parseEnvFile } from "./env-file.js";
import { isUnset } from "./env-value.js";
import { errnoOf } from "./errno.js";
import { type ArchiveEntry } from "./backup-archive.js";
import { decryptBackupFile, type ArchiveKeySlot } from "./artifact-cipher-file.js";
import { recoveryStreamSourceId } from "./recovery-source.js";
import { decodeArchiveFile } from "./backup-compression.js";
import { unpackArchiveFile } from "./backup-archive-file.js";
import type { BackupManifest } from "./backup-manifest.js";
import { BackupManifestReadError, readBackupManifest } from "./backup-manifest-reader.js";
import type { DeploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import { checkRestoreCompatibility } from "./restore-gate.js";
import { assertSafeEntryName } from "./restore-entry-guard.js";
import type { StateSecretFiles } from "./state-secrets.js";
import type { RebuildSource } from "./rebuild-first-start.js";
import { endRestoreFlow, publishRestoreFlow } from "./restore-flow.js";
import {
  ARCHIVE_INPUT_PREFIX,
  ARCHIVE_VALIDATE_PREFIX,
  RESTORE_ADMISSION_PREFIX,
} from "./restore-staging-dirs.js";
import { unpackStateFiles } from "./state-secrets.js";
import { deleteBackupRoomNote } from "./backup-room-note.js";
import { clearReplacementMark } from "./stop-mark.js";
import { removeReplacedResetMarker } from "./replaced-reset.js";
import { type StagedSecrets, stageSecrets, moduleRecordEntries } from "./restore-secrets.js";
import "./errors.js";
import { currentBackupVerificationTarget } from "./backup-verification-target.js";
import {
  assertSnapshotRecoveryArchive,
  assertSnapshotRecoveryTarget,
  cloudRecoveryUnavailable,
  readSnapshotRecoveryBinding,
  SnapshotPlacementRefused,
  type SnapshotRecoveryVerification,
} from "./cloud-recovery-v2.js";
import { VENUE_FILE_MODE, DB_DUMP_NAME, restoreDatabase } from "./restore-file-placement.js";

const MANIFEST_NAME = "manifest.json";

/** Holds a whole copy of the box's own `node.db`, placed beside the venue file. */
const NODE_DUMP_NAME = "node.dump";
const SECRETS_PREFIX = "secrets/";
const TRADING_ENV_ENTRY = `${SECRETS_PREFIX}trading.env`;

/** Retains only the last replaced identity, overwriting any prior copy; boot reads only `trading.env`. */
const REPLACED_SUFFIX = TRADING_ENV_REPLACED_SUFFIX;
const IDENTITY_KEYS = ["WAITRON_NODE_ID"] as const;
/** Where the incoming database sits while it is still incoming — same directory, so the rename is atomic. */
export { INCOMING_SUFFIX } from "@waitron/store";

/** `RestoreDeps` has no seam for {@link restoreDatabase}: a fake would hide the two failures named
 * in its own comment. */
export interface RestoreDeps extends ValidationDeps {
  readonly snapshotVerification?: SnapshotRecoveryVerification;
  readonly snapshotRequestKey?: string;
  /** A managed replacement must receive fresh destination credentials. */
  readonly managedCloud?: { requestId: string; pointId: string };
  /** The directory holding `venue.db` and `node.db` (`packages/store/src/index.ts`). */
  readonly venueDir: string;
  /** Opens the handle the hook transaction runs on. Default {@link openVenueDatabase}'s venue file,
   * with its node file beside it. */
  readonly openDb?: (
    directory: string,
  ) => Promise<{ db: Database; node: NodeDatabase; close(): Promise<void> }>;
  /** Migrates the restored database to this binary's schema before any hook runs. Default
   * `applyMigrations`. */
  readonly migrate?: typeof applyMigrations;
  /** Holds the venue folder for the whole write. Default {@link lockRestoreTarget}. */
  readonly lockVenue?: (directory: string) => Promise<VenueLock>;
  readonly rebuildSource?: RebuildSource;
  readonly recordFirstStart?: (source: RebuildSource) => Promise<void>;
  readonly clearFirstStart?: () => Promise<void>;
  /** Runs after validation and before the restore changes the venue folder, the box's identity or
   * its secrets; not run with `skipSecrets`. Refusing stops the restore. */
  readonly checkSourceLive?: (validated: ValidatedArtifact) => Promise<void>;
  readonly withModuleOperations?: RestoreOperationRunner;
  readonly beforeDatabaseMove?: () => Promise<void>;
  readonly log: Logger;
}

/** What writing an already validated artifact reads. */
export type PlacementDeps = Omit<RestoreDeps, "artifact" | "recoveryKey">;

export interface RestoreHookResult {
  readonly seriesId: string;
  readonly reports: readonly string[];
}

// Authentication is reconstructed by the trusted host, never deserialised from a backup or marker.
// A runner calls `run` once, as the body of the venue transaction it saves.
export interface RestoreOperationRunner {
  (
    context: {
      readonly db: Database;
      readonly nodeDb: NodeDatabase;
      readonly node: ProvisionedNode;
    },
    run: (tx: Transaction, operations: ModuleOperations) => Promise<RestoreHookResult>,
  ): Promise<RestoreHookResult>;
  checkBeforePlacement?(context: {
    readonly db: Database;
    readonly nodeDb: NodeDatabase;
    readonly node: ProvisionedNode;
    readonly sourceId: string | undefined;
  }): Promise<void>;
}

/** What {@link validateArtifact} reads, and nothing else. */
export interface ValidationDeps {
  readonly artifact: Uint8Array;
  readonly recoveryKey: string;
  readonly stateDir: string;
  readonly stagingDir: string;
  readonly migrationsRoot: string | null;
  readonly modules: readonly WaitronModule[];
  readonly environment: DeploymentEnvironment;
  /** Skip restoring `secrets/*`, the set-aside of any existing identity, AND the restore hooks. */
  readonly skipSecrets?: boolean;
}

/**
 * The output of {@link validateArtifact} and the input to {@link writeValidated}: an artifact that
 * produces one has passed the compatibility GATE and the traversal GUARD, plus identity completeness
 * when secrets are restored.
 */
export interface ValidatedArtifact {
  readonly sourceId?: string;
  readonly manifest: BackupManifest;
  readonly databasePath: string;
  /** The archive's copy of `node.db`, placed with the venue file unless `skipSecrets`. */
  readonly nodeDump: Uint8Array;
  readonly discard: () => Promise<void>;
  readonly secretEntries: readonly ArchiveEntry[];
}

/**
 * Writes a backup's node copy as `node.db` beside a staged `venue.db`, replacing any `node.db` set
 * a store open already created there; with no copy, that set is only removed.
 */
export async function writeStagedNodeCopy(
  databasePath: string,
  nodeDump: Uint8Array | undefined,
): Promise<void> {
  const target = join(dirname(databasePath), NODE_FILE);
  for (const suffix of ["", ...SIDE_FILE_SUFFIXES]) await rm(`${target}${suffix}`, { force: true });
  if (nodeDump !== undefined)
    await writeFile(target, nodeDump, { mode: VENUE_FILE_MODE, flag: "wx" });
}

/**
 * Opening a staged folder without its `node.db` would create an empty one in its place, and a node
 * copy the node set never migrated has none of the tables its unmigrated readers read.
 */
export function assertStagedNodeCopy(directory: string): void {
  const path = join(directory, NODE_FILE);
  if (!lstatSync(path, { throwIfNoEntry: false })?.isFile() || !nodeSetApplied(path))
    throw new AppError("restore.archive_incomplete", { missing: NODE_DUMP_NAME });
}

function nodeSetApplied(path: string): boolean {
  let copy: DatabaseSync | undefined;
  try {
    copy = new DatabaseSync(path, { readOnly: true, allowExtension: false });
    const journal = NODE_MIGRATIONS.migrationsTable;
    return (
      copy.prepare("select 1 from sqlite_schema where type = 'table' and name = ?").get(journal) !==
        undefined &&
      copy.prepare(`select 1 from ${quoteIdent(journal)} limit 1`).get() !== undefined
    );
  } catch (error) {
    // Any copy SQLite cannot open or read, a non-database included, is refused as incomplete.
    if (error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR")
      return false;
    throw error;
  } finally {
    copy?.close();
  }
}

export async function openStagedCopy(directory: string): Promise<VenueDatabase> {
  assertStagedNodeCopy(directory);
  return openVenueDatabase(directory);
}

/**
 * Copies a validated copy's `venue.db` into `directory` with its node copy beside it, so opening
 * that folder never creates an empty `node.db`; returns the new `venue.db`.
 */
export async function copyStagedCopy(
  copy: Pick<ValidatedArtifact, "databasePath" | "nodeDump">,
  directory: string,
): Promise<string> {
  const target = join(directory, VENUE_FILE);
  await copyFile(copy.databasePath, target);
  await writeStagedNodeCopy(target, copy.nodeDump);
  return target;
}

/** Validate before replacing any destination database, identity or secrets. */
export async function validateArtifact(
  deps: ValidationDeps,
): Promise<ValidatedArtifact & { readonly sourceId: string }> {
  const artifact = Uint8Array.from(deps.artifact);
  let encryptedDir: string | undefined;
  try {
    await mkdir(deps.stagingDir, { recursive: true, mode: 0o700 });
    encryptedDir = await mkdtemp(join(deps.stagingDir, ARCHIVE_INPUT_PREFIX));
    const artifactPath = join(encryptedDir, "artifact");
    await writeFile(artifactPath, artifact, { mode: VENUE_FILE_MODE, flag: "wx" });
    return await validateArtifactFile({ ...deps, artifactPath });
  } catch (error) {
    if (["ENOSPC", "EDQUOT"].includes(errnoOf(error) ?? ""))
      throw new AppError("restore.archive_resource_limit", {});
    throw error;
  } finally {
    if (encryptedDir !== undefined) await rm(encryptedDir, { recursive: true, force: true });
  }
}

export type EntryValidationDeps = Omit<ValidationDeps, "artifact" | "recoveryKey">;

export async function validateDatabaseEntries(
  entries: readonly ArchiveEntry[],
  databasePath: string,
  deps: EntryValidationDeps,
): Promise<ValidatedArtifact & { readonly sourceId: string }> {
  const { manifest, nodeDump, secretEntries } = await validateEntryMetadata(
    [...entries, { name: DB_DUMP_NAME, bytes: new Uint8Array() }],
    deps,
  );
  return {
    manifest,
    databasePath,
    nodeDump,
    secretEntries,
    discard: async () => {},
    sourceId: await recoveryStreamSourceId(databasePath, entries),
  };
}

async function validateEntryMetadata(
  entries: ArchiveEntry[],
  deps: EntryValidationDeps,
): Promise<{
  manifest: BackupManifest;
  dumpEntry: ArchiveEntry;
  nodeDump: Uint8Array;
  secretEntries: ArchiveEntry[];
}> {
  // Rejection precedence is the statement order below: missing manifest → manifest admission → missing dump → missing
  // node copy → compatibility gate → unexpected entry → path guard / duplicate destination → identity
  // completeness. `??=` only fixes which entry a repeated name is classified as; a repeated
  // destination is refused by the guard loop regardless.
  let manifestEntry: ArchiveEntry | undefined;
  let dumpEntry: ArchiveEntry | undefined;
  let nodeEntry: ArchiveEntry | undefined;
  const secretEntries: ArchiveEntry[] = [];
  let firstUnexpected: ArchiveEntry | undefined;
  for (const entry of entries) {
    if (entry.name === MANIFEST_NAME) manifestEntry ??= entry;
    else if (entry.name === DB_DUMP_NAME) dumpEntry ??= entry;
    else if (entry.name === NODE_DUMP_NAME) nodeEntry ??= entry;
    else if (
      entry.name.startsWith(SECRETS_PREFIX) &&
      !isFirstSetupHostPath(posix.normalize(entry.name.slice(SECRETS_PREFIX.length)))
    )
      secretEntries.push(entry);
    else firstUnexpected ??= entry;
  }

  if (manifestEntry === undefined) {
    throw new AppError("restore.archive_incomplete", { missing: MANIFEST_NAME });
  }
  let manifest: BackupManifest;
  try {
    manifest = readBackupManifest(manifestEntry.bytes);
  } catch (error) {
    if (error instanceof BackupManifestReadError)
      throw new AppError("restore.manifest_invalid", { reason: error.status });
    throw error;
  }

  if (dumpEntry === undefined) {
    throw new AppError("restore.archive_incomplete", { missing: DB_DUMP_NAME });
  }
  if (nodeEntry === undefined) {
    throw new AppError("restore.archive_incomplete", { missing: NODE_DUMP_NAME });
  }

  // GATE — before any write. `expectedVersions` is read from THIS binary's own migrations per migration set
  // (`expectedSchemaVersion`), never a hardcoded number — the same shape `buildManifest` builds from a
  // database, just off the shipped folders instead.
  const expectedVersions = Object.fromEntries(
    modulesWithSets(deps.modules).map((m) => [
      m.name,
      expectedSchemaVersion(m.migrations, deps.migrationsRoot),
    ]),
  );
  checkRestoreCompatibility(manifest, { environment: deps.environment, expectedVersions });

  // A source without a restore destination must fail before any database or secret write.
  if (firstUnexpected !== undefined) {
    throw new AppError("restore.unexpected_entry", { name: firstUnexpected.name });
  }

  // The path guard resolves existing roots; create protected directories before validating entries.
  await mkdir(deps.stagingDir, { recursive: true, mode: 0o700 });
  await mkdir(deps.stateDir, { recursive: true, mode: 0o700 });

  // Guard each entry against the same destination and stripped name used by its writer.
  const destinations = new Set<string>();
  for (const entry of entries) {
    const prefix = entry.name.startsWith(SECRETS_PREFIX) ? SECRETS_PREFIX : "";
    const root = prefix === SECRETS_PREFIX ? deps.stateDir : deps.stagingDir;
    const target = await assertSafeEntryName(entry.name.slice(prefix.length), root);
    // Two names for one file would share one staged and one set-aside copy, and the second publish
    // would set the first one's new file aside over the box's old one. Resolved through links (the
    // guard has made the parent), and the name in lower case because a case-insensitive filesystem
    // treats `server.pem` and `SERVER.PEM` as one file.
    const location = join(await realpath(dirname(target)), basename(target)).toLowerCase();
    if (destinations.has(location)) {
      throw new AppError("restore.unsafe_entry_path", { name: entry.name });
    }
    destinations.add(location);
    entry.name = posix.normalize(entry.name);
  }

  if (!deps.skipSecrets) readArtifactIdentity(secretEntries);

  return { manifest, dumpEntry, nodeDump: nodeEntry.bytes, secretEntries };
}

/**
 * The secrets are staged before anything is replaced, so a full disk met during staging leaves the
 * box as it was. Placing the database is the point of no return for the box's files: after it a
 * failure keeps the placed database with the box's identity set aside.
 */
async function placeValidated(validated: ValidatedArtifact, deps: PlacementDeps): Promise<void> {
  const { log } = deps;
  // Before the identity is set aside, so a refusal here leaves it where it was.
  await removeReplacedResetMarker(deps.stateDir);
  await deleteBackupRoomNote(deps.stateDir);
  let staged: StagedSecrets | undefined;
  if (!deps.skipSecrets)
    staged = await stageSecrets({ entries: validated.secretEntries, stateDir: deps.stateDir, log });
  let identityMoved = false;
  try {
    if (!deps.skipSecrets) identityMoved = await setAsideExistingIdentity(deps.stateDir, log);
    await deps.beforeDatabaseMove?.();
    await restoreDatabase({
      databasePath: validated.databasePath,
      // One source per restore: a restore that keeps the box's identity keeps its node.db too.
      ...(deps.skipSecrets ? {} : { nodeDump: validated.nodeDump }),
      venueDir: deps.venueDir,
      stateDir: deps.stateDir,
      log,
    });
  } catch (error) {
    await staged?.discard();
    if (identityMoved) await putIdentityBack(deps.stateDir, log);
    throw error;
  }

  try {
    // The gate admits an OLDER schema; a hook written against today's must not run against
    // yesterday's. Every module, as setup mode migrates — the CLI has no enabled-set config.
    await (deps.migrate ?? applyMigrations)(
      deps.venueDir,
      migrationOptionsFor(orderedMigrationSets(deps.modules), deps.migrationsRoot),
    );
    log("info", "restore.migrated", {});
    if (staged === undefined) {
      log("info", "restore.identity.kept", {});
      return;
    }
    const opened = await (deps.openDb ?? openVenue)(deps.venueDir);
    try {
      const node = await resolveArtifactNode(opened.db, validated.secretEntries);
      const name = (await readCurrentMasterKey(opened.db))?.name;
      if (name?.trim()) log("info", "restore.recovery_key_selected", { name });
      await runRestoreHooks({
        db: opened.db,
        nodeDb: opened.node,
        modules: deps.modules,
        node,
        log,
        withModuleOperations: deps.withModuleOperations,
      });
    } finally {
      await opened.close();
    }
  } catch (error) {
    await staged?.discard();
    throw error;
  }
  await staged.publish();
  await staged.finish();
}

/**
 * Writes a validated artifact ({@link placeValidated}) holding the venue folder, so a restore
 * started while another process holds the folder is refused `provisioning.database_in_use` before
 * it changes the venue folder, the box's identity or its secrets. The hook's own open and the
 * migrate inside share the hold.
 */
export async function writeValidated(
  validated: ValidatedArtifact,
  deps: PlacementDeps,
): Promise<void> {
  const lock = await (deps.lockVenue ?? lockRestoreTarget)(deps.venueDir);
  let admissionDirectory: string | undefined;
  let admitted = validated;
  try {
    await assertVenueFirstSetupAllowed(deps.venueDir, deps.stateDir);
    await assertArchiveNotAhead(validated, deps);
    const check = deps.withModuleOperations?.checkBeforePlacement;
    if (!deps.skipSecrets && check !== undefined) {
      let directory = deps.venueDir;
      admissionDirectory = await mkdtemp(join(deps.stagingDir, RESTORE_ADMISSION_PREFIX));
      directory = admissionDirectory;
      admitted = {
        ...validated,
        databasePath: await copyStagedCopy(validated, directory),
      };
      await (deps.migrate ?? applyMigrations)(
        directory,
        migrationOptionsFor(orderedMigrationSets(deps.modules), deps.migrationsRoot),
      );

      const opened = await (deps.openDb ?? openVenue)(directory);
      try {
        await check({
          db: opened.db,
          nodeDb: opened.node,
          node: await resolveArtifactNode(opened.db, validated.secretEntries),
          sourceId: validated.sourceId,
        });
      } finally {
        await opened.close();
      }
    }
    const recordFirstStart =
      deps.recordFirstStart ??
      ((source: RebuildSource) =>
        publishRestoreFlow(
          deps.stateDir,
          {
            version: 1,
            phase: "first-start",
            firstStart: { source },
          },
          async () => {},
        ));
    const clearFirstStart = deps.clearFirstStart ?? (() => endRestoreFlow(deps.stateDir));
    if (!deps.skipSecrets && deps.recordFirstStart === undefined) await access(deps.stateDir);
    try {
      if (!deps.skipSecrets) await recordFirstStart(deps.rebuildSource ?? "archive");
      await placeValidated(admitted, deps);
    } catch (error) {
      if (!deps.skipSecrets) await clearFirstStart();
      throw error;
    }
    if (!deps.skipSecrets) await clearReplacementMark(deps.stateDir);
  } finally {
    try {
      if (admissionDirectory !== undefined)
        await rm(admissionDirectory, { recursive: true, force: true });
    } finally {
      lock.release();
    }
  }
}

/**
 * The gate counts migrations; this compares their hashes, so a copy made before a starting
 * migration was rebuilt is refused before placement rather than by the migration after it. Reads
 * the main file alone, as placement moves it, and writes nothing beside it; the node copy is read
 * from memory, and only when it replaces the box's.
 */
export async function assertArchiveNotAhead(
  validated: Pick<ValidatedArtifact, "databasePath" | "nodeDump">,
  deps: Pick<PlacementDeps, "skipSecrets" | "migrationsRoot">,
): Promise<void> {
  const venue = new DatabaseSync(immutableFileUrl(validated.databasePath), {
    readOnly: true,
    allowExtension: false,
  });
  const node = deps.skipSecrets
    ? undefined
    : new DatabaseSync(":memory:", { allowExtension: false });
  try {
    node?.deserialize(validated.nodeDump);
    const handle = (connection: DatabaseSync) =>
      drizzleNodeSqlite(connectionPair(connection, connection), { schema: {} });
    await assertNotAhead(
      { venue: handle(venue), node: handle(node ?? venue) },
      manifestSets().filter((set) => node !== undefined || set.database !== "node"),
      deps.migrationsRoot,
    );
  } finally {
    venue.close();
    node?.close();
  }
}

/**
 * The lock creates the folder when the restore is the first thing to write there, so it is created
 * here first, for the operator alone, as {@link restoreDatabase} would.
 */
export async function lockRestoreTarget(directory: string): Promise<VenueLock> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return lockVenueDatabase(directory);
}

/**
 * Validate an encrypted backup and its identity completeness, then stage the artifact's secrets,
 * set aside any existing identity, place the database, migrate, run the module hooks in one
 * transaction and publish the staged secrets.
 */
export async function restoreFromArtifact(deps: RestoreDeps): Promise<void> {
  return restoreOwned(await validateArtifact(deps), deps);
}

async function restoreOwned(
  validated: ValidatedArtifact,
  deps: PlacementDeps & {
    readonly artifact?: Uint8Array;
    readonly artifactPath?: string;
  },
): Promise<void> {
  try {
    if (!deps.skipSecrets) await deps.checkSourceLive?.(validated);
    try {
      const snapshot = await readSnapshotRecoveryBinding(deps.stateDir, deps);
      if (snapshot) {
        if (deps.skipSecrets || deps.snapshotRequestKey !== snapshot.publicKey)
          cloudRecoveryUnavailable();
        const bytes =
          deps.artifact?.byteLength ??
          (deps.artifactPath === undefined ? undefined : (await lstat(deps.artifactPath)).size);
        assertSnapshotRecoveryArchive(snapshot.verification, validated.sourceId, bytes);
        assertSnapshotRecoveryTarget(snapshot.verification, currentBackupVerificationTarget());
      }
    } catch {
      throw new SnapshotPlacementRefused();
    }
    await writeValidated(
      deps.managedCloud
        ? {
            ...validated,
            secretEntries: validated.secretEntries.filter(
              (entry) => entry.name !== "secrets/backup.env",
            ),
          }
        : validated,
      deps,
    );
  } finally {
    await validated.discard();
  }
}

/**
 * Restore every `secrets/<path>` entry into `stateDir`, prefix stripped, via `unpackStateFiles` —
 * which re-applies the same traversal guard AND writes each file 0600, durably unless `durable` is
 * `false`. Secret contents are utf8 text
 * (`RECOVERY_FILES` are `.env`/PEM), matching the utf8 they were read as into the archive.
 * `trading.env` is written last, after every other secret succeeds, so a failure cannot publish a
 * partial identity.
 */
export async function restoreSecrets(args: {
  entries: readonly ArchiveEntry[];
  stateDir: string;
  log: Logger;
  durable?: boolean;
}): Promise<void> {
  const files: StateSecretFiles = {};
  for (const entry of await moduleRecordEntries(args.entries, args.stateDir)) {
    if (entry.name === TRADING_ENV_ENTRY) continue;
    files[entry.name.slice(SECRETS_PREFIX.length)] = Buffer.from(entry.bytes).toString("utf8");
  }
  const identity = args.entries.find((entry) => entry.name === TRADING_ENV_ENTRY);
  if (identity !== undefined)
    files[TRADING_ENV_FILE] = Buffer.from(identity.bytes).toString("utf8");
  await unpackStateFiles(files, args.stateDir, { durable: args.durable ?? true });
  args.log("info", "restore.secrets.done", { count: args.entries.length });
}

/**
 * Move a pre-existing identity aside before the database is placed: `<stateDir>/trading.env` →
 * `trading.env.replaced` (boot reads only the former), so no identity starts beside a restored
 * database before the artifact's is published. True when it moved a file; a missing file is the
 * normal fresh-box case.
 */
export async function setAsideExistingIdentity(stateDir: string, log: Logger): Promise<boolean> {
  const path = join(stateDir, TRADING_ENV_FILE);
  try {
    await rename(path, `${path}${REPLACED_SUFFIX}`);
    log("info", "restore.identity.set_aside", {});
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return false;
  }
}

/** Undoes {@link setAsideExistingIdentity} when no `trading.env` has taken its place. False, logged,
 * when it cannot. */
export async function putIdentityBack(stateDir: string, log: Logger): Promise<boolean> {
  const path = join(stateDir, TRADING_ENV_FILE);
  if (lstatSync(path, { throwIfNoEntry: false }) !== undefined) {
    log("error", "restore.identity.put_back_failed", { errno: "EEXIST" });
    return false;
  }
  try {
    await rename(`${path}${REPLACED_SUFFIX}`, path);
    log("info", "restore.identity.put_back", {});
    return true;
  } catch (error) {
    log("error", "restore.identity.put_back_failed", { errno: errnoOf(error) });
    return false;
  }
}

/**
 * The identity the restored box will take, read from the ARTIFACT's `secrets/trading.env` — never the
 * target box's file, which may hold a stale or foreign identity. Every key is required and non-empty
 * (`isUnset`): a backup of a never-provisioned box has no node identity to restore. `validateArtifact`
 * checks this before set-aside or database restore unless `skipSecrets` keeps the target's identity.
 */
export function readArtifactIdentity(secretEntries: readonly ArchiveEntry[]): {
  node: Pick<ProvisionedNode, "nodeId">;
} {
  const entry = secretEntries.find((e) => e.name === TRADING_ENV_ENTRY);
  if (entry === undefined) {
    throw new AppError("restore.identity_incomplete", { missing: TRADING_ENV_FILE });
  }
  const env = parseEnvFile(Buffer.from(entry.bytes).toString("utf8"));
  for (const key of IDENTITY_KEYS) {
    if (isUnset(readVariable(env, key)))
      throw new AppError("restore.identity_incomplete", { missing: key });
  }
  return {
    node: {
      nodeId: brandNodeId(readVariable(env, "WAITRON_NODE_ID")!),
    },
  };
}

export async function resolveArtifactNode(
  db: Database | Transaction,
  entries: readonly ArchiveEntry[],
): Promise<ProvisionedNode> {
  const { node } = readArtifactIdentity(entries);
  const [stored] = await db.select({ id: nodes.id }).from(nodes).where(eq(nodes.id, node.nodeId));
  if (stored === undefined) throw new AppError("restore.identity_unknown", { nodeId: node.nodeId });
  await readVenueSettings(db);
  return node;
}

async function requireCopyNode(query: BackupQuery, node: ProvisionedNode): Promise<void> {
  for await (const row of query.rows("select id from nodes where id = ?", [node.nodeId])) {
    if (typeof row.id === "string") return;
  }
  throw new AppError("restore.identity_unknown", { nodeId: node.nodeId });
}

export async function readArtifactNode(
  copy: Pick<ValidatedArtifact, "secretEntries" | "databasePath">,
): Promise<ProvisionedNode> {
  const { node } = readArtifactIdentity(copy.secretEntries);
  const opened = await openBackupQuery(copy.databasePath);
  try {
    await requireCopyNode(opened.query, node);
    return node;
  } finally {
    await opened.close();
  }
}

export async function readCopyNode(
  query: BackupQuery,
  secretEntries: readonly ArchiveEntry[],
): Promise<{ node: ProvisionedNode }> {
  const { node } = readArtifactIdentity(secretEntries);
  await requireCopyNode(query, node);
  return { node };
}

function wrapHookError(module: string, err: unknown): unknown {
  return isAppError(err) ? new AppError("restore.hook_failed", { module, code: err.code }) : err;
}

/**
 * Run every module's `backup.restore` hook and settle the node's series, in ONE
 * transaction. Order: check the node exists → hooks in
 * list order → at most one module may return `series` → if one did, retire the node's live series and
 * open the returned ones → on EVERY path require one live standard and one live full series —
 * zero or two of either aborts the transaction → mark every open and placed bill
 * `before_restore`. Returns the standard series id and the hooks' reports.
 */
export async function runRestoreHooks(args: {
  db: Database;
  nodeDb: NodeDatabase;
  modules: readonly WaitronModule[];
  node: ProvisionedNode;
  log: Logger;
  moduleOperations?: ModuleOperations;
  withModuleOperations?: RestoreOperationRunner;
}): Promise<{ seriesId: string; reports: readonly string[] }> {
  const { node } = args;
  const suppliedOperations = snapshotModuleOperations(args.moduleOperations);
  const run = async (tx: Transaction, moduleOperations = suppliedOperations) => {
    const operations = snapshotModuleOperations(moduleOperations);
    const [known] = await tx
      .select({ id: nodes.id })
      .from(nodes)
      .where(eq(nodes.id, node.nodeId))
      .limit(1);
    if (known === undefined) {
      throw new AppError("restore.identity_unknown", {
        nodeId: node.nodeId,
      });
    }
    const reports: string[] = [];
    let replacement:
      { module: string; series: readonly { code: string; purpose: string }[] } | undefined;
    for (const m of args.modules) {
      const hook = m.backup?.restore;
      if (hook === undefined) continue;
      let outcome;
      try {
        const operation = moduleOperationFor(operations, m.name, node.nodeId, "restore");
        outcome = operation === undefined ? await hook(tx, node) : await hook(tx, node, operation);
        moduleOperationFor(operations, m.name, node.nodeId, "restore");
      } catch (err) {
        throw wrapHookError(m.name, err);
      }
      reports.push(`${m.name}: ${outcome.report}`);
      args.log("info", "restore.hook.done", { module: m.name, report: outcome.report });
      if (outcome.series !== undefined) {
        if (replacement !== undefined) {
          throw new AppError("restore.series_conflict", {
            modules: `${replacement.module},${m.name}`,
          });
        }
        replacement = { module: m.name, series: outcome.series };
      }
    }
    // `core` owns `invoice_series`: a failure here with no module returning series is the node's own
    // series contract failing, so that is the module named.
    const owner = replacement?.module ?? "core";
    let seriesId: string;
    try {
      if (replacement !== undefined) {
        await retireNodeSeriesTx(tx, node.nodeId);
        await insertNodeSeriesTx(tx, node.nodeId, replacement.series);
      }
      seriesId = await readStandardSeriesIdTx(tx, node.nodeId);
      await readLiveSeriesIdTx(tx, node.nodeId, "full");
    } catch (err) {
      throw wrapHookError(owner, err);
    }
    // Bills from before a restore are left for staff (D6).
    await tx
      .update(workingOrders)
      .set({ beforeRestore: true })
      .where(inArray(workingOrders.status, ["open", "placed"]));
    for (const m of args.modules) {
      if (m.backup?.restore !== undefined) {
        try {
          moduleOperationFor(operations, m.name, node.nodeId, "restore");
        } catch (error) {
          throw wrapHookError(m.name, error);
        }
      }
    }
    return { seriesId, reports };
  };
  return args.withModuleOperations === undefined
    ? withPreparedModuleOperations(
        args.modules,
        suppliedOperations,
        node.nodeId,
        "restore",
        (ready) => withTransaction(args.db, (tx) => run(tx, ready)),
      )
    : args.withModuleOperations({ db: args.db, nodeDb: args.nodeDb, node }, run);
}

/**
 * The hook transaction's handle: the VENUE file of the directory just restored into.
 *
 * `close` closes BOTH files, not just the venue one — `openVenueDatabase` opens `node.db` beside it
 * and a handle left open would hold the restored directory for the life of the process.
 */
async function openVenue(
  directory: string,
): Promise<{ db: Database; node: NodeDatabase; close(): Promise<void> }> {
  const store = await openVenueDatabase(directory);
  return { db: store.venue, node: store.node, close: () => store.close() };
}

export type RestoreFileDeps = Omit<RestoreDeps, "artifact"> & {
  readonly artifactPath: string;
  readonly archiveKey?: ArchiveKeySlot;
};
export type ValidationFileDeps = Omit<ValidationDeps, "artifact"> & {
  readonly artifactPath: string;
  readonly archiveKey?: ArchiveKeySlot;
};
export async function validateArtifactFile(
  deps: ValidationFileDeps,
): Promise<ValidatedArtifact & { readonly sourceId: string }> {
  let scratch: string | undefined;
  const discard = async () => {
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
  };
  try {
    await mkdir(deps.stagingDir, { recursive: true, mode: 0o700 });
    scratch = await mkdtemp(join(deps.stagingDir, ARCHIVE_VALIDATE_PREFIX));
    const plaintext = join(scratch, "plaintext");
    const sourceId = await decryptBackupFile(
      deps.artifactPath,
      plaintext,
      deps.recoveryKey,
      deps.archiveKey,
    );
    const archive = await decodeArchiveFile(plaintext, join(scratch, "decoded"));
    const inputs = await unpackArchiveFile(archive, scratch);
    await rm(archive);
    const entries = inputs.map((input) =>
      input.kind === "bytes" ? input.entry : { name: input.name, bytes: new Uint8Array() },
    );
    const { manifest, nodeDump, secretEntries } = await validateEntryMetadata(entries, deps);
    await writeStagedNodeCopy(join(scratch, VENUE_FILE), nodeDump);
    return {
      manifest,
      secretEntries,
      databasePath: join(scratch, VENUE_FILE),
      nodeDump,
      discard,
      sourceId,
    };
  } catch (error) {
    await discard();
    if (["ENOSPC", "EDQUOT"].includes(errnoOf(error) ?? ""))
      throw new AppError("restore.archive_resource_limit", {});
    throw error;
  }
}
export async function restoreFromArtifactFile(deps: RestoreFileDeps): Promise<void> {
  return restoreOwned(await validateArtifactFile(deps), deps);
}
