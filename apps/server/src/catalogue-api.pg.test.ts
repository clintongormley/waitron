import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
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
// PGlite's superuser (CLAUDE.md §4) — and the tenant-consistent composite FK on the option-group
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
  tenantId: string;
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

  const { managerSid, staffSid } = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${venue.tenantId}, 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${venue.tenantId}, 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
    const managerSession = await startManagementSession(tx, {
      tenantId: venue.tenantId,
      personId: mgr.rows[0]!.id,
    });
    const staffSession = await startManagementSession(tx, {
      tenantId: venue.tenantId,
      personId: stf.rows[0]!.id,
    });
    return { managerSid: managerSession.id, staffSid: staffSession.id };
  });

  return {
    tenantId: venue.tenantId,
    locationId: venue.locationId,
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
  };
}

/** One Hono app per tenant — `mountCatalogueApi` binds ONE tenant via `cfg.tenantId`, so each venue's
 * routes need their own app (mirrors `management-api.pg.test.ts`). */
function mountApp(tenantId: string): Hono {
  const app = new Hono();
  mountCatalogueApi(
    app,
    {
      db: suite.admin,
      // These suites assert the gate and the option-group FKs, never the captured origin; any valid node id
      // satisfies the (now required) cfg.nodeId. Origin attribution is proven in sync-origin.test.ts.
      cfg: { tenantId, nodeId: "11111111-1111-4111-8111-111111111111" },
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

describe("Catalogue API over real Postgres (option groups, gates, tenant-consistent FKs)", () => {
  it("refuses every catalogue write route to a staff-role session — 403 authorization.not_permitted", async () => {
    // Every write shares the permission gate; invalid resource ids must not reveal lookup results
    // to a staff session that cannot manage the catalogue.
    const { tenantId, staffCookie } = await setupVenue();
    const app = mountApp(tenantId);

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
        descriptions: { [LOCALE]: "Refused" },
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
    // provisioning set up here; the assign is via `assignCatalogueToLocation` under withTenant+asAppUser.
    const v = await setupVenue();
    const app = mountApp(v.tenantId);

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
      descriptions: { [LOCALE]: "Entrecot" },
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
    const tillView = await withTenant(suite.admin, v.tenantId, async (tx) => {
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

  it("refuses attaching another tenant's option-group id — the tenant-consistent FK rejects it and nothing lands", async () => {
    // The composite `(tenant_id, group_id)` FK on `product_option_groups`, exercised on its
    // exists-but-foreign arm: the group id names a REAL row, just one owned by another tenant — the
    // only arm a single-column FK to `option_groups(id)` would accept. The attach must be refused
    // (a 4xx/5xx, never a silent success) and nothing may land.
    const a = await setupVenue();
    const b = await setupVenue();
    const appA = mountApp(a.tenantId);
    const appB = mountApp(b.tenantId);

    const bGroupRes = await send(appB, "POST", "/management-api/option-groups", b.managerCookie, {
      name: { [LOCALE]: "Grupo de B" },
    });
    expect(bGroupRes.status).toBe(201);
    const bGroupId = ((await bGroupRes.json()) as { id: string }).id;

    // A authors its own catalogue + product, then tries to attach B's foreign group id. The
    // tenant-consistent (tenant_id, group_id) FK finds no such group under A's tenant, so the insert
    // raises 23503 → an opaque 500 (the deliberately-opaque foreign-id posture the catalogue STATUS map
    // documents); the attach never lands.
    const catA = await createCatalogue(appA, a.managerCookie, "Carta A");
    const prodRes = await send(appA, "POST", "/management-api/products", a.managerCookie, {
      catalogueId: catA,
      categoryId: null,
      descriptions: { [LOCALE]: "Producto A" },
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "general",
    });
    const productId = ((await prodRes.json()) as { id: string }).id;
    const attachRes = await send(
      appA,
      "PATCH",
      `/management-api/products/${productId}`,
      a.managerCookie,
      { optionGroupIds: [bGroupId] },
    );
    // The cross-tenant FK is refused (never a silent success); the attach did not land.
    expect(attachRes.status).toBeGreaterThanOrEqual(400);
    const attached = await send(
      appA,
      "GET",
      `/management-api/products/${productId}/option-groups`,
      a.managerCookie,
    );
    expect((await attached.json()) as string[]).toEqual([]);
  });

  it("refuses every option-group write route to a staff-role session — 403 authorization.not_permitted", async () => {
    // Pinned test 3: the `person.manage` gate covers the new authoring routes, proved the same way the
    // catalogue-write test above proves it — by DELETION. A `staff` session holds no `person.manage`,
    // so `authorizeManager` inside `gated` throws before any option-group op runs. Dropping that
    // `authorizeManager` from `catalogue-api.ts`'s `gated` helper flips each `toBe(403)` green→red (the
    // same guard-by-deletion receipt the catalogue-write block records).
    const { tenantId, staffCookie } = await setupVenue();
    const app = mountApp(tenantId);
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
