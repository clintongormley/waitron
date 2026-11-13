import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  diningTables,
  floorResetTables,
  tableMerges,
  type Transaction,
  floorZones,
} from "@waitron/db";
import { AppError } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import "./errors.js";

/** The `zoneRevision` a till body carries; undefined when it carries none. */
export function sentRevision(body: Record<string, unknown>): number | undefined {
  const value = body.zoneRevision;
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalid("zoneRevision");
  }
  return value;
}

/** The `zoneRevision` a till body must carry; refused as invalid when it carries none. */
export function requiredRevision(body: Record<string, unknown>): number {
  const sent = sentRevision(body);
  if (sent === undefined) throw invalid("zoneRevision");
  return sent;
}

/** Refuses `floor_today.out_of_date` when the till sent a revision other than the room's `current`. */
export function refuseStale(zoneId: string, sent: number, current: number): void {
  if (sent !== current) {
    throw new AppError("floor_today.out_of_date", { zoneId, revision: current });
  }
}

/** The room's revision; 0 before its first reset. */
export async function roomRevision(tx: Transaction, zoneId: string): Promise<number> {
  return (await roomRevisions(tx, [zoneId])).get(zoneId)!;
}

/** Each room's revision, by zone, for `zoneIds`. */
export async function roomRevisions(
  tx: Transaction,
  zoneIds: readonly string[],
): Promise<Map<string, number>> {
  const rows = await tx
    .select({ zoneId: floorZones.id, revision: floorZones.todayRevision })
    .from(floorZones)
    .where(inArray(floorZones.id, [...zoneIds]));
  const found = new Map(rows.map((row) => [row.zoneId, row.revision]));
  return new Map(zoneIds.map((zoneId) => [zoneId, found.get(zoneId) ?? 0]));
}

/**
 * What each room's plan for the day holds, one comparable string per zone in `zoneIds`. Two
 * reads with no write between must print alike, or every poll would move the room.
 */
export async function roomPrints(
  tx: Transaction,
  zoneIds: readonly string[],
): Promise<Map<string, string>> {
  const rows = await tx
    .select({
      zoneId: diningTables.zoneId,
      id: diningTables.id,
      label: diningTables.label,
      shortName: diningTables.shortName,
      onFloor: diningTables.onFloor,
      seats: diningTables.todaySeats,
      fixed: diningTables.todayFixed,
      x: diningTables.todayX,
      y: diningTables.todayY,
      width: diningTables.todayWidth,
      height: diningTables.todayHeight,
      shape: diningTables.todayShape,
      rotation: diningTables.todayRotation,
      takenOff: diningTables.takenOff,
      name: diningTables.todayName,
      joinId: diningTables.mergeId,
      beforeX: diningTables.mergeBeforeX,
      beforeY: diningTables.mergeBeforeY,
      beforeRotation: diningTables.mergeBeforeRotation,
      groupSeats: tableMerges.seats,
      groupName: tableMerges.name,
      readyToMove: floorResetTables.readyToMove,
    })
    .from(diningTables)
    .leftJoin(tableMerges, eq(tableMerges.id, diningTables.mergeId))
    .leftJoin(floorResetTables, eq(floorResetTables.tableId, diningTables.id))
    .where(inArray(diningTables.zoneId, [...zoneIds]))
    .orderBy(asc(diningTables.id));
  const byZone = new Map<string, Omit<(typeof rows)[number], "zoneId">[]>(
    zoneIds.map((zoneId) => [zoneId, []]),
  );
  for (const { zoneId, ...row } of rows) byZone.get(zoneId)!.push(row);
  return new Map([...byZone].map(([zoneId, zoneRows]) => [zoneId, JSON.stringify(zoneRows)]));
}

/** Sets the room's revision to `from + 1` and answers it; a room with no recorded business day answers `from`. */
export async function moveRoom(tx: Transaction, zoneId: string, from: number): Promise<number> {
  const moved = await tx
    .update(floorZones)
    .set({ todayRevision: from + 1 })
    .where(and(eq(floorZones.id, zoneId), isNotNull(floorZones.todayBusinessDay)))
    .returning({ revision: floorZones.todayRevision });
  return moved.length === 0 ? from : from + 1;
}

/**
 * Every zone whose print differs between `before` and `after`, moved by one from `revisions`; a
 * zone with no today's plan has nothing to move and is left out.
 */
export async function moveChangedRooms(
  tx: Transaction,
  revisions: ReadonlyMap<string, number>,
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): Promise<Map<string, number>> {
  const moved = new Map<string, number>();
  for (const [zoneId, print] of after) {
    if (before.get(zoneId) === print) continue;
    const from = revisions.get(zoneId) ?? 0;
    const revision = await moveRoom(tx, zoneId, from);
    if (revision !== from) moved.set(zoneId, revision);
  }
  return moved;
}

export async function zonesOf(tx: Transaction, tableIds: readonly string[]): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ zoneId: diningTables.zoneId })
    .from(diningTables)
    .where(inArray(diningTables.id, [...tableIds]))
    .orderBy(asc(diningTables.zoneId));
  return rows.map((row) => row.zoneId);
}
