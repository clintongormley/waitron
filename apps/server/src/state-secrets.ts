import { mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { AppError } from "@waitron/shared";
import { type BundleFiles } from "./recovery-bundle.js";
import { writeFileAtomic } from "./fs-atomic.js";
import "./errors.js";

/**
 * The fixed set of state-dir secret/identity files a recovery bundle carries — the box's UNRECOVERABLE
 * material (the vault master key in `secrets.env`), its fiscal identity (`trading.env`), and the CA +
 * leaf that let a restored box keep the same trusted identity so already-trusting devices need not
 * re-trust. Relative to `stateDir`, posix-slashed. NOT the database — that is a separate scheduled
 * backup (slice 4b-ii). The layout mirrors `box-secrets.ts`/`trading-config.ts` which WROTE these.
 */
export const RECOVERY_FILES = [
  "secrets.env",
  "trading.env",
  "tls/ca.crt",
  "tls/ca.key",
  "tls/server.crt",
  "tls/server.key",
] as const;

/**
 * Read every `RECOVERY_FILES` path under `stateDir` into a `BundleFiles` map. A missing file is a
 * fatal `recovery.state_incomplete` (a bundle without the vault key is worthless — fail loud, name
 * the file), not a silently short bundle. Any other read error propagates unchanged.
 */
export async function collectStateSecrets(stateDir: string): Promise<BundleFiles> {
  const files: BundleFiles = {};
  for (const rel of RECOVERY_FILES) {
    try {
      files[rel] = await readFile(join(stateDir, rel), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new AppError("recovery.state_incomplete", { missing: rel });
      }
      throw err;
    }
  }
  return files;
}

/**
 * Validate ONE archive/bundle entry `name` against `destRoot` and return the resolved absolute path
 * it is safe to write to — the SINGLE home of BR-3's two-layer traversal guard, shared by
 * `unpackBundleToDir` here and `assertSafeEntryName` (`restore-entry-guard.ts`) so this
 * security-critical check lives in exactly one place. GCM/tar integrity proves an artifact's BYTES
 * are authentic, never that its entry NAMES stay inside `destRoot`, so a crafted-but-authentic
 * artifact must still be refused here before any write.
 *
 * Layer 1 — LEXICAL: reject an absolute `name` outright, and reject when `resolve(join(destRoot,
 * name))` does not land under `resolve(destRoot)` (a `../../etc/x`-style escape). Cheap, catches the
 * common case, blind to symlinks. Layer 2 — SYMLINK-aware: `mkdir(dirname(target), { recursive:
 * true })` is a no-op when that directory already "exists" through a symlink, so a pre-existing
 * `destRoot/tls -> /outside` link lets a lexically-fine name like `tls/ca.crt` resolve to a target
 * whose real, on-disk parent is `/outside`. Only `realpath`ing the parent AFTER ensuring it exists
 * reveals that. `destRoot` must already exist (its callers create it before validating any entry).
 *
 * On EITHER layer failing it calls `onUnsafe`, which MUST throw — the callback is how each caller
 * maps the one shared check to its OWN long-standing error code (`unpackBundleToDir` throws
 * `recovery.bundle_invalid{unsafe_path}`, `assertSafeEntryName` throws `restore.unsafe_entry_path`),
 * both shipped and never renamed (CLAUDE.md §3). Never writes file contents — that stays the
 * caller's job once this returns the safe path. The parent dir is created 0700 (subject to umask):
 * a secrets tool must not leave a world-readable dir that leaks filenames.
 */
export async function resolveSafeEntryPath(
  name: string,
  destRoot: string,
  onUnsafe: () => never,
): Promise<string> {
  const root = resolve(destRoot);
  const target = resolve(join(destRoot, name));
  if (isAbsolute(name) || !target.startsWith(root + sep)) {
    onUnsafe();
  }
  const parent = dirname(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  // Lexical guard is blind to symlinks: `mkdir` on an existing `destRoot/tls -> /outside` symlink is
  // a no-op, so resolve the real parent and confirm it is still within destRoot before returning.
  const realRoot = await realpath(root);
  const realParent = await realpath(parent);
  if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
    onUnsafe();
  }
  return target;
}

/**
 * Write a decrypted `BundleFiles` map back under `destDir` — the inverse of `collectStateSecrets`,
 * used by the `waitron-recovery unpack` CLI and by tests. Each file is created 0600 via
 * `writeFileAtomic` (temp-then-rename, so a reader never sees a torn file), and any parent (`tls/`)
 * is made 0700 first. Each key is traversal-guarded two ways by the shared {@link
 * resolveSafeEntryPath} — a cheap LEXICAL check (rejected if absolute or if it resolves outside
 * `destDir`) rejects `../../etc/x`-style keys up front, and a SYMLINK-aware check catches what the
 * lexical one cannot — if `destDir/tls` is a pre-existing symlink to somewhere outside, a
 * lexically-fine key like `tls/server.key` would still let `mkdir`/write follow the link and escape.
 * GCM auth proves the bundle's integrity, not that its keys are the fixed `RECOVERY_FILES` set, so a
 * crafted-but-authentic bundle must not be allowed to escape `destDir`. An unsafe key throws
 * `recovery.bundle_invalid{unsafe_path}`, this caller's long-standing code (CLAUDE.md §3).
 */
export async function unpackBundleToDir(files: BundleFiles, destDir: string): Promise<void> {
  // The CLI unpacks to a fresh dir the operator names, so create destDir before the guard's
  // realpath() — which ENOENTs on a missing path. 0700 (subject to umask, dirs THIS call creates):
  // a secrets tool must not leave a world-readable dir that leaks filenames — matches box-secrets.ts.
  await mkdir(destDir, { recursive: true, mode: 0o700 });
  for (const [rel, contents] of Object.entries(files)) {
    const target = await resolveSafeEntryPath(rel, destDir, () => {
      throw new AppError("recovery.bundle_invalid", { reason: "unsafe_path" });
    });
    await writeFileAtomic(target, contents, 0o600);
  }
}
