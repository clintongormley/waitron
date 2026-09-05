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

// PGlite, not real Postgres: the move/join/merge verbs are table-service LOGIC (re-point `dining_tables`
// rows, move lines, abandon a tab) whose privilege/RLS/concurrency behaviour is proven over real
// Postgres in `working-order.rls.test.ts`; here we prove only the HTTP surface — the session guard, the
// malformed-`:id` screen, and the verb's status mapping — which fires at the boundary before/around a
// single query, so a superuser PGlite backend is adequate (CLAUDE.md §4). Sessions/persons live in
// identity, so the schema is CORE_MIGRATIONS + IDENTITY_MIGRATIONS. Harness ported from `till-api.test.ts`.
let cfg: TillConfig;
let ana: { id: string };

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    const tenantId = await seedTenant(db);
    // A location → till the session cookie references: `loginWithPin` inserts a `sessions` row with a
    // FK to `tills`, so the till `cfg.tillId` names must exist. Seeded as the PGlite superuser (RLS
    // bypassed) — pure setup, as `@waitron/db`'s own seed helpers document.
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
  },
});

/** A collecting logger for asserting the structured lines the routes emit. */
function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

/** The till's config for the seeded tenant. `nodeId` is the seeded node the tab is written on;
 * `seriesId` is unused by the move/join/merge routes, so it carries a fresh uuid; `locationId` is the
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
 *  use. The move/join/merge routes never call `clock`, but `TillApiDeps` requires it, so it is stubbed
 *  real rather than left `{}`. */
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
      throw new Error("till-api.move-merge.test: anchor() is not used by these routes");
    },
    currentAnchor: () => null,
  };
}

function deps(db: Database): TillApiDeps {
  return {
    db,
    // `backend` is unused by the move/join/merge routes (they touch no fiscal path), so it is a never-
    // called stub; `clock` IS wired real for shape completeness though these routes never read it.
    backend: {} as FiscalBackend,
    clock: systemClock(),
    cfg,
    // FALSE so the Set-Cookie is issued over the non-TLS `app.request`.
    secureCookies: false,
    venueLocale: "es-ES",
    readMembership: () => Promise.resolve(null),
  };
}

/** Opens a real shift session for Ana on the app role — the same `withTenant` + `asAppUser` +
 * `loginWithPin` path the login route runs — and returns its id, so a test can hand a cookie that names
 * a genuine open row. */
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

describe("POST /api/tabs/:id/{move,join,merge}", () => {
  it("401s without a session (session.required)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const res = await app.request("/api/tabs/00000000-0000-4000-8000-000000000000/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toTableId: "00000000-0000-4000-8000-000000000001" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("4xx (not 500) on a malformed tab :id", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    // A non-UUID `:id` passed straight into `eq(workingOrders.id, id)` would `22P02` → an opaque 500;
    // `requireTabParam` refuses it as `tab.not_open` (409) BEFORE any query — the witness the screen is
    // present. Dropping the screen makes this a 500.
    const res = await app.request("/api/tabs/not-a-uuid/move", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ toTableId: "00000000-0000-4000-8000-000000000001" }),
    });
    expect(res.status).toBe(409); // tab.not_open, not an opaque 500
    expect(await res.json()).toMatchObject({
      error: { code: "tab.not_open", params: { tabId: "not-a-uuid" } },
    });
  });

  it("moves a tab to a free table (200) and re-points the target", async () => {
    const app = new Hono();
    const d = deps(suite.db);
    mountTillApi(app, d, collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    // Seed two tables + a tab in the session's tenant/location (d.cfg).
    const { src, dst, tabId } = await withTenant(suite.db, d.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const s = await createTable(tx, d.cfg, { label: "R-src" });
      const t = await createTable(tx, d.cfg, { label: "R-dst" });
      const tab = await openTab(tx, d.cfg, { tableId: s.id });
      return { src: s.id, dst: t.id, tabId: tab.tabId };
    });

    const res = await app.request(`/api/tabs/${tabId}/move`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ toTableId: dst }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    // The target now points at the moved tab, and the source has been freed (tab_id → NULL).
    const { rows } = await suite.db.execute<{ tab_id: string | null }>(
      sql`select tab_id from dining_tables where id = ${dst}`,
    );
    expect(rows[0]!.tab_id).toBe(tabId);
    const back = await suite.db.execute<{ tab_id: string | null }>(
      sql`select tab_id from dining_tables where id = ${src}`,
    );
    expect(back.rows[0]!.tab_id).toBeNull();
  });

  it("409 table.occupied when moving onto an occupied target", async () => {
    const app = new Hono();
    const d = deps(suite.db);
    mountTillApi(app, d, collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const { dst, tabId } = await withTenant(suite.db, d.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const s = await createTable(tx, d.cfg, { label: "O-src" });
      const t = await createTable(tx, d.cfg, { label: "O-dst" });
      const tab = await openTab(tx, d.cfg, { tableId: s.id });
      await openTab(tx, d.cfg, { tableId: t.id }); // occupy dst
      return { dst: t.id, tabId: tab.tabId };
    });
    const res = await app.request(`/api/tabs/${tabId}/move`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ toTableId: dst }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "table.occupied", params: { tableId: dst } },
    });
  });

  it("joins a free table onto a tab (200) — both tables now point at it, source retained", async () => {
    const app = new Hono();
    const d = deps(suite.db);
    mountTillApi(app, d, collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const { src, extra, tabId } = await withTenant(suite.db, d.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const s = await createTable(tx, d.cfg, { label: "J-src" });
      const e = await createTable(tx, d.cfg, { label: "J-extra" });
      const tab = await openTab(tx, d.cfg, { tableId: s.id });
      return { src: s.id, extra: e.id, tabId: tab.tabId };
    });

    const res = await app.request(`/api/tabs/${tabId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tableId: extra }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    // A join extends coverage — the newly-joined table AND the original both point at the one tab.
    const joined = await suite.db.execute<{ tab_id: string | null }>(
      sql`select tab_id from dining_tables where id = ${extra}`,
    );
    expect(joined.rows[0]!.tab_id).toBe(tabId);
    const source = await suite.db.execute<{ tab_id: string | null }>(
      sql`select tab_id from dining_tables where id = ${src}`,
    );
    expect(source.rows[0]!.tab_id).toBe(tabId);
  });

  it("merges one tab into another (200) — the source tab is abandoned and its table freed", async () => {
    const app = new Hono();
    const d = deps(suite.db);
    mountTillApi(app, d, collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const { fromTable, intoTabId, fromTabId } = await withTenant(
      suite.db,
      d.cfg.tenantId,
      async (tx) => {
        await asAppUser(tx);
        const into = await createTable(tx, d.cfg, { label: "M-into" });
        const from = await createTable(tx, d.cfg, { label: "M-from" });
        const intoTab = await openTab(tx, d.cfg, { tableId: into.id });
        const fromTab = await openTab(tx, d.cfg, { tableId: from.id });
        return { fromTable: from.id, intoTabId: intoTab.tabId, fromTabId: fromTab.tabId };
      },
    );

    const res = await app.request(`/api/tabs/${intoTabId}/merge`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ fromTabId, freeSourceTable: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    // The merged-away tab is abandoned (it files nothing — no double-file, §5) and, with
    // freeSourceTable, its table is turned over (tab_id → NULL).
    const gone = await suite.db.execute<{ status: string }>(
      sql`select status from working_orders where id = ${fromTabId}`,
    );
    expect(gone.rows[0]!.status).toBe("abandoned");
    const freed = await suite.db.execute<{ tab_id: string | null }>(
      sql`select tab_id from dining_tables where id = ${fromTable}`,
    );
    expect(freed.rows[0]!.tab_id).toBeNull();
  });

  it("400 tab.merge_self when merging a tab into itself", async () => {
    const app = new Hono();
    const d = deps(suite.db);
    mountTillApi(app, d, collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const tabId = await withTenant(suite.db, d.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const s = await createTable(tx, d.cfg, { label: "MS-src" });
      const tab = await openTab(tx, d.cfg, { tableId: s.id });
      return tab.tabId;
    });
    const res = await app.request(`/api/tabs/${tabId}/merge`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ fromTabId: tabId, freeSourceTable: true }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.merge_self", params: { tabId } },
    });
  });

  // The body-id screens (requirement #4): a malformed target/source id is refused at the boundary with
  // the route's fail-closed domain code — never the `22P02` → opaque 500 the raw value would raise.
  it("404 table.not_found on move with a malformed toTableId (never a 500)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const res = await app.request("/api/tabs/00000000-0000-4000-8000-000000000000/move", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ toTableId: "not-a-uuid" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "table.not_found", params: { tableId: "not-a-uuid" } },
    });
  });

  it("404 table.not_found on join with a malformed tableId (never a 500)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const res = await app.request("/api/tabs/00000000-0000-4000-8000-000000000000/join", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tableId: "not-a-uuid" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "table.not_found", params: { tableId: "not-a-uuid" } },
    });
  });

  it("409 tab.not_open on merge with a malformed fromTabId (never a 500)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const res = await app.request("/api/tabs/00000000-0000-4000-8000-000000000000/merge", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ fromTabId: "not-a-uuid", freeSourceTable: false }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.not_open", params: { tabId: "not-a-uuid" } },
    });
  });
});
