import { SECRETS_ENV_FILE, TRADING_ENV_FILE, BACKUP_ENV_FILE } from "@waitron/store";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnvFile } from "./env-file.js";
import { isUnset } from "./env-value.js";

/** Order matters: a later file's value wins over an earlier one's. */
const FILES = [SECRETS_ENV_FILE, TRADING_ENV_FILE, BACKUP_ENV_FILE] as const;

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
  delete fromFiles.WAITRON_VENUE_DIR;
  const merged: Record<string, string | undefined> = { ...fromFiles };
  for (const [k, v] of Object.entries(base)) {
    // An empty value is unset (`env-value.ts`), so it never masks a file value: compose passes
    // the backup variables as `${VAR:-}`, which is "".
    if (!isUnset(v)) merged[k] = v;
  }
  return merged;
}

const KEY_RING_VARIABLES = [
  "WAITRON_CREDENTIALS_KEY",
  "WAITRON_CREDENTIALS_KEY_VERSION",
  "WAITRON_CREDENTIALS_KEY_PREVIOUS",
  "WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION",
] as const;

/** The vault key variables `env` sets non-empty: the ones that win over `secrets.env` at every start. */
export function keyRingVariables(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const set: Record<string, string> = {};
  for (const name of KEY_RING_VARIABLES) {
    const value = env[name];
    if (!isUnset(value)) set[name] = value;
  }
  return set;
}
