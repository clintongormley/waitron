import { and, asc, eq, isNull, ne, or } from "drizzle-orm";
import { readCancelsForRefund } from "@waitron/adjustments";
import { correctionTargetFor } from "@waitron/core";
import {
  adjustmentRefunds,
  adjustments,
  refunds,
  saleLines,
  sales,
  type Transaction,
} from "@waitron/db";
import {
  addDecimal,
  centsToDecimal,
  decimal,
  decimalToCents,
  type Decimal,
  type SaleId,
} from "@waitron/shared";
import { filedFamilyOf, isFree, pairFiling, readBillFiling } from "./cancellation-refund-value.js";

const ZERO = decimal("0.00");

async function readCancelsOf(tx: Transaction, workingOrderId: string) {
  const ids = await tx
    .select({ id: adjustments.id })
    .from(adjustments)
    .where(
      and(
        eq(adjustments.workingOrderId, workingOrderId),
        eq(adjustments.action, "cancel"),
        eq(adjustments.refundHandoff, true),
      ),
    );
  return ids.length === 0
    ? []
    : readCancelsForRefund(
        tx,
        ids.map((row) => row.id),
      );
}

type CancelShare = { quantity: Decimal; owed: Decimal; back: Decimal; waiting: Decimal };

/** What card refunds still pending hold of each cancel of `workingOrderId`, in cents. */
async function waitingByCancel(tx: Transaction, workingOrderId: string) {
  const rows = await tx
    .select({ adjustmentId: adjustmentRefunds.adjustmentId, amount: adjustmentRefunds.amount })
    .from(adjustmentRefunds)
    .innerJoin(refunds, eq(refunds.id, adjustmentRefunds.refundId))
    .innerJoin(adjustments, eq(adjustments.id, adjustmentRefunds.adjustmentId))
    .where(and(eq(adjustments.workingOrderId, workingOrderId), eq(refunds.state, "pending")));
  const waiting = new Map<string, number>();
  for (const row of rows)
    waiting.set(row.adjustmentId, (waiting.get(row.adjustmentId) ?? 0) + row.amount);
  return waiting;
}

/** The cancels with Refund ticked and the free dishes of the receipt `saleId`, keyed by the line
 * of `toLine` each filed row becomes: a cancel by its dish's line, which `members` maps to every
 * line of the dish's family and `partOf` maps each extra's line back to. */
export async function cancelsAndFreeByLine(
  tx: Transaction,
  saleId: SaleId,
  toLine: (filedRowId: string) => string | undefined,
) {
  const cancelled = new Map<string, CancelShare>();
  const cancelIds = new Map<string, string[]>();
  const members = new Map<string, Set<string>>();
  const partOf = new Map<string, string>();
  const free = new Set<string>();
  const [sale] = await tx
    .select({ workingOrderId: sales.workingOrderId })
    .from(sales)
    .where(eq(sales.id, saleId));
  if (sale?.workingOrderId == null) return { cancelled, cancelIds, members, partOf, free };
  const filing = await readBillFiling(tx, sale.workingOrderId, saleId);
  const pairs = pairFiling(filing);
  for (const line of filing.stored.filter(isFree)) {
    const dish = filedFamilyOf(filing, pairs, line.id)?.[0];
    const id = dish === undefined ? undefined : toLine(dish.rowId);
    if (id !== undefined) free.add(id);
  }
  const waitingOf = await waitingByCancel(tx, sale.workingOrderId);
  for (const cancel of await readCancelsOf(tx, sale.workingOrderId)) {
    if (cancel.lineId === null || cancel.refundValue === null) continue;
    const family = filedFamilyOf(filing, pairs, cancel.lineId);
    const ids = [...new Set(family?.flatMap((row) => toLine(row.rowId) ?? []))];
    const dish = ids[0];
    if (dish === undefined) continue;
    const value = decimalToCents(cancel.refundValue);
    const back = decimalToCents(cancel.linked);
    const before = cancelled.get(dish) ?? {
      quantity: decimal("0.000"),
      owed: ZERO,
      back: ZERO,
      waiting: ZERO,
    };
    cancelled.set(dish, {
      quantity: addDecimal(before.quantity, cancel.quantity ?? decimal("0.000")),
      owed: addDecimal(before.owed, centsToDecimal(Math.max(0, value - back))),
      back: addDecimal(before.back, centsToDecimal(back)),
      waiting: addDecimal(before.waiting, centsToDecimal(waitingOf.get(cancel.id) ?? 0)),
    });
    if (value > back) cancelIds.set(dish, [...(cancelIds.get(dish) ?? []), cancel.id]);
    const lines = members.get(dish) ?? new Set([dish]);
    for (const id of ids) lines.add(id);
    members.set(dish, lines);
  }
  for (const [dish, lines] of members)
    for (const id of lines) if (id !== dish && !members.has(id)) partOf.set(id, dish);
  return { cancelled, cancelIds, members, partOf, free };
}

const filedLines = (tx: Transaction, saleId: string) =>
  tx
    .select({
      id: saleLines.id,
      lineNo: saleLines.lineNo,
      descriptions: saleLines.descriptions,
      quantity: saleLines.quantity,
      lineGross: saleLines.lineGross,
    })
    .from(saleLines)
    .where(
      and(
        eq(saleLines.saleId, saleId),
        or(isNull(saleLines.advanceRole), ne(saleLines.advanceRole, "deduction")),
      ),
    )
    .orderBy(asc(saleLines.lineNo));

/** The lines Correct invoice works on for `saleId` (a replacement's, once one took its place) and
 * the line each of `saleId`'s own filed rows became: a replacement copies them at the same line
 * numbers. */
export async function receiptLines(tx: Transaction, saleId: SaleId) {
  const target = await correctionTargetFor(tx, saleId);
  const lines = await filedLines(tx, target);
  if (target === saleId) return { lines, toLine: (id: string) => id };
  const byNumber = new Map(lines.map((line) => [line.lineNo, line.id]));
  const own = new Map(
    (await filedLines(tx, saleId)).map((line) => [line.id, byNumber.get(line.lineNo)]),
  );
  return { lines, toLine: (id: string) => own.get(id) };
}
