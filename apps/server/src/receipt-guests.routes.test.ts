import { placeOrder } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  billPayments,
  deviceProfiles,
  devices,
  printJobs,
  saleReceiptGuests,
  sales,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createCatalogue, createCategory, createProduct } from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { insertCapturedPayment, payments, SimulatorPaymentProvider } from "@waitron/payments";
import { createPrinter } from "@waitron/printing";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import { retryShapeOf, type BillPaymentRequest } from "./bill-payments.js";
import { deploymentEnvironment } from "./config.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { ALL_MODULES } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import { loadTillConfig } from "./till-config.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { decimal } from "@waitron/shared";
import { offerProducts } from "./testing/zone-offers.js";
import { BASIC_ACTIONS, deviceRequestCfg } from "./testing/session-device.js";
import { createTable } from "./testing/live-table.js";
import { fingerprint, seatTable } from "./parties.js";
import { payWorkingOrderIntegratedOrchestration } from "./till-sale.js";
import { addTabRound, createOpenOrder, parkOrder } from "./working-order.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const AT = new Date("2026-10-02T08:24:00.000Z");
const clock: TrustedClock = {
  now: () => ({
    instant: AT,
    offsetMinutes: 120,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("unused");
  },
  currentAnchor: () => null,
};

interface Venue {
  app: Hono;
  /** A till signed in on an enrolled device whose receipts print on the one printer. */
  till: string;
  /** An offer at 1,50 € in the counter zone. */
  menuItemId: string;
  db: Database;
  backend: VerifactuBackend;
  cfg: Awaited<ReturnType<typeof deviceRequestCfg>>;
  staffId: string;
  counterZone: string;
  tablesZone: string;
  /** The same product's offer in the tables zone. */
  tableItemId: string;
  /** A free product's offer at 0,00 € in the counter zone. */
  freeItemId: string;
  /** The free product's offer in the tables zone. */
  tableFreeItemId: string;
}

async function venue(db: Database): Promise<Venue> {
  const allocated = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "66000001Y",
        legalName: "Comensales SL",
        location: {
          name: "Sala",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES"],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Admin",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db, modules: ALL_MODULES },
  );
  const cfg = await deviceRequestCfg(db, {
    ...loadTillConfig({
      WAITRON_TILL_NODE_ID: allocated.nodeId,
      WAITRON_TILL_LOCATION_ID: allocated.locationId,
    }),
    simplifiedInvoiceLimit: null,
  });
  const {
    menuItemId,
    staffId,
    profileId,
    printerId,
    counterZone,
    tablesZone,
    tableItemId,
    freeItemId,
    tableFreeItemId,
  } = await withTransaction(db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Carta" });
    const category = await createCategory(tx, { name: "Tapas" });
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: category.id,
      name: "Pan",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const free = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: category.id,
      name: "Agua del grifo",
      pricingUnit: "each",
      unitPrice: "0.00",
      vatClass: "general",
    });
    const offers = await offerProducts(tx, cfg, { productIds: [product.id, free.id] });
    const tables = await offerProducts(tx, cfg, {
      zone: "tables",
      productIds: [product.id, free.id],
    });
    const [staff] = await tx
      .insert(persons)
      .values({ displayName: "Cajera", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    const { id: printerId } = await createPrinter(
      tx,
      { locationId: cfg.locationId },
      {
        name: "Recibos",
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
        hasCashDrawer: true,
      },
    );
    const [profile] = await tx
      .insert(deviceProfiles)
      .values({
        name: "Barra",
        formFactor: "till",
        capabilities: [
          ...BASIC_ACTIONS,
          "open-cash-drawer",
          "take-cash",
          "integrated-card-payment",
        ],
      })
      .returning({ id: deviceProfiles.id });
    return {
      menuItemId: offers.offerFor(product.id),
      staffId: staff!.id,
      profileId: profile!.id,
      printerId,
      counterZone: offers.zoneId,
      tablesZone: tables.zoneId,
      tableItemId: tables.offerFor(product.id),
      freeItemId: offers.offerFor(free.id),
      tableFreeItemId: tables.offerFor(free.id),
    };
  });
  const backend = new VerifactuBackend({
    clock,
    db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () => Promise.reject(new Error("a sale never submits inline")),
  });
  const app = new Hono();
  mountTillApi(
    app,
    {
      db,
      backend,
      clock,
      cfg,
      secureCookies: false,
      venueLocale: "es-ES",
      cardProvider: new SimulatorPaymentProvider(db),
    },
    () => {},
  );
  const device = await enrolDeviceForTest(db, cfg, { name: "Barra", profileId });
  const deviceCookie = `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
  const login = await app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: deviceCookie },
    body: JSON.stringify({ personId: staffId, pin: "5555" }),
  });
  const tillSession = login.headers.get("set-cookie")!.split(";")[0]!;
  await withTransaction(db, (tx) =>
    tx.update(devices).set({ receiptPrinterId: printerId, cashDrawerPrinterId: printerId }),
  );
  return {
    app,
    till: `${tillSession}; ${deviceCookie}`,
    menuItemId,
    db,
    backend,
    cfg,
    staffId,
    counterZone,
    tablesZone,
    tableItemId,
    freeItemId,
    tableFreeItemId,
  };
}

const CASH = { method: "cash", amount: "12.00" };

const BASE_FINGERPRINT = "13f0e57e4ee5aeb6378c0fb791c1778c4cc7cd95712930833a0596fcfef4df90";

/** Sells eight at 1,50 € (12,00 €) on `/api/sales`, with `extra` merged into the body. */
async function sell(
  v: Venue,
  extra: Record<string, unknown>,
  { id = randomUUID() as string, tender = CASH as Record<string, unknown> } = {},
): Promise<{ id: string; status: number; body: unknown }> {
  const res = await v.app.request("/api/sales", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: v.till },
    body: JSON.stringify({
      workingOrderId: id,
      lines: [{ menuItemId: v.menuItemId, quantity: "8" }],
      tender,
      ...extra,
    }),
  });
  return { id, status: res.status, body: await res.json() };
}

async function storedGuests(db: Database, workingOrderId: string) {
  return withTransaction(db, (tx) =>
    tx
      .select({ guests: saleReceiptGuests.guests })
      .from(saleReceiptGuests)
      .innerJoin(sales, eq(sales.id, saleReceiptGuests.saleId))
      .where(eq(sales.workingOrderId, workingOrderId)),
  );
}

/** The receipts printed so far, decoded, oldest first. */
async function receipts(db: Database): Promise<string[]> {
  const jobs = await withTransaction(db, (tx) =>
    tx
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .orderBy(sql`rowid`),
  );
  return jobs
    .map((job) => decodeTicket(new Uint8Array(job.payload)))
    .filter((text) => text.includes("TOTAL"));
}

const WRITTEN_TABLES = [
  "sales",
  "sale_receipt_guests",
  "print_jobs",
  "drawer_opens",
  "working_orders",
  "working_order_lines",
] as const;

function writtenTables(db: Database): Record<string, unknown[]> {
  return Object.fromEntries(
    WRITTEN_TABLES.map((name) => [name, db.all(sql.raw(`select * from ${name} order by rowid`))]),
  );
}

describe("/api/sales keeps the guests its receipt prints", () => {
  it("stores the chosen count and prints it with the share of 12,00 €", async () => {
    const v = await venue(suite.db);
    const sale = await sell(v, { guests: 5 });
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, sale.id)).toEqual([{ guests: 5 }]);
    const [receipt] = await receipts(suite.db);
    expect(receipt).toContain("5 comensales · por persona");
    expect(receipt).toContain("2,40 €");
  });

  it("stores no line for null and prints no guests", async () => {
    const v = await venue(suite.db);
    const sale = await sell(v, { guests: null });
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, sale.id)).toEqual([{ guests: null }]);
    const [receipt] = await receipts(suite.db);
    expect(receipt).not.toContain("comensal");
  });

  it("stores a counter sale's default, no line, when the request sends no guests", async () => {
    const v = await venue(suite.db);
    const sale = await sell(v, {});
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, sale.id)).toEqual([{ guests: null }]);
  });

  it.each([[0], [1000], [2.5], ["4"], [true]])(
    "refuses guests %j before writing anything",
    async (guests) => {
      const v = await venue(suite.db);
      const before = writtenTables(suite.db);
      const sale = await sell(v, { guests });
      expect(sale.status).toBe(400);
      expect(sale.body).toEqual({
        error: { code: "management.request_invalid", params: { field: "guests" } },
      });
      expect(writtenTables(suite.db)).toEqual(before);
    },
  );

  it("stores the count on a hand-keyed card sale", async () => {
    const v = await venue(suite.db);
    const sale = await sell(v, { guests: 3 }, { tender: { method: "card", amount: "12.00" } });
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, sale.id)).toEqual([{ guests: 3 }]);
  });

  it("keeps the first count when the same sale is sent again with another", async () => {
    const v = await venue(suite.db);
    const first = await sell(v, { guests: 5 });
    expect(first.status).toBe(200);
    const again = await sell(v, { guests: 7 }, { id: first.id });
    expect(again.status).toBe(200);
    expect(await storedGuests(suite.db, first.id)).toEqual([{ guests: 5 }]);
  });
});

/** A party of 4 seated on one bill holding eight at 1,50 € (12,00 €), never sent. */
async function partyOfFourBill(v: Venue): Promise<string> {
  return partyBill(v, 4);
}

/** A party of `guestCount` on one bill holding `quantity` of `menuItemId` (eight at 1,50 € unless named), never sent. */
async function partyBill(
  v: Venue,
  guestCount: number,
  { menuItemId = v.tableItemId, quantity = "8" } = {},
): Promise<string> {
  return withTransaction(v.db, async (tx) => {
    const { id: tableId } = await createTable(tx, v.cfg, {
      label: `Mesa ${randomUUID().slice(0, 8)}`,
      zoneId: v.tablesZone,
    });
    const { tabId } = await seatTable(tx, v.cfg, { tableId, guestCount, operatorId: v.staffId });
    await addTabRound(tx, v.cfg, tabId, [{ menuItemId, quantity }]);
    return tabId;
  });
}

describe("/api/sales on a party's bill tells a chosen no line from the default", () => {
  it("stores no line for null, and prints no guests", async () => {
    const v = await venue(suite.db);
    const billId = await partyOfFourBill(v);
    const sale = await sell(v, { lines: [], guests: null }, { id: billId });
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: null }]);
    const [receipt] = await receipts(suite.db);
    expect(receipt).not.toContain("comensal");
  });

  it("stores the party's 4 when the request sends no guests", async () => {
    const v = await venue(suite.db);
    const billId = await partyOfFourBill(v);
    const sale = await sell(v, { lines: [] }, { id: billId });
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: 4 }]);
  });
});

/** A counter order of eight at 1,50 € (12,00 €), parked and placed, with no invoice yet. */
async function placedCounterOrder(v: Venue): Promise<string> {
  const id = randomUUID();
  const deps = { db: v.db, backend: v.backend, clock };
  await parkOrder(deps, v.cfg, {
    id,
    lines: [{ menuItemId: v.menuItemId, quantity: "8" }],
    zoneId: v.counterZone,
    operatorId: v.staffId,
  });
  await placeOrder(deps, v.cfg, id, v.staffId);
  return id;
}

async function collect(
  v: Venue,
  id: string,
  extra: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const res = await v.app.request(`/api/working-orders/${id}/collect`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: v.till },
    body: JSON.stringify({ tender: CASH, ...extra }),
  });
  return { status: res.status, body: await res.json() };
}

/** {@link partyOfFourBill}, placed, with no invoice yet. */
async function placedPartyBill(v: Venue): Promise<string> {
  const billId = await partyOfFourBill(v);
  await placeOrder({ db: v.db, backend: v.backend, clock }, v.cfg, billId, v.staffId);
  return billId;
}

describe("/collect of a placed order keeps the guests its receipt prints", () => {
  it("stores a party's 4 when the request sends no guests", async () => {
    const v = await venue(suite.db);
    const id = await placedPartyBill(v);
    const answer = await collect(v, id, {});
    expect(answer.status).toBe(200);
    expect(await storedGuests(suite.db, id)).toEqual([{ guests: 4 }]);
  });

  it("stores no line for a party's bill when the request sends null", async () => {
    const v = await venue(suite.db);
    const id = await placedPartyBill(v);
    const answer = await collect(v, id, { guests: null });
    expect(answer.status).toBe(200);
    expect(await storedGuests(suite.db, id)).toEqual([{ guests: null }]);
  });

  it("stores the chosen count", async () => {
    const v = await venue(suite.db);
    const id = await placedCounterOrder(v);
    const answer = await collect(v, id, { guests: 2 });
    expect(answer.status).toBe(200);
    expect(await storedGuests(suite.db, id)).toEqual([{ guests: 2 }]);
  });

  it("stores a counter order's default, no line, when the request sends no guests", async () => {
    const v = await venue(suite.db);
    const id = await placedCounterOrder(v);
    const answer = await collect(v, id, {});
    expect(answer.status).toBe(200);
    expect(await storedGuests(suite.db, id)).toEqual([{ guests: null }]);
  });

  it("refuses guests 0 and records no sale", async () => {
    const v = await venue(suite.db);
    const id = await placedCounterOrder(v);
    const answer = await collect(v, id, { guests: 0 });
    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({
      error: { code: "management.request_invalid", params: { field: "guests" } },
    });
    expect(
      await withTransaction(suite.db, (tx) =>
        tx.select().from(sales).where(eq(sales.workingOrderId, id)),
      ),
    ).toEqual([]);
  });
});

/** Pays eight at 1,50 € (12,00 €) on `/api/pay` through the simulator, with `extra` merged into the body. */
async function payByReader(
  v: Venue,
  extra: Record<string, unknown>,
  { id = randomUUID() as string } = {},
): Promise<{ id: string; status: number; body: unknown }> {
  const res = await v.app.request("/api/pay", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: v.till },
    body: JSON.stringify({
      id,
      lines: [{ menuItemId: v.menuItemId, quantity: "8" }],
      simulationOutcome: "captured",
      ...extra,
    }),
  });
  return { id, status: res.status, body: await res.json() };
}

async function paymentsOf(db: Database, workingOrderId: string) {
  return withTransaction(db, (tx) =>
    tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.workingOrderId, workingOrderId)),
  );
}

async function salesOf(db: Database, workingOrderId: string) {
  return withTransaction(db, (tx) =>
    tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, workingOrderId)),
  );
}

describe("/api/pay keeps the guests its receipt prints", () => {
  it("stores the chosen count of a captured card and prints it with the share of 12,00 €", async () => {
    const v = await venue(suite.db);
    const pay = await payByReader(v, { guests: 5 });
    expect(pay.status).toBe(200);
    expect((pay.body as { outcome: string }).outcome).toBe("captured");
    expect(await storedGuests(suite.db, pay.id)).toEqual([{ guests: 5 }]);
    const [receipt] = await receipts(suite.db);
    expect(receipt).toContain("5 comensales · por persona");
    expect(receipt).toContain("2,40 €");
  });

  it("stores no line for null", async () => {
    const v = await venue(suite.db);
    const pay = await payByReader(v, { guests: null });
    expect(pay.status).toBe(200);
    expect(await storedGuests(suite.db, pay.id)).toEqual([{ guests: null }]);
  });

  it("stores a party's 4 when the request sends no guests", async () => {
    const v = await venue(suite.db);
    const billId = await partyOfFourBill(v);
    const pay = await payByReader(v, { lines: [] }, { id: billId });
    expect(pay.status).toBe(200);
    expect((pay.body as { outcome: string }).outcome).toBe("captured");
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: 4 }]);
  });

  it("stores no line for null on a party's bill", async () => {
    const v = await venue(suite.db);
    const billId = await partyOfFourBill(v);
    const pay = await payByReader(v, { lines: [], guests: null }, { id: billId });
    expect(pay.status).toBe(200);
    expect((pay.body as { outcome: string }).outcome).toBe("captured");
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: null }]);
  });

  it("stores nothing and records no sale when the card is declined", async () => {
    const v = await venue(suite.db);
    const pay = await payByReader(v, { guests: 5, simulationOutcome: "declined" });
    expect(pay.status).toBe(200);
    expect((pay.body as { outcome: string }).outcome).toBe("declined");
    expect(await salesOf(suite.db, pay.id)).toEqual([]);
    expect(await storedGuests(suite.db, pay.id)).toEqual([]);
  });

  it("stores the count of the Pay that files a card captured before a lost response", async () => {
    const v = await venue(suite.db);
    const id = randomUUID();
    await withTransaction(v.db, async (tx) => {
      await createOpenOrder(tx, v.cfg, id, [{ menuItemId: v.menuItemId, quantity: "8" }], null, {
        zoneId: v.counterZone,
      });
      await insertCapturedPayment(tx, {
        origin: v.cfg.origin,
        workingOrderId: id,
        provider: "simulator",
        paymentRef: `sim-ref-${randomUUID()}`,
        amount: decimal("12.00"),
        settledAt: new Date(),
        externalRef: `sim-lost-${randomUUID()}`,
      });
    });
    const pay = await payByReader(v, { lines: [], guests: 3 }, { id });
    expect(pay.status).toBe(200);
    expect((pay.body as { outcome: string }).outcome).toBe("captured");
    expect(await paymentsOf(suite.db, id)).toHaveLength(1);
    expect(await storedGuests(suite.db, id)).toEqual([{ guests: 3 }]);
    const [receipt] = await receipts(suite.db);
    expect(receipt).toContain("3 comensales · por persona");
  });

  it("stores the chosen count of an order with nothing to charge", async () => {
    const v = await venue(suite.db);
    const pay = await payByReader(v, {
      lines: [{ menuItemId: v.freeItemId, quantity: "1" }],
      guests: 2,
    });
    expect(pay.status).toBe(200);
    expect((pay.body as { outcome: string }).outcome).toBe("captured");
    expect(await paymentsOf(suite.db, pay.id)).toEqual([]);
    expect(await storedGuests(suite.db, pay.id)).toEqual([{ guests: 2 }]);
  });

  it.each([[0], [1000], [2.5], ["4"], [true]])(
    "refuses guests %j before the reader is asked",
    async (guests) => {
      const v = await venue(suite.db);
      const before = writtenTables(suite.db);
      const pay = await payByReader(v, { guests });
      expect(pay.status).toBe(400);
      expect(pay.body).toEqual({
        error: { code: "management.request_invalid", params: { field: "guests" } },
      });
      expect(await paymentsOf(suite.db, pay.id)).toEqual([]);
      expect(writtenTables(suite.db)).toEqual(before);
    },
  );
});

/** A card captured for the bill at 12,00 € whose answer never reached the till: a payment with no sale. */
async function lostCapture(v: Venue, id: string): Promise<void> {
  await withTransaction(v.db, (tx) =>
    insertCapturedPayment(tx, {
      origin: v.cfg.origin,
      workingOrderId: id,
      provider: "simulator",
      paymentRef: `sim-ref-${randomUUID()}`,
      amount: decimal("12.00"),
      settledAt: new Date(),
      externalRef: `sim-lost-${randomUUID()}`,
    }),
  );
}

/** Files a captured payment as the recovery loop and the manager's resolve do: no till request, no guests. */
async function recover(v: Venue, id: string) {
  return payWorkingOrderIntegratedOrchestration(
    { db: v.db, backend: v.backend, clock, provider: new SimulatorPaymentProvider(v.db) },
    v.cfg,
    { id, lines: [] },
  );
}

describe("a recovery with no till request stores the default guests", () => {
  it("stores a party's 4 when it files a captured card", async () => {
    const v = await venue(suite.db);
    const billId = await partyOfFourBill(v);
    await lostCapture(v, billId);
    const out = await recover(v, billId);
    expect(out.outcome).toBe("captured");
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: 4 }]);
  });
});

describe("a party above 999 guests still pays, its receipt printing no guests", () => {
  it("files a reader payment that sends no guests", async () => {
    const v = await venue(suite.db);
    const billId = await partyBill(v, 1000);
    const pay = await payByReader(v, { lines: [] }, { id: billId });
    expect(pay.status).toBe(200);
    expect((pay.body as { outcome: string }).outcome).toBe("captured");
    expect(await salesOf(suite.db, billId)).toHaveLength(1);
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: null }]);
  });

  it("files a card captured before a lost response when no till request sends guests", async () => {
    const v = await venue(suite.db);
    const billId = await partyBill(v, 1000);
    await lostCapture(v, billId);
    const out = await recover(v, billId);
    expect(out.outcome).toBe("captured");
    expect(await salesOf(suite.db, billId)).toHaveLength(1);
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: null }]);
  });

  it("files a cash sale on /api/sales that sends no guests", async () => {
    const v = await venue(suite.db);
    const billId = await partyBill(v, 1000);
    const sale = await sell(v, { lines: [] }, { id: billId });
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: null }]);
  });
});

describe("/api/pay with nothing to charge on a placed party bill", () => {
  it("stores the chosen count", async () => {
    const v = await venue(suite.db);
    const billId = await partyBill(v, 4, { menuItemId: v.tableFreeItemId, quantity: "1" });
    await placeOrder({ db: v.db, backend: v.backend, clock }, v.cfg, billId, v.staffId);
    const pay = await payByReader(v, { lines: [], guests: 2 }, { id: billId });
    expect(pay.status).toBe(200);
    expect((pay.body as { outcome: string }).outcome).toBe("captured");
    expect(await paymentsOf(suite.db, billId)).toEqual([]);
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: 2 }]);
  });
});

/** A part payment of the bill on `/payments`, with `extra` merged into the body. */
async function payPart(
  v: Venue,
  billId: string,
  extra: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await v.app.request(`/api/working-orders/${billId}/payments`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: v.till },
    body: JSON.stringify({
      submissionId: randomUUID(),
      kind: "contribution",
      tip: "0.00",
      ...extra,
    }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function cashPart(amount: string, extra: Record<string, unknown> = {}) {
  return { amount, method: "cash", tendered: amount, applied: amount, ...extra };
}

/** A party of 4 on one bill of fourteen at 1,50 € (21,00 €), 10,00 € of it paid in cash. */
async function partlyPaidBill(v: Venue): Promise<string> {
  const billId = await partyBill(v, 4, { quantity: "14" });
  expect((await payPart(v, billId, cashPart("10.00"))).status).toBe(200);
  return billId;
}

describe("/payments keeps the guests of the payment that completes the bill", () => {
  it("ignores the guests of a payment that leaves the bill unpaid, and stores the completing one's", async () => {
    const v = await venue(suite.db);
    const billId = await partyBill(v, 4, { quantity: "14" });
    expect((await payPart(v, billId, cashPart("10.00", { guests: 5 }))).status).toBe(200);
    expect(await storedGuests(suite.db, billId)).toEqual([]);
    const last = await payPart(v, billId, cashPart("11.00", { guests: 3 }));
    expect(last.status).toBe(200);
    expect(last.body.invoice).toBeDefined();
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: 3 }]);
    const [receipt] = await receipts(suite.db);
    expect(receipt).toContain("3 comensales · por persona");
    expect(receipt).toContain("7,00 €");
  });

  it("stores no line when a hand-keyed card completes it with null", async () => {
    const v = await venue(suite.db);
    const billId = await partlyPaidBill(v);
    const last = await payPart(v, billId, {
      amount: "11.00",
      method: "card",
      entry: "manual",
      applied: "11.00",
      guests: null,
    });
    expect(last.status).toBe(200);
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: null }]);
  });

  it("stores the party's 4 when the completing payment sends no guests", async () => {
    const v = await venue(suite.db);
    const billId = await partlyPaidBill(v);
    expect((await payPart(v, billId, cashPart("11.00"))).status).toBe(200);
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: 4 }]);
  });

  it("stores the count of a reader card that completes it while the till waits", async () => {
    const v = await venue(suite.db);
    const billId = await partlyPaidBill(v);
    const last = await payPart(v, billId, {
      amount: "11.00",
      method: "card",
      entry: "reader",
      applied: "11.00",
      simulationOutcome: "captured",
      guests: 2,
    });
    expect(last.status).toBe(200);
    expect(last.body.outcome).toBe("received");
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: 2 }]);
  });

  it("refuses guests 2.5 and writes no payment", async () => {
    const v = await venue(suite.db);
    const billId = await partyBill(v, 4, { quantity: "14" });
    const refused = await payPart(v, billId, cashPart("10.00", { guests: 2.5 }));
    expect(refused).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "guests" } } },
    });
    expect(
      await withTransaction(suite.db, (tx) =>
        tx.select().from(billPayments).where(eq(billPayments.workingOrderId, billId)),
      ),
    ).toEqual([]);
  });
});

describe("a bill payment's retry is matched on the payment alone, never its guests", () => {
  async function storedPayments(db: Database, billId: string) {
    return withTransaction(db, (tx) =>
      tx
        .select({ id: billPayments.id, fingerprint: billPayments.fingerprint })
        .from(billPayments)
        .where(eq(billPayments.workingOrderId, billId)),
    );
  }

  it("replays a payment that leaves the bill unpaid whatever guests the resend carries", async () => {
    const v = await venue(suite.db);
    const billId = await partyBill(v, 4, { quantity: "14" });
    const submissionId = randomUUID();
    const first = await payPart(v, billId, { submissionId, ...cashPart("10.00", { guests: 3 }) });
    expect(first.status).toBe(200);
    const paymentId = (first.body.payment as { id: string }).id;
    for (const guests of [{ guests: 9 }, { guests: null }, {}]) {
      const again = await payPart(v, billId, { submissionId, ...cashPart("10.00", guests) });
      expect([again.status, (again.body.payment as { id: string } | undefined)?.id]).toEqual([
        200,
        paymentId,
      ]);
    }
    const request: BillPaymentRequest = {
      kind: "contribution",
      method: "cash",
      amount: "10.00",
      tendered: "10.00",
      submissionId,
      applied: "10.00",
      tip: "0.00",
    };
    expect(await storedPayments(suite.db, billId)).toEqual([
      { id: paymentId, fingerprint: fingerprint(retryShapeOf(request)) },
    ]);
  });

  it("stores the fingerprint a request with no guests was stored under before guests existed", async () => {
    const v = await venue(suite.db);
    const billId = await partyBill(v, 4, { quantity: "14" });
    expect((await payPart(v, billId, cashPart("10.00"))).status).toBe(200);
    // Measured on e3b6e09bb, before `/payments` read guests, for this same body.
    expect((await storedPayments(suite.db, billId))[0]!.fingerprint).toBe(BASE_FINGERPRINT);
  });

  it("replays a completing payment re-sent with other guests, and the row keeps its count", async () => {
    const v = await venue(suite.db);
    const billId = await partlyPaidBill(v);
    const submissionId = randomUUID();
    const first = await payPart(v, billId, { submissionId, ...cashPart("11.00", { guests: 3 }) });
    expect(first.status).toBe(200);
    const again = await payPart(v, billId, { submissionId, ...cashPart("11.00", { guests: 9 }) });
    expect(again.status).toBe(200);
    expect((again.body.payment as { id: string }).id).toBe(
      (first.body.payment as { id: string }).id,
    );
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: 3 }]);
  });
});
