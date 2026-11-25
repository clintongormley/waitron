import "./errors.js";
import { and, eq } from "drizzle-orm";
import { sales, workingOrderLines, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { signedInPerson } from "@waitron/identity";
import { AppError, saleId as brandSaleId } from "@waitron/shared";
import type { SaleId } from "@waitron/shared";
import { correctionTargetFor } from "./correction-target.js";

/** Refuses `sale.correction_reopen_invalid` { saleId, reopenedBillId, reason } unless the
 * correction credits the invoice whole (`not_whole`), `reopenedBillId` is an open bill whose
 * `reopened_from` bill's ticket has `saleId` as its correction target (`no_reopened_bill`), and
 * every line of that `reopened_from` bill has a line on `reopenedBillId` with the same name,
 * product, quantity and total (`dishes_missing`); then refuses `session.not_open` unless
 * `sessionId` is open. Its person authorizes, with no permission. Only `openSplitBill`
 * (apps/server/src/split-after-print.ts) sets the link; nothing guards that. */
export async function authorizeReopenedCredit(
  tx: Transaction,
  /** `saleId` is already a correction target (`correctionTargetFor`). */
  args: { saleId: SaleId; reopenedBillId: string; sessionId: string; wholeInvoice: boolean },
): Promise<{ authorizedBy: string }> {
  const { saleId, reopenedBillId } = args;
  const refuse = (reason: "not_whole" | "no_reopened_bill" | "dishes_missing") =>
    new AppError("sale.correction_reopen_invalid", { saleId, reopenedBillId, reason });
  if (!args.wholeInvoice) throw refuse("not_whole");
  const [ticket] = await tx
    .select({ id: sales.id, billId: sales.workingOrderId })
    .from(workingOrders)
    .innerJoin(sales, eq(sales.workingOrderId, workingOrders.reopenedFrom))
    .where(and(eq(workingOrders.id, reopenedBillId), eq(workingOrders.status, "open")));
  if (ticket === undefined || (await correctionTargetFor(tx, brandSaleId(ticket.id))) !== saleId) {
    throw refuse("no_reopened_bill");
  }
  const copies = new Map<string, number>();
  for (const key of await dishKeys(tx, reopenedBillId)) copies.set(key, (copies.get(key) ?? 0) + 1);
  for (const key of await dishKeys(tx, ticket.billId!)) {
    const left = copies.get(key) ?? 0;
    if (left === 0) throw refuse("dishes_missing");
    copies.set(key, left - 1);
  }
  return { authorizedBy: await signedInPerson(tx, args.sessionId) };
}

async function dishKeys(tx: Transaction, billId: string): Promise<string[]> {
  const lines = await tx
    .select({
      name: workingOrderLines.name,
      productId: workingOrderLines.productId,
      quantity: workingOrderLines.quantity,
      lineTotal: workingOrderLines.lineTotal,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId));
  return lines.map((line) =>
    JSON.stringify([line.name, line.productId, line.quantity, line.lineTotal]),
  );
}
