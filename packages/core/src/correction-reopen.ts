import "./errors.js";
import { and, eq } from "drizzle-orm";
import { sales, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { signedInPerson } from "@waitron/identity";
import { AppError, saleId as brandSaleId } from "@waitron/shared";
import type { SaleId } from "@waitron/shared";
import { correctionTargetFor } from "./correction-target.js";

/** Refuses `sale.correction_reopen_invalid` { saleId, reopenedBillId, reason } unless the
 * correction credits the invoice whole (`not_whole`) and `reopenedBillId` is an open bill whose
 * `reopened_from` bill's ticket has `saleId` as its correction target (`no_reopened_bill`); then
 * refuses `session.not_open` unless `sessionId` is open. Its person authorizes, with no
 * permission: the `working_orders` triggers set that link only once, while the credited bill was
 * still placed. */
export async function authorizeReopenedCredit(
  tx: Transaction,
  /** `saleId` is already a correction target (`correctionTargetFor`). */
  args: { saleId: SaleId; reopenedBillId: string; sessionId: string; wholeInvoice: boolean },
): Promise<{ authorizedBy: string }> {
  const { saleId, reopenedBillId } = args;
  const refuse = (reason: "not_whole" | "no_reopened_bill") =>
    new AppError("sale.correction_reopen_invalid", { saleId, reopenedBillId, reason });
  if (!args.wholeInvoice) throw refuse("not_whole");
  const [ticket] = await tx
    .select({ id: sales.id })
    .from(workingOrders)
    .innerJoin(sales, eq(sales.workingOrderId, workingOrders.reopenedFrom))
    .where(and(eq(workingOrders.id, reopenedBillId), eq(workingOrders.status, "open")));
  if (ticket === undefined || (await correctionTargetFor(tx, brandSaleId(ticket.id))) !== saleId) {
    throw refuse("no_reopened_bill");
  }
  return { authorizedBy: await signedInPerson(tx, args.sessionId) };
}
