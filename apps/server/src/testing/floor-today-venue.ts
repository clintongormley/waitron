import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { floorTodayJoinTables, floorTodayJoins, floorTodayTables, floorZones } from "@waitron/db";
import { zoneSalePolicies, zoneServicePolicies } from "@waitron/venue-service";
import { readZonePlan, saveZonePlan, type ZonePlanSave } from "../floor-plan.js";
import { ALL_MODULES, enabledTableRemovals } from "../modules.js";
import { inTx, type PartyVenue } from "./party-venue.js";

export interface PlannedEntry {
  key: string;
  label?: string;
  seats?: number | null;
  fixed?: boolean;
  place?: { x: number; y: number; width?: number; height?: number; rotation?: number } | null;
  partKeys?: string[];
}

const REMOVALS = enabledTableRemovals(ALL_MODULES);

/** A fresh table-service zone, so one case's plans never meet another's. */
export async function tableServiceZone(v: PartyVenue): Promise<string> {
  const id = randomUUID();
  await inTx(v, async (tx) => {
    const [tables] = await tx
      .select({ departmentId: zoneServicePolicies.departmentId })
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, v.tables.zoneId));
    await tx
      .insert(floorZones)
      .values({ id, locationId: v.cfg.locationId, name: `Zone ${id.slice(0, 8)}` });
    await tx.insert(zoneServicePolicies).values({
      locationId: v.cfg.locationId,
      zoneId: id,
      departmentId: tables!.departmentId,
    });
    await tx.insert(zoneSalePolicies).values({ zoneId: id, orderStart: "table" });
  });
  return id;
}

/**
 * A fresh table-service zone, its live tables, and a first saved master holding `entries`, which
 * builds today's plan. Labels are made unique.
 */
export async function plannedZone(
  v: PartyVenue,
  entries: PlannedEntry[],
  now: Date = new Date(),
): Promise<{
  zoneId: string;
  table: Record<string, string>;
  master: Record<string, string>;
  revision: number;
}> {
  const zoneId = await tableServiceZone(v);
  const table: Record<string, string> = {};
  const tables: ZonePlanSave["tables"] = [];
  for (const entry of entries) {
    const label = `${entry.label ?? entry.key} ${randomUUID().slice(0, 6)}`;
    const place = entry.place === undefined ? { x: 0, y: 0 } : entry.place;
    tables.push({
      key: entry.key,
      label,
      seats: entry.seats === undefined ? 4 : entry.seats,
      fixed: entry.fixed ?? false,
      placement:
        place === null
          ? null
          : {
              x: place.x,
              y: place.y,
              width: place.width ?? 8,
              height: place.height ?? 8,
              shape: "rect" as const,
              rotation: place.rotation ?? 0,
            },
      partKeys: entry.partKeys ?? [],
    });
  }
  const { revision, ids } = await inTx(v, (tx) =>
    saveZonePlan(tx, v.cfg, REMOVALS, zoneId, { revision: 0, tables }, now),
  );
  const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, zoneId));
  for (const entry of entries) {
    table[entry.key] = plan.tables.find((t) => t.id === ids[entry.key])!.liveTableId!;
  }
  return { zoneId, table, master: ids, revision };
}

export async function todayRow(
  v: PartyVenue,
  tableId: string,
): Promise<typeof floorTodayTables.$inferSelect | undefined> {
  const [row] = await inTx(v, (tx) =>
    tx.select().from(floorTodayTables).where(eq(floorTodayTables.tableId, tableId)),
  );
  return row;
}

export async function mergeOf(
  v: PartyVenue,
  tableId: string,
): Promise<{
  joinId: string;
  seats: number;
  members: { tableId: string; beforeX: number; beforeY: number; beforeRotation: number }[];
} | null> {
  return inTx(v, async (tx) => {
    const [own] = await tx
      .select({ joinId: floorTodayJoinTables.joinId, seats: floorTodayJoins.seats })
      .from(floorTodayJoinTables)
      .innerJoin(floorTodayJoins, eq(floorTodayJoins.id, floorTodayJoinTables.joinId))
      .where(eq(floorTodayJoinTables.tableId, tableId));
    if (own === undefined) return null;
    const members = await tx
      .select({
        tableId: floorTodayJoinTables.tableId,
        beforeX: floorTodayJoinTables.beforeX,
        beforeY: floorTodayJoinTables.beforeY,
        beforeRotation: floorTodayJoinTables.beforeRotation,
      })
      .from(floorTodayJoinTables)
      .where(eq(floorTodayJoinTables.joinId, own.joinId));
    members.sort((a, b) => a.tableId.localeCompare(b.tableId));
    return { joinId: own.joinId, seats: own.seats, members };
  });
}
