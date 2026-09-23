// Where a one-shot operator script finds the venue it is about to write to.
//
// A venue is a DIRECTORY holding two SQLite files, not a connection string, so the scripts that
// used to read `DATABASE_URL` now need a path — and the path has to be the one the server on the
// same box opens, or the script writes a sale into a database nobody serves. That agreement is the
// whole reason this module exists: it reads the same variables through the same resolver
// (`resolveConfigDir`, `isUnset`) that `config.ts` builds `config.venueDir` from, and
// `venue-dir.test.ts` asserts the two answers are equal string-for-string for every case it covers,
// including the two that are easy to get wrong — a RELATIVE path, and `WAITRON_VENUE_DIR=`.
//
// There is deliberately NO flag. `waitron-provision venue` takes `--venue-dir` because an operator
// stands a venue up before the box has an env file to read; these scripts run on a box that is
// already trading, where the box's own setting is the only directory that can be right.
import { join } from "node:path";
import { resolveConfigDir } from "../src/config.js";
import { isUnset } from "../src/env-value.js";

/**
 * The venue directory for `env`: `WAITRON_VENUE_DIR` if it names one, otherwise `venue` under the
 * state directory — the `venueDir` default in `config.ts`, `join(resolvedStateDir, "venue")`, reached through the same
 * `resolveConfigDir` so an unset-or-empty value falls back rather than resolving to the cwd.
 *
 * `defaultStateRoot` is the last-resort root, and omitting it imports `boot.ts`'s
 * `DEFAULT_STATE_ROOT` — the constant the server itself defaults to. The import is DYNAMIC and
 * happens only on the path that needs it, for two reasons: a script run with `WAITRON_VENUE_DIR`
 * set never pays for `boot.ts`'s whole module graph, and a test can drive every other case without
 * loading it — the same choice `dev-setup.ts`'s `main` makes for the same constant, where
 * `DEFAULT_STATE_ROOT` is reached through `await import("../src/boot.js")` rather than a top-level
 * import). It is still paid for
 * at BUILD time — esbuild inlines the dynamic import, which measured 2.7 MB on
 * `dist/register-till.js` (7.12 MB with it, 4.41 MB with the constant replaced by a literal,
 * 2026-09-22). The alternative is respelling `new URL("state", import.meta.url)` here, where it
 * would resolve to `scripts/state` under tsx while boot's resolves to `src/state` — the divergence
 * this module exists to prevent.
 */
export async function resolveScriptVenueDir(
  env: NodeJS.ProcessEnv,
  defaultStateRoot?: string,
): Promise<string> {
  // Short-circuited on `isUnset` — the SAME predicate `resolveConfigDir` applies below, so this
  // branch can never disagree with the one it skips.
  if (!isUnset(env.WAITRON_VENUE_DIR)) return resolveConfigDir(env.WAITRON_VENUE_DIR, "");
  const root = defaultStateRoot ?? (await import("../src/boot.js")).DEFAULT_STATE_ROOT;
  const stateDir = resolveConfigDir(env.WAITRON_STATE_DIR, root);
  return resolveConfigDir(undefined, join(stateDir, "venue"));
}
