import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTransaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin, startManagementSession } from "@waitron/identity";
import { createOptionList } from "@waitron/catalogue";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { ALL_MODULES } from "./modules.js";

// Real Postgres, not PGlite: the route mechanics (body/id screens) are already proven
// in-process on PGlite (`catalogue-api.test.ts`); what needs the real cluster is the write group run
// as the non-superuser `app_user` — its table grants are enforced here and held unconditionally by
// PGlite's superuser (CLAUDE.md §4). The `person.manage` gate is proven by deletion on the block
// below.
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

// A distinct NIF per provisioned venue — the same per-suite counter `management-api.pg.test.ts`
// uses. Nothing here depends on them differing: `useTemplateDb` resets the clone between tests and
// `tenants_singleton_ck` allows one row inside one, so every test provisions into an empty
// `tenants`.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(70_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  /**
   * This venue's single location id — the `:locationId` the location-menu routes act on, and the
   * location-scoped read the till uses (`listAvailableProducts`).
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
        taxId: nextNif(),
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
    { db: suite.admin, modules: ALL_MODULES },
  );

  const { managerSid, staffSid } = await withTransaction(suite.admin, async (tx) => {
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

  return {
    locationId: venue.locationId,
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
  };
}

/** A Hono app carrying the catalogue routes over the suite's owner connection. */
function mountApp(): Hono {
  const app = new Hono();
  mountCatalogueApi(app, { db: suite.admin }, noopLog);
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

describe("category dependants and bulk add over real Postgres", () => {
  it("reads a category's preparation routes and cascades them away on delete", async () => {
    // This template migrates the FULL manifest, so venue-service's `preparation_routes` IS present
    // and `categoryDependants` takes its optional-table branch — the arm PGlite cannot reach, since
    // `catalogue-api.test.ts` migrates core + catalogue + identity only (that suite covers the
    // absent-table arm, asserting `routes: []`). What real Postgres adds here is the ROLE: `gated`
    // switches to the non-superuser `app_user` before the read, so this exercises its SELECT grants
    // on `preparation_routes`, `kitchen_stations` and `floor_zones` — grants PGlite's superuser
    // holds unconditionally — and its DELETE grant on the module's table when the category goes.
    const v = await setupVenue();
    const app = mountApp();
    const categoryId = await createCategory(app, v.managerCookie, { [LOCALE]: "Frituras" });
    // Seeded as the OWNER, the way `setupVenue` seeds persons: these are fixture rows, not the
    // behaviour under test. The route reads them back as `app_user`.
    const zone = await suite.admin.execute<{ id: string }>(sql`
      insert into floor_zones (location_id, name)
      values (${v.locationId}, 'Terraza') returning id`);
    const station = await suite.admin.execute<{ id: string }>(sql`
      insert into kitchen_stations (location_id, name)
      values (${v.locationId}, 'Plancha') returning id`);
    const routed = await suite.admin.execute<{ id: string }>(sql`
      insert into preparation_routes (location_id, zone_id, category_id, station_id)
      values (${v.locationId}, ${zone.rows[0]!.id}, ${categoryId}, ${station.rows[0]!.id})
      returning id`);
    // `no_preparation` routes report a null station — the read's `case` arm.
    const direct = await suite.admin.execute<{ id: string }>(sql`
      insert into preparation_routes (location_id, category_id, no_preparation)
      values (${v.locationId}, ${categoryId}, true) returning id`);

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
        { id: routed.rows[0]!.id, station: "Plancha", zone: "Terraza" },
        { id: direct.rows[0]!.id, station: null, zone: null },
      ]),
    );
    expect(body).toMatchObject({ products: [], children: [], parentId: null });

    expect(
      (await send(app, "DELETE", `/management-api/categories/${categoryId}`, v.managerCookie))
        .status,
    ).toBe(204);
    const left = await suite.admin.execute(
      sql`select 1 from preparation_routes where category_id = ${categoryId}`,
    );
    expect(left.rows).toHaveLength(0);
  });

  it("bulk-adds products to a category as the deployment role", async () => {
    // The bulk add's INSERT on `product_categories` and UPDATE on `products` run as `app_user`,
    // whose grants only a real cluster enforces.
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
    const members = await suite.admin.execute<{ product_id: string }>(
      sql`select product_id from product_categories
          where category_id = ${categoryId} order by product_id`,
    );
    expect(members.rows.map((r) => r.product_id)).toEqual([first, second].sort());
    // Neither product had a reporting category, so each took this one.
    const reporting = await suite.admin.execute<{ category_id: string | null }>(
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

describe("Catalogue API over real Postgres (option groups, gates, by-id FKs)", () => {
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
    // Pinned test 3: the `person.manage` gate covers the modifier-list authoring routes, proved the
    // same way the catalogue-write test above proves it — by DELETION. A `staff` session holds no
    // `person.manage`, so `authorizeManager` inside `gated` throws before any list op runs. MEASURED
    // on these routes, not inherited from the block they replaced: with the `authorizeManager` call
    // in `catalogue-api.ts`'s `gated` helper replaced by `void sessionId`, this case goes red with
    // `expected 400 to be 403` — the ungated request reaching the body parser instead.
    //
    // Both segments, both kinds of write: `mountListSurface` registers one set of handlers per kind
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
  // The product write goes through the ROUTE, which opens its own `app_user` transaction, so
  // `product_modifiers`' grants are what carry it.
  const venue = await setupVenue();
  const app = mountApp();
  const cookie = venue.managerCookie;
  const menuResponse = await send(app, "POST", "/management-api/catalogues", cookie, {
    name: "Menu",
  });
  const menu = (await menuResponse.json()) as { id: string };
  const listIds = await withTransaction(suite.admin, async (tx) => {
    await asAppUser(tx);
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
