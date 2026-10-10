import { and, eq, isNull } from "drizzle-orm";
import { diningTables, floorTodayJoinTables, floorTodayTables, partyTables } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

export interface Today {
  tableId: string;
  zoneId: string | null;
  row: typeof floorTodayTables.$inferSelect;
  /** Every member's today's row, this table's included; null when the table is in no merge. */
  merge: { joinId: string; members: (typeof floorTodayTables.$inferSelect)[] } | null;
}

/** The table, read only within the venue's location, with its today's row and its merge. */
export async function todayOf(tx: Transaction, cfg: TillConfig, tableId: string): Promise<Today> {
  const [table] = await tx
    .select({ zoneId: diningTables.zoneId })
    .from(diningTables)
    .where(and(eq(diningTables.id, tableId), eq(diningTables.locationId, cfg.locationId)));
  if (table === undefined) throw new AppError("table.not_found", { tableId });
  const [row] = await tx
    .select()
    .from(floorTodayTables)
    .where(eq(floorTodayTables.tableId, tableId));
  if (row === undefined) throw new AppError("table.not_in_floor_plan", { tableId });
  const base = { tableId, zoneId: table.zoneId, row };
  const [own] = await tx
    .select({ joinId: floorTodayJoinTables.joinId })
    .from(floorTodayJoinTables)
    .where(eq(floorTodayJoinTables.tableId, tableId));
  if (own === undefined) return { ...base, merge: null };
  const members = await tx
    .select({ row: floorTodayTables })
    .from(floorTodayJoinTables)
    .innerJoin(floorTodayTables, eq(floorTodayTables.tableId, floorTodayJoinTables.tableId))
    .where(eq(floorTodayJoinTables.joinId, own.joinId));
  return { ...base, merge: { joinId: own.joinId, members: members.map((m) => m.row) } };
}

/** The refusals a move, a turn or a merge shares, in the order the routes answer them; each is checked across every table before the next. */
export function refuseUnmovable(...tables: readonly Today[]): void {
  for (const { tableId, row } of tables) {
    if (row.x === null) throw new AppError("table.not_in_floor_plan", { tableId });
  }
  for (const { tableId, row } of tables) {
    if (row.takenOff) throw new AppError("table.taken_off", { tableId });
  }
  for (const { tableId, row } of tables) {
    if (row.fixed) throw new AppError("table.fixed", { tableId });
  }
}

/** A party at any of the tables. */
export async function refuseHeld(tx: Transaction, tableIds: readonly string[]): Promise<void> {
  for (const tableId of tableIds) {
    const [held] = await tx
      .select({ id: partyTables.id })
      .from(partyTables)
      .where(and(eq(partyTables.tableId, tableId), isNull(partyTables.leftAt)));
    if (held !== undefined) throw new AppError("tab.already_open", { tableId });
  }
}

/** A party at any of the tables, then any of them needing clearing. */
export async function refuseUnfree(tx: Transaction, tableIds: readonly string[]): Promise<void> {
  await refuseHeld(tx, tableIds);
  for (const tableId of tableIds) {
    const [table] = await tx
      .select({ needsClearingSince: diningTables.needsClearingSince })
      .from(diningTables)
      .where(eq(diningTables.id, tableId));
    if (table!.needsClearingSince !== null) throw new AppError("table.needs_clearing", { tableId });
  }
}
