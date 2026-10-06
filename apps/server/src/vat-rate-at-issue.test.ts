import { issueOrderInvoice } from "./testing/issue-order.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { diningTables, saleLines, sales, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createExtraList,
  createProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { insertCapturedPayment } from "@waitron/payments";
import type { PaymentProvider, PaymentResult } from "@waitron/payments";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import type { ExtraSelection } from "@waitron/shared";
import { takeBillPayment, type BillPaymentRequest } from "./bill-payments.js";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { OrderFlow } from "./till-config.js";
import { collectOrder, payWorkingOrderIntegrated, recordTillSale } from "./till-sale.js";
import { addTabRound, parkOrder, placeOrder } from "./working-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";
import { openPartyTab } from "./testing/serve-line.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { deviceRequestCfg } from "./testing/session-device.js";

// A release that ships a reduced rate of 4% from 1 January 2027, the shipped table otherwise.
vi.mock("@waitron/catalogue/src/vat-rates.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@waitron/catalogue/src/vat-rates.js")>();
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
const CANA_AT_10 = [{ rate: "10.00", base: "2.27", tax: "0.23" }];
const CANA_AT_4 = [{ rate: "4.00", base: "2.40", tax: "0.10" }];

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
    resolveClient: () =>
      Promise.reject(new Error("vat-rate-at-issue.test: resolveClient must never be called")),
  });
});

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return nifWithControlLetter(78_000_000 + nifCounter);
}

async function setupVenue(orderFlow: OrderFlow = "prepay") {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Bar de Nochevieja SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
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
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
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
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  });

  const products = await withTransaction(suite.db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Carta" });
    const product = (name: string, unitPrice: string, vatClass: "reduced" | "general") =>
      createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name,
        pricingUnit: "each",
        unitPrice,
        vatClass,
      });
    const cana = await product("Caña", "2.50", "reduced");
    const burger = await product("Hamburguesa", "10.00", "reduced");
    const queso = await product("Queso", "0.75", "reduced");
    const vino = await product("Vino", "3.63", "general");
    const extras = await createExtraList(
      tx,
      {
        name: "Extras",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 2,
        active: true,
        items: [{ productId: queso.id, maxQuantity: 1, preselected: false, price: "0.75" }],
      },
      LOCALE,
    );
    await writeProductModifiers(tx, burger.id, [{ kind: "extras", id: extras.id }]);
    await assignCatalogueToLocation(tx, venue.locationId, menu.id);
    return {
      cana: cana.id,
      burger: burger.id,
      queso: queso.id,
      vino: vino.id,
      extrasListId: extras.id,
    };
  });
  const { counter, tables } = await withTransaction(suite.db, async (tx) => ({
    counter: await offerProducts(tx, cfg, { serviceMode: orderFlow, paidWhen: orderFlow }),
    tables: await offerProducts(tx, cfg, { zone: "tables" }),
  }));
  return { cfg, products, counter, tables };
}

type Venue = Awaited<ReturnType<typeof setupVenue>>;

const deps = () => ({ db: suite.db, backend, clock });

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
      locationId: v.cfg.locationId,
      zoneId: v.tables.zoneId,
      label: `Mesa ${tableId.slice(0, 4)}`,
      active: true,
    });
    const { tabId } = await openPartyTab(tx, v.cfg, { tableId });
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
      const settledAt = new Date();
      await withTransaction(suite.db, (tx) =>
        insertCapturedPayment(tx, {
          origin: params.origin,
          workingOrderId: params.workingOrderId,
          provider: "stripe",
          paymentRef,
          amount: params.amount,
          settledAt,
          externalRef: paymentRef,
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
    forward: () =>
      Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 }),
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

describe("a sale files the rate in force on the day its invoice is issued", () => {
  it("walk-up: the day before the change files the old rate, the day of it the new one", async () => {
    const v = await setupVenue();
    const eve = randomUUID();
    const newYear = randomUUID();

    at(EVE);
    await recordTillSale(deps(), v.cfg, {
      workingOrderId: eve,
      zoneId: v.counter.zoneId,
      lines: one(v, v.products.cana),
      tender: { method: "cash", amount: "2.50" },
    });
    at(NEW_YEAR);
    await recordTillSale(deps(), v.cfg, {
      workingOrderId: newYear,
      zoneId: v.counter.zoneId,
      lines: one(v, v.products.cana),
      tender: { method: "cash", amount: "2.50" },
    });

    expect(await filed(eve)).toMatchObject({ total: 250, vatBreakdown: CANA_AT_10 });
    expect(await filed(newYear)).toMatchObject({ total: 250, vatBreakdown: CANA_AT_4 });
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
            picks: [{ productId: v.products.queso, quantity: 1 }],
          },
        ],
      },
      { menuItemId: v.tables.offerFor(v.products.vino), quantity: "1" },
    ]);

    at(NEW_YEAR);
    await recordTillSale(deps(), v.cfg, {
      workingOrderId: tabId,
      lines: [],
      tender: { method: "cash", amount: "14.38" },
    });

    const sale = await filed(tabId);
    expect(sale.lines.map((line) => [line.productId, line.vatRate])).toEqual([
      [v.products.burger, 400],
      [v.products.queso, 400],
      [v.products.vino, 2100],
    ]);
    expect(sale.total).toBe(1438);
  });

  it("a bill paid in two payments, one each side of midnight, is invoiced at the rate of the day it is fully paid", async () => {
    const v = await setupVenue();
    at(EVE);
    const tabId = await openTableTab(v, [
      { menuItemId: v.tables.offerFor(v.products.cana), quantity: "2" },
    ]);
    await takeBillPayment(deps(), v.cfg, tabId, cash("2.50"), OPERATOR);

    at(NEW_YEAR);
    const { invoice } = await takeBillPayment(deps(), v.cfg, tabId, cash("2.50"), OPERATOR);

    expect(invoice).not.toBeNull();
    expect(await filed(tabId)).toMatchObject({
      total: 500,
      vatBreakdown: [{ rate: "4.00", base: "4.81", tax: "0.19" }],
    });
  });

  it("a card charged across midnight files the rate of the day the invoice is issued, after the reader", async () => {
    const v = await setupVenue();
    at(EVE);
    const id = await park(v, one(v, v.products.cana));
    at("2026-12-31T22:59:30.000Z");

    const out = await payWorkingOrderIntegrated(
      { ...deps(), provider: stubProvider(() => at(MIDNIGHT)), readerRef: "reader_1" },
      v.cfg,
      { id, lines: [] },
    );

    expect(out.outcome).toBe("captured");
    const sale = await filed(id);
    expect(sale).toMatchObject({ issuedAt: MIDNIGHT, total: 250, vatBreakdown: CANA_AT_4 });
    expect(out.outcome === "captured" && out.ticket.vatBreakdown).toEqual(CANA_AT_4);
  });

  it("an invoice issued on the eve keeps its rate at collection; one issued on New Year's Day takes the new rate", async () => {
    const v = await setupVenue("ticket_then_pay");
    at(EVE);
    const before = await park(v, one(v, v.products.cana));
    const after = await park(v, one(v, v.products.cana));
    await placeOrder(deps(), v.cfg, before, OPERATOR);
    await issueOrderInvoice(deps(), v.cfg, before, OPERATOR);

    at(NEW_YEAR);
    await collectOrder(deps(), v.cfg, {
      id: before,
      lines: [],
      tender: { method: "cash", amount: "2.50" },
    });
    await placeOrder(deps(), v.cfg, after, OPERATOR);
    await issueOrderInvoice(deps(), v.cfg, after, OPERATOR);

    expect(await filed(before)).toMatchObject({ issuedAt: EVE, vatBreakdown: CANA_AT_10 });
    expect(await filed(after)).toMatchObject({ issuedAt: NEW_YEAR, vatBreakdown: CANA_AT_4 });
  });

  it("ticket-then-pay: placed on the eve and collected on New Year's Day files the new rate", async () => {
    const v = await setupVenue("ticket_then_pay");
    at(EVE);
    const id = await park(v, one(v, v.products.cana));
    await placeOrder(deps(), v.cfg, id, OPERATOR);

    at(NEW_YEAR);
    await collectOrder(deps(), v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "2.50" },
    });

    expect(await rates(id)).toEqual([400]);
  });
});

describe("the day is the invoice's own, read once", () => {
  it("a sale issued at local midnight on the day of the change files the new rate, and one a millisecond earlier the old", async () => {
    const v = await setupVenue();
    const early = randomUUID();
    const onTheDot = randomUUID();

    at(new Date(Date.parse(MIDNIGHT) - 1).toISOString());
    await recordTillSale(deps(), v.cfg, {
      workingOrderId: early,
      zoneId: v.counter.zoneId,
      lines: one(v, v.products.cana),
      tender: { method: "cash", amount: "2.50" },
    });
    at(MIDNIGHT);
    await recordTillSale(deps(), v.cfg, {
      workingOrderId: onTheDot,
      zoneId: v.counter.zoneId,
      lines: one(v, v.products.cana),
      tender: { method: "cash", amount: "2.50" },
    });

    expect(await filed(early)).toMatchObject({
      issuedAt: "2026-12-31T22:59:59.999Z",
      vatBreakdown: CANA_AT_10,
    });
    expect(await filed(onTheDot)).toMatchObject({ issuedAt: MIDNIGHT, vatBreakdown: CANA_AT_4 });
  });

  it("prices and dates the invoice from one reading, even when the clock crosses midnight during the request", async () => {
    const v = await setupVenue();
    const id = await park(v, one(v, v.products.cana));
    at(new Date(Date.parse(MIDNIGHT) - 1).toISOString());
    time.tickMs = 1;

    await recordTillSale(deps(), v.cfg, {
      workingOrderId: id,
      lines: [],
      tender: { method: "cash", amount: "2.50" },
    });

    // The first reading is the last millisecond of the eve; every later one is New Year's Day.
    expect(await filed(id)).toMatchObject({
      issuedAt: "2026-12-31T22:59:59.999Z",
      vatBreakdown: CANA_AT_10,
    });
  });

  it("takes the calendar date at the invoice's offset, not in UTC", async () => {
    const v = await setupVenue();
    const east = randomUUID();
    const utc = randomUUID();

    // 23:30 UTC on 31 December: already 1 January two hours east, still 31 December in UTC.
    at("2026-12-31T23:30:00.000Z", 120);
    await recordTillSale(deps(), v.cfg, {
      workingOrderId: east,
      zoneId: v.counter.zoneId,
      lines: one(v, v.products.cana),
      tender: { method: "cash", amount: "2.50" },
    });
    at("2026-12-31T23:30:00.000Z", 0);
    await recordTillSale(deps(), v.cfg, {
      workingOrderId: utc,
      zoneId: v.counter.zoneId,
      lines: one(v, v.products.cana),
      tender: { method: "cash", amount: "2.50" },
    });

    expect(await filed(east)).toMatchObject({ offsetMinutes: 120, vatBreakdown: CANA_AT_4 });
    expect(await filed(utc)).toMatchObject({ offsetMinutes: 0, vatBreakdown: CANA_AT_10 });
  });
});

describe("publishing a menu before a rate's legal date", () => {
  it("does not bring the new rate forward: a sale that day files the old rate, and one on the day files the new", async () => {
    const v = await setupVenue();
    at(EVE);
    await withTransaction(suite.db, (tx) => offerProducts(tx, v.cfg));
    const eve = await park(v, one(v, v.products.cana));
    await recordTillSale(deps(), v.cfg, {
      workingOrderId: eve,
      lines: [],
      tender: { method: "cash", amount: "2.50" },
    });

    at(NEW_YEAR);
    const newYear = await park(v, one(v, v.products.cana));
    await recordTillSale(deps(), v.cfg, {
      workingOrderId: newYear,
      lines: [],
      tender: { method: "cash", amount: "2.50" },
    });

    expect(await rates(eve)).toEqual([1000]);
    expect(await rates(newYear)).toEqual([400]);
  });
});
