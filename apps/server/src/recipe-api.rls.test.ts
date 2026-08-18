import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { createCatalogue, createProduct } from "@waitron/catalogue";
import type { Logger } from "./logger.js";
import { mountRecipeApi } from "./recipe-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import { startRealPostgres } from "./testing/postgres.js";

// Real Postgres, not PGlite: this suite proves the recipe-authoring write group's RLS isolation and its
// `recipe.manage` gate DIFFERENTIALLY, which PGlite cannot do — every PGlite connection is a superuser
// that bypasses FORCE RLS (CLAUDE.md §4), so a "cross-tenant read returned nothing" on PGlite would be a
// FALSE pass. The route mechanics (body/id screens, STATUS map) are already proven in-process on PGlite
// (`recipe-api.test.ts`); here every DB touch goes through `withTenant` + `asAppUser` from `suite.admin`,
// and the assertions are written so that dropping `asAppUser` (isolation) or `authorizeManager` (the
// gate) from `recipe-api.ts` turns a green test red — the two guard-by-deletion receipts recorded on the
// blocks below.
const LOCALE = "es-ES";

const suite = useRealPostgres({
  start: startRealPostgres,
  timeoutMs: 180_000,
});

/** A no-op logger: only the HTTP responses and the database state matter here. */
const noopLog: Logger = () => {};

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same per-suite counter the sibling RLS suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  tenantId: string;
  /** A live MANAGEMENT session cookie for a `manager` (holds `recipe.manage`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (holds nothing — the gate refuses it). */
  staffCookie: string;
  /** A seeded product, so the two `/products/:id/recipe` routes can be gated against a real id. */
  productId: string;
}

/**
 * Stand up a fresh provisioned venue (as the owner), then — as the app role under the tenant, so RLS
 * is exercised — seed a MANAGER (role `manager`) and a STAFF person (role `staff`), one catalogue +
 * product for the recipe routes to hang lines on, and mint a live management session for each person,
 * returning the two session cookies the recipe routes read. Each test gets its OWN tenant, so its reads
 * are that test's alone and order-independent (CLAUDE.md §4). The recipe routes carry no login route of
 * their own, so the sessions are minted directly with `startManagementSession`, exactly as the PGlite
 * `recipe-api.test.ts` does.
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

  const { managerSid, staffSid, productId } = await withTenant(
    suite.admin,
    venue.tenantId,
    async (tx) => {
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
      const catalogue = await createCatalogue(tx, { name: "Recipe catalogue" });
      const product = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: null,
        descriptions: { "es-ES": "Tostada" },
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      });
      return { managerSid: managerSession.id, staffSid: staffSession.id, productId: product.id };
    },
  );

  return {
    tenantId: venue.tenantId,
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
    productId,
  };
}

/** One Hono app per tenant — `mountRecipeApi` binds ONE tenant via `cfg.tenantId`, so each venue's
 * routes need their own app (mirrors `purchasing-api.rls.test.ts`). */
function mountApp(tenantId: string): Hono {
  const app = new Hono();
  mountRecipeApi(app, { db: suite.admin, cfg: { tenantId } }, noopLog);
  return app;
}

/** JSON GET/POST/PATCH/PUT helper carrying `cookie`. */
async function send(
  app: Hono,
  method: "GET" | "POST" | "PATCH" | "PUT",
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

function ingredientBody(name: string): unknown {
  return { name, allergens: { gluten: { presence: "contains" } } };
}

async function createIngredient(app: Hono, cookie: string, name: string): Promise<string> {
  const res = await send(app, "POST", "/management-api/ingredients", cookie, ingredientBody(name));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("Recipe API over real Postgres (RLS end-to-end)", () => {
  it("isolates ingredients across tenants — a manager sees only their OWN tenant", async () => {
    // Differential cross-tenant isolation (spec §2). Two independent provisioned venues, each with its
    // own manager. Every list read below has NO explicit tenant filter — isolation is entirely
    // `withTenant` + `asAppUser` RLS. So were `asAppUser` ever dropped from `mountRecipeApi`'s `gated`
    // helper, each list would run on the `suite.admin` connection (a superuser that BYPASSES FORCE RLS)
    // and would leak the other tenant's rows, failing the `toEqual([])` / `not.toContain` assertions
    // here.
    //
    // GUARD-BY-DELETION (asAppUser), run on 2026-08-18 against postgres:18 via Testcontainers
    // (TESTCONTAINERS_RYUK_DISABLED=true): removed `await asAppUser(tx);` from `recipe-api.ts`'s `gated`
    // helper (the line above `authorizeManager`). This test then FAILED — tenant B's list was no longer
    // `[]` but contained tenant A's ingredient, exactly the RLS leak predicted. Restored the line and
    // the test passed again; `git diff recipe-api.ts` is clean.
    const a = await setupVenue();
    const b = await setupVenue();
    const appA = mountApp(a.tenantId);
    const appB = mountApp(b.tenantId);

    const ingA = await createIngredient(appA, a.managerCookie, "alioli");

    // Tenant B's manager lists ingredients: exactly EMPTY. B provisioned its own venue and seeded no
    // ingredient, so the only reason it could ever see A's row is a broken tenant scope. The read is
    // unfiltered and relies wholly on RLS (see the deletion receipt above).
    const listB = await send(appB, "GET", "/management-api/ingredients", b.managerCookie);
    expect(listB.status).toBe(200);
    expect(await listB.json()).toEqual([]);

    // Tenant A's manager lists ingredients: exactly A's own, and NOT B's.
    const listA = await send(appA, "GET", "/management-api/ingredients", a.managerCookie);
    expect(listA.status).toBe(200);
    const idsA = ((await listA.json()) as { id: string }[]).map((r) => r.id);
    expect(idsA).toEqual([ingA]);

    // The reverse direction: B creates its own ingredient; A never sees it and B sees only its own,
    // proving the isolation is symmetric and not an artefact of which tenant was provisioned first.
    const ingB = await createIngredient(appB, b.managerCookie, "pan");

    const listA2 = await send(appA, "GET", "/management-api/ingredients", a.managerCookie);
    const idsA2 = ((await listA2.json()) as { id: string }[]).map((r) => r.id);
    expect(idsA2).toContain(ingA);
    expect(idsA2).not.toContain(ingB);

    const listB2 = await send(appB, "GET", "/management-api/ingredients", b.managerCookie);
    const idsB2 = ((await listB2.json()) as { id: string }[]).map((r) => r.id);
    expect(idsB2).toContain(ingB);
    expect(idsB2).not.toContain(ingA);
  });

  it("refuses every recipe-authoring route to a staff-role session — 403 authorization.not_permitted", async () => {
    // Prove the `recipe.manage` gate BY DELETION. A `staff`-role management session holds no
    // `recipe.manage`, so `authorizeManager` (inside `gated`) throws `authorization.not_permitted`
    // before any op runs on all five routes, while the manager (who holds it) gets 200 on the same list.
    //
    // GUARD-BY-DELETION (authorizeManager), run on 2026-08-18 against postgres:18 via Testcontainers
    // (TESTCONTAINERS_RYUK_DISABLED=true): removed the
    //   `await authorizeManager(tx, { managementSessionId: sessionId, permission: RECIPE_WRITE_PERMISSION });`
    // call from `recipe-api.ts`'s `gated` helper. This test then FAILED at the FIRST staff assertion
    // (`expected 200 to be 403` on `GET /management-api/ingredients`) — with the one-line gate gone the
    // staff list served 200 instead of 403, so `toBe(403)` flipped green→red. (The other four routes
    // funnel through the SAME `gated` chokepoint, so they lose the gate identically; the run aborts at
    // the first failed assertion, so 200 on the list is the only status this deletion was OBSERVED to
    // produce.) Restored the line and the test passed again; `git diff recipe-api.ts` is clean afterwards.
    const { tenantId, managerCookie, staffCookie, productId } = await setupVenue();
    const app = mountApp(tenantId);

    // A real ingredient the manager owns, so the staff PATCH targets an id that DOES exist — the refusal
    // is the gate, not a not_found masking it. Also proves the manager (who holds `recipe.manage`) is
    // NOT refused: this create is a 201.
    const ingredientId = await createIngredient(app, managerCookie, "GATE-ing");

    // The manager gets 200 on the list — the positive control the gate must let through.
    const mgrList = await send(app, "GET", "/management-api/ingredients", managerCookie);
    expect(mgrList.status).toBe(200);

    const expect403 = async (res: Response) => {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    };

    await expect403(await send(app, "GET", "/management-api/ingredients", staffCookie));
    await expect403(
      await send(
        app,
        "POST",
        "/management-api/ingredients",
        staffCookie,
        ingredientBody("STAFF-1"),
      ),
    );
    await expect403(
      await send(app, "PATCH", `/management-api/ingredients/${ingredientId}`, staffCookie, {
        name: "hack",
      }),
    );
    await expect403(
      await send(app, "GET", `/management-api/products/${productId}/recipe`, staffCookie),
    );
    await expect403(
      await send(app, "PUT", `/management-api/products/${productId}/recipe`, staffCookie, {
        ingredientIds: [ingredientId],
      }),
    );
  });
});
