import { eq } from "drizzle-orm";
import { saleSubstitutions, taxpayer, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { SaleId } from "@waitron/shared";
import "./errors.js";

export function requireSupportedCorrection(counterpartyTaxId: string | null, saleId: SaleId): void {
  if (counterpartyTaxId !== null) {
    throw new AppError("sale.correction_unsupported", { saleId });
  }
}

/** A full invoice's corrective needs an invoice naming a customer. */
export function requireFullInvoiceCorrection(
  counterpartyTaxId: string | null,
  saleId: SaleId,
): void {
  if (counterpartyTaxId === null) {
    throw new AppError("sale.correction_unsupported", { saleId });
  }
}

/**
 * A full invoice's corrective is filed against a full invoice or its replacement, never against an
 * earlier correction by differences or a full invoice made from receipts, which the regime refuses
 * only after a number is taken.
 */
export async function requireFullInvoiceOriginal(
  tx: Transaction,
  original: { correctsSaleId: string | null; replacesOriginal: boolean },
  saleId: SaleId,
): Promise<void> {
  const [exchange] = await tx
    .select({ id: saleSubstitutions.id })
    .from(saleSubstitutions)
    .where(eq(saleSubstitutions.substitutionSaleId, saleId))
    .limit(1);
  if ((original.correctsSaleId !== null && !original.replacesOriginal) || exchange !== undefined) {
    throw new AppError("sale.correction_unsupported", { saleId });
  }
}

/** The business's registered address as it is now, which every full invoice core writes names. */
export async function requireTaxpayerDomicile(tx: Transaction): Promise<string> {
  const [row] = await tx.select({ domicile: taxpayer.taxpayerDomicile }).from(taxpayer);
  if (!row?.domicile?.trim()) throw new AppError("fiscal.taxpayer_domicile_missing", {});
  return row.domicile;
}
