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
import {
  decimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import {
  DEFAULT_SETTLEMENT_LAG_MS,
  insertCapturedPayment,
  reconcilePayments,
  type ReversalFn,
  type SettlementReportSource,
} from "@waitron/payments";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { Logger } from "./logger.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { ALL_MODULES } from "./modules.js";
import { mountRecipeApi } from "./recipe-api.js";
import { mountManagementApi } from "./management-api.js";
import { mountTillApi } from "./till-api.js";
import { mountMeApi } from "./me-api.js";
import type { TillConfig } from "./till-config.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";

// Real Postgres, not PGlite: capture runs as the non-superuser app role, whose INSERT on sync_log a
// PGlite superuser connection would hold regardless — a false pass (CLAUDE.md §4). The full manifest runs once
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

// The proven reconcile fixture (mirrors @waitron/payments' reconcile.test.ts orphan-remediation
// block): a payment settled well before
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
  mediaDir = await mkdtemp(join(tmpdir(), "waitron-sync-origin-"));
});
afterAll(async () => {
  if (mediaDir !== undefined) await rm(mediaDir, { recursive: true, force: true });
});

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the per-suite counter the sibling real-Postgres suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  tenantId: string;
  /** A live MANAGEMENT session cookie for a `manager` (holds `person.manage`). */
  managerCookie: string;
  /** The seeded manager's `persons.id` — the login the till locale route logs in as (PIN "1234"), and
   * the row both locale routes UPDATE (so their captured `persons` op=update is this person's). */
  managerId: string;
  /** The provisioned venue's till / series / location ids, for building a `TillConfig` (the node id is
   * overridden per test with NODE_C / ZERO — the locale route sets no fiscal chain). */
  tillId: string;
  seriesId: string;
  locationId: string;
}

/** Stand up a fresh provisioned venue (as the owner), then — as the app role under the tenant — seed a
 * MANAGER and mint a live management session, returning the cookie the catalogue routes read. Each test
 * gets its OWN tenant, so its captured sync_log rows are that test's alone and order-independent. */
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
        },
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );

  const { managerSid, managerId } = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${venue.tenantId}, 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const managerSession = await startManagementSession(tx, {
      tenantId: venue.tenantId,
      personId: mgr.rows[0]!.id,
    });
    return { managerSid: managerSession.id, managerId: mgr.rows[0]!.id };
  });

  return {
    tenantId: venue.tenantId,
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    managerId,
    tillId: venue.tillId,
    // planVenue emits the standard series first, then the rectificative one.
    seriesId: venue.seriesIds[0]!,
    locationId: venue.locationId,
  };
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

/** The origin_id captured for this tenant's most recent `catalogues` write (fixture owner read). */
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

/** The origin_id captured for this tenant's most recent `persons` write (fixture owner read).
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

/** The origin_id captured for this tenant's most recent `persons` op=UPDATE — the row a locale write
 * mutates (`setPersonLocale` does `update persons set locale`). Filtered to op='update' so it reads the
 * locale route's write specifically, past `setupVenue`'s seed INSERT (op=insert, origin all-zero). */
async function personUpdateOrigin(tenantId: string): Promise<string | null> {
  const r = await suite.admin.execute<{ v: string | null }>(
    sql`select origin_id::text as v from sync_log
        where table_name = 'persons' and op = 'update' and tenant_id = ${tenantId}
        order by seq desc limit 1`,
  );
  return r.rows[0]?.v ?? null;
}

// The till locale route mounts the full TillApiDeps, but the locale write touches neither the fiscal
// backend nor the clock (only `POST /api/sales|pay` do), so these stubs are never invoked — a cast is
// enough, and any accidental use throws rather than silently passing.
const stubBackend = {} as unknown as FiscalBackend;
const stubClock = {} as unknown as TrustedClock;

/** Mounts the till API for one venue under a given producing node id. The fiscal ids come from the
 * provisioned venue (real `tillId`/`seriesId`/`locationId`, so login's `sessions` FK to `tills`
 * resolves), and `nodeId` is the id under test — the locale route is the only route this test drives,
 * and it sets no fiscal chain, so the node id need not match the venue's own. */
function mountTill(venue: Venue, nodeId: string): Hono {
  const app = new Hono();
  const cfg: TillConfig = {
    tenantId: brandTenantId(venue.tenantId),
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(venue.seriesId),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  mountTillApi(
    app,
    {
      db: suite.admin,
      backend: stubBackend,
      clock: stubClock,
      cfg,
      secureCookies: false,
      venueLocale: LOCALE,
    },
    noopLog,
  );
  return app;
}

/** Log the seeded manager (PIN "1234") in through the till's `POST /api/session` and return the
 * session cookie the operator-scoped locale route reads. */
async function tillLogin(app: Hono, personId: string): Promise<string> {
  const res = await app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId, pin: "1234" }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!;
}

/** Mounts the "me" (staff self-service) API for one tenant under a given producing node id. */
function mountMe(tenantId: string, nodeId: string): Hono {
  const app = new Hono();
  mountMeApi(app, { db: suite.admin, cfg: { tenantId, nodeId }, venueLocale: LOCALE }, noopLog);
  return app;
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
    const cat = await createCatalogue(tx, brandTenantId(tenantId), { name: "Carta" });
    const product = await createProduct(tx, brandTenantId(tenantId), {
      catalogueId: cat.id,
      categoryId: null,
      descriptions: { es: "plato" },
      pricingUnit: "each",
      unitPrice: "3.00",
      vatClass: "general",
    });
    const ingredient = await createIngredient(tx, brandTenantId(tenantId), {
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

  it("the till locale write (PUT /api/session/locale) captures persons UPDATE origin = cfg.nodeId (all-zero without the fix)", async () => {
    // Finding 1: `setPersonLocale` does a `persons` UPDATE, which the sync_capture trigger records —
    // but till-api's locale route ran a BARE 3-arg withTenant, so app.node_id was unset and capture
    // fell back to the all-zero origin (a write that never replicates and never prunes). Guard-by-
    // deletion: with the fix the route threads { nodeId: cfg.nodeId }, so the UPDATE captures NODE_C;
    // drop the 4th arg and app.node_id is unset → all-zero → this expect fails.
    const venue = await setupVenue();
    const app = mountTill(venue, NODE_C);
    const cookie = await tillLogin(app, venue.managerId);
    const res = await app.request("/api/session/locale", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ locale: LOCALE }),
    });
    expect(res.status).toBe(204);
    expect(await personUpdateOrigin(venue.tenantId)).toBe(NODE_C);

    // Control (the two directions visibly differ, CLAUDE.md §1): the SAME path under the all-zero node
    // id captures the all-zero origin — so the captured origin tracks cfg.nodeId, not a constant.
    const zeroVenue = await setupVenue();
    const zeroApp = mountTill(zeroVenue, ZERO);
    const zeroCookie = await tillLogin(zeroApp, zeroVenue.managerId);
    const zeroRes = await zeroApp.request("/api/session/locale", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: zeroCookie },
      body: JSON.stringify({ locale: LOCALE }),
    });
    expect(zeroRes.status).toBe(204);
    expect(await personUpdateOrigin(zeroVenue.tenantId)).toBe(ZERO);
  });

  it("the me-api locale write (PUT /management-api/session/me/locale) captures persons UPDATE origin = deps.nodeId (all-zero without the fix)", async () => {
    // Finding 1, second writer: me-api's `PUT /management-api/session/me/locale` also calls
    // `setPersonLocale` (a `persons` UPDATE), via the shared `asStaff` helper — whose `withTenant` had
    // NO nodeId (MeApiDeps.cfg was `{ tenantId }`), so the enrolled write captured the all-zero origin.
    // Guard-by-deletion: with the fix `asStaff` threads { nodeId: deps.cfg.nodeId }, so the UPDATE
    // captures NODE_C; drop it (or the cfg field) and capture falls back to all-zero → this fails.
    const venue = await setupVenue();
    const app = mountMe(venue.tenantId, NODE_C);
    const res = await app.request("/management-api/session/me/locale", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: venue.managerCookie },
      body: JSON.stringify({ locale: LOCALE }),
    });
    expect(res.status).toBe(204);
    expect(await personUpdateOrigin(venue.tenantId)).toBe(NODE_C);

    // Control (the two directions visibly differ, CLAUDE.md §1): the SAME path under the all-zero node
    // id captures the all-zero origin — so the captured origin tracks deps.nodeId, not a constant.
    const zeroVenue = await setupVenue();
    const zeroApp = mountMe(zeroVenue.tenantId, ZERO);
    const zeroRes = await zeroApp.request("/management-api/session/me/locale", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: zeroVenue.managerCookie },
      body: JSON.stringify({ locale: LOCALE }),
    });
    expect(zeroRes.status).toBe(204);
    expect(await personUpdateOrigin(zeroVenue.tenantId)).toBe(ZERO);
  });
});
