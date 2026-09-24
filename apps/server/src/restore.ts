import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { eq } from "drizzle-orm";
import {
  AppError,
  isAppError,
  locationId as brandLocationId,
  nodeId as brandNodeId,
} from "@waitron/shared";
import {
  insertNodeSeriesTx,
  lockVenueDatabase,
  nodes,
  openVenueDatabase,
  readStandardSeriesIdTx,
  retireNodeSeriesTx,
  withTransaction,
  type Database,
  type VenueLock,
} from "@waitron/db";
import { applyMigrations, expectedSchemaVersion, migrationOptionsFor } from "@waitron/migrations";
import { orderedMigrationSets, type ProvisionedNode, type WaitronModule } from "@waitron/module";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { isUnset } from "./env-value.js";
import { type ArchiveEntry, unpackArchive } from "./backup-archive.js";
import { decryptArtifact } from "./artifact-cipher.js";
import type { BackupManifest } from "./backup-manifest.js";
import type { DeploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import { checkRestoreCompatibility } from "./restore-gate.js";
import { assertSafeEntryName } from "./restore-entry-guard.js";
import type { BundleFiles } from "./recovery-bundle.js";
import { unpackBundleToDir } from "./state-secrets.js";
import "./errors.js";

/** Images are database rows; the archive carries the database and protected state files. */
const MANIFEST_NAME = "manifest.json";
/**
 * The archive's database entry. Its bytes are now a whole SQLite venue database — the file
 * `packages/store/src/archive.ts`'s `archiveTo` writes with `VACUUM INTO` — not a `pg_dump`
 * archive. The NAME is unchanged so a reader who met it in an older archive, a runbook or the
 * `restore.archive_incomplete` params still finds the same string.
 */
const DB_DUMP_NAME = "db.dump";
const SECRETS_PREFIX = "secrets/";
const TRADING_ENV_ENTRY = `${SECRETS_PREFIX}trading.env`;
const TRADING_ENV_FILE = "trading.env";
/** Retains only the last replaced identity, overwriting any prior copy; boot reads only `trading.env`. */
const REPLACED_SUFFIX = ".replaced";
const IDENTITY_KEYS = [
  "WAITRON_TILL_NODE_ID",
  "WAITRON_TILL_LOCATION_ID",
  "WAITRON_TILL_SERIES_ID",
] as const;
/** The venue database file `openVenueStore` opens inside the venue directory. */
const VENUE_FILE = "venue.db";
/**
 * SQLite's write-ahead sidecars, kept beside the main file and named from its PATH. A committed row
 * can live in `-wal` alone, so these are part of the database, not scratch.
 */
const VENUE_SIDECARS = ["-wal", "-shm"] as const;
/** Where the incoming database sits while it is still incoming — same directory, so the rename is atomic. */
const INCOMING_SUFFIX = ".incoming";
/** The venue file holds the whole database, the same protected content the artifact carried. */
const VENUE_FILE_MODE = 0o600;

/**
 * Everything BR-3's restore orchestrator needs to turn one encrypted backup artifact back into a
 * live box: the ciphertext + its recovery key, the directory this node's database files live in,
 * the state-secrets and scratch staging roots, the module list (for
 * both the compatibility gate's `expectedVersions` and the restore hooks), and this binary's target
 * environment. `migrationsRoot` is `config.migrationsRoot` (or `null` when
 * running from source) — the same value boot feeds `expectedSchemaVersion`.
 *
 * There is no injected database-restore runner any more. The restore is a file placement now
 * ({@link restoreDatabase}), so a fake standing in for it would hide the two failures that
 * placement exists to avoid — see that function's own comment.
 */
export interface RestoreDeps extends ValidationDeps {
  /** The directory holding `venue.db` and `node.db` (`packages/store/src/index.ts`). */
  readonly venueDir: string;
  /** Opens the handle the hook transaction runs on. Default {@link openVenueDatabase}'s venue file. */
  readonly openDb?: (directory: string) => Promise<{ db: Database; close(): Promise<void> }>;
  /** Migrates the restored database to this binary's schema before any hook runs. Default
   * `applyMigrations`; tests stub it. */
  readonly migrate?: typeof applyMigrations;
  /** Holds the venue folder for the whole write. Default {@link lockRestoreTarget}. */
  readonly lockVenue?: (directory: string) => Promise<VenueLock>;
  readonly log: Logger;
}

/**
 * What {@link validateArtifact} reads, and nothing else.
 *
 * The write-free pass decides everything from the artifact bytes, the module list and the two
 * destination roots it guards entry names against. It opens no database and writes no log line, so
 * neither the venue directory nor a {@link Logger} belongs in its parameter — a caller that had to
 * supply one would be supplying a value the function cannot use.
 */
export interface ValidationDeps {
  readonly artifact: Uint8Array;
  readonly recoveryKey: string;
  readonly stateDir: string;
  readonly stagingDir: string;
  readonly migrationsRoot: string | null;
  readonly modules: readonly WaitronModule[];
  readonly environment: DeploymentEnvironment;
  /** Skip restoring `secrets/*`, the set-aside of any existing identity, AND the restore hooks: a
   * returning node keeps its OWN identity, and a hook exists only to make an ASSUMED identity
   * trade-safe (spec §3.3). */
  readonly skipSecrets?: boolean;
}

/**
 * The classified, validated pieces of one backup artifact — the output of {@link validateArtifact}
 * and the input to {@link writeValidated}. Everything the destructive write phase needs, decided
 * entirely from the in-memory artifact bytes: an artifact that produces one of these has passed the
 * compatibility GATE and the traversal GUARD, plus identity completeness when secrets are restored.
 * R3 rejoin threads it across the wipe (validate BEFORE the irreversible `DROP DATABASE`, write
 * AFTER), so a bad key or a rejected manifest/entry refuses with the database still intact.
 */
export interface ValidatedArtifact {
  readonly manifest: BackupManifest;
  readonly dumpEntry: ArchiveEntry;
  readonly secretEntries: readonly ArchiveEntry[];
}

/**
 * The whole up-front, WRITE-FREE pass of a restore: decrypt → unpack → classify entries → refuse an
 * incompatible target (the GATE) → refuse an unroutable entry → mkdir the destination roots → validate
 * EVERY entry name against its destination root (the GUARD) → check identity completeness unless
 * `skipSecrets`. Returns the classified pieces; writes NOTHING to the database and no artifact
 * content to disk (it only `mkdir`s the roots the guard must `realpath`). Every rejection
 * here — a wrong recovery key, a cross-environment or
 * schema-too-new manifest, a crafted entry name, an incomplete identity — is decidable from the
 * artifact bytes alone.
 *
 * `stagingDir` is no longer a DESTINATION: the database entry goes straight into the venue
 * directory under a fixed name, and nothing is written under `stagingDir` at all. It stays as the
 * root every non-secret entry name is resolved against, which is what refuses a crafted-but-
 * authentic name before any write — and that resolution needs a real directory to `realpath`.
 *
 * The GATE and the GUARD live HERE, before any write, on purpose: {@link restoreDatabase} unlinks
 * the venue file irreversibly and secret writes land permanently on disk, so an incompatible
 * manifest or a single crafted-but-authentic entry name must abort before the first byte is written
 * — never after a half-restore (CLAUDE.md §5). R3 rejoin runs this BEFORE its irreversible wipe so
 * the same rejections refuse the whole operation while the old database is still intact.
 *
 * Throws `restore.archive_incomplete` for a missing `manifest.json`/`db.dump`,
 * `restore.identity_incomplete` for missing identity keys/file when secrets are restored,
 * `restore.unexpected_entry` for a top-level entry it cannot route,
 * `restore.environment_mismatch`/`restore.schema_too_new` from the gate, or
 * `restore.unsafe_entry_path` for an unsafe or duplicate destination (plus `recovery.passphrase_invalid`/`backup.*` from
 * decrypt/unpack).
 */
export async function validateArtifact(deps: ValidationDeps): Promise<ValidatedArtifact> {
  const plaintext = decryptArtifact(deps.artifact, deps.recoveryKey);
  const entries = unpackArchive(plaintext);

  // Rejection precedence is the statement order below: missing manifest → missing dump →
  // compatibility gate → unexpected entry → path guard / duplicate destination → identity
  // completeness. `??=` only fixes which entry a repeated name is classified as; a repeated
  // destination is refused by the guard loop regardless.
  let manifestEntry: ArchiveEntry | undefined;
  let dumpEntry: ArchiveEntry | undefined;
  const secretEntries: ArchiveEntry[] = [];
  let firstUnexpected: ArchiveEntry | undefined;
  for (const entry of entries) {
    if (entry.name === MANIFEST_NAME) manifestEntry ??= entry;
    else if (entry.name === DB_DUMP_NAME) dumpEntry ??= entry;
    else if (entry.name.startsWith(SECRETS_PREFIX)) secretEntries.push(entry);
    else firstUnexpected ??= entry;
  }

  if (manifestEntry === undefined) {
    throw new AppError("restore.archive_incomplete", { missing: MANIFEST_NAME });
  }
  const manifest = JSON.parse(Buffer.from(manifestEntry.bytes).toString("utf8")) as BackupManifest;

  if (dumpEntry === undefined) {
    throw new AppError("restore.archive_incomplete", { missing: DB_DUMP_NAME });
  }

  // GATE — before any write. `expectedVersions` is read from THIS binary's own migrations per module
  // (`expectedSchemaVersion`), never a hardcoded number — the same shape `buildManifest` builds from a
  // database, just off the shipped folders instead.
  const expectedVersions = Object.fromEntries(
    deps.modules.map((m) => [m.name, expectedSchemaVersion(m.migrations, deps.migrationsRoot)]),
  );
  checkRestoreCompatibility(manifest, { environment: deps.environment, expectedVersions });

  // A source without a restore destination must fail before any database or secret write.
  if (firstUnexpected !== undefined) {
    throw new AppError("restore.unexpected_entry", { name: firstUnexpected.name });
  }

  // The path guard resolves existing roots; create protected directories before validating entries.
  // Existing directory permissions belong to the operator and are not changed by mkdir.
  await mkdir(deps.stagingDir, { recursive: true, mode: 0o700 });
  await mkdir(deps.stateDir, { recursive: true, mode: 0o700 });

  // Guard each entry against the same destination and stripped name used by its writer.
  const destinations = new Set<string>();
  for (const entry of entries) {
    const prefix = entry.name.startsWith(SECRETS_PREFIX) ? SECRETS_PREFIX : "";
    const root = prefix === SECRETS_PREFIX ? deps.stateDir : deps.stagingDir;
    const target = await assertSafeEntryName(entry.name.slice(prefix.length), root);
    if (destinations.has(target)) {
      throw new AppError("restore.unsafe_entry_path", { name: entry.name });
    }
    destinations.add(target);
    entry.name = posix.normalize(entry.name);
  }

  if (!deps.skipSecrets) readArtifactIdentity(secretEntries);

  return { manifest, dumpEntry, secretEntries };
}

/**
 * Identity completeness is checked by `validateArtifact`: refusal leaves the target intact, before
 * any set-aside or database restore. After validation, set any existing identity aside → restore
 * database → migrate → run module hooks and settle series in one transaction → write
 * secrets. Once the old identity is set
 * aside, a failure before the secrets write leaves no bootable identity. `skipSecrets` keeps the
 * target's identity and skips hooks.
 * The GATE and GUARD belong to `validateArtifact`.
 *
 * Nothing is staged outside the venue directory any more, so there is no `finally` cleanup here:
 * {@link restoreDatabase} writes its incoming file beside the target and removes it itself on a
 * failed write.
 */
async function placeValidated(validated: ValidatedArtifact, deps: RestoreDeps): Promise<void> {
  const { log } = deps;
  if (!deps.skipSecrets) await setAsideExistingIdentity(deps.stateDir, log);
  await restoreDatabase({
    dumpBytes: validated.dumpEntry.bytes,
    venueDir: deps.venueDir,
    log,
  });
  // The gate admits an OLDER schema; a hook written against today's must not run against
  // yesterday's. Every module, as setup mode migrates — the CLI has no enabled-set config.
  await (deps.migrate ?? applyMigrations)(
    deps.venueDir,
    migrationOptionsFor(orderedMigrationSets(deps.modules), deps.migrationsRoot),
  );
  log("info", "restore.migrated", {});
  if (deps.skipSecrets) {
    log("info", "restore.identity.kept", {});
    return;
  }
  // Completeness is a validation precondition; this pure read recovers the already-checked ids.
  const identity = readArtifactIdentity(validated.secretEntries);
  const opened = await (deps.openDb ?? openVenue)(deps.venueDir);
  let seriesId: string;
  try {
    ({ seriesId } = await runRestoreHooks({
      db: opened.db,
      modules: deps.modules,
      node: identity.node,
      log,
    }));
  } finally {
    await opened.close();
  }
  const entries =
    seriesId === identity.seriesId
      ? validated.secretEntries
      : rewriteTradingEnv(validated.secretEntries, seriesId);
  await restoreSecrets({ entries, stateDir: deps.stateDir, log });
}

/**
 * Writes a validated artifact ({@link placeValidated}) holding the venue folder, so a restore
 * started while a server runs is refused `provisioning.database_in_use` with nothing on the box
 * changed. The hook's own open and the migrate inside share the hold.
 */
export async function writeValidated(
  validated: ValidatedArtifact,
  deps: RestoreDeps,
): Promise<void> {
  const lock = await (deps.lockVenue ?? lockRestoreTarget)(deps.venueDir);
  try {
    await placeValidated(validated, deps);
  } finally {
    lock.release();
  }
}

/**
 * The lock creates the folder when the restore is the first thing to write there, so it is created
 * here first, for the operator alone, as {@link restoreDatabase} would.
 */
async function lockRestoreTarget(directory: string): Promise<VenueLock> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return lockVenueDatabase(directory);
}

/**
 * Validate an encrypted backup and its identity completeness, then set aside any existing identity,
 * restore, migrate, run the module hooks in one transaction and write the artifact's secrets last.
 * After set-aside and before
 * the secrets write, the box has no bootable identity. Rejoin calls the two halves separately around its
 * database wipe and uses `skipSecrets` to keep its own identity without running restore hooks.
 */
export async function restoreFromArtifact(deps: RestoreDeps): Promise<void> {
  const validated = await validateArtifact(deps);
  await writeValidated(validated, deps);
}

/**
 * Put the artifact's database where `venue.db` goes. Exposed for R3 composition (restore DB, skip
 * secrets). Returns the path it wrote.
 *
 * The archive entry's bytes ARE a SQLite venue database (`archiveTo`, `packages/store/src/archive.ts`),
 * so there is no subprocess and nothing to feed one: the operation is a file placement. What it
 * amounts to is the ORDER of the filesystem calls below, and the `rm` loop is in that order because
 * overwriting in place is silently wrong. Both readings were measured on Node v26.7.0 against
 * `node:sqlite`, each
 * with a control in the other direction; the scripts and the tables are in
 * `docs/handoffs/2026-09-21-f1-the-flip.md` → "The restore-and-backup surgery", and the two cases
 * in `restore.test.ts` fail if the `rm` loop below is deleted.
 *
 * 1. **The sidecars go with the main file.** A writer killed mid-service (a box losing power) leaves
 *    `venue.db-wal` and `venue.db-shm` behind, and a committed row can live in the `-wal` alone.
 *    Replacing `venue.db` and leaving those, the reopened database answers with the CRASHED
 *    database's own tail and the archive's rows are absent — with no error in either direction.
 *    Removing both first, the same reopen answers with the archive.
 * 2. **The target is UNLINKED, never renamed over.** If anything still holds `venue.db` open, a
 *    rename onto that path leaves the stale connection writing through to it: a fresh open
 *    afterwards reads the OLD database plus whatever that connection wrote AFTER the restore — the
 *    restore silently and completely undone, on the cold-recovery path CLAUDE.md §5 says has to
 *    work. Unlinking first leaves the stale connection on an orphaned inode, and the fresh open
 *    reads the archive. (It does not stop a live writer from carrying on; {@link writeValidated}
 *    refuses to restore while another process holds the folder.)
 *
 * The incoming bytes are written BEFORE anything is removed, so a failed or short write leaves the
 * existing database where it was rather than nothing at all; the stale incoming file is dropped
 * first so `writeFile` CREATES it and `mode` is actually applied, the reason `fs-atomic.ts` gives
 * for the same call. `rename` within one directory is atomic on POSIX, so `venue.db` is never
 * observed half-written.
 *
 * **`node.db` IS LEFT ALONE, and that differs from the wipe — deliberately recorded rather than
 * discovered.** `db-wipe.ts` removes both files of the venue directory; this replaces `venue.db` and
 * its two sidecars only. The node file is created empty and holds no table (`applyMigrations` sends
 * every set to the venue handle, `packages/migrations/src/apply.ts`), and slice 2 keeps it that way:
 * a node's own rows are keyed by node id inside `venue.db` (slice-2 spec §2). A slice that puts
 * tables into `node.db` has to decide here whether a restore carries, clears or keeps them.
 */
export async function restoreDatabase(args: {
  dumpBytes: Uint8Array;
  venueDir: string;
  log: Logger;
}): Promise<string> {
  // The restore may be the first thing that ever writes here. An existing directory's permissions
  // belong to the operator and are not changed by mkdir.
  await mkdir(args.venueDir, { recursive: true, mode: 0o700 });
  const target = join(args.venueDir, VENUE_FILE);
  const incoming = `${target}${INCOMING_SUFFIX}`;
  await rm(incoming, { force: true });
  try {
    await writeFile(incoming, args.dumpBytes, { mode: VENUE_FILE_MODE, flag: "w" });
    for (const suffix of ["", ...VENUE_SIDECARS]) {
      await rm(`${target}${suffix}`, { force: true });
    }
    await rename(incoming, target);
  } catch (error) {
    await rm(incoming, { force: true });
    throw error;
  }
  args.log("info", "restore.db.placed", { bytes: args.dumpBytes.byteLength });
  return target;
}

/**
 * Restore every `secrets/<path>` entry into `stateDir`, prefix stripped, via `unpackBundleToDir` —
 * which re-applies the same traversal guard AND writes each file 0600 atomically, exactly as the
 * recovery-bundle unpack does. Exposed for R3 (which SKIPS this step: a mirror restore keeps its own
 * identity). Secret contents are utf8 text (`RECOVERY_FILES` are `.env`/PEM), matching the utf8 they
 * were read as into the archive. `trading.env` is written last, after every other secret succeeds;
 * failure during that final atomic write can leave a temporary file, but cannot publish a partial identity.
 */
export async function restoreSecrets(args: {
  entries: readonly ArchiveEntry[];
  stateDir: string;
  log: Logger;
}): Promise<void> {
  const files: BundleFiles = {};
  for (const entry of args.entries) {
    if (entry.name === TRADING_ENV_ENTRY) continue;
    files[entry.name.slice(SECRETS_PREFIX.length)] = Buffer.from(entry.bytes).toString("utf8");
  }
  const identity = args.entries.find((entry) => entry.name === TRADING_ENV_ENTRY);
  if (identity !== undefined)
    files[TRADING_ENV_FILE] = Buffer.from(identity.bytes).toString("utf8");
  await unpackBundleToDir(files, args.stateDir);
  args.log("info", "restore.secrets.done", { count: args.entries.length });
}

/**
 * Move a pre-existing identity aside before anything irreversible: `<stateDir>/trading.env` →
 * `trading.env.replaced` (boot reads only the former). With the artifact's identity written only
 * after the hook transaction commits, a successful set-aside leaves NO bootable identity until the
 * secrets write — neither the target's old one nor the artifact's. A missing file is the normal
 * fresh-box case.
 */
export async function setAsideExistingIdentity(stateDir: string, log: Logger): Promise<void> {
  const path = join(stateDir, TRADING_ENV_FILE);
  try {
    await rename(path, `${path}${REPLACED_SUFFIX}`);
    log("info", "restore.identity.set_aside", {});
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/**
 * The identity the restored box will take, read from the ARTIFACT's `secrets/trading.env` — never the
 * target box's file, which may hold a stale or foreign identity. Every key is required and non-empty
 * (`isUnset`): a backup of a never-provisioned box has no node to re-register. `validateArtifact`
 * checks this before set-aside or database restore unless `skipSecrets` keeps the target's identity.
 */
export function readArtifactIdentity(secretEntries: readonly ArchiveEntry[]): {
  node: ProvisionedNode;
  seriesId: string;
} {
  const entry = secretEntries.find((e) => e.name === TRADING_ENV_ENTRY);
  if (entry === undefined) {
    throw new AppError("restore.identity_incomplete", { missing: TRADING_ENV_FILE });
  }
  const env = parseEnvFile(Buffer.from(entry.bytes).toString("utf8"));
  for (const key of IDENTITY_KEYS) {
    if (isUnset(env[key])) throw new AppError("restore.identity_incomplete", { missing: key });
  }
  return {
    node: {
      locationId: brandLocationId(env.WAITRON_TILL_LOCATION_ID!),
      nodeId: brandNodeId(env.WAITRON_TILL_NODE_ID!),
    },
    seriesId: env.WAITRON_TILL_SERIES_ID!,
  };
}

/** The secret entries with `trading.env`'s `WAITRON_TILL_SERIES_ID` replaced; every other key and the
 * key order preserved (`parseEnvFile` skips comments and blank lines). */
export function rewriteTradingEnv(
  entries: readonly ArchiveEntry[],
  seriesId: string,
): ArchiveEntry[] {
  return entries.map((e) =>
    e.name === TRADING_ENV_ENTRY
      ? {
          name: e.name,
          bytes: Buffer.from(
            formatEnvFile({
              ...parseEnvFile(Buffer.from(e.bytes).toString("utf8")),
              WAITRON_TILL_SERIES_ID: seriesId,
            }),
          ),
        }
      : e,
  );
}

function wrapHookError(module: string, err: unknown): unknown {
  return isAppError(err) ? new AppError("restore.hook_failed", { module, code: err.code }) : err;
}

/**
 * Run every module's `backup.restore` hook and settle the node's series, in ONE tenant
 * transaction. Order: check the node exists → hooks in
 * list order → at most one module may return `series` → if one did, retire the node's live series and
 * open the returned ones → on EVERY path read the live standard series id — zero or two live standard
 * series aborts the transaction, so a commit leaves exactly one live standard series. Returns that id
 * (the env is pointed at it) and the hooks' reports.
 */
export async function runRestoreHooks(args: {
  db: Database;
  modules: readonly WaitronModule[];
  node: ProvisionedNode;
  log: Logger;
}): Promise<{ seriesId: string; reports: readonly string[] }> {
  const { node } = args;
  return withTransaction(args.db, async (tx) => {
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
        outcome = await hook(tx, node);
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
    try {
      if (replacement !== undefined) {
        await retireNodeSeriesTx(tx, node.nodeId);
        await insertNodeSeriesTx(tx, node.nodeId, replacement.series);
      }
      const seriesId = await readStandardSeriesIdTx(tx, node.nodeId);
      return { seriesId, reports };
    } catch (err) {
      throw wrapHookError(owner, err);
    }
  });
}

/**
 * The hook transaction's handle: the VENUE file of the directory just restored into.
 *
 * `close` closes BOTH files, not just the venue one — `openVenueDatabase` opens `node.db` beside it
 * and a handle left open would hold the restored directory for the life of the process.
 */
async function openVenue(directory: string): Promise<{ db: Database; close(): Promise<void> }> {
  const store = await openVenueDatabase(directory);
  return { db: store.venue, close: () => store.close() };
}
