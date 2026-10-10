import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorPlans,
  floorPlanTables,
  floorResetTables,
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodayTables,
  floorTodayZones,
  floorZones,
  locations,
} from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { zoneSalePolicies, zoneServicePolicies } from "@waitron/venue-service";
import { catchUpZone, ensureToday, resetZone, todayBusinessDay } from "./floor-today-store.js";
import { finishTable } from "./parties.js";
import { deactivateZone } from "./tables.js";
import {
  commandFor,
  inTx,
  join,
  seat,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import "./errors.js";

let v: PartyVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

const NOW = new Date("2026-10-10T12:00:00Z");
const NONE: readonly TableRemoval[] = [];

interface MasterTable {
  label: string;
  seats?: number;
  fixed?: boolean;
  place?: { x: number; y: number; width: number; height: number };
  /** The live table this master table is followed by. */
  live?: string;
}

/** A fresh table-service zone, so one case's master and today's plan never meet another's. */
async function zone(): Promise<string> {
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

function masterRow(planId: string, table: MasterTable) {
  return {
    planId,
    label: table.label,
    seats: table.seats ?? null,
    fixed: table.fixed ?? false,
    ...(table.place === undefined ? {} : { ...table.place, shape: "rect" as const, rotation: 0 }),
  };
}

/** Writes the zone's master plan; a table naming `live` is followed by that live table. */
async function masterOf(zoneId: string, tables: MasterTable[]): Promise<Map<string, string>> {
  return inTx(v, async (tx) => {
    const [plan] = await tx
      .insert(floorPlans)
      .values({ zoneId, savedAt: NOW.toISOString() })
      .returning({ id: floorPlans.id });
    const ids = new Map<string, string>();
    for (const table of tables) {
      const [row] = await tx
        .insert(floorPlanTables)
        .values(masterRow(plan!.id, table))
        .returning({ id: floorPlanTables.id });
      ids.set(table.label, row!.id);
      if (table.live !== undefined) {
        await tx
          .update(diningTables)
          .set({ planTableId: row!.id, planned: true })
          .where(eq(diningTables.id, table.live));
      }
    }
    return ids;
  });
}

async function planIdOf(zoneId: string): Promise<string> {
  const [plan] = await inTx(v, (tx) =>
    tx.select({ id: floorPlans.id }).from(floorPlans).where(eq(floorPlans.zoneId, zoneId)),
  );
  return plan!.id;
}

async function editMaster(masterId: string, values: Partial<typeof floorPlanTables.$inferInsert>) {
  await inTx(v, (tx) =>
    tx.update(floorPlanTables).set(values).where(eq(floorPlanTables.id, masterId)),
  );
}

async function addToMaster(zoneId: string, table: MasterTable): Promise<void> {
  const planId = await planIdOf(zoneId);
  await inTx(v, (tx) => tx.insert(floorPlanTables).values(masterRow(planId, table)));
}

async function deleteFromMaster(masterId: string): Promise<void> {
  await inTx(v, async (tx) => {
    await tx
      .update(diningTables)
      .set({ planTableId: null })
      .where(eq(diningTables.planTableId, masterId));
    await tx
      .update(floorResetTables)
      .set({ planTableId: null })
      .where(eq(floorResetTables.planTableId, masterId));
    await tx.delete(floorPlanTables).where(eq(floorPlanTables.id, masterId));
  });
}

async function todayRow(tableId: string) {
  const [row] = await inTx(v, (tx) =>
    tx.select().from(floorTodayTables).where(eq(floorTodayTables.tableId, tableId)),
  );
  return row;
}

async function todayZone(zoneId: string) {
  const [row] = await inTx(v, (tx) =>
    tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, zoneId)),
  );
  return row;
}

async function pendingRows(zoneId: string) {
  return inTx(v, (tx) =>
    tx
      .select()
      .from(floorResetTables)
      .where(and(eq(floorResetTables.zoneId, zoneId), eq(floorResetTables.pending, true))),
  );
}

async function liveTablesOf(zoneId: string) {
  return inTx(v, (tx) => tx.select().from(diningTables).where(eq(diningTables.zoneId, zoneId)));
}

async function mergeMembersIn(zoneId: string): Promise<string[]> {
  const rows = await inTx(v, (tx) =>
    tx
      .select({ tableId: floorTodayJoinTables.tableId })
      .from(floorTodayJoinTables)
      .innerJoin(floorTodayJoins, eq(floorTodayJoins.id, floorTodayJoinTables.joinId))
      .where(eq(floorTodayJoins.zoneId, zoneId)),
  );
  return rows.map((row) => row.tableId).sort();
}

async function finish(partyId: string): Promise<void> {
  const sent = await commandFor(v, partyId);
  await inTx(v, (tx) => finishTable(tx, { partyId, ...sent }));
}

const reset = (zoneId: string, removals: readonly TableRemoval[] = NONE, now = NOW) =>
  inTx(v, (tx) => resetZone(tx, v.cfg, removals, zoneId, now));
const catchUp = (zoneId: string, removals: readonly TableRemoval[] = NONE) =>
  inTx(v, (tx) => catchUpZone(tx, v.cfg, removals, zoneId, NOW));

const place = (x: number, y: number) => ({ x, y, width: 8, height: 8 });

describe("building today's plan from a zone's master plan", () => {
  it("builds today's plan from the master on the first reset", async () => {
    const z = await zone();
    const t1 = await v.table("First 1", z);
    const t2 = await v.table("First 2", z);
    await masterOf(z, [
      { label: "First 1", seats: 4, fixed: true, place: place(0, 0), live: t1 },
      { label: "First 2", live: t2 },
    ]);

    await reset(z);

    expect(await todayRow(t1)).toMatchObject({
      seats: 4,
      fixed: true,
      x: 0,
      y: 0,
      width: 8,
      height: 8,
      shape: "rect",
      rotation: 0,
      takenOff: false,
    });
    expect(await todayRow(t2)).toMatchObject({
      seats: null,
      fixed: false,
      x: null,
      y: null,
      width: null,
      height: null,
      shape: null,
      rotation: null,
    });
    expect(await todayZone(z)).toMatchObject({ businessDay: "2026-10-10", generation: 1 });
    expect(await pendingRows(z)).toEqual([]);
  });

  it("leaves a seated table and its merge alone, and catches them up once free", async () => {
    const z = await zone();
    const t1 = await v.table("Merge 1", z);
    const t2 = await v.table("Merge 2", z);
    const master = await masterOf(z, [
      { label: "Merge 1", place: place(0, 0), live: t1 },
      { label: "Merge 2", place: place(10, 0), live: t2 },
    ]);
    await reset(z);
    const { partyId } = await seat(v, t1);
    await join(v, partyId, t2);
    await inTx(v, async (tx) => {
      const [merge] = await tx
        .insert(floorTodayJoins)
        .values({ zoneId: z, seats: 8 })
        .returning({ id: floorTodayJoins.id });
      for (const tableId of [t1, t2]) {
        await tx
          .insert(floorTodayJoinTables)
          .values({ joinId: merge!.id, tableId, beforeX: 0, beforeY: 0, beforeRotation: 0 });
      }
    });
    await editMaster(master.get("Merge 1")!, { x: 20, label: "Patio 1" });
    await editMaster(master.get("Merge 2")!, { y: 30 });

    await reset(z);

    expect(await todayRow(t1)).toMatchObject({ x: 0, y: 0 });
    expect(await todayRow(t2)).toMatchObject({ x: 10, y: 0 });
    expect((await tableRow(v, t1)).label).toBe("Merge 1");
    expect(await inTx(v, (tx) => tx.select().from(floorTodayJoinTables))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableId: t1 }),
        expect.objectContaining({ tableId: t2 }),
      ]),
    );
    expect((await pendingRows(z)).map((row) => row.tableId).sort()).toEqual([t1, t2].sort());

    await finish(partyId);
    await catchUp(z);

    expect(await todayRow(t1)).toMatchObject({ x: 20, y: 0 });
    expect(await todayRow(t2)).toMatchObject({ x: 10, y: 30 });
    expect((await tableRow(v, t1)).label).toBe("Patio 1");
    expect(
      await inTx(v, (tx) => tx.select().from(floorTodayJoins).where(eq(floorTodayJoins.zoneId, z))),
    ).toEqual([]);
    expect(await pendingRows(z)).toEqual([]);
  });

  it("does not bring a mid-service master edit to the till before the next reset", async () => {
    const z = await zone();
    const t1 = await v.table("Mid 1", z);
    const t2 = await v.table("Mid 2", z);
    const master = await masterOf(z, [
      { label: "Mid 1", place: place(0, 0), live: t1 },
      { label: "Mid 2", place: place(10, 0), live: t2 },
    ]);
    await reset(z);
    await editMaster(master.get("Mid 1")!, { label: "Mid 1b", x: 40 });
    await addToMaster(z, { label: "Mid 3", place: place(50, 50) });
    await deleteFromMaster(master.get("Mid 2")!);
    const [copied] = await inTx(v, (tx) =>
      tx.select().from(floorResetTables).where(eq(floorResetTables.tableId, t2)),
    );
    expect(copied).toMatchObject({ label: "Mid 2", planTableId: null });
    const { partyId } = await seat(v, t1);
    await finish(partyId);

    await catchUp(z);

    expect((await tableRow(v, t1)).label).toBe("Mid 1");
    expect(await todayRow(t1)).toMatchObject({ x: 0 });
    expect((await liveTablesOf(z)).map((t) => t.label).sort()).toEqual(["Mid 1", "Mid 2"]);
    expect((await tableRow(v, t2)).active).toBe(true);

    await reset(z);

    expect((await tableRow(v, t1)).label).toBe("Mid 1b");
    expect(await todayRow(t1)).toMatchObject({ x: 40 });
    const t3 = (await liveTablesOf(z)).find((t) => t.label === "Mid 3");
    expect(t3).toMatchObject({ planned: true, active: true, locationId: v.cfg.locationId });
    expect(await todayRow(t3!.id)).toMatchObject({ x: 50, y: 50 });
    expect((await liveTablesOf(z)).map((t) => t.id)).not.toContain(t2);
    expect(await todayRow(t2)).toBeUndefined();
  });

  it("adds a table the master gained, and removes one it lost", async () => {
    const z = await zone();
    const t1 = await v.table("Gain 1", z);
    const t2 = await v.table("Gain 2", z);
    const master = await masterOf(z, [
      { label: "Gain 1", place: place(0, 0), live: t1 },
      { label: "Gain 2", live: t2 },
    ]);
    await reset(z);
    await deleteFromMaster(master.get("Gain 2")!);
    await addToMaster(z, { label: "Gain 3", seats: 2 });

    await reset(z);

    expect((await liveTablesOf(z)).map((t) => t.id)).not.toContain(t2);
    expect(await todayRow(t2)).toBeUndefined();
    const t3 = (await liveTablesOf(z)).find((t) => t.label === "Gain 3")!;
    const [planTable] = await inTx(v, (tx) =>
      tx.select().from(floorPlanTables).where(eq(floorPlanTables.label, "Gain 3")),
    );
    expect(t3).toMatchObject({ planTableId: planTable!.id, planned: true, active: true });
    expect(await todayRow(t3.id)).toMatchObject({ seats: 2, x: null });
    const [created] = await inTx(v, (tx) =>
      tx.select().from(floorResetTables).where(eq(floorResetTables.label, "Gain 3")),
    );
    expect(created).toMatchObject({ tableId: t3.id, pending: false });
  });

  it("swaps two tables' names", async () => {
    const z = await zone();
    const t1 = await v.table("Swap 1", z);
    const t2 = await v.table("Swap 2", z);
    const master = await masterOf(z, [
      { label: "Swap 1", live: t1 },
      { label: "Swap 2", live: t2 },
    ]);
    await reset(z);
    await editMaster(master.get("Swap 1")!, { label: "Swap tmp" });
    await editMaster(master.get("Swap 2")!, { label: "Swap 1" });
    await editMaster(master.get("Swap 1")!, { label: "Swap 2" });

    await reset(z);

    expect((await tableRow(v, t1)).label).toBe("Swap 2");
    expect((await tableRow(v, t2)).label).toBe("Swap 1");
  });

  it("brings back a table the master still has", async () => {
    const z = await zone();
    const t1 = await v.table("Back 1", z);
    await masterOf(z, [{ label: "Back 1", live: t1 }]);
    await inTx(v, (tx) =>
      tx.update(diningTables).set({ active: false }).where(eq(diningTables.id, t1)),
    );

    await reset(z);

    expect((await tableRow(v, t1)).active).toBe(true);
  });

  it("seeds a table seated at the first reset, keeping its name until it is free", async () => {
    const z = await zone();
    const t1 = await v.table("Seed 1", z);
    await masterOf(z, [{ label: "Seed 1b", seats: 6, place: place(5, 5), live: t1 }]);
    const { partyId } = await seat(v, t1);

    await reset(z);

    expect((await tableRow(v, t1)).label).toBe("Seed 1");
    expect(await todayRow(t1)).toMatchObject({ seats: 6, x: 5, y: 5 });
    expect(await pendingRows(z)).toHaveLength(1);

    await finish(partyId);
    await catchUp(z);

    expect((await tableRow(v, t1)).label).toBe("Seed 1b");
    expect(await pendingRows(z)).toEqual([]);
  });

  it("does not reset a zone with no master plan", async () => {
    const z = await zone();
    await v.table("Bare 1", z);

    await inTx(v, (tx) => ensureToday(tx, v.cfg, NONE, NOW));

    expect(await todayZone(z)).toBeUndefined();
  });

  it("resets at the first read of a new business day, and only once", async () => {
    const z = await zone();
    const t1 = await v.table("Day 1", z);
    await masterOf(z, [{ label: "Day 1", live: t1 }]);
    const [{ cutover }] = (await inTx(v, (tx) =>
      tx
        .select({ cutover: locations.dayCutover })
        .from(locations)
        .where(eq(locations.id, v.cfg.locationId)),
    )) as [{ cutover: string }];
    await inTx(v, (tx) =>
      tx.update(locations).set({ dayCutover: "04:00" }).where(eq(locations.id, v.cfg.locationId)),
    );
    // Europe/Madrid is two hours ahead of UTC on these dates.
    const at = (utc: string) => inTx(v, (tx) => ensureToday(tx, v.cfg, NONE, new Date(utc)));

    try {
      await at("2026-10-09T01:30:00Z");
      expect(await todayZone(z)).toMatchObject({ businessDay: "2026-10-08", generation: 1 });
      await at("2026-10-09T03:00:00Z");
      expect(await todayZone(z)).toMatchObject({ businessDay: "2026-10-09", generation: 2 });
      await at("2026-10-09T04:00:00Z");
      expect(await todayZone(z)).toMatchObject({ businessDay: "2026-10-09", generation: 2 });
    } finally {
      await inTx(v, (tx) =>
        tx.update(locations).set({ dayCutover: cutover }).where(eq(locations.id, v.cfg.locationId)),
      );
    }
  });

  it("catches up a pending zone without resetting it", async () => {
    const z = await zone();
    const t1 = await v.table("Wait 1", z);
    await masterOf(z, [{ label: "Wait 1b", live: t1 }]);
    const { partyId } = await seat(v, t1);
    await inTx(v, (tx) => ensureToday(tx, v.cfg, NONE, NOW));
    await finish(partyId);

    await inTx(v, (tx) => ensureToday(tx, v.cfg, NONE, NOW));

    expect((await tableRow(v, t1)).label).toBe("Wait 1b");
    expect(await todayZone(z)).toMatchObject({ generation: 1 });
  });

  it("leaves today's plan as it is when the venue's clock cannot be read", async () => {
    const z = await zone();
    const t1 = await v.table("Clock 1", z);
    await masterOf(z, [{ label: "Clock 1", live: t1 }]);
    await inTx(v, (tx) =>
      tx
        .update(locations)
        .set({ timeZone: "Nowhere/Never" })
        .where(eq(locations.id, v.cfg.locationId)),
    );
    try {
      expect(await inTx(v, (tx) => todayBusinessDay(tx, v.cfg, NOW))).toBeNull();
      await inTx(v, (tx) => ensureToday(tx, v.cfg, NONE, NOW));
      await reset(z);
      expect(await todayZone(z)).toBeUndefined();
      expect(await todayRow(t1)).toBeUndefined();
    } finally {
      await inTx(v, (tx) =>
        tx
          .update(locations)
          .set({ timeZone: "Europe/Madrid" })
          .where(eq(locations.id, v.cfg.locationId)),
      );
    }
  });

  it("leaves a table the master never had untouched", async () => {
    const z = await zone();
    const t1 = await v.table("Never 1", z);
    const t2 = await v.table("Never 2", z);
    await inTx(v, (tx) =>
      tx.update(diningTables).set({ active: false }).where(eq(diningTables.id, t2)),
    );
    await masterOf(z, [{ label: "Never 3" }]);

    await reset(z);

    expect(await todayRow(t1)).toBeUndefined();
    expect(await tableRow(v, t1)).toMatchObject({ active: true, planned: false });
    expect(await tableRow(v, t2)).toMatchObject({ active: false, planned: false });
  });

  it("places a table whose new name is taken in another zone, keeping its old name", async () => {
    const z = await zone();
    const t1 = await v.table("Taken 1", z);
    await v.table("Taken elsewhere");
    await masterOf(z, [{ label: "Taken elsewhere", place: place(3, 4), live: t1 }]);

    await reset(z);

    expect((await tableRow(v, t1)).label).toBe("Taken 1");
    expect(await todayRow(t1)).toMatchObject({ x: 3, y: 4 });
    expect(await pendingRows(z)).toMatchObject([{ tableId: t1, label: "Taken elsewhere" }]);
  });

  it("keeps a merge going while two of its tables are left in it", async () => {
    const z = await zone();
    const t1 = await v.table("Three 1", z);
    const u1 = await v.table("Three 2", z);
    const u2 = await v.table("Three 3", z);
    await masterOf(z, [{ label: "Three 1", live: t1 }]);
    const mergeId = await inTx(v, async (tx) => {
      const [merge] = await tx
        .insert(floorTodayJoins)
        .values({ zoneId: z, seats: 12 })
        .returning({ id: floorTodayJoins.id });
      for (const tableId of [t1, u1, u2]) {
        await tx
          .insert(floorTodayJoinTables)
          .values({ joinId: merge!.id, tableId, beforeX: 0, beforeY: 0, beforeRotation: 0 });
      }
      return merge!.id;
    });

    await reset(z);

    const members = await inTx(v, (tx) =>
      tx.select().from(floorTodayJoinTables).where(eq(floorTodayJoinTables.joinId, mergeId)),
    );
    expect(members.map((m) => m.tableId).sort()).toEqual([u1, u2].sort());
  });

  it("links a waiting new table to its own master table after the master's names are swapped", async () => {
    const z = await zone();
    const t1 = await v.table("Late 1", z);
    const master = await masterOf(z, [{ label: "Late 2", live: t1 }, { label: "Late 1" }]);
    const { partyId } = await seat(v, t1);
    await reset(z);
    const a = master.get("Late 1")!;
    const b = master.get("Late 2")!;
    await editMaster(a, { label: "Late tmp" });
    await editMaster(b, { label: "Late 1" });
    await editMaster(a, { label: "Late 2" });

    await finish(partyId);
    await catchUp(z);

    expect(await tableRow(v, t1)).toMatchObject({ label: "Late 2", planTableId: b });
    const created = (await liveTablesOf(z)).filter((t) => t.id !== t1);
    expect(created).toMatchObject([{ label: "Late 1", planTableId: a, planned: true }]);
    expect(await pendingRows(z)).toEqual([]);
  });

  it("keeps the day's move, take-off and merge of a table waiting only for its name", async () => {
    const z = await zone();
    const t1 = await v.table("Name 1", z);
    const t2 = await v.table("Name 2", z);
    await v.table("Name elsewhere");
    await masterOf(z, [
      { label: "Name elsewhere", place: place(0, 0), live: t1 },
      { label: "Name 2", place: place(10, 0), live: t2 },
    ]);
    await reset(z);
    await inTx(v, async (tx) => {
      await tx
        .update(floorTodayTables)
        .set({ x: 70, takenOff: true })
        .where(eq(floorTodayTables.tableId, t1));
      const [merge] = await tx
        .insert(floorTodayJoins)
        .values({ zoneId: z, seats: 8 })
        .returning({ id: floorTodayJoins.id });
      for (const tableId of [t1, t2]) {
        await tx
          .insert(floorTodayJoinTables)
          .values({ joinId: merge!.id, tableId, beforeX: 0, beforeY: 0, beforeRotation: 0 });
      }
    });

    await catchUp(z);

    expect(await todayRow(t1)).toMatchObject({ x: 70, takenOff: true });
    expect(await mergeMembersIn(z)).toEqual([t1, t2].sort());
    expect(await pendingRows(z)).toMatchObject([{ tableId: t1, placed: true }]);
  });

  it("puts a merge's last table back where it stood before the merge", async () => {
    const z = await zone();
    const t1 = await v.table("Back merge 1", z);
    const u1 = await v.table("Back merge 2", z);
    await masterOf(z, [{ label: "Back merge 1", place: place(0, 0), live: t1 }]);
    await inTx(v, async (tx) => {
      await tx
        .insert(floorTodayTables)
        .values({ tableId: u1, x: 9, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 });
      const [merge] = await tx
        .insert(floorTodayJoins)
        .values({ zoneId: z, seats: 8 })
        .returning({ id: floorTodayJoins.id });
      await tx
        .insert(floorTodayJoinTables)
        .values({ joinId: merge!.id, tableId: t1, beforeX: 0, beforeY: 0, beforeRotation: 0 });
      await tx
        .insert(floorTodayJoinTables)
        .values({ joinId: merge!.id, tableId: u1, beforeX: 30, beforeY: 40, beforeRotation: 90 });
    });

    await reset(z);

    expect(await todayRow(u1)).toMatchObject({ x: 30, y: 40, rotation: 90 });
    expect(await mergeMembersIn(z)).toEqual([]);
  });

  it("does not hand a name to a new table while a hidden table still holds it", async () => {
    const z = await zone();
    const t1 = await v.table("Hold 1", z);
    await inTx(v, (tx) =>
      tx.update(diningTables).set({ active: false }).where(eq(diningTables.id, t1)),
    );
    await masterOf(z, [{ label: "Hold 1" }]);

    await reset(z);

    expect((await liveTablesOf(z)).map((t) => t.id)).toEqual([t1]);
    expect(await pendingRows(z)).toMatchObject([{ tableId: null, label: "Hold 1" }]);
  });

  it("keeps a table a module refuses to let go, whole, until the module lets it go", async () => {
    const z = await zone();
    const t1 = await v.table("Refuse 1", z);
    const t2 = await v.table("Refuse 2", z);
    const master = await masterOf(z, [
      { label: "Refuse 1", place: place(0, 0), live: t1 },
      { label: "Refuse 2", place: place(10, 0), live: t2 },
    ]);
    await reset(z);
    await deleteFromMaster(master.get("Refuse 1")!);
    await deleteFromMaster(master.get("Refuse 2")!);
    let booked = true;
    const asked: string[] = [];
    const bookings: TableRemoval = {
      refuse: (_tx, cfg, tableId, now) => {
        asked.push(`${cfg.locationId}:${now.toISOString()}`);
        if (booked && tableId === t1) throw new AppError("table.not_found", { tableId });
        return Promise.resolve();
      },
      release: () => Promise.resolve(),
    };

    await reset(z, [bookings]);

    expect(await tableRow(v, t1)).toMatchObject({ active: true, label: "Refuse 1" });
    expect(await todayRow(t1)).toMatchObject({ x: 0 });
    expect((await pendingRows(z)).map((row) => row.tableId)).toEqual([t1]);
    expect((await liveTablesOf(z)).map((t) => t.id)).not.toContain(t2);
    expect(await todayRow(t2)).toBeUndefined();
    expect(asked).toContain(`${v.cfg.locationId}:${NOW.toISOString()}`);

    booked = false;
    await catchUp(z, [bookings]);

    expect((await liveTablesOf(z)).map((t) => t.id)).not.toContain(t1);
    expect(await todayRow(t1)).toBeUndefined();
    expect(await pendingRows(z)).toEqual([]);
  });

  it("does not put a refused table without a today's place onto today's plan", async () => {
    const z = await zone();
    const t1 = await v.table("Unseeded 1", z);
    const master = await masterOf(z, [{ label: "Unseeded 1", live: t1 }]);
    await deleteFromMaster(master.get("Unseeded 1")!);
    const bookings: TableRemoval = {
      refuse: (_tx, _cfg, tableId) => Promise.reject(new AppError("table.not_found", { tableId })),
      release: () => Promise.resolve(),
    };

    await reset(z, [bookings]);

    expect(await todayRow(t1)).toBeUndefined();
    expect((await tableRow(v, t1)).active).toBe(true);
  });

  it("does not swallow a module's failure that is not a refusal", async () => {
    const z = await zone();
    const t1 = await v.table("Broken 1", z);
    const master = await masterOf(z, [{ label: "Broken 1", live: t1 }]);
    await reset(z);
    await deleteFromMaster(master.get("Broken 1")!);
    const broken: TableRemoval = {
      refuse: () => Promise.reject(new Error("disk on fire")),
      release: () => Promise.resolve(),
    };

    await expect(reset(z, [broken])).rejects.toThrow("disk on fire");
  });
});

describe("a disabled zone", () => {
  it("is left out of the next day's reset, so its tables stay off, while an active zone resets", async () => {
    const off = await zone();
    const on = await zone();
    const offTable = await v.table("Off 1", off);
    const onTable = await v.table("On 1", on);
    await masterOf(off, [{ label: "Off 1", live: offTable }]);
    await masterOf(on, [{ label: "On 1", live: onTable }]);
    await inTx(v, (tx) => ensureToday(tx, v.cfg, NONE, NOW));
    await inTx(v, (tx) => deactivateZone(tx, v.cfg, off));
    expect((await tableRow(v, offTable)).active).toBe(false);

    const nextDay = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    await inTx(v, (tx) => ensureToday(tx, v.cfg, NONE, nextDay));

    expect((await tableRow(v, offTable)).active).toBe(false);
    expect(await todayZone(off)).toMatchObject({ businessDay: "2026-10-10", generation: 1 });
    expect(await todayZone(on)).toMatchObject({ businessDay: "2026-10-11", generation: 2 });
  });
});
