import "./errors.js";
import { eq } from "drizzle-orm";
import { invoiceCorrections } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { authorizeApproval, type Authorization } from "@waitron/identity";
import { AppError, stringToCents } from "@waitron/shared";
import type { SaleId } from "@waitron/shared";

/** Reads the invoice_corrections row and refuses `sale.correction_approval_invalid`
 * { invoiceCorrectionId, reason } unless it exists (`not_found`), is open (`not_open`), corrects
 * `correctsSaleId` (`other_sale`), and the R5's amount, −total, is no more than its gross
 * (`over_amount`); then authorizeApproval(authorized_by, "sale.rectify"). Callers pass the
 * corrective's negative total, so −total is the amount credited. */
export async function authorizeCorrectionApproval(
  tx: Transaction,
  args: { invoiceCorrectionId: string; correctsSaleId: SaleId; total: string },
): Promise<Authorization> {
  const { invoiceCorrectionId } = args;
  const [row] = await tx
    .select({
      originalSaleId: invoiceCorrections.originalSaleId,
      gross: invoiceCorrections.gross,
      state: invoiceCorrections.state,
      authorizedBy: invoiceCorrections.authorizedBy,
    })
    .from(invoiceCorrections)
    .where(eq(invoiceCorrections.id, invoiceCorrectionId));
  const refuse = (reason: "not_found" | "not_open" | "other_sale" | "over_amount") =>
    new AppError("sale.correction_approval_invalid", { invoiceCorrectionId, reason });
  if (row === undefined) throw refuse("not_found");
  if (row.state !== "open") throw refuse("not_open");
  if (row.originalSaleId !== args.correctsSaleId) throw refuse("other_sale");
  // At the cent, as recordCorrection stores and files the total.
  if (-stringToCents(args.total) > row.gross) throw refuse("over_amount");
  return authorizeApproval(tx, { personId: row.authorizedBy, permission: "sale.rectify" });
}
