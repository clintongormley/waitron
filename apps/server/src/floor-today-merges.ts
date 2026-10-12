import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  parties,
  partyTables,
  floorTodayJoins,
  floorTodayJoinTables,
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
import { holderOf } from "./parties.js";
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
): Promise<void> {
  for (const member of await mergeMembers(tx, tableId)) {
    if ((await holderOf(tx, member)) !== null) continue;
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
  const goes = { width: moving.row.width!, height: moving.row.height! };
  const against = placeOf(target.row);
  const side = freeSide(
    against,
    goes,
    (target.merge?.members ?? [target.row]).filter((m) => m.x !== null).map(placeOf),
    args.side,
  );
  const at = touchingPlace(against, goes, side);
  await tx.update(floorTodayTables).set(at).where(eq(floorTodayTables.id, moving.row.id));
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
