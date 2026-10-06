import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
  rateLines,
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
} from "@waitron/shared";
import type { ExtraSelection } from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import { systemClock } from "./till-backend.js";
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
  parkOrder,
  placeOrder,
  priceStoredOrder,
  priceStoredOrderForIssuance,
  readOrderRevision,
  updateHeldOrder,
} from "./working-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import "./errors.js";
import { openPartyTab } from "./testing/serve-line.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { deviceRequestCfg } from "./testing/session-device.js";

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
    resolveClient: () =>
      Promise.reject(new Error("vat-class-at-line-add.test: resolveClient must never be called")),
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
    orderFlow: "prepay",
  });

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
    counter: await offerProducts(tx, cfg, { paidWhen }),
    tables: await offerProducts(tx, cfg, { zone: "tables" }),
  }));
  return { cfg, products, counter, tables };
}

type Venue = Awaited<ReturnType<typeof setupVenue>>;

const deps = () => ({ db: suite.db, backend, clock });

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
const CANA_AT_10 = [{ rate: "10.00", base: "2.27", tax: "0.23" }];

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

describe("a product's VAT class changed with no new publish: the sale files the class its line was added at", () => {
  it("walk-up: files at the rate of the published class", async () => {
    const v = await setupVenue();
    await setVat(v.products.cana, "general");
    const id = randomUUID();

    await recordTillSale(deps(), v.cfg, {
      workingOrderId: id,
      zoneId: v.counter.zoneId,
      lines: one(v, v.products.cana),
      tender: { method: "cash", amount: "2.50" },
    });

    expect(await filed(id)).toMatchObject({ total: 250, vatBreakdown: CANA_AT_10 });
    expect(await rates(id)).toEqual([1000]);
  });

  it("held order paid on POST /api/sales: files 10% at the same gross, and a reprint and a replay after a further change leave the sale and the stored line as filed", async () => {
    const v = await setupVenue();
    const id = await park(v, one(v, v.products.cana));
    const storedAtAdd = await stored(id);
    expect(storedAtAdd[0]!.vatClass).toBe("reduced");
    await setVat(v.products.cana, "general");

    const ticket = await payWorkingOrder(deps(), v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "2.50" },
    });

    const sale = await filed(id);
    expect(sale).toMatchObject({ total: 250, vatBreakdown: CANA_AT_10 });
    expect(await rates(id)).toEqual([1000]);
    expect(ticket).toMatchObject({ total: "2.50", vatBreakdown: CANA_AT_10 });
    expect(await stored(id)).toEqual(storedAtAdd);

    await setVat(v.products.cana, "super_reduced");
    await reprintSale(deps(), v.cfg, id);
    await printSaleReceipt(deps(), v.cfg, id, false);
    const replay = await payWorkingOrder(deps(), v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "2.50" },
    });

    expect(replay.lines).toEqual(ticket.lines);
    expect(replay.vatBreakdown).toEqual(ticket.vatBreakdown);
    const rebuilt = await withTransaction(suite.db, (tx) => priceStoredOrder(tx, id));
    expect(rateLines(rebuilt, "2026-09-27").vatBreakdown).toEqual(CANA_AT_10);
    expect(await filed(id)).toEqual(sale);
    expect(await stored(id)).toEqual(storedAtAdd);
  });

  it("a tab: a dish line keeps its published class, and an extras line keeps the PICKED product's published class, not the dish's", async () => {
    const v = await setupVenue();
    await setVat(v.products.queso, "general");
    await republish(v);
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
    await setVat(v.products.queso, "super_reduced");
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
      [v.products.cana, 1000, 250],
    ]);
    expect(sale.total).toBe(1325);
  });

  it("a variant with no VAT class of its own keeps the class its parent was published with", async () => {
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
      [v.products.doble, 1000],
    ]);
    expect(sale.total).toBe(220);
  });

  it("card (P1): files at the stored class's rate, even when the class changes again during the charge, and the receipt and a replay match the sale", async () => {
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
    expect(sale).toMatchObject({ total: 250, vatBreakdown: CANA_AT_10 });
    expect(sale.lines.map((line) => line.vatRate)).toEqual([1000]);
    const ticket = out.outcome === "captured" ? out.ticket : undefined;
    expect(ticket?.vatBreakdown).toEqual(sale.vatBreakdown);
    expect(ticket?.lines.map((line) => line.gross)).toEqual(["2.50"]);
    const replay = await payWorkingOrderIntegrated(
      cardDeps(stubProvider(() => Promise.reject(new Error("a replay must not charge")))),
      v.cfg,
      { id, lines: [] },
    );
    expect(replay).toEqual(out);
    expect((await stored(id)).map((line) => line.vatClass)).toEqual(["reduced"]);
  });

  it("card recovery: a capture whose sale was never filed files at the stored class's rate, and the gross is the captured amount less the tip", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await withTransaction(suite.db, async (tx) => {
      await createOpenOrder(tx, v.cfg, id, one(v, v.products.cana), null, {
        zoneId: v.counter.zoneId,
      });
      await insertCapturedPayment(tx, {
        origin: v.cfg.origin,
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
    expect(sale).toMatchObject({ total: 250, vatBreakdown: CANA_AT_10 });
    expect(sale.lines.map((line) => line.vatRate)).toEqual([1000]);
    const [tender] = await suite.db
      .select({ amount: tenders.amount, tip: tenders.tipAmount })
      .from(tenders)
      .where(eq(tenders.saleId, sale.saleId));
    expect(tender).toEqual({ amount: 300, tip: 50 });
  });

  it("an explicitly issued unpaid bill keeps 10% when collected after a VAT change without re-pricing; a second issued bill retains its parked VAT too", async () => {
    const v = await setupVenue("ticket_then_pay");
    const before = await park(v, one(v, v.products.cana));
    const after = await park(v, one(v, v.products.cana));
    await placeOrder(deps(), v.cfg, before, OPERATOR);
    await issueOrderInvoice(deps(), v.cfg, before, OPERATOR);
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
    await placeOrder(deps(), v.cfg, after, OPERATOR);
    await issueOrderInvoice(deps(), v.cfg, after, OPERATOR);

    expect(placed).toMatchObject({ total: 250, vatBreakdown: CANA_AT_10 });
    expect(await filed(before)).toEqual(placed);
    expect(await stored(before)).toEqual(storedAtPlacing);
    expect(ticket.vatBreakdown).toEqual(CANA_AT_10);
    expect(prepared.filter((s) => /"products"/.test(s))).toEqual([]);
    expect(prepared.filter((s) => /^update "working_order_lines"/.test(s))).toEqual([]);
    expect(await filed(after)).toMatchObject({ total: 250, vatBreakdown: CANA_AT_10 });
    expect(await rates(after)).toEqual([1000]);
  });

  it("ticket-then-pay: an order placed at 10% and changed before collect files 10% at collect, and a replay rebuilds the same receipt", async () => {
    const v = await setupVenue("ticket_then_pay");
    const id = await park(v, one(v, v.products.cana));
    await placeOrder(deps(), v.cfg, id, OPERATOR);
    await setVat(v.products.cana, "general");

    const ticket = await collectOrder(deps(), v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "2.50" },
    });

    expect(await filed(id)).toMatchObject({ total: 250, vatBreakdown: CANA_AT_10 });
    expect(await rates(id)).toEqual([1000]);
    expect((await stored(id)).map((line) => line.vatClass)).toEqual(["reduced"]);
    const replay = await collectOrder(deps(), v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "2.50" },
    });
    expect(replay.lines).toEqual(ticket.lines);
    expect(replay.vatBreakdown).toEqual(CANA_AT_10);
  });

  it("ticket-then-pay by card: a placed order collected on the reader after the change files 10%", async () => {
    const v = await setupVenue("ticket_then_pay");
    const id = await park(v, one(v, v.products.cana));
    await placeOrder(deps(), v.cfg, id, OPERATOR);
    await setVat(v.products.cana, "general");

    const out = await payWorkingOrderIntegrated(
      cardDeps(stubProvider(() => Promise.resolve())),
      v.cfg,
      { id, lines: [] },
    );

    expect(out.outcome).toBe("captured");
    expect(await filed(id)).toMatchObject({ total: 250, vatBreakdown: CANA_AT_10 });
    expect(await rates(id)).toEqual([1000]);
  });

  it("issuing a stored order writes nothing onto its lines", async () => {
    const v = await setupVenue();
    const id = await park(v, [...one(v, v.products.cana), ...one(v, v.products.pan)]);
    const before = await stored(id);
    await setVat(v.products.cana, "general");
    await setVat(v.products.pan, "general");

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
    await setVat(v.products.queso, "general");
    await republish(v);
    const [dish] = await suite.db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    const revision = await withTransaction(suite.db, (tx) => readOrderRevision(tx, id));

    await updateHeldOrder({ db: suite.db }, v.cfg, id, {
      lines: [
        {
          workingOrderLineId: dish!.id,
          menuItemId: v.counter.offerFor(v.products.burger),
          quantity: "1",
          extras: [
            {
              listId: v.products.extrasListId,
              picks: [{ productId: v.products.queso, quantity: 1 }],
            },
          ],
        },
      ],
      revision,
    });
    await payWorkingOrder(deps(), v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "10.75" },
    });

    expect((await stored(id)).map((line) => [line.productId, line.vatClass])).toEqual([
      [v.products.burger, "reduced"],
      [v.products.queso, "general"],
    ]);
    expect(await rates(id)).toEqual([1000, 2100]);
  });

  it("raising the quantity of a line the kitchen does not have keeps the class it locked with its price, after a new publish; a line the same edit adds takes the new class", async () => {
    const v = await setupVenue();
    const id = await park(v, one(v, v.products.cana));
    await setVat(v.products.cana, "general");
    await republish(v);
    const [kept] = await suite.db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    const revision = await withTransaction(suite.db, (tx) => readOrderRevision(tx, id));

    await updateHeldOrder({ db: suite.db }, v.cfg, id, {
      lines: [
        {
          workingOrderLineId: kept!.id,
          menuItemId: v.counter.offerFor(v.products.cana),
          quantity: "2",
        },
        ...one(v, v.products.cana),
      ],
      revision,
    });
    await payWorkingOrder(deps(), v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "7.50" },
    });

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
    const id = await park(v, one(v, v.products.cana));
    await setVat(v.products.cana, "general");
    await republish(v);
    const [kept] = await suite.db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    const revision = await withTransaction(suite.db, (tx) => readOrderRevision(tx, id));

    await updateHeldOrder({ db: suite.db }, v.cfg, id, {
      lines: [
        {
          workingOrderLineId: kept!.id,
          menuItemId: v.counter.offerFor(v.products.cana),
          quantity: "1",
        },
        ...one(v, v.products.cana),
      ],
      revision,
    });
    await payWorkingOrder(deps(), v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });

    expect(await rates(id)).toEqual([1000, 2100]);
    expect((await filed(id)).total).toBe(500);
  });

  it("a tab: a round rung before the publish keeps 10%, and one rung after it takes 21%", async () => {
    const v = await setupVenue();
    const tabId = await openTableTab(v, [
      { menuItemId: v.tables.offerFor(v.products.cana), quantity: "1" },
    ]);
    await setVat(v.products.cana, "general");
    await republish(v);
    await withTransaction(suite.db, (tx) =>
      addTabRound(tx, v.cfg, tabId, [
        { menuItemId: v.tables.offerFor(v.products.cana), quantity: "1" },
      ]),
    );

    await payWorkingOrder(deps(), v.cfg, {
      id: tabId,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });

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
