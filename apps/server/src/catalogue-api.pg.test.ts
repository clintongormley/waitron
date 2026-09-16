import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTransaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin, startManagementSession } from "@waitron/identity";
import { assignCatalogueToLocation, listAvailableProducts } from "@waitron/catalogue";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { ALL_MODULES } from "./modules.js";

// Real Postgres, not PGlite: the route mechanics (body/id screens) are already proven
// in-process on PGlite (`catalogue-api.test.ts`); what needs the real cluster is the write group run
// as the non-superuser `app_user` — its table grants are enforced here and held unconditionally by
// PGlite's superuser (CLAUDE.md §4) — and the by-id FK on the option-group
// attach. The `person.manage` gate is proven by deletion on the block below.
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same per-suite counter `management-api.pg.test.ts`
// uses.
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

/** One Hono app per venue — `mountCatalogueApi` binds ONE node via `cfg.nodeId`, so each venue's
 * routes need their own app (mirrors `management-api.pg.test.ts`). */
function mountApp(): Hono {
  const app = new Hono();
  mountCatalogueApi(
    app,
    {
      db: suite.admin,
      // These suites assert the gate and the option-group FKs, never the captured origin; any valid node id
      // satisfies the (now required) cfg.nodeId. Origin attribution is proven in sync-origin.test.ts.
      cfg: { nodeId: "11111111-1111-4111-8111-111111111111" },
    },
    noopLog,
  );
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

  it("authors a group + items, attaches it to a product, and the till read reflects it (design §3)", async () => {
    // Pinned test 1 (till-read half): the modifier-authoring routes create a group with two items and
    // attach it to a product, then the OPERATOR till read (`listAvailableProducts`, location-scoped)
    // surfaces the same group + active items — the authoring surface and the sale surface agree. Runs
    // on real Postgres because `listAvailableProducts` reads the location's accessible catalogue, which
    // provisioning set up here; the assign is via `assignCatalogueToLocation` under withTransaction+asAppUser.
    const v = await setupVenue();
    const app = mountApp();

    const catId = await createCatalogue(app, v.managerCookie, "Menú de la casa");
    const groupRes = await send(app, "POST", "/management-api/option-groups", v.managerCookie, {
      name: { [LOCALE]: "Punto" },
      minSelect: 1,
      maxSelect: 1,
      required: true,
    });
    expect(groupRes.status).toBe(201);
    const groupId = ((await groupRes.json()) as { id: string }).id;
    const itemIds: string[] = [];
    // Explicit ascending `sort` so the till read's item order is deterministic (equal sort tiebreaks
    // on the random uuid).
    for (const [sort, name] of [
      [0, "Poco hecho"],
      [1, "Al punto"],
    ] as const) {
      const r = await send(
        app,
        "POST",
        `/management-api/option-groups/${groupId}/items`,
        v.managerCookie,
        { name: { [LOCALE]: name }, sort },
      );
      expect(r.status).toBe(201);
      itemIds.push(((await r.json()) as { id: string }).id);
    }

    const prodRes = await send(app, "POST", "/management-api/products", v.managerCookie, {
      catalogueId: catId,
      categoryId: null,
      name: "Entrecot",
      pricingUnit: "each",
      unitPrice: "18.00",
      vatClass: "general",
      optionGroupIds: [groupId],
    });
    expect(prodRes.status).toBe(201);
    const productId = ((await prodRes.json()) as { id: string }).id;

    // Read the attach back through the authoring route.
    const attached = await send(
      app,
      "GET",
      `/management-api/products/${productId}/option-groups`,
      v.managerCookie,
    );
    expect(attached.status).toBe(200);
    expect((await attached.json()) as string[]).toEqual([groupId]);

    // Make the catalogue sellable at the location, then the OPERATOR till read reflects the group.
    const tillView = await withTransaction(suite.admin, async (tx) => {
      await asAppUser(tx);
      await assignCatalogueToLocation(tx, v.locationId, catId);
      return listAvailableProducts(tx, v.locationId);
    });
    const sold = tillView.products.find((p) => p.id === productId)!;
    expect(sold.optionGroups).toHaveLength(1);
    expect(sold.optionGroups[0]).toMatchObject({
      id: groupId,
      name: { [LOCALE]: "Punto" },
      minSelect: 1,
      maxSelect: 1,
      required: true,
    });
    expect(sold.optionGroups[0]!.items.map((i) => i.id)).toEqual(itemIds);
  });

  it("refuses every option-group write route to a staff-role session — 403 authorization.not_permitted", async () => {
    // Pinned test 3: the `person.manage` gate covers the new authoring routes, proved the same way the
    // catalogue-write test above proves it — by DELETION. A `staff` session holds no `person.manage`,
    // so `authorizeManager` inside `gated` throws before any option-group op runs. Dropping that
    // `authorizeManager` from `catalogue-api.ts`'s `gated` helper flips each `toBe(403)` green→red (the
    // same guard-by-deletion receipt the catalogue-write block records).
    const { staffCookie } = await setupVenue();
    const app = mountApp();
    const dummy = "00000000-0000-0000-0000-000000000000";

    const expect403 = async (res: Response) => {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    };

    await expect403(
      await send(app, "POST", "/management-api/option-groups", staffCookie, {
        name: { [LOCALE]: "Refused" },
      }),
    );
    await expect403(
      await send(app, "PATCH", `/management-api/option-groups/${dummy}`, staffCookie, { sort: 1 }),
    );
    await expect403(
      await send(app, "POST", `/management-api/option-groups/${dummy}/items`, staffCookie, {
        name: { [LOCALE]: "Refused" },
      }),
    );
    await expect403(
      await send(
        app,
        "PATCH",
        `/management-api/option-groups/${dummy}/items/${dummy}`,
        staffCookie,
        { sort: 1 },
      ),
    );
  });
});

describe("canonical modifier routes", () => {
  it("saves and reads each type canonically, and keeps a failed multi-choice save atomic", async () => {
    const venue = await setupVenue();
    const app = mountApp();
    const name = { es: "Personalización" };
    const choiceId = crypto.randomUUID();
    const bodies = [
      { type: "text", name },
      {
        type: "extras",
        name,
        choices: [{ id: choiceId, name, priceDelta: "1.20", maxQuantity: 2, preselected: true }],
      },
      { type: "options", name, choices: [{ id: crypto.randomUUID(), name }] },
    ];
    const saved: unknown[] = [];
    for (const body of bodies) {
      const response = await send(
        app,
        "POST",
        "/management-api/modifiers",
        venue.managerCookie,
        body,
      );
      expect(response.status).toBe(201);
      const { modifier } = (await response.json()) as {
        modifier: { id: string; type: string };
      };
      expect(modifier).toMatchObject({ ...body, available: true });
      const read = await send(
        app,
        "GET",
        `/management-api/modifiers/${modifier.id}`,
        venue.managerCookie,
      );
      expect(await read.json()).toEqual({ modifier });
      saved.push(modifier);
    }
    const failed = await send(app, "POST", "/management-api/modifiers", venue.managerCookie, {
      type: "extras",
      name,
      choices: [
        { id: crypto.randomUUID(), name },
        { id: choiceId, name },
      ],
    });
    expect(failed.status).toBe(400);
    const list = await send(app, "GET", "/management-api/modifiers", venue.managerCookie);
    expect(((await list.json()) as { modifiers: unknown[] }).modifiers).toEqual(
      expect.arrayContaining(saved),
    );
    expect(
      (
        (await send(app, "GET", "/management-api/modifiers", venue.managerCookie).then((r) =>
          r.json(),
        )) as { modifiers: unknown[] }
      ).modifiers,
    ).toHaveLength(3);
  });
  it("refuses a staff-role session", async () => {
    const venue = await setupVenue();
    const app = mountApp();
    expect((await send(app, "GET", "/management-api/modifiers", venue.staffCookie)).status).toBe(
      403,
    );
    expect(
      (
        await send(app, "POST", "/management-api/modifiers", venue.staffCookie, {
          type: "text",
          name: { es: "Nota" },
        })
      ).status,
    ).toBe(403);
  });
});

it("accepts ordered modifierIds in the product contract and reads them back", async () => {
  const venue = await setupVenue();
  const app = mountApp();
  const cookie = venue.managerCookie;
  const modifierIds: string[] = [];
  for (const label of ["First", "Second"]) {
    const response = await send(app, "POST", "/management-api/modifiers", cookie, {
      type: "text",
      name: { es: label },
    });
    modifierIds.push(((await response.json()) as { modifier: { id: string } }).modifier.id);
  }
  const menuResponse = await send(app, "POST", "/management-api/catalogues", cookie, {
    name: "Menu",
  });
  const menu = (await menuResponse.json()) as { id: string };
  const create = await send(app, "POST", "/management-api/products", cookie, {
    catalogueId: menu.id,
    categoryId: null,
    name: "Dish",
    pricingUnit: "each",
    unitPrice: "5.00",
    vatClass: "reduced",
    modifierIds,
  });
  expect(create.status).toBe(201);
  const product = (await create.json()) as { id: string; modifierIds: string[] };
  expect(product.modifierIds).toEqual(modifierIds);
  const ordered = [...modifierIds].reverse();
  expect(
    (
      await send(app, "PATCH", `/management-api/products/${product.id}`, cookie, {
        modifierIds: ordered,
      })
    ).status,
  ).toBe(204);
  const list = await send(app, "GET", `/management-api/catalogues/${menu.id}/products`, cookie);
  expect(await list.json()).toMatchObject([{ id: product.id, modifierIds: ordered }]);
});
