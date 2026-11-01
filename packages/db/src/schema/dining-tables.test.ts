import { eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { venueLocationId } from "../venue.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { isRefusal } from "../unique-violation.js";
import { NOT_NULL_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { shortNameColumns } from "../table-short-names.js";
import { diningTables } from "./dining-tables.js";
import { floorZones } from "./floor-zones.js";
import { locations } from "./tenants.js";

let LOCATION_A: string;
const LOCATION_B = "aaaaaaaa-0000-4000-8000-000000000002";

describe("dining_tables columns", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeEach(async () => {
    const db = suite.db;
    await seedVenue(db, {
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    LOCATION_A = await venueLocationId(db);
    await db.insert(locations).values({
      id: LOCATION_B,
      name: "Loc B",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    });
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // Through the Drizzle builder rather than raw SQL: `dining_tables.id` takes its value from a
  // `$defaultFn` that Drizzle applies CLIENT-side, so a raw `insert` never reaches it and the row
  // is refused `NOT NULL constraint failed: dining_tables.id`.
  async function seedTable(location: string, label: string, shortName?: string): Promise<string> {
    return inTx(async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: location, name: label })
        .returning({ id: floorZones.id });
      const [row] = await tx
        .insert(diningTables)
        .values({
          locationId: location,
          label,
          zoneId: zone!.id,
          ...(shortName === undefined ? {} : shortNameColumns(shortName)),
        })
        .returning({ id: diningTables.id });
      return row!.id;
    });
  }

  it("accepts a dining table in its zone", async () => {
    const id = await seedTable(LOCATION_A, "T-zoned");
    const [row] = await inTx((tx) => tx.select().from(diningTables).where(eq(diningTables.id, id)));
    expect(row).toMatchObject({
      id,
      locationId: LOCATION_A,
      label: "T-zoned",
      zoneId: expect.any(String),
      planTableId: null,
    });
  });

  it("refuses a dining table with no zone", async () => {
    const id = randomUUID();
    const error = await captureError(() =>
      inTx(async (tx) => {
        tx.run(
          sql`insert into dining_tables (id, location_id, label, created_at) values (${id}, ${LOCATION_A}, ${"T-no-zone"}, ${"2026-10-11T10:00:00.000Z"})`,
        );
      }),
    );
    expect(isRefusal(error, NOT_NULL_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe("NOT NULL constraint failed: dining_tables.zone_id");
  });

  it("has only the columns today's plan needs", () => {
    const columns = suite.db.all<{ name: string }>(
      sql`select name from pragma_table_info('dining_tables')`,
    );
    expect(columns.map((column) => column.name).sort()).toEqual([
      "created_at",
      "id",
      "label",
      "location_id",
      "needs_clearing_since",
      "plan_table_id",
      "short_name",
      "short_name_key",
      "zone_id",
    ]);
  });

  it("refuses two tables of one venue whose short names differ only in case", async () => {
    await seedTable(LOCATION_A, "Terrace 1", "T1");
    const error = await captureError(() => seedTable(LOCATION_A, "Tower 1", "t1"));
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe(
      "UNIQUE constraint failed: dining_tables.location_id, dining_tables.short_name_key",
    );
  });

  it("a key a writer did not fold is not refused", async () => {
    await seedTable(LOCATION_A, "Terrace 1", "t1");
    const id = await inTx(async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: LOCATION_A, name: "Tower" })
        .returning({ id: floorZones.id });
      const [row] = await tx
        .insert(diningTables)
        .values({
          locationId: LOCATION_A,
          label: "Tower 1",
          zoneId: zone!.id,
          shortName: "T1",
          shortNameKey: "T1",
        })
        .returning({ id: diningTables.id });
      return row!.id;
    });
    const [row] = await inTx((tx) =>
      tx
        .select({ shortNameKey: diningTables.shortNameKey })
        .from(diningTables)
        .where(eq(diningTables.id, id)),
    );
    expect(row).toEqual({ shortNameKey: "T1" });
  });

  it("lets two venues use one short name, and any number of tables have none", async () => {
    await seedTable(LOCATION_A, "Garden 1", "G1");
    const other = await seedTable(LOCATION_B, "Garden 1", "G1");
    const first = await seedTable(LOCATION_A, "Unnamed 1");
    const second = await seedTable(LOCATION_A, "Unnamed 2");
    const rows = await inTx((tx) =>
      tx
        .select({ id: diningTables.id, shortName: diningTables.shortName })
        .from(diningTables)
        .where(inArray(diningTables.id, [other, first, second])),
    );
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.id === other)?.shortName).toBe("G1");
    expect(rows.filter((row) => row.shortName === null)).toHaveLength(2);
  });

  it("keeps no venue-made status table and no trigger that cleared one", () => {
    const leftovers = suite.db.all<{ name: string }>(
      sql`select name from sqlite_master where name in ('table_service_statuses', 'parties_clear_table_status')`,
    );
    expect(leftovers).toEqual([]);
  });

  it("gives a dining table no pointer to a bill", () => {
    const columns = suite.db.all<{ name: string }>(
      sql`select name from pragma_table_info('dining_tables')`,
    );
    expect(columns.map((column) => column.name)).not.toContain("tab_id");
    // Control: the read sees the table's columns at all.
    expect(columns.map((column) => column.name)).toContain("needs_clearing_since");
  });
});
