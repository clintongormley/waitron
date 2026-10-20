// Side-effect only: registers this package's error codes (./errors.ts).
import "./errors.js";
import { UNIQUE_VIOLATION, refusalOn, sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { SaleId } from "@waitron/shared";

/**
 * Inserts one `sales` row and returns its id. A refusal by `sales_series_invoice_number_key` is
 * thrown as `sale.number_reused`; any other error is rethrown unchanged.
 */
export async function insertSale(
  tx: Transaction,
  values: typeof sales.$inferInsert,
): Promise<SaleId> {
  let inserted: { id: string } | undefined;
  try {
    [inserted] = await tx.insert(sales).values(values).returning({ id: sales.id });
  } catch (error) {
    if (
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "sales",
        columns: ["series_id", "invoice_number"],
      })
    ) {
      throw new AppError("sale.number_reused", {
        seriesId: values.seriesId,
        invoiceNumber: values.invoiceNumber,
      });
    }
    throw error;
  }

  /* v8 ignore start */
  if (inserted === undefined) {
    // This unconditional INSERT returns its row or throws on a constraint violation.
    throw new Error("sales: insert returned no row");
  }
  /* v8 ignore stop */

  return inserted.id as SaleId;
}
