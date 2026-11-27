import { eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";
import { billDiscounts, workingOrderLines, type Transaction } from "@waitron/db";

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
