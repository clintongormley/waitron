import { setImmediate as yieldTurn } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { createAdjustmentReason } from "@waitron/adjustments";
import { createExtraList, createProduct, writeProductModifiers } from "@waitron/catalogue";
import {
  locationCatalogues,
  orderPortions,
  products,
  saleLinePortions,
  saleLines,
  sales,
  ticketItems,
  workingLinePortions,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { insertCapturedPayment, type PaymentProvider } from "@waitron/payments";
import { decimal } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { createCourse } from "./kitchen.js";
import { resolveKitchenAllergyBlocks } from "./kitchen-allergy.js";
import { VENUE_SERVICE } from "./modules.js";
import { moveBill } from "./move-bill.js";
import { readOrderDetail } from "./orders-list.js";
import type { PortionRef } from "./order-portions.js";
import { partyRevision } from "./parties.js";
import { receiptLines } from "./receipt-adjustments.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { addPortionRound, portionBill } from "./testing/portion-bill.js";
import {
  payWorkingOrder,
  payWorkingOrderIntegratedOrchestration,
  type IntegratedPayDeps,
} from "./till-sale.js";
import { createTable } from "./testing/live-table.js";
import { fireAll, openPartyTab } from "./testing/serve-line.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import {
  insertTabRound,
  priceStoredOrder,
  priceStoredOrderForIssuance,
  priceTabRound,
  fireableLineColumns,
  fireLines,
  readOrderRevision,
  readStoredOrder,
  storedOrderTotal,
  updateHeldOrder,
  updateOrderLine,
  type TabRoundLine,
} from "./working-order.js";

afterEach(() => yieldTurn());

let venue: BillVenue;
let offers: ZoneOffers;
let ids: {
  sweet: string;
  croqueta: string;
  burger: string;
  cheese: string;
  bacon: string;
  toppings: string;
  reasonId: string;
};

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    ids = await inTx(venue, async (tx) => {
      const [catalogue] = await tx
        .select({ id: locationCatalogues.catalogueId })
        .from(locationCatalogues)
        .where(eq(locationCatalogues.locationId, venue.cfg.locationId));
      const product = async (name: string, price: string) =>
        (
          await createProduct(tx, {
            catalogueId: catalogue!.id,
            categoryId: null,
            name,
            customerName: { [venue.cfg.locale]: `${name} (customer)` },
            kitchenName: name.toUpperCase(),
            pricingUnit: "each",
            unitPrice: price,
            vatClass: "reduced",
          })
        ).id;
      const sweet = await product("Sweet", "0.05");
      const croqueta = await product("Croqueta", "3.33");
      const burger = await product("Burger", "3.33");
      const cheese = await product("Cheese", "0.35");
      const bacon = await product("Bacon", "0.50");
      const toppings = (
        await createExtraList(
          tx,
          {
            name: "Toppings",
            customerName: null,
            kitchenName: null,
            minPicks: 0,
            maxPicks: null,
            active: true,
            items: [
              { productId: cheese, maxQuantity: 2, preselected: false, price: null },
              { productId: bacon, maxQuantity: 1, preselected: false, price: null },
            ],
          },
          venue.cfg.locale,
        )
      ).id;
      await writeProductModifiers(tx, burger, [{ kind: "extras", id: toppings }]);
      offers = await offerProducts(tx, venue.cfg, {
        zone: { zoneId: venue.zoneId },
        orderStart: "table",
      });
      const reasonId = (
        await createAdjustmentReason(tx, {
          name: "House",
          names: {},
          kind: "comp",
          actions: ["comp", "discount_percent", "discount_amount"],
          maxPercentBp: null,
          maxAmount: null,
          applyRoles: ["staff", "supervisor", "manager", "admin"],
          approverRoles: ["staff", "supervisor", "manager", "admin"],
          noteRequired: false,
        })
      ).id;
      return { sweet, croqueta, burger, cheese, bacon, toppings, reasonId };
    });
  },
});

const sweets = (quantity: string): TabRoundLine[] =>
  offers.toOfferLines([{ productId: ids.sweet, quantity }]);

const croquetas = (quantity: string): TabRoundLine[] =>
  offers.toOfferLines([{ productId: ids.croqueta, quantity }]);

const burgersWithCheese = (quantity: string): TabRoundLine[] =>
  offers.toOfferLines([
    {
      productId: ids.burger,
      quantity,
      extras: [{ listId: ids.toppings, picks: [{ productId: ids.cheese, quantity: 1 }] }],
    },
  ]);

function seed(lines: TabRoundLine[]) {
  return inTx(venue, (tx) => portionBill(tx, venue.cfg, venue.zoneId, lines));
}

async function payInCash(billId: string): Promise<void> {
  const total = await inTx(venue, (tx) => storedOrderTotal(tx, billId));
  const result = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: total,
      method: "cash",
      tendered: total,
      applied: total,
      tip: "0.00",
    },
  );
  expect(result.status, JSON.stringify(result.json)).toBe(200);
}

/** The bill's filed rows in line order, each with the portions linked to it. */
async function filedRows(billId: string) {
  return inTx(venue, async (tx) => {
    const rows = await tx
      .select({
        id: saleLines.id,
        name: saleLines.name,
        quantity: saleLines.quantity,
        base: saleLines.lineTotal,
        menuId: saleLines.menuId,
      })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(eq(sales.workingOrderId, billId))
      .orderBy(saleLines.lineNo);
    const links = await tx
      .select({ saleLineId: saleLinePortions.saleLineId, portionId: saleLinePortions.portionId })
      .from(saleLinePortions)
      .where(
        inArray(
          saleLinePortions.saleLineId,
          rows.map((row) => row.id),
        ),
      );
    return rows.map(({ id, ...row }) => ({
      ...row,
      portions: links
        .filter((link) => link.saleLineId === id)
        .map((link) => link.portionId)
        .sort(),
    }));
  });
}

function portionIdsOf(portions: readonly PortionRef[], cohortOf: PortionRef): string[] {
  return portions
    .filter((portion) => portion.pricingCohortId === cohortOf.pricingCohortId)
    .map((portion) => portion.portionId)
    .sort();
}

/** A card reader that captures what it is asked for; `charge: false` refuses to charge at all. */
function cardDeps(charge: boolean): IntegratedPayDeps {
  const fail = () => Promise.reject(new Error("cardDeps: not used"));
  const provider: PaymentProvider = {
    provider: "stripe",
    capabilities: { partialRefund: true },
    async collect(params) {
      if (!charge) throw new Error("cardDeps: this payment must not charge");
      const paymentRef = `pi-${randomUUID()}`;
      const settledAt = new Date();
      await withTransaction(venue.db, (tx) =>
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
    forward: fail,
    resolvePending: fail,
    void: fail,
    refund: fail,
    partialRefund: fail,
  };
  return { db: venue.db, backend: venue.backend, clock: venue.clock, provider, readerRef: "r1" };
}

/** The filed rows of a bill of two sweets as portions, each linked to both. */
function twoSweetsFiled(portions: readonly PortionRef[]) {
  return [
    {
      name: "Sweet",
      quantity: 2000,
      base: 9,
      menuId: offers.menuId,
      portions: portionIdsOf(portions, portions[0]!),
    },
  ];
}

describe("A803 portions: filing a bill of portions", () => {
  it("A803 portions: a bill of two bound €0.05 portions prices as one row of 2, and the stored readers agree", async () => {
    const { billId, portions } = await seed(sweets("2"));
    expect(portions).toHaveLength(2);

    await inTx(venue, async (tx) => {
      const stored = await readStoredOrder(tx, billId);
      const issuance = await priceStoredOrderForIssuance(tx, billId);
      for (const order of [stored, issuance]) {
        expect(order.gross.lines.map((line) => [line.name, line.quantity])).toEqual([
          ["Sweet", "2.000"],
        ]);
        expect(order.identities).toEqual([
          expect.objectContaining({
            id: portions[0]!.lineId,
            lineIds: portions.map((portion) => portion.lineId),
            portionIds: portions.map((portion) => portion.portionId),
          }),
        ]);
      }
      expect((await priceStoredOrder(tx, billId)).total).toBe("0.10");
      expect(await storedOrderTotal(tx, billId)).toBe("0.10");
    });
  });

  it("A803 portions: paying the bill files one row per cohort and links each dish and extra row to exactly its portions", async () => {
    const { billId, portions } = await seed([...burgersWithCheese("2"), ...sweets("2")]);
    const burger = portions[0]!;
    const sweet = portions[2]!;

    await payInCash(billId);

    // Two €0.05 at 10% are filed as one row of base 0.09; as two rows they would be 0.05 + 0.05.
    expect(await filedRows(billId)).toEqual([
      {
        name: "Burger",
        quantity: 2000,
        base: 605,
        menuId: offers.menuId,
        portions: portionIdsOf(portions, burger),
      },
      {
        name: "Cheese",
        quantity: 2000,
        base: 64,
        menuId: offers.menuId,
        portions: portionIdsOf(portions, burger),
      },
      {
        name: "Sweet",
        quantity: 2000,
        base: 9,
        menuId: offers.menuId,
        portions: portionIdsOf(portions, sweet),
      },
    ]);
  });

  it("A803 portions: issuing an unpaid invoice links its rows to their portions", async () => {
    const { billId, portions } = await seed(sweets("3"));

    await issueOrderInvoice(venue, venue.cfg, billId, venue.operatorId);

    expect(await filedRows(billId)).toEqual([
      {
        name: "Sweet",
        quantity: 3000,
        base: 14,
        menuId: offers.menuId,
        portions: portionIdsOf(portions, portions[0]!),
      },
    ]);
  });

  it("A803 portions: paying the whole bill at once links its rows to their portions", async () => {
    const { billId, portions } = await seed(sweets("2"));

    await payWorkingOrder(
      venue,
      venue.cfg,
      {
        id: billId,
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
        lines: [],
        tender: { method: "cash", amount: "0.10" },
      },
      venue.operatorId,
    );

    expect(await filedRows(billId)).toEqual(twoSweetsFiled(portions));
  });

  it("A803 portions: a card captured for the whole bill links its rows to their portions", async () => {
    const { billId, portions } = await seed(sweets("2"));

    const out = await payWorkingOrderIntegratedOrchestration(
      cardDeps(true),
      venue.cfg,
      {
        id: billId,
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
        lines: [],
      },
      venue.operatorId,
    );

    expect(out.outcome).toBe("captured");
    expect(await filedRows(billId)).toEqual(twoSweetsFiled(portions));
  });

  it("A803 portions: a card capture filed by recovery links its rows to their portions", async () => {
    const { billId, portions } = await seed(sweets("2"));
    await inTx(venue, (tx) =>
      insertCapturedPayment(tx, {
        origin: venue.cfg.origin,
        workingOrderId: billId,
        provider: "stripe",
        paymentRef: `pi-${randomUUID()}`,
        amount: decimal("0.10"),
        settledAt: new Date(),
        externalRef: `pi_lost_${randomUUID()}`,
      }),
    );

    const out = await payWorkingOrderIntegratedOrchestration(
      cardDeps(false),
      venue.cfg,
      {
        id: billId,
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
        lines: [],
      },
      venue.operatorId,
    );

    expect(out.outcome).toBe("captured");
    expect(await filedRows(billId)).toEqual(twoSweetsFiled(portions));
  });

  it("A803 portions: an unbound line files one row per line, as before", async () => {
    const billId = await inTx(venue, async (tx) => {
      const table = await createTable(tx, venue.cfg, {
        label: `U-${randomUUID().slice(0, 8)}`,
        zoneId: venue.zoneId,
      });
      const { tabId } = await openPartyTab(tx, venue.cfg, { tableId: table.id });
      for (let round = 0; round < 2; round++) {
        const priced = await priceTabRound(tx, venue.cfg, tabId, croquetas("1"), "checked");
        await insertTabRound(tx, venue.cfg, priced, priced.rows);
      }
      return tabId;
    });

    await payInCash(billId);

    expect(await filedRows(billId)).toEqual([
      { name: "Croqueta", quantity: 1000, base: 303, menuId: offers.menuId, portions: [] },
      { name: "Croqueta", quantity: 1000, base: 303, menuId: offers.menuId, portions: [] },
    ]);
  });

  it("A803 portions: a bound round and an unbound line of the same dish stay apart", async () => {
    const { billId, portions } = await seed(croquetas("2"));
    await inTx(venue, async (tx) => {
      const priced = await priceTabRound(tx, venue.cfg, billId, croquetas("1"), "checked");
      await insertTabRound(tx, venue.cfg, priced, priced.rows);
    });

    await payInCash(billId);

    expect(await filedRows(billId)).toEqual([
      {
        name: "Croqueta",
        quantity: 2000,
        base: 605,
        menuId: offers.menuId,
        portions: portionIdsOf(portions, portions[0]!),
      },
      { name: "Croqueta", quantity: 1000, base: 303, menuId: offers.menuId, portions: [] },
    ]);
  });

  it("A803 portions: two identically discounted portions print both adjustment entries under their one row", async () => {
    const { billId, portions } = await seed(sweets("1"));
    const burgers = await inTx(venue, (tx) =>
      addPortionRound(tx, venue.cfg, billId, burgersWithCheese("2")),
    );
    for (const portion of burgers) {
      await inTx(venue, async (tx) => {
        const [order] = await tx
          .select({ revision: workingOrders.revision })
          .from(workingOrders)
          .where(eq(workingOrders.id, billId));
        await applyAdjustment(
          tx,
          venue.cfg,
          {
            orderId: billId,
            expectedEdit: await readBillEditState(tx, billId),
            submissionId: randomUUID(),
            expectedRevision: order!.revision,
            lineId: portion.lineId,
            reasonId: ids.reasonId,
            action: "discount_amount",
            amount: decimal("0.10"),
            note: null,
            operatorId: venue.operatorId,
          },
          venue.cfg.locale,
        );
      });
    }

    const receipt = await inTx(venue, async (tx) => {
      const stored = await readStoredOrder(tx, billId);
      return receiptLines(tx, billId, stored.gross, stored.identities);
    });

    expect(
      receipt.lines.map((line) => [
        line.descriptions[venue.cfg.locale],
        line.quantity,
        line.adjustments ?? [],
      ]),
    ).toEqual([
      ["Sweet (customer)", "1", []],
      [
        "Burger (customer)",
        "2",
        [
          { kind: "discount", amount: "0.10" },
          { kind: "discount", amount: "0.10" },
        ],
      ],
      ["Cheese (customer)", "2", []],
    ]);
    expect(portions).toHaveLength(1);
  });

  it("A803 portions: an off-sale portion not yet sent refuses the issuance, though the first of its row was sent", async () => {
    const { billId, portions } = await seed(sweets("2"));
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ sentAt: new Date().toISOString() })
        .where(eq(workingOrderLines.id, portions[0]!.lineId)),
    );
    await inTx(venue, (tx) =>
      tx.update(products).set({ available: false }).where(eq(products.id, ids.sweet)),
    );
    try {
      await expect(
        issueOrderInvoice(venue, venue.cfg, billId, venue.operatorId),
      ).rejects.toMatchObject({ code: "product.unavailable" });
    } finally {
      await inTx(venue, (tx) =>
        tx.update(products).set({ available: true }).where(eq(products.id, ids.sweet)),
      );
    }
  });

  it("A803 portions: an order with no bound line keeps its stored row order, an extra after another dish included", async () => {
    const billId = await inTx(venue, async (tx) => {
      const table = await createTable(tx, venue.cfg, {
        label: `O-${randomUUID().slice(0, 8)}`,
        zoneId: venue.zoneId,
      });
      const { tabId } = await openPartyTab(tx, venue.cfg, { tableId: table.id });
      const priced = await priceTabRound(
        tx,
        venue.cfg,
        tabId,
        [...burgersWithCheese("1"), ...croquetas("1")],
        "checked",
      );
      // The cheese numbered after the croqueta, as an extra added to a sent dish is.
      const [burger, cheese, croqueta] = priced.rows;
      await insertTabRound(tx, venue.cfg, priced, [
        burger!,
        { ...croqueta!, lineNo: cheese!.lineNo },
        { ...cheese!, lineNo: croqueta!.lineNo },
      ]);
      return tabId;
    });

    const stored = await inTx(venue, (tx) => readStoredOrder(tx, billId));

    expect(stored.gross.lines.map((line) => [line.name, line.parentLineNo ?? null])).toEqual([
      ["Burger", null],
      ["Croqueta", null],
      ["Cheese", 1],
    ]);
    expect(stored.identities.every((identity) => identity.lineIds === undefined)).toBe(true);
  });

  it("A803 portions: a refused issuance leaves no sale and no link row", async () => {
    const { billId } = await seed(sweets("2"));
    const linksBefore = await inTx(venue, (tx) => tx.select().from(saleLinePortions));
    await inTx(venue, (tx) =>
      tx.update(products).set({ available: false }).where(eq(products.id, ids.sweet)),
    );
    try {
      await expect(
        issueOrderInvoice(venue, venue.cfg, billId, venue.operatorId),
      ).rejects.toMatchObject({ code: "product.unavailable" });
    } finally {
      await inTx(venue, (tx) =>
        tx.update(products).set({ available: true }).where(eq(products.id, ids.sweet)),
      );
    }

    expect(
      await inTx(venue, (tx) =>
        tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
      ),
    ).toEqual([]);
    expect(await inTx(venue, (tx) => tx.select().from(saleLinePortions))).toEqual(linksBefore);
  });
});

describe("A803 portion grouping: the dashboard's order detail", () => {
  const burgerWith = (cheeses: number, note?: string): TabRoundLine[] =>
    offers.toOfferLines([
      {
        productId: ids.burger,
        quantity: "1",
        ...(note === undefined ? {} : { note }),
        extras: [{ listId: ids.toppings, picks: [{ productId: ids.cheese, quantity: cheeses }] }],
      },
    ]);
  const detailLines = (billId: string) =>
    inTx(venue, async (tx) =>
      (await readOrderDetail(tx, billId, "all", false)).lines.map((line) => ({
        name: line.name,
        quantity: String(line.quantity),
        total: String(line.total),
      })),
    );

  it("A803 portion grouping: two identical portions show one row of 2 with the summed amount", async () => {
    const { billId } = await seed(burgersWithCheese("2"));

    expect(await detailLines(billId)).toEqual([
      { name: "Burger", quantity: "2.000", total: "6.66" },
      { name: "Cheese", quantity: "2.000", total: "0.70" },
    ]);
  });

  it("A803 portion grouping: different extras show apart, and an identical one joins the first", async () => {
    const { billId } = await seed([
      ...burgerWith(1),
      ...burgerWith(2),
      ...offers.toOfferLines([{ productId: ids.burger, quantity: "1" }]),
      ...burgerWith(1),
    ]);

    expect(await detailLines(billId)).toEqual([
      { name: "Burger", quantity: "2.000", total: "6.66" },
      { name: "Cheese", quantity: "2.000", total: "0.70" },
      { name: "Burger", quantity: "1.000", total: "3.33" },
      { name: "Cheese", quantity: "2.000", total: "0.70" },
      { name: "Burger", quantity: "1.000", total: "3.33" },
    ]);
  });

  it("A803 portion grouping: a note keeps a portion apart", async () => {
    const { billId } = await seed([...burgerWith(1), ...burgerWith(1, "no onion")]);

    expect(await detailLines(billId)).toEqual([
      { name: "Burger", quantity: "1.000", total: "3.33" },
      { name: "Cheese", quantity: "1.000", total: "0.35" },
      { name: "Burger", quantity: "1.000", total: "3.33" },
      { name: "Cheese", quantity: "1.000", total: "0.35" },
    ]);
  });

  it("A803 portion grouping: a discounted portion stays apart, and two discounted alike show one row, apart from one discounted otherwise", async () => {
    const { billId, portions } = await seed(croquetas("4"));
    for (const [portion, amount] of [
      [portions[1]!, "0.10"],
      [portions[2]!, "0.10"],
      [portions[3]!, "0.20"],
    ] as const) {
      await inTx(venue, async (tx) => {
        const [order] = await tx
          .select({ revision: workingOrders.revision })
          .from(workingOrders)
          .where(eq(workingOrders.id, billId));
        await applyAdjustment(
          tx,
          venue.cfg,
          {
            orderId: billId,
            expectedEdit: await readBillEditState(tx, billId),
            submissionId: randomUUID(),
            expectedRevision: order!.revision,
            lineId: portion.lineId,
            reasonId: ids.reasonId,
            action: "discount_amount",
            amount: decimal(amount),
            note: null,
            operatorId: venue.operatorId,
          },
          venue.cfg.locale,
        );
      });
    }

    const lines = await inTx(venue, async (tx) =>
      (await readOrderDetail(tx, billId, "all", false)).lines.map((line) => ({
        quantity: String(line.quantity),
        total: String(line.total),
        listUnitPrice: line.listUnitPrice === null ? null : String(line.listUnitPrice),
      })),
    );
    expect(lines).toEqual([
      { quantity: "1.000", total: "3.33", listUnitPrice: null },
      { quantity: "2.000", total: "6.46", listUnitPrice: "3.33" },
      { quantity: "1.000", total: "3.13", listUnitPrice: "3.33" },
    ]);
  });

  it("A803 portion grouping: two dishes of one price but different names show apart", async () => {
    const { billId } = await seed(
      offers.toOfferLines([
        { productId: ids.burger, quantity: "1" },
        { productId: ids.croqueta, quantity: "1" },
      ]),
    );

    expect(await detailLines(billId)).toEqual([
      { name: "Burger", quantity: "1.000", total: "3.33" },
      { name: "Croqueta", quantity: "1.000", total: "3.33" },
    ]);
  });

  const sauce = (label: string) => ({
    listName: { en: "Sauce" },
    listCustomerName: null,
    listKitchenName: null,
    labelName: { en: label },
    labelCustomerName: null,
    labelKitchenName: null,
  });
  const sauceKeysReversed = (label: string) => ({
    labelKitchenName: null,
    labelCustomerName: null,
    labelName: { en: label },
    listKitchenName: null,
    listCustomerName: null,
    listName: { en: "Sauce" },
  });

  it.each<[string, Partial<typeof workingOrderLines.$inferInsert>]>([
    ["list price", { listUnitPriceGross: 400 }],
    ["variant", { variantName: "Large" }],
    ["staff credited", { creditedTo: "0000ffff-2222-4000-8000-0000000000bb" }],
    ["answers", { optionSnapshots: [sauce("Aioli")] }],
    ["sending", { sentAt: "2026-10-28T08:00:00.000Z" }],
    ["serving", { servedAt: "2026-10-28T08:00:00.000Z" }],
    ["part served", { servedQuantity: 500 }],
  ])("A803 portion grouping: a portion whose %s differs stays apart", async (_, change) => {
    const { billId, portions } = await seed(croquetas("2"));
    await inTx(venue, (tx) =>
      tx.update(workingOrderLines).set(change).where(eq(workingOrderLines.id, portions[1]!.lineId)),
    );

    expect(await detailLines(billId)).toEqual([
      { name: "Croqueta", quantity: "1.000", total: "3.33" },
      { name: "Croqueta", quantity: "1.000", total: "3.33" },
    ]);
  });

  it("A803 portion grouping: the same answers in another order, keys in another order, still show one row", async () => {
    const { billId, portions } = await seed(croquetas("2"));
    await inTx(venue, async (tx) => {
      await tx
        .update(workingOrderLines)
        .set({ optionSnapshots: [sauce("Aioli"), sauce("Mojo")] })
        .where(eq(workingOrderLines.id, portions[0]!.lineId));
      await tx
        .update(workingOrderLines)
        .set({ optionSnapshots: [sauceKeysReversed("Mojo"), sauceKeysReversed("Aioli")] })
        .where(eq(workingOrderLines.id, portions[1]!.lineId));
    });

    expect(await detailLines(billId)).toEqual([
      { name: "Croqueta", quantity: "2.000", total: "6.66" },
    ]);
  });

  it("A803 portion grouping: the same extras stored in another order still show one row", async () => {
    const { billId, portions } = await seed(
      offers.toOfferLines([
        {
          productId: ids.burger,
          quantity: "2",
          extras: [
            {
              listId: ids.toppings,
              picks: [
                { productId: ids.cheese, quantity: 1 },
                { productId: ids.bacon, quantity: 1 },
              ],
            },
          ],
        },
      ]),
    );
    await inTx(venue, async (tx) => {
      const extras = await tx
        .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.parentLineId, portions[1]!.lineId))
        .orderBy(workingOrderLines.lineNo);
      expect(extras).toHaveLength(2);
      const [first, second] = extras as [(typeof extras)[0], (typeof extras)[0]];
      const set = (id: string, lineNo: number) =>
        tx.update(workingOrderLines).set({ lineNo }).where(eq(workingOrderLines.id, id));
      await set(first.id, 9999);
      await set(second.id, first.lineNo);
      await set(first.id, second.lineNo);
    });

    expect(await detailLines(billId)).toEqual([
      { name: "Burger", quantity: "2.000", total: "6.66" },
      { name: "Cheese", quantity: "2.000", total: "0.70" },
      { name: "Bacon", quantity: "2.000", total: "1.00" },
    ]);
  });

  it("A803 portion grouping: a portion in another course stays apart", async () => {
    const { billId, portions } = await seed(croquetas("2"));
    await inTx(venue, async (tx) => {
      const course = await createCourse(tx, venue.cfg, { name: "Starters", displayOrder: 90 });
      await tx
        .update(workingOrderLines)
        .set({ courseId: course.id })
        .where(eq(workingOrderLines.id, portions[1]!.lineId));
    });

    expect(await detailLines(billId)).toEqual([
      { name: "Croqueta", quantity: "1.000", total: "3.33" },
      { name: "Croqueta", quantity: "1.000", total: "3.33" },
    ]);
  });

  it("A803 portion grouping: measured portions stay apart", async () => {
    const { billId, portions } = await seed(croquetas("2"));
    await inTx(venue, async (tx) => {
      const cohortId = randomUUID();
      for (const [at, portion] of portions.entries()) {
        const [measured] = await tx
          .insert(orderPortions)
          .values({ cohortId, ordinal: at + 1, measured: true })
          .returning({ id: orderPortions.id });
        await tx
          .update(workingLinePortions)
          .set({ portionId: measured!.id })
          .where(eq(workingLinePortions.workingOrderLineId, portion.lineId));
      }
    });

    expect(await detailLines(billId)).toEqual([
      { name: "Croqueta", quantity: "1.000", total: "3.33" },
      { name: "Croqueta", quantity: "1.000", total: "3.33" },
    ]);
  });

  it("A803 portion grouping: identical unbound lines stay apart, as today", async () => {
    const billId = await inTx(venue, async (tx) => {
      const table = await createTable(tx, venue.cfg, {
        label: `D-${randomUUID().slice(0, 8)}`,
        zoneId: venue.zoneId,
      });
      const { tabId } = await openPartyTab(tx, venue.cfg, { tableId: table.id });
      for (let round = 0; round < 2; round++) {
        const priced = await priceTabRound(tx, venue.cfg, tabId, croquetas("1"), "checked");
        await insertTabRound(tx, venue.cfg, priced, priced.rows);
      }
      return tabId;
    });

    expect(await detailLines(billId)).toEqual([
      { name: "Croqueta", quantity: "1.000", total: "3.33" },
      { name: "Croqueta", quantity: "1.000", total: "3.33" },
    ]);
  });
});

describe("A803 portions: raising a dish", () => {
  /** A fresh party's bill holding `lines`: as portions, or (`bound: false`) as today's grouped
   * lines; `fire` sends them all. */
  async function billOf(lines: TabRoundLine[], opts: { bound: boolean; fire?: boolean }) {
    return inTx(venue, async (tx) => {
      const table = await createTable(tx, venue.cfg, {
        label: `R-${randomUUID().slice(0, 8)}`,
        zoneId: venue.zoneId,
      });
      const { tabId, partyId } = await openPartyTab(tx, venue.cfg, { tableId: table.id });
      let portions: PortionRef[] = [];
      if (opts.bound) {
        portions = await addPortionRound(tx, venue.cfg, tabId, lines, { fire: opts.fire });
      } else {
        const priced = await priceTabRound(tx, venue.cfg, tabId, lines, "checked");
        await insertTabRound(tx, venue.cfg, priced, priced.rows);
        if (opts.fire === true) await fireAll(tx, venue.cfg, tabId);
      }
      return { billId: tabId, partyId, portions };
    });
  }

  async function raise(billId: string, lineNo: number, quantity: string) {
    await inTx(venue, async (tx) =>
      updateOrderLine(
        tx,
        venue.cfg,
        billId,
        lineNo,
        { quantity },
        await readOrderRevision(tx, billId),
        { operatorId: venue.adminId, expectedEdit: await readBillEditState(tx, billId) },
      ),
    );
  }

  async function toCounter(billId: string, partyId: string) {
    await inTx(venue, async (tx) =>
      moveBill(
        tx,
        venue.cfg,
        billId,
        { counter: { zoneId: null } },
        {
          expectedEdits: [await readBillEditState(tx, billId)],
          bills: "separate",
          expectedPartyRevision: await partyRevision(tx, partyId),
          partyId,
          operatorId: venue.adminId,
        },
      ),
    );
  }

  /** Every line of the bill in line order, with the cohort and ordinal of the portion it holds. */
  function linesOf(billId: string) {
    return venue.db.all<{
      lineNo: number;
      name: string;
      quantity: number;
      lineTotal: number;
      dishNo: number | null;
      cohortId: string | null;
      ordinal: number | null;
      measured: number | null;
      creditedTo: string | null;
    }>(
      sql`select l.line_no as lineNo, l.name, l.quantity, l.line_total as lineTotal,
            d.line_no as dishNo, p.cohort_id as cohortId, p.ordinal, p.measured,
            l.credited_to as creditedTo
          from working_order_lines l
          left join working_order_lines d on d.id = l.parent_line_id
          left join working_line_portions b on b.working_order_line_id = l.id
          left join order_portions p on p.id = b.portion_id
          where l.working_order_id = ${billId}
          order by l.line_no`,
    );
  }

  /** The filed rows without their portion links, to compare a portion bill with today's. */
  async function filedFacts(billId: string) {
    return (await filedRows(billId)).map((row) => ({ ...row, portions: undefined }));
  }

  it("A803 portions: raising an unsent bound burger from 1 to 3 adds two portions of its cohort, and the bill files one row of 3", async () => {
    const bound = await billOf(burgersWithCheese("1"), { bound: true });
    const today = await billOf(burgersWithCheese("1"), { bound: false });
    const [first] = bound.portions;

    await raise(bound.billId, 1, "3");
    await raise(today.billId, 1, "3");

    const cohort = first!.pricingCohortId;
    expect(linesOf(bound.billId)).toEqual(
      [1, 2, 3].flatMap((ordinal) => [
        expect.objectContaining({
          lineNo: ordinal * 2 - 1,
          name: "Burger",
          quantity: 1000,
          lineTotal: 333,
          dishNo: null,
          cohortId: cohort,
          ordinal,
          measured: 0,
        }),
        expect.objectContaining({
          lineNo: ordinal * 2,
          name: "Cheese",
          quantity: 1000,
          lineTotal: 35,
          dishNo: ordinal * 2 - 1,
          cohortId: null,
        }),
      ]),
    );
    const credited = new Set(linesOf(bound.billId).map((line) => line.creditedTo));
    expect([...credited]).toEqual([linesOf(today.billId)[0]!.creditedTo]);

    await payInCash(bound.billId);
    await payInCash(today.billId);
    const filed = await filedRows(bound.billId);
    expect(filed.map(({ name, quantity }) => [name, quantity])).toEqual([
      ["Burger", 3000],
      ["Cheese", 3000],
    ]);
    expect(filed[0]!.portions).toHaveLength(3);
    expect(await filedFacts(bound.billId)).toEqual(await filedFacts(today.billId));
  });

  it("A803 portions: each added portion and its extra keep the sale context their originals were added with", async () => {
    const bound = await billOf(burgersWithCheese("1"), { bound: true });
    await raise(bound.billId, 1, "2");

    const contexts = venue.db.all<Record<string, unknown>>(
      sql`select c.* from working_line_contexts c
          join working_order_lines l on l.id = c.working_order_line_id
          where l.working_order_id = ${bound.billId} order by l.line_no`,
    );
    const facts = contexts.map((row) => ({ ...row, working_order_line_id: undefined }));
    expect(facts).toHaveLength(4);
    expect(facts[2]).toEqual(facts[0]);
    expect(facts[3]).toEqual(facts[1]);
  });

  it("A803 portions: raising a bound burger to 3 copies every copied line's sale context in one call", async () => {
    const bound = await billOf(burgersWithCheese("1"), { bound: true });
    const one = vi.spyOn(VENUE_SERVICE, "copyLineContext");
    const many = vi.spyOn(VENUE_SERVICE, "copyLineContexts");
    try {
      await raise(bound.billId, 1, "3");
      expect(one).not.toHaveBeenCalled();
      expect(many).toHaveBeenCalledTimes(1);
      expect(many.mock.calls[0]![2]).toHaveLength(4);
    } finally {
      one.mockRestore();
      many.mockRestore();
    }
  });

  it("A803 portions: raising a bound burger and adding bacon in one edit gives every portion its cheese and bacon", async () => {
    const lines = () => linesOf(bound.billId);
    const bound = await billOf(burgersWithCheese("1"), { bound: true });
    const today = await billOf(burgersWithCheese("1"), { bound: false });
    const withBacon = [
      {
        listId: ids.toppings,
        picks: [
          { productId: ids.cheese, quantity: 1 },
          { productId: ids.bacon, quantity: 1 },
        ],
      },
    ];
    for (const billId of [bound.billId, today.billId])
      await inTx(venue, async (tx) =>
        updateOrderLine(
          tx,
          venue.cfg,
          billId,
          1,
          { quantity: "2", extras: withBacon },
          await readOrderRevision(tx, billId),
          { operatorId: venue.adminId, expectedEdit: await readBillEditState(tx, billId) },
        ),
      );

    const dishes = lines().filter((line) => line.dishNo === null);
    expect(dishes.map((line) => [line.quantity, line.cohortId, line.ordinal])).toEqual([
      [1000, bound.portions[0]!.pricingCohortId, 1],
      [1000, bound.portions[0]!.pricingCohortId, 2],
    ]);
    for (const dish of dishes)
      expect(
        lines()
          .filter((line) => line.dishNo === dish.lineNo)
          .map((line) => [line.name, line.quantity])
          .sort(),
      ).toEqual([
        ["Bacon", 1000],
        ["Cheese", 1000],
      ]);

    await payInCash(bound.billId);
    await payInCash(today.billId);
    expect(await filedFacts(bound.billId)).toEqual(await filedFacts(today.billId));
  });

  it("A803 portions: raising a held bound burger gives each added portion its own held kitchen item", async () => {
    const bound = await billOf(burgersWithCheese("1"), { bound: true });
    await inTx(venue, async (tx) => {
      const dishes = await tx
        .select(fireableLineColumns)
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, bound.billId));
      await fireLines(
        tx,
        venue.cfg,
        bound.billId,
        dishes.map((line) => ({ ...line, hold: true })),
      );
    });

    await raise(bound.billId, 1, "3");

    const items = venue.db.all<{ lineNo: number; quantity: number; fired: number }>(
      sql`select l.line_no as lineNo, t.quantity, t.fired_at is not null as fired
          from ticket_items t join working_order_lines l on l.id = t.working_order_line_id
          where t.working_order_id = ${bound.billId} and l.parent_line_id is null
          order by l.line_no`,
    );
    expect(items).toEqual([
      { lineNo: 1, quantity: 1000, fired: 0 },
      { lineNo: 3, quantity: 1000, fired: 0 },
      { lineNo: 5, quantity: 1000, fired: 0 },
    ]);
  });

  it("A803 portions: every portion a held burger rises by carries its guest's allergy block, as the unbound raise's item does", async () => {
    const bound = await billOf(burgersWithCheese("1"), { bound: true });
    const today = await billOf(burgersWithCheese("1"), { bound: false });
    for (const { billId, partyId } of [bound, today])
      await inTx(venue, async (tx) => {
        const lines = await tx
          .select(fireableLineColumns)
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, billId));
        await fireLines(
          tx,
          venue.cfg,
          billId,
          lines.map((line) => ({ ...line, hold: true })),
        );
        await VENUE_SERVICE.writePartyAllergy(
          tx,
          partyId,
          {
            answer: "allergies",
            guests: [{ who: "Green coat", allergens: { milk: {} }, note: null }],
          },
          venue.adminId,
        );
        const { guests } = await VENUE_SERVICE.readPartyAllergy(tx, partyId);
        const dish = lines.find((line) => line.parentLineId === null)!;
        await VENUE_SERVICE.setAllergyLineTicks(tx, partyId, [
          { guestId: guests[0]!.id, draftLineId: null, workingLineId: dish.id },
        ]);
      });

    await raise(bound.billId, 1, "3");
    await raise(today.billId, 1, "3");

    /** Each dish's kitchen item in line order: its quantity and the allergy block it shows. */
    const dishItems = (billId: string) =>
      inTx(venue, async (tx) => {
        const items = await tx
          .select({ id: ticketItems.id, quantity: ticketItems.quantity })
          .from(ticketItems)
          .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
          .where(
            and(eq(ticketItems.workingOrderId, billId), isNull(workingOrderLines.parentLineId)),
          )
          .orderBy(workingOrderLines.lineNo);
        const blocks = await resolveKitchenAllergyBlocks(
          tx,
          venue.cfg,
          items.map((item) => item.id),
        );
        return items.map((item) => [item.quantity, blocks.get(item.id) ?? null] as const);
      });
    const [[quantity, block]] = await dishItems(today.billId);
    expect([quantity, block?.who]).toEqual([3000, "Green coat"]);
    expect(await dishItems(bound.billId)).toEqual([
      [1000, block],
      [1000, block],
      [1000, block],
    ]);
  });

  it("A803 portions: raising two portions of one cohort in one save numbers the added portions on, and files one row of 4", async () => {
    const bound = await billOf(burgersWithCheese("2"), { bound: true });
    const today = await billOf(burgersWithCheese("2"), { bound: false });
    const [first, second] = bound.portions;
    const revision = await inTx(venue, (tx) => readOrderRevision(tx, bound.billId));
    await updateHeldOrder({ db: venue.db }, venue.cfg, bound.billId, {
      operatorId: venue.adminId,
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, bound.billId)),
      revision,
      lines: [first!, second!].map((portion) => ({
        workingOrderLineId: portion.lineId,
        ...burgersWithCheese("2")[0]!,
      })),
    });
    await raise(today.billId, 1, "4");

    const dishes = linesOf(bound.billId).filter((line) => line.dishNo === null);
    expect(dishes.map((line) => [line.quantity, line.cohortId])).toEqual(
      [1, 2, 3, 4].map(() => [1000, first!.pricingCohortId]),
    );
    expect(dishes.map((line) => line.ordinal).sort()).toEqual([1, 2, 3, 4]);

    await payInCash(bound.billId);
    await payInCash(today.billId);
    expect((await filedRows(bound.billId)).map(({ name, quantity }) => [name, quantity])).toEqual([
      ["Burger", 4000],
      ["Cheese", 4000],
    ]);
    expect(await filedFacts(bound.billId)).toEqual(await filedFacts(today.billId));
  });

  it("A803 portions: a measured bound line rises in place and stays one portion", async () => {
    const bound = await billOf(croquetas("1"), { bound: true });
    await inTx(venue, async (tx) => {
      const [measured] = await tx
        .insert(orderPortions)
        .values({ cohortId: randomUUID(), ordinal: 1, measured: true })
        .returning({ id: orderPortions.id, cohortId: orderPortions.cohortId });
      await tx
        .update(workingLinePortions)
        .set({ portionId: measured!.id })
        .where(eq(workingLinePortions.workingOrderLineId, bound.portions[0]!.lineId));
    });

    await raise(bound.billId, 1, "3");

    expect(
      linesOf(bound.billId).map((line) => [line.quantity, line.ordinal, line.measured]),
    ).toEqual([[3000, 1, 1]]);
  });

  it("A803 portions: raising a fired bound burger adds a separately priced cohort, filed as today's second row", async () => {
    const bound = await billOf(burgersWithCheese("1"), { bound: true, fire: true });
    const today = await billOf(burgersWithCheese("1"), { bound: false, fire: true });
    const [first] = bound.portions;

    await raise(bound.billId, 1, "3");
    await raise(today.billId, 1, "3");

    const lines = linesOf(bound.billId);
    const dishes = lines.filter((line) => line.dishNo === null);
    expect(dishes.map((line) => [line.quantity, line.lineTotal])).toEqual([
      [1000, 333],
      [1000, 333],
      [1000, 333],
    ]);
    expect(dishes[0]!.cohortId).toBe(first!.pricingCohortId);
    expect(dishes[1]!.cohortId).not.toBe(first!.pricingCohortId);
    expect(dishes[2]!.cohortId).toBe(dishes[1]!.cohortId);
    expect(dishes.map((line) => line.ordinal)).toEqual([1, 1, 2]);
    expect(lines.filter((line) => line.dishNo !== null).map((line) => line.quantity)).toEqual([
      1000, 1000, 1000,
    ]);
    const items = venue.db.all<{ lineNo: number; quantity: number; fired: number }>(
      sql`select l.line_no as lineNo, t.quantity, t.fired_at is not null as fired
          from ticket_items t join working_order_lines l on l.id = t.working_order_line_id
          where t.working_order_id = ${bound.billId} and l.parent_line_id is null
          order by l.line_no`,
    );
    expect(items.map(({ quantity, fired }) => [quantity, fired])).toEqual([
      [1000, 1],
      [1000, 1],
      [1000, 1],
    ]);

    await payInCash(bound.billId);
    await payInCash(today.billId);
    expect((await filedRows(bound.billId)).map(({ name, quantity }) => [name, quantity])).toEqual([
      ["Burger", 1000],
      ["Cheese", 1000],
      ["Burger", 2000],
      ["Cheese", 2000],
    ]);
    expect(await filedFacts(bound.billId)).toEqual(await filedFacts(today.billId));
  });

  it("A803 portions: a bound line on a bill moved to the counter rises by new portions", async () => {
    const bound = await billOf(burgersWithCheese("1"), { bound: true });
    await toCounter(bound.billId, bound.partyId);

    await raise(bound.billId, 1, "2");

    const dishes = linesOf(bound.billId).filter((line) => line.dishNo === null);
    expect(dishes.map((line) => [line.quantity, line.cohortId, line.ordinal])).toEqual([
      [1000, bound.portions[0]!.pricingCohortId, 1],
      [1000, bound.portions[0]!.pricingCohortId, 2],
    ]);
  });

  it("A803 portions: an unbound counter line still rises in place", async () => {
    const today = await billOf(burgersWithCheese("1"), { bound: false });
    await toCounter(today.billId, today.partyId);

    await raise(today.billId, 1, "2");

    expect(
      linesOf(today.billId).map((line) => [
        line.name,
        line.quantity,
        line.lineTotal,
        line.cohortId,
      ]),
    ).toEqual([
      ["Burger", 2000, 666, null],
      ["Cheese", 2000, 70, null],
    ]);
  });
});
