import { testTradingAdmission } from "./testing/trading-admission.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { updateHeldOrder, placeOrder } from "./testing/order-writer-fixture.js";
import { floorTodayTables, venueLocationId } from "@waitron/db";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  diningTables,
  saleLines,
  sales,
  withTransaction,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToVenue,
  createCatalogue,
  createCategory,
  createExtraList,
  createProduct,
  menuPublications,
  setProductVariants,
  updateCategory,
  writeProductModifiers,
} from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { insertCapturedPayment } from "@waitron/payments";
import type { PaymentProvider, PaymentResult } from "@waitron/payments";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import type { SaleLineClassification } from "@waitron/shared";
import { decimal, nodeId as brandNodeId, seriesId as brandSeriesId } from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { issuancePass } from "./issuance-pass.js";
import { ALL_MODULES } from "./modules.js";
import { systemClock } from "./till-backend.js";
import {
  collectOrderOrchestration as collectOrder,
  payWorkingOrder,
  payWorkingOrderIntegratedOrchestration as payWorkingOrderIntegrated,
  printSaleReceipt,
  recordTillSaleOrchestration as recordTillSale,
  reprintSale,
} from "./testing/whole-payment-fixture.js";
import type { IntegratedPayDeps } from "./till-sale.js";
import {
  createOpenOrder,
  parkOrder,
  priceStoredOrderForIssuance,
  readOrderRevision,
} from "./working-order.js";
import type { GrossOrder } from "./working-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";
import { openPartyTab, splitPartyBill } from "./testing/serve-line.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { deviceRequestCfg } from "./testing/session-device.js";

// Path by path: a line records its classification snapshot when it is added to the order, each
// filing path copies it onto the sale line, and nothing after it re-classifies.
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
      Promise.reject(new Error("issuance-pass.test: resolveClient must never be called")),
  });
});

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return nifWithControlLetter(76_000_000 + nifCounter);
}

const sessionOf = (tx: Transaction) =>
  (tx as unknown as { session: { prepareQuery: (query: { sql: string }) => unknown } }).session;

type Entry = { id: string; name: string };

/**
 * A venue whose reporting tree is Bebidas > Bebidas alcohólicas > Cócteles, with Licores and Cafés
 * also under Bebidas, and Comida and Añadidos at the top. Every product's staff, customer and
 * kitchen names differ.
 */
async function setupVenue(paidWhen: "prepay" | "ticket_then_pay" = "prepay") {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Bar Clasificado SL",
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
  const venueId = await venueLocationId(suite.db);
  const cfg = await deviceRequestCfg(suite.db, {
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: venueId,
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  });

  const seeded = await withTransaction(suite.db, async (tx) => {
    const menu = await createCatalogue(tx, { name: `Issuance pass menu ${cfg.locationId}` });
    const category = (name: string, parentId?: string) =>
      createCategory(tx, { name, ...(parentId ? { parentId } : {}) });
    const drinks = await category("Bebidas");
    const alcoholicDrinks = await category("Bebidas alcohólicas", drinks.id);
    const cocktails = await category("Cócteles", alcoholicDrinks.id);
    const spirits = await category("Licores", drinks.id);
    const coffees = await category("Cafés", drinks.id);
    const food = await category("Comida");
    const additions = await category("Añadidos");
    const product = (name: string, categoryId: string | null, unitPrice: string) =>
      createProduct(tx, {
        catalogueId: menu.id,
        categoryId,
        name: `${name} staff`,
        customerName: { es: `${name} cliente` },
        kitchenName: `${name} cocina`,
        pricingUnit: "each",
        unitPrice,
        vatClass: "general",
      });
    const negroni = await product("Negroni", cocktails.id, "9.00");
    const draftBeer = await product("Caña", alcoholicDrinks.id, "2.50");
    const coffee = await product("Café", coffees.id, "1.50");
    const burger = await product("Hamburguesa", food.id, "10.00");
    const cheese = await product("Queso", additions.id, "3.00");
    const bread = await product("Pan", null, "1.00");
    const [doubleVariant] = await setProductVariants(
      tx,
      coffee.id,
      [
        {
          name: "Doble staff",
          customerName: { es: "Doble cliente" },
          kitchenName: "Doble cocina",
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
    await assignCatalogueToVenue(tx, menu.id);
    return {
      categories: { drinks, alcoholicDrinks, cocktails, spirits, coffees, food, additions },
      products: {
        negroni: negroni.id,
        draftBeer: draftBeer.id,
        coffee: coffee.id,
        doubleVariant: doubleVariant!.id,
        burger: burger.id,
        cheese: cheese.id,
        bread: bread.id,
      },
      extrasListId: extras.id,
    };
  });
  const { counter, tables } = await withTransaction(suite.db, async (tx) => ({
    counter: await offerProducts(tx, cfg, { paidWhen }),
    tables: await offerProducts(tx, cfg, { zone: "tables" }),
  }));
  return { cfg, ...seeded, counter, tables };
}

type Venue = Awaited<ReturnType<typeof setupVenue>>;

const entry = (c: { id: string; name: string }): Entry => ({ id: c.id, name: c.name });

/** The chain Cócteles records before and after it moves from Bebidas alcohólicas to Licores. */
const underAlcoholic = (v: Venue) =>
  [v.categories.drinks, v.categories.alcoholicDrinks, v.categories.cocktails].map(entry);
const underSpirits = (v: Venue) =>
  [v.categories.drinks, v.categories.spirits, v.categories.cocktails].map(entry);

async function moveCocktailsToSpirits(v: Venue): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    updateCategory(tx, v.categories.cocktails.id, { parentId: v.categories.spirits.id }),
  );
}

const deps = () => ({ db: suite.db, backend, clock });

interface FiledLine {
  lineNo: number;
  name: string;
  category: string | null;
  parentLineId: string | null;
  id: string;
  productId: string | null;
  parentProductId: string | null;
  menuId: string | null;
  menuVersionId: string | null;
  lineGross: number | null;
  classification: SaleLineClassification | null;
}

async function filedLines(workingOrderId: string): Promise<FiledLine[]> {
  const [sale] = await suite.db
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.workingOrderId, workingOrderId));
  if (sale === undefined) throw new Error(`no sale for ${workingOrderId}`);
  return suite.db
    .select({
      lineNo: saleLines.lineNo,
      name: saleLines.name,
      category: saleLines.category,
      parentLineId: saleLines.parentLineId,
      id: saleLines.id,
      productId: saleLines.productId,
      parentProductId: saleLines.parentProductId,
      menuId: saleLines.menuId,
      menuVersionId: saleLines.menuVersionId,
      lineGross: saleLines.lineGross,
      classification: saleLines.classification,
    })
    .from(saleLines)
    .where(eq(saleLines.saleId, sale.id))
    .orderBy(saleLines.lineNo);
}

async function reportingOf(workingOrderId: string): Promise<Entry[][]> {
  return (await filedLines(workingOrderId)).map((line) => line.classification!.reporting);
}

async function openTableTab(v: Venue, lines: { menuItemId: string; quantity: string }[]) {
  const tableId = randomUUID();
  return withTransaction(suite.db, async (tx) => {
    await tx.insert(diningTables).values({
      id: tableId,
      locationId: v.cfg.locationId,
      zoneId: v.tables.zoneId,
      label: `Mesa ${tableId.slice(0, 4)}`,
    });
    await tx.insert(floorTodayTables).values({ tableId: tableId });
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
  return { admission: testTradingAdmission(), ...deps(), provider, readerRef: "reader_1" };
}

describe("what a filed sale line records about its product", () => {
  it("records a dish's product, gross, menu and its reporting chain", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await recordTillSale({ ...deps(), admission: testTradingAdmission() }, v.cfg, {
      workingOrderId: id,
      zoneId: v.counter.zoneId,
      lines: [{ menuItemId: v.counter.offerFor(v.products.negroni), quantity: "2" }],
      tender: { method: "cash", amount: "20.00" },
    });
    const [published] = await suite.db
      .select({ versionId: menuPublications.versionId })
      .from(menuPublications)
      .where(eq(menuPublications.menuId, v.counter.menuId));

    expect(await filedLines(id)).toEqual([
      expect.objectContaining({
        productId: v.products.negroni,
        parentProductId: null,
        menuId: v.counter.menuId,
        menuVersionId: published!.versionId,
        lineGross: 1800,
        classification: { reporting: underAlcoholic(v) },
      }),
    ]);
  });

  it("records a variant as itself, its parent, and the parent's chain when it sets none", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await recordTillSale({ ...deps(), admission: testTradingAdmission() }, v.cfg, {
      workingOrderId: id,
      zoneId: v.counter.zoneId,
      lines: [
        {
          menuItemId: v.counter.offerFor(v.products.coffee),
          variantId: v.products.doubleVariant,
          quantity: "1",
        },
      ],
      tender: { method: "cash", amount: "5.00" },
    });

    const [line] = await filedLines(id);
    expect(line).toMatchObject({
      productId: v.products.doubleVariant,
      parentProductId: v.products.coffee,
      lineGross: 220,
      classification: { reporting: [v.categories.drinks, v.categories.coffees].map(entry) },
    });
  });

  it("classifies an extras pick by its own product, keeps its dish link, and leaves the free-text category as the dish's", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await recordTillSale({ ...deps(), admission: testTradingAdmission() }, v.cfg, {
      workingOrderId: id,
      zoneId: v.counter.zoneId,
      lines: [
        {
          menuItemId: v.counter.offerFor(v.products.burger),
          quantity: "1",
          extras: [
            { listId: v.extrasListId, picks: [{ productId: v.products.cheese, quantity: 1 }] },
          ],
        },
      ],
      tender: { method: "cash", amount: "20.00" },
    });

    const [dish, extra] = await filedLines(id);
    expect(dish).toMatchObject({
      productId: v.products.burger,
      category: "Comida",
      menuId: v.counter.menuId,
      classification: { reporting: [entry(v.categories.food)] },
    });
    expect(extra).toMatchObject({
      productId: v.products.cheese,
      parentProductId: null,
      parentLineId: dish!.id,
      // The dish's, as before this change.
      category: "Comida",
      menuId: v.counter.menuId,
      lineGross: 75,
      classification: { reporting: [entry(v.categories.additions)] },
    });
  });

  it("records an Uncategorised product with an empty chain", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await recordTillSale({ ...deps(), admission: testTradingAdmission() }, v.cfg, {
      workingOrderId: id,
      zoneId: v.counter.zoneId,
      lines: [{ menuItemId: v.counter.offerFor(v.products.bread), quantity: "1" }],
      tender: { method: "cash", amount: "1.00" },
    });

    expect((await filedLines(id))[0]).toMatchObject({
      productId: v.products.bread,
      classification: { reporting: [] },
    });
  });

  it("keeps the snapshot as filed after the category is renamed and moved", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await recordTillSale({ ...deps(), admission: testTradingAdmission() }, v.cfg, {
      workingOrderId: id,
      zoneId: v.counter.zoneId,
      lines: [{ menuItemId: v.counter.offerFor(v.products.negroni), quantity: "1" }],
      tender: { method: "cash", amount: "9.00" },
    });

    await withTransaction(suite.db, (tx) =>
      updateCategory(tx, v.categories.cocktails.id, {
        name: "Mixed drinks",
        parentId: v.categories.spirits.id,
      }),
    );

    expect(await reportingOf(id)).toEqual([underAlcoholic(v)]);
  });
});

describe("the snapshot is taken when the line is added, on every till filing path (spec §7 example 10)", () => {
  it("a tab: a round rung before the move and paid after it keeps the chain it was rung with; a round rung after records the move", async () => {
    const v = await setupVenue();
    const tabId = await openTableTab(v, [
      { menuItemId: v.tables.offerFor(v.products.negroni), quantity: "1" },
    ]);
    await moveCocktailsToSpirits(v);
    await withTransaction(suite.db, (tx) =>
      addTabRound(tx, v.cfg, tabId, [
        { menuItemId: v.tables.offerFor(v.products.negroni), quantity: "1" },
      ]),
    );

    await payWorkingOrder({ ...deps(), admission: testTradingAdmission() }, v.cfg, {
      id: tabId,
      lines: [],
      tender: { method: "cash", amount: "18.00" },
    });

    expect(await reportingOf(tabId)).toEqual([underAlcoholic(v), underSpirits(v)]);
    const [line] = await filedLines(tabId);
    expect(line!.menuId).toBe(v.tables.menuId);
  });

  it("a held order: a line added before the move keeps its chain, and a line an edit adds after it records the move", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    const negroni = { menuItemId: v.counter.offerFor(v.products.negroni), quantity: "1" };
    await parkOrder({ db: suite.db }, v.cfg, { id, zoneId: v.counter.zoneId, lines: [negroni] });
    await moveCocktailsToSpirits(v);
    const [kept] = await suite.db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    const revision = await withTransaction(suite.db, (tx) => readOrderRevision(tx, id));
    await updateHeldOrder({ admission: testTradingAdmission(), db: suite.db }, v.cfg, id, {
      lines: [{ workingOrderLineId: kept!.id, ...negroni }, negroni],
      revision,
    });

    await payWorkingOrder({ ...deps(), admission: testTradingAdmission() }, v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "18.00" },
    });

    expect(await reportingOf(id)).toEqual([underAlcoholic(v), underSpirits(v)]);
  });

  it("an extras pick keeps its own product's chain from when it was added", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.db }, v.cfg, {
      id,
      zoneId: v.counter.zoneId,
      lines: [
        {
          menuItemId: v.counter.offerFor(v.products.burger),
          quantity: "1",
          extras: [
            { listId: v.extrasListId, picks: [{ productId: v.products.cheese, quantity: 1 }] },
          ],
        },
      ],
    });
    await withTransaction(suite.db, (tx) =>
      updateCategory(tx, v.categories.additions.id, { parentId: v.categories.food.id }),
    );

    await payWorkingOrder({ ...deps(), admission: testTradingAdmission() }, v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "10.75" },
    });

    expect(await reportingOf(id)).toEqual([
      [entry(v.categories.food)],
      [entry(v.categories.additions)],
    ]);
  });

  it("a check split off a tab after the move keeps the chain the carved line was rung with", async () => {
    const v = await setupVenue();
    const tabId = await openTableTab(v, [
      { menuItemId: v.tables.offerFor(v.products.negroni), quantity: "2" },
    ]);
    await moveCocktailsToSpirits(v);
    const { billId: checkId } = await withTransaction(suite.db, (tx) =>
      splitPartyBill(tx, v.cfg, tabId, [{ lineNo: 1, quantity: "1" }]),
    );

    await payWorkingOrder({ ...deps(), admission: testTradingAdmission() }, v.cfg, {
      id: checkId,
      lines: [],
      tender: { method: "cash", amount: "9.00" },
    });

    expect(await reportingOf(checkId)).toEqual([underAlcoholic(v)]);
  });

  it("ticket then pay: an order placed before the move keeps it when collected after; one parked before and placed after keeps it too; one parked after records the move", async () => {
    const v = await setupVenue("ticket_then_pay");
    const before = randomUUID();
    const parkedBefore = randomUUID();
    const parkedAfter = randomUUID();
    const park = (id: string) =>
      parkOrder({ db: suite.db }, v.cfg, {
        id,
        zoneId: v.counter.zoneId,
        lines: [{ menuItemId: v.counter.offerFor(v.products.negroni), quantity: "1" }],
      });
    await park(before);
    await park(parkedBefore);
    await placeOrder({ ...deps(), admission: testTradingAdmission() }, v.cfg, before, OPERATOR);
    await moveCocktailsToSpirits(v);
    await park(parkedAfter);

    await collectOrder({ ...deps(), admission: testTradingAdmission() }, v.cfg, {
      id: before,
      lines: [],
      tender: { method: "cash", amount: "9.00" },
    });
    await placeOrder(
      { ...deps(), admission: testTradingAdmission() },
      v.cfg,
      parkedBefore,
      OPERATOR,
    );
    await placeOrder(
      { ...deps(), admission: testTradingAdmission() },
      v.cfg,
      parkedAfter,
      OPERATOR,
    );
    for (const id of [parkedBefore, parkedAfter]) {
      await collectOrder({ ...deps(), admission: testTradingAdmission() }, v.cfg, {
        id,
        lines: [],
        tender: { method: "cash", amount: "9.00" },
      });
    }

    expect(await reportingOf(before)).toEqual([underAlcoholic(v)]);
    expect(await reportingOf(parkedBefore)).toEqual([underAlcoholic(v)]);
    expect(await reportingOf(parkedAfter)).toEqual([underSpirits(v)]);
  });

  it("ticket-then-pay: an order placed before the move and collected after keeps the chain it was added with", async () => {
    const v = await setupVenue("ticket_then_pay");
    const id = randomUUID();
    await parkOrder({ db: suite.db }, v.cfg, {
      id,
      zoneId: v.counter.zoneId,
      lines: [{ menuItemId: v.counter.offerFor(v.products.negroni), quantity: "1" }],
    });
    await placeOrder({ ...deps(), admission: testTradingAdmission() }, v.cfg, id, OPERATOR);
    await moveCocktailsToSpirits(v);

    await collectOrder({ ...deps(), admission: testTradingAdmission() }, v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "9.00" },
    });

    expect(await reportingOf(id)).toEqual([underAlcoholic(v)]);
  });

  it("card: the pricing pass before the reader is what is filed, even when the category moves during the charge", async () => {
    const v = await setupVenue();
    const movedDuringCharge = randomUUID();
    const pricedAfterMove = randomUUID();
    const line = [{ menuItemId: v.counter.offerFor(v.products.negroni), quantity: "1" }];

    const out = await payWorkingOrderIntegrated(
      cardDeps(stubProvider(() => moveCocktailsToSpirits(v))),
      v.cfg,
      { id: movedDuringCharge, zoneId: v.counter.zoneId, lines: line },
    );
    expect(out.outcome).toBe("captured");
    await payWorkingOrderIntegrated(cardDeps(stubProvider(() => Promise.resolve())), v.cfg, {
      id: pricedAfterMove,
      zoneId: v.counter.zoneId,
      lines: line,
    });

    expect(await reportingOf(movedDuringCharge)).toEqual([underAlcoholic(v)]);
    expect(await reportingOf(pricedAfterMove)).toEqual([underSpirits(v)]);
  });

  it("card recovery: a capture whose sale was never filed records the chain its line was added with", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await withTransaction(suite.db, async (tx) => {
      await createOpenOrder(
        tx,
        v.cfg,
        id,
        [{ menuItemId: v.counter.offerFor(v.products.negroni), quantity: "1" }],
        null,
        { zoneId: v.counter.zoneId },
      );
      await insertCapturedPayment(tx, {
        origin: v.cfg.origin,
        nodeId: v.cfg.nodeId,
        workingOrderId: id,
        provider: "stripe",
        paymentRef: `pi-${randomUUID()}`,
        amount: decimal("9.00"),
        settledAt: new Date(),
        externalRef: `pi_lost_${randomUUID()}`,
      });
    });
    await moveCocktailsToSpirits(v);

    const out = await payWorkingOrderIntegrated(
      cardDeps(stubProvider(() => Promise.reject(new Error("recovery must not charge")))),
      v.cfg,
      { id, lines: [] },
    );

    expect(out.outcome).toBe("captured");
    expect(await reportingOf(id)).toEqual([underAlcoholic(v)]);
  });

  it("a reprint, a duplicate and a replayed pay change no filed line and read no classification", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    const sale = {
      workingOrderId: id,
      zoneId: v.counter.zoneId,
      lines: [{ menuItemId: v.counter.offerFor(v.products.negroni), quantity: "1" }],
      tender: { method: "cash" as const, amount: "9.00" },
    };
    await recordTillSale({ ...deps(), admission: testTradingAdmission() }, v.cfg, sale);
    const filed = await filedLines(id);
    await moveCocktailsToSpirits(v);

    const statements: string[] = [];
    const prepare = await sessionPrepareSpy(statements);
    try {
      await reprintSale(deps(), v.cfg, id);
      await printSaleReceipt(deps(), v.cfg, id, false);
      await recordTillSale({ ...deps(), admission: testTradingAdmission() }, v.cfg, sale);
    } finally {
      prepare.restore();
    }

    expect(await filedLines(id)).toEqual(filed);
    expect(statements.filter((s) => /from "categories"/.test(s))).toEqual([]);
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

describe("issuancePass", () => {
  async function basketOrder(v: Venue, lines: { productId: string; variantId?: string }[]) {
    const id = randomUUID();
    await withTransaction(suite.db, (tx) =>
      createOpenOrder(
        tx,
        v.cfg,
        id,
        lines.map((line) => ({
          menuItemId: v.counter.offerFor(line.productId),
          quantity: "1",
          ...(line.variantId ? { variantId: line.variantId } : {}),
        })),
        null,
        { zoneId: v.counter.zoneId },
      ),
    );
    return id;
  }

  it("reads no classification at issuance, and copies each line's recorded one", async () => {
    const v = await setupVenue();
    const five = await basketOrder(v, [
      { productId: v.products.negroni },
      { productId: v.products.draftBeer },
      { productId: v.products.coffee, variantId: v.products.doubleVariant },
      { productId: v.products.negroni },
      { productId: v.products.draftBeer },
    ]);

    await withTransaction(suite.db, async (tx) => {
      const pricedFive = await priceStoredOrderForIssuance(tx, five);
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
      prepared.mockClear();

      const issued = await issuancePass(tx, five, pricedFive);

      expect(prepared.mock.calls.filter(([query]) => /from "categories"/.test(query.sql))).toEqual(
        [],
      );
      expect(new Set(issued.lines.map((l) => l.classification?.reporting.at(-1)?.id))).toEqual(
        new Set([
          v.categories.cocktails.id,
          v.categories.alcoholicDrinks.id,
          v.categories.coffees.id,
        ]),
      );
    });
  });

  it("reads the classification once when lines are added, however many lines and categories the basket has", async () => {
    const v = await setupVenue();
    const add = (lines: { productId: string; variantId?: string }[]) =>
      withTransaction(suite.db, async (tx) => {
        const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
        prepared.mockClear();
        await createOpenOrder(
          tx,
          v.cfg,
          randomUUID(),
          lines.map((line) => ({
            menuItemId: v.counter.offerFor(line.productId),
            quantity: "1",
            ...(line.variantId ? { variantId: line.variantId } : {}),
          })),
          null,
          { zoneId: v.counter.zoneId },
        );
        const statements = prepared.mock.calls.map(([query]) => query.sql);
        prepared.mockRestore();
        return statements;
      });

    // The first add reads the published document, which later adds take from a cache.
    await add([{ productId: v.products.negroni }]);
    const forOne = await add([{ productId: v.products.negroni }]);
    const forFive = await add([
      { productId: v.products.negroni },
      { productId: v.products.draftBeer },
      { productId: v.products.coffee, variantId: v.products.doubleVariant },
      { productId: v.products.negroni },
      { productId: v.products.draftBeer },
    ]);

    expect(forFive).toHaveLength(forOne.length);
    expect(forFive.filter((s) => /from "categories"/.test(s))).toHaveLength(1);
  });

  it("copies each stored line's recorded classification as it is: a line whose product id is gone keeps its snapshot, and a line with none recorded files none", async () => {
    const v = await setupVenue();
    const id = await basketOrder(v, [
      { productId: v.products.negroni },
      { productId: v.products.negroni },
      { productId: v.products.bread },
    ]);
    await suite.db
      .update(workingOrderLines)
      .set({ productId: null })
      .where(and(eq(workingOrderLines.workingOrderId, id), eq(workingOrderLines.lineNo, 2)));
    await suite.db
      .update(workingOrderLines)
      .set({ classification: null })
      .where(and(eq(workingOrderLines.workingOrderId, id), eq(workingOrderLines.lineNo, 3)));

    const issued = await withTransaction(suite.db, async (tx) =>
      issuancePass(tx, id, await priceStoredOrderForIssuance(tx, id)),
    );

    const negroni = { reporting: underAlcoholic(v) };
    expect(issued.lines.map((l) => [l.productId, l.parentProductId, l.classification])).toEqual([
      [v.products.negroni, null, negroni],
      [null, null, negroni],
      [v.products.bread, null, null],
    ]);
  });

  it("leaves the menu empty on a line with no recorded selling context", async () => {
    const v = await setupVenue();
    const id = await basketOrder(v, [{ productId: v.products.negroni }]);
    await suite.db.run(
      sql`delete from working_line_contexts where working_order_line_id in (select id from working_order_lines where working_order_id = ${id})`,
    );

    const issued = await withTransaction(suite.db, async (tx) =>
      issuancePass(tx, id, await priceStoredOrderForIssuance(tx, id)),
    );

    expect(issued.lines.map((l) => [l.productId, l.menuId])).toEqual([[v.products.negroni, null]]);
  });

  it("refuses gross lines that do not line up with the line identities handed with them", async () => {
    const v = await setupVenue();
    const id = await basketOrder(v, [{ productId: v.products.negroni }]);

    await withTransaction(suite.db, async (tx) => {
      const { gross, identities }: GrossOrder = await priceStoredOrderForIssuance(tx, id);
      const doubled = { ...gross, lines: [...gross.lines, ...gross.lines] };
      await expect(issuancePass(tx, id, { gross: doubled, identities })).rejects.toThrow(
        /do not line up/,
      );
      await expect(issuancePass(tx, id, { gross, identities: [] })).rejects.toThrow(
        /do not line up/,
      );
    });
  });
});
