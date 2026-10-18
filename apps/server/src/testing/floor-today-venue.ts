import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { expect } from "vitest";
import {
  diningTables,
  floorPlans,
  floorPlanSets,
  floorPlanTables,
  floorPlanTableSizes,
  floorTodayJoinTables,
  floorTodayJoins,
  floorTodaySplitParts,
  floorTodayTables,
  floorTodayZones,
  floorZones,
} from "@waitron/db";
import { createCatalogue } from "@waitron/catalogue";
import {
  createDepartment,
  createServiceZone,
  linkFloorPlanSet,
  menuPeriods,
  replaceMenuWeek,
  saveMenuPeriod,
  zoneSalePolicies,
  zoneServicePolicies,
} from "@waitron/venue-service";
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

/** Gives master table `masterId` the size it keeps while off its zone's layout in `setId`. */
export async function giveKeptSize(
  v: PartyVenue,
  masterId: string,
  size: { width: number; height: number },
  setId: string | null = null,
): Promise<void> {
  await inTx(v, async (tx) => {
    const [plan] = await tx
      .select({ id: floorPlans.id })
      .from(floorPlans)
      .innerJoin(floorPlanTables, eq(floorPlanTables.zoneId, floorPlans.zoneId))
      .where(
        and(
          eq(floorPlanTables.id, masterId),
          setId === null ? isNull(floorPlans.setId) : eq(floorPlans.setId, setId),
        ),
      );
    await tx
      .insert(floorPlanTableSizes)
      .values({ planId: plan!.id, planTableId: masterId, ...size });
  });
}

/**
 * A fresh department with one zone, Lunch (12:00-15:00) and Dinner (20:00-23:00) painted every
 * day from `paintedAt`, and sets Standard (its default) and Dinner, which Dinner's period picks.
 */
export async function setsDepartment(
  v: PartyVenue,
  paintedAt: Date,
): Promise<{
  departmentId: string;
  zoneId: string;
  standard: string;
  dinner: string;
  lunchPeriod: string;
  dinnerPeriod: string;
}> {
  const name = (base: string) => `${base} ${randomUUID().slice(0, 8)}`;
  return inTx(v, async (tx) => {
    const department = await createDepartment(tx, v.cfg, {
      name: name("Dept"),
      orderStart: "table",
    });
    const zone = await createServiceZone(tx, v.cfg, {
      name: name("Inside"),
      departmentId: department.id,
    });
    const menu = await createCatalogue(tx, { name: name("Menu") });
    const period = async (periodName: string) =>
      (
        await saveMenuPeriod(
          tx,
          v.cfg,
          department.id,
          { name: periodName, menuId: menu.id, staffMenuIds: [] },
          0,
        )
      ).id;
    const lunchPeriod = await period("Lunch");
    const dinnerPeriod = await period("Dinner");
    await replaceMenuWeek(
      tx,
      v.cfg,
      department.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [
          { periodId: lunchPeriod, startsAt: "12:00", endsAt: "15:00" },
          { periodId: dinnerPeriod, startsAt: "20:00", endsAt: "23:00" },
        ],
      })),
      paintedAt,
      0,
    );
    const set = async (setName: string) => {
      const [row] = await tx
        .insert(floorPlanSets)
        .values({ locationId: v.cfg.locationId })
        .returning({ id: floorPlanSets.id });
      await linkFloorPlanSet(tx, v.cfg, {
        setId: row!.id,
        departmentId: department.id,
        name: setName,
      });
      return row!.id;
    };
    const standard = await set("Standard");
    const dinner = await set("Dinner");
    await tx
      .update(menuPeriods)
      .set({ floorPlanSetId: dinner })
      .where(eq(menuPeriods.id, dinnerPeriod));
    return {
      departmentId: department.id,
      zoneId: zone.id,
      standard,
      dinner,
      lunchPeriod,
      dinnerPeriod,
    };
  });
}

/** Records `partTableId` as split off joined table `joinedTableId` today, as the split route will. */
export async function splitOffRow(
  v: PartyVenue,
  joinedTableId: string,
  partTableId: string,
): Promise<void> {
  await inTx(v, (tx) => tx.insert(floorTodaySplitParts).values({ joinedTableId, partTableId }));
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

/** The room's stored revision; undefined with no row. */
export async function zoneRevisionOf(v: PartyVenue, zoneId: string): Promise<number | undefined> {
  const [row] = await inTx(v, (tx) =>
    tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, zoneId)),
  );
  return row?.revision;
}

/**
 * `body` carrying the stored revision of the room holding `tableId` (0 with no row or no such
 * table) as `zoneRevision`; a body that names one, or is not an object, is answered as given.
 */
export async function withRevision(
  v: PartyVenue,
  tableId: string,
  body: unknown,
): Promise<unknown> {
  if (!isPlainBody(body) || "zoneRevision" in body) return body;
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ zoneId: diningTables.zoneId })
      .from(diningTables)
      .where(eq(diningTables.id, tableId.toLowerCase())),
  );
  const zoneRevision = row === undefined ? 0 : ((await zoneRevisionOf(v, row.zoneId)) ?? 0);
  return { ...body, zoneRevision };
}

/** `body` carrying `zoneId`'s stored revision (0 with no row), as `withRevision` does for a table. */
export async function withZoneRevision(
  v: PartyVenue,
  zoneId: string,
  body: unknown,
): Promise<unknown> {
  if (!isPlainBody(body) || "zoneRevision" in body) return body;
  return { ...body, zoneRevision: (await zoneRevisionOf(v, zoneId)) ?? 0 };
}

/**
 * `body` for a POST to `path`: a change to today's floor, or a zone reset, carrying the room's
 * revision as `withRevision` and `withZoneRevision` give it; any other path's body as given.
 */
export async function withFloorRevision(
  v: PartyVenue,
  path: string,
  body: unknown,
): Promise<unknown> {
  const table = /^\/api\/tables\/([^/]+)\/today\//.exec(path)?.[1];
  if (table !== undefined) return withRevision(v, table, body);
  const zone = /^\/api\/zones\/([^/]+)\/today\/reset$/.exec(path)?.[1];
  return zone === undefined ? body : withZoneRevision(v, zone, body);
}

function isPlainBody(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

/**
 * A 200 naming the zone — `zoneId`, or the one the body names — and the revision it now stores (0
 * with no row), which is `revision` when given.
 */
export async function expectRevision(
  v: PartyVenue,
  answer: Response | Promise<Response>,
  zoneId?: string,
  revision?: number,
): Promise<void> {
  const settled = await answer;
  const body: unknown = await settled
    .clone()
    .json()
    .catch(() => null);
  const zone = zoneId ?? (body as { zoneId?: unknown } | null)?.zoneId;
  expect(zone, "the answer names a zone").toBeTypeOf("string");
  const stored = typeof zone === "string" ? ((await zoneRevisionOf(v, zone)) ?? 0) : undefined;
  expect({ status: settled.status, body }, await settled.text()).toEqual({
    status: 200,
    body: { zoneId: zone, revision: stored },
  });
  if (revision !== undefined) expect(stored).toBe(revision);
}
