import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { stillJoinedPart } from "./joined-parts.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { diningTables } from "./schema/dining-tables.js";
import { floorResetTableParts, floorResetTables } from "./schema/floor-plans.js";
import { floorZones } from "./schema/floor-zones.js";
import { locations } from "./schema/tenants.js";
import { seedTenant } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";

const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
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
const WAITING_PART_ROW = "dddddddd-0000-4000-8000-000000000006";

describe("still joined part", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeEach(async () => {
    await seedTenant(suite.db);
    await suite.db.insert(locations).values({
      id: LOCATION,
      name: "Room",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await suite.db.insert(floorZones).values({ id: ZONE, locationId: LOCATION, name: "Bar" });
    await suite.db.insert(diningTables).values([
      { id: LONG, locationId: LOCATION, zoneId: ZONE, label: "Long table" },
      { id: COUNTER_3, locationId: LOCATION, zoneId: ZONE, label: "Counter 3" },
      { id: COUNTER_4, locationId: LOCATION, zoneId: ZONE, label: "Counter 4" },
      { id: COUNTER_5, locationId: LOCATION, zoneId: ZONE, label: "Counter 5" },
      { id: PLAIN, locationId: LOCATION, zoneId: ZONE, label: "Plain" },
    ]);
    await suite.db.insert(floorResetTables).values([
      { id: LONG_ROW, zoneId: ZONE, tableId: LONG, label: "Long table", seats: 10 },
      { id: COUNTER_3_ROW, zoneId: ZONE, tableId: COUNTER_3, label: "Counter 3", seats: 2 },
      { id: COUNTER_4_ROW, zoneId: ZONE, tableId: COUNTER_4, label: "Counter 4", seats: 6 },
      { id: COUNTER_5_ROW, zoneId: ZONE, tableId: COUNTER_5, label: "Counter 5", seats: 4 },
      { id: PLAIN_ROW, zoneId: ZONE, tableId: PLAIN, label: "Plain", seats: 4 },
    ]);
    await suite.db.insert(floorResetTableParts).values([
      { joinedResetTableId: LONG_ROW, partResetTableId: COUNTER_3_ROW },
      { joinedResetTableId: LONG_ROW, partResetTableId: COUNTER_4_ROW },
      { joinedResetTableId: LONG_ROW, partResetTableId: COUNTER_5_ROW },
    ]);
  });

  async function read() {
    const rows = await suite.db.all<{ id: string; joined: number | null }>(
      sql`select dt.id, ${stillJoinedPart(sql`dt.id`)} as joined from dining_tables dt order by dt.id`,
    );
    return Object.fromEntries(rows.map((row) => [row.id, row.joined]));
  }

  it("names each applied part of a joined table with a live table, and nothing else", async () => {
    expect(await read()).toEqual({
      [LONG]: 0,
      [COUNTER_3]: 1,
      [COUNTER_4]: 1,
      [COUNTER_5]: 1,
      [PLAIN]: 0,
    });
  });

  it("names no part whose reset row still waits to be applied", async () => {
    await suite.db
      .update(floorResetTables)
      .set({ pending: true, placed: false })
      .where(eq(floorResetTables.id, COUNTER_3_ROW));
    expect((await read())[COUNTER_3]).toBe(0);
  });

  it("names a part whose reset row waits only for its name, already placed", async () => {
    await suite.db
      .update(floorResetTables)
      .set({ pending: true, placed: true })
      .where(eq(floorResetTables.id, COUNTER_3_ROW));
    expect((await read())[COUNTER_3]).toBe(1);
  });

  it("reads a part reset row with no live table as naming nothing", async () => {
    await suite.db.insert(floorResetTables).values({
      id: WAITING_PART_ROW,
      zoneId: ZONE,
      tableId: null,
      label: "Counter 6",
      seats: 2,
    });
    await suite.db
      .insert(floorResetTableParts)
      .values({ joinedResetTableId: LONG_ROW, partResetTableId: WAITING_PART_ROW });
    expect(await read()).toEqual({
      [LONG]: 0,
      [COUNTER_3]: 1,
      [COUNTER_4]: 1,
      [COUNTER_5]: 1,
      [PLAIN]: 0,
    });
  });

  it("names no part while the joined table's reset row has no live table", async () => {
    await suite.db
      .update(floorResetTables)
      .set({ tableId: null, pending: true })
      .where(eq(floorResetTables.id, LONG_ROW));
    expect(await read()).toEqual({
      [LONG]: 0,
      [COUNTER_3]: 0,
      [COUNTER_4]: 0,
      [COUNTER_5]: 0,
      [PLAIN]: 0,
    });
  });
});
