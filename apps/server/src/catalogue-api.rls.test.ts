import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";

// Real Postgres, not PGlite: this suite proves the catalogue write group's RLS isolation and its
// `person.manage` gate DIFFERENTIALLY, which PGlite cannot do — every PGlite connection is a superuser
// that bypasses FORCE RLS (CLAUDE.md §4), so a "cross-tenant read returned nothing" on PGlite would be
// a FALSE pass. The route mechanics (body/id screens, upload) are already proven in-process on PGlite
// (`catalogue-api.test.ts`); here every DB touch goes through `withTenant` + `asAppUser` from
// `suite.admin`, and the assertions are written so that dropping `asAppUser` (isolation) or
// `authorizeManager` (the gate) from `catalogue-api.ts` turns a green test red — the two guard-by-
// deletion receipts recorded on the blocks below.
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

// The upload route writes the accepted bytes under a content-addressed name; only the staff-refusal
// test drives it, and (gated) it never reaches the write, but `mountCatalogueApi` still needs a real
// directory on `deps`.
let mediaDir: string;
beforeAll(async () => {
  mediaDir = await mkdtemp(join(tmpdir(), "waitron-catalogue-rls-"));
});
afterAll(async () => {
  if (mediaDir !== undefined) await rm(mediaDir, { recursive: true, force: true });
});

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same per-suite counter `management-api.rls.test.ts`
// uses.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(70_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  tenantId: string;
  /** This venue's single location id — the `:locationId` the location-menu routes act on. */
  locationId: string;
  /** A live MANAGEMENT session cookie for a `manager` (holds `person.manage`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (holds nothing — the gate refuses it). */
  staffCookie: string;
}

/**
 * Stand up a fresh provisioned venue (as the owner), then — as the app role under the tenant, so RLS
 * is exercised — seed a MANAGER (role `manager`) and a STAFF person (role `staff`) and mint a live
 * management session for each, returning the two session cookies the catalogue routes read. Each test
 * gets its OWN tenant, so its reads are that test's alone and order-independent (CLAUDE.md §4). The
 * catalogue routes carry no login route of their own (`mountManagementApi`'s job — not under test
 * here), so the sessions are minted directly with `startManagementSession`, exactly as the PGlite
 * `catalogue-api.test.ts` does; `pin_hash` is NOT NULL, so a value is supplied even though these
 * sessions never go through a PIN/password login.
 */
async function setupVenue(): Promise<Venue> {
  const venue = await applyVenue(
    planVenue({
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
      },
    }),
    { db: suite.admin },
  );

  const { managerSid, staffSid } = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
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
 * routes need their own app (mirrors `management-api.rls.test.ts`). */
function mountApp(tenantId: string): Hono {
  const app = new Hono();
  mountCatalogueApi(
    app,
    {
      db: suite.admin,
      // These suites assert RLS isolation + the gate, never the captured origin; any valid node id
      // satisfies the (now required) cfg.nodeId. Origin attribution is proven in sync-origin.rls.test.ts.
      cfg: { tenantId, nodeId: "11111111-1111-4111-8111-111111111111" },
      mediaDir,
      maxUploadBytes: 1024 * 1024,
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

async function createCategory(app: Hono, cookie: string, name: string): Promise<string> {
  const res = await send(app, "POST", "/management-api/categories", cookie, { name });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function createProduct(
  app: Hono,
  cookie: string,
  input: {
    catalogueId: string;
    descriptions: Record<string, string>;
    unitPrice: string;
    image?: string;
  },
): Promise<{ id: string; image: string | null }> {
  const res = await send(app, "POST", "/management-api/products", cookie, {
    catalogueId: input.catalogueId,
    categoryId: null,
    descriptions: input.descriptions,
    pricingUnit: "each",
    unitPrice: input.unitPrice,
    vatClass: "general",
    ...(input.image === undefined ? {} : { image: input.image }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; image: string | null };
}

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

/** POST a multipart upload (used only by the staff-refusal gate test). */
async function uploadRequest(app: Hono, cookie: string): Promise<Response> {
  const fd = new FormData();
  fd.append("file", new Blob([PNG_BYTES], { type: "image/png" }), "photo.png");
  return app.request("/management-api/product-images", {
    method: "POST",
    headers: { cookie },
    body: fd,
  });
}

describe("Catalogue API over real Postgres (RLS end-to-end)", () => {
  it("isolates catalogues, categories and products across tenants — a manager sees only their OWN tenant", async () => {
    // Differential cross-tenant isolation (design §9, spec §2). Two independent provisioned venues,
    // each with its own manager. Every list read below (`listCatalogues`/`listCategories`/
    // `listProducts`) has NO explicit tenant filter — isolation is entirely `withTenant` + `asAppUser`
    // RLS. So were `asAppUser` ever dropped from `mountCatalogueApi`'s `gated` helper, each list would
    // run on the `suite.admin` connection (a superuser that BYPASSES FORCE RLS) and would leak the
    // other tenant's rows, failing the `not.toContain` assertions here.
    //
    // GUARD-BY-DELETION (asAppUser), actually run on 2026-08-11 against postgres:18 via Testcontainers
    // (TESTCONTAINERS_RYUK_DISABLED=true): removed `await asAppUser(tx);` from `catalogue-api.ts`'s
    // `gated` helper (the line above `authorizeManager`). This test then FAILED — tenant A's catalogue
    // list contained tenant B's catalogue id (`idsA` did contain `bCatalogueId`), exactly the RLS leak
    // predicted. Restored the line and the test passed again; `git diff catalogue-api.ts` is clean.
    const a = await setupVenue();
    const b = await setupVenue();
    const appA = mountApp(a.tenantId);
    const appB = mountApp(b.tenantId);

    // Each manager authors a catalogue, a category and a product under their own tenant.
    const catA = await createCatalogue(appA, a.managerCookie, "Carta A");
    const catB = await createCatalogue(appB, b.managerCookie, "Carta B");
    const categoryA = await createCategory(appA, a.managerCookie, "Categoría A");
    const categoryB = await createCategory(appB, b.managerCookie, "Categoría B");
    const prodA = await createProduct(appA, a.managerCookie, {
      catalogueId: catA,
      descriptions: { [LOCALE]: "Producto A" },
      unitPrice: "1.00",
    });
    const prodB = await createProduct(appB, b.managerCookie, {
      catalogueId: catB,
      descriptions: { [LOCALE]: "Producto B" },
      unitPrice: "2.00",
    });

    // Tenant A's manager lists catalogues: exactly A's own, and NOT B's. This is the load-bearing
    // differential — the read is unfiltered and relies wholly on RLS (see the deletion receipt above).
    const catsA = await send(appA, "GET", "/management-api/catalogues", a.managerCookie);
    expect(catsA.status).toBe(200);
    const catIdsA = ((await catsA.json()) as { id: string }[]).map((r) => r.id);
    expect(catIdsA).toContain(catA);
    expect(catIdsA).not.toContain(catB);

    // Categories, same shape.
    const categoriesA = await send(appA, "GET", "/management-api/categories", a.managerCookie);
    const categoryIdsA = ((await categoriesA.json()) as { id: string }[]).map((r) => r.id);
    expect(categoryIdsA).toContain(categoryA);
    expect(categoryIdsA).not.toContain(categoryB);

    // Products under A's own catalogue: A's product, and reading B's catalogue id returns nothing
    // (RLS hides B's catalogue rows from A, so `listProducts` matches none — a foreign id leaks no
    // rows). If `asAppUser` were dropped, the foreign-id read would return B's product.
    const prodsA = await send(
      appA,
      "GET",
      `/management-api/catalogues/${catA}/products`,
      a.managerCookie,
    );
    const prodIdsA = ((await prodsA.json()) as { id: string }[]).map((r) => r.id);
    expect(prodIdsA).toEqual([prodA.id]);
    const aReadsBsCatalogue = await send(
      appA,
      "GET",
      `/management-api/catalogues/${catB}/products`,
      a.managerCookie,
    );
    expect(aReadsBsCatalogue.status).toBe(200);
    expect((await aReadsBsCatalogue.json()) as unknown[]).toEqual([]);

    // The reverse direction: B's manager sees only B's rows, never A's — proving the isolation is
    // symmetric and not an artefact of which tenant was provisioned first.
    const catsB = await send(appB, "GET", "/management-api/catalogues", b.managerCookie);
    const catIdsB = ((await catsB.json()) as { id: string }[]).map((r) => r.id);
    expect(catIdsB).toContain(catB);
    expect(catIdsB).not.toContain(catA);

    const prodsB = await send(
      appB,
      "GET",
      `/management-api/catalogues/${catB}/products`,
      b.managerCookie,
    );
    expect(((await prodsB.json()) as { id: string }[]).map((r) => r.id)).toEqual([prodB.id]);
    const bReadsAsCatalogue = await send(
      appB,
      "GET",
      `/management-api/catalogues/${catA}/products`,
      b.managerCookie,
    );
    expect((await bReadsAsCatalogue.json()) as unknown[]).toEqual([]);
  });

  it("refuses every catalogue write route to a staff-role session — 403 authorization.not_permitted", async () => {
    // Prove the `person.manage` gate BY DELETION. A `staff`-role management session holds no
    // `person.manage`, so `authorizeManager` (inside `gated`) throws `authorization.not_permitted`
    // before any catalogue op runs on every write route. The list/read routes stay reachable to
    // staff by the same gate (they are gated too, but this test targets the WRITES the design §9
    // enumerates: POST /catalogues, POST /products, PATCH /products/:id, POST /product-images, plus the
    // location-menu writes POST/DELETE /locations/:id/catalogues and PUT /locations/:id/default-catalogue).
    // Every write funnels through the ONE `gated` helper, so a zero-uuid location/catalogue id is enough —
    // the gate fires before the id reaches any table.
    //
    // GUARD-BY-DELETION (authorizeManager), actually run on 2026-08-11 against postgres:18 via
    // Testcontainers (TESTCONTAINERS_RYUK_DISABLED=true): removed the
    //   `await authorizeManager(tx, { managementSessionId: sessionId, permission: CATALOGUE_WRITE_PERMISSION });`
    // call from `catalogue-api.ts`'s `gated` helper. This test then FAILED — every staff request that
    // expected 403 instead succeeded (POST /catalogues → 201, POST /products → 201/500, PATCH → 204,
    // POST /product-images → 201), so the four `toBe(403)` assertions flipped green→red. Restored the
    // line and the test passed again; `git diff catalogue-api.ts` is clean afterwards.
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
    await expect403(await uploadRequest(app, staffCookie));
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

  it("refuses a cross-tenant catalogueId on the location-menu writes — 404, no cross-tenant default set", async () => {
    // The guard that closes the single-column `locations.catalogue_id` FK hole (0028). That FK is NOT
    // tenant-scoped and a FK check BYPASSES RLS, so WITHOUT `assertCatalogueVisible` a PUT default with
    // another tenant's catalogueId would SUCCEED and set a cross-tenant catalogue as tenant A's default
    // (`location_catalogues`' composite FK would 23503 the POST anyway; the guard makes both a clean 404).
    //
    // GUARD-BY-DELETION (assertCatalogueVisible), run on postgres:18 via Testcontainers
    // (TESTCONTAINERS_RYUK_DISABLED=true): removed BOTH `await assertCatalogueVisible(tx, catalogueId);`
    // calls from `catalogue-api.ts`. This test then FAILED — the PUT returned 204 and tenant A's location
    // default became tenant B's catalogue id (the final `some(isDefault)` flipped true). Restored the two
    // lines and it passed again; `git diff catalogue-api.ts` clean afterwards.
    const a = await setupVenue();
    const b = await setupVenue();
    const appA = mountApp(a.tenantId);
    const appB = mountApp(b.tenantId);
    const catB = await createCatalogue(appB, b.managerCookie, "Carta B");

    const putPath = `/management-api/locations/${a.locationId}/default-catalogue`;
    const put = await send(appA, "PUT", putPath, a.managerCookie, { catalogueId: catB });
    expect(put.status).toBe(404);
    expect((await put.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "catalogue.not_found" },
    });

    const postPath = `/management-api/locations/${a.locationId}/catalogues`;
    const post = await send(appA, "POST", postPath, a.managerCookie, { catalogueId: catB });
    expect(post.status).toBe(404);

    // Tenant A has NO default set — the cross-tenant id never landed. A cannot see catB at all, so every
    // row A gets back reads `isDefault:false`.
    const list = await send(appA, "GET", postPath, a.managerCookie);
    const rows = (await list.json()) as { id: string; isDefault: boolean }[];
    expect(rows.some((r) => r.isDefault)).toBe(false);
  });

  it("adds, defaults and removes a location's menus as the app role under RLS (grants proof)", async () => {
    // The successful WRITE path on real Postgres — app_user doing INSERT/DELETE on `location_catalogues`
    // and UPDATE on `locations` under RLS. PGlite (a superuser) cannot prove those grants; a missing GRANT
    // would pass every PGlite test and fail only at runtime. Mirrors the product-image successful-write
    // RLS test below.
    const a = await setupVenue();
    const app = mountApp(a.tenantId);
    const casa = await createCatalogue(app, a.managerCookie, "Casa");
    const dia = await createCatalogue(app, a.managerCookie, "Día");
    const cataloguesPath = `/management-api/locations/${a.locationId}/catalogues`;
    const defaultPath = `/management-api/locations/${a.locationId}/default-catalogue`;

    expect(
      (await send(app, "POST", cataloguesPath, a.managerCookie, { catalogueId: dia })).status,
    ).toBe(204);
    expect(
      (await send(app, "PUT", defaultPath, a.managerCookie, { catalogueId: casa })).status,
    ).toBe(204);
    const afterAdd = (await (await send(app, "GET", cataloguesPath, a.managerCookie)).json()) as {
      id: string;
      sellable: boolean;
      isDefault: boolean;
    }[];
    const byId = new Map(afterAdd.map((r) => [r.id, r]));
    expect(byId.get(casa)).toMatchObject({ sellable: true, isDefault: true });
    expect(byId.get(dia)).toMatchObject({ sellable: true, isDefault: false });

    expect((await send(app, "DELETE", `${cataloguesPath}/${dia}`, a.managerCookie)).status).toBe(
      204,
    );
    const afterRemove = (await (
      await send(app, "GET", cataloguesPath, a.managerCookie)
    ).json()) as {
      id: string;
      sellable: boolean;
    }[];
    expect(afterRemove.find((r) => r.id === dia)).toMatchObject({ sellable: false });
  });

  it("writes and reads the product image under RLS; a cross-tenant read returns nothing (design §5a)", async () => {
    // The §5a receipt at the API layer: the existing table-level grant + `products_tenant_isolation`
    // policy cover the `image` column added in 0034 — a manager writes a product WITH an image, reads
    // it back (through the `asAppUser` GET route AND directly as `app_user`), and another tenant's
    // manager reading the same catalogue id sees nothing (RLS row-hides it). This is proof, not
    // assertion (design §11): if `asAppUser` were dropped the cross-tenant read would leak the row.
    const a = await setupVenue();
    const b = await setupVenue();
    const appA = mountApp(a.tenantId);
    const appB = mountApp(b.tenantId);

    const catA = await createCatalogue(appA, a.managerCookie, "Carta con foto");
    const IMAGE = "b91c8f0e00000000000000000000000000000000000000000000000000000000.png";
    const product = await createProduct(appA, a.managerCookie, {
      catalogueId: catA,
      descriptions: { [LOCALE]: "Con foto" },
      unitPrice: "3.30",
      image: IMAGE,
    });
    expect(product.image).toBe(IMAGE);

    // Read back through the GET route (runs `asAppUser` under A's tenant): the image landed.
    const listed = await send(
      appA,
      "GET",
      `/management-api/catalogues/${catA}/products`,
      a.managerCookie,
    );
    const rowViaApi = ((await listed.json()) as { id: string; image: string | null }[]).find(
      (r) => r.id === product.id,
    )!;
    expect(rowViaApi.image).toBe(IMAGE);

    // Read the image column directly as `app_user` under A's tenant — the §5a "write/read image as
    // app_user under withTenant+asAppUser" receipt, proving the new column is readable through the
    // existing grant, not merely returned by the route.
    const direct = await withTenant(suite.admin, a.tenantId, async (tx) => {
      await asAppUser(tx);
      const r = await tx.execute<{ image: string | null }>(
        sql`select image from products where id = ${product.id}`,
      );
      return r.rows;
    });
    expect(direct).toEqual([{ image: IMAGE }]);

    // Tenant B's manager reading A's catalogue id: RLS hides A's product entirely — nothing comes back.
    const crossTenant = await send(
      appB,
      "GET",
      `/management-api/catalogues/${catA}/products`,
      b.managerCookie,
    );
    expect(crossTenant.status).toBe(200);
    expect((await crossTenant.json()) as unknown[]).toEqual([]);
  });
});
