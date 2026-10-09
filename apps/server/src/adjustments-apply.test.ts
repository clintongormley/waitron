import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  floorZones,
  serviceCommands,
  orderGroups,
  parties,
  printJobs,
  saleLines,
  sales,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  adjustments,
  computeAdjustmentReport,
  createAdjustmentReason,
  saveAdjustmentSettings,
  updateAdjustmentReason,
  type AdjustmentAction,
} from "@waitron/adjustments";
import { localToday, rateLines, type GrossLines, type VatClass } from "@waitron/catalogue";
import { insertCapturedPayment, SimulatorPaymentProvider } from "@waitron/payments";
import { listStationNotices, writePrintHeldWork } from "@waitron/venue-service";
import { decimal, subtractDecimal, sumDecimals, toScale, type Decimal } from "@waitron/shared";
import { applyAdjustment, previewAdjustment } from "./adjustments-apply.js";
import type { AdjustmentArgs } from "./adjustments-apply.js";
import { splitBill, transferItems } from "./bill-actions.js";
import { moveBill } from "./move-bill.js";
import { fireGroup, placeGroups } from "./order-groups.js";
import { formatReceipt } from "./receipt-ticket.js";
import { printedLines } from "./testing/decode-ticket.js";
import {
  payWorkingOrder,
  payWorkingOrderIntegrated,
  readSettledTicket,
  type TillSaleResult,
} from "./till-sale.js";
import {
  addTabRound,
  advanceTicketItem,
  parkOrder,
  placeOrder,
  readOrderRevision,
  recallLines,
  splitLinesWithinOrder,
  updateHeldOrder,
  updateOrderLine,
} from "./working-order.js";
import { send } from "./testing/bill-venue.js";
import { serveLine } from "./testing/serve-line.js";
import {
  billWith,
  inTx,
  lineIdOf,
  PINS,
  provisionAdjustmentVenue,
  REASONS,
  rowsOf,
  ticketOf,
  type AdjustmentVenue,
  type RoundLine,
} from "./testing/adjustment-venue.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

// Cancellations, comps and discounts applied to an open bill (service plan Task 11, spec §7),
// against a provisioned venue that files real Veri*Factu records.
let venue: AdjustmentVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});

type Ask = Partial<Omit<AdjustmentArgs, "amount">> & {
  action: AdjustmentAction;
  amount?: string;
};

/** Apply `ask` to the bill as its current revision reads, as the supervisor, under House. */
async function adjust(billId: string, ask: Ask) {
  return inTx(venue, async (tx) =>
    applyAdjustment(tx, venue.cfg, await argsFor(tx, billId, ask), venue.venueLocale),
  );
}

async function argsFor(tx: Transaction, billId: string, ask: Ask): Promise<AdjustmentArgs> {
  const [order] = await tx
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  const { amount, ...rest } = ask;
  return {
    orderId: billId,
    submissionId: randomUUID(),
    expectedRevision: order!.revision,
    lineId: null,
    reasonId: venue.reasonId.house,
    note: null,
    operatorId: venue.supervisorId,
    ...rest,
    ...(amount === undefined ? {} : { amount: decimal(amount) }),
  };
}

function preview(billId: string, ask: Ask) {
  return inTx(venue, async (tx) => {
    const { submissionId, approver, ...args } = await argsFor(tx, billId, ask);
    void submissionId;
    void approver;
    return previewAdjustment(tx, args, venue.venueLocale);
  });
}

/** Everything an adjustment could change on a bill, to show that a refused one changed nothing. */
async function stateOf(billId: string) {
  return inTx(venue, async (tx) => {
    const [order] = await tx
      .select({ revision: workingOrders.revision, party: parties.revision })
      .from(workingOrders)
      .innerJoin(parties, eq(parties.id, workingOrders.partyId))
      .where(eq(workingOrders.id, billId));
    const recorded = await tx
      .select({ id: adjustments.id })
      .from(adjustments)
      .where(eq(adjustments.workingOrderId, billId));
    return { order, recorded };
  }).then(async (state) => ({ ...state, rows: await rowsOf(venue, billId) }));
}

async function refusedWith(billId: string, ask: Ask, code: string, params?: object) {
  const before = await stateOf(billId);
  await expect(adjust(billId, ask)).rejects.toMatchObject({
    code,
    ...(params === undefined ? {} : { params }),
  });
  expect(await stateOf(billId)).toEqual(before);
}

function recordedOn(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select()
      .from(adjustments)
      .where(eq(adjustments.workingOrderId, billId))
      .orderBy(asc(adjustments.createdAt), asc(adjustments.id)),
  );
}

const bill = (lines: RoundLine[], opts?: Parameters<typeof billWith>[2]) =>
  billWith(venue, lines, opts);

function total(rows: { lineTotal: string }[]): string {
  return toScale(sumDecimals(rows.map((row) => decimal(row.lineTotal))), 2);
}

/** The prices and totals of a bill's rows, as `[name, quantity, unit, list, total]`. */
async function priced(billId: string) {
  return (await rowsOf(venue, billId)).map((row) => [
    row.name,
    row.quantity,
    row.unitPriceGross,
    row.listUnitPriceGross,
    row.lineTotal,
  ]);
}

/** Pays the whole bill in cash, filing its invoice; answers the sale and its lines. */
async function payAll(billId: string) {
  const due = total(await rowsOf(venue, billId));
  await payWorkingOrder({ db: venue.db, backend: venue.backend, clock: venue.clock }, venue.cfg, {
    id: billId,
    tender: { method: "cash", amount: due },
    lines: [],
  });
  const [sale] = await inTx(venue, (tx) =>
    tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
  );
  const lines = await inTx(venue, (tx) =>
    tx
      .select({ name: saleLines.name, lineGross: saleLines.lineGross, total: saleLines.lineTotal })
      .from(saleLines)
      .where(eq(saleLines.saleId, sale!.id))
      .orderBy(saleLines.lineNo),
  );
  return { sale: sale!, lines };
}

/** The VAT breakdown `rateLines` gives lines of these classes and gross totals, by rate. */
function breakdownOf(lines: [VatClass, string][]) {
  const gross: GrossLines = {
    lines: lines.map(([vatClass, lineGross]) => ({
      vatClass,
      grossUnitPrice: decimal(lineGross),
      lineGross: decimal(lineGross),
    })) as unknown as GrossLines["lines"],
    total: decimal("0"),
  };
  return byRate(rateLines(gross, localToday()).vatBreakdown);
}

function byRate(rows: readonly { rate: string; base: string; tax: string }[]) {
  return Object.fromEntries(
    rows.map((row) => [Number(row.rate).toFixed(2), { base: row.base, tax: row.tax }]),
  );
}

describe("a comp (plan D4)", () => {
  it("sets the line to zero, keeps its list price, and files the bill with the line at zero", async () => {
    const { billId } = await bill([{ name: "Burger" }, { name: "Bread" }]);
    const burger = await lineIdOf(venue, billId, 1);

    await adjust(billId, { lineId: burger, action: "comp", reasonId: venue.reasonId.complaint });

    expect(await priced(billId)).toEqual([
      ["Burger", "1.000", "0.00", "12.00", "0.00"],
      ["Bread", "1.000", "2.50", null, "2.50"],
    ]);
    const [row] = await recordedOn(billId);
    expect(row).toMatchObject({
      lineId: burger,
      action: "comp",
      beforeAmount: 1200,
      afterAmount: 0,
      reduction: 1200,
      nominalValue: 1200,
      stage: "fired",
      requestedBy: venue.supervisorId,
      approvedBy: null,
      lineName: "Burger",
      lineListUnitPrice: 1200,
    });
    const { sale, lines } = await payAll(billId);
    expect(lines.map((line) => [line.name, line.lineGross, line.total])).toEqual([
      ["Burger", 0, 0],
      ["Bread", 250, expect.any(Number)],
    ]);
    const filed = byRate(sale.vatBreakdown);
    const comped = breakdownOf([
      ["general", "0.00"],
      ["reduced", "2.50"],
    ]);
    const uncomped = breakdownOf([
      ["general", "12.00"],
      ["reduced", "2.50"],
    ]);
    const burgerAlone = breakdownOf([["general", "12.00"]]);
    expect(filed).toEqual(comped);
    // The general rate's base and tax drop by exactly the Burger's; the reduced rate is untouched.
    const general = Object.keys(burgerAlone)[0]!;
    expect(decimalDifference(uncomped[general]!.base, filed[general]!.base)).toBe(
      burgerAlone[general]!.base,
    );
    expect(decimalDifference(uncomped[general]!.tax, filed[general]!.tax)).toBe(
      burgerAlone[general]!.tax,
    );
  });

  it("comps a served dish whose ticket is ready, telling the kitchen nothing and printing nothing", async () => {
    const { billId } = await bill([{ name: "Burger" }]);
    const ticket = await ticketOf(venue, billId, 1);
    await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, ticket.id, "preparing"));
    await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, ticket.id, "ready"));
    await inTx(venue, (tx) => serveLine(tx, venue.cfg, billId, 1));
    const notices = await noticesAtStation();
    const jobs = await printJobCount();
    const items = await ticketItemCount(billId);

    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "comp",
      reasonId: venue.reasonId.complaint,
    });

    expect(await priced(billId)).toEqual([["Burger", "1.000", "0.00", "12.00", "0.00"]]);
    expect(await noticesAtStation()).toEqual(notices);
    expect(await printJobCount()).toBe(jobs);
    expect(await ticketItemCount(billId)).toBe(items);
    expect((await recordedOn(billId))[0]).toMatchObject({ stage: "served", reduction: 1200 });
  });

  it("comps 1 of Steak ×2 by splitting it into a row at €25.00 and a row at €0.00", async () => {
    const { billId } = await bill([{ name: "Steak", quantity: "2" }]);
    const steak = await lineIdOf(venue, billId, 1);

    await adjust(billId, { lineId: steak, action: "comp", quantity: "1" });

    expect(await priced(billId)).toEqual([
      ["Steak", "1.000", "25.00", "25.00", "25.00"],
      ["Steak", "1.000", "0.00", "25.00", "0.00"],
    ]);
    const [row] = await recordedOn(billId);
    expect(row).toMatchObject({
      lineId: steak,
      quantity: 1000,
      lineQuantity: 2000,
      reduction: 2500,
      nominalValue: 2500,
      splits: [{ from: steak, to: await lineIdOf(venue, billId, 2) }],
    });
  });

  it("comps 0.005 kg of ham at €24.00/kg to a unit price of exactly €0.00", async () => {
    const { billId } = await bill([{ name: "Ham", quantity: "0.005" }]);

    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });

    expect(await priced(billId)).toEqual([["Ham", "0.005", "0.00", "24.00", "0.00"]]);
    expect((await recordedOn(billId))[0]).toMatchObject({
      beforeAmount: 12,
      afterAmount: 0,
      reduction: 12,
    });
  });

  it("comps a dish together with its extras", async () => {
    const { billId } = await bill([{ name: "Pizza", olives: 1 }]);

    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });

    expect(await priced(billId)).toEqual([
      ["Pizza", "1.000", "0.00", "9.00", "0.00"],
      ["Olives", "1.000", "0.00", "1.50", "0.00"],
    ]);
    expect((await recordedOn(billId))[0]).toMatchObject({ reduction: 1050, nominalValue: 1050 });
  });

  it("records the parent and variant staff pair for a comp and cancel", async () => {
    const glass = { name: "Wine", variantId: venue.wineGlassId };
    const comped = await bill([glass]);
    const cancelled = await bill([glass]);

    await adjust(comped.billId, {
      lineId: await lineIdOf(venue, comped.billId, 1),
      action: "comp",
    });
    await adjust(cancelled.billId, {
      lineId: await lineIdOf(venue, cancelled.billId, 1),
      action: "cancel",
    });

    expect((await recordedOn(comped.billId))[0]).toMatchObject({
      action: "comp",
      lineName: "Wine (Wine glass)",
      lineListUnitPrice: 400,
    });
    // The cancel deleted the line, so the record is the only place the variant is still named.
    expect(await rowsOf(venue, cancelled.billId)).toEqual([]);
    expect((await recordedOn(cancelled.billId))[0]).toMatchObject({
      action: "cancel",
      lineName: "Wine (Wine glass)",
    });
  });
});

describe("the extras rows an adjustment records as comped with their dish (B11f)", () => {
  /** A bill of Pizza × `quantity` with olives, and the ids of the pizza and its one extras row. */
  async function pizzaWithOlives(quantity = "1") {
    const { billId } = await bill([{ name: "Pizza", quantity, olives: 1 }]);
    const pizza = await lineIdOf(venue, billId, 1);
    const extras = (await rowsOf(venue, billId))
      .filter((row) => row.parentLineId === pizza)
      .map((row) => row.id);
    expect(extras).toHaveLength(1);
    return { billId, pizza, extras };
  }

  it("records the dish's extras row on a whole comp of the dish", async () => {
    const { billId, pizza, extras } = await pizzaWithOlives();

    await adjust(billId, { lineId: pizza, action: "comp" });

    expect(await recordedOn(billId)).toMatchObject([
      { lineId: pizza, action: "comp", splits: [], compedExtras: extras },
    ]);
  });

  it("records none on a comp of part of the dish", async () => {
    const { billId, pizza } = await pizzaWithOlives("2");

    await adjust(billId, { lineId: pizza, action: "comp", quantity: "1" });

    const [row] = await recordedOn(billId);
    expect(row).toMatchObject({ lineId: pizza, action: "comp", quantity: 1000 });
    expect(row!.splits).not.toEqual([]);
    expect(row!.compedExtras).toEqual([]);
  });

  it("records none on a comp of the extras row on its own", async () => {
    const { billId, extras } = await pizzaWithOlives();

    await adjust(billId, { lineId: extras[0]!, action: "comp" });

    expect(await recordedOn(billId)).toMatchObject([
      { lineId: extras[0], action: "comp", compedExtras: [] },
    ]);
  });

  it("records none on a percent discount of the dish", async () => {
    const { billId, pizza } = await pizzaWithOlives();

    await adjust(billId, { lineId: pizza, action: "discount_percent", percentBp: 1000 });

    expect(await recordedOn(billId)).toMatchObject([
      { lineId: pizza, action: "discount_percent", compedExtras: [] },
    ]);
  });
});

describe("the receipt (ruling R13)", () => {
  /** A ticket's lines as `[customer name, gross, total before the change, what was taken off]`. */
  const shown = (ticket: TillSaleResult) =>
    ticket.lines.map((line) => [
      line.descriptions["es-ES"],
      line.gross,
      line.listGross,
      line.adjustments,
    ]);

  async function compBurgerAndDiscountBottle() {
    const { billId } = await bill([{ name: "Burger" }, { name: "Bottle" }, { name: "Bread" }]);
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 2),
      action: "discount_percent",
      percentBp: 1000,
    });
    return billId;
  }

  const ADJUSTED_LINES = [
    ["Hamburguesa", "0.00", "12.00", [{ kind: "comp", amount: "12.00" }]],
    ["Rioja crianza", "27.00", "30.00", [{ kind: "discount", percentBp: 1000, amount: "3.00" }]],
    ["Pan de pueblo", "2.50", undefined, undefined],
  ];

  it("prints the Burger at €12.00 with an Invitación line beneath it, when the bill is paid and when it is printed again", async () => {
    const billId = await compBurgerAndDiscountBottle();

    const ticket = await payWorkingOrder(
      { db: venue.db, backend: venue.backend, clock: venue.clock },
      venue.cfg,
      { id: billId, tender: { method: "cash", amount: "29.50" }, lines: [] },
    );

    expect(shown(ticket)).toEqual(ADJUSTED_LINES);
    const again = await inTx(venue, (tx) =>
      readSettledTicket(venue.backend, tx, venue.cfg, billId),
    );
    expect(shown(again)).toEqual(ADJUSTED_LINES);
    const printed = printedLines(
      formatReceipt({
        result: again,
        issuer: { venueName: "Ajustes SL", nif: "62000003K" },
        receipt: {},
        invoiceLocale: "es-ES",
        printer: {
          paperWidth: "80mm",
          resolution: "180dpi",
        },
      }),
    );
    const burger = printed.findIndex((line) => /^1 ud {2}Hamburguesa +12,00 €$/u.test(line));
    expect(burger).toBeGreaterThanOrEqual(0);
    expect(printed[burger + 1]).toMatch(/^ {2}Invitación +-12,00 €$/u);
  });

  it("shows the change on a card reader's receipt too", async () => {
    const billId = await compBurgerAndDiscountBottle();

    const paid = await payWorkingOrderIntegrated(
      {
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        provider: new SimulatorPaymentProvider(venue.db),
      },
      venue.cfg,
      { id: billId, lines: [], simulationOutcome: "captured" },
    );

    expect(paid.outcome).toBe("captured");
    expect(shown((paid as { ticket: TillSaleResult }).ticket)).toEqual(ADJUSTED_LINES);
  });

  it("shows the change when a card payment whose reply was lost is filed later", async () => {
    const billId = await compBurgerAndDiscountBottle();
    await inTx(venue, (tx) =>
      insertCapturedPayment(tx, {
        origin: venue.cfg.origin,
        workingOrderId: billId,
        provider: "simulator",
        paymentRef: `sim-${randomUUID()}`,
        amount: decimal("29.50"),
        settledAt: new Date(),
        externalRef: `sim_lost_${randomUUID()}`,
      }),
    );

    const paid = await payWorkingOrderIntegrated(
      {
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        provider: new SimulatorPaymentProvider(venue.db),
      },
      venue.cfg,
      { id: billId, lines: [] },
    );

    expect(paid.outcome).toBe("captured");
    expect(shown((paid as { ticket: TillSaleResult }).ticket)).toEqual(ADJUSTED_LINES);
  });
});

describe("a line discount (plan D4)", () => {
  it("takes 10% off a €30.00 bottle, leaving €27.00, with one adjustment of €3.00", async () => {
    const { billId } = await bill([{ name: "Bottle" }]);

    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
    });

    expect(await priced(billId)).toEqual([["Bottle", "1.000", "27.00", "30.00", "27.00"]]);
    const recorded = await recordedOn(billId);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      action: "discount_percent",
      percentBp: 1000,
      beforeAmount: 3000,
      afterAmount: 2700,
      reduction: 300,
    });
  });

  it("keeps the list price the first adjustment saw through a second one", async () => {
    const { billId } = await bill([{ name: "Bottle" }]);
    const bottle = await lineIdOf(venue, billId, 1);
    await adjust(billId, { lineId: bottle, action: "discount_percent", percentBp: 1000 });

    await adjust(billId, { lineId: bottle, action: "discount_amount", amount: "2.00" });

    expect(await priced(billId)).toEqual([["Bottle", "1.000", "25.00", "30.00", "25.00"]]);
    expect((await recordedOn(billId))[1]).toMatchObject({
      beforeAmount: 2700,
      reduction: 200,
      lineListUnitPrice: 3000,
      nominalValue: 3000,
    });
  });

  it("keeps whole cents a unit: 10% off Croquetas ×3 at €3.33 is 2 × €3.00 and 1 × €2.99, filed at €8.99", async () => {
    const { billId } = await bill([{ name: "Croquetas", quantity: "3" }]);

    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
    });

    expect(await priced(billId)).toEqual([
      ["Croquetas", "2.000", "3.00", "3.33", "6.00"],
      ["Croquetas", "1.000", "2.99", "3.33", "2.99"],
    ]);
    expect((await recordedOn(billId))[0]).toMatchObject({ reduction: 100 });
    const { sale, lines } = await payAll(billId);
    expect(lines.map((line) => line.lineGross)).toEqual([600, 299]);
    expect(sale.total).toBe(899);
  });

  it("spreads a discount over a dish and its extras, each row at a whole-cent price", async () => {
    const { billId } = await bill([{ name: "Pizza", olives: 1 }]);

    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
    });

    expect(await priced(billId)).toEqual([
      ["Pizza", "1.000", "8.10", "9.00", "8.10"],
      ["Olives", "1.000", "1.35", "1.50", "1.35"],
    ]);
    expect((await recordedOn(billId))[0]).toMatchObject({ reduction: 105 });
  });

  it("discounts a frozen three-portion extra at its price basis and keeps its physical amount", async () => {
    const { billId } = await bill([{ name: "Pizza", olives: 1 }]);
    const extraId = await lineIdOf(venue, billId, 2);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ quantity: 150, priceQuantity: 50, unitPriceGross: 1, lineTotal: 3 })
        .where(eq(workingOrderLines.id, extraId)),
    );

    await adjust(billId, { lineId: extraId, action: "discount_amount", amount: "0.03" });

    expect(await priced(billId)).toEqual([
      ["Pizza", "1.000", "9.00", null, "9.00"],
      ["Olives", "0.150", "0.00", "0.01", "0.00"],
    ]);
    expect((await recordedOn(billId))[0]).toMatchObject({
      beforeAmount: 3,
      reduction: 3,
      nominalValue: 3,
    });
  });

  it("discounts part of a line by splitting that part off first", async () => {
    const { billId } = await bill([{ name: "Croquetas", quantity: "5" }]);

    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_amount",
      quantity: "3",
      amount: "1.00",
    });

    expect(await priced(billId)).toEqual([
      ["Croquetas", "2.000", "3.33", "3.33", "6.66"],
      ["Croquetas", "2.000", "3.00", "3.33", "6.00"],
      ["Croquetas", "1.000", "2.99", "3.33", "2.99"],
    ]);
    const [row] = await recordedOn(billId);
    expect(row).toMatchObject({ quantity: 3000, beforeAmount: 999, reduction: 100 });
    const [first, second, third] = [1, 2, 3].map((lineNo) => lineIdOf(venue, billId, lineNo));
    expect(row!.splits).toEqual([
      { from: await first, to: await second },
      { from: await second, to: await third },
    ]);
  });
});

describe("too large (plan D4)", () => {
  it("refuses a €40.00 discount on a €30.00 line, changing nothing", async () => {
    const { billId } = await bill([{ name: "Bottle" }]);
    await refusedWith(
      billId,
      { lineId: await lineIdOf(venue, billId, 1), action: "discount_amount", amount: "40.00" },
      "adjustment.exceeds_amount",
      { requested: "40.00", available: "30.00" },
    );
  });

  it("refuses a €150.00 discount on a €120.00 bill, changing nothing", async () => {
    const { billId } = await bill([{ name: "Bottle", quantity: "4" }]);
    await refusedWith(
      billId,
      { action: "discount_amount", amount: "150.00" },
      "adjustment.exceeds_amount",
      { requested: "150.00", available: "120.00" },
    );
  });
});

describe("a bill discount with a weighed line (plan D15)", () => {
  it("takes €5.00 off a €10.00 salad and 2.5 kg of fish exactly, the salad giving back the fish's extra cent", async () => {
    const { billId } = await bill([{ name: "Salad" }, { name: "Fish", quantity: "2.5" }]);

    await adjust(billId, { action: "discount_amount", amount: "5.00" });

    expect(await priced(billId)).toEqual([
      ["Salad", "1.000", "8.83", "10.00", "8.83"],
      ["Fish", "2.500", "11.46", "12.99", "28.65"],
    ]);
    const [row] = await recordedOn(billId);
    expect(row).toMatchObject({
      lineId: null,
      stage: null,
      beforeAmount: 4248,
      afterAmount: 3748,
      reduction: 500,
      nominalValue: 4248,
    });
  });

  it("records what a bill of only weighed lines actually loses, which the preview showed", async () => {
    const { billId } = await bill([{ name: "Fish", quantity: "2.5" }]);
    const ask: Ask = { action: "discount_amount", amount: "3.27" };

    expect(await preview(billId, ask)).toMatchObject({ reduction: "3.28" });
    await adjust(billId, ask);

    expect(await priced(billId)).toEqual([["Fish", "2.500", "11.68", "12.99", "29.20"]]);
    expect((await recordedOn(billId))[0]).toMatchObject({ reduction: 328 });
  });

  it("puts the fish's missing cent on the bread, which has room", async () => {
    const { billId } = await bill([{ name: "Fish", quantity: "2.5" }, { name: "Bread" }]);

    await adjust(billId, { action: "discount_amount", amount: "3.27" });

    expect(await priced(billId)).toEqual([
      ["Fish", "2.500", "11.78", "12.99", "29.45"],
      ["Bread", "1.000", "2.26", "2.50", "2.26"],
    ]);
    expect((await recordedOn(billId))[0]).toMatchObject({ reduction: 327 });
  });

  it("leaves a comped water at €0.00 whichever way the fish misses, recording what was achieved", async () => {
    for (const [asked, achieved, fish] of [
      ["3.24", 323, ["Fish", "2.500", "11.70", "12.99", "29.25"]],
      ["3.27", 328, ["Fish", "2.500", "11.68", "12.99", "29.20"]],
    ] as const) {
      const { billId } = await bill([{ name: "Fish", quantity: "2.5" }, { name: "Water" }]);
      await adjust(billId, { lineId: await lineIdOf(venue, billId, 2), action: "comp" });
      const ask: Ask = { action: "discount_amount", amount: asked };

      expect((await preview(billId, ask)).reduction).toBe((achieved / 100).toFixed(2));
      await adjust(billId, ask);

      expect(await priced(billId)).toEqual([fish, ["Water", "1.000", "0.00", "2.00", "0.00"]]);
      expect((await recordedOn(billId))[1]).toMatchObject({ reduction: achieved });
    }
  });
});

describe("a bill discount over a dish with extras (ruling R7)", () => {
  it("keeps each row of the dish whole at its nearest price and moves the cents it misses to a line with room", async () => {
    const { billId } = await bill([{ name: "Pizza", quantity: "2", olives: 1 }, { name: "Salad" }]);

    await adjust(billId, { action: "discount_amount", amount: "3.01" });

    expect(await priced(billId)).toEqual([
      ["Pizza", "2.000", "8.13", "9.00", "16.26"],
      ["Olives", "2.000", "1.36", "1.50", "2.72"],
      ["Salad", "1.000", "9.01", "10.00", "9.01"],
    ]);
    expect((await recordedOn(billId))[0]).toMatchObject({ reduction: 301 });
  });
});

describe("a bill discount across VAT rates (Review Focus 5)", () => {
  it("gives €1.67, €1.66 and €1.67, the tie going to the line added first, and files each rate's base from what is left", async () => {
    const shares = [];
    for (let run = 0; run < 2; run++) {
      const { billId } = await bill([
        { name: "Tortilla" },
        { name: "Pimientos" },
        { name: "Cana" },
      ]);

      await adjust(billId, { action: "discount_amount", amount: "5.00" });

      const rows = await priced(billId);
      expect(rows).toEqual([
        ["Tortilla", "1.000", "1.66", "3.33", "1.66"],
        ["Pimientos", "1.000", "1.67", "3.33", "1.67"],
        ["Cana", "1.000", "1.67", "3.34", "1.67"],
      ]);
      shares.push(rows);
      const { sale } = await payAll(billId);
      expect(byRate(sale.vatBreakdown)).toEqual(
        breakdownOf([
          ["reduced", "1.66"],
          ["reduced", "1.67"],
          ["general", "1.67"],
        ]),
      );
    }
    expect(shares[1]).toEqual(shares[0]);
  });
});

// A generated id, digest or timestamp can hold the PIN's digits by chance, so such a value skips the
// "contains the PIN" check, but only when its key names that kind of value and it has that shape.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function generatedShape(key: string): RegExp | null {
  if (key === "fingerprint") return /^[0-9a-f]{64}$/;
  if (key.endsWith("At")) return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  if (key === "id" || key === "madeHere" || /Ids?$/.test(key)) return UUID;
  return null;
}

function expectNoPinIn(value: unknown, pin: string, key = ""): void {
  if (Array.isArray(value)) {
    for (const item of value) expectNoPinIn(item, pin, key);
  } else if (typeof value === "object" && value !== null) {
    for (const [name, item] of Object.entries(value)) {
      expect(name.toLowerCase()).not.toBe("pin");
      expect(name).not.toContain(pin);
      expectNoPinIn(item, pin, name);
    }
  } else {
    const text = String(value);
    expect(text).not.toBe(pin);
    if (!generatedShape(key)?.test(text)) expect(text).not.toContain(pin);
  }
}

describe("approval (plan D6)", () => {
  const comp = async (billId: string, approver?: AdjustmentArgs["approver"]) => ({
    lineId: await lineIdOf(venue, billId, 1),
    action: "comp" as const,
    reasonId: venue.reasonId.complaint,
    operatorId: venue.staffId,
    ...(approver === undefined ? {} : { approver }),
  });

  it("refuses a staff member's comp under a supervisor's reason with no approver, naming the manager", async () => {
    const { billId } = await bill([{ name: "Burger" }]);
    await refusedWith(billId, await comp(billId), "adjustment.approval_required", {
      approverRole: "manager",
    });
    expect(await preview(billId, await comp(billId))).toMatchObject({
      needsApproval: "manager",
      reduction: "12.00",
    });
  });

  it("applies it with a manager's PIN, recording who asked and who approved", async () => {
    const { billId } = await bill([{ name: "Burger" }]);

    await adjust(billId, await comp(billId, { personId: venue.managerId, pin: PINS.manager }));

    expect((await recordedOn(billId))[0]).toMatchObject({
      requestedBy: venue.staffId,
      approvedBy: venue.managerId,
    });
    // The recorded command never holds the PIN (ruling R2).
    const commands = await inTx(venue, (tx) =>
      tx.select().from(serviceCommands).where(eq(serviceCommands.scopeId, billId)),
    );
    expect(commands).toHaveLength(1);
    expectNoPinIn(commands, PINS.manager);
  });

  it("refuses a staff member as the approver", async () => {
    const { billId } = await bill([{ name: "Burger" }]);
    await refusedWith(
      billId,
      await comp(billId, { personId: venue.staffId, pin: PINS.staff }),
      "adjustment.approval_required",
      { approverRole: "manager" },
    );
  });

  it("refuses a wrong PIN as pin.invalid", async () => {
    const { billId } = await bill([{ name: "Burger" }]);
    await refusedWith(
      billId,
      await comp(billId, { personId: venue.managerId, pin: "0000" }),
      "pin.invalid",
    );
  });
});

describe("retries (plan D8)", () => {
  it("applies a resent adjustment once, and refuses the same id asking another amount", async () => {
    const { billId } = await bill([{ name: "Bottle" }]);
    const args = await inTx(venue, (tx) =>
      argsFor(tx, billId, {
        lineId: null,
        action: "discount_amount",
        amount: "5.00",
      }),
    );

    const first = await inTx(venue, (tx) =>
      applyAdjustment(tx, venue.cfg, args, venue.venueLocale),
    );
    const again = await inTx(venue, (tx) =>
      applyAdjustment(tx, venue.cfg, args, venue.venueLocale),
    );

    expect(again).toEqual(first);
    expect(await recordedOn(billId)).toHaveLength(1);
    expect(await priced(billId)).toEqual([["Bottle", "1.000", "25.00", "30.00", "25.00"]]);
    const before = await stateOf(billId);
    await expect(
      inTx(venue, (tx) =>
        applyAdjustment(tx, venue.cfg, { ...args, amount: decimal("6.00") }, venue.venueLocale),
      ),
    ).rejects.toMatchObject({
      code: "submission.id_reused",
      params: { submissionId: args.submissionId },
    });
    expect(await stateOf(billId)).toEqual(before);
  });
});

describe("split rows and groups (plan D19)", () => {
  it("keeps both rows of a part-comped held Steak in its group, credited to its person, and moves the party on", async () => {
    const { billId, partyId } = await bill([{ name: "Steak", quantity: "2" }], {
      release: "hold",
    });
    const partyBefore = await partyRevision(partyId);

    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "comp",
      quantity: "1",
    });

    const rows = await rowsOf(venue, billId);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.groupId).toBe(rows[0]!.groupId);
    expect(rows[0]!.groupId).not.toBeNull();
    expect(rows.map((row) => row.creditedTo)).toEqual([venue.staffId, venue.staffId]);
    expect(await partyRevision(partyId)).toBe(partyBefore + 1);
    expect((await recordedOn(billId))[0]).toMatchObject({
      stage: "held",
      creditedTo: venue.staffId,
    });
  });

  it("records a line nothing has sent or held as unsent", async () => {
    // Saving a party's empty bill as an order adds lines no group holds and nothing sends.
    const { billId } = await bill([]);
    await updateHeldOrder({ db: venue.db }, venue.cfg, billId, {
      revision: (await stateOf(billId)).order!.revision,
      lines: [{ menuItemId: venue.item("Burger"), quantity: "1" }],
      operatorId: venue.staffId,
    });
    const [row] = await rowsOf(venue, billId);
    expect(row!.groupId).toBeNull();
    expect(await ticketItemCount(billId)).toBe(0);

    await adjust(billId, { lineId: row!.id, action: "comp" });

    expect((await recordedOn(billId))[0]).toMatchObject({ stage: "unsent", reduction: 1200 });
  });

  it("marks a held group removed when its only line is cancelled", async () => {
    const { billId } = await bill([{ name: "Steak" }], { release: "hold" });
    const [row] = await rowsOf(venue, billId);

    await adjust(billId, { lineId: row!.id, action: "cancel" });

    const [group] = await inTx(venue, (tx) =>
      tx
        .select({ state: orderGroups.state })
        .from(orderGroups)
        .where(eq(orderGroups.id, row!.groupId!)),
    );
    expect(group!.state).toBe("removed");
    expect(await rowsOf(venue, billId)).toEqual([]);
  });
});

describe("raising an adjusted line the kitchen does not have (ruling R12)", () => {
  /** Line `lineNo`'s group state, and whether its kitchen item has fired. */
  async function kitchenOf(billId: string, lineNo: number) {
    const [row] = await inTx(venue, (tx) =>
      tx
        .select({ group: orderGroups.state, firedAt: ticketItems.firedAt })
        .from(workingOrderLines)
        .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
        .innerJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
        .where(
          and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.lineNo, lineNo)),
        ),
    );
    return row;
  }

  /** Line `lineNo`'s group, whether it was stamped sent, and its kitchen items. */
  async function placeOf(billId: string, lineNo: number) {
    const [row] = await rowsWhere(billId, lineNo);
    const items = await inTx(venue, (tx) =>
      tx
        .select({ firedAt: ticketItems.firedAt })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, row!.id)),
    );
    return { groupId: row!.groupId, sent: row!.sentAt !== null, items };
  }

  function rowsWhere(billId: string, lineNo: number) {
    return inTx(venue, (tx) =>
      tx
        .select({
          id: workingOrderLines.id,
          groupId: workingOrderLines.groupId,
          sentAt: workingOrderLines.sentAt,
        })
        .from(workingOrderLines)
        .where(
          and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.lineNo, lineNo)),
        ),
    );
  }

  /** The kitchen printer's jobs after the first `from`, each as its non-blank lines. */
  async function kitchenJobsSince(from: number): Promise<string[][]> {
    const jobs = await inTx(venue, (tx) =>
      tx
        .select({ payload: printJobs.payload })
        .from(printJobs)
        .where(eq(printJobs.printerId, venue.printerId))
        .orderBy(sql`rowid`),
    );
    return jobs
      .slice(from)
      .map((job) => printedLines(job.payload).filter((line) => line.trim() !== ""));
  }

  async function kitchenJobCount(): Promise<number> {
    return (await kitchenJobsSince(0)).length;
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
        venue.staffId,
      ),
    );
  }

  it("sells the added Burger at today's price on a line of its own, leaving the comped one at €0.00", async () => {
    const { billId, partyId } = await bill([{ name: "Burger" }], { release: "hold" });
    // Bread fired since: a dish new to the bill would now go straight to the kitchen.
    await inTx(venue, (tx) =>
      placeGroups(tx, venue.cfg, partyId, {
        groups: [{ lines: [{ menuItemId: venue.item("Bread"), quantity: "1" }], release: "fire" }],
        operatorId: venue.staffId,
        billId,
      }),
    );
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });
    const before = total(await rowsOf(venue, billId));

    await raise(billId, 1, "2");

    expect(await priced(billId)).toEqual([
      ["Burger", "1.000", "0.00", "12.00", "0.00"],
      ["Bread", "1.000", "2.50", null, "2.50"],
      ["Burger", "1.000", "12.00", null, "12.00"],
    ]);
    expect(decimalDifference(total(await rowsOf(venue, billId)), before)).toBe("12.00");
    // The added Burger waits in the comped one's group, and fires with it.
    expect(await kitchenOf(billId, 3)).toEqual({ group: "held", firedAt: null });
    const held = await placeOf(billId, 1);
    expect((await placeOf(billId, 3)).groupId).toBe(held.groupId);
    await inTx(venue, async (tx) =>
      fireGroup(tx, venue.cfg, partyId, held.groupId!, {
        submissionId: randomUUID(),
        expectedPartyRevision: (
          await tx
            .select({ revision: parties.revision })
            .from(parties)
            .where(eq(parties.id, partyId))
        )[0]!.revision,
        operatorId: venue.staffId,
      }),
    );
    expect((await placeOf(billId, 1)).items).toEqual([{ firedAt: expect.any(String) }]);
    expect((await placeOf(billId, 3)).items).toEqual([{ firedAt: expect.any(String) }]);
  });

  it("corrects the queued HOLD ticket with +1, as a raise of a line nobody adjusted does", async () => {
    await inTx(venue, (tx) => writePrintHeldWork(tx, true));
    try {
      const comped = await bill([{ name: "Burger" }], { release: "hold" });
      const plain = await bill([{ name: "Burger" }], { release: "hold" });
      await adjust(comped.billId, {
        lineId: await lineIdOf(venue, comped.billId, 1),
        action: "comp",
      });

      const beforePlain = await kitchenJobCount();
      await raise(plain.billId, 1, "2");
      const plainJobs = await kitchenJobsSince(beforePlain);
      const beforeComped = await kitchenJobCount();
      await raise(comped.billId, 1, "2");
      const compedJobs = await kitchenJobsSince(beforeComped);

      // Each prints one HOLD CHANGED slip adding one Burger, and no new HOLD ticket.
      const shape = (jobs: string[][]) =>
        jobs.map((job) => [job[0]!.trim(), job.find((line) => line.includes("x BURG"))!.trim()]);
      expect(shape(plainJobs)).toEqual([["*** HOLD CHANGED ***", "+1.000 x BURG"]]);
      expect(shape(compedJobs)).toEqual(shape(plainJobs));
    } finally {
      await inTx(venue, (tx) => writePrintHeldWork(tx, false));
    }
  });

  it("leaves the Burger added to a comped line nothing sent or held unsent too", async () => {
    const { billId } = await bill([]);
    await updateHeldOrder({ db: venue.db }, venue.cfg, billId, {
      revision: (await stateOf(billId)).order!.revision,
      lines: [{ menuItemId: venue.item("Burger"), quantity: "1" }],
      operatorId: venue.staffId,
    });
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });

    await raise(billId, 1, "2");

    expect(await priced(billId)).toEqual([
      ["Burger", "1.000", "0.00", "12.00", "0.00"],
      ["Burger", "1.000", "12.00", null, "12.00"],
    ]);
    expect(await placeOf(billId, 2)).toEqual({ groupId: null, sent: false, items: [] });
  });

  it("clears the chosen station on added units of an adjusted unsent line", async () => {
    const { billId } = await bill([]);
    await updateHeldOrder({ db: venue.db }, venue.cfg, billId, {
      revision: (await stateOf(billId)).order!.revision,
      lines: [{ menuItemId: venue.item("Burger"), quantity: "1", makeAt: venue.stationId }],
      operatorId: venue.staffId,
    });
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });

    await inTx(venue, async (tx) =>
      updateOrderLine(
        tx,
        venue.cfg,
        billId,
        1,
        { quantity: "2", makeAt: null },
        await readOrderRevision(tx, billId),
        venue.staffId,
      ),
    );

    const stations = await inTx(venue, (tx) =>
      tx
        .select({ makeAt: workingOrderLines.makeAtStationId })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, billId))
        .orderBy(workingOrderLines.lineNo),
    );
    expect(stations).toEqual([{ makeAt: null }, { makeAt: null }]);
    expect(await placeOf(billId, 2)).toEqual({ groupId: null, sent: false, items: [] });
  });

  it("sends the coffee added to a comped one poured at the bar straight away, in its group", async () => {
    const { billId } = await bill([{ name: "Coffee" }]);
    const coffee = await placeOf(billId, 1);
    expect(coffee).toMatchObject({ sent: true, items: [] });
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });

    await raise(billId, 1, "2");

    expect(await priced(billId)).toEqual([
      ["Coffee", "1.000", "0.00", "1.50", "0.00"],
      ["Coffee", "1.000", "1.50", null, "1.50"],
    ]);
    expect(await placeOf(billId, 2)).toEqual({ groupId: coffee.groupId, sent: true, items: [] });
  });

  it("sells the added bottle at its full price beside the discounted one", async () => {
    const { billId } = await bill([{ name: "Bottle" }], { release: "hold" });
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
    });

    await raise(billId, 1, "2");

    expect(await priced(billId)).toEqual([
      ["Bottle", "1.000", "27.00", "30.00", "27.00"],
      ["Bottle", "1.000", "30.00", null, "30.00"],
    ]);
  });

  it("holds the Burger added to a comped one recalled from the kitchen", async () => {
    const { billId } = await bill([{ name: "Burger" }]);
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });
    await inTx(venue, (tx) => recallLines(tx, venue.cfg, billId, [1]));

    await raise(billId, 1, "2");

    expect(await priced(billId)).toEqual([
      ["Burger", "1.000", "0.00", "12.00", "0.00"],
      ["Burger", "1.000", "12.00", null, "12.00"],
    ]);
    // It waits with the recalled Burger, in the group that Burger was fired in.
    expect(await kitchenOf(billId, 2)).toEqual({ group: "fired", firedAt: null });
    expect((await placeOf(billId, 2)).groupId).toBe((await placeOf(billId, 1)).groupId);
  });

  it("still widens a line nobody adjusted", async () => {
    const { billId } = await bill([{ name: "Burger" }], { release: "hold" });

    await raise(billId, 1, "2");

    expect(await priced(billId)).toEqual([["Burger", "2.000", "12.00", null, "24.00"]]);
  });
});

describe("the reason as it was (plan D20)", () => {
  it("keeps the name and policy an adjustment was made under, and groups both under one reason id", async () => {
    const reasonId = await inTx(venue, async (tx) => {
      return (
        await createAdjustmentReason(tx, {
          ...REASONS.complaint,
          name: "Complaint D20",
          names: {},
        })
      ).id;
    });
    const { billId } = await bill([{ name: "Burger" }, { name: "Burger" }]);
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp", reasonId });

    await inTx(venue, (tx) =>
      updateAdjustmentReason(tx, reasonId, {
        ...REASONS.complaint,
        name: "Guest recovery",
        names: {},
        maxAmount: decimal("50.00"),
      }),
    );
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 2), action: "comp", reasonId });

    const [first, second] = await recordedOn(billId);
    expect(first).toMatchObject({
      reasonId,
      reasonName: "Complaint D20",
      policySnapshot: expect.objectContaining({ maxAmount: "30.00" }),
    });
    expect(second).toMatchObject({
      reasonId,
      reasonName: "Guest recovery",
      policySnapshot: expect.objectContaining({ maxAmount: "50.00" }),
    });
  });

  it("records the reason's name in the operator's language", async () => {
    const { billId } = await bill([{ name: "Burger" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "comp",
      reasonId: venue.reasonId.complaint,
    });
    // The operator has no language of their own, so the venue's display language, es-ES in this
    // venue, is used.
    expect((await recordedOn(billId))[0]!.reasonName).toBe("Queja");
  });

  it("falls back to the venue's display language, as the till's reasons list does, not the receipt's", async () => {
    const { billId } = await bill([{ name: "Burger" }]);
    const lineId = await lineIdOf(venue, billId, 1);
    expect(venue.cfg.locale).toBe("es-ES");
    await inTx(venue, async (tx) =>
      applyAdjustment(
        tx,
        venue.cfg,
        await argsFor(tx, billId, {
          lineId,
          action: "comp",
          reasonId: venue.reasonId.complaint,
        }),
        "en-GB",
      ),
    );
    expect((await recordedOn(billId))[0]!.reasonName).toBe("Complaint");
  });
});

describe("a stale bill (plan D19)", () => {
  it("refuses a discount made from a revision another device has since moved on", async () => {
    const { billId, revision } = await bill([{ name: "Bottle" }]);
    await inTx(venue, (tx) =>
      addTabRound(tx, venue.cfg, billId, [{ menuItemId: venue.item("Bread"), quantity: "1" }]),
    );
    const current = (await stateOf(billId)).order!.revision;

    await refusedWith(
      billId,
      { action: "discount_amount", amount: "1.00", expectedRevision: revision },
      "working_order.out_of_date",
      { workingOrderId: billId, revision: current },
    );
  });
});

describe("cumulative limits (plan D6)", () => {
  it("refuses the third €12.00 comp under a €30.00 cap", async () => {
    const { billId } = await bill([{ name: "Burger" }, { name: "Burger" }, { name: "Burger" }]);
    const comp = async (lineNo: number) => ({
      lineId: await lineIdOf(venue, billId, lineNo),
      action: "comp" as const,
      reasonId: venue.reasonId.complaint,
    });
    await adjust(billId, await comp(1));
    await adjust(billId, await comp(2));

    await refusedWith(billId, await comp(3), "adjustment.over_limit");
  });

  it("refuses a second 30% discount on one line under a 50% limit", async () => {
    const { billId } = await bill([{ name: "Salad" }]);
    const discount = async () => ({
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent" as const,
      percentBp: 3000,
      reasonId: venue.reasonId.complaint,
    });
    await adjust(billId, await discount());

    await refusedWith(billId, await discount(), "adjustment.over_limit");
  });

  it("counts a line's percentages on the row a bill discount split off it", async () => {
    // Half off a line at most, and no cap on the bill, so only the line's percentage can refuse.
    const reasonId = await inTx(venue, async (tx) => {
      return (
        await createAdjustmentReason(tx, {
          ...REASONS.house,
          name: "Half off D6",
          names: {},
          maxPercentBp: 5000,
        })
      ).id;
    });
    const { billId } = await bill([{ name: "Bottle", quantity: "3" }]);
    const bottles = await lineIdOf(venue, billId, 1);
    await adjust(billId, {
      lineId: bottles,
      action: "discount_percent",
      percentBp: 3000,
      reasonId,
    });
    await adjust(billId, { action: "discount_amount", amount: "0.01" });
    expect(await priced(billId)).toEqual([
      ["Bottle", "2.000", "21.00", "30.00", "42.00"],
      ["Bottle", "1.000", "20.99", "30.00", "20.99"],
    ]);
    const carved = await lineIdOf(venue, billId, 2);
    expect((await recordedOn(billId))[1]).toMatchObject({
      lineId: null,
      splits: [{ from: bottles, to: carved }],
    });

    await refusedWith(
      billId,
      {
        lineId: carved,
        action: "discount_percent",
        percentBp: 3000,
        reasonId,
      },
      "adjustment.over_limit",
    );
  });
});

describe("the venue's limit on a bill's total discount (B11b)", () => {
  // The venue is shared by every case in the file, so each case sets the limit it needs.
  const setLimit = (maxBillDiscountBp: number | null) =>
    inTx(venue, (tx) => saveAdjustmentSettings(tx, { maxBillDiscountBp }));
  afterEach(() => setLimit(null));

  const MANAGER_PIN = () => ({ personId: venue.managerId, pin: PINS.manager });
  const billPercent = (percentBp: number, extra: Partial<Ask> = {}): Ask => ({
    action: "discount_percent",
    percentBp,
    operatorId: venue.staffId,
    ...extra,
  });

  it("asks a manager for a staff member's second 30% off a bill under a 40% limit, and records who approved", async () => {
    await setLimit(4000);
    const { billId } = await bill([{ name: "Salad", quantity: "10" }]);
    await adjust(billId, billPercent(3000));

    await refusedWith(billId, billPercent(3000), "adjustment.approval_required", {
      approverRole: "manager",
    });
    expect(await preview(billId, billPercent(3000))).toMatchObject({
      reduction: "21.00",
      needsApproval: "manager",
      overBillDiscountLimit: true,
    });

    await adjust(billId, billPercent(3000, { approver: MANAGER_PIN() }));
    expect((await recordedOn(billId)).map((row) => [row.reduction, row.approvedBy])).toEqual([
      [3000, null],
      [2100, venue.managerId],
    ]);
  });

  it("refuses a supervisor as the approver past the limit", async () => {
    await setLimit(4000);
    const { billId } = await bill([{ name: "Salad", quantity: "10" }]);
    await adjust(billId, billPercent(3000));
    await refusedWith(
      billId,
      billPercent(3000, { approver: { personId: venue.supervisorId, pin: PINS.supervisor } }),
      "adjustment.approval_required",
      { approverRole: "manager" },
    );
  });

  it("counts a line discount and a bill discount together, each under the limit alone", async () => {
    await setLimit(4000);
    // €40.00 before adjustments, so the limit is €16.00: €9.00 off the bottle, then €8.00 off the bill.
    const { billId } = await bill([{ name: "Bottle" }, { name: "Salad" }]);
    const billAmount: Ask = {
      action: "discount_amount",
      amount: "8.00",
      operatorId: venue.staffId,
    };
    expect(await preview(billId, billAmount)).toMatchObject({
      needsApproval: null,
      overBillDiscountLimit: false,
    });
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 3000,
      operatorId: venue.staffId,
    });

    await refusedWith(billId, billAmount, "adjustment.approval_required", {
      approverRole: "manager",
    });
  });

  it("counts a line discount asked after a bill discount against the limit too", async () => {
    await setLimit(4000);
    const { billId } = await bill([{ name: "Bottle" }, { name: "Salad" }]);
    await adjust(billId, { action: "discount_amount", amount: "8.00", operatorId: venue.staffId });

    await refusedWith(
      billId,
      {
        lineId: await lineIdOf(venue, billId, 1),
        action: "discount_amount",
        amount: "8.01",
        operatorId: venue.staffId,
      },
      "adjustment.approval_required",
      { approverRole: "manager" },
    );
    // Reaching €16.00 exactly is allowed.
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_amount",
      amount: "8.00",
      operatorId: venue.staffId,
    });
  });

  it("leaves a comp out of the total, and never asks a manager for one", async () => {
    await setLimit(4000);
    // €60.00 before adjustments, so the limit is €24.00; the €30.00 comp counts toward nothing.
    const { billId } = await bill([{ name: "Bottle" }, { name: "Salad", quantity: "3" }]);
    const comp: Ask = {
      lineId: await lineIdOf(venue, billId, 1),
      action: "comp",
      operatorId: venue.staffId,
    };
    expect(await preview(billId, comp)).toMatchObject({
      needsApproval: null,
      overBillDiscountLimit: false,
    });
    await adjust(billId, comp);

    await adjust(billId, { action: "discount_amount", amount: "20.00", operatorId: venue.staffId });
    expect((await recordedOn(billId)).map((row) => [row.action, row.approvedBy])).toEqual([
      ["comp", null],
      ["discount_amount", null],
    ]);
  });

  it("changes nothing when the venue has no limit", async () => {
    await setLimit(null);
    const { billId } = await bill([{ name: "Salad", quantity: "10" }]);
    await adjust(billId, billPercent(3000));
    expect(await preview(billId, billPercent(3000))).toMatchObject({
      needsApproval: null,
      overBillDiscountLimit: false,
    });
    await adjust(billId, billPercent(3000));
    expect(await recordedOn(billId)).toHaveLength(2);
  });

  it("lets a manager pass the limit without anyone's PIN", async () => {
    await setLimit(4000);
    const { billId } = await bill([{ name: "Salad", quantity: "10" }]);
    const byManager = billPercent(3000, { operatorId: venue.managerId });
    await adjust(billId, byManager);
    expect(await preview(billId, byManager)).toMatchObject({
      needsApproval: null,
      overBillDiscountLimit: false,
    });
    await adjust(billId, byManager);
    expect((await recordedOn(billId)).map((row) => row.approvedBy)).toEqual([null, null]);
  });

  it("asks for the higher role when the reason needs an approver of its own", async () => {
    await setLimit(4000);
    const policy = {
      ...REASONS.house,
      names: {},
      actions: ["discount_percent" as const],
    };
    const [byAdmin, bySupervisor] = await inTx(venue, async (tx) => [
      await createAdjustmentReason(tx, {
        ...policy,
        name: "Owner's discount B11b",
        applyRole: "manager",
        approverRole: "admin",
      }),
      await createAdjustmentReason(tx, {
        ...policy,
        name: "Regular's discount B11b",
        applyRole: "supervisor",
        approverRole: "supervisor",
      }),
    ]);
    const { billId } = await bill([{ name: "Salad", quantity: "10" }]);
    await adjust(billId, billPercent(3000));

    // Past the limit under an admin-approved reason: admin, the higher of the two.
    expect(await preview(billId, billPercent(3000, { reasonId: byAdmin.id }))).toMatchObject({
      needsApproval: "admin",
      overBillDiscountLimit: true,
    });
    await refusedWith(
      billId,
      billPercent(3000, { reasonId: byAdmin.id, approver: MANAGER_PIN() }),
      "adjustment.approval_required",
      { approverRole: "admin" },
    );

    // Under the limit a supervisor would do; past it, a manager.
    expect(await preview(billId, billPercent(1000, { reasonId: bySupervisor.id }))).toMatchObject({
      needsApproval: "supervisor",
      overBillDiscountLimit: false,
    });
    await refusedWith(
      billId,
      billPercent(3000, {
        reasonId: bySupervisor.id,
        approver: { personId: venue.supervisorId, pin: PINS.supervisor },
      }),
      "adjustment.approval_required",
      { approverRole: "manager" },
    );
    await adjust(billId, billPercent(3000, { reasonId: bySupervisor.id, approver: MANAGER_PIN() }));
    expect((await recordedOn(billId)).at(-1)).toMatchObject({ approvedBy: venue.managerId });
  });

  const byStaff = () => ({ operatorId: venue.staffId });
  /** The staff member's command on `billId`'s party, at the party's current revision. */
  const partyCommand = async (billId: string) => {
    const [row] = await inTx(venue, (tx) =>
      tx
        .select({ revision: parties.revision })
        .from(workingOrders)
        .innerJoin(parties, eq(parties.id, workingOrders.partyId))
        .where(eq(workingOrders.id, billId)),
    );
    return { ...byStaff(), expectedPartyRevision: row!.revision };
  };
  const moveOff = async (billId: string, lineNos: number[]) => {
    const command = await partyCommand(billId);
    const split = await inTx(venue, (tx) =>
      splitBill(
        tx,
        venue.cfg,
        billId,
        lineNos.map((lineNo) => ({ lineNo })),
        command,
      ),
    );
    return split.billId;
  };
  const cancelLine = async (billId: string, lineNo: number, extra: Partial<Ask> = {}) => ({
    lineId: await lineIdOf(venue, billId, lineNo),
    action: "cancel" as const,
    ...byStaff(),
    ...extra,
  });

  it("counts the discount a split-off line carries onto its new bill", async () => {
    await setLimit(4000);
    const { billId } = await bill([{ name: "Salad", quantity: "10" }]);
    await adjust(billId, billPercent(4000));
    const moved = await moveOff(billId, [1]);

    expect(await preview(moved, billPercent(4000))).toMatchObject({
      reduction: "24.00",
      needsApproval: "manager",
      overBillDiscountLimit: true,
    });
    await refusedWith(moved, billPercent(4000), "adjustment.approval_required", {
      approverRole: "manager",
    });
  });

  it("counts the discount a transferred line carries onto the bill it joins", async () => {
    await setLimit(4000);
    // €130.00 in all, so a bill holding both lines has a €52.00 limit; €40.00 is off the salads.
    const { billId } = await bill([{ name: "Salad", quantity: "10" }, { name: "Bottle" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 4000,
      ...byStaff(),
    });
    const other = await moveOff(billId, [2]);
    const command = await partyCommand(billId);
    await inTx(venue, (tx) =>
      transferItems(tx, venue.cfg, billId, other, [{ lineNo: 1 }], command),
    );

    await refusedWith(
      other,
      { action: "discount_amount", amount: "13.00", ...byStaff() },
      "adjustment.approval_required",
      { approverRole: "manager" },
    );
  });

  it("asks a manager for a cancel that leaves the bill's discount past the limit", async () => {
    await setLimit(4000);
    // €400.00 in all, €100.00 of it off the salads: 25%, under 40%. Without the bottles it is 100%.
    const { billId } = await bill([
      { name: "Salad", quantity: "10" },
      { name: "Bottle", quantity: "10" },
    ]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 10000,
      ...byStaff(),
    });

    expect(await preview(billId, await cancelLine(billId, 2))).toMatchObject({
      reduction: "300.00",
      needsApproval: "manager",
      overBillDiscountLimit: true,
    });
    await refusedWith(billId, await cancelLine(billId, 2), "adjustment.approval_required", {
      approverRole: "manager",
    });
    await adjust(billId, await cancelLine(billId, 2, { approver: MANAGER_PIN() }));
    expect((await recordedOn(billId)).at(-1)).toMatchObject({
      action: "cancel",
      approvedBy: venue.managerId,
    });
  });

  it("asks nobody for a cancel that leaves the bill's discount share where it was", async () => {
    await setLimit(4000);
    // 40% off every line, at the limit: cancelling the bottle leaves the salads at 40% too.
    const even = await bill([{ name: "Salad", quantity: "10" }, { name: "Bottle" }]);
    await adjust(even.billId, billPercent(4000));
    expect(await preview(even.billId, await cancelLine(even.billId, 2))).toMatchObject({
      needsApproval: null,
      overBillDiscountLimit: false,
    });
    await adjust(even.billId, await cancelLine(even.billId, 2));

    // 60% off every line, which a manager applied: past the limit, but the cancel does not raise it.
    const approved = await bill([{ name: "Salad", quantity: "10" }, { name: "Bottle" }]);
    await adjust(approved.billId, billPercent(6000, { operatorId: venue.managerId }));
    await adjust(approved.billId, await cancelLine(approved.billId, 2));

    // A cancel that empties the bill leaves no share to measure.
    const alone = await bill([{ name: "Salad", quantity: "10" }]);
    await adjust(alone.billId, billPercent(6000, { operatorId: venue.managerId }));
    await adjust(alone.billId, await cancelLine(alone.billId, 1));
    expect((await recordedOn(alone.billId)).map((row) => [row.action, row.approvedBy])).toEqual([
      ["discount_percent", null],
      ["cancel", null],
    ]);
  });

  it("asks nobody for part of a weighed line cancelled at the same exact share, however its totals round", async () => {
    await setLimit(4000);
    const { billId } = await bill([{ name: "Fish", quantity: "1.001" }]);
    const lineId = await lineIdOf(venue, billId, 1);
    await adjust(billId, {
      lineId,
      action: "discount_percent",
      percentBp: 5000,
      operatorId: venue.managerId,
    });
    // €6.50 off €12.99 a kilo on either weight; the rounded totals would read €6.50 of €13.00, then
    // €6.50 of €12.99, a share that rises.
    expect(await priced(billId)).toEqual([["Fish", "1.001", "6.49", "12.99", "6.50"]]);
    const cancel = await cancelLine(billId, 1, { quantity: "0.001" });

    expect(await preview(billId, cancel)).toMatchObject({
      needsApproval: null,
      overBillDiscountLimit: false,
    });
    await adjust(billId, cancel);
    expect((await recordedOn(billId)).map((row) => [row.action, row.approvedBy])).toEqual([
      ["discount_percent", null],
      ["cancel", null],
    ]);
  });

  it("asks nobody for a cancel that leaves the share the bill shows unchanged, though the exact share rises", async () => {
    await setLimit(4000);
    const { billId } = await bill([{ name: "Fish", quantity: "1.001" }, { name: "Salad" }]);
    for (const lineNo of [1, 2]) {
      await adjust(billId, {
        lineId: await lineIdOf(venue, billId, lineNo),
        action: "discount_percent",
        percentBp: 5000,
        operatorId: venue.managerId,
      });
    }
    // Shown, €11.50 of €23.00 becomes €6.50 of €13.00 without the salad: 50% both. Exactly,
    // €11.5065 of €23.00299 becomes €6.5065 of €13.00299, a rise.
    expect(await priced(billId)).toEqual([
      ["Fish", "1.001", "6.49", "12.99", "6.50"],
      ["Salad", "1.000", "5.00", "10.00", "5.00"],
    ]);
    const cancel = await cancelLine(billId, 2);

    expect(await preview(billId, cancel)).toMatchObject({
      needsApproval: null,
      overBillDiscountLimit: false,
    });
    await adjust(billId, cancel);
    expect((await recordedOn(billId)).map((row) => [row.action, row.approvedBy])).toEqual([
      ["discount_percent", null],
      ["discount_percent", null],
      ["cancel", null],
    ]);
  });

  it("measures a discount in the cents the bill shows, to the last cent the limit allows", async () => {
    await setLimit(4000);
    // The bill shows €43.00 before adjustments, so the limit is €17.20, and €6.50 off the fish:
    // €10.70 more reaches the limit exactly. Measured exactly, the €6.5065 off €43.00299 would refuse
    // it.
    const { billId } = await bill([{ name: "Fish", quantity: "1.001" }, { name: "Bottle" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 5000,
      operatorId: venue.managerId,
    });
    expect(await priced(billId)).toEqual([
      ["Fish", "1.001", "6.49", "12.99", "6.50"],
      ["Bottle", "1.000", "30.00", null, "30.00"],
    ]);
    const bottle = await lineIdOf(venue, billId, 2);
    const off = (amount: string): Ask => ({
      lineId: bottle,
      action: "discount_amount",
      amount,
      ...byStaff(),
    });

    expect(await preview(billId, off("10.71"))).toMatchObject({
      needsApproval: "manager",
      overBillDiscountLimit: true,
    });
    await refusedWith(billId, off("10.71"), "adjustment.approval_required", {
      approverRole: "manager",
    });
    expect(await preview(billId, off("10.70"))).toMatchObject({
      needsApproval: null,
      overBillDiscountLimit: false,
    });
    await adjust(billId, off("10.70"));
    expect((await recordedOn(billId)).map((row) => row.approvedBy)).toEqual([null, null]);
  });

  it("judges a cancel past the limit in the cents the bill shows, not the exact prices", async () => {
    await setLimit(4000);
    // €45.00 shown with the water, €17.20 off it; without the water €17.20 of €43.00 is the limit
    // exactly. Measured exactly, €17.2065 of €43.00299 would be past it and higher than before.
    const { billId } = await bill([
      { name: "Fish", quantity: "1.001" },
      { name: "Bottle" },
      { name: "Water" },
    ]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 5000,
      operatorId: venue.managerId,
    });
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 2),
      action: "discount_amount",
      amount: "10.70",
      ...byStaff(),
    });
    expect(await priced(billId)).toEqual([
      ["Fish", "1.001", "6.49", "12.99", "6.50"],
      ["Bottle", "1.000", "19.30", "30.00", "19.30"],
      ["Water", "1.000", "2.00", null, "2.00"],
    ]);
    const cancel = await cancelLine(billId, 3);

    expect(await preview(billId, cancel)).toMatchObject({
      needsApproval: null,
      overBillDiscountLimit: false,
    });
    await adjust(billId, cancel);
    expect((await recordedOn(billId)).map((row) => [row.action, row.approvedBy])).toEqual([
      ["discount_percent", null],
      ["discount_amount", null],
      ["cancel", null],
    ]);
  });

  it("allows a whole weighed line off at a 100% limit, though its total rounds up", async () => {
    await setLimit(10000);
    // €13.03 on the bill, €13.02897 exactly: the whole of what the bill shows is 100% of it.
    const { billId } = await bill([{ name: "Fish", quantity: "1.003" }]);
    expect(await priced(billId)).toEqual([["Fish", "1.003", "12.99", null, "13.03"]]);
    const all: Ask = {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 10000,
      ...byStaff(),
    };

    expect(await preview(billId, all)).toMatchObject({
      reduction: "13.03",
      needsApproval: null,
      overBillDiscountLimit: false,
    });
    await adjust(billId, all);
    expect((await recordedOn(billId)).map((row) => row.approvedBy)).toEqual([null]);
  });

  it("leaves out a dish comped whole with its extras, and the part of a dish comped", async () => {
    await setLimit(4000);
    // €110.50 in all, limit €44.20: the €10.50 pizza and olive comped, then €43.00 off the salads,
    // which the olive's €1.50 alone would take past the limit.
    const whole = await bill([
      { name: "Pizza", olives: 1 },
      { name: "Salad", quantity: "10" },
    ]);
    await adjust(whole.billId, {
      lineId: await lineIdOf(venue, whole.billId, 1),
      action: "comp",
      ...byStaff(),
    });
    const salads = await lineIdOf(venue, whole.billId, 3);
    await adjust(whole.billId, {
      lineId: salads,
      action: "discount_amount",
      amount: "43.00",
      ...byStaff(),
    });

    // €150.00 in all, limit €60.00: one of two steaks comped (€25.00), then €40.00 off the salads.
    const part = await bill([
      { name: "Steak", quantity: "2" },
      { name: "Salad", quantity: "10" },
    ]);
    await adjust(part.billId, {
      lineId: await lineIdOf(venue, part.billId, 1),
      action: "comp",
      quantity: "1",
      ...byStaff(),
    });
    await adjust(part.billId, {
      lineId: await lineIdOf(venue, part.billId, 2),
      action: "discount_percent",
      percentBp: 4000,
      ...byStaff(),
    });
    for (const billId of [whole.billId, part.billId]) {
      expect((await recordedOn(billId)).map((row) => row.approvedBy)).toEqual([null, null]);
    }
  });

  it("leaves out an extra comped on its own, and the olive carved off with a pizza comped", async () => {
    await setLimit(4000);
    // €110.50 in all, limit €44.20: the olive comped, then €44.20 off the salads.
    const extra = await bill([
      { name: "Pizza", olives: 1 },
      { name: "Salad", quantity: "10" },
    ]);
    await adjust(extra.billId, {
      lineId: await lineIdOf(venue, extra.billId, 2),
      action: "comp",
      ...byStaff(),
    });
    const extraAsk = {
      lineId: await lineIdOf(venue, extra.billId, 3),
      action: "discount_amount" as const,
      amount: "44.20",
      ...byStaff(),
    };

    // €121.00 in all, limit €48.40: one of two pizzas comped with its olive, then €48.40 off the
    // salads, which the carved olive's €1.50 alone would take past the limit.
    const carved = await bill([
      { name: "Pizza", quantity: "2", olives: 1 },
      { name: "Salad", quantity: "10" },
    ]);
    await adjust(carved.billId, {
      lineId: await lineIdOf(venue, carved.billId, 1),
      action: "comp",
      quantity: "1",
      ...byStaff(),
    });
    const carvedAsk = {
      lineId: await lineIdOf(venue, carved.billId, 3),
      action: "discount_amount" as const,
      amount: "48.40",
      ...byStaff(),
    };

    for (const [billId, ask] of [
      [extra.billId, extraAsk],
      [carved.billId, carvedAsk],
    ] as const) {
      expect(await preview(billId, ask)).toMatchObject({
        needsApproval: null,
        overBillDiscountLimit: false,
      });
      await adjust(billId, ask);
      expect((await recordedOn(billId)).map((row) => row.approvedBy)).toEqual([null, null]);
    }
  });

  it("leaves out the copy of a comped olive a later discount carved off with its pizza", async () => {
    await setLimit(800);
    // €23.50 in all, limit €1.88: the €3.00 olives comped, then 10% off 1 pizza, whose carved part
    // takes a copy of one comped olive, then 10% off the bread: €0.90 and €0.25 of discount.
    const { billId } = await bill([{ name: "Pizza", quantity: "2", olives: 1 }, { name: "Bread" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 2),
      action: "comp",
      ...byStaff(),
    });
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      quantity: "1",
      ...billPercent(1000),
    });
    const ask = { lineId: await lineIdOf(venue, billId, 3), ...billPercent(1000) };

    expect(await preview(billId, ask)).toMatchObject({
      reduction: "0.25",
      needsApproval: null,
      overBillDiscountLimit: false,
    });
  });

  describe("an extra added at full price to a dish given away whole", () => {
    /** A held Pizza and Bread ×4, the Pizza comped whole, then Olives added to it at €1.50:
     * €20.50 before adjustments. Answers the bill and the Olives' row. */
    async function compedPizzaWithOlivesAdded() {
      const { billId } = await bill([{ name: "Pizza" }, { name: "Bread", quantity: "4" }], {
        release: "hold",
      });
      const pizza = await lineIdOf(venue, billId, 1);
      await adjust(billId, { lineId: pizza, action: "comp", ...byStaff() });
      await inTx(venue, async (tx) =>
        updateOrderLine(
          tx,
          venue.cfg,
          billId,
          1,
          {
            extras: [
              { listId: venue.pizzaExtras, picks: [{ productId: venue.olivesId, quantity: 1 }] },
            ],
          },
          await readOrderRevision(tx, billId),
          venue.staffId,
        ),
      );
      const olives = (await rowsOf(venue, billId)).find((row) => row.parentLineId === pizza)!;
      expect(olives.unitPriceGross).toBe("1.50");
      return { billId, pizza, olives: olives.id };
    }

    // Limit 20% of €20.50 is €4.10. 30% off the Bread is €3.00: with the Olives' €1.50 of
    // discount that is €4.50, past the limit; without it €3.00, under it.
    const breadAsk = async (billId: string) => ({
      lineId: (await rowsOf(venue, billId)).find((row) => row.name === "Bread")!.id,
      ...billPercent(3000),
    });

    it("counts a discount on the added Olives against the limit", async () => {
      await setLimit(2000);
      const { billId, olives } = await compedPizzaWithOlivesAdded();
      await adjust(billId, { lineId: olives, ...billPercent(10000) });

      expect(await preview(billId, await breadAsk(billId))).toMatchObject({
        reduction: "3.00",
        needsApproval: "manager",
        overBillDiscountLimit: true,
      });
    });

    it("counts a discount on the whole given-away Pizza, which lands on its added Olives", async () => {
      await setLimit(2000);
      const { billId, pizza } = await compedPizzaWithOlivesAdded();
      await adjust(billId, { lineId: pizza, ...billPercent(10000) });
      expect(
        Object.fromEntries((await rowsOf(venue, billId)).map((row) => [row.name, row.lineTotal])),
      ).toEqual({ Pizza: "0.00", Bread: "10.00", Olives: "0.00" });

      expect(await preview(billId, await breadAsk(billId))).toMatchObject({
        reduction: "3.00",
        needsApproval: "manager",
        overBillDiscountLimit: true,
      });
    });
  });

  it("still counts a line discounted to nothing", async () => {
    await setLimit(4000);
    // €40.00 in all, limit €16.00: €10.00 off the salad, which is then free, and €6.01 more.
    const { billId } = await bill([{ name: "Salad" }, { name: "Bottle" }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 10000,
      ...byStaff(),
    });
    await refusedWith(
      billId,
      { action: "discount_amount", amount: "6.01", ...byStaff() },
      "adjustment.approval_required",
      { approverRole: "manager" },
    );
  });

  it("counts a row priced above its list price as no discount, answering rather than failing", async () => {
    await setLimit(4000);
    const { billId } = await bill([{ name: "Salad", quantity: "10" }, { name: "Bottle" }]);
    // Written by hand: no product path is known to price a row above its list price.
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ listUnitPriceGross: 2000 })
        .where(and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.lineNo, 2))),
    );

    expect(await preview(billId, billPercent(1000))).toMatchObject({
      needsApproval: null,
      overBillDiscountLimit: false,
    });
    await adjust(billId, billPercent(1000));
    expect((await recordedOn(billId)).map((row) => row.approvedBy)).toEqual([null]);
  });

  it("counts a comped dish as discount on a bill it has moved to, erring toward a manager", async () => {
    await setLimit(4000);
    const { billId } = await bill([
      { name: "Burger" },
      { name: "Salad", quantity: "10" },
      { name: "Bottle" },
    ]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "comp",
      ...byStaff(),
    });
    // The new bill is €112.00 before adjustments, limit €44.80; the €12.00 comp is not proven there.
    const moved = await moveOff(billId, [1, 2]);

    await refusedWith(
      moved,
      { action: "discount_amount", amount: "33.00", ...byStaff() },
      "adjustment.approval_required",
      { approverRole: "manager" },
    );
  });
});

describe("a cancel (menus §11.5)", () => {
  it("cancels a fired, not-started Steak with a VOID notice and slip, and keeps its snapshot after the row is gone", async () => {
    const { billId } = await bill([{ name: "Steak" }, { name: "Bread" }]);
    const jobs = await printJobCount();

    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "cancel",
      reasonId: venue.reasonId.mistake,
      note: "Wrong table",
    });

    expect(await priced(billId)).toEqual([["Bread", "1.000", "2.50", null, "2.50"]]);
    expect((await noticesAtStation()).slice(-1)).toEqual([
      { kind: "void", lineName: "CHULETA", quantity: "1.000", wasStarted: false },
    ]);
    expect(await printJobCount()).toBe(jobs + 1);
    expect((await recordedOn(billId))[0]).toMatchObject({
      action: "cancel",
      stage: "fired",
      reduction: 2500,
      nominalValue: 2500,
      lineName: "Steak",
      lineQuantity: 1000,
      lineListUnitPrice: 2500,
      note: "Wrong table",
    });
  });

  it("records a cancel of a comped line as no reduction and its list value", async () => {
    const { billId } = await bill([{ name: "Steak" }]);
    const steak = await lineIdOf(venue, billId, 1);
    await adjust(billId, { lineId: steak, action: "comp" });

    await adjust(billId, { lineId: steak, action: "cancel" });

    expect((await recordedOn(billId))[1]).toMatchObject({
      action: "cancel",
      beforeAmount: 0,
      reduction: 0,
      nominalValue: 2500,
      lineListUnitPrice: 2500,
    });
  });

  it("cancels part of a line as a void of that quantity", async () => {
    const { billId } = await bill([{ name: "Steak", quantity: "3" }]);

    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "cancel",
      quantity: "2",
    });

    expect(await priced(billId)).toEqual([["Steak", "1.000", "25.00", null, "25.00"]]);
    expect((await recordedOn(billId))[0]).toMatchObject({ quantity: 2000, reduction: 5000 });
  });

  it("cancels 1 of Pizza ×2 with two olives each: the olives follow the dish, the kitchen is told, and the bill's drop is recorded", async () => {
    const { billId } = await bill([{ name: "Pizza", quantity: "2", olives: 2 }]);
    const pizza = await lineIdOf(venue, billId, 1);
    const ticket = await ticketOf(venue, billId, 1);
    const before = total(await rowsOf(venue, billId));
    const ask = { lineId: pizza, action: "cancel", quantity: "1" } as const;
    const previewed = await preview(billId, ask);

    await adjust(billId, ask);

    expect(await priced(billId)).toEqual([
      ["Pizza", "1.000", "9.00", null, "9.00"],
      ["Olives", "2.000", "1.50", null, "3.00"],
    ]);
    const [item] = await inTx(venue, (tx) =>
      tx
        .select({ quantity: ticketItems.quantity })
        .from(ticketItems)
        .where(eq(ticketItems.id, ticket.id)),
    );
    expect(item!.quantity).toBe(1000);
    expect((await noticesAtStation()).slice(-1)).toEqual([
      { kind: "void", lineName: "PIZZA", quantity: "1.000", wasStarted: false },
    ]);
    const drop = subtractDecimal(decimal(before), decimal(total(await rowsOf(venue, billId))));
    expect(drop).toBe("12.00");
    expect((await recordedOn(billId))[0]).toMatchObject({
      action: "cancel",
      quantity: 1000,
      lineQuantity: 2000,
      beforeAmount: 1200,
      afterAmount: 0,
      reduction: 1200,
      nominalValue: 1200,
    });
    expect(previewed).toMatchObject({
      reduction: "12.00",
      nominalValue: "12.00",
      lines: [{ lineId: pizza, reduction: "12.00", rows: [] }],
    });
  });

  it("records a part cancel of a discounted Pizza with olives at what the bill loses, and its list value as nominal", async () => {
    const { billId } = await bill([{ name: "Pizza", quantity: "3", olives: 1 }]);
    const pizza = await lineIdOf(venue, billId, 1);
    await adjust(billId, { lineId: pizza, action: "discount_percent", percentBp: 1000 });
    expect(await priced(billId)).toEqual([
      ["Pizza", "3.000", "8.10", "9.00", "24.30"],
      ["Olives", "3.000", "1.35", "1.50", "4.05"],
    ]);
    const before = total(await rowsOf(venue, billId));
    const ask = { lineId: pizza, action: "cancel", quantity: "1" } as const;
    const previewed = await preview(billId, ask);

    await adjust(billId, ask);

    expect(await priced(billId)).toEqual([
      ["Pizza", "2.000", "8.10", "9.00", "16.20"],
      ["Olives", "2.000", "1.35", "1.50", "2.70"],
    ]);
    const drop = subtractDecimal(decimal(before), decimal(total(await rowsOf(venue, billId))));
    expect(drop).toBe("9.45");
    expect((await recordedOn(billId))[1]).toMatchObject({
      action: "cancel",
      quantity: 1000,
      beforeAmount: 945,
      afterAmount: 0,
      reduction: 945,
      nominalValue: 1050,
    });
    expect(previewed).toMatchObject({ reduction: "9.45", nominalValue: "10.50" });
  });
});

describe("an extra on its own (B11d)", () => {
  it("comps the olives alone: the bill drops by their price and the pizza stays as it was", async () => {
    const { billId } = await bill([{ name: "Pizza", olives: 1 }]);
    const olives = await lineIdOf(venue, billId, 2);
    const ask = { lineId: olives, action: "comp" } as const;
    const previewed = await preview(billId, ask);

    await adjust(billId, ask);

    expect(await priced(billId)).toEqual([
      ["Pizza", "1.000", "9.00", null, "9.00"],
      ["Olives", "1.000", "0.00", "1.50", "0.00"],
    ]);
    expect(await recordedOn(billId)).toMatchObject([
      {
        lineId: olives,
        action: "comp",
        lineName: "Olives",
        lineQuantity: 1000,
        lineListUnitPrice: 150,
        creditedTo: venue.staffId,
        quantity: 1000,
        beforeAmount: 150,
        afterAmount: 0,
        reduction: 150,
        nominalValue: 150,
        stage: "fired",
        splits: [],
      },
    ]);
    expect(previewed).toEqual({
      reduction: "1.50",
      nominalValue: "1.50",
      needsApproval: null,
      overBillDiscountLimit: false,
      lines: [
        {
          lineId: olives,
          lineNo: 2,
          reduction: "1.50",
          rows: [{ quantity: "1.000", unitGross: "0.00" }],
        },
      ],
    });
  });

  it("discounts the olives of Pizza ×2 alone, leaving the pizzas at their price", async () => {
    const { billId } = await bill([{ name: "Pizza", quantity: "2", olives: 1 }]);
    const olives = await lineIdOf(venue, billId, 2);
    const ask = { lineId: olives, action: "discount_percent", percentBp: 1000 } as const;
    const previewed = await preview(billId, ask);

    await adjust(billId, ask);

    expect(await priced(billId)).toEqual([
      ["Pizza", "2.000", "9.00", null, "18.00"],
      ["Olives", "2.000", "1.35", "1.50", "2.70"],
    ]);
    expect(await recordedOn(billId)).toMatchObject([
      {
        lineId: olives,
        action: "discount_percent",
        percentBp: 1000,
        quantity: 2000,
        lineQuantity: 2000,
        beforeAmount: 300,
        afterAmount: 270,
        reduction: 30,
        nominalValue: 300,
      },
    ]);
    expect(previewed).toMatchObject({ reduction: "0.30", nominalValue: "3.00" });
  });

  it("cancels the olives of a fired pizza alone: they have no kitchen item of their own, so the pizza's station gets one correction", async () => {
    const { billId } = await bill([{ name: "Pizza", olives: 1 }, { name: "Bread" }]);
    const olives = await lineIdOf(venue, billId, 2);
    const ticket = await ticketOf(venue, billId, 1);
    const ownItems = await inTx(venue, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, olives)),
    );
    expect(ownItems).toEqual([]);
    const notices = await noticesAtStation();
    const jobs = await printJobCount();
    const ask = { lineId: olives, action: "cancel" } as const;
    const previewed = await preview(billId, ask);

    await adjust(billId, ask);

    expect(await priced(billId)).toEqual([
      ["Pizza", "1.000", "9.00", null, "9.00"],
      ["Bread", "1.000", "2.50", null, "2.50"],
    ]);
    expect(await noticesAtStation()).toEqual([
      ...notices,
      expect.objectContaining({ kind: "changed" }),
    ]);
    expect(await printJobCount()).toBe(jobs + 1);
    const [item] = await inTx(venue, (tx) =>
      tx
        .select({ quantity: ticketItems.quantity })
        .from(ticketItems)
        .where(eq(ticketItems.id, ticket.id)),
    );
    expect(item!.quantity).toBe(1000);
    expect(await recordedOn(billId)).toMatchObject([
      {
        lineId: olives,
        action: "cancel",
        lineName: "Olives",
        quantity: 1000,
        beforeAmount: 150,
        afterAmount: 0,
        reduction: 150,
        nominalValue: 150,
        stage: "fired",
      },
    ]);
    expect(previewed).toEqual({
      reduction: "1.50",
      nominalValue: "1.50",
      needsApproval: null,
      overBillDiscountLimit: false,
      lines: [{ lineId: olives, lineNo: 2, reduction: "1.50", rows: [] }],
    });
  });

  it("records the stage of the dish the extra belongs to, not one of its own", async () => {
    const dish = await bill([{ name: "Pizza", olives: 1 }]);
    const extra = await bill([{ name: "Pizza", olives: 1 }]);
    for (const { billId } of [dish, extra]) {
      await inTx(venue, (tx) => recallLines(tx, venue.cfg, billId, [1]));
    }

    await adjust(dish.billId, { lineId: await lineIdOf(venue, dish.billId, 1), action: "comp" });
    await adjust(extra.billId, { lineId: await lineIdOf(venue, extra.billId, 2), action: "comp" });

    const [dishStage, extraStage] = await Promise.all(
      [dish, extra].map(async ({ billId }) => (await recordedOn(billId))[0]!.stage),
    );
    expect(dishStage).toBe("unsent");
    expect(extraStage).toBe(dishStage);
  });

  it.each(["cancel", "discount_percent"] as const)(
    "refuses a %s of part of the olives, whose quantity follows the pizza's",
    async (action) => {
      const { billId } = await bill([{ name: "Pizza", quantity: "2", olives: 1 }]);
      const ask = {
        lineId: await lineIdOf(venue, billId, 2),
        action,
        quantity: "1",
        ...(action === "discount_percent" ? { percentBp: 1000 } : {}),
      };
      await expect(preview(billId, ask)).rejects.toMatchObject({
        code: "adjustment.quantity_invalid",
      });
      await refusedWith(billId, ask, "adjustment.quantity_invalid", {
        workingOrderId: billId,
        lineNo: 2,
        quantity: "1",
      });
    },
  );

  it("takes all of the olives when the quantity asked is all of them", async () => {
    const { billId } = await bill([{ name: "Pizza", quantity: "2", olives: 1 }]);

    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 2),
      action: "comp",
      quantity: "2",
    });

    expect(await priced(billId)).toEqual([
      ["Pizza", "2.000", "9.00", null, "18.00"],
      ["Olives", "2.000", "0.00", "1.50", "0.00"],
    ]);
    expect((await recordedOn(billId))[0]).toMatchObject({ quantity: 2000, reduction: 300 });
  });

  it("asks the reason's approver for a staff member's comp of the olives", async () => {
    const { billId } = await bill([{ name: "Pizza", olives: 1 }]);
    const ask = {
      lineId: await lineIdOf(venue, billId, 2),
      action: "comp" as const,
      reasonId: venue.reasonId.complaint,
      operatorId: venue.staffId,
    };

    expect(await preview(billId, ask)).toMatchObject({ needsApproval: "manager" });
    await refusedWith(billId, ask, "adjustment.approval_required", { approverRole: "manager" });
    await adjust(billId, { ...ask, approver: { personId: venue.managerId, pin: PINS.manager } });
    expect((await recordedOn(billId))[0]).toMatchObject({
      requestedBy: venue.staffId,
      approvedBy: venue.managerId,
      reduction: 150,
    });
  });

  // Complaint caps the percentage it takes off one line at 50%.
  const percent = (percentBp: number) => ({
    action: "discount_percent" as const,
    percentBp,
    reasonId: venue.reasonId.complaint,
  });

  it("counts the pizza's percentage against its olives discounted afterwards", async () => {
    const { billId } = await bill([{ name: "Pizza", olives: 1 }]);
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), ...percent(3000) });
    const olives = await lineIdOf(venue, billId, 2);

    await refusedWith(billId, { lineId: olives, ...percent(3000) }, "adjustment.over_limit");
    await adjust(billId, { lineId: olives, ...percent(2000) });
  });

  it("counts the olives' own percentage against the pizza discounted afterwards", async () => {
    const { billId } = await bill([{ name: "Pizza", olives: 1 }]);
    await adjust(billId, { lineId: await lineIdOf(venue, billId, 2), ...percent(3000) });
    const pizza = await lineIdOf(venue, billId, 1);

    await refusedWith(billId, { lineId: pizza, ...percent(3000) }, "adjustment.over_limit");
    await adjust(billId, { lineId: pizza, ...percent(2000) });
  });
});

describe("part of a dish with extras (B11d)", () => {
  /** The bill's rows as `[name, quantity, total]`, each extra with the line number of its dish. */
  async function families(billId: string) {
    const rows = await rowsOf(venue, billId);
    const lineNoOf = new Map(rows.map((row) => [row.id, row.lineNo]));
    return rows.map((row) => [
      row.lineNo,
      row.name,
      row.quantity,
      row.lineTotal,
      row.parentLineId === null ? null : lineNoOf.get(row.parentLineId),
    ]);
  }

  it("comps 1 of Pizza ×2 with an olive each: the carved pizza and its olive at €0.00, the other at full price", async () => {
    const { billId } = await bill([{ name: "Pizza", quantity: "2", olives: 1 }]);
    const pizza = await lineIdOf(venue, billId, 1);
    const olives = await lineIdOf(venue, billId, 2);
    const ask = { lineId: pizza, action: "comp", quantity: "1" } as const;
    const previewed = await preview(billId, ask);

    await adjust(billId, ask);

    expect(await priced(billId)).toEqual([
      ["Pizza", "1.000", "9.00", "9.00", "9.00"],
      ["Olives", "1.000", "1.50", "1.50", "1.50"],
      ["Pizza", "1.000", "0.00", "9.00", "0.00"],
      ["Olives", "1.000", "0.00", "1.50", "0.00"],
    ]);
    expect(await families(billId)).toEqual([
      [1, "Pizza", "1.000", "9.00", null],
      [2, "Olives", "1.000", "1.50", 1],
      [3, "Pizza", "1.000", "0.00", null],
      [4, "Olives", "1.000", "0.00", 3],
    ]);
    const [carvedPizza, carvedOlives] = [3, 4].map((lineNo) => lineIdOf(venue, billId, lineNo));
    expect(await recordedOn(billId)).toMatchObject([
      {
        lineId: pizza,
        action: "comp",
        quantity: 1000,
        lineQuantity: 2000,
        beforeAmount: 1050,
        afterAmount: 0,
        reduction: 1050,
        nominalValue: 1050,
        splits: [
          { from: pizza, to: await carvedPizza },
          { from: olives, to: await carvedOlives },
        ],
      },
    ]);
    expect(previewed).toEqual({
      reduction: "10.50",
      nominalValue: "10.50",
      needsApproval: null,
      overBillDiscountLimit: false,
      lines: [
        {
          lineId: pizza,
          lineNo: 1,
          reduction: "9.00",
          rows: [{ quantity: "1.000", unitGross: "0.00" }],
        },
        {
          lineId: olives,
          lineNo: 2,
          reduction: "1.50",
          rows: [{ quantity: "1.000", unitGross: "0.00" }],
        },
      ],
    });
    // The kitchen still makes two pizzas: one ticket item each.
    const items = await inTx(venue, (tx) =>
      tx
        .select({ lineId: ticketItems.workingOrderLineId, quantity: ticketItems.quantity })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, billId)),
    );
    expect(items).toEqual(
      expect.arrayContaining([
        { lineId: pizza, quantity: 1000 },
        { lineId: await carvedPizza, quantity: 1000 },
      ]),
    );
    expect(items).toHaveLength(2);
  });

  it("discounts 10% off 1 of Pizza ×3 with two olives each: the carved pizza and its two olives take it", async () => {
    const { billId } = await bill([{ name: "Pizza", quantity: "3", olives: 2 }]);
    const pizza = await lineIdOf(venue, billId, 1);
    const ask = {
      lineId: pizza,
      action: "discount_percent",
      percentBp: 1000,
      quantity: "1",
    } as const;
    const previewed = await preview(billId, ask);

    await adjust(billId, ask);

    expect(await priced(billId)).toEqual([
      ["Pizza", "2.000", "9.00", "9.00", "18.00"],
      ["Olives", "4.000", "1.50", "1.50", "6.00"],
      ["Pizza", "1.000", "8.10", "9.00", "8.10"],
      ["Olives", "2.000", "1.35", "1.50", "2.70"],
    ]);
    expect((await families(billId)).map((row) => row[4])).toEqual([null, 1, null, 3]);
    expect(await recordedOn(billId)).toMatchObject([
      {
        action: "discount_percent",
        quantity: 1000,
        lineQuantity: 3000,
        beforeAmount: 1200,
        afterAmount: 1080,
        reduction: 120,
        nominalValue: 1200,
      },
    ]);
    expect(previewed).toMatchObject({ reduction: "1.20", nominalValue: "12.00" });
  });

  // An extra's quantity is its dish's times a whole count a dish on every path known to store one,
  // so a part of whole dishes carries whole extras and the carved and kept rows add up to the rows
  // they came from.
  it.each([
    { what: "comp", ask: { action: "comp" } },
    { what: "€1.00 off", ask: { action: "discount_amount", amount: "1.00" } },
  ] as const)(
    "keeps the bill exact to the cent with a $what of 1 of Pizza ×3 with an olive each",
    async ({ ask }) => {
      const { billId } = await bill([{ name: "Pizza", quantity: "3", olives: 1 }]);
      const before = total(await rowsOf(venue, billId));
      expect(before).toBe("31.50");
      const full = { lineId: await lineIdOf(venue, billId, 1), quantity: "1", ...ask };
      const previewed = await preview(billId, full);

      await adjust(billId, full);

      const rows = await rowsOf(venue, billId);
      expect(rows.map((row) => [row.name, row.quantity])).toEqual([
        ["Pizza", "2.000"],
        ["Olives", "2.000"],
        ["Pizza", "1.000"],
        ["Olives", "1.000"],
      ]);
      expect(rows.slice(0, 2).map((row) => row.lineTotal)).toEqual(["18.00", "3.00"]);
      const [recorded] = await recordedOn(billId);
      const reduction = toScale(decimal(String(recorded!.reduction / 100)), 2);
      expect(previewed.reduction).toBe(reduction);
      expect(total(rows)).toBe(toScale(subtractDecimal(decimal(before), decimal(reduction)), 2));
      expect(total(rows.slice(2))).toBe(
        toScale(subtractDecimal(decimal("10.50"), decimal(reduction)), 2),
      );
    },
  );

  /** Pizza ×3 with 2 olives, written by hand: no product path is known to store an extra that is
   * not a whole count a dish. */
  async function unevenOlives() {
    const { billId } = await bill([{ name: "Pizza", quantity: "3", olives: 1 }]);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ quantity: 2000, lineTotal: 300 })
        .where(and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.lineNo, 2))),
    );
    expect(total(await rowsOf(venue, billId))).toBe("30.00");
    return billId;
  }

  it("refuses part of a dish whose extra is not a whole count a dish, rather than let the bill drift", async () => {
    const billId = await unevenOlives();
    const ask = {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
      quantity: "1",
    } as const;
    const refusal = { workingOrderId: billId, lineNo: 1, quantity: "1" };

    await expect(preview(billId, ask)).rejects.toMatchObject({
      code: "adjustment.quantity_invalid",
      params: refusal,
    });
    await refusedWith(billId, ask, "adjustment.quantity_invalid", refusal);
  });

  it("has splitLinesWithinOrder refuse the same split, for a caller that did not check first", async () => {
    const billId = await unevenOlives();
    const before = await stateOf(billId);

    await expect(
      inTx(venue, (tx) =>
        splitLinesWithinOrder(tx, venue.cfg, billId, [{ lineNo: 1, quantity: "1" }], {
          splitExtras: true,
        }),
      ),
    ).rejects.toMatchObject({
      code: "tab.transfer_modifier_line",
      params: { tabId: billId, lineNo: 1 },
    });
    expect(await stateOf(billId)).toEqual(before);
  });

  it("prints the carved pizza's olives on the VOID slip when the carved pizza is cancelled", async () => {
    const { billId } = await bill([{ name: "Pizza", quantity: "2", olives: 1 }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "comp",
      quantity: "1",
    });
    const jobs = await printJobCount();

    await adjust(billId, { lineId: await lineIdOf(venue, billId, 3), action: "cancel" });

    expect(await priced(billId)).toEqual([
      ["Pizza", "1.000", "9.00", "9.00", "9.00"],
      ["Olives", "1.000", "1.50", "1.50", "1.50"],
    ]);
    expect((await noticesAtStation()).slice(-1)).toEqual([
      { kind: "void", lineName: "PIZZA", quantity: "1.000", wasStarted: false },
    ]);
    expect(await printJobCount()).toBe(jobs + 1);
    const slip = await lastKitchenSlip();
    const dish = slip.indexOf("1.000 x PIZZA");
    expect(slip).toContain("*** VOID ***");
    expect(dish).toBeGreaterThanOrEqual(0);
    expect(slip[dish + 1]).toBe("  + Olives");
  });

  it("prints the comp beneath the carved pizza on the receipt, the other pizza and olive as sold", async () => {
    const { billId } = await bill([{ name: "Pizza", quantity: "2", olives: 1 }]);
    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "comp",
      quantity: "1",
    });

    const ticket = await payWorkingOrder(
      { db: venue.db, backend: venue.backend, clock: venue.clock },
      venue.cfg,
      { id: billId, tender: { method: "cash", amount: "10.50" }, lines: [] },
    );

    expect(
      ticket.lines.map((line) => [line.gross, line.listGross, line.adjustments, line.parentLineNo]),
    ).toEqual([
      ["9.00", undefined, undefined, null],
      ["1.50", undefined, undefined, 1],
      ["0.00", "9.00", [{ kind: "comp", amount: "10.50" }], null],
      ["0.00", "1.50", undefined, 3],
    ]);
  });

  it("leaves each person's sales in the adjustment report as they were, and counts the comp once", async () => {
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const report = () =>
      inTx(venue, (tx) =>
        computeAdjustmentReport(tx, {
          fromBusinessDay: day(-2),
          toBusinessDay: day(2),
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        }),
      );
    const staffOf = (answer: Awaited<ReturnType<typeof report>>) =>
      answer.people.find((person) => person.personId === venue.staffId);
    const { billId } = await bill([{ name: "Pizza", quantity: "2", olives: 1 }]);
    const before = await report();

    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "comp",
      quantity: "1",
    });

    const after = await report();
    expect(after.overall.sales).toBe(before.overall.sales);
    expect(staffOf(after)?.sales).toBe(staffOf(before)?.sales);
    expect(after.overall.byAction.comp.count).toBe(before.overall.byAction.comp.count + 1);
    expect(
      toScale(
        subtractDecimal(
          after.overall.byAction.comp.reduction,
          before.overall.byAction.comp.reduction,
        ),
        2,
      ),
    ).toBe("10.50");
  });
});

describe("what an adjustment reads (B11d)", () => {
  /** `tx`, counting the raw statements run on it and the reads of a row's line number alone. */
  function counting(tx: Transaction) {
    const counts = { statements: 0, lineNoReads: 0 };
    const counted = new Proxy(tx, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target);
        if (prop === "execute") {
          return (...args: Parameters<Transaction["execute"]>) => {
            counts.statements += 1;
            return target.execute(...args);
          };
        }
        if (prop === "select") {
          return (...args: Parameters<Transaction["select"]>) => {
            const [fields] = args as unknown[];
            if (fields !== undefined && Object.keys(fields as object).join() === "lineNo") {
              counts.lineNoReads += 1;
            }
            return target.select(...args);
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return { tx: counted, counts };
  }

  async function previewCounted(billId: string, ask: Ask) {
    return inTx(venue, async (tx) => {
      const { submissionId, approver, ...args } = await argsFor(tx, billId, ask);
      void submissionId;
      void approver;
      const probe = counting(tx);
      await previewAdjustment(probe.tx, args, venue.venueLocale);
      return probe.counts;
    });
  }

  async function adjustCounted(billId: string, ask: Ask) {
    return inTx(venue, async (tx) => {
      const args = await argsFor(tx, billId, ask);
      const probe = counting(tx);
      await applyAdjustment(probe.tx, venue.cfg, args, venue.venueLocale);
      return probe.counts;
    });
  }

  it("reads a percentage's priors for a dish with an extra in as many statements as for one without", async () => {
    const burger = await bill([{ name: "Burger" }]);
    const pizza = await bill([{ name: "Pizza", olives: 1 }]);
    const ask = (billId: string) =>
      lineIdOf(venue, billId, 1).then((lineId) => ({
        lineId,
        action: "discount_percent" as const,
        percentBp: 1000,
      }));

    const plain = await previewCounted(burger.billId, await ask(burger.billId));
    const withExtra = await previewCounted(pizza.billId, await ask(pizza.billId));

    expect(withExtra.statements).toBe(plain.statements);
  });

  it("looks up no line number for the rows it carves off a dish, however many extras go with it", async () => {
    const steak = await bill([{ name: "Steak", quantity: "2" }]);
    const pizza = await bill([{ name: "Pizza", quantity: "2", olives: 1 }]);
    const ask = (billId: string) =>
      lineIdOf(venue, billId, 1).then((lineId) => ({
        lineId,
        action: "discount_percent" as const,
        percentBp: 1000,
        quantity: "1",
      }));

    const plain = await adjustCounted(steak.billId, await ask(steak.billId));
    const withExtra = await adjustCounted(pizza.billId, await ask(pizza.billId));

    expect([plain.lineNoReads, withExtra.lineNoReads]).toEqual([0, 0]);
  });
});

describe("a weighed line (B11d)", () => {
  it.each([
    { action: "discount_percent", percentBp: 1000 },
    { action: "discount_amount", amount: "1.00" },
  ] as const)("refuses $action of part of it as adjustment.weighed_partial", async (ask) => {
    const { billId } = await bill([{ name: "Ham", quantity: "0.333" }]);
    const full = { lineId: await lineIdOf(venue, billId, 1), quantity: "0.100", ...ask };

    await expect(preview(billId, full)).rejects.toMatchObject({
      code: "adjustment.weighed_partial",
    });
    await refusedWith(billId, full, "adjustment.weighed_partial", {
      workingOrderId: billId,
      lineNo: 1,
    });
  });

  it("discounts the whole of it", async () => {
    const { billId } = await bill([{ name: "Ham", quantity: "0.333" }]);
    const before = total(await rowsOf(venue, billId));
    const ask = {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
    } as const;
    const previewed = await preview(billId, ask);

    await adjust(billId, ask);

    expect(before).toBe("7.99");
    expect(previewed.reduction).toBe("0.80");
    expect(total(await rowsOf(venue, billId))).toBe("7.19");
    expect((await recordedOn(billId))[0]).toMatchObject({ quantity: 333, reduction: 80 });
  });

  it("cancels part of it", async () => {
    const { billId } = await bill([{ name: "Ham", quantity: "0.333" }]);

    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "cancel",
      quantity: "0.100",
    });

    expect((await rowsOf(venue, billId)).map((row) => row.quantity)).toEqual(["0.233"]);
    expect((await recordedOn(billId))[0]).toMatchObject({ action: "cancel", quantity: 100 });
  });
});

describe("the bill's own rules", () => {
  it("moves the bill's revision on once per adjustment and answers it", async () => {
    const { billId, revision } = await bill([{ name: "Bottle" }]);

    const applied = await adjust(billId, { action: "discount_amount", amount: "1.00" });

    expect(applied.revision).toBe(revision + 1);
    expect((await stateOf(billId)).order!.revision).toBe(revision + 1);
  });

  it("refuses while a card payment of the bill is in flight", async () => {
    const { billId } = await bill([{ name: "Bottle" }]);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ paymentAttemptAt: new Date().toISOString() })
        .where(eq(workingOrders.id, billId)),
    );
    await refusedWith(
      billId,
      { action: "discount_amount", amount: "1.00" },
      "order.payment_in_flight",
    );
  });

  it("refuses a give-away on a settled bill", async () => {
    const { billId } = await bill([{ name: "Bottle" }]);
    const line = await lineIdOf(venue, billId, 1);
    await payAll(billId);
    await refusedWith(billId, { lineId: line, action: "comp" }, "tab.not_open", { tabId: billId });
  });
});

describe("a give-away or a discount that takes nothing off", () => {
  const comped = async (billId: string) =>
    adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });
  const onLine =
    (lineNo: number, ask: Ask) =>
    async (billId: string): Promise<Ask> => ({
      ...ask,
      lineId: await lineIdOf(venue, billId, lineNo),
    });
  const onBill = (ask: Ask) => (): Promise<Ask> => Promise.resolve(ask);

  it.each([
    {
      what: "a give-away of a dish already given away",
      lines: [{ name: "Steak" }],
      before: comped,
      ask: onLine(1, { action: "comp" }),
    },
    {
      what: "a discount of a dish already given away",
      lines: [{ name: "Steak" }],
      before: comped,
      ask: onLine(1, { action: "discount_percent", percentBp: 1000 }),
    },
    {
      what: "a discount of a bill whose only dish is given away",
      lines: [{ name: "Steak" }],
      before: comped,
      ask: onBill({ action: "discount_percent", percentBp: 1000 }),
    },
    {
      what: "0.01% off a €12.00 dish, which rounds to nothing",
      lines: [{ name: "Burger" }],
      ask: onLine(1, { action: "discount_percent", percentBp: 1 }),
    },
    {
      what: "0.01% off a €14.50 bill, which rounds to nothing",
      lines: [{ name: "Burger" }, { name: "Bread" }],
      ask: onBill({ action: "discount_percent", percentBp: 1 }),
    },
    {
      what: "€0.01 off a bill of 2.5 kg of fish, whose price moves the total by more",
      lines: [{ name: "Fish", quantity: "2.5" }],
      ask: onBill({ action: "discount_amount", amount: "0.01" }),
    },
    {
      what: "€0.01 off Pizza ×2 with an olive each, each row keeping a whole-cent price",
      lines: [{ name: "Pizza", quantity: "2", olives: 1 }],
      ask: onLine(1, { action: "discount_amount", amount: "0.01" }),
    },
    {
      what: "€0.01 off the two olives of Pizza ×2 alone",
      lines: [{ name: "Pizza", quantity: "2", olives: 1 }],
      ask: onLine(2, { action: "discount_amount", amount: "0.01" }),
    },
  ] satisfies {
    what: string;
    lines: RoundLine[];
    before?: (billId: string) => Promise<unknown>;
    ask: (billId: string) => Promise<Ask>;
  }[])("refuses $what, in the preview too, recording nothing", async (shape) => {
    const { billId } = await bill(shape.lines);
    if (shape.before !== undefined) await shape.before(billId);
    const ask = await shape.ask(billId);

    await expect(preview(billId, ask)).rejects.toMatchObject({
      code: "adjustment.no_reduction",
      params: { workingOrderId: billId },
    });
    await refusedWith(billId, ask, "adjustment.no_reduction", { workingOrderId: billId });
  });

  it("still records a cancel of a dish already given away, which takes nothing off the bill", async () => {
    const { billId } = await bill([{ name: "Steak" }]);
    await comped(billId);

    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "cancel" });

    expect((await recordedOn(billId)).map((row) => [row.action, row.reduction])).toEqual([
      ["comp", 2500],
      ["cancel", 0],
    ]);
  });
});

describe("refusals change nothing", () => {
  it.each([
    [
      "part of an extras row, whose quantity follows its dish",
      { olives: 1, quantity: "2", lineNo: 2 },
      { action: "comp", quantity: "1" },
      "adjustment.quantity_invalid",
    ],
    [
      "more than the line holds",
      {},
      { action: "comp", quantity: "3" },
      "adjustment.quantity_invalid",
    ],
    [
      "a quantity finer than the unit",
      {},
      { action: "comp", quantity: "0.5" },
      "adjustment.quantity_invalid",
    ],
    [
      "an action the reason does not allow",
      {},
      { action: "cancel", reason: "complaint" },
      "adjustment.action_not_allowed",
    ],
    [
      "a reason needing a note, with none",
      {},
      { action: "cancel", reason: "mistake" },
      "adjustment.note_required",
    ],
    ["no percentage", {}, { action: "discount_percent" }, "management.request_invalid"],
    ["an amount on a comp", {}, { action: "comp", amount: "1.00" }, "management.request_invalid"],
    [
      "a percentage on a comp",
      {},
      { action: "comp", percentBp: 1000 },
      "management.request_invalid",
    ],
    [
      "an amount on a percentage",
      {},
      { action: "discount_percent", percentBp: 1000, amount: "1.00" },
      "management.request_invalid",
    ],
    [
      "a percentage on an amount",
      {},
      { action: "discount_amount", amount: "1.00", percentBp: 1000 },
      "management.request_invalid",
    ],
    ["no amount", {}, { action: "discount_amount" }, "management.request_invalid"],
    [
      "a part-cent amount",
      {},
      { action: "discount_amount", amount: "0.005" },
      "management.request_invalid",
    ],
    [
      "a percentage on a cancel",
      {},
      { action: "cancel", percentBp: 1000 },
      "management.request_invalid",
    ],
    [
      "an amount on a cancel",
      {},
      { action: "cancel", amount: "1.00" },
      "management.request_invalid",
    ],
  ] as const)("refuses %s", async (_what, shape, ask, code) => {
    const pizza = "olives" in shape;
    const { billId } = await bill([
      pizza
        ? {
            name: "Pizza",
            olives: shape.olives,
            quantity: "quantity" in shape ? shape.quantity : "1",
          }
        : { name: "Steak", quantity: "2" },
    ]);
    const { reason, ...rest } = { reason: "house", ...ask } as Ask & {
      reason: keyof typeof REASONS;
    };
    await refusedWith(
      billId,
      {
        ...rest,
        lineId: await lineIdOf(venue, billId, "lineNo" in shape ? shape.lineNo : 1),
        reasonId: venue.reasonId[reason],
      },
      code,
    );
  });

  it("refuses part of a weighed line for a comp", async () => {
    const { billId } = await bill([{ name: "Ham", quantity: "0.333" }]);
    await refusedWith(
      billId,
      { lineId: await lineIdOf(venue, billId, 1), action: "comp", quantity: "0.100" },
      "adjustment.weighed_partial",
      { workingOrderId: billId, lineNo: 1 },
    );
  });

  it("refuses a comp or a cancel of the whole bill", async () => {
    const { billId } = await bill([{ name: "Steak" }]);
    await refusedWith(billId, { action: "comp" }, "management.request_invalid", {
      field: "lineId",
    });
    await refusedWith(
      billId,
      { action: "discount_amount", amount: "1.00", quantity: "1" },
      "management.request_invalid",
      {
        field: "quantity",
      },
    );
  });

  it("refuses an operator who is nobody", async () => {
    const { billId } = await bill([{ name: "Steak" }]);
    const nobody = randomUUID();
    await refusedWith(
      billId,
      { lineId: await lineIdOf(venue, billId, 1), action: "comp", operatorId: nobody },
      "person.not_found",
      { personId: nobody },
    );
  });

  it("refuses a line or a reason that does not exist", async () => {
    const { billId } = await bill([{ name: "Steak" }]);
    const missing = randomUUID();
    await refusedWith(billId, { lineId: missing, action: "comp" }, "tab.line_not_found", {
      tabId: billId,
      lineId: missing,
    });
    await refusedWith(
      billId,
      { lineId: await lineIdOf(venue, billId, 1), action: "comp", reasonId: missing },
      "adjustment_reason.not_found",
      { reasonId: missing },
    );
  });
});

async function partyRevision(partyId: string): Promise<number> {
  const [row] = await inTx(venue, (tx) =>
    tx.select({ revision: parties.revision }).from(parties).where(eq(parties.id, partyId)),
  );
  return row!.revision;
}

async function noticesAtStation() {
  return (await inTx(venue, (tx) => listStationNotices(tx, venue.cfg, venue.stationId))).map(
    (notice) => ({
      kind: notice.kind,
      lineName: notice.lineName,
      quantity: notice.quantity,
      wasStarted: notice.wasStarted,
    }),
  );
}

async function printJobCount(): Promise<number> {
  const rows = await inTx(venue, (tx) => tx.select({ id: printJobs.id }).from(printJobs));
  return rows.length;
}

async function ticketItemCount(billId: string): Promise<number> {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, billId)),
  );
  return rows.length;
}

function decimalDifference(a: string, b: string): Decimal {
  return toScale(subtractDecimal(decimal(a), decimal(b)), 2);
}

describe("a counter order (B11c)", () => {
  /** A counter zone of its own, paying before the order is sent. */
  let counterZone: string;
  /** A counter zone whose orders are placed with a ticket and paid after. */
  let ticketZone: string;

  async function counterZoneNamed(name: string) {
    return inTx(venue, async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: venue.cfg.locationId, name })
        .returning({ id: floorZones.id });
      return (
        await offerProducts(tx, venue.cfg, {
          zone: { zoneId: zone!.id },
          orderStart: "counter",
        })
      ).zoneId;
    });
  }

  beforeAll(async () => {
    counterZone = await counterZoneNamed("Barra B11c");
    ticketZone = await counterZoneNamed("Barra ticket B11c");
  });

  /** A table's bill with `lines` sent to the kitchen, then moved to the counter. */
  async function movedToCounter(lines: RoundLine[]): Promise<string> {
    const { billId, partyId } = await bill(lines);
    const expectedPartyRevision = await partyRevision(partyId);
    await inTx(venue, (tx) =>
      moveBill(
        tx,
        venue.cfg,
        billId,
        { counter: { zoneId: counterZone } },
        { bills: "merge", partyId, expectedPartyRevision, operatorId: venue.staffId },
      ),
    );
    return billId;
  }

  /** An order parked at the counter, nothing sent. */
  async function parked(zoneId: string, ...names: string[]): Promise<string> {
    const id = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id,
      zoneId,
      lines: names.map((name) => ({ menuItemId: venue.item(name), quantity: "1" })),
      operatorId: venue.staffId,
    });
    return id;
  }

  /** Everything an adjustment could change on an order of no party. */
  async function counterStateOf(orderId: string) {
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({
          revision: workingOrders.revision,
          status: workingOrders.status,
          partyId: workingOrders.partyId,
        })
        .from(workingOrders)
        .where(eq(workingOrders.id, orderId)),
    );
    return { order, recorded: await recordedOn(orderId), rows: await rowsOf(venue, orderId) };
  }

  it("is a table's bill moved to the counter: open, of no party, its dishes sent", async () => {
    const billId = await movedToCounter([{ name: "Burger" }]);

    expect((await counterStateOf(billId)).order).toMatchObject({ status: "open", partyId: null });
    expect(await ticketOf(venue, billId, 1)).toMatchObject({ stationId: venue.stationId });
  });

  it("comps a sent dish, recorded once under its reason, and moves the order's revision on", async () => {
    const billId = await movedToCounter([{ name: "Burger" }, { name: "Bread" }]);
    const before = await counterStateOf(billId);

    const applied = await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "comp",
      reasonId: venue.reasonId.complaint,
    });

    expect(await priced(billId)).toEqual([
      ["Burger", "1.000", "0.00", "12.00", "0.00"],
      ["Bread", "1.000", "2.50", null, "2.50"],
    ]);
    const recorded = await recordedOn(billId);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      action: "comp",
      reasonId: venue.reasonId.complaint,
      stage: "fired",
      reduction: 1200,
    });
    expect(applied.revision).toBe(before.order!.revision + 1);
    expect((await counterStateOf(billId)).order!.revision).toBe(before.order!.revision + 1);
  });

  it("discounts a sent dish", async () => {
    const billId = await movedToCounter([{ name: "Bottle" }]);

    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "discount_percent",
      percentBp: 1000,
    });

    expect(await priced(billId)).toEqual([["Bottle", "1.000", "27.00", "30.00", "27.00"]]);
    expect(await recordedOn(billId)).toMatchObject([
      { action: "discount_percent", reasonId: venue.reasonId.house, reduction: 300 },
    ]);
  });

  it("discounts the whole order", async () => {
    const billId = await movedToCounter([{ name: "Bottle" }, { name: "Salad" }]);

    await adjust(billId, { action: "discount_amount", amount: "4.00" });

    expect(total(await rowsOf(venue, billId))).toBe("36.00");
    expect(await recordedOn(billId)).toMatchObject([
      { action: "discount_amount", lineName: null, reduction: 400 },
    ]);
  });

  it("cancels a sent dish whole, telling the kitchen with a VOID slip", async () => {
    const billId = await movedToCounter([{ name: "Steak" }, { name: "Bread" }]);
    const jobs = await printJobCount();

    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "cancel",
      reasonId: venue.reasonId.mistake,
      note: "Wrong order",
    });

    expect(await priced(billId)).toEqual([["Bread", "1.000", "2.50", null, "2.50"]]);
    expect((await noticesAtStation()).slice(-1)).toEqual([
      { kind: "void", lineName: "CHULETA", quantity: "1.000", wasStarted: false },
    ]);
    expect(await printJobCount()).toBe(jobs + 1);
    expect(await lastKitchenSlip()).toEqual(
      expect.arrayContaining(["*** VOID ***", "1.000 x CHULETA"]),
    );
    expect(await recordedOn(billId)).toMatchObject([
      {
        action: "cancel",
        reasonId: venue.reasonId.mistake,
        reduction: 2500,
        lineName: "Steak",
        note: "Wrong order",
      },
    ]);
  });

  it("cancels 1 of 2 sent Steaks, telling the kitchen with a VOID slip of one", async () => {
    const billId = await movedToCounter([{ name: "Steak", quantity: "2" }]);
    const jobs = await printJobCount();

    await adjust(billId, {
      lineId: await lineIdOf(venue, billId, 1),
      action: "cancel",
      quantity: "1",
    });

    expect(await priced(billId)).toEqual([["Steak", "1.000", "25.00", null, "25.00"]]);
    expect((await noticesAtStation()).slice(-1)).toEqual([
      { kind: "void", lineName: "CHULETA", quantity: "1.000", wasStarted: false },
    ]);
    expect(await printJobCount()).toBe(jobs + 1);
    expect(await lastKitchenSlip()).toEqual(
      expect.arrayContaining(["*** VOID ***", "1.000 x CHULETA"]),
    );
    expect(await recordedOn(billId)).toMatchObject([
      { action: "cancel", quantity: 1000, reduction: 2500 },
    ]);
  });

  it("asks for the reason's approver: refused without a PIN, applied with a manager's", async () => {
    const billId = await movedToCounter([{ name: "Burger" }]);
    const comp = async (approver?: AdjustmentArgs["approver"]): Promise<Ask> => ({
      lineId: await lineIdOf(venue, billId, 1),
      action: "comp",
      reasonId: venue.reasonId.complaint,
      operatorId: venue.staffId,
      ...(approver === undefined ? {} : { approver }),
    });
    const before = await counterStateOf(billId);

    await expect(adjust(billId, await comp())).rejects.toMatchObject({
      code: "adjustment.approval_required",
      params: { approverRole: "manager" },
    });
    expect(await counterStateOf(billId)).toEqual(before);

    await adjust(billId, await comp({ personId: venue.managerId, pin: PINS.manager }));
    expect(await recordedOn(billId)).toMatchObject([
      { requestedBy: venue.staffId, approvedBy: venue.managerId },
    ]);
  });

  describe("under the venue's limit on a bill's total discount (B11b)", () => {
    const setLimit = (maxBillDiscountBp: number | null) =>
      inTx(venue, (tx) => saveAdjustmentSettings(tx, { maxBillDiscountBp }));
    afterEach(() => setLimit(null));

    it("asks a manager for a staff member's second 30% off under a 40% limit", async () => {
      await setLimit(4000);
      const billId = await movedToCounter([{ name: "Salad", quantity: "10" }]);
      const thirty = (extra: Partial<Ask> = {}): Ask => ({
        action: "discount_percent",
        percentBp: 3000,
        operatorId: venue.staffId,
        ...extra,
      });
      await adjust(billId, thirty());
      const before = await counterStateOf(billId);

      await expect(adjust(billId, thirty())).rejects.toMatchObject({
        code: "adjustment.approval_required",
        params: { approverRole: "manager" },
      });
      expect(await counterStateOf(billId)).toEqual(before);

      await adjust(billId, thirty({ approver: { personId: venue.managerId, pin: PINS.manager } }));
      expect((await recordedOn(billId)).map((row) => [row.reduction, row.approvedBy])).toEqual([
        [3000, null],
        [2100, venue.managerId],
      ]);
    });
  });

  it("applies a resent adjustment once, under the order's own command scope", async () => {
    const billId = await movedToCounter([{ name: "Bottle" }]);
    const args = await inTx(venue, (tx) =>
      argsFor(tx, billId, { lineId: null, action: "discount_amount", amount: "5.00" }),
    );

    const first = await inTx(venue, (tx) =>
      applyAdjustment(tx, venue.cfg, args, venue.venueLocale),
    );
    const again = await inTx(venue, (tx) =>
      applyAdjustment(tx, venue.cfg, args, venue.venueLocale),
    );

    expect(again).toEqual(first);
    expect(await recordedOn(billId)).toHaveLength(1);
    expect(await priced(billId)).toEqual([["Bottle", "1.000", "25.00", "30.00", "25.00"]]);
    const commands = await inTx(venue, (tx) =>
      tx
        .select({ scopeKind: serviceCommands.scopeKind })
        .from(serviceCommands)
        .where(eq(serviceCommands.scopeId, billId)),
    );
    expect(commands).toEqual([{ scopeKind: "bill" }]);
  });

  it("refuses a comp of a dish paid for on its own, writing nothing, and comps the unpaid one", async () => {
    const { billId, partyId } = await bill([{ name: "Burger" }, { name: "Steak" }]);
    const paid = await send(
      venue.app,
      venue.cookie.staff,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        tip: "0.00",
        kind: "items",
        lines: [{ lineNo: 2 }],
        method: "cash",
        tendered: "25.00",
        applied: "25.00",
      },
    );
    expect(paid.status).toBe(200);
    const expectedPartyRevision = await partyRevision(partyId);
    await inTx(venue, (tx) =>
      moveBill(
        tx,
        venue.cfg,
        billId,
        { counter: { zoneId: counterZone } },
        { bills: "merge", partyId, expectedPartyRevision, operatorId: venue.staffId },
      ),
    );
    const before = await counterStateOf(billId);
    expect(before.order).toMatchObject({ status: "open", partyId: null });

    await expect(
      adjust(billId, { lineId: await lineIdOf(venue, billId, 2), action: "comp" }),
    ).rejects.toMatchObject({
      code: "bill.line_paid",
      params: { workingOrderId: billId, lineNo: 2 },
    });
    expect(await counterStateOf(billId)).toEqual(before);

    await adjust(billId, { lineId: await lineIdOf(venue, billId, 1), action: "comp" });
    expect(await priced(billId)).toEqual([
      ["Burger", "1.000", "0.00", "12.00", "0.00"],
      ["Steak", "1.000", "25.00", null, "25.00"],
    ]);
    expect(await recordedOn(billId)).toMatchObject([{ action: "comp", reduction: 1200 }]);
  });

  it("discounts a parked order, and the sale route charges the discounted price", async () => {
    const orderId = await parked(counterZone, "Bottle");

    await adjust(orderId, { action: "discount_percent", percentBp: 1000 });
    const paid = await send(venue.app, venue.cookie.staff, "POST", "/api/sales", {
      lines: [],
      tender: { method: "cash", amount: "27.00" },
      workingOrderId: orderId,
    });

    expect(paid.status).toBe(200);
    const [sale] = await inTx(venue, (tx) =>
      tx.select({ total: sales.total }).from(sales).where(eq(sales.workingOrderId, orderId)),
    );
    expect(sale).toEqual({ total: 2700 });
  });

  it("keeps a comped dish at €0.00 when a held-order edit adds another dish", async () => {
    const orderId = await parked(counterZone, "Burger");
    const [burger] = await rowsOf(venue, orderId);
    await adjust(orderId, { lineId: burger!.id, action: "comp" });

    await updateHeldOrder({ db: venue.db }, venue.cfg, orderId, {
      revision: (await counterStateOf(orderId)).order!.revision,
      lines: [
        { workingOrderLineId: burger!.id, menuItemId: venue.item("Burger"), quantity: "1" },
        { menuItemId: venue.item("Bread"), quantity: "1" },
      ],
      operatorId: venue.staffId,
    });

    expect(await priced(orderId)).toEqual([
      ["Burger", "1.000", "0.00", "12.00", "0.00"],
      ["Bread", "1.000", "2.50", null, "2.50"],
    ]);
  });

  it("refuses a placed counter order as tab.not_open, writing nothing", async () => {
    const orderId = await parked(ticketZone, "Burger");
    await placeOrder(
      { db: venue.db, backend: venue.backend, clock: venue.clock },
      venue.cfg,
      orderId,
      venue.staffId,
    );
    const before = await counterStateOf(orderId);
    expect(before.order).toMatchObject({ status: "placed", partyId: null });

    await expect(
      adjust(orderId, { lineId: before.rows[0]!.id, action: "comp" }),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: orderId } });
    expect(await counterStateOf(orderId)).toEqual(before);
  });
});

/** The kitchen printer's newest job, as its non-blank lines. */
async function lastKitchenSlip(): Promise<string[]> {
  const [job] = await inTx(venue, (tx) =>
    tx
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, venue.printerId))
      .orderBy(sql`rowid desc`)
      .limit(1),
  );
  return printedLines(job!.payload).filter((line) => line.trim() !== "");
}
