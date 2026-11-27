import {
  type Transaction,
  diningTables,
  todaySet,
  tableMerges,
  floorResetTables,
} from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { groupStep, AppError, NEW_TABLE_SIZE } from "@waitron/shared";
import { eq } from "drizzle-orm";
import { tableNeedsMoving, markMoved } from "./floor-today-mark-moved.js";
import { leaveMerges } from "./floor-today-merges.js";
import { refuseDeliveryPending, placementOf, placementColumns } from "./floor-today-store.js";
import { todayOf, refuseUnmovable, refuseUnfree } from "./floor-today-table.js";
import { withMovedSlips } from "./moved-slips.js";
import type { TradingContext } from "./trading-context.js";
import "./errors.js";

/** Moves the table's top-left corner to `at`; a merge's members all move by the same distance. */
export async function moveToday(
  tx: Transaction,
  tableId: string,
  at: { x: number; y: number },
): Promise<void> {
  const today = await todayOf(tx, tableId);
  refuseUnmovable(today);
  const members = (today.merge?.members ?? [today.row]).filter((m) => m.x !== null);
  const { dx, dy } = groupStep(
    members.map((m) => ({ x: m.x!, y: m.y! })),
    { x: at.x - today.row.x!, y: at.y - today.row.y! },
  );
  for (const member of members) {
    await tx
      .update(diningTables)
      .set(todaySet({ x: member.x! + dx, y: member.y! + dy }))
      .where(eq(diningTables.id, member.tableId));
  }
}
/** Turns the table 15° clockwise about its centre: its corner, `x` and `y`, does not change. */
export async function rotateToday(tx: Transaction, tableId: string): Promise<void> {
  const today = await todayOf(tx, tableId);
  refuseUnmovable(today);
  if (today.merge !== null) throw new AppError("table.merged", { tableId });
  await tx
    .update(diningTables)
    .set(todaySet({ rotation: (today.row.rotation! + 15) % 360 }))
    .where(eq(diningTables.id, today.row.tableId));
}
/** Puts a spare on the map with its top-left corner at `at`; a table with a place is left alone. */
export async function placeSpareToday(
  tx: Transaction,
  tableId: string,
  at: { x: number; y: number },
): Promise<void> {
  const { row } = await todayOf(tx, tableId);
  if (row.takenOff) throw new AppError("table.taken_off", { tableId });
  if (row.x !== null) return;
  if (row.fixed) throw new AppError("table.fixed", { tableId });
  await tx
    .update(diningTables)
    .set(
      todaySet({
        x: at.x,
        y: at.y,
        width: NEW_TABLE_SIZE,
        height: NEW_TABLE_SIZE,
        shape: "rect",
        rotation: 0,
      }),
    )
    .where(eq(diningTables.id, row.tableId));
}
/** Takes a free table off today's plan, keeping its place; one already taken off is left as it is. */
export async function takeOffToday(tx: Transaction, tableId: string): Promise<void> {
  const today = await todayOf(tx, tableId);
  if (today.row.takenOff) return;
  if (today.merge !== null) throw new AppError("table.merged", { tableId });
  await refuseUnfree(tx, [tableId]);
  await refuseDeliveryPending(tx, tableId);
  await tx
    .update(diningTables)
    .set(todaySet({ takenOff: true }))
    .where(eq(diningTables.id, today.row.tableId));
}

export async function putBackToday(tx: Transaction, tableId: string): Promise<void> {
  const { row } = await todayOf(tx, tableId);
  await tx
    .update(diningTables)
    .set(todaySet({ takenOff: false }))
    .where(eq(diningTables.id, row.tableId));
}
/** Today's seats for the table, or for its merge when it is in one. */
export async function seatsToday(tx: Transaction, tableId: string, seats: number): Promise<void> {
  const today = await todayOf(tx, tableId);
  if (today.row.takenOff) throw new AppError("table.taken_off", { tableId });
  if (today.merge !== null) {
    await tx.update(tableMerges).set({ seats }).where(eq(tableMerges.id, today.merge.joinId));
    return;
  }
  await tx
    .update(diningTables)
    .set(todaySet({ seats }))
    .where(eq(diningTables.id, today.row.tableId));
}
/**
 * Sets the table's today's row from what the last reset copied for it, after it leaves any merge.
 * Its label and its today's name are left alone. The kitchen is told of each bill of a party at the
 * table's group, and each counter order with food on its way to one of its tables, when
 * `kitchenToBeTold` (kitchen-ticket-moves.ts) says so. On a table that needs moving it is Mark moved.
 */
export async function backToSaved(
  tx: Transaction,
  cfg: TradingContext,
  removals: readonly TableRemoval[],
  tableId: string,
  now: Date,
): Promise<void> {
  const { row, merge } = await todayOf(tx, tableId);
  if (await tableNeedsMoving(tx, tableId)) return markMoved(tx, removals, tableId, now);
  const [saved] = await tx
    .select()
    .from(floorResetTables)
    .where(eq(floorResetTables.tableId, tableId));
  if (saved === undefined || saved.remove) {
    throw new AppError("table.not_on_today_plan", { tableId });
  }
  const members = merge?.members.map((member) => member.tableId) ?? [];
  const place = placementOf(saved);
  await withMovedSlips(tx, cfg, members.length === 0 ? null : { tables: members }, async () => {
    await leaveMerges(tx, [tableId]);
    await tx
      .update(diningTables)
      .set(
        todaySet({
          seats: saved.seats,
          fixed: saved.fixed,
          ...placementColumns(place),
          takenOff: false,
        }),
      )
      .where(eq(diningTables.id, row.tableId));
  });
}
