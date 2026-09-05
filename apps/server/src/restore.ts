import { rm } from "node:fs/promises";
import { join } from "node:path";
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
 * Restore one encrypted backup artifact onto a fresh box, in the fixed order the flow demands:
 * decrypt → unpack → read the manifest → refuse an incompatible target (the GATE) → validate EVERY
 * entry name against its destination root (the GUARD) → restore the database, then media, then
 * secrets → invoke each enabled module's restore hook → clean staging.
 *
 * The GATE and the GUARD both run BEFORE any write, on purpose: `pg_restore` mutates the live
 * database irreversibly and media/secrets writes land permanently on disk, so a cross-environment or
 * schema-too-new manifest, or a single crafted-but-authentic entry name, must abort the whole
 * restore before the first byte is written — never after a half-restore (CLAUDE.md §5: a backup IS
 * the cold-recovery path, so a partial one must not masquerade as recovery-ready).
 *
 * This restores the fiscal ledger VERBATIM. It mints NO fresh chain, no installation number, and
 * makes the box no trade-readier — the restore hooks are the only extension seat and none exists in
 * v1. Throws `restore.archive_incomplete` for a missing `manifest.json`/`db.dump`,
 * `restore.environment_mismatch`/`restore.schema_too_new` from the gate, or
 * `restore.unsafe_entry_path` from the guard.
 */
export async function restoreFromArtifact(deps: RestoreDeps): Promise<void> {
  const { log } = deps;
  const plaintext = decryptArtifact(deps.artifact, deps.recoveryKey);
  const entries = unpackArchive(plaintext);

  const manifestEntry = entries.find((e) => e.name === MANIFEST_NAME);
  if (manifestEntry === undefined) {
    throw new AppError("restore.archive_incomplete", { missing: MANIFEST_NAME });
  }
  const manifest = JSON.parse(Buffer.from(manifestEntry.bytes).toString("utf8")) as BackupManifest;

  const dumpEntry = entries.find((e) => e.name === DB_DUMP_NAME);
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

  const mediaEntries = entries.filter((e) => e.name.startsWith(MEDIA_PREFIX));
  const secretEntries = entries.filter((e) => e.name.startsWith(SECRETS_PREFIX));

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

  const staged = join(deps.stagingDir, DB_DUMP_NAME);
  try {
    await restoreDatabase({
      dumpBytes: dumpEntry.bytes,
      stagingDir: deps.stagingDir,
      databaseUrl: deps.databaseUrl,
      runRestore: deps.runRestore ?? realPgRestore,
      log,
    });
    await restoreMedia({ entries: mediaEntries, mediaDir: deps.mediaDir, log });
    await restoreSecrets({ entries: secretEntries, stateDir: deps.stateDir, log });
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
  for (const entry of args.entries) {
    const target = await assertSafeEntryName(entry.name.slice(MEDIA_PREFIX.length), args.mediaDir);
    await writeFileAtomic(target, entry.bytes, MEDIA_FILE_MODE);
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
