import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { catalogues, categories, products } from "./catalogue.js";
import { kitchenStations } from "./kitchen-stations.js";
import { locations, tenants } from "./tenants.js";

// What this proves is the hand-written (station_id) → kitchen_stations foreign keys on
// categories/products.
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const RANDOM_UUID = "99999999-9999-4999-8999-999999999999";

let categoryA = "";
let productA = "";
let stationA = "";

describe("categories.station_id / products.station_id routing FKs", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

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
    const [station] = await db
      .insert(kitchenStations)
      .values({ locationId: LOCATION_A, name: "Cocina", isDefault: true })
      .returning({ id: kitchenStations.id });
    stationA = station!.id;
    const [catA] = await db
      .insert(categories)
      .values({ name: { es: "Comida" } })
      .returning({ id: categories.id });
    categoryA = catA!.id;
    const [cat] = await db
      .insert(catalogues)
      .values({ name: "Deli A" })
      .returning({ id: catalogues.id });
    const [prodA] = await db
      .insert(products)
      .values({
        catalogueId: cat!.id,
        name: "Café solo",
        pricingUnit: "each",
        unitPrice: 100,
        vatClass: "general",
      })
      .returning({ id: products.id });
    productA = prodA!.id;
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  it("routes a category to a station and rejects a missing one", async () => {
    await inTx((tx) =>
      tx.update(categories).set({ stationId: stationA }).where(eq(categories.id, categoryA)),
    );
    const [row] = await inTx((tx) =>
      tx
        .select({ stationId: categories.stationId })
        .from(categories)
        .where(eq(categories.id, categoryA)),
    );
    expect(row!.stationId).toBe(stationA);

    // … a station that names no row at all is refused (FK existence) …
    const eRandom = await captureError(() =>
      inTx((tx) =>
        tx.update(categories).set({ stationId: RANDOM_UUID }).where(eq(categories.id, categoryA)),
      ),
    );
    expect(isRefusal(eRandom, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("routes a product to a station and rejects a missing one", async () => {
    await inTx((tx) =>
      tx.update(products).set({ stationId: stationA }).where(eq(products.id, productA)),
    );
    const [row] = await inTx((tx) =>
      tx.select({ stationId: products.stationId }).from(products).where(eq(products.id, productA)),
    );
    expect(row!.stationId).toBe(stationA);

    const eRandom = await captureError(() =>
      inTx((tx) =>
        tx.update(products).set({ stationId: RANDOM_UUID }).where(eq(products.id, productA)),
      ),
    );
    expect(isRefusal(eRandom, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});
