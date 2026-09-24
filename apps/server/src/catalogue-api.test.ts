import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, catalogues, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, persons, startManagementSession } from "@waitron/identity";
import { CATALOGUE_MIGRATIONS, contentLanguages, menuSections } from "@waitron/catalogue";
import type { ExtraList, OptionList } from "@waitron/catalogue";
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

// This suite proves the ROUTES — the request/response boundary, the body + id screens, the
// permission gate wiring — end to end in-process, the same way `till-api.test.ts` proves the till
// routes. The catalogue tables live in CORE_MIGRATIONS and the management session/persons in
// IDENTITY_MIGRATIONS, and every DB touch runs `withTransaction` exactly as production does. The
// gate-by-DELETION proof (removing `authorizeManager` turns the staff refusals green→red) is
// `catalogue-api.full-manifest.test.ts`.
const noopLog: Logger = () => {};

let locationId: string;
let managerCookie: string;
let staffCookie: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    await seedLegacySellingUnits(db);
    // One location for the tenant, seeded as the owner (fixture setup like seedTenant) so
    // the location↔menu membership routes have a `:locationId` to act on. Minimal required columns only.
    // Through the table definition: `locations.id` is a `$defaultFn` generator on this engine, which
    // a raw insert never reaches, and `invoice_locales` is encoded by the column's own write mapping
    // — the `array[...]` constructor it replaces is a syntax error here.
    const [loc] = await db
      .insert(locations)
      .values({ name: "Main", invoiceLocales: ["es-ES"], operationDescription: "Venta" })
      .returning({ id: locations.id });
    locationId = loc!.id;
    // Seed a MANAGER (role `manager`, holds `person.manage`) and a STAFF person (role `staff`,
    // holds nothing) under the tenant, then mint a live management session for each so the route
    // tests can drive the gate through a real cookie. `pin_hash` is NOT NULL, so a value is
    // supplied even though these sessions are minted directly rather than via a PIN/password login.
    const { managerSid, staffSid } = await withTransaction(db, async (tx) => {
      const [mgr] = await tx
        .insert(persons)
        .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
        .returning({ id: persons.id });
      const [stf] = await tx
        .insert(persons)
        .values({ displayName: "The Clerk", pinHash: hashPin("1234"), role: "staff" })
        .returning({ id: persons.id });
      const managerSession = await startManagementSession(tx, {
        personId: mgr!.id,
      });
      const staffSession = await startManagementSession(tx, {
        personId: stf!.id,
      });
      return { managerSid: managerSession.token, staffSid: staffSession.token };
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

/** A live kitchen station and course of the seeded venue. */
async function seedRouting(): Promise<{ stationId: string; courseId: string }> {
  return withTransaction(suite.db, async (tx) => {
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

  it("requires the configured default for a new product's customer-facing name", async () => {
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
  // The location's default + member rows are the ONLY state shared across these tests (one venue
  // file for the whole file); every catalogue a test creates gets a fresh id. Reset both so the tests
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
      active: true,
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
          active: true,
        },
        {
          name: "Sencillo",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: "2.00",
          available: true,
          active: true,
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
          variants: [{ variantId: saved.variants[0]!.id, price: "4.10", offered: true }],
        },
      },
    );
    expect(published.status).toBe(200);
    // Every Active variant is listed, the one this menu sets nothing for with the defaults.
    expect(await published.json()).toEqual([
      { variantId: saved.variants[0]!.id, price: "4.10", offered: true },
      { variantId: saved.variants[1]!.id, price: null, offered: true },
    ]);
    const malformed = await send(
      app,
      "PUT",
      `/management-api/catalogues/${catalogueId}/items/${offerId}/variants`,
      { body: { variants: [{ variantId: saved.variants[0]!.id, price: 4.1, offered: true }] } },
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "variants.0" } },
    });
    // A variant follows its parent onto the menu; it is never put there on its own.
    const variantOffer = await send(
      app,
      "POST",
      `/management-api/catalogues/${catalogueId}/items`,
      {
        body: { productId: saved.variants[0]!.id, sectionId, grossPrice: "4.00", displayOrder: 1 },
      },
    );
    expect(variantOffer.status).toBe(400);
    expect(await variantOffer.json()).toMatchObject({
      error: {
        code: "menu_item.variant_not_allowed",
        params: { productId: saved.variants[0]!.id },
      },
    });
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
      expect.objectContaining({ id: saved.variants[0]!.id, unitPrice: "4.10", menuPrice: "4.10" }),
      expect.objectContaining({ id: saved.variants[1]!.id, unitPrice: "2.00", menuPrice: null }),
    ]);
    await send(app, "PUT", `/management-api/catalogues/${catalogueId}/items/${offerId}/variants`, {
      body: { variants: [] },
    });
    const updated = await send(app, "PUT", `/management-api/products/${saved.id}/editor`, {
      body: { ...value, available: false, kitchenName: null, variants: [] },
    });
    expect(updated.status).toBe(200);
    // Left out of the body, both variants are kept, Inactive, and read back so.
    expect(await updated.json()).toMatchObject({
      available: false,
      kitchenName: null,
      variants: [
        { id: saved.variants[0]!.id, active: false },
        { id: saved.variants[1]!.id, active: false },
      ],
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
      active: true,
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

  // A variant is a `products` row. Its own page (the editor routes) reads and writes it; every other
  // management route that reads or writes a product by id answers exactly what it answers for an id
  // that names nothing.
  it("refuses a variant's id on every product-by-id route but its own page, and accepts its parent's", async () => {
    const app = mountApp("es-ES");
    const catalogueId = await createCatalogueVia(app, "Variant ids");
    const categoryId = await createCategoryVia(app, { es: `Vinos ${crypto.randomUUID()}` });
    const variant = {
      name: "Copa",
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: "3.25",
      available: true,
      active: true,
    };
    const created = await send(
      app,
      "POST",
      `/management-api/catalogues/${catalogueId}/product-editor`,
      { body: await editorBody(app, { name: "Vino", vatClass: "reduced", variants: [variant] }) },
    );
    expect(created.status).toBe(201);
    const parent = (await created.json()) as { id: string; variants: { id: string }[] };
    const variantId = parent.variants[0]!.id;
    const variantRow = async () =>
      (
        await suite.db.execute<{ vat_class: string | null; category_id: string | null }>(
          sql`select vat_class, category_id from products where id = ${variantId}`,
        )
      ).rows[0];
    const notFound = { error: { code: "product.not_found", params: { productId: variantId } } };

    const readVariant = await send(app, "GET", `/management-api/products/${variantId}/editor`);
    expect(readVariant.status).toBe(200);
    expect(await readVariant.json()).toMatchObject({ id: variantId, parentId: parent.id });
    expect((await send(app, "GET", `/management-api/products/${parent.id}/editor`)).status).toBe(
      200,
    );

    // A variant offers its parent's lists and has no variants of its own.
    const saveVariant = await send(app, "PUT", `/management-api/products/${variantId}/editor`, {
      body: await editorBody(app, { name: "Copa", vatClass: "general", variants: [variant] }),
    });
    expect(saveVariant.status).toBe(400);
    expect(await saveVariant.json()).toMatchObject({
      error: { code: "product.invalid", params: { field: "variants" } },
    });
    expect(
      (await suite.db.execute(sql`select id from products where parent_id = ${variantId}`)).rows,
    ).toEqual([]);

    const patchVariant = await send(app, "PATCH", `/management-api/products/${variantId}`, {
      body: { vatClass: "general" },
    });
    expect(patchVariant.status).toBe(403);
    expect(await patchVariant.json()).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
    expect(await variantRow()).toEqual({ vat_class: null, category_id: null });
    expect(
      (
        await send(app, "PATCH", `/management-api/products/${parent.id}`, {
          body: { vatClass: "general" },
        })
      ).status,
    ).toBe(204);

    const readCategories = await send(
      app,
      "GET",
      `/management-api/products/${variantId}/categories`,
    );
    expect(readCategories.status).toBe(404);
    expect(await readCategories.json()).toMatchObject(notFound);
    const membership = { categoryIds: [categoryId], primaryCategoryId: categoryId };
    const writeCategories = await send(
      app,
      "PUT",
      `/management-api/products/${variantId}/categories`,
      { body: membership },
    );
    expect(writeCategories.status).toBe(404);
    expect(await writeCategories.json()).toMatchObject(notFound);
    const addToCategory = await send(
      app,
      "POST",
      `/management-api/categories/${categoryId}/products`,
      { body: { productIds: [variantId] } },
    );
    expect(addToCategory.status).toBe(400);
    expect(await addToCategory.json()).toMatchObject({
      error: { code: "category.membership_invalid" },
    });
    expect(await variantRow()).toEqual({ vat_class: null, category_id: null });
    expect(
      (
        await suite.db.execute(
          sql`select product_id from product_categories where product_id = ${variantId}`,
        )
      ).rows,
    ).toEqual([]);

    expect(
      (await send(app, "GET", `/management-api/products/${parent.id}/categories`)).status,
    ).toBe(200);
    expect(
      (
        await send(app, "POST", `/management-api/categories/${categoryId}/products`, {
          body: { productIds: [parent.id] },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await send(app, "PUT", `/management-api/products/${parent.id}/categories`, {
          body: membership,
        })
      ).status,
    ).toBe(200);
    const saveParent = await send(app, "PUT", `/management-api/products/${parent.id}/editor`, {
      body: await editorBody(app, { name: "Vino", vatClass: "reduced", variants: [variant] }),
    });
    expect(saveParent.status).toBe(200);
  });

  /** A parent product with one variant, each with three different names of its own. */
  async function parentWithVariant(app: Hono): Promise<{
    parentId: string;
    variantId: string;
    categoryId: string;
    ownCategoryId: string;
  }> {
    const catalogueId = await createCatalogueVia(app, "Variant page");
    const categoryId = await createCategoryVia(app, { es: `Cafés ${crypto.randomUUID()}` });
    const ownCategoryId = await createCategoryVia(app, { es: `Solos ${crypto.randomUUID()}` });
    const created = await send(
      app,
      "POST",
      `/management-api/catalogues/${catalogueId}/product-editor`,
      {
        body: await editorBody(app, {
          name: "Café",
          customerName: { es: "Café de la casa" },
          kitchenName: "CAFE",
          description: { es: "Tostado natural" },
          unitPrice: "2.00",
          vatClass: "reduced",
          categoryIds: [categoryId],
          primaryCategoryId: categoryId,
          allergens: { milk: { presence: "contains" } },
          dietaryDeclarations: ["vegan"],
          variants: [
            {
              name: "Café doble",
              customerName: { es: "Doble de la casa" },
              kitchenName: "DOBLE",
              image: null,
              unitPrice: "2.40",
              available: true,
              active: true,
            },
          ],
        }),
      },
    );
    expect(created.status).toBe(201);
    const parent = (await created.json()) as { id: string; variants: { id: string }[] };
    return { parentId: parent.id, variantId: parent.variants[0]!.id, categoryId, ownCategoryId };
  }

  it("reads a variant's own page: its own names, its blanks blank, its parent's values beside", async () => {
    const app = mountApp("es-ES");
    const { parentId, variantId, categoryId } = await parentWithVariant(app);
    const read = await send(app, "GET", `/management-api/products/${variantId}/editor`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      id: variantId,
      parentId,
      name: "Café doble",
      customerName: { es: "Doble de la casa" },
      kitchenName: "DOBLE",
      description: null,
      unitPrice: "2.40",
      vatClass: null,
      categoryIds: [],
      primaryCategoryId: null,
      allergens: null,
      dietaryDeclarations: null,
      modifiers: [],
      variants: [],
      inherited: {
        description: { es: "Tostado natural" },
        unitPrice: "2.00",
        vatClass: "reduced",
        categoryIds: [categoryId],
        primaryCategoryId: categoryId,
        allergens: { milk: { presence: "contains" } },
        dietaryDeclarations: ["vegan"],
      },
    });
  });

  it("saves a variant's override, and a blank returns the field to inheriting", async () => {
    const app = mountApp("es-ES");
    const { variantId, ownCategoryId } = await parentWithVariant(app);
    const { stationId, courseId } = await seedRouting();
    const value = (await (
      await send(app, "GET", `/management-api/products/${variantId}/editor`)
    ).json()) as Record<string, unknown>;
    const stored = async () =>
      (
        await suite.db.execute<Record<string, unknown>>(
          sql`select vat_class, unit_price, category_id, manual_allergens, station_id,
                (select count(*) from product_categories where product_id = ${variantId}) as memberships
              from products where id = ${variantId}`,
        )
      ).rows[0];
    const blank = {
      vat_class: null,
      unit_price: null,
      category_id: null,
      manual_allergens: null,
      station_id: null,
      memberships: 0,
    };

    const kept = await send(app, "PUT", `/management-api/products/${variantId}/editor`, {
      body: value,
    });
    expect(kept.status).toBe(200);
    expect(await stored()).toEqual({ ...blank, unit_price: 240 });
    const blankPrice = await send(app, "PUT", `/management-api/products/${variantId}/editor`, {
      body: { ...value, unitPrice: null },
    });
    expect(blankPrice.status).toBe(200);
    expect(await blankPrice.json()).toMatchObject({ unitPrice: null, inherited: value.inherited });
    expect(await stored()).toEqual(blank);

    const overridden = await send(app, "PUT", `/management-api/products/${variantId}/editor`, {
      body: {
        ...value,
        vatClass: "general",
        unitPrice: "2.60",
        categoryIds: [ownCategoryId],
        primaryCategoryId: ownCategoryId,
        allergens: { eggs: { presence: "contains" } },
        stationId,
        courseId,
      },
    });
    expect(overridden.status).toBe(200);
    expect(await overridden.json()).toMatchObject({
      vatClass: "general",
      unitPrice: "2.60",
      categoryIds: [ownCategoryId],
      allergens: { eggs: { presence: "contains" } },
      stationId,
      courseId,
    });
    expect(await stored()).toEqual({
      vat_class: "general",
      unit_price: 260,
      category_id: ownCategoryId,
      manual_allergens: JSON.stringify({ eggs: { presence: "contains" } }),
      station_id: stationId,
      memberships: 1,
    });

    const cleared = await send(app, "PUT", `/management-api/products/${variantId}/editor`, {
      body: { ...value, unitPrice: null, stationId: null, courseId: null },
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ ...value, unitPrice: null });
    expect(await stored()).toEqual(blank);
  });

  it("keeps a removed variant Inactive through the parent's page, and restores it when sent Active", async () => {
    const app = mountApp("es-ES");
    const { parentId } = await parentWithVariant(app);
    type Editor = { variants: Record<string, unknown>[] };
    const read = async () =>
      (await (
        await send(app, "GET", `/management-api/products/${parentId}/editor`)
      ).json()) as Editor;
    const put = (body: unknown) =>
      send(app, "PUT", `/management-api/products/${parentId}/editor`, { body });
    const flags = (value: Editor) => value.variants.map(({ name, active }) => ({ name, active }));
    const corto = {
      name: "Café corto",
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: null,
      available: true,
      active: false,
    };
    const parent = await read();
    expect((await put({ ...parent, variants: [...parent.variants, corto] })).status).toBe(200);
    const saved = await read();
    expect(flags(saved)).toEqual([
      { name: "Café doble", active: true },
      { name: "Café corto", active: false },
    ]);

    expect((await put(saved)).status).toBe(200);
    expect(flags(await read())).toEqual(flags(saved));

    const noActive = { ...saved.variants[1] };
    delete noActive.active;
    const refused = await put({ ...saved, variants: [saved.variants[0], noActive] });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: { code: "product.invalid", params: { field: "variants.1.active" } },
    });

    const restored = await put({
      ...saved,
      variants: [saved.variants[0], { ...saved.variants[1], active: true }],
    });
    expect(restored.status).toBe(200);
    expect(flags(await read())).toEqual([
      { name: "Café doble", active: true },
      { name: "Café corto", active: true },
    ]);
  });

  it("checks a variant's customer name against the default language only when it is saved Active", async () => {
    const app = mountApp("es-ES");
    const { parentId } = await parentWithVariant(app);
    const parent = (await (
      await send(app, "GET", `/management-api/products/${parentId}/editor`)
    ).json()) as { variants: Record<string, unknown>[] };
    // French only: it names neither the venue's default language nor any fallback.
    const french = {
      name: "Café corto",
      customerName: { fr: "Café court" },
      kitchenName: null,
      image: null,
      unitPrice: null,
      available: true,
    };
    const put = (active: boolean) =>
      send(app, "PUT", `/management-api/products/${parentId}/editor`, {
        body: { ...parent, variants: [...parent.variants, { ...french, active }] },
      });
    expect((await put(false)).status).toBe(200);
    const refused = await put(true);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: { code: "content.translation_required" },
    });
  });

  it("saves a variant's own page Inactive without the default language, and refuses it Active", async () => {
    const app = mountApp("es-ES");
    const { parentId } = await parentWithVariant(app);
    const editor = async (id: string) =>
      (await (await send(app, "GET", `/management-api/products/${id}/editor`)).json()) as {
        variants: { id: string; name: string }[];
      } & Record<string, unknown>;
    const parent = await editor(parentId);
    const french = {
      name: "Café corto",
      customerName: { fr: "Café court" },
      kitchenName: null,
      image: null,
      unitPrice: null,
      available: true,
      active: false,
    };
    expect(
      (
        await send(app, "PUT", `/management-api/products/${parentId}/editor`, {
          body: { ...parent, variants: [...parent.variants, french] },
        })
      ).status,
    ).toBe(200);
    const { id } = (await editor(parentId)).variants.find(({ name }) => name === "Café corto")!;
    const own = await editor(id);
    const put = (active: boolean) =>
      send(app, "PUT", `/management-api/products/${id}/editor`, { body: { ...own, active } });
    const removed = await put(false);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({
      customerName: { fr: "Café court" },
      active: false,
    });
    const refused = await put(true);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: { code: "content.translation_required" },
    });
  });

  it("lists every variant, a removed one too, with its own price and its effective price, VAT and categories", async () => {
    const app = mountApp("es-ES");
    const { parentId, variantId, categoryId, ownCategoryId } = await parentWithVariant(app);
    // Café doble sets its own price (2.40, where the parent's is 2.00), and here its own VAT class
    // and category; Café corto, added Inactive, leaves all three blank.
    const own = (await (
      await send(app, "GET", `/management-api/products/${variantId}/editor`)
    ).json()) as Record<string, unknown>;
    expect(
      (
        await send(app, "PUT", `/management-api/products/${variantId}/editor`, {
          body: {
            ...own,
            vatClass: "general",
            categoryIds: [ownCategoryId],
            primaryCategoryId: ownCategoryId,
          },
        })
      ).status,
    ).toBe(200);
    const parent = (await (
      await send(app, "GET", `/management-api/products/${parentId}/editor`)
    ).json()) as { variants: unknown[] };
    const corto = {
      name: "Café corto",
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: null,
      available: true,
      active: false,
    };
    expect(
      (
        await send(app, "PUT", `/management-api/products/${parentId}/editor`, {
          body: { ...parent, variants: [...parent.variants, corto] },
        })
      ).status,
    ).toBe(200);

    const listed = (await (await send(app, "GET", "/management-api/products")).json()) as {
      id: string;
      unitPrice: string;
      vatClass: string;
      variants: unknown[];
    }[];
    const row = listed.find((product) => product.id === parentId)!;
    expect(row).toMatchObject({ unitPrice: "2.00", vatClass: "reduced" });
    expect(row.variants).toEqual([
      expect.objectContaining({
        id: variantId,
        name: "Café doble",
        active: true,
        unitPrice: "2.40",
        effective: {
          unitPrice: "2.40",
          vatClass: "general",
          primaryCategoryId: ownCategoryId,
          categoryIds: [ownCategoryId],
        },
      }),
      expect.objectContaining({
        name: "Café corto",
        active: false,
        unitPrice: null,
        effective: {
          unitPrice: "2.00",
          vatClass: "reduced",
          primaryCategoryId: categoryId,
          categoryIds: [categoryId],
        },
      }),
    ]);
  });

  it("saves the parent's page back unchanged after its variant's price was blanked", async () => {
    const app = mountApp("es-ES");
    const { parentId, variantId } = await parentWithVariant(app);
    const value = (await (
      await send(app, "GET", `/management-api/products/${variantId}/editor`)
    ).json()) as Record<string, unknown>;
    expect(
      (
        await send(app, "PUT", `/management-api/products/${variantId}/editor`, {
          body: { ...value, unitPrice: null },
        })
      ).status,
    ).toBe(200);
    const parent = (await (
      await send(app, "GET", `/management-api/products/${parentId}/editor`)
    ).json()) as { variants: { unitPrice: string | null }[] };
    expect(parent.variants.map((variant) => variant.unitPrice)).toEqual([null]);
    const saved = await send(app, "PUT", `/management-api/products/${parentId}/editor`, {
      body: parent,
    });
    expect(saved.status).toBe(200);
    expect(
      ((await saved.json()) as typeof parent).variants.map((variant) => variant.unitPrice),
    ).toEqual([null]);
    expect(
      (
        await suite.db.execute<{ unit_price: number | null }>(
          sql`select unit_price from products where id = ${variantId}`,
        )
      ).rows,
    ).toEqual([{ unit_price: null }]);
  });

  it.each(["vatClass", "unitPrice"] as const)(
    "refuses a blank %s on a product with no parent",
    async (field) => {
      const app = mountApp("es-ES");
      const { parentId } = await parentWithVariant(app);
      const refused = await send(app, "PUT", `/management-api/products/${parentId}/editor`, {
        body: await editorBody(app, { [field]: null }),
      });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({
        error: { code: "product.invalid", params: { field } },
      });
    },
  );

  it("refuses a body whose parent is not the stored one (V10)", async () => {
    const app = mountApp("es-ES");
    const { parentId, variantId } = await parentWithVariant(app);
    const value = (await (
      await send(app, "GET", `/management-api/products/${variantId}/editor`)
    ).json()) as Record<string, unknown>;
    const invalidParent = {
      error: { code: "product.invalid", params: { field: "parentId" } },
    };
    for (const [id, body] of [
      [variantId, { ...value, parentId: crypto.randomUUID() }],
      [variantId, { ...value, parentId: null }],
      [parentId, await editorBody(app, { parentId: variantId })],
    ] as const) {
      const refused = await send(app, "PUT", `/management-api/products/${id}/editor`, { body });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject(invalidParent);
    }
    const catalogueId = await createCatalogueVia(app, "Variant create");
    const create = await send(
      app,
      "POST",
      `/management-api/catalogues/${catalogueId}/product-editor`,
      { body: await editorBody(app, { parentId }) },
    );
    expect(create.status).toBe(400);
    expect(await create.json()).toMatchObject(invalidParent);
  });

  it("refuses attached lists on a variant, which offers its parent's", async () => {
    const app = mountApp("es-ES");
    const { variantId } = await parentWithVariant(app);
    const value = (await (
      await send(app, "GET", `/management-api/products/${variantId}/editor`)
    ).json()) as Record<string, unknown>;
    const refused = await send(app, "PUT", `/management-api/products/${variantId}/editor`, {
      body: { ...value, modifiers: [{ kind: "extras", id: crypto.randomUUID() }] },
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: { code: "product.invalid", params: { field: "modifiers" } },
    });
  });

  // Spec §15.6: the editor writes Active and Available as two separate states. Each save sets the
  // two to DIFFERENT values, so a route that writes one flag into the other column fails.
  it("writes Active and Available as two states through the editor routes", async () => {
    const app = mountApp("es-ES");
    const catalogueId = await createCatalogueVia(app, "Two states");
    const created = await send(
      app,
      "POST",
      `/management-api/catalogues/${catalogueId}/product-editor`,
      { body: await editorBody(app, { active: true, available: false }) },
    );
    expect(created.status).toBe(201);
    const saved = (await created.json()) as { id: string };
    expect(saved).toMatchObject({ active: true, available: false });

    const updated = await send(app, "PUT", `/management-api/products/${saved.id}/editor`, {
      body: await editorBody(app, { active: false, available: true }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ active: false, available: true });
    const read = await send(app, "GET", `/management-api/products/${saved.id}/editor`);
    expect(await read.json()).toMatchObject({ active: false, available: true });
    const listed = await send(app, "GET", `/management-api/catalogues/${catalogueId}/products`);
    expect(await listed.json()).toEqual([
      expect.objectContaining({ id: saved.id, active: false, available: true }),
    ]);

    const withoutActive = await editorBody(app);
    delete withoutActive.active;
    const refused = await send(app, "PUT", `/management-api/products/${saved.id}/editor`, {
      body: withoutActive,
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: { code: "product.invalid", params: { field: "active" } },
    });
  });

  // Spec §15.6: Available "never hides the item from the dashboard", so the menu management route
  // keeps a sold-out product's offer; an Inactive product's offer stays hidden, as it was before
  // the two states were split.
  it("keeps an Unavailable product's offer on the management offers route and hides an Inactive one", async () => {
    const app = mountApp("es-ES");
    const catalogueId = await createCatalogueVia(app, "Management offers");
    const created = await send(
      app,
      "POST",
      `/management-api/catalogues/${catalogueId}/product-editor`,
      { body: await editorBody(app) },
    );
    const productId = ((await created.json()) as { id: string }).id;
    const section = await send(app, "POST", `/management-api/catalogues/${catalogueId}/sections`, {
      body: { name: { en: "Tapas", es: "Tapas" }, displayOrder: 0 },
    });
    const sectionId = ((await section.json()) as { id: string }).id;
    const offer = await send(app, "POST", `/management-api/catalogues/${catalogueId}/items`, {
      body: { productId, sectionId, grossPrice: "4.50", displayOrder: 0 },
    });
    expect(offer.status).toBe(201);
    const offerId = ((await offer.json()) as { id: string }).id;
    const offeredIds = async (): Promise<string[]> =>
      (
        (await (
          await send(app, "GET", `/management-api/catalogues/${catalogueId}/offers`)
        ).json()) as { id: string }[]
      ).map((row) => row.id);

    const soldOut = await send(app, "PUT", `/management-api/products/${productId}/editor`, {
      body: await editorBody(app, { active: true, available: false }),
    });
    expect(soldOut.status).toBe(200);
    expect(await offeredIds()).toEqual([offerId]);

    const deleted = await send(app, "PUT", `/management-api/products/${productId}/editor`, {
      body: await editorBody(app, { active: false, available: true }),
    });
    expect(deleted.status).toBe(200);
    expect(await offeredIds()).toEqual([]);
  });

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

  it("POST /management-api/products with available:false → 201, a sold-out product that stays active", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Create-unavailable catalogue");
    const res = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Agotado",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
        available: false,
      },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ active: true, available: false });
  });

  it("PATCH /management-api/products/:id with available:false stores it and leaves active unchanged", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Patch-unavailable catalogue");
    const createRes = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Se agota",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      },
    });
    const productId = ((await createRes.json()) as { id: string }).id;

    const res = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: { available: false },
    });
    expect(res.status).toBe(204);
    const list = await send(app, "GET", `/management-api/catalogues/${catalogueId}/products`);
    expect(await list.json()).toEqual([
      expect.objectContaining({ id: productId, active: true, available: false }),
    ]);
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

    // A customer name with no text in the venue's default content language is a translation gap,
    // not a clear.
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

  it("PATCH /management-api/products/:id naming no stored product → authorization.not_permitted 403", async () => {
    // Pins the route's existing refusal, which is the pre-read's alone: `updateProduct`
    // (packages/catalogue/src/operations.ts) runs a bare `update products … where id = $1` and
    // reports nothing when no row matches, so without the pre-read this body would answer 204
    // having written nothing.
    const res = await send(
      mountApp(),
      "PATCH",
      `/management-api/products/11111111-1111-4111-8111-111111111111`,
      { body: { unitPrice: "1.00" } },
    );
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
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
    ["available", { ...productBase, available: "nope" }],
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
    ["available", { available: "yes" }],
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
  // opaque 500 — the same guard the management routes carry (management-api.accounts-and-receipt-config.test.ts).
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

describe("mountCatalogueApi — attaching extras and options lists to products", () => {
  // A product body carries one ordered `modifiers` list, each entry naming a KIND (`extras` or
  // `options`) and a list id, written to `product_modifiers`. Two of the cases below are about the
  // two flat fields it replaced: they are refused by name, never ignored.
  async function createOptionsListVia(
    app: Hono,
    body: Record<string, unknown>,
  ): Promise<OptionList> {
    const res = await send(app, "POST", "/management-api/modifiers/options", { body });
    expect(res.status).toBe(201);
    return ((await res.json()) as { optionList: OptionList }).optionList;
  }

  async function createExtrasListVia(
    app: Hono,
    catalogueId: string,
    name: string,
  ): Promise<ExtraList> {
    const productId = await createProductVia(app, catalogueId);
    const res = await send(app, "POST", "/management-api/modifiers/extras", {
      body: { name, items: [{ productId }] },
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { extraList: ExtraList }).extraList;
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

  it("answers the 201 with the list as STORED, not as sent, when a list id arrives in upper case", async () => {
    // `writeProductModifiers` lower-cases every list id before it writes (product-modifiers.ts), so
    // a 201 echoing the request would tell the caller its attachments are held in a casing the
    // database does not have — and the caller's own next read would disagree with the answer it
    // was just given. The `expect(created).not.toEqual(sent)` line is the control: it fails if the
    // fixture stops being upper-cased and the case silently stops testing anything.
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Menú en mayúsculas");
    const options = await createOptionsListVia(app, {
      name: "Punto",
      labels: [{ name: "Poco hecho" }],
    });
    const sent = [{ kind: "options", id: options.id.toUpperCase() }];
    const createRes = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Solomillo",
        pricingUnit: "each",
        unitPrice: "21.00",
        vatClass: "general",
        modifiers: sent,
      },
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; modifiers: unknown };
    expect(created.modifiers).not.toEqual(sent);
    expect(created.modifiers).toEqual([{ kind: "options", id: options.id }]);
    expect(await readModifiers(app, catalogueId, created.id)).toEqual(created.modifiers);
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
    // A repeat is REFUSED, not collapsed: `product.invalid` naming the entry, so the caller is told
    // rather than quietly saved something it did not send.
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

/**
 * Extras lists over the management API. What the CRUD itself does is proven in the catalogue package
 * (`packages/catalogue/src/extras.test.ts`); what is proven HERE is the request/response boundary —
 * the status codes, the `{ extraList }` / `{ extraLists }` envelopes, the uuid screen, the venue's
 * fallback language reaching the write, and the permission gate. The sibling suite for option lists
 * is directly above.
 */
describe("mountCatalogueApi — extras lists", () => {
  // The same shared-database insurance the option-list block above takes, and for the same reason:
  // a content-language configuration another describe left behind would decide what
  // `createExtraList` demands of the customer-facing name map. Emptying the table puts
  // `readContentLanguages` on the mounted venue locale.
  beforeEach(async () => {
    await suite.db.execute(sql`delete from content_languages`);
  });

  /** Two products a list can offer. Each gets a catalogue of its own; only the ids matter here. */
  async function twoProducts(app: Hono): Promise<[string, string]> {
    return [
      await createNamedProductVia(app, `Alioli ${crypto.randomUUID()}`),
      await createNamedProductVia(app, `Brava ${crypto.randomUUID()}`),
    ];
  }

  /**
   * Staff, customer-facing and kitchen name are DIFFERENT text, so a response reading the wrong one
   * of the three cannot pass these assertions (CLAUDE.md §3). The two items differ in every field a
   * response could confuse — quantity cap, preselection and price — for the same reason.
   */
  const sauces = (productIds: string[]) => ({
    name: "Salsas",
    customerName: { es: "¿Alguna salsa?" },
    kitchenName: "SALSA",
    minPicks: 0,
    maxPicks: 2,
    items: productIds.map((productId, index) => ({
      productId,
      maxQuantity: index + 1,
      preselected: index === 0,
      price: index === 0 ? "0.50" : null,
    })),
  });

  async function createListVia(app: Hono, body: Record<string, unknown>): Promise<ExtraList> {
    const res = await send(app, "POST", "/management-api/modifiers/extras", { body });
    expect(res.status).toBe(201);
    return ((await res.json()) as { extraList: ExtraList }).extraList;
  }

  it("POST creates a list (201) with all three names, its bounds and its items in body order", async () => {
    const app = mountApp();
    const [alioli, brava] = await twoProducts(app);
    const list = await createListVia(app, sauces([alioli, brava]));
    expect(list).toMatchObject({
      name: "Salsas",
      customerName: { es: "¿Alguna salsa?" },
      kitchenName: "SALSA",
      minPicks: 0,
      maxPicks: 2,
      active: true,
    });
    expect(
      list.items.map((item) => [item.productId, item.maxQuantity, item.preselected, item.price]),
    ).toEqual([
      [alioli, 1, true, "0.50"],
      [brava, 2, false, null],
    ]);
  });

  it("GET /management-api/modifiers/extras lists them", async () => {
    const app = mountApp();
    const [alioli] = await twoProducts(app);
    const list = await createListVia(app, { ...sauces([alioli]), name: "Lista listada" });
    const res = await send(app, "GET", "/management-api/modifiers/extras");
    expect(res.status).toBe(200);
    const { extraLists } = (await res.json()) as { extraLists: ExtraList[] };
    expect(extraLists.find((row) => row.id === list.id)).toMatchObject({
      name: "Lista listada",
      kitchenName: "SALSA",
      items: [{ productId: alioli, price: "0.50" }],
    });
  });

  it("GET /management-api/modifiers/extras/:id reads one back", async () => {
    const app = mountApp();
    const [alioli, brava] = await twoProducts(app);
    const list = await createListVia(app, { ...sauces([alioli, brava]), name: "Lista leída" });
    const res = await send(app, "GET", `/management-api/modifiers/extras/${list.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      extraList: {
        id: list.id,
        name: "Lista leída",
        customerName: { es: "¿Alguna salsa?" },
        kitchenName: "SALSA",
        items: [{ productId: alioli }, { productId: brava }],
      },
    });
  });

  it("PATCH replaces the list — a rename, a reorder and a reprice come back in the new order", async () => {
    const app = mountApp();
    const [alioli, brava] = await twoProducts(app);
    const list = await createListVia(app, { ...sauces([alioli, brava]), name: "Lista reordenada" });
    const [first, second] = list.items;
    const res = await send(app, "PATCH", `/management-api/modifiers/extras/${list.id}`, {
      body: {
        name: "Lista reordenada y renombrada",
        customerName: { es: "¿Dos salsas?" },
        kitchenName: "SALSA2",
        minPicks: 1,
        maxPicks: 3,
        items: [
          { id: second!.id, productId: brava, maxQuantity: 4, preselected: true, price: "1.25" },
          { id: first!.id, productId: alioli, maxQuantity: 1, preselected: false, price: null },
        ],
      },
    });
    expect(res.status).toBe(200);
    const { extraList } = (await res.json()) as { extraList: ExtraList };
    expect(extraList).toMatchObject({
      name: "Lista reordenada y renombrada",
      customerName: { es: "¿Dos salsas?" },
      kitchenName: "SALSA2",
      minPicks: 1,
      maxPicks: 3,
    });
    expect(extraList.items.map((item) => [item.id, item.productId, item.price])).toEqual([
      [second!.id, brava, "1.25"],
      [first!.id, alioli, null],
    ]);
  });

  it("DELETE answers { ok: true } and the list is then gone", async () => {
    const app = mountApp();
    const [alioli] = await twoProducts(app);
    const list = await createListVia(app, { ...sauces([alioli]), name: "Lista borrada" });
    const res = await send(app, "DELETE", `/management-api/modifiers/extras/${list.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const gone = await send(app, "GET", `/management-api/modifiers/extras/${list.id}`);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ error: { code: "extras.not_found" } });
  });

  it("refuses an invalid body with 400 and the domain code, naming the field", async () => {
    const app = mountApp();
    const [alioli] = await twoProducts(app);
    const item = { productId: alioli };
    for (const [body, field] of [
      [{ name: "   ", items: [item] }, "name"],
      // An ACTIVE list with no product cannot be answered, so the contract refuses it.
      [{ name: "Sin productos", items: [] }, "items"],
      // The cap below the floor: the contract names the cap, the field a manager just raised.
      [{ name: "Tope al revés", minPicks: 2, maxPicks: 1, items: [item] }, "maxPicks"],
      [{ name: "Clave de más", items: [item], nope: 1 }, "extraList.nope"],
      [{ name: "Producto inventado", items: [{ productId: "no-es-uuid" }] }, "items.0.productId"],
    ] as const) {
      const res = await send(app, "POST", "/management-api/modifiers/extras", { body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "extras.invalid", params: { field } },
      });
    }
  });

  /**
   * The VENUE's fallback language decides which language a customer-facing name must carry, so the
   * mount here is `fr-FR` and nothing else in the file is: a route passing `FALLBACK_LOCALE`
   * (`en-GB`) or nothing at all would report the gap as `en`, and a route passing the mounted
   * `es-ES` of every other test would find no gap in an `es` map and answer 201.
   */
  it("reports a missing customer-facing name in the venue's own language, on create and on update", async () => {
    const app = mountApp("fr-FR");
    const [alioli] = await twoProducts(app);
    const refused = await send(app, "POST", "/management-api/modifiers/extras", {
      body: sauces([alioli]),
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: {
        code: "extras.translation_required",
        params: { field: "customerName", language: "fr" },
      },
    });
    const list = await createListVia(app, {
      ...sauces([alioli]),
      customerName: { fr: "Une sauce ?" },
    });
    const patched = await send(app, "PATCH", `/management-api/modifiers/extras/${list.id}`, {
      body: sauces([alioli]),
    });
    expect(patched.status).toBe(400);
    expect(await patched.json()).toMatchObject({
      error: {
        code: "extras.translation_required",
        params: { field: "customerName", language: "fr" },
      },
    });
  });

  it("gates every extras-list route and refuses an id naming no list", async () => {
    const app = mountApp();
    const [alioli] = await twoProducts(app);
    const list = await createListVia(app, { ...sauces([alioli]), name: "Lista vigilada" });
    const collection = "/management-api/modifiers/extras";
    const path = `${collection}/${list.id}`;
    // Every gated route, as [method, path, body] — the table the option-list block above uses. Each
    // route is checked BOTH ways, so a route missing one of the two refusals cannot hide behind a
    // sibling that has it.
    const routes: ["GET" | "POST" | "PATCH" | "DELETE", string, unknown?][] = [
      ["GET", collection],
      ["POST", collection, sauces([alioli])],
      ["GET", path],
      ["PATCH", path, sauces([alioli])],
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
    const malformed = `${collection}/not-a-uuid`;
    for (const [method, routePath, body] of [
      ["GET", malformed],
      ["PATCH", malformed, sauces([alioli])],
      ["DELETE", malformed],
      ["GET", `${malformed}/dependants`],
    ] as ["GET" | "PATCH" | "DELETE", string, unknown?][]) {
      const res = await send(app, method, routePath, {
        ...(body === undefined ? {} : { body }),
      });
      expect(res.status, `${method} ${routePath}`).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "shared.invalid_id" } });
    }
    // A well-formed id naming no list, on each of the four `:id` routes — the read reaches
    // `getExtraList`, the update and the delete reach `assertExtraListForWrite`, the preview reaches
    // `assertExtraList`, and all four must answer 404 rather than the boundary's 400 default. The
    // PATCH body is a VALID one, or the contract would refuse it before the list is looked up.
    const absentId = "33333333-3333-4333-8333-333333333333";
    const absentPath = `${collection}/${absentId}`;
    for (const [method, routePath, body] of [
      ["GET", absentPath],
      ["PATCH", absentPath, sauces([alioli])],
      ["DELETE", absentPath],
      ["GET", `${absentPath}/dependants`],
    ] as ["GET" | "PATCH" | "DELETE", string, unknown?][]) {
      const absent = await send(app, method, routePath, {
        ...(body === undefined ? {} : { body }),
      });
      expect(absent.status, `${method} ${routePath}`).toBe(404);
      expect(await absent.json()).toMatchObject({
        error: { code: "extras.not_found", params: { extraListId: absentId } },
      });
    }
  });

  it("previews what deleting a list would touch — the products carrying it", async () => {
    const app = mountApp();
    const [alioli] = await twoProducts(app);
    const list = await createListVia(app, { ...sauces([alioli]), name: "Lista con dependientes" });
    const catalogueId = await createCatalogueVia(app, "Menú con extras");
    const productId = await createProductVia(app, catalogueId);
    const attached = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: { modifiers: [{ kind: "extras", id: list.id }] },
    });
    expect(attached.status).toBe(204);
    const res = await send(app, "GET", `/management-api/modifiers/extras/${list.id}/dependants`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      dependants: { products: [{ id: productId, name: "Producto con opciones" }], menus: [] },
    });
  });
});

describe("mountCatalogueApi — extras lists and products with variants", () => {
  type Editor = Record<string, unknown> & { variants: { id: string; name: string }[] };
  const editor = async (app: Hono, id: string) =>
    (await (await send(app, "GET", `/management-api/products/${id}/editor`)).json()) as Editor;
  const copa = (active: boolean) => ({
    name: "Copa",
    customerName: null,
    kitchenName: null,
    image: null,
    unitPrice: null,
    available: true,
    active,
  });

  it("answers 409 extras.product_has_variants to a list naming a product with an Active variant, on create and on update", async () => {
    const app = mountApp();
    const pan = await createNamedProductVia(app, `Pan ${crypto.randomUUID()}`);
    const vino = await createNamedProductVia(app, `Vino ${crypto.randomUUID()}`);
    const withVariant = await send(app, "PUT", `/management-api/products/${vino}/editor`, {
      body: { ...(await editor(app, vino)), variants: [copa(true)] },
    });
    expect(withVariant.status).toBe(200);
    const refusal = {
      error: {
        code: "extras.product_has_variants",
        params: { field: "items.1.productId", productId: vino },
      },
    };

    const created = await send(app, "POST", "/management-api/modifiers/extras", {
      body: { name: "Acompañamientos", items: [{ productId: pan }, { productId: vino }] },
    });
    expect(created.status).toBe(409);
    expect(await created.json()).toEqual(refusal);

    const list = await send(app, "POST", "/management-api/modifiers/extras", {
      body: { name: "Acompañamientos", items: [{ productId: pan }] },
    });
    expect(list.status).toBe(201);
    const { extraList } = (await list.json()) as { extraList: ExtraList };
    const updated = await send(app, "PATCH", `/management-api/modifiers/extras/${extraList.id}`, {
      body: { name: "Acompañamientos", items: [{ productId: pan }, { productId: vino }] },
    });
    expect(updated.status).toBe(409);
    expect(await updated.json()).toEqual(refusal);
  });

  it("answers 409 product.offered_as_extra to an Active variant on a product a list offers, naming the list", async () => {
    const app = mountApp();
    const cerveza = await createNamedProductVia(app, `Cerveza ${crypto.randomUUID()}`);
    const list = await send(app, "POST", "/management-api/modifiers/extras", {
      body: { name: "Bebidas extra", items: [{ productId: cerveza }] },
    });
    expect(list.status).toBe(201);
    const { extraList } = (await list.json()) as { extraList: ExtraList };
    const extraLists = [{ id: extraList.id, name: "Bebidas extra" }];
    const parent = await editor(app, cerveza);

    const fromParent = await send(app, "PUT", `/management-api/products/${cerveza}/editor`, {
      body: { ...parent, variants: [copa(true)] },
    });
    expect(fromParent.status).toBe(409);
    expect(await fromParent.json()).toEqual({
      error: {
        code: "product.offered_as_extra",
        params: { field: "variants.0.active", extraLists },
      },
    });

    const inactive = await send(app, "PUT", `/management-api/products/${cerveza}/editor`, {
      body: { ...parent, variants: [copa(false)] },
    });
    expect(inactive.status).toBe(200);
    const variantId = ((await inactive.json()) as Editor).variants[0]!.id;
    const fromOwnPage = await send(app, "PUT", `/management-api/products/${variantId}/editor`, {
      body: { ...(await editor(app, variantId)), active: true },
    });
    expect(fromOwnPage.status).toBe(409);
    expect(await fromOwnPage.json()).toEqual({
      error: { code: "product.offered_as_extra", params: { field: "active", extraLists } },
    });

    // The product PATCH route refuses a variant's id before it writes anything.
    const patched = await send(app, "PATCH", `/management-api/products/${variantId}`, {
      body: { active: true },
    });
    expect(patched.status).toBe(403);
    expect(await patched.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(
      (await suite.db.execute(sql`select active from products where id = ${variantId}`)).rows,
    ).toEqual([{ active: 0 }]);
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
      // Through the table definitions: both ids are `$defaultFn` generators here, and `name` is a
      // JSON column whose own write mapping encodes the object — the `'{…}'::jsonb` literal it
      // replaces carries a cast this engine refuses.
      const [menu] = await suite.db
        .insert(catalogues)
        .values({ name: "Section edit" })
        .returning({ id: catalogues.id });
      const [section] = await suite.db
        .insert(menuSections)
        .values({ menuId: menu!.id, name: { en: "Cocktails", de: "Getränke" } })
        .returning({ id: menuSections.id });
      return section!.id;
    };
    const sectionId = await seedSection();
    // `content_languages` is a singleton keyed on id = 1 (`content_languages_singleton_ck`), so the
    // upsert targets that primary key. `languages` is a JSON list column here, not a PostgreSQL
    // array, so it goes over as an array and the column encodes it.
    await suite.db
      .insert(contentLanguages)
      .values({ defaultLanguage: "en", languages: ["en", "fr"] })
      .onConflictDoUpdate({
        target: contentLanguages.id,
        set: { defaultLanguage: "en", languages: ["en", "fr"] },
      });
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
      // Read back through the table definition, not as raw SQL. `name` is a JSON column stored as
      // TEXT on this engine, and a raw `select name` hands back the stored string
      // (`{"en":"Drinks",…}`) — only the column's own read mapping parses it. The assertion is
      // unchanged; the decode moved from the driver to the column.
      const own = await suite.db
        .select({ name: menuSections.name })
        .from(menuSections)
        .where(eq(menuSections.id, sectionId));
      expect(own).toEqual([input]);
    } finally {
      await suite.db.delete(contentLanguages);
    }
  });
});

describe("menu-section list", () => {
  it("lists empty sections in display order", async () => {
    const app = mountApp();
    const menuId = await createCatalogueVia(app, "Empty sections");
    await suite.db.insert(menuSections).values([
      { menuId, name: { es: "Postres" }, displayOrder: 2 },
      { menuId, name: { es: "Bebidas" }, displayOrder: 1 },
    ]);
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

// A negative CATALOGUE price is never a valid one (owner ruling, 2026-09-21) — the scope matters,
// because a corrective invoice's prices are deliberately negative elsewhere in the tree. The
// catalogue's price-carrying routes were driven with `"-1.00"` before the screen was written. Four
// answered wrongly: the two product writes stored the value, and the two menu-item writes answered
// 500. The rest already refused with a clean 400 of their own. The two blocks below cover both --
// the four fixed here, and the already-refusing ones, pinned so a later change cannot quietly lose
// them. The second block is a sample of that second group and does not claim to be all of it.
describe("a negative price is refused at the catalogue request boundary", () => {
  it("POST /management-api/products refuses a negative unitPrice and stores no row", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Negative price catalogue");
    const body = {
      catalogueId,
      categoryId: null,
      name: "Precio negativo",
      pricingUnit: "each",
      unitPrice: "-1.00",
      vatClass: "general",
    };
    const res = await send(app, "POST", "/management-api/products", { body });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "unitPrice" } },
    });
    // Measured on main before the screen: this answered 201 and the row read back `unitPrice: "-1.00"`.
    const stored = await send(app, "GET", `/management-api/catalogues/${catalogueId}/products`);
    expect(await stored.json()).toEqual([]);
    // The control that separates "refuses a negative" from "refuses a non-positive": zero is a
    // legitimate price and still creates the product.
    expect(
      (
        await send(app, "POST", "/management-api/products", {
          body: { ...body, unitPrice: "0.00" },
        })
      ).status,
    ).toBe(201);
  });

  it("PATCH /management-api/products/:id refuses a negative unitPrice and leaves the price alone", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Negative patch catalogue");
    const created = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Precio bueno",
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "general",
      },
    });
    const productId = ((await created.json()) as { id: string }).id;
    const res = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: { unitPrice: "-1.00" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "unitPrice" } },
    });
    // Measured on main before the screen: this answered 204 and overwrote the price with `-1.00`.
    const rows = (await (
      await send(app, "GET", `/management-api/catalogues/${catalogueId}/products`)
    ).json()) as { id: string; unitPrice: string }[];
    expect(rows.find((r) => r.id === productId)?.unitPrice).toBe("2.00");
    expect(
      (
        await send(app, "PATCH", `/management-api/products/${productId}`, {
          body: { unitPrice: "0.00" },
        })
      ).status,
    ).toBe(204);
  });

  it("the two menu-item writes refuse a negative grossPrice with a 400, not a 500", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Negative menu catalogue");
    const productId = await createNamedProductVia(app, `Oferta ${crypto.randomUUID()}`);
    const section = await send(app, "POST", `/management-api/catalogues/${catalogueId}/sections`, {
      body: { name: { es: "Sección" }, displayOrder: 0 },
    });
    const sectionId = ((await section.json()) as { id: string }).id;
    const items = `/management-api/catalogues/${catalogueId}/items`;

    // Measured on main before the screen: both of these answered 500 `server.internal`, because
    // `menu_items_gross_price_ck` refused the row and the route could not classify a driver error.
    const badCreate = await send(app, "POST", items, {
      body: { productId, sectionId, grossPrice: "-1.00", displayOrder: 0 },
    });
    expect(badCreate.status).toBe(400);
    expect(await badCreate.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "grossPrice" } },
    });

    // The zero control, which also supplies the item the patch below acts on.
    const good = await send(app, "POST", items, {
      body: { productId, sectionId, grossPrice: "0.00", displayOrder: 0 },
    });
    expect(good.status).toBe(201);
    const itemId = ((await good.json()) as { id: string }).id;

    const badPatch = await send(app, "PATCH", `${items}/${itemId}`, {
      body: { grossPrice: "-1.00" },
    });
    expect(badPatch.status).toBe(400);
    expect(await badPatch.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "grossPrice" } },
    });
    expect(
      (await send(app, "PATCH", `${items}/${itemId}`, { body: { grossPrice: "0.00" } })).status,
    ).toBe(204);
  });

  it("the two menu-item writes take a blank grossPrice as the product's own price", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Blank menu price catalogue");
    // The product's own price is 1.00, so a blank menu price must charge exactly that.
    const productId = await createNamedProductVia(app, `Oferta ${crypto.randomUUID()}`);
    const section = await send(app, "POST", `/management-api/catalogues/${catalogueId}/sections`, {
      body: { name: { es: "Sección" }, displayOrder: 0 },
    });
    const sectionId = ((await section.json()) as { id: string }).id;
    const items = `/management-api/catalogues/${catalogueId}/items`;
    const offer = async () =>
      (
        (await (
          await send(app, "GET", `/management-api/catalogues/${catalogueId}/offers`)
        ).json()) as { id: string; grossPrice: string | null; unitPrice: string }[]
      )[0]!;

    const created = await send(app, "POST", items, {
      body: { productId, sectionId, grossPrice: null, displayOrder: 0 },
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ grossPrice: null });
    expect(await offer()).toMatchObject({ grossPrice: null, unitPrice: "1.00" });
    const itemId = (await offer()).id;

    expect(
      (await send(app, "PATCH", `${items}/${itemId}`, { body: { grossPrice: "2.50" } })).status,
    ).toBe(204);
    expect(await offer()).toMatchObject({ grossPrice: "2.50", unitPrice: "2.50" });
    expect(
      (await send(app, "PATCH", `${items}/${itemId}`, { body: { grossPrice: null } })).status,
    ).toBe(204);
    expect(await offer()).toMatchObject({ grossPrice: null, unitPrice: "1.00" });

    // A value of the wrong type is still refused on both routes, and changes nothing.
    const wrongPatch = await send(app, "PATCH", `${items}/${itemId}`, {
      body: { grossPrice: 2.5 },
    });
    expect(wrongPatch.status).toBe(400);
    expect(await wrongPatch.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "grossPrice" } },
    });
    const wrongCreate = await send(app, "POST", items, {
      body: { productId, sectionId, grossPrice: 2.5, displayOrder: 0 },
    });
    expect(wrongCreate.status).toBe(400);
    expect(await wrongCreate.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "grossPrice" } },
    });
    expect(await offer()).toMatchObject({ grossPrice: null, unitPrice: "1.00" });

    // Only an explicit null means blank: a create that leaves the field out is refused, and adds
    // no offer. A product not yet on the menu, so nothing but the missing field can refuse it.
    const otherProductId = await createNamedProductVia(app, `Oferta ${crypto.randomUUID()}`);
    const absentCreate = await send(app, "POST", items, {
      body: { productId: otherProductId, sectionId, displayOrder: 1 },
    });
    expect(absentCreate.status).toBe(400);
    expect(await absentCreate.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "grossPrice" } },
    });
    const offers = (await (
      await send(app, "GET", `/management-api/catalogues/${catalogueId}/offers`)
    ).json()) as { id: string }[];
    expect(offers.map((row) => row.id)).toEqual([itemId]);
  });

  it("leaves a malformed price to the refusal it already had, so no shipped code changes meaning", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Malformed price catalogue");
    // The screen reads the SIGN and nothing else: a value `decimal()` cannot parse falls straight
    // through to the write's own `decimal()`, which is where `shared.invalid_decimal` comes from.
    const res = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Coma decimal",
        pricingUnit: "each",
        unitPrice: "1,00",
        vatClass: "general",
      },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "shared.invalid_decimal" } });
    // `decimal()` strips the sign from a zero magnitude, so `-0.00` is not below zero and is stored
    // as plain zero rather than refused.
    const zero = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Cero firmado",
        pricingUnit: "each",
        unitPrice: "-0.00",
        vatClass: "general",
      },
    });
    expect(zero.status).toBe(201);
    expect(await zero.json()).toMatchObject({ unitPrice: "0.00" });
  });
});

// Catalogue write routes that already refused a negative before this branch, each through
// `isProductPrice` (`packages/catalogue/src/modifier-limits.ts:12`), whose pattern carries no sign.
// They are pinned at the ROUTE here, which is what the package tests on the operations behind them
// cannot cover: without these, a later change could drop the wiring and nothing would notice. This
// is the set that was checked, not a claim that no other route carries a price.
describe("catalogue routes that already refused a negative price", () => {
  it("the product-editor, offer-variant and extras-list writes each answer their own 400", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Already-refusing catalogue");
    const unitId = (
      await suite.db.execute<{ id: string }>(sql`select id from units where seed_key = 'each'`)
    ).rows[0]!.id;
    const variant = (name: string, unitPrice: string) => ({
      name,
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice,
      available: true,
      active: true,
    });
    const editor = {
      name: "Con variantes",
      customerName: null,
      description: null,
      kitchenName: null,
      image: null,
      unitId,
      unitPrice: "2.00",
      active: true,
      available: true,
      soldAlone: true,
      vatClass: "general",
      variants: [variant("A", "2.00"), variant("B", "3.00")],
      categoryIds: [],
      primaryCategoryId: null,
      modifiers: [],
      allergens: {},
      dietaryDeclarations: [],
    };
    const editorPath = `/management-api/catalogues/${catalogueId}/product-editor`;

    const badProductPrice = await send(app, "POST", editorPath, {
      body: { ...editor, unitPrice: "-1.00", variants: [] },
    });
    expect(badProductPrice.status).toBe(400);
    expect(await badProductPrice.json()).toMatchObject({
      error: { code: "product.invalid", params: { field: "unitPrice" } },
    });

    const badVariantPrice = await send(app, "POST", editorPath, {
      body: { ...editor, variants: [variant("A", "-1.00"), variant("B", "3.00")] },
    });
    expect(badVariantPrice.status).toBe(400);
    expect(await badVariantPrice.json()).toMatchObject({
      error: { code: "product.invalid", params: { field: "variants.0.unitPrice" } },
    });

    const saved = (await (await send(app, "POST", editorPath, { body: editor })).json()) as {
      id: string;
      variants: { id: string }[];
    };
    const badEditorUpdate = await send(app, "PUT", `/management-api/products/${saved.id}/editor`, {
      body: { ...editor, unitPrice: "-1.00", variants: [] },
    });
    expect(badEditorUpdate.status).toBe(400);
    expect(await badEditorUpdate.json()).toMatchObject({
      error: { code: "product.invalid", params: { field: "unitPrice" } },
    });

    const sectionId = (
      (await (
        await send(app, "POST", `/management-api/catalogues/${catalogueId}/sections`, {
          body: { name: { es: "Sección" }, displayOrder: 0 },
        })
      ).json()) as { id: string }
    ).id;
    const itemId = (
      (await (
        await send(app, "POST", `/management-api/catalogues/${catalogueId}/items`, {
          body: { productId: saved.id, sectionId, grossPrice: "1.00", displayOrder: 0 },
        })
      ).json()) as { id: string }
    ).id;
    const badOfferVariant = await send(
      app,
      "PUT",
      `/management-api/catalogues/${catalogueId}/items/${itemId}/variants`,
      {
        body: {
          variants: [{ variantId: saved.variants[0]!.id, price: "-1.00", offered: true }],
        },
      },
    );
    expect(badOfferVariant.status).toBe(400);
    expect(await badOfferVariant.json()).toMatchObject({
      error: { code: "product.variant_invalid", params: { field: "price" } },
    });

    // An extras list may not offer a product with Active variants, so the list writes name one
    // without any.
    const plain = (await (
      await send(app, "POST", editorPath, {
        body: { ...editor, name: "Sin variantes", variants: [] },
      })
    ).json()) as { id: string };
    const badExtra = await send(app, "POST", "/management-api/modifiers/extras", {
      body: { name: "Extras", items: [{ productId: plain.id, price: "-1.00", maxQuantity: 1 }] },
    });
    expect(badExtra.status).toBe(400);
    expect(await badExtra.json()).toMatchObject({
      error: { code: "extras.invalid", params: { field: "items.0.price" } },
    });

    // The two the first pass of this enumeration missed, added after a reviewer drove them: the
    // extras list UPDATE (the create's sibling, which reaches the same screen), and a negative
    // VARIANT price on the editor UPDATE (the editor tests above vary the product price there).
    const goodExtra = await send(app, "POST", "/management-api/modifiers/extras", {
      body: {
        name: "Extras buenos",
        items: [{ productId: plain.id, price: "1.00", maxQuantity: 1 }],
      },
    });
    expect(goodExtra.status).toBe(201);
    const extraListId = ((await goodExtra.json()) as { extraList: { id: string } }).extraList.id;
    const badExtraPatch = await send(
      app,
      "PATCH",
      `/management-api/modifiers/extras/${extraListId}`,
      {
        body: {
          name: "Extras buenos",
          items: [{ productId: plain.id, price: "-1.00", maxQuantity: 1 }],
        },
      },
    );
    expect(badExtraPatch.status).toBe(400);
    expect(await badExtraPatch.json()).toMatchObject({
      error: { code: "extras.invalid", params: { field: "items.0.price" } },
    });

    const badEditorVariant = await send(app, "PUT", `/management-api/products/${saved.id}/editor`, {
      body: { ...editor, variants: [variant("A", "-1.00"), variant("B", "3.00")] },
    });
    expect(badEditorVariant.status).toBe(400);
    expect(await badEditorVariant.json()).toMatchObject({
      error: { code: "product.invalid", params: { field: "variants.0.unitPrice" } },
    });
  });
});
