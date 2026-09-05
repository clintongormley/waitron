import { mkdir, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AppError } from "@waitron/shared";
import { expectedSchemaVersion } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
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
  /**
   * Skip restoring `secrets/*` into `stateDir`. Default `false` (the disaster-recovery CLI restores
   * everything). R3 rejoin sets `true`: a returning node keeps its OWN identity (its identity keypair
   * / box key in `stateDir`), so it restores the primary's DB and media but NOT the primary's secrets
   * (spec §4.4). The whole up-front pass — decrypt, unpack, compatibility gate, traversal guard — still
   * runs; only the `restoreSecrets` write is elided, keeping that gate+guard a single source of truth.
   */
  readonly skipSecrets?: boolean;
  readonly log: Logger;
}

/** The context a module's `backup.restore` hook receives — the restore destinations it may need to
 * put its own non-DB state back. Declared here rather than in `@waitron/module` (whose `restore`
 * seat stays `unknown` until BR-4 gives it a body); v1 has no such hook, so this is exercised only by
 * a test's injected fake. Deliberately NO database/chain handle: BR-3 restores the ledger VERBATIM
 * and mints nothing (CLAUDE.md §5), and a restore hook has no business touching the fiscal chain. */
export interface RestoreHookContext {
  readonly mediaDir: string;
  readonly stateDir: string;
  readonly log: Logger;
}
type RestoreHook = (ctx: RestoreHookContext) => void | Promise<void>;

/**
 * The classified, validated pieces of one backup artifact — the output of {@link validateArtifact}
 * and the input to {@link writeValidated}. Everything the destructive write phase needs, decided
 * entirely from the in-memory artifact bytes: an artifact that produces one of these has passed the
 * compatibility GATE and the traversal GUARD, so a returned value is safe to write. R3 rejoin threads
 * it across the wipe (validate BEFORE the irreversible `DROP DATABASE`, write AFTER), so a bad key or
 * a rejected manifest/entry refuses with the database still intact.
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
 * EVERY entry name against its destination root (the GUARD). Returns the classified pieces; writes
 * NOTHING to the database and no artifact content to disk (it only `mkdir`s the destination roots the
 * guard must `realpath`). Every rejection here — a wrong recovery key, a cross-environment or
 * schema-too-new manifest, a crafted entry name — is decidable from the artifact bytes alone.
 *
 * The GATE and the GUARD live HERE, before any write, on purpose: `pg_restore` mutates the live
 * database irreversibly and media/secrets writes land permanently on disk, so an incompatible manifest
 * or a single crafted-but-authentic entry name must abort before the first byte is written — never
 * after a half-restore (CLAUDE.md §5). R3 rejoin runs this BEFORE its irreversible wipe so the same
 * rejections refuse the whole operation while the old database is still intact.
 *
 * Throws `restore.archive_incomplete` for a missing `manifest.json`/`db.dump`,
 * `restore.unexpected_entry` for a top-level entry it cannot route,
 * `restore.environment_mismatch`/`restore.schema_too_new` from the gate, or
 * `restore.unsafe_entry_path` from the guard (plus `recovery.passphrase_invalid`/`backup.*` from
 * decrypt/unpack).
 */
export async function validateArtifact(deps: RestoreDeps): Promise<ValidatedArtifact> {
  const plaintext = decryptArtifact(deps.artifact, deps.recoveryKey);
  const entries = unpackArchive(plaintext);

  // ONE pass classifies every entry into its bucket: the manifest, the db dump, media/* blobs,
  // secrets/* files, and the FIRST entry that routes nowhere. `??=` keeps first-wins for the two
  // singletons (matching the old `.find`) and for `firstUnexpected` (matching the old loop, which
  // threw on its first unrouted entry). The presence/unexpected checks below then run in the exact
  // same precedence as before — manifest missing → db.dump missing → gate → unexpected → guard.
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
  await mkdir(deps.stagingDir, { recursive: true });
  await mkdir(deps.mediaDir, { recursive: true });
  await mkdir(deps.stateDir, { recursive: true });

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

  return { manifest, dumpEntry, mediaEntries, secretEntries };
}

/**
 * The destructive write phase of a restore, driven by an already-{@link validateArtifact validated}
 * artifact: restore the database, then media, then secrets (SKIPPED when `skipSecrets` is set — R3
 * rejoin keeps its own identity) → invoke each enabled module's restore hook → clean staging. Assumes
 * the GATE and GUARD have already passed (its input is a `ValidatedArtifact`, which only
 * `validateArtifact` produces), so it re-runs neither — the security pass stays a single source of
 * truth. Restores the fiscal ledger VERBATIM: mints NO fresh chain and makes the box no trade-readier.
 */
export async function writeValidated(
  validated: ValidatedArtifact,
  deps: RestoreDeps,
): Promise<void> {
  const { log } = deps;
  const staged = join(deps.stagingDir, DB_DUMP_NAME);
  try {
    await restoreDatabase({
      dumpBytes: validated.dumpEntry.bytes,
      stagingDir: deps.stagingDir,
      databaseUrl: deps.databaseUrl,
      runRestore: deps.runRestore ?? realPgRestore,
      log,
    });
    await restoreMedia({ entries: validated.mediaEntries, mediaDir: deps.mediaDir, log });
    if (!deps.skipSecrets) {
      await restoreSecrets({ entries: validated.secretEntries, stateDir: deps.stateDir, log });
    }
    await invokeRestoreHooks({
      modules: deps.modules,
      mediaDir: deps.mediaDir,
      stateDir: deps.stateDir,
      log,
    });
  } finally {
    // Staging holds the whole-DB plaintext dump — remove it whether or not pg_restore succeeded, so a
    // failed restore leaves no plaintext ledger behind. `force` so cleanup is a no-op when a throw in
    // the guard/gate meant it was never staged.
    await rm(staged, { force: true });
  }
}

/**
 * Restore one encrypted backup artifact onto a fresh box: the write-free {@link validateArtifact} pass
 * (decrypt → unpack → GATE → GUARD) then the destructive {@link writeValidated} phase (db → media →
 * secrets → hooks → staging cleanup). External behaviour is exactly the two composed — the gate/guard
 * still run before any write. R3 rejoin instead calls the two halves separately, validating BEFORE its
 * irreversible wipe and writing after, so this stays the single-shot path for the disaster-recovery
 * CLI.
 *
 * This restores the fiscal ledger VERBATIM. It mints NO fresh chain, no installation number, and
 * makes the box no trade-readier — the restore hooks are the only extension seat and none exists in
 * v1. Throws `restore.archive_incomplete` for a missing `manifest.json`/`db.dump`,
 * `restore.unexpected_entry` for a top-level entry it cannot route,
 * `restore.environment_mismatch`/`restore.schema_too_new` from the gate, or
 * `restore.unsafe_entry_path` from the guard.
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
 * Invoke each enabled module's `backup.restore` hook, in list order, so a module can put its own
 * non-DB state back after the DB/media/secrets are restored. EMPTY in v1: no module declares a
 * `backup.restore` hook yet (the `@waitron/module` seat is still typed `unknown`), so the loop body
 * runs for none of `ALL_MODULES` today — the mechanism is here, the bodies land later. Exposed for
 * R3. It touches NO fiscal chain or SIF: BR-3 restores the ledger verbatim (CLAUDE.md §5).
 */
export async function invokeRestoreHooks(args: {
  modules: readonly WaitronModule[];
  mediaDir: string;
  stateDir: string;
  log: Logger;
}): Promise<void> {
  const ctx: RestoreHookContext = {
    mediaDir: args.mediaDir,
    stateDir: args.stateDir,
    log: args.log,
  };
  for (const m of args.modules) {
    const hook = m.backup?.restore;
    if (typeof hook === "function") {
      await (hook as RestoreHook)(ctx);
    }
  }
}
