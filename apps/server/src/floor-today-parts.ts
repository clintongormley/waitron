import { aliasedTable, and, eq, exists, inArray, isNull, max, sql } from "drizzle-orm";
import {
  diningTables,
  nowIso,
  parties,
  partyTables,
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
import { enqueueMovedSlipsFor, readPartiesSentWork } from "./kitchen-print.js";
import { checkAndBumpParty, holderOf, leaveTables } from "./parties.js";
import type { TillConfig } from "./till-config.js";

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

/**
 * The party at `fromTableId`, if any, leaves it and sits at `toTableIds`: not a turnover, so its
 * status stays. They join in the order given, each a millisecond after the party's latest table, so
 * the party's name lists them in that order after the tables it already holds. With `"caller"` the
 * caller tells the kitchen.
 */
export async function passGuests(
  tx: Transaction,
  cfg: TillConfig,
  fromTableId: string,
  toTableIds: readonly string[],
  slips: "now" | "caller",
): Promise<void> {
  const partyId = await holderOf(tx, fromTableId);
  if (partyId === null) return;
  await tx
    .update(diningTables)
    .set({ needsClearingSince: null })
    .where(inArray(diningTables.id, [...toTableIds]));
  const before = slips === "now" ? await readPartiesSentWork(tx, cfg, [partyId]) : null;
  const [party] = await tx
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  await checkAndBumpParty(tx, partyId, party!.revision, "open");
  const [latest] = await tx
    .select({ joinedAt: max(partyTables.joinedAt) })
    .from(partyTables)
    .where(and(eq(partyTables.partyId, partyId), isNull(partyTables.leftAt)));
  const now = nowIso();
  const from = Date.parse(
    latest?.joinedAt != null && latest.joinedAt > now ? latest.joinedAt : now,
  );
  await leaveTables(tx, [fromTableId]);
  for (const [index, tableId] of toTableIds.entries()) {
    const joinedAt = new Date(from + index + 1).toISOString();
    await tx.insert(partyTables).values({ partyId, tableId, joinedAt });
  }
  if (before !== null) await enqueueMovedSlipsFor(tx, cfg, before);
}
