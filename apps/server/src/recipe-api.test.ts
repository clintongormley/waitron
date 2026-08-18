import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, startManagementSession } from "@waitron/identity";
import { createCatalogue, createProduct } from "@waitron/catalogue";
import type { Logger } from "./logger.js";
import { mountRecipeApi } from "./recipe-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import "./errors.js";

// PGlite, not real Postgres: this suite proves the recipe-authoring ROUTES — the request/response
// boundary, the body + id screens and the `recipe.manage` gate wiring — end to end in-process, the
// same way `catalogue-api.test.ts` proves the catalogue routes. The ingredients/recipe_lines tables
// live in CORE_MIGRATIONS and the management session/persons in IDENTITY_MIGRATIONS, and every DB
// touch runs `withTenant` + `asAppUser` exactly as production does. The differential RLS isolation
// proof and the gate-by-DELETION proof (removing `authorizeManager` turns the staff refusal
// green→red) are the NEXT task's real-Postgres suite (`recipe-api.rls.test.ts`), which PGlite cannot
// show because it connects as a superuser (CLAUDE.md §4).
const noopLog: Logger = () => {};

let tenantId: string;
let managerCookie: string;
let staffCookie: string;
let productId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    tenantId = await seedTenant(db);
    // Seed a MANAGER (role `manager`, holds `recipe.manage`) and a STAFF person (role `staff`, holds
    // nothing) as the app role under the tenant, mint a live management session for each, and seed one
    // catalogue + product for the recipe routes to hang lines on. `pin_hash` is NOT NULL, so a value
    // is supplied even though these sessions are minted directly rather than via a PIN/password login.
    const seeded = await withTenant(db, tenantId, async (tx) => {
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
      const catalogue = await createCatalogue(tx, { name: "Recipe catalogue" });
      const product = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: null,
        descriptions: { "es-ES": "Tostada" },
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      });
      return { managerSid: managerSession.id, staffSid: staffSession.id, prodId: product.id };
    });
    managerCookie = `${MANAGEMENT_COOKIE}=${seeded.managerSid}`;
    staffCookie = `${MANAGEMENT_COOKIE}=${seeded.staffSid}`;
    productId = seeded.prodId;
  },
});

function mountApp(): Hono {
  const app = new Hono();
  mountRecipeApi(app, { db: suite.db, cfg: { tenantId } }, noopLog);
  return app;
}

/** JSON GET/POST/PUT helper with the manager cookie unless overridden. */
async function send(
  app: Hono,
  method: "GET" | "POST" | "PUT",
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

describe("mountRecipeApi", () => {
  it("creates and lists an ingredient under a manager session", async () => {
    const app = mountApp();
    const created = await send(app, "POST", "/management-api/ingredients", {
      body: { name: "alioli", allergens: { eggs: { presence: "contains" } } },
      cookie: managerCookie,
    });
    expect(created.status).toBe(201);
    const list = await send(app, "GET", "/management-api/ingredients", { cookie: managerCookie });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { name: string }[]).map((i) => i.name)).toEqual(["alioli"]);
  });

  it("sets and gets a product's recipe", async () => {
    const app = mountApp();
    const ing = (await (
      await send(app, "POST", "/management-api/ingredients", {
        body: { name: "bread", allergens: { gluten: { presence: "contains" } } },
        cookie: managerCookie,
      })
    ).json()) as { id: string };
    const put = await send(app, "PUT", `/management-api/products/${productId}/recipe`, {
      body: { ingredientIds: [ing.id] },
      cookie: managerCookie,
    });
    expect(put.status).toBe(204);
    const got = await send(app, "GET", `/management-api/products/${productId}/recipe`, {
      cookie: managerCookie,
    });
    expect(got.status).toBe(200);
    expect(((await got.json()) as { name: string }[]).map((i) => i.name)).toEqual(["bread"]);
  });

  it("rejects a missing ingredient name with 400 management.request_invalid { field }", async () => {
    const res = await send(mountApp(), "POST", "/management-api/ingredients", {
      body: {},
      cookie: managerCookie,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });
  });

  it("rejects a non-uuid product id on the recipe route → shared.invalid_id 400", async () => {
    const res = await send(mountApp(), "GET", "/management-api/products/not-a-uuid/recipe", {
      cookie: managerCookie,
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });

  it("rejects an absent session with 401 and a staff session with 403", async () => {
    const app = mountApp();
    const noCookie = await send(app, "GET", "/management-api/ingredients", { cookie: null });
    expect(noCookie.status).toBe(401);
    const staff = await send(app, "GET", "/management-api/ingredients", { cookie: staffCookie });
    expect(staff.status).toBe(403);
    expect(((await staff.json()) as { error: { code: string } }).error.code).toBe(
      "authorization.not_permitted",
    );
  });
});
