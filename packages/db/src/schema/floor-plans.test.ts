import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { checkFailed, refusalOn } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { UNIQUE_VIOLATION } from "../sql-state.js";
import { withTransaction } from "../tenancy.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { diningTables } from "./dining-tables.js";
import {
  floorPlanJoinTables,
  floorPlanJoins,
  floorPlans,
  floorPlanTables,
  floorResetTables,
  floorTodayJoinTables,
  floorTodayJoins,
  floorTodayTables,
  floorTodayZones,
} from "./floor-plans.js";
import { floorZones } from "./floor-zones.js";
import { parties } from "./parties.js";
import { locations, tenants } from "./tenants.js";

const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
const ZONE = "bbbbbbbb-0000-4000-8000-000000000001";
const OTHER_ZONE = "bbbbbbbb-0000-4000-8000-000000000002";
const PLAN = "cccccccc-0000-4000-8000-000000000001";
const TABLE_1 = "dddddddd-0000-4000-8000-000000000001";
const TABLE_2 = "dddddddd-0000-4000-8000-000000000002";
const PERSON = "eeeeeeee-0000-4000-8000-000000000001";

const PLACED = { x: 10, y: 20, width: 4, height: 4, shape: "rect", rotation: 0 } as const;
const GOOD_MASTER_TABLE = { planId: PLAN, label: "T9", seats: 4, ...PLACED };
const NO_PLACE = { x: null, y: null, width: null, height: null, shape: null, rotation: null };

describe("floor plan tables", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  beforeEach(async () => {
    const db = suite.db;
    await db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await db
      .insert(locations)
      .values([
        { id: LOCATION, name: "Loc A", invoiceLocales: ["es"], operationDescription: "Hostelería" },
      ]);
    await db.insert(floorZones).values([
      { id: ZONE, locationId: LOCATION, name: "Comedor" },
      { id: OTHER_ZONE, locationId: LOCATION, name: "Terraza" },
    ]);
    await db.insert(floorPlans).values({ id: PLAN, zoneId: ZONE, savedAt: "2026-10-08T10:00:00Z" });
    await db.insert(diningTables).values([
      { id: TABLE_1, locationId: LOCATION, label: "T1", zoneId: ZONE },
      { id: TABLE_2, locationId: LOCATION, label: "T2", zoneId: ZONE },
    ]);
  });

  type MasterValues = Record<string, unknown>;
  function insertMasterTable(values: MasterValues) {
    return inTx((tx) =>
      tx.insert(floorPlanTables).values(values as typeof floorPlanTables.$inferInsert),
    );
  }

  it.each([
    ["rotation 20", { rotation: 20 }, "floor_plan_tables_rotation_ck"],
    ["rotation 360", { rotation: 360 }, "floor_plan_tables_rotation_ck"],
    ["rotation -15", { rotation: -15 }, "floor_plan_tables_rotation_ck"],
    ["x -1", { x: -1 }, "floor_plan_tables_x_ck"],
    ["x 1000", { x: 1000 }, "floor_plan_tables_x_ck"],
    ["y 1000", { y: 1000 }, "floor_plan_tables_y_ck"],
    ["width 0", { width: 0 }, "floor_plan_tables_width_ck"],
    ["height 100", { height: 100 }, "floor_plan_tables_height_ck"],
    ["shape square", { shape: "square" }, "floor_plan_tables_shape_ck"],
    ["seats 1000", { seats: 1000 }, "floor_plan_tables_seats_ck"],
    ["seats -1", { seats: -1 }, "floor_plan_tables_seats_ck"],
    ["a position without a size", { width: null }, "floor_plan_tables_placement_ck"],
    ["a size without a position", { x: null, y: null }, "floor_plan_tables_placement_ck"],
    ["no shape", { shape: null }, "floor_plan_tables_placement_ck"],
  ] as const)("refuses a master table with %s", async (_name, patch, constraint) => {
    const error = await captureError(() => insertMasterTable({ ...GOOD_MASTER_TABLE, ...patch }));
    expect(checkFailed(error, constraint)).toBe(true);
  });

  it.each([
    ["the bounds' low ends", { x: 0, y: 0, width: 1, height: 1, rotation: 0, seats: 0 }],
    ["the bounds' high ends", { x: 999, y: 999, width: 99, height: 99, rotation: 345, seats: 999 }],
    ["a round table turned 15", { shape: "round", rotation: 15, seats: null }],
  ] as const)("accepts a master table at %s (the control)", async (name, patch) => {
    await insertMasterTable({ ...GOOD_MASTER_TABLE, label: `ok ${name}`, ...patch });
  });

  it("accepts a master spare with no position at all", async () => {
    await insertMasterTable({ planId: PLAN, label: "spare", ...NO_PLACE });
    const [row] = await inTx((tx) =>
      tx.select().from(floorPlanTables).where(eq(floorPlanTables.label, "spare")),
    );
    expect(row).toMatchObject({ ...NO_PLACE, seats: null, fixed: false });
  });

  it("keeps names unique within a plan", async () => {
    await insertMasterTable({ ...GOOD_MASTER_TABLE, label: "dup" });
    const error = await captureError(() =>
      insertMasterTable({ ...GOOD_MASTER_TABLE, label: "dup" }),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "floor_plan_tables",
        columns: ["plan_id", "label"],
      }),
    ).toBe(true);
  });

  it("keeps one plan, and one today's row, per zone", async () => {
    const plan = await captureError(() =>
      inTx((tx) => tx.insert(floorPlans).values({ zoneId: ZONE, savedAt: "2026-10-08T11:00:00Z" })),
    );
    expect(refusalOn(plan, UNIQUE_VIOLATION, { table: "floor_plans", columns: ["zone_id"] })).toBe(
      true,
    );

    await inTx((tx) =>
      tx.insert(floorTodayZones).values({ zoneId: OTHER_ZONE, businessDay: "2026-10-08" }),
    );
    const today = await captureError(() =>
      inTx((tx) =>
        tx.insert(floorTodayZones).values({ zoneId: OTHER_ZONE, businessDay: "2026-10-09" }),
      ),
    );
    expect(
      refusalOn(today, UNIQUE_VIOLATION, { table: "floor_today_zones", columns: ["zone_id"] }),
    ).toBe(true);
  });

  it("keeps one today's row and one reset row per live table, and a table in one merge at a time", async () => {
    const extra = await inTx(async (tx) => {
      const [row] = await tx
        .insert(diningTables)
        .values({ locationId: LOCATION, label: "U1", zoneId: OTHER_ZONE })
        .returning({ id: diningTables.id });
      return row!.id;
    });
    await inTx((tx) => tx.insert(floorTodayTables).values({ tableId: extra, ...PLACED }));
    const today = await captureError(() =>
      inTx((tx) => tx.insert(floorTodayTables).values({ tableId: extra, ...NO_PLACE })),
    );
    expect(
      refusalOn(today, UNIQUE_VIOLATION, { table: "floor_today_tables", columns: ["table_id"] }),
    ).toBe(true);

    await inTx((tx) =>
      tx.insert(floorResetTables).values({ zoneId: OTHER_ZONE, tableId: extra, label: "U1" }),
    );
    const reset = await captureError(() =>
      inTx((tx) =>
        tx.insert(floorResetTables).values({ zoneId: OTHER_ZONE, tableId: extra, label: "U1" }),
      ),
    );
    expect(
      refusalOn(reset, UNIQUE_VIOLATION, { table: "floor_reset_tables", columns: ["table_id"] }),
    ).toBe(true);

    const [first, second] = await inTx(async (tx) => {
      const a = await tx
        .insert(floorTodayJoins)
        .values({ zoneId: OTHER_ZONE, seats: 6 })
        .returning({ id: floorTodayJoins.id });
      const b = await tx
        .insert(floorTodayJoins)
        .values({ zoneId: OTHER_ZONE, seats: 6 })
        .returning({ id: floorTodayJoins.id });
      return [a[0]!.id, b[0]!.id];
    });
    const before = { beforeX: 1, beforeY: 2, beforeRotation: 30 };
    await inTx((tx) =>
      tx.insert(floorTodayJoinTables).values({ joinId: first!, tableId: extra, ...before }),
    );
    const merge = await captureError(() =>
      inTx((tx) =>
        tx.insert(floorTodayJoinTables).values({ joinId: second!, tableId: extra, ...before }),
      ),
    );
    expect(
      refusalOn(merge, UNIQUE_VIOLATION, {
        table: "floor_today_join_tables",
        columns: ["table_id"],
      }),
    ).toBe(true);
  });

  it("keeps a master table in one join only once", async () => {
    const [tableId, joinId] = await inTx(async (tx) => {
      const [t] = await tx
        .insert(floorPlanTables)
        .values({ ...GOOD_MASTER_TABLE, label: "J1" })
        .returning({ id: floorPlanTables.id });
      const [j] = await tx
        .insert(floorPlanJoins)
        .values({ planId: PLAN, seats: 8 })
        .returning({ id: floorPlanJoins.id });
      return [t!.id, j!.id];
    });
    await inTx((tx) => tx.insert(floorPlanJoinTables).values({ joinId, planTableId: tableId }));
    const error = await captureError(() =>
      inTx((tx) => tx.insert(floorPlanJoinTables).values({ joinId, planTableId: tableId })),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "floor_plan_join_tables",
        columns: ["join_id", "plan_table_id"],
      }),
    ).toBe(true);
  });

  it.each([
    [
      "a master join with no seats",
      () => inTx((tx) => tx.insert(floorPlanJoins).values({ planId: PLAN, seats: 0 })),
      "floor_plan_joins_seats_ck",
    ],
    [
      "a today's join with no seats",
      () => inTx((tx) => tx.insert(floorTodayJoins).values({ zoneId: ZONE, seats: 0 })),
      "floor_today_joins_seats_ck",
    ],
    [
      "a reset row turned 20",
      () =>
        inTx((tx) =>
          tx.insert(floorResetTables).values({ zoneId: ZONE, label: "R", ...PLACED, rotation: 20 }),
        ),
      "floor_reset_tables_rotation_ck",
    ],
    [
      "a reset row placed with no size",
      () =>
        inTx((tx) =>
          tx.insert(floorResetTables).values({ zoneId: ZONE, label: "R", ...PLACED, height: null }),
        ),
      "floor_reset_tables_placement_ck",
    ],
    [
      "a reset row with 1000 seats",
      () =>
        inTx((tx) => tx.insert(floorResetTables).values({ zoneId: ZONE, label: "R", seats: 1000 })),
      "floor_reset_tables_seats_ck",
    ],
    [
      "a today's table at x 1000",
      () =>
        inTx((tx) => tx.insert(floorTodayTables).values({ tableId: TABLE_2, ...PLACED, x: 1000 })),
      "floor_today_tables_x_ck",
    ],
    [
      "a today's table with no shape",
      () =>
        inTx((tx) =>
          tx.insert(floorTodayTables).values({ tableId: TABLE_2, ...PLACED, shape: null }),
        ),
      "floor_today_tables_placement_ck",
    ],
    [
      "a merged table that was turned 20",
      async () => {
        const joinId = await inTx(async (tx) => {
          const [j] = await tx
            .insert(floorTodayJoins)
            .values({ zoneId: ZONE, seats: 2 })
            .returning({ id: floorTodayJoins.id });
          return j!.id;
        });
        return inTx((tx) =>
          tx
            .insert(floorTodayJoinTables)
            .values({ joinId, tableId: TABLE_2, beforeX: 1, beforeY: 1, beforeRotation: 20 }),
        );
      },
      "floor_today_join_tables_before_rotation_ck",
    ],
    [
      "a merged table that stood at x 1000",
      async () => {
        const joinId = await inTx(async (tx) => {
          const [j] = await tx
            .insert(floorTodayJoins)
            .values({ zoneId: ZONE, seats: 2 })
            .returning({ id: floorTodayJoins.id });
          return j!.id;
        });
        return inTx((tx) =>
          tx
            .insert(floorTodayJoinTables)
            .values({ joinId, tableId: TABLE_2, beforeX: 1000, beforeY: 1, beforeRotation: 0 }),
        );
      },
      "floor_today_join_tables_before_x_ck",
    ],
  ] as const)("refuses %s", async (_name, write, constraint) => {
    const error = await captureError(write);
    expect(checkFailed(error, constraint)).toBe(true);
  });

  it("round-trips a plan, reset rows, today's rows and the new columns", async () => {
    const masterId = await inTx(async (tx) => {
      const [row] = await tx
        .insert(floorPlanTables)
        .values({ ...GOOD_MASTER_TABLE, label: "T1", fixed: true, rotation: 345 })
        .returning({ id: floorPlanTables.id });
      return row!.id;
    });
    await inTx(async (tx) => {
      await tx
        .update(diningTables)
        .set({ planTableId: masterId, planned: true })
        .where(eq(diningTables.id, TABLE_1));
      await tx
        .insert(floorResetTables)
        .values({ zoneId: ZONE, tableId: TABLE_1, label: "T1", seats: 4, fixed: true, ...PLACED });
      await tx
        .insert(floorResetTables)
        .values({ zoneId: ZONE, tableId: null, label: "T5", ...NO_PLACE, pending: true });
      await tx
        .insert(floorTodayZones)
        .values({ zoneId: ZONE, businessDay: "2026-10-08", generation: 3 });
      await tx.insert(floorTodayTables).values({ tableId: TABLE_1, seats: 4, ...PLACED });
      await tx.insert(parties).values({ openedBy: PERSON, tableNames: ["T1", "T2"] });
    });

    const [plan] = await inTx((tx) => tx.select().from(floorPlans).where(eq(floorPlans.id, PLAN)));
    expect(plan).toEqual({
      id: PLAN,
      zoneId: ZONE,
      revision: 0,
      savedAt: "2026-10-08T10:00:00Z",
    });
    const [master] = await inTx((tx) =>
      tx.select().from(floorPlanTables).where(eq(floorPlanTables.id, masterId)),
    );
    expect(master).toEqual({
      id: masterId,
      planId: PLAN,
      label: "T1",
      seats: 4,
      fixed: true,
      ...PLACED,
      rotation: 345,
    });
    const live = await inTx((tx) =>
      tx
        .select({
          id: diningTables.id,
          planTableId: diningTables.planTableId,
          planned: diningTables.planned,
        })
        .from(diningTables)
        .where(eq(diningTables.zoneId, ZONE))
        .orderBy(diningTables.label),
    );
    expect(live).toEqual([
      { id: TABLE_1, planTableId: masterId, planned: true },
      { id: TABLE_2, planTableId: null, planned: false },
    ]);
    const resets = await inTx((tx) =>
      tx
        .select()
        .from(floorResetTables)
        .where(eq(floorResetTables.zoneId, ZONE))
        .orderBy(floorResetTables.label),
    );
    expect(resets).toEqual([
      expect.objectContaining({
        tableId: TABLE_1,
        label: "T1",
        seats: 4,
        fixed: true,
        ...PLACED,
        remove: false,
        pending: false,
      }),
      expect.objectContaining({
        tableId: null,
        label: "T5",
        seats: null,
        fixed: false,
        ...NO_PLACE,
        remove: false,
        pending: true,
      }),
    ]);
    const [todayZone] = await inTx((tx) =>
      tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, ZONE)),
    );
    expect(todayZone).toMatchObject({ businessDay: "2026-10-08", generation: 3 });
    const [todayTable] = await inTx((tx) =>
      tx.select().from(floorTodayTables).where(eq(floorTodayTables.tableId, TABLE_1)),
    );
    expect(todayTable).toMatchObject({ seats: 4, fixed: false, takenOff: false, ...PLACED });
    const [party] = await inTx((tx) =>
      tx
        .select({ tableNames: parties.tableNames })
        .from(parties)
        .where(eq(parties.openedBy, PERSON)),
    );
    expect(party!.tableNames).toEqual(["T1", "T2"]);
  });

  it("starts a today's zone at generation 0", async () => {
    const zone = await inTx(async (tx) => {
      const [row] = await tx
        .insert(floorZones)
        .values({ locationId: LOCATION, name: "Barra" })
        .returning({ id: floorZones.id });
      return row!.id;
    });
    await inTx((tx) =>
      tx.insert(floorTodayZones).values({ zoneId: zone, businessDay: "2026-10-08" }),
    );
    const [row] = await inTx((tx) =>
      tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, zone)),
    );
    expect(row!.generation).toBe(0);
  });
});
