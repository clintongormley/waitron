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
import { AppError, NEW_TABLE_SIZE } from "@waitron/shared";
import { leaveMergesRestoring } from "./floor-today-merges.js";
import { partsOf, type Part } from "./floor-today-parts.js";
import { splitJoinedTable } from "./floor-today-split.js";
import { catchUpZone, foodComingTo, placementColumns, placementOf } from "./floor-today-store.js";
import { refuseHeld, todayOf, type Today } from "./floor-today-table.js";
import type { Placement } from "./floor-reset-plan.js";
import { joinedPlaceOver, partPlaces } from "./joined-split-layout.js";
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
  const today = await todayOf(tx, cfg, args.tableId);
  if (today.merge !== null) {
    return splitGroup(tx, cfg, removals, now, { zoneId: today.zoneId, merge: today.merge }, args);
  }
  return splitJoinedTable(tx, cfg, args);
}

type Merge = NonNullable<Today["merge"]>;
type Row = Merge["members"][number];

interface Rejoin {
  joinedId: string;
  parts: Part[];
  /** The indexes into `parts` of the tables that stay, in order and side by side. */
  stayingAt: number[];
  anchor: Placement;
  whole: boolean;
}

/**
 * `partIds` leave the group as a table leaves a group. When two or more stay, all split off one
 * joined table none of whose tables is still joined, next to each other in its order and each
 * standing where its layout from the first of them puts it, with nobody seated and no food on its
 * way to them, the joined table is put back over them; otherwise they stay a group of `seats`.
 */
async function splitGroup(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  now: Date,
  { zoneId, merge }: { zoneId: string; merge: Merge },
  { tableId, partIds, seats }: SplitArgs,
): Promise<void> {
  const members = merge.members.map((member) => member.tableId);
  for (const partId of partIds) {
    if (!members.includes(partId)) {
      throw new AppError("merge.member_invalid", { tableId: partId, field: "partIds" });
    }
  }
  const ticked = new Set(partIds);
  const staying = merge.members.filter((member) => !ticked.has(member.tableId));
  if (staying.length === 0) throw new AppError("merge.split_all", { tableId, field: "partIds" });
  await refuseHeld(tx, members);

  const rejoin = staying.length >= 2 ? await rejoining(tx, staying) : null;
  if (rejoin === null) {
    if (staying.length < 2) return leaveMergesRestoring(tx, partIds);
    if (seats === null) throw new AppError("merge.seats_required", {});
    await leaveMergesRestoring(tx, partIds);
    await tx.update(floorTodayJoins).set({ seats }).where(eq(floorTodayJoins.id, merge.joinId));
    return;
  }
  if (!rejoin.whole && seats === null) throw new AppError("joined_table.seats_required", {});

  await leaveMergesRestoring(tx, partIds);
  const { joinedId, parts, stayingAt, anchor, whole } = rejoin;
  const stayingIds = staying.map((member) => member.tableId);
  await tx.delete(floorTodayJoinTables).where(eq(floorTodayJoinTables.joinId, merge.joinId));
  await tx.delete(floorTodayJoins).where(eq(floorTodayJoins.id, merge.joinId));
  await tx
    .update(diningTables)
    .set({ needsClearingSince: null })
    .where(inArray(diningTables.id, stayingIds));
  await tx
    .delete(floorTodaySplitParts)
    .where(
      and(
        eq(floorTodaySplitParts.joinedTableId, joinedId),
        inArray(floorTodaySplitParts.partTableId, stayingIds),
      ),
    );
  const [saved] = await tx
    .select()
    .from(floorResetTables)
    .where(eq(floorResetTables.tableId, joinedId));
  const size = placementOf(saved!) ?? { width: NEW_TABLE_SIZE, height: NEW_TABLE_SIZE };
  const place = joinedPlaceOver(anchor, parts, stayingAt, whole, size);
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
  await catchUpZone(tx, cfg, removals, zoneId, now);
}

/**
 * Within one square: places are rounded to whole squares, so on a turned table the slot worked out
 * from the anchor's rounded place can be a square off where the joined table's own layout, or a merge
 * beside a neighbour, rounded the table.
 */
const standsIn = (at: Placement, slot: Placement): boolean =>
  Math.abs(at.x - slot.x) <= 1 && Math.abs(at.y - slot.y) <= 1 && at.rotation === slot.rotation;

/** The joined table `staying` were all split off, when it may be put back over them; else null. The caller has refused a seated group. */
async function rejoining(tx: Transaction, staying: readonly Row[]): Promise<Rejoin | null> {
  const ids = staying.map((member) => member.tableId);
  const rows = await tx
    .select({ joinedId: floorTodaySplitParts.joinedTableId })
    .from(floorTodaySplitParts)
    .where(inArray(floorTodaySplitParts.partTableId, ids));
  const joinedIds = new Set(rows.map((row) => row.joinedId));
  if (rows.length !== staying.length || joinedIds.size !== 1) return null;
  const [joinedId] = joinedIds as Set<string>;
  const parts = await partsOf(tx, joinedId!);
  if (!parts.every((part) => part.splitOff)) return null;
  const stayingAt = parts.flatMap((part, index) => (ids.includes(part.tableId) ? [index] : []));
  const first = stayingAt[0]!;
  if (stayingAt.at(-1)! - first !== stayingAt.length - 1) return null;
  const rowOf = new Map(staying.map((member) => [member.tableId, member]));
  const placeOf = (index: number) => placementOf(rowOf.get(parts[index]!.tableId)!)!;
  const anchor = placeOf(first);
  const slots = partPlaces(anchor, parts, first);
  if (!stayingAt.every((index) => standsIn(placeOf(index), slots[index]!))) return null;
  if ((await foodComingTo(tx, ids)).size > 0) return null;
  return {
    joinedId: joinedId!,
    parts,
    stayingAt,
    anchor,
    whole: parts.every((part) => ids.includes(part.tableId)),
  };
}
