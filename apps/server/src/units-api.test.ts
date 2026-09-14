import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { asAppUser, CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { hashPin, IDENTITY_MIGRATIONS, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { mountUnitsApi } from "./units-api.js";

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS],
});
const log: Logger = () => {};
let tenantId: string;
let cookie: string;

beforeEach(async () => {
  // Child-to-parent order: product_units RESTRICTs deletes of the units and products it references.
  await suite.db.execute(sql`delete from product_units`);
  await suite.db.execute(sql`delete from units`);
  await suite.db.execute(sql`delete from products`);
  await suite.db.execute(sql`delete from catalogues`);
  await suite.db.execute(sql`delete from management_sessions`);
  await suite.db.execute(sql`delete from persons`);
  tenantId = await seedTenant(suite.db);
  await withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const person = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'Manager', ${hashPin("1234")}, 'manager') returning id`);
    const session = await startManagementSession(tx, { tenantId, personId: person.rows[0]!.id });
    cookie = `${MANAGEMENT_COOKIE}=${session.id}`;
  });
});

function app() {
  const app = new Hono();
  mountUnitsApi(app, { db: suite.db, cfg: { tenantId }, venueLocale: "en-GB" }, log);
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

    const [a, b] = await withTenant(suite.db, tenantId, async (tx) => {
      const menu = await tx.execute<{ id: string }>(sql`
        insert into catalogues (tenant_id, name) values (${tenantId}, 'Menu') returning id`);
      const ids: string[] = [];
      for (const name of ["A", "B"]) {
        const product = await tx.execute<{ id: string }>(sql`
          insert into products (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
          values (${tenantId}, ${menu.rows[0]!.id}, ${JSON.stringify({ en: name })}::jsonb, 'each', '1', 'general')
          returning id`);
        await tx.execute(sql`
          insert into product_units (tenant_id, product_id, unit_id)
          values (${tenantId}, ${product.rows[0]!.id}, ${from.id})`);
        ids.push(product.rows[0]!.id);
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

  it("does not expose or mutate another tenant's unit through either manager session", async () => {
    const otherTenantId = await seedTenant(suite.db);
    const other = await withTenant(suite.db, otherTenantId, async (tx) => {
      await asAppUser(tx);
      const unit = await tx.execute<{ id: string }>(sql`
        insert into units (tenant_id, name, abbreviation, precision)
        values (${otherTenantId}, '{"en":"foreign"}'::jsonb, '{"en":"f"}'::jsonb, 0) returning id`);
      const person = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${otherTenantId}, 'Other manager', ${hashPin("5678")}, 'manager') returning id`);
      const session = await startManagementSession(tx, {
        tenantId: otherTenantId,
        personId: person.rows[0]!.id,
      });
      return { unitId: unit.rows[0]!.id, cookie: `${MANAGEMENT_COOKIE}=${session.id}` };
    });

    const foreignSession = await app().request("/management-api/units", {
      headers: { cookie: other.cookie },
    });
    expect(foreignSession.status).toBe(403);
    expect(await foreignSession.json()).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
    expect((await send("GET", `/management-api/units/${other.unitId}`)).status).toBe(404);
    expect(
      (await send("PATCH", `/management-api/units/${other.unitId}`, { precision: 1 })).status,
    ).toBe(404);
    expect((await send("DELETE", `/management-api/units/${other.unitId}`)).status).toBe(404);
  });
});
