import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { catalogues, CORE_MIGRATIONS, products, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS, productUnits } from "@waitron/catalogue";
import { hashPin, IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { mountUnitsApi } from "./units-api.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS],
});
const log: Logger = () => {};
let cookie: string;

beforeEach(async () => {
  // Child-to-parent order: product_units RESTRICTs deletes of the units and products it references.
  await suite.db.execute(sql`delete from product_units`);
  await suite.db.execute(sql`delete from units`);
  await suite.db.execute(sql`delete from products`);
  await suite.db.execute(sql`delete from catalogues`);
  await suite.db.execute(sql`delete from management_sessions`);
  await suite.db.execute(sql`delete from persons`);
  await seedTenant(suite.db);
  await withTransaction(suite.db, async (tx) => {
    // Every fixture insert goes through the table definition so each column's `$defaultFn` runs.
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Manager", pinHash: hashPin("1234"), role: "manager" })
      .returning({ id: persons.id });
    const session = await startManagementSession(tx, { personId: person!.id });
    cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
  });
});

/** A catalogue to hang fixture products off. */
async function seedCatalogue(tx: Transaction): Promise<string> {
  const [menu] = await tx
    .insert(catalogues)
    .values({ name: "Menu" })
    .returning({ id: catalogues.id });
  return menu!.id;
}

/** One product in `catalogueId`, measured in `unitId`. `unitPrice` is a count of whole cents. */
async function seedProduct(
  tx: Transaction,
  catalogueId: string,
  name: string,
  unitId: string,
): Promise<string> {
  const [product] = await tx
    .insert(products)
    .values({ catalogueId, name, pricingUnit: "each", unitPrice: 100, vatClass: "general" })
    .returning({ id: products.id });
  await tx.insert(productUnits).values({ productId: product!.id, unitId });
  return product!.id;
}

function app() {
  const app = new Hono();
  mountUnitsApi(app, { db: suite.db, venueLocale: "en-GB" }, log);
  return app;
}

async function send(method: string, path: string, body?: unknown) {
  return app().request(path, {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("unit management routes", () => {
  it("returns canonical objects from create and update and lists the collection", async () => {
    const created = await send("POST", "/management-api/units", {
      name: { en: "portion" },
      precision: 2,
      abbreviation: { en: "pt" },
    });
    expect(created.status).toBe(201);
    const unit = (await created.json()) as {
      id: string;
      name: Record<string, string>;
      precision: number;
      abbreviation: Record<string, string>;
    };
    expect(unit).toEqual({
      id: expect.any(String),
      name: { en: "portion" },
      precision: 2,
      abbreviation: { en: "pt" },
    });
    expect(await (await send("GET", "/management-api/units")).json()).toEqual([unit]);

    const updated = await send("PATCH", `/management-api/units/${unit.id}`, {
      name: { en: "serving" },
      precision: 1,
      abbreviation: { en: "sv" },
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      ...unit,
      name: { en: "serving" },
      precision: 1,
      abbreviation: { en: "sv" },
    });

    const unchanged = await send("PATCH", `/management-api/units/${unit.id}`, {});
    expect(unchanged.status).toBe(200);
    expect(await unchanged.json()).toEqual({
      ...unit,
      name: { en: "serving" },
      precision: 1,
      abbreviation: { en: "sv" },
    });
    expect((await send("DELETE", `/management-api/units/${unit.id}`)).status).toBe(204);
  });

  it("rejects a create with no abbreviation object", async () => {
    const response = await send("POST", "/management-api/units", {
      name: { en: "Litre" },
      precision: 3,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "abbreviation" } },
    });
  });

  it("accepts and returns the abbreviation", async () => {
    const response = await send("POST", "/management-api/units", {
      name: { en: "Litre" },
      precision: 3,
      abbreviation: { en: "l" },
    });
    expect(response.status).toBe(201);
    expect((await response.json()).abbreviation).toEqual({ en: "l" });
  });

  it.each([
    [{ name: { en: "cup" }, precision: 4, abbreviation: { en: "c" } }, "unit.precision_invalid"],
    [
      { name: { fr: "tasse" }, precision: 0, abbreviation: { en: "c" } },
      "content.translation_required",
    ],
    [{ name: "cup", precision: 0, abbreviation: { en: "c" } }, "management.request_invalid"],
    [
      { name: { en: "cup" }, precision: "0", abbreviation: { en: "c" } },
      "management.request_invalid",
    ],
    [{ name: { en: "cup" }, precision: 0, abbreviation: "c" }, "management.request_invalid"],
  ] as const)("rejects invalid create body %j", async (body, code) => {
    const response = await send("POST", "/management-api/units", body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code } });
  });

  it("reports the abbreviation field when the abbreviation shape is wrong", async () => {
    const response = await send("POST", "/management-api/units", {
      name: { en: "cup" },
      precision: 0,
      abbreviation: "c",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "abbreviation" } },
    });
  });

  it("requires a session", async () => {
    const response = await app().request("/management-api/units");
    expect(response.status).toBe(401);
  });

  it("reassigns selected products to another unit and returns the shrunk list", async () => {
    const from = (await (
      await send("POST", "/management-api/units", {
        name: { en: "each" },
        precision: 0,
        abbreviation: { en: "ea" },
      })
    ).json()) as { id: string };
    const to = (await (
      await send("POST", "/management-api/units", {
        name: { en: "kg" },
        precision: 3,
        abbreviation: { en: "kg" },
      })
    ).json()) as { id: string };

    const [a, b] = await withTransaction(suite.db, async (tx) => {
      const menuId = await seedCatalogue(tx);
      const ids: string[] = [];
      for (const name of ["A", "B"]) {
        ids.push(await seedProduct(tx, menuId, name, from.id));
      }
      return ids;
    });

    const response = await send("POST", `/management-api/units/${from.id}/products/reassign`, {
      productIds: [a],
      unitId: to.id,
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { id: string }[]).map((p) => p.id)).toEqual([b]);
  });

  it("GET /management-api/units/:id/products returns the products using the unit", async () => {
    const unit = (await (
      await send("POST", "/management-api/units", {
        name: { en: "each" },
        precision: 0,
        abbreviation: { en: "ea" },
      })
    ).json()) as { id: string };

    const p1 = await withTransaction(suite.db, async (tx) =>
      seedProduct(tx, await seedCatalogue(tx), "A", unit.id),
    );

    const res = await send("GET", `/management-api/units/${unit.id}/products`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: p1, name: "A", available: true }]);
  });

  it("GET /management-api/units/:id/products 404s an unknown unit", async () => {
    const res = await send("GET", `/management-api/units/${crypto.randomUUID()}/products`);
    expect(res.status).toBe(404);
  });

  it("GET /management-api/units/:id/products requires a session", async () => {
    const unit = (await (
      await send("POST", "/management-api/units", {
        name: { en: "each" },
        precision: 0,
        abbreviation: { en: "ea" },
      })
    ).json()) as { id: string };
    const res = await app().request(`/management-api/units/${unit.id}/products`);
    expect(res.status).toBe(401);
  });

  it("reassign accepts a null target and clears the products' unit", async () => {
    const unit = (await (
      await send("POST", "/management-api/units", {
        name: { en: "kg" },
        precision: 3,
        abbreviation: { en: "kg" },
      })
    ).json()) as { id: string };

    const p1 = await withTransaction(suite.db, async (tx) =>
      seedProduct(tx, await seedCatalogue(tx), "A", unit.id),
    );

    const res = await send("POST", `/management-api/units/${unit.id}/products/reassign`, {
      productIds: [p1],
      unitId: null,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("rejects a reassign with a malformed body", async () => {
    const unit = (await (
      await send("POST", "/management-api/units", {
        name: { en: "each" },
        precision: 0,
        abbreviation: { en: "ea" },
      })
    ).json()) as { id: string };
    const response = await send("POST", `/management-api/units/${unit.id}/products/reassign`, {
      productIds: "nope",
      unitId: unit.id,
    });
    expect(response.status).toBe(400);
  });

  it("GET /management-api/units/:id returns the one unit, and 404s an unknown one", async () => {
    const created = (await (
      await send("POST", "/management-api/units", {
        name: { en: "portion" },
        precision: 1,
        abbreviation: { en: "pt" },
      })
    ).json()) as { id: string };
    const res = await send("GET", `/management-api/units/${created.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: created.id,
      name: { en: "portion" },
      precision: 1,
      abbreviation: { en: "pt" },
    });
    const unknown = await send("GET", `/management-api/units/${crypto.randomUUID()}`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "unit.not_found" } });
  });

  it("400s a unit id that is not a uuid, naming it", async () => {
    const res = await send("GET", "/management-api/units/not-a-uuid");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "shared.invalid_id", params: { kind: "UnitId", value: "not-a-uuid" } },
    });
  });

  it("rejects a reassign whose target unitId is neither null nor a uuid", async () => {
    const unit = (await (
      await send("POST", "/management-api/units", {
        name: { en: "each" },
        precision: 0,
        abbreviation: { en: "ea" },
      })
    ).json()) as { id: string };
    const p1 = await withTransaction(suite.db, async (tx) =>
      seedProduct(tx, await seedCatalogue(tx), "A", unit.id),
    );
    for (const unitId of ["not-a-uuid", 7, undefined]) {
      const response = await send("POST", `/management-api/units/${unit.id}/products/reassign`, {
        productIds: [p1],
        unitId,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "unitId" } },
      });
    }
    const still = await send("GET", `/management-api/units/${unit.id}/products`);
    expect(((await still.json()) as { id: string }[]).map((p) => p.id)).toEqual([p1]);
  });

  it("rejects an update whose precision is not a number, leaving the unit unchanged", async () => {
    const unit = (await (
      await send("POST", "/management-api/units", {
        name: { en: "kg" },
        precision: 3,
        abbreviation: { en: "kg" },
      })
    ).json()) as { id: string };
    const response = await send("PATCH", `/management-api/units/${unit.id}`, { precision: "2" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "precision" } },
    });
    expect(
      (
        (await (await send("GET", `/management-api/units/${unit.id}`)).json()) as {
          precision: number;
        }
      ).precision,
    ).toBe(3);
  });
});
