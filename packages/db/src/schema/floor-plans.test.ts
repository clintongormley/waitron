import { todaySet } from "@waitron/db";
import { todayColumns } from "../floor-today-columns.js";
import { eq, inArray, isNotNull, sql, and } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { Transaction } from "../client.js";
import { checkFailed, refusalOn } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { withTransaction } from "../tenancy.js";
import { isRefusal } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { seedVenue, seedZone } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { diningTables } from "./dining-tables.js";
import {
  floorPlanPlacements,
  floorPlans,
  floorPlanSets,
  floorPlanTables,
  floorResetTables,
  tableMerges,
  rangeCheck,
} from "./floor-plans.js";
import { floorZones } from "./floor-zones.js";
import { parties } from "./parties.js";

let DEPARTMENT: string;
const ZONE = "bbbbbbbb-0000-4000-8000-000000000001";
const OTHER_ZONE = "bbbbbbbb-0000-4000-8000-000000000002";
const PLAN = "cccccccc-0000-4000-8000-000000000001";
const SET = "cccccccc-0000-4000-8000-000000000009";
const TABLE_1 = "dddddddd-0000-4000-8000-000000000001";
const TABLE_2 = "dddddddd-0000-4000-8000-000000000002";
const PERSON = "eeeeeeee-0000-4000-8000-000000000001";

const PLACED = { x: 10, y: 20, width: 4, height: 4, shape: "rect", rotation: 0 } as const;
const GOOD_MASTER_TABLE = { zoneId: ZONE, label: "T9", seats: 4 };
const NO_PLACE = { x: null, y: null, width: null, height: null, shape: null, rotation: null };

describe("floor plan tables", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  beforeEach(async () => {
    const db = suite.db;
    await seedVenue(db, {
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    DEPARTMENT = (await seedZone(db, { id: ZONE, name: "Dining room" })).departmentId;
    await seedZone(db, { id: OTHER_ZONE, name: "Terrace" });
    await db
      .insert(floorPlanSets)
      .values({ id: SET, departmentId: DEPARTMENT, name: "Standard", isDefault: true });
    await db
      .insert(floorPlans)
      .values({ id: PLAN, zoneId: ZONE, setId: SET, savedAt: "2026-10-08T10:00:00Z" });
    await db.insert(diningTables).values([
      { id: TABLE_1, label: "T1", zoneId: ZONE },
      { id: TABLE_2, label: "T2", zoneId: ZONE },
    ]);
  });

  type MasterValues = Record<string, unknown>;
  function insertMasterTable(values: MasterValues) {
    return inTx((tx) =>
      tx.insert(floorPlanTables).values(values as typeof floorPlanTables.$inferInsert),
    );
  }

  async function insertSet(): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(floorPlanSets)
        .values({ departmentId: DEPARTMENT, name: crypto.randomUUID() })
        .returning({ id: floorPlanSets.id });
      return row!.id;
    });
  }

  async function insertPlanTable(label: string): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(floorPlanTables)
        .values({ ...GOOD_MASTER_TABLE, label })
        .returning({ id: floorPlanTables.id });
      return row!.id;
    });
  }

  it("keeps every incoming design-table key at NO ACTION", () => {
    const rows = suite.db.all<{ source: string; deletion: string }>(sql`
      select m.name || '.' || f."from" as source, f.on_delete as deletion
      from sqlite_master m join pragma_foreign_key_list(m.name) f
      where m.type = 'table' and f."table" = 'floor_plan_tables' order by source`);
    expect(rows).toEqual([
      { source: "dining_tables.plan_table_id", deletion: "NO ACTION" },
      { source: "floor_plan_placements.plan_table_id", deletion: "NO ACTION" },
      { source: "floor_plan_tables.part_of_table_id", deletion: "NO ACTION" },
      { source: "floor_reset_tables.plan_table_id", deletion: "NO ACTION" },
    ]);
  });

  it("refuses a blank name on the owning floor set row", async () => {
    const [zone] = await inTx((tx) =>
      tx
        .select({ departmentId: floorZones.departmentId })
        .from(floorZones)
        .where(eq(floorZones.id, ZONE)),
    );
    const error = await captureError(() =>
      inTx(async (tx) =>
        tx.execute(
          sql`insert into floor_plan_sets (id, department_id, name, is_default) values (${PERSON}, ${zone!.departmentId}, '  ', 0)`,
        ),
      ),
    );
    expect(checkFailed(error, "floor_plan_sets_name_ck")).toBe(true);
  });

  it("stores saved membership on each design and reset row, refusing self membership", async () => {
    const plan = await insertCounterTables();
    const reset = await insertCounterResetRows();
    for (const [table, column, parent, member, constraint] of [
      [
        "floor_plan_tables",
        "part_of_table_id",
        plan.long,
        plan.counter3,
        "floor_plan_tables_part_of_not_self_ck",
      ],
      [
        "floor_reset_tables",
        "part_of_reset_table_id",
        reset.long,
        reset.counter3,
        "floor_reset_tables_part_of_not_self_ck",
      ],
    ]) {
      const refused = await captureError(() =>
        inTx(async (tx) =>
          tx.execute(
            sql`update ${sql.identifier(table!)} set ${sql.identifier(column!)} = ${parent!} where id = ${parent!}`,
          ),
        ),
      );
      expect(checkFailed(refused, constraint!)).toBe(true);
      await inTx(async (tx) =>
        tx.execute(
          sql`update ${sql.identifier(table!)} set ${sql.identifier(column!)} = ${parent!} where id = ${member!}`,
        ),
      );
      const missing = await captureError(() =>
        inTx(async (tx) =>
          tx.execute(
            sql`update ${sql.identifier(table!)} set ${sql.identifier(column!)} = ${PERSON} where id = ${member!}`,
          ),
        ),
      );
      expect(isRefusal(missing, FOREIGN_KEY_VIOLATION)).toBe(true);
      const deletion = await captureError(() =>
        inTx(async (tx) =>
          tx.execute(sql`delete from ${sql.identifier(table!)} where id = ${parent!}`),
        ),
      );
      expect(isRefusal(deletion, FOREIGN_KEY_VIOLATION)).toBe(true);
    }
  });

  it("keeps mandatory sizes while a placement is off, refusing partially placed rows", async () => {
    const tableId = await insertPlanTable("Kept");
    await inTx((tx) =>
      tx.insert(floorPlanPlacements).values({
        planId: PLAN,
        planTableId: tableId,
        x: null,
        y: null,
        width: 2,
        height: 3,
        shape: null,
        rotation: null,
      } as unknown as typeof floorPlanPlacements.$inferInsert),
    );
    const partial = await captureError(() =>
      inTx((tx) =>
        tx
          .update(floorPlanPlacements)
          .set({ x: 0 })
          .where(eq(floorPlanPlacements.planTableId, tableId)),
      ),
    );
    expect(checkFailed(partial, "floor_plan_placements_placement_ck")).toBe(true);
    const [kept] = await inTx((tx) => tx.select().from(floorPlanPlacements));
    expect(kept).toMatchObject({
      x: null,
      y: null,
      width: 2,
      height: 3,
      shape: null,
      rotation: null,
    });
  });

  it.each([
    ["seats 1000", { seats: 1000 }, "floor_plan_tables_seats_ck"],
    ["seats -1", { seats: -1 }, "floor_plan_tables_seats_ck"],
  ] as const)("refuses a master table with %s", async (_name, patch, constraint) => {
    const error = await captureError(() => insertMasterTable({ ...GOOD_MASTER_TABLE, ...patch }));
    expect(checkFailed(error, constraint)).toBe(true);
  });

  it.each([
    ["the bounds' low ends", { seats: 0 }],
    ["the bounds' high ends", { seats: 999 }],
  ] as const)("accepts a master table at %s (the control)", async (name, patch) => {
    await insertMasterTable({ ...GOOD_MASTER_TABLE, label: `ok ${name}`, ...patch });
  });

  it("accepts a master table with no seat count, not fixed unless asked", async () => {
    await insertMasterTable({ zoneId: ZONE, label: "spare" });
    const [row] = await inTx((tx) =>
      tx.select().from(floorPlanTables).where(eq(floorPlanTables.label, "spare")),
    );
    expect(row).toMatchObject({ seats: null, fixed: false });
  });

  it("keeps names unique within a zone", async () => {
    await insertMasterTable({ ...GOOD_MASTER_TABLE, label: "dup" });
    const error = await captureError(() =>
      insertMasterTable({ ...GOOD_MASTER_TABLE, label: "dup" }),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "floor_plan_tables",
        columns: ["zone_id", "label"],
      }),
    ).toBe(true);
  });

  it("keeps one plan per zone in a set", async () => {
    const setId = await insertSet();
    await inTx((tx) => tx.update(floorPlans).set({ setId }).where(eq(floorPlans.id, PLAN)));
    const plan = await captureError(() =>
      inTx((tx) =>
        tx.insert(floorPlans).values({ zoneId: ZONE, setId, savedAt: "2026-10-08T11:00:00Z" }),
      ),
    );
    expect(
      refusalOn(plan, UNIQUE_VIOLATION, { table: "floor_plans", columns: ["set_id", "zone_id"] }),
    ).toBe(true);
  });

  it("keeps one reset row per live table", async () => {
    const extra = await inTx(async (tx) => {
      const [row] = await tx
        .insert(diningTables)
        .values({ label: "U1", zoneId: OTHER_ZONE })
        .returning({ id: diningTables.id });
      return row!.id;
    });
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
  });

  it.each([
    [
      "a today's join with no seats",
      () => inTx((tx) => tx.insert(tableMerges).values({ zoneId: ZONE, seats: 0 })),
      "table_merges_seats_ck",
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
        inTx((tx) =>
          tx
            .update(diningTables)
            .set(todaySet({ ...PLACED, x: 1000 }))
            .where(eq(diningTables.id, TABLE_2)),
        ),
      "dining_tables_today_x_ck",
    ],
    [
      "a today's table with no shape",
      () =>
        inTx((tx) =>
          tx
            .update(diningTables)
            .set(todaySet({ ...PLACED, shape: null }))
            .where(eq(diningTables.id, TABLE_2)),
        ),
      "dining_tables_today_placement_ck",
    ],
    [
      "a merged table that was turned 20",
      async () => {
        const joinId = await inTx(async (tx) => {
          const [j] = await tx
            .insert(tableMerges)
            .values({ zoneId: ZONE, seats: 2 })
            .returning({ id: tableMerges.id });
          return j!.id;
        });
        return inTx((tx) =>
          tx
            .update(diningTables)
            .set({
              onFloor: true,
              mergeId: joinId,
              mergeBeforeX: 1,
              mergeBeforeY: 1,
              mergeBeforeRotation: 20,
            })
            .where(eq(diningTables.id, TABLE_2)),
        );
      },
      "dining_tables_merge_before_rotation_ck",
    ],
    [
      "a merged table that stood at x 1000",
      async () => {
        const joinId = await inTx(async (tx) => {
          const [j] = await tx
            .insert(tableMerges)
            .values({ zoneId: ZONE, seats: 2 })
            .returning({ id: tableMerges.id });
          return j!.id;
        });
        return inTx((tx) =>
          tx
            .update(diningTables)
            .set({
              onFloor: true,
              mergeId: joinId,
              mergeBeforeX: 1000,
              mergeBeforeY: 1,
              mergeBeforeRotation: 0,
            })
            .where(eq(diningTables.id, TABLE_2)),
        );
      },
      "dining_tables_merge_before_x_ck",
    ],
  ] as const)("refuses %s", async (_name, write, constraint) => {
    const error = await captureError(write);
    expect(checkFailed(error, constraint)).toBe(true);
  });

  it("round-trips a plan, reset rows, today's rows and the new columns", async () => {
    const masterId = await inTx(async (tx) => {
      const [row] = await tx
        .insert(floorPlanTables)
        .values({ ...GOOD_MASTER_TABLE, label: "T1", shortName: "Tm1", fixed: true })
        .returning({ id: floorPlanTables.id });
      return row!.id;
    });
    await inTx(async (tx) => {
      await tx
        .update(diningTables)
        .set({ planTableId: masterId })
        .where(eq(diningTables.id, TABLE_1));
      await tx.insert(floorResetTables).values({
        zoneId: ZONE,
        tableId: TABLE_1,
        label: "T1",
        shortName: "Tm1",
        seats: 4,
        fixed: true,
        ...PLACED,
      });
      await tx
        .insert(floorResetTables)
        .values({ zoneId: ZONE, tableId: null, label: "T5", ...NO_PLACE, pending: true });
      await tx
        .update(floorZones)
        .set({ todayBusinessDay: "2026-10-08", todayRevision: 3 })
        .where(eq(floorZones.id, ZONE));
      await tx
        .update(diningTables)
        .set(todaySet({ seats: 4, ...PLACED }))
        .where(eq(diningTables.id, TABLE_1));
      await tx.insert(parties).values({ openedBy: PERSON, tableNames: ["T1", "T2"] });
    });
    const [plan] = await inTx((tx) => tx.select().from(floorPlans).where(eq(floorPlans.id, PLAN)));
    expect(plan).toEqual({
      id: PLAN,
      zoneId: ZONE,
      setId: SET,
      revision: 0,
      savedAt: "2026-10-08T10:00:00Z",
    });
    const [master] = await inTx((tx) =>
      tx.select().from(floorPlanTables).where(eq(floorPlanTables.id, masterId)),
    );
    expect(master).toEqual({
      partOfTableId: null,
      id: masterId,
      zoneId: ZONE,
      label: "T1",
      shortName: "Tm1",
      seats: 4,
      fixed: true,
    });
    const live = await inTx((tx) =>
      tx
        .select({
          id: diningTables.id,
          planTableId: diningTables.planTableId,
        })
        .from(diningTables)
        .where(eq(diningTables.zoneId, ZONE))
        .orderBy(diningTables.label),
    );
    expect(live).toEqual([
      { id: TABLE_1, planTableId: masterId },
      { id: TABLE_2, planTableId: null },
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
        shortName: "Tm1",
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
      tx
        .select({
          zoneId: floorZones.id,
          businessDay: floorZones.todayBusinessDay,
          revision: floorZones.todayRevision,
          setId: floorZones.todaySetId,
          layoutRevision: floorZones.todayLayoutRevision,
          occurrence: floorZones.todayOccurrence,
        })
        .from(floorZones)
        .where(and(isNotNull(floorZones.todayBusinessDay), eq(floorZones.id, ZONE))),
    );
    expect(todayZone).toMatchObject({ businessDay: "2026-10-08", revision: 3 });
    const [todayTable] = await inTx((tx) =>
      tx
        .select(todayColumns)
        .from(diningTables)
        .where(and(eq(diningTables.onFloor, true), eq(diningTables.id, TABLE_1))),
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

  async function insertCounterTables(): Promise<{
    long: string;
    counter3: string;
    counter4: string;
    counter5: string;
  }> {
    return inTx(async (tx) => {
      const rows = await tx
        .insert(floorPlanTables)
        .values([
          { ...GOOD_MASTER_TABLE, label: "Long table", seats: 10 },
          { zoneId: ZONE, label: "Counter 3", seats: 2 },
          { zoneId: ZONE, label: "Counter 4", seats: 6 },
          { zoneId: ZONE, label: "Counter 5", seats: 4 },
        ])
        .returning({ id: floorPlanTables.id });
      return {
        long: rows[0]!.id,
        counter3: rows[1]!.id,
        counter4: rows[2]!.id,
        counter5: rows[3]!.id,
      };
    });
  }

  async function insertCounterResetRows(): Promise<{
    long: string;
    counter3: string;
    counter4: string;
    counter5: string;
  }> {
    return inTx(async (tx) => {
      const rows = await tx
        .insert(floorResetTables)
        .values([
          { zoneId: ZONE, label: "Long table", seats: 10, ...PLACED },
          { zoneId: ZONE, label: "Counter 3", seats: 2, ...NO_PLACE },
          { zoneId: ZONE, label: "Counter 4", seats: 6, ...NO_PLACE },
          { zoneId: ZONE, label: "Counter 5", seats: 4, ...NO_PLACE },
        ])
        .returning({ id: floorResetTables.id });
      return {
        long: rows[0]!.id,
        counter3: rows[1]!.id,
        counter4: rows[2]!.id,
        counter5: rows[3]!.id,
      };
    });
  }

  it("keeps a master table in one joined table only", async () => {
    const t = await insertCounterTables();
    await inTx((tx) =>
      tx
        .update(floorPlanTables)
        .set({ partOfTableId: t.long })
        .where(inArray(floorPlanTables.id, [t.counter3, t.counter4, t.counter5])),
    );
    const bar = await inTx(async (tx) => {
      const [row] = await tx
        .insert(floorPlanTables)
        .values({ ...GOOD_MASTER_TABLE, label: "Bar" })
        .returning({ id: floorPlanTables.id });
      return row!.id;
    });
    await inTx((tx) =>
      tx
        .update(floorPlanTables)
        .set({ partOfTableId: bar })
        .where(eq(floorPlanTables.id, t.counter4)),
    );
    const [member] = await inTx((tx) =>
      tx
        .select({ parent: floorPlanTables.partOfTableId })
        .from(floorPlanTables)
        .where(eq(floorPlanTables.id, t.counter4)),
    );
    expect(member).toEqual({ parent: bar });
  });

  it("refuses a master table joined to itself", async () => {
    const t = await insertCounterTables();
    const error = await captureError(() =>
      inTx((tx) =>
        tx
          .update(floorPlanTables)
          .set({ partOfTableId: t.long })
          .where(eq(floorPlanTables.id, t.long)),
      ),
    );
    expect(checkFailed(error, "floor_plan_tables_part_of_not_self_ck")).toBe(true);
  });

  it("refuses deleting a master table other members name", async () => {
    const t = await insertCounterTables();
    await inTx((tx) =>
      tx
        .update(floorPlanTables)
        .set({ partOfTableId: t.long })
        .where(inArray(floorPlanTables.id, [t.counter3, t.counter4, t.counter5])),
    );
    for (const doomed of [t.long]) {
      const error = await captureError(() =>
        inTx((tx) => tx.delete(floorPlanTables).where(eq(floorPlanTables.id, doomed))),
      );
      expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    }
    const tables = await inTx((tx) => tx.select({ id: floorPlanTables.id }).from(floorPlanTables));
    expect(tables.map((row) => row.id).sort()).toEqual(
      [t.long, t.counter3, t.counter4, t.counter5].sort(),
    );
    const parts = await inTx((tx) =>
      tx
        .select({
          joinedTableId: floorPlanTables.partOfTableId,
          partTableId: floorPlanTables.id,
        })
        .from(floorPlanTables)
        .where(isNotNull(floorPlanTables.partOfTableId)),
    );
    expect(parts).toHaveLength(3);
  });

  it("keeps a reset row in one copied joined table only", async () => {
    const t = await insertCounterResetRows();
    await inTx((tx) =>
      tx
        .update(floorResetTables)
        .set({ partOfResetTableId: t.long })
        .where(inArray(floorResetTables.id, [t.counter3, t.counter4, t.counter5])),
    );
    const bar = await inTx(async (tx) => {
      const [row] = await tx
        .insert(floorResetTables)
        .values({ zoneId: ZONE, label: "Bar", ...PLACED })
        .returning({ id: floorResetTables.id });
      return row!.id;
    });
    await inTx((tx) =>
      tx
        .update(floorResetTables)
        .set({ partOfResetTableId: bar })
        .where(eq(floorResetTables.id, t.counter4)),
    );
    const [member] = await inTx((tx) =>
      tx
        .select({ parent: floorResetTables.partOfResetTableId })
        .from(floorResetTables)
        .where(eq(floorResetTables.id, t.counter4)),
    );
    expect(member).toEqual({ parent: bar });
  });

  it("refuses a reset row joined to itself", async () => {
    const t = await insertCounterResetRows();
    const error = await captureError(() =>
      inTx((tx) =>
        tx
          .update(floorResetTables)
          .set({ partOfResetTableId: t.long })
          .where(eq(floorResetTables.id, t.long)),
      ),
    );
    expect(checkFailed(error, "floor_reset_tables_part_of_not_self_ck")).toBe(true);
  });

  it("refuses deleting a reset row other members name", async () => {
    const t = await insertCounterResetRows();
    await inTx((tx) =>
      tx
        .update(floorResetTables)
        .set({ partOfResetTableId: t.long })
        .where(inArray(floorResetTables.id, [t.counter3, t.counter4, t.counter5])),
    );
    for (const doomed of [t.long]) {
      const error = await captureError(() =>
        inTx((tx) => tx.delete(floorResetTables).where(eq(floorResetTables.id, doomed))),
      );
      expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    }
    const rows = await inTx((tx) => tx.select({ id: floorResetTables.id }).from(floorResetTables));
    expect(rows.map((row) => row.id).sort()).toEqual(
      [t.long, t.counter3, t.counter4, t.counter5].sort(),
    );
    const parts = await inTx((tx) =>
      tx.select().from(floorResetTables).where(isNotNull(floorResetTables.partOfResetTableId)),
    );
    expect(parts).toHaveLength(3);
  });

  it("round-trips a joined table's parts in the plan and in the reset copy", async () => {
    const plan = await insertCounterTables();
    const reset = await insertCounterResetRows();
    await inTx(async (tx) => {
      await tx
        .update(floorPlanTables)
        .set({ partOfTableId: plan.long })
        .where(inArray(floorPlanTables.id, [plan.counter3, plan.counter4, plan.counter5]));
      await tx
        .update(floorResetTables)
        .set({ partOfResetTableId: reset.long })
        .where(inArray(floorResetTables.id, [reset.counter3, reset.counter4, reset.counter5]));
    });
    const planParts = await inTx((tx) =>
      tx
        .select({
          joinedTableId: floorPlanTables.partOfTableId,
          partTableId: floorPlanTables.id,
          label: floorPlanTables.label,
        })
        .from(floorPlanTables)
        .where(isNotNull(floorPlanTables.partOfTableId))
        .orderBy(floorPlanTables.label),
    );
    expect(planParts).toEqual([
      { joinedTableId: plan.long, partTableId: plan.counter3, label: "Counter 3" },
      { joinedTableId: plan.long, partTableId: plan.counter4, label: "Counter 4" },
      { joinedTableId: plan.long, partTableId: plan.counter5, label: "Counter 5" },
    ]);
    const resetParts = await inTx((tx) =>
      tx
        .select({
          joinedResetTableId: floorResetTables.partOfResetTableId,
          partResetTableId: floorResetTables.id,
          label: floorResetTables.label,
        })
        .from(floorResetTables)
        .where(isNotNull(floorResetTables.partOfResetTableId))
        .orderBy(floorResetTables.label),
    );
    expect(resetParts).toEqual([
      { joinedResetTableId: reset.long, partResetTableId: reset.counter3, label: "Counter 3" },
      { joinedResetTableId: reset.long, partResetTableId: reset.counter4, label: "Counter 4" },
      { joinedResetTableId: reset.long, partResetTableId: reset.counter5, label: "Counter 5" },
    ]);
  });

  it("keeps one size per master table in a layout, 1 to 99 squares each way", async () => {
    const t = await insertCounterTables();
    await inTx((tx) =>
      tx
        .insert(floorPlanPlacements)
        .values({ planId: PLAN, planTableId: t.counter3, width: 2, height: 2 }),
    );
    const duplicate = await captureError(() =>
      inTx((tx) =>
        tx
          .insert(floorPlanPlacements)
          .values({ planId: PLAN, planTableId: t.counter3, width: 3, height: 3 }),
      ),
    );
    expect(
      refusalOn(duplicate, UNIQUE_VIOLATION, {
        table: "floor_plan_placements",
        columns: ["plan_id", "plan_table_id"],
      }),
    ).toBe(true);
    const narrow = await captureError(() =>
      inTx((tx) =>
        tx
          .insert(floorPlanPlacements)
          .values({ planId: PLAN, planTableId: t.counter4, width: 0, height: 2 }),
      ),
    );
    expect(checkFailed(narrow, "floor_plan_placements_width_ck")).toBe(true);
    const deep = await captureError(() =>
      inTx((tx) =>
        tx
          .insert(floorPlanPlacements)
          .values({ planId: PLAN, planTableId: t.counter4, width: 2, height: 100 }),
      ),
    );
    expect(checkFailed(deep, "floor_plan_placements_height_ck")).toBe(true);
    const sizes = await inTx((tx) => tx.select().from(floorPlanPlacements));
    expect(sizes).toHaveLength(1);
  });

  it("refuses deleting a master table that keeps a size", async () => {
    const t = await insertCounterTables();
    await inTx((tx) =>
      tx
        .insert(floorPlanPlacements)
        .values({ planId: PLAN, planTableId: t.counter3, width: 2, height: 2 }),
    );
    const error = await captureError(() =>
      inTx((tx) => tx.delete(floorPlanTables).where(eq(floorPlanTables.id, t.counter3))),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    const tables = await inTx((tx) => tx.select({ id: floorPlanTables.id }).from(floorPlanTables));
    expect(tables.map((row) => row.id).sort()).toEqual(
      [t.long, t.counter3, t.counter4, t.counter5].sort(),
    );
    const sizes = await inTx((tx) => tx.select().from(floorPlanPlacements));
    expect(sizes).toHaveLength(1);
  });

  it("round-trips a kept size", async () => {
    const plan = await insertCounterTables();
    await inTx(async (tx) => {
      await tx
        .insert(floorPlanPlacements)
        .values({ planId: PLAN, planTableId: plan.counter3, width: 2, height: 3 });
    });
    const sizes = await inTx((tx) =>
      tx
        .select({
          planTableId: floorPlanPlacements.planTableId,
          width: floorPlanPlacements.width,
          height: floorPlanPlacements.height,
        })
        .from(floorPlanPlacements),
    );
    expect(sizes).toEqual([{ planTableId: plan.counter3, width: 2, height: 3 }]);
  });

  it("has no saved joins: their four tables are gone", () => {
    const names = suite.db
      .all<{ name: string }>(
        sql`select name from sqlite_master where type = 'table' and name in ('floor_plan_joins', 'floor_plan_join_tables', 'floor_reset_joins', 'floor_reset_join_tables')`,
      )
      .map((row) => row.name);
    expect(names).toEqual([]);
  });

  it("keeps one placement per table in a layout", async () => {
    const tableId = await insertPlanTable("P1");
    await inTx((tx) =>
      tx.insert(floorPlanPlacements).values({ planId: PLAN, planTableId: tableId, ...PLACED }),
    );
    const error = await captureError(() =>
      inTx((tx) =>
        tx
          .insert(floorPlanPlacements)
          .values({ planId: PLAN, planTableId: tableId, ...PLACED, x: 30 }),
      ),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "floor_plan_placements",
        columns: ["plan_id", "plan_table_id"],
      }),
    ).toBe(true);
  });

  it("refuses a placement out of range", async () => {
    const tableId = await insertPlanTable("P1");
    const error = await captureError(() =>
      inTx((tx) =>
        tx
          .insert(floorPlanPlacements)
          .values({ planId: PLAN, planTableId: tableId, ...PLACED, x: 1000 }),
      ),
    );
    expect(checkFailed(error, "floor_plan_placements_x_ck")).toBe(true);
  });

  it("allows a zone a layout in each set", async () => {
    const lunch = await insertSet();
    const dinner = await insertSet();
    await inTx((tx) =>
      tx.insert(floorPlans).values([
        { zoneId: OTHER_ZONE, setId: lunch, savedAt: "2026-10-08T10:00:00Z" },
        { zoneId: OTHER_ZONE, setId: dinner, savedAt: "2026-10-08T10:00:00Z" },
      ]),
    );
    const error = await captureError(() =>
      inTx((tx) =>
        tx
          .insert(floorPlans)
          .values({ zoneId: OTHER_ZONE, setId: lunch, savedAt: "2026-10-08T11:00:00Z" }),
      ),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "floor_plans", columns: ["set_id", "zone_id"] }),
    ).toBe(true);
  });

  it("starts a reset row not ready to move", async () => {
    await inTx((tx) => tx.insert(floorResetTables).values({ zoneId: ZONE, label: "R1" }));
    const [row] = await inTx((tx) => tx.select().from(floorResetTables));
    expect(row!.readyToMove).toBe(false);
  });

  it("keeps a table's off-plan size in each layout", async () => {
    const lunch = await insertSet();
    const dinner = await insertSet();
    const [lunchPlan, dinnerPlan] = await inTx(async (tx) => {
      const rows = await tx
        .insert(floorPlans)
        .values([
          { zoneId: OTHER_ZONE, setId: lunch, savedAt: "2026-10-08T10:00:00Z" },
          { zoneId: OTHER_ZONE, setId: dinner, savedAt: "2026-10-08T10:00:00Z" },
        ])
        .returning({ id: floorPlans.id });
      return [rows[0]!.id, rows[1]!.id];
    });
    const tableId = await insertPlanTable("S1");
    await inTx((tx) =>
      tx.insert(floorPlanPlacements).values([
        { planId: lunchPlan, planTableId: tableId, width: 2, height: 2 },
        { planId: dinnerPlan, planTableId: tableId, width: 3, height: 3 },
      ]),
    );
    const error = await captureError(() =>
      inTx((tx) =>
        tx
          .insert(floorPlanPlacements)
          .values({ planId: lunchPlan, planTableId: tableId, width: 4, height: 4 }),
      ),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "floor_plan_placements",
        columns: ["plan_id", "plan_table_id"],
      }),
    ).toBe(true);
  });

  it("floor_plan_tables has no place columns and needs a zone", async () => {
    const columns = await suite.db.execute<{ name: string }>(
      sql`select name from pragma_table_info('floor_plan_tables')`,
    );
    const names = columns.rows.map((row) => row.name);
    for (const gone of ["plan_id", "x", "y", "width", "height", "shape", "rotation"]) {
      expect(names).not.toContain(gone);
    }
    expect(names).toContain("seats");
    const seats = await captureError(() =>
      insertMasterTable({ zoneId: ZONE, label: "Too many", seats: 1000 }),
    );
    expect(checkFailed(seats, "floor_plan_tables_seats_ck")).toBe(true);

    const zoneless = await captureError(() => insertMasterTable({ label: "Nowhere", seats: 4 }));
    expect(String((zoneless as Error).message)).toContain(
      "NOT NULL constraint failed: floor_plan_tables.zone_id",
    );
  });

  it("starts a today's zone at revision 0", async () => {
    const zone = await inTx(async (tx) => {
      const row = await seedZone(tx, { name: "Bar" });
      return row!.id;
    });
    await inTx((tx) =>
      tx.update(floorZones).set({ todayBusinessDay: "2026-10-08" }).where(eq(floorZones.id, zone)),
    );
    const [row] = await inTx((tx) =>
      tx
        .select({
          zoneId: floorZones.id,
          businessDay: floorZones.todayBusinessDay,
          revision: floorZones.todayRevision,
          setId: floorZones.todaySetId,
          layoutRevision: floorZones.todayLayoutRevision,
          occurrence: floorZones.todayOccurrence,
        })
        .from(floorZones)
        .where(and(isNotNull(floorZones.todayBusinessDay), eq(floorZones.id, zone))),
    );
    expect(row!.revision).toBe(0);
  });
});

describe("rangeCheck", () => {
  const render = (fragment: ReturnType<typeof rangeCheck>) =>
    new SQLiteSyncDialect().sqlToQuery(fragment).sql;

  it("writes whole-number bounds into the check as they are", () => {
    expect(render(rangeCheck(floorPlanPlacements.x, 0, 999))).toBe(
      '"floor_plan_placements"."x" is null or "floor_plan_placements"."x" between 0 and 999',
    );
  });

  it("refuses a bound that is not a whole number, since it is pasted into the SQL", () => {
    expect(() => rangeCheck(floorPlanPlacements.x, 0.5, 999)).toThrow(/whole/);
    expect(() => rangeCheck(floorPlanPlacements.x, 0, Number.NaN)).toThrow(/whole/);
    expect(() => rangeCheck(floorPlanPlacements.x, 0, "1) or (1" as unknown as number)).toThrow(
      /whole/,
    );
  });
});
