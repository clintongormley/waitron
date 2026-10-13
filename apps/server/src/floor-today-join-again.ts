import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  diningTables,
  floorResetTables,
  floorTodayJoinTables,
  floorTodaySplitParts,
  floorTodayTables,
  joinedTableApart,
  type Transaction,
} from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { catchUpZone, foodComingTo, placementColumns, placementOf } from "./floor-today-store.js";
import { partsOf } from "./floor-today-split.js";
import { todayOf } from "./floor-today-table.js";
import { joinedPlaceAfter } from "./joined-split-layout.js";
import { holdersOf } from "./parties.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

/** Those of `tableIds` with no party, no clearing mark, no merge and no food on its way. */
async function freeOf(tx: Transaction, tableIds: readonly string[]): Promise<Set<string>> {
  if (tableIds.length === 0) return new Set();
  const held = await holdersOf(tx, tableIds);
  const clearing = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(
      and(inArray(diningTables.id, [...tableIds]), isNotNull(diningTables.needsClearingSince)),
    );
  const merged = await tx
    .select({ id: floorTodayJoinTables.tableId })
    .from(floorTodayJoinTables)
    .where(inArray(floorTodayJoinTables.tableId, [...tableIds]));
  const food = await foodComingTo(tx, tableIds);
  const busy = new Set([
    ...held.keys(),
    ...clearing.map((row) => row.id),
    ...merged.map((row) => row.id),
    ...food,
  ]);
  return new Set(tableIds.filter((id) => !busy.has(id)));
}

/** Puts every free table split off the joined table back into it: they leave the map, it grows over them. */
export async function joinAgain(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  now: Date,
  { tableId, partIds, seats }: { tableId: string; partIds: string[]; seats: number | null },
): Promise<void> {
  const today = await todayOf(tx, cfg, tableId);
  const parts = await partsOf(tx, tableId);
  if (parts.length === 0) throw new AppError("joined_table.not_found", { tableId });
  // `partsOf` reached the parts through this row, and `table_id` is unique there.
  const [saved] = await tx
    .select()
    .from(floorResetTables)
    .where(eq(floorResetTables.tableId, tableId));
  const splitRows = await tx
    .select({ partId: floorTodaySplitParts.partTableId })
    .from(floorTodaySplitParts)
    .where(eq(floorTodaySplitParts.joinedTableId, tableId));
  const split = new Set(splitRows.map((row) => row.partId));
  const splitOff = parts.filter((part) => split.has(part.tableId));
  const free = await freeOf(
    tx,
    splitOff.map((part) => part.tableId),
  );
  const back = splitOff.filter((part) => free.has(part.tableId));
  const joined = parts.filter((part) => part.stillJoined).length;
  if (back.length === 0 || joined + back.length < 2) {
    throw new AppError("joined_table.nothing_to_join", { tableId });
  }
  const sent = new Set(partIds);
  if (sent.size !== back.length || back.some((part) => !sent.has(part.tableId))) {
    throw new AppError("joined_table.out_of_date", { tableId });
  }
  const whole = back.length === splitOff.length;
  if (!whole && seats === null) throw new AppError("joined_table.seats_required", {});
  const [{ apart }] = await tx
    .select({ apart: joinedTableApart(diningTables.id).mapWith(Boolean) })
    .from(diningTables)
    .where(eq(diningTables.id, tableId));
  const row = placementOf(today.row);
  const covered = parts.findIndex((part) => !split.has(part.tableId));
  const backIds = new Set(back.map((part) => part.tableId));
  const staying = parts.flatMap((part, index) =>
    !split.has(part.tableId) || backIds.has(part.tableId) ? [index] : [],
  );
  const place = joinedPlaceAfter({
    row,
    standing: !apart && !today.row.takenOff && row !== null,
    saved: placementOf(saved!),
    parts,
    covered,
    staying,
    whole,
  });
  await tx
    .delete(floorTodaySplitParts)
    .where(
      and(
        eq(floorTodaySplitParts.joinedTableId, tableId),
        inArray(floorTodaySplitParts.partTableId, [...backIds]),
      ),
    );
  for (const part of back) {
    await tx
      .update(floorTodayTables)
      .set({
        ...placementColumns(null),
        seats: part.savedSeats,
        takenOff: false,
      })
      .where(eq(floorTodayTables.tableId, part.tableId));
  }
  await tx
    .update(floorTodayTables)
    .set({ ...placementColumns(place), seats: whole ? saved!.seats : seats, takenOff: false })
    .where(eq(floorTodayTables.id, today.row.id));
  await catchUpZone(tx, cfg, removals, today.zoneId, now);
}
