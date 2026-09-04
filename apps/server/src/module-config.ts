import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { parseModuleConfig, type ModuleConfig } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";

const KNOWN = ALL_MODULES.map((m) => m.name);

/**
 * Read `<stateDir>/modules.json` into the desired ModuleConfig (spec §2). Absent file = every module
 * enabled (today's behaviour). A present-but-unparseable file is reported as `module.config_invalid`
 * rather than a bare `SyntaxError`, so a hand-edited file fails with a classified, actionable code.
 * Read at boot before migrations (spec §1.3) — the enabled set is not a DB row.
 */
export async function readModuleConfig(stateDir: string): Promise<ModuleConfig> {
  let text: string;
  try {
    text = await readFile(join(stateDir, "modules.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return parseModuleConfig({}, KNOWN); // no file → all enabled
    }
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError("module.config_invalid", { reason: "modules.json is not valid JSON" });
  }
  return parseModuleConfig(raw, KNOWN);
}
