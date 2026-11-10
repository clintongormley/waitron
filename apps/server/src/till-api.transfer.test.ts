import { testTradingAdmission } from "./testing/trading-admission.js";
import { billActionBody } from "./testing/bill-action-fixture.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { parties, venueLocationId, withTransaction, workingOrders } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  assignCatalogueToVenue,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { nodeId as brandNodeId, jobOrigin } from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { Logger, LogLevel } from "./logger.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import type { OriginConfig } from "./trading-context.js";
import type { WithVenueRowId } from "./testing/venue-row-id.js";
import { createTable } from "./testing/live-table.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";
import { openPartyTab } from "./testing/serve-line.js";
import { writeGroupedLines } from "./testing/grouped-counter-order.js";
import { createOpenOrder } from "./working-order.js";
import { seedSessionDevice, sessionCookieForTest } from "./testing/session-device.js";

// The HTTP surface of the transfer route: the session guard, the malformed-`:id`/`toBillId` screens
// and the STATUS mapping for the transfer codes. The transfer's write behaviour is pinned in
// `transfer-lines.test.ts` and `transfer-lines.filing.test.ts`.
let cfg: WithVenueRowId<OriginConfig>;
let ana: { id: string };
// One product, offered in a table zone, so a tab can open with a real line to transfer — `openTab`
// prices it and the `check_locales` trigger demands its `es-ES` description key match the
// venue's `es-ES` locale. Both tabs' tables sit in that zone, so a transfer joins like modes.
let coffeeId: string;
let coffeeOffer: string;
let tablesZoneId: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedLegacySellingUnits(db);
    await seedVenue(db, {
      name: "Counter",
      invoiceLocales: ["es-ES"],
      operationDescription: "Retail",
    });
    // `openTab` writes `working_orders.node_id`, whose FK requires a real row.
    const nodeId = await seedNode(db);
    const [person] = await db
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    ana = { id: person!.id };
    cfg = makeCfg(await venueLocationId(db), nodeId);
    const offers = await withTransaction(db, async (tx) => {
      const cat = await createCatalogue(tx, { name: "Menu" });
      const drinksCategory = await createCategory(tx, { name: "Drinks" });
      const p = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: drinksCategory.id,
        name: "Espresso",
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await assignCatalogueToVenue(tx, cat.id);
      const zoneOffers = await offerProducts(tx, cfg, { zone: "tables" });
      return { zoneId: zoneOffers.zoneId, coffeeId: p.id, coffee: zoneOffers.offerFor(p.id) };
    });
    coffeeId = offers.coffeeId;
    coffeeOffer = offers.coffee;
    tablesZoneId = offers.zoneId;
  },
});

function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

/** `seriesId` is unused by the transfer route (no fiscal write on the tab path). */
function makeCfg(locationId: string, nodeId: string): WithVenueRowId<OriginConfig> {
  return {
    origin: jobOrigin("dashboard"),
    nodeId: brandNodeId(nodeId),
    locationId: locationId,
    locale: "es-ES",
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
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
      throw new Error("till-api.transfer.test: anchor() is not used by this route");
    },
    currentAnchor: () => null,
  };
}

function deps(db: Database): TillApiDeps {
  return {
    admission: testTradingAdmission(),
    db,
    // Unused: the transfer route touches no fiscal path.
    backend: {} as FiscalBackend,
    clock: systemClock(),
    cfg,
    secureCookies: false,
    venueLocale: "es-ES",
  };
}

async function openSession(db: Database): Promise<string> {
  const deviceId = await seedSessionDevice(db);
  const session = await withTransaction(db, async (tx) => {
    return loginWithPin(tx, {
      deviceId,
      personId: ana.id,
      pin: "5555",
    });
  });
  return session.token;
}

/** Seeds two open bills of one party (tab A carries one espresso line at quantity `aQty`, tab B is
 * empty) plus a mounted app and a logged-in cookie, for the tests below to drive
 * `POST /api/bills/:id/transfer` against. */
async function setupTabsApp(
  aQty = "2",
): Promise<{ app: Hono; d: TillApiDeps; tabA: string; tabB: string; cookie: string }> {
  const app = new Hono();
  const d = deps(suite.db);
  mountTillApi(app, d, collect([]));
  const cookie = await sessionCookieForTest(suite.db, await openSession(suite.db));
  const { tabA, tabB } = await withTransaction(suite.db, async (tx) => {
    const a = await createTable(tx, cfg, { label: `T-${randomUUID()}`, zoneId: tablesZoneId });
    // Its line is stored grouped, as a line written before portions: the route moves part of it.
    const tabAResult = await openPartyTab(tx, cfg, { tableId: a.id });
    await writeGroupedLines(tx, cfg, tabAResult.tabId, [
      { menuItemId: coffeeOffer, quantity: aQty },
    ]);
    const tabB = randomUUID();
    await createOpenOrder(tx, cfg, tabB, [], null, {
      partyId: tabAResult.partyId,
      existingService: true,
      copyServiceContextFrom: tabAResult.tabId,
    });
    return { tabA: tabAResult.tabId, tabB };
  });
  return { app, d, tabA, tabB, cookie };
}

/** A transfer's body, sent with the party's revision as it stands. */
async function transferBody(
  from: string,
  body: { toBillId: string; transfers: { lineNo: number; quantity?: string }[] },
): Promise<string> {
  const [row] = await suite.db
    .select({ revision: parties.revision })
    .from(workingOrders)
    .innerJoin(parties, eq(parties.id, workingOrders.partyId))
    .where(eq(workingOrders.id, from));
  return JSON.stringify(
    await withTransaction(suite.db, (tx) =>
      billActionBody(tx, `/api/bills/${from}/transfer`, {
        ...body,
        expectedPartyRevision: row?.revision ?? 0,
      }),
    ),
  );
}

describe("POST /api/bills/:id/transfer", () => {
  it("401s without a session (session.required)", async () => {
    const { app, tabA, tabB } = await setupTabsApp();
    const res = await app.request(`/api/bills/${tabA}/transfer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await transferBody(tabA, { toBillId: tabB, transfers: [{ lineNo: 1 }] }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("rejects a malformed :id with 4xx tab.not_open, not an opaque 500", async () => {
    const { app, tabB, cookie } = await setupTabsApp();
    const res = await app.request("/api/bills/not-a-uuid/transfer", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: await transferBody(randomUUID(), { toBillId: tabB, transfers: [{ lineNo: 1 }] }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.not_open", params: { tabId: "not-a-uuid" } },
    });
  });

  it("rejects a malformed toTabId with 4xx tab.not_open, not an opaque 500", async () => {
    const { app, tabA, cookie } = await setupTabsApp();
    const res = await app.request(`/api/bills/${tabA}/transfer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: await transferBody(tabA, { toBillId: "nope", transfers: [{ lineNo: 1 }] }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.not_open", params: { tabId: "nope" } },
    });
  });

  it("moves a whole line (204) and re-points it onto the destination bill", async () => {
    const { app, tabA, tabB, cookie } = await setupTabsApp();
    const res = await app.request(`/api/bills/${tabA}/transfer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: await transferBody(tabA, { toBillId: tabB, transfers: [{ lineNo: 1 }] }),
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");

    // Source lost the line entirely, destination gained it with the locked price kept.
    const a = await suite.db.execute<{ count: number }>(
      sql`select cast(count(*) as int) as count from working_order_lines where working_order_id = ${tabA}`,
    );
    expect(a.rows[0]!.count).toBe(0);
    const b = await suite.db.execute<{
      line_no: number;
      product_id: string;
      quantity: string;
      unit_price_gross: number;
    }>(
      // `unit_price_gross` counts cents, so 150 is the locked 1.50, and `quantity` counts
      // thousandths, so "2000" is two units.
      sql`select line_no, product_id, cast(quantity as text) as quantity, cast(unit_price_gross as int) as unit_price_gross from working_order_lines where working_order_id = ${tabB}`,
    );
    expect(b.rows).toEqual([
      { line_no: 1, product_id: coffeeId, quantity: "2000", unit_price_gross: 150 },
    ]);
  });

  it("splits part of a line (204), leaving a reduced source line and a new destination line", async () => {
    const { app, tabA, tabB, cookie } = await setupTabsApp("3");
    const res = await app.request(`/api/bills/${tabA}/transfer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: await transferBody(tabA, { toBillId: tabB, transfers: [{ lineNo: 1, quantity: "1" }] }),
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");

    const a = await suite.db.execute<{ quantity: string }>(
      sql`select cast(quantity as text) as quantity from working_order_lines where working_order_id = ${tabA}`,
    );
    expect(a.rows).toEqual([{ quantity: "2000" }]); // 3 − 1 = 2 units remain on the source
    const b = await suite.db.execute<{ quantity: string; unit_price_gross: number }>(
      sql`select cast(quantity as text) as quantity, cast(unit_price_gross as int) as unit_price_gross from working_order_lines where working_order_id = ${tabB}`,
    );
    // one unit carved off, at the same locked 1.50
    expect(b.rows).toEqual([{ quantity: "1000", unit_price_gross: 150 }]);
  });

  it("400 tab.transfer_self when transferring a tab to itself", async () => {
    const { app, tabA, cookie } = await setupTabsApp();
    const res = await app.request(`/api/bills/${tabA}/transfer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: await transferBody(tabA, { toBillId: tabA, transfers: [{ lineNo: 1 }] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.transfer_self", params: { tabId: tabA } },
    });
  });

  it("400 tab.transfer_quantity_invalid for an over-quantity transfer", async () => {
    const { app, tabA, tabB, cookie } = await setupTabsApp("2");
    const res = await app.request(`/api/bills/${tabA}/transfer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: await transferBody(tabA, { toBillId: tabB, transfers: [{ lineNo: 1, quantity: "5" }] }),
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
    const res = await app.request(`/api/bills/${tabA}/transfer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: await transferBody(tabA, { toBillId: tabB, transfers: [{ lineNo: 99 }] }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.line_not_found", params: { tabId: tabA, lineNo: 99 } },
    });
  });

  it("400 tab.transfer_duplicate_line when the batch names a line_no twice", async () => {
    const { app, tabA, tabB, cookie } = await setupTabsApp("3");
    const res = await app.request(`/api/bills/${tabA}/transfer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: await transferBody(tabA, {
        toBillId: tabB,
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
