import { join } from "node:path";
import { writeFileAtomic } from "./fs-atomic.js";
import { formatEnvFile } from "./env-file.js";

/**
 * The provisioned identity of a single till, written out as the env the supervisor sources on the
 * next boot so the box enters TRADING mode. The five *Id fields become the `WAITRON_TILL_*_ID`
 * config the till reads; `databaseUrl`/`migrationsDatabaseUrl` and `environment` are the same
 * connection + `WAITRON_ENV` the running server expects.
 */
export interface TradingConfig {
  tenantId: string;
  tillId: string;
  nodeId: string;
  seriesId: string;
  locationId: string;
  databaseUrl: string;
  migrationsDatabaseUrl: string;
  environment: "production" | "preproduction";
}

/**
 * Atomically write `<stateDir>/trading.env` (`KEY=value\n`, 0600) — the file the supervisor sources
 * on the next boot so the five `WAITRON_TILL_*_ID` + `DATABASE_URL`(+migrations) + `WAITRON_ENV` are
 * present and the box boots in TRADING mode. Sibling to 2a's secrets.env (left untouched). Returns
 * the path written.
 */
export async function writeTradingEnv(stateDir: string, cfg: TradingConfig): Promise<string> {
  const path = join(stateDir, "trading.env");
  const body = formatEnvFile({
    WAITRON_TILL_TENANT_ID: cfg.tenantId,
    WAITRON_TILL_TILL_ID: cfg.tillId,
    WAITRON_TILL_NODE_ID: cfg.nodeId,
    WAITRON_TILL_SERIES_ID: cfg.seriesId,
    WAITRON_TILL_LOCATION_ID: cfg.locationId,
    DATABASE_URL: cfg.databaseUrl,
    WAITRON_MIGRATIONS_DATABASE_URL: cfg.migrationsDatabaseUrl,
    WAITRON_ENV: cfg.environment,
  });
  await writeFileAtomic(path, body, 0o600);
  return path;
}
