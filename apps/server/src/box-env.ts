import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnvFile } from "./env-file.js";
import { isUnset } from "./env-value.js";

/** Later files win over earlier ones: `trading.env` is rewritten by provisioning and by a promote,
 *  so it is the most recent statement of the box's identity. `backup.env` is the wizard's file and
 *  is read last. */
const FILES = ["instance.env", "secrets.env", "trading.env", "backup.env"] as const;

/**
 * The environment `startServer` is handed: the box's own env files merged under the real
 * environment. A NON-EMPTY variable in `base` wins over a file — that is what lets a cloud profile
 * inject the vault key without the box having a `secrets.env` at all. An EMPTY base value does not
 * mask a file value: `""` is unset everywhere in this codebase (`env-value.ts`), and compose passes
 * the backup vars as `${VAR:-}` → `""`, which must not silently disable a file-configured backup
 * (spec 2026-09-09-backup-recovery-key-wizard-design.md §3.2, Blocker 1).
 *
 * A missing file is normal (a setup box has no `trading.env`) and is skipped; an unreadable one is
 * skipped too rather than thrown, so a damaged file cannot be the thing that stops a box booting
 * into the recovery path that exists to fix it.
 */
export async function loadBoxEnv(
  base: NodeJS.ProcessEnv,
  stateDir: string,
): Promise<NodeJS.ProcessEnv> {
  const fromFiles: Record<string, string> = {};
  for (const name of FILES) {
    try {
      Object.assign(fromFiles, parseEnvFile(await readFile(join(stateDir, name), "utf8")));
    } catch {
      continue;
    }
  }
  const merged: Record<string, string | undefined> = { ...fromFiles };
  for (const [k, v] of Object.entries(base)) {
    // A real-env value wins ONLY when non-empty — an empty string is "unset"
    // everywhere in this codebase (env-value.ts), and compose passes backup vars
    // as `${VAR:-}` → "", which must not mask a file value (spec §3.2, Blocker 1).
    if (!isUnset(v)) merged[k] = v;
  }
  return merged;
}
