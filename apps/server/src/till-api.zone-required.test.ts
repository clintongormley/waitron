import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  deviceProfiles,
  diningTables,
  locations,
  tills,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createExtraList,
  createProduct,
  setProductVariants,
  writeProductModifiers,
} from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { PaymentProvider } from "@waitron/payments";
import { mountTillApi } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import type { TillConfig } from "./till-config.js";
import { addTabRound, createOpenOrder, openTab, parkOrder } from "./working-order.js";
import { createTable } from "./tables.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import "./errors.js";

// Every line sold is priced from a service zone's menu offer. A venue with no zone, and an order
// with no service context, sell nothing; an order with no lines still opens. The fiscal seat is an
// empty object, so a case that reached a filing would fail rather than file.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

interface Venue {
  cfg: TillConfig;
  cookie: string;
  water: string;
  // Its only variant is Inactive, so it sells as itself.
  coffee: string;
  // Water's extras list, offering the coffee.
  extrasListId: string;
  // A dining table in no zone.
  tableId: string;
}

async function seedVenue(db: Database): Promise<Venue> {
  await seedTenant(db);
  await seedLegacySellingUnits(db);
  const [loc] = await db
    .insert(locations)
    .values({ name: "Counter", invoiceLocales: ["es-ES"], operationDescription: "Retail" })
    .returning({ id: locations.id });
  const locationId = brandLocationId(loc!.id);
  await seedKitchenStation(db, { locationId });
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Till 1" })
    .returning({ id: tills.id });
  const [person] = await db
    .insert(persons)
    .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
    .returning({ id: persons.id });
  const cfg: TillConfig = {
    tillId: brandTillId(till!.id),
    nodeId: brandNodeId(await seedNode(db, locationId)),
    seriesId: brandSeriesId(randomUUID()),
    locationId,
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const ids = await withTransaction(db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Carta" });
    await assignCatalogueToLocation(tx, locationId, menu.id);
    const product = (name: string, unitPrice: string) =>
      createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name,
        pricingUnit: "each",
        unitPrice,
        vatClass: "general",
      });
    const coffee = await product("Café", "1.20");
    await setProductVariants(
      tx,
      coffee.id,
      [
        {
          name: "Café doble",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: "3.00",
          available: true,
          active: false,
        },
      ],
      "es",
    );
    const water = await product("Agua", "1.50");
    const list = await createExtraList(
      tx,
      {
        name: "Para acompañar",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: null,
        active: true,
        items: [{ productId: coffee.id, maxQuantity: 1, preselected: false, price: "0.50" }],
      },
      "es",
    );
    await writeProductModifiers(tx, water.id, [{ kind: "extras", id: list.id }]);
    const table = await createTable(tx, cfg, { label: "T1" });
    return { water: water.id, coffee: coffee.id, extrasListId: list.id, tableId: table.id };
  });
  const [profile] = await db
    .insert(deviceProfiles)
    .values({
      name: "Card till",
      formFactor: "till",
      canvasId: null,
      capabilities: ["integrated-card-payment"],
    })
    .returning({ id: deviceProfiles.id });
  const device = await enrolDeviceForTest(db, cfg, { name: "Card till", profileId: profile!.id });
  const session = await withTransaction(db, (tx) =>
    loginWithPin(tx, { tillId: cfg.tillId, personId: person!.id, pin: "5555" }),
  );
  return {
    cfg,
    cookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
    ...ids,
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
      throw new Error("anchor() is not used here");
    },
    currentAnchor: () => null,
  };
}

async function post(venue: Venue, path: string, body: object): Promise<Response> {
  const deps: TillApiDeps = {
    db: suite.db,
    backend: {} as FiscalBackend,
    clock: systemClock(),
    cfg: venue.cfg,
    secureCookies: false,
    venueLocale: "es-ES",
    cardProvider: { provider: "simulator" } as PaymentProvider,
  };
  const hono = new Hono();
  mountTillApi(hono, deps, () => {});
  return hono.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: venue.cookie },
    body: JSON.stringify(body),
  });
}

// A JSON body can still send a line naming a product, which the line types no longer allow.
function productLine(productId: string): { menuItemId: string; quantity: string } {
  return { productId, quantity: "1" } as unknown as { menuItemId: string; quantity: string };
}

const ROUTES = [
  ["/api/working-orders", (line: object) => ({ id: randomUUID(), lines: [line] })],
  [
    "/api/sales",
    (line: object) => ({ lines: [line], tender: { method: "cash", amount: "10.00" } }),
  ],
  [
    "/api/pay",
    (line: object) => ({ id: randomUUID(), lines: [line], simulationOutcome: "captured" }),
  ],
] as const;

async function recorded(): Promise<{ orders: number; lines: number }> {
  const { rows } = await suite.db.execute<{ orders: number; lines: number }>(sql`
    select (select count(*) from working_orders) as orders,
           (select count(*) from working_order_lines) as lines`);
  return rows[0]!;
}

async function orderLines(id: string): Promise<(string | null)[]> {
  const rows = await suite.db
    .select({ productId: workingOrderLines.productId })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  return rows.map((row) => row.productId);
}

describe("a venue with no service zone sells nothing", () => {
  for (const [route, body] of ROUTES) {
    it(`POST ${route} answers 409 service_zone.default_missing and records nothing`, async () => {
      const venue = await seedVenue(suite.db);
      const res = await post(venue, route, body({ productId: venue.water, quantity: "1" }));
      expect({ status: res.status, body: await res.json() }).toEqual({
        status: 409,
        body: { error: { code: "service_zone.default_missing", params: {} } },
      });
      expect(await recorded()).toEqual({ orders: 0, lines: 0 });
    });
  }
});

describe("an order with no service context takes no lines", () => {
  it("parkOrder with no zone refuses order.service_context_missing, whatever the line names", async () => {
    const venue = await seedVenue(suite.db);
    for (const line of [productLine(venue.water), { menuItemId: randomUUID(), quantity: "1" }]) {
      const id = randomUUID();
      await expect(
        parkOrder({ db: suite.db }, venue.cfg, { id, lines: [line] }),
      ).rejects.toMatchObject({
        code: "order.service_context_missing",
        params: { workingOrderId: id },
      });
    }
    expect(await recorded()).toEqual({ orders: 0, lines: 0 });
  });

  it("openTab with lines on a table in no zone refuses order.service_context_missing", async () => {
    const venue = await seedVenue(suite.db);
    await expect(
      withTransaction(suite.db, (tx) =>
        openTab(tx, venue.cfg, {
          tableId: venue.tableId,
          lines: [productLine(venue.water)],
        }),
      ),
    ).rejects.toMatchObject({ code: "order.service_context_missing" });
    expect(await recorded()).toEqual({ orders: 0, lines: 0 });
  });

  it("openTab with no lines on a table in no zone opens an empty tab", async () => {
    const venue = await seedVenue(suite.db);
    const { tabId } = await withTransaction(suite.db, (tx) =>
      openTab(tx, venue.cfg, { tableId: venue.tableId }),
    );
    const [table] = await suite.db
      .select({ tabId: diningTables.tabId })
      .from(diningTables)
      .where(eq(diningTables.id, venue.tableId));
    expect(table!.tabId).toBe(tabId);
    expect(await orderLines(tabId)).toEqual([]);
  });

  it("addTabRound on that empty tab refuses order.service_context_missing", async () => {
    const venue = await seedVenue(suite.db);
    const { tabId } = await withTransaction(suite.db, (tx) =>
      openTab(tx, venue.cfg, { tableId: venue.tableId }),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        addTabRound(tx, venue.cfg, tabId, [productLine(venue.water)]),
      ),
    ).rejects.toMatchObject({
      code: "order.service_context_missing",
      params: { workingOrderId: tabId },
    });
    expect(await orderLines(tabId)).toEqual([]);
  });

  it("createOpenOrder with no lines and no zone opens an empty order", async () => {
    const venue = await seedVenue(suite.db);
    const id = randomUUID();
    const opened = await withTransaction(suite.db, (tx) =>
      createOpenOrder(tx, venue.cfg, id, [], null),
    );
    expect(opened.lineRows).toEqual([]);
    expect(await recorded()).toEqual({ orders: 1, lines: 0 });
  });
});

describe("a venue with a service zone", () => {
  for (const [route, body] of ROUTES) {
    it(`POST ${route} refuses a line naming a product rather than an offer`, async () => {
      const venue = await seedVenue(suite.db);
      await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
      const res = await post(venue, route, body({ productId: venue.water, quantity: "1" }));
      expect({ status: res.status, body: await res.json() }).toEqual({
        status: 400,
        body: { error: { code: "management.request_invalid", params: { field: "lines" } } },
      });
      expect(await recorded()).toEqual({ orders: 0, lines: 0 });
    });
  }

  it("sells an extras pick of a product whose only variant is Inactive", async () => {
    const venue = await seedVenue(suite.db);
    const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
    const id = randomUUID();
    await parkOrder({ db: suite.db }, venue.cfg, {
      id,
      zoneId: offers.zoneId,
      lines: offers.toOfferLines([
        {
          productId: venue.water,
          quantity: "1",
          extras: [
            { listId: venue.extrasListId, picks: [{ productId: venue.coffee, quantity: 1 }] },
          ],
        },
      ]),
    });
    expect(await orderLines(id)).toEqual([venue.water, venue.coffee]);
  });
});
