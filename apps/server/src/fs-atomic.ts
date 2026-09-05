import { writeFile, rename, rm } from "node:fs/promises";

/**
 * Write `data` to `${path}.tmp` (same directory, so the following `rename` is atomic on POSIX) and
 * rename it onto `path`. A reader therefore only ever sees `path` absent or fully written — never a
 * torn/truncated file mid-write.
 *
 * Any stale `${path}.tmp` (left by an earlier crash between write and rename) is REMOVED first, so
 * `writeFile` always CREATES the temp file and its `mode` is actually applied. This is load-bearing
 * for secrets: `writeFile` only sets `mode` when it CREATES the file, so truncating-and-reusing a
 * stale tmp (`flag: "w"` on an existing file) would keep that file's OLD, possibly-broader
 * permissions and `rename` would carry them onto the target — and the SECRET callers write TLS keys,
 * `secrets.env` and `trading.env`, so a reused stale tmp could land a secret world-readable.
 * Removing it first closes that window; `rename` then preserves the freshly-created `mode` on the
 * target. `mode` is REQUIRED: every caller passes `0o600` — the secret writers rely on it, and
 * `modules.json` (module names, not a secret) matches it for a consistent state-dir — so there is no
 * default-permissions path to keep. This gives atomic VISIBILITY only; it does not fsync, so it makes
 * no durability claim across a power loss — only that the visible file is whole.
 */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  mode: number,
): Promise<void> {
  const tmp = `${path}.tmp`;
  // Drop any stale tmp so `writeFile` creates a fresh file and actually applies `mode` (a reused tmp
  // keeps its old, possibly-broader perms — a secret-leak risk on this helper's secret callers).
  await rm(tmp, { force: true });
  await writeFile(tmp, data, { mode, flag: "w" });
  await rename(tmp, path);
}
