import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { isRefusal } from "../unique-violation.js";
import { NOT_NULL_VIOLATION } from "../sql-state.js";
import { diningTables } from "./dining-tables.js";
import { floorZones } from "./floor-zones.js";
import { locations, tenants } from "./tenants.js";

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";

describe("dining_tables columns", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeAll(async () => {
    const db = suite.db;
    await db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await db.insert(locations).values([
      {
        id: LOCATION_A,
        name: "Loc A",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
    ]);
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // Through the Drizzle builder rather than raw SQL: `dining_tables.id` takes its value from a
  // `$defaultFn` that Drizzle applies CLIENT-side, so a raw `insert` never reaches it and the row
  // is refused `NOT NULL constraint failed: dining_tables.id`.
  async function seedTable(location: string, label: string): Promise<string> {
    return inTx(async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: location, name: label })
        .returning({ id: floorZones.id });
      const [row] = await tx
        .insert(diningTables)
        .values({ locationId: location, label, zoneId: zone!.id })
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
      "status_id",
      "zone_id",
    ]);
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
