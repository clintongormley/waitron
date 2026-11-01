import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { seedVenue } from "../testing/seed.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { venueLocationId } from "../venue.js";
import { diningTables } from "./dining-tables.js";
import { floorZones } from "./floor-zones.js";
import { workingOrderLines } from "./orders.js";
import { locations } from "./tenants.js";

// What this suite proves is the schema half: the Drizzle export's column mapping, and the
// `dining_tables.zone_id` foreign key.
let LOCATION_A: string;
const ABSENT_ZONE = "99999999-9999-4999-8999-999999999999";

describe("floor_zones schema (columns and the dining_tables.zone_id FK)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  beforeAll(async () => {
    await seedVenue(suite.db, {
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    LOCATION_A = await venueLocationId(suite.db);
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
    const id = await seedZone(LOCATION_A, "Dining room");
    await inTx((tx) => tx.update(floorZones).set({ displayOrder: 5 }).where(eq(floorZones.id, id)));
    const [row] = await inTx((tx) => tx.select().from(floorZones).where(eq(floorZones.id, id)));
    expect(row!.displayOrder).toBe(5);
    expect(row!.name).toBe("Dining room");
  });

  it("dining_tables.zone_id round-trips, and its FK rejects an absent zone", async () => {
    const initialZoneId = await seedZone(LOCATION_A, "Initial");
    const [table] = await inTx((tx) =>
      tx
        .insert(diningTables)
        .values({ locationId: LOCATION_A, label: "T-zone", zoneId: initialZoneId })
        .returning({ id: diningTables.id }),
    );
    const tableId = table!.id;
    const zoneId = await seedZone(LOCATION_A, "Lounge");
    await inTx((tx) => tx.update(diningTables).set({ zoneId }).where(eq(diningTables.id, tableId)));
    const [row] = await inTx((tx) =>
      tx
        .select({ zoneId: diningTables.zoneId })
        .from(diningTables)
        .where(eq(diningTables.id, tableId)),
    );
    expect(row!.zoneId).toBe(zoneId);

    const eRandom = await captureError(() =>
      inTx((tx) =>
        tx.update(diningTables).set({ zoneId: ABSENT_ZONE }).where(eq(diningTables.id, tableId)),
      ),
    );
    expect(isRefusal(eRandom, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("reuses a deleted zone name with a new id", async () => {
    const oldId = await seedZone(LOCATION_A, "Reusable");
    await inTx((tx) =>
      tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, oldId)),
    );
    const replacementId = await seedZone(LOCATION_A, "Reusable");
    expect(replacementId).not.toBe(oldId);
    expect(await suite.db.select().from(floorZones).where(eq(floorZones.id, oldId))).toEqual([
      expect.objectContaining({ id: oldId, name: "Reusable", active: false }),
    ]);
  });

  it("still refuses two live names in one location", async () => {
    await seedZone(LOCATION_A, "Live duplicate");
    await expect(seedZone(LOCATION_A, "Live duplicate")).rejects.toThrow(
      "UNIQUE constraint failed:",
    );
  });

  it("allows equal names in separate locations", async () => {
    const [other] = await suite.db
      .insert(locations)
      .values({
        name: "Loc B",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      })
      .returning({ id: locations.id });
    const first = await seedZone(LOCATION_A, "Shared");
    const second = await seedZone(other!.id, "Shared");
    expect(second).not.toBe(first);
    expect(
      await suite.db
        .select({ name: floorZones.name })
        .from(floorZones)
        .where(eq(floorZones.name, "Shared")),
    ).toEqual([{ name: "Shared" }, { name: "Shared" }]);
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
