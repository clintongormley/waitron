import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { catalogues, categories, products } from "./catalogue.js";
import { locations, tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: what this proves is the hand-written
// (tenant_id, station_id) → kitchen_stations FKs on categories/products, written and read as the
// non-owner `app_user` — the deployment role, which PGlite (every connection a superuser) cannot be.
// The FKs themselves would fire on either target — a candidate for the PGlite tier once the suites
// are re-tagged.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const RANDOM_UUID = "99999999-9999-4999-8999-999999999999";

let categoryA = "";
let productA = "";
let stationA = "";
let stationB = "";

describe("categories.station_id / products.station_id routing FKs (tenant-consistent, app-writable)", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    const admin = suite.admin;
    await admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    await admin.insert(locations).values([
      {
        id: LOCATION_A,
        tenantId: TENANT_A,
        name: "Loc A",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
      {
        id: LOCATION_B,
        tenantId: TENANT_B,
        name: "Loc B",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
    ]);
    stationA = await seedStation(TENANT_A, LOCATION_A);
    stationB = await seedStation(TENANT_B, LOCATION_B);
    const [catA] = await admin
      .insert(categories)
      .values({ tenantId: TENANT_A, name: "Comida" })
      .returning({ id: categories.id });
    categoryA = catA!.id;
    const [cat] = await admin
      .insert(catalogues)
      .values({ tenantId: TENANT_A, name: "Deli A" })
      .returning({ id: catalogues.id });
    const [prodA] = await admin
      .insert(products)
      .values({
        tenantId: TENANT_A,
        catalogueId: cat!.id,
        descriptions: { es: "Café solo" },
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      })
      .returning({ id: products.id });
    productA = prodA!.id;
  });

  async function seedStation(tenant: string, location: string): Promise<string> {
    const r = await suite.admin.execute<{ id: string }>(
      sql`insert into kitchen_stations (tenant_id, location_id, name, is_default)
          values (${tenant}, ${location}, 'Cocina', true) returning id`,
    );
    return r.rows[0]!.id;
  }

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenant, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  it("lets the app role route a category to an own-tenant station and rejects a foreign or missing one", async () => {
    // The app role writes and reads back station_id (the additive column, under categories' existing
    // grant) …
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update categories set station_id = ${stationA} where id = ${categoryA}`),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ station_id: string | null }>(
          sql`select station_id from categories where id = ${categoryA}`,
        )
        .then((r) => r.rows),
    );
    expect(row!.station_id).toBe(stationA);

    // … a station that names no row at all is refused (FK existence) …
    const eRandom = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(sql`update categories set station_id = ${RANDOM_UUID} where id = ${categoryA}`),
      ),
    );
    expect(pgErrorCode(eRandom)).toBe("23503");

    // … and the case a SINGLE-column FK would let through: a station that EXISTS but belongs to another
    // tenant. The composite (tenant_id, station_id) requires a kitchen_stations row with (TENANT_A,
    // B's id), which does not exist — so it is 23503, proving the FK is tenant-consistent.
    const eForeign = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(sql`update categories set station_id = ${stationB} where id = ${categoryA}`),
      ),
    );
    expect(pgErrorCode(eForeign)).toBe("23503");
  });

  it("lets the app role route a product to an own-tenant station and rejects a foreign or missing one", async () => {
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update products set station_id = ${stationA} where id = ${productA}`),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ station_id: string | null }>(
          sql`select station_id from products where id = ${productA}`,
        )
        .then((r) => r.rows),
    );
    expect(row!.station_id).toBe(stationA);

    const eRandom = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(sql`update products set station_id = ${RANDOM_UUID} where id = ${productA}`),
      ),
    );
    expect(pgErrorCode(eRandom)).toBe("23503");

    const eForeign = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(sql`update products set station_id = ${stationB} where id = ${productA}`),
      ),
    );
    expect(pgErrorCode(eForeign)).toBe("23503");
  });
});
