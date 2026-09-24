import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { UNIQUE_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { catalogues } from "./catalogue.js";
import { locationCatalogues } from "./location-catalogues.js";
import { locations, tenants } from "./tenants.js";

// What this suite proves is the column mapping and the composite primary key.
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";

describe("location_catalogues schema (multi-menu accessibility map — PK + FKs)", () => {
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

  // An additional menu in the location's menu list, beyond its default. The Drizzle builder rather
  // than raw SQL: `catalogues.id` and its `created_at` are `$defaultFn` columns applied CLIENT-side.
  async function seedCatalogue(name: string): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx.insert(catalogues).values({ name }).returning({ id: catalogues.id });
      return row!.id;
    });
  }

  async function seedMembership(location: string, catalogue: string): Promise<void> {
    await inTx((tx) =>
      tx.insert(locationCatalogues).values({ locationId: location, catalogueId: catalogue }),
    );
  }

  it("maps every column through the Drizzle export and detaches by DELETE … RETURNING", async () => {
    const catalogue = await seedCatalogue("Menú de tarde");
    await seedMembership(LOCATION_A, catalogue);
    const [row] = await inTx((tx) =>
      tx.select().from(locationCatalogues).where(eq(locationCatalogues.catalogueId, catalogue)),
    );
    expect(row!.locationId).toBe(LOCATION_A);
    expect(row!.catalogueId).toBe(catalogue);
    // A membership row is REMOVED via DELETE — detach.
    const deleted = await inTx((tx) =>
      tx
        .delete(locationCatalogues)
        .where(
          and(
            eq(locationCatalogues.locationId, LOCATION_A),
            eq(locationCatalogues.catalogueId, catalogue),
          ),
        )
        .returning({ catalogueId: locationCatalogues.catalogueId }),
    );
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.catalogueId).toBe(catalogue);
  });

  it("the primary key rejects a duplicate (location_id, catalogue_id) membership", async () => {
    const catalogue = await seedCatalogue("Carta de vinos");
    await seedMembership(LOCATION_A, catalogue);
    const e = await captureError(() => seedMembership(LOCATION_A, catalogue));
    // PostgreSQL folded a primary-key collision into `23505` with every other unique index; SQLite
    // reports it under its own result code, which is why the class is a list (`../sql-state.ts`).
    expect(isRefusal(e, UNIQUE_VIOLATION)).toBe(true);
  });
});
