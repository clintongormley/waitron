import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  diningTables,
  saleLines,
  sales,
  tenders,
  withTransaction,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createExtraList,
  createProduct,
  setProductVariants,
  updateProduct,
  writeProductModifiers,
  type VatClass,
} from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { insertCapturedPayment } from "@waitron/payments";
import type { PaymentProvider, PaymentResult } from "@waitron/payments";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  decimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { ExtraSelection } from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import { systemClock } from "./till-backend.js";
import type { OrderFlow, TillConfig } from "./till-config.js";
import {
  collectOrder,
  payWorkingOrder,
  payWorkingOrderIntegrated,
  printSaleReceipt,
  recordTillSale,
  reprintSale,
} from "./till-sale.js";
import type { IntegratedPayDeps } from "./till-sale.js";
import {
  addTabRound,
  createOpenOrder,
  openTab,
  parkOrder,
  placeOrder,
  priceStoredOrder,
  priceStoredOrderForIssuance,
} from "./working-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

// Spec §11.4: a line's VAT rate is resolved from its product's CURRENT VAT class in the pass that
// issues the invoice record, on every filing path, and written back onto the stored line. Every
// product starts at `reduced` (10%); a case corrects one to `general` (21%). The gross the customer
// pays never moves, so each case also pins the filed total.
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
    resolveClient: () =>
      Promise.reject(new Error("vat-at-issuance.test: resolveClient must never be called")),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(77_000_000 + nifCounter).padStart(8, "0")}K`;
}

const sessionOf = (tx: Transaction) =>
  (tx as unknown as { session: { prepareQuery: (query: { sql: string }) => unknown } }).session;

async function setupVenue(orderFlow: OrderFlow = "prepay") {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Bar del IVA SL",
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
    { db: suite.db, modules: ALL_MODULES },
  );
  const cfg: TillConfig = {
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow,
  };
  suite.db.run(sql`update locations set order_flow = ${orderFlow} where id = ${cfg.locationId}`);

  const products = await withTransaction(suite.db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Carta" });
    const product = (name: string, unitPrice: string) =>
      createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name,
        pricingUnit: "each",
        unitPrice,
        vatClass: "reduced",
      });
    const cana = await product("Caña", "2.50");
    const burger = await product("Hamburguesa", "10.00");
    const queso = await product("Queso", "3.00");
    const cafe = await product("Café", "1.50");
    const pan = await product("Pan", "1.00");
    // Created with no VAT class of its own, so it reads its parent's.
    const [doble] = await setProductVariants(
      tx,
      cafe.id,
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
      cafe: cafe.id,
      doble: doble!.id,
      pan: pan.id,
      extrasListId: extras.id,
    };
  });
  const { counter, tables } = await withTransaction(suite.db, async (tx) => ({
    counter: await offerProducts(tx, cfg),
    tables: await offerProducts(tx, cfg, { zone: "tables" }),
  }));
  return { cfg, products, counter, tables };
}

type Venue = Awaited<ReturnType<typeof setupVenue>>;

const deps = () => ({ db: suite.db, backend, clock });

async function setVat(productId: string, vatClass: VatClass): Promise<void> {
  await withTransaction(suite.db, (tx) => updateProduct(tx, productId, { vatClass }));
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
      vatRate: workingOrderLines.vatRate,
      unitPrice: workingOrderLines.unitPrice,
      unitPriceGross: workingOrderLines.unitPriceGross,
      lineTotal: workingOrderLines.lineTotal,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId))
    .orderBy(workingOrderLines.lineNo);
}

const rates = async (workingOrderId: string) =>
  (await filed(workingOrderId)).lines.map((line) => line.vatRate);

// A 2.50 gross split at each rate: base = gross × 100 ÷ (100 + rate), tax the difference.
const CANA_AT_10 = [{ rate: "10.00", base: "2.27", tax: "0.23" }];
const CANA_AT_21 = [{ rate: "21.00", base: "2.07", tax: "0.43" }];

async function openTableTab(
  v: Venue,
  lines: { menuItemId: string; quantity: string; extras?: ExtraSelection[] }[],
) {
  const tableId = randomUUID();
  return withTransaction(suite.db, async (tx) => {
    await tx.insert(diningTables).values({
      id: tableId,
      locationId: v.cfg.locationId,
      zoneId: v.tables.zoneId,
      label: `Mesa ${tableId.slice(0, 4)}`,
      active: true,
    });
    const { tabId } = await openTab(tx, v.cfg, { tableId });
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

function cardDeps(provider: PaymentProvider): IntegratedPayDeps {
  return { ...deps(), provider, readerRef: "reader_1" };
}

describe("the VAT rate is resolved when the invoice record is issued (spec §11.4)", () => {
  it("walk-up: files the product's current class, as it always has", async () => {
    const v = await setupVenue();
    await setVat(v.products.cana, "general");
    const id = randomUUID();

    await recordTillSale(deps(), v.cfg, {
      workingOrderId: id,
      zoneId: v.counter.zoneId,
      lines: one(v, v.products.cana),
      tender: { method: "cash", amount: "2.50" },
    });

    expect(await filed(id)).toMatchObject({ total: 250, vatBreakdown: CANA_AT_21 });
    expect(await rates(id)).toEqual([2100]);
  });

  it("held order paid on POST /api/sales: added at 10%, corrected to 21% before payment, files 21% at the same gross (spec §10.7(6))", async () => {
    const v = await setupVenue();
    const id = await park(v, one(v, v.products.cana));
    expect((await stored(id))[0]!.vatRate).toBe(1000);
    await setVat(v.products.cana, "general");

    const ticket = await payWorkingOrder(deps(), v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "2.50" },
    });

    expect(await filed(id)).toMatchObject({ total: 250, vatBreakdown: CANA_AT_21 });
    expect(await rates(id)).toEqual([2100]);
    expect(ticket).toMatchObject({ total: "2.50", vatBreakdown: CANA_AT_21 });
  });

  it("a tab: a dish line follows its own product, and an extras line follows the PICKED product's class, not the dish's", async () => {
    const v = await setupVenue();
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
      { menuItemId: v.tables.offerFor(v.products.cana), quantity: "1" },
    ]);
    await setVat(v.products.queso, "general");
    await setVat(v.products.cana, "general");

    await payWorkingOrder(deps(), v.cfg, {
      id: tabId,
      lines: [],
      tender: { method: "cash", amount: "13.25" },
    });

    const sale = await filed(tabId);
    expect(sale.lines.map((line) => [line.productId, line.vatRate, line.lineGross])).toEqual([
      [v.products.burger, 1000, 1000],
      [v.products.queso, 2100, 75],
      [v.products.cana, 2100, 250],
    ]);
    expect(sale.total).toBe(1325);
  });

  it("a variant with no VAT class of its own follows its parent's CURRENT class", async () => {
    const v = await setupVenue();
    const id = await park(v, [
      {
        menuItemId: v.counter.offerFor(v.products.cafe),
        variantId: v.products.doble,
        quantity: "1",
      },
    ]);
    await setVat(v.products.cafe, "general");

    await payWorkingOrder(deps(), v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "2.20" },
    });

    const sale = await filed(id);
    expect(sale.lines.map((line) => [line.productId, line.vatRate])).toEqual([
      [v.products.doble, 2100],
    ]);
    expect(sale.total).toBe(220);
  });

  it("card (P1): the rate resolved before the reader is what is filed, even when the class changes during the charge, and the receipt matches the sale", async () => {
    const v = await setupVenue();
    const id = await park(v, one(v, v.products.cana));
    await setVat(v.products.cana, "general");

    const out = await payWorkingOrderIntegrated(
      cardDeps(stubProvider(() => setVat(v.products.cana, "super_reduced"))),
      v.cfg,
      { id, lines: [] },
    );

    expect(out.outcome).toBe("captured");
    const sale = await filed(id);
    expect(sale).toMatchObject({ total: 250, vatBreakdown: CANA_AT_21 });
    expect(sale.lines.map((line) => line.vatRate)).toEqual([2100]);
    const ticket = out.outcome === "captured" ? out.ticket : undefined;
    expect(ticket?.vatBreakdown).toEqual(sale.vatBreakdown);
    expect(ticket?.lines.map((line) => line.gross)).toEqual(["2.50"]);
    // A replay rebuilds its lines from the stored order, so it must agree with the filed sale too.
    const replay = await payWorkingOrderIntegrated(
      cardDeps(stubProvider(() => Promise.reject(new Error("a replay must not charge")))),
      v.cfg,
      { id, lines: [] },
    );
    expect(replay).toEqual(out);
    expect((await stored(id)).map((line) => line.vatRate)).toEqual([2100]);
  });

  it("card recovery: a capture whose sale was never filed files the CURRENT rate, and the gross is the captured amount less the tip", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await withTransaction(suite.db, async (tx) => {
      await createOpenOrder(tx, v.cfg, id, one(v, v.products.cana), null, {
        zoneId: v.counter.zoneId,
      });
      await insertCapturedPayment(tx, {
        workingOrderId: id,
        provider: "stripe",
        paymentRef: `pi-${randomUUID()}`,
        amount: decimal("3.00"),
        settledAt: new Date(),
        externalRef: `pi_lost_${randomUUID()}`,
      });
    });
    await setVat(v.products.cana, "general");

    const out = await payWorkingOrderIntegrated(
      cardDeps(stubProvider(() => Promise.reject(new Error("recovery must not charge")))),
      v.cfg,
      { id, lines: [] },
    );

    expect(out.outcome).toBe("captured");
    const sale = await filed(id);
    expect(sale).toMatchObject({ total: 250, vatBreakdown: CANA_AT_21 });
    expect(sale.lines.map((line) => line.vatRate)).toEqual([2100]);
    const [tender] = await suite.db
      .select({ amount: tenders.amount, tip: tenders.tipAmount })
      .from(tenders)
      .where(eq(tenders.saleId, sale.saleId));
    expect(tender).toEqual({ amount: 300, tip: 50 });
  });

  it("invoice-first: an order placed at 10% keeps 10% when collected after the correction, and collect re-prices nothing; one placed after files 21%", async () => {
    const v = await setupVenue("invoice_first");
    const before = await park(v, one(v, v.products.cana));
    const after = await park(v, one(v, v.products.cana));
    await placeOrder(deps(), v.cfg, before, OPERATOR, v.cfg.tillId);
    const placed = await filed(before);
    const storedAtPlacing = await stored(before);
    await setVat(v.products.cana, "general");

    const prepared: string[] = [];
    const spy = await sessionPrepareSpy(prepared);
    let ticket;
    try {
      ticket = await collectOrder(deps(), v.cfg, {
        id: before,
        lines: [],
        tender: { method: "cash", amount: "2.50" },
      });
    } finally {
      spy.restore();
    }
    await placeOrder(deps(), v.cfg, after, OPERATOR, v.cfg.tillId);

    expect(placed).toMatchObject({ total: 250, vatBreakdown: CANA_AT_10 });
    expect(await filed(before)).toEqual(placed);
    expect(await stored(before)).toEqual(storedAtPlacing);
    expect(ticket.vatBreakdown).toEqual(CANA_AT_10);
    expect(prepared.filter((s) => /from "products"/.test(s))).toEqual([]);
    expect(prepared.filter((s) => /^update "working_order_lines"/.test(s))).toEqual([]);
    expect(await filed(after)).toMatchObject({ total: 250, vatBreakdown: CANA_AT_21 });
    expect(await rates(after)).toEqual([2100]);
  });

  it("ticket-then-pay: an order placed at 10% and corrected before collect files 21% at collect", async () => {
    const v = await setupVenue("ticket_then_pay");
    const id = await park(v, one(v, v.products.cana));
    await placeOrder(deps(), v.cfg, id, OPERATOR, v.cfg.tillId);
    await setVat(v.products.cana, "general");

    const ticket = await collectOrder(deps(), v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "2.50" },
    });

    expect(await filed(id)).toMatchObject({ total: 250, vatBreakdown: CANA_AT_21 });
    expect(await rates(id)).toEqual([2100]);
    // A placed order's lines cannot be written (`working_order_lines_require_open_parent_update`),
    // so its stored line keeps the add-time rate; the receipt a replay rebuilds still matches.
    expect((await stored(id)).map((line) => line.vatRate)).toEqual([1000]);
    const replay = await collectOrder(deps(), v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "2.50" },
    });
    expect(replay.lines).toEqual(ticket.lines);
    expect(replay.vatBreakdown).toEqual(CANA_AT_21);
  });

  it("ticket-then-pay by card: a placed order collected on the reader after the correction files 21%", async () => {
    const v = await setupVenue("ticket_then_pay");
    const id = await park(v, one(v, v.products.cana));
    await placeOrder(deps(), v.cfg, id, OPERATOR, v.cfg.tillId);
    await setVat(v.products.cana, "general");

    const out = await payWorkingOrderIntegrated(
      cardDeps(stubProvider(() => Promise.resolve())),
      v.cfg,
      { id, lines: [] },
    );

    expect(out.outcome).toBe("captured");
    expect(await filed(id)).toMatchObject({ total: 250, vatBreakdown: CANA_AT_21 });
    expect(await rates(id)).toEqual([2100]);
  });
});

describe("the resolved rate is written back onto the stored line", () => {
  it("after filing, the stored line holds the filed rate and net unit; a reprint and a replay after a further change print the filed rate and change no row", async () => {
    const v = await setupVenue();
    const id = await park(v, one(v, v.products.cana));
    const [atAdd] = await stored(id);
    await setVat(v.products.cana, "general");

    const original = await payWorkingOrder(deps(), v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "2.50" },
    });
    const sale = await filed(id);
    const [line] = await stored(id);
    expect(line).toEqual({
      productId: v.products.cana,
      vatRate: sale.lines[0]!.vatRate,
      unitPrice: sale.lines[0]!.unitPrice,
      unitPriceGross: atAdd!.unitPriceGross,
      lineTotal: atAdd!.lineTotal,
    });
    expect(line!.vatRate).toBe(2100);
    expect(line!.unitPrice).not.toBe(atAdd!.unitPrice);

    await setVat(v.products.cana, "super_reduced");
    const storedAfterFiling = await stored(id);
    await reprintSale(deps(), v.cfg, id);
    await printSaleReceipt(deps(), v.cfg, id, false);
    const replay = await payWorkingOrder(deps(), v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "2.50" },
    });

    expect(replay.lines).toEqual(original.lines);
    expect(replay.vatBreakdown).toEqual(original.vatBreakdown);
    const rebuilt = await withTransaction(suite.db, (tx) => priceStoredOrder(tx, id));
    expect(rebuilt.lines.map((l) => l.vatRate)).toEqual(["21.00"]);
    expect(rebuilt.vatBreakdown).toEqual(CANA_AT_21);
    expect(await filed(id)).toEqual(sale);
    expect(await stored(id)).toEqual(storedAfterFiling);
  });

  it("resolves every line's class in one read and writes the changed rates in one statement, however many lines the order has", async () => {
    const v = await setupVenue();
    const single = await park(v, one(v, v.products.cana));
    const five = await park(v, [
      ...one(v, v.products.cana),
      ...one(v, v.products.burger),
      {
        menuItemId: v.counter.offerFor(v.products.cafe),
        variantId: v.products.doble,
        quantity: "1",
      },
      ...one(v, v.products.pan),
      ...one(v, v.products.cana),
    ]);
    for (const product of [v.products.cana, v.products.burger, v.products.cafe, v.products.pan]) {
      await setVat(product, "general");
    }

    await withTransaction(suite.db, async (tx) => {
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
      await priceStoredOrderForIssuance(tx, single);
      const forOne = prepared.mock.calls.map(([query]) => query.sql);
      prepared.mockClear();
      const priced = await priceStoredOrderForIssuance(tx, five);
      const forFive = prepared.mock.calls.map(([query]) => query.sql);

      expect(forFive).toHaveLength(forOne.length);
      expect(forFive.filter((s) => /from "products"/.test(s))).toHaveLength(1);
      expect(forFive.filter((s) => /^update "working_order_lines"/.test(s))).toHaveLength(1);
      expect(priced.priced.lines.map((l) => l.vatRate)).toEqual(Array(5).fill("21.00"));
    });
    expect((await stored(five)).map((line) => line.vatRate)).toEqual(Array(5).fill(2100));
  });

  it("writes nothing when no line's rate changed", async () => {
    const v = await setupVenue();
    const id = await park(v, one(v, v.products.cana));
    const before = await stored(id);

    await withTransaction(suite.db, async (tx) => {
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
      await priceStoredOrderForIssuance(tx, id);

      expect(
        prepared.mock.calls.filter(([query]) => /^update "working_order_lines"/.test(query.sql)),
      ).toEqual([]);
    });
    expect(await stored(id)).toEqual(before);
  });

  it("keeps the stored rate on a line with no product id", async () => {
    const v = await setupVenue();
    const id = await park(v, [...one(v, v.products.cana), ...one(v, v.products.pan)]);
    await suite.db
      .update(workingOrderLines)
      .set({ productId: null })
      .where(and(eq(workingOrderLines.workingOrderId, id), eq(workingOrderLines.lineNo, 2)));
    await setVat(v.products.cana, "general");
    await setVat(v.products.pan, "general");

    const priced = await withTransaction(suite.db, (tx) => priceStoredOrderForIssuance(tx, id));

    expect(priced.priced.lines.map((l) => l.vatRate)).toEqual(["21.00", "10.00"]);
    expect((await stored(id)).map((line) => line.vatRate)).toEqual([2100, 1000]);
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
