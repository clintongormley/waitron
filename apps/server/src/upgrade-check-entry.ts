import { DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT } from "./boot.js";
import { loadConfig, resolveConfigDir } from "./config.js";
import { loadBoxEnv } from "./box-env.js";
import { checkUpgradeData, openUpgradeListener } from "./upgrade-checks.js";
import type { Logger } from "./logger.js";

export async function runUpgradeChecks(base: NodeJS.ProcessEnv, log: Logger) {
  const stateDir = resolveConfigDir(base.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT);
  const env = await loadBoxEnv(base, stateDir);
  const config = loadConfig(env, DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT);
  const listener = await openUpgradeListener(config, log);
  try {
    return await checkUpgradeData(config, env);
  } finally {
    await listener.close();
  }
}
