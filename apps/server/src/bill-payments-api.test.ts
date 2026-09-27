import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billPaymentLines,
  billPaymentRefunds,
  billPayments,
  deviceProfiles,
  drawerOpens,
  printJobs,
  products,
  saleLines,
  sales,
  tenders,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, loginWithPin, persons } from "@waitron/identity";
import { insertCapturedPayment, payments, SimulatorPaymentProvider } from "@waitron/payments";
import { createPrinter } from "@waitron/printing";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  basisPointsToDecimal,
  centsToDecimal,
  decimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  thousandthsToDecimal,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { DEVICE_COOKIE } from "./device-session.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { createTable } from "./tables.js";
import { printedLines } from "./testing/decode-ticket.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import type { TillConfig } from "./till-config.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { openTab } from "./working-order.js";
import "./errors.js";

// The bill payment routes (bill payments design §8 tests 2, 4, 5, 6, 7, 8, 9, 11, 14 and 15, and plan
// D8), driven over HTTP against a provisioned venue that files real Veri*Factu records. Each case
// opens its own tab, so a count read back is that case's alone.
const LOCALE = "es-ES";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provision(db);
  },
});

let backend: FiscalBackend;
let clock: TrustedClock;

interface Venue {
  cfg: TillConfig;
  offers: ZoneOffers;
  /** Product id by the staff name. */
  productIds: Map<string, string>;
  app: Hono;
  cookie: string;
  /** The operator's session with no device. */
  sessionCookie: string;
  /** The operator's session on a handheld, which never opens a cash drawer. */
  handheldCookie: string;
  /** The till the enrolled device rings on. */
  deviceTillId: string;
  printerId: string;
  /** The session's operator, a member of staff, who does not hold `sale.refund`. */
  staffId: string;
  /** The provisioned admin, who does. */
  adminId: string;
}
let venue: Venue;

// Each product's staff, customer-facing and kitchen names differ (docs/developers/products.md), so
// a surface reading the wrong one is seen.
const MENU: { name: string; customer: string; kitchen: string; price: string }[] = [
  { name: "Paella", customer: "Paella valenciana", kitchen: "PAELLA", price: "35.00" },
  { name: "Chuletón", customer: "Chuletón a la brasa", kitchen: "CHULETA", price: "25.00" },
  { name: "Botella tinto", customer: "Rioja crianza", kitchen: "TINTO", price: "30.00" },
  { name: "Ensalada", customer: "Ensalada de la casa", kitchen: "ENSAL", price: "12.00" },
  { name: "Tarta", customer: "Tarta de queso", kitchen: "TARTA", price: "18.00" },
  { name: "Caña", customer: "Caña de cerveza", kitchen: "CANA", price: "3.00" },
  { name: "Mariscada", customer: "Mariscada para dos", kitchen: "MARISC", price: "100.01" },
  { name: "Pulpo", customer: "Pulpo a la gallega", kitchen: "PULPO", price: "20.00" },
  { name: "Croquetas", customer: "Croquetas de jamón", kitchen: "CROQ", price: "10.00" },
];

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
      throw new Error("bill-payments-api.test: anchor() is not used");
    },
    currentAnchor: () => null,
  };
}

const quiet: Logger = () => {};

async function provision(db: typeof suite.db): Promise<Venue> {
  clock = systemClock();
  backend = new VerifactuBackend({
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
        taxId: "61000001K",
        legalName: "Cuentas SL",
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
    orderFlow: "prepay",
  };
  const seeded = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Carta" });
    const platos = await createCategory(tx, { name: { [LOCALE]: "Platos" } });
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
    const [profile] = await tx
      .insert(deviceProfiles)
      .values({
        name: "Counter till",
        formFactor: "till",
        capabilities: ["integrated-card-payment", "open-cash-drawer"],
      })
      .returning({ id: deviceProfiles.id });
    const [handheldProfile] = await tx
      .insert(deviceProfiles)
      .values({ name: "Handheld", formFactor: "phone-portrait" })
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
    return {
      productIds,
      offers,
      personId: person!.id,
      profileId: profile!.id,
      handheldProfileId: handheldProfile!.id,
      printerId: printer.id,
    };
  });
  const session = await withTransaction(db, (tx) =>
    loginWithPin(tx, { tillId: cfg.tillId, personId: seeded.personId, pin: "5555" }),
  );
  const device = await enrolDeviceForTest(db, cfg, { name: "Barra", profileId: seeded.profileId });
  const handheld = await enrolDeviceForTest(db, cfg, {
    name: "Terraza",
    profileId: seeded.handheldProfileId,
    registerId: cfg.tillId,
  });
  const [deviceRow] = db.all<{ till_id: string }>(
    sql`select till_id from devices where id = ${device.deviceId}`,
  );
  const [admin] = db.all<{ id: string }>(sql`select id from persons where role = 'admin'`);
  // Every till, so the device's own till prints and opens its drawer whichever one it is.
  db.run(sql`update tills set receipt_printer_id = ${seeded.printerId}`);
  const app = new Hono();
  mountTillApi(
    app,
    {
      db,
      backend,
      clock,
      cfg,
      secureCookies: false,
      venueLocale: LOCALE,
      cardProvider: new SimulatorPaymentProvider(db),
    },
    quiet,
  );
  return {
    cfg,
    offers: seeded.offers,
    productIds: seeded.productIds,
    app,
    cookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
    sessionCookie: `${SESSION_COOKIE}=${session.token}`,
    handheldCookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${handheld.deviceId}.${handheld.token}`,
    deviceTillId: deviceRow!.till_id,
    printerId: seeded.printerId,
    staffId: seeded.personId,
    adminId: admin!.id,
  };
}

const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

function offer(name: string): string {
  return venue.offers.offerFor(venue.productIds.get(name)!);
}

/** A fresh tab at a fresh table carrying one of each named dish, in order (line 1, 2, …). */
async function tabWith(...names: string[]): Promise<string> {
  return inTx(async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `M-${randomUUID().slice(0, 8)}`,
      zoneId: venue.offers.zoneId,
    });
    const { tabId } = await openTab(tx, venue.cfg, {
      tableId: table.id,
      lines: names.map((name) => ({ menuItemId: offer(name), quantity: "1" })),
    });
    return tabId;
  });
}

/** The €120.00 bill of the owner's example: Paella, Chuletón, Botella tinto, Ensalada, Tarta. */
function bill120(): Promise<string> {
  return tabWith("Paella", "Chuletón", "Botella tinto", "Ensalada", "Tarta");
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  cookie = venue.cookie,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await venue.app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  const parsed = res.headers.get("content-type")?.includes("json")
    ? (JSON.parse(text) as Record<string, unknown>)
    : { body: text };
  // A refusal answers `{ error: { code, params } }`; read as its code and params.
  const json = (parsed.error as Record<string, unknown> | undefined) ?? parsed;
  return { status: res.status, json };
}

interface PaymentBody {
  submissionId?: string;
  kind: "items" | "contribution" | "share";
  lines?: { lineNo: number; quantity?: string }[];
  amount?: string;
  shareOf?: number;
  method: "cash" | "card";
  entry?: "manual" | "reader";
  tendered?: string;
  addedTip?: string;
  choice?: "full_with_tip" | "use_pool";
  externalRef?: string;
  applied: string;
  tip: string;
}

function pay(billId: string, body: PaymentBody) {
  return request("POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    ...body,
  });
}

/** A cash contribution of `amount`, handed over exactly. */
function contribute(billId: string, amount: string, submissionId = randomUUID()) {
  return pay(billId, {
    submissionId,
    kind: "contribution",
    amount,
    method: "cash",
    tendered: amount,
    applied: amount,
    tip: "0.00",
  });
}

function balance(billId: string) {
  return request("GET", `/api/working-orders/${billId}/payments`);
}

async function saleOf(billId: string) {
  return inTx((tx) => tx.select().from(sales).where(eq(sales.workingOrderId, billId)));
}

async function tendersOf(saleId: string) {
  return inTx((tx) =>
    tx
      .select({
        method: tenders.method,
        amount: tenders.amount,
        tip: tenders.tipAmount,
        billPaymentId: tenders.billPaymentId,
      })
      .from(tenders)
      .where(eq(tenders.saleId, saleId)),
  );
}

function registroCount(billId: string): number {
  const [row] = suite.db.all<{ count: string }>(sql`
    select cast(count(*) as text) as count
    from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${billId}
  `);
  return Number(row!.count);
}

async function lineTotals(billId: string): Promise<string[]> {
  const rows = await inTx((tx) =>
    tx
      .select({ lineTotal: workingOrderLines.lineTotal })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(workingOrderLines.lineNo),
  );
  return rows.map((row) => centsToDecimal(row.lineTotal));
}

async function paymentRows(billId: string) {
  return inTx((tx) =>
    tx.select().from(billPayments).where(eq(billPayments.workingOrderId, billId)),
  );
}

async function statusOf(billId: string): Promise<string> {
  const [row] = await inTx((tx) =>
    tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId)),
  );
  return row!.status;
}

describe("the balance", () => {
  it("reads a bill with nothing paid as owing its whole total", async () => {
    const billId = await bill120();

    const { status, json } = await balance(billId);

    expect(status).toBe(200);
    expect(json).toMatchObject({
      workingOrderId: billId,
      total: "120.00",
      received: "0.00",
      reserved: "0.00",
      outstanding: "120.00",
      tips: "0.00",
      payments: [],
      paidLines: [],
    });
  });

  it("reads a bill with no lines as owing nothing", async () => {
    const billId = await tabWith();

    const { status, json } = await balance(billId);

    expect(status).toBe(200);
    expect(json).toMatchObject({
      total: "0.00",
      received: "0.00",
      reserved: "0.00",
      outstanding: "0.00",
      payments: [],
      paidLines: [],
    });
  });

  it("answers an unknown bill as not found", async () => {
    const { status, json } = await balance(randomUUID());
    expect(status).toBe(404);
    expect(json).toMatchObject({ code: "working_order.not_found" });
  });

  it("answers a bill id that is not an id as not found", async () => {
    const { status, json } = await balance("mesa-4");
    expect(status).toBe(404);
    expect(json).toEqual({ code: "working_order.not_found", params: { workingOrderId: "mesa-4" } });
  });

  it("answers a preview of an unknown bill as not found", async () => {
    const unknown = randomUUID();

    const { status, json } = await request(
      "POST",
      `/api/working-orders/${unknown}/payments/preview`,
      {
        kind: "contribution",
        amount: "10.00",
        method: "cash",
        tendered: "10.00",
      },
    );

    expect(status).toBe(404);
    expect(json).toEqual({ code: "working_order.not_found", params: { workingOrderId: unknown } });
  });
});

describe("a contribution (design §8 test 2)", () => {
  it("leaves €70.00 outstanding on a €120.00 bill, changes no line's price, and issues no invoice", async () => {
    const billId = await bill120();
    const before = await lineTotals(billId);

    const paid = await contribute(billId, "50.00");

    expect(paid.status).toBe(200);
    expect(paid.json).toMatchObject({
      outcome: "received",
      payment: {
        kind: "contribution",
        method: "cash",
        applied: "50.00",
        tip: "0.00",
        tendered: "50.00",
        change: "0.00",
        state: "received",
      },
      balance: { total: "120.00", received: "50.00", outstanding: "70.00" },
    });
    expect(paid.json.invoice).toBeUndefined();
    expect(await lineTotals(billId)).toEqual(before);
    expect(await saleOf(billId)).toEqual([]);
    expect(registroCount(billId)).toBe(0);
    expect((await balance(billId)).json).toMatchObject({ outstanding: "70.00" });
  });

  it("gives the change of a cash contribution back and records it nowhere", async () => {
    const billId = await bill120();

    const paid = await pay(billId, {
      kind: "contribution",
      amount: "20.00",
      method: "cash",
      tendered: "50.00",
      applied: "20.00",
      tip: "0.00",
    });

    expect(paid.status).toBe(200);
    expect(paid.json).toMatchObject({
      payment: { applied: "20.00", tip: "0.00", tendered: "50.00", change: "30.00" },
      balance: { outstanding: "100.00" },
    });
  });

  it("opens the till's cash drawer with an audited drawer open naming the bill payment", async () => {
    const billId = await bill120();

    const paid = await contribute(billId, "10.00");

    const paymentId = (paid.json.payment as { id: string }).id;
    const opens = await inTx((tx) =>
      tx.select().from(drawerOpens).where(eq(drawerOpens.billPaymentId, paymentId)),
    );
    expect(opens).toMatchObject([
      { reason: "bill_payment", saleId: null, tillId: venue.deviceTillId },
    ]);
  });

  it("opens no drawer for cash taken on a handheld", async () => {
    const billId = await bill120();

    const paid = await request(
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "10.00",
        method: "cash",
        tendered: "10.00",
        applied: "10.00",
        tip: "0.00",
      },
      venue.handheldCookie,
    );

    expect(paid.status).toBe(200);
    const paymentId = (paid.json.payment as { id: string }).id;
    const opens = await inTx((tx) =>
      tx.select().from(drawerOpens).where(eq(drawerOpens.billPaymentId, paymentId)),
    );
    expect(opens).toEqual([]);
  });

  it("records a hand-keyed card with its manual payment row, linked to the bill payment", async () => {
    const billId = await bill120();

    const paid = await pay(billId, {
      kind: "contribution",
      amount: "40.00",
      method: "card",
      entry: "manual",
      externalRef: "OP-7781",
      applied: "40.00",
      tip: "0.00",
    });

    expect(paid.status).toBe(200);
    const paymentId = (paid.json.payment as { id: string }).id;
    const rows = await inTx((tx) =>
      tx.select().from(payments).where(eq(payments.billPaymentId, paymentId)),
    );
    expect(rows).toMatchObject([
      { provider: "manual", state: "captured", amount: 4000, externalRef: "OP-7781", saleId: null },
    ]);
    const opens = await inTx((tx) =>
      tx.select().from(drawerOpens).where(eq(drawerOpens.billPaymentId, paymentId)),
    );
    expect(opens).toEqual([]);
  });

  it("takes a card on the practice simulator, charging it with the outcome the operator chose", async () => {
    const billId = await bill120();
    const card = {
      kind: "contribution",
      amount: "40.00",
      method: "card",
      entry: "reader",
      applied: "40.00",
      tip: "0.00",
    } as const;

    const declined = await request("POST", `/api/working-orders/${billId}/payments`, {
      ...card,
      submissionId: randomUUID(),
      simulationOutcome: "declined",
    });
    const captured = await request("POST", `/api/working-orders/${billId}/payments`, {
      ...card,
      submissionId: randomUUID(),
      simulationOutcome: "captured",
    });

    expect(declined.json).toMatchObject({ outcome: "declined", payment: { state: "failed" } });
    expect(captured.json).toMatchObject({
      outcome: "received",
      balance: { received: "40.00", outstanding: "80.00" },
    });
    const provided = await inTx((tx) =>
      tx
        .select({ state: payments.state, provider: payments.provider })
        .from(payments)
        .where(eq(payments.workingOrderId, billId)),
    );
    expect(provided.map((row) => row.state).sort()).toEqual(["captured", "failed"]);
    expect(new Set(provided.map((row) => row.provider))).toEqual(new Set(["simulator"]));
  });

  it("refuses a tip with the venue's tips off, showing what can be charged, and writes nothing", async () => {
    const billId = await bill120();

    const refused = await pay(billId, {
      kind: "contribution",
      amount: "40.00",
      method: "cash",
      tendered: "50.00",
      addedTip: "10.00",
      applied: "40.00",
      tip: "10.00",
    });

    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({
      code: "bill.tip_not_allowed",
      params: { workingOrderId: billId, chargeable: "40.00" },
    });
    expect(await paymentRows(billId)).toEqual([]);
  });

  it("refuses an allocation other than the one the operator saw, with the new one, and writes nothing", async () => {
    const billId = await tabWith("Chuletón");

    const refused = await contribute(billId, "30.00");

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      code: "bill.allocation_changed",
      params: {
        workingOrderId: billId,
        preview: { kind: "allocated", applied: "25.00", change: "5.00" },
      },
    });
    expect(await paymentRows(billId)).toEqual([]);
  });

  it("refuses a payment of a bill with nothing on it", async () => {
    const billId = await inTx(async (tx) => {
      const table = await createTable(tx, venue.cfg, {
        label: `M-${randomUUID().slice(0, 8)}`,
        zoneId: venue.offers.zoneId,
      });
      return (await openTab(tx, venue.cfg, { tableId: table.id })).tabId;
    });

    const refused = await contribute(billId, "5.00");

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      code: "bill.nothing_outstanding",
      params: { workingOrderId: billId },
    });
  });

  it("previews without writing anything", async () => {
    const billId = await bill120();

    const preview = await request("POST", `/api/working-orders/${billId}/payments/preview`, {
      kind: "contribution",
      amount: "150.00",
      method: "cash",
      tendered: "150.00",
    });

    expect(preview.status).toBe(200);
    expect(preview.json).toMatchObject({
      kind: "allocated",
      applied: "120.00",
      tip: "0.00",
      change: "30.00",
    });
    expect(await paymentRows(billId)).toEqual([]);
  });

  it("refuses a malformed amount by the field it names", async () => {
    const billId = await bill120();

    const refused = await contribute(billId, "5.001");

    expect(refused.status).toBe(400);
    expect(refused.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "amount" },
    });
  });
});

describe("equal shares (design §8 test 4)", () => {
  it("takes €100.01 as €33.34, €33.34 and €33.33, and the third share issues the invoice", async () => {
    const billId = await tabWith("Mariscada");
    const taken: string[] = [];
    let last: Record<string, unknown> = {};

    for (const shareOf of [3, 2, 1]) {
      const preview = await request("POST", `/api/working-orders/${billId}/payments/preview`, {
        kind: "share",
        shareOf,
        method: "cash",
        tendered: "50.00",
      });
      const applied = preview.json.applied as string;
      const paid = await pay(billId, {
        kind: "share",
        shareOf,
        method: "cash",
        tendered: "50.00",
        applied,
        tip: "0.00",
      });
      expect(paid.status).toBe(200);
      taken.push((paid.json.payment as { applied: string }).applied);
      last = paid.json;
    }

    expect(taken).toEqual(["33.34", "33.34", "33.33"]);
    expect(last.invoice).toMatchObject({ total: "100.01" });
    const [sale] = await saleOf(billId);
    expect(sale!.total).toBe(10001);
    expect((await tendersOf(sale!.id)).map((t) => t.amount).sort()).toEqual([3333, 3334, 3334]);
    expect(await statusOf(billId)).toBe("settled");
  });
});

describe("an item already paid for (design §8 test 5)", () => {
  async function steakPaid(): Promise<string> {
    const billId = await tabWith("Paella", "Chuletón", "Caña");
    const paid = await pay(billId, {
      kind: "items",
      lines: [{ lineNo: 2 }],
      method: "cash",
      tendered: "25.00",
      applied: "25.00",
      tip: "0.00",
    });
    expect(paid.status).toBe(200);
    return billId;
  }

  it("records the steak's line as paid on the balance", async () => {
    const billId = await steakPaid();

    const { json } = await balance(billId);

    expect(json).toMatchObject({
      received: "25.00",
      outstanding: "38.00",
      paidLines: [{ lineNo: 2, paidQuantity: "1.000" }],
    });
    expect(json.payments).toMatchObject([
      { kind: "items", lines: [{ lineNo: 2, quantity: "1.000", amount: "25.00" }] },
    ]);
  });

  it("refuses a second item payment naming the steak, writing nothing", async () => {
    const billId = await steakPaid();

    const refused = await pay(billId, {
      kind: "items",
      lines: [{ lineNo: 2 }],
      method: "cash",
      tendered: "25.00",
      applied: "25.00",
      tip: "0.00",
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      code: "bill.line_paid",
      params: { workingOrderId: billId, lineNo: 2 },
    });
    expect(await paymentRows(billId)).toHaveLength(1);
  });

  it("refuses voiding the steak", async () => {
    const billId = await steakPaid();

    const refused = await request("DELETE", `/api/working-orders/${billId}/lines/2`);

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: "bill.line_paid", params: { lineNo: 2 } });
    expect(await lineTotals(billId)).toEqual(["35.00", "25.00", "3.00"]);
  });

  it("refuses editing the steak's line", async () => {
    const billId = await steakPaid();
    const lines = await request("GET", `/api/working-orders/${billId}/lines`);

    const refused = await request("PUT", `/api/working-orders/${billId}/lines/2`, {
      revision: lines.json.revision,
      note: "poco hecho",
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: "bill.line_paid", params: { lineNo: 2 } });
    const after = await request("GET", `/api/working-orders/${billId}/lines`);
    expect(after.json).toEqual(lines.json);
    expect(await lineTotals(billId)).toEqual(["35.00", "25.00", "3.00"]);
  });

  it("refuses moving the steak to another table's tab, or splitting it off", async () => {
    const billId = await steakPaid();
    const other = await tabWith("Ensalada");

    const moved = await request("POST", `/api/tabs/${billId}/transfer`, {
      toTabId: other,
      transfers: [{ lineNo: 2 }],
    });
    const split = await request("POST", `/api/tabs/${billId}/split`, {
      transfers: [{ lineNo: 2 }],
    });

    expect(moved.status).toBe(409);
    expect(moved.json).toMatchObject({ code: "bill.line_paid", params: { lineNo: 2 } });
    expect(split.status).toBe(409);
    expect(split.json).toMatchObject({ code: "bill.line_paid", params: { lineNo: 2 } });
    expect(await lineTotals(billId)).toEqual(["35.00", "25.00", "3.00"]);
  });

  it("lets the unpaid beers of a line move and be cut, and refuses cutting the paid one", async () => {
    const billId = await tabWith("Paella", "Caña");
    const lines = await request("GET", `/api/working-orders/${billId}/lines`);
    const raised = await request("PUT", `/api/working-orders/${billId}/lines/2`, {
      revision: lines.json.revision,
      quantity: "4",
    });
    expect(raised.status).toBe(200);
    const paid = await pay(billId, {
      kind: "items",
      lines: [{ lineNo: 2, quantity: "1" }],
      method: "cash",
      tendered: "3.00",
      applied: "3.00",
      tip: "0.00",
    });
    expect(paid.status).toBe(200);
    const other = await tabWith("Ensalada");

    const moved = await request("POST", `/api/tabs/${billId}/transfer`, {
      toTabId: other,
      transfers: [{ lineNo: 2, quantity: "2" }],
    });
    const cutTooFar = await request("DELETE", `/api/working-orders/${billId}/lines/2?quantity=2`);
    const cut = await request("DELETE", `/api/working-orders/${billId}/lines/2?quantity=1`);

    expect(moved.status).toBe(200);
    expect(cutTooFar.status).toBe(409);
    expect(cutTooFar.json).toMatchObject({ code: "bill.line_paid", params: { lineNo: 2 } });
    expect(cut.status).toBe(200);
    expect((await balance(billId)).json).toMatchObject({
      total: "38.00",
      received: "3.00",
      paidLines: [{ lineNo: 2, paidQuantity: "1.000" }],
    });
  });

  it("takes an item payment for a held line that has not gone to the kitchen", async () => {
    const table = await inTx((tx) =>
      createTable(tx, venue.cfg, {
        label: `M-${randomUUID().slice(0, 8)}`,
        zoneId: venue.offers.zoneId,
      }),
    );
    const seated = await request("POST", `/api/tables/${table.id}/seat`, {});
    const {
      tabId: billId,
      visitId,
      revision,
    } = seated.json as { tabId: string; visitId: string; revision: number };
    const round = await request("POST", `/api/visits/${visitId}/groups`, {
      submissionId: randomUUID(),
      expectedVisitRevision: revision,
      groups: [
        { lines: [{ menuItemId: offer("Paella"), quantity: "1" }], release: "fire" },
        { lines: [{ menuItemId: offer("Tarta"), quantity: "1" }], release: "hold" },
      ],
    });
    expect(round.status).toBe(200);
    const lines = await request("GET", `/api/working-orders/${billId}/lines`);
    const tabLines = lines.json.lines as {
      lineNo: number;
      firedAt: string | null;
      sentAt: string | null;
      name: string;
    }[];
    const held = tabLines.find((line) => line.name === "Tarta")!;
    expect(held.firedAt).toBeNull();
    expect(held.sentAt).toBeNull();
    expect(tabLines.find((line) => line.name === "Paella")!.sentAt).not.toBeNull();

    const paid = await pay(billId, {
      kind: "items",
      lines: [{ lineNo: held.lineNo }],
      method: "cash",
      tendered: "18.00",
      applied: "18.00",
      tip: "0.00",
    });

    expect(paid.status).toBe(200);
    expect((await balance(billId)).json).toMatchObject({
      paidLines: [{ lineNo: held.lineNo, paidQuantity: "1.000" }],
    });
    const groups = await request("GET", `/api/visits/${visitId}/groups`);
    expect(
      (groups.json.groups as { state: string; summary: string }[]).map(({ state, summary }) => ({
        state,
        summary,
      })),
    ).toEqual([
      { state: "fired", summary: "1 × Paella" },
      { state: "held", summary: "1 × Tarta" },
    ]);
  });

  it("refuses an item payment naming a line the bill does not have", async () => {
    const billId = await tabWith("Paella");

    const refused = await pay(billId, {
      kind: "items",
      lines: [{ lineNo: 9 }],
      method: "cash",
      tendered: "35.00",
      applied: "35.00",
      tip: "0.00",
    });

    expect(refused.status).toBe(404);
    expect(refused.json).toMatchObject({ code: "tab.line_not_found", params: { lineNo: 9 } });
  });
});

describe("what an item payment may name", () => {
  /** A cash item payment of `lines` for `amount`, handed over exactly. */
  function payItems(billId: string, lines: unknown, amount = "3.00") {
    return request("POST", `/api/working-orders/${billId}/payments`, {
      submissionId: randomUUID(),
      kind: "items",
      lines,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
    });
  }

  /** An extra on the dish at `lineNo`, as a modifier line under it, costing `cents`. */
  async function addExtra(billId: string, lineNo: number, cents: number): Promise<void> {
    await inTx(async (tx) => {
      const [dish] = await tx
        .select()
        .from(workingOrderLines)
        .where(
          and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.lineNo, lineNo)),
        );
      const lineNos = await tx
        .select({ lineNo: workingOrderLines.lineNo })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, billId));
      await tx.insert(workingOrderLines).values({
        ...dish!,
        id: randomUUID(),
        lineNo: Math.max(...lineNos.map((line) => line.lineNo)) + 1,
        parentLineId: dish!.id,
        name: "Extra de queso",
        unitPriceGross: cents,
        lineTotal: cents,
      });
    });
  }

  it.each([
    ["no lines", []],
    ["a line twice", [{ lineNo: 1 }, { lineNo: 1 }]],
    ["an entry that is not a line", [1]],
    ["more of a line than the bill has", [{ lineNo: 1, quantity: "2" }]],
    ["part of a unit", [{ lineNo: 1, quantity: "0.5" }]],
  ] as const)("refuses %s, taking nothing", async (_name, lines) => {
    const billId = await tabWith("Caña");

    const refused = await payItems(billId, lines);

    expect(refused.status).toBe(400);
    expect(refused.json).toEqual({
      code: "management.request_invalid",
      params: { field: "lines" },
    });
    expect(await paymentRows(billId)).toEqual([]);
  });

  it("refuses part of a weighed line", async () => {
    const billId = await tabWith("Caña");
    suite.db.run(
      sql`update working_order_lines set unit_precision = 3, quantity = 2500 where working_order_id = ${billId}`,
    );

    const refused = await payItems(billId, [{ lineNo: 1, quantity: "1" }]);

    expect(refused.status).toBe(400);
    expect(refused.json).toMatchObject({ params: { field: "lines" } });
    expect(await paymentRows(billId)).toEqual([]);
  });

  it("takes a dish's extras with it, and refuses them apart or the dish in part", async () => {
    const billId = await tabWith("Chuletón", "Caña");
    await inTx((tx) =>
      tx
        .update(workingOrderLines)
        .set({ quantity: 2000, lineTotal: 5000 })
        .where(and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.lineNo, 1))),
    );
    await addExtra(billId, 1, 200);

    const extraAlone = await payItems(billId, [{ lineNo: 3 }], "2.00");
    const partOfDish = await payItems(billId, [{ lineNo: 1, quantity: "1" }], "25.00");
    const whole = await payItems(billId, [{ lineNo: 1 }], "52.00");

    expect(extraAlone.json).toMatchObject({ params: { field: "lines" } });
    expect(partOfDish.json).toMatchObject({ params: { field: "lines" } });
    expect(whole.status).toBe(200);
    const paymentId = paymentIdOf(whole);
    const covered = await inTx((tx) =>
      tx
        .select({
          lineNo: workingOrderLines.lineNo,
          quantity: billPaymentLines.quantity,
          amount: billPaymentLines.amount,
        })
        .from(billPaymentLines)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, billPaymentLines.lineId))
        .where(eq(billPaymentLines.billPaymentId, paymentId))
        .orderBy(workingOrderLines.lineNo),
    );
    expect(covered).toEqual([
      { lineNo: 1, quantity: 2000, amount: 5000 },
      { lineNo: 3, quantity: 2000, amount: 200 },
    ]);
    expect((await balance(billId)).json).toMatchObject({ received: "52.00" });
  });
});

describe("a split after a contribution (design §8 test 6, §4.2)", () => {
  it("invoices the €30.00 split at once, and the original for €90.00 once its €40.00 is paid", async () => {
    const billId = await bill120();
    expect((await contribute(billId, "50.00")).status).toBe(200);

    const split = await request("POST", `/api/tabs/${billId}/split`, {
      transfers: [{ lineNo: 4 }, { lineNo: 5 }],
    });
    expect(split.status).toBe(200);
    const checkId = split.json.checkId as string;

    const checkPaid = await contribute(checkId, "30.00");
    expect(checkPaid.json).toMatchObject({ invoice: { total: "30.00" } });
    expect(registroCount(checkId)).toBe(1);

    expect((await balance(billId)).json).toMatchObject({
      total: "90.00",
      received: "50.00",
      outstanding: "40.00",
    });
    expect(await saleOf(billId)).toEqual([]);

    const rest = await contribute(billId, "40.00");
    expect(rest.json).toMatchObject({ invoice: { total: "90.00" } });
    const [sale] = await saleOf(billId);
    const filed = await tendersOf(sale!.id);
    expect(filed.map((t) => t.amount).sort()).toEqual([4000, 5000]);
    expect(filed.every((t) => t.billPaymentId !== null)).toBe(true);
  });

  it("refuses a split that would leave the bill owing less than it has received, by the excess", async () => {
    const billId = await bill120();
    expect((await contribute(billId, "100.00")).status).toBe(200);

    const refused = await request("POST", `/api/tabs/${billId}/split`, {
      transfers: [{ lineNo: 1 }],
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      code: "bill.received_exceeds_total",
      params: { workingOrderId: billId, excess: "15.00" },
    });
    expect(await lineTotals(billId)).toHaveLength(5);
  });
});

describe("the invoice at full payment (design §8 test 8)", () => {
  it("files nothing while anything is outstanding, then exactly one record", async () => {
    const billId = await tabWith("Chuletón", "Tarta");

    expect((await contribute(billId, "20.00")).json.invoice).toBeUndefined();
    expect(registroCount(billId)).toBe(0);
    const last = await contribute(billId, "23.00");

    expect(last.json).toMatchObject({ outcome: "received", invoice: { total: "43.00" } });
    expect(registroCount(billId)).toBe(1);
    const [sale] = await saleOf(billId);
    const filedLines = await inTx((tx) =>
      tx
        .select({ name: saleLines.name, vatRate: saleLines.vatRate })
        .from(saleLines)
        .where(eq(saleLines.saleId, sale!.id)),
    );
    expect(filedLines.map((line) => basisPointsToDecimal(line.vatRate))).toEqual([
      "21.00",
      "21.00",
    ]);
    expect(await statusOf(billId)).toBe("settled");
  });

  it("files each line at the rate of the class recorded on it, not the class its product has when the last payment lands", async () => {
    const billId = await tabWith("Ensalada");
    expect((await contribute(billId, "5.00")).status).toBe(200);
    await inTx((tx) =>
      tx
        .update(products)
        .set({ vatClass: "reduced" })
        .where(eq(products.id, venue.productIds.get("Ensalada")!)),
    );

    try {
      await contribute(billId, "7.00");
      const [sale] = await saleOf(billId);
      const [line] = await inTx((tx) =>
        tx
          .select({ vatRate: saleLines.vatRate, classification: saleLines.classification })
          .from(saleLines)
          .where(eq(saleLines.saleId, sale!.id)),
      );
      expect(basisPointsToDecimal(line!.vatRate)).toBe("21.00");
      expect(line!.classification).not.toBeNull();
    } finally {
      await inTx((tx) =>
        tx
          .update(products)
          .set({ vatClass: "general" })
          .where(eq(products.id, venue.productIds.get("Ensalada")!)),
      );
    }
  });

  it("puts every payment on the ticket, each with its own change, and prints the receipt once", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    await pay(billId, {
      kind: "contribution",
      amount: "20.00",
      method: "cash",
      tendered: "50.00",
      applied: "20.00",
      tip: "0.00",
    });
    const receiptsBefore = suite.db.all<{ n: number }>(
      sql`select count(*) as n from print_jobs where printer_id = ${venue.printerId} and kind = 'document'`,
    )[0]!.n;

    const last = await pay(billId, {
      kind: "contribution",
      amount: "23.00",
      method: "card",
      entry: "manual",
      externalRef: "OP-1",
      applied: "23.00",
      tip: "0.00",
    });

    expect(last.json.invoice).toMatchObject({
      total: "43.00",
      payments: [
        { method: "cash", amount: "20.00", tip: "0.00", tendered: "50.00", change: "30.00" },
        { method: "card", amount: "23.00", tip: "0.00", reference: "OP-1" },
      ],
    });
    const receiptsAfter = suite.db.all<{ n: number }>(
      sql`select count(*) as n from print_jobs where printer_id = ${venue.printerId} and kind = 'document'`,
    )[0]!.n;
    expect(receiptsAfter - receiptsBefore).toBe(1);
    const [sale] = await saleOf(billId);
    const [cardRow] = await inTx((tx) =>
      tx
        .select({ saleId: payments.saleId })
        .from(payments)
        .where(eq(payments.workingOrderId, billId)),
    );
    expect(cardRow!.saleId).toBe(sale!.id);
  });

  it("issues the invoice in the transaction of a void that leaves the bill fully paid", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    expect((await contribute(billId, "25.00")).status).toBe(200);

    const voided = await request("DELETE", `/api/working-orders/${billId}/lines/2`);

    expect(voided.status).toBe(200);
    expect(await statusOf(billId)).toBe("settled");
    const [sale] = await saleOf(billId);
    expect(sale!.total).toBe(2500);
    expect(registroCount(billId)).toBe(1);
  });
});

describe("a line write that leaves the bill exactly paid (design §7)", () => {
  /** Issued in the write's own transaction, once, and filed on the till of the device that wrote. */
  async function expectInvoicedOnDeviceTill(billId: string, totalCents: number): Promise<void> {
    expect(await statusOf(billId)).toBe("settled");
    expect(registroCount(billId)).toBe(1);
    const [sale] = await saleOf(billId);
    expect(sale!.total).toBe(totalCents);
    expect(sale!.tillId).toBe(venue.deviceTillId);
  }

  async function revisionOf(billId: string): Promise<number> {
    const lines = await request("GET", `/api/working-orders/${billId}/lines`);
    return lines.json.revision as number;
  }

  async function raiseLine(billId: string, lineNo: number, quantity: string): Promise<void> {
    const raised = await request("PUT", `/api/working-orders/${billId}/lines/${lineNo}`, {
      revision: await revisionOf(billId),
      quantity,
    });
    expect(raised.status).toBe(200);
  }

  it("files on the device's own till, which is not the box's configured one", () => {
    expect(venue.deviceTillId).not.toBe(venue.cfg.tillId);
  });

  it("issues the invoice when a void leaves the bill exactly paid", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    expect((await contribute(billId, "25.00")).status).toBe(200);

    const voided = await request("DELETE", `/api/working-orders/${billId}/lines/2`);

    expect(voided.status).toBe(200);
    await expectInvoicedOnDeviceTill(billId, 2500);
  });

  it("issues the invoice when a transfer leaves the bill exactly paid", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    const other = await tabWith("Ensalada");
    expect((await contribute(billId, "25.00")).status).toBe(200);

    const moved = await request("POST", `/api/tabs/${billId}/transfer`, {
      toTabId: other,
      transfers: [{ lineNo: 2 }],
    });

    expect(moved.status).toBe(200);
    await expectInvoicedOnDeviceTill(billId, 2500);
  });

  it("issues the invoice when a split leaves the bill exactly paid", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    expect((await contribute(billId, "25.00")).status).toBe(200);

    const split = await request("POST", `/api/tabs/${billId}/split`, {
      transfers: [{ lineNo: 2 }],
    });

    expect(split.status).toBe(200);
    await expectInvoicedOnDeviceTill(billId, 2500);
  });

  it("issues the invoice when an unjoin leaves the bill exactly paid", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    const second = await inTx((tx) =>
      createTable(tx, venue.cfg, {
        label: `M-${randomUUID().slice(0, 8)}`,
        zoneId: venue.offers.zoneId,
      }),
    );
    expect((await request("POST", `/api/tabs/${billId}/join`, { tableId: second.id })).status).toBe(
      200,
    );
    expect((await contribute(billId, "25.00")).status).toBe(200);

    const unjoined = await request("POST", `/api/tabs/${billId}/unjoin`, {
      tableId: second.id,
      transfers: [{ lineNo: 2 }],
    });

    expect(unjoined.status).toBe(200);
    await expectInvoicedOnDeviceTill(billId, 2500);
  });

  it("issues the invoice when a line edit leaves the bill exactly paid", async () => {
    const billId = await tabWith("Chuletón", "Caña");
    await raiseLine(billId, 2, "2");
    expect((await contribute(billId, "28.00")).status).toBe(200);

    const edited = await request("PUT", `/api/working-orders/${billId}/lines/2`, {
      revision: await revisionOf(billId),
      quantity: "1",
    });

    expect(edited.status).toBe(200);
    await expectInvoicedOnDeviceTill(billId, 2800);
  });

  it("issues the invoice when saving the whole order leaves the bill exactly paid", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    expect((await contribute(billId, "25.00")).status).toBe(200);
    const [steak] = await inTx((tx) =>
      tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.lineNo, 1))),
    );

    const saved = await request("PUT", `/api/working-orders/${billId}`, {
      lines: [{ workingOrderLineId: steak!.id, menuItemId: offer("Chuletón"), quantity: "1" }],
      revision: await revisionOf(billId),
    });

    expect(saved.status).toBe(200);
    await expectInvoicedOnDeviceTill(billId, 2500);
  });

  it("refuses cutting part of a line when the rest would be less than the bill has received", async () => {
    const billId = await tabWith("Paella", "Caña");
    await raiseLine(billId, 2, "3");
    expect((await contribute(billId, "42.00")).status).toBe(200);

    const refused = await request("DELETE", `/api/working-orders/${billId}/lines/2?quantity=1`);

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      code: "bill.received_exceeds_total",
      params: { workingOrderId: billId, excess: "1.00" },
    });
    expect(await lineTotals(billId)).toEqual(["35.00", "9.00"]);
  });

  it("voids a line of a bill with no payments for a request with no device", async () => {
    const billId = await tabWith("Chuletón", "Tarta");

    const voided = await request(
      "DELETE",
      `/api/working-orders/${billId}/lines/2`,
      undefined,
      venue.sessionCookie,
    );

    expect(voided.status).toBe(200);
    expect(await lineTotals(billId)).toEqual(["25.00"]);
  });

  it("refuses a void that would issue the invoice for a request with no device, writing nothing", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    expect((await contribute(billId, "25.00")).status).toBe(200);

    const refused = await request(
      "DELETE",
      `/api/working-orders/${billId}/lines/2`,
      undefined,
      venue.sessionCookie,
    );

    expect(refused.status).toBe(401);
    expect(refused.json).toMatchObject({ code: "device.unauthorized" });
    expect(await statusOf(billId)).toBe("open");
    expect(await lineTotals(billId)).toEqual(["25.00", "18.00"]);
    expect(registroCount(billId)).toBe(0);
  });
});

describe("the bottle (design §8 test 9, §7)", () => {
  it("files one line of €30.00 and three tenders of €10.00", async () => {
    const tabId = await tabWith("Paella", "Botella tinto");
    const split = await request("POST", `/api/tabs/${tabId}/split`, {
      transfers: [{ lineNo: 2 }],
    });
    const bottleBill = split.json.checkId as string;

    for (let i = 0; i < 3; i++) {
      expect((await contribute(bottleBill, "10.00")).status).toBe(200);
    }

    const [sale] = await saleOf(bottleBill);
    const filedLines = await inTx((tx) =>
      tx
        .select({ quantity: saleLines.quantity })
        .from(saleLines)
        .where(eq(saleLines.saleId, sale!.id)),
    );
    expect(filedLines.map((line) => thousandthsToDecimal(line.quantity))).toEqual(["1.000"]);
    expect(sale!.total).toBe(3000);
    expect((await tendersOf(sale!.id)).map((t) => t.amount)).toEqual([1000, 1000, 1000]);
  });
});

describe("retries and reused ids (plan D8, design §5.1)", () => {
  it("answers the same request sent twice with one payment and, once invoiced, one tender", async () => {
    const billId = await tabWith("Chuletón");
    const submissionId = randomUUID();

    const first = await contribute(billId, "25.00", submissionId);
    const again = await contribute(billId, "25.00", submissionId);

    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({
      outcome: "received",
      payment: { id: (first.json.payment as { id: string }).id },
      invoice: { total: "25.00" },
    });
    expect(await paymentRows(billId)).toHaveLength(1);
    const [sale] = await saleOf(billId);
    expect(await tendersOf(sale!.id)).toHaveLength(1);
    const opens = await inTx((tx) =>
      tx
        .select()
        .from(drawerOpens)
        .where(eq(drawerOpens.billPaymentId, (first.json.payment as { id: string }).id)),
    );
    expect(opens).toHaveLength(1);
  });

  it("answers the same request resent with its lines in another order and its added tip spelled out", async () => {
    const billId = await tabWith("Paella", "Chuletón", "Tarta");
    const submissionId = randomUUID();
    const body = {
      submissionId,
      kind: "items" as const,
      method: "cash" as const,
      tendered: "60.00",
      applied: "60.00",
      tip: "0.00",
    };
    const first = await pay(billId, { ...body, lines: [{ lineNo: 1 }, { lineNo: 2 }] });
    expect(first.status).toBe(200);

    const again = await pay(billId, {
      ...body,
      lines: [{ lineNo: 2 }, { lineNo: 1 }],
      addedTip: "0",
    });

    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ payment: { id: paymentIdOf(first) } });
    expect(await paymentRows(billId)).toHaveLength(1);
  });

  it("refuses the id resent with another amount, writing nothing", async () => {
    const billId = await bill120();
    const submissionId = randomUUID();
    expect((await contribute(billId, "20.00", submissionId)).status).toBe(200);

    const refused = await contribute(billId, "30.00", submissionId);

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: "submission.id_reused", params: { submissionId } });
    expect(await paymentRows(billId)).toHaveLength(1);
    expect((await balance(billId)).json).toMatchObject({ received: "20.00" });
  });

  it("refuses the id resent naming other lines, writing nothing", async () => {
    // Two lines of one price, so the resend differs only in the line it names.
    const billId = await tabWith("Paella", "Paella");
    const submissionId = randomUUID();
    const body = {
      submissionId,
      kind: "items" as const,
      method: "cash" as const,
      tendered: "40.00",
      tip: "0.00",
    };
    expect((await pay(billId, { ...body, lines: [{ lineNo: 1 }], applied: "35.00" })).status).toBe(
      200,
    );

    const refused = await pay(billId, { ...body, lines: [{ lineNo: 2 }], applied: "35.00" });

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: "submission.id_reused" });
    const lines = await inTx((tx) =>
      tx
        .select({ lineId: billPaymentLines.lineId })
        .from(billPaymentLines)
        .innerJoin(billPayments, eq(billPayments.id, billPaymentLines.billPaymentId))
        .where(eq(billPayments.workingOrderId, billId)),
    );
    expect(lines).toHaveLength(1);
  });

  it("refuses a payment reusing the id of a refund on the same bill, writing nothing", async () => {
    const billId = await bill120();
    const paid = await contribute(billId, "20.00");
    const paymentId = (paid.json.payment as { id: string }).id;
    const refundId = randomUUID();
    await inTx((tx) =>
      tx.insert(billPaymentRefunds).values({
        billPaymentId: paymentId,
        submissionId: refundId,
        fingerprint: "f",
        appliedAmount: 500,
        reason: "error",
        authorizedBy: randomUUID(),
        requestedBy: randomUUID(),
        tillId: venue.deviceTillId,
        state: "completed",
        completedAt: new Date().toISOString(),
      }),
    );

    const refused = await contribute(billId, "5.00", refundId);

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      code: "submission.id_reused",
      params: { submissionId: refundId },
    });
    expect(await paymentRows(billId)).toHaveLength(1);
  });
});

describe("the single-payment routes on a bill holding bill payments (design §7)", () => {
  it("refuses a cash sale of the whole bill", async () => {
    const billId = await bill120();
    expect((await contribute(billId, "50.00")).status).toBe(200);

    const refused = await request("POST", "/api/sales", {
      lines: [],
      tender: { method: "cash", amount: "120.00" },
      workingOrderId: billId,
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      code: "bill.payments_received",
      params: { workingOrderId: billId },
    });
    expect(await saleOf(billId)).toEqual([]);
  });

  it("refuses a card pay before filing a capture the bill payment already took", async () => {
    const billId = await bill120();
    expect((await contribute(billId, "50.00")).status).toBe(200);
    // A capture with no sale, as a card bill payment leaves one until the bill is invoiced: the
    // integrated pay's own recovery would otherwise file the whole bill from it.
    const [paymentRow] = await paymentRows(billId);
    await inTx((tx) =>
      insertCapturedPayment(tx, {
        workingOrderId: billId,
        provider: "simulator",
        paymentRef: randomUUID(),
        amount: decimal("50.00"),
        settledAt: new Date(),
        billPaymentId: paymentRow!.id,
      }),
    );

    const refused = await request("POST", "/api/pay", { id: billId, lines: [] });

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: "bill.payments_received" });
    expect(await saleOf(billId)).toEqual([]);
  });

  it("refuses abandoning or placing a bill holding money", async () => {
    const billId = await tabWith("Tarta");
    expect((await contribute(billId, "5.00")).status).toBe(200);

    const abandoned = await request("DELETE", `/api/working-orders/${billId}`);
    const placed = await request("POST", `/api/working-orders/${billId}/place`);

    expect(abandoned.status).toBe(409);
    expect(abandoned.json).toMatchObject({ code: "bill.payments_received" });
    expect(placed.status).toBe(409);
    expect(placed.json).toMatchObject({ code: "bill.payments_received" });
    expect(await statusOf(billId)).toBe("open");
  });

  it("refuses merging a check holding money back into its tab", async () => {
    const tabId = await bill120();
    const split = await request("POST", `/api/tabs/${tabId}/split`, {
      transfers: [{ lineNo: 5 }],
    });
    const checkId = split.json.checkId as string;
    expect((await contribute(checkId, "5.00")).status).toBe(200);

    const refused = await request("POST", `/api/tabs/${tabId}/merge`, {
      fromTabId: checkId,
      freeSourceTable: false,
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      code: "bill.payments_received",
      params: { workingOrderId: checkId },
    });
    expect(await statusOf(checkId)).toBe("open");
    expect(await lineTotals(checkId)).toEqual(["18.00"]);
  });
});

interface RefundBody {
  submissionId?: string;
  appliedAmount: string;
  tipAmount: string;
  reason?: string;
  override?: { personId: string; pin: string };
  manualConfirmed?: boolean;
}

/** A refund of the payment, authorised by the admin's PIN unless the body says otherwise. */
function refund(billId: string, paymentId: string, body: RefundBody) {
  return request("POST", `/api/working-orders/${billId}/payments/${paymentId}/refunds`, {
    submissionId: randomUUID(),
    reason: "El cliente lo pide",
    override: { personId: venue.adminId, pin: "1234" },
    ...body,
  });
}

function paymentIdOf(paid: { json: Record<string, unknown> }): string {
  return (paid.json.payment as { id: string }).id;
}

async function refundRows(paymentId: string) {
  return inTx((tx) =>
    tx.select().from(billPaymentRefunds).where(eq(billPaymentRefunds.billPaymentId, paymentId)),
  );
}

async function refundDrawerOpens(paymentId: string) {
  return inTx((tx) =>
    tx
      .select()
      .from(drawerOpens)
      .where(and(eq(drawerOpens.billPaymentId, paymentId), eq(drawerOpens.reason, "bill_refund"))),
  );
}

function drawerJobCount(): number {
  return suite.db.all<{ n: number }>(
    sql`select count(*) as n from print_jobs where printer_id = ${venue.printerId} and kind = 'drawer'`,
  )[0]!.n;
}

/** A bill payment written straight to the table, for the states and tips no route here can make. */
async function insertBillPayment(
  billId: string,
  row: Partial<typeof billPayments.$inferInsert>,
): Promise<string> {
  const [inserted] = await inTx((tx) =>
    tx
      .insert(billPayments)
      .values({
        workingOrderId: billId,
        submissionId: randomUUID(),
        fingerprint: "f",
        kind: "contribution",
        method: "cash",
        applied: 1000,
        tip: 0,
        tendered: 1000,
        state: "received",
        receivedAt: new Date().toISOString(),
        requestedBy: venue.staffId,
        tillId: venue.deviceTillId,
        ...row,
      })
      .returning({ id: billPayments.id }),
  );
  return inserted!.id;
}

describe("a cash refund before the invoice (design §6)", () => {
  it("gives the money back with a manager's PIN, recording who asked, who authorised it and the till", async () => {
    const billId = await bill120();
    const paymentId = paymentIdOf(await contribute(billId, "50.00"));

    const refunded = await refund(billId, paymentId, {
      appliedAmount: "20.00",
      tipAmount: "0.00",
      reason: "Cobrado de más",
    });

    expect(refunded.status).toBe(200);
    expect(refunded.json).toMatchObject({
      refund: {
        paymentId,
        appliedAmount: "20.00",
        tipAmount: "0.00",
        reason: "Cobrado de más",
        state: "completed",
      },
      balance: { total: "120.00", received: "30.00", outstanding: "90.00" },
    });
    expect((refunded.json.balance as { payments: unknown[] }).payments).toMatchObject([
      { id: paymentId, refunds: [{ appliedAmount: "20.00", state: "completed" }] },
    ]);
    expect(await refundRows(paymentId)).toMatchObject([
      {
        appliedAmount: 2000,
        tipAmount: 0,
        state: "completed",
        requestedBy: venue.staffId,
        authorizedBy: venue.adminId,
        tillId: venue.deviceTillId,
      },
    ]);
    expect(await refundDrawerOpens(paymentId)).toMatchObject([
      {
        tillId: venue.deviceTillId,
        personId: venue.staffId,
        authorizedBy: venue.adminId,
        viaOverride: true,
        saleId: null,
      },
    ]);
    expect(await saleOf(billId)).toEqual([]);
  });

  it("refuses an operator without the refund permission and no override, writing nothing", async () => {
    const billId = await bill120();
    const paymentId = paymentIdOf(await contribute(billId, "50.00"));

    const refused = await refund(billId, paymentId, {
      appliedAmount: "20.00",
      tipAmount: "0.00",
      override: undefined,
    });

    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({
      code: "authorization.not_permitted",
      params: { permission: "sale.refund" },
    });
    expect(await refundRows(paymentId)).toEqual([]);
    expect(await refundDrawerOpens(paymentId)).toEqual([]);
  });

  it("refuses a wrong manager PIN, writing nothing", async () => {
    const billId = await bill120();
    const paymentId = paymentIdOf(await contribute(billId, "50.00"));

    const refused = await refund(billId, paymentId, {
      appliedAmount: "20.00",
      tipAmount: "0.00",
      override: { personId: venue.adminId, pin: "9999" },
    });

    expect(refused.status).toBe(401);
    expect(refused.json).toMatchObject({ code: "pin.invalid" });
    expect(await refundRows(paymentId)).toEqual([]);
  });

  it("refuses more than the payment can still give back, the applied money and the tip apart", async () => {
    const billId = await bill120();
    const paymentId = await insertBillPayment(billId, { applied: 1000, tip: 200, tendered: 1200 });
    const exceeds = (refundable: { applied: string; tip: string }) => ({
      code: "bill.refund_exceeds_payment",
      params: { paymentId, ...refundable },
    });

    const overApplied = await refund(billId, paymentId, {
      appliedAmount: "10.01",
      tipAmount: "0.00",
    });
    const tipWithPart = await refund(billId, paymentId, {
      appliedAmount: "5.00",
      tipAmount: "2.00",
    });
    const partOfTip = await refund(billId, paymentId, {
      appliedAmount: "10.00",
      tipAmount: "1.00",
    });
    expect(overApplied.status).toBe(422);
    expect(overApplied.json).toMatchObject(exceeds({ applied: "10.00", tip: "2.00" }));
    expect(tipWithPart.status).toBe(422);
    expect(tipWithPart.json).toMatchObject(exceeds({ applied: "10.00", tip: "2.00" }));
    expect(partOfTip.status).toBe(422);
    expect(partOfTip.json).toMatchObject(exceeds({ applied: "10.00", tip: "2.00" }));
    expect(await refundRows(paymentId)).toEqual([]);

    expect(
      (await refund(billId, paymentId, { appliedAmount: "4.00", tipAmount: "0.00" })).status,
    ).toBe(200);
    const overRest = await refund(billId, paymentId, { appliedAmount: "6.01", tipAmount: "0.00" });
    expect(overRest.status).toBe(422);
    expect(overRest.json).toMatchObject(exceeds({ applied: "6.00", tip: "2.00" }));
    const rest = await refund(billId, paymentId, { appliedAmount: "6.00", tipAmount: "2.00" });

    expect(rest.status).toBe(200);
    expect(rest.json).toMatchObject({ balance: { received: "0.00", tips: "0.00" } });
    const nothingLeft = await refund(billId, paymentId, {
      appliedAmount: "0.00",
      tipAmount: "0.01",
    });
    expect(nothingLeft.status).toBe(422);
    expect(nothingLeft.json).toMatchObject(exceeds({ applied: "0.00", tip: "0.00" }));
  });

  it("refuses a refund of a payment that took no money", async () => {
    const billId = await bill120();
    const paymentId = await insertBillPayment(billId, {
      method: "card",
      tendered: null,
      state: "failed",
      receivedAt: null,
      failedAt: new Date().toISOString(),
    });

    const refused = await refund(billId, paymentId, { appliedAmount: "1.00", tipAmount: "0.00" });

    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({
      code: "bill.refund_exceeds_payment",
      params: { paymentId, applied: "0.00", tip: "0.00" },
    });
  });

  it("refunds an item payment only whole, and the refund frees its line to be paid for again", async () => {
    const billId = await tabWith("Paella", "Chuletón");
    const paid = await pay(billId, {
      kind: "items",
      lines: [{ lineNo: 2 }],
      method: "cash",
      tendered: "25.00",
      applied: "25.00",
      tip: "0.00",
    });
    const paymentId = paymentIdOf(paid);

    const part = await refund(billId, paymentId, { appliedAmount: "10.00", tipAmount: "0.00" });
    expect(part.status).toBe(422);
    expect(part.json).toEqual({
      code: "bill.refund_not_whole",
      params: { paymentId, applied: "25.00", tip: "0.00" },
    });
    expect(await refundRows(paymentId)).toEqual([]);

    const whole = await refund(billId, paymentId, { appliedAmount: "25.00", tipAmount: "0.00" });
    expect(whole.status).toBe(200);
    expect(whole.json).toMatchObject({ balance: { paidLines: [] } });
    const again = await pay(billId, {
      kind: "items",
      lines: [{ lineNo: 2 }],
      method: "cash",
      tendered: "25.00",
      applied: "25.00",
      tip: "0.00",
    });
    expect(again.status).toBe(200);
  });

  it("keeps a line paid by an item payment of only a tip paid until that payment is refunded", async () => {
    const billId = await tabWith("Paella");
    const [line] = await inTx((tx) =>
      tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, billId)),
    );
    const paymentId = await insertBillPayment(billId, {
      kind: "items",
      applied: 0,
      tip: 100,
      tendered: 100,
    });
    await inTx((tx) =>
      tx
        .insert(billPaymentLines)
        .values({ billPaymentId: paymentId, lineId: line!.id, quantity: 1000, amount: 0 }),
    );
    expect((await balance(billId)).json).toMatchObject({ paidLines: [{ lineNo: 1 }] });

    const refunded = await refund(billId, paymentId, { appliedAmount: "0.00", tipAmount: "1.00" });

    expect(refunded.status).toBe(200);
    expect(refunded.json).toMatchObject({ balance: { paidLines: [] } });
  });

  it("lets the line of an item payment refunded whole be voided", async () => {
    const billId = await tabWith("Paella", "Chuletón");
    const paymentId = paymentIdOf(
      await pay(billId, {
        kind: "items",
        lines: [{ lineNo: 2 }],
        method: "cash",
        tendered: "25.00",
        applied: "25.00",
        tip: "0.00",
      }),
    );
    expect(
      (await refund(billId, paymentId, { appliedAmount: "25.00", tipAmount: "0.00" })).status,
    ).toBe(200);

    const voided = await request("DELETE", `/api/working-orders/${billId}/lines/2`);

    expect(voided.status).toBe(200);
    expect(await lineTotals(billId)).toEqual(["35.00"]);
  });

  it("refuses refunding a card charged on a terminal Waitron does not drive, writing nothing", async () => {
    const billId = await bill120();
    const paymentId = paymentIdOf(
      await pay(billId, {
        kind: "contribution",
        amount: "40.00",
        method: "card",
        entry: "manual",
        applied: "40.00",
        tip: "0.00",
      }),
    );

    const refused = await refund(billId, paymentId, { appliedAmount: "10.00", tipAmount: "0.00" });

    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({
      code: "bill.refund_unsupported",
      params: { paymentId },
    });
    expect(await refundRows(paymentId)).toEqual([]);
  });

  it("records a manager-confirmed hand-keyed card refund completed in both payment ledgers", async () => {
    const billId = await bill120();
    const paymentId = paymentIdOf(
      await pay(billId, {
        kind: "contribution",
        amount: "40.00",
        method: "card",
        entry: "manual",
        externalRef: "OP-7781",
        applied: "40.00",
        tip: "0.00",
      }),
    );

    const confirmed = await refund(billId, paymentId, {
      appliedAmount: "10.00",
      tipAmount: "0.00",
      manualConfirmed: true,
    });

    expect(confirmed.status).toBe(200);
    expect(confirmed.json).toMatchObject({
      refund: { paymentId, state: "completed", appliedAmount: "10.00" },
      balance: { received: "30.00", outstanding: "90.00" },
    });
    expect(await refundRows(paymentId)).toMatchObject([
      {
        state: "completed",
        appliedAmount: 1000,
        requestedBy: venue.staffId,
        authorizedBy: venue.adminId,
        tillId: venue.deviceTillId,
      },
    ]);
    const [manual] = await inTx((tx) =>
      tx.select().from(payments).where(eq(payments.billPaymentId, paymentId)),
    );
    expect(manual).toMatchObject({ provider: "manual", state: "partially_refunded" });
    expect(
      suite.db.all(
        sql`select amount, state, authorized_by from payment_refunds where payment_id = ${manual!.id}`,
      ),
    ).toEqual([{ amount: 1000, state: "succeeded", authorized_by: venue.adminId }]);
    expect(await saleOf(billId)).toEqual([]);
  });

  it("requires the manager's PIN for a confirmed hand-keyed card refund", async () => {
    const billId = await bill120();
    const paymentId = paymentIdOf(
      await pay(billId, {
        kind: "contribution",
        amount: "40.00",
        method: "card",
        entry: "manual",
        applied: "40.00",
        tip: "0.00",
      }),
    );

    const refused = await refund(billId, paymentId, {
      appliedAmount: "10.00",
      tipAmount: "0.00",
      manualConfirmed: true,
      override: undefined,
    });

    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({ code: "authorization.not_permitted" });
    expect(await refundRows(paymentId)).toEqual([]);
  });

  it("requires a manager PIN even when the operator has the refund permission", async () => {
    const billId = await bill120();
    const paymentId = paymentIdOf(
      await pay(billId, {
        kind: "contribution",
        amount: "40.00",
        method: "card",
        entry: "manual",
        applied: "40.00",
        tip: "0.00",
      }),
    );
    const adminSession = await inTx((tx) =>
      loginWithPin(tx, { tillId: venue.cfg.tillId, personId: venue.adminId, pin: "1234" }),
    );
    const deviceCookie = venue.cookie
      .split("; ")
      .find((part) => part.startsWith(`${DEVICE_COOKIE}=`));
    const adminCookie = `${SESSION_COOKIE}=${adminSession.token}; ${deviceCookie}`;

    const refused = await request(
      "POST",
      `/api/working-orders/${billId}/payments/${paymentId}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "10.00",
        tipAmount: "0.00",
        reason: "Devuelto en datáfono",
        manualConfirmed: true,
      },
      adminCookie,
    );

    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({
      code: "bill.manual_refund_pin_required",
      params: { paymentId },
    });
    expect(await refundRows(paymentId)).toEqual([]);

    const wrongPin = await request(
      "POST",
      `/api/working-orders/${billId}/payments/${paymentId}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "10.00",
        tipAmount: "0.00",
        reason: "Devuelto en datáfono",
        manualConfirmed: true,
        override: { personId: venue.adminId, pin: "9999" },
      },
      adminCookie,
    );
    expect(wrongPin.status).toBe(401);
    expect(wrongPin.json).toMatchObject({ code: "pin.invalid" });
    expect(await refundRows(paymentId)).toEqual([]);

    const confirmed = await request(
      "POST",
      `/api/working-orders/${billId}/payments/${paymentId}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "10.00",
        tipAmount: "0.00",
        reason: "Devuelto en datáfono",
        manualConfirmed: true,
        override: { personId: venue.adminId, pin: "1234" },
      },
      adminCookie,
    );
    expect(confirmed.status).toBe(200);
    expect(await refundRows(paymentId)).toMatchObject([{ authorizedBy: venue.adminId }]);
  });

  it("refuses terminal confirmation by a wrong PIN or a person without refund permission", async () => {
    const billId = await bill120();
    const paymentId = paymentIdOf(
      await pay(billId, {
        kind: "contribution",
        amount: "40.00",
        method: "card",
        entry: "manual",
        applied: "40.00",
        tip: "0.00",
      }),
    );
    const ask = { appliedAmount: "10.00", tipAmount: "0.00", manualConfirmed: true };

    const wrongPin = await refund(billId, paymentId, {
      ...ask,
      override: { personId: venue.adminId, pin: "9999" },
    });
    const noPermission = await refund(billId, paymentId, {
      ...ask,
      override: { personId: venue.staffId, pin: "5555" },
    });

    expect(wrongPin.status).toBe(401);
    expect(wrongPin.json).toMatchObject({ code: "pin.invalid" });
    expect(noPermission.status).toBe(403);
    expect(noPermission.json).toMatchObject({
      code: "authorization.not_permitted",
      params: { permission: "sale.refund" },
    });
    expect(await refundRows(paymentId)).toEqual([]);
  });

  it("does not replay a confirmed terminal refund as an unconfirmed request", async () => {
    const billId = await bill120();
    const paymentId = paymentIdOf(
      await pay(billId, {
        kind: "contribution",
        amount: "40.00",
        method: "card",
        entry: "manual",
        applied: "40.00",
        tip: "0.00",
      }),
    );
    const submissionId = randomUUID();
    const ask = { submissionId, appliedAmount: "10.00", tipAmount: "0.00" };

    expect((await refund(billId, paymentId, { ...ask, manualConfirmed: true })).status).toBe(200);
    const replay = await refund(billId, paymentId, ask);

    expect(replay.status).toBe(409);
    expect(replay.json).toMatchObject({ code: "submission.id_reused", params: { submissionId } });
    expect(await refundRows(paymentId)).toHaveLength(1);
  });

  it("refuses a refund while a card payment on the bill is at the reader", async () => {
    const billId = await bill120();
    const paymentId = paymentIdOf(await contribute(billId, "50.00"));
    await insertBillPayment(billId, {
      method: "card",
      tendered: null,
      state: "pending",
      receivedAt: null,
    });

    const refused = await refund(billId, paymentId, { appliedAmount: "10.00", tipAmount: "0.00" });

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      code: "order.payment_in_flight",
      params: { workingOrderId: billId },
    });
    expect(await refundRows(paymentId)).toEqual([]);
  });

  it("refuses a refund once the bill is invoiced", async () => {
    const billId = await tabWith("Tarta");
    const paymentId = paymentIdOf(await contribute(billId, "18.00"));
    expect(await statusOf(billId)).toBe("settled");

    const refused = await refund(billId, paymentId, { appliedAmount: "5.00", tipAmount: "0.00" });

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: billId },
    });
    expect(await refundRows(paymentId)).toEqual([]);
  });

  it("answers a payment the bill does not have as not found", async () => {
    const billId = await bill120();
    const otherBill = await bill120();
    const othersPayment = paymentIdOf(await contribute(otherBill, "10.00"));
    const unknown = randomUUID();

    const ofAnother = await refund(billId, othersPayment, {
      appliedAmount: "1.00",
      tipAmount: "0.00",
    });
    const missing = await refund(billId, unknown, { appliedAmount: "1.00", tipAmount: "0.00" });
    const malformed = await refund(billId, "nope", { appliedAmount: "1.00", tipAmount: "0.00" });

    expect(ofAnother.status).toBe(404);
    expect(ofAnother.json).toMatchObject({
      code: "bill.payment_not_found",
      params: { paymentId: othersPayment },
    });
    expect(missing.json).toMatchObject({
      code: "bill.payment_not_found",
      params: { paymentId: unknown },
    });
    expect(malformed.json).toMatchObject({ code: "bill.payment_not_found" });
    expect(await refundRows(othersPayment)).toEqual([]);
  });

  it("refuses a malformed refund by the field it names", async () => {
    const billId = await bill120();
    const paymentId = paymentIdOf(await contribute(billId, "50.00"));
    const path = `/api/working-orders/${billId}/payments/${paymentId}/refunds`;
    const good = {
      submissionId: randomUUID(),
      appliedAmount: "1.00",
      tipAmount: "0.00",
      reason: "Error",
    };

    const cases: [Record<string, unknown>, string][] = [
      [{ ...good, submissionId: "" }, "submissionId"],
      [{ ...good, appliedAmount: "1,00" }, "appliedAmount"],
      [{ ...good, tipAmount: undefined }, "tipAmount"],
      [{ ...good, appliedAmount: "0.00", tipAmount: "0.00" }, "appliedAmount"],
      [{ ...good, reason: "   " }, "reason"],
      [{ ...good, override: "1234" }, "override"],
      [{ ...good, manualConfirmed: null }, "manualConfirmed"],
    ];
    for (const [body, field] of cases) {
      const refused = await request("POST", path, body);
      expect(refused.status, field).toBe(400);
      expect(refused.json, field).toMatchObject({
        code: "management.request_invalid",
        params: { field },
      });
    }
    expect(await refundRows(paymentId)).toEqual([]);
  });
});

describe("refund retries (design §8 test 15, §5.1)", () => {
  it("answers the same refund sent twice with one refund row and one drawer job", async () => {
    const billId = await bill120();
    const paymentId = paymentIdOf(await contribute(billId, "50.00"));
    const body = { submissionId: randomUUID(), appliedAmount: "20.00", tipAmount: "0.00" };
    const jobsBefore = drawerJobCount();

    const first = await refund(billId, paymentId, body);
    const second = await refund(billId, paymentId, body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((second.json.refund as { id: string }).id).toBe(
      (first.json.refund as { id: string }).id,
    );
    expect(second.json).toMatchObject({ balance: { received: "30.00" } });
    expect(await refundRows(paymentId)).toHaveLength(1);
    expect(await refundDrawerOpens(paymentId)).toHaveLength(1);
    expect(drawerJobCount() - jobsBefore).toBe(1);
  });

  it("refuses the refund id resent with another amount, writing nothing", async () => {
    const billId = await bill120();
    const paymentId = paymentIdOf(await contribute(billId, "50.00"));
    const submissionId = randomUUID();
    expect(
      (await refund(billId, paymentId, { submissionId, appliedAmount: "20.00", tipAmount: "0.00" }))
        .status,
    ).toBe(200);

    const refused = await refund(billId, paymentId, {
      submissionId,
      appliedAmount: "15.00",
      tipAmount: "0.00",
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: "submission.id_reused", params: { submissionId } });
    expect(await refundRows(paymentId)).toHaveLength(1);
  });

  it("refuses a refund reusing the id of a payment, or of a refund of another payment, on the bill", async () => {
    const billId = await bill120();
    const paymentSubmission = randomUUID();
    const first = paymentIdOf(await contribute(billId, "30.00", paymentSubmission));
    const second = paymentIdOf(await contribute(billId, "20.00"));
    const refundSubmission = randomUUID();
    expect(
      (
        await refund(billId, first, {
          submissionId: refundSubmission,
          appliedAmount: "5.00",
          tipAmount: "0.00",
        })
      ).status,
    ).toBe(200);

    const reusedPayment = await refund(billId, second, {
      submissionId: paymentSubmission,
      appliedAmount: "5.00",
      tipAmount: "0.00",
    });
    const reusedRefund = await refund(billId, second, {
      submissionId: refundSubmission,
      appliedAmount: "5.00",
      tipAmount: "0.00",
    });

    expect(reusedPayment.status).toBe(409);
    expect(reusedPayment.json).toMatchObject({
      code: "submission.id_reused",
      params: { submissionId: paymentSubmission },
    });
    expect(reusedRefund.status).toBe(409);
    expect(reusedRefund.json).toMatchObject({
      code: "submission.id_reused",
      params: { submissionId: refundSubmission },
    });
    expect(await refundRows(second)).toEqual([]);
  });
});

function documentJobs() {
  return inTx((tx) =>
    tx
      .select({ id: printJobs.id, payload: printJobs.payload })
      .from(printJobs)
      .where(and(eq(printJobs.printerId, venue.printerId), eq(printJobs.kind, "document"))),
  );
}

describe("refund first (design §4.3, §6a)", () => {
  /** €60.00: Botella tinto €30.00, Pulpo €20.00, Croquetas €10.00, with €50.00 contributed. */
  async function sixtyHoldingFifty(): Promise<{ billId: string; paymentId: string }> {
    const billId = await tabWith("Botella tinto", "Pulpo", "Croquetas");
    const paymentId = paymentIdOf(await contribute(billId, "50.00"));
    return { billId, paymentId };
  }

  it("refuses moving €30.00 out by the €20.00 excess, and moves it after a €20.00 refund (design §8 test 7)", async () => {
    const { billId, paymentId } = await sixtyHoldingFifty();

    const refused = await request("POST", `/api/tabs/${billId}/split`, {
      transfers: [{ lineNo: 2 }, { lineNo: 3 }],
    });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      code: "bill.received_exceeds_total",
      params: { workingOrderId: billId, excess: "20.00" },
    });
    expect(await lineTotals(billId)).toEqual(["30.00", "20.00", "10.00"]);

    expect(
      (await refund(billId, paymentId, { appliedAmount: "20.00", tipAmount: "0.00" })).status,
    ).toBe(200);
    const moved = await request("POST", `/api/tabs/${billId}/split`, {
      transfers: [{ lineNo: 2 }, { lineNo: 3 }],
    });

    expect(moved.status).toBe(200);
    expect(await lineTotals(billId)).toEqual(["30.00"]);
    expect(await statusOf(billId)).toBe("settled");
    const [sale] = await saleOf(billId);
    expect(sale!.total).toBe(3000);
    expect(await tendersOf(sale!.id)).toMatchObject([
      { method: "cash", amount: 3000, tip: 0, billPaymentId: paymentId },
    ]);
  });

  it("refuses a €20.00 void by the €10.00 excess; after a €10.00 refund the void issues the €40.00 invoice with no tip (design §8 test 11)", async () => {
    const { billId, paymentId } = await sixtyHoldingFifty();

    const refused = await request("DELETE", `/api/working-orders/${billId}/lines/2`);
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      code: "bill.received_exceeds_total",
      params: { workingOrderId: billId, excess: "10.00" },
    });
    expect(await lineTotals(billId)).toEqual(["30.00", "20.00", "10.00"]);
    expect(registroCount(billId)).toBe(0);

    expect(
      (await refund(billId, paymentId, { appliedAmount: "10.00", tipAmount: "0.00" })).status,
    ).toBe(200);
    const jobsBefore = new Set((await documentJobs()).map((job) => job.id));
    const voided = await request("DELETE", `/api/working-orders/${billId}/lines/2`);

    expect(voided.status).toBe(200);
    expect(await statusOf(billId)).toBe("settled");
    expect(registroCount(billId)).toBe(1);
    const [sale] = await saleOf(billId);
    expect(sale!.total).toBe(4000);
    expect(await tendersOf(sale!.id)).toEqual([
      { method: "cash", amount: 4000, tip: 0, billPaymentId: paymentId },
    ]);
    const tickets = (await documentJobs())
      .filter((job) => !jobsBefore.has(job.id))
      .map((job) => printedLines(job.payload).map((line) => line.trim().replace(/\s+/g, " ")))
      .filter((printed) => printed.some((line) => line.startsWith("TOTAL")));
    expect(tickets).toHaveLength(1);
    const printed = tickets[0]!;
    const start = printed.findIndex((line) => line.startsWith("TOTAL"));
    expect(printed[start]).toBe("TOTAL 40,00 €");
    expect(
      printed
        .slice(start + 1)
        .filter((line) => line !== "")
        .slice(0, 3),
    ).toEqual(["Efectivo 50,00 €", "Devolución -10,00 €", "VERI*FACTU"]);
  });
});

describe("the ticket after a refund", () => {
  it("lists only the money actually given back, not a refund that did not complete", async () => {
    const billId = await tabWith("Botella tinto", "Pulpo", "Croquetas");
    const paymentId = paymentIdOf(await contribute(billId, "50.00"));
    expect(
      (await refund(billId, paymentId, { appliedAmount: "10.00", tipAmount: "0.00" })).status,
    ).toBe(200);
    await inTx((tx) =>
      tx.insert(billPaymentRefunds).values({
        billPaymentId: paymentId,
        submissionId: randomUUID(),
        fingerprint: "f",
        appliedAmount: 700,
        reason: "error",
        authorizedBy: venue.adminId,
        requestedBy: venue.adminId,
        tillId: venue.deviceTillId,
        state: "failed",
        failedAt: new Date().toISOString(),
      }),
    );
    const jobsBefore = new Set((await documentJobs()).map((job) => job.id));

    expect((await request("DELETE", `/api/working-orders/${billId}/lines/2`)).status).toBe(200);

    const printed = (await documentJobs())
      .filter((job) => !jobsBefore.has(job.id))
      .flatMap((job) => printedLines(job.payload))
      .map((line) => line.trim().replace(/\s+/g, " "));
    expect(printed.filter((line) => line.startsWith("Devolución"))).toEqual([
      "Devolución -10,00 €",
    ]);
  });
});

describe("a payment no card provider stands behind", () => {
  it("refuses a refund of a card payment with no provider row as unsupported, changing nothing", async () => {
    const billId = await bill120();
    const [row] = await inTx((tx) =>
      tx
        .insert(billPayments)
        .values({
          workingOrderId: billId,
          submissionId: randomUUID(),
          fingerprint: "attested",
          kind: "contribution",
          method: "card",
          applied: 2000,
          state: "received",
          receivedAt: new Date().toISOString(),
          requestedBy: venue.staffId,
          tillId: venue.deviceTillId,
        })
        .returning({ id: billPayments.id }),
    );

    const refused = await refund(billId, row!.id, { appliedAmount: "5.00", tipAmount: "0.00" });

    expect(refused.status).toBe(422);
    expect(refused.json).toEqual({
      code: "bill.refund_unsupported",
      params: { paymentId: row!.id },
    });
    expect(
      await inTx((tx) =>
        tx.select().from(billPaymentRefunds).where(eq(billPaymentRefunds.billPaymentId, row!.id)),
      ),
    ).toEqual([]);
    expect((await balance(billId)).json).toMatchObject({ received: "20.00" });
  });
});

describe("an item payment whose line has gone", () => {
  it("still lists the payment's line, with no line number, once it is refunded and voided", async () => {
    const billId = await tabWith("Paella", "Caña");
    const paid = await pay(billId, {
      kind: "items",
      lines: [{ lineNo: 2 }],
      method: "cash",
      tendered: "3.00",
      applied: "3.00",
      tip: "0.00",
    });
    const paymentId = paymentIdOf(paid);
    expect(
      (await refund(billId, paymentId, { appliedAmount: "3.00", tipAmount: "0.00" })).status,
    ).toBe(200);
    expect((await request("DELETE", `/api/working-orders/${billId}/lines/2`)).status).toBe(200);

    const { json } = await balance(billId);

    expect(json).toMatchObject({ total: "35.00", received: "0.00", paidLines: [] });
    const payment = (json.payments as { id: string; lines: unknown[] }[]).find(
      (p) => p.id === paymentId,
    );
    expect(payment!.lines).toEqual([
      { lineId: expect.any(String), lineNo: null, quantity: "1.000", amount: "3.00" },
    ]);
  });
});

describe("abandoning a bill after a full refund (design §8 test 14, §4.5)", () => {
  it("refuses abandoning a bill holding a contribution, and abandons it once that is refunded", async () => {
    const billId = await tabWith("Tarta");
    const paymentId = paymentIdOf(await contribute(billId, "5.00"));

    const refused = await request("DELETE", `/api/working-orders/${billId}`);
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      code: "bill.payments_received",
      params: { workingOrderId: billId },
    });
    expect(await statusOf(billId)).toBe("open");

    expect(
      (await refund(billId, paymentId, { appliedAmount: "5.00", tipAmount: "0.00" })).status,
    ).toBe(200);
    const abandoned = await request("DELETE", `/api/working-orders/${billId}`);

    expect(abandoned.status).toBe(200);
    expect(await statusOf(billId)).toBe("abandoned");
  });
});
