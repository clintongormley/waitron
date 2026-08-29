import { join } from "node:path";
import { writeFileAtomic } from "./fs-atomic.js";
import { formatEnvFile } from "./env-file.js";

/**
 * The provisioned identity of a single till, written out as the env the supervisor sources on the
 * next boot so the box enters TRADING mode. The five *Id fields become the `WAITRON_TILL_*_ID`
 * config the till reads; `databaseUrl`/`migrationsDatabaseUrl`/`syncDatabaseUrl` and `environment`
 * are the same connections + `WAITRON_ENV` the running server expects (`syncDatabaseUrl` is the
 * mirror's own sync pool, read back at a mirror boot — see its field note below).
 */
export interface TradingConfig {
  tenantId: string;
  tillId: string;
  nodeId: string;
  seriesId: string;
  locationId: string;
  databaseUrl: string;
  migrationsDatabaseUrl: string;
  /**
   * The mirror's OWN least-privileged sync-pool connection (a `sync_applier` LOGIN role), written out
   * as `WAITRON_SYNC_DATABASE_URL`. It is the value `loadMirrorSyncConfig` (config.ts) reads back at
   * the next boot to enter mirror mode; without it in `trading.env` an adopted mirror throws
   * `server.config_missing` at reboot and never boots into mirror mode — which is why the ADOPT path
   * always supplies it (guaranteed non-empty by boot's adopt guard, Ruling 1).
   *
   * OPTIONAL because the PRIMARY provision path does not need it (a fresh primary has no sync peers
   * yet, so its trading boot never reads `WAITRON_SYNC_DATABASE_URL`): the provision writer omits it
   * and `writeTradingEnv` then emits no `WAITRON_SYNC_DATABASE_URL` line at all, rather than a blank
   * `WAITRON_SYNC_DATABASE_URL=` a later `loadSyncConfig` would read as missing (the "empty connection
   * string is a valid connection string" trap, CLAUDE.md §3).
   */
  syncDatabaseUrl?: string;
  environment: "production" | "preproduction";
}

/**
 * Atomically write `<stateDir>/trading.env` (`KEY=value\n`, 0600) — the file the supervisor sources
 * on the next boot so the five `WAITRON_TILL_*_ID` + `DATABASE_URL`(+migrations, +sync on a MIRROR) +
 * `WAITRON_ENV` are present and the box boots in TRADING mode. Sibling to 2a's secrets.env (left
 * untouched). Returns the path written.
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
    // Conditionally present, never a blank line: an adopted MIRROR always carries it (boot's adopt
    // guard, Ruling 1), so this line is always written for a mirror; a provisioned PRIMARY omits it
    // (it has no sync peers yet), so no `WAITRON_SYNC_DATABASE_URL=` reaches a later `loadSyncConfig`
    // as the empty string that reads as missing (CLAUDE.md §3).
    ...(cfg.syncDatabaseUrl === undefined
      ? {}
      : { WAITRON_SYNC_DATABASE_URL: cfg.syncDatabaseUrl }),
    WAITRON_ENV: cfg.environment,
  });
  await writeFileAtomic(path, body, 0o600);
  return path;
}
