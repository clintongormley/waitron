import { setImmediate as yieldTurn } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createAdjustmentReason } from "@waitron/adjustments";
import { createExtraList, createProduct, writeProductModifiers } from "@waitron/catalogue";
import {
  locationCatalogues,
  products,
  saleLinePortions,
  saleLines,
  sales,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { insertCapturedPayment, type PaymentProvider } from "@waitron/payments";
import { decimal } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
import { afterEach, describe, expect, it } from "vitest";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import type { PortionRef } from "./order-portions.js";
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
import { openPartyTab } from "./testing/serve-line.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import {
  insertTabRound,
  priceStoredOrder,
  priceStoredOrderForIssuance,
  priceTabRound,
  readStoredOrder,
  storedOrderTotal,
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
            items: [{ productId: cheese, maxQuantity: 2, preselected: false, price: null }],
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
      return { sweet, croqueta, burger, cheese, toppings, reasonId };
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
