import { seedPerson } from "@waitron/db/testing/seed.js";
import { fixturePasswordHash, fixturePinHash } from "./testing/known-secret-hashes.js";
import { readSettings, BUSINESS_DAY_SETTINGS } from "@waitron/db";
import { sql } from "drizzle-orm";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  billPayments,
  diningTables,
  productTakeawayVatRates,
  saleLines,
  sales,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignMenuToVenue,
  createMenu,
  createExtraList,
  createProduct,
  writeProductModifiers,
} from "@waitron/menu";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";

import { insertCapturedPayment } from "@waitron/payments";
import type { PaymentProvider, PaymentResult } from "@waitron/payments";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import { nodeId as brandNodeId, seriesId as brandSeriesId } from "@waitron/shared";
import type { ExtraSelection } from "@waitron/shared";
import {
  payFreshCounterInCash,
  takeBillPayment,
  takeReaderBillPayment,
  type BillPaymentRequest,
} from "./testing/bill-payment-fixture.js";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { OrderFlow } from "./till-config.js";
import { parkOrder } from "./working-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";
import { openPartyTab } from "./testing/serve-line.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { counterFixtureOperator, deviceRequestCfg } from "./testing/session-device.js";

// A release that ships a reduced rate of 4% from 1 January 2027, the shipped table otherwise.
vi.mock("@waitron/shared/src/menu-document/vat-rates.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@waitron/shared/src/menu-document/vat-rates.js")>();
  const table = {
    ...original.VAT_RATE_TABLE,
    reduced: [
      { from: null, rate: "10.00" },
      { from: "2027-01-01", rate: "4.00" },
    ],
  };
  return {
    ...original,
    VAT_RATE_TABLE: table,
    vatRatesOn: (...[date, given]: Parameters<typeof original.vatRatesOn>) =>
      original.vatRatesOn(date, given ?? table),
  };
});

const LOCALE = "es-ES";
const OPERATOR = "0000ffff-2222-4000-8000-0000000000cc";
// Madrid in winter.
const MADRID = 60;
// 21:00 on 31 December in Madrid.
const EVE = "2026-12-31T20:00:00.000Z";
// 11:00 on 1 January in Madrid.
const NEW_YEAR = "2027-01-01T10:00:00.000Z";
// 00:00 on 1 January in Madrid.
const MIDNIGHT = "2026-12-31T23:00:00.000Z";

/** A 2.50 gross line split at each rate: base = gross × 100 ÷ (100 + rate), tax the difference. */
const BEER_AT_10_PERCENT = [{ rate: "10.00", base: "2.27", tax: "0.23" }];
const BEER_AT_4_PERCENT = [{ rate: "4.00", base: "2.40", tax: "0.10" }];

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/**
 * The test's clock. Each reading returns `at` in the zone `offsetMinutes`, then moves `at` on by
 * `tickMs`, so a test can make two readings of one request land on different days.
 */
const time = { at: new Date(EVE), offsetMinutes: MADRID, tickMs: 0 };
const clock: TrustedClock = {
  now: () => {
    const instant = new Date(time.at.getTime());
    time.at = new Date(time.at.getTime() + time.tickMs);
    return {
      instant,
      offsetMinutes: time.offsetMinutes,
      confident: true,
      confidence: "anchored",
      anchorAgeSeconds: 0,
    };
  },
  anchor: () => {
    throw new Error("vat-rate-at-issue.test: anchor() is not used");
  },
  currentAnchor: () => null,
};

function at(instant: string, offsetMinutes = MADRID): void {
  time.at = new Date(instant);
  time.offsetMinutes = offsetMinutes;
  time.tickMs = 0;
}

let backend: FiscalBackend;

beforeAll(() => {
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
  });
});

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return nifWithControlLetter(78_000_000 + nifCounter);
}

async function setupVenue(orderFlow: OrderFlow = "prepay") {
  if (orderFlow === "ticket_then_pay")
    await seedPerson(suite.db, { id: OPERATOR, displayName: "Operator" });
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Bar de Nochevieja SL",
        name: "Sala principal",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        seriesCode: "A",
        correctiveSeriesCode: "R",
        admin: {
          displayName: "Administrator",
          pinHash: fixturePinHash("1234"),
          passwordHash: fixturePasswordHash("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  const cfg = await deviceRequestCfg(suite.db, {
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  });

  const products = await withTransaction(suite.db, async (tx) => {
    const menu = await createMenu(tx, { name: `Vat rate at issue menu ${cfg.nodeId}` });
    const product = (name: string, unitPrice: string, vatClass: "reduced" | "general") =>
      createProduct(tx, {
        categoryId: null,
        name,
        pricingUnit: "each",
        unitPrice,
        vatClass,
      });
    const beer = await product("Caña", "2.50", "reduced");
    const burger = await product("Hamburguesa", "10.00", "reduced");
    const cheese = await product("Queso", "0.75", "reduced");
    const wine = await product("Vino", "3.63", "general");
    // Served here at `general`; its takeaway rates are set by the takeaway case.
    const juice = await createProduct(tx, {
      categoryId: null,
      name: "Juice",
      pricingUnit: "each",
      unitPrice: "2.50",
      vatClass: "general",
      takeawayVatRate: "10.00",
    });
    const extras = await createExtraList(
      tx,
      {
        name: "Extras",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 2,
        active: true,
        items: [{ productId: cheese.id, maxQuantity: 1, preselected: false, price: "0.75" }],
      },
      LOCALE,
    );
    await writeProductModifiers(tx, burger.id, [{ kind: "extras", id: extras.id }]);
    await assignMenuToVenue(tx, menu.id);
    return {
      beer: beer.id,
      burger: burger.id,
      cheese: cheese.id,
      wine: wine.id,
      juice: juice.id,
      extrasListId: extras.id,
    };
  });
  const { counter, tables } = await withTransaction(suite.db, async (tx) => ({
    counter: await offerProducts(tx, cfg, {
      orderStart: "counter",
      paidWhen: orderFlow,
    }),
    tables: await offerProducts(tx, cfg, { zone: "tables" }),
  }));
  const operator = await counterFixtureOperator(suite.db, cfg.origin.deviceId);
  return { cfg, products, counter, tables, operator };
}

type Venue = Awaited<ReturnType<typeof setupVenue>>;

const deps = () => ({ db: suite.db, backend, clock, admission: testTradingAdmission() });

const one = (v: Venue, productId: string) => [
  { menuItemId: v.counter.offerFor(productId), quantity: "1" },
];

async function park(v: Venue, lines: Parameters<typeof parkOrder>[2]["lines"]): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: suite.db }, v.cfg, { id, zoneId: v.counter.zoneId, lines });
  return id;
}

async function openTableTab(
  v: Venue,
  lines: { menuItemId: string; quantity: string; extras?: ExtraSelection[] }[],
): Promise<string> {
  const tableId = randomUUID();
  return withTransaction(suite.db, async (tx) => {
    await tx.insert(diningTables).values({
      id: tableId,
      zoneId: v.tables.zoneId,
      label: `Mesa ${tableId.slice(0, 4)}`,
    });
    await tx.update(diningTables).set({ onFloor: true }).where(eq(diningTables.id, tableId));
    const { tabId } = await openPartyTab(tx, v.cfg, { tableId });
    // Opened at the test's clock, not the machine's: a bill's opening decides its close of day.
    await tx
      .update(workingOrders)
      .set({ trustedOpenedAt: time.at.toISOString() })
      .where(eq(workingOrders.id, tabId));
    await addTabRound(tx, v.cfg, tabId, lines);
    return tabId;
  });
}

/** The filed sale: its issue instant and offset, total, VAT breakdown, and each line's rate in
 * basis points. */
async function filed(workingOrderId: string) {
  const [sale] = await suite.db
    .select({
      id: sales.id,
      issuedAt: sales.issuedAt,
      offsetMinutes: sales.issuedOffsetMinutes,
      total: sales.total,
      vatBreakdown: sales.vatBreakdown,
    })
    .from(sales)
    .where(eq(sales.workingOrderId, workingOrderId));
  if (sale === undefined) throw new Error(`no sale for ${workingOrderId}`);
  const rates = await suite.db
    .select({ productId: saleLines.productId, vatRate: saleLines.vatRate })
    .from(saleLines)
    .where(eq(saleLines.saleId, sale.id))
    .orderBy(saleLines.lineNo);
  return { ...sale, issuedAt: new Date(sale.issuedAt).toISOString(), lines: rates };
}

const rates = async (workingOrderId: string) =>
  (await filed(workingOrderId)).lines.map((line) => line.vatRate);

function stubProvider(onCollect: () => void): PaymentProvider {
  return {
    provider: "stripe",
    capabilities: { partialRefund: true },
    async collect(params): Promise<PaymentResult> {
      onCollect();
      const paymentRef = `pi-${randomUUID()}`;
      const settledAt = new Date(time.at);
      await withTransaction(suite.db, (tx) =>
        insertCapturedPayment(tx, {
          origin: params.origin,
          nodeId: params.nodeId,
          workingOrderId: params.workingOrderId,
          provider: "stripe",
          paymentRef,
          amount: params.amount,
          settledAt,
          externalRef: paymentRef,
          billPaymentId: params.billPaymentId,
        }),
      );
      return {
        provider: "stripe",
        paymentRef,
        state: "captured",
        amount: params.amount,
        settledAt,
      };
    },
    resolvePending: () =>
      Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 }),
    void: () => Promise.reject(new Error("stubProvider: void unused")),
    refund: () => Promise.reject(new Error("stubProvider: refund unused")),
    partialRefund: () => Promise.reject(new Error("stubProvider: partialRefund unused")),
  };
}

function cash(amount: string): BillPaymentRequest {
  return {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "cash",
    tendered: amount,
    applied: amount,
    tip: "0.00",
  };
}

const payCash = (v: Venue, id: string, amount: string) =>
  takeBillPayment(deps(), v.cfg, id, cash(amount), v.operator);

const payFreshBeer = (v: Venue, id: string) =>
  payFreshCounterInCash(
    deps(),
    v.cfg,
    v.operator,
    id,
    { zoneId: v.counter.zoneId, lines: one(v, v.products.beer) },
    "2.50",
  );

describe("a sale files the rate in force on the day its invoice is issued", () => {
  it("walk-up: the day before the change files the old rate, the day of it the new one", async () => {
    const v = await setupVenue();
    const eve = randomUUID();
    const newYear = randomUUID();

    at(EVE);
    await payFreshBeer(v, eve);
    at(NEW_YEAR);
    await payFreshBeer(v, newYear);

    expect(await filed(eve)).toMatchObject({ total: 250, vatBreakdown: BEER_AT_10_PERCENT });
    expect(await filed(newYear)).toMatchObject({ total: 250, vatBreakdown: BEER_AT_4_PERCENT });
  });

  it("a tab rung on the eve and paid on New Year's Day files the new rate for the dish, its extra and a round, at the same gross", async () => {
    const v = await setupVenue();
    at(EVE);
    const tabId = await openTableTab(v, [
      {
        menuItemId: v.tables.offerFor(v.products.burger),
        quantity: "1",
        extras: [
          {
            listId: v.products.extrasListId,
            picks: [{ productId: v.products.cheese, quantity: 1 }],
          },
        ],
      },
      { menuItemId: v.tables.offerFor(v.products.wine), quantity: "1" },
    ]);

    at(NEW_YEAR);
    await payCash(v, tabId, "14.38");

    const sale = await filed(tabId);
    expect(sale.lines.map((line) => [line.productId, line.vatRate])).toEqual([
      [v.products.burger, 400],
      [v.products.cheese, 400],
      [v.products.wine, 2100],
    ]);
    expect(sale.total).toBe(1438);
  });

  it("a bill paid in two payments, one each side of midnight, is invoiced at the rate of the day it is fully paid", async () => {
    const v = await setupVenue();
    at(EVE);
    const tabId = await openTableTab(v, [
      { menuItemId: v.tables.offerFor(v.products.beer), quantity: "2" },
    ]);
    await payCash(v, tabId, "2.50");

    at(NEW_YEAR);
    const { invoice } = await payCash(v, tabId, "2.50");

    expect(invoice).not.toBeNull();
    expect(await filed(tabId)).toMatchObject({
      total: 500,
      vatBreakdown: [{ rate: "4.00", base: "4.81", tax: "0.19" }],
    });
  });

  it("a card charged across midnight files the rate of the day the invoice is issued, after the reader", async () => {
    const v = await setupVenue();
    at(EVE);
    const id = await park(v, one(v, v.products.beer));
    at("2026-12-31T22:59:30.000Z");

    const { payment, invoice } = await takeReaderBillPayment(
      { ...deps(), provider: stubProvider(() => at(MIDNIGHT)), readerRef: "reader_1" },
      v.cfg,
      id,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "2.50",
        method: "card",
        entry: "reader",
        applied: "2.50",
        tip: "0.00",
      },
      v.operator,
    );

    expect(payment.state).toBe("received");
    const sale = await filed(id);
    expect(sale).toMatchObject({ issuedAt: MIDNIGHT, total: 250, vatBreakdown: BEER_AT_4_PERCENT });
    expect(invoice?.vatBreakdown).toEqual(BEER_AT_4_PERCENT);
  });

  it("an invoice issued on the eve keeps its rate at collection; one issued on New Year's Day takes the new rate", async () => {
    const v = await setupVenue("ticket_then_pay");
    at(EVE);
    const before = await park(v, one(v, v.products.beer));
    const after = await park(v, one(v, v.products.beer));
    await placeOrder({ ...deps(), admission: testTradingAdmission() }, v.cfg, before, OPERATOR);
    await issueOrderInvoice(
      { ...deps(), admission: testTradingAdmission() },
      v.cfg,
      before,
      OPERATOR,
    );

    at(NEW_YEAR);
    await payCash(v, before, "2.50");
    await placeOrder({ ...deps(), admission: testTradingAdmission() }, v.cfg, after, OPERATOR);
    await issueOrderInvoice(
      { ...deps(), admission: testTradingAdmission() },
      v.cfg,
      after,
      OPERATOR,
    );

    expect(await filed(before)).toMatchObject({ issuedAt: EVE, vatBreakdown: BEER_AT_10_PERCENT });
    expect(await filed(after)).toMatchObject({
      issuedAt: NEW_YEAR,
      vatBreakdown: BEER_AT_4_PERCENT,
    });
  });

  it("ticket-then-pay: placed on the eve and collected on New Year's Day files the new rate", async () => {
    const v = await setupVenue("ticket_then_pay");
    at(EVE);
    const id = await park(v, one(v, v.products.beer));
    await placeOrder({ ...deps(), admission: testTradingAdmission() }, v.cfg, id, OPERATOR);

    at(NEW_YEAR);
    await payCash(v, id, "2.50");

    expect(await rates(id)).toEqual([400]);
  });
});

describe("a takeaway order's product rate is taken on the day its invoice is issued", () => {
  it("a takeaway order parked on the eve files its product's takeaway rate of the day it is paid", async () => {
    const v = await setupVenue();
    await withTransaction(suite.db, async (tx) => {
      await tx
        .delete(productTakeawayVatRates)
        .where(eq(productTakeawayVatRates.productId, v.products.juice));
      await tx.insert(productTakeawayVatRates).values([
        { productId: v.products.juice, startsOn: null, rate: 1000 },
        { productId: v.products.juice, startsOn: "2027-01-01", rate: 400 },
      ]);
    });
    at(EVE);
    const eve = await park(v, one(v, v.products.juice));
    const newYear = await park(v, one(v, v.products.juice));
    await withTransaction(suite.db, (tx) =>
      tx
        .update(workingOrders)
        .set({ dining: "takeaway" })
        .where(inArray(workingOrders.id, [eve, newYear])),
    );
    await payCash(v, eve, "2.50");

    at(NEW_YEAR);
    await payCash(v, newYear, "2.50");

    expect(await filed(eve)).toMatchObject({ total: 250, vatBreakdown: BEER_AT_10_PERCENT });
    expect(await filed(newYear)).toMatchObject({ total: 250, vatBreakdown: BEER_AT_4_PERCENT });
  });
});

describe("the day is the invoice's own, read once", () => {
  it("a sale issued at local midnight on the day of the change files the new rate, and one a millisecond earlier the old", async () => {
    const v = await setupVenue();
    const early = randomUUID();
    const onTheDot = randomUUID();

    at(new Date(Date.parse(MIDNIGHT) - 1).toISOString());
    await payFreshBeer(v, early);
    at(MIDNIGHT);
    await payFreshBeer(v, onTheDot);

    expect(await filed(early)).toMatchObject({
      issuedAt: "2026-12-31T22:59:59.999Z",
      vatBreakdown: BEER_AT_10_PERCENT,
    });
    expect(await filed(onTheDot)).toMatchObject({
      issuedAt: MIDNIGHT,
      vatBreakdown: BEER_AT_4_PERCENT,
    });
  });

  it("uses the invoice day's rate when payment crosses midnight", async () => {
    const v = await setupVenue();
    const id = await park(v, one(v, v.products.beer));
    at(new Date(Date.parse(MIDNIGHT) - 1).toISOString());
    time.tickMs = 1;

    await payCash(v, id, "2.50");

    const sale = await filed(id);
    expect(sale.vatBreakdown).toEqual(
      sale.issuedAt < MIDNIGHT ? BEER_AT_10_PERCENT : BEER_AT_4_PERCENT,
    );
    const [payment] = await suite.db
      .select({ receivedAt: billPayments.receivedAt })
      .from(billPayments)
      .where(eq(billPayments.workingOrderId, id));
    expect(Date.parse(payment!.receivedAt!)).toBeLessThanOrEqual(Date.parse(sale.issuedAt));
  });

  it("takes the calendar date at the invoice's offset, not in UTC", async () => {
    const v = await setupVenue();
    const east = randomUUID();
    const utc = randomUUID();

    const [venueDoc] = await readSettings(suite.db, BUSINESS_DAY_SETTINGS).then(({ doc }) => [doc]);
    try {
      await suite.db.run(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${"Etc/GMT-2"}) where module = 'business_day'`,
      );
      // 23:30 UTC on 31 December: already 1 January two hours east, still 31 December in UTC.
      at("2026-12-31T23:30:00.000Z", 120);
      await payFreshBeer(v, east);
      await suite.db.run(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${"Etc/UTC"}) where module = 'business_day'`,
      );
      at("2026-12-31T23:30:00.000Z", 0);
      await payFreshBeer(v, utc);

      expect(await filed(east)).toMatchObject({
        offsetMinutes: 120,
        vatBreakdown: BEER_AT_4_PERCENT,
      });
      expect(await filed(utc)).toMatchObject({
        offsetMinutes: 0,
        vatBreakdown: BEER_AT_10_PERCENT,
      });
    } finally {
      await suite.db.run(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${venueDoc!.timeZone}) where module = 'business_day'`,
      );
    }
  });
});

describe("publishing a menu before a rate's legal date", () => {
  it("does not bring the new rate forward: a sale that day files the old rate, and one on the day files the new", async () => {
    const v = await setupVenue();
    at(EVE);
    await withTransaction(suite.db, (tx) => offerProducts(tx, v.cfg));
    const eve = await park(v, one(v, v.products.beer));
    await payCash(v, eve, "2.50");

    at(NEW_YEAR);
    const newYear = await park(v, one(v, v.products.beer));
    await payCash(v, newYear, "2.50");

    expect(await rates(eve)).toEqual([1000]);
    expect(await rates(newYear)).toEqual([400]);
  });
});
