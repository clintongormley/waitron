import { eq, getTableColumns, inArray, or, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";
import { billDiscounts, workingOrderLines, type Transaction } from "@waitron/db";
import {
  byQuantity,
  byQuantityWithin,
  workOutBillDiscounts,
  type BillDiscountLine,
  type PendingBillDiscount,
} from "./bill-discounts.js";

/** A discount to hold on an open bill until its invoice (plan A1621 D3). */
export type NewPendingDiscount = typeof billDiscounts.$inferInsert;

/** A held discount and the bill it is on: its own, or its line's. */
export type PendingDiscount = typeof billDiscounts.$inferSelect & { billId: string };

/** The new share's own columns: it is an amount, split from the row it moves from. */
export type NewShare = Omit<NewPendingDiscount, "action" | "percentBp" | "amount" | "sharedFrom">;

export async function insertPendingDiscount(
  tx: Transaction,
  row: NewPendingDiscount,
): Promise<string> {
  const [inserted] = await tx.insert(billDiscounts).values(row).returning({ id: billDiscounts.id });
  return inserted!.id;
}

export async function deletePendingDiscounts(
  tx: Transaction,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await tx.delete(billDiscounts).where(inArray(billDiscounts.id, [...ids]));
}

/**
 * Every discount held on `billIds`: each bill's own rows and the rows on its lines, bill by bill in
 * the order each bill first appears in `billIds`, each bill's by position, rows at one position by id.
 */
export async function readPendingDiscounts(
  tx: Transaction,
  billIds: readonly string[],
): Promise<PendingDiscount[]> {
  if (billIds.length === 0) return [];
  const bills = sql`(select value from json_each(${JSON.stringify(billIds)}))`;
  const columns = getTableColumns(billDiscounts);
  const rows = await unionAll(
    tx
      .select({ row: columns, billId: sql<string>`${billDiscounts.workingOrderId}` })
      .from(billDiscounts)
      .where(inArray(billDiscounts.workingOrderId, bills)),
    tx
      .select({ row: columns, billId: sql<string>`${workingOrderLines.workingOrderId}` })
      .from(workingOrderLines)
      .innerJoin(billDiscounts, eq(billDiscounts.lineId, workingOrderLines.id))
      .where(inArray(workingOrderLines.workingOrderId, bills)),
  );
  const order = new Map<string, number>();
  billIds.forEach((id, at) => {
    if (!order.has(id)) order.set(id, at);
  });
  return rows
    .map(({ row, billId }) => ({ ...row, billId }))
    .sort(
      (a, b) =>
        order.get(a.billId)! - order.get(b.billId)! ||
        a.position - b.position ||
        a.id.localeCompare(b.id),
    );
}

async function amountOf(tx: Transaction, id: string): Promise<number> {
  const [row] = await tx
    .select({ action: billDiscounts.action, amount: billDiscounts.amount })
    .from(billDiscounts)
    .where(eq(billDiscounts.id, id));
  if (row?.action !== "discount_amount") throw new RangeError(`discount ${id} is not an amount`);
  return row.amount!;
}

/**
 * Moves `cents` of amount row `from` into amount row `to`, or into a new share of `from` when `to`
 * is a new row's columns; answers the row it moved into. A `from` left at nothing is deleted.
 */
export async function moveShare(
  tx: Transaction,
  from: string,
  cents: number,
  to: string | NewShare,
): Promise<string> {
  if (to === from) throw new RangeError(`discount ${from} cannot move into itself`);
  const held = await amountOf(tx, from);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > held) {
    throw new RangeError(`discount ${from} holds ${held}, not ${cents} to move`);
  }
  let into: string;
  if (typeof to === "string") {
    const has = await amountOf(tx, to);
    await tx
      .update(billDiscounts)
      .set({ amount: has + cents })
      .where(eq(billDiscounts.id, to));
    into = to;
  } else {
    into = await insertPendingDiscount(tx, {
      ...to,
      action: "discount_amount",
      percentBp: null,
      amount: cents,
      sharedFrom: from,
    });
  }
  if (cents === held) await deletePendingDiscounts(tx, [from]);
  else
    await tx
      .update(billDiscounts)
      .set({ amount: held - cents })
      .where(eq(billDiscounts.id, from));
  return into;
}

type Held = typeof billDiscounts.$inferSelect;

const asPending = (row: Held, lineId: string, amount: number | null, id = row.id) =>
  ({
    id,
    target: { kind: "line", lineId },
    action: row.action,
    percentBp: row.percentBp,
    amount,
    origin: row.origin,
    position: row.position,
  }) satisfies PendingBillDiscount;

/**
 * Each part's share of each amount held on a split line, shared as `workOutBillDiscounts` shares
 * an amount over a line's parts: by quantity, no share above what its part costs once the
 * discounts worked out before it are taken off, and what is above the parts' whole cost by
 * quantity on top, so a discount cut down before the split is cut down after it. Answers too the
 * lines it read, by id: the split lines, their parts and their extras.
 */
async function amountShares(
  tx: Transaction,
  partsOf: ReadonlyMap<string, readonly string[]>,
  held: readonly Held[],
): Promise<{ shares: Map<string, number[]>; lineOf: Map<string, BillDiscountLine> }> {
  const ids = [...partsOf].flatMap(([from, parts]) => [from, ...parts]);
  const read = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      quantity: workingOrderLines.quantity,
      priceQuantity: workingOrderLines.priceQuantity,
      unit: workingOrderLines.unitPriceGross,
      unitPrecision: workingOrderLines.unitPrecision,
      lineTotal: workingOrderLines.lineTotal,
    })
    .from(workingOrderLines)
    .where(or(inArray(workingOrderLines.id, ids), inArray(workingOrderLines.parentLineId, ids)));
  const present = new Set(read.map(({ id }) => id));
  const lines: BillDiscountLine[] = read.map((line) => ({
    ...line,
    parentLineId:
      line.parentLineId !== null && present.has(line.parentLineId) ? line.parentLineId : null,
    setMenuLineId: null,
    portion: null,
  }));
  const lineOf = new Map(lines.map((line) => [line.id, line]));
  const onLines = await tx
    .select()
    .from(billDiscounts)
    .where(inArray(billDiscounts.lineId, [...present]));
  const decided: PendingBillDiscount[] = onLines
    .filter(({ lineId }) => !partsOf.has(lineId!))
    .map((row) => asPending(row, row.lineId!, row.amount));
  const heldOf = new Map(held.map((row) => [row.id, row]));
  const order = workOutBillDiscounts(
    lines,
    held.map((row) => asPending(row, row.lineId!, row.amount)),
  ).discounts.map(({ id }) => heldOf.get(id)!);
  const shares = new Map<string, number[]>();
  for (const row of order) {
    const parts = [row.lineId!, ...partsOf.get(row.lineId!)!]
      .map((id) => lineOf.get(id)!)
      .sort((a, b) => a.lineNo - b.lineNo);
    let amounts = parts.map(() => row.amount);
    if (row.action === "discount_amount") {
      // A probe larger than the bill takes each part's whole cost as the discounts before it leave it.
      const probe = lines.reduce((sum, line) => sum + line.lineTotal, 1);
      const costs = workOutBillDiscounts(lines, [
        ...decided,
        ...parts.map((part, at) => asPending(row, part.id, probe, `${row.id}#${at}`)),
      ]).discounts.filter(({ id }) => id.startsWith(`${row.id}#`));
      const quantities = parts.map(({ quantity }) => quantity);
      const whole = costs.reduce((sum, { takes }) => sum + takes, 0);
      const within = byQuantityWithin(
        Math.min(row.amount!, whole),
        quantities,
        parts.map((_, at) => costs.find(({ id }) => id === `${row.id}#${at}`)!.takes),
      );
      const above = byQuantity(Math.max(0, row.amount! - whole), quantities);
      const cents = within.map((share, at) => share + above[at]!);
      shares.set(row.id, cents);
      amounts = cents;
    }
    parts.forEach((part, at) => {
      if (amounts[at] !== 0) decided.push(asPending(row, part.id, amounts[at]!, `${row.id}@${at}`));
    });
  }
  return { shares, lineOf };
}

/** The split lines and their parts, by id, with their line numbers. */
async function lineNumbers(
  tx: Transaction,
  partsOf: ReadonlyMap<string, readonly string[]>,
): Promise<Map<string, { id: string; lineNo: number }>> {
  const ids = [...partsOf].flatMap(([from, parts]) => [from, ...parts]);
  const lines = await tx
    .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.id, ids));
  return new Map(lines.map((line) => [line.id, line]));
}

/**
 * Copies each discount held on a split line to the parts `splits` cut off it (plan A1621 D10): a
 * percentage or Free as it is, an amount shared over the line and its parts in line order, the
 * cents left over one each from the earliest, as `workOutBillDiscounts` shares it, within what each
 * part costs ({@link amountShares}). A part whose share is nothing holds no copy, and nor then
 * does the line.
 */
export async function copyPendingDiscountsToParts(
  tx: Transaction,
  splits: readonly { from: string; to: string }[],
): Promise<void> {
  const partsOf = new Map<string, string[]>();
  for (const { from, to } of splits) {
    const parts = partsOf.get(from);
    if (parts === undefined) partsOf.set(from, [to]);
    else parts.push(to);
  }
  if (partsOf.size === 0) return;
  const held = await tx
    .select()
    .from(billDiscounts)
    .where(inArray(billDiscounts.lineId, [...partsOf.keys()]));
  if (held.length === 0) return;
  const { shares: amounts, lineOf } = held.some(({ action }) => action === "discount_amount")
    ? await amountShares(tx, partsOf, held)
    : { shares: new Map<string, number[]>(), lineOf: await lineNumbers(tx, partsOf) };
  for (const { id, ...row } of held) {
    const parts = [row.lineId!, ...partsOf.get(row.lineId!)!]
      .map((lineId) => lineOf.get(lineId)!)
      .sort((a, b) => a.lineNo - b.lineNo);
    const shares = amounts.get(id) ?? parts.map(() => row.amount);
    for (const [at, part] of parts.entries()) {
      const amount = shares[at]!;
      if (part.id === row.lineId) {
        if (amount === 0) await deletePendingDiscounts(tx, [id]);
        else if (amount !== row.amount) {
          await tx.update(billDiscounts).set({ amount }).where(eq(billDiscounts.id, id));
        }
      } else if (amount !== 0) {
        await insertPendingDiscount(tx, { ...row, lineId: part.id, amount });
      }
    }
  }
}
