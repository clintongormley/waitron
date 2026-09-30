import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
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
  createAdjustmentReason,
  updateAdjustmentReason,
  type AdjustmentAction,
} from "@waitron/adjustments";
import { localToday, rateLines, type GrossLines, type VatClass } from "@waitron/catalogue";
import { insertCapturedPayment, SimulatorPaymentProvider } from "@waitron/payments";
import { listStationNotices, writePrintHeldWork } from "@waitron/venue-service";
import { decimal, subtractDecimal, sumDecimals, toScale, type Decimal } from "@waitron/shared";
import { applyAdjustment, previewAdjustment } from "./adjustments-apply.js";
import type { AdjustmentArgs } from "./adjustments-apply.js";
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
  readOrderRevision,
  recallLines,
  updateHeldOrder,
  updateOrderLine,
} from "./working-order.js";
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
import "./errors.js";

// Cancellations, comps and discounts applied to a party's bill (service plan Task 11, spec §7),
// against a provisioned venue that files real Veri*Factu records. Each case seats its own party.
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
    return previewAdjustment(tx, venue.cfg, args, venue.venueLocale);
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
      splitLineIds: [await lineIdOf(venue, billId, 2)],
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
});

describe("the receipt (ruling R13)", () => {
  /** A ticket's lines as `[customer name, gross, total before the change]`. */
  const shown = (ticket: TillSaleResult) =>
    ticket.lines.map((line) => [line.descriptions["es-ES"], line.gross, line.listGross]);

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
    ["Hamburguesa", "0.00", "12.00"],
    ["Rioja crianza", "27.00", "30.00"],
    ["Pan de pueblo", "2.50", undefined],
  ];

  it("prints the Burger's €12.00 before its €0.00, when the bill is paid and when it is printed again", async () => {
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
          characterSet: "wpc1252",
          characterTable: 16,
        },
      }),
    );
    expect(
      printed.filter((line) => /^1 ud {2}Hamburguesa +12,00 € -> 0,00 €$/u.test(line)),
    ).toHaveLength(1);
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
    expect(row!.splitLineIds).toEqual([
      await lineIdOf(venue, billId, 2),
      await lineIdOf(venue, billId, 3),
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
    // The recorded command keeps the approver, never the PIN (ruling R2).
    const commands = await inTx(venue, (tx) =>
      tx.select().from(serviceCommands).where(eq(serviceCommands.scopeId, billId)),
    );
    expect(commands).toHaveLength(1);
    expect(JSON.stringify(commands)).not.toContain(PINS.manager);
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

  it("refuses a settled bill as the void does", async () => {
    const { billId } = await bill([{ name: "Bottle" }]);
    const line = await lineIdOf(venue, billId, 1);
    await payAll(billId);
    await refusedWith(billId, { lineId: line, action: "comp" }, "tab.not_open", { tabId: billId });
  });
});

describe("refusals change nothing", () => {
  it.each([
    [
      "an extras row on its own",
      { olives: 1, lineNo: 2 },
      { action: "comp" },
      "adjustment.line_not_adjustable",
    ],
    [
      "part of a dish with extras",
      { olives: 1, quantity: "2" },
      { action: "comp", quantity: "1" },
      "adjustment.partial_with_extras",
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
      "adjustment.quantity_invalid",
      { quantity: "0.100" },
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
