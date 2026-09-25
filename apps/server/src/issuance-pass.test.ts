import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
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
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  createLabel,
  createProduct,
  setProductLabels,
  setProductVariants,
  updateCategory,
  writeProductModifiers,
} from "@waitron/catalogue";
import type { PricedLines } from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { insertCapturedPayment } from "@waitron/payments";
import type { PaymentProvider, PaymentResult } from "@waitron/payments";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { SaleLineClassification } from "@waitron/shared";
import {
  decimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { issuancePass } from "./issuance-pass.js";
import { ALL_MODULES } from "./modules.js";
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
} from "./working-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

// Spec §3's table, path by path: each filing path takes the classification snapshot in the pass
// that issues the record, and nothing after it re-classifies.
const LOCALE = "es-ES";
const OPERATOR = "0000ffff-2222-4000-8000-0000000000bb";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let backend: FiscalBackend;
let clock: TrustedClock;

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
      throw new Error("issuance-pass.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

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
  return `${String(76_000_000 + nifCounter).padStart(8, "0")}K`;
}

const sessionOf = (tx: Transaction) =>
  (tx as unknown as { session: { prepareQuery: (query: { sql: string }) => unknown } }).session;

type Entry = { id: string; name: string };

/**
 * A venue whose reporting tree is Bebidas > Bebidas alcohólicas > Cócteles, with Licores and Cafés
 * also under Bebidas, and Comida and Añadidos at the top. Every category's `es` and `en` names
 * differ, and the venue's default content language is `es`, so a snapshot read in the wrong
 * language fails. Every product's staff, customer and kitchen names differ too.
 */
async function setupVenue(orderFlow: OrderFlow = "prepay") {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Bar Clasificado SL",
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

  const seeded = await withTransaction(suite.db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Carta" });
    const category = (es: string, en: string, parentId?: string) =>
      createCategory(tx, { name: { es, en }, ...(parentId ? { parentId } : {}) });
    const bebidas = await category("Bebidas", "Drinks");
    const alcoholicas = await category("Bebidas alcohólicas", "Alcoholic drinks", bebidas.id);
    const cocteles = await category("Cócteles", "Cocktails", alcoholicas.id);
    const licores = await category("Licores", "Spirits", bebidas.id);
    const cafes = await category("Cafés", "Hot drinks", bebidas.id);
    const comida = await category("Comida", "Food");
    const anadidos = await category("Añadidos", "Extras");
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
    const negroni = await product("Negroni", cocteles.id, "9.00");
    const cana = await product("Caña", alcoholicas.id, "2.50");
    const cafe = await product("Café", cafes.id, "1.50");
    const burger = await product("Hamburguesa", comida.id, "10.00");
    const queso = await product("Queso", anadidos.id, "3.00");
    const pan = await product("Pan", null, "1.00");
    const [doble] = await setProductVariants(
      tx,
      cafe.id,
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
        items: [{ productId: queso.id, maxQuantity: 1, preselected: false, price: "0.75" }],
      },
      LOCALE,
    );
    await writeProductModifiers(tx, burger.id, [{ kind: "extras", id: extras.id }]);
    const happyHour = await createLabel(tx, "Happy hour drinks");
    const alcohol = await createLabel(tx, "Alcoholic");
    await setProductLabels(tx, negroni.id, [happyHour.id, alcohol.id]);
    await setProductLabels(tx, cana.id, [alcohol.id]);
    await setProductLabels(tx, cafe.id, [happyHour.id]);
    await assignCatalogueToLocation(tx, venue.locationId, menu.id);
    return {
      categories: { bebidas, alcoholicas, cocteles, licores, cafes, comida, anadidos },
      labels: { happyHour, alcohol },
      products: {
        negroni: negroni.id,
        cana: cana.id,
        cafe: cafe.id,
        doble: doble!.id,
        burger: burger.id,
        queso: queso.id,
        pan: pan.id,
      },
      extrasListId: extras.id,
    };
  });
  const { counter, tables } = await withTransaction(suite.db, async (tx) => ({
    counter: await offerProducts(tx, cfg),
    tables: await offerProducts(tx, cfg, { zone: "tables" }),
  }));
  return { cfg, ...seeded, counter, tables };
}

type Venue = Awaited<ReturnType<typeof setupVenue>>;

const entry = (c: { id: string; name: Record<string, string> }): Entry => ({
  id: c.id,
  name: c.name.es!,
});
const labelsOf = (...labels: { id: string; name: string }[]): Entry[] =>
  labels.map((l) => ({ id: l.id, name: l.name })).sort((a, b) => (a.id < b.id ? -1 : 1));

/** The chain Cócteles records before and after it moves from Bebidas alcohólicas to Licores. */
const underAlcoholic = (v: Venue) =>
  [v.categories.bebidas, v.categories.alcoholicas, v.categories.cocteles].map(entry);
const underSpirits = (v: Venue) =>
  [v.categories.bebidas, v.categories.licores, v.categories.cocteles].map(entry);

async function moveCocktailsToSpirits(v: Venue): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    updateCategory(tx, v.categories.cocteles.id, { parentId: v.categories.licores.id }),
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

describe("what a filed sale line records about its product", () => {
  it("records a dish's product, gross, menu and its reporting chain and labels at issuance", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await recordTillSale(deps(), v.cfg, {
      workingOrderId: id,
      zoneId: v.counter.zoneId,
      lines: [{ menuItemId: v.counter.offerFor(v.products.negroni), quantity: "2" }],
      tender: { method: "cash", amount: "20.00" },
    });

    expect(await filedLines(id)).toEqual([
      expect.objectContaining({
        productId: v.products.negroni,
        parentProductId: null,
        menuId: v.counter.menuId,
        menuVersionId: null,
        lineGross: 1800,
        classification: {
          reporting: underAlcoholic(v),
          labels: labelsOf(v.labels.happyHour, v.labels.alcohol),
        },
      }),
    ]);
  });

  it("records a variant as itself, its parent, and the parent's chain when it sets none", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await recordTillSale(deps(), v.cfg, {
      workingOrderId: id,
      zoneId: v.counter.zoneId,
      lines: [
        {
          menuItemId: v.counter.offerFor(v.products.cafe),
          variantId: v.products.doble,
          quantity: "1",
        },
      ],
      tender: { method: "cash", amount: "5.00" },
    });

    const [line] = await filedLines(id);
    expect(line).toMatchObject({
      productId: v.products.doble,
      parentProductId: v.products.cafe,
      lineGross: 220,
      classification: {
        reporting: [v.categories.bebidas, v.categories.cafes].map(entry),
        labels: labelsOf(v.labels.happyHour),
      },
    });
  });

  it("classifies an extras pick by its own product, keeps its dish link, and leaves the free-text category as the dish's", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await recordTillSale(deps(), v.cfg, {
      workingOrderId: id,
      zoneId: v.counter.zoneId,
      lines: [
        {
          menuItemId: v.counter.offerFor(v.products.burger),
          quantity: "1",
          extras: [
            { listId: v.extrasListId, picks: [{ productId: v.products.queso, quantity: 1 }] },
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
      classification: { reporting: [entry(v.categories.comida)], labels: [] },
    });
    expect(extra).toMatchObject({
      productId: v.products.queso,
      parentProductId: null,
      parentLineId: dish!.id,
      // The dish's, as before this change.
      category: "Comida",
      menuId: v.counter.menuId,
      lineGross: 75,
      classification: { reporting: [entry(v.categories.anadidos)], labels: [] },
    });
  });

  it("records an Uncategorised product with an empty chain", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await recordTillSale(deps(), v.cfg, {
      workingOrderId: id,
      zoneId: v.counter.zoneId,
      lines: [{ menuItemId: v.counter.offerFor(v.products.pan), quantity: "1" }],
      tender: { method: "cash", amount: "1.00" },
    });

    expect((await filedLines(id))[0]).toMatchObject({
      productId: v.products.pan,
      classification: { reporting: [], labels: [] },
    });
  });

  it("keeps the snapshot as filed after the category is renamed and moved", async () => {
    const v = await setupVenue();
    const id = randomUUID();
    await recordTillSale(deps(), v.cfg, {
      workingOrderId: id,
      zoneId: v.counter.zoneId,
      lines: [{ menuItemId: v.counter.offerFor(v.products.negroni), quantity: "1" }],
      tender: { method: "cash", amount: "9.00" },
    });

    await withTransaction(suite.db, (tx) =>
      updateCategory(tx, v.categories.cocteles.id, {
        name: { es: "Combinados", en: "Mixed drinks" },
        parentId: v.categories.licores.id,
      }),
    );

    expect(await reportingOf(id)).toEqual([underAlcoholic(v)]);
  });
});

describe("the snapshot is taken when the record is issued, on every filing path (spec §7 example 10)", () => {
  it("a tab rung before the move and paid after it records the chain at payment", async () => {
    const v = await setupVenue();
    const tabId = await openTableTab(v, [
      { menuItemId: v.tables.offerFor(v.products.negroni), quantity: "1" },
    ]);
    await moveCocktailsToSpirits(v);

    await payWorkingOrder(deps(), v.cfg, {
      id: tabId,
      lines: [],
      tender: { method: "cash", amount: "9.00" },
    });

    expect(await reportingOf(tabId)).toEqual([underSpirits(v)]);
    const [line] = await filedLines(tabId);
    expect(line!.menuId).toBe(v.tables.menuId);
  });

  it("invoice-first: an order placed before the move keeps it when collected after; one placed after records the move", async () => {
    const v = await setupVenue("invoice_first");
    const before = randomUUID();
    const after = randomUUID();
    for (const id of [before, after]) {
      await parkOrder({ db: suite.db }, v.cfg, {
        id,
        zoneId: v.counter.zoneId,
        lines: [{ menuItemId: v.counter.offerFor(v.products.negroni), quantity: "1" }],
      });
    }
    await placeOrder(deps(), v.cfg, before, OPERATOR, v.cfg.tillId);
    await moveCocktailsToSpirits(v);

    await collectOrder(deps(), v.cfg, {
      id: before,
      lines: [],
      tender: { method: "cash", amount: "9.00" },
    });
    await placeOrder(deps(), v.cfg, after, OPERATOR, v.cfg.tillId);

    expect(await reportingOf(before)).toEqual([underAlcoholic(v)]);
    expect(await reportingOf(after)).toEqual([underSpirits(v)]);
  });

  it("ticket-then-pay: an order placed before the move and collected after records the chain at collect", async () => {
    const v = await setupVenue("ticket_then_pay");
    const id = randomUUID();
    await parkOrder({ db: suite.db }, v.cfg, {
      id,
      zoneId: v.counter.zoneId,
      lines: [{ menuItemId: v.counter.offerFor(v.products.negroni), quantity: "1" }],
    });
    await placeOrder(deps(), v.cfg, id, OPERATOR, v.cfg.tillId);
    await moveCocktailsToSpirits(v);

    await collectOrder(deps(), v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "9.00" },
    });

    expect(await reportingOf(id)).toEqual([underSpirits(v)]);
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

  it("card recovery: a capture whose sale was never filed records the chain at recovery", async () => {
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
    expect(await reportingOf(id)).toEqual([underSpirits(v)]);
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
    await recordTillSale(deps(), v.cfg, sale);
    const filed = await filedLines(id);
    await moveCocktailsToSpirits(v);

    const statements: string[] = [];
    const prepare = await sessionPrepareSpy(statements);
    try {
      await reprintSale(deps(), v.cfg, id);
      await printSaleReceipt(deps(), v.cfg, id, false);
      await recordTillSale(deps(), v.cfg, sale);
    } finally {
      prepare.restore();
    }

    expect(await filedLines(id)).toEqual(filed);
    expect(statements.filter((s) => /from "labels"/.test(s))).toEqual([]);
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

  it("reads the classification once per sale, however many lines and categories the basket has", async () => {
    const v = await setupVenue();
    const one = await basketOrder(v, [{ productId: v.products.negroni }]);
    const five = await basketOrder(v, [
      { productId: v.products.negroni },
      { productId: v.products.cana },
      { productId: v.products.cafe, variantId: v.products.doble },
      { productId: v.products.negroni },
      { productId: v.products.cana },
    ]);

    await withTransaction(suite.db, async (tx) => {
      const pricedOne = await priceStoredOrder(tx, one);
      const pricedFive = await priceStoredOrder(tx, five);
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");

      await issuancePass(tx, v.cfg, one, pricedOne);
      const forOne = prepared.mock.calls.length;
      prepared.mockClear();
      const issued = await issuancePass(tx, v.cfg, five, pricedFive);

      expect(prepared).toHaveBeenCalledTimes(forOne);
      expect(prepared.mock.calls.filter(([query]) => /from "labels"/.test(query.sql))).toHaveLength(
        1,
      );
      expect(new Set(issued.lines.map((l) => l.classification?.reporting.at(-1)?.id))).toEqual(
        new Set([v.categories.cocteles.id, v.categories.alcoholicas.id, v.categories.cafes.id]),
      );
    });
  });

  it("records a line whose stored product is gone as Uncategorised with no product", async () => {
    const v = await setupVenue();
    const id = await basketOrder(v, [
      { productId: v.products.negroni },
      { productId: v.products.pan },
    ]);
    await suite.db
      .update(workingOrderLines)
      .set({ productId: null })
      .where(eq(workingOrderLines.lineNo, 2));

    const issued = await withTransaction(suite.db, async (tx) =>
      issuancePass(tx, v.cfg, id, await priceStoredOrder(tx, id)),
    );

    expect(issued.lines.map((l) => [l.productId, l.parentProductId, l.classification])).toEqual([
      [
        v.products.negroni,
        null,
        { reporting: underAlcoholic(v), labels: labelsOf(v.labels.happyHour, v.labels.alcohol) },
      ],
      [null, null, { reporting: [], labels: [] }],
    ]);
  });

  it("leaves the menu empty on a line with no recorded selling context", async () => {
    const v = await setupVenue();
    const id = await basketOrder(v, [{ productId: v.products.negroni }]);
    await suite.db.run(sql`delete from working_line_contexts`);

    const issued = await withTransaction(suite.db, async (tx) =>
      issuancePass(tx, v.cfg, id, await priceStoredOrder(tx, id)),
    );

    expect(issued.lines.map((l) => [l.productId, l.menuId])).toEqual([[v.products.negroni, null]]);
  });

  it("refuses priced lines that do not line up with the order's stored lines", async () => {
    const v = await setupVenue();
    const id = await basketOrder(v, [{ productId: v.products.negroni }]);

    await withTransaction(suite.db, async (tx) => {
      const priced: PricedLines = await priceStoredOrder(tx, id);
      const doubled = { ...priced, lines: [...priced.lines, ...priced.lines] };
      const renamed = { ...priced, lines: [{ ...priced.lines[0]!, name: "Otro" }] };
      await expect(issuancePass(tx, v.cfg, id, doubled)).rejects.toThrow(/do not line up/);
      await expect(issuancePass(tx, v.cfg, id, renamed)).rejects.toThrow(/do not line up/);
    });
  });
});
