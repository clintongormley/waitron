import { BOX_FILE_VARIABLES, readVariable, type BoxFile } from "@waitron/shared";
import { KEY_RING_VARIABLES } from "@waitron/credentials";
import { SECRETS_ENV_FILE, TRADING_ENV_FILE, BACKUP_ENV_FILE } from "@waitron/store";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnvFile } from "./env-file.js";
import { isUnset } from "./env-value.js";

/** Order matters: a later file's value wins over an earlier one's. */
const FILES = [SECRETS_ENV_FILE, TRADING_ENV_FILE, BACKUP_ENV_FILE] as const;
const SETTING_NAME = /^WAITRON_[A-Z0-9_]*[A-Z0-9]$/;

/**
 * The box's env files merged under the real environment. A non-empty variable in `base` wins over a
 * file, which lets a cloud profile inject the vault key without a `secrets.env`. A missing or
 * unreadable file is skipped, so a damaged file cannot stop a box booting into the recovery path
 * that exists to fix it.
 */
export async function loadBoxEnv(
  base: NodeJS.ProcessEnv,
  stateDir: string,
  onIgnored?: (file: BoxFile, names: string[]) => void,
): Promise<NodeJS.ProcessEnv> {
  const fromFiles: Record<string, string> = {};
  for (const file of FILES) {
    let parsed: Record<string, string>;
    try {
      parsed = parseEnvFile(await readFile(join(stateDir, file), "utf8"));
    } catch {
      continue;
    }
    const owned = new Set<string>(BOX_FILE_VARIABLES[file]);
    const ignored: string[] = [];
    for (const [name, value] of Object.entries(parsed)) {
      if (owned.has(name)) fromFiles[name] = value;
      // A malformed line can contain key material where the parser expects a setting name.
      else if (SETTING_NAME.test(name)) ignored.push(name);
    }
    if (ignored.length > 0) onIgnored?.(file, ignored.sort());
  }
  const merged: Record<string, string | undefined> = { ...fromFiles };
  for (const [k, v] of Object.entries(base)) {
    // An empty value is unset (`env-value.ts`), so it never masks a file value: compose passes
    // the backup variables as `${VAR:-}`, which is "".
    if (!isUnset(v)) merged[k] = v;
  }
  return merged;
}

/** The vault key variables `env` sets non-empty: the ones that win over `secrets.env` at every start. */
export function keyRingVariables(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const set: Record<string, string> = {};
  for (const name of KEY_RING_VARIABLES) {
    const value = readVariable(env, name);
    if (!isUnset(value)) set[name] = value;
  }
  return set;
}
