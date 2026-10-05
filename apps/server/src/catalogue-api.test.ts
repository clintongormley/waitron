import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, categories, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, persons, startManagementSession } from "@waitron/identity";
import {
  CATALOGUE_MIGRATIONS,
  categoryDetails,
  menuDetails,
  menuPublications,
  menuVersions,
  sectionMembers,
} from "@waitron/catalogue";
import type { MenuPreview, MenuStatus } from "@waitron/catalogue";
import type { ExtraList, ExtraListRow, OptionList, OptionListRow } from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  type ContentLanguageRules,
} from "@waitron/shared";
import type { Logger } from "./logger.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { createCourse } from "./kitchen.js";
import {
  VENUE_SERVICE_MIGRATIONS,
  createException,
  setClaim,
  createDepartment,
  configureZone,
} from "@waitron/venue-service";
import { floorZones, kitchenStations } from "@waitron/db";
import type { TillConfig } from "./till-config.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import "./errors.js";

// The catalogue ROUTES end to end in-process: the body and id screens and the permission gate. The
// staff refusal over every write route is in `catalogue-api.full-manifest.test.ts`.
const noopLog: Logger = () => {};

describe("folder selection routes", () => {
  async function folder(app: Hono, name: string, parentId: string | null = null) {
    const response = await send(app, "POST", "/management-api/categories", {
      body: { name, parentId },
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }
  async function plantFolder(name: string): Promise<string> {
    const id = crypto.randomUUID();
    await suite.db.insert(categories).values({ id, name });
    await suite.db.insert(categoryDetails).values({ categoryId: id, parentId: null });
    return id;
  }
  it("moves a selection, reports its contents, then deletes it", async () => {
    const app = mountApp();
    const parent = await folder(app, "Drinks");
    const child = await folder(app, "Beer");
    expect(
      (
        await send(app, "POST", "/management-api/folders/move", {
          body: { productIds: [], categoryIds: [child], to: parent },
        })
      ).status,
    ).toBe(204);
    const summary = await send(
      app,
      "GET",
      `/management-api/folders/summary?id=${parent}&id=${child}`,
    );
    expect(summary.status).toBe(200);
    expect(await summary.json()).toEqual([
      { id: parent, folders: 1, products: 0, activeProducts: 0, routes: 0 },
      { id: child, folders: 0, products: 0, activeProducts: 0, routes: 0 },
    ]);
    expect(
      (
        await send(app, "POST", "/management-api/folders/delete", {
          body: { productIds: [], categoryIds: [parent, child], contents: "delete" },
        })
      ).status,
    ).toBe(204);
    expect((await send(app, "GET", `/management-api/categories/${child}`)).status).toBe(404);
  });

  it.each(["move_up", "delete"] as const)(
    "summarises and deletes (%s) only the empty one of three top-level categories named Mains",
    async (contents) => {
      const app = mountApp();
      const empty = await folder(app, "Mains");
      // The routes refuse siblings sharing a name, so the other two are written
      // straight into the tables, as data stored before the rule.
      const withActive = await plantFolder("Mains");
      const withInactive = await plantFolder("Mains");
      const menu = await createCatalogueVia(app, "Mains menu");
      const make = async (name: string, categoryId: string) => {
        const created = await send(app, "POST", "/management-api/products", {
          body: {
            catalogueId: menu,
            categoryId,
            name,
            pricingUnit: "each",
            unitPrice: "2",
            vatClass: "general",
          },
        });
        expect(created.status).toBe(201);
        return ((await created.json()) as { id: string }).id;
      };
      const steak = await make("Steak", withActive);
      const stew = await make("Stew", withInactive);
      expect(
        (
          await send(app, "POST", "/management-api/folders/delete", {
            body: { productIds: [stew], categoryIds: [], contents: "move_up" },
          })
        ).status,
      ).toBe(204);
      const products = async () =>
        (
          (await (await send(app, "GET", "/management-api/products")).json()) as {
            id: string;
            active: boolean;
            primaryCategoryId: string | null;
          }[]
        )
          .filter(({ id }) => id === steak || id === stew)
          .map(({ id, active, primaryCategoryId }) => ({ id, active, primaryCategoryId }))
          .sort((a, b) => a.id.localeCompare(b.id));
      const before = await products();
      expect(before).toEqual(
        [
          { id: steak, active: true, primaryCategoryId: withActive },
          { id: stew, active: false, primaryCategoryId: withInactive },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      );

      const summary = await send(app, "GET", `/management-api/folders/summary?id=${empty}`);
      expect(await summary.json()).toEqual([
        { id: empty, folders: 0, products: 0, activeProducts: 0, routes: 0 },
      ]);
      expect(
        (
          await send(app, "POST", "/management-api/folders/delete", {
            body: { productIds: [], categoryIds: [empty], contents },
          })
        ).status,
      ).toBe(204);

      const left = (await (await send(app, "GET", "/management-api/categories")).json()) as {
        id: string;
        name: string;
        parentId: string | null;
      }[];
      expect(left.map(({ id, name, parentId }) => ({ id, name, parentId }))).toEqual(
        expect.arrayContaining([
          { id: withActive, name: "Mains", parentId: null },
          { id: withInactive, name: "Mains", parentId: null },
        ]),
      );
      expect(left.some(({ id }) => id === empty)).toBe(false);
      expect(await products()).toEqual(before);
    },
  );

  it("answers a cycle with 409 and leaves the selected product where it was", async () => {
    const app = mountApp();
    const parent = await folder(app, "Drinks");
    const child = await folder(app, "Beer", parent);
    const menu = await createCatalogueVia(app, "Folder refusal");
    const created = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId: menu,
        categoryId: parent,
        name: "Cola",
        pricingUnit: "each",
        unitPrice: "2",
        vatClass: "general",
      },
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const refusal = await send(app, "POST", "/management-api/folders/move", {
      body: { productIds: [id], categoryIds: [parent], to: child },
    });
    expect(refusal.status).toBe(409);
    expect(await refusal.json()).toMatchObject({ error: { code: "category.parent_cycle" } });
    const listed = await send(app, "GET", "/management-api/products");
    expect(await listed.json()).toContainEqual(
      expect.objectContaining({ id, primaryCategoryId: parent }),
    );
  });

  it.each(["self", "descendant"])(
    "answers a folder parent edit to its %s with 409 and preserves the tree",
    async (target) => {
      const app = mountApp();
      const parent = await folder(app, "Drinks");
      const child = await folder(app, "Beer", parent);
      const response = await send(app, "PATCH", `/management-api/categories/${parent}`, {
        body: { parentId: target === "self" ? parent : child },
      });
      expect(await response.json()).toMatchObject({ error: { code: "category.parent_cycle" } });
      expect(response.status).toBe(409);
      expect(
        await (await send(app, "GET", `/management-api/categories/${parent}`)).json(),
      ).toMatchObject({
        id: parent,
        parentId: null,
      });
      expect(
        await (await send(app, "GET", `/management-api/categories/${child}`)).json(),
      ).toMatchObject({
        id: child,
        parentId: parent,
      });
    },
  );

  it.each([
    ["move", { productIds: [], categoryIds: [] }, "management.request_invalid", "to"],
    [
      "move",
      { productIds: null, categoryIds: [], to: null },
      "management.request_invalid",
      "productIds",
    ],
    [
      "move",
      { productIds: [], categoryIds: null, to: null },
      "management.request_invalid",
      "categoryIds",
    ],
    [
      "move",
      { productIds: ["invalid"], categoryIds: [], to: null },
      "shared.invalid_id",
      undefined,
    ],
    [
      "move",
      { productIds: [], categoryIds: ["invalid"], to: null },
      "shared.invalid_id",
      undefined,
    ],
    [
      "delete",
      { productIds: [], categoryIds: [], contents: "archive" },
      "management.request_invalid",
      "contents",
    ],
    [
      "delete",
      { productIds: [], categoryIds: [], contents: null },
      "management.request_invalid",
      "contents",
    ],
  ] as const)("validates %s body %j", async (action, body, code, field) => {
    const response = await send(mountApp(), "POST", `/management-api/folders/${action}`, { body });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code, ...(field === undefined ? {} : { params: { field } }) },
    });
  });

  it.each(["productIds", "categoryIds"] as const)("refuses repeated %s", async (field) => {
    const id = crypto.randomUUID();
    const response = await send(mountApp(), "POST", "/management-api/folders/move", {
      body: { productIds: [], categoryIds: [], [field]: [id, id], to: null },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field } },
    });
  });

  it("validates summary IDs and allows an empty summary", async () => {
    const app = mountApp();
    const bad = await send(app, "GET", "/management-api/folders/summary?id=invalid");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "shared.invalid_id" } });
    const empty = await send(app, "GET", "/management-api/folders/summary");
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);
  });

  it.each(["move", "delete", "summary"] as const)(
    "protects folder %s with manager authorization",
    async (action) => {
      for (const [cookie, status, code] of [
        [null, 401, "management_session.required"],
        [staffCookie, 403, "authorization.not_permitted"],
      ] as const) {
        const response = await send(
          mountApp(),
          action === "summary" ? "GET" : "POST",
          `/management-api/folders/${action}`,
          {
            cookie,
            ...(action === "summary"
              ? {}
              : { body: { productIds: [], categoryIds: [], to: null, contents: "delete" } }),
          },
        );
        expect(response.status).toBe(status);
        expect(await response.json()).toMatchObject({ error: { code } });
      }
    },
  );
});

let locationId: string;
let managerCookie: string;
let managerPersonId: string;
let staffCookie: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
  ],
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    await seedLegacySellingUnits(db);
    // One location, so the location↔menu routes have a `:locationId` to act on. Through the table
    // definition: `locations.id` is a `$defaultFn` generator, which a raw insert never reaches.
    const [loc] = await db
      .insert(locations)
      .values({ name: "Main", invoiceLocales: ["es-ES"], operationDescription: "Venta" })
      .returning({ id: locations.id });
    locationId = loc!.id;
    // A MANAGER (holds `person.manage`) and a STAFF person (holds no `person.manage`), each with a
    // live management session.
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
      managerPersonId = mgr!.id;
      return { managerSid: managerSession.token, staffSid: staffSession.token };
    });
    managerCookie = `${MANAGEMENT_COOKIE}=${managerSid}`;
    staffCookie = `${MANAGEMENT_COOKIE}=${staffSid}`;
  },
});

// Every test here shares one database, and a category's name is unique among its siblings and an
// Active product's across the venue. Before each test the rows earlier tests left are renamed, so
// a name an earlier test used is free again; the rows themselves remain.
beforeEach(async () => {
  await suite.db.execute(
    sql`update categories set name = 'earlier test ' || id where name <> 'earlier test ' || id`,
  );
  await suite.db.execute(
    sql`update products set name = 'earlier test ' || id where name <> 'earlier test ' || id`,
  );
});

/**
 * The venue the product editor's kitchen routing is checked against. Only `locationId` is read by
 * `setProductCourse`; the fiscal ids are shape-fillers, as they are in the other
 * route suites.
 */
function venueCfg(): TillConfig {
  return {
    nodeId: brandNodeId("11111111-1111-4111-8111-111111111111"),
    seriesId: brandSeriesId(crypto.randomUUID()),
    locationId: brandLocationId(locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
    orderFlow: "prepay",
  };
}

function mountApp(venueLocale = "es-ES", contentLanguageRules?: ContentLanguageRules): Hono {
  const app = new Hono();
  mountCatalogueApi(
    app,
    {
      db: suite.db,
      venueCfg: venueCfg(),
      venueLocale,
      ...(contentLanguageRules === undefined ? {} : { contentLanguageRules }),
    },
    noopLog,
  );
  return app;
}

/** A live kitchen course of the seeded venue. */
async function seedRouting(): Promise<{ courseId: string }> {
  return withTransaction(suite.db, async (tx) => {
    const cfg = venueCfg();
    const course = await createCourse(tx, cfg, { name: `Course ${crypto.randomUUID()}` });
    return { courseId: course.id };
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

  const BARCELONA: ContentLanguageRules = {
    required: ["ca", "es"],
    official: ["es", "ca", "gl", "eu"],
  };

  it("refuses removing a language the venue's region requires", async () => {
    const app = mountApp("es-ES", BARCELONA);
    const all = { defaultLanguage: "es", languages: ["es", "ca", "en"] };
    expect(
      (await send(app, "PUT", "/management-api/content-languages", { body: all })).status,
    ).toBe(204);
    const withoutCatalan = await send(app, "PUT", "/management-api/content-languages", {
      body: { defaultLanguage: "es", languages: ["es", "en"] },
    });
    expect(withoutCatalan.status).toBe(400);
    expect(await withoutCatalan.json()).toEqual({
      error: { code: "content.language_required", params: { language: "ca" } },
    });
    expect(await (await send(app, "GET", "/management-api/content-languages")).json()).toEqual(all);
  });

  it("lets a venue whose region requires nothing remove any language but its default", async () => {
    const app = mountApp("es-ES", { required: [], official: BARCELONA.official });
    for (const settings of [
      { defaultLanguage: "es", languages: ["es", "ca", "en"] },
      { defaultLanguage: "es", languages: ["es"] },
    ])
      expect(
        (await send(app, "PUT", "/management-api/content-languages", { body: settings })).status,
      ).toBe(204);
  });

  it("answers the venue's content-language rules to a manager", async () => {
    const response = await send(
      mountApp("es-ES", BARCELONA),
      "GET",
      "/management-api/content-language-rules",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(BARCELONA);
  });

  it("answers no rules when none were worked out for the venue", async () => {
    const response = await send(mountApp(), "GET", "/management-api/content-language-rules");
    expect(await response.json()).toEqual({ required: [], official: [] });
  });

  it("answers the rules only under the content-languages read's authorisation", async () => {
    const app = mountApp("es-ES", BARCELONA);
    expect(
      (await send(app, "GET", "/management-api/content-language-rules", { cookie: null })).status,
    ).toBe(401);
    for (const path of ["content-languages", "content-language-rules"])
      expect(
        (await send(app, "GET", `/management-api/${path}`, { cookie: staffCookie })).status,
        path,
      ).toBe(403);
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

describe("the missing-translations report", () => {
  const PATH = "/management-api/content-translation-gaps";

  beforeEach(async () => {
    await suite.db.execute(sql`delete from content_languages`);
  });

  it("answers a manager each enabled language's gaps under the saved configuration", async () => {
    const app = mountApp("es-ES");
    const settings = { defaultLanguage: "es", languages: ["es", "ca", "en"] };
    expect(
      (await send(app, "PUT", "/management-api/content-languages", { body: settings })).status,
    ).toBe(204);
    const menu = await createCatalogueVia(app, "Gap report");
    const created = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId: menu,
        categoryId: null,
        name: "STAFF Pan gap report",
        customerName: { es: "CLIENT-ES Pan con tomate" },
        kitchenName: "KITCHEN Pan",
        pricingUnit: "each",
        unitPrice: "3",
        vatClass: "reduced",
      },
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const response = await send(app, "GET", PATH);
    expect(response.status).toBe(200);
    const report = (await response.json()) as {
      language: string;
      gaps: { kind: string; id: string; name: string; reason: string }[];
    }[];
    expect(report.map((entry) => entry.language)).toEqual(["es", "ca", "en"]);
    const gapsIn = (language: string) =>
      report.find((entry) => entry.language === language)!.gaps.filter((gap) => gap.id === id);
    expect(gapsIn("ca")).toEqual([
      { kind: "product", id, name: "STAFF Pan gap report", reason: "partial" },
    ]);
    expect(gapsIn("es")).toEqual([]);
  });

  it("answers the report only under the content-languages read's authorisation", async () => {
    const app = mountApp("es-ES");
    expect((await send(app, "GET", PATH, { cookie: null })).status).toBe(401);
    expect((await send(app, "GET", PATH, { cookie: staffCookie })).status).toBe(403);
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

interface MenuPriceRow {
  menuItemId: string;
  productId: string;
  override: string | null;
  effectivePrice: string;
  offered: boolean | null;
}

async function menuPricesVia(app: Hono, menuId: string): Promise<MenuPriceRow[]> {
  const res = await send(app, "GET", `/management-api/catalogues/${menuId}/prices`);
  expect(res.status).toBe(200);
  return (await res.json()) as MenuPriceRow[];
}

/** The top-level list the menu was created with. */
async function menuRootVia(app: Hono, menuId: string): Promise<string> {
  const structure = await send(app, "GET", `/management-api/catalogues/${menuId}/structure`);
  return ((await structure.json()) as { rootSectionId: string }).rootSectionId;
}

async function offerVia(
  app: Hono,
  menuId: string,
  productId: string,
  grossPrice: string | null = null,
): Promise<string> {
  const rootSectionId = await menuRootVia(app, menuId);
  const member = await send(app, "POST", `/management-api/sections/${rootSectionId}/members`, {
    body: { ref: { kind: "product", productId } },
  });
  expect(member.status).toBe(201);
  const itemId = (await menuPricesVia(app, menuId)).find(
    (row) => row.productId === productId,
  )!.menuItemId;
  if (grossPrice !== null) {
    const priced = await send(
      app,
      "PATCH",
      `/management-api/catalogues/${menuId}/items/${itemId}`,
      {
        body: { grossPrice },
      },
    );
    expect(priced.status).toBe(204);
  }
  return itemId;
}

async function createCategoryVia(app: Hono, name: string): Promise<string> {
  const res = await send(app, "POST", "/management-api/categories", { body: { name } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** A named product with no main category, in a catalogue of its own. */
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

  it.each(["", "   "])(
    "POST /management-api/catalogues with a blank name %j → management.request_invalid 400, no menu written",
    async (name) => {
      const count = async () =>
        (await suite.db.execute<{ n: number }>(sql`select count(*) as n from catalogues`)).rows[0]!
          .n;
      const before = await count();
      const res = await send(mountApp(), "POST", "/management-api/catalogues", { body: { name } });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "name" } },
      });
      expect(await count()).toBe(before);
    },
  );

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
      body: { name: " Bebidas " },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      name: string;
      parentId: string | null;
    };
    expect(body).toMatchObject({ name: "Bebidas", parentId: null });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses a translated-object category name", async () => {
    const res = await send(mountApp(), "POST", "/management-api/categories", {
      body: { name: { en: "Drinks" } },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });
  });

  it("refuses a blank category name on create and on rename with category.invalid (400)", async () => {
    const app = mountApp();
    const blank = await send(app, "POST", "/management-api/categories", { body: { name: "  " } });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toMatchObject({
      error: { code: "category.invalid", params: { field: "name" } },
    });
    const id = await createCategoryVia(app, "Kept");
    const renamed = await send(app, "PATCH", `/management-api/categories/${id}`, {
      body: { name: "" },
    });
    expect(renamed.status).toBe(400);
    expect(await renamed.json()).toMatchObject({
      error: { code: "category.invalid", params: { field: "name" } },
    });
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
      body: { name: "Postres" },
    });
    const res = await send(app, "GET", "/management-api/categories");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { name: string }[];
    expect(rows.some((r) => r.name === "Postres")).toBe(true);
  });
});

describe("unique category and product names", () => {
  // The database is shared by every describe here, so each name carries a tag of its own.
  const tag = () => crypto.randomUUID().slice(0, 8);
  async function refused(response: Response, code: string, params: Record<string, unknown>) {
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code, params } });
  }

  it("answers a duplicate sibling category on create, rename and move with category.name_taken (409)", async () => {
    const app = mountApp();
    const name = `Mains ${tag()}`;
    const first = await createCategoryVia(app, name);
    await refused(
      await send(app, "POST", "/management-api/categories", {
        body: { name: ` ${name.toUpperCase()} ` },
      }),
      "category.name_taken",
      { field: "name", name: name.toUpperCase() },
    );
    const other = await createCategoryVia(app, `Other ${tag()}`);
    await refused(
      await send(app, "PATCH", `/management-api/categories/${other}`, { body: { name } }),
      "category.name_taken",
      { field: "name", name },
    );
    const holder = await createCategoryVia(app, `Holder ${tag()}`);
    const nested = await send(app, "POST", "/management-api/categories", {
      body: { name, parentId: holder },
    });
    expect(nested.status).toBe(201);
    const nestedId = ((await nested.json()) as { id: string }).id;
    await refused(
      await send(app, "POST", "/management-api/folders/move", {
        body: { productIds: [], categoryIds: [nestedId], to: null },
      }),
      "category.name_taken",
      { field: "name", name },
    );
    await refused(
      await send(app, "POST", "/management-api/folders/delete", {
        body: { productIds: [], categoryIds: [holder], contents: "move_up" },
      }),
      "category.name_taken",
      { field: "name", name },
    );
    expect((await send(app, "GET", `/management-api/categories/${first}`)).status).toBe(200);
  });

  it("answers a duplicate Active product on create, rename and reactivation with product.name_taken (409)", async () => {
    const app = mountApp();
    const name = `Café ${tag()}`;
    await createNamedProductVia(app, name);
    const catalogueId = await createCatalogueVia(app, `Second menu ${tag()}`);
    const body = {
      catalogueId,
      categoryId: null,
      name: name.toLowerCase(),
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "general",
    };
    await refused(
      await send(app, "POST", "/management-api/products", { body }),
      "product.name_taken",
      { field: "name", name: name.toLowerCase() },
    );
    const other = await createNamedProductVia(app, `Té ${tag()}`);
    await refused(
      await send(app, "PATCH", `/management-api/products/${other}`, { body: { name } }),
      "product.name_taken",
      { field: "name", name },
    );
    const inactive = await send(app, "POST", "/management-api/products", {
      body: { ...body, active: false },
    });
    expect(inactive.status).toBe(201);
    const inactiveId = ((await inactive.json()) as { id: string }).id;
    await refused(
      await send(app, "PATCH", `/management-api/products/${inactiveId}`, {
        body: { active: true },
      }),
      "product.name_taken",
      { field: "name", name: name.toLowerCase() },
    );
  });

  it("answers a product editor save whose variant takes a used name with the variant's field (409)", async () => {
    const app = mountApp();
    const name = `Agua ${tag()}`;
    await createNamedProductVia(app, name);
    const catalogueId = await createCatalogueVia(app, `Editor menu ${tag()}`);
    const unitId = (
      await suite.db.execute<{ id: string }>(sql`select id from units where seed_key = 'each'`)
    ).rows[0]!.id;
    const variant = (variantName: string) => ({
      name: variantName,
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: null,
      available: true,
      active: true,
    });
    await refused(
      await send(app, "POST", `/management-api/catalogues/${catalogueId}/product-editor`, {
        body: {
          name: `Refresco ${tag()}`,
          customerName: null,
          description: null,
          kitchenName: null,
          image: null,
          unitId,
          unitPrice: "2.00",
          active: true,
          available: true,
          ordering: "public",
          vatClass: "general",
          variants: [variant(`Pequeño ${tag()}`), variant(name)],
          primaryCategoryId: null,
          modifiers: [],
          allergens: null,
          dietaryDeclarations: [],
        },
      }),
      "product.name_taken",
      { field: "variants.1.name", name },
    );
  });
});

describe("mountCatalogueApi — labels", () => {
  it("has no labels routes", async () => {
    const app = mountApp();
    const productId = await createNamedProductVia(app, "Cerveza");
    for (const [method, path] of [
      ["GET", "/management-api/labels"],
      ["POST", "/management-api/labels"],
      // Not a uuid, so a surviving handler would refuse it with 400 before any lookup.
      ["PATCH", "/management-api/labels/not-a-uuid"],
      ["DELETE", "/management-api/labels/not-a-uuid"],
      ["GET", `/management-api/products/${productId}/labels`],
      ["PUT", `/management-api/products/${productId}/labels`],
    ] as const) {
      const body = method === "GET" || method === "DELETE" ? {} : { body: { name: "X" } };
      const res = await send(app, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it("refuses a product editor save that still carries labelIds", async () => {
    const app = mountApp();
    const productId = await createNamedProductVia(app, "Sidra");
    const editorPath = `/management-api/products/${productId}/editor`;
    const value = (await (await send(app, "GET", editorPath)).json()) as Record<string, unknown>;
    expect(value).not.toHaveProperty("labelIds");
    expect((await send(app, "PUT", editorPath, { body: value })).status).toBe(200);
    const res = await send(app, "PUT", editorPath, { body: { ...value, labelIds: [] } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "product.invalid", params: { field: "labelIds" } },
    });
  });
});

describe("mountCatalogueApi — products", () => {
  it("GET /management-api/products/made-at names the base station and zone variation", async () => {
    const app = mountApp();
    const menu = await createCatalogueVia(app, `Made at ${crypto.randomUUID()}`);
    const folder = async (name: string, parentId: string | null = null) => {
      const response = await send(app, "POST", "/management-api/categories", {
        body: { name, parentId },
      });
      return ((await response.json()) as { id: string }).id;
    };
    const drinks = await folder(`Drinks ${crypto.randomUUID()}`);
    const cocktails = await folder(`Cocktails ${crypto.randomUUID()}`, drinks);
    const create = async (name: string, categoryId: string | null) => {
      const response = await send(app, "POST", "/management-api/products", {
        body: {
          catalogueId: menu,
          categoryId,
          name,
          pricingUnit: "each",
          unitPrice: "3",
          vatClass: "general",
        },
      });
      expect(response.status).toBe(201);
      return ((await response.json()) as { id: string }).id;
    };
    const lager = await create("Lager", drinks);
    const mojito = await create("Mojito", cocktails);
    const bread = await create("Bread", null);
    await withTransaction(suite.db, async (tx) => {
      const cfg = venueCfg();
      const [bar, cocktailBar] = await tx
        .insert(kitchenStations)
        .values([
          { locationId: cfg.locationId, name: "Bar", isDefault: true },
          { locationId: cfg.locationId, name: "Cocktail bar" },
        ])
        .returning();
      await setClaim(tx, cfg, drinks, { kind: "station", stationId: bar!.id });
      const [terrace] = await tx
        .insert(floorZones)
        .values({ locationId: cfg.locationId, name: "Terrace" })
        .returning();
      const department = await createDepartment(tx, cfg, {
        name: "Dining",
        defaultServiceMode: "table_tab",
      });
      await configureZone(tx, cfg, { zoneId: terrace!.id, departmentId: department.id });
      await createException(tx, cfg, {
        zoneId: terrace!.id,
        categoryId: cocktails,
        productId: null,
        target: { kind: "station", stationId: cocktailBar!.id },
      });
    });
    const response = await send(app, "GET", "/management-api/products/made-at");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body[lager]).toMatchObject({ stationName: "Bar", variesByZone: false });
    expect(body[mojito]).toMatchObject({ stationName: "Bar", variesByZone: true });
    expect(body[bread]).toMatchObject({ stationName: "Bar", variesByZone: false });
    await withTransaction(suite.db, async (tx) => {
      const cfg = venueCfg();
      const [cocktailBar] = await tx
        .select({ id: kitchenStations.id })
        .from(kitchenStations)
        .where(
          and(
            eq(kitchenStations.locationId, cfg.locationId),
            eq(kitchenStations.name, "Cocktail bar"),
          ),
        );
      await setClaim(tx, cfg, drinks, { kind: "station", stationId: cocktailBar!.id });
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, cocktailBar!.id));
    });
    const changed = await send(app, "GET", "/management-api/products/made-at");
    const changedBody = (await changed.json()) as Record<string, unknown>;
    expect(changedBody[lager]).toMatchObject({
      stationId: null,
      stationName: "Cocktail bar",
      noReplacement: true,
    });
  });
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

    const upstairsItemId = await offerVia(app, upstairsMenuId, productId, "11.00");
    const downstairsItemId = await offerVia(app, downstairsMenuId, productId, "9.00");

    expect((await menuPricesVia(app, upstairsMenuId))[0]).toMatchObject({
      productId,
      override: "11.00",
    });
    expect((await menuPricesVia(app, downstairsMenuId))[0]).toMatchObject({
      productId,
      override: "9.00",
    });

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
          "PATCH",
          `/management-api/catalogues/${downstairsMenuId}/items/${downstairsItemId}`,
          { body: { offered: false } },
        )
      ).status,
    ).toBe(204);
    expect((await menuPricesVia(app, upstairsMenuId))[0]!.override).toBe("12.50");
    // The dashboard still lists it, switched off, so it can be switched back on.
    expect(await menuPricesVia(app, downstairsMenuId)).toMatchObject([
      { menuItemId: downstairsItemId, offered: false },
    ]);
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
      body: { name: "Cafés" },
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
      categoryId: string | null;
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
      categoryId,
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
      body: { name: "Cafés" },
    });
    const categoryId = ((await category.json()) as { id: string }).id;
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
      ordering: "public",
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
    const offerId = await offerVia(app, catalogueId, saved.id, "2.40");
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
      { variantId: saved.variants[1]!.id, price: null, offered: null },
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
    const rootSectionId = await menuRootVia(app, catalogueId);
    const variantOffer = await send(
      app,
      "POST",
      `/management-api/sections/${rootSectionId}/members`,
      { body: { ref: { kind: "product", productId: saved.variants[0]!.id } } },
    );
    expect(variantOffer.status).toBe(400);
    expect(await variantOffer.json()).toMatchObject({
      error: { code: "menu_section.membership_invalid" },
    });
    const otherCatalogueId = await createCatalogueVia(app, "Other catalogue");
    const mismatched = await send(
      app,
      "GET",
      `/management-api/catalogues/${otherCatalogueId}/items/${offerId}/variants`,
    );
    expect(mismatched.status).toBe(404);
    expect(await mismatched.json()).toMatchObject({ error: { code: "menu_item.not_found" } });
    const preview = await send(app, "GET", `/management-api/catalogues/${catalogueId}/preview`);
    expect(
      ((await preview.json()) as { document: { offers: Record<string, { variants: unknown[] }> } })
        .document.offers[offerId]!.variants,
    ).toEqual([
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
      ordering: "public",
      vatClass: "general",
      variants: [],
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

    const readVariant = await send(app, "GET", `/management-api/products/${variantId}/editor`);
    expect(readVariant.status).toBe(200);
    expect(await readVariant.json()).toMatchObject({ id: variantId, parentId: parent.id });
    expect((await send(app, "GET", `/management-api/products/${parent.id}/editor`)).status).toBe(
      200,
    );

    // A variant offers its parent's lists and has no variants of its own.
    const saveVariant = await send(app, "PUT", `/management-api/products/${variantId}/editor`, {
      // No unit, which a variant's body refuses before its variants.
      body: await editorBody(app, {
        name: "Copa",
        vatClass: "general",
        unitId: null,
        variants: [variant],
      }),
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

    expect(await variantRow()).toEqual({ vat_class: null, category_id: null });

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
    const categoryId = await createCategoryVia(app, `Cafés ${crypto.randomUUID()}`);
    const ownCategoryId = await createCategoryVia(app, `Solos ${crypto.randomUUID()}`);
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
    return {
      parentId: parent.id,
      variantId: parent.variants[0]!.id,
      categoryId,
      ownCategoryId,
    };
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
      primaryCategoryId: null,
      allergens: null,
      dietaryDeclarations: null,
      modifiers: [],
      variants: [],
      inherited: {
        description: { es: "Tostado natural" },
        unitPrice: "2.00",
        vatClass: "reduced",
        primaryCategoryId: categoryId,
        allergens: { milk: { presence: "contains" } },
        dietaryDeclarations: ["vegan"],
      },
    });
  });

  it("saves a variant's override, and a blank returns the field to inheriting", async () => {
    const app = mountApp("es-ES");
    const { variantId } = await parentWithVariant(app);
    const { courseId } = await seedRouting();
    const value = (await (
      await send(app, "GET", `/management-api/products/${variantId}/editor`)
    ).json()) as Record<string, unknown>;
    const stored = async () =>
      (
        await suite.db.execute<Record<string, unknown>>(
          sql`select vat_class, unit_price, category_id, manual_allergens
              from products where id = ${variantId}`,
        )
      ).rows[0];
    const blank = {
      vat_class: null,
      unit_price: null,
      category_id: null,
      manual_allergens: null,
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
        allergens: { eggs: { presence: "contains" } },
        courseId,
      },
    });
    expect(overridden.status).toBe(200);
    expect(await overridden.json()).toMatchObject({
      vatClass: "general",
      unitPrice: "2.60",
      allergens: { eggs: { presence: "contains" } },
      courseId,
    });
    expect(await stored()).toEqual({
      vat_class: "general",
      unit_price: 260,
      category_id: null,
      manual_allergens: JSON.stringify({ eggs: { presence: "contains" } }),
    });

    const cleared = await send(app, "PUT", `/management-api/products/${variantId}/editor`, {
      body: { ...value, unitPrice: null, courseId: null },
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ ...value, unitPrice: null });
    expect(await stored()).toEqual(blank);
  });

  describe("a variant holding a category of its own, stored before a variant always took its parent's", () => {
    async function withStoredCategory(app: Hono) {
      const seeded = await parentWithVariant(app);
      const plantCategory = () =>
        suite.db.execute(
          sql`update products set category_id = ${seeded.ownCategoryId} where id = ${seeded.variantId}`,
        );
      await plantCategory();
      const storedCategory = async () =>
        (
          await suite.db.execute<{ category_id: string | null }>(
            sql`select category_id from products where id = ${seeded.variantId}`,
          )
        ).rows[0]!.category_id;
      return { ...seeded, plantCategory, storedCategory };
    }

    it("is removed and restored by reading its editor value and saving it back", async () => {
      const app = mountApp("es-ES");
      const { variantId, categoryId, ownCategoryId, plantCategory, storedCategory } =
        await withStoredCategory(app);
      const value = (await (
        await send(app, "GET", `/management-api/products/${variantId}/editor`)
      ).json()) as Record<string, unknown>;
      expect(value).toMatchObject({
        primaryCategoryId: null,
        inherited: { primaryCategoryId: categoryId },
      });
      const put = (active: boolean) =>
        send(app, "PUT", `/management-api/products/${variantId}/editor`, {
          body: { ...value, active },
        });
      const removed = await put(false);
      expect(removed.status).toBe(200);
      expect(await removed.json()).toMatchObject({ active: false, primaryCategoryId: null });
      expect(await storedCategory()).toBeNull();
      // Removing cleared it, so it is planted again for Restore to start from a leftover too.
      await plantCategory();
      expect(await storedCategory()).toBe(ownCategoryId);
      const restored = await put(true);
      expect(restored.status).toBe(200);
      expect(await restored.json()).toMatchObject({ active: true, primaryCategoryId: null });
      expect(await storedCategory()).toBeNull();
    });

    it("refuses a save naming a category of its own, and keeps the row as it was", async () => {
      const app = mountApp("es-ES");
      const { variantId, ownCategoryId, storedCategory } = await withStoredCategory(app);
      const value = (await (
        await send(app, "GET", `/management-api/products/${variantId}/editor`)
      ).json()) as Record<string, unknown>;
      const refused = await send(app, "PUT", `/management-api/products/${variantId}/editor`, {
        body: { ...value, primaryCategoryId: ownCategoryId },
      });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({
        error: { code: "product.invalid", params: { field: "primaryCategoryId" } },
      });
      expect(await storedCategory()).toBe(ownCategoryId);
    });
  });

  describe("a variant holding a unit of its own, stored before a variant always took its parent's", () => {
    // The parent sells by the seeded each; the planted row names kg, with a weight pricing unit.
    async function withStoredUnit(app: Hono) {
      const seeded = await parentWithVariant(app);
      const kgUnitId = (
        await suite.db.execute<{ id: string }>(sql`select id from units where seed_key = 'kg'`)
      ).rows[0]!.id;
      const plantUnit = async () => {
        await suite.db.execute(
          sql`insert into product_units (product_id, unit_id) values (${seeded.variantId}, ${kgUnitId})`,
        );
        await suite.db.execute(
          sql`update products set pricing_unit = 'weight' where id = ${seeded.variantId}`,
        );
      };
      await plantUnit();
      const storedUnit = async () =>
        (
          await suite.db.execute<{ unit_id: string | null; pricing_unit: string | null }>(
            sql`select product_units.unit_id, products.pricing_unit from products
                left join product_units on product_units.product_id = products.id
                where products.id = ${seeded.variantId}`,
          )
        ).rows[0]!;
      return { ...seeded, kgUnitId, plantUnit, storedUnit };
    }

    it("is removed and restored by reading its editor value and saving it back", async () => {
      const app = mountApp("es-ES");
      const { variantId, kgUnitId, plantUnit, storedUnit } = await withStoredUnit(app);
      const value = (await (
        await send(app, "GET", `/management-api/products/${variantId}/editor`)
      ).json()) as { unitId: string | null; inherited: { unitId: string | null } };
      expect(value.unitId).toBeNull();
      expect(value.inherited.unitId).not.toBeNull();
      expect(value.inherited.unitId).not.toBe(kgUnitId);
      const put = (active: boolean) =>
        send(app, "PUT", `/management-api/products/${variantId}/editor`, {
          body: { ...value, active },
        });
      const removed = await put(false);
      expect(removed.status).toBe(200);
      expect(await removed.json()).toMatchObject({ active: false, unitId: null });
      expect(await storedUnit()).toEqual({ unit_id: null, pricing_unit: null });
      // Removing cleared it, so it is planted again for Restore to start from a leftover too.
      await plantUnit();
      expect(await storedUnit()).toEqual({ unit_id: kgUnitId, pricing_unit: "weight" });
      const restored = await put(true);
      expect(restored.status).toBe(200);
      expect(await restored.json()).toMatchObject({ active: true, unitId: null });
      expect(await storedUnit()).toEqual({ unit_id: null, pricing_unit: null });
    });

    it("refuses a save naming a unit of its own, and keeps the row as it was", async () => {
      const app = mountApp("es-ES");
      const { variantId, kgUnitId, storedUnit } = await withStoredUnit(app);
      const value = (await (
        await send(app, "GET", `/management-api/products/${variantId}/editor`)
      ).json()) as Record<string, unknown>;
      const refused = await send(app, "PUT", `/management-api/products/${variantId}/editor`, {
        body: { ...value, unitId: kgUnitId },
      });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({
        error: { code: "product.invalid", params: { field: "unitId" } },
      });
      expect(await storedUnit()).toEqual({ unit_id: kgUnitId, pricing_unit: "weight" });
    });
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

  it("lists every variant, a removed one too, with its own price and its effective price, VAT and category", async () => {
    const app = mountApp("es-ES");
    const { parentId, variantId, categoryId, ownCategoryId } = await parentWithVariant(app);
    // Café doble sets its own price (2.40, where the parent's is 2.00) and here its own VAT class,
    // and holds a stored category of its own, which it never reports; Café corto, added Inactive,
    // leaves all three blank.
    const own = (await (
      await send(app, "GET", `/management-api/products/${variantId}/editor`)
    ).json()) as Record<string, unknown>;
    expect(
      (
        await send(app, "PUT", `/management-api/products/${variantId}/editor`, {
          body: { ...own, vatClass: "general" },
        })
      ).status,
    ).toBe(200);
    await suite.db.execute(
      sql`update products set category_id = ${ownCategoryId} where id = ${variantId}`,
    );
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
          primaryCategoryId: categoryId,
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

  // The editor writes Active and Available as two separate states. Each save sets the
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

  // Available "never hides the item from the dashboard", so the menu's price list keeps a
  // sold-out product; an Inactive product stays hidden.
  it("keeps an Unavailable product on the menu's price list and hides an Inactive one", async () => {
    const app = mountApp("es-ES");
    const catalogueId = await createCatalogueVia(app, "Management offers");
    const created = await send(
      app,
      "POST",
      `/management-api/catalogues/${catalogueId}/product-editor`,
      { body: await editorBody(app) },
    );
    const productId = ((await created.json()) as { id: string }).id;
    const offerId = await offerVia(app, catalogueId, productId, "4.50");
    const offeredIds = async (): Promise<string[]> =>
      (await menuPricesVia(app, catalogueId)).map((row) => row.menuItemId);

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

  it("creates a product with its kitchen course in one save", async () => {
    const app = mountApp("es-ES");
    const catalogueId = await createCatalogueVia(app, "Routing catalogue");
    const { courseId } = await seedRouting();
    const created = await send(
      app,
      "POST",
      `/management-api/catalogues/${catalogueId}/product-editor`,
      { body: await editorBody(app, { courseId }) },
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ courseId });
  });

  it("saves the kitchen course on the editor PUT and reads it back", async () => {
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

    const updated = await send(app, "PUT", `/management-api/products/${productId}/editor`, {
      body: await editorBody(app, { name: "Rutas cambiadas", courseId }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ name: "Rutas cambiadas", courseId });
    const read = await send(app, "GET", `/management-api/products/${productId}/editor`);
    expect(await read.json()).toMatchObject({ courseId });
  });

  it("rolls the whole product back when the save names an absent course", async () => {
    const app = mountApp("es-ES");
    const catalogueId = await createCatalogueVia(app, "Routing catalogue");
    const created = await send(
      app,
      "POST",
      `/management-api/catalogues/${catalogueId}/product-editor`,
      {
        body: await editorBody(app),
      },
    );
    const productId = ((await created.json()) as { id: string }).id;
    const beforeValue = await (
      await send(app, "GET", `/management-api/products/${productId}/editor`)
    ).json();
    const missing = crypto.randomUUID();
    const rejected = await send(app, "PUT", `/management-api/products/${productId}/editor`, {
      body: await editorBody(app, { name: "Unsaved", unitPrice: "9.99", courseId: missing }),
    });
    expect(rejected.status).toBe(404);
    expect(await rejected.json()).toMatchObject({ error: { code: "course.not_found" } });
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
    // Omitting `active` creates an active product.
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

  it("POST/PATCH /management-api/products carries ordering, defaulting to public and round-tripping", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Ordering catalogue");
    const referenced = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        name: "Solo ingrediente",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
        ordering: "not_sold_separately",
      },
    });
    expect(referenced.status).toBe(201);
    const referencedBody = (await referenced.json()) as { id: string; ordering: string };
    expect(referencedBody).toMatchObject({ ordering: "not_sold_separately" });
    const referencedId = referencedBody.id;
    // Omitting ordering preserves the column default.
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
    expect((await omitted.json()) as { ordering: string }).toMatchObject({ ordering: "public" });
    const patched = await send(app, "PATCH", `/management-api/products/${referencedId}`, {
      body: { ordering: "staff_only" },
    });
    expect(patched.status).toBe(204);
    const list = await send(app, "GET", `/management-api/catalogues/${catalogueId}/products`);
    const row = ((await list.json()) as { id: string; ordering: string }[]).find(
      (r) => r.id === referencedId,
    )!;
    expect(row).toMatchObject({ ordering: "staff_only" });
  });

  describe.each([
    ["POST", "/management-api/products"],
    ["PATCH", "/management-api/products/:id"],
  ] as const)("%s /management-api/products", (method, template) => {
    async function sendOrdering(fields: Record<string, unknown>) {
      const app = mountApp();
      const catalogueId = await createCatalogueVia(app, `Bad-ordering ${method} catalogue`);
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
              ...fields,
            }
          : fields;
      const res = await send(app, method, path, { body });
      const list = await send(app, "GET", `/management-api/catalogues/${catalogueId}/products`);
      return { res, products: (await list.json()) as { name: string; ordering: string }[] };
    }

    it.each(["secret", "Public", "", true, null, 1])(
      "rejects the ordering %j → management.request_invalid 400, writing nothing",
      async (ordering) => {
        const { res, products } = await sendOrdering({ ordering });
        expect(res.status).toBe(400);
        expect(
          (await res.json()) as { error: { code: string; params: { field: string } } },
        ).toMatchObject({
          error: { code: "management.request_invalid", params: { field: "ordering" } },
        });
        expect(products.map(({ name, ordering }) => ({ name, ordering }))).toEqual([
          { name: "Base", ordering: "public" },
        ]);
      },
    );

    // `ordering` replaced it; ignoring it would tell a caller still sending it that it was saved.
    it.each([true, false])(
      "rejects the retired soldAlone (%j) → management.request_invalid 400",
      async (soldAlone) => {
        const { res } = await sendOrdering({ soldAlone });
        expect(res.status).toBe(400);
        expect(
          (await res.json()) as { error: { code: string; params: { field: string } } },
        ).toMatchObject({
          error: { code: "management.request_invalid", params: { field: "soldAlone" } },
        });
      },
    );
  });

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
    // `manualAllergens`), so the dashboard's diet-override editor can seed from it.
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
    // The refusal is the pre-read's alone: `updateProduct` reports nothing when no row matches.
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
  // The screens run BEFORE the transaction, so these need no real rows — a uuid-shaped id and a
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
      body: { name: "Tapas" },
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
        categoryId: string | null;
        primaryCategoryId: string | null;
        image: string | null;
      }[]
    ).find((r) => r.id === productId)!;
    expect(row).toMatchObject({
      name: "después",
      vatClass: "reduced",
      pricingUnit: "weight",
      categoryId,
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
  // `readJsonBody` turns a literal `null` body into `{}`, so each write route answers its own 4xx
  // (or, for PATCH, the empty-body 204).
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

  // `readJsonBody` coerces a malformed body to `{}` too. Sent raw — `send` would JSON.stringify a
  // valid body.
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
    // `writeProductModifiers` lower-cases every list id before it writes, so a 201 echoing the
    // request would disagree with the caller's next read. The `expect(created).not.toEqual(sent)`
    // line is the control: it fails if the fixture stops being upper-cased.
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
      // which of its fields is the one that went away.
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
      // Same treatment `requireUuidParam` gives a path id.
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
  // venue locale, `es` — the one language every map here fills.
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
      active: true,
    });
    expect(list.defaultLabelId).toBe(list.labels[0]!.id);
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
    const productId = await createNamedProductVia(app, `Filete ${crypto.randomUUID()}`);
    const attached = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: { modifiers: [{ kind: "options", id: list.id }] },
    });
    expect(attached.status).toBe(204);
    const res = await send(app, "GET", "/management-api/modifiers/options");
    expect(res.status).toBe(200);
    const { optionLists } = (await res.json()) as { optionLists: OptionListRow[] };
    const row = optionLists.find((entry) => entry.id === list.id)!;
    expect(row).toMatchObject({
      name: "Lista listada",
      labels: [{ name: "Poco hecho" }, { name: "Al punto" }],
    });
    expect(row.usage).toEqual({ products: 1 });
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
    // Every gated route, as [method, path, body]. Each route is checked BOTH ways, so a route missing
    // one of the two refusals cannot hide behind a sibling that has it.
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
    expect(await res.json()).toEqual({ dependants: { products: [] } });
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

  it("shows a manager the extras lists using a product and refuses staff", async () => {
    const app = mountApp();
    const [alioli] = await twoProducts(app);
    const list = await createListVia(app, sauces([alioli]));
    const path = `/management-api/products/${alioli}/extra-usage`;

    const response = await send(app, "GET", path);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        productId: alioli,
        productName: expect.stringContaining("Alioli"),
        lists: [{ id: list.id, name: "Salsas", menus: [] }],
      },
    ]);
    expect((await send(app, "GET", path, { cookie: staffCookie })).status).toBe(403);
  });

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
    const productId = await createNamedProductVia(app, `Patatas ${crypto.randomUUID()}`);
    const attached = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: { modifiers: [{ kind: "extras", id: list.id }] },
    });
    expect(attached.status).toBe(204);
    const res = await send(app, "GET", "/management-api/modifiers/extras");
    expect(res.status).toBe(200);
    const { extraLists } = (await res.json()) as { extraLists: ExtraListRow[] };
    const row = extraLists.find((entry) => entry.id === list.id)!;
    expect(row).toMatchObject({
      name: "Lista listada",
      kitchenName: "SALSA",
      items: [{ productId: alioli, price: "0.50" }],
    });
    expect(row.usage).toEqual({ products: 1 });
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
      dependants: { products: [{ id: productId, name: "Producto con opciones" }] },
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

  it("includes an inherited variant's extras list in its parent's unit-change usage", async () => {
    const app = mountApp();
    const parentId = await createNamedProductVia(app, `Wine ${crypto.randomUUID()}`);
    const created = await send(app, "PUT", `/management-api/products/${parentId}/editor`, {
      body: { ...(await editor(app, parentId)), variants: [copa(true)] },
    });
    expect(created.status).toBe(200);
    const variantId = ((await created.json()) as Editor).variants[0]!.id;
    const list = await send(app, "POST", "/management-api/modifiers/extras", {
      body: { name: "Wine extras", items: [{ productId: variantId }] },
    });
    expect(list.status).toBe(201);
    const { extraList } = (await list.json()) as { extraList: ExtraList };

    const response = await send(app, "GET", `/management-api/products/${parentId}/extra-usage`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        productId: variantId,
        productName: "Copa",
        lists: [{ id: extraList.id, name: "Wine extras", menus: [] }],
      },
    ]);

    const [each] = (
      await suite.db.execute<{ id: string }>(sql`select id from units where seed_key = 'each'`)
    ).rows;
    await suite.db.execute(
      sql`insert into product_units (product_id, unit_id) values (${variantId}, ${each!.id})`,
    );
    const after = await send(app, "GET", `/management-api/products/${parentId}/extra-usage`);
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual([
      {
        productId: variantId,
        productName: "Copa",
        lists: [{ id: extraList.id, name: "Wine extras", menus: [] }],
      },
    ]);
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

describe("a menu's structure", () => {
  it("creates a menu with its top level, and reads what the top level holds", async () => {
    const app = mountApp();
    const menuId = await createCatalogueVia(app, "Structured menu");
    const path = `/management-api/catalogues/${menuId}/structure`;
    expect((await send(app, "GET", path, { cookie: null })).status).toBe(401);
    expect((await send(app, "GET", path, { cookie: staffCookie })).status).toBe(403);
    const empty = await send(app, "GET", path);
    expect(empty.status).toBe(200);
    const { rootSectionId, nodes, root } = (await empty.json()) as {
      root: {
        internalName: string;
        names: Record<string, string>;
        image: string | null;
        color: string | null;
      };
      rootSectionId: string;
      nodes: unknown[];
    };
    expect(nodes).toEqual([]);
    const [shell] = await suite.db.select().from(menuDetails).where(eq(menuDetails.menuId, menuId));
    expect(shell).toMatchObject({ menuId, rootSectionId });
    expect(root).toMatchObject({ names: {}, image: null, color: null });

    const productId = await createNamedProductVia(app, `Oferta ${crypto.randomUUID()}`);
    const drinksName = `Drinks ${crypto.randomUUID()}`;
    const drinksMenu = await createCatalogueVia(app, drinksName);
    const drinks = { id: await menuRootVia(app, drinksMenu) };
    const members = `/management-api/sections/${rootSectionId}/members`;
    const onRoot = await send(app, "POST", members, {
      body: { ref: { kind: "section", sectionId: drinks.id } },
    });
    expect(onRoot.status).toBe(201);
    const item = await send(app, "POST", members, {
      body: { ref: { kind: "product", productId } },
    });
    expect(item.status).toBe(201);
    expect(((await (await send(app, "GET", path)).json()) as { nodes: unknown[] }).nodes).toEqual([
      {
        memberId: ((await onRoot.json()) as { id: string }).id,
        ref: { kind: "section", sectionId: drinks.id },
        internalName: drinksName,
        names: {},
        image: null,
        color: null,
        ownerMenuId: drinksMenu,
        includedMenuId: drinksMenu,
        children: [],
      },
      { memberId: ((await item.json()) as { id: string }).id, ref: { kind: "product", productId } },
    ]);

    expect(
      (await send(app, "GET", `/management-api/catalogues/${crypto.randomUUID()}/structure`))
        .status,
    ).toBe(404);
    expect((await send(app, "GET", "/management-api/catalogues/bad-id/structure")).status).toBe(
      400,
    );
  });

  it("switches a product back on for a menu after it was switched off there", async () => {
    const app = mountApp();
    const menuId = await createCatalogueVia(app, "Switched menu");
    const productId = await createNamedProductVia(app, `Oferta ${crypto.randomUUID()}`);
    const items = `/management-api/catalogues/${menuId}/items`;
    const itemId = await offerVia(app, menuId, productId, "2.00");
    const offered = async () =>
      (await menuPricesVia(app, menuId)).map(({ menuItemId, override, offered }) => ({
        menuItemId,
        override,
        offered,
      }));
    expect(
      (await send(app, "PATCH", `${items}/${itemId}`, { body: { offered: false } })).status,
    ).toBe(204);
    expect(await offered()).toEqual([{ menuItemId: itemId, override: "2.00", offered: false }]);
    // Still on the menu's top level, so adding it again is refused rather than duplicated.
    const rootSectionId = await menuRootVia(app, menuId);
    const again = await send(app, "POST", `/management-api/sections/${rootSectionId}/members`, {
      body: { ref: { kind: "product", productId } },
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "menu_section.member_duplicate" } });
    const bad = await send(app, "PATCH", `${items}/${itemId}`, { body: { offered: "yes" } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "offered" } },
    });
    expect(
      (await send(app, "PATCH", `${items}/${itemId}`, { body: { offered: true } })).status,
    ).toBe(204);
    expect(await offered()).toEqual([{ menuItemId: itemId, override: "2.00", offered: true }]);
  });

  it("takes a product off a menu's top level, and then adds it again on the same row", async () => {
    const app = mountApp();
    const menuId = await createCatalogueVia(app, "Removed menu");
    const productId = await createNamedProductVia(app, `Oferta ${crypto.randomUUID()}`);
    const itemId = await offerVia(app, menuId, productId, "2.00");
    const structure = (await (
      await send(app, "GET", `/management-api/catalogues/${menuId}/structure`)
    ).json()) as { rootSectionId: string; nodes: { memberId: string }[] };
    const members = `/management-api/sections/${structure.rootSectionId}/members`;
    expect((await send(app, "DELETE", `${members}/${structure.nodes[0]!.memberId}`)).status).toBe(
      204,
    );
    expect(await menuPricesVia(app, menuId)).toEqual([]);
    const again = await send(app, "POST", members, {
      body: { ref: { kind: "product", productId } },
    });
    expect(again.status).toBe(201);
    expect(await menuPricesVia(app, menuId)).toMatchObject([
      { menuItemId: itemId, override: null, offered: null },
    ]);
  });
});

describe("a menu's prices", () => {
  it("lists each product the menu reaches with its own price, the menu's override and the price charged", async () => {
    const app = mountApp();
    const menuId = await createCatalogueVia(app, "Priced menu");
    const name = `Oferta ${crypto.randomUUID()}`;
    const product = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId: await createCatalogueVia(app, `Catalogue for ${name}`),
        categoryId: null,
        name,
        customerName: { en: `${name} (customer)`, es: `${name} (cliente)` },
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      },
    });
    expect(product.status).toBe(201);
    const productId = ((await product.json()) as { id: string }).id;
    // This route takes no kitchen name, so it is written to the row.
    await suite.db.execute(
      sql`update products set kitchen_name = ${`${name} (kitchen)`} where id = ${productId}`,
    );
    const items = `/management-api/catalogues/${menuId}/items`;
    const itemId = await offerVia(app, menuId, productId, "1.40");
    const path = `/management-api/catalogues/${menuId}/prices`;
    expect((await send(app, "GET", path, { cookie: null })).status).toBe(401);
    expect((await send(app, "GET", path, { cookie: staffCookie })).status).toBe(403);
    const res = await send(app, "GET", path);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        menuItemId: itemId,
        combined: {
          productId,
          offered: { state: "decided", value: true, source: { kind: "product" }, otherwise: null },
          price: {
            state: "decided",
            value: "1.40",
            source: { kind: "own" },
            otherwise: {
              state: "decided",
              value: "1.00",
              source: { kind: "product" },
              otherwise: null,
            },
          },
          variants: [],
        },
        productId,
        name,
        categoryId: null,
        placements: [[]],
        productPrice: "1.00",
        override: "1.40",
        effectivePrice: "1.40",
        offered: null,
        variants: [],
      },
    ]);
    // "Use product price" clears the override, and the row then charges the product's own price.
    expect(
      (await send(app, "PATCH", `${items}/${itemId}`, { body: { grossPrice: null } })).status,
    ).toBe(204);
    expect(await (await send(app, "GET", path)).json()).toMatchObject([
      { menuItemId: itemId, productPrice: "1.00", override: null, effectivePrice: "1.00" },
    ]);

    const unknown = await send(
      app,
      "GET",
      `/management-api/catalogues/${crypto.randomUUID()}/prices`,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "catalogue.not_found" } });
    const bad = await send(app, "GET", "/management-api/catalogues/bad-id/prices");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      error: { code: "shared.invalid_id", params: { kind: "MenuId", value: "bad-id" } },
    });
  });
});

describe("publishing a menu", () => {
  const HASH = /^[0-9a-f]{64}$/;

  /** A new menu offering one new product at a menu price of 2.00. */
  async function menuWithProduct(
    app: Hono,
  ): Promise<{ menuId: string; itemId: string; name: string }> {
    const menuId = await createCatalogueVia(app, `Published menu ${crypto.randomUUID()}`);
    const name = `Oferta ${crypto.randomUUID()}`;
    const productId = await createNamedProductVia(app, name);
    return { menuId, itemId: await offerVia(app, menuId, productId, "2.00"), name };
  }

  async function preview(app: Hono, menuId: string): Promise<MenuPreview> {
    const res = await send(app, "GET", `/management-api/catalogues/${menuId}/preview`);
    expect(res.status).toBe(200);
    return (await res.json()) as MenuPreview;
  }

  async function status(app: Hono, menuId: string): Promise<MenuStatus> {
    const res = await send(app, "GET", `/management-api/catalogues/${menuId}/status`);
    expect(res.status).toBe(200);
    return (await res.json()) as MenuStatus;
  }

  async function versionsOf(menuId: string) {
    return suite.db
      .select({ number: menuVersions.number, publishedBy: menuVersions.publishedBy })
      .from(menuVersions)
      .where(eq(menuVersions.menuId, menuId))
      .orderBy(menuVersions.number);
  }

  it("shows included on/off clashes in prices and refuses publication without a version", async () => {
    const app = mountApp();
    const child = await createCatalogueVia(app, `Drinks ${crypto.randomUUID()}`);
    const parent = await createCatalogueVia(app, `Evening ${crypto.randomUUID()}`);
    const productId = await createNamedProductVia(app, `Lager ${crypto.randomUUID()}`);
    const childItem = await offerVia(app, child, productId, "2.00");
    await offerVia(app, parent, productId);
    const childRoot = await menuRootVia(app, child);
    const parentRoot = await menuRootVia(app, parent);
    const included = await send(app, "POST", `/management-api/sections/${parentRoot}/members`, {
      body: { ref: { kind: "section", sectionId: childRoot } },
    });
    expect(included.status).toBe(201);
    expect(
      (
        await send(app, "PATCH", `/management-api/catalogues/${child}/items/${childItem}`, {
          body: { offered: false },
        })
      ).status,
    ).toBe(204);
    const rows = await (
      await send(app, "GET", `/management-api/catalogues/${parent}/prices`)
    ).json();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId,
          combined: expect.objectContaining({
            offered: { state: "clash", candidates: expect.any(Array) },
          }),
        }),
      ]),
    );
    const proposed = await preview(app, parent);
    expect(proposed.clashes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId, field: "offered", variantId: null }),
      ]),
    );
    const refused = await send(app, "POST", `/management-api/catalogues/${parent}/publish`, {
      body: { expectedHash: proposed.hash },
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: { code: "menu.clashes_unresolved", params: { menuId: parent, count: 1 } },
    });
    expect(await versionsOf(parent)).toEqual([]);
  });

  it("previews, publishes and reports a menu as unpublished, current, then changed", async () => {
    const app = mountApp();
    const { menuId, itemId, name } = await menuWithProduct(app);
    expect(await status(app, menuId)).toEqual({ state: "unpublished", clashes: 0 });

    const first = await preview(app, menuId);
    expect(first.hash).toMatch(HASH);
    expect(first.changes).toEqual([
      expect.objectContaining({ kind: "product_added", name, under: [], source: "this_menu" }),
    ]);
    expect(first.warnings).toEqual([]);
    expect(first.status).toEqual({ state: "unpublished", clashes: 0 });
    expect(first.document).toMatchObject({ menuId, menuName: expect.any(String) });
    expect(first.document.root.members).toEqual([
      { kind: "product", menuItemId: itemId, productId: expect.any(String) },
    ]);
    expect(first.document.offers[itemId]).toMatchObject({ name, grossPrice: "2.00" });

    const publish = `/management-api/catalogues/${menuId}/publish`;
    const published = await send(app, "POST", publish, { body: { expectedHash: first.hash } });
    expect(published.status).toBe(200);
    const one = (await published.json()) as { versionId: string; number: number };
    expect(one).toEqual({ versionId: expect.any(String), number: 1 });
    expect(await versionsOf(menuId)).toEqual([{ number: 1, publishedBy: managerPersonId }]);
    expect(await status(app, menuId)).toEqual({
      state: "current",
      clashes: 0,
      version: 1,
      publishedAt: expect.any(String),
      hash: first.hash,
    });
    const current = await status(app, menuId);
    expect(await preview(app, menuId)).toEqual({
      clashes: [],
      hash: first.hash,
      changes: [],
      warnings: [],
      status: current,
      document: first.document,
    });

    expect(
      (
        await send(app, "PATCH", `/management-api/catalogues/${menuId}/items/${itemId}`, {
          body: { grossPrice: "2.50" },
        })
      ).status,
    ).toBe(204);
    expect(await status(app, menuId)).toMatchObject({ state: "changed", clashes: 0, version: 1 });
    const second = await preview(app, menuId);
    expect(second.hash).not.toBe(first.hash);
    expect(second.changes).toEqual([
      expect.objectContaining({ kind: "price_changed", name, from: "2.00", to: "2.50" }),
    ]);
    expect(second.status).toEqual({ ...current, state: "changed", clashes: 0 });
    const again = await send(app, "POST", publish, { body: { expectedHash: second.hash } });
    expect(again.status).toBe(200);
    const two = (await again.json()) as { versionId: string; number: number };
    expect(two.number).toBe(2);
    expect(two.versionId).not.toBe(one.versionId);
    const [live] = await suite.db
      .select({ versionId: menuPublications.versionId })
      .from(menuPublications)
      .where(eq(menuPublications.menuId, menuId));
    expect(live).toEqual({ versionId: two.versionId });
    expect(await status(app, menuId)).toMatchObject({ state: "current", clashes: 0, version: 2 });
  });

  it("refuses a hash from before the latest edit and writes nothing", async () => {
    const app = mountApp();
    const { menuId, itemId } = await menuWithProduct(app);
    const stale = (await preview(app, menuId)).hash;
    await send(app, "PATCH", `/management-api/catalogues/${menuId}/items/${itemId}`, {
      body: { grossPrice: "3.00" },
    });
    const refused = await send(app, "POST", `/management-api/catalogues/${menuId}/publish`, {
      body: { expectedHash: stale },
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: { code: "menu.changed_since_preview", params: { menuId } },
    });
    expect(await versionsOf(menuId)).toEqual([]);
    expect(await status(app, menuId)).toEqual({ state: "unpublished", clashes: 0 });
  });

  it("answers a publish of an unchanged menu with its live version, writing nothing", async () => {
    const app = mountApp();
    const { menuId } = await menuWithProduct(app);
    const { hash } = await preview(app, menuId);
    const publish = `/management-api/catalogues/${menuId}/publish`;
    const first = await send(app, "POST", publish, { body: { expectedHash: hash } });
    expect(first.status).toBe(200);
    const live = (await first.json()) as { versionId: string; number: number };
    const again = await send(app, "POST", publish, { body: { expectedHash: hash } });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(live);
    expect(await versionsOf(menuId)).toEqual([{ number: 1, publishedBy: managerPersonId }]);
  });

  it("warns about a shortcut that publishing keeps as an empty slot", async () => {
    const app = mountApp();
    const { menuId } = await menuWithProduct(app);
    const offMenu = `Fuera ${crypto.randomUUID()}`;
    const productId = await createNamedProductVia(app, offMenu);
    const [details] = await suite.db
      .select({ layoutId: menuDetails.defaultHomeLayoutId })
      .from(menuDetails)
      .where(eq(menuDetails.menuId, menuId));
    await suite.db
      .insert(sectionMembers)
      .values({ sectionId: details!.layoutId, position: 0, productId });
    expect((await preview(app, menuId)).warnings).toEqual([
      { kind: "shortcut_missing", layoutName: expect.any(String), name: offMenu },
    ]);
  });

  it("answers every menu's status in one request", async () => {
    const app = mountApp();
    const published = await menuWithProduct(app);
    const { hash } = await preview(app, published.menuId);
    await send(app, "POST", `/management-api/catalogues/${published.menuId}/publish`, {
      body: { expectedHash: hash },
    });
    const unpublished = await menuWithProduct(app);
    const path = "/management-api/catalogues/status";
    const anonymous = await send(app, "GET", path, { cookie: null });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({
      error: { code: "management_session.required" },
    });
    const staff = await send(app, "GET", path, { cookie: staffCookie });
    expect(staff.status).toBe(403);
    expect(await staff.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    const res = await send(app, "GET", path);
    expect(res.status).toBe(200);
    const all = (await res.json()) as Record<string, MenuStatus>;
    expect(all[published.menuId]).toEqual({
      state: "current",
      clashes: 0,
      version: 1,
      publishedAt: expect.any(String),
      hash,
    });
    expect(all[unpublished.menuId]).toEqual({ state: "unpublished", clashes: 0 });
    const menus = (await (await send(app, "GET", "/management-api/catalogues")).json()) as {
      id: string;
    }[];
    expect(Object.keys(all).sort()).toEqual(menus.map((menu) => menu.id).sort());
  });

  it.each(["status", "preview"])(
    "refuses GET …/%s without a manager, or for no menu",
    async (tail) => {
      const app = mountApp();
      const { menuId } = await menuWithProduct(app);
      const path = `/management-api/catalogues/${menuId}/${tail}`;
      const anonymous = await send(app, "GET", path, { cookie: null });
      expect(anonymous.status).toBe(401);
      expect(await anonymous.json()).toMatchObject({
        error: { code: "management_session.required" },
      });
      const staff = await send(app, "GET", path, { cookie: staffCookie });
      expect(staff.status).toBe(403);
      expect(await staff.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
      const missing = crypto.randomUUID();
      const unknown = await send(app, "GET", `/management-api/catalogues/${missing}/${tail}`);
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toMatchObject({
        error: { code: "catalogue.not_found", params: { catalogueId: missing } },
      });
      const bad = await send(app, "GET", `/management-api/catalogues/bad-id/${tail}`);
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({
        error: { code: "shared.invalid_id", params: { kind: "MenuId", value: "bad-id" } },
      });
    },
  );

  it("refuses a publish without a manager, for no menu, or without a hash", async () => {
    const app = mountApp();
    const { menuId } = await menuWithProduct(app);
    const { hash } = await preview(app, menuId);
    const path = `/management-api/catalogues/${menuId}/publish`;
    const body = { expectedHash: hash };
    const anonymous = await send(app, "POST", path, { body, cookie: null });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({
      error: { code: "management_session.required" },
    });
    const staff = await send(app, "POST", path, { body, cookie: staffCookie });
    expect(staff.status).toBe(403);
    expect(await staff.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    const missing = crypto.randomUUID();
    const unknown = await send(app, "POST", `/management-api/catalogues/${missing}/publish`, {
      body,
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({
      error: { code: "catalogue.not_found", params: { catalogueId: missing } },
    });
    const bad = await send(app, "POST", "/management-api/catalogues/bad-id/publish", { body });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "shared.invalid_id" } });
    for (const refusedBody of [{}, { expectedHash: 4 }, { expectedHash: null }, null]) {
      const res = await send(app, "POST", path, { body: refusedBody });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "expectedHash" } },
      });
    }
    const malformed = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: "{ not json",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "expectedHash" } },
    });
    expect(await versionsOf(menuId)).toEqual([]);
  });
});

it.each([
  ["DELETE", "/management-api/categories/00000000-0000-0000-0000-000000000001"],
  ["GET", "/management-api/categories/00000000-0000-0000-0000-000000000001/dependants"],
  ["GET", "/management-api/categories/00000000-0000-0000-0000-000000000001/products"],
  ["POST", "/management-api/categories/00000000-0000-0000-0000-000000000001/products"],
  ["PUT", "/management-api/products/00000000-0000-0000-0000-000000000001/categories"],
] as const)("retired Categories route %s %s answers 404", async (method, path) => {
  const app = mountApp("en-GB");
  const response = await send(app, method, path, method === "GET" ? {} : { body: {} });
  expect(response.status).toBe(404);
  expect(await response.text()).toBe("404 Not Found");
});

it("authors a hierarchy and requires a session to read it", async () => {
  const app = mountApp("en-GB");
  await suite.db.execute(sql`delete from content_languages`);
  const created = await send(app, "POST", "/management-api/categories", {
    body: { name: "Food", parentId: null },
  });
  expect(created.status).toBe(201);
  const category = (await created.json()) as { id: string };
  const path = `/management-api/categories/${category.id}`;
  expect(await (await send(app, "GET", path)).json()).toEqual({
    id: category.id,
    name: "Food",
    parentId: null,
  });
  const cycle = await send(app, "PATCH", path, { body: { parentId: category.id } });
  expect(cycle.status).toBe(409);
  expect(await cycle.json()).toMatchObject({ error: { code: "category.parent_cycle" } });
  const catalogueId = await createCatalogueVia(app, "Main category menu");
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
  expect((await send(app, "GET", path, { cookie: null })).status).toBe(401);
});

// A negative CATALOGUE price is never a valid one (owner ruling, 2026-09-21) — the scope matters,
// because a corrective invoice's prices are deliberately negative elsewhere in the tree. This block
// pins the routes `refuseNegativePrice` screens; the next pins a sample of those that refuse a
// negative through their own checks.
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

  it("the menu-item write refuses a negative grossPrice with a 400, not a 500", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Negative menu catalogue");
    const productId = await createNamedProductVia(app, `Oferta ${crypto.randomUUID()}`);
    const items = `/management-api/catalogues/${catalogueId}/items`;
    const itemId = await offerVia(app, catalogueId, productId);

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

  it("the menu-item write takes a blank grossPrice as the product's own price", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Blank menu price catalogue");
    // The product's own price is 1.00, so a blank menu price must charge exactly that.
    const productId = await createNamedProductVia(app, `Oferta ${crypto.randomUUID()}`);
    const items = `/management-api/catalogues/${catalogueId}/items`;
    const offer = async () => (await menuPricesVia(app, catalogueId))[0]!;

    const itemId = await offerVia(app, catalogueId, productId);
    expect(await offer()).toMatchObject({ override: null, effectivePrice: "1.00" });

    expect(
      (await send(app, "PATCH", `${items}/${itemId}`, { body: { grossPrice: "2.50" } })).status,
    ).toBe(204);
    expect(await offer()).toMatchObject({ override: "2.50", effectivePrice: "2.50" });
    expect(
      (await send(app, "PATCH", `${items}/${itemId}`, { body: { grossPrice: null } })).status,
    ).toBe(204);
    expect(await offer()).toMatchObject({ override: null, effectivePrice: "1.00" });

    // A value of the wrong type is still refused, and changes nothing.
    const wrongPatch = await send(app, "PATCH", `${items}/${itemId}`, {
      body: { grossPrice: 2.5 },
    });
    expect(wrongPatch.status).toBe(400);
    expect(await wrongPatch.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "grossPrice" } },
    });
    expect(await offer()).toMatchObject({ override: null, effectivePrice: "1.00" });
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

// Catalogue write routes that refuse a negative through `isProductPrice`
// (`packages/catalogue/src/modifier-limits.ts`), whose pattern carries no sign. Pinned at the ROUTE,
// which the package tests on the operations behind them cannot cover. This is the set that was
// checked, not a claim that no other route carries a price.
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
      ordering: "public",
      vatClass: "general",
      variants: [variant("A", "2.00"), variant("B", "3.00")],
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

    const itemId = await offerVia(app, catalogueId, saved.id, "1.00");
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

    // The extras list UPDATE, and a negative VARIANT price on the editor UPDATE.
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

describe("mountCatalogueApi — sections", () => {
  interface Member {
    id: string;
    position: number;
    ref: { kind: "product"; productId: string } | { kind: "section"; sectionId: string };
  }
  interface Section {
    id: string;
    internalName: string;
    names: Record<string, string>;
    image: string | null;
    color: string | null;
    members: Member[];
  }
  const json = async <T>(response: Response, status: number): Promise<T> => {
    expect(response.status).toBe(status);
    return (await response.json()) as T;
  };
  async function createSectionVia(app: Hono, internalName: string): Promise<Section> {
    const menuId = await createCatalogueVia(app, internalName);
    const root = await menuRootVia(app, menuId);
    return json<Section>(await send(app, "GET", `/management-api/sections/${root}`), 200);
  }
  const product = (productId: string) => ({ kind: "product", productId });
  const section = (sectionId: string) => ({ kind: "section", sectionId });

  it("creates, reads, updates and deletes an owned section", async () => {
    const app = mountApp();
    const name = `Bebidas ${crypto.randomUUID()}`;
    const menuId = await createCatalogueVia(app, "Owner");
    const root = await menuRootVia(app, menuId);
    const { id } = await json<{ id: string }>(
      await send(app, "POST", `/management-api/sections/${root}/sections`, {
        body: { internalName: ` ${name} `, names: { es: "Bebidas" }, color: "#aabbcc" },
      }),
      201,
    );
    const created = await json<Section>(
      await send(app, "GET", `/management-api/sections/${id}`),
      200,
    );
    expect(created).toEqual({
      id: created.id,
      internalName: name,
      names: { es: "Bebidas" },
      image: null,
      color: "#aabbcc",
      members: [],
    });
    const path = `/management-api/sections/${created.id}`;
    expect(await json(await send(app, "GET", path), 200)).toEqual(created);
    const updated = await json<Section>(
      await send(app, "PATCH", path, { body: { internalName: `${name} 2`, color: null } }),
      200,
    );
    expect(updated).toEqual({ ...created, internalName: `${name} 2`, color: null });
    expect((await send(app, "DELETE", path)).status).toBe(204);
    const gone = await send(app, "GET", path);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({
      error: { code: "menu_section.not_found", params: { sectionId: created.id } },
    });
  });

  it("adds, lists, moves, replaces and removes members of an included menu", async () => {
    const app = mountApp();
    const menuId = await createCatalogueVia(app, `Carta ${crypto.randomUUID()}`);
    const root = await menuRootVia(app, menuId);
    const drinks = await createSectionVia(app, `Bebidas ${crypto.randomUUID()}`);
    const beer = await createSectionVia(app, `Cervezas ${crypto.randomUUID()}`);
    const water = await createNamedProductVia(app, "Agua");
    const juice = await createNamedProductVia(app, "Zumo");
    const lager = await createNamedProductVia(app, "Lager");
    const members = `/management-api/sections/${drinks.id}/members`;

    const first = await json<Member>(
      await send(app, "POST", members, { body: { ref: product(water) } }),
      201,
    );
    expect(first).toEqual({ id: first.id, position: 0, ref: product(water) });
    const nested = await json<Member>(
      await send(app, "POST", members, { body: { ref: section(beer.id), position: 0 } }),
      201,
    );
    expect(nested.position).toBe(0);
    expect(
      await json(
        await send(app, "POST", `${members}/products`, { body: { productIds: [water, juice] } }),
        200,
      ),
    ).toEqual({ added: 1 });
    const listed = await json<Member[]>(await send(app, "GET", members), 200);
    expect(listed.map((member) => member.ref)).toEqual([
      section(beer.id),
      product(water),
      product(juice),
    ]);
    const moved = await json<Member[]>(
      await send(app, "PUT", `${members}/${nested.id}/position`, { body: { to: 2 } }),
      200,
    );
    expect(moved.map((member) => member.ref)).toEqual([
      product(water),
      product(juice),
      section(beer.id),
    ]);
    const replaced = await json<Member>(
      await send(app, "POST", `${members}/${first.id}/replace`, { body: { ref: product(lager) } }),
      200,
    );
    expect(replaced).toEqual({ id: first.id, position: 0, ref: product(lager) });
    expect((await send(app, "DELETE", `${members}/${replaced.id}`)).status).toBe(204);
    expect(
      (await json<Member[]>(await send(app, "GET", members), 200)).map((member) => member.ref),
    ).toEqual([product(juice), section(beer.id)]);

    await json(
      await send(app, "POST", `/management-api/sections/${root}/members`, {
        body: { ref: section(drinks.id) },
      }),
      201,
    );
    const included = await json<{ includedBy: { id: string }[] }>(
      await send(
        app,
        "GET",
        `/management-api/catalogues/${(await suite.db.execute<{ owner: string }>(sql`select owner_menu_id as owner from sections where id=${drinks.id}`)).rows[0]!.owner}/structure`,
      ),
      200,
    );
    expect(included.includedBy.map((menu) => menu.id)).toContain(menuId);
  });

  it("answers a refused member write with its code and status", async () => {
    const app = mountApp();
    const menuId = await createCatalogueVia(app, `Carta ${crypto.randomUUID()}`);
    const root = await menuRootVia(app, menuId);
    const a = await createSectionVia(app, `A ${crypto.randomUUID()}`);
    const b = await createSectionVia(app, `B ${crypto.randomUUID()}`);
    const water = await createNamedProductVia(app, "Agua");
    const members = (id: string) => `/management-api/sections/${id}/members`;
    await json(await send(app, "POST", members(a.id), { body: { ref: section(b.id) } }), 201);
    await json(await send(app, "POST", members(a.id), { body: { ref: product(water) } }), 201);
    for (const [path, body, status, code] of [
      [members(b.id), { ref: section(a.id) }, 409, "menu_section.member_cycle"],
      [members(a.id), { ref: product(water) }, 409, "menu_section.member_duplicate"],
      [members(a.id), { ref: section(a.id) }, 409, "menu_section.member_cycle"],
      [
        members(a.id),
        { ref: product("11111111-1111-4111-8111-111111111111") },
        400,
        "menu_section.membership_invalid",
      ],
      [
        `${members(a.id)}/products`,
        { productIds: ["11111111-1111-4111-8111-111111111111"] },
        400,
        "menu_section.membership_invalid",
      ],
      [members(a.id), { ref: product(water), position: -1 }, 400, "menu_section.invalid"],
      [members(crypto.randomUUID()), { ref: product(water) }, 404, "menu_section.not_found"],
    ] as const) {
      const response = await send(app, "POST", path, { body });
      expect(response.status, code).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    const blank = await send(app, "POST", `/management-api/sections/${root}/sections`, {
      body: { internalName: "  " },
    });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toMatchObject({
      error: { code: "menu_section.invalid", params: { field: "internalName" } },
    });
    const owned = await send(app, "DELETE", `/management-api/sections/${root}`);
    expect(owned.status).toBe(409);
    expect(await owned.json()).toMatchObject({ error: { code: "menu_section.wrong_role" } });
    const unknownMember = crypto.randomUUID();
    const missing = await send(app, "DELETE", `${members(a.id)}/${unknownMember}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      error: {
        code: "menu_section.not_found",
        params: { sectionId: a.id, memberId: unknownMember },
      },
    });
    const unknownList = crypto.randomUUID();
    const unlisted = await send(app, "GET", members(unknownList));
    expect(unlisted.status).toBe(404);
    expect(await unlisted.json()).toMatchObject({
      error: { code: "menu_section.not_found", params: { sectionId: unknownList } },
    });
  });

  it("screens every section body's shape and ids", async () => {
    const app = mountApp();
    const s = await createSectionVia(app, `S ${crypto.randomUUID()}`);
    const id = s.id;
    const member = crypto.randomUUID();
    const uuid = "11111111-1111-4111-8111-111111111111";
    const cases: [method: "POST" | "PATCH" | "PUT", path: string, body: unknown, field: string][] =
      [
        ["POST", `/management-api/sections/${id}/sections`, {}, "internalName"],
        ["POST", `/management-api/sections/${id}/sections`, { internalName: 7 }, "internalName"],
        [
          "POST",
          `/management-api/sections/${id}/sections`,
          { internalName: "X", names: "x" },
          "names",
        ],
        [
          "POST",
          `/management-api/sections/${id}/sections`,
          { internalName: "X", names: { en: 5 } },
          "names",
        ],
        ["PATCH", `/management-api/sections/${id}`, { names: { en: "Ok", es: null } }, "names"],
        [
          "POST",
          `/management-api/sections/${id}/sections`,
          { internalName: "X", image: 7 },
          "image",
        ],
        [
          "POST",
          `/management-api/sections/${id}/sections`,
          { internalName: "X", color: 7 },
          "color",
        ],
        ["PATCH", `/management-api/sections/${id}`, { internalName: 7 }, "internalName"],
        ["PATCH", `/management-api/sections/${id}`, { names: [] }, "names"],
        ["POST", `/management-api/sections/${id}/members`, {}, "ref"],
        ["POST", `/management-api/sections/${id}/members`, { ref: { kind: "x" } }, "ref"],
        [
          "POST",
          `/management-api/sections/${id}/members`,
          { ref: { kind: "product", productId: 7 } },
          "ref",
        ],
        [
          "POST",
          `/management-api/sections/${id}/members`,
          { ref: { kind: "section", sectionId: 7 } },
          "ref",
        ],
        [
          "POST",
          `/management-api/sections/${id}/members`,
          { ref: { kind: "product", productId: uuid }, position: "0" },
          "position",
        ],
        ["POST", `/management-api/sections/${id}/members/products`, {}, "productIds"],
        [
          "POST",
          `/management-api/sections/${id}/members/products`,
          { productIds: "nope" },
          "productIds",
        ],
        [
          "POST",
          `/management-api/sections/${id}/members/products`,
          { productIds: [uuid, 7] },
          "productIds",
        ],
        ["PUT", `/management-api/sections/${id}/members/${member}/position`, {}, "to"],
        ["POST", `/management-api/sections/${id}/members/${member}/replace`, {}, "ref"],
      ];
    for (const [method, path, body, field] of cases) {
      const response = await send(app, method, path, { body });
      expect(response.status, `${method} ${path} ${JSON.stringify(body)}`).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
    // A malformed id inside a body is refused as the categories' product list refuses one.
    const idCases: [method: "POST", path: string, body: unknown, kind: string][] = [
      [
        "POST",
        `/management-api/sections/${id}/members`,
        { ref: { kind: "product", productId: "nope" } },
        "ProductId",
      ],
      [
        "POST",
        `/management-api/sections/${id}/members`,
        { ref: { kind: "section", sectionId: "nope" } },
        "SectionId",
      ],
      [
        "POST",
        `/management-api/sections/${id}/members/${member}/replace`,
        { ref: { kind: "section", sectionId: "nope" } },
        "SectionId",
      ],
      [
        "POST",
        `/management-api/sections/${id}/members/products`,
        { productIds: [uuid, "nope"] },
        "ProductId",
      ],
    ];
    for (const [method, path, body, kind] of idCases) {
      const response = await send(app, method, path, { body });
      expect(response.status, `${method} ${path} ${JSON.stringify(body)}`).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "shared.invalid_id", params: { kind, value: "nope" } },
      });
    }
    for (const path of [
      "/management-api/sections/nope",
      "/management-api/sections/nope/members",
      `/management-api/sections/${id}/members/nope`,
    ]) {
      const method = path.endsWith("/nope") && path.includes("/members/") ? "DELETE" : "GET";
      expect((await send(app, method, path)).status, path).toBe(400);
    }
  });

  it("requires a management session and refuses staff on every section route", async () => {
    const app = mountApp();
    const id = (await createSectionVia(app, `Gate ${crypto.randomUUID()}`)).id;
    const member = crypto.randomUUID();
    const routes: [
      method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
      path: string,
      body?: unknown,
    ][] = [
      ["POST", `/management-api/sections/${id}/sections`, { internalName: "X" }],
      ["GET", `/management-api/sections/${id}`],
      ["PATCH", `/management-api/sections/${id}`, { internalName: "X" }],
      ["DELETE", `/management-api/sections/${id}`],
      ["GET", `/management-api/sections/${id}/members`],
      [
        "POST",
        `/management-api/sections/${id}/members`,
        { ref: product("11111111-1111-4111-8111-111111111111") },
      ],
      ["POST", `/management-api/sections/${id}/members/products`, { productIds: [] }],
      ["DELETE", `/management-api/sections/${id}/members/${member}`],
      ["PUT", `/management-api/sections/${id}/members/${member}/position`, { to: 0 }],
      ["POST", `/management-api/sections/${id}/members/${member}/replace`, { ref: section(id) }],
    ];
    for (const [method, path, body] of routes) {
      const options = body === undefined ? {} : { body };
      expect((await send(app, method, path, { ...options, cookie: null })).status, path).toBe(401);
      expect(
        (await send(app, method, path, { ...options, cookie: staffCookie })).status,
        path,
      ).toBe(403);
    }
    // Nothing was written by the refused requests.
    expect(
      (await json<Section>(await send(app, "GET", `/management-api/sections/${id}`), 200))
        .internalName,
    ).toMatch(/^Gate /);
  });
});

describe("mountCatalogueApi — home layouts", () => {
  interface Tile {
    memberId: string;
    position: number;
    ref: { kind: "product"; productId: string } | { kind: "section"; sectionId: string };
    name: string;
    reachable: boolean;
  }
  interface Layout {
    id: string;
    name: string;
    isDefault: boolean;
    tiles: Tile[];
  }
  const json = async <T>(response: Response, status: number): Promise<T> => {
    expect(response.status).toBe(status);
    return (await response.json()) as T;
  };
  const product = (productId: string) => ({ kind: "product" as const, productId });
  const section = (sectionId: string) => ({ kind: "section" as const, sectionId });
  const layoutsOf = (menuId: string) => `/management-api/catalogues/${menuId}/home-layouts`;
  const tilesOf = (layoutId: string) => `/management-api/home-layouts/${layoutId}/tiles`;

  async function menuWithTargets(app: Hono) {
    const menuId = await createCatalogueVia(app, `Layouts ${crypto.randomUUID()}`);
    const soupName = `Soup ${crypto.randomUUID()}`;
    const soup = await createNamedProductVia(app, soupName);
    const elsewhere = await createNamedProductVia(app, `Elsewhere ${crypto.randomUUID()}`);
    await offerVia(app, menuId, soup);
    const drinksName = `Drinks ${crypto.randomUUID()}`;
    const { rootSectionId } = await json<{ rootSectionId: string }>(
      await send(app, "GET", `/management-api/catalogues/${menuId}/structure`),
      200,
    );
    const drinks = await json<{ id: string }>(
      await send(app, "POST", `/management-api/sections/${rootSectionId}/sections`, {
        body: { internalName: drinksName },
      }),
      201,
    );
    return { menuId, soup, soupName, elsewhere, drinks: drinks.id, drinksName, rootSectionId };
  }

  it("replaces a deleted section tile in place and gates/refuses invalid replacements", async () => {
    const app = mountApp();
    const m = await menuWithTargets(app);
    const [home] = await json<Layout[]>(await send(app, "GET", layoutsOf(m.menuId)), 200);
    const tile = await json<{ id: string }>(
      await send(app, "POST", tilesOf(home!.id), { body: { ref: section(m.drinks) } }),
      201,
    );
    expect((await send(app, "DELETE", `/management-api/sections/${m.drinks}`)).status).toBe(204);
    const replace = `${tilesOf(home!.id)}/${tile.id}/replace`;
    const body = { ref: product(m.soup) };
    expect((await send(app, "POST", replace, { body, cookie: null })).status).toBe(401);
    expect((await send(app, "POST", replace, { body, cookie: staffCookie })).status).toBe(403);
    const refusal = await send(app, "POST", replace, { body: { ref: product(m.elsewhere) } });
    expect(refusal.status).toBe(409);
    expect(await refusal.json()).toMatchObject({ error: { code: "menu.shortcut_unreachable" } });
    const result = await json(await send(app, "POST", replace, { body }), 200);
    expect(result).toEqual({ id: tile.id, position: 0, ref: product(m.soup) });
    expect(
      (await json<Layout[]>(await send(app, "GET", layoutsOf(m.menuId)), 200))[0]!.tiles,
    ).toEqual([
      {
        memberId: tile.id,
        position: 0,
        ref: product(m.soup),
        name: m.soupName,
        reachable: true,
        missingName: null,
      },
    ]);
    const malformed = await send(app, "POST", replace, {
      body: { ref: { kind: "missing", name: "X" } },
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "management.request_invalid" } });
  });

  it("lists, creates, duplicates, renames, deletes and sets the default layout", async () => {
    const app = mountApp();
    const m = await menuWithTargets(app);
    const [home] = await json<Layout[]>(await send(app, "GET", layoutsOf(m.menuId)), 200);
    expect(home).toEqual({ id: home!.id, name: "Home", isDefault: true, tiles: [] });

    const counter = await json<{ id: string }>(
      await send(app, "POST", layoutsOf(m.menuId), { body: { name: "Counter" } }),
      201,
    );
    const soupTile = await json<{ id: string; position: number }>(
      await send(app, "POST", tilesOf(home!.id), { body: { ref: product(m.soup) } }),
      201,
    );
    expect(soupTile).toEqual({ id: soupTile.id, position: 0, ref: product(m.soup) });
    await json(
      await send(app, "POST", tilesOf(home!.id), { body: { ref: section(m.drinks), position: 0 } }),
      201,
    );
    const bar = await json<{ id: string }>(
      await send(app, "POST", `/management-api/home-layouts/${home!.id}/duplicate`, {
        body: { name: "Bar" },
      }),
      201,
    );
    expect(
      (
        await send(app, "PATCH", `/management-api/home-layouts/${counter.id}`, {
          body: { name: "Terrace" },
        })
      ).status,
    ).toBe(204);
    const listed = await json<Layout[]>(await send(app, "GET", layoutsOf(m.menuId)), 200);
    const tiles = [
      { position: 0, ref: section(m.drinks), name: m.drinksName, reachable: true },
      { position: 1, ref: product(m.soup), name: m.soupName, reachable: true },
    ];
    expect(listed).toMatchObject([
      { id: home!.id, name: "Home", isDefault: true, tiles },
      { id: bar.id, name: "Bar", isDefault: false, tiles },
      { id: counter.id, name: "Terrace", isDefault: false, tiles: [] },
    ]);

    const refused = await send(app, "DELETE", `/management-api/home-layouts/${home!.id}`);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      error: { code: "menu.default_layout_required", params: { layoutId: home!.id } },
    });
    expect(
      (
        await send(app, "PUT", `/management-api/catalogues/${m.menuId}/default-home-layout`, {
          body: { layoutId: counter.id },
        })
      ).status,
    ).toBe(204);
    expect((await send(app, "DELETE", `/management-api/home-layouts/${home!.id}`)).status).toBe(
      204,
    );
    const after = await json<Layout[]>(await send(app, "GET", layoutsOf(m.menuId)), 200);
    expect(after.map((layout) => [layout.name, layout.isDefault])).toEqual([
      ["Terrace", true],
      ["Bar", false],
    ]);
  });

  it("adds, moves and removes tiles, refusing one the menu does not reach or owns", async () => {
    const app = mountApp();
    const m = await menuWithTargets(app);
    const [home] = await json<Layout[]>(await send(app, "GET", layoutsOf(m.menuId)), 200);
    const soup = await json<{ id: string }>(
      await send(app, "POST", tilesOf(home!.id), { body: { ref: product(m.soup) } }),
      201,
    );
    const drinks = await json<{ id: string }>(
      await send(app, "POST", tilesOf(home!.id), { body: { ref: section(m.drinks) } }),
      201,
    );
    const moved = await json<{ id: string; position: number }[]>(
      await send(app, "PUT", `${tilesOf(home!.id)}/${soup.id}/position`, { body: { to: 1 } }),
      200,
    );
    expect(moved.map(({ id, position }) => [id, position])).toEqual([
      [drinks.id, 0],
      [soup.id, 1],
    ]);
    for (const [ref, status, code] of [
      [product(m.elsewhere), 409, "menu.shortcut_unreachable"],
      [section(m.rootSectionId), 409, "menu.shortcut_unreachable"],
      [product(m.soup), 409, "menu_section.member_duplicate"],
    ] as const) {
      const response = await send(app, "POST", tilesOf(home!.id), { body: { ref } });
      expect(response.status, code).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    // The generic member routes still refuse every write into a home layout.
    const generic = await send(app, "POST", `/management-api/sections/${home!.id}/members`, {
      body: { ref: product(m.soup) },
    });
    expect(generic.status).toBe(409);
    expect(await generic.json()).toMatchObject({ error: { code: "menu_section.wrong_role" } });
    expect((await send(app, "DELETE", `${tilesOf(home!.id)}/${soup.id}`)).status).toBe(204);
    const missing = await send(app, "DELETE", `${tilesOf(home!.id)}/${soup.id}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      error: { code: "menu_section.not_found", params: { sectionId: home!.id, memberId: soup.id } },
    });
    // Removing the tile left the product on the menu.
    const offers = await menuPricesVia(app, m.menuId);
    expect(offers.map((offer) => offer.productId)).toEqual([m.soup]);
    const [listed] = await json<Layout[]>(await send(app, "GET", layoutsOf(m.menuId)), 200);
    expect(listed!.tiles.map((tile) => tile.ref)).toEqual([section(m.drinks)]);
  });

  it("answers 404 for an id that names no layout or no menu", async () => {
    const app = mountApp();
    const m = await menuWithTargets(app);
    const unknown = crypto.randomUUID();
    const member = crypto.randomUUID();
    for (const [method, path, body] of [
      ["POST", `/management-api/home-layouts/${unknown}/duplicate`, { name: "X" }],
      ["PATCH", `/management-api/home-layouts/${unknown}`, { name: "X" }],
      ["DELETE", `/management-api/home-layouts/${unknown}`, undefined],
      ["POST", tilesOf(unknown), { ref: product(m.soup) }],
      ["DELETE", `${tilesOf(unknown)}/${member}`, undefined],
      ["PUT", `${tilesOf(unknown)}/${member}/position`, { to: 0 }],
      ["POST", tilesOf(m.rootSectionId), { ref: product(m.soup) }],
      ["PUT", `/management-api/catalogues/${m.menuId}/default-home-layout`, { layoutId: m.drinks }],
    ] as const) {
      const response = await send(app, method, path, body === undefined ? {} : { body });
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "menu.layout_not_found" } });
    }
    for (const [method, path, body] of [
      ["GET", layoutsOf(unknown), undefined],
      ["POST", layoutsOf(unknown), { name: "X" }],
      ["PUT", `/management-api/catalogues/${unknown}/default-home-layout`, { layoutId: m.drinks }],
    ] as const) {
      const response = await send(app, method, path, body === undefined ? {} : { body });
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: "catalogue.not_found", params: { catalogueId: unknown } },
      });
    }
  });

  it("screens every home-layout body's shape and ids", async () => {
    const app = mountApp();
    const m = await menuWithTargets(app);
    const [home] = await json<Layout[]>(await send(app, "GET", layoutsOf(m.menuId)), 200);
    const id = home!.id;
    const member = crypto.randomUUID();
    const cases: [method: "POST" | "PATCH" | "PUT", path: string, body: unknown, field: string][] =
      [
        ["POST", layoutsOf(m.menuId), {}, "name"],
        ["POST", layoutsOf(m.menuId), { name: 7 }, "name"],
        ["POST", `/management-api/home-layouts/${id}/duplicate`, {}, "name"],
        ["PATCH", `/management-api/home-layouts/${id}`, { name: null }, "name"],
        ["PUT", `/management-api/catalogues/${m.menuId}/default-home-layout`, {}, "layoutId"],
        ["POST", tilesOf(id), {}, "ref"],
        ["POST", tilesOf(id), { ref: { kind: "x" } }, "ref"],
        ["POST", tilesOf(id), { ref: product(m.soup), position: "0" }, "position"],
        ["PUT", `${tilesOf(id)}/${member}/position`, {}, "to"],
      ];
    for (const [method, path, body, field] of cases) {
      const response = await send(app, method, path, { body });
      expect(response.status, `${method} ${path} ${JSON.stringify(body)}`).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
    const blank = await send(app, "POST", layoutsOf(m.menuId), { body: { name: " " } });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toMatchObject({
      error: { code: "menu_section.invalid", params: { field: "name" } },
    });
    const idCases: [method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown][] = [
      ["GET", layoutsOf("nope")],
      ["POST", layoutsOf("nope"), { name: "X" }],
      ["POST", "/management-api/home-layouts/nope/duplicate", { name: "X" }],
      ["DELETE", "/management-api/home-layouts/nope"],
      ["POST", tilesOf("nope"), { ref: product(m.soup) }],
      ["DELETE", `${tilesOf(id)}/nope`],
      ["PUT", `${tilesOf(id)}/nope/position`, { to: 0 }],
      ["PUT", `/management-api/catalogues/${m.menuId}/default-home-layout`, { layoutId: "nope" }],
      ["POST", tilesOf(id), { ref: { kind: "product", productId: "nope" } }],
    ];
    for (const [method, path, body] of idCases) {
      const response = await send(app, method, path, body === undefined ? {} : { body });
      expect(response.status, `${method} ${path}`).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "shared.invalid_id", params: { value: "nope" } },
      });
    }
  });

  it("requires a management session and refuses staff on every home-layout route", async () => {
    const app = mountApp();
    const m = await menuWithTargets(app);
    const [home] = await json<Layout[]>(await send(app, "GET", layoutsOf(m.menuId)), 200);
    const id = home!.id;
    const member = crypto.randomUUID();
    const routes: [
      method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
      path: string,
      body?: unknown,
    ][] = [
      ["GET", layoutsOf(m.menuId)],
      ["POST", layoutsOf(m.menuId), { name: "X" }],
      ["PUT", `/management-api/catalogues/${m.menuId}/default-home-layout`, { layoutId: id }],
      ["POST", `/management-api/home-layouts/${id}/duplicate`, { name: "X" }],
      ["PATCH", `/management-api/home-layouts/${id}`, { name: "X" }],
      ["DELETE", `/management-api/home-layouts/${id}`],
      ["POST", tilesOf(id), { ref: product(m.soup) }],
      ["DELETE", `${tilesOf(id)}/${member}`],
      ["PUT", `${tilesOf(id)}/${member}/position`, { to: 0 }],
    ];
    for (const [method, path, body] of routes) {
      const options = body === undefined ? {} : { body };
      expect((await send(app, method, path, { ...options, cookie: null })).status, path).toBe(401);
      const staff = await send(app, method, path, { ...options, cookie: staffCookie });
      expect(staff.status, path).toBe(403);
      expect(await staff.json(), `${method} ${path}`).toMatchObject({
        error: { code: "authorization.not_permitted", params: { permission: "person.manage" } },
      });
    }
    expect(await json<Layout[]>(await send(app, "GET", layoutsOf(m.menuId)), 200)).toEqual([
      { id, name: "Home", isDefault: true, tiles: [] },
    ]);
  });
});

it("refuses the retired menu-item active field and preserves an unset switch on price edits", async () => {
  const app = mountApp();
  const menuId = await createCatalogueVia(app, "Nullable switches");
  const productId = await createNamedProductVia(app, `Offer ${crypto.randomUUID()}`);
  const itemId = await offerVia(app, menuId, productId);
  const path = `/management-api/catalogues/${menuId}/items/${itemId}`;
  for (const active of [false, true, null]) {
    const refused = await send(app, "PATCH", path, { body: { active } });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "active" } },
    });
  }
  expect((await send(app, "PATCH", path, { body: { grossPrice: "2.00" } })).status).toBe(204);
  expect((await menuPricesVia(app, menuId))[0]!.offered).toBeNull();
  expect((await send(app, "PATCH", path, { body: { offered: false } })).status).toBe(204);
  expect((await send(app, "PATCH", path, { body: { offered: null } })).status).toBe(204);
  expect((await menuPricesVia(app, menuId))[0]!.offered).toBeNull();
});

it("variant price-only requests preserve the own switch and explicit null clears it", async () => {
  const app = mountApp();
  const menuId = await createCatalogueVia(app, "Variant switches");
  const productId = await createNamedProductVia(app, `Wine ${crypto.randomUUID()}`);
  const editorPath = `/management-api/products/${productId}/editor`;
  const editor = (await (await send(app, "GET", editorPath)).json()) as Record<string, unknown>;
  const saved = await send(app, "PUT", editorPath, {
    body: {
      ...editor,
      variants: [
        {
          name: "Glass",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: null,
          available: true,
          active: true,
        },
      ],
    },
  });
  expect(saved.status).toBe(200);
  const variantId = ((await saved.json()) as { variants: { id: string }[] }).variants[0]!.id;
  const itemId = await offerVia(app, menuId, productId);
  const path = `/management-api/catalogues/${menuId}/items/${itemId}/variants`;
  for (const offered of [null, false, true]) {
    expect(
      (
        await send(app, "PUT", path, {
          body: { variants: [{ variantId, price: "2.00", offered }] },
        })
      ).status,
    ).toBe(200);
    const priceOnly = await send(app, "PUT", path, {
      body: { variants: [{ variantId, price: "3.00" }] },
    });
    expect(priceOnly.status).toBe(200);
    expect(await priceOnly.json()).toEqual([{ variantId, price: "3.00", offered }]);
  }
  const cleared = await send(app, "PUT", path, {
    body: { variants: [{ variantId, price: null, offered: null }] },
  });
  expect(cleared.status).toBe(200);
  expect(await cleared.json()).toEqual([{ variantId, price: null, offered: null }]);
});

describe("owned section routes", () => {
  it("creates an owned section in a list and carries menu presentation", async () => {
    const app = mountApp("en");
    const created = await send(app, "POST", "/management-api/catalogues", {
      body: { name: "Internal menu", names: { en: "Guests menu" }, color: "#123456" },
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const root = await menuRootVia(app, id);
    const child = await send(app, "POST", `/management-api/sections/${root}/sections`, {
      body: { internalName: "Internal child", names: { en: "Guest child" }, position: 0 },
    });
    expect(child.status).toBe(201);
    const { id: sectionId } = (await child.json()) as { id: string };
    const details = await send(app, "GET", `/management-api/sections/${sectionId}`);
    expect(await details.json()).toMatchObject({
      internalName: "Internal child",
      names: { en: "Guest child" },
    });
    expect(await (await send(app, "GET", `/management-api/sections/${root}`)).json()).toMatchObject(
      { names: { en: "Guests menu" }, color: "#123456" },
    );
    expect(
      (
        await send(app, "PATCH", `/management-api/catalogues/${id}`, {
          body: { names: { en: "Updated guest menu" } },
        })
      ).status,
    ).toBe(204);
    expect(await (await send(app, "GET", `/management-api/sections/${root}`)).json()).toMatchObject(
      { names: { en: "Updated guest menu" } },
    );
  });
});
