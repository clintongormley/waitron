import { and, eq, inArray, isNotNull, not } from "drizzle-orm";
import {
  diningTables,
  joinedOutOfService,
  floorResetTables,
  floorTodayJoinTables,
  floorTodaySplitParts,
  floorTodayTables,
  type Transaction,
} from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { catchUpZone, foodComingTo, placementColumns, placementOf } from "./floor-today-store.js";
import { leaveMergesRestoring, mergeMembers } from "./floor-today-merges.js";
import { partsOf } from "./floor-today-parts.js";
import { todayOf } from "./floor-today-table.js";
import { joinedPlaceAfter, standsIn } from "./joined-split-layout.js";
import { holdersOf } from "./parties.js";
import type { Placement } from "./floor-reset-plan.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

/**
 * Takes back every table split off the joined table that no party holds and no food is on its way
 * to, ending any group one is in, and puts the joined table in its saved place: all of it when
 * whole, else over the slots of the tables joined.
 */
export async function resetTable(
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
  const splitOffIds = parts.filter((part) => split.has(part.tableId)).map((part) => part.tableId);
  const held = await holdersOf(tx, splitOffIds);
  const food = await foodComingTo(tx, splitOffIds);
  const back = parts.filter(
    (part) => split.has(part.tableId) && !held.has(part.tableId) && !food.has(part.tableId),
  );
  const joined = parts.filter((part) => part.stillJoined).length;
  if (back.length === 0 || joined + back.length < 2) {
    const grouped = await tx
      .select({ id: floorTodayJoinTables.tableId })
      .from(floorTodayJoinTables)
      .where(inArray(floorTodayJoinTables.tableId, splitOffIds));
    const inGroup = new Set(grouped.map((row) => row.id));
    const blocking = splitOffIds.filter((id) => held.has(id) && inGroup.has(id));
    if (blocking.length > 0) {
      throw new AppError("joined_table.tables_in_group", { tableId, partIds: blocking });
    }
    throw new AppError("joined_table.nothing_to_join", { tableId });
  }
  const sent = new Set(partIds);
  if (sent.size !== back.length || back.some((part) => !sent.has(part.tableId))) {
    throw new AppError("joined_table.out_of_date", { tableId });
  }
  const whole = back.length === splitOffIds.length;
  if (!whole && seats === null) throw new AppError("joined_table.seats_required", {});
  const backIds = [...sent];
  const staying = parts.flatMap((part, index) =>
    !split.has(part.tableId) || sent.has(part.tableId) ? [index] : [],
  );
  const place = joinedPlaceAfter({
    row: placementOf(today.row),
    standing: false,
    saved: placementOf(saved!),
    parts,
    covered: 0,
    staying,
    whole,
  });

  for (const id of backIds) {
    const members = await mergeMembers(tx, id);
    if (members.length > 0) await leaveMergesRestoring(tx, members);
  }
  await refusePlaceTaken(tx, today.zoneId, tableId, place!, new Set([tableId, ...backIds]));
  await tx
    .update(diningTables)
    .set({ needsClearingSince: null })
    .where(inArray(diningTables.id, backIds));
  await tx
    .delete(floorTodaySplitParts)
    .where(
      and(
        eq(floorTodaySplitParts.joinedTableId, tableId),
        inArray(floorTodaySplitParts.partTableId, backIds),
      ),
    );
  for (const part of back) {
    await tx
      .update(floorTodayTables)
      .set({ ...placementColumns(null), seats: part.savedSeats, takenOff: false })
      .where(eq(floorTodayTables.tableId, part.tableId));
  }
  await tx
    .update(floorTodayTables)
    .set({ ...placementColumns(place), seats: whole ? saved!.seats : seats, takenOff: false })
    .where(eq(floorTodayTables.id, today.row.id));
  await catchUpZone(tx, cfg, removals, today.zoneId, now);
}

/** Refuses when a table drawn on today's map, other than `own`, stands in `place`; the first by label is named. */
async function refusePlaceTaken(
  tx: Transaction,
  zoneId: string,
  tableId: string,
  place: Placement,
  own: ReadonlySet<string>,
): Promise<void> {
  const rows = await tx
    .select({
      id: diningTables.id,
      label: diningTables.label,
      x: floorTodayTables.x,
      y: floorTodayTables.y,
      width: floorTodayTables.width,
      height: floorTodayTables.height,
      shape: floorTodayTables.shape,
      rotation: floorTodayTables.rotation,
    })
    .from(floorTodayTables)
    .innerJoin(diningTables, eq(diningTables.id, floorTodayTables.tableId))
    .where(
      and(
        eq(diningTables.zoneId, zoneId),
        isNotNull(floorTodayTables.x),
        eq(floorTodayTables.takenOff, false),
        not(joinedOutOfService(diningTables.id)),
      ),
    );
  const standing = rows
    .filter((row) => !own.has(row.id) && standsIn(place, placementOf(row)!))
    .sort(
      (a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true }) || a.id.localeCompare(b.id),
    );
  if (standing.length > 0) {
    throw new AppError("table.place_taken", { tableId, standingId: standing[0]!.id });
  }
}
