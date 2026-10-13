import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  partyTables,
  floorTodayJoins,
  floorTodayJoinTables,
  floorResetTables,
  floorTodaySplitParts,
  floorTodayTables,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, freeSide, touchingPlace, type JoinPlace, type JoinSide } from "@waitron/shared";
import {
  refuseHeld,
  refuseInJoinedTable,
  refuseUnfree,
  refuseUnmovable,
  todayOf,
  type Today,
} from "./floor-today-table.js";
import { partsOf, passGuests, type Part } from "./floor-today-parts.js";
import { placementColumns, placementOf, refuseDeliveryPending } from "./floor-today-store.js";
import type { Placement } from "./floor-reset-plan.js";
import { partPlaces } from "./joined-split-layout.js";
import { holderOf, partyRevision } from "./parties.js";
import { joinTables, type SlipsLater } from "./table-actions.js";
import type { OriginConfig, TillConfig } from "./till-config.js";
import "./errors.js";

/**
 * The tables leave their today's merges; a merge left with fewer than two members goes, and its last
 * member goes back to where it stood before the merge.
 */
export async function leaveMerges(tx: Transaction, tableIds: readonly string[]): Promise<void> {
  const left = await tx
    .delete(floorTodayJoinTables)
    .where(inArray(floorTodayJoinTables.tableId, [...tableIds]))
    .returning({ joinId: floorTodayJoinTables.joinId });
  for (const joinId of new Set(left.map((row) => row.joinId))) {
    const rest = await tx
      .select({
        tableId: floorTodayJoinTables.tableId,
        beforeX: floorTodayJoinTables.beforeX,
        beforeY: floorTodayJoinTables.beforeY,
        beforeRotation: floorTodayJoinTables.beforeRotation,
      })
      .from(floorTodayJoinTables)
      .where(eq(floorTodayJoinTables.joinId, joinId));
    if (rest.length >= 2) continue;
    for (const member of rest) {
      await putBack(tx, member);
    }
    await tx.delete(floorTodayJoinTables).where(eq(floorTodayJoinTables.joinId, joinId));
    await tx.delete(floorTodayJoins).where(eq(floorTodayJoins.id, joinId));
  }
}

async function putBack(
  tx: Transaction,
  member: { tableId: string; beforeX: number; beforeY: number; beforeRotation: number },
): Promise<void> {
  await tx
    .update(floorTodayTables)
    .set({ x: member.beforeX, y: member.beforeY, rotation: member.beforeRotation })
    .where(and(eq(floorTodayTables.tableId, member.tableId), isNotNull(floorTodayTables.x)));
}

/** Each table leaves its merge and goes back to where it stood before; a merge left with one member ends as leaveMerges ends it. */
export async function leaveMergesRestoring(
  tx: Transaction,
  tableIds: readonly string[],
): Promise<void> {
  const leaving = await tx
    .select({
      tableId: floorTodayJoinTables.tableId,
      beforeX: floorTodayJoinTables.beforeX,
      beforeY: floorTodayJoinTables.beforeY,
      beforeRotation: floorTodayJoinTables.beforeRotation,
    })
    .from(floorTodayJoinTables)
    .where(inArray(floorTodayJoinTables.tableId, [...tableIds]));
  for (const member of leaving) {
    await putBack(tx, member);
  }
  await leaveMerges(tx, tableIds);
}

/** The table's merge ends, every member going back to where it stood before; no party may hold one. A table in no merge is left alone. */
export async function splitFreeMerge(
  tx: Transaction,
  cfg: TillConfig,
  tableId: string,
): Promise<void> {
  const { merge } = await todayOf(tx, cfg, tableId);
  if (merge === null) return;
  const members = merge.members.map((m) => m.tableId);
  await refuseHeld(tx, members);
  await leaveMergesRestoring(tx, members);
}

/** Every member of `tableId`'s merge by table id, `tableId` included, or [] when it is in none. Reads by id alone: the caller checks the venue first. */
export async function mergeMembers(tx: Transaction, tableId: string): Promise<string[]> {
  const own = tx
    .select({ joinId: floorTodayJoinTables.joinId })
    .from(floorTodayJoinTables)
    .where(eq(floorTodayJoinTables.tableId, tableId));
  const members = await tx
    .select({ tableId: floorTodayJoinTables.tableId })
    .from(floorTodayJoinTables)
    .where(inArray(floorTodayJoinTables.joinId, own))
    .orderBy(asc(floorTodayJoinTables.tableId));
  return members.map((m) => m.tableId);
}

/**
 * The party just seated at `tableId` takes every other member of its merge: refused
 * `tab.already_open` for a member a party holds, `table.needs_clearing` for one needing clearing.
 */
export async function seatMergeMembers(
  tx: Transaction,
  partyId: string,
  tableId: string,
): Promise<void> {
  const others = (await mergeMembers(tx, tableId)).filter((id) => id !== tableId);
  await refuseUnfree(tx, others);
  for (const other of others) {
    await tx.insert(partyTables).values({ partyId, tableId: other });
  }
}

/** Every member of `tableId`'s merge that no party holds joins the party, as the join route joins a table. */
export async function joinMergeMembers(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  tableId: string,
  operatorId: string,
  slipsLater?: SlipsLater,
): Promise<void> {
  for (const member of await mergeMembers(tx, tableId)) {
    if ((await holderOf(tx, member)) !== null) continue;
    await joinTables(tx, cfg, partyId, member, {
      bills: "merge",
      expectedPartyRevision: await partyRevision(tx, partyId),
      operatorId,
      otherPartyId: null,
      slipsLater,
    });
  }
}

/**
 * `moving` joins `target`'s merge (or a new one), touching it on `side`; with `free`, neither table,
 * nor a table still joined in either that goes in the merge, may be held or need clearing.
 * This never puts a joined table in a merge: its tables still joined are split off it and go in
 * instead, and its guests pass to them; the caller tells the kitchen. A joined `target` a reset
 * already left in a merge stays whole in it, and a joined `moving` table in one is refused
 * `table.merged`.
 */
export async function writeMerge(
  tx: Transaction,
  cfg: TillConfig,
  args: { movingId: string; targetId: string; side: JoinSide; seats: number | null; free: boolean },
): Promise<void> {
  if (args.movingId === args.targetId) {
    throw new AppError("management.request_invalid", { field: "targetId" });
  }
  const moving = await todayOf(tx, cfg, args.movingId);
  const target = await todayOf(tx, cfg, args.targetId);
  const { zoneId } = target;
  refuseUnmovable(moving, target);
  await refuseInJoinedTable(tx, [moving.tableId, target.tableId]);
  if (moving.merge !== null) throw new AppError("table.merged", { tableId: moving.tableId });
  if (args.free) await refuseUnfree(tx, [moving.tableId, target.tableId]);
  if (zoneId !== moving.zoneId) {
    throw new AppError("service_zone.join_mismatch", {
      orderZoneId: zoneId,
      tableZoneId: moving.zoneId,
    });
  }

  if (args.seats === null) throw new AppError("merge.seats_required", {});
  const { seats } = args;

  const movingParts = await partsOf(tx, moving.tableId);
  const targetParts = target.merge === null ? await partsOf(tx, target.tableId) : [];
  if (movingParts.length > 0) await refuseDeliveryPending(tx, moving.tableId);
  if (targetParts.length > 0) await refuseDeliveryPending(tx, target.tableId);
  if (args.free) {
    const joining = [...movingParts, ...targetParts].flatMap((part) =>
      part.stillJoined ? [part.tableId] : [],
    );
    await refuseUnfree(tx, joining);
  }
  await splitInUse(tx, moving.tableId, movingParts);
  await splitInUse(tx, target.tableId, targetParts);

  let joinId = target.merge?.joinId;
  if (joinId === undefined) {
    const [join] = await tx
      .insert(floorTodayJoins)
      .values({ zoneId, seats })
      .returning({ id: floorTodayJoins.id });
    joinId = join!.id;
    if (targetParts.length === 0) {
      await tx.insert(floorTodayJoinTables).values(beforeRow(joinId, target));
    }
  } else {
    await tx.update(floorTodayJoins).set({ seats }).where(eq(floorTodayJoins.id, joinId));
  }

  const targetRow = placementOf(target.row)!;
  const targetTables = laidInside(targetRow, targetParts);
  for (const laid of targetTables) {
    await standApart(tx, joinId, target.tableId, laid.tableId, laid.place, laid.place);
  }
  if (targetParts.length > 0) {
    await passGuests(
      tx,
      cfg,
      target.tableId,
      targetTables.map((laid) => laid.tableId),
      "caller",
    );
  }

  const goes = { width: moving.row.width!, height: moving.row.height! };
  const against = placeOf(target.row);
  const members =
    targetParts.length > 0
      ? targetTables.map((laid) => laid.place)
      : (target.merge?.members ?? [target.row]).filter((m) => m.x !== null).map(placeOf);
  const side = freeSide(against, goes, members, args.side);
  const at = touchingPlace(against, goes, side);

  if (movingParts.length === 0) {
    await tx.insert(floorTodayJoinTables).values(beforeRow(joinId, moving));
    await tx.update(floorTodayTables).set(at).where(eq(floorTodayTables.id, moving.row.id));
    return;
  }
  const outline = placementOf(moving.row)!;
  const from = laidInside(outline, movingParts);
  const to = laidInside({ ...outline, ...at }, movingParts);
  for (const [index, laid] of to.entries()) {
    await standApart(tx, joinId, moving.tableId, laid.tableId, laid.place, from[index]!.place);
  }
  await passGuests(
    tx,
    cfg,
    moving.tableId,
    to.map((laid) => laid.tableId),
    "caller",
  );
}

/** Each table of the joined table still joined, in number order, where it stands inside `outline`. */
function laidInside(
  outline: Placement,
  parts: readonly Part[],
): { tableId: string; place: Placement }[] {
  const covered = parts.findIndex((part) => !part.splitOff);
  const places = partPlaces(outline, parts, covered);
  return parts.flatMap((part, index) =>
    part.stillJoined ? [{ tableId: part.tableId, place: places[index]! }] : [],
  );
}

/**
 * Each table of the joined table in use, so neither still joined nor split off, is split off where
 * it stands and stays out of the group: the joined table is apart from now on, so once free the
 * table is an ordinary one. Marking its reset row placed stops the catch-up taking it off the map
 * when it frees.
 */
async function splitInUse(
  tx: Transaction,
  joinedId: string,
  parts: readonly Part[],
): Promise<void> {
  for (const part of parts) {
    if (part.stillJoined || part.splitOff) continue;
    await tx
      .insert(floorTodaySplitParts)
      .values({ joinedTableId: joinedId, partTableId: part.tableId });
    await tx
      .update(floorResetTables)
      .set({ placed: true })
      .where(eq(floorResetTables.tableId, part.tableId));
  }
}

/** `partId` is split off `joinedId`, stands at `place` and joins the merge as having stood at `before`. */
async function standApart(
  tx: Transaction,
  joinId: string,
  joinedId: string,
  partId: string,
  place: Placement,
  before: Placement,
): Promise<void> {
  await tx.insert(floorTodaySplitParts).values({ joinedTableId: joinedId, partTableId: partId });
  await tx
    .update(floorTodayTables)
    .set({ ...placementColumns(place), takenOff: false })
    .where(eq(floorTodayTables.tableId, partId));
  await tx.insert(floorTodayJoinTables).values({
    joinId,
    tableId: partId,
    beforeX: before.x,
    beforeY: before.y,
    beforeRotation: before.rotation,
  });
}

function placeOf(row: Today["row"]): JoinPlace {
  return { x: row.x!, y: row.y!, width: row.width!, height: row.height!, rotation: row.rotation! };
}

function beforeRow(joinId: string, today: Today) {
  return {
    joinId,
    tableId: today.tableId,
    beforeX: today.row.x!,
    beforeY: today.row.y!,
    beforeRotation: today.row.rotation!,
  };
}
