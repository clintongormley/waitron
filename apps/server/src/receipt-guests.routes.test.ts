import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { writePartyAllergy } from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import { observedPaymentBody } from "./testing/bill-payment-fixture.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  billPayments,
  devices,
  printJobs,
  sales,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createCategory, createProduct } from "@waitron/menu";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { fixturePinHash, fixturePasswordHash } from "./testing/known-secret-hashes.js";
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
import { loadNodeIdentity } from "./node-config.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { decimal } from "@waitron/shared";
import { offerProducts } from "./testing/zone-offers.js";
import { BASIC_ACTIONS, deviceRequestCfg } from "./testing/session-device.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import { createTable } from "./testing/live-table.js";
import { fingerprint, seatTable } from "./parties.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { createOpenOrder, parkOrder } from "./working-order-open.js";
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
  cfg: DeviceRequestConfig;
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
        name: "Sala",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        addressLine1: "Calle 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        seriesCode: "A",
        correctiveSeriesCode: "R",
        admin: {
          displayName: "Admin",
          pinHash: fixturePinHash("1234"),
          passwordHash: fixturePasswordHash("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db, modules: ALL_MODULES },
  );
  const cfg = await deviceRequestCfg(db, {
    locale: "es-ES",
    ...loadNodeIdentity({
      WAITRON_NODE_ID: allocated.nodeId,
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
    const category = await createCategory(tx, { name: "Tapas" });
    const product = await createProduct(tx, {
      categoryId: category.id,
      name: "Pan",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const free = await createProduct(tx, {
      categoryId: category.id,
      name: "Agua del grifo",
      pricingUnit: "each",
      unitPrice: "0.00",
      vatClass: "general",
    });
    const offers = await offerProducts(tx, { productIds: [product.id, free.id] });
    const tables = await offerProducts(tx, {
      zone: "tables",
      productIds: [product.id, free.id],
    });
    const [staff] = await seedPersons(tx, {
      displayName: "Cashier",
      pinHash: fixturePinHash("5555"),
      role: "staff",
    });
    const { id: printerId } = await createPrinter(tx, {
      name: "Recibos",
      transport: "cloud_poll",
      pollId: `poll-${randomUUID()}`,
      hasCashDrawer: true,
    });
    const [profile] = await seedDeviceProfiles(tx, {
      name: "Barra",
      formFactor: "till",
      capabilities: [
        ...BASIC_ACTIONS,
        "print-receipt",
        "open-cash-drawer",
        "take-cash",
        "integrated-card-payment",
      ],
    });
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
  });
  const app = new Hono();
  mountTillApi(
    app,
    {
      admission: testTradingAdmission(),
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

async function payCounter(
  v: Venue,
  extra: Record<string, unknown>,
  id = randomUUID() as string,
): Promise<{ id: string; status: number; body: Record<string, unknown> }> {
  return {
    id,
    ...(await payPart(v, id, {
      kind: "share",
      shareOf: 1,
      expectedEdit: null,
      dining: "eat_in",
      basket: { lines: [{ menuItemId: v.menuItemId, quantity: "8" }] },
      ...extra,
    })),
  };
}

const COUNTER_CASH = { method: "cash", tendered: "12.00" };
const COUNTER_READER = { method: "card", entry: "reader", simulationOutcome: "captured" };

async function storedGuests(db: Database, workingOrderId: string) {
  return withTransaction(db, (tx) =>
    tx
      .select({ guests: sales.receiptGuestCount })
      .from(sales)
      .where(
        and(
          eq(sales.workingOrderId, workingOrderId),
          isNotNull(sales.receiptTradingName),
          isNull(sales.counterpartyTaxId),
        ),
      ),
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
    .map((job) => decodeTicket(new Uint8Array(job.payload!)))
    .filter((text) => text.includes("TOTAL"));
}

const WRITTEN_TABLES = [
  "sales",
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

describe("a counter cash payment keeps the guests its receipt prints", () => {
  it("stores the chosen count and prints it with the share of 12,00 €", async () => {
    const v = await venue(suite.db);
    const sale = await payCounter(v, { ...COUNTER_CASH, guestCount: 5 });
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, sale.id)).toEqual([{ guests: 5 }]);
    expect(
      (
        await v.app.request(`/api/sales/${sale.id}/receipt`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: v.till },
          body: "{}",
        })
      ).status,
    ).toBe(200);
    const [receipt] = await receipts(suite.db);
    expect(receipt).toContain("5 comensales · por persona");
    expect(receipt).toContain("2,40 €");
  });

  it("stores no line for null and prints no guests", async () => {
    const v = await venue(suite.db);
    const sale = await payCounter(v, { ...COUNTER_CASH, guestCount: null });
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, sale.id)).toEqual([{ guests: null }]);
    expect(
      (
        await v.app.request(`/api/sales/${sale.id}/receipt`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: v.till },
          body: "{}",
        })
      ).status,
    ).toBe(200);
    const [receipt] = await receipts(suite.db);
    expect(receipt).not.toContain("comensal");
  });

  it("stores a counter sale's default, no line, when the request sends no guests", async () => {
    const v = await venue(suite.db);
    const sale = await payCounter(v, COUNTER_CASH);
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, sale.id)).toEqual([{ guests: null }]);
  });

  it.each([[0], [1000], [2.5], ["4"], [true]])(
    "refuses guests %j before writing anything",
    async (guestCount) => {
      const v = await venue(suite.db);
      const before = writtenTables(suite.db);
      const sale = await payCounter(v, { ...COUNTER_CASH, guestCount });
      expect(sale.status).toBe(400);
      expect(sale.body).toEqual({
        error: { code: "management.request_invalid", params: { field: "guestCount" } },
      });
      expect(writtenTables(suite.db)).toEqual(before);
    },
  );

  it("stores the count on a hand-keyed card sale", async () => {
    const v = await venue(suite.db);
    const sale = await payCounter(v, { method: "card", entry: "manual", guestCount: 3 });
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, sale.id)).toEqual([{ guests: 3 }]);
  });

  it("keeps the first count when the same sale is sent again with another", async () => {
    const v = await venue(suite.db);
    const submissionId = randomUUID();
    const first = await payCounter(v, { ...COUNTER_CASH, submissionId, guestCount: 5 });
    expect(first.status).toBe(200);
    const again = await payCounter(v, { ...COUNTER_CASH, submissionId, guestCount: 7 }, first.id);
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
    const { id: tableId } = await createTable(tx, {
      label: `Mesa ${randomUUID().slice(0, 8)}`,
      zoneId: v.tablesZone,
    });
    const { tabId, partyId } = await seatTable(tx, v.cfg, {
      tableId,
      guestCount,
      operatorId: v.staffId,
    });
    await writePartyAllergy(tx, partyId, { answer: "none", guests: [] }, v.staffId);
    await addTabRound(tx, v.cfg, tabId, [{ menuItemId, quantity }]);
    return tabId;
  });
}

describe("a party bill distinguishes a chosen no line from the default", () => {
  it("stores no line for null, and prints no guests", async () => {
    const v = await venue(suite.db);
    const billId = await partyOfFourBill(v);
    const sale = await payPart(v, billId, cashPart("12.00", { guestCount: null }));
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: null }]);
    expect(
      (
        await v.app.request(`/api/sales/${billId}/receipt`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: v.till },
          body: "{}",
        })
      ).status,
    ).toBe(200);
    const [receipt] = await receipts(suite.db);
    expect(receipt).not.toContain("comensal");
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
  await placeOrder({ ...deps, admission: testTradingAdmission() }, v.cfg, id, v.staffId);
  return id;
}

/** {@link partyOfFourBill}, placed, with no invoice yet. */
async function placedPartyBill(v: Venue): Promise<string> {
  const billId = await partyOfFourBill(v);
  await placeOrder(
    { admission: testTradingAdmission(), db: v.db, backend: v.backend, clock },
    v.cfg,
    billId,
    v.staffId,
  );
  return billId;
}

describe("a payment of a placed order keeps the guests its receipt prints", () => {
  it("stores a party's 4 when the request sends no guests", async () => {
    const v = await venue(suite.db);
    const id = await placedPartyBill(v);
    const answer = await payPart(v, id, cashPart("12.00"));
    expect(answer.status).toBe(200);
    expect(await storedGuests(suite.db, id)).toEqual([{ guests: 4 }]);
  });

  it("stores no line for a party's bill when the request sends null", async () => {
    const v = await venue(suite.db);
    const id = await placedPartyBill(v);
    const answer = await payPart(v, id, cashPart("12.00", { guestCount: null }));
    expect(answer.status).toBe(200);
    expect(await storedGuests(suite.db, id)).toEqual([{ guests: null }]);
  });

  it("stores the chosen count", async () => {
    const v = await venue(suite.db);
    const id = await placedCounterOrder(v);
    const answer = await payPart(v, id, cashPart("12.00", { guestCount: 2 }));
    expect(answer.status).toBe(200);
    expect(await storedGuests(suite.db, id)).toEqual([{ guests: 2 }]);
  });

  it("stores a counter order's default, no line, when the request sends no guests", async () => {
    const v = await venue(suite.db);
    const id = await placedCounterOrder(v);
    const answer = await payPart(v, id, cashPart("12.00"));
    expect(answer.status).toBe(200);
    expect(await storedGuests(suite.db, id)).toEqual([{ guests: null }]);
  });

  it("refuses guests 0 and records no sale", async () => {
    const v = await venue(suite.db);
    const id = await placedCounterOrder(v);
    const answer = await payPart(v, id, cashPart("12.00", { guestCount: 0 }));
    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({
      error: { code: "management.request_invalid", params: { field: "guestCount" } },
    });
    expect(
      await withTransaction(suite.db, (tx) =>
        tx.select().from(sales).where(eq(sales.workingOrderId, id)),
      ),
    ).toEqual([]);
  });
});

function paySavedByReader(v: Venue, id: string, extra: Record<string, unknown> = {}) {
  return payPart(v, id, { ...COUNTER_READER, amount: "12.00", applied: "12.00", ...extra });
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

describe("a reader payment keeps the guests its receipt prints", () => {
  it("stores the chosen count of a captured card and prints it with the share of 12,00 €", async () => {
    const v = await venue(suite.db);
    const pay = await payCounter(v, { ...COUNTER_READER, guestCount: 5 });
    expect(pay.status).toBe(200);
    expect(pay.body.outcome).toBe("received");
    expect(await storedGuests(suite.db, pay.id)).toEqual([{ guests: 5 }]);
    expect(
      (
        await v.app.request(`/api/sales/${pay.id}/receipt`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: v.till },
          body: "{}",
        })
      ).status,
    ).toBe(200);
    const [receipt] = await receipts(suite.db);
    expect(receipt).toContain("5 comensales · por persona");
    expect(receipt).toContain("2,40 €");
  });

  it("stores no line for null", async () => {
    const v = await venue(suite.db);
    const pay = await payCounter(v, { ...COUNTER_READER, guestCount: null });
    expect(pay.status).toBe(200);
    expect(await storedGuests(suite.db, pay.id)).toEqual([{ guests: null }]);
  });

  it("stores a party's 4 when the request sends no guests", async () => {
    const v = await venue(suite.db);
    const billId = await partyOfFourBill(v);
    const pay = await paySavedByReader(v, billId);
    expect(pay.status).toBe(200);
    expect(pay.body.outcome).toBe("received");
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: 4 }]);
  });

  it("stores no line for null on a party's bill", async () => {
    const v = await venue(suite.db);
    const billId = await partyOfFourBill(v);
    const pay = await paySavedByReader(v, billId, { guestCount: null });
    expect(pay.status).toBe(200);
    expect(pay.body.outcome).toBe("received");
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: null }]);
  });

  it("stores nothing and records no sale when the card is declined", async () => {
    const v = await venue(suite.db);
    const pay = await payCounter(v, {
      ...COUNTER_READER,
      guestCount: 5,
      simulationOutcome: "declined",
    });
    expect(pay.status).toBe(200);
    expect(pay.body.outcome).toBe("declined");
    expect(await salesOf(suite.db, pay.id)).toEqual([]);
    expect(await storedGuests(suite.db, pay.id)).toEqual([]);
  });

  it("stores the count of the Pay that files a card captured before a lost response", async () => {
    const v = await venue(suite.db);
    const id = randomUUID();
    await withTransaction(v.db, (tx) =>
      createOpenOrder(tx, v.cfg, id, [{ menuItemId: v.menuItemId, quantity: "8" }], v.staffId, {
        zoneId: v.counterZone,
      }),
    );
    const request: BillPaymentRequest = {
      expectedEdit: await withTransaction(v.db, (tx) => readBillEditState(tx, id)),
      submissionId: randomUUID(),
      kind: "share",
      shareOf: 1,
      method: "card",
      entry: "reader",
      applied: "12.00",
      tip: "0.00",
    };
    await lostCapture(v, id, request);
    const pay = await payPart(v, id, { ...request, guestCount: 3 });
    expect(pay.status).toBe(200);
    expect(pay.body.outcome).toBe("received");
    expect(await paymentsOf(suite.db, id)).toHaveLength(1);
    expect(await storedGuests(suite.db, id)).toEqual([{ guests: 3 }]);
    expect(
      (
        await v.app.request(`/api/sales/${id}/receipt`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: v.till },
          body: "{}",
        })
      ).status,
    ).toBe(200);
    const [receipt] = await receipts(suite.db);
    expect(receipt).toContain("3 comensales · por persona");
  });

  it("stores the chosen count of an order with nothing to charge", async () => {
    const v = await venue(suite.db);
    const pay = await payCounter(v, {
      ...COUNTER_READER,
      basket: { lines: [{ menuItemId: v.freeItemId, quantity: "1" }] },
      guestCount: 2,
    });
    expect(pay.status).toBe(200);
    expect(pay.body.outcome).toBe("settled");
    expect(await paymentsOf(suite.db, pay.id)).toEqual([]);
    expect(await storedGuests(suite.db, pay.id)).toEqual([{ guests: 2 }]);
  });

  it.each([[0], [1000], [2.5], ["4"], [true]])(
    "refuses guests %j before the reader is asked",
    async (guestCount) => {
      const v = await venue(suite.db);
      const before = writtenTables(suite.db);
      const pay = await payCounter(v, { ...COUNTER_READER, guestCount });
      expect(pay.status).toBe(400);
      expect(pay.body).toEqual({
        error: { code: "management.request_invalid", params: { field: "guestCount" } },
      });
      expect(await paymentsOf(suite.db, pay.id)).toEqual([]);
      expect(writtenTables(suite.db)).toEqual(before);
    },
  );
});

/** A card captured for the bill at 12,00 € whose answer never reached the till: a payment with no sale. */
async function lostCapture(v: Venue, id: string, request?: BillPaymentRequest): Promise<void> {
  await withTransaction(v.db, async (tx) => {
    const [bill] = await tx
      .insert(billPayments)
      .values({
        workingOrderId: id,
        submissionId: request?.submissionId ?? randomUUID(),
        fingerprint: request
          ? fingerprint(retryShapeOf(request))
          : "reader captured without a reply",
        kind: request?.kind ?? "contribution",
        shareOf: request?.shareOf ?? null,
        method: "card",
        applied: 1200,
        state: "pending",
        requestedBy: v.staffId,
        ...v.cfg.origin,
      })
      .returning({ id: billPayments.id });
    await insertCapturedPayment(tx, {
      origin: v.cfg.origin,
      nodeId: v.cfg.nodeId,
      workingOrderId: id,
      provider: "simulator",
      paymentRef: `sim-ref-${randomUUID()}`,
      amount: decimal("12.00"),
      settledAt: AT,
      externalRef: `sim-lost-${randomUUID()}`,
      billPaymentId: bill!.id,
    });
  });
}

describe("a party above 999 guests still pays, its receipt printing no guests", () => {
  it("files a reader payment that sends no guests", async () => {
    const v = await venue(suite.db);
    const billId = await partyBill(v, 1000);
    const pay = await payPart(v, billId, {
      amount: "12.00",
      applied: "12.00",
      method: "card",
      entry: "reader",
      simulationOutcome: "captured",
    });
    expect(pay.status).toBe(200);
    expect(pay.body.outcome).toBe("received");
    expect(await salesOf(suite.db, billId)).toHaveLength(1);
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: null }]);
  });

  it("files a cash payment that sends no guests", async () => {
    const v = await venue(suite.db);
    const billId = await partyBill(v, 1000);
    const sale = await payPart(v, billId, cashPart("12.00"));
    expect(sale.status).toBe(200);
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: null }]);
  });
});

it.each([
  { partySize: 4, guests: 4 },
  { partySize: 1000, guests: null },
])(
  "recovers a card capture with the receipt guest count for a party of $partySize",
  async ({ partySize, guests }) => {
    const v = await venue(suite.db);
    const billId = await partyBill(v, partySize);
    await lostCapture(v, billId);
    const pass = await settlePendingBillPayments({
      ...v,
      clock,
      admission: testTradingAdmission(),
    });
    expect(pass).toMatchObject({ received: 1, errors: [] });
    expect(await salesOf(suite.db, billId)).toHaveLength(1);
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests }]);
  },
);

describe("closing a placed bill with nothing to charge", () => {
  it("stores the chosen count", async () => {
    const v = await venue(suite.db);
    const billId = await partyBill(v, 4, { menuItemId: v.tableFreeItemId, quantity: "1" });
    await placeOrder(
      { admission: testTradingAdmission(), db: v.db, backend: v.backend, clock },
      v.cfg,
      billId,
      v.staffId,
    );
    const pay = await payPart(v, billId, {
      amount: "0.00",
      applied: "0.00",
      method: "card",
      entry: "reader",
      guestCount: 2,
    });
    expect(pay.status).toBe(200);
    expect(pay.body.outcome).toBe("settled");
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
    body: JSON.stringify(
      await observedPaymentBody(suite.db, `/api/working-orders/${billId}/payments`, {
        submissionId: randomUUID(),
        kind: "contribution",
        tip: "0.00",
        ...extra,
      }),
    ),
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
    expect((await payPart(v, billId, cashPart("10.00", { guestCount: 5 }))).status).toBe(200);
    expect(await storedGuests(suite.db, billId)).toEqual([]);
    const last = await payPart(v, billId, cashPart("11.00", { guestCount: 3 }));
    expect(last.status).toBe(200);
    expect(last.body.invoice).toBeDefined();
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: 3 }]);
    expect(
      (
        await v.app.request(`/api/sales/${billId}/receipt`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: v.till },
          body: "{}",
        })
      ).status,
    ).toBe(200);
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
      guestCount: null,
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
      guestCount: 2,
    });
    expect(last.status).toBe(200);
    expect(last.body.outcome).toBe("received");
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: 2 }]);
  });

  it("refuses guests 2.5 and writes no payment", async () => {
    const v = await venue(suite.db);
    const billId = await partyBill(v, 4, { quantity: "14" });
    const refused = await payPart(v, billId, cashPart("10.00", { guestCount: 2.5 }));
    expect(refused).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "guestCount" } } },
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
    const first = await payPart(v, billId, {
      submissionId,
      ...cashPart("10.00", { guestCount: 3 }),
    });
    expect(first.status).toBe(200);
    const paymentId = (first.body.payment as { id: string }).id;
    for (const guests of [{ guestCount: 9 }, { guestCount: null }, {}]) {
      const again = await payPart(v, billId, { submissionId, ...cashPart("10.00", guests) });
      expect([again.status, (again.body.payment as { id: string } | undefined)?.id]).toEqual([
        200,
        paymentId,
      ]);
    }
    const request: BillPaymentRequest = {
      expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, billId)),
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

  it("fingerprints a payment without guests with its observed bill state", async () => {
    const v = await venue(suite.db);
    const billId = await partyBill(v, 4, { quantity: "14" });
    expect((await payPart(v, billId, cashPart("10.00"))).status).toBe(200);
    expect((await storedPayments(suite.db, billId))[0]!.fingerprint).toBe(
      fingerprint({
        kind: "contribution",
        amount: "10.00",
        method: "cash",
        tendered: "10.00",
        applied: "10.00",
        tip: "0.00",
        addedTip: "0.00",
        expectedEdit: { billId, editorVersion: 0, draftId: null, draftRevision: null },
      }),
    );
  });

  it("replays a completing payment re-sent with other guests, and the row keeps its count", async () => {
    const v = await venue(suite.db);
    const billId = await partlyPaidBill(v);
    const submissionId = randomUUID();
    const first = await payPart(v, billId, {
      submissionId,
      ...cashPart("11.00", { guestCount: 3 }),
    });
    expect(first.status).toBe(200);
    const again = await payPart(v, billId, {
      submissionId,
      ...cashPart("11.00", { guestCount: 9 }),
    });
    expect(again.status).toBe(200);
    expect((again.body.payment as { id: string }).id).toBe(
      (first.body.payment as { id: string }).id,
    );
    expect(await storedGuests(suite.db, billId)).toEqual([{ guests: 3 }]);
  });
});

describe("the payment routes read guestCount and ignore guests", () => {
  const REFUSED = {
    error: { code: "management.request_invalid", params: { field: "guestCount" } },
  };

  describe("POST /api/working-orders/:id/payments completing the bill", () => {
    async function billPaymentsOf(billId: string) {
      return withTransaction(suite.db, (tx) =>
        tx
          .select({ id: billPayments.id })
          .from(billPayments)
          .where(eq(billPayments.workingOrderId, billId)),
      );
    }

    it("stores the guestCount sent", async () => {
      const v = await venue(suite.db);
      const billId = await partlyPaidBill(v);
      const last = await payPart(v, billId, cashPart("11.00", { guestCount: 2 }));
      expect(last.status).toBe(200);
      expect(await storedGuests(suite.db, billId)).toEqual([{ guests: 2 }]);
    });

    it("ignores the old name guests and stores the party's 4", async () => {
      const v = await venue(suite.db);
      const billId = await partlyPaidBill(v);
      const last = await payPart(v, billId, cashPart("11.00", { guests: 2 }));
      expect(last.status).toBe(200);
      expect(await storedGuests(suite.db, billId)).toEqual([{ guests: 4 }]);
    });

    it("refuses guestCount 0 and records no sale or payment", async () => {
      const v = await venue(suite.db);
      const billId = await partlyPaidBill(v);
      const before = await billPaymentsOf(billId);
      const refused = await payPart(v, billId, cashPart("11.00", { guestCount: 0 }));
      expect(refused).toEqual({ status: 400, body: REFUSED });
      expect(await billPaymentsOf(billId)).toEqual(before);
      expect(await salesOf(suite.db, billId)).toEqual([]);
    });
  });
});
