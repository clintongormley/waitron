import { eq } from "drizzle-orm";
import { sales, unpaidDepartures, type Transaction } from "@waitron/db";
import { correctionTargetFor } from "@waitron/core";
import { AppError, type SaleId } from "@waitron/shared";
import "./errors.js";

/**
 * Why Reopen bill refuses the bill `workingOrderId`, of the party `partyId` and printed as
 * `invoiceId`, for the bill's own state; undefined when that state admits it. Refusals staff can
 * clear and then reopen (a payment under way, a refund pending, dishes not served) are not read
 * here.
 */
export async function billReopenRefusal(
  tx: Transaction,
  workingOrderId: string,
  partyId: string | null,
  invoiceId: SaleId | undefined,
): Promise<AppError | undefined> {
  if (partyId === null) return new AppError("bill.not_at_table", { workingOrderId });
  const [departure] = await tx
    .select({ id: unpaidDepartures.workingOrderId })
    .from(unpaidDepartures)
    .where(eq(unpaidDepartures.workingOrderId, workingOrderId));
  if (departure !== undefined) return new AppError("bill.left_unpaid", { workingOrderId });
  if (invoiceId === undefined) return new AppError("bill.not_issued", { workingOrderId });
  // `recordCorrection` refuses the same invoice (`requireSupportedCorrection`), but only after
  // Reopen bill has checked the dishes.
  const target = await correctionTargetFor(tx, invoiceId);
  const [credited] = await tx
    .select({ counterpartyTaxId: sales.counterpartyTaxId })
    .from(sales)
    .where(eq(sales.id, target));
  if (credited!.counterpartyTaxId !== null)
    return new AppError("sale.correction_unsupported", { saleId: target });
  return undefined;
}
