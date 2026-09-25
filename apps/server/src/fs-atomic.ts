import { writeFile, rename, rm } from "node:fs/promises";

/** Where {@link stageFile} writes `path`'s working copy. */
export function stagedPath(path: string): string {
  return `${path}.tmp`;
}

/**
 * Write `data` to `${path}.tmp` (same directory, so a later `rename` onto `path` is atomic on POSIX)
 * and return that working path; `path` itself is untouched.
 *
 * Any stale `${path}.tmp` is REMOVED first, because `writeFile` applies `mode` only when it CREATES
 * the file: a reused stale tmp would carry its old, possibly broader permissions onto a secret.
 */
export async function stageFile(
  path: string,
  data: string | Uint8Array,
  mode: number,
): Promise<string> {
  const tmp = stagedPath(path);
  await rm(tmp, { force: true });
  await writeFile(tmp, data, { mode, flag: "w" });
  return tmp;
}

/**
 * {@link stageFile}, then rename the working copy onto `path`, so a reader sees `path` absent or
 * whole. Atomic VISIBILITY only: it does not fsync.
 */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  mode: number,
): Promise<void> {
  await rename(await stageFile(path, data, mode), path);
}
