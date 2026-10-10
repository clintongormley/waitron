import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  diningTables,
  floorPlanJoins,
  floorPlanJoinTables,
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodayTables,
  partyTables,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, touchingPlace, type JoinSide } from "@waitron/shared";
import { todayOf, type Today } from "./floor-today-store.js";
import type { TillConfig } from "./till-config.js";
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

/** Every member of `tableId`'s merge, `tableId` included, or [] when it is in none. */
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
 * The seats of the master's saved join with exactly these tables' master tables, or null. The
 * master is read as it is now: a reset copies no joins.
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
  if (rows.length !== tableIds.length || wanted.has(null)) return null;
  const candidates = await tx
    .selectDistinct({ joinId: floorPlanJoinTables.joinId })
    .from(floorPlanJoinTables)
    .where(inArray(floorPlanJoinTables.planTableId, [...wanted] as string[]));
  for (const { joinId } of candidates) {
    const members = await tx
      .select({ planTableId: floorPlanJoinTables.planTableId })
      .from(floorPlanJoinTables)
      .where(eq(floorPlanJoinTables.joinId, joinId));
    if (members.length !== wanted.size) continue;
    if (!members.every((m) => wanted.has(m.planTableId))) continue;
    const [join] = await tx
      .select({ seats: floorPlanJoins.seats })
      .from(floorPlanJoins)
      .where(eq(floorPlanJoins.id, joinId));
    return join!.seats;
  }
  return null;
}

async function refuseUnfree(tx: Transaction, tables: readonly Today[]): Promise<void> {
  for (const { tableId } of tables) {
    const [held] = await tx
      .select({ id: partyTables.id })
      .from(partyTables)
      .where(and(eq(partyTables.tableId, tableId), isNull(partyTables.leftAt)));
    if (held !== undefined) throw new AppError("tab.already_open", { tableId });
  }
  for (const { tableId } of tables) {
    const [table] = await tx
      .select({ needsClearingSince: diningTables.needsClearingSince })
      .from(diningTables)
      .where(eq(diningTables.id, tableId));
    if (table!.needsClearingSince !== null) throw new AppError("table.needs_clearing", { tableId });
  }
}

async function zoneOf(tx: Transaction, tableId: string): Promise<string | null> {
  const [table] = await tx
    .select({ zoneId: diningTables.zoneId })
    .from(diningTables)
    .where(eq(diningTables.id, tableId));
  return table!.zoneId;
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
  const both = [moving, target];
  for (const { tableId, row } of both) {
    if (row.x === null) throw new AppError("table.not_in_floor_plan", { tableId });
  }
  for (const { tableId, row } of both) {
    if (row.takenOff) throw new AppError("table.taken_off", { tableId });
  }
  for (const { tableId, row } of both) {
    if (row.fixed) throw new AppError("table.fixed", { tableId });
  }
  if (moving.merge !== null) throw new AppError("table.merged", { tableId: moving.tableId });
  if (args.free) await refuseUnfree(tx, both);
  const zoneId = await zoneOf(tx, target.tableId);
  const movingZoneId = await zoneOf(tx, moving.tableId);
  if (zoneId !== movingZoneId) {
    throw new AppError("service_zone.join_mismatch", {
      orderZoneId: zoneId!,
      tableZoneId: movingZoneId!,
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
      .values({ zoneId: zoneId!, seats })
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
