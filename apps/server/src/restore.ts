import { mkdir, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import {
  AppError,
  isAppError,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  tenantId as brandTenantId,
} from "@waitron/shared";
import {
  createPostgresDb,
  insertNodeSeriesTx,
  nodes,
  readStandardSeriesIdTx,
  retireNodeSeriesTx,
  withTenant,
  type Database,
} from "@waitron/db";
import { applyMigrations, expectedSchemaVersion, migrationOptionsFor } from "@waitron/migrations";
import { orderedMigrationSets, type ProvisionedNode, type WaitronModule } from "@waitron/module";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { isUnset } from "./env-value.js";
import { type ArchiveEntry, unpackArchive } from "./backup-archive.js";
import { decryptArtifact } from "./artifact-cipher.js";
import type { BackupManifest } from "./backup-manifest.js";
import type { DeploymentEnvironment } from "./config.js";
import { writeFileAtomic } from "./fs-atomic.js";
import type { Logger } from "./logger.js";
import { checkRestoreCompatibility } from "./restore-gate.js";
import { assertSafeEntryName } from "./restore-entry-guard.js";
import { type PgRestoreRunner, realPgRestore } from "./pg-restore.js";
import type { BundleFiles } from "./recovery-bundle.js";
import { unpackBundleToDir } from "./state-secrets.js";
import "./errors.js";

/** The fixed archive entry names this orchestrator understands, mirroring `backup-sweep.ts`'s pack
 * order: the plaintext index (`manifest.json`), the whole-DB dump (`db.dump`), the module non-DB
 * state under `media/` (content-addressed blobs), and the state secrets under `secrets/`. */
const MANIFEST_NAME = "manifest.json";
const DB_DUMP_NAME = "db.dump";
const MEDIA_PREFIX = "media/";
const SECRETS_PREFIX = "secrets/";
const TRADING_ENV_ENTRY = `${SECRETS_PREFIX}trading.env`;
const TRADING_ENV_FILE = "trading.env";
/** Where a pre-existing identity is moved before the restore; boot reads only `trading.env`. */
const REPLACED_SUFFIX = ".replaced";
const IDENTITY_KEYS = [
  "WAITRON_TILL_TENANT_ID",
  "WAITRON_TILL_NODE_ID",
  "WAITRON_TILL_LOCATION_ID",
  "WAITRON_TILL_SERIES_ID",
] as const;
/** Media blobs are public content-addressed files (`GET /media/:filename`), not secrets — 0644, not
 * the 0600 the secret writers use. The staged dump IS sensitive (whole-DB plaintext), so it is 0600. */
const MEDIA_FILE_MODE = 0o644;
const STAGED_DUMP_MODE = 0o600;
/** How many media blobs `restoreMedia` writes at once — the WRITE-direction twin of
 * `backup-sources.ts`'s `CONCURRENCY`, bounding open file descriptors so a restore of a large
 * content-addressed store (thousands of blobs) cannot exhaust them (EMFILE). Writes are to distinct
 * files, so chunk order does not matter (unlike the read side, which sorts for a deterministic archive). */
const MEDIA_WRITE_CONCURRENCY = 64;

/**
 * Everything BR-3's restore orchestrator needs to turn one encrypted backup artifact back into a
 * live box: the ciphertext + its recovery key, a privileged connection to the FRESH target database,
 * the three destination roots (media / state-secrets / a scratch staging dir), the module list (for
 * both the compatibility gate's `expectedVersions` and the restore hooks), and this binary's target
 * environment. `runRestore` is injected so a unit test drives the flow without spawning `pg_restore`;
 * it defaults to {@link realPgRestore}. `migrationsRoot` is `config.migrationsRoot` (or `null` when
 * running from source) — the same value boot feeds `expectedSchemaVersion`.
 */
export interface RestoreDeps {
  readonly artifact: Uint8Array;
  readonly recoveryKey: string;
  readonly databaseUrl: string;
  readonly mediaDir: string;
  readonly stateDir: string;
  readonly stagingDir: string;
  readonly migrationsRoot: string | null;
  readonly modules: readonly WaitronModule[];
  readonly environment: DeploymentEnvironment;
  readonly runRestore?: PgRestoreRunner;
  /** Opens the privileged connection the hook transaction runs on. Default `createPostgresDb`;
   * tests hand in a PGlite. */
  readonly openDb?: (url: string) => Promise<{ db: Database; close(): Promise<void> }>;
  /** Migrates the restored database to this binary's schema before any hook runs. Default
   * `applyMigrations`; tests stub it. */
  readonly migrate?: typeof applyMigrations;
  /** Skip restoring `secrets/*`, the set-aside of any existing identity, AND the restore hooks: a
   * returning node keeps its OWN identity, and a hook exists only to make an ASSUMED identity
   * trade-safe (spec §3.3). */
  readonly skipSecrets?: boolean;
  readonly log: Logger;
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
  readonly mediaEntries: readonly ArchiveEntry[];
  readonly secretEntries: readonly ArchiveEntry[];
}

/**
 * The whole up-front, WRITE-FREE pass of a restore: decrypt → unpack → classify entries → refuse an
 * incompatible target (the GATE) → refuse an unroutable entry → mkdir the destination roots → validate
 * EVERY entry name against its destination root (the GUARD) → check identity completeness unless
 * `skipSecrets`. Returns the classified pieces; writes NOTHING to the database and no artifact
 * content to disk (it only `mkdir`s the destination roots the guard must `realpath`). Every rejection
 * here — a wrong recovery key, a cross-environment or
 * schema-too-new manifest, a crafted entry name, an incomplete identity — is decidable from the
 * artifact bytes alone.
 *
 * The GATE and the GUARD live HERE, before any write, on purpose: `pg_restore` mutates the live
 * database irreversibly and media/secrets writes land permanently on disk, so an incompatible manifest
 * or a single crafted-but-authentic entry name must abort before the first byte is written — never
 * after a half-restore (CLAUDE.md §5). R3 rejoin runs this BEFORE its irreversible wipe so the same
 * rejections refuse the whole operation while the old database is still intact.
 *
 * Throws `restore.archive_incomplete` for a missing `manifest.json`/`db.dump`,
 * `restore.identity_incomplete` for missing identity keys/file when secrets are restored,
 * `restore.unexpected_entry` for a top-level entry it cannot route,
 * `restore.environment_mismatch`/`restore.schema_too_new` from the gate, or
 * `restore.unsafe_entry_path` from the guard (plus `recovery.passphrase_invalid`/`backup.*` from
 * decrypt/unpack).
 */
export async function validateArtifact(deps: RestoreDeps): Promise<ValidatedArtifact> {
  const plaintext = decryptArtifact(deps.artifact, deps.recoveryKey);
  const entries = unpackArchive(plaintext);

  // First-wins classification preserves rejection precedence: missing manifest → missing dump →
  // compatibility gate → unexpected entry → path guard → identity completeness.
  let manifestEntry: ArchiveEntry | undefined;
  let dumpEntry: ArchiveEntry | undefined;
  const mediaEntries: ArchiveEntry[] = [];
  const secretEntries: ArchiveEntry[] = [];
  let firstUnexpected: ArchiveEntry | undefined;
  for (const entry of entries) {
    if (entry.name === MANIFEST_NAME) manifestEntry ??= entry;
    else if (entry.name === DB_DUMP_NAME) dumpEntry ??= entry;
    else if (entry.name.startsWith(MEDIA_PREFIX)) mediaEntries.push(entry);
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

  // FAIL-VISIBLE — every entry must route somewhere, before ANY write. This orchestrator handles
  // exactly `manifest.json`, `db.dump`, `media/*` and `secrets/*`; an entry matching none of those
  // (captured as `firstUnexpected` above) would otherwise be SILENTLY dropped. BR-2 emits only those
  // four shapes today, so nothing drops now — but the day a second non-DB source id starts packing
  // `<source>/...` blobs, a silent drop would lose that data on the cold-recovery path that must not
  // lose it (CLAUDE.md §5), so refuse it LOUD here rather than proceed to a half-restore. Widening
  // the routing to accept a new source is later work; this reject is the tripwire that forces it.
  if (firstUnexpected !== undefined) {
    throw new AppError("restore.unexpected_entry", { name: firstUnexpected.name });
  }

  // Restore creates its OWN destination roots before the guard realpath's them: the backup side
  // mkdir's its staging (backup-sweep.ts `runOnce`), so the restore side must mkdir its staging AND
  // its media/state destinations, or the guard's `realpath` ENOENTs on a fresh box — after `runRejoin`
  // has already run the IRREVERSIBLE wipe, leaving the box wiped-but-not-restored. stagingDir is proven
  // by deletion in restore.test.ts (deleting all three mkdirs fails at the FIRST guard, stagingDir);
  // media/state are established by the same guard-realpath shape — the up-front guard realpaths all
  // three roots (db.dump→stagingDir, media/*→mediaDir, secrets/*→stateDir), the secret-guard loop
  // running even under `skipSecrets`. Recursive mkdir of an existing dir is a harmless no-op. These
  // are directory creations, not artifact writes — no restored content lands until `writeValidated`.
  // stagingDir (whole-DB plaintext dump) and stateDir (secrets) are created 0700, the same mode
  // `state-secrets.ts` uses for secret-bearing dirs — a world/group-readable dir would expose the
  // 0600 files inside it by traversal. `mode` applies only when the dir is CREATED here; an existing
  // dir keeps the operator's perms (mkdir does not tighten one). mediaDir is public content served at
  // `/media/*` (0644 files), so it takes the default mode like `local-fs-backend.ts`.
  await mkdir(deps.stagingDir, { recursive: true, mode: 0o700 });
  await mkdir(deps.mediaDir, { recursive: true });
  await mkdir(deps.stateDir, { recursive: true, mode: 0o700 });

  // GUARD — every entry against ITS destination root, before ANY write. The db.dump goes to
  // stagingDir, media/* to mediaDir, secrets/* to stateDir; each is guarded against the root it
  // will actually be written under, with the same prefix-stripping the writes use, so the guard
  // validates the real target and a crafted name aborts before pg_restore or any file write.
  await assertSafeEntryName(DB_DUMP_NAME, deps.stagingDir);
  for (const entry of mediaEntries) {
    await assertSafeEntryName(entry.name.slice(MEDIA_PREFIX.length), deps.mediaDir);
  }
  for (const entry of secretEntries) {
    await assertSafeEntryName(entry.name.slice(SECRETS_PREFIX.length), deps.stateDir);
  }

  if (!deps.skipSecrets) readArtifactIdentity(secretEntries);

  return { manifest, dumpEntry, mediaEntries, secretEntries };
}

/**
 * Identity completeness is checked by `validateArtifact`: refusal leaves the target intact, before
 * any set-aside or database restore. After validation, set any existing identity aside → restore
 * database and media → migrate → run module hooks and settle series in one transaction → write
 * secrets. Once the old identity is set
 * aside, a failure before the secrets write leaves no bootable identity. `skipSecrets` keeps the
 * target's identity and skips hooks.
 * The GATE and GUARD belong to `validateArtifact`; staging is cleaned even on failure.
 */
export async function writeValidated(
  validated: ValidatedArtifact,
  deps: RestoreDeps,
): Promise<void> {
  const { log } = deps;
  const staged = join(deps.stagingDir, DB_DUMP_NAME);
  try {
    if (!deps.skipSecrets) await setAsideExistingIdentity(deps.stateDir, log);
    await restoreDatabase({
      dumpBytes: validated.dumpEntry.bytes,
      stagingDir: deps.stagingDir,
      databaseUrl: deps.databaseUrl,
      runRestore: deps.runRestore ?? realPgRestore,
      log,
    });
    await restoreMedia({ entries: validated.mediaEntries, mediaDir: deps.mediaDir, log });
    // The gate admits an OLDER schema; a hook written against today's must not run against
    // yesterday's. Every module, as setup mode migrates — the CLI has no enabled-set config.
    await (deps.migrate ?? applyMigrations)(
      deps.databaseUrl,
      migrationOptionsFor(orderedMigrationSets(deps.modules), deps.migrationsRoot),
    );
    log("info", "restore.migrated", {});
    if (deps.skipSecrets) {
      log("info", "restore.identity.kept", {});
      return;
    }
    // Completeness is a validation precondition; this pure read recovers the already-checked ids.
    const identity = readArtifactIdentity(validated.secretEntries);
    const opened = await (deps.openDb ?? openPostgres)(deps.databaseUrl);
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
  } finally {
    await rm(staged, { force: true });
  }
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
 * Write the DB dump to a staging file and feed it to `pg_restore`. Exposed for R3 composition
 * (restore DB + media, skip secrets). Guards `db.dump` against `stagingDir` (defence in depth — the
 * name is a fixed literal, but a step must be safe called standalone) and writes it 0600 (whole-DB
 * plaintext). Returns the staged path so the caller can clean it; cleanup is the caller's job — a
 * restore READS the dump and WRITES the live DB, so there is no half-written artifact to fan out
 * (`pg-restore.ts`).
 */
export async function restoreDatabase(args: {
  dumpBytes: Uint8Array;
  stagingDir: string;
  databaseUrl: string;
  runRestore: PgRestoreRunner;
  log: Logger;
  signal?: AbortSignal;
}): Promise<string> {
  const inFile = await assertSafeEntryName(DB_DUMP_NAME, args.stagingDir);
  await writeFileAtomic(inFile, args.dumpBytes, STAGED_DUMP_MODE);
  args.log("info", "restore.db.staged", { bytes: args.dumpBytes.byteLength });
  await args.runRestore({ databaseUrl: args.databaseUrl, inFile, signal: args.signal });
  return inFile;
}

/**
 * Restore every `media/<file>` entry into `mediaDir`, prefix stripped, byte-for-byte (media is
 * binary — jpg/webp/png). Exposed for R3. Each name is guarded against `mediaDir` (the same two-layer
 * lexical+symlink check the orchestrator runs up front) so this is safe standalone; writes are atomic
 * (a public serve route must never read a torn blob) and 0644 (public content, not a secret).
 */
export async function restoreMedia(args: {
  entries: readonly ArchiveEntry[];
  mediaDir: string;
  log: Logger;
}): Promise<void> {
  // realpath(mediaDir) is the SAME for every entry, so compute it once here rather than once per
  // blob — `assertSafeEntryName`'s realDestRoot param exists for exactly this fan-out.
  const realMediaDir = await realpath(resolve(args.mediaDir));
  // Write in bounded-concurrency CHUNKS rather than a sequential loop or one unbounded `Promise.all`
  // — the same fan-out `backup-sources.ts` uses on the read side (see `MEDIA_WRITE_CONCURRENCY`).
  // Each entry keeps its own `assertSafeEntryName` guard (the two-layer lexical+symlink check); a
  // single unsafe name rejects its chunk's `Promise.all` and so the whole call. Distinct target
  // files mean write order is irrelevant.
  for (let i = 0; i < args.entries.length; i += MEDIA_WRITE_CONCURRENCY) {
    const chunk = args.entries.slice(i, i + MEDIA_WRITE_CONCURRENCY);
    await Promise.all(
      chunk.map(async (entry) => {
        const target = await assertSafeEntryName(
          entry.name.slice(MEDIA_PREFIX.length),
          args.mediaDir,
          realMediaDir,
        );
        await writeFileAtomic(target, entry.bytes, MEDIA_FILE_MODE);
      }),
    );
  }
  args.log("info", "restore.media.done", { count: args.entries.length });
}

/**
 * Restore every `secrets/<path>` entry into `stateDir`, prefix stripped, via `unpackBundleToDir` —
 * which re-applies the same traversal guard AND writes each file 0600 atomically, exactly as the
 * recovery-bundle unpack does. Exposed for R3 (which SKIPS this step: a mirror restore keeps its own
 * identity). Secret contents are utf8 text (`RECOVERY_FILES` are `.env`/PEM), matching the utf8 they
 * were read as into the archive.
 */
export async function restoreSecrets(args: {
  entries: readonly ArchiveEntry[];
  stateDir: string;
  log: Logger;
}): Promise<void> {
  const files: BundleFiles = {};
  for (const entry of args.entries) {
    files[entry.name.slice(SECRETS_PREFIX.length)] = Buffer.from(entry.bytes).toString("utf8");
  }
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
      tenantId: brandTenantId(env.WAITRON_TILL_TENANT_ID!),
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
 * Run every module's `backup.restore` hook and settle the node's series, in ONE tenant transaction
 * stamped with the node as sync origin (`registro_sif`/`cadenas` are enrolled on the ordered lane; a
 * later standby pulls only rows whose origin is this node). Order: check the node exists → hooks in
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
  return withTenant(
    args.db,
    node.tenantId,
    async (tx) => {
      const [known] = await tx
        .select({ id: nodes.id })
        .from(nodes)
        .where(and(eq(nodes.tenantId, node.tenantId), eq(nodes.id, node.nodeId)))
        .limit(1);
      if (known === undefined) {
        throw new AppError("restore.identity_unknown", {
          tenantId: node.tenantId,
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
          await retireNodeSeriesTx(tx, node.tenantId, node.nodeId);
          await insertNodeSeriesTx(tx, node.tenantId, node.nodeId, replacement.series);
        }
        const seriesId = await readStandardSeriesIdTx(tx, node.tenantId, node.nodeId);
        return { seriesId, reports };
      } catch (err) {
        throw wrapHookError(owner, err);
      }
    },
    { nodeId: node.nodeId },
  );
}

async function openPostgres(url: string): Promise<{ db: Database; close(): Promise<void> }> {
  const db = await createPostgresDb(url);
  return { db, close: () => db.close() };
}
