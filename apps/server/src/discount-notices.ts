import { readDiscountNotices, type EndedDiscount } from "@waitron/adjustments";
import { workingOrderLines, type Transaction } from "@waitron/db";
import { AppError, addDecimal, decimal, type DiscountNotice } from "@waitron/shared";
import { inIds } from "./in-ids.js";
import "./errors.js";

/**
 * The line to give an ended comp or discount again on: the dish whose extras or variant changed.
 * A set menu's answers null (D54); staff choose in the comp window.
 */
function reapplyOn(ended: EndedDiscount): DiscountNotice["reapplyOn"] {
  return ended.lineId === null ? null : { lineId: ended.lineId };
}

/** Each bill's notices among `billIds`; a bill with none has no entry. A dish's notice goes once
 * its line has left the bill. */
export async function readBillsDiscountNotices(
  tx: Transaction,
  billIds: readonly string[],
): Promise<Map<string, DiscountNotice[]>> {
  const ended = await readDiscountNotices(tx, billIds);
  const lineIds = ended.flatMap(({ lineId }) => (lineId === null ? [] : [lineId]));
  const billOfLine = new Map(
    lineIds.length === 0
      ? []
      : (
          await tx
            .select({ id: workingOrderLines.id, billId: workingOrderLines.workingOrderId })
            .from(workingOrderLines)
            .where(inIds(workingOrderLines.id, lineIds))
        ).map(({ id, billId }) => [id, billId]),
  );
  const byBill = new Map<string, DiscountNotice[]>();
  for (const one of ended) {
    if (one.lineId !== null && billOfLine.get(one.lineId) !== one.workingOrderId) continue;
    const notices = byBill.get(one.workingOrderId) ?? [];
    const held = notices.find(({ adjustmentId }) => adjustmentId === one.adjustmentId);
    if (held !== undefined) {
      held.amount = addDecimal(decimal(held.amount), one.givenBack);
      continue;
    }
    notices.push({
      adjustmentId: one.adjustmentId,
      why: one.why,
      dishName: one.dishName,
      on: one.lineName!,
      action: one.action as DiscountNotice["action"],
      percentBp: one.percentBp,
      amount: one.givenBack,
      reasonId: one.reasonId,
      reapplyOn: reapplyOn(one),
    });
    byBill.set(one.workingOrderId, notices);
  }
  return byBill;
}

/** The bill's `discountNotices`, absent when it has none. */
export function discountNoticesOf(
  notices: ReadonlyMap<string, DiscountNotice[]>,
  billId: string,
): { discountNotices?: DiscountNotice[] } {
  const found = notices.get(billId);
  return found === undefined ? {} : { discountNotices: found };
}

/** Refuses `reapplies` unless it names a notice open on `orderId` and, when the notice names a
 * line, the ask gives it on that line or on a row holding it. */
export async function requireOpenNotice(
  tx: Transaction,
  ask: { orderId: string; reapplies?: string; lineId: string | null; lineIds?: string[] },
): Promise<void> {
  if (ask.reapplies === undefined) return;
  const open = (await readBillsDiscountNotices(tx, [ask.orderId])).get(ask.orderId) ?? [];
  const notice = open.find(({ adjustmentId }) => adjustmentId === ask.reapplies);
  const on = notice?.reapplyOn?.lineId;
  if (
    notice === undefined ||
    (on !== undefined && ask.lineId !== on && !(ask.lineIds ?? []).includes(on))
  ) {
    throw new AppError("management.request_invalid", { field: "reapplies" });
  }
}
