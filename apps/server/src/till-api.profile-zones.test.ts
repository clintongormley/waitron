import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  billPayments,
  deviceProfiles,
  kitchenStations,
  parties,
  workingOrderLines,
  tenants,
  workingOrders,
  type Transaction,
  withTransaction,
} from "@waitron/db";
import { completeBillPayment } from "./bill-payments.js";
import { lookUpBills } from "./bill-lookup-api.js";
import { lookUpInvoices } from "./invoice-lookup-api.js";
import { orderZoneCondition } from "./zone-access.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { addProductToMenu, createCatalogue, createProduct } from "@waitron/catalogue";
import { ADJUSTMENT_ACTIONS } from "@waitron/adjustments";
import { hashPin, persons } from "@waitron/identity";
import { CAPABILITY_FLAGS } from "@waitron/layouts";
import { SimulatorPaymentProvider } from "@waitron/payments";
import {
  configureZone,
  createDepartment,
  createServiceZone,
  deactivateServiceZone,
  setProfileServiceAccess,
  zoneServicePolicies,
} from "@waitron/venue-service";
import { offerMenuThroughZone } from "@waitron/venue-service/testing/zone-menus.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { VENUE_SERVICE } from "./modules.js";
import type { Logger } from "./logger.js";
import { placeGroups } from "./order-groups.js";
import { createTable } from "./tables.js";
import { mountTillApi } from "./till-api.js";
import { mountDeviceApi } from "./device-api.js";
import { createStation } from "./kitchen.js";
import { moveDishesToStation } from "./station-move.js";
import { createPairingMode } from "./pairing-mode.js";
import type { StationQueueGroup } from "./working-order.js";
import { parkOrder } from "./working-order.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  OPERATOR,
  inTx,
  partyRow,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { offerProducts } from "./testing/zone-offers.js";

/*
 * Route-to-zone map. Every till route, with where the zone it acts in is read from and the case that
 * fails when its gate is removed. "body" is a zone the request names; "order" is the zone recorded
 * on the working order (a bill, a sale's order and an order's lines are all working orders); "party"
 * is the zone of the party's first table (`partyZone`, which also prices the party's rounds); "table"
 * is the table's own zone. A subject that names nothing, or sits in no zone, is left to the route.
 *
 * | Route                                                   | Zone from              | Case that fails without the gate                     |
 * | ------------------------------------------------------- | ---------------------- | ---------------------------------------------------- |
 * | GET  /api/default-service-zone/offers                   | profile start; list    | "starts at the profile's starting zone and lists..." |
 * | GET  /api/service-zones/:zoneId/offers                  | path zone              | refuses GET /api/service-zones/:zoneId/offers        |
 * | GET  /api/menu-state?zoneId                             | query zone; or start   | refuses GET /api/menu-state?zoneId                   |
 * | POST /api/dead-ends/sale                                | body zone; body order  | refuses POST /api/dead-ends/sale (zone), (order)     |
 * | POST /api/sales                                         | body zone; body order  | refuses POST /api/sales (zone), (order)              |
 * | POST /api/pay                                           | body zone; body order  | refuses POST /api/pay (zone), (order)                |
 * | POST /api/working-orders                                | body zone; body order  | refuses POST /api/working-orders (zone), (order)     |
 * | GET  /api/working-orders                                | list, by order zone    | "lists only the profile's zones, tables and orders"  |
 * | GET  /api/working-orders/:id                            | order                  | refuses GET /api/working-orders/:id                  |
 * | GET  /api/working-orders/:id/placed                     | order                  | refuses GET /api/working-orders/:id/placed           |
 * | PUT  /api/working-orders/:id                            | order                  | refuses PUT /api/working-orders/:id                  |
 * | PUT  /api/working-orders/:id/invoice-choice             | order                  | refuses PUT .../invoice-choice                       |
 * | DELETE /api/working-orders/:id                          | order                  | refuses DELETE /api/working-orders/:id               |
 * | POST /api/working-orders/:id/place                      | order                  | refuses POST .../place                               |
 * | POST /api/working-orders/:id/prep                       | order                  | refuses POST .../prep                                |
 * | POST /api/orders/:id/courses/:courseId/fire|ready|away  | order                  | refuses POST /api/orders/:id/courses/:courseId/<verb>|
 * | GET  /api/orders/counter-waiting                        | list, by order zone    | "lists only the profile's zones, tables and orders"  |
 * | POST /api/orders/:id/collect                            | order                  | refuses POST /api/orders/:id/collect                 |
 * | POST /api/orders/:id/reprint                            | order                  | refuses POST /api/orders/:id/reprint                 |
 * | GET  /api/sales/:id                                     | order                  | refuses GET /api/sales/:id                           |
 * | GET  /api/sales/:id/receipt                             | order                  | refuses GET /api/sales/:id/receipt                   |
 * | POST /api/sales/:id/receipt/handover                    | order                  | refuses POST .../receipt/handover                    |
 * | POST /api/sales/:id/receipt/retry                       | order                  | refuses POST .../receipt/retry                       |
 * | POST /api/sales/:id/receipt, /payment-slip              | order                  | refuses POST /api/sales/:id/receipt, /payment-slip   |
 * | POST /api/sales/:id/reprint                             | order                  | refuses POST /api/sales/:id/reprint                  |
 * | POST /api/working-orders/:id/collect                    | order                  | refuses POST /api/working-orders/:id/collect         |
 * | POST /api/working-orders/:id/cancel                     | order                  | refuses POST /api/working-orders/:id/cancel          |
 * | GET  /api/tables, /api/tables/state, /api/zones         | list, by table or zone | "lists only the profile's zones, tables and orders"  |
 * | POST /api/tables/:id/seat                               | table                  | refuses POST /api/tables/:id/seat                    |
 * | POST /api/tables/:id/cleared                            | table                  | refuses POST /api/tables/:id/cleared                 |
 * | POST /api/tables/:id/status                             | table                  | refuses POST /api/tables/:id/status                  |
 * | PUT  /api/tables/:id/placement                          | table; body zone       | refuses PUT .../placement (table), (zone)            |
 * | DELETE /api/tables/:id/placement                        | table                  | refuses DELETE /api/tables/:id/placement             |
 * | POST /api/parties/:id/finish                            | party                  | refuses POST /api/parties/:id/finish                 |
 * | POST /api/parties/:id/bill-request                      | party                  | refuses POST /api/parties/:id/bill-request           |
 * | PUT  /api/parties/:id/name                              | party                  | refuses PUT /api/parties/:id/name                    |
 * | POST /api/parties/:id/move, /join                       | party; body table      | refuses POST /api/parties/:id/<move|join> (party), (table) |
 * | POST /api/parties/:id/split-table                       | party                  | refuses POST /api/parties/:id/split-table            |
 * | GET  /api/parties/:id/bills|groups|current-orders|print-problems|drafts | party  | refuses GET /api/parties/:id/<read>                  |
 * | POST /api/parties/:id/groups                            | party                  | refuses POST /api/parties/:id/groups                 |
 * | POST /api/parties/:id/groups/:gid/fire|ready|away|served|snooze|unsnooze | party | refuses POST /api/parties/:id/groups/:gid/<verb>  |
 * | POST /api/parties/:id/served, /unserved                 | party                  | refuses POST /api/parties/:id/<served|unserved>      |
 * | PUT  /api/parties/:id/groups/order                      | party                  | refuses PUT /api/parties/:id/groups/order            |
 * | POST /api/parties/:id/groups/move                       | party                  | refuses POST /api/parties/:id/groups/move            |
 * | PUT  /api/parties/:id/drafts                            | party                  | refuses PUT /api/parties/:id/drafts                  |
 * | POST /api/parties/:id/drafts/:did/take-over, /submit    | party                  | refuses POST /api/parties/:id/drafts/:did/<verb>     |
 * | POST /api/parties/:id/unpaid-departure                  | party                  | refuses POST /api/parties/:id/unpaid-departure       |
 * | POST /api/dead-ends/draft                               | body party             | refuses POST /api/dead-ends/draft                    |
 * | POST /api/dead-ends/order                               | body order; body zone  | refuses POST /api/dead-ends/order (order), (zone)    |
 * | PUT  /api/working-orders/:id/make-at                    | order                  | refuses PUT .../make-at                              |
 * | GET  /api/working-orders/:id/lines                      | order                  | refuses GET /api/working-orders/:id/lines            |
 * | POST /api/working-orders/:id/lines/move-station         | order                  | refuses POST .../lines/move-station                  |
 * | PUT  /api/working-orders/:id/lines/:lineNo              | order                  | refuses PUT .../lines/:lineNo                        |
 * | PATCH /api/working-orders/:id/lines/:lineNo/course      | order                  | refuses PATCH .../lines/:lineNo/course               |
 * | POST /api/working-orders/:id/lines/send, /recall        | order                  | refuses POST .../lines/<send|recall>                 |
 * | POST /api/bills/:id/split                               | order                  | refuses POST /api/bills/:id/split                    |
 * | POST /api/bills/:id/merge                               | order; body order      | refuses POST /api/bills/:id/merge (into), (from)     |
 * | POST /api/bills/:id/transfer                            | order; body order      | refuses POST /api/bills/:id/transfer (from), (to)    |
 * | POST /api/bills/:id/move                                | order; body table/zone | refuses POST /api/bills/:id/move (bill), (table), (counter) |
 * | GET  /api/working-orders/:id/payments                   | order                  | refuses GET /api/working-orders/:id/payments         |
 * | POST /api/working-orders/:id/payments/preview           | order                  | refuses POST .../payments/preview                    |
 * | POST /api/working-orders/:id/payments                   | order                  | refuses POST /api/working-orders/:id/payments        |
 * | POST /api/working-orders/:id/payments/:paymentId/refunds| order                  | refuses POST .../payments/:paymentId/refunds         |
 * | POST /api/working-orders/:id/adjustments, /preview      | order                  | refuses POST .../adjustments, /preview               |
 * | GET  /api/bills/lookup                                  | list, by order zone    | "shows a Deli bill to the Deli ...", "fills ... twenty Deli bills ..." |
 * | GET  /api/invoices/lookup                               | list, by order zone    | "shows a Deli invoice to the Deli ...", "fills ... twenty Deli invoices ..." |
 *
 * The bill lookup searches party names, delivery labels and table labels as well as numbers, and
 * the invoice lookup the customer's legal name, so both are filtered like the other lists, reading
 * on past the rows they hide until a page of twenty shows.
 *
 * Where the check runs: first inside the route's own transaction, except where the route's work
 * runs in a helper that opens its own transaction — `/api/sales`, `/api/pay`, POST
 * `/api/working-orders`, GET, PUT and DELETE `/api/working-orders/:id`, `/placed`,
 * `/invoice-choice`, `/place`, `/prep`, `/collect`, `/cancel`, `/api/sales/:id/receipt`,
 * `/payment-slip`, `/reprint` and the four bill-payment routes — where it reads just before, outside
 * any transaction.
 *
 * Not zone-gated: the session, staff, till, locale and product reads; the kitchen's station,
 * notice, ticket-item, expo, watcher and `/api/orders/:id/stations/:sid/advance` routes, whose scope
 * is the device's station or watcher ("a kitchen display" below); and the drawer, the authorizer and reason lists,
 * `/api/statuses` and `GET/PUT /api/device/equipment`, which name no zone.
 */

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 120_000,
});

const noopLog: Logger = () => {};

/** What the lookup routes hand their lookup for a session on `profileId`. */
const lookupScope = (tx: Transaction, profileId: string) =>
  orderZoneCondition(tx, v.cfg, profileId);

interface Fixtures {
  /** Restaurant: the provisioned department, with the counter, tables and bar zones. */
  bar: string;
  counter: string;
  restTables: string;
  /** Deli: a department of its own. */
  deliCounter: string;
  deliTables: string;
  /** A Deli open counter order with one line, a Deli table with a seated party and a round. */
  deliOrder: string;
  deliTable: string;
  deliParty: string;
  deliTab: string;
  /** The same, in the Restaurant. */
  restOrder: string;
  restTable: string;
  restFreeTable: string;
  restParty: string;
  restTab: string;
  /** A Deli menu's item, also offered in the bar. */
  deliSpecial: string;
  deliItem: string;
  /** The Deli tables zone's offer of the product the Deli round orders. */
  deliTablesItem: string;
}

let v: PartyVenue;
let app: Hono;
let f: Fixtures;
let restaurantProfile: string;
/** Ana on a till whose profile is the Restaurant's, starting at the bar. */
let restaurant: string;
/** Ana on a till whose profile has no department row. */
let plain: string;
/** Ana on a till whose profile is the Deli's, starting at the Deli counter. */
let deli: string;
let personId: string;

async function signIn(profileId: string): Promise<string> {
  const device = await enrolDeviceForTest(suite.db, v.cfg, {
    name: `Till ${randomUUID()}`,
    profileId,
  });
  const login = await app.request("/api/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
    },
    body: JSON.stringify({ personId, pin: "5555" }),
  });
  expect(login.status).toBe(200);
  return login.headers.get("set-cookie")!.split(";")[0]!;
}

async function profile(): Promise<string> {
  const [row] = await suite.db
    .insert(deviceProfiles)
    .values({
      name: `Till ${randomUUID()}`,
      formFactor: "till",
      capabilities: [...CAPABILITY_FLAGS],
    })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

async function departmentOf(tx: Transaction, zoneId: string): Promise<string> {
  const [row] = await tx
    .select({ departmentId: zoneServicePolicies.departmentId })
    .from(zoneServicePolicies)
    .where(eq(zoneServicePolicies.zoneId, zoneId));
  return row!.departmentId;
}

async function seatWithRound(tableId: string, menuItemId: string) {
  const seated = await seat(v, tableId);
  await inTx(v, (tx) =>
    placeGroups(tx, v.cfg, seated.partyId, {
      groups: [{ lines: [{ menuItemId, quantity: "1" }], release: "hold" }],
      operatorId: OPERATOR,
    }),
  );
  return seated;
}

async function park(zoneId: string, menuItemId: string): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: suite.db }, v.cfg, {
    id,
    lines: [{ menuItemId, quantity: "1" }],
    zoneId,
    operatorId: OPERATOR,
  });
  return id;
}

beforeAll(async () => {
  v = await setupPartyVenue(suite.db);
  app = new Hono();
  mountTillApi(
    app,
    {
      db: suite.db,
      backend: v.backend,
      clock: v.clock,
      cfg: v.cfg,
      secureCookies: false,
      venueLocale: v.cfg.locale,
      cardProvider: new SimulatorPaymentProvider(suite.db),
    },
    noopLog,
  );
  mountDeviceApi(
    app,
    { db: suite.db, cfg: v.cfg, secureCookies: false, pairingMode: createPairingMode() },
    noopLog,
  );
  const zones = await inTx(v, async (tx) => {
    const restaurantId = await departmentOf(tx, v.tables.zoneId);
    const bar = await createServiceZone(tx, v.cfg, { name: "Bar", departmentId: restaurantId });
    await configureZone(tx, v.cfg, {
      zoneId: bar.id,
      departmentId: restaurantId,
      serviceMode: "prepay",
    });
    const deli = await createDepartment(tx, v.cfg, { name: "Deli", defaultServiceMode: "prepay" });
    const deliCounter = await createServiceZone(tx, v.cfg, {
      name: "Deli counter",
      departmentId: deli.id,
    });
    const deliTables = await createServiceZone(tx, v.cfg, {
      name: "Deli tables",
      departmentId: deli.id,
    });
    const barOffers = await offerProducts(tx, v.cfg, { zone: { zoneId: bar.id } });
    const deliCounterOffers = await offerProducts(tx, v.cfg, {
      zone: { zoneId: deliCounter.id },
      serviceMode: "prepay",
    });
    const deliTablesOffers = await offerProducts(tx, v.cfg, {
      zone: { zoneId: deliTables.id },
      serviceMode: "table_tab",
    });
    // A menu the Deli sells from, offered in the bar as well.
    const specials = await createCatalogue(tx, { name: "Deli specials" });
    const pastrami = await createProduct(tx, {
      catalogueId: specials.id,
      categoryId: null,
      name: "Pastrami",
      pricingUnit: "each",
      unitPrice: "9.00",
      vatClass: "general",
    });
    const special = await addProductToMenu(tx, { menuId: specials.id, productId: pastrami.id });
    await publishWorkingMenu(tx, specials.id);
    await offerMenuThroughZone(tx, v.cfg, deliCounter.id, specials.id);
    await offerMenuThroughZone(tx, v.cfg, bar.id, specials.id);
    const deliTable = await createTable(tx, v.cfg, { label: "D1", zoneId: deliTables.id });
    return {
      bar: bar.id,
      deliCounter: deliCounter.id,
      deliTables: deliTables.id,
      deliTable: deliTable.id,
      deliItem: deliCounterOffers.offerFor(v.productId("Agua")),
      deliTablesItem: deliTablesOffers.offerFor(v.productId("Agua")),
      barItem: barOffers.offerFor(v.productId("Agua")),
      deliSpecial: special.id,
    };
  });
  const deliSeated = await seatWithRound(zones.deliTable, zones.deliTablesItem);
  const restTable = await v.table("R1");
  const restSeated = await seatWithRound(restTable, v.item("Agua"));
  f = {
    bar: zones.bar,
    counter: v.counter.zoneId,
    restTables: v.tables.zoneId,
    deliCounter: zones.deliCounter,
    deliTables: zones.deliTables,
    deliOrder: await park(zones.deliCounter, zones.deliItem),
    deliTable: zones.deliTable,
    deliParty: deliSeated.partyId,
    deliTab: deliSeated.tabId,
    restOrder: await park(zones.bar, zones.barItem),
    restTable,
    restFreeTable: await v.table("R2"),
    restParty: restSeated.partyId,
    restTab: restSeated.tabId,
    deliSpecial: zones.deliSpecial,
    deliItem: zones.deliItem,
    deliTablesItem: zones.deliTablesItem,
  };
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "admin" })
    .returning({ id: persons.id });
  personId = person!.id;
  restaurantProfile = await profile();
  await inTx(v, async (tx) =>
    setProfileServiceAccess(tx, v.cfg, restaurantProfile, {
      departmentId: await departmentOf(tx, v.tables.zoneId),
      allowedZoneIds: null,
      startingZoneId: f.bar,
      stationIds: [],
      watcherIds: [],
    }),
  );
  restaurant = await signIn(restaurantProfile);
  plain = await signIn(await profile());
  const deliProfile = await profile();
  await inTx(v, async (tx) =>
    setProfileServiceAccess(tx, v.cfg, deliProfile, {
      departmentId: await departmentOf(tx, f.deliCounter),
      allowedZoneIds: null,
      startingZoneId: f.deliCounter,
      stationIds: [],
      watcherIds: [],
    }),
  );
  deli = await signIn(deliProfile);
}, 120_000);

async function send(
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{
  status: number;
  body: { error?: { code: string } } & Record<string, unknown>;
}> {
  const response = await app.request(path, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? {} : JSON.parse(text) };
}

const notAllowed = (zoneId: string) => ({
  status: 403,
  body: { error: { code: "service_zone.not_allowed", params: { zoneId } } },
});

type Row = readonly [
  name: string,
  method: string,
  path: (f: Fixtures) => string,
  body: ((f: Fixtures) => unknown) | undefined,
  zone: (f: Fixtures) => string,
];

const id = randomUUID();
const deliOrderZone = (x: Fixtures) => x.deliCounter;
const deliTableZone = (x: Fixtures) => x.deliTables;
const adjustment = () => ({
  submissionId: randomUUID(),
  expectedRevision: 0,
  action: ADJUSTMENT_ACTIONS[0],
  lineId: null,
  reasonId: randomUUID(),
});
const saleLines = (x: Fixtures) => [{ menuItemId: x.deliItem, quantity: "1" }];

const ROUTES: readonly Row[] = [
  [
    "GET /api/service-zones/:zoneId/offers",
    "GET",
    (x) => `/api/service-zones/${x.deliCounter}/offers`,
    undefined,
    deliOrderZone,
  ],
  [
    "GET /api/menu-state?zoneId",
    "GET",
    (x) => `/api/menu-state?zoneId=${x.deliCounter}`,
    undefined,
    deliOrderZone,
  ],
  [
    "POST /api/dead-ends/sale (zone)",
    "POST",
    () => "/api/dead-ends/sale",
    (x) => ({ step: "pay", lines: saleLines(x), zoneId: x.deliCounter }),
    deliOrderZone,
  ],
  [
    "POST /api/dead-ends/sale (order)",
    "POST",
    () => "/api/dead-ends/sale",
    (x) => ({ step: "edit", lines: [], workingOrderId: x.deliOrder }),
    deliOrderZone,
  ],
  [
    "POST /api/sales (zone)",
    "POST",
    () => "/api/sales",
    (x) => ({
      lines: saleLines(x),
      zoneId: x.deliCounter,
      tender: { method: "cash", amount: "2.00" },
    }),
    deliOrderZone,
  ],
  [
    "POST /api/sales (order)",
    "POST",
    () => "/api/sales",
    (x) => ({ workingOrderId: x.deliOrder, lines: [], tender: { method: "cash", amount: "2.00" } }),
    deliOrderZone,
  ],
  [
    "POST /api/pay (zone)",
    "POST",
    () => "/api/pay",
    (x) => ({ id: randomUUID(), lines: saleLines(x), zoneId: x.deliCounter }),
    deliOrderZone,
  ],
  [
    "POST /api/pay (order)",
    "POST",
    () => "/api/pay",
    (x) => ({ id: x.deliOrder, lines: [] }),
    deliOrderZone,
  ],
  [
    "POST /api/working-orders (zone)",
    "POST",
    () => "/api/working-orders",
    (x) => ({ id: randomUUID(), lines: saleLines(x), zoneId: x.deliCounter }),
    deliOrderZone,
  ],
  [
    "POST /api/working-orders (order)",
    "POST",
    () => "/api/working-orders",
    (x) => ({ id: x.deliOrder, lines: saleLines(x) }),
    deliOrderZone,
  ],
  [
    "GET /api/working-orders/:id",
    "GET",
    (x) => `/api/working-orders/${x.deliOrder}`,
    undefined,
    deliOrderZone,
  ],
  [
    "GET /api/working-orders/:id/placed",
    "GET",
    (x) => `/api/working-orders/${x.deliOrder}/placed`,
    undefined,
    deliOrderZone,
  ],
  [
    "PUT /api/working-orders/:id",
    "PUT",
    (x) => `/api/working-orders/${x.deliOrder}`,
    () => ({}),
    deliOrderZone,
  ],
  [
    "PUT /api/working-orders/:id/invoice-choice",
    "PUT",
    (x) => `/api/working-orders/${x.deliOrder}/invoice-choice`,
    () => ({}),
    deliOrderZone,
  ],
  [
    "DELETE /api/working-orders/:id",
    "DELETE",
    (x) => `/api/working-orders/${x.deliOrder}`,
    undefined,
    deliOrderZone,
  ],
  [
    "POST /api/working-orders/:id/place",
    "POST",
    (x) => `/api/working-orders/${x.deliOrder}/place`,
    () => ({}),
    deliOrderZone,
  ],
  [
    "POST /api/working-orders/:id/prep",
    "POST",
    (x) => `/api/working-orders/${x.deliOrder}/prep`,
    () => ({}),
    deliOrderZone,
  ],
  ...(["fire", "ready", "away"] as const).map((verb): Row => [
    `POST /api/orders/:id/courses/:courseId/${verb}`,
    "POST",
    (x) => `/api/orders/${x.deliOrder}/courses/${id}/${verb}`,
    () => ({}),
    deliOrderZone,
  ]),
  [
    "POST /api/orders/:id/collect",
    "POST",
    (x) => `/api/orders/${x.deliOrder}/collect`,
    () => ({}),
    deliOrderZone,
  ],
  [
    "POST /api/orders/:id/reprint",
    "POST",
    (x) => `/api/orders/${x.deliOrder}/reprint`,
    () => ({}),
    deliOrderZone,
  ],
  ["GET /api/sales/:id", "GET", (x) => `/api/sales/${x.deliOrder}`, undefined, deliOrderZone],
  [
    "GET /api/sales/:id/receipt",
    "GET",
    (x) => `/api/sales/${x.deliOrder}/receipt`,
    undefined,
    deliOrderZone,
  ],
  [
    "POST /api/sales/:id/receipt/handover",
    "POST",
    (x) => `/api/sales/${x.deliOrder}/receipt/handover`,
    () => ({}),
    deliOrderZone,
  ],
  [
    "POST /api/sales/:id/receipt/retry",
    "POST",
    (x) => `/api/sales/${x.deliOrder}/receipt/retry`,
    () => ({}),
    deliOrderZone,
  ],
  [
    "POST /api/sales/:id/receipt",
    "POST",
    (x) => `/api/sales/${x.deliOrder}/receipt`,
    () => ({}),
    deliOrderZone,
  ],
  [
    "POST /api/sales/:id/payment-slip",
    "POST",
    (x) => `/api/sales/${x.deliOrder}/payment-slip`,
    () => ({}),
    deliOrderZone,
  ],
  [
    "POST /api/sales/:id/reprint",
    "POST",
    (x) => `/api/sales/${x.deliOrder}/reprint`,
    () => ({}),
    deliOrderZone,
  ],
  [
    "POST /api/working-orders/:id/collect",
    "POST",
    (x) => `/api/working-orders/${x.deliOrder}/collect`,
    () => ({ tender: { method: "cash", amount: "2.00" } }),
    deliOrderZone,
  ],
  [
    "POST /api/working-orders/:id/cancel",
    "POST",
    (x) => `/api/working-orders/${x.deliOrder}/cancel`,
    () => ({ reason: "Test" }),
    deliOrderZone,
  ],
  [
    "POST /api/tables/:id/seat",
    "POST",
    (x) => `/api/tables/${x.deliTable}/seat`,
    () => ({}),
    deliTableZone,
  ],
  [
    "POST /api/tables/:id/cleared",
    "POST",
    (x) => `/api/tables/${x.deliTable}/cleared`,
    () => ({}),
    deliTableZone,
  ],
  [
    "POST /api/tables/:id/status",
    "POST",
    (x) => `/api/tables/${x.deliTable}/status`,
    () => ({ statusId: null }),
    deliTableZone,
  ],
  [
    "PUT /api/tables/:id/placement (table)",
    "PUT",
    (x) => `/api/tables/${x.deliTable}/placement`,
    (x) => ({ zoneId: x.restTables, posX: 1, posY: 1, shape: "square", rotation: 0 }),
    deliTableZone,
  ],
  [
    "PUT /api/tables/:id/placement (zone)",
    "PUT",
    (x) => `/api/tables/${x.restFreeTable}/placement`,
    (x) => ({ zoneId: x.deliCounter, posX: 1, posY: 1, shape: "square", rotation: 0 }),
    deliOrderZone,
  ],
  [
    "DELETE /api/tables/:id/placement",
    "DELETE",
    (x) => `/api/tables/${x.deliTable}/placement`,
    undefined,
    deliTableZone,
  ],
  [
    "POST /api/parties/:id/finish",
    "POST",
    (x) => `/api/parties/${x.deliParty}/finish`,
    () => ({ expectedPartyRevision: 0 }),
    deliTableZone,
  ],
  [
    "POST /api/parties/:id/bill-request",
    "POST",
    (x) => `/api/parties/${x.deliParty}/bill-request`,
    () => ({ submissionId: randomUUID(), expectedPartyRevision: 0, requested: true }),
    deliTableZone,
  ],
  [
    "PUT /api/parties/:id/name",
    "PUT",
    (x) => `/api/parties/${x.deliParty}/name`,
    () => ({ name: "Renamed", expectedPartyRevision: 0 }),
    deliTableZone,
  ],
  ...(["move", "join"] as const).flatMap((verb): Row[] => [
    [
      `POST /api/parties/:id/${verb} (party)`,
      "POST",
      (x) => `/api/parties/${x.deliParty}/${verb}`,
      (x) => ({
        [verb === "move" ? "toTableId" : "tableId"]: x.restFreeTable,
        expectedPartyRevision: 0,
      }),
      deliTableZone,
    ],
    [
      `POST /api/parties/:id/${verb} (table)`,
      "POST",
      (x) => `/api/parties/${x.restParty}/${verb}`,
      (x) => ({
        [verb === "move" ? "toTableId" : "tableId"]: x.deliTable,
        expectedPartyRevision: 0,
      }),
      deliTableZone,
    ],
  ]),
  [
    "POST /api/parties/:id/split-table",
    "POST",
    (x) => `/api/parties/${x.deliParty}/split-table`,
    (x) => ({ tableId: x.deliTable, billId: null, expectedPartyRevision: 0 }),
    deliTableZone,
  ],
  ...(["bills", "groups", "current-orders", "print-problems", "drafts"] as const).map(
    (read): Row => [
      `GET /api/parties/:id/${read}`,
      "GET",
      (x) => `/api/parties/${x.deliParty}/${read}`,
      undefined,
      deliTableZone,
    ],
  ),
  [
    "POST /api/parties/:id/groups",
    "POST",
    (x) => `/api/parties/${x.deliParty}/groups`,
    () => ({ submissionId: randomUUID(), expectedPartyRevision: 0, groups: [] }),
    deliTableZone,
  ],
  ...(["fire", "ready", "away", "served", "snooze", "unsnooze"] as const).map((verb): Row => [
    `POST /api/parties/:id/groups/:gid/${verb}`,
    "POST",
    (x) => `/api/parties/${x.deliParty}/groups/${id}/${verb}`,
    () => ({ submissionId: randomUUID(), expectedPartyRevision: 0, minutes: 5 }),
    deliTableZone,
  ]),
  ...(["served", "unserved"] as const).map((verb): Row => [
    `POST /api/parties/:id/${verb}`,
    "POST",
    (x) => `/api/parties/${x.deliParty}/${verb}`,
    () => ({ submissionId: randomUUID(), expectedPartyRevision: 0, items: [] }),
    deliTableZone,
  ]),
  [
    "PUT /api/parties/:id/groups/order",
    "PUT",
    (x) => `/api/parties/${x.deliParty}/groups/order`,
    () => ({ submissionId: randomUUID(), expectedPartyRevision: 0, heldGroupIds: [] }),
    deliTableZone,
  ],
  [
    "POST /api/parties/:id/groups/move",
    "POST",
    (x) => `/api/parties/${x.deliParty}/groups/move`,
    () => ({ submissionId: randomUUID(), expectedPartyRevision: 0, moves: [], target: "new" }),
    deliTableZone,
  ],
  [
    "PUT /api/parties/:id/drafts",
    "PUT",
    (x) => `/api/parties/${x.deliParty}/drafts`,
    () => ({ draftId: null, revision: 0 }),
    deliTableZone,
  ],
  ...(["take-over", "submit"] as const).map((verb): Row => [
    `POST /api/parties/:id/drafts/:did/${verb}`,
    "POST",
    (x) => `/api/parties/${x.deliParty}/drafts/${id}/${verb}`,
    () => ({
      submissionId: randomUUID(),
      expectedPartyRevision: 0,
      revision: 0,
      draftRevision: 0,
      groups: [],
    }),
    deliTableZone,
  ]),
  [
    "POST /api/parties/:id/unpaid-departure",
    "POST",
    (x) => `/api/parties/${x.deliParty}/unpaid-departure`,
    () => ({ expectedPartyRevision: 0, reason: "Left" }),
    deliTableZone,
  ],
  [
    "POST /api/dead-ends/draft",
    "POST",
    () => "/api/dead-ends/draft",
    (x) => ({ partyId: x.deliParty, draftId: id, lineIds: [] }),
    deliTableZone,
  ],
  [
    "POST /api/dead-ends/order (order)",
    "POST",
    () => "/api/dead-ends/order",
    (x) => ({ workingOrderId: x.deliOrder }),
    deliOrderZone,
  ],
  [
    "POST /api/dead-ends/order (zone)",
    "POST",
    () => "/api/dead-ends/order",
    (x) => ({ workingOrderId: x.restOrder, toZoneId: x.deliCounter }),
    deliOrderZone,
  ],
  [
    "PUT /api/working-orders/:id/make-at",
    "PUT",
    (x) => `/api/working-orders/${x.deliOrder}/make-at`,
    () => ({ revision: 0, lines: {} }),
    deliOrderZone,
  ],
  [
    "GET /api/working-orders/:id/lines",
    "GET",
    (x) => `/api/working-orders/${x.deliTab}/lines`,
    undefined,
    deliTableZone,
  ],
  [
    "POST /api/working-orders/:id/lines/move-station",
    "POST",
    (x) => `/api/working-orders/${x.deliOrder}/lines/move-station`,
    () => ({ submissionId: randomUUID(), lineIds: [id], stationId: id }),
    deliOrderZone,
  ],
  [
    "PUT /api/working-orders/:id/lines/:lineNo",
    "PUT",
    (x) => `/api/working-orders/${x.deliOrder}/lines/1`,
    () => ({ revision: 0 }),
    deliOrderZone,
  ],
  [
    "PATCH /api/working-orders/:id/lines/:lineNo/course",
    "PATCH",
    (x) => `/api/working-orders/${x.deliTab}/lines/1/course`,
    () => ({}),
    deliTableZone,
  ],
  ...(["send", "recall"] as const).map((verb): Row => [
    `POST /api/working-orders/:id/lines/${verb}`,
    "POST",
    (x) => `/api/working-orders/${x.deliTab}/lines/${verb}`,
    () => ({}),
    deliTableZone,
  ]),
  [
    "POST /api/bills/:id/split",
    "POST",
    (x) => `/api/bills/${x.deliTab}/split`,
    () => ({ transfers: [] }),
    deliTableZone,
  ],
  [
    "POST /api/bills/:id/merge (into)",
    "POST",
    (x) => `/api/bills/${x.deliTab}/merge`,
    (x) => ({ fromBillId: x.restTab }),
    deliTableZone,
  ],
  [
    "POST /api/bills/:id/merge (from)",
    "POST",
    (x) => `/api/bills/${x.restTab}/merge`,
    (x) => ({ fromBillId: x.deliTab }),
    deliTableZone,
  ],
  [
    "POST /api/bills/:id/transfer (from)",
    "POST",
    (x) => `/api/bills/${x.deliTab}/transfer`,
    (x) => ({ toBillId: x.restTab, transfers: [] }),
    deliTableZone,
  ],
  [
    "POST /api/bills/:id/transfer (to)",
    "POST",
    (x) => `/api/bills/${x.restTab}/transfer`,
    (x) => ({ toBillId: x.deliTab, transfers: [] }),
    deliTableZone,
  ],
  [
    "POST /api/bills/:id/move (bill)",
    "POST",
    (x) => `/api/bills/${x.deliTab}/move`,
    (x) => ({ to: { tableId: x.restFreeTable } }),
    deliTableZone,
  ],
  [
    "POST /api/bills/:id/move (table)",
    "POST",
    (x) => `/api/bills/${x.restTab}/move`,
    (x) => ({ to: { tableId: x.deliTable } }),
    deliTableZone,
  ],
  [
    "POST /api/bills/:id/move (counter)",
    "POST",
    (x) => `/api/bills/${x.restTab}/move`,
    (x) => ({ to: { counter: { zoneId: x.deliCounter } } }),
    deliOrderZone,
  ],
  [
    "GET /api/working-orders/:id/payments",
    "GET",
    (x) => `/api/working-orders/${x.deliOrder}/payments`,
    undefined,
    deliOrderZone,
  ],
  [
    "POST /api/working-orders/:id/payments/preview",
    "POST",
    (x) => `/api/working-orders/${x.deliOrder}/payments/preview`,
    () => ({}),
    deliOrderZone,
  ],
  [
    "POST /api/working-orders/:id/payments",
    "POST",
    (x) => `/api/working-orders/${x.deliOrder}/payments`,
    () => ({}),
    deliOrderZone,
  ],
  [
    "POST /api/working-orders/:id/payments/:paymentId/refunds",
    "POST",
    (x) => `/api/working-orders/${x.deliOrder}/payments/${id}/refunds`,
    () => ({}),
    deliOrderZone,
  ],
  [
    "POST /api/working-orders/:id/adjustments",
    "POST",
    (x) => `/api/working-orders/${x.deliOrder}/adjustments`,
    () => adjustment(),
    deliOrderZone,
  ],
  [
    "POST /api/working-orders/:id/adjustments/preview",
    "POST",
    (x) => `/api/working-orders/${x.deliOrder}/adjustments/preview`,
    () => adjustment(),
    deliOrderZone,
  ],
];

describe("a kitchen display", () => {
  it("receives the Restaurant's and the Deli's work at its station, and cannot browse either department's orders", async () => {
    const [station] = await suite.db
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(eq(kitchenStations.isDefault, true));
    const [kitchen] = await suite.db
      .insert(deviceProfiles)
      .values({
        name: `Kitchen ${randomUUID()}`,
        formFactor: "kds",
        capabilities: ["act-as-kds", "prepare-orders"],
      })
      .returning({ id: deviceProfiles.id });
    const device = await enrolDeviceForTest(suite.db, v.cfg, {
      name: `Kitchen ${randomUUID()}`,
      profileId: kitchen!.id,
      stationId: station!.id,
    });
    const display = `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
    const fire = async (tableId: string, menuItemId: string) => {
      const seated = await seat(v, tableId);
      await inTx(v, (tx) =>
        placeGroups(tx, v.cfg, seated.partyId, {
          groups: [{ lines: [{ menuItemId, quantity: "1" }], release: "fire" }],
          operatorId: OPERATOR,
        }),
      );
      return seated;
    };
    const deliTable = await inTx(v, (tx) =>
      createTable(tx, v.cfg, { label: `D${randomUUID().slice(0, 4)}`, zoneId: f.deliTables }),
    );
    const restTable = () => v.table(`R${randomUUID().slice(0, 4)}`);
    const deliRound = await fire(deliTable.id, f.deliTablesItem);
    const restRound = await fire(await restTable(), v.item("Agua"));
    // One more order from each department, its dish then moved to another station.
    const pastry = await inTx(v, (tx) =>
      createStation(tx, v.cfg, { name: `Pastry ${randomUUID().slice(0, 4)}` }),
    );
    const elsewhere = [
      await fire(
        (
          await inTx(v, (tx) =>
            createTable(tx, v.cfg, { label: `D${randomUUID().slice(0, 4)}`, zoneId: f.deliTables }),
          )
        ).id,
        f.deliTablesItem,
      ),
      await fire(await restTable(), v.item("Agua")),
    ];
    for (const round of elsewhere) {
      const lines = await suite.db
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, round.tabId));
      await inTx(v, (tx) =>
        moveDishesToStation(tx, v.cfg, round.tabId, {
          submissionId: randomUUID(),
          lineIds: lines.map((line) => line.id),
          stationId: pastry.id,
        }),
      );
    }

    const queue = await send(display, "GET", "/api/device/station");
    expect(queue.status).toBe(200);
    const orders = (queue.body.station as { queue: StationQueueGroup[] }).queue.map(
      (group) => group.orderId,
    );
    expect(orders).toEqual(expect.arrayContaining([deliRound.tabId, restRound.tabId]));
    for (const round of elsewhere) expect(orders).not.toContain(round.tabId);

    for (const path of [
      "/api/working-orders",
      `/api/working-orders/${deliRound.tabId}`,
      `/api/working-orders/${restRound.tabId}`,
      `/api/parties/${deliRound.partyId}/current-orders`,
      `/api/parties/${restRound.partyId}/bills`,
    ]) {
      const answer = await send(display, "GET", path);
      expect({ path, status: answer.status, code: answer.body.error?.code }).toEqual({
        path,
        status: 401,
        code: "session.required",
      });
    }
  });
});

describe("a Restaurant profile on another department's zone", () => {
  it.each(ROUTES)("refuses %s", async (_name, method, path, body, zone) => {
    const answer = await send(restaurant, method, path(f), body?.(f));
    expect(answer).toEqual(notAllowed(zone(f)));
  });

  it("leaves the refused Deli party, table and order as they were", async () => {
    await send(restaurant, "PUT", `/api/parties/${f.deliParty}/name`, {
      name: "Renamed",
      expectedPartyRevision: 0,
    });
    await send(restaurant, "DELETE", `/api/working-orders/${f.deliOrder}`);
    const [order] = await inTx(v, (tx) =>
      tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, f.deliOrder)),
    );
    expect(order!.status).toBe("open");
    expect((await partyRow(v, f.deliParty)).name).toBeNull();
  });
});

describe("a profile with no department row", () => {
  it.each(ROUTES.filter(([, method]) => method === "GET"))(
    "answers %s without a zone refusal",
    async (_name, method, path) => {
      const answer = await send(plain, method, path(f));
      expect(answer.body.error?.code).not.toBe("service_zone.not_allowed");
    },
  );

  it("starts at the counter default and lists every department's counter zones", async () => {
    const answer = await send(plain, "GET", "/api/default-service-zone/offers");
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ context: { zoneId: f.counter } });
    const zones = (answer.body.zones as { id: string }[]).map((zone) => zone.id);
    expect(zones).toEqual(expect.arrayContaining([f.counter, f.bar, f.deliCounter]));
  });

  it("lists every zone, table and open order", async () => {
    const zones = await send(plain, "GET", "/api/zones");
    expect((zones.body as unknown as { id: string }[]).map((zone) => zone.id)).toEqual(
      expect.arrayContaining([f.deliTables, f.deliCounter, f.restTables]),
    );
    for (const path of ["/api/tables", "/api/tables/state"]) {
      const tables = await send(plain, "GET", path);
      expect((tables.body as unknown as { id: string }[]).map((table) => table.id)).toEqual(
        expect.arrayContaining([f.deliTable, f.restTable]),
      );
    }
    const orders = await send(plain, "GET", "/api/working-orders");
    expect((orders.body as unknown as { id: string }[]).map((order) => order.id)).toEqual(
      expect.arrayContaining([f.deliOrder, f.restOrder]),
    );
  });
});

describe("a Restaurant profile in its own zones", () => {
  it("starts at the profile's starting zone and lists only its own counter zones", async () => {
    const answer = await send(restaurant, "GET", "/api/default-service-zone/offers");
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ context: { zoneId: f.bar } });
    const zones = (answer.body.zones as { id: string }[]).map((zone) => zone.id);
    expect(zones).toEqual(expect.arrayContaining([f.bar, f.counter]));
    expect(zones).not.toContain(f.deliCounter);
    const state = await send(restaurant, "GET", "/api/menu-state");
    const atBar = await send(restaurant, "GET", `/api/menu-state?zoneId=${f.bar}`);
    expect(state).toEqual(atBar);
  });

  it("orders a Deli menu's item where the bar offers it", async () => {
    const orderId = randomUUID();
    const answer = await send(restaurant, "POST", "/api/working-orders", {
      id: orderId,
      lines: [{ menuItemId: f.deliSpecial, quantity: "1" }],
      zoneId: f.bar,
    });
    expect(answer.status).toBe(200);
    const read = await send(restaurant, "GET", `/api/working-orders/${orderId}`);
    expect(read.status).toBe(200);
  });

  it("opens a new order with no zone named in the profile's starting zone", async () => {
    const orderId = randomUUID();
    const answer = await send(restaurant, "POST", "/api/working-orders", {
      id: orderId,
      lines: [{ menuItemId: f.deliSpecial, quantity: "1" }],
    });
    expect(answer.status).toBe(200);
    const zones = await inTx(v, (tx) => VENUE_SERVICE.findOrderZones(tx, v.cfg, [orderId]));
    expect(zones.get(orderId)).toBe(f.bar);
  });

  it("lists only the profile's zones, tables and orders", async () => {
    const zones = await send(restaurant, "GET", "/api/zones");
    const zoneIds = (zones.body as unknown as { id: string }[]).map((zone) => zone.id);
    expect(zoneIds).toEqual(expect.arrayContaining([f.restTables, f.bar]));
    expect(zoneIds).not.toContain(f.deliTables);
    expect(zoneIds).not.toContain(f.deliCounter);
    for (const path of ["/api/tables", "/api/tables/state"]) {
      const tables = await send(restaurant, "GET", path);
      const tableIds = (tables.body as unknown as { id: string }[]).map((table) => table.id);
      expect(tableIds).toContain(f.restTable);
      expect(tableIds).not.toContain(f.deliTable);
    }
    const orders = await send(restaurant, "GET", "/api/working-orders");
    const orderIds = (orders.body as unknown as { id: string }[]).map((order) => order.id);
    expect(orderIds).toContain(f.restOrder);
    expect(orderIds).not.toContain(f.deliOrder);
    expect(orderIds).not.toContain(f.deliTab);
  });

  it("lists only the profile's orders waiting at the counter", async () => {
    const deliPlaced = await park(f.deliCounter, f.deliItem);
    const restPlaced = await park(f.bar, f.deliSpecial);
    await inTx(v, (tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, deliPlaced)),
    );
    await inTx(v, (tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, restPlaced)),
    );
    const waiting = await send(restaurant, "GET", "/api/orders/counter-waiting");
    const ids = (waiting.body as unknown as { id: string }[]).map((order) => order.id);
    expect(ids).toContain(restPlaced);
    expect(ids).not.toContain(deliPlaced);
    const all = await send(plain, "GET", "/api/orders/counter-waiting");
    expect((all.body as unknown as { id: string }[]).map((order) => order.id)).toContain(
      deliPlaced,
    );
  });

  it("refuses a Restaurant zone moved to the Deli after the profile was saved, as it refuses the Deli's", async () => {
    const { terrace, table } = await inTx(v, async (tx) => {
      const zone = await createServiceZone(tx, v.cfg, {
        name: "Terrace",
        departmentId: await departmentOf(tx, v.tables.zoneId),
      });
      await offerProducts(tx, v.cfg, { zone: { zoneId: zone.id }, serviceMode: "table_tab" });
      return {
        terrace: zone.id,
        table: (await createTable(tx, v.cfg, { label: "T9", zoneId: zone.id })).id,
      };
    });
    const { partyId } = await seat(v, table);
    expect((await send(restaurant, "GET", `/api/service-zones/${terrace}/offers`)).status).toBe(
      200,
    );
    expect((await send(restaurant, "GET", `/api/parties/${partyId}/bills`)).status).toBe(200);
    const [deli] = await inTx(v, (tx) =>
      tx
        .select({ departmentId: zoneServicePolicies.departmentId })
        .from(zoneServicePolicies)
        .where(eq(zoneServicePolicies.zoneId, f.deliCounter)),
    );
    await inTx(v, (tx) =>
      configureZone(tx, v.cfg, { zoneId: terrace, departmentId: deli!.departmentId }),
    );
    expect(await send(restaurant, "GET", `/api/service-zones/${terrace}/offers`)).toEqual(
      notAllowed(terrace),
    );
    expect(await send(restaurant, "GET", `/api/parties/${partyId}/bills`)).toEqual(
      notAllowed(terrace),
    );
  });

  it("refuses a Restaurant zone deactivated after the profile was saved", async () => {
    const patio = await inTx(v, async (tx) => {
      const zone = await createServiceZone(tx, v.cfg, {
        name: "Patio",
        departmentId: await departmentOf(tx, v.tables.zoneId),
      });
      await offerProducts(tx, v.cfg, { zone: { zoneId: zone.id } });
      return zone.id;
    });
    expect((await send(restaurant, "GET", `/api/service-zones/${patio}/offers`)).status).toBe(200);
    await inTx(v, (tx) => deactivateServiceZone(tx, v.cfg, patio));
    expect(await send(restaurant, "GET", `/api/service-zones/${patio}/offers`)).toEqual(
      notAllowed(patio),
    );
  });

  it("cannot order once no zone of the profile is left", async () => {
    const profileId = await profile();
    const zoneId = await inTx(v, async (tx) => {
      const restaurantId = await departmentOf(tx, v.tables.zoneId);
      const zone = await createServiceZone(tx, v.cfg, {
        name: "Snug",
        departmentId: restaurantId,
      });
      await setProfileServiceAccess(tx, v.cfg, profileId, {
        departmentId: restaurantId,
        allowedZoneIds: [zone.id],
        startingZoneId: zone.id,
        stationIds: [],
        watcherIds: [],
      });
      return zone.id;
    });
    const cookie = await signIn(profileId);
    await inTx(v, (tx) => deactivateServiceZone(tx, v.cfg, zoneId));
    expect(await send(cookie, "GET", "/api/default-service-zone/offers")).toEqual({
      status: 409,
      body: { error: { code: "device_profile.no_service_zone", params: { profileId } } },
    });
  });
});

describe("the bill and invoice lookups", () => {
  const ids = (body: Record<string, unknown>, key: string) =>
    (body[key] as { workingOrderId: string }[]).map((row) => row.workingOrderId);

  /** A seated party named `name`, whose bill waits for payment. */
  async function unpaidBill(tableId: string, menuItemId: string, name: string): Promise<string> {
    const seated = await seatWithRound(tableId, menuItemId);
    await inTx(v, async (tx) => {
      await tx.update(parties).set({ name }).where(eq(parties.id, seated.partyId));
      await tx
        .update(workingOrders)
        .set({ status: "placed" })
        .where(eq(workingOrders.id, seated.tabId));
    });
    return seated.tabId;
  }

  /** A seated party's bill, invoiced in full to `legalName` and paid. */
  async function invoiced(tableId: string, menuItemId: string, legalName: string): Promise<string> {
    await inTx(v, (tx) =>
      tx.update(tenants).set({ taxpayerDomicile: "Calle Mayor 1, 28013 Madrid" }),
    );
    const { tabId } = await seatWithRound(tableId, menuItemId);
    const lines = await send(plain, "GET", `/api/working-orders/${tabId}/lines`);
    const chosen = await send(plain, "PUT", `/api/working-orders/${tabId}/invoice-choice`, {
      revision: lines.body.revision,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName,
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    expect(chosen).toMatchObject({ status: 200 });
    // Through the payment's completion, as `bill-payments.test.ts` files one: the till's payment
    // route refuses a bill chosen for a full invoice.
    await inTx(v, async (tx) => {
      const [payment] = await tx
        .insert(billPayments)
        .values({
          workingOrderId: tabId,
          submissionId: randomUUID(),
          fingerprint: "f",
          kind: "contribution",
          method: "card",
          applied: 200,
          state: "pending",
          requestedBy: OPERATOR,
          source: v.cfg.origin.source,
          deviceId: v.cfg.origin.deviceId,
        })
        .returning({ id: billPayments.id });
      await completeBillPayment(
        tx,
        { db: suite.db, backend: v.backend, clock: v.clock, log: noopLog },
        v.cfg,
        payment!.id,
        new Date(),
      );
    });
    return tabId;
  }

  const deliTable = (label: string) =>
    inTx(v, async (tx) => (await createTable(tx, v.cfg, { label, zoneId: f.deliTables })).id);
  const deliTableItem = async () =>
    (
      await inTx(v, (tx) =>
        offerProducts(tx, v.cfg, { zone: { zoneId: f.deliTables }, serviceMode: "table_tab" }),
      )
    ).offerFor(v.productId("Agua"));

  it("shows a Deli bill to the Deli and to a profile with no department, never to the Restaurant", async () => {
    const deliBill = await unpaidBill(
      await inTx(
        v,
        async (tx) => (await createTable(tx, v.cfg, { label: "D7", zoneId: f.deliTables })).id,
      ),
      (
        await inTx(v, (tx) =>
          offerProducts(tx, v.cfg, { zone: { zoneId: f.deliTables }, serviceMode: "table_tab" }),
        )
      ).offerFor(v.productId("Agua")),
      "Lookup Deli",
    );
    const restBill = await unpaidBill(await v.table("R7"), v.item("Agua"), "Lookup Sala");
    const as = async (cookie: string) => {
      const answer = await send(cookie, "GET", "/api/bills/lookup?q=Lookup");
      expect(answer.status).toBe(200);
      return ids(answer.body, "bills");
    };
    expect(await as(restaurant)).toEqual([restBill]);
    expect(await as(deli)).toEqual([deliBill]);
    expect((await as(plain)).sort()).toEqual([deliBill, restBill].sort());
  });

  it("shows a Deli invoice to the Deli and to a profile with no department, never to the Restaurant", async () => {
    const deliInvoice = await invoiced(
      await deliTable("D8"),
      await deliTableItem(),
      "Lookup Deli Invoices SL",
    );
    const restInvoice = await invoiced(
      await v.table("R9"),
      v.item("Agua"),
      "Lookup Sala Invoices SL",
    );
    const as = async (cookie: string) => {
      const answer = await send(cookie, "GET", "/api/invoices/lookup?q=Invoices");
      expect(answer.status).toBe(200);
      return ids(answer.body, "invoices");
    };
    expect(await as(restaurant)).toEqual([restInvoice]);
    expect(await as(deli)).toEqual([deliInvoice]);
    expect((await as(plain)).sort()).toEqual([deliInvoice, restInvoice].sort());
  });

  it("fills the Restaurant's page past twenty Deli invoices that match first", async () => {
    const restInvoice = await invoiced(await v.table("R10"), v.item("Agua"), "Packed Sala SL");
    const item = await deliTableItem();
    for (let index = 0; index < 21; index++) {
      await invoiced(await deliTable(`DI${index}`), item, `Packed Deli ${index} SL`);
    }
    const answer = await send(restaurant, "GET", "/api/invoices/lookup?q=Packed");
    expect(ids(answer.body, "invoices")).toEqual([restInvoice]);
  });

  it("fills the Restaurant's page past twenty Deli bills that match first", async () => {
    const restBill = await unpaidBill(await v.table("R8"), v.item("Agua"), "Crowded Sala");
    const deliItem = (
      await inTx(v, (tx) =>
        offerProducts(tx, v.cfg, { zone: { zoneId: f.deliTables }, serviceMode: "table_tab" }),
      )
    ).offerFor(v.productId("Agua"));
    for (let index = 0; index < 21; index++) {
      const table = await inTx(
        v,
        async (tx) =>
          (await createTable(tx, v.cfg, { label: `DC${index}`, zoneId: f.deliTables })).id,
      );
      await unpaidBill(table, deliItem, `Crowded Deli ${index}`);
    }
    const answer = await send(restaurant, "GET", "/api/bills/lookup?q=Crowded");
    expect(ids(answer.body, "bills")).toEqual([restBill]);
  });

  it("reads one page, however many Deli bills and invoices the Restaurant's lookup hides", async () => {
    const reads = (lookUp: (tx: Transaction) => Promise<unknown>) =>
      withTransaction(suite.db, async (tx) => {
        const spies = [
          vi.spyOn(tx, "select"),
          vi.spyOn(tx, "selectDistinct"),
          vi.spyOn(tx, "execute"),
        ];
        try {
          await lookUp(tx);
          return spies.reduce((count, spy) => count + spy.mock.calls.length, 0);
        } finally {
          for (const spy of spies) spy.mockRestore();
        }
      });
    const restaurantOnly = (tx: Transaction) => lookupScope(tx, restaurantProfile);
    expect(await reads(async (tx) => lookUpBills(tx, "Crowded", await restaurantOnly(tx)))).toBe(
      await reads(async (tx) => lookUpBills(tx, "Crowded Sala", await restaurantOnly(tx))),
    );
    expect(await reads(async (tx) => lookUpInvoices(tx, "Packed", await restaurantOnly(tx)))).toBe(
      await reads(async (tx) => lookUpInvoices(tx, "Packed Sala", await restaurantOnly(tx))),
    );
  });
});
