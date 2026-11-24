import { cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Database } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { sql } from "drizzle-orm";

/**
 * Builds in `into` the layout `scripts/copy-migrations.mjs` builds beside the bundle, for
 * `WAITRON_MIGRATIONS_DIR`: `boot.ts`'s default migrations root exists only there.
 */
export async function copyMigrationsRoot(into: string): Promise<void> {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(into, set.name), {
      recursive: true,
    });
  }
}

export const TRADING_BOOT_KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

export function tradingBootEnv(
  db: Database,
  stateDir: string,
  nodeId: string,
  migrationsRoot: string,
) {
  const database = db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  return {
    ...TRADING_BOOT_KEY_ENV,
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_STATE_DIR: stateDir,
    WAITRON_VENUE_DIR: dirname(database),
    WAITRON_NODE_ID: nodeId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
  };
}
