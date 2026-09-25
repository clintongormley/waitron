// Where a one-shot operator script finds the venue it writes to. It must be the directory the server
// on the same box opens, or the script writes into a database nobody serves, so it reads the same
// variables through the same resolver `config.ts` uses.
//
// Deliberately no flag: these scripts run on a box that is already trading, where the box's own
// setting is the only directory that can be right.
import { join } from "node:path";
import { resolveConfigDir } from "../src/config.js";
import { isUnset } from "../src/env-value.js";

/**
 * Omitting `defaultStateRoot` imports `boot.ts`'s `DEFAULT_STATE_ROOT`, dynamically so a test can
 * drive every other case without loading boot's module graph. Respelling it here would resolve to
 * `scripts/state` under tsx while boot's resolves to `src/state`.
 */
export async function resolveScriptVenueDir(
  env: NodeJS.ProcessEnv,
  defaultStateRoot?: string,
): Promise<string> {
  if (!isUnset(env.WAITRON_VENUE_DIR)) return resolveConfigDir(env.WAITRON_VENUE_DIR, "");
  const root = defaultStateRoot ?? (await import("../src/boot.js")).DEFAULT_STATE_ROOT;
  const stateDir = resolveConfigDir(env.WAITRON_STATE_DIR, root);
  return resolveConfigDir(undefined, join(stateDir, "venue"));
}
