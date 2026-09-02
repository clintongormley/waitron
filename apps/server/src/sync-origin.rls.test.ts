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
import { recordIncidentOnce } from "@waitron/core";
import { createCatalogue, createProduct } from "@waitron/catalogue";
import { createIngredient } from "@waitron/recipes";
import { decimal, tenantId as brandTenantId } from "@waitron/shared";
import {
  DEFAULT_SETTLEMENT_LAG_MS,
  insertCapturedPayment,
  reconcilePayments,
  type ReversalFn,
  type SettlementReportSource,
} from "@waitron/payments";
import type { Logger } from "./logger.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { mountRecipeApi } from "./recipe-api.js";
import { mountManagementApi } from "./management-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";

// Real Postgres, not PGlite: capture runs under FORCE ROW LEVEL SECURITY as the non-superuser app
// role, which PGlite (superuser) bypasses — a false pass (CLAUDE.md §4). The full manifest runs once
// in the globalSetup (`applyMigrations` over the whole manifest, `sync` last) into the `manifest`
// template, so each clone this suite takes carries the sync_capture triggers over the enrolled
// commercial tables (catalogues, payments, …).
//
// origin.gate.test.ts already proves withTenant's 4th arg reaches sync_log.origin_id for a raw write;
// THIS suite guards that the real API call sites (fix B) actually pass cfg.nodeId / deps.nodeId, so the
// enrolled writes those paths perform capture a real origin rather than the all-zero sentinel.
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

/** A no-op logger: only the HTTP responses and the captured sync_log rows matter here. */
const noopLog: Logger = () => {};

// Producing node ids, and the all-zero uuid capture defaults origin to when app.node_id is unset.
const NODE_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NODE_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ZERO = "00000000-0000-0000-0000-000000000000";

// The proven reconcile fixture (mirrors reconcile.rls.test.ts): a payment settled well before
// NOW - DEFAULT_SETTLEMENT_LAG_MS on an ABANDONED working order with no sale is the auto-reversible
// orphan the sweep reverses and stamps (its `payments` UPDATE, which capture records).
const NOW = new Date("2026-07-25T12:00:00Z");
const OLD_SETTLED = new Date("2026-07-01T12:00:00Z");
const PERIOD = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };
const emptyReport: SettlementReportSource = { fetch: async () => [] };
const fakeReverse: ReversalFn = async () => {};

// mountCatalogueApi needs a real media directory on deps even though the catalogue POST never writes one.
let mediaDir: string;
beforeAll(async () => {
  mediaDir = await mkdtemp(join(tmpdir(), "waitron-sync-origin-rls-"));
});
afterAll(async () => {
  if (mediaDir !== undefined) await rm(mediaDir, { recursive: true, force: true });
});

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the per-suite counter the sibling RLS suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  tenantId: string;
  /** A live MANAGEMENT session cookie for a `manager` (holds `person.manage`). */
  managerCookie: string;
}

/** Stand up a fresh provisioned venue (as the owner), then — as the app role under the tenant — seed a
 * MANAGER and mint a live management session, returning the cookie the catalogue routes read. Each test
 * gets its OWN tenant, so its captured sync_log rows are that test's alone and order-independent. */
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

  const managerSid = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const managerSession = await startManagementSession(tx, {
      tenantId: venue.tenantId,
      personId: mgr.rows[0]!.id,
    });
    return managerSession.id;
  });

  return { tenantId: venue.tenantId, managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}` };
}

/** Mounts the catalogue API for one tenant under a given producing node id. */
function mountApp(tenantId: string, nodeId: string): Hono {
  const app = new Hono();
  mountCatalogueApi(
    app,
    { db: suite.admin, cfg: { tenantId, nodeId }, mediaDir, maxUploadBytes: 1024 * 1024 },
    noopLog,
  );
  return app;
}

/** POST a catalogue via the manager cookie, asserting 201, and return nothing — the sync_log row it
 * captured is read back separately. */
async function postCatalogue(app: Hono, cookie: string, name: string): Promise<void> {
  const res = await app.request("/management-api/catalogues", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
}

/** The origin_id captured for this tenant's most recent `catalogues` write (RLS-bypassing admin read). */
async function catalogueOrigin(tenantId: string): Promise<string | null> {
  const r = await suite.admin.execute<{ v: string | null }>(
    sql`select origin_id::text as v from sync_log
        where table_name = 'catalogues' and tenant_id = ${tenantId}
        order by seq desc limit 1`,
  );
  return r.rows[0]?.v ?? null;
}

/** The origin_id captured for this tenant's most recent `payments` UPDATE (the sweep's marker). */
async function paymentUpdateOrigin(tenantId: string): Promise<string | null> {
  const r = await suite.admin.execute<{ v: string | null }>(
    sql`select origin_id::text as v from sync_log
        where table_name = 'payments' and op = 'update' and tenant_id = ${tenantId}
        order by seq desc limit 1`,
  );
  return r.rows[0]?.v ?? null;
}

/** The origin_id captured for this tenant's most recent `products` UPDATE — a recipe write UPDATEs
 * `products` (the enrolled table) via applyRecipeDerivation, so op=update, not the seed's op=insert. */
async function productUpdateOrigin(tenantId: string): Promise<string | null> {
  const r = await suite.admin.execute<{ v: string | null }>(
    sql`select origin_id::text as v from sync_log
        where table_name = 'products' and op = 'update' and tenant_id = ${tenantId}
        order by seq desc limit 1`,
  );
  return r.rows[0]?.v ?? null;
}

/** Mounts the management API for one tenant under a given producing node id. `secureCookies:false`
 * (loopback, no TLS) and the loopback passkey RP config mirror `boot.ts`'s dev defaults — this suite
 * exercises only the identity-config WRITE routes (createPerson), not the passkey ceremonies. */
function mountMgmt(tenantId: string, nodeId: string): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.admin,
      cfg: { tenantId, nodeId },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost:5191",
    },
    noopLog,
  );
  return app;
}

/** The origin_id captured for this tenant's most recent `persons` write (RLS-bypassing admin read).
 * `setupVenue` seeds a manager persons row (op=insert, origin all-zero, no node id supplied) before the
 * API's createPerson runs, so `seq desc limit 1` reads the API write specifically — the same
 * most-recent-write convention `catalogueOrigin` uses. (The route is `/staff` but the enrolled table,
 * and thus the sync_log `table_name`, is `persons`.) */
async function personOrigin(tenantId: string): Promise<string | null> {
  const r = await suite.admin.execute<{ v: string | null }>(
    sql`select origin_id::text as v from sync_log
        where table_name = 'persons' and tenant_id = ${tenantId}
        order by seq desc limit 1`,
  );
  return r.rows[0]?.v ?? null;
}

/** POST a new person via the manager cookie, asserting 201 — the persons INSERT it captures is read
 * back separately via `personOrigin`. */
async function postPerson(app: Hono, cookie: string, displayName: string): Promise<void> {
  const res = await app.request("/management-api/staff", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ displayName, role: "staff", pin: "1234" }),
  });
  expect(res.status).toBe(201);
}

/** Mounts the recipe API for one tenant under a given producing node id. */
function mountRecipeApp(tenantId: string, nodeId: string): Hono {
  const app = new Hono();
  mountRecipeApi(app, { db: suite.admin, cfg: { tenantId, nodeId } }, noopLog);
  return app;
}

/** Seed a catalogue + product + ingredient on a tenant (as the app role) so a recipe PUT has something
 * to compose. The seed's own INSERTs capture op=insert (origin all-zero, no node id supplied) — the
 * test reads the recipe write's products op=update. */
async function seedProductAndIngredient(
  tenantId: string,
): Promise<{ productId: string; ingredientId: string }> {
  return withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Carta" });
    const product = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: null,
      descriptions: { es: "plato" },
      pricingUnit: "each",
      unitPrice: "3.00",
      vatClass: "general",
    });
    const ingredient = await createIngredient(tx, {
      name: "harina",
      allergens: { gluten: { presence: "contains" } },
    });
    return { productId: product.id, ingredientId: ingredient.id };
  });
}

/** PUT a product's recipe via the manager cookie, asserting 204 — the products UPDATE it drives is read
 * back separately. */
async function putRecipe(
  app: Hono,
  cookie: string,
  productId: string,
  ingredientIds: string[],
): Promise<void> {
  const res = await app.request(`/management-api/products/${productId}/recipe`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ ingredientIds }),
  });
  expect(res.status).toBe(204);
}

/** Seed the auto-reversible-orphan fixture on a fresh venue: an abandoned working order carrying one
 * captured payment with no sale. The insert itself captures a `payments` op=insert (origin all-zero,
 * no node id supplied) — the test reads op=update only. Returns the tenant id. */
async function seedOrphanPayment(): Promise<string> {
  const venue = await setupVenue();
  const till = await suite.admin.execute<{ id: string }>(
    sql`select id from tills where tenant_id = ${venue.tenantId} limit 1`,
  );
  const tillId = till.rows[0]!.id;
  const woId = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    const wo = await tx.execute<{ id: string }>(
      sql`insert into working_orders (tenant_id, till_id, order_number)
          values (${venue.tenantId}, ${tillId}, 1) returning id`,
    );
    return wo.rows[0]!.id;
  });
  // open -> abandoned is a valid transition; this is the orphan shape (abandoned, no sale_id).
  await suite.admin.execute(sql`update working_orders set status = 'abandoned' where id = ${woId}`);
  await withTenant(suite.admin, venue.tenantId, (tx) =>
    insertCapturedPayment(tx, {
      tenantId: brandTenantId(venue.tenantId),
      workingOrderId: woId,
      provider: "fake",
      paymentRef: `orphan-${venue.tenantId}`,
      externalRef: `ext-${venue.tenantId}`,
      amount: decimal("10.00"),
      settledAt: OLD_SETTLED,
    }),
  );
  return venue.tenantId;
}

describe("sync origin attribution through the real API call sites (fix B)", () => {
  it("a catalogue write captures sync_log.origin_id = cfg.nodeId (all-zero without the fix)", async () => {
    // Guard-by-deletion: with fix B, catalogue-api's `gated` passes { nodeId: cfg.nodeId } to
    // withTenant, so the enrolled catalogues INSERT captures NODE_C. Revert the fix (drop the 4th arg)
    // and app.node_id is unset → capture falls back to the all-zero origin → this expect fails.
    const venue = await setupVenue();
    const app = mountApp(venue.tenantId, NODE_C);
    await postCatalogue(app, venue.managerCookie, "Carta con origen");
    expect(await catalogueOrigin(venue.tenantId)).toBe(NODE_C);

    // Control (the two directions visibly differ, CLAUDE.md §1): the SAME path under the all-zero node
    // id captures the all-zero origin — so the captured origin tracks cfg.nodeId, not a constant.
    const zeroVenue = await setupVenue();
    const zeroApp = mountApp(zeroVenue.tenantId, ZERO);
    await postCatalogue(zeroApp, zeroVenue.managerCookie, "Carta sin origen");
    expect(await catalogueOrigin(zeroVenue.tenantId)).toBe(ZERO);
  });

  it("the reconcile sweep's payments UPDATE captures origin_id = deps.nodeId (all-zero without the fix)", async () => {
    // Guard-by-deletion: with fix B, reconcile.ts threads { nodeId: deps.nodeId } into its write
    // withTenant, so the auto-reversible orphan's markReconcileRemediated UPDATE captures NODE_D.
    // Revert the fix (drop the 4th arg) and app.node_id is unset → capture falls back to all-zero.
    const tenant = await seedOrphanPayment();
    const result = await reconcilePayments(
      {
        db: suite.admin,
        provider: "fake",
        report: emptyReport,
        reverse: fakeReverse,
        incidents: recordIncidentOnce,
        settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
        nodeId: NODE_D,
      },
      brandTenantId(tenant),
      PERIOD,
      NOW,
    );
    expect(result.remediated).toBe(1); // the orphan was reversed + its payments row stamped
    expect(await paymentUpdateOrigin(tenant)).toBe(NODE_D);

    // Control (the two directions visibly differ, CLAUDE.md §1): the SAME sweep under the all-zero
    // node id captures the all-zero origin — so the captured origin tracks deps.nodeId, not a constant.
    const zeroTenant = await seedOrphanPayment();
    const zeroResult = await reconcilePayments(
      {
        db: suite.admin,
        provider: "fake",
        report: emptyReport,
        reverse: fakeReverse,
        incidents: recordIncidentOnce,
        settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
        nodeId: ZERO,
      },
      brandTenantId(zeroTenant),
      PERIOD,
      NOW,
    );
    expect(zeroResult.remediated).toBe(1);
    expect(await paymentUpdateOrigin(zeroTenant)).toBe(ZERO);
  });

  it("a recipe write captures sync_log.origin_id = cfg.nodeId on the products UPDATE (all-zero without the fix)", async () => {
    // The recipe surface writes no enrolled table DIRECTLY (ingredients / recipe_lines carry no capture
    // trigger), but setProductRecipe → recomputeProductDerivations → applyRecipeDerivation +
    // applyDietDerivation UPDATE `products`, which IS enrolled (products_capture,
    // sync/drizzle/0000_sync_outbox.sql:196). Guard-by-deletion: with the fix, recipe-api's `gated`
    // threads { nodeId: cfg.nodeId } into withTenant, so that UPDATE captures NODE_C. Drop the 4th arg
    // and app.node_id is unset → capture falls back to all-zero.
    const venue = await setupVenue();
    const seed = await seedProductAndIngredient(venue.tenantId);
    const app = mountRecipeApp(venue.tenantId, NODE_C);
    await putRecipe(app, venue.managerCookie, seed.productId, [seed.ingredientId]);
    expect(await productUpdateOrigin(venue.tenantId)).toBe(NODE_C);

    // Control (the two directions visibly differ, CLAUDE.md §1): the SAME path under the all-zero node
    // id captures the all-zero origin — so the captured origin tracks cfg.nodeId, not a constant.
    const zeroVenue = await setupVenue();
    const zeroSeed = await seedProductAndIngredient(zeroVenue.tenantId);
    const zeroApp = mountRecipeApp(zeroVenue.tenantId, ZERO);
    await putRecipe(zeroApp, zeroVenue.managerCookie, zeroSeed.productId, [zeroSeed.ingredientId]);
    expect(await productUpdateOrigin(zeroVenue.tenantId)).toBe(ZERO);
  });

  it("a createPerson write captures sync_log.origin_id = cfg.nodeId (all-zero without the fix)", async () => {
    // Guard-by-deletion: with fix B, management-api threads { nodeId: cfg.nodeId } into the createPerson
    // withTenant, so the enrolled `persons` INSERT captures NODE_C. Revert (drop the 4th arg) and
    // app.node_id is unset → capture falls back to the all-zero origin → this expect fails. (The route
    // is `/management-api/staff`; the enrolled table it writes is `persons`.)
    const venue = await setupVenue();
    const app = mountMgmt(venue.tenantId, NODE_C);
    await postPerson(app, venue.managerCookie, "Ada");
    expect(await personOrigin(venue.tenantId)).toBe(NODE_C);

    // Control (the two directions visibly differ, CLAUDE.md §1): the SAME path under the all-zero node
    // id captures the all-zero origin — so the captured origin tracks cfg.nodeId, not a constant.
    const zeroVenue = await setupVenue();
    const zeroApp = mountMgmt(zeroVenue.tenantId, ZERO);
    await postPerson(zeroApp, zeroVenue.managerCookie, "Grace");
    expect(await personOrigin(zeroVenue.tenantId)).toBe(ZERO);
  });
});
