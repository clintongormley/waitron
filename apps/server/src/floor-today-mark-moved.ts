import { and, eq, inArray, or, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { diningTables, floorResetTables, floorTodayJoinTables, needsMoving } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { catchUpZone, refuseDeliveryPending } from "./floor-today-store.js";
import { refuseUnfree, zoneOfTable } from "./floor-today-table.js";
import { refusedByAModule } from "./table-removal.js";
import "./errors.js";

const joinedRow = alias(floorResetTables, "mark_moved_joined");

/** Whether the till shows the table "Needs moving". */
export async function tableNeedsMoving(tx: Transaction, tableId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(and(eq(diningTables.id, tableId), needsMoving(diningTables.id)));
  return row !== undefined;
}

/**
 * Applies the change of a table that needs moving, with every row of a pending joined group
 * holding it, and clears their marks. A table that does not need moving is left as it is.
 */
export async function markMoved(
  tx: Transaction,
  removals: readonly TableRemoval[],
  tableId: string,
  now: Date,
): Promise<void> {
  const zoneId = await zoneOfTable(tx, tableId);
  if (!(await tableNeedsMoving(tx, tableId))) return;
  const [own] = await tx
    .select({ id: floorResetTables.id })
    .from(floorResetTables)
    .where(and(eq(floorResetTables.tableId, tableId), eq(floorResetTables.pending, true)));
  const groupIds = new Set([
    own!.id,
    ...(await pendingGroupRows(tx, [own!.id])).map((member) => member.id),
  ]);
  const group = await tx
    .select({
      row: floorResetTables,
    })
    .from(floorResetTables)
    .where(and(inArray(floorResetTables.id, [...groupIds]), eq(floorResetTables.pending, true)));
  const groupTables = new Set(
    group.flatMap(({ row }) => (row.tableId === null ? [] : [row.tableId])),
  );

  await catchUpZone(tx, removals, zoneId, now, {
    inReset: false,
    carry: new Set(group.map(({ row }) => row.id)),
  });
  if (await tableNeedsMoving(tx, tableId))
    await refuseHeldBack(tx, removals, now, tableId, [...groupTables]);
}

/**
 * Leaves a table that needs moving, and every table of a pending joined group holding it, in the
 * place today's map gives it until the next reset rewrites the rows. A row whose table does not
 * yet have the row's label and short name is marked placed but left pending, so the catch-up still
 * gives the table its new names.
 */
export async function leaveHere(
  tx: Transaction,
  removals: readonly TableRemoval[],
  tableId: string,
  now: Date,
): Promise<void> {
  const zoneId = await zoneOfTable(tx, tableId);
  if (!(await tableNeedsMoving(tx, tableId))) return;
  const [own] = await tx
    .select({ id: floorResetTables.id })
    .from(floorResetTables)
    .where(and(eq(floorResetTables.tableId, tableId), eq(floorResetTables.pending, true)));
  const groupIds = [
    ...new Set([own!.id, ...(await pendingGroupRows(tx, [own!.id])).map((member) => member.id)]),
  ];
  const group = await tx
    .select({
      id: floorResetTables.id,
      tableId: floorResetTables.tableId,
      label: floorResetTables.label,
      shortName: floorResetTables.shortName,
      tableLabel: diningTables.label,
      tableShortName: diningTables.shortName,
    })
    .from(floorResetTables)
    .leftJoin(diningTables, eq(diningTables.id, floorResetTables.tableId))
    .where(inArray(floorResetTables.id, groupIds));
  for (const row of group) {
    const state =
      row.tableId === null
        ? { pending: false, readyToMove: false }
        : row.label === row.tableLabel && row.shortName === row.tableShortName
          ? { pending: false, readyToMove: false, placed: true }
          : { placed: true, readyToMove: false };
    await tx.update(floorResetTables).set(state).where(eq(floorResetTables.id, row.id));
  }
  await catchUpZone(tx, removals, zoneId, now, { inReset: false });
}

/**
 * Throws what still holds back the group of `tables`, which Mark moved could not apply: food on
 * its way, a party, a table needing clearing or a module's refusal to let a table go, at one of
 * them or at a table tied to them by today's merges or a pending joined group, as the
 * catch-up's waiting rules (`waitingTogether`) tie them. `table.needs_moving` is the answer when none of those is found.
 */
async function refuseHeldBack(
  tx: Transaction,
  removals: readonly TableRemoval[],
  now: Date,
  tableId: string,
  tables: readonly string[],
): Promise<never> {
  const tied = new Set(tables);
  for (let size = 0; size !== tied.size;) {
    size = tied.size;
    const ids = [...tied];
    const joins = tx
      .select({ id: floorTodayJoinTables.joinId })
      .from(floorTodayJoinTables)
      .where(inArray(floorTodayJoinTables.tableId, ids));
    const merged = await tx
      .select({ id: floorTodayJoinTables.tableId })
      .from(floorTodayJoinTables)
      .where(inArray(floorTodayJoinTables.joinId, joins));
    for (const row of merged) tied.add(row.id);
    for (const id of await pendingGroupTables(tx, ids)) tied.add(id);
  }
  const ids = [tableId, ...[...tied].filter((id) => id !== tableId)];
  for (const id of ids) await refuseDeliveryPending(tx, id);
  await refuseUnfree(tx, ids);
  const removing = await tx
    .select({ id: floorResetTables.tableId })
    .from(floorResetTables)
    .where(
      and(
        inArray(floorResetTables.tableId, ids),
        eq(floorResetTables.pending, true),
        eq(floorResetTables.remove, true),
      ),
    );
  const refusals = await refusedByAModule(
    tx,
    removals,
    removing.map((row) => row.id!),
    now,
  );
  for (const id of ids) {
    const refusal = refusals.get(id);
    if (refusal !== undefined) throw refusal;
  }
  throw new AppError("table.needs_moving", { tableId });
}

/** The tables of every pending joined group holding a pending reset row of one of `tableIds`. */
async function pendingGroupTables(tx: Transaction, tableIds: readonly string[]): Promise<string[]> {
  const rows = tx
    .select({ id: floorResetTables.id })
    .from(floorResetTables)
    .where(
      and(inArray(floorResetTables.tableId, [...tableIds]), eq(floorResetTables.pending, true)),
    );
  const members = await pendingGroupRows(tx, rows);
  return members.flatMap((member) => (member.tableId === null ? [] : [member.tableId]));
}

/** The pending rows of every pending joined group holding one of the reset rows `rowIds`. */
async function pendingGroupRows(
  tx: Transaction,
  rowIds: string[] | SQLWrapper,
): Promise<{ id: string; tableId: string | null }[]> {
  const links = await tx
    .select({ joinedId: floorResetTables.partOfResetTableId })
    .from(floorResetTables)
    .innerJoin(
      joinedRow,
      and(eq(joinedRow.id, floorResetTables.partOfResetTableId), eq(joinedRow.pending, true)),
    )
    .where(
      or(
        inArray(floorResetTables.partOfResetTableId, rowIds),
        inArray(floorResetTables.id, rowIds),
      ),
    );
  const joinedIds = [
    ...new Set(links.flatMap((link) => (link.joinedId === null ? [] : [link.joinedId]))),
  ];
  if (joinedIds.length === 0) return [];
  const parts = tx
    .select({ id: floorResetTables.id })
    .from(floorResetTables)
    .where(inArray(floorResetTables.partOfResetTableId, joinedIds));
  return tx
    .select({ id: floorResetTables.id, tableId: floorResetTables.tableId })
    .from(floorResetTables)
    .where(
      and(
        or(inArray(floorResetTables.id, joinedIds), inArray(floorResetTables.id, parts)),
        eq(floorResetTables.pending, true),
      ),
    );
}
