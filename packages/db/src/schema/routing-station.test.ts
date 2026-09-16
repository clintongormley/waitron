import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTransaction } from "../tenancy.js";
import { catalogues, categories, products } from "./catalogue.js";
import { locations, tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: what this proves is the hand-written
// (station_id) → kitchen_stations FKs on categories/products, written and read as the
// non-owner `app_user` — the deployment role, which PGlite (every connection a superuser) cannot be.
// The suite retains the reads and writes under app_user's grants.
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const RANDOM_UUID = "99999999-9999-4999-8999-999999999999";

let categoryA = "";
let productA = "";
let stationA = "";

describe("categories.station_id / products.station_id routing FKs (app-writable)", () => {
  const suite = useTemplateDb({ template: "core", resetPerTest: false });

  beforeAll(async () => {
    const admin = suite.admin;
    await admin
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await admin.insert(locations).values([
      {
        id: LOCATION_A,
        name: "Loc A",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
    ]);
    stationA = await seedStation(LOCATION_A);
    const [catA] = await admin
      .insert(categories)
      .values({ name: { es: "Comida" } })
      .returning({ id: categories.id });
    categoryA = catA!.id;
    const [cat] = await admin
      .insert(catalogues)
      .values({ name: "Deli A" })
      .returning({ id: catalogues.id });
    const [prodA] = await admin
      .insert(products)
      .values({
        catalogueId: cat!.id,
        name: "Café solo",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      })
      .returning({ id: products.id });
    productA = prodA!.id;
  });

  async function seedStation(location: string): Promise<string> {
    const r = await suite.admin.execute<{ id: string }>(
      sql`insert into kitchen_stations (location_id, name, is_default) values (${location}, 'Cocina', true) returning id`,
    );
    return r.rows[0]!.id;
  }

  function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.admin, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  it("lets the app role route a category to an own-tenant station and rejects a missing one", async () => {
    // The app role writes and reads back station_id (the additive column, under categories' existing
    // grant) …
    await asApp((tx) =>
      tx.execute(sql`update categories set station_id = ${stationA} where id = ${categoryA}`),
    );
    const [row] = await asApp((tx) =>
      tx
        .execute<{ station_id: string | null }>(
          sql`select station_id from categories where id = ${categoryA}`,
        )
        .then((r) => r.rows),
    );
    expect(row!.station_id).toBe(stationA);

    // … a station that names no row at all is refused (FK existence) …
    const eRandom = await captureError(() =>
      asApp((tx) =>
        tx.execute(sql`update categories set station_id = ${RANDOM_UUID} where id = ${categoryA}`),
      ),
    );
    expect(pgErrorCode(eRandom)).toBe("23503");
  });

  it("lets the app role route a product to an own-tenant station and rejects a missing one", async () => {
    await asApp((tx) =>
      tx.execute(sql`update products set station_id = ${stationA} where id = ${productA}`),
    );
    const [row] = await asApp((tx) =>
      tx
        .execute<{ station_id: string | null }>(
          sql`select station_id from products where id = ${productA}`,
        )
        .then((r) => r.rows),
    );
    expect(row!.station_id).toBe(stationA);

    const eRandom = await captureError(() =>
      asApp((tx) =>
        tx.execute(sql`update products set station_id = ${RANDOM_UUID} where id = ${productA}`),
      ),
    );
    expect(pgErrorCode(eRandom)).toBe("23503");
  });
});
