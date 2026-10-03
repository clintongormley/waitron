// Side-effect only: registers this package's error codes (./errors.ts).
import "./errors.js";
import { AppError, compareDecimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";

/**
 * Refuses, with `sale.total_exceeds_simplified_limit`, a sale with no named customer whose total is
 * over `limit` — the fiscal regime's `FiscalBackend.simplifiedInvoiceLimit`. A total equal to the
 * limit passes, and so does every total when `limit` is null.
 */
export function refuseOverSimplifiedLimit(limit: Decimal | null, total: Decimal): void {
  if (limit !== null && compareDecimal(total, limit) > 0) {
    throw new AppError("sale.total_exceeds_simplified_limit", { total, limit });
  }
}
