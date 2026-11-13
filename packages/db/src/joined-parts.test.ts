import { LEFT_MERGE } from "./floor-today-columns.js";
import { todaySet } from "@waitron/db";
import { eq, inArray, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { needsMoving } from "./joined-parts.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { diningTables } from "./schema/dining-tables.js";
import { floorResetTables, tableMerges } from "./schema/floor-plans.js";
import { seedVenue, seedZone } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";

const ZONE = "bbbbbbbb-0000-4000-8000-000000000001";
const LONG = "cccccccc-0000-4000-8000-000000000001";
const COUNTER_3 = "cccccccc-0000-4000-8000-000000000003";
const COUNTER_4 = "cccccccc-0000-4000-8000-000000000004";
const COUNTER_5 = "cccccccc-0000-4000-8000-000000000005";
const PLAIN = "cccccccc-0000-4000-8000-000000000009";
const LONG_ROW = "dddddddd-0000-4000-8000-000000000001";
const COUNTER_3_ROW = "dddddddd-0000-4000-8000-000000000003";
const COUNTER_4_ROW = "dddddddd-0000-4000-8000-000000000004";
const COUNTER_5_ROW = "dddddddd-0000-4000-8000-000000000005";
const PLAIN_ROW = "dddddddd-0000-4000-8000-000000000009";

type Db = ReturnType<typeof useVenueDb>["db"];

/** Long table joined from Counter 3, 4 and 5 in today's copy, beside a Plain table. */
async function seedJoinedToday(db: Db): Promise<void> {
  await seedVenue(db, {
    name: "Room",
    invoiceLocales: ["es"],
    operationDescription: "Hostelería",
  });
  await seedZone(db, { id: ZONE, name: "Bar" });
  await db.insert(diningTables).values([
    { id: LONG, zoneId: ZONE, label: "Long table" },
    { id: COUNTER_3, zoneId: ZONE, label: "Counter 3" },
    { id: COUNTER_4, zoneId: ZONE, label: "Counter 4" },
    { id: COUNTER_5, zoneId: ZONE, label: "Counter 5" },
    { id: PLAIN, zoneId: ZONE, label: "Plain" },
  ]);
  await db.insert(floorResetTables).values([
    { id: LONG_ROW, zoneId: ZONE, tableId: LONG, label: "Long table", seats: 10 },
    { id: COUNTER_3_ROW, zoneId: ZONE, tableId: COUNTER_3, label: "Counter 3", seats: 2 },
    { id: COUNTER_4_ROW, zoneId: ZONE, tableId: COUNTER_4, label: "Counter 4", seats: 6 },
    { id: COUNTER_5_ROW, zoneId: ZONE, tableId: COUNTER_5, label: "Counter 5", seats: 4 },
    { id: PLAIN_ROW, zoneId: ZONE, tableId: PLAIN, label: "Plain", seats: 4 },
  ]);
  await db
    .update(floorResetTables)
    .set({ partOfResetTableId: LONG_ROW })
    .where(inArray(floorResetTables.id, [COUNTER_3_ROW, COUNTER_4_ROW, COUNTER_5_ROW]));
}

describe("needs moving", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  const place = { x: 10, y: 10, width: 8, height: 8, shape: "rect" as const, rotation: 0 };

  beforeEach(async () => {
    await seedJoinedToday(suite.db);
    await suite.db
      .update(floorResetTables)
      .set({ ...place, pending: true, readyToMove: true })
      .where(eq(floorResetTables.id, PLAIN_ROW));
    await suite.db
      .update(diningTables)
      .set(todaySet({ seats: 4, ...place }))
      .where(eq(diningTables.id, PLAIN));
  });

  async function plain(): Promise<number | null> {
    const rows = await suite.db.all<{ moving: number | null }>(
      sql`select ${needsMoving(sql`dt.id`)} as moving from dining_tables dt where dt.id = ${PLAIN}`,
    );
    return rows[0]!.moving;
  }

  const target = (values: Partial<typeof floorResetTables.$inferInsert>) =>
    suite.db.update(floorResetTables).set(values).where(eq(floorResetTables.id, PLAIN_ROW));
  const today = (values: Partial<import("@waitron/db").TodayRow>) =>
    suite.db.update(diningTables).set(todaySet(values)).where(eq(diningTables.id, PLAIN));

  it("is false for a marked table standing exactly at its row's place", async () => {
    expect(await plain()).toBe(0);
  });

  it.each([
    ["x", { x: 11 }],
    ["y", { y: 11 }],
    ["width", { width: 9 }],
    ["height", { height: 9 }],
    ["shape", { shape: "round" as const }],
    ["rotation", { rotation: 15 }],
    ["into store", { x: null, y: null, width: null, height: null, shape: null, rotation: null }],
  ])("is true when the row's %s differs", async (_, values) => {
    await target(values);
    expect(await plain()).toBe(1);
  });

  it("is true in a merge", async () => {
    const [join] = await suite.db
      .insert(tableMerges)
      .values({ zoneId: ZONE, seats: 8 })
      .returning({ id: tableMerges.id });
    await suite.db
      .update(diningTables)
      .set({ mergeId: join!.id, mergeBeforeX: 0, mergeBeforeY: 0, mergeBeforeRotation: 0 })
      .where(eq(diningTables.id, PLAIN));
    expect(await plain()).toBe(1);
    await suite.db.update(diningTables).set(LEFT_MERGE).where(eq(diningTables.id, PLAIN));
    expect(await plain()).toBe(0);
  });

  it("is false when the row is not marked, the table is taken off, or not drawn", async () => {
    await target({ x: 11 });
    expect(await plain()).toBe(1);
    await target({ readyToMove: false });
    expect(await plain()).toBe(0);
    await target({ readyToMove: true });
    await today({ takenOff: true });
    expect(await plain()).toBe(0);
    await today({
      takenOff: false,
      x: null,
      y: null,
      width: null,
      height: null,
      shape: null,
      rotation: null,
    });
    expect(await plain()).toBe(0);
  });
});
