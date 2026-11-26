import { readDiscountNotices, type EndedDiscount } from "@waitron/adjustments";
import { workingOrderLines, type Transaction } from "@waitron/db";
import {
  AppError,
  addDecimal,
  compareDecimal,
  decimal,
  type Decimal,
  type DiscountNotice,
} from "@waitron/shared";
import { inIds } from "./in-ids.js";
import "./errors.js";

/**
 * The line to give an ended comp or discount again on: the dish whose extras or variant changed.
 * A set menu's answers null (D54); staff choose in the comp window.
 */
function reapplyOn(ended: EndedDiscount): DiscountNotice["reapplyOn"] {
  return ended.lineId === null ? null : { lineId: ended.lineId };
}

/** The endings among `billIds` that a notice still shows: a dish's goes once its line has left the
 * bill. */
async function shownEndings(tx: Transaction, billIds: readonly string[]): Promise<EndedDiscount[]> {
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
  return ended.filter(
    ({ lineId, workingOrderId }) => lineId === null || billOfLine.get(lineId) === workingOrderId,
  );
}

/** Each bill's notices among `billIds`; a bill with none has no entry. */
export async function readBillsDiscountNotices(
  tx: Transaction,
  billIds: readonly string[],
): Promise<Map<string, DiscountNotice[]>> {
  const byBill = new Map<string, DiscountNotice[]>();
  for (const one of await shownEndings(tx, billIds)) {
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

const ZERO = decimal("0.00");

const refused = () => new AppError("management.request_invalid", { field: "reapplies" });

/** Refuses `reapplies` unless it names a notice open on `orderId` and, when the notice names a
 * line, the ask gives it on, or on a row holding, a line one of its shown endings names. Answers
 * those lines, for {@link requireNoticedLineTaken}; null when nothing needs checking. */
export async function requireOpenNotice(
  tx: Transaction,
  ask: { orderId: string; reapplies?: string; lineId: string | null; lineIds?: string[] },
): Promise<ReadonlySet<string> | null> {
  if (ask.reapplies === undefined) return null;
  const shown = (await shownEndings(tx, [ask.orderId])).filter(
    ({ adjustmentId }) => adjustmentId === ask.reapplies,
  );
  if (shown.length === 0) throw refused();
  if (shown[0]!.lineId === null) return null;
  const noticed = new Set(shown.flatMap(({ lineId }) => (lineId === null ? [] : [lineId])));
  if (![ask.lineId, ...(ask.lineIds ?? [])].some((id) => id !== null && noticed.has(id))) {
    throw refused();
  }
  return noticed;
}

/** Refuses a reapplication whose priced rows take nothing off a `noticed` dish or its extras:
 * part of a till row is taken from its last portions, which need not be the one the notice names. */
export function requireNoticedLineTaken(
  noticed: ReadonlySet<string> | null,
  writes: readonly { row: { id: string; parentLineId: string | null }; reduction: Decimal }[],
): void {
  if (noticed === null) return;
  const taken = writes.some(
    ({ row, reduction }) =>
      noticed.has(row.parentLineId ?? row.id) && compareDecimal(reduction, ZERO) !== 0,
  );
  if (!taken) throw refused();
}
