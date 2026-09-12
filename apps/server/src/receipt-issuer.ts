import type { Transaction } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import type { SaleId } from "@waitron/shared";
import type { TillSaleResult } from "./till-sale.js";

/** Backends with a filed issuer provide the same identity for originals and later duplicates. */
export async function readReceiptIssuer(
  backend: FiscalBackend,
  tx: Transaction,
  saleId: SaleId,
): Promise<Pick<TillSaleResult, "issuer">> {
  const filed = await backend.filedReceiptFor(tx, saleId);
  return filed?.issuer
    ? { issuer: { venueName: filed.issuer.legalName, nif: filed.issuer.taxId } }
    : {};
}
