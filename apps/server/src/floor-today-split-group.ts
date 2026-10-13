import { and, eq, inArray } from "drizzle-orm";
import {
  diningTables,
  floorResetTables,
  floorTodayJoinTables,
  floorTodayJoins,
  floorTodaySplitParts,
  floorTodayTables,
  type Transaction,
} from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { leaveMergesRestoring } from "./floor-today-merges.js";
import { partsOf, type Part } from "./floor-today-parts.js";
import { splitJoinedTable } from "./floor-today-split.js";
import { catchUpZone, foodComingTo, placementColumns, placementOf } from "./floor-today-store.js";
import { refuseHeld, todayOf } from "./floor-today-table.js";
import { joinedPlaceOver } from "./joined-split-layout.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

interface SplitArgs {
  tableId: string;
  partIds: string[];
  seats: number | null;
}

/** Split tables… on `tableId`: a joined table with tables still joined splits as one, else a table in a group splits the group, else the joined table's split answers. */
export async function splitOff(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  now: Date,
  args: SplitArgs,
): Promise<void> {
  if ((await partsOf(tx, args.tableId)).some((part) => part.stillJoined)) {
    return splitJoinedTable(tx, cfg, args);
  }
  if ((await todayOf(tx, cfg, args.tableId)).merge !== null) {
    return splitGroup(tx, cfg, removals, now, args);
  }
  return splitJoinedTable(tx, cfg, args);
}

/**
 * `partIds` leave `tableId`'s group as a table leaves a group. When two or more stay, all split off
 * one joined table none of whose tables is still joined, with nobody seated and no food on its way,
 * the joined table is put back over them where they stand; otherwise they stay a group of `seats`.
 */
export async function splitGroup(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  now: Date,
  { tableId, partIds, seats }: SplitArgs,
): Promise<void> {
  const today = await todayOf(tx, cfg, tableId);
  const merge = today.merge!;
  const members = merge.members.map((member) => member.tableId);
  for (const partId of partIds) {
    if (!members.includes(partId)) {
      throw new AppError("merge.member_invalid", { tableId: partId, field: "partIds" });
    }
  }
  const ticked = new Set(partIds);
  const staying = members.filter((member) => !ticked.has(member));
  if (staying.length === 0) throw new AppError("merge.split_all", { tableId, field: "partIds" });
  await refuseHeld(tx, members);

  const rejoin = staying.length >= 2 ? await rejoining(tx, staying) : null;
  const whole = rejoin !== null && rejoin.parts.every((part) => staying.includes(part.tableId));
  if (staying.length >= 2 && !whole && seats === null) {
    throw new AppError(
      rejoin === null ? "merge.seats_required" : "joined_table.seats_required",
      {},
    );
  }

  await leaveMergesRestoring(tx, partIds);
  if (staying.length < 2) return;
  if (rejoin === null) {
    await tx
      .update(floorTodayJoins)
      .set({ seats: seats! })
      .where(eq(floorTodayJoins.id, merge.joinId));
    return;
  }

  const { joinedId, parts } = rejoin;
  await tx.delete(floorTodayJoinTables).where(eq(floorTodayJoinTables.joinId, merge.joinId));
  await tx.delete(floorTodayJoins).where(eq(floorTodayJoins.id, merge.joinId));
  await tx
    .update(diningTables)
    .set({ needsClearingSince: null })
    .where(inArray(diningTables.id, staying));
  await tx
    .delete(floorTodaySplitParts)
    .where(
      and(
        eq(floorTodaySplitParts.joinedTableId, joinedId),
        inArray(floorTodaySplitParts.partTableId, staying),
      ),
    );
  const stayingAt = parts.flatMap((part, index) => (staying.includes(part.tableId) ? [index] : []));
  const first = merge.members.find((member) => member.tableId === parts[stayingAt[0]!]!.tableId)!;
  const [saved] = await tx
    .select()
    .from(floorResetTables)
    .where(eq(floorResetTables.tableId, joinedId));
  const place = joinedPlaceOver(placementOf(first)!, parts, stayingAt, whole, {
    width: saved!.width!,
    height: saved!.height!,
  });
  for (const index of stayingAt) {
    const part = parts[index]!;
    await tx
      .update(floorTodayTables)
      .set({ ...placementColumns(null), seats: part.savedSeats, takenOff: false })
      .where(eq(floorTodayTables.tableId, part.tableId));
  }
  await tx
    .update(floorTodayTables)
    .set({ ...placementColumns(place), seats: whole ? saved!.seats : seats, takenOff: false })
    .where(eq(floorTodayTables.tableId, joinedId));
  await catchUpZone(tx, cfg, removals, today.zoneId, now);
}

/** The joined table `staying` were all split off, with its parts, when it may be put back over them; else null. The caller has refused a seated group. */
async function rejoining(
  tx: Transaction,
  staying: readonly string[],
): Promise<{ joinedId: string; parts: Part[] } | null> {
  const rows = await tx
    .select({ joinedId: floorTodaySplitParts.joinedTableId })
    .from(floorTodaySplitParts)
    .where(inArray(floorTodaySplitParts.partTableId, [...staying]));
  const joinedIds = new Set(rows.map((row) => row.joinedId));
  if (rows.length !== staying.length || joinedIds.size !== 1) return null;
  const [joinedId] = joinedIds as Set<string>;
  const parts = await partsOf(tx, joinedId!);
  if (!parts.every((part) => part.splitOff)) return null;
  if ((await foodComingTo(tx, staying)).size > 0) return null;
  return { joinedId: joinedId!, parts };
}
