import { writeFile, rename, rm } from "node:fs/promises";

/**
 * Write `data` to `${path}.tmp` (same directory, so the `rename` is atomic on POSIX) and rename it onto
 * `path`, so a reader sees `path` absent or whole. Atomic VISIBILITY only: it does not fsync.
 *
 * Any stale `${path}.tmp` is REMOVED first, because `writeFile` applies `mode` only when it CREATES
 * the file: a reused stale tmp would carry its old, possibly broader permissions onto a secret.
 */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  mode: number,
): Promise<void> {
  const tmp = `${path}.tmp`;
  await rm(tmp, { force: true });
  await writeFile(tmp, data, { mode, flag: "w" });
  await rename(tmp, path);
}
