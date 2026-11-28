import { and, asc, eq, isNull, ne, or } from "drizzle-orm";
import { linkRefundToCancels, readCancelsForRefund } from "@waitron/adjustments";
import { correctionTargetFor } from "@waitron/core";
import {
  adjustmentRefunds,
  adjustments,
  invoiceCorrectionRefunds,
  invoiceCorrections,
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
import {
  filedFamilyOf,
  filedPortionAmounts,
  isFree,
  pairFiling,
  readBillFiling,
} from "./cancellation-refund-value.js";

const ZERO = decimal("0.00");

async function readCancelsOf(tx: Transaction, workingOrderId: string) {
  const ids = await tx
    .select({ id: adjustments.id, createdAt: adjustments.createdAt })
    .from(adjustments)
    .where(
      and(
        eq(adjustments.workingOrderId, workingOrderId),
        eq(adjustments.action, "cancel"),
        eq(adjustments.refundHandoff, true),
      ),
    );
  if (ids.length === 0) return [];
  const createdAt = new Map(ids.map((row) => [row.id, row.createdAt]));
  return (
    await readCancelsForRefund(
      tx,
      ids.map((row) => row.id),
    )
  ).map((cancel) => ({ ...cancel, createdAt: createdAt.get(cancel.id)! }));
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

/** What legs of filed correctives have paid back of each cancel of `workingOrderId`, in cents. */
async function filedLegsByCancel(tx: Transaction, workingOrderId: string) {
  const rows = await tx
    .select({ adjustmentId: adjustmentRefunds.adjustmentId, amount: adjustmentRefunds.amount })
    .from(adjustmentRefunds)
    .innerJoin(adjustments, eq(adjustments.id, adjustmentRefunds.adjustmentId))
    .innerJoin(
      invoiceCorrectionRefunds,
      eq(invoiceCorrectionRefunds.tenderRefundId, adjustmentRefunds.refundId),
    )
    .innerJoin(
      invoiceCorrections,
      eq(invoiceCorrections.id, invoiceCorrectionRefunds.invoiceCorrectionId),
    )
    .where(
      and(eq(adjustments.workingOrderId, workingOrderId), eq(invoiceCorrections.state, "filed")),
    );
  const filed = new Map<string, number>();
  for (const row of rows)
    filed.set(row.adjustmentId, (filed.get(row.adjustmentId) ?? 0) + row.amount);
  return filed;
}

/** A cancel its dish's money has not all gone back to, as a corrective's links see it. */
export interface CancelOwing {
  id: string;
  /** In cents. */
  owed: number;
  createdAt: string;
}

type SaleCancels = Awaited<ReturnType<typeof readCancelsOf>>;

/** The cancels with Refund ticked on the receipt `saleId`'s bill, with that bill; null when the
 * sale has none. */
async function saleCancels(tx: Transaction, saleId: SaleId) {
  const [sale] = await tx
    .select({ workingOrderId: sales.workingOrderId })
    .from(sales)
    .where(eq(sales.id, saleId));
  if (sale?.workingOrderId == null) return null;
  return {
    workingOrderId: sale.workingOrderId,
    cancels: await readCancelsOf(tx, sale.workingOrderId),
  };
}

function cancelsByLine(
  familyOf: (lineId: string) => readonly { rowId: string }[] | undefined,
  cancels: SaleCancels,
  toLine: (filedRowId: string) => string | undefined,
  /** In cents, by cancel. */
  waitingOf: ReadonlyMap<string, number>,
  filedOf: ReadonlyMap<string, number>,
) {
  const cancelled = new Map<string, CancelShare>();
  const members = new Map<string, Set<string>>();
  const partOf = new Map<string, string>();
  const owing = new Map<string, CancelOwing[]>();
  const filedBack = new Map<string, number>();
  for (const cancel of cancels) {
    if (cancel.lineId === null || cancel.refundValue === null) continue;
    const ids = [...new Set(familyOf(cancel.lineId)?.flatMap((row) => toLine(row.rowId) ?? []))];
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
    filedBack.set(dish, (filedBack.get(dish) ?? 0) + (filedOf.get(cancel.id) ?? 0));
    if (value > back)
      owing.set(dish, [
        ...(owing.get(dish) ?? []),
        { id: cancel.id, owed: value - back, createdAt: cancel.createdAt },
      ]);
    const lines = members.get(dish) ?? new Set([dish]);
    for (const id of ids) lines.add(id);
    members.set(dish, lines);
  }
  for (const [dish, lines] of members)
    for (const id of lines) if (id !== dish && !members.has(id)) partOf.set(id, dish);
  const cancelIds = new Map(
    [...owing].map(([dish, own]) => [dish, own.map((cancel) => cancel.id)] as const),
  );
  return { cancelled, cancelIds, members, partOf, owing, filedBack };
}

const NONE: ReadonlyMap<string, number> = new Map();

/** The cancels with Refund ticked and the free dishes of the receipt `saleId`, keyed by the line
 * of `toLine` each filed row becomes: a cancel by its dish's line, which `members` maps to every
 * line of the dish's family and `partOf` maps each extra's line back to. `owing` lists each dish's
 * cancels not all paid back, oldest first; with `filedLegs`, `filedBack` is the part of `back`, in
 * cents, that legs of filed correctives paid, which those correctives already took off the dish. */
export async function cancelsAndFreeByLine(
  tx: Transaction,
  saleId: SaleId,
  toLine: (filedRowId: string) => string | undefined,
  { filedLegs, includePortions }: { filedLegs: boolean; includePortions: boolean },
) {
  const free = new Set<string>();
  const portionAmounts = new Map<string, string[]>();
  const found = await saleCancels(tx, saleId);
  if (found === null)
    return { free, portionAmounts, ...cancelsByLine(() => undefined, [], toLine, NONE, NONE) };
  const filing = await readBillFiling(tx, found.workingOrderId, saleId);
  const pairs = pairFiling(filing);
  for (const line of filing.stored.filter(isFree)) {
    const dish = filedFamilyOf(filing, pairs, line.id)?.[0];
    const id = dish === undefined ? undefined : toLine(dish.rowId);
    if (id !== undefined) free.add(id);
  }
  if (includePortions) {
    for (const row of filing.filed) {
      const id = toLine(row.id);
      const amounts = filedPortionAmounts(pairs, row);
      if (id !== undefined && amounts !== undefined) portionAmounts.set(id, amounts);
    }
  }
  const some = found.cancels.length > 0;
  const waitingOf = some ? await waitingByCancel(tx, found.workingOrderId) : NONE;
  const filedOf = some && filedLegs ? await filedLegsByCancel(tx, found.workingOrderId) : NONE;
  return {
    free,
    portionAmounts,
    ...cancelsByLine(
      (lineId) => filedFamilyOf(filing, pairs, lineId),
      found.cancels,
      toLine,
      waitingOf,
      filedOf,
    ),
  };
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
export async function correctionTargetLines(tx: Transaction, saleId: SaleId) {
  const target = await correctionTargetFor(tx, saleId);
  const lines = await filedLines(tx, target);
  if (target === saleId) return { lines, toLine: (id: string) => id };
  const byNumber = new Map(lines.map((line) => [line.lineNo, line.id]));
  const own = new Map(
    (await filedLines(tx, saleId)).map((line) => [line.id, byNumber.get(line.lineNo)]),
  );
  return { lines, toLine: (id: string) => own.get(id) };
}

/** A link to write: what of the refund `refundId` pays the cancel `adjustmentId`, in cents. */
export interface CancelLink {
  refundId: string;
  adjustmentId: string;
  amount: number;
}

/**
 * The links of a corrective's money to its dishes' cancels: each dish's cancels, in order, take up
 * to what they owe and together no more than `off`, what the corrective takes off the dish; what
 * they take is put on `legs`, its completed refunds, in order, none past its amount.
 */
export function cancelLinks(
  dishes: readonly { off: number; cancels: readonly { id: string; owed: number }[] }[],
  legs: readonly { id: string; amount: number }[],
): CancelLink[] {
  const links: CancelLink[] = [];
  let leg = 0;
  let room = legs[0]?.amount ?? 0;
  for (const dish of dishes) {
    let off = dish.off;
    for (const cancel of dish.cancels) {
      let take = Math.min(cancel.owed, off);
      off -= take;
      while (take > 0 && leg < legs.length) {
        const share = Math.min(take, room);
        if (share > 0)
          links.push({ refundId: legs[leg]!.id, adjustmentId: cancel.id, amount: share });
        take -= share;
        room -= share;
        if (room === 0) room = legs[++leg]?.amount ?? 0;
      }
    }
  }
  return links;
}

/** How a full invoice's correction ended: filed, with the corrective's `allocations`, or closed
 * unrecorded with `moneyBack` cents back. */
export type CorrectionEnd =
  | { filed: { allocations: readonly { saleLineId: string; gross: Decimal }[]; openedAt: string } }
  | { closed: { lineIds: readonly string[] | null; moneyBack: number } };

/**
 * Links the completed `legs` of a full invoice's correction on `saleId`, in order, to its dishes'
 * cancels. Filed, each dish's cancels recorded before the correction opened take up to what they
 * owe, and together no more than what the corrective takes off the dish ({@link cancelLinks});
 * closed unrecorded, the cancels on the dishes of `lineIds` (none named: every dish) take the money
 * back in their order, as a plain refund pays them.
 */
export async function linkCorrectionToCancels(
  tx: Transaction,
  saleId: SaleId,
  legs: readonly { id: string; appliedAmount: number }[],
  end: CorrectionEnd,
): Promise<void> {
  const found = await saleCancels(tx, saleId);
  if (
    found === null ||
    !found.cancels.some(
      (cancel) =>
        cancel.refundValue !== null &&
        decimalToCents(cancel.refundValue) > decimalToCents(cancel.linked),
    )
  )
    return;
  const { toLine } = await correctionTargetLines(tx, saleId);
  const filing = await readBillFiling(tx, found.workingOrderId, saleId);
  const pairs = pairFiling(filing);
  const { members, owing } = cancelsByLine(
    (lineId) => filedFamilyOf(filing, pairs, lineId),
    found.cancels,
    toLine,
    NONE,
    NONE,
  );
  const familyOf = (dish: string) => members.get(dish) ?? new Set([dish]);
  let dishes: { off: number; cancels: CancelOwing[] }[];
  if ("filed" in end) {
    const off = new Map<string, number>();
    for (const part of end.filed.allocations)
      off.set(part.saleLineId, (off.get(part.saleLineId) ?? 0) + decimalToCents(part.gross));
    dishes = [...owing].map(([dish, cancels]) => ({
      off: [...familyOf(dish)].reduce((total, id) => total + (off.get(id) ?? 0), 0),
      cancels: cancels.filter((cancel) => cancel.createdAt < end.filed.openedAt),
    }));
  } else {
    const named = end.closed.lineIds?.length ? new Set(end.closed.lineIds) : undefined;
    const cancels = [...owing]
      .filter(([dish]) => named === undefined || [...familyOf(dish)].some((id) => named.has(id)))
      .flatMap(([, own]) => own)
      .sort((a, b) =>
        a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
      );
    dishes = [{ off: end.closed.moneyBack, cancels }];
  }
  const links = cancelLinks(
    dishes,
    legs.map((leg) => ({ id: leg.id, amount: leg.appliedAmount })),
  );
  for (const leg of legs) {
    const own = links.filter((link) => link.refundId === leg.id);
    await linkRefundToCancels(tx, {
      tenderRefundId: leg.id,
      links: own.map((link) => ({
        adjustmentId: link.adjustmentId,
        amount: centsToDecimal(link.amount),
      })),
    });
  }
}
