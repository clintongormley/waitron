import { setImmediate as yieldTurn } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { adjustmentLines, adjustments, createAdjustmentReason } from "@waitron/adjustments";
import { createExtraList, createProduct, writeProductModifiers } from "@waitron/catalogue";
import {
  billPaymentLines,
  locationCatalogues,
  orderPortionEvents,
  saleLinePortions,
  saleLines,
  sales,
  workingOrders,
} from "@waitron/db";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { insertCapturedPayment, type PaymentProvider } from "@waitron/payments";
import { decimal } from "@waitron/shared";
import { afterEach, describe, expect, it } from "vitest";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { takeBillPayment } from "./bill-payments.js";
import { carryLineReductions } from "./order-portions.js";
import { inTx, provisionBillVenue, type BillVenue } from "./testing/bill-venue.js";
import { createTable } from "./testing/live-table.js";
import { openTillSession } from "./testing/session-device.js";
import { REASONS } from "./testing/adjustment-venue.js";
import { openPartyTab } from "./testing/serve-line.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import {
  payWorkingOrder,
  payWorkingOrderIntegratedOrchestration,
  type IntegratedPayDeps,
} from "./till-sale.js";
import {
  createOpenOrder,
  parkOrder,
  readOrderRevision,
  updateHeldOrder,
  type TabRoundLine,
} from "./working-order.js";

afterEach(() => yieldTurn());

let venue: BillVenue;
let counter: ZoneOffers;
let ids: { croqueta: string; burger: string; cheese: string; toppings: string };

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
            customerName: null,
            kitchenName: null,
            pricingUnit: "each",
            unitPrice: price,
            vatClass: "reduced",
          })
        ).id;
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
      counter = await offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" });
      return { croqueta, burger, cheese, toppings };
    });
  },
});

const croquetas = (quantity: string): TabRoundLine[] =>
  counter.toOfferLines([{ productId: ids.croqueta, quantity }]);

const burgersWithCheese = (quantity: string): TabRoundLine[] =>
  counter.toOfferLines([
    {
      productId: ids.burger,
      quantity,
      extras: [{ listId: ids.toppings, picks: [{ productId: ids.cheese, quantity: 1 }] }],
    },
  ]);

/** The order's working lines in line order, each with the portion it is bound to. */
function linesOf(orderId: string) {
  return venue.db.all<{
    id: string;
    lineNo: number;
    name: string;
    quantity: number;
    lineTotal: number;
    parentLineId: string | null;
    portionId: string | null;
    cohortId: string | null;
    ordinal: number | null;
  }>(
    sql`select l.id, l.line_no as lineNo, l.name, l.quantity, l.line_total as lineTotal,
               l.parent_line_id as parentLineId, b.portion_id as portionId,
               p.cohort_id as cohortId, p.ordinal
        from working_order_lines l
        left join working_line_portions b on b.working_order_line_id = l.id
        left join order_portions p on p.id = b.portion_id
        where l.working_order_id = ${orderId} order by l.line_no`,
  );
}

/** The order's filed rows in line order, each with the portions linked to it. */
async function filedRows(orderId: string) {
  return inTx(venue, async (tx) => {
    const rows = await tx
      .select({
        id: saleLines.id,
        name: saleLines.name,
        quantity: saleLines.quantity,
        base: saleLines.lineTotal,
        vatRate: saleLines.vatRate,
      })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(eq(sales.workingOrderId, orderId))
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

function saleOf(orderId: string) {
  return venue.db.all<{ total: number; vatBreakdown: string }>(
    sql`select total, vat_breakdown as vatBreakdown from sales where working_order_id = ${orderId}`,
  );
}

async function walkUp(lines: TabRoundLine[], amount: string): Promise<string> {
  const id = randomUUID();
  await payWorkingOrder(
    venue,
    venue.cfg,
    { id, expectedEdit: null, lines, zoneId: counter.zoneId, tender: { method: "cash", amount } },
    venue.operatorId,
  );
  return id;
}

async function park(lines: TabRoundLine[]): Promise<{ id: string; orderNumber: number }> {
  return parkOrder({ db: venue.db }, venue.cfg, {
    id: randomUUID(),
    lines,
    zoneId: counter.zoneId,
    operatorId: venue.operatorId,
  });
}

async function payParked(id: string, amount: string): Promise<void> {
  await payWorkingOrder(
    venue,
    venue.cfg,
    {
      id,
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, id)),
      lines: [],
      tender: { method: "cash", amount },
    },
    venue.operatorId,
  );
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

const sorted = (values: (string | null)[]) => [...values].sort();

describe("A1208 counter orders are written as portions", () => {
  it("A1208 a walk-up of 2 × burger with cheese stores two portions of one cohort, each with its own cheese, and files one row of 2 linked to both", async () => {
    const id = await walkUp(burgersWithCheese("2"), "7.36");

    const lines = linesOf(id);
    expect(
      lines.map(({ name, quantity, lineTotal, ordinal }) => [name, quantity, lineTotal, ordinal]),
    ).toEqual([
      ["Burger", 1000, 333, 1],
      ["Cheese", 1000, 35, null],
      ["Burger", 1000, 333, 2],
      ["Cheese", 1000, 35, null],
    ]);
    const [burger1, cheese1, burger2, cheese2] = lines;
    expect(cheese1!.parentLineId).toBe(burger1!.id);
    expect(cheese2!.parentLineId).toBe(burger2!.id);
    expect(burger1!.cohortId).not.toBeNull();
    expect(burger2!.cohortId).toBe(burger1!.cohortId);
    expect(cheese1!.portionId).toBeNull();
    const portions = sorted([burger1!.portionId, burger2!.portionId]);
    expect(new Set(portions).size).toBe(2);

    expect(await filedRows(id)).toEqual([
      { name: "Burger", quantity: 2000, base: 605, vatRate: 1000, portions },
      { name: "Cheese", quantity: 2000, base: 64, vatRate: 1000, portions },
    ]);
    const [sale] = saleOf(id);
    expect(sale!.total).toBe(736);
    expect(JSON.parse(sale!.vatBreakdown)).toEqual([{ rate: "10.00", base: "6.69", tax: "0.67" }]);
  });

  it("A1208 the same dish on two request lines files two rows, as today", async () => {
    const id = await walkUp([...croquetas("1"), ...croquetas("1")], "6.66");

    const lines = linesOf(id);
    expect(lines.map(({ name, quantity, ordinal }) => [name, quantity, ordinal])).toEqual([
      ["Croqueta", 1000, 1],
      ["Croqueta", 1000, 1],
    ]);
    expect(lines[1]!.cohortId).not.toBe(lines[0]!.cohortId);
    expect(await filedRows(id)).toEqual([
      {
        name: "Croqueta",
        quantity: 1000,
        base: 303,
        vatRate: 1000,
        portions: [lines[0]!.portionId],
      },
      {
        name: "Croqueta",
        quantity: 1000,
        base: 303,
        vatRate: 1000,
        portions: [lines[1]!.portionId],
      },
    ]);
  });

  it("A1208 a walk-up paid by integrated card links its filed row to both portions", async () => {
    const id = randomUUID();
    const out = await payWorkingOrderIntegratedOrchestration(
      cardDeps(true),
      venue.cfg,
      { id, expectedEdit: null, lines: croquetas("2"), zoneId: counter.zoneId },
      venue.operatorId,
    );

    expect(out.outcome).toBe("captured");
    const lines = linesOf(id);
    expect(lines.map(({ quantity, ordinal }) => [quantity, ordinal])).toEqual([
      [1000, 1],
      [1000, 2],
    ]);
    expect(await filedRows(id)).toEqual([
      {
        name: "Croqueta",
        quantity: 2000,
        base: 605,
        vatRate: 1000,
        portions: sorted(lines.map((line) => line.portionId)),
      },
    ]);
  });

  it("A1208 100 of one dish on an integrated-card walk-up is refused before the reader is asked", async () => {
    const id = randomUUID();
    await expect(
      payWorkingOrderIntegratedOrchestration(
        cardDeps(false),
        venue.cfg,
        { id, expectedEdit: null, lines: croquetas("100"), zoneId: counter.zoneId },
        venue.operatorId,
      ),
    ).rejects.toMatchObject({ code: "tab.portions_too_many", params: { limit: 99 } });
    expect(await venue.db.select().from(workingOrders).where(eq(workingOrders.id, id))).toEqual([]);
  });

  it("A1208 a parked order's two portions pay as one row", async () => {
    const { id } = await park(croquetas("2"));
    const lines = linesOf(id);
    expect(lines.map(({ quantity, ordinal }) => [quantity, ordinal])).toEqual([
      [1000, 1],
      [1000, 2],
    ]);

    await payParked(id, "6.66");

    expect(await filedRows(id)).toEqual([
      {
        name: "Croqueta",
        quantity: 2000,
        base: 605,
        vatRate: 1000,
        portions: sorted(lines.map((line) => line.portionId)),
      },
    ]);
  });

  it("A1208 a new line saved onto a parked order is portions", async () => {
    const { id } = await park(croquetas("1"));
    const [croqueta] = linesOf(id);
    const [revision, expectedEdit] = await inTx(venue, async (tx) => [
      await readOrderRevision(tx, id),
      await readBillEditState(tx, id),
    ]);

    await updateHeldOrder({ db: venue.db }, venue.cfg, id, {
      operatorId: venue.operatorId,
      expectedEdit,
      revision,
      lines: [
        { workingOrderLineId: croqueta!.id, ...croquetas("1")[0]! },
        ...burgersWithCheese("3"),
      ],
    });

    const burgers = linesOf(id).filter((line) => line.name === "Burger");
    expect(burgers.map(({ quantity, ordinal }) => [quantity, ordinal])).toEqual([
      [1000, 1],
      [1000, 2],
      [1000, 3],
    ]);
    expect(new Set(burgers.map((line) => line.cohortId)).size).toBe(1);
    expect(burgers[0]!.cohortId).not.toBe(croqueta!.cohortId);
    expect(linesOf(id).filter((line) => line.name === "Cheese")).toHaveLength(3);
  });

  it("A1208 100 of one dish in one walk-up line is refused before anything is written", async () => {
    const before = await park(croquetas("1"));
    const id = randomUUID();

    await expect(
      payWorkingOrder(
        venue,
        venue.cfg,
        {
          id,
          expectedEdit: null,
          lines: croquetas("100"),
          zoneId: counter.zoneId,
          tender: { method: "cash", amount: "333.00" },
        },
        venue.operatorId,
      ),
    ).rejects.toMatchObject({ code: "tab.portions_too_many", params: { limit: 99 } });

    expect(await venue.db.select().from(workingOrders).where(eq(workingOrders.id, id))).toEqual([]);
    expect((await park(croquetas("1"))).orderNumber).toBe(before.orderNumber + 1);
  });

  it("A1208 the ceiling refusal still comes first", async () => {
    const id = randomUUID();
    await expect(
      inTx(venue, (tx) =>
        createOpenOrder(
          tx,
          { ...venue.cfg, simplifiedInvoiceLimit: decimal("3000.00") },
          id,
          croquetas("1000"),
          null,
          { zoneId: counter.zoneId },
        ),
      ),
    ).rejects.toMatchObject({ code: "sale.total_exceeds_simplified_limit" });
  });

  it("A1208 openTab with lines writes portions", async () => {
    const tabId = await inTx(venue, async (tx) => {
      const table = await createTable(tx, venue.cfg, {
        label: `M-${randomUUID().slice(0, 8)}`,
        zoneId: venue.zoneId,
      });
      return (
        await openPartyTab(tx, venue.cfg, {
          tableId: table.id,
          lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "2" }],
        })
      ).tabId;
    });

    const lines = linesOf(tabId);
    expect(lines.map(({ quantity, ordinal }) => [quantity, ordinal])).toEqual([
      [1000, 1],
      [1000, 2],
    ]);
    expect(lines[1]!.cohortId).toBe(lines[0]!.cohortId);
  });
});

/** `count` of a dish as request lines of at most 99, the most one line may hold. */
function linesOfAtMost99(count: number, of: (quantity: string) => TabRoundLine[]): TabRoundLine[] {
  const lines: TabRoundLine[] = [];
  for (let left = count; left > 0; left -= 99) lines.push(...of(String(Math.min(left, 99))));
  return lines;
}

// Node's own SQLite binds at most 32,766 values per statement; each case writes more than that to one table.
describe("A1208 a counter order of more portions than one statement can bind", () => {
  it("A1208 a walk-up of 815 burgers with cheese stores 1,630 lines and files every portion", async () => {
    const id = await walkUp(linesOfAtMost99(815, burgersWithCheese), "2999.20");

    const lines = linesOf(id);
    expect(lines).toHaveLength(1630);
    const burgers = lines.filter((line) => line.name === "Burger");
    expect(new Set(burgers.map((line) => line.portionId)).size).toBe(815);
    expect(burgers.every((line) => line.portionId !== null)).toBe(true);
    const filed = await filedRows(id);
    expect(filed).toHaveLength(18);
    expect(filed.filter((row) => row.name === "Burger").flatMap((row) => row.portions)).toEqual(
      expect.arrayContaining(burgers.map((line) => line.portionId)),
    );
    expect(filed.reduce((sum, row) => sum + row.portions.length, 0)).toBe(1630);
    expect(saleOf(id)[0]!.total).toBe(299920);
  });

  it("A1208 a parked order saved with 2,001 more croquetas stores each as its own portion", async () => {
    const { id } = await park(croquetas("1"));
    const [croqueta] = linesOf(id);
    const [revision, expectedEdit] = await inTx(venue, async (tx) => [
      await readOrderRevision(tx, id),
      await readBillEditState(tx, id),
    ]);

    await updateHeldOrder({ db: venue.db }, venue.cfg, id, {
      operatorId: venue.operatorId,
      expectedEdit,
      revision,
      lines: [
        { workingOrderLineId: croqueta!.id, ...croquetas("1")[0]! },
        ...linesOfAtMost99(2001, croquetas),
      ],
    });

    const lines = linesOf(id);
    expect(lines).toHaveLength(2002);
    expect(new Set(lines.map((line) => line.portionId)).size).toBe(2002);
    expect(lines.every((line) => line.portionId !== null && line.quantity === 1000)).toBe(true);
  });

  it("A1208 a parked order of 17 croquetas each raised to 99 copies every sale context", async () => {
    const { id } = await park(croquetas("17"));
    const stored = linesOf(id);
    const [revision, expectedEdit] = await inTx(venue, async (tx) => [
      await readOrderRevision(tx, id),
      await readBillEditState(tx, id),
    ]);

    await updateHeldOrder({ db: venue.db }, venue.cfg, id, {
      operatorId: venue.operatorId,
      expectedEdit,
      revision,
      lines: stored.map((line) => ({ workingOrderLineId: line.id, ...croquetas("99")[0]! })),
    });

    const lines = linesOf(id);
    expect(lines).toHaveLength(17 * 99);
    expect(new Set(lines.map((line) => line.portionId)).size).toBe(17 * 99);
    const [contexts] = venue.db.all<{ count: number }>(
      sql`select count(*) as count from working_line_contexts c
          join working_order_lines l on l.id = c.working_order_line_id
          where l.working_order_id = ${id}`,
    );
    expect(contexts!.count).toBe(17 * 99);
  });

  it("A1208 a parked order of 4,700 croquetas saved down to one records a cancellation for each other", async () => {
    const { id } = await park(linesOfAtMost99(4700, croquetas));
    const [kept, ...removed] = linesOf(id);
    const [revision, expectedEdit] = await inTx(venue, async (tx) => [
      await readOrderRevision(tx, id),
      await readBillEditState(tx, id),
    ]);

    await updateHeldOrder({ db: venue.db }, venue.cfg, id, {
      operatorId: venue.operatorId,
      expectedEdit,
      revision,
      lines: [{ workingOrderLineId: kept!.id, ...croquetas("1")[0]! }],
    });

    expect(linesOf(id).map((line) => line.id)).toEqual([kept!.id]);
    const cancelled = await venue.db
      .select({ portionId: orderPortionEvents.portionId })
      .from(orderPortionEvents)
      .where(eq(orderPortionEvents.fromOrderId, id));
    expect(cancelled.map((event) => event.portionId).sort()).toEqual(
      sorted(removed.map((line) => line.portionId)),
    );
  });

  it("A1208 paying for 3,277 of 3,278 burgers with cheese records a payment line for each burger and each cheese", async () => {
    const { id } = await park(linesOfAtMost99(3278, burgersWithCheese));
    const burgers = linesOf(id).filter((line) => line.name === "Burger");
    expect(burgers).toHaveLength(3278);
    const paidFor = burgers.slice(0, 3277);
    const sessionId = await openTillSession(venue.db, {
      deviceId: venue.cfg.origin.deviceId,
      personId: venue.operatorId,
    });

    const { payment } = await takeBillPayment(
      { db: venue.db, backend: venue.backend, clock: venue.clock },
      venue.cfg,
      id,
      {
        submissionId: randomUUID(),
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, id)),
        kind: "items",
        lines: paidFor.map((line) => ({ lineNo: line.lineNo })),
        method: "cash",
        tendered: "12059.36",
        applied: "12059.36",
        tip: "0.00",
      },
      { personId: venue.operatorId, sessionId },
    );

    const recorded = await venue.db
      .select({ lineId: billPaymentLines.lineId })
      .from(billPaymentLines)
      .where(eq(billPaymentLines.billPaymentId, payment.id));
    expect(recorded).toHaveLength(6554);
    const cheeses = linesOf(id).filter((line) => line.name === "Cheese");
    const paidIds = new Set(paidFor.map((line) => line.id));
    const expected = [
      ...paidFor.map((line) => line.id),
      ...cheeses.filter((line) => paidIds.has(line.parentLineId!)).map((line) => line.id),
    ];
    expect(sorted(recorded.map((row) => row.lineId))).toEqual(sorted(expected));
  });

  it("A1208 half off the whole of 3,277 burgers with cheese records what it took off each burger and each cheese", async () => {
    const { id } = await park(linesOfAtMost99(3277, burgersWithCheese));
    const reasonId = await inTx(
      venue,
      async (tx) => (await createAdjustmentReason(tx, REASONS.house)).id,
    );

    const { adjustmentIds } = await inTx(venue, async (tx) =>
      applyAdjustment(
        tx,
        venue.cfg,
        {
          submissionId: randomUUID(),
          expectedEdit: await readBillEditState(tx, id),
          orderId: id,
          expectedRevision: await readOrderRevision(tx, id),
          lineId: null,
          reasonId,
          action: "discount_percent",
          percentBp: 5000,
          note: null,
          operatorId: venue.operatorId,
        },
        venue.cfg.locale,
      ),
    );

    const recorded = await venue.db
      .select({ lineId: adjustmentLines.lineId })
      .from(adjustmentLines)
      .where(inArray(adjustmentLines.adjustmentId, adjustmentIds));
    expect(sorted(recorded.map((row) => row.lineId))).toEqual(
      sorted(linesOf(id).map((line) => line.id)),
    );
  });

  it("A1208 carryLineReductions gives each of 6,554 copies the reduction its line carries", async () => {
    const { id } = await park(croquetas("1"));
    const [croqueta] = linesOf(id);
    const copies = Array.from({ length: 6554 }, () => ({ from: croqueta!.id, to: randomUUID() }));

    const adjustmentId = await inTx(venue, async (tx) => {
      const [adjustment] = await tx
        .insert(adjustments)
        .values({
          workingOrderId: id,
          splits: [],
          reasonId: randomUUID(),
          reasonName: "Regular",
          policySnapshot: {
            kind: "comp",
            actions: ["discount_amount"],
            maxPercentBp: null,
            maxAmount: null,
            applyRoles: [],
            approverRoles: [],
            noteRequired: false,
          },
          action: "discount_amount",
          beforeAmount: 333,
          afterAmount: 300,
          reduction: 33,
          nominalValue: 333,
          requestedBy: venue.operatorId,
        })
        .returning({ id: adjustments.id });
      await tx.insert(adjustmentLines).values({
        adjustmentId: adjustment!.id,
        lineId: croqueta!.id,
        reduction: 33,
        quantity: 1000,
      });
      await carryLineReductions(tx, copies);
      return adjustment!.id;
    });

    const carried = await venue.db
      .select({
        lineId: adjustmentLines.lineId,
        reduction: adjustmentLines.reduction,
        quantity: adjustmentLines.quantity,
      })
      .from(adjustmentLines)
      .where(eq(adjustmentLines.adjustmentId, adjustmentId));
    expect(carried).toHaveLength(6555);
    expect(new Set(carried.map((row) => row.lineId))).toEqual(
      new Set([croqueta!.id, ...copies.map((copy) => copy.to)]),
    );
    expect(carried.every((row) => row.reduction === 33 && row.quantity === 1000)).toBe(true);
  });
});
