import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  deviceProfiles,
  kitchenStations,
  locations,
  printJobs,
  ticketItems,
  tills,
  partyTables,
  parties,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
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
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { deploymentEnvironment } from "./config.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import type { Logger, LogLevel } from "./logger.js";
import { createPrinter } from "@waitron/printing";
import { attachPrinterToStation } from "./station-printers.js";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { addTabRound } from "./working-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";
import { openPartyTab } from "./testing/serve-line.js";

// The HTTP surface of the split, un-join and merge routes: the session guard, the malformed-`:id`/`tableId`
// screens, the result shapes and the STATUS mapping for `table.not_joined`. The successful merge case also
// checks the kitchen tickets, kitchen notices and print jobs it leaves; the refused one checks the
// tickets stay on the check. One case finds a split-off check in Held orders and pays it through the
// sale route. The split and un-join verbs themselves are tested in
// `split-bill.test.ts` and `split-bill.fiscal.test.ts`.
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
      const bebidas = await createCategory(tx, { name: "Bebidas" });
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

/** The revision of the party the bill belongs to, as a bill route is sent it. */
async function partyRevisionOf(db: Database, billId: string): Promise<number> {
  const [row] = await db
    .select({ revision: parties.revision })
    .from(workingOrders)
    .innerJoin(parties, eq(parties.id, workingOrders.partyId))
    .where(eq(workingOrders.id, billId));
  return row!.revision;
}

/** Seeds one open tab on table A carrying `aQty` café lines (line_no 1), plus a mounted app and a
 * logged-in cookie. */
async function setupTabApp(
  aQty = "2",
): Promise<{ app: Hono; d: TillApiDeps; tabA: string; tableA: string; cookie: string }> {
  const app = new Hono();
  const d = deps(suite.db);
  mountTillApi(app, d, collect([]));
  const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
  const { tabA, tableA } = await withTransaction(suite.db, async (tx) => {
    const a = await createTable(tx, d.cfg, { label: `T-${randomUUID()}`, zoneId: tablesZoneId });
    const tabAResult = await openPartyTab(tx, d.cfg, {
      tableId: a.id,
      lines: [{ menuItemId: cafeMenuItemId, quantity: aQty }],
    });
    return { tabA: tabAResult.tabId, tableA: a.id };
  });
  return { app, d, tabA, tableA, cookie };
}

/** The suite shares one database, and an earlier case may already have seeded the default station. */
async function kitchenStation(config: TillConfig): Promise<string> {
  const [existing] = await suite.db
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(eq(kitchenStations.locationId, config.locationId));
  return existing?.id ?? seedKitchenStation(suite.db, { locationId: config.locationId });
}

/** The merge the till sends when a waiter leaves an unpaid split-off check without paying it. */
describe("POST /api/bills/:id/merge of a check back into the tab it was split from", () => {
  /** A tab whose second line was sent to a kitchen with a printer, then split whole onto a check. */
  async function splitSentLine(): Promise<{
    app: Hono;
    tabA: string;
    checkId: string;
    cookie: string;
    printerId: string;
    ticket: { id: string; quantity: number | null };
  }> {
    const { app, d, tabA, cookie } = await setupTabApp("1");
    const stationId = await kitchenStation(d.cfg);
    const offers = await withTransaction(suite.db, (tx) =>
      offerProducts(tx, d.cfg, { zone: "tables" }),
    );
    const printerId = await withTransaction(suite.db, async (tx) => {
      const { id } = await createPrinter(
        tx,
        { locationId: d.cfg.locationId },
        {
          name: `P-${randomUUID().slice(0, 8)}`,
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
        },
      );
      await attachPrinterToStation(tx, { stationId, printerId: id });
      return id;
    });
    await withTransaction(suite.db, (tx) =>
      addTabRound(tx, d.cfg, tabA, [{ menuItemId: offers.offerFor(cafeId), quantity: "2" }]),
    );
    const [ticket] = await ticketsOn(tabA);
    expect(ticket).toMatchObject({ lineNo: 2, quantity: 2000 });
    const split = await app.request(`/api/bills/${tabA}/split`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        transfers: [{ lineNo: 2 }],
        expectedPartyRevision: await partyRevisionOf(suite.db, tabA),
      }),
    });
    const { billId: checkId } = (await split.json()) as { billId: string };
    return { app, tabA, checkId, cookie, printerId, ticket: ticket! };
  }

  /** Each ticket item on the order, with the line number of the line it belongs to. */
  async function ticketsOn(orderId: string) {
    return suite.db
      .select({
        id: ticketItems.id,
        quantity: ticketItems.quantity,
        lineNo: workingOrderLines.lineNo,
      })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(ticketItems.workingOrderId, orderId))
      .orderBy(workingOrderLines.lineNo);
  }

  async function heldOrderIds(app: Hono, cookie: string): Promise<string[]> {
    const res = await app.request("/api/working-orders", { headers: { cookie } });
    return ((await res.json()) as { id: string }[]).map((order) => order.id);
  }

  async function noticeCount(...orderIds: string[]): Promise<number> {
    const { rows } = await suite.db.execute<{ count: number }>(
      sql`select cast(count(*) as int) as count from kitchen_notices where working_order_id in (${sql.join(
        orderIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
    return rows[0]!.count;
  }

  async function printJobCount(printerId: string): Promise<number> {
    return (
      await suite.db
        .select({ id: printJobs.id })
        .from(printJobs)
        .where(eq(printJobs.printerId, printerId))
    ).length;
  }

  it("puts the check's sent line and its kitchen ticket back on the tab, and tells the kitchen nothing", async () => {
    const { app, tabA, checkId, cookie, printerId, ticket } = await splitSentLine();
    expect(await heldOrderIds(app, cookie)).toContain(checkId);
    expect((await ticketsOn(checkId)).map((item) => item.id)).toEqual([ticket.id]);
    const jobsBefore = await printJobCount(printerId);

    const res = await app.request(`/api/bills/${tabA}/merge`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        fromBillId: checkId,
        expectedPartyRevision: await partyRevisionOf(suite.db, tabA),
      }),
    });

    expect(res.status).toBe(204);
    expect(await ticketsOn(tabA)).toEqual([
      { id: ticket.id, quantity: ticket.quantity, lineNo: expect.any(Number) },
    ]);
    expect(await ticketsOn(checkId)).toEqual([]);
    expect(await heldOrderIds(app, cookie)).not.toContain(checkId);
    expect(await noticeCount(tabA, checkId)).toBe(0);
    expect(await printJobCount(printerId)).toBe(jobsBefore);
  });

  it("refuses order.payment_in_flight while the check is being paid by card, leaving its lines on it", async () => {
    const { app, tabA, checkId, cookie, ticket } = await splitSentLine();
    suite.db.run(
      sql`update working_orders set payment_attempt_at = '2026-09-26T10:00:00.000Z' where id = ${checkId}`,
    );

    const res = await app.request(`/api/bills/${tabA}/merge`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        fromBillId: checkId,
        expectedPartyRevision: await partyRevisionOf(suite.db, tabA),
      }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "order.payment_in_flight", params: { workingOrderId: checkId } },
    });
    expect((await ticketsOn(checkId)).map((item) => item.id)).toEqual([ticket.id]);
    expect(await ticketsOn(tabA)).toEqual([]);
    expect(await heldOrderIds(app, cookie)).toContain(checkId);
  });
});

/** The same merge on a seated party's tab, whose split-off check belongs to the party too. */
describe("POST /api/bills/:id/merge of a seated party's check back into its tab", () => {
  /** A party seated through the till's seat route, a round of three cafés, and one of them split off
   * onto a check; the revision is the party's as the floor reads it after the split. */
  async function seatedSplit(): Promise<{
    post: (path: string, body: unknown) => Promise<Response>;
    tabId: string;
    checkId: string;
    partyId: string;
    revision: number;
  }> {
    const app = new Hono();
    const d = deps(suite.db);
    mountTillApi(app, d, collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const post = async (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      });
    const table = await withTransaction(suite.db, (tx) =>
      createTable(tx, d.cfg, { label: `T-${randomUUID()}`, zoneId: tablesZoneId }),
    );
    const seated = await post(`/api/tables/${table.id}/seat`, { guestCount: 2 });
    expect(seated.status).toBe(200);
    const { tabId, partyId, revision } = (await seated.json()) as {
      tabId: string;
      partyId: string;
      revision: number;
    };
    await kitchenStation(d.cfg);
    const offers = await withTransaction(suite.db, (tx) =>
      offerProducts(tx, d.cfg, { zone: "tables" }),
    );
    const round = await post(`/api/parties/${partyId}/groups`, {
      submissionId: randomUUID(),
      expectedPartyRevision: revision,
      groups: [
        { lines: [{ menuItemId: offers.offerFor(cafeId), quantity: "3" }], release: "fire" },
      ],
    });
    expect(round.status).toBe(200);
    const split = await post(`/api/bills/${tabId}/split`, {
      transfers: [{ lineNo: 1, quantity: "1" }],
      expectedPartyRevision: ((await round.json()) as { revision: number }).revision,
    });
    expect(split.status).toBe(200);
    const { billId: checkId } = (await split.json()) as { billId: string };
    const floor = await app.request("/api/tables/state", { headers: { cookie } });
    const row = ((await floor.json()) as { id: string; party: { revision: number } | null }[]).find(
      (candidate) => candidate.id === table.id,
    );
    return { post, tabId, checkId, partyId, revision: row!.party!.revision };
  }

  async function quantitiesOn(orderId: string): Promise<string[]> {
    const { rows } = await suite.db.execute<{ quantity: string }>(
      sql`select cast(quantity as text) as quantity from working_order_lines
          where working_order_id = ${orderId} order by line_no`,
    );
    return rows.map((row) => row.quantity);
  }

  async function partyOf(partyId: string) {
    const [party] = await suite.db
      .select({ state: parties.state })
      .from(parties)
      .where(eq(parties.id, partyId));
    const members = await suite.db
      .select({ tableId: partyTables.tableId, leftAt: partyTables.leftAt })
      .from(partyTables)
      .where(eq(partyTables.partyId, partyId));
    return { state: party?.state, members };
  }

  it("puts the check's lines back on the tab when sent with the party's revision, keeping the party", async () => {
    const { post, tabId, checkId, partyId, revision } = await seatedSplit();
    const before = await partyOf(partyId);

    const res = await post(`/api/bills/${tabId}/merge`, {
      fromBillId: checkId,
      expectedPartyRevision: revision,
    });

    expect(res.status).toBe(204);
    expect(await quantitiesOn(checkId)).toEqual([]);
    expect(await quantitiesOn(tabId)).toEqual(["2000", "1000"]);
    expect(before).toMatchObject({ state: "open", members: [{ leftAt: null }] });
    expect(await partyOf(partyId)).toEqual(before);
  });

  it("refuses the merge sent without a revision, leaving the check's line on it", async () => {
    const { post, tabId, checkId } = await seatedSplit();

    const res = await post(`/api/bills/${tabId}/merge`, { fromBillId: checkId });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "expectedPartyRevision" } },
    });
    expect(await quantitiesOn(checkId)).toEqual(["1000"]);
  });
});

/** What a till that forgot the split, by a reload or a crash, finds on the server. */
describe("a split-off check after the till that made it has forgotten it", () => {
  // Paying files a fiscal record, which needs a provisioned venue: the file's shared database is seeded
  // without a registered installation or series.
  const venueSuite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });

  async function provisionedTab(): Promise<{ app: Hono; tabId: string; cookie: string }> {
    const db = venueSuite.db;
    const { cfg: venueCfg, cafeId } = await setupVenue(db);
    const { tabId, personId, profileId } = await withTransaction(db, async (tx) => {
      const offers = await offerProducts(tx, venueCfg, { zone: "tables" });
      const table = await createTable(tx, venueCfg, { label: "Mesa 5", zoneId: offers.zoneId });
      const tab = await openPartyTab(tx, venueCfg, {
        tableId: table.id,
        lines: offers.toOfferLines([{ productId: cafeId, quantity: "2" }]),
      });
      const [person] = await tx
        .insert(persons)
        .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
        .returning({ id: persons.id });
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: "Counter till", formFactor: "till", capabilities: [] })
        .returning({ id: deviceProfiles.id });
      return { tabId: tab.tabId, personId: person!.id, profileId: profile!.id };
    });
    const session = await withTransaction(db, (tx) =>
      loginWithPin(tx, { tillId: venueCfg.tillId, personId, pin: "5555" }),
    );
    // The sale route takes its till from the device that sends it.
    const device = await enrolDeviceForTest(db, venueCfg, { name: "Barra", profileId });
    const clock = systemClock();
    const app = new Hono();
    mountTillApi(
      app,
      {
        db,
        backend: new VerifactuBackend({
          clock,
          db,
          environment: deploymentEnvironment(process.env),
          deploymentEnvironment: deploymentEnvironment(process.env),
          resolveClient: () => Promise.reject(new Error("a sale never submits inline")),
        }),
        clock,
        cfg: venueCfg,
        secureCookies: false,
        venueLocale: "es-ES",
      },
      collect([]),
    );
    const cookie = `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
    return { app, tabId, cookie };
  }

  async function heldOrders(app: Hono, cookie: string): Promise<{ id: string; label: string }[]> {
    const res = await app.request("/api/working-orders", { headers: { cookie } });
    expect(res.status).toBe(200);
    return (await res.json()) as { id: string; label: string }[];
  }

  it("is in Held orders under its table's name, and pays there through the sale route", async () => {
    const { app, tabId, cookie } = await provisionedTab();
    const split = await app.request(`/api/bills/${tabId}/split`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        transfers: [{ lineNo: 1, quantity: "1" }],
        expectedPartyRevision: await partyRevisionOf(venueSuite.db, tabId),
      }),
    });
    expect(split.status).toBe(200);
    const { billId: checkId } = (await split.json()) as { billId: string };

    expect((await heldOrders(app, cookie)).find((order) => order.id === checkId)).toMatchObject({
      label: "Mesa 5",
    });

    const pay = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        lines: [],
        tender: { method: "cash", amount: "5.00" },
        workingOrderId: checkId,
      }),
    });
    expect(pay.status).toBe(200);
    expect(await pay.json()).toMatchObject({ total: "1.50", orderLabel: "Mesa 5" });
    expect((await heldOrders(app, cookie)).map((order) => order.id)).not.toContain(checkId);
  });
});
