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
import { joinTable, openTab } from "./working-order.js";
import "./errors.js";

// PGlite, not real Postgres: `splitOffCheck`/`unjoinTable`'s own WRITE behaviour (check minting, item
// partition, quantity conservation, the FOR UPDATE lock ordering, fiscal filing multiplicity) is proven
// in the TS-5 verb + fiscal suites (Tasks 1-5); this suite proves only the HTTP surface — the session
// guard, the malformed-`:id`/`tableId` screens, the happy-path result shapes, and the STATUS mapping for
// the new `table.not_joined` code — the same shape `till-api.transfer.test.ts`/`till-api.move-merge.test.ts`
// prove for the sibling tab verbs, PGlite-adequate for the same reason (CLAUDE.md §4). Harness ported from
// `till-api.transfer.test.ts`.
let cfg: TillConfig;
let ana: { id: string };
// One product so a tab can open with a real line to split/carry across an un-join — `openTab` prices it
// and the `check_locales` trigger demands its `es-ES` description key match the location's `es-ES` locale.
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
 * `seriesId` is unused by the split/unjoin routes (they open no fiscal chain — the detached check files
 * only when paid); `locationId` is the seeded one `createTable` writes into. */
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
 *  use. The split/unjoin routes never call `clock`, but `TillApiDeps` requires it. */
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
      throw new Error("till-api.split-bill.test: anchor() is not used by these routes");
    },
    currentAnchor: () => null,
  };
}

function deps(db: Database): TillApiDeps {
  return {
    db,
    // `backend` is unused by these routes (they touch no fiscal path); `clock` IS wired real for shape
    // completeness though the routes never read it.
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

/** Seeds one open tab on table A carrying `aQty` café lines (line_no 1), plus a mounted app and a
 * logged-in cookie, for the split tests to drive `POST /api/tabs/:id/split` against. */
async function setupTabApp(
  aQty = "2",
): Promise<{ app: Hono; d: TillApiDeps; tabA: string; tableA: string; cookie: string }> {
  const app = new Hono();
  const d = deps(suite.db);
  mountTillApi(app, d, collect([]));
  const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
  const { tabA, tableA } = await withTenant(suite.db, d.cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const a = await createTable(tx, d.cfg, { label: `T-${randomUUID()}` });
    const tabAResult = await openTab(tx, d.cfg, {
      tableId: a.id,
      lines: [{ productId: cafeId, quantity: aQty }],
    });
    return { tabA: tabAResult.tabId, tableA: a.id };
  });
  return { app, d, tabA, tableA, cookie };
}

/** Seeds one open tab covering TWO tables (A opened it and carries a café line; B is joined to the same
 * tab), plus a mounted app + cookie, for the un-join tests to drive `POST /api/tabs/:id/unjoin` against.
 * `tableFree` is a third table that is NOT joined to anything, for the `table.not_joined` case. */
async function setupJoinedApp(): Promise<{
  app: Hono;
  d: TillApiDeps;
  tabA: string;
  tableB: string;
  tableFree: string;
  cookie: string;
}> {
  const app = new Hono();
  const d = deps(suite.db);
  mountTillApi(app, d, collect([]));
  const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
  const { tabA, tableB, tableFree } = await withTenant(suite.db, d.cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const a = await createTable(tx, d.cfg, { label: `T-${randomUUID()}` });
    const b = await createTable(tx, d.cfg, { label: `T-${randomUUID()}` });
    const free = await createTable(tx, d.cfg, { label: `T-${randomUUID()}` });
    const tabAResult = await openTab(tx, d.cfg, {
      tableId: a.id,
      lines: [{ productId: cafeId, quantity: "2" }],
    });
    await joinTable(tx, d.cfg, tabAResult.tabId, b.id);
    return { tabA: tabAResult.tabId, tableB: b.id, tableFree: free.id };
  });
  return { app, d, tabA, tableB, tableFree, cookie };
}

describe("POST /api/tabs/:id/split", () => {
  it("401s without a session (session.required)", async () => {
    const { app, tabA } = await setupTabApp();
    const res = await app.request(`/api/tabs/${tabA}/split`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transfers: [{ lineNo: 1 }] }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("rejects a malformed :id with 4xx tab.not_open, not an opaque 500", async () => {
    const { app, cookie } = await setupTabApp();
    const res = await app.request("/api/tabs/not-a-uuid/split", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ transfers: [{ lineNo: 1 }] }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.not_open", params: { tabId: "not-a-uuid" } },
    });
  });

  it("splits selected items off the tab into a NEW check (200 { checkId })", async () => {
    const { app, tabA, cookie } = await setupTabApp("3");
    const res = await app.request(`/api/tabs/${tabA}/split`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ transfers: [{ lineNo: 1, quantity: "1" }] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checkId: string };
    expect(body.checkId).toMatch(/^[0-9a-f-]{36}$/);

    // The minted check is a NEW open working order carrying the carved-off quantity, with NO table
    // pointing at it (a table-LESS payment unit); the origin tab keeps the remainder.
    const check = await suite.db.execute<{ status: string; quantity: string }>(sql`
      select wo.status, wol.quantity
      from working_orders wo join working_order_lines wol on wol.working_order_id = wo.id
      where wo.id = ${body.checkId}`);
    expect(check.rows).toEqual([{ status: "open", quantity: "1.000" }]);
    const anchored = await suite.db.execute<{ count: number }>(
      sql`select count(*)::int as count from dining_tables where tab_id = ${body.checkId}`,
    );
    expect(anchored.rows[0]!.count).toBe(0);
    const origin = await suite.db.execute<{ quantity: string }>(
      sql`select quantity from working_order_lines where working_order_id = ${tabA}`,
    );
    expect(origin.rows).toEqual([{ quantity: "2.000" }]); // 3 − 1 = 2 remain on the origin tab
  });

  it("409 tab.not_open when the tab is not open", async () => {
    const { app, cookie } = await setupTabApp();
    const res = await app.request(`/api/tabs/${randomUUID()}/split`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ transfers: [{ lineNo: 1 }] }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "tab.not_open" } });
  });

  it("400 management.request_invalid when transfers is absent, not an opaque 500", async () => {
    const { app, tabA, cookie } = await setupTabApp();
    // Body `{}` → `transfers` undefined → `splitOffCheck`'s `transfers.length` would throw a TypeError →
    // opaque 500 without the route's array-shape screen. Screened at the boundary as the generic
    // request-shape 400 naming the field (the `requireCapacity` sibling's discipline, till-api.ts:347).
    const res = await app.request(`/api/tabs/${tabA}/split`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "transfers" } },
    });
  });

  it("400 management.request_invalid when transfers is not an array", async () => {
    const { app, tabA, cookie } = await setupTabApp();
    const res = await app.request(`/api/tabs/${tabA}/split`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ transfers: 5 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "transfers" } },
    });
  });

  it("400 management.request_invalid for a literal JSON null body, not an opaque 500 (Copilot)", async () => {
    const { app, tabA, cookie } = await setupTabApp();
    // A literal JSON `null` body parses successfully (unlike malformed JSON, which throws a
    // SyntaxError c.req.json<T>() never catches for these routes): `c.req.json()` returns `null`
    // itself, so `body.transfers` would throw `Cannot read properties of null` before the
    // array-shape screen above ever ran, escaping to an opaque 500 (the class every `:id`/field
    // screen in this file exists to prevent). Screened by the same object/null/array guard the
    // `/api/tables/:id/placement` sibling uses (till-api.ts ~1547), naming "body".
    const res = await app.request(`/api/tabs/${tabA}/split`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "null",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });
  });
});

describe("POST /api/tabs/:id/unjoin", () => {
  it("401s without a session (session.required)", async () => {
    const { app, tabA, tableB } = await setupJoinedApp();
    const res = await app.request(`/api/tabs/${tabA}/unjoin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tableId: tableB }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("rejects a malformed :id with 4xx tab.not_open, not an opaque 500", async () => {
    const { app, tableB, cookie } = await setupJoinedApp();
    const res = await app.request("/api/tabs/not-a-uuid/unjoin", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tableId: tableB }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.not_open", params: { tabId: "not-a-uuid" } },
    });
  });

  it("rejects a malformed tableId with 4xx table.not_joined, not an opaque 500", async () => {
    const { app, tabA, cookie } = await setupJoinedApp();
    const res = await app.request(`/api/tabs/${tabA}/unjoin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tableId: "nope" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "table.not_joined", params: { tableId: "nope", tabId: tabA } },
    });
  });

  it("409 table.not_joined for a table not joined to the tab", async () => {
    const { app, tabA, tableFree, cookie } = await setupJoinedApp();
    const res = await app.request(`/api/tabs/${tabA}/unjoin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tableId: tableFree }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "table.not_joined", params: { tableId: tableFree, tabId: tabA } },
    });
  });

  it("un-joins WITH items into a new anchored tab (200 { tabId })", async () => {
    const { app, tabA, tableB, cookie } = await setupJoinedApp();
    const res = await app.request(`/api/tabs/${tabA}/unjoin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tableId: tableB, transfers: [{ lineNo: 1 }] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tabId: string };
    expect(body.tabId).toMatch(/^[0-9a-f-]{36}$/);

    // The detached table now anchors the NEW tab, which carries the moved line; the origin tab lost it.
    const anchored = await suite.db.execute<{ tab_id: string | null }>(
      sql`select tab_id from dining_tables where id = ${tableB}`,
    );
    expect(anchored.rows[0]!.tab_id).toBe(body.tabId);
    const moved = await suite.db.execute<{ quantity: string }>(
      sql`select quantity from working_order_lines where working_order_id = ${body.tabId}`,
    );
    expect(moved.rows).toEqual([{ quantity: "2.000" }]);
    const origin = await suite.db.execute<{ count: number }>(
      sql`select count(*)::int as count from working_order_lines where working_order_id = ${tabA}`,
    );
    expect(origin.rows[0]!.count).toBe(0);
  });

  it("un-joins WITHOUT items, freeing the table (200 {})", async () => {
    const { app, tabA, tableB, cookie } = await setupJoinedApp();
    const res = await app.request(`/api/tabs/${tabA}/unjoin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tableId: tableB }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});

    // The freed table points at no tab; the origin tab keeps its line.
    const freed = await suite.db.execute<{ tab_id: string | null }>(
      sql`select tab_id from dining_tables where id = ${tableB}`,
    );
    expect(freed.rows[0]!.tab_id).toBeNull();
    const origin = await suite.db.execute<{ quantity: string }>(
      sql`select quantity from working_order_lines where working_order_id = ${tabA}`,
    );
    expect(origin.rows).toEqual([{ quantity: "2.000" }]);
  });

  it("400 management.request_invalid when transfers is present but not an array", async () => {
    const { app, tabA, tableB, cookie } = await setupJoinedApp();
    // `transfers` is OPTIONAL here (absent = free-the-table, tested above), so the route screens only a
    // PRESENT non-array — which `unjoinTable`'s `transferLines` would otherwise reach as `.length` → 500.
    const res = await app.request(`/api/tabs/${tabA}/unjoin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tableId: tableB, transfers: 5 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "transfers" } },
    });
  });

  it("400 management.request_invalid for a literal JSON null body, not an opaque 500 (Copilot)", async () => {
    const { app, tabA, cookie } = await setupJoinedApp();
    // Same degenerate input as the /split case above: a literal JSON `null` body parses to `null`
    // itself (not a SyntaxError), so `body.tableId` would throw before `isUuid` ever ran, escaping to
    // an opaque 500. Screened by the object/null/array guard naming "body" — the SAME code the
    // `/api/tables/:id/placement` sibling answers for a non-object body, before the domain-specific
    // `table.not_joined` a well-formed-but-wrong `tableId` gets.
    const res = await app.request(`/api/tabs/${tabA}/unjoin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "null",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });
  });
});
