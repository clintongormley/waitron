import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The state-dir config files a backup captures OPTIONALLY — durable on-disk settings a cold restore
 * must bring back but whose ABSENCE is a valid box state, not a fault: `backup.env` (the backup
 * schedule/destinations — absent when backups are off) and `modules.json` (the enabled-module set —
 * absent when every module runs at its default). UNLIKE `RECOVERY_FILES` (`state-secrets.ts`), a
 * missing one here is skipped, never a `recovery.state_incomplete`. Captured by the SWEEP alone
 * (`backup-sweep.ts`), NOT by `collectStateSecrets`/the operator recovery-bundle download, which stays
 * the identity-only set. Restored with no restore-side change: they pack as `secrets/<name>`, which the
 * restore already writes back verbatim (`restore.ts`).
 */
export const OPTIONAL_BACKUP_STATE = ["backup.env", "modules.json"] as const;

/**
 * Read each `names` file under `stateDir` into a `{ name: contents }` map, silently skipping any that
 * is ENOENT — that is the whole point (absent-is-fine, see {@link OPTIONAL_BACKUP_STATE}). Any OTHER
 * read error (EISDIR/EACCES/…) rethrows, so a genuinely broken state dir still fails the tick rather
 * than shipping a silently short archive.
 */
export async function collectOptionalStateFiles(
  stateDir: string,
  names: readonly string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of names) {
    try {
      out[name] = await readFile(join(stateDir, name), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return out;
}
