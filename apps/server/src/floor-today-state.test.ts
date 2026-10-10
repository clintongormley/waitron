import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { floorTodayJoins, floorTodayJoinTables, floorTodayTables, floorZones } from "@waitron/db";
import { zoneSalePolicies, zoneServicePolicies } from "@waitron/venue-service";
import { saveZonePlan, type ZonePlanSave } from "./floor-plan.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { inTx, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { listTablesWithState, type TableState } from "./working-order.js";
import "./errors.js";

let v: PartyVenue;

const NOW = new Date("2026-10-10T12:00:00Z");
const REMOVALS = enabledTableRemovals(ALL_MODULES);

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

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

function fresh(label: string): string {
  return `${label} ${randomUUID().slice(0, 6)}`;
}

type Entry = ZonePlanSave["tables"][number];

function place(x: number, y: number, extra: { width?: number; rotation?: number } = {}) {
  return { x, y, width: 8, height: 6, shape: "round" as const, rotation: 0, ...extra };
}

async function read(): Promise<Map<string, TableState>> {
  const states = await inTx(v, (tx) => listTablesWithState(tx, v.cfg, [], undefined, NOW));
  return new Map(states.map((s) => [s.id, s]));
}

describe("the till's table-state answer carries today's plan", () => {
  it("gives each planned table its today's row, a spare no placement, and a merge's tables one join", async () => {
    const zoneId = await zone();
    const [la, lb, ls, lo] = [fresh("A"), fresh("B"), fresh("S"), fresh("O")];
    const a = await v.table(la, zoneId);
    const b = await v.table(lb, zoneId);
    const spare = await v.table(ls, zoneId);
    const off = await v.table(lo, zoneId);
    const entries: Entry[] = [
      { key: "a", liveTableId: a, label: la, seats: 4, fixed: true, placement: place(3, 5) },
      {
        key: "b",
        liveTableId: b,
        label: lb,
        seats: 2,
        fixed: false,
        placement: place(20, 5, { width: 10, rotation: 45 }),
      },
      { key: "s", liveTableId: spare, label: ls, seats: null, fixed: false, placement: null },
      { key: "o", liveTableId: off, label: lo, seats: 6, fixed: false, placement: place(40, 0) },
    ];
    await inTx(v, (tx) =>
      saveZonePlan(tx, v.cfg, REMOVALS, zoneId, { revision: 0, tables: entries, joins: [] }, NOW),
    );
    const joinId = await inTx(v, async (tx) => {
      await tx
        .update(floorTodayTables)
        .set({ takenOff: true })
        .where(eq(floorTodayTables.tableId, off));
      const [join] = await tx
        .insert(floorTodayJoins)
        .values({ zoneId, seats: 7 })
        .returning({ id: floorTodayJoins.id });
      for (const tableId of [a, b]) {
        await tx
          .insert(floorTodayJoinTables)
          .values({ joinId: join!.id, tableId, beforeX: 0, beforeY: 0, beforeRotation: 0 });
      }
      return join!.id;
    });

    const states = await read();
    expect(states.get(a)!.today).toEqual({
      placement: place(3, 5),
      seats: 4,
      fixed: true,
      takenOff: false,
      joinId,
      joinSeats: 7,
    });
    expect(states.get(b)!.today).toEqual({
      placement: place(20, 5, { width: 10, rotation: 45 }),
      seats: 2,
      fixed: false,
      takenOff: false,
      joinId,
      joinSeats: 7,
    });
    expect(states.get(spare)!.today).toEqual({
      placement: null,
      seats: null,
      fixed: false,
      takenOff: false,
      joinId: null,
      joinSeats: null,
    });
    expect(states.get(off)!.today).toEqual({
      placement: null,
      seats: 6,
      fixed: false,
      takenOff: true,
      joinId: null,
      joinSeats: null,
    });
  });

  it("answers null for a table whose zone has no master plan", async () => {
    const zoneId = await zone();
    const t = await v.table(fresh("N"), zoneId);
    expect((await read()).get(t)!.today).toBeNull();
  });
});
