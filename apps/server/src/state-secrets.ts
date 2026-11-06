import { isFirstSetupHostPath } from "@waitron/provisioning";
import { readArchiveStateFile, type ArchiveReadBudget } from "./archive-read-budget.js";
import { chmod, lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, resolve, sep } from "node:path";
import { AppError } from "@waitron/shared";
import { type BundleFiles } from "./recovery-bundle.js";
import { mkdirDurable, syncNewFolders, writeFileAtomic, writeFileDurable } from "./fs-atomic.js";
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
export async function collectStateSecrets(
  stateDir: string,
  budget?: ArchiveReadBudget,
): Promise<BundleFiles> {
  const files: BundleFiles = {};
  for (const rel of RECOVERY_FILES) {
    try {
      files[rel] = budget
        ? (await readArchiveStateFile(join(stateDir, rel), budget, `secrets/${rel}`)).toString(
            "utf8",
          )
        : await readFile(join(stateDir, rel), "utf8");
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
 * crafted-but-authentic artifact is still refused here before its file is written, and before any
 * folder is created unless the folders change during the call.
 *
 * `destRoot` must already exist, and `realDestRoot` is its `realpath`. `onUnsafe` must throw: each
 * caller keeps its own shipped error code. A parent this call creates is made 0700, so a secrets
 * tool adds no world-readable directory listing filenames; an existing one keeps its mode. With
 * `durable`, the folder holding each folder it creates is synced once the parent passes the guard.
 */
export async function resolveSafeEntryPath(
  name: string,
  destRoot: string,
  realDestRoot: string,
  onUnsafe: () => never,
  { durable = false }: { durable?: boolean } = {},
): Promise<string> {
  const root = resolve(destRoot);
  const target = resolve(join(destRoot, name));
  if (isAbsolute(name) || !target.startsWith(root + sep)) {
    onUnsafe();
  }
  const parent = dirname(target);
  const within = (real: string) => real === realDestRoot || real.startsWith(realDestRoot + sep);
  // The lexical guard is blind to links, and a recursive `mkdir` follows an existing one, so the
  // deepest folder that already exists is checked before anything is created below it.
  let existing = parent;
  while (existing !== root && !(await entryExists(existing))) existing = dirname(existing);
  if (!within(await realpath(existing))) onUnsafe();
  const created = await mkdir(parent, { recursive: true, mode: 0o700 });
  // Checked again before the write: `mkdir` follows a folder swapped for a link after the first
  // check.
  if (!within(await realpath(parent))) onUnsafe();
  if (durable) await syncNewFolders(created, parent);
  return target;
}

async function entryExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * The inverse of `collectStateSecrets`: each file written 0600, durably unless `durable` is
 * `false`. The destination and every folder between it and an entry end 0700 whether or not they
 * already existed (`mkdir`'s mode applies only to a folder it creates). No existing folder above
 * the destination is changed (missing ones are created 0700), provided nothing else changes the folders
 * during the unpack: a folder inside the destination replaced by a symlink mid-run is followed,
 * wherever it points.
 */
export async function unpackBundleToDir(
  files: BundleFiles,
  destDir: string,
  // `false` for a copy that is thrown away: the backup verifier's runs under Node's permission
  // mode, which refuses every fsync.
  { durable = true }: { durable?: boolean } = {},
): Promise<void> {
  if (Object.keys(files).some((name) => isFirstSetupHostPath(posix.normalize(name)))) {
    throw new AppError("recovery.bundle_invalid", { reason: "unsafe_path" });
  }
  // Created before the guard's `realpath`, which fails on a missing path.
  if (durable) await mkdirDurable(destDir, 0o700);
  else await mkdir(destDir, { recursive: true, mode: 0o700 });
  const realDestRoot = await realpath(resolve(destDir));
  await chmod(realDestRoot, 0o700);
  for (const [rel, contents] of Object.entries(files)) {
    const target = await resolveSafeEntryPath(
      rel,
      destDir,
      realDestRoot,
      () => {
        throw new AppError("recovery.bundle_invalid", { reason: "unsafe_path" });
      },
      { durable },
    );
    // Stops at the destination. Goes by path, like the write below: a folder swapped for a symlink
    // after `realpath` is followed.
    for (
      let dir = await realpath(dirname(target));
      dir.startsWith(realDestRoot + sep);
      dir = dirname(dir)
    ) {
      await chmod(dir, 0o700);
    }
    if (durable) await writeFileDurable(target, contents, 0o600);
    else await writeFileAtomic(target, contents, 0o600);
  }
}
