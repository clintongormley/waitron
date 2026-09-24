import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { CHECK_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { kitchenStations } from "./kitchen-stations.js";
import { locations, tenants } from "./tenants.js";

// What this suite proves is the column mapping, the threshold CHECK and the partial unique index.
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_A2 = "aaaaaaaa-0000-4000-8000-000000000002";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";

describe("kitchen_stations schema (columns, threshold CHECK, partial unique)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  beforeAll(async () => {
    await suite.db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await suite.db.insert(locations).values([
      { id: LOCATION_A, name: "Loc A", invoiceLocales: ["es"], operationDescription: "Hostelería" },
      {
        id: LOCATION_A2,
        name: "Loc A2",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
      { id: LOCATION_B, name: "Loc B", invoiceLocales: ["es"], operationDescription: "Hostelería" },
    ]);
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // Drizzle rather than raw SQL: `id` and `created_at` are `$defaultFn` columns a raw insert does
  // not fill.
  async function seedStation(location: string, name: string, isDefault = false): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(kitchenStations)
        .values({ locationId: location, name, isDefault })
        .returning({ id: kitchenStations.id });
      return row!.id;
    });
  }

  it("exposes every column through the Drizzle export, with the is_default and active defaults", async () => {
    const id = await seedStation(LOCATION_A, "Cocina");
    await inTx((tx) =>
      tx.update(kitchenStations).set({ displayOrder: 5 }).where(eq(kitchenStations.id, id)),
    );
    const [row] = await inTx((tx) =>
      tx.select().from(kitchenStations).where(eq(kitchenStations.id, id)),
    );
    expect(row!.displayOrder).toBe(5);
    expect(row!.name).toBe("Cocina");
    expect(row!.isDefault).toBe(false);
    expect(row!.active).toBe(true);
  });

  it("carries ordered timing thresholds with sane defaults (KDS order-timing alerts)", async () => {
    const id = await seedStation(LOCATION_A, "Timing station");
    const [row] = await inTx((tx) =>
      tx
        .select({
          w: kitchenStations.warmAfterMinutes,
          o: kitchenStations.overdueAfterMinutes,
          f: kitchenStations.forgottenAfterMinutes,
        })
        .from(kitchenStations)
        .where(eq(kitchenStations.id, id)),
    );
    expect(row).toMatchObject({ w: 5, o: 10, f: 15 });
    const e = await captureError(() =>
      inTx((tx) =>
        tx.update(kitchenStations).set({ warmAfterMinutes: 20 }).where(eq(kitchenStations.id, id)),
      ),
    );
    expect(isRefusal(e, CHECK_VIOLATION)).toBe(true);
    // SQLite names the constraint in the message when it has one.
    expect(engineErrorMessage(e)).toMatch(/kitchen_stations_thresholds_ordered/);
  });

  it("rejects a SECOND default station per location (the WHERE is_default partial unique)", async () => {
    // A non-default sibling and a default at another location are both accepted, so the refusal is
    // the partial predicate and not a plain unique.
    await seedStation(LOCATION_A, "Default one", true);
    await seedStation(LOCATION_A, "Non-default sibling", false);
    await seedStation(LOCATION_A2, "Default elsewhere", true);
    const e = await captureError(() => seedStation(LOCATION_A, "Default two", true));
    expect(isRefusal(e, UNIQUE_VIOLATION)).toBe(true);
  });

  it("the partial unique index is what blocks the second default (proof by deletion of the index)", async () => {
    // The index is recreated in a `finally` so every other case still meets it.
    const probeLocation = "aaaaaaaa-0000-4000-8000-000000000003";
    await suite.db.insert(locations).values({
      id: probeLocation,
      name: "Loc A3",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await seedStation(probeLocation, "Probe default", true);
    const [index] = suite.db.all<{ sql: string }>(
      sql`select sql from sqlite_master where type = 'index' and name = 'kitchen_stations_default_key'`,
    );
    expect(index?.sql).toContain("is_default");
    try {
      suite.db.run(sql`drop index kitchen_stations_default_key`);
      await seedStation(probeLocation, "Probe default two", true);
      const [counted] = await inTx((tx) =>
        tx
          .select({ n: sql<number>`cast(count(*) as int)` })
          .from(kitchenStations)
          .where(
            and(eq(kitchenStations.locationId, probeLocation), eq(kitchenStations.isDefault, true)),
          ),
      );
      expect(counted!.n).toBe(2);
    } finally {
      // The probe rows go first: recreating the index over their two defaults would fail.
      await suite.db.delete(kitchenStations).where(eq(kitchenStations.locationId, probeLocation));
      suite.db.run(sql.raw(index!.sql));
    }
  });
});
