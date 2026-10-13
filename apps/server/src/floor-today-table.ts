import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  diningTables,
  floorZones,
  floorTodayJoinTables,
  floorTodayTables,
  joinedOutOfService,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { holdersOf } from "./parties.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

export interface Today {
  tableId: string;
  zoneId: string;
  row: typeof floorTodayTables.$inferSelect;
  /** Every member's today's row, this table's included, by table id; null when the table is in no merge. */
  merge: { joinId: string; members: (typeof floorTodayTables.$inferSelect)[] } | null;
}

/** The table, read only within the venue's location, with its today's row and its merge. */
export async function todayOf(tx: Transaction, cfg: TillConfig, tableId: string): Promise<Today> {
  const [table] = await tx
    .select({
      zoneId: diningTables.zoneId,
      row: floorTodayTables,
      joinId: floorTodayJoinTables.joinId,
    })
    .from(diningTables)
    .innerJoin(floorZones, eq(floorZones.id, diningTables.zoneId))
    .leftJoin(floorTodayTables, eq(floorTodayTables.tableId, diningTables.id))
    .leftJoin(floorTodayJoinTables, eq(floorTodayJoinTables.tableId, diningTables.id))
    .where(
      and(
        eq(diningTables.id, tableId),
        eq(diningTables.locationId, cfg.locationId),
        eq(floorZones.active, true),
      ),
    );
  if (table === undefined) throw new AppError("table.not_found", { tableId });
  const { zoneId, row, joinId } = table;
  if (row === null) throw new AppError("table.not_on_today_plan", { tableId });
  if (joinId === null) return { tableId, zoneId, row, merge: null };
  const members = await tx
    .select({ row: floorTodayTables })
    .from(floorTodayJoinTables)
    .innerJoin(floorTodayTables, eq(floorTodayTables.tableId, floorTodayJoinTables.tableId))
    .where(eq(floorTodayJoinTables.joinId, joinId))
    .orderBy(asc(floorTodayJoinTables.tableId));
  return { tableId, zoneId, row, merge: { joinId, members: members.map((m) => m.row) } };
}

/** The zone of a table in an active zone of the venue's location, as `todayOf` finds it. */
export async function zoneOfTable(
  tx: Transaction,
  cfg: TillConfig,
  tableId: string,
): Promise<string> {
  const [table] = await tx
    .select({ zoneId: diningTables.zoneId })
    .from(diningTables)
    .innerJoin(floorZones, eq(floorZones.id, diningTables.zoneId))
    .where(
      and(
        eq(diningTables.id, tableId),
        eq(diningTables.locationId, cfg.locationId),
        eq(floorZones.active, true),
      ),
    );
  if (table === undefined) throw new AppError("table.not_found", { tableId });
  return table.zoneId;
}

/** The refusals a move, a turn or a merge shares, in the order the routes answer them; each is checked across every table before the next. */
export function refuseUnmovable(...tables: readonly Today[]): void {
  for (const { tableId, row } of tables) {
    if (row.x === null) throw new AppError("table.not_on_today_plan", { tableId });
  }
  for (const { tableId, row } of tables) {
    if (row.takenOff) throw new AppError("table.taken_off", { tableId });
  }
  for (const { tableId, row } of tables) {
    if (row.fixed) throw new AppError("table.fixed", { tableId });
  }
}

/** A party at any of the tables, the first in the caller's order named. */
export async function refuseHeld(tx: Transaction, tableIds: readonly string[]): Promise<void> {
  const holders = await holdersOf(tx, tableIds);
  const held = tableIds.find((tableId) => holders.has(tableId));
  if (held !== undefined) throw new AppError("tab.already_open", { tableId: held });
}

/** A party at any of the tables, then any of them needing clearing, the first in the caller's order named. */
export async function refuseUnfree(tx: Transaction, tableIds: readonly string[]): Promise<void> {
  if (tableIds.length === 0) return;
  await refuseHeld(tx, tableIds);
  const rows = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(
      and(inArray(diningTables.id, [...tableIds]), isNotNull(diningTables.needsClearingSince)),
    );
  const needing = new Set(rows.map((row) => row.id));
  const first = tableIds.find((tableId) => needing.has(tableId));
  if (first !== undefined) throw new AppError("table.needs_clearing", { tableId: first });
}

/** Any of the tables out of service because of a joined table, the first in the caller's order named. */
export async function refuseInJoinedTable(
  tx: Transaction,
  tableIds: readonly string[],
): Promise<void> {
  const rows = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(and(inArray(diningTables.id, [...tableIds]), joinedOutOfService(diningTables.id)));
  const joined = new Set(rows.map((row) => row.id));
  const first = tableIds.find((tableId) => joined.has(tableId));
  if (first !== undefined) throw new AppError("table.in_joined_table", { tableId: first });
}

/** Any of the tables taken off today, the first in the caller's order named; a table with no today's row never is. Reads by id alone. */
export async function refuseTakenOff(tx: Transaction, tableIds: readonly string[]): Promise<void> {
  const rows = await tx
    .select({ tableId: floorTodayTables.tableId })
    .from(floorTodayTables)
    .where(
      and(inArray(floorTodayTables.tableId, [...tableIds]), eq(floorTodayTables.takenOff, true)),
    );
  const off = new Set(rows.map((row) => row.tableId));
  const first = tableIds.find((tableId) => off.has(tableId));
  if (first !== undefined) throw new AppError("table.taken_off", { tableId: first });
}
