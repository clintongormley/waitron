import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  diningTables,
  floorPlanJoins,
  parties,
  partyTables,
  floorPlanJoinTables,
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodayTables,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, touchingPlace, type JoinSide } from "@waitron/shared";
import {
  refuseHeld,
  refuseUnfree,
  refuseUnmovable,
  todayOf,
  type Today,
} from "./floor-today-table.js";
import { joinTables } from "./table-actions.js";
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

/** Every member of `tableId`'s merge, `tableId` included, or [] when it is in none. Reads by id alone: the caller checks the venue first. */
export async function mergeMembers(tx: Transaction, tableId: string): Promise<string[]> {
  const [own] = await tx
    .select({ joinId: floorTodayJoinTables.joinId })
    .from(floorTodayJoinTables)
    .where(eq(floorTodayJoinTables.tableId, tableId));
  if (own === undefined) return [];
  const members = await tx
    .select({ tableId: floorTodayJoinTables.tableId })
    .from(floorTodayJoinTables)
    .where(eq(floorTodayJoinTables.joinId, own.joinId));
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
): Promise<void> {
  for (const member of await mergeMembers(tx, tableId)) {
    const [held] = await tx
      .select({ id: partyTables.id })
      .from(partyTables)
      .where(and(eq(partyTables.tableId, member), isNull(partyTables.leftAt)));
    if (held !== undefined) continue;
    await joinTables(tx, cfg, partyId, member, {
      bills: "merge",
      expectedPartyRevision: await partyRevision(tx, partyId),
      operatorId,
      otherPartyId: null,
    });
  }
}

/** The party's revision as it stands in the transaction now. */
export async function partyRevision(tx: Transaction, partyId: string): Promise<number> {
  const [party] = await tx
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  return party!.revision;
}

/**
 * The seats of the master's saved join with exactly these tables' master tables, or null. The
 * master is read as it is now: a reset copies no joins. Reads by id alone: the caller checks the
 * venue first.
 */
export async function savedJoinSeats(
  tx: Transaction,
  tableIds: readonly string[],
): Promise<number | null> {
  const rows = await tx
    .select({ planTableId: diningTables.planTableId })
    .from(diningTables)
    .where(inArray(diningTables.id, [...tableIds]));
  const wanted = new Set(rows.map((row) => row.planTableId));
  // Nothing makes plan_table_id unique, so two tables on one master table must not count as one.
  if (rows.length !== tableIds.length || wanted.size !== tableIds.length || wanted.has(null)) {
    return null;
  }
  const candidates = await tx
    .select({ joinId: floorPlanJoinTables.joinId })
    .from(floorPlanJoinTables)
    .where(inArray(floorPlanJoinTables.planTableId, [...wanted] as string[]));
  const joinIds = [...new Set(candidates.map((c) => c.joinId))];
  if (joinIds.length === 0) return null;
  const members = await tx
    .select({ joinId: floorPlanJoinTables.joinId, planTableId: floorPlanJoinTables.planTableId })
    .from(floorPlanJoinTables)
    .where(inArray(floorPlanJoinTables.joinId, joinIds));
  const byJoin = new Map<string, string[]>();
  for (const { joinId, planTableId } of members) {
    byJoin.set(joinId, [...(byJoin.get(joinId) ?? []), planTableId]);
  }
  const match = joinIds.find((joinId) => {
    const ids = byJoin.get(joinId)!;
    return ids.length === wanted.size && ids.every((id) => wanted.has(id));
  });
  if (match === undefined) return null;
  const [join] = await tx
    .select({ seats: floorPlanJoins.seats })
    .from(floorPlanJoins)
    .where(eq(floorPlanJoins.id, match));
  return join!.seats;
}

/** `moving` joins `target`'s merge (or a new one), touching it on `side`; with `free`, neither table may be held or need clearing. */
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
  if (moving.zoneId === null) {
    throw new AppError("table.not_in_floor_plan", { tableId: moving.tableId });
  }
  if (zoneId === null) throw new AppError("table.not_in_floor_plan", { tableId: target.tableId });
  refuseUnmovable(moving, target);
  if (moving.merge !== null) throw new AppError("table.merged", { tableId: moving.tableId });
  if (args.free) await refuseUnfree(tx, [moving.tableId, target.tableId]);
  if (zoneId !== moving.zoneId) {
    throw new AppError("service_zone.join_mismatch", {
      orderZoneId: zoneId,
      tableZoneId: moving.zoneId,
    });
  }

  const members = [
    ...(target.merge?.members.map((m) => m.tableId) ?? [target.tableId]),
    moving.tableId,
  ];
  const seats = args.seats ?? (await savedJoinSeats(tx, members));
  if (seats === null) throw new AppError("floor_plan.invalid", { field: "seats" });

  let joinId = target.merge?.joinId;
  if (joinId === undefined) {
    const [join] = await tx
      .insert(floorTodayJoins)
      .values({ zoneId, seats })
      .returning({ id: floorTodayJoins.id });
    joinId = join!.id;
    await tx.insert(floorTodayJoinTables).values(beforeRow(joinId, target));
  } else {
    await tx.update(floorTodayJoins).set({ seats }).where(eq(floorTodayJoins.id, joinId));
  }
  await tx.insert(floorTodayJoinTables).values(beforeRow(joinId, moving));
  const at = touchingPlace(
    {
      x: target.row.x!,
      y: target.row.y!,
      width: target.row.width!,
      height: target.row.height!,
      rotation: target.row.rotation!,
    },
    { width: moving.row.width!, height: moving.row.height! },
    args.side,
  );
  await tx.update(floorTodayTables).set(at).where(eq(floorTodayTables.id, moving.row.id));
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
