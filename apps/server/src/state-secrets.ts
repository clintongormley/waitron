import { mkdir, readFile } from "node:fs/promises";
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
 * is made 0700 first. Each key is traversal-guarded (rejected if absolute or if it resolves outside
 * `destDir`): GCM auth proves the bundle's integrity, not that its keys are the fixed
 * `RECOVERY_FILES` set, so a crafted-but-authentic bundle carrying a key like `../../etc/x` must not
 * be allowed to escape `destDir` via `join`.
 */
export async function unpackBundleToDir(files: BundleFiles, destDir: string): Promise<void> {
  const destRoot = resolve(destDir);
  for (const [rel, contents] of Object.entries(files)) {
    const target = join(destDir, rel);
    if (isAbsolute(rel) || !resolve(target).startsWith(destRoot + sep)) {
      throw new AppError("recovery.bundle_invalid", { reason: "unsafe_path" });
    }
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFileAtomic(target, contents, 0o600);
  }
}
