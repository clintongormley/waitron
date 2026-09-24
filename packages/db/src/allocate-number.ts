import { eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
// Side-effect only — nothing here is used as a value. This is what keeps `series.not_found`
// (declared in ./errors.ts via `declare module "@waitron/shared"`) visible outside this package;
// nothing in this package's own checks would catch its removal. The rule is in
// packages/shared/src/errors.ts's design comment.
import "./errors.js";
import type { Transaction } from "./client.js";
import { invoiceSeries } from "./schema/series.js";

/**
 * Allocates the next invoice number from a series.
 *
 * Strictly increasing, and never reused once used. One statement, so the read
 * of `next_number` and the write of its successor cannot be separated. There is
 * no second allocator to overlap with: one write transaction runs on the venue
 * file at a time, and the pattern is stated once, with its control, on
 * `assertExtraListForWrite` (`packages/catalogue/src/extras.ts`).
 *
 * Allocation is transactional. A rollback returns the number, and the next
 * caller receives it again; no gap appears. This is correct rather than a
 * compromise: the regulation requires strictly-increasing and never-reused
 * numbering and PERMITS gaps without requiring them, and a number that was
 * allocated inside a transaction that aborted was never used — nothing was
 * recorded under it. The property that must hold, "no two committed sales
 * share a number", is enforced by `sales_series_invoice_number_key`, UNIQUE
 * (series_id, invoice_number) on `sales` (`packages/db/src/schema/sales.ts`),
 * which does not depend on this function being correct.
 */
export async function allocateInvoiceNumber(tx: Transaction, seriesId: string): Promise<number> {
  const updated = await tx
    .update(invoiceSeries)
    .set({ nextNumber: sql`${invoiceSeries.nextNumber} + 1` })
    .where(eq(invoiceSeries.id, seriesId))
    .returning({ allocated: invoiceSeries.nextNumber });

  const row = updated[0];
  if (row === undefined) {
    throw new AppError("series.not_found", { seriesId });
  }
  // RETURNING on an UPDATE yields the NEW row, so `next_number` has already
  // been incremented. The number this caller may use is therefore the one
  // before the increment.
  return row.allocated - 1;
}
