import { beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "@waitron/db";
import type { Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";

/** Share the migrated database; each case starts with empty invoice tables. */
export function usePurchasingDb(): { readonly db: Database } {
  const fx = usePgliteDb({ migrations: [CORE_MIGRATIONS] });
  beforeEach(async () => {
    await fx.db.execute(sql`truncate purchase_invoice_vat, purchase_invoices`);
  });
  return fx;
}
