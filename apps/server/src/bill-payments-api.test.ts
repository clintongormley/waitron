import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billPaymentLines,
  billPaymentRefunds,
  billPayments,
  deviceProfiles,
  drawerOpens,
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
import { enrolDeviceForTest } from "./testing/enrol.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import type { TillConfig } from "./till-config.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { openTab } from "./working-order.js";
import "./errors.js";

// The bill payment routes (bill payments design §8 tests 2, 4, 5, 6, 8 and 9, and plan D8), driven
// over HTTP against a provisioned venue that files real Veri*Factu records. Each case opens its own
// tab, so a count read back is that case's alone.
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
  /** The till the enrolled device rings on. */
  deviceTillId: string;
  printerId: string;
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
      printerId: printer.id,
    };
  });
  const session = await withTransaction(db, (tx) =>
    loginWithPin(tx, { tillId: cfg.tillId, personId: seeded.personId, pin: "5555" }),
  );
  const device = await enrolDeviceForTest(db, cfg, { name: "Barra", profileId: seeded.profileId });
  const [deviceRow] = db.all<{ till_id: string }>(
    sql`select till_id from devices where id = ${device.deviceId}`,
  );
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
    deviceTillId: deviceRow!.till_id,
    printerId: seeded.printerId,
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
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await venue.app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: venue.cookie },
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

  it("answers an unknown bill as not found", async () => {
    const { status, json } = await balance(randomUUID());
    expect(status).toBe(404);
    expect(json).toMatchObject({ code: "working_order.not_found" });
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

  it("refuses a card on a reader for now, writing nothing", async () => {
    const billId = await bill120();

    const refused = await pay(billId, {
      kind: "contribution",
      amount: "40.00",
      method: "card",
      entry: "reader",
      applied: "40.00",
      tip: "0.00",
    });

    expect(refused.status).toBe(400);
    expect(refused.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "entry" },
    });
    expect(await paymentRows(billId)).toEqual([]);
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
    const billId = await tabWith("Paella");
    const round = await request("POST", `/api/working-orders/${billId}/round`, {
      lines: [{ menuItemId: offer("Tarta"), quantity: "1", hold: true }],
    });
    expect(round.status).toBe(200);
    const lines = await request("GET", `/api/working-orders/${billId}/lines`);
    const held = (
      lines.json.lines as { lineNo: number; firedAt: string | null; name: string }[]
    ).find((line) => line.name === "Tarta")!;
    expect(held.firedAt).toBeNull();

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

  it("files each line at the rate its product has when the last payment lands, until the rate is recorded on the line", async () => {
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
          .select({ vatRate: saleLines.vatRate })
          .from(saleLines)
          .where(eq(saleLines.saleId, sale!.id)),
      );
      expect(basisPointsToDecimal(line!.vatRate)).toBe("10.00");
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
    const billId = await tabWith("Paella", "Chuletón");
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

    const refused = await pay(billId, { ...body, lines: [{ lineNo: 2 }], applied: "25.00" });

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
