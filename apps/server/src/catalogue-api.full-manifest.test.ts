import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { floorZones, kitchenStations, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons, startManagementSession } from "@waitron/identity";
import { createOptionList } from "@waitron/catalogue";
import { preparationRoutes } from "@waitron/venue-service";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { ALL_MODULES } from "./modules.js";
import "./errors.js";

/**
 * The catalogue routes over the FULL migration manifest, so venue-service's `preparation_routes`
 * exists and `categoryDependants` takes its optional-table branch. `catalogue-api.test.ts` migrates
 * core + catalogue + identity only and covers the absent-table arm.
 */
const LOCALE = "es-ES";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

interface Venue {
  /**
   * This venue's single location id — the `:locationId` the location-menu routes act on, and the
   * location-scoped read behind `GET /api/products` (`listAvailableProducts`).
   */
  locationId: string;
  /** A live MANAGEMENT session cookie for a `manager` (holds `person.manage`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (holds nothing — the gate refuses it). */
  staffCookie: string;
}

/** Provision a venue as owner and seed the people and sessions this route fixture needs. */
async function setupVenue(): Promise<Venue> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "70000001K",
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );

  const { managerSid, staffSid } = await withTransaction(suite.db, async (tx) => {
    // Through the table definition, not raw SQL: `persons.id` and `persons.created_at` are
    // `$defaultFn` generators, which a raw insert never reaches.
    const [mgr] = await tx
      .insert(persons)
      .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
      .returning({ id: persons.id });
    const [stf] = await tx
      .insert(persons)
      .values({ displayName: "The Clerk", pinHash: hashPin("1234"), role: "staff" })
      .returning({ id: persons.id });
    const managerSession = await startManagementSession(tx, { personId: mgr!.id });
    const staffSession = await startManagementSession(tx, { personId: stf!.id });
    return { managerSid: managerSession.token, staffSid: staffSession.token };
  });

  return {
    locationId: venue.locationId,
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
  };
}

/** A Hono app carrying the catalogue routes over the suite's connection. */
function mountApp(): Hono {
  const app = new Hono();
  mountCatalogueApi(app, { db: suite.db }, noopLog);
  return app;
}

/** JSON helper carrying `cookie`. */
async function send(
  app: Hono,
  method: "POST" | "PATCH" | "GET" | "DELETE" | "PUT",
  path: string,
  cookie: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { cookie };
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createCatalogue(app: Hono, cookie: string, name: string): Promise<string> {
  const res = await send(app, "POST", "/management-api/catalogues", cookie, { name });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function createCategory(
  app: Hono,
  cookie: string,
  name: Record<string, string>,
): Promise<string> {
  const res = await send(app, "POST", "/management-api/categories", cookie, { name });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function createProduct(
  app: Hono,
  cookie: string,
  catalogueId: string,
  name: string,
): Promise<string> {
  const res = await send(app, "POST", "/management-api/products", cookie, {
    catalogueId,
    categoryId: null,
    name,
    pricingUnit: "each",
    unitPrice: "1.00",
    vatClass: "general",
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("category dependants and bulk add", () => {
  it("reads a category's preparation routes and cascades them away on delete", async () => {
    const v = await setupVenue();
    const app = mountApp();
    const categoryId = await createCategory(app, v.managerCookie, { [LOCALE]: "Frituras" });
    // Fixture rows, seeded through the table definitions for the `$defaultFn` reason `setupVenue`
    // states.
    const [zone] = await suite.db
      .insert(floorZones)
      .values({ locationId: v.locationId, name: "Terraza" })
      .returning({ id: floorZones.id });
    const [station] = await suite.db
      .insert(kitchenStations)
      .values({ locationId: v.locationId, name: "Plancha" })
      .returning({ id: kitchenStations.id });
    const [routed] = await suite.db
      .insert(preparationRoutes)
      .values({
        locationId: v.locationId,
        zoneId: zone!.id,
        categoryId,
        stationId: station!.id,
      })
      .returning({ id: preparationRoutes.id });
    // `no_preparation` routes report a null station — the read's `case` arm.
    const [direct] = await suite.db
      .insert(preparationRoutes)
      .values({ locationId: v.locationId, categoryId, noPreparation: true })
      .returning({ id: preparationRoutes.id });

    const res = await send(
      app,
      "GET",
      `/management-api/categories/${categoryId}/dependants`,
      v.managerCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      routes: { id: string; station: string | null; zone: string | null }[];
      products: unknown[];
      children: unknown[];
      parentId: string | null;
    };
    const byId = <T extends { id: string }>(rows: T[]): T[] =>
      [...rows].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(body.routes)).toEqual(
      byId([
        { id: routed!.id, station: "Plancha", zone: "Terraza" },
        { id: direct!.id, station: null, zone: null },
      ]),
    );
    expect(body).toMatchObject({ products: [], children: [], parentId: null });

    expect(
      (await send(app, "DELETE", `/management-api/categories/${categoryId}`, v.managerCookie))
        .status,
    ).toBe(204);
    const left = await suite.db.execute(
      sql`select 1 from preparation_routes where category_id = ${categoryId}`,
    );
    expect(left.rows).toHaveLength(0);
  });

  it("bulk-adds products to a category", async () => {
    const v = await setupVenue();
    const app = mountApp();
    const catalogueId = await createCatalogue(app, v.managerCookie, "Carta");
    const categoryId = await createCategory(app, v.managerCookie, { [LOCALE]: "Tapas" });
    const first = await createProduct(app, v.managerCookie, catalogueId, "Croquetas");
    const second = await createProduct(app, v.managerCookie, catalogueId, "Boquerones");
    const path = `/management-api/categories/${categoryId}/products`;

    expect(
      (await send(app, "POST", path, v.managerCookie, { productIds: [first, second] })).status,
    ).toBe(204);
    // Each product's main category is now this one.
    const reporting = await suite.db.execute<{ category_id: string | null }>(
      sql`select category_id from products
          where id in (${first}, ${second})`,
    );
    expect(reporting.rows.map((r) => r.category_id)).toEqual([categoryId, categoryId]);
    // A staff session holds no `person.manage`, so the gate refuses the write.
    expect((await send(app, "POST", path, v.staffCookie, { productIds: [first] })).status).toBe(
      403,
    );
  });
});

describe("Catalogue API — option groups, gates, by-id FKs", () => {
  it("refuses every catalogue write route to a staff-role session — 403 authorization.not_permitted", async () => {
    // Every write shares the permission gate; invalid resource ids must not reveal lookup results
    // to a staff session that cannot manage the catalogue.
    const { staffCookie } = await setupVenue();
    const app = mountApp();

    const expect403 = async (res: Response) => {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    };

    await expect403(
      await send(app, "POST", "/management-api/catalogues", staffCookie, { name: "Refused" }),
    );
    await expect403(
      await send(app, "POST", "/management-api/products", staffCookie, {
        catalogueId: "00000000-0000-0000-0000-000000000000",
        categoryId: null,
        name: "Refused",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      }),
    );
    await expect403(
      await send(
        app,
        "PATCH",
        "/management-api/products/00000000-0000-0000-0000-000000000000",
        staffCookie,
        { unitPrice: "9.99" },
      ),
    );
    const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
    await expect403(
      await send(app, "POST", `/management-api/locations/${ZERO_UUID}/catalogues`, staffCookie, {
        catalogueId: ZERO_UUID,
      }),
    );
    await expect403(
      await send(
        app,
        "DELETE",
        `/management-api/locations/${ZERO_UUID}/catalogues/${ZERO_UUID}`,
        staffCookie,
      ),
    );
    await expect403(
      await send(
        app,
        "PUT",
        `/management-api/locations/${ZERO_UUID}/default-catalogue`,
        staffCookie,
        { catalogueId: ZERO_UUID },
      ),
    );
  });

  it("refuses every modifier-list write route to a staff-role session — 403 authorization.not_permitted", async () => {
    // A `staff` session holds no `person.manage`, so `authorizeManager` inside `gated` throws before
    // any list op runs. Both segments, both kinds of write: `mountListSurface` registers one set of
    // handlers per kind
    // and each closes over its own `surface`, so one kind passing says nothing about the other.
    const { staffCookie } = await setupVenue();
    const app = mountApp();
    const dummy = "00000000-0000-0000-0000-000000000000";

    const expect403 = async (res: Response) => {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    };

    for (const segment of ["options", "extras"]) {
      const collection = `/management-api/modifiers/${segment}`;
      await expect403(
        await send(app, "POST", collection, staffCookie, { name: "Refused", labels: [] }),
      );
      await expect403(
        await send(app, "PATCH", `${collection}/${dummy}`, staffCookie, {
          name: "Refused",
          labels: [],
        }),
      );
      await expect403(await send(app, "DELETE", `${collection}/${dummy}`, staffCookie));
      await expect403(await send(app, "GET", collection, staffCookie));
      await expect403(await send(app, "GET", `${collection}/${dummy}/dependants`, staffCookie));
    }
  });
});

it("accepts an ordered modifiers list in the product contract and reads it back", async () => {
  const venue = await setupVenue();
  const app = mountApp();
  const cookie = venue.managerCookie;
  const menuResponse = await send(app, "POST", "/management-api/catalogues", cookie, {
    name: "Menu",
  });
  const menu = (await menuResponse.json()) as { id: string };
  const listIds = await withTransaction(suite.db, async (tx) => {
    const ids: string[] = [];
    for (const label of ["First", "Second"]) {
      const list = await createOptionList(
        tx,
        { name: label, labels: [{ name: `${label} label` }] },
        LOCALE,
      );
      ids.push(list.id);
    }
    return ids;
  });
  const modifiers = listIds.map((id) => ({ kind: "options", id }));
  const create = await send(app, "POST", "/management-api/products", cookie, {
    catalogueId: menu.id,
    categoryId: null,
    name: "Dish",
    pricingUnit: "each",
    unitPrice: "5.00",
    vatClass: "reduced",
    modifiers,
  });
  expect(create.status).toBe(201);
  const product = (await create.json()) as { id: string; modifiers: unknown };
  expect(product.modifiers).toEqual(modifiers);
  const ordered = [...modifiers].reverse();
  expect(
    (
      await send(app, "PATCH", `/management-api/products/${product.id}`, cookie, {
        modifiers: ordered,
      })
    ).status,
  ).toBe(204);
  const list = await send(app, "GET", `/management-api/catalogues/${menu.id}/products`, cookie);
  expect(await list.json()).toMatchObject([{ id: product.id, modifiers: ordered }]);
});

describe("sections and the reporting and routing they do not touch", () => {
  it("adds, moves and removes a routed product and deletes its section, and the product keeps its category and routes", async () => {
    const v = await setupVenue();
    const app = mountApp();
    const catalogueId = await createCatalogue(app, v.managerCookie, "Carta");
    const categoryId = await createCategory(app, v.managerCookie, { [LOCALE]: "Bebidas" });
    const productId = await createProduct(app, v.managerCookie, catalogueId, "Agua");
    expect(
      (
        await send(
          app,
          "POST",
          `/management-api/categories/${categoryId}/products`,
          v.managerCookie,
          {
            productIds: [productId],
          },
        )
      ).status,
    ).toBe(204);
    await suite.db.insert(preparationRoutes).values([
      { locationId: v.locationId, categoryId, noPreparation: true },
      { locationId: v.locationId, productId, noPreparation: true },
    ]);
    const routes = async () =>
      (
        await suite.db.execute<{
          id: string;
          category_id: string | null;
          product_id: string | null;
        }>(sql`select id, category_id, product_id from preparation_routes order by id`)
      ).rows;
    const categoryOf = async () =>
      (
        await suite.db.execute<{ category_id: string | null }>(
          sql`select category_id from products where id = ${productId}`,
        )
      ).rows[0]!.category_id;
    const before = await routes();
    expect(before).toHaveLength(2);

    const created = await send(app, "POST", "/management-api/sections", v.managerCookie, {
      internalName: "Bebidas (sección)",
    });
    expect(created.status).toBe(201);
    const sectionId = ((await created.json()) as { id: string }).id;
    const members = `/management-api/sections/${sectionId}/members`;
    const add = async () => {
      const response = await send(app, "POST", members, v.managerCookie, {
        ref: { kind: "product", productId },
      });
      expect(response.status).toBe(201);
      return ((await response.json()) as { id: string }).id;
    };
    const memberId = await add();
    expect(
      (await send(app, "PUT", `${members}/${memberId}/position`, v.managerCookie, { to: 0 }))
        .status,
    ).toBe(200);
    expect((await send(app, "DELETE", `${members}/${memberId}`, v.managerCookie)).status).toBe(204);
    expect(await categoryOf()).toBe(categoryId);
    expect(await routes()).toEqual(before);
    await add();
    expect(
      (await send(app, "DELETE", `/management-api/sections/${sectionId}`, v.managerCookie)).status,
    ).toBe(204);

    expect(await categoryOf()).toBe(categoryId);
    expect(await routes()).toEqual(before);
  });
});
