import { and, asc, eq, inArray } from "drizzle-orm";
import {
  diningTables,
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodaySplitParts,
  floorTodayTables,
  floorTodayZones,
  type Transaction,
} from "@waitron/db";
import { invalid } from "./bill-allocation.js";
import type { TillConfig } from "./till-config.js";
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
    .select({ zoneId: floorTodayZones.zoneId, revision: floorTodayZones.revision })
    .from(floorTodayZones)
    .where(inArray(floorTodayZones.zoneId, [...zoneIds]));
  const found = new Map(rows.map((row) => [row.zoneId, row.revision]));
  return new Map(zoneIds.map((zoneId) => [zoneId, found.get(zoneId) ?? 0]));
}

/**
 * What each room's plan for the day holds, one comparable string per zone in `zoneIds`. Two
 * reads with no write between must print alike, or every poll would move the room.
 */
export async function roomPrints(
  tx: Transaction,
  cfg: TillConfig,
  zoneIds: readonly string[],
): Promise<Map<string, string>> {
  const rows = await tx
    .select({
      zoneId: diningTables.zoneId,
      id: diningTables.id,
      label: diningTables.label,
      seats: floorTodayTables.seats,
      fixed: floorTodayTables.fixed,
      x: floorTodayTables.x,
      y: floorTodayTables.y,
      width: floorTodayTables.width,
      height: floorTodayTables.height,
      shape: floorTodayTables.shape,
      rotation: floorTodayTables.rotation,
      takenOff: floorTodayTables.takenOff,
      joinId: floorTodayJoinTables.joinId,
      beforeX: floorTodayJoinTables.beforeX,
      beforeY: floorTodayJoinTables.beforeY,
      beforeRotation: floorTodayJoinTables.beforeRotation,
      groupSeats: floorTodayJoins.seats,
      splitOffFrom: floorTodaySplitParts.joinedTableId,
    })
    .from(diningTables)
    .leftJoin(floorTodayTables, eq(floorTodayTables.tableId, diningTables.id))
    .leftJoin(floorTodayJoinTables, eq(floorTodayJoinTables.tableId, diningTables.id))
    .leftJoin(floorTodayJoins, eq(floorTodayJoins.id, floorTodayJoinTables.joinId))
    .leftJoin(floorTodaySplitParts, eq(floorTodaySplitParts.partTableId, diningTables.id))
    .where(
      and(eq(diningTables.locationId, cfg.locationId), inArray(diningTables.zoneId, [...zoneIds])),
    )
    .orderBy(asc(diningTables.id));
  const byZone = new Map<string, Omit<(typeof rows)[number], "zoneId">[]>(
    zoneIds.map((zoneId) => [zoneId, []]),
  );
  for (const { zoneId, ...row } of rows) byZone.get(zoneId)!.push(row);
  return new Map([...byZone].map(([zoneId, zoneRows]) => [zoneId, JSON.stringify(zoneRows)]));
}

/** Sets the room's revision to `from + 1` and answers it; a room with no row answers `from`. */
export async function moveRoom(tx: Transaction, zoneId: string, from: number): Promise<number> {
  const moved = await tx
    .update(floorTodayZones)
    .set({ revision: from + 1 })
    .where(eq(floorTodayZones.zoneId, zoneId))
    .returning({ revision: floorTodayZones.revision });
  return moved.length === 0 ? from : from + 1;
}

/** Every zone whose print differs between `before` and `after`, moved by one from `revisions`. */
export async function moveChangedRooms(
  tx: Transaction,
  revisions: ReadonlyMap<string, number>,
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): Promise<Map<string, number>> {
  const moved = new Map<string, number>();
  for (const [zoneId, print] of after) {
    if (before.get(zoneId) === print) continue;
    moved.set(zoneId, await moveRoom(tx, zoneId, revisions.get(zoneId) ?? 0));
  }
  return moved;
}

/** The zones of `tableIds`, read within the venue's location. */
export async function zonesOf(
  tx: Transaction,
  cfg: TillConfig,
  tableIds: readonly string[],
): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ zoneId: diningTables.zoneId })
    .from(diningTables)
    .where(
      and(eq(diningTables.locationId, cfg.locationId), inArray(diningTables.id, [...tableIds])),
    )
    .orderBy(asc(diningTables.zoneId));
  return rows.map((row) => row.zoneId);
}
