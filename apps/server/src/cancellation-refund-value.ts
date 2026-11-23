import { eq } from "drizzle-orm";
import { saleLineDishes, saleLines, workingOrderLines, type Transaction } from "@waitron/db";
import {
  addDecimal,
  centsToDecimal,
  decimal,
  isZeroDecimal,
  sumDecimals,
  thousandthsToDecimal,
} from "@waitron/shared";
import { readPortionBindings } from "./order-portions.js";
import { readLineCancellations, serviceQuantities } from "./line-service-state.js";

type Filed = typeof saleLines.$inferSelect;
type Stored = typeof workingOrderLines.$inferSelect;

type Value = { quantity: string; gross: string };

/** What a settled bill's refund values are read from: its stored lines in line order, its sale's
 * filed lines, the portions' bindings and the filed rows' links to portions. */
export interface BillFiling {
  stored: Stored[];
  filed: Filed[];
  bindings: Awaited<ReturnType<typeof readPortionBindings>>;
  links: { saleLineId: string; dishLineId: string }[];
}

export async function cancellationRefundValue(
  tx: Transaction,
  billId: string,
  saleId: string,
  lineId: string,
): Promise<Value | undefined> {
  return refundValueIn(await readBillFiling(tx, billId, saleId), lineId);
}

export function refundValueIn(filing: BillFiling, lineId: string): Value | undefined {
  return refundValues(filing, [lineId])[0];
}

export async function rowRefundValue(
  tx: Transaction,
  billId: string,
  saleId: string,
  lineIds: readonly string[],
): Promise<Value | undefined> {
  return rowRefundValueIn(await readBillFiling(tx, billId, saleId), lineIds);
}

/** A till row of identical portions valued as one grouped line (plan D32): the portions' count and
 * the sum of each one's filed value; none when any portion's value cannot be read. */
export function rowRefundValueIn(
  filing: BillFiling,
  lineIds: readonly string[],
): Value | undefined {
  const values = refundValues(filing, lineIds);
  if (values.some((value) => value === undefined)) return undefined;
  return {
    quantity: sumDecimals(values.map((value) => decimal(value!.quantity))),
    gross: sumDecimals(values.map((value) => decimal(value!.gross))),
  };
}

/** A dish line of a settled bill whose filed value is above €0, and its portions cancelled so far. */
export interface ShareHolder {
  line: Stored;
  value: Value;
  cancelled: number;
}

const NO_HOLDERS: { free: ShareHolder[]; paid: ShareHolder[] } = { free: [], paid: [] };

const isFree = (line: Stored) =>
  line.parentLineId === null && line.lineTotal === 0 && (line.listUnitPriceGross ?? 0) > 0;

/**
 * The bill's dish lines holding a share of what its sale filed (plan 2026-11-19 §4.3.1): free items,
 * charged €0 with a menu price above €0, and paid dishes, every other. Neither when no free item
 * holds a share.
 */
export async function readShareHolders(
  tx: Transaction,
  billId: string,
  saleId: string,
): Promise<{ free: ShareHolder[]; paid: ShareHolder[] }> {
  const stored = await readStored(tx, billId);
  if (!stored.some(isFree)) return NO_HOLDERS;
  return shareHoldersIn(tx, await readBillFiling(tx, billId, saleId, stored));
}

/** {@link readShareHolders} over a filing already read. */
export async function shareHoldersIn(
  tx: Transaction,
  filing: BillFiling,
): Promise<{ free: ShareHolder[]; paid: ShareHolder[] }> {
  if (!filing.stored.some(isFree)) return NO_HOLDERS;
  const dishes = filing.stored.filter((line) => line.parentLineId === null);
  const values = refundValues(
    filing,
    dishes.map((dish) => dish.id),
  );
  const holding = dishes.flatMap((line, i) => {
    const value = values[i];
    return value === undefined || isZeroDecimal(decimal(value.gross)) ? [] : [{ line, value }];
  });
  if (!holding.some(({ line }) => isFree(line))) return NO_HOLDERS;
  const cancelled = await readLineCancellations(
    tx,
    holding.map(({ line }) => line.id),
  );
  const holders = holding.map((holder) => ({
    ...holder,
    cancelled: cancelled.get(holder.line.id) ?? 0,
  }));
  return {
    free: holders.filter(({ line }) => isFree(line)),
    paid: holders.filter(({ line }) => !isFree(line)),
  };
}

/** Whether cancelling `off` portions (thousandths, by line id) leaves no paid dish a portion that is
 * not cancelled; a served portion is not cancelled. */
export function isLastPaidDish(
  paid: readonly ShareHolder[],
  off: ReadonlyMap<string, number>,
): boolean {
  return (
    paid.some(({ line }) => off.has(line.id)) &&
    paid.every(({ line, cancelled }) => line.quantity - cancelled - (off.get(line.id) ?? 0) === 0)
  );
}

/** The paid dishes, with their unserved portions (thousandths), whose cancel with Refund ticked
 * makes the bill's last paid dish; none while a paid dish keeps a served portion. */
export function lastPaidDishes(paid: readonly ShareHolder[]): Map<string, number> {
  const off = new Map(
    paid.flatMap(({ line, cancelled }) => {
      const { remaining } = serviceQuantities(line.quantity, line.servedQuantity, cancelled);
      return remaining > 0 ? [[line.id, remaining] as const] : [];
    }),
  );
  return isLastPaidDish(paid, off) ? off : new Map();
}

/** The free items still holding a portion that is not cancelled: those the last paid dish takes. */
export function freeItemsLeft(free: readonly ShareHolder[]): ShareHolder[] {
  return free.filter(({ line, cancelled }) => line.quantity - cancelled > 0);
}

function readStored(tx: Transaction, billId: string): Promise<Stored[]> {
  return tx
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
}

/** The bill's filing; `stored`, when given, is the bill's stored lines in line order. */
export async function readBillFiling(
  tx: Transaction,
  billId: string,
  saleId: string,
  stored?: Stored[],
): Promise<BillFiling> {
  const lines = stored ?? (await readStored(tx, billId));
  const filed = await tx
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
  const bindings = await readPortionBindings(
    tx,
    lines.filter((row) => row.parentLineId === null).map((row) => row.id),
  );
  const links =
    bindings.size === 0
      ? []
      : await tx
          .select({
            saleLineId: saleLineDishes.saleLineId,
            dishLineId: saleLineDishes.dishLineId,
          })
          .from(saleLineDishes)
          .innerJoin(saleLines, eq(saleLines.id, saleLineDishes.saleLineId))
          .where(eq(saleLines.saleId, saleId));
  return { stored: lines, filed, bindings, links };
}

function refundValues(filing: BillFiling, lineIds: readonly string[]): (Value | undefined)[] {
  const { stored, filed, bindings, links } = filing;
  const linked = new Set(links.map((link) => link.saleLineId));
  const unboundStored = stored.filter((row) => !bindings.has(row.parentLineId ?? row.id));
  const unlinkedFiled = filed.filter((row) => !linked.has(row.id));
  return lineIds.map((lineId) => {
    const parent = stored.find((row) => row.id === lineId && row.parentLineId === null);
    if (parent === undefined) return undefined;
    if (bindings.size === 0) return byPosition(stored, filed, lineId);
    const binding = bindings.get(lineId);
    if (binding === undefined) return byPosition(unboundStored, unlinkedFiled, lineId);
    return byPortion(
      filed,
      links,
      binding.lineId,
      stored.filter((row) => row.id === lineId || row.parentLineId === lineId),
    );
  });
}

/** Unbound lines, each paired by position with a filed row no portion is linked to. */
function byPosition(
  stored: readonly Stored[],
  filed: readonly Filed[],
  lineId: string,
): { quantity: string; gross: string } | undefined {
  if (
    stored.length !== filed.length ||
    stored.some((row, i) => {
      const frozen = filed[i]!;
      const parent = stored.findIndex((candidate) => candidate.id === row.parentLineId);
      return (
        frozen.quantity !== row.quantity ||
        frozen.parentLineId !== (parent === -1 ? null : filed[parent]!.id)
      );
    })
  )
    return undefined;
  let gross = decimal("0.00");
  let quantity = 0;
  for (const [i, row] of stored.entries()) {
    if (row.id === lineId) quantity = row.quantity;
    if (row.id !== lineId && row.parentLineId !== lineId) continue;
    const amount = filed[i]!.lineGross;
    if (amount === null) return undefined;
    gross = addDecimal(gross, centsToDecimal(amount));
  }
  return { quantity: thousandthsToDecimal(quantity), gross };
}

/**
 * One portion's share of each filed row linked to it: its dish row and its extras' rows, which must
 * match its stored dish line and extras.
 */
function byPortion(
  filed: readonly Filed[],
  links: readonly { saleLineId: string; dishLineId: string }[],
  dishLineId: string,
  family: readonly Stored[],
): { quantity: string; gross: string } | undefined {
  const count = new Map<string, number>();
  const mine = new Set<string>();
  for (const link of links) {
    count.set(link.saleLineId, (count.get(link.saleLineId) ?? 0) + 1);
    if (link.dishLineId === dishLineId) mine.add(link.saleLineId);
  }
  const rows = filed.filter((row) => mine.has(row.id));
  const dish = rows.find((row) => row.parentLineId === null);
  let gross = decimal("0.00");
  let quantity = 0;
  const shares: string[] = [];
  for (const row of rows) {
    const portions = count.get(row.id)!;
    const shareQuantity = row.quantity / portions;
    const shareGross = row.lineGross === null ? null : row.lineGross / portions;
    if (shareGross === null || !Number.isInteger(shareGross)) return undefined;
    if (row === dish) quantity = shareQuantity;
    shares.push(`${row === dish}:${shareQuantity}`);
    gross = addDecimal(gross, centsToDecimal(shareGross));
  }
  const kept = family.map((row) => `${row.parentLineId === null}:${row.quantity}`);
  if (shares.sort().join() !== kept.sort().join()) return undefined;
  return { quantity: thousandthsToDecimal(quantity), gross };
}
