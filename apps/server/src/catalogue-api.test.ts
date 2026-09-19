import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTransaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, startManagementSession } from "@waitron/identity";
import { CATALOGUE_MIGRATIONS, createExtraList, setProductOptionGroups } from "@waitron/catalogue";
import type { OptionList } from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Logger } from "./logger.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { createCourse, createStation } from "./kitchen.js";
import type { TillConfig } from "./till-config.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import "./errors.js";

// PGlite, not real Postgres: this suite proves the ROUTES — the request/response boundary, the body +
// id screens, the permission gate wiring — end to end in-process, the
// same way `till-api.test.ts` proves the till routes. The catalogue tables live in CORE_MIGRATIONS and
// the management session/persons in IDENTITY_MIGRATIONS, and every DB touch runs `withTransaction` +
// `asAppUser` exactly as production does. The gate-by-DELETION proof (removing `authorizeManager`
// turns the staff refusals green→red) and the option-group attach's by-id FK are
// the real-Postgres suite (`catalogue-api.pg.test.ts`); PGlite connects as a superuser holding every
// grant (CLAUDE.md §4).
const noopLog: Logger = () => {};

let locationId: string;
let managerCookie: string;
let staffCookie: string;

const suite = usePgliteDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    await seedLegacySellingUnits(db);
    // One location for the tenant, seeded as the owner (fixture setup like seedTenant) so
    // the location↔menu membership routes have a `:locationId` to act on. Minimal required columns only.
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (name, invoice_locales, operation_description)
      values ('Main', array['es-ES'], 'Venta') returning id`);
    locationId = loc.rows[0]!.id;
    // Seed a MANAGER (role `manager`, holds `person.manage`) and a STAFF person (role `staff`, holds
    // nothing) as the app role under the tenant, then mint a live management session for each so the
    // route tests can drive the gate through a real cookie. `pin_hash` is NOT NULL, so a value is
    // supplied even though these sessions are minted directly rather than via a PIN/password login.
    const { managerSid, staffSid } = await withTransaction(db, async (tx) => {
      await asAppUser(tx);
      const mgr = await tx.execute<{ id: string }>(sql`
        insert into persons (display_name, pin_hash, role)
        values ('The Manager', ${hashPin("1234")}, 'manager') returning id`);
      const stf = await tx.execute<{ id: string }>(sql`
        insert into persons (display_name, pin_hash, role)
        values ('The Clerk', ${hashPin("1234")}, 'staff') returning id`);
      const managerSession = await startManagementSession(tx, {
        personId: mgr.rows[0]!.id,
      });
      const staffSession = await startManagementSession(tx, {
        personId: stf.rows[0]!.id,
      });
      return { managerSid: managerSession.id, staffSid: staffSession.id };
    });
    managerCookie = `${MANAGEMENT_COOKIE}=${managerSid}`;
    staffCookie = `${MANAGEMENT_COOKIE}=${staffSid}`;
  },
});

/**
 * The venue the product editor's kitchen routing is checked against. Only `locationId` is read by
 * `setProductStation`/`setProductCourse`; the fiscal ids are shape-fillers, as they are in the other
 * route suites.
 */
function venueCfg(): TillConfig {
  return {
    tillId: brandTillId(crypto.randomUUID()),
    nodeId: brandNodeId("11111111-1111-4111-8111-111111111111"),
    seriesId: brandSeriesId(crypto.randomUUID()),
    locationId: brandLocationId(locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

function mountApp(venueLocale = "es-ES"): Hono {
  const app = new Hono();
  mountCatalogueApi(
    app,
    {
      db: suite.db,
      venueCfg: venueCfg(),
      venueLocale,
    },
    noopLog,
  );
  return app;
}

/** A live kitchen station and course of the seeded venue, as the app role. */
async function seedRouting(): Promise<{ stationId: string; courseId: string }> {
  return withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    const cfg = venueCfg();
    const station = await createStation(tx, cfg, { name: `Pass ${crypto.randomUUID()}` });
    const course = await createCourse(tx, cfg, { name: `Course ${crypto.randomUUID()}` });
    return { stationId: station.id, courseId: course.id };
  });
}

describe("content-language configuration", () => {
  beforeEach(async () => {
    await suite.db.execute(sql`delete from content_languages`);
  });

  it("starts from the configured site language and saves additional content languages", async () => {
    const app = mountApp("en-GB");
    const initial = await send(app, "GET", "/management-api/content-languages");
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({ defaultLanguage: "en", languages: ["en"] });
    const settings = { defaultLanguage: "en", languages: ["en", "fr", "ca"] };
    expect(
      (await send(app, "PUT", "/management-api/content-languages", { body: settings })).status,
    ).toBe(204);
    expect(await (await send(app, "GET", "/management-api/content-languages")).json()).toEqual(
      settings,
    );
  });

  it("exposes language choices to public content readers without a management session", async () => {
    const app = mountApp("en-GB");
    const response = await send(app, "GET", "/api/content-languages", { cookie: null });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ defaultLanguage: "en", languages: ["en"] });
  });

  it("requires a management session and refuses staff writes", async () => {
    const app = mountApp();
    expect(
      (await send(app, "GET", "/management-api/content-languages", { cookie: null })).status,
    ).toBe(401);
    expect(
      (
        await send(app, "PUT", "/management-api/content-languages", {
          cookie: staffCookie,
          body: { defaultLanguage: "es", languages: ["es", "fr"] },
        })
      ).status,
    ).toBe(403);
  });

  it("requires the configured default for new products and modifier names", async () => {
    const app = mountApp("en-GB");
    const catalogueId = await createCatalogueVia(app, "Lunch");
    const product = {
      catalogueId,
      categoryId: null,
      name: "Pain",
      customerName: { fr: "Pain" },
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    };
    const missing = await send(app, "POST", "/management-api/products", { body: product });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: { code: "content.translation_required", params: { language: "en" } },
    });
    expect(
      (
        await send(app, "POST", "/management-api/products", {
          body: { ...product, customerName: { en: "Bread" } },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await send(app, "POST", "/management-api/option-groups", {
          body: { name: { fr: "Taille" } },
        })
      ).status,
    ).toBe(400);
    expect(
      (await send(app, "POST", "/management-api/option-groups", { body: { name: { en: "Size" } } }))
        .status,
    ).toBe(201);
  });

  it.each([
    null,
    {},
    { defaultLanguage: "es", languages: "es" },
    { defaultLanguage: "es", languages: [4] },
  ])("rejects malformed language configuration %j", async (body) => {
    expect(
      (await send(mountApp(), "PUT", "/management-api/content-languages", { body })).status,
    ).toBe(400);
  });
});

/** JSON POST/PATCH helper with the manager cookie unless overridden. */
async function send(
  app: Hono,
  method: "POST" | "PATCH" | "GET" | "DELETE" | "PUT",
  path: string,
  opts: { body?: unknown; cookie?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const cookie = opts.cookie === undefined ? managerCookie : opts.cookie;
  if (cookie !== null) headers["cookie"] = cookie;
  return app.request(path, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

async function createCatalogueVia(app: Hono, name: string): Promise<string> {
  const res = await send(app, "POST", "/management-api/catalogues", { body: { name } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function createCategoryVia(app: Hono, name: Record<string, string>): Promise<string> {
  const res = await send(app, "POST", "/management-api/categories", { body: { name } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** A named product with no reporting category and no memberships, in a catalogue of its own. */
async function createNamedProductVia(app: Hono, name: string): Promise<string> {
  const catalogueId = await createCatalogueVia(app, `Catalogue for ${name}`);
  const res = await send(app, "POST", "/management-api/products", {
    body: {
      catalogueId,
      categoryId: null,
      name: name,
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "general",
    },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("mountCatalogueApi — catalogues", () => {
  it("POST /management-api/catalogues creates one (201)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/catalogues", {
      body: { name: "Carta de verano" },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      name: string;
      active: boolean;
      version: number;
    };
    expect(body.name).toBe("Carta de verano");
    expect(body.active).toBe(true);
    expect(typeof body.version).toBe("number");
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("POST /management-api/catalogues with a missing/non-string name → management.request_invalid 400", async () => {
    const missing = await send(mountApp(), "POST", "/management-api/catalogues", { body: {} });
    expect(missing.status).toBe(400);
    expect((await missing.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });

    const nonString = await send(mountApp(), "POST", "/management-api/catalogues", {
      body: { name: 123 },
    });
    expect(nonString.status).toBe(400);
  });

  it("POST /management-api/catalogues unauthenticated → 401", async () => {
    const res = await send(mountApp(), "POST", "/management-api/catalogues", {
      body: { name: "No cookie" },
      cookie: null,
    });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });
  });

  it("POST /management-api/catalogues as a staff-role session → 403 authorization.not_permitted", async () => {
    const res = await send(mountApp(), "POST", "/management-api/catalogues", {
      body: { name: "Refused" },
      cookie: staffCookie,
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });

  it("GET /management-api/catalogues lists them (200)", async () => {
    const app = mountApp();
    await createCatalogueVia(app, "Listable catalogue");
    const res = await send(app, "GET", "/management-api/catalogues");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { name: string }[];
    expect(rows.some((r) => r.name === "Listable catalogue")).toBe(true);
  });

  it("GET /management-api/catalogues unauthenticated → 401", async () => {
    const res = await send(mountApp(), "GET", "/management-api/catalogues", { cookie: null });
    expect(res.status).toBe(401);
  });
});

describe("mountCatalogueApi — location menus", () => {
  // The location's default + member rows are the ONLY state shared across these tests (PGlite is shared
  // for the file); every catalogue a test creates gets a fresh id. Reset both as the owner so the tests
  // are order-independent. `locationId` is set by the shared setup, which runs before this beforeEach.
  beforeEach(async () => {
    await suite.db.execute(sql`delete from location_catalogues where location_id = ${locationId}`);
    await suite.db.execute(sql`update locations set catalogue_id = null where id = ${locationId}`);
  });

  const cataloguesPath = () => `/management-api/locations/${locationId}/catalogues`;
  const defaultPath = () => `/management-api/locations/${locationId}/default-catalogue`;

  it("GET lists every tenant catalogue with sellable + default flags (200)", async () => {
    const app = mountApp();
    const casa = await createCatalogueVia(app, "Casa");
    const dia = await createCatalogueVia(app, "Día");
    const shelf = await createCatalogueVia(app, "Shelf");
    await send(app, "PUT", defaultPath(), { body: { catalogueId: casa } });
    await send(app, "POST", cataloguesPath(), { body: { catalogueId: dia } });
    const res = await send(app, "GET", cataloguesPath());
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; sellable: boolean; isDefault: boolean }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(casa)).toMatchObject({ sellable: true, isDefault: true });
    expect(byId.get(dia)).toMatchObject({ sellable: true, isDefault: false });
    expect(byId.get(shelf)).toMatchObject({ sellable: false, isDefault: false });
  });

  it("POST adds a catalogue to the location's accessible set (204)", async () => {
    const app = mountApp();
    const dia = await createCatalogueVia(app, "Día");
    const res = await send(app, "POST", cataloguesPath(), { body: { catalogueId: dia } });
    expect(res.status).toBe(204);
    const rows = (await (await send(app, "GET", cataloguesPath())).json()) as {
      id: string;
      sellable: boolean;
    }[];
    expect(rows.find((r) => r.id === dia)).toMatchObject({ sellable: true });
  });

  it("DELETE removes a catalogue from the location's accessible set (204)", async () => {
    const app = mountApp();
    const dia = await createCatalogueVia(app, "Día");
    await send(app, "POST", cataloguesPath(), { body: { catalogueId: dia } });
    const res = await send(app, "DELETE", `${cataloguesPath()}/${dia}`);
    expect(res.status).toBe(204);
    const rows = (await (await send(app, "GET", cataloguesPath())).json()) as {
      id: string;
      sellable: boolean;
    }[];
    expect(rows.find((r) => r.id === dia)).toMatchObject({ sellable: false });
  });

  it("PUT default-catalogue sets the default and keeps the old default sellable (204)", async () => {
    const app = mountApp();
    const casa = await createCatalogueVia(app, "Casa");
    const dia = await createCatalogueVia(app, "Día");
    await send(app, "PUT", defaultPath(), { body: { catalogueId: casa } });
    const res = await send(app, "PUT", defaultPath(), { body: { catalogueId: dia } });
    expect(res.status).toBe(204);
    const rows = (await (await send(app, "GET", cataloguesPath())).json()) as {
      id: string;
      sellable: boolean;
      isDefault: boolean;
    }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(dia)).toMatchObject({ sellable: true, isDefault: true });
    expect(byId.get(casa)).toMatchObject({ sellable: true, isDefault: false });
  });

  it("POST unauthenticated → 401", async () => {
    const app = mountApp();
    const res = await send(app, "POST", cataloguesPath(), {
      body: { catalogueId: "11111111-1111-4111-8111-111111111111" },
      cookie: null,
    });
    expect(res.status).toBe(401);
  });

  it("POST as a staff-role session → 403 authorization.not_permitted", async () => {
    const app = mountApp();
    const res = await send(app, "POST", cataloguesPath(), {
      body: { catalogueId: "11111111-1111-4111-8111-111111111111" },
      cookie: staffCookie,
    });
    expect(res.status).toBe(403);
  });

  it("POST with a missing/non-string catalogueId → management.request_invalid 400", async () => {
    const app = mountApp();
    const res = await send(app, "POST", cataloguesPath(), { body: { catalogueId: 42 } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "catalogueId" } },
    });
  });

  it("PUT default-catalogue with a missing/non-string catalogueId → management.request_invalid 400", async () => {
    const app = mountApp();
    const res = await send(app, "PUT", defaultPath(), { body: {} });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "catalogueId" } },
    });
  });

  it("POST with a valid-but-nonexistent catalogueId → catalogue.not_found 404", async () => {
    const app = mountApp();
    const res = await send(app, "POST", cataloguesPath(), {
      body: { catalogueId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "catalogue.not_found" } });
  });

  it("PUT default-catalogue with a valid-but-nonexistent catalogueId → catalogue.not_found 404", async () => {
    const app = mountApp();
    const res = await send(app, "PUT", defaultPath(), {
      body: { catalogueId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "catalogue.not_found" } });
  });

  it("POST with a malformed-uuid catalogueId → shared.invalid_id 400", async () => {
    const app = mountApp();
    const res = await send(app, "POST", cataloguesPath(), { body: { catalogueId: "not-a-uuid" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "shared.invalid_id" } });
  });

  it("GET with a non-uuid locationId → shared.invalid_id 400", async () => {
    const res = await send(mountApp(), "GET", "/management-api/locations/not-a-uuid/catalogues");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "shared.invalid_id" } });
  });
});

describe("mountCatalogueApi — categories", () => {
  it("POST /management-api/categories creates one (201)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/categories", {
      body: { name: { es: "Bebidas" } },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      name: Record<string, string>;
      image: string | null;
      parentId: string | null;
    };
    expect(body).toMatchObject({ name: { es: "Bebidas" }, image: null, parentId: null });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("POST /management-api/categories with a missing name → management.request_invalid 400", async () => {
    const res = await send(mountApp(), "POST", "/management-api/categories", { body: {} });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });
  });

  it("GET /management-api/categories lists them (200)", async () => {
    const app = mountApp();
    await send(app, "POST", "/management-api/categories", {
      body: { name: { es: "Postres" } },
    });
    const res = await send(app, "GET", "/management-api/categories");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { name: Record<string, string> }[];
    expect(rows.some((r) => r.name.es === "Postres")).toBe(true);
  });

  it("creates and repaints a category with a colour", async () => {
    const app = mountApp();
    const created = await send(app, "POST", "/management-api/categories", {
      body: { name: { es: "Picante" }, color: "#b12525" },
    });
    expect(created.status).toBe(201);
    const category = (await created.json()) as { id: string; color: string | null };
    expect(category.color).toBe("#b12525");
    const repainted = await send(app, "PATCH", `/management-api/categories/${category.id}`, {
      body: { color: "#0a0a0a" },
    });
    expect(repainted.status).toBe(200);
    expect(((await repainted.json()) as { color: string | null }).color).toBe("#0a0a0a");
    const cleared = await send(app, "PATCH", `/management-api/categories/${category.id}`, {
      body: { color: null },
    });
    expect(((await cleared.json()) as { color: string | null }).color).toBeNull();
  });

  // A colour the operation refuses is a CLIENT fault: `category.color_invalid` at 400, not the
  // opaque 500 an unmapped code would take. A non-string never reaches the operation — the body
  // screen refuses it as `management.request_invalid` naming the field, as `image` is screened.
  it.each([
    ["red", "category.color_invalid"],
    ["#B12525", "category.color_invalid"],
    ["#b125", "category.color_invalid"],
    [42, "management.request_invalid"],
  ])("rejects the colour %j with %s (400)", async (color, code) => {
    const res = await send(mountApp(), "POST", "/management-api/categories", {
      body: { name: { es: "Picante" }, color },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code } });
  });

  it("returns a category's dependants for the delete confirmation", async () => {
    const app = mountApp();
    const parent = await createCategoryVia(app, { es: "Bebidas" });
    const child = await send(app, "POST", "/management-api/categories", {
      body: { name: { es: "Vinos" }, parentId: parent },
    });
    const childId = ((await child.json()) as { id: string }).id;
    const productId = await createNamedProductVia(app, "Rioja");
    expect(
      (
        await send(app, "PUT", `/management-api/products/${productId}/categories`, {
          body: { categoryIds: [parent] },
        })
      ).status,
    ).toBe(200);

    const res = await send(app, "GET", `/management-api/categories/${parent}/dependants`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      products: [{ id: productId, name: "Rioja", reporting: true }],
      children: [{ id: childId, name: { es: "Vinos" } }],
      parentId: null,
      // The venue-service module is not migrated in this suite, so the optional route table is
      // absent and the read's `to_regclass` guard answers with an empty list rather than a 500.
      routes: [],
    });
  });

  it("gates the dependants read and refuses a foreign or malformed id", async () => {
    const app = mountApp();
    const id = await createCategoryVia(app, { es: "Bebidas" });
    const path = `/management-api/categories/${id}/dependants`;
    expect((await send(app, "GET", path, { cookie: null })).status).toBe(401);
    expect((await send(app, "GET", path, { cookie: staffCookie })).status).toBe(403);
    expect(
      (await send(app, "GET", "/management-api/categories/not-a-uuid/dependants")).status,
    ).toBe(400);
    const absent = await send(
      app,
      "GET",
      "/management-api/categories/11111111-1111-4111-8111-111111111111/dependants",
    );
    expect(absent.status).toBe(404);
    expect(await absent.json()).toMatchObject({ error: { code: "category.not_found" } });
  });

  it("bulk-adds products to a category in one write", async () => {
    const app = mountApp();
    const id = await createCategoryVia(app, { es: "Tapas" });
    const first = await createNamedProductVia(app, "Croquetas");
    const second = await createNamedProductVia(app, "Boquerones");

    const res = await send(app, "POST", `/management-api/categories/${id}/products`, {
      body: { productIds: [first, second] },
    });
    expect(res.status).toBe(204);
    expect(
      (
        (await (await send(app, "GET", `/management-api/categories/${id}/products`)).json()) as {
          id: string;
        }[]
      ).map((p) => p.id),
    ).toEqual([first, second].sort());
    // Neither product had a reporting category, so the bulk add gave each one this category.
    expect(
      await (await send(app, "GET", `/management-api/products/${first}/categories`)).json(),
    ).toEqual({ categoryIds: [id], primaryCategoryId: id });
  });

  it("screens the bulk-add body and gates the write", async () => {
    const app = mountApp();
    const id = await createCategoryVia(app, { es: "Tapas" });
    const path = `/management-api/categories/${id}/products`;
    const productId = await createNamedProductVia(app, "Croquetas");
    // An empty selection is a legitimate no-op the screen lets through, not a 400.
    expect((await send(app, "POST", path, { body: { productIds: [] } })).status).toBe(204);
    for (const productIds of [undefined, "nope", [7]]) {
      const res = await send(app, "POST", path, { body: { productIds } });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "productIds" } },
      });
    }
    // A well-formed-but-unknown id is the operation's refusal; a malformed one never reaches it.
    const malformed = await send(app, "POST", path, { body: { productIds: ["not-a-uuid"] } });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "shared.invalid_id" } });
    const unknown = await send(app, "POST", path, {
      body: { productIds: ["11111111-1111-4111-8111-111111111111"] },
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: { code: "category.membership_invalid" } });
    expect(
      (await send(app, "POST", path, { body: { productIds: [productId] }, cookie: staffCookie }))
        .status,
    ).toBe(403);
    expect(
      (await send(app, "POST", path, { body: { productIds: [productId] }, cookie: null })).status,
    ).toBe(401);
  });

  it("accepts a null reporting category on the membership PUT", async () => {
    const app = mountApp();
    const food = await createCategoryVia(app, { es: "Comida" });
    const drinks = await createCategoryVia(app, { es: "Bebidas" });
    const productId = await createNamedProductVia(app, "Vermut");
    const path = `/management-api/products/${productId}/categories`;
    const res = await send(app, "PUT", path, {
      body: { categoryIds: [food, drinks], primaryCategoryId: null },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      categoryIds: [food, drinks].sort(),
      primaryCategoryId: null,
    });
    expect(await (await send(app, "GET", path)).json()).toEqual({
      categoryIds: [food, drinks].sort(),
      primaryCategoryId: null,
    });
  });
});

describe("mountCatalogueApi — products", () => {
  it("GET /management-api/catalogues/:id/products → 200 (empty for a fresh catalogue)", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Empty catalogue");
    const res = await send(app, "GET", `/management-api/catalogues/${catalogueId}/products`);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown[]).toEqual([]);
  });

  it("offers one product on two menus with independent section and price", async () => {
    const app = mountApp();
    const productsMenuId = await createCatalogueVia(app, "Products");
    const upstairsMenuId = await createCatalogueVia(app, "Upstairs drinks");
    const downstairsMenuId = await createCatalogueVia(app, "Downstairs drinks");
    const createdProduct = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId: productsMenuId,
        categoryId: null,
        name: "Negroni",
        customerName: { en: "Negroni", es: "Negroni" },
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      },
    });
    const productId = ((await createdProduct.json()) as { id: string }).id;

    const createOffer = async (menuId: string, grossPrice: string): Promise<string> => {
      const sectionResponse = await send(
        app,
        "POST",
        `/management-api/catalogues/${menuId}/sections`,
        { body: { name: { en: "Cocktails", es: "Cócteles" }, displayOrder: 0 } },
      );
      expect(sectionResponse.status).toBe(201);
      const sectionId = ((await sectionResponse.json()) as { id: string }).id;
      const response = await send(app, "POST", `/management-api/catalogues/${menuId}/items`, {
        body: { productId, sectionId, grossPrice, displayOrder: 0 },
      });
      expect(response.status).toBe(201);
      return ((await response.json()) as { id: string }).id;
    };
    const upstairsItemId = await createOffer(upstairsMenuId, "11.00");
    const downstairsItemId = await createOffer(downstairsMenuId, "9.00");

    const upstairs = await send(app, "GET", `/management-api/catalogues/${upstairsMenuId}/offers`);
    const downstairs = await send(
      app,
      "GET",
      `/management-api/catalogues/${downstairsMenuId}/offers`,
    );
    expect(
      ((await upstairs.json()) as { productId: string; grossPrice: string }[])[0],
    ).toMatchObject({ productId, grossPrice: "11.00" });
    expect(
      ((await downstairs.json()) as { productId: string; grossPrice: string }[])[0],
    ).toMatchObject({ productId, grossPrice: "9.00" });

    expect(
      (
        await send(
          app,
          "PATCH",
          `/management-api/catalogues/${upstairsMenuId}/items/${upstairsItemId}`,
          { body: { grossPrice: "12.50" } },
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await send(
          app,
          "DELETE",
          `/management-api/catalogues/${downstairsMenuId}/items/${downstairsItemId}`,
        )
      ).status,
    ).toBe(204);
    const updated = await send(app, "GET", `/management-api/catalogues/${upstairsMenuId}/offers`);
    const removed = await send(app, "GET", `/management-api/catalogues/${downstairsMenuId}/offers`);
    expect(((await updated.json()) as { grossPrice: string }[])[0]!.grossPrice).toBe("12.50");
    expect(await removed.json()).toEqual([]);
  });

  it("GET /management-api/catalogues/:id/products with a non-uuid id → shared.invalid_id 400", async () => {
    const res = await send(mountApp(), "GET", "/management-api/catalogues/not-a-uuid/products");
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });

  it("POST /management-api/products creates one and lists it back (201 → the Product shape)", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Product catalogue");
    const catRes = await send(app, "POST", "/management-api/categories", {
      body: { name: { es: "Cafés" } },
    });
    const categoryId = ((await catRes.json()) as { id: string }).id;

    const res = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId,
        name: "Café solo",
        customerName: { es: "Café con leche" },
        pricingUnit: "each",
        unitPrice: "1.20",
        vatClass: "general",
        allergens: { milk: { presence: "may_contain", source: "leche" } },
        image: "abc.png",
      },
    });
    expect(res.status).toBe(201);
    const product = (await res.json()) as {
      id: string;
      catalogueId: string;
      categoryIds: string[];
      primaryCategoryId: string | null;
      name: string;
      customerName: Record<string, string> | null;
      unitPrice: string;
      vatClass: string;
      pricingUnit: string;
      active: boolean;
      allergens: unknown;
      image: string | null;
    };
    expect(product).toMatchObject({
      catalogueId,
      categoryIds: [categoryId],
      primaryCategoryId: categoryId,
      name: "Café solo",
      customerName: { es: "Café con leche" },
      unitPrice: "1.20",
      vatClass: "general",
      pricingUnit: "each",
      active: true,
      allergens: { milk: { presence: "may_contain", source: "leche" } },
      image: "abc.png",
    });

    const list = await send(app, "GET", `/management-api/catalogues/${catalogueId}/products`);
    expect(list.status).toBe(200);
    const rows = (await list.json()) as { id: string }[];
    expect(rows.some((r) => r.id === product.id)).toBe(true);
  });

  it("round-trips the complete product editor through its canonical routes", async () => {
    const app = mountApp("es-ES");
    const catalogueId = await createCatalogueVia(app, "Editor catalogue");
    const unitId = (
      await suite.db.execute<{ id: string }>(sql`select id from units where seed_key = 'each'`)
    ).rows[0]!.id;
    const category = await send(app, "POST", "/management-api/categories", {
      body: { name: { es: "Cafés" } },
    });
    const categoryId = ((await category.json()) as { id: string }).id;
    // An OPTIONS list, not the old text modifier: the editor body's flat `modifierIds` is now an
    // ordered `modifiers` list naming a list and its kind.
    const optionList = await send(app, "POST", "/management-api/modifiers/options", {
      body: { name: "Nota", labels: [{ name: "Sin azúcar" }] },
    });
    const optionListId = ((await optionList.json()) as { optionList: { id: string } }).optionList
      .id;
    const value = {
      name: "Café",
      customerName: { es: "Café recién molido" },
      description: { es: "Recién molido" },
      kitchenName: "CAFÉ BAR",
      image: null,
      unitId,
      unitPrice: "2.00",
      available: true,
      soldAlone: true,
      vatClass: "general",
      variants: [
        {
          name: "Doble",
          customerName: { es: "Doble ración" },
          kitchenName: "DBL",
          image: null,
          unitPrice: "3.25",
          available: true,
        },
        {
          name: "Sencillo",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: "2.00",
          available: true,
        },
      ],
      categoryIds: [categoryId],
      primaryCategoryId: categoryId,
      modifiers: [{ kind: "options", id: optionListId }],
      allergens: {},
      dietaryDeclarations: ["vegetarian", "halal"],
    };
    const created = await send(
      app,
      "POST",
      `/management-api/catalogues/${catalogueId}/product-editor`,
      { body: value },
    );
    expect(created.status).toBe(201);
    const saved = (await created.json()) as { id: string; variants: { id: string }[] };
    expect(saved).toMatchObject(value);
    const read = await send(app, "GET", `/management-api/products/${saved.id}/editor`);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(saved);
    const section = await send(app, "POST", `/management-api/catalogues/${catalogueId}/sections`, {
      body: { name: { es: "Cafés" }, displayOrder: 0 },
    });
    const sectionId = ((await section.json()) as { id: string }).id;
    const offer = await send(app, "POST", `/management-api/catalogues/${catalogueId}/items`, {
      body: { productId: saved.id, sectionId, grossPrice: "2.40", displayOrder: 0 },
    });
    const offerId = ((await offer.json()) as { id: string }).id;
    const published = await send(
      app,
      "PUT",
      `/management-api/catalogues/${catalogueId}/items/${offerId}/variants`,
      {
        body: {
          variants: [{ variantId: saved.variants[0]!.id, unitPrice: "4.10", available: true }],
        },
      },
    );
    expect(published.status).toBe(200);
    expect(await published.json()).toEqual([
      { variantId: saved.variants[0]!.id, unitPrice: "4.10", available: true },
    ]);
    const otherCatalogueId = await createCatalogueVia(app, "Other catalogue");
    const mismatched = await send(
      app,
      "GET",
      `/management-api/catalogues/${otherCatalogueId}/items/${offerId}/variants`,
    );
    expect(mismatched.status).toBe(404);
    expect(await mismatched.json()).toMatchObject({ error: { code: "menu_item.not_found" } });
    const offers = await send(app, "GET", `/management-api/catalogues/${catalogueId}/offers`);
    expect(((await offers.json()) as { variants: unknown[] }[])[0]!.variants).toEqual([
      expect.objectContaining({ id: saved.variants[0]!.id, unitPrice: "4.10" }),
    ]);
    await send(app, "PUT", `/management-api/catalogues/${catalogueId}/items/${offerId}/variants`, {
      body: { variants: [] },
    });
    const updated = await send(app, "PUT", `/management-api/products/${saved.id}/editor`, {
      body: { ...value, available: false, kitchenName: null, variants: [] },
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      available: false,
      kitchenName: null,
      variants: [],
    });
  });

  /** The smallest body the editor parser accepts, plus whatever a test wants on top. */
  async function editorBody(
    app: Hono,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const unitId = (
      await suite.db.execute<{ id: string }>(sql`select id from units where seed_key = 'each'`)
    ).rows[0]!.id;
    void app;
    return {
      name: "Rutas",
      customerName: null,
      description: null,
      kitchenName: null,
      image: null,
      unitId,
      unitPrice: "2.00",
      available: true,
      soldAlone: true,
      vatClass: "general",
      variants: [],
      categoryIds: [],
      primaryCategoryId: null,
      modifiers: [],
      allergens: null,
      dietaryDeclarations: [],
      ...extra,
    };
  }

  it("creates a product with its kitchen station and course in one save", async () => {
    const app = mountApp("es-ES");
    const catalogueId = await createCatalogueVia(app, "Routing catalogue");
    const { stationId, courseId } = await seedRouting();
    const created = await send(
      app,
      "POST",
      `/management-api/catalogues/${catalogueId}/product-editor`,
      { body: await editorBody(app, { stationId, courseId }) },
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ stationId, courseId });
  });

  it("saves the kitchen station and course on the editor PUT and reads them back", async () => {
    const app = mountApp("es-ES");
    const catalogueId = await createCatalogueVia(app, "Routing catalogue");
    const { stationId, courseId } = await seedRouting();
    const created = await send(
      app,
      "POST",
      `/management-api/catalogues/${catalogueId}/product-editor`,
      { body: await editorBody(app) },
    );
    const productId = ((await created.json()) as { id: string }).id;

    const updated = await send(app, "PUT", `/management-api/products/${productId}/editor`, {
      body: await editorBody(app, { name: "Rutas cambiadas", stationId, courseId }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ name: "Rutas cambiadas", stationId, courseId });
    const read = await send(app, "GET", `/management-api/products/${productId}/editor`);
    expect(await read.json()).toMatchObject({ stationId, courseId });
  });

  it("rolls the WHOLE product back when the save names a station this venue does not have", async () => {
    const app = mountApp("es-ES");
    const catalogueId = await createCatalogueVia(app, "Routing catalogue");
    const { courseId } = await seedRouting();
    const created = await send(
      app,
      "POST",
      `/management-api/catalogues/${catalogueId}/product-editor`,
      { body: await editorBody(app) },
    );
    const productId = ((await created.json()) as { id: string }).id;
    const before = await send(app, "GET", `/management-api/products/${productId}/editor`);
    const beforeValue = await before.json();

    const rejected = await send(app, "PUT", `/management-api/products/${productId}/editor`, {
      body: await editorBody(app, {
        name: "Nombre que no debe guardarse",
        unitPrice: "9.99",
        stationId: crypto.randomUUID(),
        courseId,
      }),
    });
    expect(rejected.status).toBe(404);
    expect(await rejected.json()).toMatchObject({ error: { code: "station.not_found" } });
    // A malformed id is the same refusal, not an opaque 500 from a uuid cast.
    const malformed = await send(app, "PUT", `/management-api/products/${productId}/editor`, {
      body: await editorBody(app, { stationId: "not-a-uuid" }),
    });
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({
      error: { code: "station.not_found", params: { stationId: "not-a-uuid" } },
    });
    // Not one field of the product moved: the name, the price and the course all share the save's
    // single transaction with the rejected routing write.
    const after = await send(app, "GET", `/management-api/products/${productId}/editor`);
    expect(await after.json()).toEqual(beforeValue);
  });

  it("round-trips direct modifier dietary effects and rejects origin authoring", async () => {
    const app = mountApp("es-ES");
    const choiceId = crypto.randomUUID();
    const body = {
      type: "extras",
      name: { es: "Extras" },
      available: true,
      required: false,
      maxTotalQuantity: 2,
      choices: [
        {
          id: choiceId,
          name: { es: "Bacon" },
          available: true,
          priceDelta: "1.00",
          maxQuantity: 2,
          preselected: false,
          suitableFor: ["vegan", "halal"],
        },
      ],
    };
    const created = await send(app, "POST", "/management-api/modifiers", { body });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ modifier: body });
    const legacy = await send(app, "POST", "/management-api/modifiers", {
      body: {
        ...body,
        choices: [{ ...body.choices[0], addOrigins: ["meat"] }],
      },
    });
    expect(legacy.status).toBe(400);
    expect(await legacy.json()).toMatchObject({ error: { code: "modifier.invalid" } });
  });

  it("POST /management-api/products with active:false → 201 and the created product is inactive", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Create-inactive catalogue");
    const res = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "No sellable yet",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
        active: false,
      },
    });
    expect(res.status).toBe(201);
    expect((await res.json()) as { active: boolean }).toMatchObject({ active: false });
  });

  it("POST /management-api/products with active:true (and with it omitted) → an active product", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Create-active catalogue");
    const explicit = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Explícitamente activo",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
        active: true,
      },
    });
    expect(explicit.status).toBe(201);
    expect((await explicit.json()) as { active: boolean }).toMatchObject({ active: true });
    // Omitting `active` preserves today's behaviour: an active product.
    const omitted = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Activo por defecto",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      },
    });
    expect(omitted.status).toBe(201);
    expect((await omitted.json()) as { active: boolean }).toMatchObject({ active: true });
  });

  it("POST/PATCH /management-api/products carries soldAlone, defaulting to true and round-tripping", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Sold-alone catalogue");
    // Explicit false is created as a referenced-only product and reads back false.
    const referenced = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Solo ingrediente",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
        soldAlone: false,
      },
    });
    expect(referenced.status).toBe(201);
    const referencedBody = (await referenced.json()) as { id: string; soldAlone: boolean };
    expect(referencedBody).toMatchObject({ soldAlone: false });
    const referencedId = referencedBody.id;
    // Omitting soldAlone preserves the column default: a standalone product.
    const omitted = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Vendible por defecto",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      },
    });
    expect(omitted.status).toBe(201);
    expect((await omitted.json()) as { soldAlone: boolean }).toMatchObject({ soldAlone: true });
    // PATCH flips it back on and the change lands.
    const patched = await send(app, "PATCH", `/management-api/products/${referencedId}`, {
      body: { soldAlone: true },
    });
    expect(patched.status).toBe(204);
    const list = await send(app, "GET", `/management-api/catalogues/${catalogueId}/products`);
    const row = ((await list.json()) as { id: string; soldAlone: boolean }[]).find(
      (r) => r.id === referencedId,
    )!;
    expect(row).toMatchObject({ soldAlone: true });
  });

  it.each([
    ["POST", "/management-api/products"],
    ["PATCH", "/management-api/products/:id"],
  ] as const)(
    "%s /management-api/products rejects a non-boolean soldAlone → management.request_invalid 400",
    async (method, template) => {
      const app = mountApp();
      const catalogueId = await createCatalogueVia(app, `Bad-soldAlone ${method} catalogue`);
      const created = await send(app, "POST", "/management-api/products", {
        body: {
          catalogueId,
          categoryId: null,
          name: "Base",
          pricingUnit: "each",
          unitPrice: "1.00",
          vatClass: "general",
        },
      });
      const productId = ((await created.json()) as { id: string }).id;
      const path = template.replace(":id", productId);
      const body =
        method === "POST"
          ? {
              catalogueId,
              categoryId: null,
              name: "Malformado",
              pricingUnit: "each",
              unitPrice: "1.00",
              vatClass: "general",
              soldAlone: 1,
            }
          : { soldAlone: 1 };
      const res = await send(app, method, path, { body });
      expect(res.status).toBe(400);
      expect(
        (await res.json()) as { error: { code: string; params: { field: string } } },
      ).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "soldAlone" } },
      });
    },
  );

  it("POST /management-api/products with a missing required field → management.request_invalid 400", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Missing-field catalogue");
    const res = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Sin precio",
        pricingUnit: "each",
        // unitPrice omitted
        vatClass: "general",
      },
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "unitPrice" } },
    });
  });

  it.each([
    ["invalid_code", { notacode: { presence: "contains" } }, "allergen.invalid_code"],
    ["invalid_presence", { gluten: { presence: "sometimes" } }, "allergen.invalid_presence"],
    ["invalid_source", { gluten: { presence: "contains", source: 7 } }, "allergen.invalid_source"],
  ])(
    "POST /management-api/products with a bad allergen (%s) → %s 400",
    async (_label, allergens, code) => {
      const app = mountApp();
      const catalogueId = await createCatalogueVia(app, `Allergen catalogue ${_label}`);
      const res = await send(app, "POST", "/management-api/products", {
        body: {
          catalogueId,
          categoryId: null,
          name: "Mal alérgeno",
          pricingUnit: "each",
          unitPrice: "1.00",
          vatClass: "general",
          allergens,
        },
      });
      expect(res.status).toBe(400);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code },
      });
    },
  );

  it("POST /management-api/products with a valid dietOverride → 201", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Diet catalogue");
    const res = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Falafel",
        pricingUnit: "each",
        unitPrice: "5.00",
        vatClass: "general",
        dietOverride: { vegan: "no", halal: "yes", addContains: ["meat"] },
      },
    });
    expect(res.status).toBe(201);
    // The management product read exposes the staff override distinctly (the diet twin of
    // `manualAllergens`), so the dashboard's diet-override editor (Task 8b) can seed from it.
    const list = await send(app, "GET", `/management-api/catalogues/${catalogueId}/products`);
    const products = (await list.json()) as { dietOverride: unknown }[];
    expect(products[0]!.dietOverride).toEqual({ vegan: "no", halal: "yes", addContains: ["meat"] });
  });

  it.each([
    ["a bad label", { vegan: "maybe" }, "diet.invalid_label"],
    ["a non-contains-tag addContains", { addContains: ["plant"] }, "diet.invalid_origin"],
    ["an unknown addContains", { addContains: ["wombat"] }, "diet.invalid_origin"],
    [
      "a conflicting overlay",
      { addContains: ["meat"], removeContains: ["meat"] },
      "diet.add_remove_conflict",
    ],
  ])(
    "POST /management-api/products with %s in dietOverride → %s 400",
    async (_label, dietOverride, code) => {
      const app = mountApp();
      const catalogueId = await createCatalogueVia(app, `Diet catalogue ${code} ${_label}`);
      const res = await send(app, "POST", "/management-api/products", {
        body: {
          catalogueId,
          categoryId: null,
          name: "x",
          pricingUnit: "each",
          unitPrice: "1.00",
          vatClass: "general",
          dietOverride,
        },
      });
      expect(res.status).toBe(400);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code } });
    },
  );

  it("POST /management-api/products with a non-object dietOverride → management.request_invalid 400", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Diet shape catalogue");
    const res = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "x",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
        dietOverride: "nope",
      },
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "dietOverride" } },
    });
  });

  it("PATCH /management-api/products/:id with a bad dietOverride label → diet.invalid_label 400", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Patch-diet catalogue");
    const created = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "x",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      },
    });
    const productId = ((await created.json()) as { id: string }).id;
    const res = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: { dietOverride: { vegetarian: "perhaps" } },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "diet.invalid_label" },
    });
  });

  it("PATCH /management-api/products/:id updates unitPrice / active / image (204 each)", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Patchable catalogue");
    const createRes = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Editar",
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "general",
        image: "before.png",
      },
    });
    const productId = ((await createRes.json()) as { id: string }).id;

    for (const patch of [{ unitPrice: "3.50" }, { active: false }, { image: null }]) {
      const res = await send(app, "PATCH", `/management-api/products/${productId}`, {
        body: patch,
      });
      expect(res.status).toBe(204);
    }

    // Read the product back through the list route: the three patches landed.
    const list = await send(app, "GET", `/management-api/catalogues/${catalogueId}/products`);
    const row = (
      (await list.json()) as {
        id: string;
        unitPrice: string;
        active: boolean;
        image: string | null;
      }[]
    ).find((r) => r.id === productId)!;
    expect(row).toMatchObject({ unitPrice: "3.50", active: false, image: null });
  });

  it("PATCH /management-api/products/:id sets the customer-facing name and clears it with null", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Customer-name catalogue");
    const createRes = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Café solo",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      },
    });
    const productId = ((await createRes.json()) as { id: string }).id;
    const readBack = async (): Promise<{ name: string; customerName: unknown }> => {
      const list = await send(app, "GET", `/management-api/catalogues/${catalogueId}/products`);
      return ((await list.json()) as { id: string; name: string; customerName: unknown }[]).find(
        (r) => r.id === productId,
      )!;
    };
    // Created without one: the staff name is what a receipt would fall back to.
    expect(await readBack()).toMatchObject({ name: "Café solo", customerName: null });

    const set = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: { customerName: { es: "Café recién molido" } },
    });
    expect(set.status).toBe(204);
    expect(await readBack()).toMatchObject({
      name: "Café solo",
      customerName: { es: "Café recién molido" },
    });

    // Explicit null clears it back to "no customer name", leaving the staff name untouched.
    const cleared = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: { customerName: null },
    });
    expect(cleared.status).toBe(204);
    expect(await readBack()).toMatchObject({ name: "Café solo", customerName: null });

    // A customer name that names no enabled language at all is a translation gap, not a clear.
    const partial = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: { customerName: { fr: "Café frais" } },
    });
    expect(partial.status).toBe(400);
    expect(await partial.json()).toMatchObject({
      error: { code: "content.translation_required" },
    });
    expect(await readBack()).toMatchObject({ customerName: null });
  });

  it("PATCH /management-api/products/:id with a non-uuid id → shared.invalid_id 400", async () => {
    const res = await send(mountApp(), "PATCH", "/management-api/products/not-a-uuid", {
      body: { unitPrice: "1.00" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });

  it("PATCH /management-api/products/:id with a bad allergen map → allergen.* 400", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Patch-allergen catalogue");
    const createRes = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Editar alérgeno",
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "general",
      },
    });
    const productId = ((await createRes.json()) as { id: string }).id;

    const res = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: { allergens: { notacode: { presence: "contains" } } },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "allergen.invalid_code" },
    });
  });
});

const DUMMY_UUID = "00000000-0000-0000-0000-000000000000";

describe("mountCatalogueApi — product request-shape screens", () => {
  // The screens run BEFORE the tenant transaction, so these need no real rows — a uuid-shaped id and a
  // string catalogueId pass their own checks and the target field throws first.
  const productBase = {
    catalogueId: DUMMY_UUID,
    categoryId: null,
    name: "x",
    pricingUnit: "each",
    unitPrice: "1.00",
    vatClass: "general",
  };

  it.each([
    ["catalogueId", { ...productBase, catalogueId: 123 }],
    ["categoryId", { ...productBase, categoryId: 123 }],
    ["name", { ...productBase, name: 123 }],
    ["name", { ...productBase, name: "   " }],
    ["customerName", { ...productBase, customerName: "nope" }],
    ["customerName", { ...productBase, customerName: ["arr"] }],
    ["customerName", { ...productBase, customerName: { es: 5 } }],
    ["pricingUnit", { ...productBase, pricingUnit: 5 }],
    ["vatClass", { ...productBase, vatClass: 5 }],
    ["image", { ...productBase, image: 5 }],
    ["active", { ...productBase, active: "nope" }],
  ])(
    "POST /products rejects a wrong-typed %s → management.request_invalid 400",
    async (field, body) => {
      const res = await send(mountApp(), "POST", "/management-api/products", { body });
      expect(res.status).toBe(400);
      expect(
        (await res.json()) as { error: { code: string; params: { field: string } } },
      ).toMatchObject({ error: { code: "management.request_invalid", params: { field } } });
    },
  );

  it("POST /products rejects an unknown legacy pricingUnit", async () => {
    const res = await send(mountApp(), "POST", "/management-api/products", {
      body: { ...productBase, pricingUnit: "portion" },
    });
    expect(res.status).toBe(400);
    // The unknown-legacy-value rejection is `createProduct`'s own domain check (`operations.ts`), so it
    // throws the catalogue-owned `product.invalid`, not the route screen's `management.request_invalid`.
    expect(await res.json()).toMatchObject({
      error: { code: "product.invalid", params: { field: "pricingUnit" } },
    });
  });

  it.each([
    ["name", { name: 123 }],
    ["name", { name: "   " }],
    ["customerName", { customerName: "nope" }],
    ["customerName", { customerName: ["arr"] }],
    ["unitPrice", { unitPrice: 5 }],
    ["vatClass", { vatClass: 5 }],
    ["pricingUnit", { pricingUnit: 5 }],
    ["categoryId", { categoryId: 5 }],
    ["image", { image: 5 }],
    ["active", { active: "yes" }],
  ])(
    "PATCH /products/:id rejects a wrong-typed %s → management.request_invalid 400",
    async (field, body) => {
      const res = await send(mountApp(), "PATCH", `/management-api/products/${DUMMY_UUID}`, {
        body,
      });
      expect(res.status).toBe(400);
      expect(
        (await res.json()) as { error: { code: string; params: { field: string } } },
      ).toMatchObject({ error: { code: "management.request_invalid", params: { field } } });
    },
  );

  it("PATCH /products/:id applies name/vatClass/pricingUnit/categoryId/image (204) and they land", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Full-patch catalogue");
    const catRes = await send(app, "POST", "/management-api/categories", {
      body: { name: { es: "Tapas" } },
    });
    const categoryId = ((await catRes.json()) as { id: string }).id;
    const createRes = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "antes",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      },
    });
    const productId = ((await createRes.json()) as { id: string }).id;

    const res = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: {
        name: "después",
        vatClass: "reduced",
        pricingUnit: "weight",
        categoryId,
        image: "pic.png",
      },
    });
    expect(res.status).toBe(204);

    const list = await send(app, "GET", `/management-api/catalogues/${catalogueId}/products`);
    const row = (
      (await list.json()) as {
        id: string;
        name: string;
        vatClass: string;
        pricingUnit: string;
        categoryIds: string[];
        primaryCategoryId: string | null;
        image: string | null;
      }[]
    ).find((r) => r.id === productId)!;
    expect(row).toMatchObject({
      name: "después",
      vatClass: "reduced",
      pricingUnit: "weight",
      categoryIds: [categoryId],
      primaryCategoryId: categoryId,
      image: "pic.png",
    });
  });

  it("PATCH /products/:id with an empty body is a 204 no-op", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Empty-patch catalogue");
    const createRes = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "sin cambios",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      },
    });
    const productId = ((await createRes.json()) as { id: string }).id;
    const res = await send(app, "PATCH", `/management-api/products/${productId}`, { body: {} });
    expect(res.status).toBe(204);
  });
});

describe("mountCatalogueApi — null request bodies map to the route's own 4xx, never a 500", () => {
  // A literal JSON `null` body parses to `null`; each write route coerces it with `?? {}` so a field
  // access is the route's documented 4xx (or, for PATCH, the empty-body 204) rather than a TypeError →
  // opaque 500 — the same guard the management routes carry (management-api.pg.test.ts).
  it("POST /catalogues null body → 400 management.request_invalid", async () => {
    const res = await send(mountApp(), "POST", "/management-api/catalogues", { body: null });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("POST /categories null body → 400 management.request_invalid", async () => {
    const res = await send(mountApp(), "POST", "/management-api/categories", { body: null });
    expect(res.status).toBe(400);
  });

  it("POST /products null body → 400 management.request_invalid", async () => {
    const res = await send(mountApp(), "POST", "/management-api/products", { body: null });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "catalogueId" } },
    });
  });

  it("PATCH /products/:id null body → 204 no-op", async () => {
    const app = mountApp();
    const productId = await createProductVia(app, await createCatalogueVia(app, "Null body"));
    const res = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: null,
    });
    expect(res.status).toBe(204);
  });

  // A malformed body makes `c.req.json()` throw; the shared `readJsonBody` coerces that throw to `{}`,
  // the same shape the null-body cases above rely on, so POST hits the field-screen 400 and PATCH the
  // empty-body 204 — never an opaque 500. Sent raw — `send` would JSON.stringify a valid body.
  it("POST /products and PATCH /products/:id with a malformed body → 400 / 204 (never a 500)", async () => {
    const app = mountApp();
    const headers = { "content-type": "application/json", cookie: managerCookie };

    const post = await app.request("/management-api/products", {
      method: "POST",
      headers,
      body: "{ not json",
    });
    expect(post.status).toBe(400);
    expect(
      (await post.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "catalogueId" } },
    });

    const productId = await createProductVia(app, await createCatalogueVia(app, "Malformed body"));
    const patch = await app.request(`/management-api/products/${productId}`, {
      method: "PATCH",
      headers,
      body: "{ not json",
    });
    expect(patch.status).toBe(204);
  });
});

interface OptionGroupShape {
  id: string;
  name: Record<string, string>;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  sort: number;
  active: boolean;
}

async function createGroupVia(app: Hono, body: Record<string, unknown>): Promise<OptionGroupShape> {
  const res = await send(app, "POST", "/management-api/option-groups", { body });
  expect(res.status).toBe(201);
  return (await res.json()) as OptionGroupShape;
}

async function createProductVia(app: Hono, catalogueId: string): Promise<string> {
  const res = await send(app, "POST", "/management-api/products", {
    body: {
      catalogueId,
      categoryId: null,
      name: "Producto con opciones",
      pricingUnit: "each",
      unitPrice: "5.00",
      vatClass: "general",
    },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("mountCatalogueApi — option groups", () => {
  it("POST /management-api/option-groups creates one (201, defaults applied)", async () => {
    const group = await createGroupVia(mountApp(), { name: { es: "Tamaño" } });
    expect(group).toMatchObject({
      name: { es: "Tamaño" },
      minSelect: 0,
      maxSelect: 1,
      required: false,
      sort: 0,
      active: true,
    });
    expect(group.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("POST /management-api/option-groups honours explicit bounds/sort/active", async () => {
    const group = await createGroupVia(mountApp(), {
      name: { es: "Extras" },
      minSelect: 1,
      maxSelect: 3,
      required: true,
      sort: 5,
      active: false,
    });
    expect(group).toMatchObject({
      minSelect: 1,
      maxSelect: 3,
      required: true,
      sort: 5,
      active: false,
    });
  });

  it("POST /management-api/option-groups with a missing/non-object name → management.request_invalid 400", async () => {
    for (const body of [{}, { name: "nope" }, { name: ["a"] }]) {
      const res = await send(mountApp(), "POST", "/management-api/option-groups", { body });
      expect(res.status).toBe(400);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "name" } },
      });
    }
  });

  it.each([
    ["minSelect", { name: { es: "x" }, minSelect: 1.5 }],
    ["maxSelect", { name: { es: "x" }, maxSelect: "2" }],
    ["required", { name: { es: "x" }, required: "yes" }],
    ["sort", { name: { es: "x" }, sort: 1.5 }],
    ["active", { name: { es: "x" }, active: "no" }],
  ])(
    "POST /option-groups rejects a wrong-typed %s → management.request_invalid 400",
    async (field, body) => {
      const res = await send(mountApp(), "POST", "/management-api/option-groups", { body });
      expect(res.status).toBe(400);
      expect(
        (await res.json()) as { error: { code: string; params: { field: string } } },
      ).toMatchObject({ error: { code: "management.request_invalid", params: { field } } });
    },
  );

  it.each([
    [
      "select bounds (max < min)",
      { name: { es: "x" }, minSelect: 3, maxSelect: 1 },
      "select_bounds",
    ],
    ["negative min", { name: { es: "x" }, minSelect: -1 }, "select_bounds"],
    [
      "required without min",
      { name: { es: "x" }, required: true, minSelect: 0 },
      "required_without_min",
    ],
  ])("POST /option-groups with %s → options.group_invalid 400", async (_label, body, reason) => {
    const res = await send(mountApp(), "POST", "/management-api/option-groups", { body });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { reason: string } } },
    ).toMatchObject({ error: { code: "options.group_invalid", params: { reason } } });
  });

  it("GET /management-api/option-groups lists them (active + inactive)", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "Listable" }, active: false });
    const res = await send(app, "GET", "/management-api/option-groups");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as OptionGroupShape[];
    expect(rows.some((r) => r.id === g.id && r.active === false)).toBe(true);
  });

  it("PATCH /management-api/option-groups/:id updates fields (204) and they land", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "antes" }, maxSelect: 1 });
    const res = await send(app, "PATCH", `/management-api/option-groups/${g.id}`, {
      body: { name: { es: "después" }, maxSelect: 4, sort: 2, active: false },
    });
    expect(res.status).toBe(204);
    const rows = (await (
      await send(app, "GET", "/management-api/option-groups")
    ).json()) as OptionGroupShape[];
    expect(rows.find((r) => r.id === g.id)).toMatchObject({
      name: { es: "después" },
      maxSelect: 4,
      sort: 2,
      active: false,
    });
  });

  it("PATCH /management-api/option-groups/:id merges against the stored row for the bounds check", async () => {
    const app = mountApp();
    // Stored minSelect is 2; a patch that only lowers maxSelect to 1 must be caught against the STORED
    // min (2), not a default, so the merged (min 2, max 1) violates select_bounds.
    const g = await createGroupVia(app, { name: { es: "x" }, minSelect: 2, maxSelect: 3 });
    const res = await send(app, "PATCH", `/management-api/option-groups/${g.id}`, {
      body: { maxSelect: 1 },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "options.group_invalid", params: { reason: "select_bounds" } },
    });
    // And required:true against the stored min 2 is fine (2 >= 1).
    const ok = await send(app, "PATCH", `/management-api/option-groups/${g.id}`, {
      body: { required: true },
    });
    expect(ok.status).toBe(204);
  });

  it("PATCH /management-api/option-groups/:id with a non-uuid id → shared.invalid_id 400", async () => {
    const res = await send(mountApp(), "PATCH", "/management-api/option-groups/not-a-uuid", {
      body: { sort: 1 },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });

  it("PATCH /management-api/option-groups/:id with an empty body is a 204 no-op", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "x" } });
    const res = await send(app, "PATCH", `/management-api/option-groups/${g.id}`, { body: {} });
    expect(res.status).toBe(204);
  });

  it.each([
    ["name", { name: "nope" }],
    ["minSelect", { minSelect: 1.5 }],
    ["maxSelect", { maxSelect: "2" }],
    ["required", { required: "yes" }],
    ["sort", { sort: 1.5 }],
    ["active", { active: "no" }],
  ])(
    "PATCH /option-groups/:id rejects a wrong-typed %s → management.request_invalid 400",
    async (field, body) => {
      const app = mountApp();
      const g = await createGroupVia(app, { name: { es: "x" } });
      const res = await send(app, "PATCH", `/management-api/option-groups/${g.id}`, { body });
      expect(res.status).toBe(400);
      expect(
        (await res.json()) as { error: { code: string; params: { field: string } } },
      ).toMatchObject({ error: { code: "management.request_invalid", params: { field } } });
    },
  );

  it("POST /management-api/option-groups unauthenticated → 401", async () => {
    const res = await send(mountApp(), "POST", "/management-api/option-groups", {
      body: { name: { es: "x" } },
      cookie: null,
    });
    expect(res.status).toBe(401);
  });
});

describe("mountCatalogueApi — option group items", () => {
  it("POST /option-groups/:id/items creates one (201, defaults) and lists it back", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "Salsas" } });
    const res = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: { name: { es: "Alioli" } },
    });
    expect(res.status).toBe(201);
    const item = (await res.json()) as {
      id: string;
      groupId: string;
      name: Record<string, string>;
      priceDelta: string;
      vatClass: string | null;
      sort: number;
      active: boolean;
      maxQuantity: number;
    };
    expect(item).toMatchObject({
      groupId: g.id,
      name: { es: "Alioli" },
      priceDelta: "0.00", // numeric(12,2) default renders with scale
      vatClass: null,
      sort: 0,
      active: true,
      maxQuantity: 1, // default: no per-option quantity
    });

    const list = await send(app, "GET", `/management-api/option-groups/${g.id}/items`);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { id: string }[]).some((r) => r.id === item.id)).toBe(true);
  });

  it("POST /option-groups/:id/items honours priceDelta / vatClass / sort / active", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "Tamaño" } });
    const res = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: {
        name: { es: "Grande" },
        priceDelta: "1.50",
        vatClass: "reduced",
        sort: 2,
        active: false,
        maxQuantity: 3,
      },
    });
    expect(res.status).toBe(201);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      priceDelta: "1.50",
      vatClass: "reduced",
      sort: 2,
      active: false,
      maxQuantity: 3,
    });
  });

  it("POST /option-groups/:id/items with maxQuantity < 1 → options.item_invalid 400", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "Salsas" } });
    const res = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: { name: { es: "x" }, maxQuantity: 0 },
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { reason: string } } },
    ).toMatchObject({
      error: { code: "options.item_invalid", params: { reason: "max_quantity" } },
    });
  });

  it.each([
    ["name", { name: "nope" }],
    ["priceDelta", { name: { es: "x" }, priceDelta: 1.5 }],
    ["vatClass", { name: { es: "x" }, vatClass: 5 }],
    ["sort", { name: { es: "x" }, sort: 1.5 }],
    ["active", { name: { es: "x" }, active: "no" }],
    ["maxQuantity", { name: { es: "x" }, maxQuantity: 1.5 }],
  ])(
    "POST /items rejects a wrong-typed %s → management.request_invalid 400",
    async (field, body) => {
      const app = mountApp();
      const g = await createGroupVia(app, { name: { es: "x" } });
      const res = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, { body });
      expect(res.status).toBe(400);
      expect(
        (await res.json()) as { error: { code: string; params: { field: string } } },
      ).toMatchObject({ error: { code: "management.request_invalid", params: { field } } });
    },
  );

  it("POST /option-groups/:id/items with a non-uuid group id → shared.invalid_id 400", async () => {
    const res = await send(mountApp(), "POST", "/management-api/option-groups/not-a-uuid/items", {
      body: { name: { es: "x" } },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });

  it("PATCH /option-groups/:id/items/:itemId updates fields (204) and they land", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "x" } });
    const created = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: { name: { es: "antes" } },
    });
    const itemId = ((await created.json()) as { id: string }).id;
    const res = await send(app, "PATCH", `/management-api/option-groups/${g.id}/items/${itemId}`, {
      body: {
        name: { es: "después" },
        priceDelta: "2.00",
        vatClass: null,
        sort: 3,
        active: false,
        maxQuantity: 4,
      },
    });
    expect(res.status).toBe(204);
    const rows = (await (
      await send(app, "GET", `/management-api/option-groups/${g.id}/items`)
    ).json()) as Record<string, unknown>[];
    expect(rows.find((r) => r["id"] === itemId)).toMatchObject({
      name: { es: "después" },
      priceDelta: "2.00",
      vatClass: null,
      sort: 3,
      active: false,
      maxQuantity: 4,
    });
  });

  it("PATCH /option-groups/:id/items/:itemId with maxQuantity < 1 → options.item_invalid 400", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "x" } });
    const created = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: { name: { es: "x" }, maxQuantity: 3 },
    });
    const itemId = ((await created.json()) as { id: string }).id;
    const res = await send(app, "PATCH", `/management-api/option-groups/${g.id}/items/${itemId}`, {
      body: { maxQuantity: 0 },
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { reason: string } } },
    ).toMatchObject({
      error: { code: "options.item_invalid", params: { reason: "max_quantity" } },
    });
  });

  it("PATCH /option-groups/:id/items/:itemId with a non-uuid item id → shared.invalid_id 400", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "x" } });
    const res = await send(app, "PATCH", `/management-api/option-groups/${g.id}/items/not-a-uuid`, {
      body: { sort: 1 },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });

  it.each([
    ["name", { name: "nope" }],
    ["priceDelta", { priceDelta: 1.5 }],
    ["vatClass", { vatClass: 5 }],
    ["sort", { sort: 1.5 }],
    ["active", { active: "no" }],
    ["maxQuantity", { maxQuantity: 1.5 }],
  ])(
    "PATCH /items/:itemId rejects a wrong-typed %s → management.request_invalid 400",
    async (field, body) => {
      const app = mountApp();
      const g = await createGroupVia(app, { name: { es: "x" } });
      const created = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
        body: { name: { es: "x" } },
      });
      const itemId = ((await created.json()) as { id: string }).id;
      const res = await send(
        app,
        "PATCH",
        `/management-api/option-groups/${g.id}/items/${itemId}`,
        {
          body,
        },
      );
      expect(res.status).toBe(400);
      expect(
        (await res.json()) as { error: { code: string; params: { field: string } } },
      ).toMatchObject({ error: { code: "management.request_invalid", params: { field } } });
    },
  );

  it("PATCH /option-groups/:id/items/:itemId with an empty body is a 204 no-op", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "x" } });
    const created = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: { name: { es: "x" } },
    });
    const itemId = ((await created.json()) as { id: string }).id;
    const res = await send(app, "PATCH", `/management-api/option-groups/${g.id}/items/${itemId}`, {
      body: {},
    });
    expect(res.status).toBe(204);
  });

  // ── Allergen declaration: the routes accept the option's own `addAllergens` and defer validation to
  // the ops, exactly as product `allergens` is threaded. ───────────────────────────────────────────
  it("POST /option-groups/:id/items accepts the option's allergens and returns them", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "Extras" } });
    const res = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: {
        name: { en: "Extra cheese", es: "Queso extra" },
        addAllergens: { milk: { presence: "contains" } },
      },
    });
    expect(res.status).toBe(201);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      addAllergens: { milk: { presence: "contains" } },
    });
  });

  it("POST /option-groups/:id/items 400s on a non-EU-14 allergen code", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "x" } });
    const res = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: { name: { en: "x", es: "x" }, addAllergens: { wombat: { presence: "contains" } } },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "allergen.invalid_code" },
    });
  });

  it("PATCH /option-groups/:id/items/:itemId threads the option's allergens (204) and they land", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "x" } });
    const created = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: { name: { es: "x" } },
    });
    const itemId = ((await created.json()) as { id: string }).id;
    const res = await send(app, "PATCH", `/management-api/option-groups/${g.id}/items/${itemId}`, {
      body: { addAllergens: { milk: { presence: "contains" } } },
    });
    expect(res.status).toBe(204);
    const rows = (await (
      await send(app, "GET", `/management-api/option-groups/${g.id}/items`)
    ).json()) as Record<string, unknown>[];
    expect(rows.find((r) => r["id"] === itemId)).toMatchObject({
      addAllergens: { milk: { presence: "contains" } },
    });
  });
});

describe("mountCatalogueApi — attaching extras and options lists to products", () => {
  // The product body used to carry a flat `optionGroupIds`/`modifierIds` of option-group ids. It now
  // carries one ordered `modifiers` list, each entry naming a KIND (`extras` or `options`) and a list
  // id, written to `product_modifiers`. The cases below are the old ones re-aimed at that contract,
  // plus the two the old field had no equivalent of: a mixed ordered list, and the legacy fields'
  // refusal.
  //
  // There are no extras ROUTES yet (a later slice adds them), so an extras list is made through the
  // catalogue package against the same database the routes use.
  async function createOptionsListVia(
    app: Hono,
    body: Record<string, unknown>,
  ): Promise<OptionList> {
    const res = await send(app, "POST", "/management-api/modifiers/options", { body });
    expect(res.status).toBe(201);
    return ((await res.json()) as { optionList: OptionList }).optionList;
  }

  async function createExtrasListVia(app: Hono, catalogueId: string, name: string) {
    const productId = await createProductVia(app, catalogueId);
    return withTransaction(suite.db, async (tx) => {
      await asAppUser(tx);
      return createExtraList(tx, { name, items: [{ productId }] }, "es");
    });
  }

  /** The product's attachment list as the catalogue read hands it back. */
  async function readModifiers(app: Hono, catalogueId: string, productId: string) {
    const res = await send(app, "GET", `/management-api/catalogues/${catalogueId}/products`);
    expect(res.status).toBe(200);
    const products = (await res.json()) as { id: string; modifiers: unknown }[];
    return products.find((product) => product.id === productId)?.modifiers;
  }

  it("creates a product with an ordered mix of extras and options, and reads it back in order", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Menú con listas");
    const options = await createOptionsListVia(app, {
      name: "Punto de la carne",
      labels: [{ name: "Poco hecho" }],
    });
    const extras = await createExtrasListVia(app, catalogueId, "Salsas");
    // Options FIRST, so the read-back proves the stored order is the body's and not the two tables'.
    const modifiers = [
      { kind: "options", id: options.id },
      { kind: "extras", id: extras.id },
    ];
    const createRes = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Entrecot",
        pricingUnit: "each",
        unitPrice: "18.00",
        vatClass: "general",
        modifiers,
      },
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; modifiers: unknown };
    expect(created.modifiers).toEqual(modifiers);
    expect(await readModifiers(app, catalogueId, created.id)).toEqual(modifiers);
  });

  it("PATCH /products/:id with modifiers re-orders and detaches (the attach is a full replace)", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Reorder menu");
    const a = await createOptionsListVia(app, { name: "A", labels: [{ name: "a1" }] });
    const b = await createOptionsListVia(app, { name: "B", labels: [{ name: "b1" }] });
    const productId = await createProductVia(app, catalogueId);
    const ref = (id: string) => ({ kind: "options", id });

    for (const wanted of [[ref(a.id), ref(b.id)], [ref(b.id), ref(a.id)], [ref(b.id)], []]) {
      const res = await send(app, "PATCH", `/management-api/products/${productId}`, {
        body: { modifiers: wanted },
      });
      expect(res.status).toBe(204);
      expect(await readModifiers(app, catalogueId, productId)).toEqual(wanted);
    }
  });

  it("PATCH /products/:id refuses a repeated attachment rather than colliding in the insert", async () => {
    // The old `optionGroupIds` screen COLLAPSED a repeat, because two copies would otherwise hit the
    // `(product_id, group_id)` primary key and surface as an opaque 500. The ordered list refuses it
    // instead, through the same `product.invalid` the catalogue parser throws — a 400 naming the
    // entry, which is a better answer than silently saving something the caller did not send.
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Dupe attach menu");
    const a = await createOptionsListVia(app, { name: "Repetida", labels: [{ name: "a1" }] });
    const productId = await createProductVia(app, catalogueId);
    const res = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: {
        modifiers: [
          { kind: "options", id: a.id },
          { kind: "options", id: a.id },
        ],
      },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "product.invalid", params: { field: "modifiers.1.id" } },
    });
    expect(await readModifiers(app, catalogueId, productId)).toEqual([]);
  });

  it("POST /products refuses an attachment naming no stored list", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Lista inexistente");
    const res = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "x",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
        modifiers: [{ kind: "extras", id: "11111111-1111-4111-8111-111111111111" }],
      },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "product.invalid", params: { field: "modifiers.0.id" } },
    });
  });

  it.each([
    ["not an array", { modifiers: "lista" }],
    ["a non-object element", { modifiers: [123] }],
    ["an element with no kind", { modifiers: [{ id: "11111111-1111-4111-8111-111111111111" }] }],
    [
      "an element with an unknown kind",
      { modifiers: [{ kind: "salsas", id: "11111111-1111-4111-8111-111111111111" }] },
    ],
    ["an element with no id", { modifiers: [{ kind: "extras" }] }],
  ])(
    "POST /products rejects %s → management.request_invalid 400 naming modifiers",
    async (_label, extra) => {
      const app = mountApp();
      const catalogueId = await createCatalogueVia(app, `Bad attach ${_label}`);
      const res = await send(app, "POST", "/management-api/products", {
        body: {
          catalogueId,
          categoryId: null,
          name: "x",
          pricingUnit: "each",
          unitPrice: "1.00",
          vatClass: "general",
          ...extra,
        },
      });
      expect(res.status).toBe(400);
      expect(
        (await res.json()) as { error: { code: string; params: { field: string } } },
      ).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "modifiers" } },
      });
    },
  );

  it.each(["modifierIds", "optionGroupIds"])(
    "POST /products refuses the legacy %s field, naming it",
    async (legacy) => {
      // Naming the legacy field, not `modifiers`: a caller still on the old contract needs to be told
      // which of its fields is the one that went away. Same choice `parseProductEditorInput`
      // (packages/catalogue/src/product-editor-input.ts) makes on the editor body.
      const app = mountApp();
      const catalogueId = await createCatalogueVia(app, `Legacy ${legacy}`);
      const res = await send(app, "POST", "/management-api/products", {
        body: {
          catalogueId,
          categoryId: null,
          name: "x",
          pricingUnit: "each",
          unitPrice: "1.00",
          vatClass: "general",
          [legacy]: [],
        },
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: legacy } },
      });
    },
  );

  it.each(["POST", "PATCH"])(
    "%s /products rejects a malformed uuid in modifiers → shared.invalid_id 400",
    async (method) => {
      // Same treatment `requireUuidParam` gives a path id, and for the same reason: a string that is
      // not uuid-shaped would otherwise reach the `uuid` column as a `22P02` driver error, which the
      // STATUS map has nothing for and which surfaces as an opaque 500.
      const app = mountApp();
      const catalogueId = await createCatalogueVia(app, `Bad uuid attach ${method}`);
      const modifiers = [{ kind: "extras", id: "not-a-uuid" }];
      const res =
        method === "POST"
          ? await send(app, "POST", "/management-api/products", {
              body: {
                catalogueId,
                categoryId: null,
                name: "x",
                pricingUnit: "each",
                unitPrice: "1.00",
                vatClass: "general",
                modifiers,
              },
            })
          : await send(
              app,
              "PATCH",
              `/management-api/products/${await createProductVia(app, catalogueId)}`,
              { body: { modifiers } },
            );
      expect(res.status).toBe(400);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "shared.invalid_id" },
      });
    },
  );

  it("GET /management-api/products/:id/option-groups with a non-uuid id → shared.invalid_id 400", async () => {
    const res = await send(mountApp(), "GET", "/management-api/products/not-a-uuid/option-groups");
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });

  it("returns a modifier's dependants for the delete confirmation", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Menú con modificador");
    const group = await createGroupVia(app, { name: { es: "Punto" } });
    const createRes = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Entrecot",
        pricingUnit: "each",
        unitPrice: "18.00",
        vatClass: "general",
      },
    });
    expect(createRes.status).toBe(201);
    const productId = ((await createRes.json()) as { id: string }).id;
    // No request body attaches an option GROUP any more — the product carries `modifiers` and writes
    // `product_modifiers` — so the row this read is about is written directly. `product_option_groups`
    // and everything reading it go in Task 13 of
    // `docs/superpowers/plans/2026-09-18-modifiers-extras-options.md`.
    await withTransaction(suite.db, async (tx) => {
      await asAppUser(tx);
      await setProductOptionGroups(tx, productId, [group.id]);
    });

    const res = await send(app, "GET", `/management-api/modifiers/${group.id}/dependants`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dependants: unknown };
    expect(body.dependants).toMatchObject({
      products: [{ id: productId, name: "Entrecot" }],
      menus: [],
      orders: 0,
    });
  });

  it("gates the modifier dependants read and refuses a foreign or malformed id", async () => {
    const app = mountApp();
    const group = await createGroupVia(app, { name: { es: "Punto" } });
    const path = `/management-api/modifiers/${group.id}/dependants`;
    expect((await send(app, "GET", path, { cookie: null })).status).toBe(401);
    expect((await send(app, "GET", path, { cookie: staffCookie })).status).toBe(403);
    expect((await send(app, "GET", "/management-api/modifiers/not-a-uuid/dependants")).status).toBe(
      400,
    );
    const absent = await send(
      app,
      "GET",
      "/management-api/modifiers/11111111-1111-4111-8111-111111111111/dependants",
    );
    expect(absent.status).toBe(404);
    expect(await absent.json()).toMatchObject({ error: { code: "modifier.not_found" } });
  });
});

/**
 * Option lists over the management API. What the CRUD itself does is proven in the catalogue package
 * (`packages/catalogue/src/options.test.ts`); what is proven HERE is the request/response boundary —
 * the status codes, the `{ optionList }` / `{ optionLists }` envelopes, the uuid screen and the
 * permission gate.
 */
describe("mountCatalogueApi — option lists", () => {
  // Every describe in this file shares one database (`resetPerTest: false`), so a content-language
  // configuration another describe left behind would decide what `createOptionList` demands of the
  // customer-facing name maps below. Emptying the table puts `readContentLanguages` on the mounted
  // venue locale, `es` — the one language every map here fills. Insurance, not a repair: measured,
  // the file still passes with this `beforeEach` deleted.
  beforeEach(async () => {
    await suite.db.execute(sql`delete from content_languages`);
  });

  /**
   * Staff, customer-facing and kitchen name are DIFFERENT text at both levels, so a response reading
   * the wrong one of the three cannot pass these assertions (CLAUDE.md §3).
   */
  const doneness = () => ({
    name: "Punto de la carne",
    customerName: { es: "¿Cómo la quiere?" },
    kitchenName: "PTO",
    labels: [
      { name: "Poco hecho", customerName: { es: "Poco hecha" }, kitchenName: "POCO" },
      { name: "Al punto", customerName: { es: "En su punto" }, kitchenName: "PUNTO" },
    ],
  });

  async function createListVia(app: Hono, body: Record<string, unknown>): Promise<OptionList> {
    const res = await send(app, "POST", "/management-api/modifiers/options", { body });
    expect(res.status).toBe(201);
    return ((await res.json()) as { optionList: OptionList }).optionList;
  }

  it("POST creates a list (201) carrying all three names, with the labels in body order", async () => {
    const list = await createListVia(mountApp(), doneness());
    expect(list).toMatchObject({
      name: "Punto de la carne",
      customerName: { es: "¿Cómo la quiere?" },
      kitchenName: "PTO",
      defaultLabelId: null,
      active: true,
    });
    expect(list.labels.map((label) => label.name)).toEqual(["Poco hecho", "Al punto"]);
    expect(list.labels[0]).toMatchObject({
      customerName: { es: "Poco hecha" },
      kitchenName: "POCO",
      available: true,
    });
  });

  it("GET /management-api/modifiers/options lists them", async () => {
    const app = mountApp();
    const list = await createListVia(app, { ...doneness(), name: "Lista listada" });
    const res = await send(app, "GET", "/management-api/modifiers/options");
    expect(res.status).toBe(200);
    const { optionLists } = (await res.json()) as { optionLists: OptionList[] };
    expect(optionLists.find((row) => row.id === list.id)).toMatchObject({
      name: "Lista listada",
      labels: [{ name: "Poco hecho" }, { name: "Al punto" }],
    });
  });

  it("GET /management-api/modifiers/options/:id reads one back", async () => {
    const app = mountApp();
    const list = await createListVia(app, { ...doneness(), name: "Lista leída" });
    const res = await send(app, "GET", `/management-api/modifiers/options/${list.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      optionList: {
        id: list.id,
        name: "Lista leída",
        kitchenName: "PTO",
        labels: [{ name: "Poco hecho" }, { name: "Al punto" }],
      },
    });
  });

  it("PATCH replaces the list — a relabel and a reorder come back in the new order", async () => {
    const app = mountApp();
    const list = await createListVia(app, { ...doneness(), name: "Lista reordenada" });
    const [first, second] = list.labels;
    const res = await send(app, "PATCH", `/management-api/modifiers/options/${list.id}`, {
      body: {
        name: "Lista reordenada y renombrada",
        customerName: { es: "¿Al punto?" },
        kitchenName: "PTO2",
        labels: [
          {
            id: second!.id,
            name: "Al punto",
            customerName: { es: "En su punto" },
            kitchenName: "PUNTO",
          },
          {
            id: first!.id,
            name: "Muy poco hecho",
            customerName: { es: "Casi cruda" },
            kitchenName: "AZUL",
          },
        ],
      },
    });
    expect(res.status).toBe(200);
    const { optionList } = (await res.json()) as { optionList: OptionList };
    expect(optionList.name).toBe("Lista reordenada y renombrada");
    expect(optionList.labels.map((label) => [label.id, label.name])).toEqual([
      [second!.id, "Al punto"],
      [first!.id, "Muy poco hecho"],
    ]);
  });

  it("DELETE answers { ok: true } and the list is then gone", async () => {
    const app = mountApp();
    const list = await createListVia(app, { ...doneness(), name: "Lista borrada" });
    const res = await send(app, "DELETE", `/management-api/modifiers/options/${list.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const gone = await send(app, "GET", `/management-api/modifiers/options/${list.id}`);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ error: { code: "options.not_found" } });
  });

  it("refuses an invalid body with 400 and the domain code, naming the field", async () => {
    const app = mountApp();
    for (const [body, field] of [
      [{ name: "   ", labels: [{ name: "Poco hecho" }] }, "name"],
      // An ACTIVE list with no available label cannot be answered, so the contract refuses it.
      [{ name: "Sin etiquetas", labels: [] }, "labels"],
      [{ name: "Clave de más", labels: [{ name: "Poco hecho" }], nope: 1 }, "optionList.nope"],
    ] as const) {
      const res = await send(app, "POST", "/management-api/modifiers/options", { body });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "options.invalid", params: { field } },
      });
    }
  });

  it("gates every option-list route and refuses an id naming no list", async () => {
    const app = mountApp();
    const list = await createListVia(app, { ...doneness(), name: "Lista vigilada" });
    const collection = "/management-api/modifiers/options";
    const path = `${collection}/${list.id}`;
    // Every gated route, as [method, path, body] — the table shape `print-api.test.ts`'s gate suite
    // uses. Each route is checked BOTH ways, so a route missing one of the two refusals cannot hide
    // behind a sibling that has it.
    const routes: ["GET" | "POST" | "PATCH" | "DELETE", string, unknown?][] = [
      ["GET", collection],
      ["POST", collection, doneness()],
      ["GET", path],
      ["PATCH", path, doneness()],
      ["DELETE", path],
      ["GET", `${path}/dependants`],
    ];
    for (const [method, routePath, body] of routes) {
      for (const [cookie, status, code] of [
        [null, 401, "management_session.required"],
        [staffCookie, 403, "authorization.not_permitted"],
      ] as const) {
        const res = await send(app, method, routePath, {
          cookie,
          ...(body === undefined ? {} : { body }),
        });
        expect(res.status, `${method} ${routePath}`).toBe(status);
        expect(await res.json()).toMatchObject({ error: { code } });
      }
    }
    for (const malformed of [`${collection}/not-a-uuid`, `${collection}/not-a-uuid/dependants`]) {
      const res = await send(app, "GET", malformed);
      expect(res.status, malformed).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "shared.invalid_id" } });
    }
    const absentId = "22222222-2222-4222-8222-222222222222";
    const absent = await send(app, "GET", `${collection}/${absentId}`);
    expect(absent.status).toBe(404);
    expect(await absent.json()).toMatchObject({
      error: { code: "options.not_found", params: { optionListId: absentId } },
    });
  });

  it("previews what deleting a list would touch", async () => {
    const app = mountApp();
    const list = await createListVia(app, { ...doneness(), name: "Lista con dependientes" });
    const res = await send(app, "GET", `/management-api/modifiers/options/${list.id}/dependants`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dependants: { products: [], menus: [] } });
  });
});

describe("menu name edits", () => {
  it("renames a menu in place and validates name, identity and permission", async () => {
    const app = mountApp();
    const id = await createCatalogueVia(app, "Lunch");
    const path = `/management-api/catalogues/${id}`;
    expect((await send(app, "PATCH", path, { body: { name: "Dinner" } })).status).toBe(204);
    const rows = await (await send(app, "GET", "/management-api/catalogues")).json();
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ id, name: "Dinner" })]));
    expect((await send(app, "PATCH", path, { body: { name: "Wrong" }, cookie: null })).status).toBe(
      401,
    );
    expect(
      (await send(app, "PATCH", path, { body: { name: "Wrong" }, cookie: staffCookie })).status,
    ).toBe(403);
    for (const name of ["", "  ", 4, null])
      expect((await send(app, "PATCH", path, { body: { name } })).status).toBe(400);
    expect(
      (await send(app, "PATCH", "/management-api/catalogues/bad-id", { body: { name: "Wrong" } }))
        .status,
    ).toBe(400);
    expect(
      (
        await send(app, "PATCH", `/management-api/catalogues/${crypto.randomUUID()}`, {
          body: { name: "Wrong" },
        })
      ).status,
    ).toBe(404);
  });
});

describe("menu-section translations", () => {
  it("updates translations with default-language validation and rejects unknown section ids", async () => {
    const app = mountApp("en-GB");
    const seedSection = async () => {
      const menu = await suite.db.execute<{ id: string }>(sql`
        insert into catalogues (name) values ('Section edit') returning id`);
      return (
        await suite.db.execute<{ id: string }>(sql`
        insert into menu_sections (menu_id, name)
        values (${menu.rows[0]!.id}, '{"en":"Cocktails","de":"Getränke"}'::jsonb) returning id`)
      ).rows[0]!.id;
    };
    const sectionId = await seedSection();
    await suite.db.execute(sql`
      insert into content_languages (default_language, languages) values ('en', array['en','fr'])
      on conflict (id) do update set default_language = 'en', languages = array['en','fr']`);
    try {
      const path = `/management-api/menu-sections/${sectionId}`;
      const input = { name: { en: "Drinks", fr: "Boissons", de: "Getränke" } };
      expect((await send(app, "PATCH", path, { body: input, cookie: null })).status).toBe(401);
      expect((await send(app, "PATCH", path, { body: input, cookie: staffCookie })).status).toBe(
        403,
      );
      for (const body of [
        {},
        { name: [] },
        { name: "Drinks" },
        { name: { en: 42 } },
        { name: { fr: "Boissons" } },
      ]) {
        expect((await send(app, "PATCH", path, { body })).status).toBe(400);
      }
      expect(
        (await send(app, "PATCH", "/management-api/menu-sections/bad-id", { body: input })).status,
      ).toBe(400);
      expect(
        (
          await send(app, "PATCH", `/management-api/menu-sections/${crypto.randomUUID()}`, {
            body: input,
          })
        ).status,
      ).toBe(404);
      expect((await send(app, "PATCH", path, { body: input })).status).toBe(204);
      const own = await suite.db.execute<{ name: Record<string, string> }>(
        sql`select name from menu_sections where id = ${sectionId}`,
      );
      expect(own.rows).toEqual([input]);
    } finally {
      await suite.db.execute(sql`delete from content_languages`);
    }
  });
});

describe("menu-section list", () => {
  it("lists empty sections in display order", async () => {
    const app = mountApp();
    const menuId = await createCatalogueVia(app, "Empty sections");
    await suite.db.execute(sql`insert into menu_sections (menu_id, name, display_order)
      values (${menuId}, '{"es":"Postres"}'::jsonb, 2),
             (${menuId}, '{"es":"Bebidas"}'::jsonb, 1)`);
    const path = `/management-api/catalogues/${menuId}/sections`;
    expect((await send(app, "GET", path, { cookie: null })).status).toBe(401);
    expect((await send(app, "GET", path, { cookie: staffCookie })).status).toBe(403);
    const response = await send(app, "GET", path);
    expect(response.status).toBe(200);
    const rows = (await response.json()) as {
      id: string;
      menuId: string;
      name: Record<string, string>;
      displayOrder: number;
      active: boolean;
    }[];
    expect(rows.map(({ id, ...row }) => ({ ...row, hasId: typeof id === "string" }))).toEqual([
      { menuId, name: { es: "Bebidas" }, displayOrder: 1, active: true, hasId: true },
      { menuId, name: { es: "Postres" }, displayOrder: 2, active: true, hasId: true },
    ]);
    expect(
      (await send(app, "GET", `/management-api/catalogues/${crypto.randomUUID()}/sections`)).status,
    ).toBe(404);
    expect((await send(app, "GET", "/management-api/catalogues/bad-id/sections")).status).toBe(400);
  });
});

describe("catalogue API tenant authorization", () => {
  it("refuses editing an item through a group it does not belong to", async () => {
    const app = mountApp();
    const ownA = await createGroupVia(app, { name: { es: "A" } });
    const ownB = await createGroupVia(app, { name: { es: "B" } });
    const ownItem = await suite.db.execute<{ id: string }>(
      sql`insert into option_group_items (group_id, name) values (${ownA.id}, '{"es":"Original"}'::jsonb) returning id`,
    );
    expect(
      (
        await send(
          app,
          "PATCH",
          `/management-api/option-groups/${ownB.id}/items/${ownItem.rows[0]!.id}`,
          { body: { name: { es: "Cambio" } } },
        )
      ).status,
    ).toBe(403);
    const names = await suite.db.execute(
      sql`select name from option_group_items where id = ${ownItem.rows[0]!.id}`,
    );
    expect(names.rows).toEqual([{ name: { es: "Original" } }]);
  });
});

it("authors translated hierarchy and shares full membership replacement through the API", async () => {
  const app = mountApp("en-GB");
  await suite.db.execute(sql`delete from content_languages`);
  const created = await send(app, "POST", "/management-api/categories", {
    body: { name: { en: "Food", fr: "Cuisine" }, parentId: null, image: null },
  });
  expect(created.status).toBe(201);
  const category = (await created.json()) as { id: string };
  const path = `/management-api/categories/${category.id}`;
  expect(await (await send(app, "GET", path)).json()).toEqual({
    id: category.id,
    name: { en: "Food", fr: "Cuisine" },
    parentId: null,
    image: null,
    color: null,
  });
  expect((await send(app, "PATCH", path, { body: { parentId: category.id } })).status).toBe(400);
  const catalogueId = await createCatalogueVia(app, "Membership menu");
  const response = await send(app, "POST", "/management-api/products", {
    body: {
      catalogueId,
      categoryId: null,
      name: "Toast",
      unitPrice: "2",
      pricingUnit: "each",
      vatClass: "general",
    },
  });
  expect(response.status).toBe(201);
  const product = (await response.json()) as { id: string };
  const memberships = `/management-api/products/${product.id}/categories`;
  expect(
    await (await send(app, "PUT", memberships, { body: { categoryIds: [category.id] } })).json(),
  ).toEqual({ categoryIds: [category.id], primaryCategoryId: category.id });
  expect(
    ((await (await send(app, "GET", `${path}/products`)).json()) as { id: string }[]).map(
      (p) => p.id,
    ),
  ).toEqual([product.id]);
  // Deleting a category that still has a member product CASCADES rather than refusing: the
  // membership goes with it and the product survives, having lost its reporting category.
  expect((await send(app, "DELETE", path)).status).toBe(204);
  expect(await (await send(app, "GET", memberships)).json()).toEqual({
    categoryIds: [],
    primaryCategoryId: null,
  });
  expect(
    (await send(app, "PUT", memberships, { body: { categoryIds: [] }, cookie: staffCookie }))
      .status,
  ).toBe(403);
  expect((await send(app, "GET", path, { cookie: null })).status).toBe(401);
  expect((await send(app, "PUT", memberships, { body: { categoryIds: [] } })).status).toBe(200);
  expect((await send(app, "GET", path)).status).toBe(404);
});
