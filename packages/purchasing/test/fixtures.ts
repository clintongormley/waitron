import { afterEach, beforeEach } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";

/** Each case gets its own database so unfiltered purchase-invoice reads see only that case's fixture. */
export function usePurchasingDb(): { readonly db: Database } {
  let db: Database | undefined;
  beforeEach(async () => {
    db = await createPgliteDb();
    await runMigrations(db, CORE_MIGRATIONS);
  });
  afterEach(async () => {
    const started = db;
    db = undefined;
    if (started !== undefined) await started.close();
  });
  return {
    get db() {
      if (db === undefined) throw new Error("purchase-invoice database is not started");
      return db;
    },
  };
}
