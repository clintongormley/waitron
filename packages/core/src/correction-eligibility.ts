import { taxpayer, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { SaleId } from "@waitron/shared";
import "./errors.js";

export function requireSupportedCorrection(counterpartyTaxId: string | null, saleId: SaleId): void {
  if (counterpartyTaxId !== null) {
    throw new AppError("sale.correction_unsupported", { saleId });
  }
}

/** A full invoice's corrective needs an invoice naming a customer, and is never a whole credit. */
export function requireFullInvoiceCorrection(
  counterpartyTaxId: string | null,
  saleId: SaleId,
  wholeInvoice?: boolean,
): void {
  if (counterpartyTaxId === null || wholeInvoice === true) {
    throw new AppError("sale.correction_unsupported", { saleId });
  }
}

/** A full invoice made from receipts may store its customer with no address. */
export function requireStoredCustomerAddress(address: string | null, saleId: SaleId): void {
  if (!address?.trim()) {
    throw new AppError("sale.correction_unsupported", { saleId });
  }
}

/** The business's registered address as it is now, which a full invoice's corrective names. */
export async function requireTaxpayerDomicile(tx: Transaction): Promise<string> {
  const [row] = await tx.select({ domicile: taxpayer.taxpayerDomicile }).from(taxpayer);
  if (!row?.domicile?.trim()) throw new AppError("fiscal.taxpayer_domicile_missing", {});
  return row.domicile;
}
