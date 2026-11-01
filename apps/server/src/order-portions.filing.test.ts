import { testTradingAdmission } from "./testing/trading-admission.js";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { createAdjustmentReason } from "@waitron/adjustments";
import { createExtraList, createProduct, writeProductModifiers } from "@waitron/catalogue";
import {
  locationCatalogues,
  orderDraftRecalledLines,
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
import { cancelRefundShare, decimal } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { cancellationRefundValue } from "./cancellation-refund-value.js";
import { createCourse } from "./kitchen.js";
import { resolveKitchenAllergyBlocks } from "./kitchen-allergy.js";
import { VENUE_SERVICE } from "./modules.js";
import { moveBill } from "./move-bill.js";
import type { BillDraftSnapshot, Draft } from "./order-drafts.js";
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
  type UpdateHeldOrderRequest,
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
  return {
    admission: testTradingAdmission(),
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
    provider,
    readerRef: "r1",
  };
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

    await issueOrderInvoice(
      { ...venue, admission: testTradingAdmission() },
      venue.cfg,
      billId,
      venue.operatorId,
    );

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
      { ...venue, admission: testTradingAdmission() },
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
            admission: testTradingAdmission(),
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
          { kind: "discount", percentBp: 272, amount: "0.10" },
          { kind: "discount", percentBp: 272, amount: "0.10" },
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
        issueOrderInvoice(
          { ...venue, admission: testTradingAdmission() },
          venue.cfg,
          billId,
          venue.operatorId,
        ),
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
        issueOrderInvoice(
          { ...venue, admission: testTradingAdmission() },
          venue.cfg,
          billId,
          venue.operatorId,
        ),
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

describe("A803 portions: a cancel's refund value on a paid bill", () => {
  async function refundValueOf(billId: string, lineId: string) {
    return inTx(venue, async (tx) => {
      const [sale] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, billId));
      return cancellationRefundValue(tx, billId, sale!.id, lineId);
    });
  }

  it("A803 portions: each portion of a filed row of 2 is worth its own share of the row and of its extras", async () => {
    const { billId, portions } = await seed([...burgersWithCheese("2"), ...sweets("2")]);
    await payInCash(billId);

    expect(
      await Promise.all(portions.map((portion) => refundValueOf(billId, portion.lineId))),
    ).toEqual([
      { quantity: "1.000", gross: "3.68" },
      { quantity: "1.000", gross: "3.68" },
      { quantity: "1.000", gross: "0.05" },
      { quantity: "1.000", gross: "0.05" },
    ]);
  });

  it("A803 portions: an unbound line on a bill whose other rows stand for portions keeps its own row's value", async () => {
    const { billId, portions } = await seed(burgersWithCheese("2"));
    const unbound = await inTx(venue, async (tx) => {
      const priced = await priceTabRound(tx, venue.cfg, billId, sweets("1"), "checked");
      await insertTabRound(tx, venue.cfg, priced, priced.rows);
      return priced.rows[0]!.id!;
    });
    await payInCash(billId);

    expect(
      await Promise.all(
        [...portions.map((portion) => portion.lineId), unbound].map((lineId) =>
          refundValueOf(billId, lineId),
        ),
      ),
    ).toEqual([
      { quantity: "1.000", gross: "3.68" },
      { quantity: "1.000", gross: "3.68" },
      { quantity: "1.000", gross: "0.05" },
    ]);
  });

  it("A803 portions: a bound line whose portion no filed row stands for has no refund value", async () => {
    const { billId } = await seed(croquetas("1"));
    const unbound = await inTx(venue, async (tx) => {
      const priced = await priceTabRound(tx, venue.cfg, billId, sweets("1"), "checked");
      await insertTabRound(tx, venue.cfg, priced, priced.rows);
      return priced.rows[0]!.id!;
    });
    await payInCash(billId);
    await inTx(venue, async (tx) => {
      const portionId = randomUUID();
      await tx
        .insert(orderPortions)
        .values({ id: portionId, cohortId: randomUUID(), ordinal: 1, measured: false });
      await tx.insert(workingLinePortions).values({ workingOrderLineId: unbound, portionId });
    });

    expect(await refundValueOf(billId, unbound)).toBeUndefined();
  });

  it("A803 portions: a measured portion of 3 is worth its whole row, so a part cancel refunds its part", async () => {
    const billId = await inTx(venue, async (tx) => {
      const table = await createTable(tx, venue.cfg, {
        label: `M-${randomUUID().slice(0, 8)}`,
        zoneId: venue.zoneId,
      });
      const { tabId } = await openPartyTab(tx, venue.cfg, { tableId: table.id });
      const priced = await priceTabRound(tx, venue.cfg, tabId, croquetas("3"), "checked");
      await insertTabRound(tx, venue.cfg, priced, priced.rows);
      const [measured] = await tx
        .insert(orderPortions)
        .values({ cohortId: randomUUID(), ordinal: 1, measured: true })
        .returning({ id: orderPortions.id });
      await tx
        .insert(workingLinePortions)
        .values({ workingOrderLineId: priced.rows[0]!.id!, portionId: measured!.id });
      return tabId;
    });
    const [line] = await inTx(venue, (tx) =>
      tx.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, billId)),
    );
    await payInCash(billId);

    const value = await refundValueOf(billId, line!.id);
    expect(value).toEqual({ quantity: "3.000", gross: "9.99" });
    expect(cancelRefundShare(value!, "0", "1")).toBe("3.33");
  });

  it("A803 portions: after a whole-bill discount each portion is worth the price its own filed row gives it", async () => {
    const { billId, portions } = await seed(croquetas("3"));
    await inTx(venue, async (tx) => {
      const [order] = await tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, billId));
      await applyAdjustment(
        tx,
        venue.cfg,
        {
          admission: testTradingAdmission(),
          orderId: billId,
          expectedEdit: await readBillEditState(tx, billId),
          submissionId: randomUUID(),
          expectedRevision: order!.revision,
          lineId: null,
          reasonId: ids.reasonId,
          action: "discount_amount",
          amount: decimal("1.00"),
          note: null,
          operatorId: venue.operatorId,
        },
        venue.cfg.locale,
      );
    });
    await payInCash(billId);

    expect(
      await Promise.all(portions.map((portion) => refundValueOf(billId, portion.lineId))),
    ).toEqual([
      { quantity: "1.000", gross: "3.00" },
      { quantity: "1.000", gross: "3.00" },
      { quantity: "1.000", gross: "2.99" },
    ]);
  });

  it("A803 portions: a portion whose stored copy drifted from its filed rows has no refund value", async () => {
    const { billId, portions } = await seed([...burgersWithCheese("2"), ...burgersWithCheese("2")]);
    await payInCash(billId);
    const drift = (change: (tx: Parameters<Parameters<typeof inTx>[1]>[0]) => Promise<unknown>) =>
      inTx(venue, async (tx) => {
        // The stored copy drifting from the filed sale stands in for any line the sale cannot value.
        const names = [
          "working_order_lines_require_open_parent_update",
          "working_order_lines_require_open_parent_insert",
        ];
        const triggers = names.map(
          (name) =>
            tx.all<{ sql: string }>(
              sql`select sql from sqlite_master where type = 'trigger' and name = ${name}`,
            )[0]!.sql,
        );
        for (const name of names) tx.run(sql.raw(`drop trigger ${name}`));
        await change(tx);
        for (const trigger of triggers) tx.run(sql.raw(trigger));
      });
    const [cheese] = await inTx(venue, (tx) =>
      tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.parentLineId, portions[0]!.lineId)),
    );
    await drift((tx) =>
      tx
        .update(workingOrderLines)
        .set({ quantity: 2000 })
        .where(eq(workingOrderLines.id, cheese!.id)),
    );
    await drift((tx) =>
      tx
        .insert(workingOrderLines)
        .values({ ...cheese!, id: randomUUID(), lineNo: 99, parentLineId: portions[1]!.lineId }),
    );
    await drift((tx) =>
      tx
        .update(workingOrderLines)
        .set({ quantity: 2000 })
        .where(eq(workingOrderLines.id, portions[2]!.lineId)),
    );

    expect(
      await Promise.all(portions.map((portion) => refundValueOf(billId, portion.lineId))),
    ).toEqual([undefined, undefined, undefined, { quantity: "1.000", gross: "3.68" }]);
  });

  it("A803 portions: a portion whose filed row does not split into whole cents between its links has no refund value", async () => {
    const { billId, portions } = await seed(sweets("2"));
    await payInCash(billId);
    const stray = await seed(sweets("2"));
    await inTx(venue, async (tx) => {
      const [row] = await tx
        .select({ id: saleLinePortions.saleLineId })
        .from(saleLinePortions)
        .where(eq(saleLinePortions.portionId, portions[0]!.portionId));
      // 2.000 between four portions is 0.500 each; 0.10 is not a whole number of cents.
      await tx
        .insert(saleLinePortions)
        .values(
          stray.portions.map((portion) => ({ saleLineId: row!.id, portionId: portion.portionId })),
        );
    });

    expect(await refundValueOf(billId, portions[0]!.lineId)).toBeUndefined();
  });

  it("A803 portions: a comped row of 2 linked to a third portion has no refund value, though its €0.00 splits evenly", async () => {
    const { billId, portions } = await seed(sweets("2"));
    await inTx(venue, (tx) => addPortionRound(tx, venue.cfg, billId, croquetas("1")));
    for (const portion of portions)
      await inTx(venue, async (tx) => {
        const [order] = await tx
          .select({ revision: workingOrders.revision })
          .from(workingOrders)
          .where(eq(workingOrders.id, billId));
        await applyAdjustment(
          tx,
          venue.cfg,
          {
            admission: testTradingAdmission(),
            orderId: billId,
            expectedEdit: await readBillEditState(tx, billId),
            submissionId: randomUUID(),
            expectedRevision: order!.revision,
            lineId: portion.lineId,
            reasonId: ids.reasonId,
            action: "comp",
            note: null,
            operatorId: venue.operatorId,
          },
          venue.cfg.locale,
        );
      });
    await payInCash(billId);
    expect(await refundValueOf(billId, portions[0]!.lineId)).toEqual({
      quantity: "1.000",
      gross: "0.00",
    });
    const stray = await seed(sweets("1"));
    await inTx(venue, async (tx) => {
      const [row] = await tx
        .select({ id: saleLinePortions.saleLineId })
        .from(saleLinePortions)
        .where(eq(saleLinePortions.portionId, portions[0]!.portionId));
      await tx
        .insert(saleLinePortions)
        .values({ saleLineId: row!.id, portionId: stray.portions[0]!.portionId });
    });

    expect(await refundValueOf(billId, portions[0]!.lineId)).toBeUndefined();
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
            admission: testTradingAdmission(),
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
        {
          admission: testTradingAdmission(),
          operatorId: venue.adminId,
          expectedEdit: await readBillEditState(tx, billId),
        },
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
          {
            admission: testTradingAdmission(),
            operatorId: venue.adminId,
            expectedEdit: await readBillEditState(tx, billId),
          },
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
    await updateHeldOrder(
      { admission: testTradingAdmission(), db: venue.db },
      venue.cfg,
      bound.billId,
      {
        operatorId: venue.adminId,
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, bound.billId)),
        revision,
        lines: [first!, second!].map((portion) => ({
          workingOrderLineId: portion.lineId,
          ...burgersWithCheese("2")[0]!,
        })),
      },
    );
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

  /** Save the bill as `lines` say, the whole request being its new state. */
  async function saveLines(billId: string, lines: UpdateHeldOrderRequest["lines"]) {
    const [revision, expectedEdit] = await inTx(venue, async (tx) => [
      await readOrderRevision(tx, billId),
      await readBillEditState(tx, billId),
    ]);
    await updateHeldOrder({ admission: testTradingAdmission(), db: venue.db }, venue.cfg, billId, {
      operatorId: venue.adminId,
      expectedEdit,
      revision,
      lines,
    });
  }

  /** Each burger and its cheese as written, by name, size, price, cohort and ordinal. */
  const burgerLines = (billId: string) =>
    linesOf(billId)
      .filter((line) => line.name !== "Croqueta")
      .map(({ name, quantity, lineTotal, dishNo, cohortId, ordinal }) => ({
        name,
        quantity,
        lineTotal,
        dishNo,
        cohortId,
        ordinal,
      }));

  it("A803 portions: a new 2 × burger on a party bill is written as two portions", async () => {
    const bill = await billOf(croquetas("1"), { bound: true });
    const [croqueta] = bill.portions;

    await saveLines(bill.billId, [
      { workingOrderLineId: croqueta!.lineId, ...croquetas("1")[0]! },
      ...burgersWithCheese("2"),
    ]);

    const written = burgerLines(bill.billId);
    const cohort = written[0]!.cohortId;
    expect(cohort).not.toBeNull();
    expect(cohort).not.toBe(croqueta!.pricingCohortId);
    expect(written).toEqual([
      {
        name: "Burger",
        quantity: 1000,
        lineTotal: 333,
        dishNo: null,
        cohortId: cohort,
        ordinal: 1,
      },
      { name: "Cheese", quantity: 1000, lineTotal: 35, dishNo: 2, cohortId: null, ordinal: null },
      {
        name: "Burger",
        quantity: 1000,
        lineTotal: 333,
        dishNo: null,
        cohortId: cohort,
        ordinal: 2,
      },
      { name: "Cheese", quantity: 1000, lineTotal: 35, dishNo: 4, cohortId: null, ordinal: null },
    ]);

    await payInCash(bill.billId);
    expect((await filedRows(bill.billId)).map(({ name, quantity }) => [name, quantity])).toEqual([
      ["Croqueta", 1000],
      ["Burger", 2000],
      ["Cheese", 2000],
    ]);
  });

  it("A803 portions: each portion of a new line on a sent party bill gets its own kitchen item", async () => {
    const bill = await billOf(croquetas("1"), { bound: true, fire: true });
    const [croqueta] = bill.portions;

    await saveLines(bill.billId, [
      { workingOrderLineId: croqueta!.lineId, ...croquetas("1")[0]! },
      ...burgersWithCheese("3"),
    ]);

    const items = venue.db.all<{ name: string; quantity: number; dish: number }>(
      sql`select l.name, t.quantity, l.parent_line_id is null as dish
          from ticket_items t join working_order_lines l on l.id = t.working_order_line_id
          where t.working_order_id = ${bill.billId} and l.name = 'Burger'
          order by l.line_no`,
    );
    expect(items).toEqual([1, 2, 3].map(() => ({ name: "Burger", quantity: 1000, dish: 1 })));
  });

  it("A803 portions: a line whose product changed, on a party bill, is written as portions", async () => {
    const bill = await billOf(croquetas("1"), { bound: true });
    const [croqueta] = bill.portions;

    await saveLines(bill.billId, [
      { workingOrderLineId: croqueta!.lineId, ...burgersWithCheese("2")[0]! },
    ]);

    const written = linesOf(bill.billId);
    expect(written.map((line) => line.name)).toEqual(["Burger", "Cheese", "Burger", "Cheese"]);
    const dishes = written.filter((line) => line.dishNo === null);
    expect(dishes.map((line) => [line.quantity, line.ordinal])).toEqual([
      [1000, 1],
      [1000, 2],
    ]);
    expect(dishes[0]!.cohortId).not.toBeNull();
    expect(dishes[1]!.cohortId).toBe(dishes[0]!.cohortId);
    expect(dishes[0]!.cohortId).not.toBe(croqueta!.pricingCohortId);
  });

  it("A803 portions: a new line of 100 burgers on a party bill is refused and writes nothing", async () => {
    const bill = await billOf(croquetas("1"), { bound: true });
    const [croqueta] = bill.portions;
    const before = linesOf(bill.billId);

    await expect(
      saveLines(bill.billId, [
        { workingOrderLineId: croqueta!.lineId, ...croquetas("1")[0]! },
        ...burgersWithCheese("100"),
      ]),
    ).rejects.toMatchObject({ code: "tab.portions_too_many", params: { limit: 99 } });
    expect(linesOf(bill.billId)).toEqual(before);
  });

  it("A803 portions: a held-order save raising a sent portion by 100 is refused and writes nothing; by 99 it adds 99 portions", async () => {
    const bill = await billOf(croquetas("1"), { bound: true, fire: true });
    const [croqueta] = bill.portions;
    const before = linesOf(bill.billId);

    await expect(
      saveLines(bill.billId, [{ workingOrderLineId: croqueta!.lineId, ...croquetas("101")[0]! }]),
    ).rejects.toMatchObject({ code: "tab.portions_too_many", params: { limit: 99 } });
    expect(linesOf(bill.billId)).toEqual(before);

    await saveLines(bill.billId, [
      { workingOrderLineId: croqueta!.lineId, ...croquetas("100")[0]! },
    ]);
    const added = linesOf(bill.billId).filter((line) => line.lineNo !== before[0]!.lineNo);
    expect(added).toHaveLength(99);
    expect(added.every((line) => line.quantity === 1000 && line.cohortId !== null)).toBe(true);
    expect(new Set(added.map((line) => line.cohortId)).size).toBe(1);
    expect(added[0]!.cohortId).not.toBe(croqueta!.pricingCohortId);
  });

  it("A1208 portions: a new line on a counter order is written as portions", async () => {
    const bill = await billOf(croquetas("1"), { bound: false });
    await toCounter(bill.billId, bill.partyId);
    const [croqueta] = linesOf(bill.billId);
    const croquetaId = venue.db.all<{ id: string }>(
      sql`select id from working_order_lines
          where working_order_id = ${bill.billId} and line_no = ${croqueta!.lineNo}`,
    )[0]!.id;

    await saveLines(bill.billId, [
      { workingOrderLineId: croquetaId, ...croquetas("1")[0]! },
      ...burgersWithCheese("2"),
    ]);

    const burgers = burgerLines(bill.billId);
    const cohortId = burgers[0]!.cohortId;
    expect(cohortId).not.toBeNull();
    expect(burgers).toEqual([
      { name: "Burger", quantity: 1000, lineTotal: 333, dishNo: null, cohortId, ordinal: 1 },
      { name: "Cheese", quantity: 1000, lineTotal: 35, dishNo: 2, cohortId: null, ordinal: null },
      { name: "Burger", quantity: 1000, lineTotal: 333, dishNo: null, cohortId, ordinal: 2 },
      { name: "Cheese", quantity: 1000, lineTotal: 35, dishNo: 4, cohortId: null, ordinal: null },
    ]);
  });

  /** Recall `lineId` into this operator's draft on its bill. */
  async function recallLine(bill: { billId: string; partyId: string }, lineId: string) {
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${bill.partyId}/lines/${lineId}/recall`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: await inTx(venue, (tx) => partyRevision(tx, bill.partyId)),
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, bill.billId)),
      },
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    return (answer.json as unknown as { draft: Draft }).draft;
  }

  async function sendDraftLines(
    bill: { billId: string; partyId: string },
    draft: Draft,
    lines: Draft["lines"],
  ) {
    return send(venue.app, venue.cookie, "PUT", `/api/parties/${bill.partyId}/drafts`, {
      billId: bill.billId,
      draftId: draft.id,
      revision: draft.revision,
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, bill.billId)),
      lines,
      personId: venue.operatorId,
    });
  }

  async function saveDraftLines(
    bill: { billId: string; partyId: string },
    draft: Draft,
    lines: Draft["lines"],
  ) {
    const answer = await sendDraftLines(bill, draft, lines);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    return (answer.json as unknown as BillDraftSnapshot).draft!;
  }

  /** Recall the bill's first dish and save its draft line raised to `quantity`. */
  async function raiseRecalled(bill: { billId: string; partyId: string }, quantity: string) {
    const [dish] = linesOf(bill.billId);
    const [line] = await venue.db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, bill.billId),
          eq(workingOrderLines.lineNo, dish!.lineNo),
        ),
      );
    const draft = await recallLine(bill, line!.id);
    return saveDraftLines(bill, draft, [{ ...draft.lines[0]!, quantity }]);
  }

  async function submitAll(bill: { billId: string; partyId: string }, draft: Draft) {
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${bill.partyId}/drafts/${draft.id}/submit`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: await inTx(venue, (tx) => partyRevision(tx, bill.partyId)),
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, bill.billId)),
        draftRevision: draft.revision,
        groups: [{ release: "fire", lineIds: draft.lines.map((line) => line.id) }],
      },
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  }

  it("A803 portions: raising a recalled burger to 3 saves two reserved portions of its cohort", async () => {
    const bound = await billOf(burgersWithCheese("1"), { bound: true, fire: true });
    const cohort = bound.portions[0]!.pricingCohortId;

    const draft = await raiseRecalled(bound, "3");

    const lines = linesOf(bound.billId);
    expect(lines.map((line) => [line.name, line.quantity, line.lineTotal, line.ordinal])).toEqual(
      [1, 2, 3].flatMap((ordinal) => [
        ["Burger", 1000, 333, ordinal],
        ["Cheese", 1000, 35, null],
      ]),
    );
    expect(new Set(lines.flatMap((line) => line.cohortId ?? []))).toEqual(new Set([cohort]));
    const dishIds = await venue.db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, bound.billId),
          isNull(workingOrderLines.parentLineId),
        ),
      )
      .orderBy(workingOrderLines.lineNo);
    expect(draft.lines.map((line) => [line.sourceLineId, line.quantity])).toEqual(
      dishIds.map(({ id }) => [id, "1.000"]),
    );
    const reserved = await venue.db
      .select({ sourceLineId: orderDraftRecalledLines.sourceLineId })
      .from(orderDraftRecalledLines)
      .where(eq(orderDraftRecalledLines.draftId, draft.id));
    expect(reserved.map((row) => row.sourceLineId).sort()).toEqual(
      dishIds.map(({ id }) => id).sort(),
    );
    expect(
      await venue.db.select().from(ticketItems).where(eq(ticketItems.workingOrderId, bound.billId)),
    ).toEqual([]);
  });

  it("A803 portions: raising a recalled burger by 100 is refused 400 and saves nothing; by 99 is saved", async () => {
    const bound = await billOf(burgersWithCheese("1"), { bound: true, fire: true });
    const [dish] = linesOf(bound.billId);
    const [line] = await venue.db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, bound.billId),
          eq(workingOrderLines.lineNo, dish!.lineNo),
        ),
      );
    const draft = await recallLine(bound, line!.id);

    const refused = await sendDraftLines(bound, draft, [{ ...draft.lines[0]!, quantity: "101" }]);
    expect([refused.status, refused.json]).toMatchObject([
      400,
      { code: "tab.portions_too_many", params: { limit: 99 } },
    ]);
    expect(linesOf(bound.billId).filter((l) => l.name === "Burger")).toHaveLength(1);

    await saveDraftLines(bound, draft, [{ ...draft.lines[0]!, quantity: "100" }]);
    expect(linesOf(bound.billId).filter((l) => l.name === "Burger")).toHaveLength(100);
  });

  it("A803 portions: submitting places all three recalled portions in the chosen group", async () => {
    const bound = await billOf(burgersWithCheese("1"), { bound: true, fire: true });
    const draft = await raiseRecalled(bound, "3");

    await submitAll(bound, draft);

    const dishes = await venue.db
      .select({ id: workingOrderLines.id, groupId: workingOrderLines.groupId })
      .from(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, bound.billId),
          isNull(workingOrderLines.parentLineId),
        ),
      );
    expect(dishes).toHaveLength(3);
    expect(dishes[0]!.groupId).not.toBeNull();
    expect(new Set(dishes.map((dish) => dish.groupId)).size).toBe(1);
    const items = await venue.db
      .select({ lineId: ticketItems.workingOrderLineId, quantity: ticketItems.quantity })
      .from(ticketItems)
      .where(
        inArray(
          ticketItems.workingOrderLineId,
          dishes.map((dish) => dish.id),
        ),
      );
    expect(items.map((item) => item.quantity)).toEqual([1000, 1000, 1000]);
    expect(
      await venue.db
        .select()
        .from(orderDraftRecalledLines)
        .where(eq(orderDraftRecalledLines.draftId, draft.id)),
    ).toEqual([]);
  });

  it("A803 portions: discarding a raised recalled burger leaves what today's discard leaves", async () => {
    // Held, so cancelling needs no refund approval.
    const bound = await billOf(burgersWithCheese("1"), { bound: true });
    const today = await billOf(burgersWithCheese("1"), { bound: false });
    for (const { billId } of [bound, today])
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
      });
    const reasonId = await inTx(
      venue,
      async (tx) =>
        (
          await createAdjustmentReason(tx, {
            name: `Void-${randomUUID()}`,
            names: {},
            kind: "void",
            actions: ["cancel"],
            maxPercentBp: null,
            maxAmount: null,
            applyRoles: [],
            approverRoles: [],
            noteRequired: false,
          })
        ).id,
    );

    for (const bill of [bound, today]) {
      const draft = await raiseRecalled(bill, "3");
      const answer = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/parties/${bill.partyId}/drafts/${draft.id}/discard`,
        {
          submissionId: randomUUID(),
          revision: draft.revision,
          expectedRevision: await inTx(venue, (tx) => readOrderRevision(tx, bill.billId)),
          expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, bill.billId)),
          reasonId,
          note: null,
        },
      );
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    }

    expect(linesOf(today.billId)).toEqual([]);
    expect(linesOf(bound.billId)).toEqual([]);
    const cancelled = venue.db.all<{ kind: string }>(
      sql`select e.kind from order_portion_events e
          join order_portions p on p.id = e.portion_id
          where p.cohort_id = ${bound.portions[0]!.pricingCohortId}`,
    );
    expect(cancelled.map((event) => event.kind)).toEqual(["cancelled", "cancelled", "cancelled"]);
  });

  it("A803 portions: a raised recalled burger, sent again, files one row of 3 as today's does", async () => {
    const bound = await billOf(burgersWithCheese("1"), { bound: true, fire: true });
    const today = await billOf(burgersWithCheese("1"), { bound: false, fire: true });
    for (const bill of [bound, today]) await submitAll(bill, await raiseRecalled(bill, "3"));

    expect(linesOf(today.billId).map((line) => [line.name, line.quantity])).toEqual([
      ["Burger", 3000],
      ["Cheese", 3000],
    ]);
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

  it("A803 portions: each recalled copy keeps its original's sale context and guest tick, and saving the draft again adds nothing", async () => {
    const bound = await billOf(burgersWithCheese("1"), { bound: true, fire: true });
    const dishId = bound.portions[0]!.lineId;
    const guestId = await inTx(venue, async (tx) => {
      await VENUE_SERVICE.writePartyAllergy(
        tx,
        bound.partyId,
        {
          answer: "allergies",
          guests: [{ who: "Green coat", allergens: { milk: {} }, note: null }],
        },
        venue.adminId,
      );
      const { guests } = await VENUE_SERVICE.readPartyAllergy(tx, bound.partyId);
      await VENUE_SERVICE.setAllergyLineTicks(tx, bound.partyId, [
        { guestId: guests[0]!.id, draftLineId: null, workingLineId: dishId },
      ]);
      return guests[0]!.id;
    });

    const draft = await raiseRecalled(bound, "3");

    const contexts = venue.db.all<Record<string, unknown>>(
      sql`select c.* from working_line_contexts c
          join working_order_lines l on l.id = c.working_order_line_id
          where l.working_order_id = ${bound.billId} order by l.line_no`,
    );
    const facts = contexts.map((row) => ({ ...row, working_order_line_id: undefined }));
    expect(facts).toEqual([facts[0], facts[1], facts[0], facts[1], facts[0], facts[1]]);
    const { ticks } = await inTx(venue, (tx) => VENUE_SERVICE.readPartyAllergy(tx, bound.partyId));
    expect(
      draft.lines.map(
        (line) => ticks.find((tick) => tick.workingLineId === line.sourceLineId)?.guestId,
      ),
    ).toEqual([guestId, guestId, guestId]);

    const again = await saveDraftLines(bound, draft, draft.lines);
    expect(again.lines.map((line) => line.sourceLineId)).toEqual(
      draft.lines.map((line) => line.sourceLineId),
    );
    expect(linesOf(bound.billId)).toHaveLength(6);
  });

  it("A803 portions: a measured recalled portion rises in place and stays one portion", async () => {
    const bound = await billOf(croquetas("1"), { bound: true, fire: true });
    await inTx(venue, async (tx) => {
      const [measured] = await tx
        .insert(orderPortions)
        .values({ cohortId: randomUUID(), ordinal: 1, measured: true })
        .returning({ id: orderPortions.id });
      await tx
        .update(workingLinePortions)
        .set({ portionId: measured!.id })
        .where(eq(workingLinePortions.workingOrderLineId, bound.portions[0]!.lineId));
    });

    const draft = await raiseRecalled(bound, "3");

    expect(draft.lines.map((line) => line.quantity)).toEqual(["3.000"]);
    expect(
      linesOf(bound.billId).map((line) => [line.quantity, line.ordinal, line.measured]),
    ).toEqual([[3000, 1, 1]]);
  });

  it("A803 portions: raising two portions of one cohort, only the first ticked, ticks only the first one's copy", async () => {
    const bound = await billOf(burgersWithCheese("2"), { bound: true });
    const [first, second] = bound.portions;
    await inTx(venue, async (tx) => {
      await VENUE_SERVICE.writePartyAllergy(
        tx,
        bound.partyId,
        {
          answer: "allergies",
          guests: [{ who: "Green coat", allergens: { milk: {} }, note: null }],
        },
        venue.adminId,
      );
      const { guests } = await VENUE_SERVICE.readPartyAllergy(tx, bound.partyId);
      await VENUE_SERVICE.setAllergyLineTicks(tx, bound.partyId, [
        { guestId: guests[0]!.id, draftLineId: null, workingLineId: first!.lineId },
      ]);
    });
    await updateHeldOrder(
      { admission: testTradingAdmission(), db: venue.db },
      venue.cfg,
      bound.billId,
      {
        operatorId: venue.adminId,
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, bound.billId)),
        revision: await inTx(venue, (tx) => readOrderRevision(tx, bound.billId)),
        lines: [first!, second!].map((portion) => ({
          workingOrderLineId: portion.lineId,
          ...burgersWithCheese("2")[0]!,
        })),
      },
    );

    // The copies follow the dishes they copy, in the order the edit names them: lines 5 and 7.
    const ticked = venue.db.all<{ lineNo: number }>(
      sql`select l.line_no as lineNo from working_order_lines l
          join allergy_line_ticks t on t.working_line_id = l.id
          where l.working_order_id = ${bound.billId} order by l.line_no`,
    );
    expect(ticked.map((row) => row.lineNo)).toEqual([1, 5]);
  });

  /** What a refused draft save must leave untouched: the bill's lines, the draft's reserved rows
   * and its revision. */
  function draftState(billId: string, draftId: string) {
    return {
      lines: linesOf(billId),
      reserved: venue.db.all(
        sql`select id, source_line_id from order_draft_recalled_lines
            where draft_id = ${draftId} order by id`,
      ),
      revision: venue.db.all(sql`select revision from order_drafts where id = ${draftId}`),
    };
  }

  it("A803 portions: a save that keeps a raised burger's original but leaves out its copies is refused as out of date, writing nothing", async () => {
    const bound = await billOf(burgersWithCheese("1"), { bound: true, fire: true });
    const draft = await raiseRecalled(bound, "3");
    expect(draft.lines).toHaveLength(3);
    const before = draftState(bound.billId, draft.id);
    const edit = await inTx(venue, (tx) => readBillEditState(tx, bound.billId));

    const answer = await sendDraftLines(bound, draft, [{ ...draft.lines[0]!, quantity: "3" }]);

    expect(answer.status, JSON.stringify(answer.json)).toBe(409);
    expect(answer.json).toEqual({
      code: "draft.out_of_date",
      params: { billId: bound.billId, draftId: draft.id, revision: draft.revision, edit },
    });
    expect(draftState(bound.billId, draft.id)).toEqual(before);
  });

  it("A803 portions: a save leaving out a separately recalled dish is still refused as invalid lines", async () => {
    const today = await billOf([...burgersWithCheese("1"), ...croquetas("1")], {
      bound: false,
      fire: true,
    });
    const dishes = await venue.db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, today.billId),
          isNull(workingOrderLines.parentLineId),
        ),
      )
      .orderBy(workingOrderLines.lineNo);
    expect(dishes).toHaveLength(2);
    await recallLine(today, dishes[0]!.id);
    const draft = await recallLine(today, dishes[1]!.id);
    expect(draft.lines).toHaveLength(2);
    const before = draftState(today.billId, draft.id);

    const answer = await sendDraftLines(today, draft, [draft.lines[0]!]);

    expect(answer.status, JSON.stringify(answer.json)).toBe(400);
    expect(answer.json).toEqual({
      code: "management.request_invalid",
      params: { field: "lines" },
    });
    expect(draftState(today.billId, draft.id)).toEqual(before);
  });
});
