import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, loginWithPin } from "@waitron/identity";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { TenantId } from "@waitron/shared";
import type { Logger, LogLevel } from "./logger.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { openTab } from "./working-order.js";
import "./errors.js";

// PGlite, not real Postgres: `transferLines`' own WRITE behaviour (split arithmetic, guards, price-lock,
// the FOR UPDATE lock ordering) is proven in `transfer-lines.test.ts`/`transfer-lines.rls.test.ts`; this
// suite proves only the HTTP surface — the session guard, the malformed-`:id`/`toTabId` screens, and the
// STATUS mapping for the two new transfer codes — the same shape `till-api.move-merge.test.ts` proves for
// move/join/merge, PGlite-adequate for the same reason (CLAUDE.md §4). Harness ported from
// `till-api.move-merge.test.ts`, itself ported from `till-api.test.ts`.
let cfg: TillConfig;
let ana: { id: string };
// One product so a tab can open with a real line to transfer — `openTab` prices it and the
// `check_locales` trigger demands its `es-ES` description key match the location's `es-ES` locale.
let cafeId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    const tenantId = await seedTenant(db);
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Counter', array['es-ES'], 'Retail') returning id`);
    const till = await db.execute<{ id: string }>(sql`
      insert into tills (tenant_id, location_id, name)
      values (${tenantId}, ${loc.rows[0]!.id}, 'Till 1') returning id`);
    // A node the tab lives on: `openTab` writes `working_orders.node_id` (its composite FK
    // `(tenant_id, node_id) → nodes(tenant_id, id)` requires a real row). `cfg.nodeId` names THIS row.
    const nodeId = await seedNode(db, tenantId, brandLocationId(loc.rows[0]!.id));
    // Ana's PIN is "5555"; `openSession` logs her in over the app role, exactly as the login route does.
    const person = await db.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'Ana', ${hashPin("5555")}, 'staff') returning id`);
    ana = { id: person.rows[0]!.id };
    cfg = makeCfg(tenantId, till.rows[0]!.id, loc.rows[0]!.id, nodeId);
    // One product in a catalogue assigned to the counter location, seeded on the APP role via the
    // catalogue helpers — the same `withTenant` + `asAppUser` path `openTab` prices it through.
    const product = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const cat = await createCatalogue(tx, { name: "Carta" });
      const bebidas = await createCategory(tx, { name: "Bebidas" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: bebidas.id,
        descriptions: { es: "Café" },
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, loc.rows[0]!.id, cat.id);
      return p;
    });
    cafeId = product.id;
  },
});

/** A collecting logger for asserting the structured lines the routes emit. */
function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

/** The till's config for the seeded tenant. `nodeId` is the seeded node the tab is written on;
 * `seriesId` is unused by the transfer route (no fiscal write on the tab path); `locationId` is the
 * seeded one `createTable` writes into. */
function makeCfg(
  tenantId: TenantId,
  tillId: string,
  locationId: string,
  nodeId: string,
): TillConfig {
  return {
    tenantId,
    tillId: brandTillId(tillId),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

/** The system wall clock, reported confident/anchored — the identical stub shape the sibling suites
 *  use. The transfer route never calls `clock`, but `TillApiDeps` requires it. */
function systemClock(): TrustedClock {
  return {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("till-api.transfer.test: anchor() is not used by this route");
    },
    currentAnchor: () => null,
  };
}

function deps(db: Database): TillApiDeps {
  return {
    db,
    // `backend` is unused by the transfer route (it touches no fiscal path); `clock` IS wired real for
    // shape completeness though the route never reads it.
    backend: {} as FiscalBackend,
    clock: systemClock(),
    cfg,
    secureCookies: false,
    venueLocale: "es-ES",
  };
}

/** Opens a real shift session for Ana on the app role — the same `withTenant` + `asAppUser` +
 * `loginWithPin` path the login route runs — and returns its id. */
async function openSession(db: Database): Promise<string> {
  const session = await withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return loginWithPin(tx, {
      tenantId: cfg.tenantId,
      tillId: cfg.tillId,
      personId: ana.id,
      pin: "5555",
    });
  });
  return session.id;
}

/** Seeds two open tabs (tab A carries one café line at quantity `aQty`, tab B is empty unless
 * `bLines` is given) plus a mounted app and a logged-in cookie, for the tests below to drive
 * `POST /api/tabs/:id/transfer` against. */
async function setupTabsApp(
  aQty = "2",
): Promise<{ app: Hono; d: TillApiDeps; tabA: string; tabB: string; cookie: string }> {
  const app = new Hono();
  const d = deps(suite.db);
  mountTillApi(app, d, collect([]));
  const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
  const { tabA, tabB } = await withTenant(suite.db, d.cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const a = await createTable(tx, d.cfg, { label: `T-${randomUUID()}` });
    const b = await createTable(tx, d.cfg, { label: `T-${randomUUID()}` });
    const tabAResult = await openTab(tx, d.cfg, {
      tableId: a.id,
      lines: [{ productId: cafeId, quantity: aQty }],
    });
    const tabBResult = await openTab(tx, d.cfg, { tableId: b.id });
    return { tabA: tabAResult.tabId, tabB: tabBResult.tabId };
  });
  return { app, d, tabA, tabB, cookie };
}

describe("POST /api/tabs/:id/transfer", () => {
  it("401s without a session (session.required)", async () => {
    const { app, tabA, tabB } = await setupTabsApp();
    const res = await app.request(`/api/tabs/${tabA}/transfer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toTabId: tabB, transfers: [{ lineNo: 1 }] }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("rejects a malformed :id with 4xx tab.not_open, not an opaque 500", async () => {
    const { app, tabB, cookie } = await setupTabsApp();
    const res = await app.request("/api/tabs/not-a-uuid/transfer", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ toTabId: tabB, transfers: [{ lineNo: 1 }] }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.not_open", params: { tabId: "not-a-uuid" } },
    });
  });

  it("rejects a malformed toTabId with 4xx tab.not_open, not an opaque 500", async () => {
    const { app, tabA, cookie } = await setupTabsApp();
    const res = await app.request(`/api/tabs/${tabA}/transfer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ toTabId: "nope", transfers: [{ lineNo: 1 }] }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.not_open", params: { tabId: "nope" } },
    });
  });

  it("moves a whole line (200) and re-points it onto the destination tab", async () => {
    const { app, tabA, tabB, cookie } = await setupTabsApp();
    const res = await app.request(`/api/tabs/${tabA}/transfer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ toTabId: tabB, transfers: [{ lineNo: 1 }] }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");

    // Owner read: source lost the line entirely, destination gained it with the locked price kept.
    const a = await suite.db.execute<{ count: number }>(
      sql`select count(*)::int as count from working_order_lines where working_order_id = ${tabA}`,
    );
    expect(a.rows[0]!.count).toBe(0);
    const b = await suite.db.execute<{
      line_no: number;
      product_id: string;
      quantity: string;
      unit_price_gross: string;
    }>(
      sql`select line_no, product_id, quantity, unit_price_gross from working_order_lines where working_order_id = ${tabB}`,
    );
    expect(b.rows).toEqual([
      { line_no: 1, product_id: cafeId, quantity: "2.000", unit_price_gross: "1.50" },
    ]);
  });

  it("splits part of a line (200), leaving a reduced source line and a new destination line", async () => {
    const { app, tabA, tabB, cookie } = await setupTabsApp("3");
    const res = await app.request(`/api/tabs/${tabA}/transfer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ toTabId: tabB, transfers: [{ lineNo: 1, quantity: "1" }] }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");

    const a = await suite.db.execute<{ quantity: string }>(
      sql`select quantity from working_order_lines where working_order_id = ${tabA}`,
    );
    expect(a.rows).toEqual([{ quantity: "2.000" }]); // 3 − 1 = 2 remain on the source
    const b = await suite.db.execute<{ quantity: string; unit_price_gross: string }>(
      sql`select quantity, unit_price_gross from working_order_lines where working_order_id = ${tabB}`,
    );
    expect(b.rows).toEqual([{ quantity: "1.000", unit_price_gross: "1.50" }]); // same locked price
  });

  it("400 tab.transfer_self when transferring a tab to itself", async () => {
    const { app, tabA, cookie } = await setupTabsApp();
    const res = await app.request(`/api/tabs/${tabA}/transfer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ toTabId: tabA, transfers: [{ lineNo: 1 }] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.transfer_self", params: { tabId: tabA } },
    });
  });

  it("400 tab.transfer_quantity_invalid for an over-quantity transfer", async () => {
    const { app, tabA, tabB, cookie } = await setupTabsApp("2");
    const res = await app.request(`/api/tabs/${tabA}/transfer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ toTabId: tabB, transfers: [{ lineNo: 1, quantity: "5" }] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: {
        code: "tab.transfer_quantity_invalid",
        params: { tabId: tabA, lineNo: 1, quantity: "5" },
      },
    });
  });

  it("404 tab.line_not_found for a line_no not on the source tab", async () => {
    const { app, tabA, tabB, cookie } = await setupTabsApp();
    const res = await app.request(`/api/tabs/${tabA}/transfer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ toTabId: tabB, transfers: [{ lineNo: 99 }] }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.line_not_found", params: { tabId: tabA, lineNo: 99 } },
    });
  });

  it("400 tab.transfer_duplicate_line when the batch names a line_no twice", async () => {
    const { app, tabA, tabB, cookie } = await setupTabsApp("3");
    const res = await app.request(`/api/tabs/${tabA}/transfer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        toTabId: tabB,
        transfers: [
          { lineNo: 1, quantity: "1" },
          { lineNo: 1, quantity: "1" },
        ],
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.transfer_duplicate_line", params: { tabId: tabA, lineNo: 1 } },
    });
  });
});
