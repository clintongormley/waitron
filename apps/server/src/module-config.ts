import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { parseModuleConfig, serializeModuleConfig, type ModuleConfig } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";
import { writeFileAtomic } from "./fs-atomic.js";

/**
 * Read `<stateDir>/modules.json` into the desired ModuleConfig (spec §2). Absent file = every module
 * enabled (today's behaviour). A present-but-unparseable file is reported as `module.config_invalid`
 * rather than a bare `SyntaxError`, so a hand-edited file fails with a classified, actionable code.
 * Read at boot before migrations (architecture §1.3) — the enabled set is not a DB row.
 */
export async function readModuleConfig(stateDir: string): Promise<ModuleConfig> {
  let text: string;
  try {
    text = await readFile(join(stateDir, "modules.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return parseModuleConfig({}, ALL_MODULES); // no file → all enabled
    }
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError("module.config_invalid", { reason: "modules.json is not valid JSON" });
  }
  return parseModuleConfig(raw, ALL_MODULES);
}

/**
 * Write `<stateDir>/modules.json` from a validated ModuleConfig (SP-1d adopt bootstrap). The inverse
 * write of `readModuleConfig`: it serializes the override map back into the `{ modules: … }` file
 * envelope. Atomic, mode 0600 to match the state-dir siblings (`trading.env`/`secrets.env`). Returns
 * the written path.
 */
export async function writeModuleConfig(stateDir: string, config: ModuleConfig): Promise<string> {
  const body = JSON.stringify({ modules: serializeModuleConfig(config) }, null, 2) + "\n";
  const path = join(stateDir, "modules.json");
  await writeFileAtomic(path, body, 0o600);
  return path;
}
