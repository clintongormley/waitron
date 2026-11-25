import { inArray, sql } from "drizzle-orm";
import { nowIso, type Transaction } from "@waitron/db";
import { payments } from "./schema/payments.js";

/**
 * Moves the card provider rows of `billPaymentIds` to `toWorkingOrderId`, after their bill payments
 * moved there off an abandoned printed bill (Reopen to split). A row linked to `fromSaleId`, the
 * credited ticket, goes back to no sale, as a card part payment on an open bill has none until the
 * bill's own ticket links it.
 */
export async function carryProviderRows(
  tx: Transaction,
  params: { billPaymentIds: readonly string[]; toWorkingOrderId: string; fromSaleId: string },
): Promise<void> {
  await tx
    .update(payments)
    .set({
      workingOrderId: params.toWorkingOrderId,
      saleId: sql`case when ${payments.saleId} = ${params.fromSaleId} then null else ${payments.saleId} end`,
      updatedAt: nowIso(),
    })
    .where(inArray(payments.billPaymentId, [...params.billPaymentIds]));
}
