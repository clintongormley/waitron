import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  floorPlanPlacements,
  floorPlans,
  floorPlanSets,
  floorPlanTableSizes,
  floorResetTables,
  floorTodayTables,
  floorTodayZones,
  type Transaction,
} from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import {
  createDepartment,
  createServiceZone,
  departmentFloorPlanSets,
  linkFloorPlanSet,
} from "@waitron/venue-service";
import { readLayout, saveLayout, type ZonePlanSave } from "./floor-plan.js";
import { floorPlanSetsFor, layoutCounts } from "./floor-plan-sets.js";
import { floorDeletionFor } from "./floor-delete.js";
import { resetZone } from "./floor-today-store.js";
import { inTx, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
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

const NOW = new Date("2026-10-11T12:00:00Z");
const NONE: readonly TableRemoval[] = [];
const PLACE = { x: 0, y: 0, width: 8, height: 8, shape: "rect" as const, rotation: 0 };

type SaveEntry = ZonePlanSave["tables"][number];

function fresh(label: string): string {
  return `${label}-${randomUUID().slice(0, 6)}`;
}

function entry(key: string, label: string, extra: Partial<SaveEntry> = {}): SaveEntry {
  return { key, label, seats: 4, fixed: false, placement: PLACE, partKeys: [], ...extra };
}

const sets = () => floorPlanSetsFor(v.cfg);

/** A department with zone Inside and sets Standard (its default) and Dinner. */
async function department() {
  return inTx(v, async (tx) => {
    const dept = await createDepartment(tx, v.cfg, { name: fresh("Dept"), orderStart: "table" });
    const inside = await createServiceZone(tx, v.cfg, {
      name: fresh("Inside"),
      departmentId: dept.id,
    });
    const standard = await addSet(tx, dept.id, "Standard");
    const dinner = await addSet(tx, dept.id, "Dinner");
    return { departmentId: dept.id, zoneId: inside.id, standard, dinner };
  });
}

async function addSet(tx: Transaction, departmentId: string, name: string): Promise<string> {
  const setId = await sets().create(tx);
  await linkFloorPlanSet(tx, v.cfg, { setId, departmentId, name });
  return setId;
}

function save(setId: string, zoneId: string, input: ZonePlanSave) {
  return inTx(v, (tx) => saveLayout(tx, v.cfg, NONE, { setId, zoneId }, input, NOW));
}

/** Inside's tables 1–12 and the joined table 4+5, placed as `placed` says. */
function inside(placed: readonly string[]) {
  const labels = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "4+5"];
  return labels.map((id) => ({
    id,
    placed: placed.includes(id),
    partOf: id === "4" || id === "5" ? "4+5" : null,
  }));
}

describe("layoutCounts", () => {
  it("counts Inside's Standard layout: 1–12 placed, 4+5 off", () => {
    expect(
      layoutCounts(inside(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"])),
    ).toEqual({ onPlan: 12, spare: 0 });
  });

  it("counts Inside's Dinner layout: 4+5 placed, 4 and 5 off", () => {
    expect(
      layoutCounts(inside(["1", "2", "3", "4+5", "6", "7", "8", "9", "10", "11", "12"])),
    ).toEqual({ onPlan: 11, spare: 0 });
  });

  it("counts a placed part of a placed joined table once", () => {
    expect(layoutCounts(inside(["4+5", "4", "5"]))).toEqual({ onPlan: 1, spare: 10 });
  });

  it("counts Inside's Private party layout: 4+5, 1, 2 and 3 placed", () => {
    expect(layoutCounts(inside(["4+5", "1", "2", "3"]))).toEqual({ onPlan: 4, spare: 7 });
  });

  it("counts an unplaced part of a joined table that has come apart as a spare", () => {
    expect(layoutCounts(inside(["4"]))).toEqual({ onPlan: 1, spare: 11 });
  });

  it("counts an unplaced joined table with no placed part as one spare", () => {
    expect(layoutCounts(inside([]))).toEqual({ onPlan: 0, spare: 11 });
  });

  it("counts the Terrace's Standard layout: T1–T10 of 16", () => {
    const tables = Array.from({ length: 16 }, (_, i) => ({
      id: `T${i + 1}`,
      placed: i < 10,
      partOf: null,
    }));
    expect(layoutCounts(tables)).toEqual({ onPlan: 10, spare: 6 });
  });
});

describe("the floor plan sets port", () => {
  it("creates an empty set of the location", async () => {
    const setId = await inTx(v, (tx) => sets().create(tx));
    const rows = await inTx(v, (tx) =>
      tx.select().from(floorPlanSets).where(eq(floorPlanSets.id, setId)),
    );
    expect(rows).toEqual([{ id: setId, locationId: v.cfg.locationId }]);
    const layouts = await inTx(v, (tx) =>
      tx.select().from(floorPlans).where(eq(floorPlans.setId, setId)),
    );
    expect(layouts).toEqual([]);
  });

  it("copies a set's layouts", async () => {
    const d = await department();
    const { ids } = await save(d.dinner, d.zoneId, {
      revision: 0,
      tables: [entry("a", fresh("1")), entry("b", fresh("2"), { placement: { ...PLACE, x: 20 } })],
    });
    const first = await inTx(v, (tx) =>
      readLayout(tx, v.cfg, { setId: d.dinner, zoneId: d.zoneId }),
    );
    await save(d.dinner, d.zoneId, {
      revision: first.revision,
      tables: first.tables.map((t) => ({
        id: t.id,
        key: t.id,
        label: t.label,
        seats: t.seats,
        fixed: t.fixed,
        placement: t.id === ids.a ? null : { ...PLACE, x: 30 },
        partKeys: [],
      })),
    });
    const dinner = await inTx(v, (tx) =>
      readLayout(tx, v.cfg, { setId: d.dinner, zoneId: d.zoneId }),
    );
    expect(dinner.revision).toBeGreaterThan(1);
    expect(dinner.tables.find((t) => t.id === ids.a)!.keptSize).toEqual({ width: 8, height: 8 });

    const bar = await inTx(v, (tx) =>
      createServiceZone(tx, v.cfg, { name: fresh("Bar"), departmentId: d.departmentId }),
    );
    await save(d.dinner, bar.id, { revision: 0, tables: [] });

    const late = await inTx(v, async (tx) => {
      const setId = await addSet(tx, d.departmentId, "Late");
      await sets().copyLayouts(tx, d.dinner, setId);
      return setId;
    });

    const copied = await inTx(v, (tx) => readLayout(tx, v.cfg, { setId: late, zoneId: d.zoneId }));
    expect(copied.revision).toBe(1);
    expect(copied.tables).toEqual(dinner.tables);
    expect(
      (await inTx(v, (tx) => readLayout(tx, v.cfg, { setId: d.dinner, zoneId: d.zoneId }))).tables,
    ).toEqual(dinner.tables);
    const emptyCopy = await inTx(v, (tx) => readLayout(tx, v.cfg, { setId: late, zoneId: bar.id }));
    expect(emptyCopy).toMatchObject({ revision: 1, tables: [] });
  });

  it("refuses a copy from or to a set the location does not hold", async () => {
    const d = await department();
    const unknown = randomUUID();
    for (const [from, to] of [
      [unknown, d.dinner],
      [d.dinner, unknown],
    ] as const) {
      await expect(inTx(v, (tx) => sets().copyLayouts(tx, from, to))).rejects.toMatchObject({
        code: "floor_plan_set.not_found",
        params: { setId: unknown },
      });
    }
  });

  it("reads each zone's table count and each layout's revision and counts", async () => {
    const d = await department();
    await save(d.dinner, d.zoneId, {
      revision: 0,
      tables: [
        entry("a", fresh("1")),
        entry("b", fresh("2")),
        entry("c", fresh("3"), { placement: null }),
      ],
    });
    const empty = await inTx(v, (tx) => sets().create(tx));
    const other = await inTx(v, (tx) =>
      createServiceZone(tx, v.cfg, { name: fresh("Bar"), departmentId: d.departmentId }),
    );

    const read = await inTx(v, (tx) =>
      sets().readLayouts(tx, [d.dinner, empty], [d.zoneId, other.id]),
    );

    expect([...read.tableCounts]).toEqual([
      [d.zoneId, 3],
      [other.id, 0],
    ]);
    expect(read.layouts).toEqual([
      { setId: d.dinner, zoneId: d.zoneId, revision: 1, onPlan: 2, spare: 1 },
      { setId: d.dinner, zoneId: other.id, revision: 0, onPlan: 0, spare: 0 },
      { setId: empty, zoneId: d.zoneId, revision: 0, onPlan: 0, spare: 3 },
      { setId: empty, zoneId: other.id, revision: 0, onPlan: 0, spare: 0 },
    ]);
    expect(await inTx(v, (tx) => sets().readLayouts(tx, [], [d.zoneId]))).toEqual({
      tableCounts: new Map([[d.zoneId, 3]]),
      layouts: [],
    });
    expect(await inTx(v, (tx) => sets().readLayouts(tx, [], []))).toEqual({
      tableCounts: new Map(),
      layouts: [],
    });
  });

  it("names the zones whose today's record shows a set", async () => {
    const d = await department();
    await save(d.dinner, d.zoneId, { revision: 0, tables: [entry("a", fresh("1"))] });
    await inTx(v, (tx) =>
      resetZone(tx, v.cfg, NONE, d.zoneId, NOW, { setId: d.dinner, occurrence: null }),
    );

    expect(await inTx(v, (tx) => sets().zonesShowing(tx, d.dinner))).toEqual([d.zoneId]);
    expect(await inTx(v, (tx) => sets().zonesShowing(tx, d.standard))).toEqual([]);
  });

  it("removes a set and nulls today's record", async () => {
    const d = await department();
    await save(d.dinner, d.zoneId, {
      revision: 0,
      tables: [entry("a", fresh("1")), entry("b", fresh("2"))],
    });
    const dinner = await inTx(v, (tx) =>
      readLayout(tx, v.cfg, { setId: d.dinner, zoneId: d.zoneId }),
    );
    await save(d.dinner, d.zoneId, {
      revision: dinner.revision,
      tables: dinner.tables.map((t, i) => ({
        id: t.id,
        key: t.id,
        label: t.label,
        seats: t.seats,
        fixed: t.fixed,
        placement: i === 0 ? null : t.placement,
        partKeys: [],
      })),
    });
    await inTx(v, (tx) =>
      resetZone(tx, v.cfg, NONE, d.zoneId, NOW, { setId: d.dinner, occurrence: null }),
    );
    const before = await inTx(v, async (tx) => {
      const reset = await tx
        .select()
        .from(floorResetTables)
        .where(eq(floorResetTables.zoneId, d.zoneId));
      const live = await tx.select().from(floorTodayTables);
      return { reset, live };
    });
    expect(before.reset.length).toBe(2);
    const plans = await inTx(v, (tx) =>
      tx.select({ id: floorPlans.id }).from(floorPlans).where(eq(floorPlans.setId, d.dinner)),
    );
    const planIds = plans.map((p) => p.id);
    expect(
      await inTx(v, (tx) =>
        tx.select().from(floorPlanTableSizes).where(inArray(floorPlanTableSizes.planId, planIds)),
      ),
    ).toHaveLength(1);

    await inTx(v, async (tx) => {
      await tx.delete(departmentFloorPlanSets).where(eq(departmentFloorPlanSets.setId, d.dinner));
      await floorDeletionFor(v.cfg, NONE).removeSets(tx, [d.dinner]);
    });

    const after = await inTx(v, async (tx) => ({
      sets: await tx.select().from(floorPlanSets).where(eq(floorPlanSets.id, d.dinner)),
      plans: await tx.select().from(floorPlans).where(eq(floorPlans.setId, d.dinner)),
      placements: await tx
        .select()
        .from(floorPlanPlacements)
        .where(inArray(floorPlanPlacements.planId, planIds)),
      sizes: await tx
        .select()
        .from(floorPlanTableSizes)
        .where(inArray(floorPlanTableSizes.planId, planIds)),
      today: await tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, d.zoneId)),
      reset: await tx.select().from(floorResetTables).where(eq(floorResetTables.zoneId, d.zoneId)),
      live: await tx.select().from(floorTodayTables),
      standard: await tx.select().from(floorPlans).where(eq(floorPlans.setId, d.standard)),
    }));
    expect(after.sets).toEqual([]);
    expect(after.plans).toEqual([]);
    expect(after.placements).toEqual([]);
    expect(after.sizes).toEqual([]);
    expect(after.today).toHaveLength(1);
    expect(after.today[0]!.setId).toBeNull();
    expect(after.reset).toEqual(before.reset);
    expect(after.live).toEqual(before.live);
    expect(after.standard).toHaveLength(1);
  });

  it("removes nothing for no sets and ignores another location's set", async () => {
    const d = await department();
    await inTx(v, (tx) =>
      floorDeletionFor({ ...v.cfg, locationId: randomUUID() as never }, NONE).removeSets(tx, [
        d.standard,
      ]),
    );
    await inTx(v, (tx) => floorDeletionFor(v.cfg, NONE).removeSets(tx, []));
    const rows = await inTx(v, (tx) =>
      tx.select().from(floorPlanSets).where(eq(floorPlanSets.id, d.standard)),
    );
    expect(rows).toHaveLength(1);
  });
});
