import { AppError } from "@waitron/shared";
import type { SaleId } from "@waitron/shared";
import "./errors.js";

export function requireSupportedCorrection(counterpartyTaxId: string | null, saleId: SaleId): void {
  if (counterpartyTaxId !== null) {
    throw new AppError("sale.correction_unsupported", { saleId });
  }
}
