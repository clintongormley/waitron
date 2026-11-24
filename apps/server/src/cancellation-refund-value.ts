import { eq } from "drizzle-orm";
import { saleLineDishes, saleLines, workingOrderLines, type Transaction } from "@waitron/db";
import {
  addDecimal,
  AppError,
  cancelRefundShare,
  centsToDecimal,
  decimal,
  isZeroDecimal,
  sumDecimals,
  thousandthsToDecimal,
  type Decimal,
} from "@waitron/shared";
import { readPortionBindings } from "./order-portions.js";
import { readLineCancellations, serviceQuantities } from "./line-service-state.js";
import "./errors.js";

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

export function refundValueIn(filing: BillFiling, lineId: string): Value | undefined {
  return refundValues(filing, [lineId])[0];
}

/** A till row of identical portions valued as one grouped line (plan D32): the portions' count and
 * the sum of each one's filed value; none when any portion's value cannot be read. What a cancel of
 * some of them refunds is {@link rowRefundsIn}'s, not a share of this. */
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

/**
 * What each portion a till row of `lineIds` can still give up refunds, in the order the row gives
 * them up (its last first, plan D32), `cancelled` holding the portions cancelled so far (thousandths,
 * by line id). A portion refunds its own filed value ({@link refundValueIn}) whichever way it is
 * cancelled, so however a filed row's portions are cancelled they refund no more than it filed, and
 * exactly that once all are refunded. None when a portion's value cannot be read.
 */
export function rowRefundsIn(
  filing: BillFiling,
  lineIds: readonly string[],
  cancelled: ReadonlyMap<string, number>,
): string[] | undefined {
  const cancellable = filing.stored.filter(
    (row) =>
      lineIds.includes(row.id) &&
      row.quantity - (cancelled.get(row.id) ?? 0) - row.servedQuantity > 0,
  );
  const values = refundValues(
    filing,
    cancellable.map((row) => row.id),
  );
  if (values.some((value) => value === undefined)) return undefined;
  return values.map((value) => value!.gross).reverse();
}

/** A paid dish line of a settled bill, and its portions cancelled so far. */
export interface PaidDish {
  line: Stored;
  cancelled: number;
}

/** A free item of a settled bill whose filed value is above €0. */
export interface ShareHolder extends PaidDish {
  value: Value;
}

const NO_HOLDERS: { free: ShareHolder[]; paid: PaidDish[] } = { free: [], paid: [] };

/** A dish line charged €0 whose menu price is above €0: given free. */
export const isFree = (line: Stored) =>
  line.parentLineId === null && line.lineTotal === 0 && (line.listUnitPriceGross ?? 0) > 0;

/**
 * A settled bill's free items holding a share of what its sale filed (plan 2026-11-19 §4.3.1), each
 * charged €0 with a menu price above €0 and filed above €0, and its paid dishes: every other dish
 * line charged above €0 with its extras, whatever its filed share. Neither when no free item holds
 * a share.
 */
export async function readShareHolders(
  tx: Transaction,
  billId: string,
  saleId: string,
): Promise<{ free: ShareHolder[]; paid: PaidDish[] }> {
  const stored = await readStored(tx, billId);
  if (!stored.some(isFree)) return NO_HOLDERS;
  return shareHoldersIn(tx, await readBillFiling(tx, billId, saleId, stored));
}

/** {@link readShareHolders} over a filing already read. */
export async function shareHoldersIn(
  tx: Transaction,
  filing: BillFiling,
): Promise<{ free: ShareHolder[]; paid: PaidDish[] }> {
  const candidates = filing.stored.filter(isFree);
  const values = refundValues(
    filing,
    candidates.map((line) => line.id),
  );
  const holding = candidates.flatMap((line, i) => {
    const value = values[i];
    return value === undefined || isZeroDecimal(decimal(value.gross)) ? [] : [{ line, value }];
  });
  if (holding.length === 0) return NO_HOLDERS;
  const charged = new Map<string, number>();
  for (const line of filing.stored) {
    const dish = line.parentLineId ?? line.id;
    charged.set(dish, (charged.get(dish) ?? 0) + line.lineTotal);
  }
  const paid = filing.stored.filter(
    (line) => line.parentLineId === null && !isFree(line) && charged.get(line.id)! > 0,
  );
  const cancelled = await readLineCancellations(tx, [
    ...holding.map(({ line }) => line.id),
    ...paid.map((line) => line.id),
  ]);
  return {
    free: holding.map((holder) => ({ ...holder, cancelled: cancelled.get(holder.line.id) ?? 0 })),
    paid: paid.map((line) => ({ line, cancelled: cancelled.get(line.id) ?? 0 })),
  };
}

/** Whether cancelling `off` portions (thousandths, by line id) leaves no paid dish a portion that is
 * not cancelled; a served portion is not cancelled. */
export function isLastPaidDish(
  paid: readonly PaidDish[],
  off: ReadonlyMap<string, number>,
): boolean {
  return (
    paid.some(({ line }) => off.has(line.id)) &&
    paid.every(({ line, cancelled }) => line.quantity - cancelled - (off.get(line.id) ?? 0) === 0)
  );
}

/** The paid dishes, with their unserved portions (thousandths), whose cancel with Refund ticked
 * makes the bill's last paid dish; none while a paid dish keeps a served portion. */
export function lastPaidDishes(paid: readonly PaidDish[]): Map<string, number> {
  const off = new Map(
    paid.flatMap(({ line, cancelled }) => {
      const { remaining } = serviceQuantities(line.quantity, line.servedQuantity, cancelled);
      return remaining > 0 ? [[line.id, remaining] as const] : [];
    }),
  );
  return isLastPaidDish(paid, off) ? off : new Map();
}

/** What a free item gives back when it comes back with the bill's last paid dish: the share of its
 * portions not yet cancelled. The cancellation read shows it and the cancel records it. */
export function freeItemRefund({ line, value, cancelled }: ShareHolder): Decimal {
  return cancelRefundShare(
    value,
    thousandthsToDecimal(cancelled),
    thousandthsToDecimal(line.quantity - cancelled),
  );
}

/** Cancel and refund refused for how a free item holding a share comes back with its paid dishes. */
export function freeItemRefusal(reason: "not_listed" | "free_item" | "served"): AppError {
  return new AppError("tab.free_item_with_dish", { reason });
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
  const position = new Map(stored.map((row, i) => [row.id, i]));
  const portionsOf = new Map<string, string[]>();
  for (const link of links) {
    const portions = portionsOf.get(link.saleLineId);
    if (portions === undefined) portionsOf.set(link.saleLineId, [link.dishLineId]);
    else portions.push(link.dishLineId);
  }
  for (const portions of portionsOf.values())
    portions.sort(
      (a, b) =>
        (position.get(a) ?? stored.length) - (position.get(b) ?? stored.length) ||
        a.localeCompare(b),
    );
  return lineIds.map((lineId) => {
    const parent = stored.find((row) => row.id === lineId && row.parentLineId === null);
    if (parent === undefined) return undefined;
    if (bindings.size === 0) return byPosition(stored, filed, lineId);
    const binding = bindings.get(lineId);
    if (binding === undefined) return byPosition(unboundStored, unlinkedFiled, lineId);
    return byPortion(
      filed,
      portionsOf,
      binding.lineId,
      stored.filter((row) => row.id === lineId || row.parentLineId === lineId),
    );
  });
}

/** Whether each stored line pairs with the filed row at its position: same count, quantities and
 * parents. */
function pairsByPosition(stored: readonly Stored[], filed: readonly Filed[]): boolean {
  return (
    stored.length === filed.length &&
    !stored.some((row, i) => {
      const frozen = filed[i]!;
      const parent = stored.findIndex((candidate) => candidate.id === row.parentLineId);
      return (
        frozen.quantity !== row.quantity ||
        frozen.parentLineId !== (parent === -1 ? null : filed[parent]!.id)
      );
    })
  );
}

/** The filed dish row the dish line `lineId` is paired with, as {@link refundValueIn} pairs them;
 * none where it pairs none. */
export function filedDishRowOf(filing: BillFiling, lineId: string): string | undefined {
  const { stored, filed, bindings, links } = filing;
  if (!stored.some((row) => row.id === lineId && row.parentLineId === null)) return undefined;
  const atPosition = (lines: readonly Stored[], rows: readonly Filed[]) =>
    pairsByPosition(lines, rows)
      ? rows[lines.findIndex((row) => row.id === lineId)]!.id
      : undefined;
  if (bindings.size === 0) return atPosition(stored, filed);
  if (!bindings.has(lineId)) {
    const linked = new Set(links.map((link) => link.saleLineId));
    return atPosition(
      stored.filter((row) => !bindings.has(row.parentLineId ?? row.id)),
      filed.filter((row) => !linked.has(row.id)),
    );
  }
  const rows = new Set(
    links.filter((link) => link.dishLineId === lineId).map((link) => link.saleLineId),
  );
  return filed.find((row) => rows.has(row.id) && row.parentLineId === null)?.id;
}

/** Unbound lines, each paired by position with a filed row no portion is linked to. */
function byPosition(
  stored: readonly Stored[],
  filed: readonly Filed[],
  lineId: string,
): { quantity: string; gross: string } | undefined {
  if (!pairsByPosition(stored, filed)) return undefined;
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
 * match its stored dish line and extras. `portionsOf` lists each row's linked dish lines in stored
 * line order; a row's cents go to them evenly, the cents left over one each to the earliest, so the
 * portions of a row sum to what it filed.
 */
function byPortion(
  filed: readonly Filed[],
  portionsOf: ReadonlyMap<string, readonly string[]>,
  dishLineId: string,
  family: readonly Stored[],
): { quantity: string; gross: string } | undefined {
  const rows = filed.filter((row) => portionsOf.get(row.id)?.includes(dishLineId) === true);
  const dish = rows.find((row) => row.parentLineId === null);
  let gross = decimal("0.00");
  let quantity = 0;
  const shares: string[] = [];
  for (const row of rows) {
    if (row.lineGross === null) return undefined;
    const portions = portionsOf.get(row.id)!;
    const shareQuantity = row.quantity / portions.length;
    const base = Math.floor(row.lineGross / portions.length);
    const left = row.lineGross - base * portions.length;
    const shareGross = base + (portions.indexOf(dishLineId) < left ? 1 : 0);
    if (row === dish) quantity = shareQuantity;
    shares.push(`${row === dish}:${shareQuantity}`);
    gross = addDecimal(gross, centsToDecimal(shareGross));
  }
  const kept = family.map((row) => `${row.parentLineId === null}:${row.quantity}`);
  if (shares.sort().join() !== kept.sort().join()) return undefined;
  return { quantity: thousandthsToDecimal(quantity), gross };
}
