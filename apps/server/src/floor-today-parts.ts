import { aliasedTable, eq, exists, sql } from "drizzle-orm";
import {
  diningTables,
  floorPlanTableSizes,
  floorPlanTables,
  floorResetTableParts,
  floorResetTables,
  floorTodaySplitParts,
  stillJoinedPart,
  type Transaction,
} from "@waitron/db";
import { NEW_TABLE_SIZE, compareLabels } from "@waitron/shared";
import type { LaidPart } from "./joined-split-layout.js";

export interface Part extends LaidPart {
  label: string;
  stillJoined: boolean;
  splitOff: boolean;
  savedSeats: number | null;
}

const joinedRow = aliasedTable(floorResetTables, "joined_row");
const partRow = aliasedTable(floorResetTables, "part_row");

/** Every part of the joined table in today's copy that has a live table, in number order. */
export async function partsOf(tx: Transaction, tableId: string): Promise<Part[]> {
  const rows = await tx
    .select({
      tableId: diningTables.id,
      label: diningTables.label,
      placedWidth: floorPlanTables.width,
      placedHeight: floorPlanTables.height,
      keptWidth: floorPlanTableSizes.width,
      keptHeight: floorPlanTableSizes.height,
      savedSeats: partRow.seats,
      stillJoined: sql<number>`${stillJoinedPart(diningTables.id)}`,
      splitOff: sql<number>`${exists(
        tx
          .select({ one: sql`1` })
          .from(floorTodaySplitParts)
          .where(eq(floorTodaySplitParts.partTableId, diningTables.id)),
      )}`,
    })
    .from(floorResetTableParts)
    .innerJoin(joinedRow, eq(joinedRow.id, floorResetTableParts.joinedResetTableId))
    .innerJoin(partRow, eq(partRow.id, floorResetTableParts.partResetTableId))
    .innerJoin(diningTables, eq(diningTables.id, partRow.tableId))
    .leftJoin(floorPlanTables, eq(floorPlanTables.id, diningTables.planTableId))
    .leftJoin(floorPlanTableSizes, eq(floorPlanTableSizes.planTableId, diningTables.planTableId))
    .where(eq(joinedRow.tableId, tableId));
  return rows
    .map((row) => ({
      tableId: row.tableId,
      label: row.label,
      width: row.placedWidth ?? row.keptWidth ?? NEW_TABLE_SIZE,
      height: row.placedHeight ?? row.keptHeight ?? NEW_TABLE_SIZE,
      stillJoined: Boolean(row.stillJoined),
      splitOff: Boolean(row.splitOff),
      savedSeats: row.savedSeats,
    }))
    .sort((a, b) => compareLabels(a.label, b.label));
}
