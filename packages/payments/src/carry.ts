import { inArray } from "drizzle-orm";
import { nowIso, type Transaction } from "@waitron/db";
import { payments } from "./schema/payments.js";

/**
 * Moves the card provider rows of `billPaymentIds` to `toWorkingOrderId`, after their bill payments
 * moved there off an abandoned printed bill (Reopen bill), with no sale: a card part payment on
 * an open bill has none until the bill's own ticket links it.
 */
export async function carryProviderRows(
  tx: Transaction,
  params: { billPaymentIds: readonly string[]; toWorkingOrderId: string },
): Promise<void> {
  if (params.billPaymentIds.length === 0) return;
  await tx
    .update(payments)
    .set({
      workingOrderId: params.toWorkingOrderId,
      saleId: null,
      updatedAt: nowIso(),
    })
    .where(inArray(payments.billPaymentId, [...params.billPaymentIds]));
}
