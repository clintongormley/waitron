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
 * Write a decrypted `BundleFiles` map back under `destDir` — the inverse of `collectStateSecrets`,
 * used by the `waitron-recovery unpack` CLI and by tests. Each file is created 0600 via
 * `writeFileAtomic` (temp-then-rename, so a reader never sees a torn file), and any parent (`tls/`)
 * is made 0700 first. Each key is traversal-guarded two ways: a cheap LEXICAL check (rejected if
 * absolute or if it resolves outside `destDir`) rejects `../../etc/x`-style keys up front, and a
 * SYMLINK-aware check catches what the lexical one cannot — if `destDir/tls` is a pre-existing symlink
 * to somewhere outside, a lexically-fine key like `tls/server.key` would still let `mkdir`/write
 * follow the link and escape. GCM auth proves the bundle's integrity, not that its keys are the fixed
 * `RECOVERY_FILES` set, so a crafted-but-authentic bundle must not be allowed to escape `destDir`.
 */
export async function unpackBundleToDir(files: BundleFiles, destDir: string): Promise<void> {
  const destRoot = resolve(destDir);
  // The CLI unpacks to a fresh dir the operator names, so create destDir before realpath() — which
  // ENOENTs on a missing path. The old code created it lazily via the per-file mkdir(dirname(target)).
  // 0700 (subject to umask, dirs THIS call creates): a secrets tool must not leave a world-readable
  // dir that leaks filenames — matches box-secrets.ts's 0700 state-dir convention.
  await mkdir(destDir, { recursive: true, mode: 0o700 });
  const realDestRoot = await realpath(destDir);
  for (const [rel, contents] of Object.entries(files)) {
    const target = join(destDir, rel);
    if (isAbsolute(rel) || !resolve(target).startsWith(destRoot + sep)) {
      throw new AppError("recovery.bundle_invalid", { reason: "unsafe_path" });
    }
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    // Lexical guard is blind to symlinks: `mkdir` on an existing `destDir/tls -> /outside` symlink is
    // a no-op, so resolve the real parent and confirm it is still within destDir before writing.
    const realParent = await realpath(dirname(target));
    if (realParent !== realDestRoot && !realParent.startsWith(realDestRoot + sep)) {
      throw new AppError("recovery.bundle_invalid", { reason: "unsafe_path" });
    }
    await writeFileAtomic(target, contents, 0o600);
  }
}
