import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnvFile } from "./env-file.js";
import { isUnset } from "./env-value.js";

/** Order matters: a later file's value wins over an earlier one's. */
const FILES = ["secrets.env", "trading.env", "backup.env"] as const;

/**
 * The box's env files merged under the real environment. A non-empty variable in `base` wins over a
 * file, which lets a cloud profile inject the vault key without a `secrets.env`. A missing or
 * unreadable file is skipped, so a damaged file cannot stop a box booting into the recovery path
 * that exists to fix it.
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
    // An empty value is unset (`env-value.ts`), so it never masks a file value: compose passes
    // the backup variables as `${VAR:-}`, which is "".
    // Spec: 2026-09-09-backup-recovery-key-wizard-design.md §3.2.
    if (!isUnset(v)) merged[k] = v;
  }
  return merged;
}
