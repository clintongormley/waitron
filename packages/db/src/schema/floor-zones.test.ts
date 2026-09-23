import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { isPgError } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { diningTables } from "./dining-tables.js";
import { floorZones } from "./floor-zones.js";
import { workingOrderLines } from "./orders.js";
import { locations, tenants } from "./tenants.js";

// LOSS, from the storage swap: every write below used to run as the non-owner `app_user` against a
// real PostgreSQL, so the suite also established that the deployment role held the grants these
// columns needed. SQLite has no roles and no grants, so nothing here says anything about who may
// write. What survives is the schema half: the Drizzle export's column mapping, and the
// `dining_tables.zone_id` foreign key.
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ABSENT_ZONE = "99999999-9999-4999-8999-999999999999";

describe("floor_zones schema (columns and the dining_tables.zone_id FK)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  beforeAll(async () => {
    await suite.db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await suite.db.insert(locations).values({
      id: LOCATION_A,
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // Through the Drizzle builder, not a raw `insert`: `id` and `created_at` both take their value
  // from a `$defaultFn` that Drizzle applies CLIENT-side, so a raw statement reaches neither and
  // the row is refused `NOT NULL constraint failed: floor_zones.id`.
  async function seedZone(location: string, name: string): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(floorZones)
        .values({ locationId: location, name })
        .returning({ id: floorZones.id });
      return row!.id;
    });
  }

  it("maps display_order and name through the Drizzle export", async () => {
    const id = await seedZone(LOCATION_A, "Comedor");
    await inTx((tx) => tx.update(floorZones).set({ displayOrder: 5 }).where(eq(floorZones.id, id)));
    const [row] = await inTx((tx) => tx.select().from(floorZones).where(eq(floorZones.id, id)));
    expect(row!.displayOrder).toBe(5);
    expect(row!.name).toBe("Comedor");
  });

  it("dining_tables.zone_id round-trips, and its FK rejects an absent zone", async () => {
    const [table] = await inTx((tx) =>
      tx
        .insert(diningTables)
        .values({ locationId: LOCATION_A, label: "T-zone" })
        .returning({ id: diningTables.id }),
    );
    const tableId = table!.id;
    const zoneId = await seedZone(LOCATION_A, "Salon");
    await inTx((tx) => tx.update(diningTables).set({ zoneId }).where(eq(diningTables.id, tableId)));
    const [row] = await inTx((tx) =>
      tx
        .select({ zoneId: diningTables.zoneId })
        .from(diningTables)
        .where(eq(diningTables.id, tableId)),
    );
    expect(row!.zoneId).toBe(zoneId);

    // The FK rejects a zone_id that names no row at all.
    const eRandom = await captureError(() =>
      inTx((tx) =>
        tx.update(diningTables).set({ zoneId: ABSENT_ZONE }).where(eq(diningTables.id, tableId)),
      ),
    );
    expect(isPgError(eRandom, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("working_order_lines.served_at is readable and writable", async () => {
    await inTx((tx) => tx.select({ servedAt: workingOrderLines.servedAt }).from(workingOrderLines));
    const updated = await inTx(async (tx) =>
      tx.all<{ served_at: string | null }>(
        sql`update working_order_lines set served_at = ${new Date().toISOString()}
              where id = ${ABSENT_ZONE} returning served_at`,
      ),
    );
    expect(updated).toHaveLength(0); // no such line — but the column and the UPDATE both resolved
  });
});
