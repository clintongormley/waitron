import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { adjustments } from "@waitron/adjustments";
import {
  departments,
  parties,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { currentBusinessDay, periodDays, resolveVenueClock } from "@waitron/reporting";
import { createDepartment } from "@waitron/venue-service";
import { decimal, type AdjustmentAction } from "@waitron/shared";
import { applyAdjustment, type AdjustmentArgs } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { estimatedCost, listFreeItems, type FreeItem } from "./free-items.js";
import { cancelItem } from "./line-cancel.js";
import { splitBill } from "./testing/bill-action-fixture.js";
import { paySavedBillInCash } from "./testing/bill-payment-fixture.js";
import { cancelReasonId, ensureOperator, observedCancelItem } from "./testing/cancel-line.js";
import {
  billWith,
  inTx,
  lineIdOf,
  provisionAdjustmentVenue,
  rowsOf,
  todayLine,
  type AdjustmentVenue,
  type RoundLine,
} from "./testing/adjustment-venue.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { moveLinesToGroup } from "./order-groups.js";
import { partyRevision } from "./parties.js";
import { serveLine } from "./testing/serve-line.js";
import { openTillSession } from "./testing/session-device.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import "./errors.js";

// The Given free sheet's rows (plan Design, D3, D10, D11, D14) over bills made through the till's
// own writers, in a provisioned venue that files real Veri*Factu records.
let venue: AdjustmentVenue;
let departmentId: string;
let departmentName: string;
let today: { year: number; month: number };

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
    const bill = await billWith(venue, []);
    const read = await inTx(venue, async (tx) => {
      const [row] = await tx
        .select({ id: departments.id, name: departments.name })
        .from(workingOrders)
        .innerJoin(departments, eq(departments.id, workingOrders.departmentId))
        .where(eq(workingOrders.id, bill.billId));
      return { row: row!, day: currentBusinessDay(await resolveVenueClock(tx, venue.cfg.nodeId)) };
    });
    departmentId = read.row.id;
    departmentName = read.row.name;
    today = { year: Number(read.day.slice(0, 4)), month: Number(read.day.slice(5, 7)) };
  },
});

type Ask = Partial<Omit<AdjustmentArgs, "amount">> & { action: AdjustmentAction; amount?: string };

async function adjust(billId: string, ask: Ask) {
  return inTx(venue, async (tx) => {
    const [order] = await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId));
    const { amount, ...rest } = ask;
    return applyAdjustment(
      tx,
      venue.cfg,
      {
        orderId: billId,
        expectedEdit: await readBillEditState(tx, billId),
        submissionId: randomUUID(),
        expectedRevision: order!.revision,
        lineId: null,
        reasonId: venue.reasonId.house,
        note: null,
        operatorId: venue.staffId,
        admission: testTradingAdmission(),
        ...rest,
        ...(amount === undefined ? {} : { amount: decimal(amount) }),
      },
      venue.venueLocale,
    );
  });
}

/** Cancels all of line `lineNo`, its charge removed or kept. */
async function cancel(billId: string, lineNo: number, outcome: "remove_charge" | "keep_charge") {
  return inTx(venue, async (tx: Transaction) => {
    const { target, lineId, body } = await observedCancelItem(tx, billId, lineNo);
    return cancelItem(
      tx,
      venue.cfg,
      target,
      lineId,
      {
        ...body,
        outcome,
        // Keeping the charge needs the kitchen to have started the dish.
        preparationStarted: outcome === "keep_charge",
        reasonId: await cancelReasonId(tx),
        admission: testTradingAdmission(),
      },
      await ensureOperator(tx, venue.supervisorId),
    );
  });
}

/** Pays what is left on the bill in cash, issuing its invoice; answers its formatted number. */
async function pay(billId: string): Promise<string> {
  const sessionId = await openTillSession(venue.db, {
    deviceId: venue.cfg.origin.deviceId,
    personId: venue.staffId,
  });
  const invoice = await paySavedBillInCash(
    { admission: testTradingAdmission(), db: venue.db, backend: venue.backend, clock: venue.clock },
    venue.cfg,
    { personId: venue.staffId, sessionId },
    billId,
    "1000.00",
  );
  return invoice.invoiceNumber;
}

const bill = (lines: RoundLine[], opts?: Parameters<typeof billWith>[2]) =>
  billWith(venue, lines, opts);

function recordedOn(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ id: adjustments.id, action: adjustments.action })
      .from(adjustments)
      .where(eq(adjustments.workingOrderId, billId))
      .orderBy(asc(adjustments.createdAt), asc(adjustments.id)),
  );
}

function listed(period = { year: today.year, month: today.month }) {
  return inTx(venue, async (tx) =>
    listFreeItems(tx, await resolveVenueClock(tx, venue.cfg.nodeId), {
      year: period.year,
      period: { kind: "month", month: period.month },
    }),
  );
}

/** The free rows the adjustments recorded on `billIds` give, as plain strings. */
async function freeOn(...billIds: string[]) {
  const ids = new Set<string>();
  for (const id of billIds) for (const row of await recordedOn(id)) ids.add(row.id);
  return (await listed())
    .filter((row) => ids.has(row.adjustmentId))
    .map(({ adjustmentId, ...row }) => {
      void adjustmentId;
      return row;
    });
}

function setMargin(id: string, marginBp: number | null) {
  return inTx(venue, (tx) =>
    tx.update(departments).set({ estimatedMarginBp: marginBp }).where(eq(departments.id, id)),
  );
}

/** Reprices line `lineNo` of an open bill as one portion of `price` in `vatClass`. */
function reprice(billId: string, lineNo: number, price: number, vatClass: string) {
  return inTx(venue, (tx) =>
    tx
      .update(workingOrderLines)
      .set({ unitPriceGross: price, lineTotal: price, vatClass, takeawayVatClass: vatClass })
      .where(
        sql`${workingOrderLines.workingOrderId} = ${billId} and ${workingOrderLines.lineNo} = ${lineNo}`,
      ),
  );
}

function row(overrides: Partial<FreeItem>): Omit<FreeItem, "adjustmentId"> {
  return {
    date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown as string,
    invoice: null,
    item: "Burger",
    quantity: decimal("1.000"),
    kind: "comp",
    department: departmentName,
    menuPrice: decimal("12.00"),
    amountTakenOff: decimal("12.00"),
    estimatedCost: null,
    // The reason as recorded, in the language of the till that applied it (es-ES).
    reason: "Casa",
    note: null,
    ...overrides,
  };
}

const number = (formatted: string) => {
  const [seriesCode, digits] = formatted.split("/") as [string, string];
  return { seriesCode, number: Number(digits) };
};

describe("which adjustment a free row stands for", () => {
  it("names, for a comp of part of a line, the line before the comp, and the comped part only in its splits", async () => {
    const { billId } = await bill([{ name: "Burger", quantity: "3" }], { shape: "grouped" });
    const line = await lineIdOf(venue, billId, 1);
    await adjust(billId, { lineId: line, action: "comp", quantity: "1" });
    const comped = await lineIdOf(venue, billId, 2);
    const [recorded] = await inTx(venue, (tx) =>
      tx
        .select({ lineId: adjustments.lineId, splits: adjustments.splits })
        .from(adjustments)
        .where(eq(adjustments.workingOrderId, billId)),
    );
    expect(recorded).toEqual({ lineId: line, splits: [{ from: line, to: comped }] });
    // The part not comped cancelled away, the comped one is still listed.
    await cancel(billId, 1, "remove_charge");
    expect(await freeOn(billId)).toEqual([row({})]);
  });

  it("leaves out a comp of part of a line once the comped part is taken off, the rest still there", async () => {
    const { billId } = await bill([{ name: "Burger", quantity: "3" }], { shape: "grouped" });
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "comp",
      quantity: "1",
    });
    await cancel(billId, 2, "remove_charge");
    expect(
      (
        await inTx(venue, (tx) =>
          tx.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, billId)),
        )
      ).length,
    ).toBe(1);
    expect(await freeOn(billId)).toEqual([]);
  });

  it("lists a comp of one of a row's portions, which its splits name", async () => {
    const { billId } = await bill([{ name: "Burger", quantity: "3" }]);
    const target = await todayLine(venue, billId, 1);
    await adjust(billId, { ...target, action: "comp", quantity: "1" });
    const comped = await lineIdOf(venue, billId, 3);
    const [recorded] = await inTx(venue, (tx) =>
      tx
        .select({ lineId: adjustments.lineId, splits: adjustments.splits })
        .from(adjustments)
        .where(eq(adjustments.workingOrderId, billId)),
    );
    expect(recorded).toEqual({
      lineId: target.lineId,
      splits: [{ from: target.lineId, to: comped }],
    });
    expect(await freeOn(billId)).toEqual([row({})]);
  });

  it("lists a comp of a dish's three portions while two of them stay on the bill", async () => {
    const { billId } = await bill([{ name: "Burger", quantity: "3" }]);
    await adjust(billId, { ...(await todayLine(venue, billId, 1)), action: "comp" });
    await cancel(billId, 1, "remove_charge");
    expect(
      (await rowsOf(venue, billId)).map(({ quantity, lineTotal }) => [quantity, lineTotal]),
    ).toEqual([
      ["1.000", "0.00"],
      ["1.000", "0.00"],
    ]);
    expect(await freeOn(billId)).toEqual([
      row({
        quantity: decimal("3.000"),
        menuPrice: decimal("36.00"),
        amountTakenOff: decimal("36.00"),
      }),
    ]);
  });

  it("lists a comp of a grouped line still on the bill after a cut moved part of it to a new course", async () => {
    const { partyId, billId } = await bill([{ name: "Burger", quantity: "3" }], {
      shape: "grouped",
      release: "hold",
    });
    const line = await lineIdOf(venue, billId, 1);
    await adjust(billId, { lineId: line, action: "comp" });
    await inTx(venue, async (tx) =>
      moveLinesToGroup(tx, venue.cfg, partyId, [{ lineId: line, quantity: "1.000" }], "new", {
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(tx, partyId),
        operatorId: venue.staffId,
        expectedEdits: [await readBillEditState(tx, billId)],
      }),
    );
    await cancel(billId, 1, "remove_charge");
    expect(
      (await rowsOf(venue, billId)).map(({ id, quantity, lineTotal }) => [
        id === line,
        quantity,
        lineTotal,
      ]),
    ).toEqual([[false, "1.000", "0.00"]]);
    expect(await freeOn(billId)).toEqual([
      row({
        quantity: decimal("3.000"),
        menuPrice: decimal("36.00"),
        amountTakenOff: decimal("36.00"),
      }),
    ]);
  });

  it("lists a comp whose bill was settled, under the bill's invoice", async () => {
    const { billId } = await bill([{ name: "Burger" }, { name: "Salad" }]);
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });
    const invoice = await pay(billId);
    expect(await freeOn(billId)).toEqual([row({ invoice: number(invoice) })]);
  });

  it("leaves no row behind for a comped dish taken off the bill after serving or before firing", async () => {
    const served = await bill([{ name: "Burger" }, { name: "Salad" }]);
    await inTx(venue, (tx) => serveLine(tx, venue.cfg, served.billId, 1));
    const servedLine = await lineIdOf(venue, served.billId, 1);
    await adjust(served.billId, { lineId: servedLine, action: "comp" });
    await cancel(served.billId, 1, "remove_charge");
    const held = await bill([{ name: "Burger" }, { name: "Salad" }], { release: "hold" });
    const heldLine = await lineIdOf(venue, held.billId, 1);
    await adjust(held.billId, { lineId: heldLine, action: "comp" });
    await cancel(held.billId, 1, "remove_charge");
    const left = await inTx(venue, (tx) =>
      tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(sql`${workingOrderLines.id} in (${servedLine}, ${heldLine})`),
    );
    expect(left).toEqual([]);
    expect(await freeOn(served.billId, held.billId)).toEqual([]);
  });
});

describe("the free list", () => {
  it("lists a comp on a dish that reached the bill", async () => {
    const { billId } = await bill([{ name: "Burger" }, { name: "Salad" }]);
    await inTx(venue, (tx) => serveLine(tx, venue.cfg, billId, 1));
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });
    expect(await freeOn(billId)).toEqual([row({})]);
  });

  it("lists a 100% discount and an amount discount to zero, with the reason and note", async () => {
    const { billId } = await bill([{ name: "Burger" }, { name: "Salad" }, { name: "Water" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 10000,
      note: "Birthday",
    });
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 2),
      action: "discount_amount",
      amount: "10.00",
    });
    expect(await freeOn(billId)).toEqual([
      row({ kind: "discount", note: "Birthday" }),
      row({
        kind: "discount",
        item: "Salad",
        menuPrice: decimal("10.00"),
        amountTakenOff: decimal("10.00"),
      }),
    ]);
  });

  it("lists a discount of the whole bill to zero under the bill's department", async () => {
    const { billId } = await bill([{ name: "Burger" }, { name: "Salad" }]);
    await adjust(billId, { action: "discount_percent", percentBp: 10000 });
    expect(await freeOn(billId)).toEqual([
      row({
        item: null,
        quantity: null,
        kind: "discount",
        menuPrice: decimal("22.00"),
        amountTakenOff: decimal("22.00"),
      }),
    ]);
  });

  it("lists a comped dish cancelled with its charge kept, and not the cancel", async () => {
    const { billId } = await bill([{ name: "Burger" }, { name: "Salad" }]);
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });
    await cancel(billId, 1, "keep_charge");
    expect((await recordedOn(billId)).map((entry) => entry.action)).toEqual(["comp", "cancel"]);
    expect(await freeOn(billId)).toEqual([row({})]);
  });

  it("names the ticket of the bill a comped dish moved to", async () => {
    const { partyId, billId } = await bill([
      { name: "Burger" },
      { name: "Salad" },
      { name: "Water" },
    ]);
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });
    const moved = await inTx(venue, async (tx) => {
      const [party] = await tx
        .select({ revision: parties.revision })
        .from(parties)
        .where(eq(parties.id, partyId));
      return splitBill(tx, venue.cfg, billId, [{ lineNo: 1 }, { lineNo: 2 }], {
        operatorId: venue.staffId,
        expectedPartyRevision: party!.revision,
      });
    });
    await pay(billId);
    const invoice = await pay(moved.billId);
    expect(await freeOn(billId)).toEqual([row({ invoice: number(invoice) })]);
  });

  it("leaves out a partial discount, every cancel, and a period the bill was not opened in", async () => {
    const { billId } = await bill([{ name: "Burger" }, { name: "Salad" }, { name: "Water" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 5000,
    });
    await cancel(billId, 2, "remove_charge");
    await cancel(billId, 1, "keep_charge");
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 3), action: "comp" });
    expect(await freeOn(billId)).toEqual([
      row({ item: "Water", menuPrice: decimal("2.00"), amountTakenOff: decimal("2.00") }),
    ]);
    const ids = new Set((await recordedOn(billId)).map((entry) => entry.id));
    const lastYear = await listed({ year: today.year - 1, month: today.month });
    expect(lastYear.filter((entry) => ids.has(entry.adjustmentId))).toEqual([]);
  });
  it("leaves out a bill opened on the first business day after the period", async () => {
    const { billId } = await bill([{ name: "Burger" }, { name: "Salad" }]);
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });
    const { next } = periodDays(today.year, { kind: "month", month: today.month });
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ openedAt: `${next}T12:00:00.000Z` })
        .where(eq(workingOrders.id, billId)),
    );
    const ids = new Set((await recordedOn(billId)).map((entry) => entry.id));
    const thisPeriod = await listed();
    expect(thisPeriod.filter((entry) => ids.has(entry.adjustmentId))).toEqual([]);
    const nextPeriod = await listed({
      year: Number(next.slice(0, 4)),
      month: Number(next.slice(5, 7)),
    });
    expect(nextPeriod.filter((entry) => ids.has(entry.adjustmentId))).toHaveLength(1);
  });
});

describe("the estimated cost", () => {
  // The margin is read when the list is, so each case sets its own and leaves none behind.
  afterEach(() => setMargin(departmentId, null));

  it("is the price without VAT less the margin, rounded half up to the cent", () => {
    expect(estimatedCost([{ gross: decimal("11.00"), rate: decimal("10.00") }], 3000)).toBe("7.00");
    expect(estimatedCost([{ gross: decimal("12.10"), rate: decimal("21.00") }], 3333)).toBe("6.67");
    expect(
      estimatedCost(
        [
          { gross: decimal("11.00"), rate: decimal("10.00") },
          { gross: decimal("12.10"), rate: decimal("21.00") },
        ],
        3000,
      ),
    ).toBe("14.00");
    // 10.00 ÷ 1.21 × 0.70 is 5.785…; a price without VAT rounded to the cent first gives 5.78.
    expect(estimatedCost([{ gross: decimal("10.00"), rate: decimal("21.00") }], 3000)).toBe("5.79");
    // 1.21 without VAT is exactly 1.00, × 0.695 is exactly half a cent over 0.69, which rounds up,
    // though each of the three prices without VAT is a quotient that does not end.
    expect(
      estimatedCost(
        ["0.01", "0.02", "1.18"].map((gross) => ({
          gross: decimal(gross),
          rate: decimal("21.00"),
        })),
        3050,
      ),
    ).toBe("0.70");
    expect(estimatedCost([], 3000)).toBe("0.00");
    expect(estimatedCost([{ gross: decimal("11.00"), rate: decimal("10.00") }], null)).toBeNull();
  });

  it("takes each dish's own rate, and for a whole bill the sum over its lines", async () => {
    await setMargin(departmentId, 3000);
    const dish = await bill([{ name: "Bread" }, { name: "Salad" }]);
    await reprice(dish.billId, 1, 1100, "reduced");
    await adjust(dish.billId, { lineId: await lineIdOf(venue, dish.billId, 1), action: "comp" });
    const whole = await bill([{ name: "Bread" }, { name: "Salad" }]);
    await reprice(whole.billId, 1, 1100, "reduced");
    await reprice(whole.billId, 2, 1210, "general");
    await adjust(whole.billId, { action: "discount_percent", percentBp: 10000 });
    expect(await freeOn(dish.billId)).toEqual([
      row({
        item: "Bread",
        menuPrice: decimal("11.00"),
        amountTakenOff: decimal("11.00"),
        estimatedCost: decimal("7.00"),
      }),
    ]);
    expect(await freeOn(whole.billId)).toEqual([
      row({
        item: null,
        quantity: null,
        kind: "discount",
        menuPrice: decimal("23.10"),
        amountTakenOff: decimal("23.10"),
        estimatedCost: decimal("14.00"),
      }),
    ]);
  });

  it("counts in a whole-bill discount only the dishes it took money off", async () => {
    await setMargin(departmentId, 3000);
    const { billId } = await bill([{ name: "Bread" }, { name: "Salad" }]);
    await reprice(billId, 1, 1100, "reduced");
    await reprice(billId, 2, 1210, "general");
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });
    await adjust(billId, { action: "discount_percent", percentBp: 10000 });
    expect(await freeOn(billId)).toEqual([
      row({
        item: "Bread",
        menuPrice: decimal("11.00"),
        amountTakenOff: decimal("11.00"),
        estimatedCost: decimal("7.00"),
      }),
      row({
        item: null,
        quantity: null,
        kind: "discount",
        menuPrice: decimal("12.10"),
        amountTakenOff: decimal("12.10"),
        estimatedCost: decimal("7.00"),
      }),
    ]);
  });

  it("takes the dish's takeaway class on a takeaway bill", async () => {
    await setMargin(departmentId, 3000);
    const { partyId, billId } = await bill([]);
    await inTx(venue, async (tx) => {
      await tx
        .update(workingOrders)
        .set({ dining: "takeaway" })
        .where(eq(workingOrders.id, billId));
      await placeGroups(tx, venue.cfg, partyId, {
        groups: [{ lines: [{ menuItemId: venue.item("Salad"), quantity: "1" }], release: "fire" }],
        operatorId: venue.staffId,
        billId,
      });
      await tx
        .update(workingOrderLines)
        .set({
          unitPriceGross: 1100,
          lineTotal: 1100,
          vatClass: "general",
          takeawayVatClass: "reduced",
        })
        .where(eq(workingOrderLines.workingOrderId, billId));
    });
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });
    expect(await freeOn(billId)).toEqual([
      row({
        item: "Salad",
        menuPrice: decimal("11.00"),
        amountTakenOff: decimal("11.00"),
        estimatedCost: decimal("7.00"),
      }),
    ]);
  });

  it("is blank for a department with no margin and for a bill with no department", async () => {
    const noMargin = await bill([{ name: "Burger" }, { name: "Salad" }]);
    await adjust(noMargin.billId, {
      lineId: await lineIdOf(venue, noMargin.billId, 1),
      action: "comp",
    });
    expect(await freeOn(noMargin.billId)).toEqual([row({})]);
    await setMargin(departmentId, 3000);
    const none = await bill([{ name: "Burger" }, { name: "Salad" }]);
    // A whole-bill discount reads only the bill's department; menu lines always carry their own.
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ zoneId: null, departmentId: null, serviceMode: null })
        .where(eq(workingOrders.id, none.billId)),
    );
    await adjust(none.billId, { action: "discount_percent", percentBp: 10000 });
    expect(await freeOn(none.billId)).toEqual([
      row({
        item: null,
        quantity: null,
        kind: "discount",
        department: null,
        menuPrice: decimal("22.00"),
        amountTakenOff: decimal("22.00"),
      }),
    ]);
  });

  it("takes the margin of the department a dish was ordered in, not the bill's (D11)", async () => {
    const bar = await inTx(venue, (tx) => createDepartment(tx, { name: "Bar" }));
    await setMargin(bar.id, 5000);
    await setMargin(departmentId, 3000);
    const { billId } = await bill([{ name: "Bread" }, { name: "Salad" }]);
    await reprice(billId, 1, 1100, "reduced");
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ offerDepartmentId: bar.id })
        .where(
          sql`${workingOrderLines.workingOrderId} = ${billId} and ${workingOrderLines.lineNo} = 1`,
        ),
    );
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });
    expect(await freeOn(billId)).toEqual([
      row({
        item: "Bread",
        department: "Bar",
        menuPrice: decimal("11.00"),
        amountTakenOff: decimal("11.00"),
        estimatedCost: decimal("5.00"),
      }),
    ]);
  });
});
