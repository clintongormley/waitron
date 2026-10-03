import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import {
  billPayments,
  deviceProfiles,
  sales,
  tenders,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, loginWithPin, persons } from "@waitron/identity";
import { cardReaders, deviceCardReaders } from "@waitron/payments";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { createPrinter } from "@waitron/printing";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  AppError,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { CardProviderPool } from "../card-provider-pool.js";
import { deploymentEnvironment } from "../config.js";
import { DEVICE_COOKIE } from "../device-session.js";
import type { Logger } from "../logger.js";
import { ALL_MODULES } from "../modules.js";
import { createTable } from "../tables.js";
import type { TillConfig } from "../till-config.js";
import { mountTillApi } from "../till-api.js";
import { systemClock } from "../till-backend.js";
import { SESSION_COOKIE } from "../till-session.js";
import { openPartyTab } from "./serve-line.js";
import { enrolDeviceForTest } from "./enrol.js";
import { offerProducts } from "./zone-offers.js";
import { partyRevisionOfOrder } from "../parties.js";
import { parkOrder, placeOrder } from "../working-order.js";

/**
 * A provisioned venue for the bill payment suites that take a card on a reader: real Veri*Factu
 * filing, two enrolled tills each with its own reader, and a {@link FakePaymentProvider} behind the
 * reader pool, so a suite can hold, stall, fail or crash a collect.
 */
const LOCALE = "es-ES";

// Each product's staff, customer-facing and kitchen names differ (docs/developers/products.md).
const MENU: { name: string; customer: string; kitchen: string; price: string }[] = [
  { name: "Paella", customer: "Paella valenciana", kitchen: "PAELLA", price: "35.00" },
  { name: "Chuletón", customer: "Chuletón a la brasa", kitchen: "CHULETA", price: "25.00" },
  { name: "Botella tinto", customer: "Rioja crianza", kitchen: "TINTO", price: "30.00" },
  { name: "Ensalada", customer: "Ensalada de la casa", kitchen: "ENSAL", price: "12.00" },
  { name: "Tarta", customer: "Tarta de queso", kitchen: "TARTA", price: "18.00" },
  { name: "Caña", customer: "Caña de cerveza", kitchen: "CANA", price: "3.00" },
  { name: "Croquetas", customer: "Croquetas de jamón", kitchen: "CROQ", price: "10.00" },
  { name: "Pulpo", customer: "Pulpo a la gallega", kitchen: "PULPO", price: "20.00" },
];

export interface BillVenue {
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
  /** The box's configuration, tips off. */
  cfg: TillConfig;
  card: FakePaymentProvider;
  /** Serves the fake card provider as `fake`. */
  pool: CardProviderPool;
  /** Tips on. */
  app: Hono;
  /** The same routes, tips on, on another clock. */
  appAt(clock: TrustedClock): Hono;
  /** The same routes with the venue's tips off. */
  appTipsOff: Hono;
  /** The first till's session and device. */
  cookie: string;
  /** The second till's session and device. */
  cookie2: string;
  /** A till whose profile does not declare `integrated-card-payment`. */
  cookieNoCard: string;
  deviceTillId: string;
  device2TillId: string;
  operatorId: string;
  /** The provisioned administrator, PIN 1234. */
  adminId: string;
  offerFor(name: string): string;
  zoneId: string;
}

const quiet: Logger = () => {};

export async function provisionBillVenue(db: Database): Promise<BillVenue> {
  const clock = systemClock();
  const backend = new VerifactuBackend({
    clock,
    db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () => Promise.reject(new Error("a sale never submits inline")),
  });
  const provisioned = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "61000002T",
        legalName: "Tarjetas SL",
        location: {
          name: "Sala",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Restaurante",
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
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db, modules: ALL_MODULES },
  );
  const cfg: TillConfig = {
    tillId: brandTillId(provisioned.tillId),
    nodeId: brandNodeId(provisioned.nodeId),
    seriesId: brandSeriesId(provisioned.seriesIds[0]!),
    locationId: brandLocationId(provisioned.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
    orderFlow: "prepay",
  };
  const seeded = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Carta" });
    const platos = await createCategory(tx, { name: "Platos" });
    const productIds = new Map<string, string>();
    for (const item of MENU) {
      const product = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: platos.id,
        name: item.name,
        customerName: { [LOCALE]: item.customer },
        kitchenName: item.kitchen,
        pricingUnit: "each",
        unitPrice: item.price,
        vatClass: "general",
      });
      productIds.set(item.name, product.id);
    }
    await assignCatalogueToLocation(tx, provisioned.locationId, cat.id);
    const offers = await offerProducts(tx, cfg, { zone: "tables" });
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    const [profile, cashOnly] = await tx
      .insert(deviceProfiles)
      .values([
        {
          name: "Counter till",
          formFactor: "till",
          capabilities: ["integrated-card-payment", "open-cash-drawer", "take-cash"],
        },
        { name: "Cash till", formFactor: "till", capabilities: ["open-cash-drawer", "take-cash"] },
      ])
      .returning({ id: deviceProfiles.id });
    const printer = await createPrinter(
      tx,
      { locationId: cfg.locationId },
      {
        name: "Recibos",
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
        hasCashDrawer: true,
      },
    );
    const readers = await tx
      .insert(cardReaders)
      .values([
        { provider: "fake", providerRef: "reader-1", name: "Lector 1" },
        { provider: "fake", providerRef: "reader-2", name: "Lector 2" },
      ])
      .returning({ id: cardReaders.id });
    return {
      productIds,
      offers,
      personId: person!.id,
      profileId: profile!.id,
      cashOnlyProfileId: cashOnly!.id,
      printerId: printer.id,
      readerIds: readers.map((reader) => reader.id),
    };
  });
  const session = await withTransaction(db, (tx) =>
    loginWithPin(tx, { tillId: cfg.tillId, personId: seeded.personId, pin: "5555" }),
  );
  const devices = [];
  for (const [index, name] of ["Barra", "Terraza"].entries()) {
    const device = await enrolDeviceForTest(db, cfg, { name, profileId: seeded.profileId });
    await db
      .insert(deviceCardReaders)
      .values({ deviceId: device.deviceId, readerId: seeded.readerIds[index]! });
    const [row] = db.all<{ till_id: string }>(
      sql`select till_id from devices where id = ${device.deviceId}`,
    );
    devices.push({ ...device, tillId: row!.till_id });
  }
  const cashOnlyDevice = await enrolDeviceForTest(db, cfg, {
    name: "Caja efectivo",
    profileId: seeded.cashOnlyProfileId,
  });
  db.run(sql`update tills set receipt_printer_id = ${seeded.printerId}`);

  const card = new FakePaymentProvider(db);
  const pool: CardProviderPool = {
    get: (providerId) =>
      providerId === "fake"
        ? Promise.resolve(card)
        : Promise.reject(new AppError("payment.provider_unknown", { providerId })),
    evict: () => {},
  };
  const mount = (tipsEnabled: boolean, at: TrustedClock = clock): Hono => {
    const app = new Hono();
    mountTillApi(
      app,
      {
        db,
        backend,
        clock: at,
        cfg: { ...cfg, tipsEnabled },
        secureCookies: false,
        venueLocale: LOCALE,
        pool,
      },
      quiet,
    );
    return app;
  };
  const cookieFor = (device: { deviceId: string; token: string }) =>
    `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
  return {
    db,
    backend,
    clock,
    cfg,
    card,
    pool,
    app: mount(true),
    appAt: (at) => mount(true, at),
    appTipsOff: mount(false),
    cookie: cookieFor(devices[0]!),
    cookie2: cookieFor(devices[1]!),
    cookieNoCard: cookieFor(cashOnlyDevice),
    deviceTillId: devices[0]!.tillId,
    device2TillId: devices[1]!.tillId,
    operatorId: seeded.personId,
    adminId: db.all<{ id: string }>(sql`select id from persons where role = 'admin'`)[0]!.id,
    offerFor: (name) => seeded.offers.offerFor(seeded.productIds.get(name)!),
    zoneId: seeded.offers.zoneId,
  };
}

/** A fresh party's bill at a fresh table carrying one of each named dish, in order (line 1, 2, …). */
export function tabWith(venue: BillVenue, ...names: string[]): Promise<string> {
  return withTransaction(venue.db, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `M-${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    });
    const { tabId } = await openPartyTab(tx, venue.cfg, {
      tableId: table.id,
      lines: names.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
    });
    return tabId;
  });
}

export interface Answer {
  status: number;
  /** A refusal answers `{ error: { code, params } }`; read as its code and params. */
  json: Record<string, unknown>;
}

export async function send(
  app: Hono,
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Answer> {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  const parsed = res.headers.get("content-type")?.includes("json")
    ? (JSON.parse(text) as Record<string, unknown>)
    : { body: text };
  const json = (parsed.error as Record<string, unknown> | undefined) ?? parsed;
  return { status: res.status, json };
}

export function inTx<T>(venue: BillVenue, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(venue.db, fn);
}

/** The revision of the party the bill belongs to, as a bill route is sent it. */
export async function partyRevisionOf(venue: BillVenue, billId: string): Promise<number> {
  const party = await inTx(venue, (tx) => partyRevisionOfOrder(tx, billId));
  return party!.revision;
}

export function paymentRows(venue: BillVenue, billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select()
      .from(billPayments)
      .where(eq(billPayments.workingOrderId, billId))
      .orderBy(billPayments.createdAt),
  );
}

export async function statusOf(venue: BillVenue, billId: string): Promise<string> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId)),
  );
  return row!.status;
}

export function registroCount(venue: BillVenue, billId: string): number {
  const [row] = venue.db.all<{ count: string }>(sql`
    select cast(count(*) as text) as count
    from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${billId}
  `);
  return Number(row!.count);
}

export async function tendersOfBill(venue: BillVenue, billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({
        method: tenders.method,
        amount: tenders.amount,
        tip: tenders.tipAmount,
        billPaymentId: tenders.billPaymentId,
        saleTillId: sales.tillId,
      })
      .from(tenders)
      .innerJoin(sales, eq(sales.id, tenders.saleId))
      .where(eq(sales.workingOrderId, billId)),
  );
}

/**
 * A party seated through the till's routes at a fresh table, made with `createTable`, one of each
 * named dish sent to the kitchen as one group on its main bill, in order (line 1, 2, …). `revision`
 * is the party's after the order.
 */
export async function seatedWith(
  venue: BillVenue,
  ...names: string[]
): Promise<{ partyId: string; tabId: string; tableId: string; revision: number }> {
  const { id: tableId } = await withTransaction(venue.db, (tx) =>
    createTable(tx, venue.cfg, { label: `Mesa ${randomUUID().slice(0, 8)}`, zoneId: venue.zoneId }),
  );
  const seated = await send(venue.app, venue.cookie, "POST", `/api/tables/${tableId}/seat`, {});
  if (seated.status !== 200) throw new Error(`seatedWith: seating answered ${seated.status}`);
  const partyId = seated.json.partyId as string;
  if (names.length > 0) {
    const ordered = await send(venue.app, venue.cookie, "POST", `/api/parties/${partyId}/groups`, {
      submissionId: randomUUID(),
      expectedPartyRevision: seated.json.revision,
      groups: [
        {
          lines: names.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
          release: "fire",
        },
      ],
    });
    if (ordered.status !== 200) throw new Error(`seatedWith: ordering answered ${ordered.status}`);
  }
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return { partyId, tabId: seated.json.tabId as string, tableId, revision: row!.revision };
}

/**
 * A counter order of one Tarta (18.00) placed in `zoneId`, then moved through the till's route to
 * the party at `party.tableId`; answers its id. Placed in an `invoice_first` zone, its invoice is
 * filed at placing; in a `prepay` zone, none is.
 */
export async function placedCounterBillMovedTo(
  venue: BillVenue,
  zoneId: string,
  party: { partyId: string; tableId: string },
): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
    zoneId,
    operatorId: venue.operatorId,
  });
  await placeOrder(deps, venue.cfg, id, venue.operatorId, venue.cfg.tillId);
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${party.partyId}`,
  );
  const moved = await send(venue.app, venue.cookie, "POST", `/api/bills/${id}/move`, {
    to: { tableId: party.tableId },
    otherPartyId: party.partyId,
    expectedOtherPartyRevision: row!.revision,
  });
  if (moved.status !== 200) {
    throw new Error(`placedCounterBillMovedTo: moving answered ${moved.status}`);
  }
  return id;
}
