import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { locations, tills, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
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
import type { Logger, LogLevel } from "./logger.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { joinTable, openTab } from "./working-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

// The HTTP surface of the split and un-join routes: the session guard, the malformed-`:id`/`tableId`
// screens, the happy-path result shapes and the STATUS mapping for `table.not_joined`. The verbs'
// write behaviour is pinned in `split-bill.test.ts` and `split-bill.fiscal.test.ts`.
let cfg: TillConfig;
let ana: { id: string };
// One product so a tab can open with a real line to split/carry across an un-join — `openTab` prices it
// and the `check_locales` trigger demands its `es-ES` description key match the location's `es-ES` locale.
let cafeId: string;
// The café's offer, and the table_tab zone offering it, where every table here sits.
let cafeMenuItemId: string;
let tablesZoneId: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    await seedLegacySellingUnits(db);
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
    const product = await withTransaction(db, async (tx) => {
      const cat = await createCatalogue(tx, { name: "Carta" });
      const bebidas = await createCategory(tx, { name: { en: "Bebidas" } });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: bebidas.id,
        name: "Café",
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, loc!.id, cat.id);
      return p;
    });
    cafeId = product.id;
    const offers = await withTransaction(db, (tx) => offerProducts(tx, cfg, { zone: "tables" }));
    cafeMenuItemId = offers.offerFor(cafeId);
    tablesZoneId = offers.zoneId;
  },
});

function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

/** `seriesId` is unused by the split/unjoin routes: the detached check files only when paid. */
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
      throw new Error("till-api.split-bill.test: anchor() is not used by these routes");
    },
    currentAnchor: () => null,
  };
}

function deps(db: Database): TillApiDeps {
  return {
    db,
    // Unused: these routes touch no fiscal path.
    backend: {} as FiscalBackend,
    clock: systemClock(),
    cfg,
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

/** Seeds one open tab on table A carrying `aQty` café lines (line_no 1), plus a mounted app and a
 * logged-in cookie, for the split tests to drive `POST /api/tabs/:id/split` against. */
async function setupTabApp(
  aQty = "2",
): Promise<{ app: Hono; d: TillApiDeps; tabA: string; tableA: string; cookie: string }> {
  const app = new Hono();
  const d = deps(suite.db);
  mountTillApi(app, d, collect([]));
  const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
  const { tabA, tableA } = await withTransaction(suite.db, async (tx) => {
    const a = await createTable(tx, d.cfg, { label: `T-${randomUUID()}`, zoneId: tablesZoneId });
    const tabAResult = await openTab(tx, d.cfg, {
      tableId: a.id,
      lines: [{ menuItemId: cafeMenuItemId, quantity: aQty }],
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
  const { tabA, tableB, tableFree } = await withTransaction(suite.db, async (tx) => {
    const a = await createTable(tx, d.cfg, { label: `T-${randomUUID()}`, zoneId: tablesZoneId });
    const b = await createTable(tx, d.cfg, { label: `T-${randomUUID()}`, zoneId: tablesZoneId });
    const free = await createTable(tx, d.cfg, { label: `T-${randomUUID()}`, zoneId: tablesZoneId });
    const tabAResult = await openTab(tx, d.cfg, {
      tableId: a.id,
      lines: [{ menuItemId: cafeMenuItemId, quantity: "2" }],
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
    // `working_order_lines.quantity` is a count of whole THOUSANDTHS, read as text so the assertion
    // is about the stored number and not about which engine renders an eight-byte integer as what.
    const check = await suite.db.execute<{ status: string; quantity: string }>(sql`
      select wo.status, cast(wol.quantity as text) as quantity
      from working_orders wo join working_order_lines wol on wol.working_order_id = wo.id
      where wo.id = ${body.checkId}`);
    expect(check.rows).toEqual([{ status: "open", quantity: "1000" }]);
    const anchored = await suite.db.execute<{ count: number }>(
      sql`select cast(count(*) as int) as count from dining_tables where tab_id = ${body.checkId}`,
    );
    expect(anchored.rows[0]!.count).toBe(0);
    const origin = await suite.db.execute<{ quantity: string }>(
      sql`select cast(quantity as text) as quantity from working_order_lines where working_order_id = ${tabA}`,
    );
    // 3 − 1 = 2 units remain on the origin tab, stored as 2000 thousandths
    expect(origin.rows).toEqual([{ quantity: "2000" }]);
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
    // Body `{}` → `transfers` undefined, which `splitOffCheck` would reach as `transfers.length`.
    // Refused at the boundary as the generic request-shape 400 naming the field.
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
    // A literal JSON `null` body parses successfully, so `body.transfers` would throw before the
    // array-shape screen ran. Refused by the object/null/array guard, naming "body".
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

  it("400 management.request_invalid for an empty (unparseable) body, not an opaque 500", async () => {
    const { app, tabA, cookie } = await setupTabApp();
    // Unlike a literal `null` body, an empty body is invalid JSON; the route sends it to the SAME
    // body-shape refusal (field "body").
    const res = await app.request(`/api/tabs/${tabA}/split`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "",
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

  it("409 table.not_shared un-joining WITH items a table that solely anchors its tab", async () => {
    // A plain single-table tab (setupTabApp): tableA is the ONLY table on tabA. A WITH-items un-join has
    // no join to split off, so it must 409 table.not_shared rather than mint a new tab and strand it.
    const { app, tabA, tableA, cookie } = await setupTabApp();
    const res = await app.request(`/api/tabs/${tabA}/unjoin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tableId: tableA, transfers: [{ lineNo: 1 }] }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "table.not_shared", params: { tableId: tableA, tabId: tabA } },
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
      sql`select cast(quantity as text) as quantity from working_order_lines where working_order_id = ${body.tabId}`,
    );
    expect(moved.rows).toEqual([{ quantity: "2000" }]); // two units, as a count of thousandths
    const origin = await suite.db.execute<{ count: number }>(
      sql`select cast(count(*) as int) as count from working_order_lines where working_order_id = ${tabA}`,
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
      sql`select cast(quantity as text) as quantity from working_order_lines where working_order_id = ${tabA}`,
    );
    expect(origin.rows).toEqual([{ quantity: "2000" }]); // two units, as a count of thousandths
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
    // itself, so `body.tableId` would throw before `isUuid` ever ran. Refused by the object/null/array
    // guard naming "body", before the `table.not_joined` a well-formed-but-wrong `tableId` gets.
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

  it("400 management.request_invalid for an empty (unparseable) body, not an opaque 500", async () => {
    const { app, tabA, cookie } = await setupJoinedApp();
    // An empty body is invalid JSON; the route sends it to the SAME field "body" refusal a null body gets.
    const res = await app.request(`/api/tabs/${tabA}/unjoin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });
  });
});
