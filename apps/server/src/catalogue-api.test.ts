import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, startManagementSession } from "@waitron/identity";
import type { Logger } from "./logger.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import "./errors.js";

// PGlite, not real Postgres: this suite proves the ROUTES — the request/response boundary, the body +
// id screens, the permission gate wiring and the image-upload mechanics — end to end in-process, the
// same way `till-api.test.ts` proves the till routes. The catalogue tables live in CORE_MIGRATIONS and
// the management session/persons in IDENTITY_MIGRATIONS, and every DB touch runs `withTenant` +
// `asAppUser` exactly as production does. The gate-by-DELETION proof (removing `authorizeManager`
// turns the staff refusals green→red) and the option-group attach's tenant-consistent composite FK are
// the real-Postgres suite (`catalogue-api.pg.test.ts`); PGlite connects as a superuser holding every
// grant (CLAUDE.md §4).
const noopLog: Logger = () => {};

// A comfortable per-file limit for the handler-path tests (happy path, missing, unsupported): well
// above the multipart framing so a small payload reaches the handler. The two `media.too_large` tests
// mount their own app with a tiny limit instead (see below).
const HANDLER_LIMIT = 1024 * 1024;

let tenantId: string;
let locationId: string;
let managerCookie: string;
let staffCookie: string;
let mediaDir: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    tenantId = await seedTenant(db);
    // One location for the tenant, seeded as the owner (fixture setup like seedTenant) so
    // the location↔menu membership routes have a `:locationId` to act on. Minimal required columns only.
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Main', array['es-ES'], 'Venta') returning id`);
    locationId = loc.rows[0]!.id;
    // Seed a MANAGER (role `manager`, holds `person.manage`) and a STAFF person (role `staff`, holds
    // nothing) as the app role under the tenant, then mint a live management session for each so the
    // route tests can drive the gate through a real cookie. `pin_hash` is NOT NULL, so a value is
    // supplied even though these sessions are minted directly rather than via a PIN/password login.
    const { managerSid, staffSid } = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const mgr = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
      const stf = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
      const managerSession = await startManagementSession(tx, {
        tenantId,
        personId: mgr.rows[0]!.id,
      });
      const staffSession = await startManagementSession(tx, {
        tenantId,
        personId: stf.rows[0]!.id,
      });
      return { managerSid: managerSession.id, staffSid: staffSession.id };
    });
    managerCookie = `${MANAGEMENT_COOKIE}=${managerSid}`;
    staffCookie = `${MANAGEMENT_COOKIE}=${staffSid}`;
  },
});

beforeAll(async () => {
  mediaDir = await mkdtemp(join(tmpdir(), "waitron-catalogue-api-"));
});
afterAll(async () => {
  if (mediaDir !== undefined) await rm(mediaDir, { recursive: true, force: true });
});

function mountApp(maxUploadBytes: number = HANDLER_LIMIT): Hono {
  const app = new Hono();
  mountCatalogueApi(
    app,
    // cfg.nodeId is required but this in-process suite asserts route mechanics, not the captured
    // origin (that is sync-origin.test.ts's job); any valid node id satisfies the type.
    {
      db: suite.db,
      cfg: { tenantId, nodeId: "11111111-1111-4111-8111-111111111111" },
      mediaDir,
      maxUploadBytes,
    },
    noopLog,
  );
  return app;
}

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

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);

async function uploadRequest(
  app: Hono,
  part: { name: string; bytes: Uint8Array<ArrayBuffer>; type: string; filename?: string } | null,
  cookie: string | null = managerCookie,
): Promise<Response> {
  const fd = new FormData();
  if (part !== null) {
    fd.append(
      part.name,
      new Blob([part.bytes], { type: part.type }),
      part.filename ?? "upload.bin",
    );
  }
  const headers: Record<string, string> = {};
  if (cookie !== null) headers["cookie"] = cookie;
  return app.request("/management-api/product-images", { method: "POST", headers, body: fd });
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
      body: { name: "Bebidas" },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.name).toBe("Bebidas");
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
    await send(app, "POST", "/management-api/categories", { body: { name: "Postres" } });
    const res = await send(app, "GET", "/management-api/categories");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { name: string }[];
    expect(rows.some((r) => r.name === "Postres")).toBe(true);
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
        descriptions: { es: "Café solo" },
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
      descriptions: Record<string, string>;
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
      descriptions: { es: "Café solo" },
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

  it("POST /management-api/products with active:false → 201 and the created product is inactive", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Create-inactive catalogue");
    const res = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        descriptions: { es: "No sellable yet" },
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
        descriptions: { es: "Explícitamente activo" },
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
        descriptions: { es: "Activo por defecto" },
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      },
    });
    expect(omitted.status).toBe(201);
    expect((await omitted.json()) as { active: boolean }).toMatchObject({ active: true });
  });

  it("POST /management-api/products with a missing required field → management.request_invalid 400", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Missing-field catalogue");
    const res = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        descriptions: { es: "Sin precio" },
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
          descriptions: { es: "Mal alérgeno" },
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
        descriptions: { es: "Falafel" },
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
          descriptions: { es: "x" },
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
        descriptions: { es: "x" },
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
        descriptions: { es: "x" },
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
        descriptions: { es: "Editar" },
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
        descriptions: { es: "Editar alérgeno" },
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
    descriptions: { es: "x" },
    pricingUnit: "each",
    unitPrice: "1.00",
    vatClass: "general",
  };

  it.each([
    ["catalogueId", { ...productBase, catalogueId: 123 }],
    ["categoryId", { ...productBase, categoryId: 123 }],
    ["descriptions", { ...productBase, descriptions: "nope" }],
    ["descriptions", { ...productBase, descriptions: ["arr"] }],
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

  it.each([
    ["descriptions", { descriptions: "nope" }],
    ["descriptions", { descriptions: ["arr"] }],
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

  it("PATCH /products/:id applies descriptions/vatClass/pricingUnit/categoryId/image (204) and they land", async () => {
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
        descriptions: { es: "antes" },
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      },
    });
    const productId = ((await createRes.json()) as { id: string }).id;

    const res = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: {
        descriptions: { es: "después" },
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
        descriptions: Record<string, string>;
        vatClass: string;
        pricingUnit: string;
        categoryId: string | null;
        image: string | null;
      }[]
    ).find((r) => r.id === productId)!;
    expect(row).toMatchObject({
      descriptions: { es: "después" },
      vatClass: "reduced",
      pricingUnit: "weight",
      categoryId,
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
        descriptions: { es: "sin cambios" },
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
    const res = await send(mountApp(), "PATCH", `/management-api/products/${DUMMY_UUID}`, {
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

    const patch = await app.request(`/management-api/products/${DUMMY_UUID}`, {
      method: "PATCH",
      headers,
      body: "{ not json",
    });
    expect(patch.status).toBe(204);
  });
});

describe("mountCatalogueApi — image upload", () => {
  it("POST /management-api/product-images with a valid PNG → 201 { image: <64hex>.png } and writes the file", async () => {
    const app = mountApp();
    const res = await uploadRequest(app, {
      name: "file",
      bytes: PNG_BYTES,
      type: "image/png",
      filename: "photo.png",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { image: string };
    expect(body.image).toMatch(/^[0-9a-f]{64}\.png$/);
    // The bytes were written under the content-addressed name (idempotent by construction).
    const onDisk = new Uint8Array(await readFile(join(mediaDir, body.image)));
    expect(onDisk).toEqual(PNG_BYTES);
  });

  it("POST /management-api/product-images with no file part → media.missing 400", async () => {
    const res = await uploadRequest(mountApp(), {
      name: "notfile",
      bytes: PNG_BYTES,
      type: "image/png",
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "media.missing" },
    });
  });

  it("POST /management-api/product-images with a GIF blob → media.unsupported_type 415", async () => {
    const res = await uploadRequest(mountApp(), {
      name: "file",
      bytes: GIF_BYTES,
      type: "image/gif",
      filename: "x.gif",
    });
    expect(res.status).toBe(415);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "media.unsupported_type" },
    });
  });

  it("POST /management-api/product-images unauthenticated → 401", async () => {
    const res = await uploadRequest(
      mountApp(),
      { name: "file", bytes: PNG_BYTES, type: "image/png" },
      null,
    );
    expect(res.status).toBe(401);
  });

  it("POST /management-api/product-images over the per-file limit → media.too_large 413 (precise check)", async () => {
    // A file whose bytes exceed the tiny per-file limit but whose whole multipart body stays under the
    // coarse bodyLimit ceiling, so it reaches the handler's precise `file.size` check.
    const app = mountApp(256);
    const big = new Uint8Array(400);
    big.set(PNG_BYTES, 0);
    const res = await uploadRequest(app, { name: "file", bytes: big, type: "image/png" });
    expect(res.status).toBe(413);
    expect(
      (await res.json()) as { error: { code: string; params: { limit: number } } },
    ).toMatchObject({ error: { code: "media.too_large", params: { size: 400, limit: 256 } } });
  });

  it("POST /management-api/product-images over the coarse body ceiling → media.too_large 413 (bodyLimit)", async () => {
    // A body far larger than the coarse ceiling (limit + framing headroom): bodyLimit rejects it
    // mid-stream, before parseBody buffers it, and answers the same media.too_large 413.
    const app = mountApp(256);
    const huge = new Uint8Array(64 * 1024);
    huge.set(PNG_BYTES, 0);
    const res = await uploadRequest(app, { name: "file", bytes: huge, type: "image/png" });
    expect(res.status).toBe(413);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "media.too_large" },
    });
  });
});

// ── Option groups + items authoring (Task 11) ────────────────────────────────────────────────────
// Route mechanics for the modifier-authoring surface, proved in-process on PGlite like the rest of
// this file: the group/item CRUD, the request-shape + id screens, the domain `options.group_invalid`
// bounds check, and the product↔group attach carried on the product POST/PATCH body. The
// `person.manage` gate-by-deletion and the attach's tenant-consistent composite FK are the
// real-Postgres suite's job (catalogue-api.pg.test.ts), which PGlite cannot show (every PGlite
// connection is a superuser holding every grant).

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
      descriptions: { es: "Producto con opciones" },
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

  // ── Allergen overlay (modifier↔allergen, Task 5): the routes accept addAllergens/removeAllergens
  // and defer validation to the ops, exactly as product `allergens` is threaded. ──────────────────
  it("POST /option-groups/:id/items accepts an allergen overlay and returns it", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "Panes" } });
    const res = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: { name: { en: "Gluten-free bun" }, removeAllergens: ["gluten"] },
    });
    expect(res.status).toBe(201);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      addAllergens: null,
      removeAllergens: ["gluten"],
    });
  });

  it("POST /option-groups/:id/items 400s on a conflicting overlay", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "x" } });
    const res = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: {
        name: { en: "x" },
        addAllergens: { gluten: { presence: "contains" } },
        removeAllergens: ["gluten"],
      },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "allergen.add_remove_conflict" },
    });
  });

  it("PATCH /option-groups/:id/items/:itemId threads an allergen overlay (204) and it lands", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "x" } });
    const created = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: { name: { es: "x" } },
    });
    const itemId = ((await created.json()) as { id: string }).id;
    const res = await send(app, "PATCH", `/management-api/option-groups/${g.id}/items/${itemId}`, {
      body: {
        addAllergens: { milk: { presence: "contains" } },
        removeAllergens: ["gluten"],
      },
    });
    expect(res.status).toBe(204);
    const rows = (await (
      await send(app, "GET", `/management-api/option-groups/${g.id}/items`)
    ).json()) as Record<string, unknown>[];
    expect(rows.find((r) => r["id"] === itemId)).toMatchObject({
      addAllergens: { milk: { presence: "contains" } },
      removeAllergens: ["gluten"],
    });
  });

  it("PATCH /option-groups/:id/items/:itemId 400s on a conflicting overlay", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "x" } });
    const created = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: { name: { es: "x" } },
    });
    const itemId = ((await created.json()) as { id: string }).id;
    const res = await send(app, "PATCH", `/management-api/option-groups/${g.id}/items/${itemId}`, {
      body: {
        addAllergens: { gluten: { presence: "contains" } },
        removeAllergens: ["gluten"],
      },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "allergen.add_remove_conflict" },
    });
  });

  // ── Origin overlay (Task 4): the diet twin of the allergen overlay — the routes accept
  // addOrigins/removeOrigins and defer validation to the ops. ──────────────────────────────────────
  it("POST /option-groups/:id/items accepts an origin overlay and returns it", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "Extras" } });
    const res = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: { name: { en: "Add bacon" }, addOrigins: ["meat"], removeOrigins: ["dairy"] },
    });
    expect(res.status).toBe(201);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      addOrigins: ["meat"],
      removeOrigins: ["dairy"],
    });
  });

  it("POST /option-groups/:id/items 400s on a non-origin addOrigins entry", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "x" } });
    const res = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: { name: { en: "x" }, addOrigins: ["wombat"] },
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { origin: string } } },
    ).toMatchObject({ error: { code: "diet.invalid_origin", params: { origin: "wombat" } } });
  });

  it("PATCH /option-groups/:id/items/:itemId threads an origin overlay (204) and it lands", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "x" } });
    const created = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: { name: { es: "x" } },
    });
    const itemId = ((await created.json()) as { id: string }).id;
    const res = await send(app, "PATCH", `/management-api/option-groups/${g.id}/items/${itemId}`, {
      body: { addOrigins: ["meat"], removeOrigins: ["fish"] },
    });
    expect(res.status).toBe(204);
    const rows = (await (
      await send(app, "GET", `/management-api/option-groups/${g.id}/items`)
    ).json()) as Record<string, unknown>[];
    expect(rows.find((r) => r["id"] === itemId)).toMatchObject({
      addOrigins: ["meat"],
      removeOrigins: ["fish"],
    });
  });

  it("PATCH /option-groups/:id/items/:itemId 400s on a non-origin removeOrigins entry", async () => {
    const app = mountApp();
    const g = await createGroupVia(app, { name: { es: "x" } });
    const created = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
      body: { name: { es: "x" } },
    });
    const itemId = ((await created.json()) as { id: string }).id;
    const res = await send(app, "PATCH", `/management-api/option-groups/${g.id}/items/${itemId}`, {
      body: { removeOrigins: ["wombat"] },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "diet.invalid_origin" },
    });
  });
});

describe("mountCatalogueApi — attaching option groups to products", () => {
  it("creates a group + items, attaches via the product body, and reads the whole thing back", async () => {
    // Pinned test 1 (route half): author a group with two items, create a product carrying an ordered
    // `optionGroupIds`, then read the group's items (GET /option-groups/:id/items) and the product's
    // attached group ids (GET /products/:id/option-groups) back. The till-read half (the same attach
    // surfacing in `listAvailableProducts`) is the real-Postgres suite's, where a location exists.
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Menú con opciones");
    const g = await createGroupVia(app, {
      name: { es: "Punto de la carne" },
      minSelect: 1,
      maxSelect: 1,
      required: true,
    });
    // Explicit ascending `sort` so the list order is deterministic (equal sort would tiebreak on the
    // random uuid, which is why the sort is set rather than relying on insertion order).
    for (const [sort, name] of [
      [0, "Poco hecho"],
      [1, "Al punto"],
    ] as const) {
      const r = await send(app, "POST", `/management-api/option-groups/${g.id}/items`, {
        body: { name: { es: name }, sort },
      });
      expect(r.status).toBe(201);
    }

    const createRes = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        descriptions: { es: "Entrecot" },
        pricingUnit: "each",
        unitPrice: "18.00",
        vatClass: "general",
        optionGroupIds: [g.id],
      },
    });
    expect(createRes.status).toBe(201);
    const productId = ((await createRes.json()) as { id: string }).id;

    const items = (await (
      await send(app, "GET", `/management-api/option-groups/${g.id}/items`)
    ).json()) as { name: Record<string, string> }[];
    expect(items.map((i) => i.name["es"])).toEqual(["Poco hecho", "Al punto"]);

    const attached = await send(app, "GET", `/management-api/products/${productId}/option-groups`);
    expect(attached.status).toBe(200);
    expect((await attached.json()) as string[]).toEqual([g.id]);
  });

  it("PATCH /products/:id with optionGroupIds re-orders and detaches (the attach is a full replace)", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Reorder menu");
    const g1 = await createGroupVia(app, { name: { es: "A" } });
    const g2 = await createGroupVia(app, { name: { es: "B" } });
    const productId = await createProductVia(app, catalogueId);

    // Attach [g1, g2] in order.
    let res = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: { optionGroupIds: [g1.id, g2.id] },
    });
    expect(res.status).toBe(204);
    expect(
      (await (
        await send(app, "GET", `/management-api/products/${productId}/option-groups`)
      ).json()) as string[],
    ).toEqual([g1.id, g2.id]);

    // Replace with [g2] only — g1 detaches, order is the new list.
    res = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: { optionGroupIds: [g2.id] },
    });
    expect(res.status).toBe(204);
    expect(
      (await (
        await send(app, "GET", `/management-api/products/${productId}/option-groups`)
      ).json()) as string[],
    ).toEqual([g2.id]);

    // An empty list detaches everything.
    res = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: { optionGroupIds: [] },
    });
    expect(res.status).toBe(204);
    expect(
      (await (
        await send(app, "GET", `/management-api/products/${productId}/option-groups`)
      ).json()) as string[],
    ).toEqual([]);
  });

  it("PATCH /products/:id dedupes a repeated optionGroupId instead of a PK-collision 500", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Dupe attach menu");
    const g1 = await createGroupVia(app, { name: { es: "A" } });
    const productId = await createProductVia(app, catalogueId);

    // The same id twice would collide on the (product_id, group_id) PK if it reached the insert —
    // the shape screen collapses it to one, first-occurrence order preserved. 204, not 500.
    const res = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: { optionGroupIds: [g1.id, g1.id] },
    });
    expect(res.status).toBe(204);
    expect(
      (await (
        await send(app, "GET", `/management-api/products/${productId}/option-groups`)
      ).json()) as string[],
    ).toEqual([g1.id]);
  });

  it.each([
    ["not an array", { optionGroupIds: "g1" }],
    ["a non-string element", { optionGroupIds: [123] }],
  ])(
    "POST /products rejects optionGroupIds that is %s → management.request_invalid 400",
    async (_label, extra) => {
      const app = mountApp();
      const catalogueId = await createCatalogueVia(app, `Bad attach ${_label}`);
      const res = await send(app, "POST", "/management-api/products", {
        body: {
          catalogueId,
          categoryId: null,
          descriptions: { es: "x" },
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
        error: { code: "management.request_invalid", params: { field: "optionGroupIds" } },
      });
    },
  );

  it("POST /products rejects a malformed uuid in optionGroupIds → shared.invalid_id 400", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Bad uuid attach");
    const res = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        descriptions: { es: "x" },
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
        optionGroupIds: ["not-a-uuid"],
      },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });

  it("GET /management-api/products/:id/option-groups with a non-uuid id → shared.invalid_id 400", async () => {
    const res = await send(mountApp(), "GET", "/management-api/products/not-a-uuid/option-groups");
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });
});
