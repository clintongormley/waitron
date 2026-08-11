import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
// `asAppUser` exactly as production does. The *differential* RLS isolation proof and the
// gate-by-DELETION proof (a manager of tenant A cannot see B; removing `authorizeManager` turns the
// staff refusals green→red) are the NEXT task's real-Postgres suite (`catalogue-api.rls.test.ts`),
// which PGlite cannot show because it connects as a superuser (CLAUDE.md §4).
const noopLog: Logger = () => {};

// A comfortable per-file limit for the handler-path tests (happy path, missing, unsupported): well
// above the multipart framing so a small payload reaches the handler. The two `media.too_large` tests
// mount their own app with a tiny limit instead (see below).
const HANDLER_LIMIT = 1024 * 1024;

let tenantId: string;
let managerCookie: string;
let staffCookie: string;
let mediaDir: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    tenantId = await seedTenant(db);
    // Seed a MANAGER (role `manager`, holds `person.manage`) and a STAFF person (role `staff`, holds
    // nothing) as the app role under the tenant, then mint a live management session for each so the
    // route tests can drive the gate through a real cookie. `pin_hash` is NOT NULL, so a value is
    // supplied even though these sessions are minted directly rather than via a PIN/password login.
    const { managerSid, staffSid } = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const mgr = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
      const stf = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
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
  mountCatalogueApi(app, { db: suite.db, cfg: { tenantId }, mediaDir, maxUploadBytes }, noopLog);
  return app;
}

/** JSON POST/PATCH helper with the manager cookie unless overridden. */
async function send(
  app: Hono,
  method: "POST" | "PATCH" | "GET",
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
        descriptions: { "es-ES": "Café solo" },
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
      descriptions: { "es-ES": "Café solo" },
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

  it("POST /management-api/products with a missing required field → management.request_invalid 400", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Missing-field catalogue");
    const res = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        descriptions: { "es-ES": "Sin precio" },
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
          descriptions: { "es-ES": "Mal alérgeno" },
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

  it("PATCH /management-api/products/:id updates unitPrice / active / image (204 each)", async () => {
    const app = mountApp();
    const catalogueId = await createCatalogueVia(app, "Patchable catalogue");
    const createRes = await send(app, "POST", "/management-api/products", {
      body: {
        catalogueId,
        categoryId: null,
        descriptions: { "es-ES": "Editar" },
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
        descriptions: { "es-ES": "Editar alérgeno" },
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
    descriptions: { "es-ES": "x" },
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
        descriptions: { "es-ES": "antes" },
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      },
    });
    const productId = ((await createRes.json()) as { id: string }).id;

    const res = await send(app, "PATCH", `/management-api/products/${productId}`, {
      body: {
        descriptions: { "es-ES": "después" },
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
      descriptions: { "es-ES": "después" },
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
        descriptions: { "es-ES": "sin cambios" },
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
  // opaque 500 — the same guard the management routes carry (management-api.rls.test.ts).
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
