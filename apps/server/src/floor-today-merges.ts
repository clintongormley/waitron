import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { partyTables, tableMerges, mergeOf, LEFT_MERGE, todaySet, diningTables } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, freeSide, touchingPlace, type JoinPlace, type JoinSide } from "@waitron/shared";
import {
  refuseNeedsMoving,
  refuseUnfree,
  refuseUnmovable,
  todayOf,
  type Today,
} from "./floor-today-table.js";
import { holderOf, partyRevision } from "./parties.js";
import type { SlipsLater } from "./moved-slips.js";
import { readBillEditState, readPartyBillIds } from "./bill-editing.js";
import type { BillEditExpected } from "./order-drafts.js";
import { joinTables } from "./table-actions.js";
import type { OriginConfig, TradingContext } from "./trading-context.js";
import "./errors.js";

/**
 * The tables leave their today's merges; a merge left with fewer than two members goes, and its last
 * member goes back to where it stood before the merge.
 */
export async function leaveMerges(tx: Transaction, tableIds: readonly string[]): Promise<void> {
  const left = await tx
    .select({ joinId: diningTables.mergeId })
    .from(diningTables)
    .where(and(inArray(diningTables.id, [...tableIds]), isNotNull(diningTables.mergeId)));
  if (left.length === 0) return;
  await tx
    .update(diningTables)
    .set(LEFT_MERGE)
    .where(inArray(diningTables.id, [...tableIds]));
  for (const joinId of new Set(left.map((row) => row.joinId!))) {
    const rest = await tx
      .select(mergeOf)
      .from(diningTables)
      .where(eq(diningTables.mergeId, joinId));
    if (rest.length >= 2) continue;
    for (const member of rest) {
      await putBack(tx, member);
    }
    await tx.update(diningTables).set(LEFT_MERGE).where(eq(diningTables.mergeId, joinId));
    await tx.delete(tableMerges).where(eq(tableMerges.id, joinId));
  }
}

async function putBack(
  tx: Transaction,
  member: {
    tableId: string;
    beforeX: number | null;
    beforeY: number | null;
    beforeRotation: number | null;
  },
): Promise<void> {
  await tx
    .update(diningTables)
    .set(todaySet({ x: member.beforeX, y: member.beforeY, rotation: member.beforeRotation }))
    .where(and(eq(diningTables.id, member.tableId), isNotNull(diningTables.todayX)));
}

/** Each table leaves its merge and goes back to where it stood before; a merge left with one member ends as leaveMerges ends it. */
export async function leaveMergesRestoring(
  tx: Transaction,
  tableIds: readonly string[],
): Promise<void> {
  const leaving = await tx
    .select(mergeOf)
    .from(diningTables)
    .where(and(inArray(diningTables.id, [...tableIds]), isNotNull(diningTables.mergeId)));
  for (const member of leaving) {
    await putBack(tx, member);
  }
  await leaveMerges(tx, tableIds);
}

/** Every member of `tableId`'s merge by table id, `tableId` included, or [] when it is in none. */
export async function mergeMembers(tx: Transaction, tableId: string): Promise<string[]> {
  const own = tx
    .select({ joinId: diningTables.mergeId })
    .from(diningTables)
    .where(eq(diningTables.id, tableId));
  const members = await tx
    .select({ tableId: diningTables.id })
    .from(diningTables)
    .where(inArray(diningTables.mergeId, own))
    .orderBy(asc(diningTables.id));
  return members.map((m) => m.tableId);
}

/**
 * The party just seated at `tableId` takes every other member of its merge: refused
 * `tab.already_open` for a member a party holds, `table.needs_clearing` for one needing clearing,
 * `table.needs_moving` for one needing moving.
 */
export async function seatMergeMembers(
  tx: Transaction,
  partyId: string,
  tableId: string,
): Promise<void> {
  const others = (await mergeMembers(tx, tableId)).filter((id) => id !== tableId);
  await refuseUnfree(tx, others);
  await refuseNeedsMoving(tx, others);
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
    // The enclosing seat/join already validated its bills; these free members add no bill work.
    const expectedEdits: BillEditExpected[] = [];
    for (const billId of await readPartyBillIds(tx, [partyId]))
      expectedEdits.push(await readBillEditState(tx, billId));
    await joinTables(tx, cfg, partyId, member, {
      expectedEdits,
      expectedPartyRevision: await partyRevision(tx, partyId),
      operatorId,
      otherPartyId: null,
      slipsLater,
    });
  }
}

export async function writeMerge(
  tx: Transaction,
  _cfg: TradingContext,
  args: { movingId: string; targetId: string; side: JoinSide; seats: number | null; free: boolean },
): Promise<void> {
  if (args.movingId === args.targetId) {
    throw new AppError("management.request_invalid", { field: "targetId" });
  }
  const moving = await todayOf(tx, args.movingId);
  const target = await todayOf(tx, args.targetId);
  const { zoneId } = target;
  refuseUnmovable(moving, target);
  if (moving.merge !== null) throw new AppError("table.merged", { tableId: moving.tableId });
  if (args.free) {
    await refuseUnfree(tx, [moving.tableId, target.tableId]);
    await refuseNeedsMoving(tx, [moving.tableId, target.tableId]);
  }
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
      .insert(tableMerges)
      .values({ zoneId, seats })
      .returning({ id: tableMerges.id });
    joinId = join!.id;
    await tx
      .update(diningTables)
      .set(beforeRow(joinId, target))
      .where(eq(diningTables.id, target.tableId));
  } else {
    await tx.update(tableMerges).set({ seats }).where(eq(tableMerges.id, joinId));
  }
  const goes = { width: moving.row.width!, height: moving.row.height! };
  const against = placeOf(target.row);
  const members = (target.merge?.members ?? [target.row]).filter((m) => m.x !== null).map(placeOf);
  const side = freeSide(against, goes, members, args.side);
  const at = touchingPlace(against, goes, side);

  await tx
    .update(diningTables)
    .set(beforeRow(joinId, moving))
    .where(eq(diningTables.id, moving.tableId));
  await tx.update(diningTables).set(todaySet(at)).where(eq(diningTables.id, moving.row.tableId));
}

function placeOf(row: Today["row"]): JoinPlace {
  return { x: row.x!, y: row.y!, width: row.width!, height: row.height!, rotation: row.rotation! };
}

function beforeRow(joinId: string, today: Today) {
  return {
    mergeId: joinId,
    mergeBeforeX: today.row.x!,
    mergeBeforeY: today.row.y!,
    mergeBeforeRotation: today.row.rotation!,
  };
}
