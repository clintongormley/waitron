import { DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT } from "./boot.js";
import { loadConfig, resolveConfigDir } from "./config.js";
import { loadBoxEnv } from "./box-env.js";
import { checkUpgradeData, openUpgradeListener } from "./upgrade-checks.js";
import type { Logger } from "./logger.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkUpgradeSale } from "./upgrade-sale.js";

// Run once in its own candidate process: the shared listener exits on a refused bind.
export async function runUpgradeChecks(
  base: NodeJS.ProcessEnv,
  log: Logger,
  mode: "readiness" | "sale" = "readiness",
) {
  const stateDir = resolveConfigDir(base.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT);
  const env = await loadBoxEnv(base, stateDir);
  const config = loadConfig(env, DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT);
  if (mode === "sale") return checkUpgradeSale(config, env);
  const listener = await openUpgradeListener(config, log);
  try {
    return await checkUpgradeData(config, env);
  } finally {
    await listener.close();
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2] ?? "readiness";
    if (!["readiness", "sale"].includes(mode) || process.argv.length > 3)
      throw new Error("Expected readiness or sale");
    const details = await runUpgradeChecks(
      process.env,
      (level, event, fields) =>
        process.stderr.write(JSON.stringify({ level, event, ...fields }) + "\n"),
      mode as "readiness" | "sale",
    );
    process.stdout.write(JSON.stringify([{ name: mode, ok: true, details }]) + "\n");
  } catch (error) {
    process.stderr.write(String(error instanceof Error ? error.message : error) + "\n");
    process.exitCode = 1;
  }
}
