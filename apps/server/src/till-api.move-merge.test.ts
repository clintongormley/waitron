import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { floorZones, locations, tills, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { departments } from "@waitron/venue-service";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { Logger, LogLevel } from "./logger.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { openTab } from "./working-order.js";
import "./errors.js";

// The HTTP surface of the move/join/merge routes: the session guard, the malformed-id screens and
// the verbs' status mapping. The verbs themselves are pinned in `move-merge.test.ts`.
let cfg: TillConfig;
let ana: { id: string };

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    // `loginWithPin` inserts a `sessions` row with a FK to `tills`, so the till `cfg.tillId` names
    // must exist.
    const [loc] = await db
      .insert(locations)
      .values({ name: "Counter", invoiceLocales: ["es-ES"], operationDescription: "Retail" })
      .returning({ id: locations.id });
    const [till] = await db
      .insert(tills)
      .values({ locationId: loc!.id, name: "Till 1" })
      .returning({ id: tills.id });
    // `openTab` writes `working_orders.node_id`, whose FK requires a real row.
    const nodeId = await seedNode(db, brandLocationId(loc!.id));
    const [person] = await db
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    ana = { id: person!.id };
    cfg = makeCfg(till!.id, loc!.id, nodeId);
  },
});

function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

/** `seriesId` is unused by the move/join/merge routes, so it carries a fresh uuid. */
function makeCfg(tillId: string, locationId: string, nodeId: string): TillConfig {
  return {
    tillId: brandTillId(tillId),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

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
    // Unused: the move/join/merge routes touch no fiscal path.
    backend: {} as FiscalBackend,
    clock: systemClock(),
    cfg,
    // FALSE so the Set-Cookie is issued over the non-TLS `app.request`.
    secureCookies: false,
    venueLocale: "es-ES",
  };
}

async function openSession(db: Database): Promise<string> {
  const session = await withTransaction(db, async (tx) => {
    return loginWithPin(tx, {
      tillId: cfg.tillId,
      personId: ana.id,
      pin: "5555",
    });
  });
  return session.token;
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
    // `requireTabParam` refuses a non-UUID `:id` as `tab.not_open` (409) before any query.
    const res = await app.request("/api/tabs/not-a-uuid/move", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ toTableId: "00000000-0000-4000-8000-000000000001" }),
    });
    expect(res.status).toBe(409); // tab.not_open
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
    const { src, dst, tabId } = await withTransaction(suite.db, async (tx) => {
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
    const { dst, tabId } = await withTransaction(suite.db, async (tx) => {
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
    const { src, extra, tabId } = await withTransaction(suite.db, async (tx) => {
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
    const { fromTable, intoTabId, fromTabId } = await withTransaction(suite.db, async (tx) => {
      const into = await createTable(tx, d.cfg, { label: "M-into" });
      const from = await createTable(tx, d.cfg, { label: "M-from" });
      const intoTab = await openTab(tx, d.cfg, { tableId: into.id });
      const fromTab = await openTab(tx, d.cfg, { tableId: from.id });
      return { fromTable: from.id, intoTabId: intoTab.tabId, fromTabId: fromTab.tabId };
    });

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

  it("refuses to merge a contextual tab with a context-less tab", async () => {
    const app = new Hono();
    const d = deps(suite.db);
    mountTillApi(app, d, collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const { intoTabId, fromTabId } = await withTransaction(suite.db, async (tx) => {
      const into = await createTable(tx, d.cfg, { label: "MC-into" });
      const from = await createTable(tx, d.cfg, { label: "MC-from" });
      const intoTab = await openTab(tx, d.cfg, { tableId: into.id });
      const fromTab = await openTab(tx, d.cfg, { tableId: from.id });
      const [department] = await tx
        .insert(departments)
        .values({
          locationId: d.cfg.locationId,
          name: "Restaurant",
          tradingName: "Restaurant",
          defaultServiceMode: "table_tab",
        })
        .returning({ id: departments.id });
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: d.cfg.locationId, name: "Dining room" })
        .returning({ id: floorZones.id });
      await tx.execute(sql`
          insert into order_service_contexts
            (working_order_id, location_id, zone_id, department_id, service_mode)
          values (
            ${intoTab.tabId}, ${d.cfg.locationId}, ${zone!.id},
            ${department!.id}, 'table_tab'
          )`);
      return { intoTabId: intoTab.tabId, fromTabId: fromTab.tabId };
    });

    const res = await app.request(`/api/tabs/${intoTabId}/merge`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ fromTabId, freeSourceTable: true }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "service_zone.mode_incompatible" } });
  });

  it("400 tab.merge_self when merging a tab into itself", async () => {
    const app = new Hono();
    const d = deps(suite.db);
    mountTillApi(app, d, collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const tabId = await withTransaction(suite.db, async (tx) => {
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

  // A malformed target/source id in the body is refused at the boundary with the route's
  // fail-closed domain code.
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
