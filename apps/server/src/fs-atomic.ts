import { writeFile, rename } from "node:fs/promises";

/**
 * Write `data` to `${path}.tmp` (same directory, so the following `rename` is atomic on POSIX) and
 * rename it onto `path`. A reader therefore only ever sees `path` absent or fully written — never a
 * torn/truncated file mid-write. `flag: "w"` truncates any stale `.tmp` left by an earlier crash.
 * `mode` (when given) is applied by `writeFile` on creating the temp file, and `rename` preserves it
 * on the target. This gives atomic VISIBILITY only; it does not fsync, so it makes no durability
 * claim across a power loss — only that the visible file is whole.
 */
export async function writeFileAtomic(path: string, data: string, mode?: number): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, data, mode === undefined ? { flag: "w" } : { mode, flag: "w" });
  await rename(tmp, path);
}
