import { chmod, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { AppError } from "@waitron/shared";
import { type BundleFiles } from "./recovery-bundle.js";
import { writeFileAtomic } from "./fs-atomic.js";
import "./errors.js";

/**
 * The state-dir files a recovery bundle carries: the vault master key (`secrets.env`), the fiscal
 * identity (`trading.env`), and the CA with its key, which already-trusting devices keep trusting
 * after a restore. Not the database. Cloud installation keys are excluded: a replacement pairs with
 * its own key.
 */
export const RECOVERY_FILES = [
  "secrets.env",
  "trading.env",
  "tls/ca.crt",
  "tls/ca.key",
  "tls/server.crt",
  "tls/server.key",
] as const;

/** A missing file is `recovery.state_incomplete`: a bundle without the vault key is worthless. */
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
 * Validate one archive or bundle entry `name` against `destRoot` and return the path it is safe to
 * write to. Authenticated bytes do not prove an entry's NAME stays inside `destRoot`, so a
 * crafted-but-authentic artifact is still refused here before any write.
 *
 * `destRoot` must already exist, and `realDestRoot` is its `realpath`. `onUnsafe` must throw: each
 * caller keeps its own shipped error code. A parent this call creates is made 0700, so a secrets
 * tool adds no world-readable directory listing filenames; an existing one keeps its mode.
 */
export async function resolveSafeEntryPath(
  name: string,
  destRoot: string,
  realDestRoot: string,
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
  const realParent = await realpath(parent);
  if (realParent !== realDestRoot && !realParent.startsWith(realDestRoot + sep)) {
    onUnsafe();
  }
  return target;
}

/**
 * The inverse of `collectStateSecrets`: each file written atomically, 0600. The destination and every
 * folder between it and an entry end 0700 whether or not they already existed (`mkdir`'s mode applies
 * only to a folder it creates). No existing folder above the destination is changed (missing ones
 * are created 0700), provided nothing else changes the folders during the unpack: a folder inside
 * the destination replaced by a symlink mid-run is followed, wherever it points.
 */
export async function unpackBundleToDir(files: BundleFiles, destDir: string): Promise<void> {
  // Created before the guard's `realpath`, which fails on a missing path.
  await mkdir(destDir, { recursive: true, mode: 0o700 });
  const realDestRoot = await realpath(resolve(destDir));
  await chmod(realDestRoot, 0o700);
  for (const [rel, contents] of Object.entries(files)) {
    const target = await resolveSafeEntryPath(rel, destDir, realDestRoot, () => {
      throw new AppError("recovery.bundle_invalid", { reason: "unsafe_path" });
    });
    // Stops at the destination. Goes by path, like the write below: a folder swapped for a symlink
    // after `realpath` is followed.
    for (
      let dir = await realpath(dirname(target));
      dir.startsWith(realDestRoot + sep);
      dir = dirname(dir)
    ) {
      await chmod(dir, 0o700);
    }
    await writeFileAtomic(target, contents, 0o600);
  }
}
