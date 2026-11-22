import {
  billShare,
  takeReaderBillPayment,
  payFreshCounterInCash,
  paySavedBillInCash,
  takeBillPayment,
} from "./testing/bill-payment-fixture.js";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { fixturePasswordHash, fixturePinHash } from "./testing/known-secret-hashes.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { updateHeldOrder, placeOrder } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  devices,
  diningTables,
  printJobs,
  saleLines,
  sales,
  tenders,
  withTransaction,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { decodeTicket } from "./testing/decode-ticket.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignMenuToVenue,
  createMenu,
  createExtraList,
  createProduct,
  setProductVariants,
  updateProduct,
  writeProductModifiers,
  rateLines,
  type VatClass,
} from "@waitron/menu";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";

import { insertCapturedPayment } from "@waitron/payments";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import type { PaymentProvider, PaymentResult } from "@waitron/payments";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import { nodeId as brandNodeId, seriesId as brandSeriesId } from "@waitron/shared";
import type { ExtraSelection } from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import { systemClock } from "./till-backend.js";
import { printSaleReceipt, reprintSale } from "./till-sale.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import {
  createOpenOrder,
  parkOrder,
  priceStoredOrderForIssuance,
  readOrderRevision,
} from "./working-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import "./errors.js";
import { openPartyTab } from "./testing/serve-line.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { counterFixtureOperator, deviceRequestCfg } from "./testing/session-device.js";

// A line takes the VAT class the zone's published menu version froze, when its price locks, and
// issuance files that stored class's rate on every path. Every product is published at `reduced`
// (10%); a case changes one's class to `general` (21%) with or without publishing again. The rate a
// class carries on the day of issue is `vat-rate-at-issue.test.ts`'s subject.
const LOCALE = "es-ES";
const OPERATOR = "0000ffff-2222-4000-8000-0000000000bb";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let backend: FiscalBackend;
let clock: TrustedClock;

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return nifWithControlLetter(77_000_000 + nifCounter);
}

const sessionOf = (tx: Transaction) =>
  (tx as unknown as { session: { prepareQuery: (query: { sql: string }) => unknown } }).session;

async function setupVenue(paidWhen: "prepay" | "ticket_then_pay" = "prepay") {
  if (paidWhen === "ticket_then_pay")
    await seedPerson(suite.db, { id: OPERATOR, displayName: "Operator" });
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Bar del IVA SL",
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
    const menu = await createMenu(tx, {
      name: `Vat class at line add menu ${cfg.nodeId}`,
    });
    const product = (name: string, unitPrice: string) =>
      createProduct(tx, {
        categoryId: null,
        name,
        pricingUnit: "each",
        unitPrice,
        vatClass: "reduced",
      });
    const beer = await product("Caña", "2.50");
    const burger = await product("Hamburguesa", "10.00");
    const cheese = await product("Queso", "3.00");
    const coffee = await product("Café", "1.50");
    const bread = await product("Pan", "1.00");
    // Created with no VAT class of its own, so it reads its parent's.
    const [doubleCoffeeVariant] = await setProductVariants(
      tx,
      coffee.id,
      [
        {
          name: "Doble",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: "2.20",
          available: true,
        },
      ],
      LOCALE,
    );
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
      coffee: coffee.id,
      doubleCoffeeVariant: doubleCoffeeVariant!.id,
      bread: bread.id,
      extrasListId: extras.id,
    };
  });
  const { counter, tables } = await withTransaction(suite.db, async (tx) => ({
    counter: await offerProducts(tx, cfg, { paidWhen }),
    tables: await offerProducts(tx, cfg, { zone: "tables" }),
  }));
  const operator = await counterFixtureOperator(suite.db, cfg.origin.deviceId);
  return { cfg, products, counter, tables, operator };
}

type Venue = Awaited<ReturnType<typeof setupVenue>>;

const deps = () => ({ db: suite.db, backend, clock });

const payCash = (v: Venue, id: string, tendered: string) =>
  paySavedBillInCash(
    { ...deps(), admission: testTradingAdmission() },
    v.cfg,
    v.operator,
    id,
    tendered,
  );

async function setVat(productId: string, vatClass: VatClass): Promise<void> {
  await withTransaction(suite.db, (tx) => updateProduct(tx, productId, { vatClass }));
}

/** Publishes the suite's menu again, as it now stands. Counter and tables share it. */
async function republish(v: Venue): Promise<void> {
  await withTransaction(suite.db, (tx) => offerProducts(tx, v.cfg));
}

async function park(v: Venue, lines: Parameters<typeof parkOrder>[2]["lines"]): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: suite.db }, v.cfg, { id, zoneId: v.counter.zoneId, lines });
  return id;
}

const one = (v: Venue, productId: string) => [
  { menuItemId: v.counter.offerFor(productId), quantity: "1" },
];

/** The filed sale: its gross total in cents, its VAT breakdown, and per line the rate in basis
 * points, the gross in cents and the net unit in cents. */
async function filed(workingOrderId: string) {
  const [sale] = await suite.db
    .select({ id: sales.id, total: sales.total, vatBreakdown: sales.vatBreakdown })
    .from(sales)
    .where(eq(sales.workingOrderId, workingOrderId));
  if (sale === undefined) throw new Error(`no sale for ${workingOrderId}`);
  const lines = await suite.db
    .select({
      productId: saleLines.productId,
      vatRate: saleLines.vatRate,
      lineGross: saleLines.lineGross,
      unitPrice: saleLines.unitPrice,
    })
    .from(saleLines)
    .where(eq(saleLines.saleId, sale.id))
    .orderBy(saleLines.lineNo);
  return { saleId: sale.id, total: sale.total, vatBreakdown: sale.vatBreakdown, lines };
}

async function stored(workingOrderId: string) {
  return suite.db
    .select({
      productId: workingOrderLines.productId,
      vatClass: workingOrderLines.vatClass,
      unitPriceGross: workingOrderLines.unitPriceGross,
      lineTotal: workingOrderLines.lineTotal,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId))
    .orderBy(workingOrderLines.lineNo);
}

const rates = async (workingOrderId: string) =>
  (await filed(workingOrderId)).lines.map((line) => line.vatRate);

// A 2.50 gross split at 10%: base = gross × 100 ÷ 110, tax the difference.
const BEER_AT_10_PERCENT = [{ rate: "10.00", base: "2.27", tax: "0.23" }];

async function openTableTab(
  v: Venue,
  lines: { menuItemId: string; quantity: string; extras?: ExtraSelection[] }[],
) {
  const tableId = randomUUID();
  return withTransaction(suite.db, async (tx) => {
    await tx.insert(diningTables).values({
      id: tableId,
      zoneId: v.tables.zoneId,
      label: `Mesa ${tableId.slice(0, 4)}`,
    });
    await tx.update(diningTables).set({ onFloor: true }).where(eq(diningTables.id, tableId));
    const { tabId } = await openPartyTab(tx, v.cfg, { tableId });
    await addTabRound(tx, v.cfg, tabId, lines);
    return tabId;
  });
}

/** A card provider that runs `onCollect` inside the reader call, where P1 has committed and P3 has
 * not started, then records and returns a captured payment. */
function stubProvider(onCollect: () => Promise<void>): PaymentProvider {
  return {
    provider: "stripe",
    capabilities: { partialRefund: true },
    async collect(params): Promise<PaymentResult> {
      await onCollect();
      const paymentRef = `pi-${randomUUID()}`;
      const settledAt = new Date();
      await withTransaction(suite.db, (tx) =>
        insertCapturedPayment(tx, {
          origin: params.origin,
          nodeId: params.nodeId,
          workingOrderId: params.workingOrderId,
          billPaymentId: params.billPaymentId,
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
    resolvePending: () =>
      Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 }),
    void: () => Promise.reject(new Error("stubProvider: void unused")),
    refund: () => Promise.reject(new Error("stubProvider: refund unused")),
    partialRefund: () => Promise.reject(new Error("stubProvider: partialRefund unused")),
  };
}

function payBeerOnReader(v: Venue, id: string, provider: PaymentProvider) {
  return takeReaderBillPayment(
    { ...deps(), admission: testTradingAdmission(), provider },
    v.cfg,
    id,
    billShare("card", "2.50", { entry: "reader", submissionId: id }),
    v.operator,
  );
}

async function payBeer(v: Venue, id: string) {
  const { invoice } = await takeBillPayment(
    { ...deps(), admission: testTradingAdmission() },
    v.cfg,
    id,
    {
      submissionId: id,
      kind: "contribution",
      amount: "2.50",
      method: "cash",
      tendered: "2.50",
      applied: "2.50",
      tip: "0.00",
    },
    v.operator,
  );
  if (invoice == null) throw new Error(`no invoice for ${id}`);
  return invoice;
}

describe("a product's VAT class changed with no new publish: the sale files the class its line was added at", () => {
  it("walk-up: files at the rate of the published class", async () => {
    const v = await setupVenue();
    await setVat(v.products.beer, "general");
    const id = randomUUID();

    await payFreshCounterInCash(
      { ...deps(), admission: testTradingAdmission() },
      v.cfg,
      v.operator,
      id,
      { zoneId: v.counter.zoneId, lines: one(v, v.products.beer) },
      "2.50",
    );

    expect(await filed(id)).toMatchObject({ total: 250, vatBreakdown: BEER_AT_10_PERCENT });
    expect(await rates(id)).toEqual([1000]);
  });

  it("paying a held order: files 10% at the same gross, and a reprint and a replay after a further change leave the sale and the stored line as filed", async () => {
    const v = await setupVenue();
    const id = await park(v, one(v, v.products.beer));
    const storedAtAdd = await stored(id);
    expect(storedAtAdd[0]!.vatClass).toBe("reduced");
    await setVat(v.products.beer, "general");

    const ticket = await payBeer(v, id);

    const sale = await filed(id);
    expect(sale).toMatchObject({ total: 250, vatBreakdown: BEER_AT_10_PERCENT });
    expect(await rates(id)).toEqual([1000]);
    expect(ticket).toMatchObject({ total: "2.50", vatBreakdown: BEER_AT_10_PERCENT });
    expect(await stored(id)).toEqual(storedAtAdd);

    await setVat(v.products.beer, "super_reduced");
    await giveReceiptPrinter(v.cfg.origin.deviceId);
    await reprintSale(deps(), v.cfg, id);
    await printSaleReceipt(deps(), v.cfg, id, "original");
    // The copy and the original were both built and queued, each printing the filed 10%.
    expect(await suite.db.select().from(printJobs)).toHaveLength(2);
    for (const job of await suite.db.select().from(printJobs))
      expect(decodeTicket(new Uint8Array(job.payload!))).toContain(
        "10%          2,27        0,23         2,50",
      );
    const replay = await payBeer(v, id);

    expect(replay.lines).toEqual(ticket.lines);
    expect(replay.vatBreakdown).toEqual(ticket.vatBreakdown);
    const rebuilt = await withTransaction(suite.db, (tx) => priceStoredOrderForIssuance(tx, id));
    expect(rateLines(rebuilt.gross, "2026-09-27").vatBreakdown).toEqual(BEER_AT_10_PERCENT);
    expect(await filed(id)).toEqual(sale);
    expect(await stored(id)).toEqual(storedAtAdd);
  });

  it("a tab: a dish line keeps its published class, and an extras line keeps the PICKED product's published class, not the dish's", async () => {
    const v = await setupVenue();
    await setVat(v.products.cheese, "general");
    await republish(v);
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
      { menuItemId: v.tables.offerFor(v.products.beer), quantity: "1" },
    ]);
    await setVat(v.products.cheese, "super_reduced");
    await setVat(v.products.beer, "general");

    await payCash(v, tabId, "13.25");

    const sale = await filed(tabId);
    expect(sale.lines.map((line) => [line.productId, line.vatRate, line.lineGross])).toEqual([
      [v.products.burger, 1000, 1000],
      [v.products.cheese, 2100, 75],
      [v.products.beer, 1000, 250],
    ]);
    expect(sale.total).toBe(1325);
  });

  it("a variant with no VAT class of its own keeps the class its parent was published with", async () => {
    const v = await setupVenue();
    const id = await park(v, [
      {
        menuItemId: v.counter.offerFor(v.products.coffee),
        variantId: v.products.doubleCoffeeVariant,
        quantity: "1",
      },
    ]);
    await setVat(v.products.coffee, "general");

    await payCash(v, id, "2.20");

    const sale = await filed(id);
    expect(sale.lines.map((line) => [line.productId, line.vatRate])).toEqual([
      [v.products.doubleCoffeeVariant, 1000],
    ]);
    expect(sale.total).toBe(220);
  });

  it("card (P1): files at the stored class's rate, even when the class changes again during the charge, and the receipt and a replay match the sale", async () => {
    const v = await setupVenue();
    const id = await park(v, one(v, v.products.beer));
    await setVat(v.products.beer, "general");

    const out = await payBeerOnReader(
      v,
      id,
      stubProvider(() => setVat(v.products.beer, "super_reduced")),
    );

    expect(out.outcome).toBe("received");
    const sale = await filed(id);
    expect(sale).toMatchObject({ total: 250, vatBreakdown: BEER_AT_10_PERCENT });
    expect(sale.lines.map((line) => line.vatRate)).toEqual([1000]);
    const ticket = out.invoice;
    expect(ticket?.vatBreakdown).toEqual(sale.vatBreakdown);
    expect(ticket?.lines.map((line) => line.gross)).toEqual(["2.50"]);
    const replay = await payBeerOnReader(
      v,
      id,
      stubProvider(() => Promise.reject(new Error("a replay must not charge"))),
    );
    expect(replay).toEqual(out);
    expect((await stored(id)).map((line) => line.vatClass)).toEqual(["reduced"]);
  });

  it("card recovery: a capture whose sale was never filed files at the stored class's rate, and the gross is the captured amount less the tip", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await withTransaction(suite.db, async (tx) => {
      await createOpenOrder(tx, v.cfg, id, one(v, v.products.beer), null, {
        zoneId: v.counter.zoneId,
      });
    });
    const provider = new FakePaymentProvider(suite.db);
    const filing = { ...deps(), admission: testTradingAdmission() };
    const cfg = { ...v.cfg, tipsEnabled: true };
    provider.crashNextCollect("captured");
    await expect(
      takeReaderBillPayment(
        { ...filing, provider },
        cfg,
        id,
        billShare("card", "2.50", { entry: "reader", addedTip: "0.50", tip: "0.50" }),
        v.operator,
      ),
    ).rejects.toThrow("fake provider: the process stopped after writing a captured row");
    await setVat(v.products.beer, "general");

    expect(await settlePendingBillPayments({ ...filing, cfg })).toMatchObject({ received: 1 });
    const sale = await filed(id);
    expect(sale).toMatchObject({ total: 250, vatBreakdown: BEER_AT_10_PERCENT });
    expect(sale.lines.map((line) => line.vatRate)).toEqual([1000]);
    const [tender] = await suite.db
      .select({ amount: tenders.amount, tip: tenders.tipAmount })
      .from(tenders)
      .where(eq(tenders.saleId, sale.saleId));
    expect(tender).toEqual({ amount: 300, tip: 50 });
  });

  it("an explicitly issued unpaid bill keeps 10% when collected after a VAT change without re-pricing; a second issued bill retains its parked VAT too", async () => {
    const v = await setupVenue("ticket_then_pay");
    const before = await park(v, one(v, v.products.beer));
    const after = await park(v, one(v, v.products.beer));
    await placeOrder({ ...deps(), admission: testTradingAdmission() }, v.cfg, before, OPERATOR);
    await issueOrderInvoice(
      { ...deps(), admission: testTradingAdmission() },
      v.cfg,
      before,
      OPERATOR,
    );
    const placed = await filed(before);
    const storedAtPlacing = await stored(before);
    await setVat(v.products.beer, "general");

    const prepared: string[] = [];
    const spy = await sessionPrepareSpy(prepared);
    let ticket;
    try {
      ticket = await payCash(v, before, "2.50");
    } finally {
      spy.restore();
    }
    await placeOrder({ ...deps(), admission: testTradingAdmission() }, v.cfg, after, OPERATOR);
    await issueOrderInvoice(
      { ...deps(), admission: testTradingAdmission() },
      v.cfg,
      after,
      OPERATOR,
    );

    expect(placed).toMatchObject({ total: 250, vatBreakdown: BEER_AT_10_PERCENT });
    expect(await filed(before)).toEqual(placed);
    expect(await stored(before)).toEqual(storedAtPlacing);
    expect(ticket.vatBreakdown).toEqual(BEER_AT_10_PERCENT);
    expect(prepared.filter((s) => /"products"/.test(s))).toEqual([]);
    expect(prepared.filter((s) => /^update "working_order_lines"/.test(s))).toEqual([]);
    expect(await filed(after)).toMatchObject({ total: 250, vatBreakdown: BEER_AT_10_PERCENT });
    expect(await rates(after)).toEqual([1000]);
  });

  it("ticket-then-pay: an order placed at 10% and changed before collect files 10% at collect, and a replay rebuilds the same receipt", async () => {
    const v = await setupVenue("ticket_then_pay");
    const id = await park(v, one(v, v.products.beer));
    await placeOrder({ ...deps(), admission: testTradingAdmission() }, v.cfg, id, OPERATOR);
    await setVat(v.products.beer, "general");

    const ticket = await payBeer(v, id);

    expect(await filed(id)).toMatchObject({ total: 250, vatBreakdown: BEER_AT_10_PERCENT });
    expect(await rates(id)).toEqual([1000]);
    expect((await stored(id)).map((line) => line.vatClass)).toEqual(["reduced"]);
    const replay = await payBeer(v, id);
    expect(replay.lines).toEqual(ticket.lines);
    expect(replay.vatBreakdown).toEqual(BEER_AT_10_PERCENT);
  });

  it("ticket-then-pay by card: a placed order collected on the reader after the change files 10%", async () => {
    const v = await setupVenue("ticket_then_pay");
    const id = await park(v, one(v, v.products.beer));
    await placeOrder({ ...deps(), admission: testTradingAdmission() }, v.cfg, id, OPERATOR);
    await setVat(v.products.beer, "general");

    const out = await payBeerOnReader(
      v,
      id,
      stubProvider(() => Promise.resolve()),
    );

    expect(out.outcome).toBe("received");
    expect(await filed(id)).toMatchObject({ total: 250, vatBreakdown: BEER_AT_10_PERCENT });
    expect(await rates(id)).toEqual([1000]);
  });

  it("issuing a stored order writes nothing onto its lines", async () => {
    const v = await setupVenue();
    const id = await park(v, [...one(v, v.products.beer), ...one(v, v.products.bread)]);
    const before = await stored(id);
    await setVat(v.products.beer, "general");
    await setVat(v.products.bread, "general");

    await withTransaction(suite.db, async (tx) => {
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
      const { gross } = await priceStoredOrderForIssuance(tx, id);

      expect(rateLines(gross, "2026-09-27").lines.map((l) => l.vatRate)).toEqual([
        "10.00",
        "10.00",
      ]);
      expect(
        prepared.mock.calls.filter(([query]) => /^update "working_order_lines"/.test(query.sql)),
      ).toEqual([]);
    });
    expect(await stored(id)).toEqual(before);
  });
});

describe("an edit prices only what it adds", () => {
  it("an extras pick added to a stored line by an edit takes the class the published version froze", async () => {
    const v = await setupVenue();
    const id = await park(v, one(v, v.products.burger));
    await setVat(v.products.cheese, "general");
    await republish(v);
    const [dish] = await suite.db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    const revision = await withTransaction(suite.db, (tx) => readOrderRevision(tx, id));

    await updateHeldOrder({ admission: testTradingAdmission(), db: suite.db }, v.cfg, id, {
      lines: [
        {
          workingOrderLineId: dish!.id,
          menuItemId: v.counter.offerFor(v.products.burger),
          quantity: "1",
          extras: [
            {
              listId: v.products.extrasListId,
              picks: [{ productId: v.products.cheese, quantity: 1 }],
            },
          ],
        },
      ],
      revision,
    });
    await payCash(v, id, "10.75");

    expect((await stored(id)).map((line) => [line.productId, line.vatClass])).toEqual([
      [v.products.burger, "reduced"],
      [v.products.cheese, "general"],
    ]);
    expect(await rates(id)).toEqual([1000, 2100]);
  });

  it("raising the quantity of a line the kitchen does not have keeps the class it locked with its price, after a new publish; a line the same edit adds takes the new class", async () => {
    const v = await setupVenue();
    const id = await park(v, one(v, v.products.beer));
    await setVat(v.products.beer, "general");
    await republish(v);
    const [kept] = await suite.db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    const revision = await withTransaction(suite.db, (tx) => readOrderRevision(tx, id));

    await updateHeldOrder({ admission: testTradingAdmission(), db: suite.db }, v.cfg, id, {
      lines: [
        {
          workingOrderLineId: kept!.id,
          menuItemId: v.counter.offerFor(v.products.beer),
          quantity: "2",
        },
        ...one(v, v.products.beer),
      ],
      revision,
    });
    await payCash(v, id, "7.50");

    const sale = await filed(id);
    expect(sale.lines.map((line) => [line.vatRate, line.lineGross])).toEqual([
      [1000, 500],
      [2100, 250],
    ]);
    expect(sale.total).toBe(750);
  });
});

describe("a new version published with the new class", () => {
  it("a held order: a line added before the publish keeps 10%, and one added after it takes 21%", async () => {
    const v = await setupVenue();
    const id = await park(v, one(v, v.products.beer));
    await setVat(v.products.beer, "general");
    await republish(v);
    const [kept] = await suite.db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    const revision = await withTransaction(suite.db, (tx) => readOrderRevision(tx, id));

    await updateHeldOrder({ admission: testTradingAdmission(), db: suite.db }, v.cfg, id, {
      lines: [
        {
          workingOrderLineId: kept!.id,
          menuItemId: v.counter.offerFor(v.products.beer),
          quantity: "1",
        },
        ...one(v, v.products.beer),
      ],
      revision,
    });
    await payCash(v, id, "5.00");

    expect(await rates(id)).toEqual([1000, 2100]);
    expect((await filed(id)).total).toBe(500);
  });

  it("a tab: a round rung before the publish keeps 10%, and one rung after it takes 21%", async () => {
    const v = await setupVenue();
    const tabId = await openTableTab(v, [
      { menuItemId: v.tables.offerFor(v.products.beer), quantity: "1" },
    ]);
    await setVat(v.products.beer, "general");
    await republish(v);
    await withTransaction(suite.db, (tx) =>
      addTabRound(tx, v.cfg, tabId, [
        { menuItemId: v.tables.offerFor(v.products.beer), quantity: "1" },
      ]),
    );

    await payCash(v, tabId, "5.00");

    expect(await rates(tabId)).toEqual([1000, 2100]);
  });
});

/**
 * Records the SQL of every statement prepared on any transaction opened while it is installed. Each
 * `withTransaction` body gets a fresh transaction object, so the spy sits on its session's
 * prototype.
 */
async function sessionPrepareSpy(into: string[]): Promise<{ restore: () => void }> {
  const proto = (await withTransaction(suite.db, (tx) =>
    Promise.resolve(Object.getPrototypeOf(sessionOf(tx)) as object),
  )) as { prepareQuery: (query: { sql: string }, ...rest: unknown[]) => unknown };
  const original = proto.prepareQuery;
  proto.prepareQuery = function (this: unknown, query, ...rest) {
    into.push(query.sql);
    return original.call(this, query, ...rest);
  };
  return {
    restore: () => {
      proto.prepareQuery = original;
    },
  };
}

/** Gives the device a switched-on receipt printer, so receipts are built and queued. */
async function giveReceiptPrinter(deviceId: string): Promise<void> {
  await withTransaction(suite.db, async (tx) => {
    const { id } = await createPrinter(tx, {
      name: "Receipts",
      transport: "cloud_poll",
      pollId: `poll-${randomUUID()}`,
    });
    await tx.update(devices).set({ receiptPrinterId: id }).where(eq(devices.id, deviceId));
  });
}
