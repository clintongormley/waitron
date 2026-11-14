import { and, eq } from "drizzle-orm";
import { sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { saleId as brandSaleId } from "@waitron/shared";
import type { SaleId } from "@waitron/shared";

/**
 * The invoice a correction of `saleId` is filed against: its replacement when it has one, since
 * that is the invoice AEAT holds in the sale's place, else the sale itself. A sale has at most one
 * replacement (`sale.replacement_not_first`).
 */
export async function correctionTargetFor(tx: Transaction, saleId: SaleId): Promise<SaleId> {
  const [replacement] = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(and(eq(sales.correctsSaleId, saleId), eq(sales.replacesOriginal, true)));
  return replacement === undefined ? saleId : brandSaleId(replacement.id);
}
