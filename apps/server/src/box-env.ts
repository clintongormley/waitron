import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnvFile } from "./env-file.js";

/** Later files win over earlier ones: `trading.env` is rewritten by provisioning and by a promote,
 *  so it is the most recent statement of the box's identity. */
const FILES = ["instance.env", "secrets.env", "trading.env"] as const;

/**
 * The environment `startServer` is handed: the box's own env files merged under the real
 * environment. A variable already present in `base` ALWAYS wins — that is what lets a cloud
 * profile inject the vault key without the box having a `secrets.env` at all, and it is the half of
 * "every secret can come from the environment as well as a file" this spec builds.
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
  return { ...fromFiles, ...base };
}
