import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { inArray, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, products, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTaxpayer } from "@waitron/db/testing/seed.js";
import { createExtraList, createUnit, writeProductModifiers } from "@waitron/menu";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { mountUnitsApi } from "./units-api.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
const log: Logger = () => {};
let cookie: string;

beforeEach(async () => {
  await suite.db.execute(sql`delete from extra_list_items`);
  await suite.db.execute(sql`delete from extra_lists`);
  await suite.db.execute(sql`delete from products`);
  await suite.db.execute(sql`delete from units`);
  await suite.db.execute(sql`delete from menus`);
  await suite.db.execute(sql`delete from dashboard_sessions`);
  await suite.db.execute(sql`delete from persons`);
  await seedTaxpayer(suite.db);
  await withTransaction(suite.db, async (tx) => {
    // Every fixture insert goes through the table definition so each column's `$defaultFn` runs.
    const [person] = await seedPersons(tx, {
      displayName: "Manager",
      pinHash: fixturePinHash("1234"),
      role: "manager",
    });
    const session = await startManagementSession(tx, { method: "password", personId: person!.id });
    cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
  });
});

/** One product in `menuId`, measured in `unitId`. `unitPrice` is a count of whole cents. */
async function seedProduct(tx: Transaction, name: string, unitId: string): Promise<string> {
  const [product] = await tx
    .insert(products)
    .values({ name, unitPrice: 100, vatClass: "general" })
    .returning({ id: products.id });
  await tx
    .update(products)
    .set({ unitId })
    .where(inArray(products.id, [product!.id]));
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
  it("reads the attached-extras dish count and refuses an unknown unit", async () => {
    const unit = await withTransaction(suite.db, async (tx) => {
      const made = await createUnit(
        tx,
        { staffName: "Portion", staffAbbreviation: "pt", name: {}, abbreviation: {}, precision: 0 },
        "en",
      );
      const dishId = await seedProduct(tx, "Burger", made.id);
      const sauceId = await seedProduct(tx, "Sauce", made.id);
      const list = await createExtraList(
        tx,
        { name: "Sauces", items: [{ productId: sauceId, portion: "1" }] },
        "en",
      );
      await writeProductModifiers(tx, dishId, [{ kind: "extras", id: list.id }]);
      return made;
    });
    const answer = await send("GET", `/management-api/units/${unit.id}/attached-extras-count`);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ dishCount: 1 });
    const missing = await send(
      "GET",
      "/management-api/units/00000000-0000-4000-8000-000000000000/attached-extras-count",
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "unit.not_found" } });
  });

  it("returns canonical objects from create and update and lists the collection", async () => {
    const created = await send("POST", "/management-api/units", {
      staffName: "Staff unit",
      staffAbbreviation: "su",
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
      hardwareUnit: null,
      staffName: "Staff unit",
      staffAbbreviation: "su",
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

  it("reads and writes a unit's measure switch", async () => {
    const created = await send("POST", "/management-api/units", {
      staffName: "Millilitre",
      staffAbbreviation: "ml",
      name: { en: "millilitre" },
      precision: 0,
      abbreviation: { en: "ml" },
      measure: true,
    });
    expect(created.status).toBe(201);
    const unit = (await created.json()) as { id: string; measure?: true };
    expect(unit.measure).toBe(true);
    expect(await (await send("GET", "/management-api/units")).json()).toEqual([unit]);

    const off = await send("PATCH", `/management-api/units/${unit.id}`, { measure: false });
    expect(off.status).toBe(200);
    expect(await off.json()).not.toHaveProperty("measure");

    const on = await send("PATCH", `/management-api/units/${unit.id}`, { measure: true });
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual(unit);
  });

  it.each([
    ["a string", "yes"],
    ["null", null],
  ])("rejects a measure switch given as %s", async (_label, measure) => {
    const response = await send("POST", "/management-api/units", {
      staffName: "Millilitre",
      staffAbbreviation: "ml",
      name: { en: "millilitre" },
      precision: 0,
      abbreviation: { en: "ml" },
      measure,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "measure" } },
    });
    expect(await (await send("GET", "/management-api/units")).json()).toEqual([]);
  });

  it.each([
    ["a string", "yes"],
    ["null", null],
  ])("rejects a measure switch change given as %s", async (_label, measure) => {
    const created = (await (
      await send("POST", "/management-api/units", {
        staffName: "Millilitre",
        staffAbbreviation: "ml",
        name: { en: "millilitre" },
        precision: 0,
        abbreviation: { en: "ml" },
        measure: true,
      })
    ).json()) as { id: string };
    const before = await (await send("GET", "/management-api/units")).json();
    const response = await send("PATCH", `/management-api/units/${created.id}`, {
      measure,
      precision: 2,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "measure" } },
    });
    expect(await (await send("GET", "/management-api/units")).json()).toEqual(before);
  });

  it("rejects a create with no abbreviation object", async () => {
    const response = await send("POST", "/management-api/units", {
      staffName: "Staff unit",
      staffAbbreviation: "su",
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
      staffName: "Staff unit",
      staffAbbreviation: "su",
      name: { en: "Litre" },
      precision: 3,
      abbreviation: { en: "l" },
    });
    expect(response.status).toBe(201);
    expect((await response.json()).abbreviation).toEqual({ en: "l" });
  });

  it.each([
    [
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "cup" },
        precision: 4,
        abbreviation: { en: "c" },
      },
      "unit.precision_invalid",
    ],
    [
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: "cup",
        precision: 0,
        abbreviation: { en: "c" },
      },
      "management.request_invalid",
    ],
    [
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "cup" },
        precision: "0",
        abbreviation: { en: "c" },
      },
      "management.request_invalid",
    ],
    [
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "cup" },
        precision: 0,
        abbreviation: "c",
      },
      "management.request_invalid",
    ],
  ] as const)("rejects invalid create body %j", async (body, code) => {
    const response = await send("POST", "/management-api/units", body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code } });
  });

  it.each([
    { name: { fr: "tasse" }, abbreviation: { en: "c" } },
    { name: { en: "cup" }, abbreviation: { fr: "t" } },
  ])(
    "keeps authored disabled translations on create, then refuses disabled edits: %j",
    async (maps) => {
      const response = await send("POST", "/management-api/units", {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        ...maps,
        precision: 0,
      });
      expect(response.status).toBe(201);
      const saved = await response.json();
      expect(saved).toEqual({
        hardwareUnit: null,
        id: expect.any(String),
        staffName: "Staff unit",
        staffAbbreviation: "su",
        ...maps,
        precision: 0,
      });
      const read = await send("GET", `/management-api/units/${saved.id}`);
      expect(await read.json()).toEqual(saved);
      const field = maps.name.fr ? "name" : "abbreviation";
      const refused = await send("PATCH", `/management-api/units/${saved.id}`, {
        [field]: { fr: "Changed" },
      });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({
        error: { code: "content.translation_invalid", params: {} },
      });
      expect(await (await send("GET", `/management-api/units/${saved.id}`)).json()).toEqual(saved);
    },
  );

  it("reports the abbreviation field when the abbreviation shape is wrong", async () => {
    const response = await send("POST", "/management-api/units", {
      staffName: "Staff unit",
      staffAbbreviation: "su",
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
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "each" },
        precision: 0,
        abbreviation: { en: "ea" },
      })
    ).json()) as { id: string };
    const to = (await (
      await send("POST", "/management-api/units", {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "kg" },
        precision: 3,
        abbreviation: { en: "kg" },
      })
    ).json()) as { id: string };

    const [a, b] = await withTransaction(suite.db, async (tx) => {
      const ids: string[] = [];
      for (const name of ["A", "B"]) {
        ids.push(await seedProduct(tx, name, from.id));
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
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "each" },
        precision: 0,
        abbreviation: { en: "ea" },
      })
    ).json()) as { id: string };

    const p1 = await withTransaction(suite.db, async (tx) => seedProduct(tx, "A", unit.id));

    const res = await send("GET", `/management-api/units/${unit.id}/products`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: p1, name: "A", active: true }]);
  });

  it("names an extra's list before a unit precision edit without blocking the edit", async () => {
    const unit = (await (
      await send("POST", "/management-api/units", {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "kilogram" },
        precision: 3,
        abbreviation: { en: "kg" },
      })
    ).json()) as { id: string };
    const { productId, listId } = await withTransaction(suite.db, async (tx) => {
      const productId = await seedProduct(tx, "Ham", unit.id);
      const list = await createExtraList(
        tx,
        { name: "Toppings", items: [{ productId, portion: "0.055", price: "0.01" }] },
        "en",
      );
      return { productId, listId: list.id };
    });

    const usage = await send("GET", `/management-api/units/${unit.id}/extra-usage`);
    expect(usage.status).toBe(200);
    expect(await usage.json()).toEqual([
      {
        productId,
        productName: "Ham",
        lists: [{ id: listId, name: "Toppings", menus: [] }],
      },
    ]);
    const changed = await send("PATCH", `/management-api/units/${unit.id}`, { precision: 2 });
    expect(changed.status).toBe(200);
    expect((await changed.json()).precision).toBe(2);
    const retained = await suite.db.execute(sql`select portion from extra_list_items`);
    expect(retained.rows[0]?.portion).toBe(55);
  });

  it("GET /management-api/units/:id/products 404s an unknown unit", async () => {
    const res = await send("GET", `/management-api/units/${crypto.randomUUID()}/products`);
    expect(res.status).toBe(404);
  });

  it("GET /management-api/units/:id/products requires a session", async () => {
    const unit = (await (
      await send("POST", "/management-api/units", {
        staffName: "Staff unit",
        staffAbbreviation: "su",
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
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "kg" },
        precision: 3,
        abbreviation: { en: "kg" },
      })
    ).json()) as { id: string };

    const p1 = await withTransaction(suite.db, async (tx) => seedProduct(tx, "A", unit.id));

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
        staffName: "Staff unit",
        staffAbbreviation: "su",
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
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "portion" },
        precision: 1,
        abbreviation: { en: "pt" },
      })
    ).json()) as { id: string };
    const res = await send("GET", `/management-api/units/${created.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      staffName: "Staff unit",
      staffAbbreviation: "su",
      id: created.id,
      hardwareUnit: null,
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
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "each" },
        precision: 0,
        abbreviation: { en: "ea" },
      })
    ).json()) as { id: string };
    const p1 = await withTransaction(suite.db, async (tx) => seedProduct(tx, "A", unit.id));
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

  it("answers a reassign to a target unit no row holds with 400, moving nothing", async () => {
    const unit = (await (
      await send("POST", "/management-api/units", {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "each" },
        precision: 0,
        abbreviation: { en: "ea" },
      })
    ).json()) as { id: string };
    const p1 = await withTransaction(suite.db, async (tx) => seedProduct(tx, "A", unit.id));
    const missing = randomUUID();
    const response = await send("POST", `/management-api/units/${unit.id}/products/reassign`, {
      productIds: [p1],
      unitId: missing,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "unit.target_not_found", params: { unitId: missing } },
    });
    const still = await send("GET", `/management-api/units/${unit.id}/products`);
    expect(((await still.json()) as { id: string }[]).map((p) => p.id)).toEqual([p1]);
  });

  it("answers a reassign from a unit the address names but no row holds with 404", async () => {
    const target = (await (
      await send("POST", "/management-api/units", {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "kg" },
        precision: 3,
        abbreviation: { en: "kg" },
      })
    ).json()) as { id: string };
    const p1 = await withTransaction(suite.db, async (tx) => seedProduct(tx, "A", target.id));
    const missing = randomUUID();
    const response = await send("POST", `/management-api/units/${missing}/products/reassign`, {
      productIds: [p1],
      unitId: target.id,
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "unit.not_found", params: { unitId: missing } },
    });
  });

  it("rejects an update whose precision is not a number, leaving the unit unchanged", async () => {
    const unit = (await (
      await send("POST", "/management-api/units", {
        staffName: "Staff unit",
        staffAbbreviation: "su",
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

it.each(["target", "each"])(
  "returns 409 and preserves a mixed active/archived reassignment to %s",
  async (destination) => {
    const makeUnit = async (name: string) =>
      (await (
        await send("POST", "/management-api/units", {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: name },
          precision: 0,
          abbreviation: { en: name },
        })
      ).json()) as { id: string };
    const source = await makeUnit("source");
    const target = await makeUnit("target");
    const [active, archived] = await withTransaction(suite.db, async (tx) => {
      const active = await seedProduct(tx, "Active", source.id);
      const archived = await seedProduct(tx, "Archived", source.id);
      await tx
        .update(products)
        .set({ active: false })
        .where(inArray(products.id, [archived]));
      return [active, archived];
    });
    const response = await send("POST", `/management-api/units/${source.id}/products/reassign`, {
      productIds: [active, archived],
      unitId: destination === "each" ? null : target.id,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "product.archived", params: { productId: archived } },
    });
    const rows = await suite.db
      .select({ productId: products.id, unitId: products.unitId })
      .from(products);
    expect(rows).toHaveLength(2);
    expect(Object.fromEntries(rows.map((row) => [row.productId, row.unitId]))).toEqual({
      [active!]: source.id,
      [archived!]: source.id,
    });
  },
);

describe("explicit staff identity at the unit API", () => {
  const input = {
    staffName: "Kilogram",
    staffAbbreviation: "kg",
    name: {},
    abbreviation: {},
    precision: 3,
  };
  it("round-trips explicit staff fields and empty translations", async () => {
    const created = await send("POST", "/management-api/units", input);
    expect(created.status).toBe(201);
    const unit = await created.json();
    expect(unit).toEqual({ ...input, id: expect.any(String), hardwareUnit: null });
    const patched = await send("PATCH", `/management-api/units/${unit.id}`, {
      staffName: "Masa",
      staffAbbreviation: "M",
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toEqual({ ...unit, staffName: "Masa", staffAbbreviation: "M" });
  });
  for (const field of ["staffName", "staffAbbreviation"] as const) {
    it.each([undefined, null, "", "  ", 42, "é".repeat(2049)])(
      `returns the exact invalid ${field} on create`,
      async (value) => {
        const response = await send("POST", "/management-api/units", { ...input, [field]: value });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: { code: "unit.invalid", params: { field } },
        });
      },
    );
  }
});
