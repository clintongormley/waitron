import { beforeEach } from "vitest";
import { CORE_MIGRATIONS, purchaseInvoiceVat, purchaseInvoices } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";

/**
 * Share the migrated database; each case starts with empty invoice tables.
 *
 * Two `delete`s rather than one `truncate`: SQLite has no TRUNCATE statement at all
 * (`near "truncate": syntax error`). The lines go first and the headers second, which is the order
 * the `truncate` named them in — `purchase_invoice_vat` holds the foreign key.
 */
export function usePurchasingDb(): { readonly db: Database } {
  const fx = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  beforeEach(async () => {
    await fx.db.delete(purchaseInvoiceVat);
    await fx.db.delete(purchaseInvoices);
  });
  return fx;
}
