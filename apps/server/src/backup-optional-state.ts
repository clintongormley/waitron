import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * State-dir files a cold restore must bring back but whose ABSENCE is a valid box state: unlike
 * `RECOVERY_FILES` (`state-secrets.ts`), a missing one is skipped, never
 * `recovery.state_incomplete`.
 */
export const OPTIONAL_BACKUP_STATE = ["backup.env", "modules.json"] as const;

/** Skips only a missing file; any other read error rethrows rather than shipping a short archive. */
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
