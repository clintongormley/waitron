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

function refundValues(
  filing: BillFiling,
  lineIds: readonly string[],
  pairs: FilingPairs = pairFiling(filing),
): (Value | undefined)[] {
  return lineIds.map((lineId) => {
    const family = pairs.familyOf.get(lineId);
    if (family === undefined) return undefined;
    if (filing.bindings.has(lineId)) return byPortion(pairs, lineId, family);
    return byPosition(pairs, family);
  });
}

/** How a settled bill's dish lines pair with its filed rows, worked out once per filing. */
export interface FilingPairs {
  /** Each top-level stored line's family: the line, then its extras in stored order. */
  familyOf: Map<string, Stored[]>;
  /** The filed row at each unbound stored line's position; empty when the positions do not pair
   * (count, quantities or parents differ). */
  atPosition: Map<string, Filed>;
  /** Each filed row's linked dish lines, in stored line order. */
  portionsOf: Map<string, string[]>;
  /** The filed rows linked to each dish line, in filed order. */
  rowsOfPortion: Map<string, Filed[]>;
}

export function pairFiling(filing: BillFiling): FilingPairs {
  const { stored, filed, bindings, links } = filing;
  const familyOf = new Map<string, Stored[]>();
  for (const row of stored) if (row.parentLineId === null) familyOf.set(row.id, [row]);
  for (const row of stored)
    if (row.parentLineId !== null) familyOf.get(row.parentLineId)?.push(row);
  const linked = new Set(links.map((link) => link.saleLineId));
  const atPosition =
    bindings.size === 0
      ? pairByPosition(stored, filed)
      : pairByPosition(
          stored.filter((row) => !bindings.has(row.parentLineId ?? row.id)),
          filed.filter((row) => !linked.has(row.id)),
        );
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
  const rowsOfPortion = new Map<string, Filed[]>();
  for (const row of filed)
    for (const dishLineId of new Set(portionsOf.get(row.id) ?? [])) {
      const rows = rowsOfPortion.get(dishLineId);
      if (rows === undefined) rowsOfPortion.set(dishLineId, [row]);
      else rows.push(row);
    }
  return { familyOf, atPosition, portionsOf, rowsOfPortion };
}

/** Each stored line's filed row at its position, when every line pairs with the row at its
 * position (same count, quantities and parents); otherwise none. */
function pairByPosition(stored: readonly Stored[], filed: readonly Filed[]): Map<string, Filed> {
  if (stored.length !== filed.length) return new Map();
  const index = new Map(stored.map((row, i) => [row.id, i]));
  const pairs = new Map<string, Filed>();
  for (const [i, row] of stored.entries()) {
    const frozen = filed[i]!;
    const parent = row.parentLineId === null ? undefined : index.get(row.parentLineId);
    if (
      frozen.quantity !== row.quantity ||
      frozen.parentLineId !== (parent === undefined ? null : filed[parent]!.id)
    )
      return new Map();
    pairs.set(row.id, frozen);
  }
  return pairs;
}

/** The filed rows the dish line `lineId` and its extras are valued from, the dish's first, each
 * with this line's share of it in cents; none where {@link refundValueIn} values none. */
export function filedFamilyOf(
  filing: BillFiling,
  pairs: FilingPairs,
  lineId: string,
): { rowId: string; dish: boolean; share: number }[] | undefined {
  const family = pairs.familyOf.get(lineId);
  if (family === undefined) return undefined;
  if (filing.bindings.has(lineId)) {
    if (byPortion(pairs, lineId, family) === undefined) return undefined;
    return portionShares(pairs, lineId)
      .map(({ row, share }) => ({ rowId: row.id, dish: row.parentLineId === null, share }))
      .sort((a, b) => Number(b.dish) - Number(a.dish));
  }
  const rows = family.map((row) => pairs.atPosition.get(row.id));
  if (rows.some((row) => row?.lineGross == null)) return undefined;
  return rows.map((row, i) => ({ rowId: row!.id, dish: i === 0, share: row!.lineGross! }));
}

/** An unbound line's family, each paired by position with a filed row no portion is linked to. */
function byPosition(
  pairs: FilingPairs,
  family: readonly Stored[],
): { quantity: string; gross: string } | undefined {
  let gross = decimal("0.00");
  for (const row of family) {
    const amount = pairs.atPosition.get(row.id)?.lineGross;
    if (amount == null) return undefined;
    gross = addDecimal(gross, centsToDecimal(amount));
  }
  return { quantity: thousandthsToDecimal(family[0]!.quantity), gross };
}

/** Each filed row linked to `dishLineId` with that portion's share of its quantity and cents: a
 * row's cents go to its portions evenly, the cents left over one each to the earliest. */
function portionShares(pairs: FilingPairs, dishLineId: string) {
  return (pairs.rowsOfPortion.get(dishLineId) ?? []).map((row) => {
    const portions = pairs.portionsOf.get(row.id)!;
    if (row.lineGross === null) return { row, quantity: 0, share: null };
    const base = Math.floor(row.lineGross / portions.length);
    const left = row.lineGross - base * portions.length;
    return {
      row,
      quantity: row.quantity / portions.length,
      share: base + (portions.indexOf(dishLineId) < left ? 1 : 0),
    };
  }) as { row: Filed; quantity: number; share: number }[];
}

/**
 * One portion's share of each filed row linked to it: its dish row and its extras' rows, which must
 * match its stored dish line and extras. A row's portions sum to what it filed.
 */
function byPortion(
  pairs: FilingPairs,
  dishLineId: string,
  family: readonly Stored[],
): { quantity: string; gross: string } | undefined {
  const shares = portionShares(pairs, dishLineId);
  if (shares.some(({ share }) => share === null)) return undefined;
  let gross = decimal("0.00");
  let quantity = 0;
  const kept: string[] = [];
  for (const { row, quantity: shareQuantity, share } of shares) {
    if (row.parentLineId === null && quantity === 0) quantity = shareQuantity;
    kept.push(`${row.parentLineId === null}:${shareQuantity}`);
    gross = addDecimal(gross, centsToDecimal(share));
  }
  const expected = family.map((row) => `${row.parentLineId === null}:${row.quantity}`);
  if (kept.sort().join() !== expected.sort().join()) return undefined;
  return { quantity: thousandthsToDecimal(quantity), gross };
}
