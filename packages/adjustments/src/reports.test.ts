import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  locations,
  tills,
  withTransaction,
  workingOrderLines,
  workingOrders,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import {
  addDecimal,
  decimal,
  decimalToCents,
  grossOf,
  stringToThousandths,
  subtractDecimal,
} from "@waitron/shared";
import { ADJUSTMENTS_MIGRATIONS } from "./migrations.js";
import { policySnapshotOf, type AdjustmentAction, type AdjustmentReason } from "./policy.js";
import { recordAdjustment } from "./record.js";
import {
  computeAdjustmentReport,
  listAdjustmentEntries,
  type AdjustmentReport,
} from "./reports.js";
import type { AdjustmentStage } from "./schema/adjustments.js";
import { seedReason } from "../test/seed.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, ADJUSTMENTS_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

// Business day 2026-09-15 in Madrid, cut over at 05:00 local (03:00 UTC in summer), runs from
// 2026-09-15T03:00:00.000Z up to, not including, 2026-09-16T03:00:00.000Z.
const CLOCK = { timeZone: "Europe/Madrid", dayCutover: "05:00" };
const DAY = "2026-09-15";
const EVENING = "2026-09-15T18:00:00.000Z";
const range = (from = DAY, to = from) => ({ fromBusinessDay: from, toBusinessDay: to, ...CLOCK });

async function person(name: string, status?: "suspended"): Promise<string> {
  const [row] = await db
    .insert(persons)
    .values({ displayName: name, ...(status === undefined ? {} : { status }) })
    .returning({ id: persons.id });
  return row!.id;
}

let tillId: string;
let orderNumber = 0;

/** A bill opened at `openedAt` on this test's till, which is made on first use. */
async function bill(
  opts: { openedAt?: string } = {},
): Promise<{ id: string; orderNumber: number }> {
  const [till] = await db.select({ id: tills.id }).from(tills);
  if (till === undefined) {
    const [location] = await db
      .insert(locations)
      .values({ name: "Sala", invoiceLocales: ["es"], operationDescription: "Restaurante" })
      .returning({ id: locations.id });
    [{ id: tillId }] = (await db
      .insert(tills)
      .values({ locationId: location!.id, name: "Till 1" })
      .returning({ id: tills.id })) as [{ id: string }];
  } else {
    tillId = till.id;
  }
  orderNumber += 1;
  const [order] = await db
    .insert(workingOrders)
    .values({
      tillId,
      orderNumber,
      openedAt: opts.openedAt ?? EVENING,
    })
    .returning({ id: workingOrders.id });
  return { id: order!.id, orderNumber };
}

/** A line still on `billId`: `quantity` at `unit`, first priced at `list` when an adjustment
 * touched it. */
async function line(
  billId: string,
  opts: {
    name: string;
    quantity?: string;
    unit: string;
    list?: string;
    creditedTo: string | null;
  },
): Promise<void> {
  const [{ n }] = (await db.all(
    sql`select count(*) as n from working_order_lines where working_order_id = ${billId}`,
  )) as [{ n: number }];
  const quantity = opts.quantity ?? "1";
  await db.insert(workingOrderLines).values({
    workingOrderId: billId,
    lineNo: n + 1,
    name: opts.name,
    descriptions: { es: opts.name },
    quantity: stringToThousandths(quantity),
    unitPriceGross: decimalToCents(decimal(opts.unit)),
    listUnitPriceGross: opts.list === undefined ? null : decimalToCents(decimal(opts.list)),
    vatClass: "general",
    lineTotal: 0,
    creditedTo: opts.creditedTo,
  });
}

interface Ask {
  bill: string;
  reason: AdjustmentReason;
  /** The reason's name as the row snapshots it. */
  reasonName: string;
  action: AdjustmentAction;
  /** Absent for a discount on the whole bill. */
  line?: {
    name: string;
    quantity?: string;
    list: string;
    creditedTo: string | null;
    stage: AdjustmentStage;
  };
  percentBp?: number;
  before: string;
  after: string;
  nominal: string;
  by: string;
  approvedBy?: string;
  note?: string;
  byGuest?: boolean;
  /** When the row is written, which is its `created_at`. */
  at: string;
}

async function adjust(ask: Ask): Promise<string> {
  const lineQuantity = ask.line?.quantity ?? "1";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(ask.at));
  try {
    return await withTransaction(db, (tx) =>
      recordAdjustment(tx, {
        workingOrderId: ask.bill,
        line:
          ask.line === undefined
            ? null
            : {
                id: randomUUID(),
                name: ask.line.name,
                quantity: lineQuantity,
                listUnitPriceGross: decimal(ask.line.list),
                creditedTo: ask.line.creditedTo,
                stage: ask.line.stage,
              },
        quantity: ask.line === undefined ? null : lineQuantity,
        reason: {
          id: ask.reason.id,
          name: ask.reasonName,
          policy: policySnapshotOf(ask.reason),
        },
        action: ask.action,
        percentBp: ask.percentBp ?? null,
        beforeAmount: decimal(ask.before),
        afterAmount: decimal(ask.after),
        reduction: subtractDecimal(decimal(ask.before), decimal(ask.after)),
        nominalValue: decimal(ask.nominal),
        requestedBy: ask.by,
        approvedBy: ask.approvedBy ?? null,
        note: ask.note ?? null,
        byGuest: ask.byGuest ?? false,
      }),
    );
  } finally {
    vi.useRealTimers();
  }
}

function report(input = range()): Promise<AdjustmentReport> {
  return withTransaction(db, (tx) => computeAdjustmentReport(tx, input));
}

function entries(
  requester?: { personId: string } | "guests",
  input = range(),
): ReturnType<typeof listAdjustmentEntries> {
  return withTransaction(db, (tx) => listAdjustmentEntries(tx, { ...input, requester }));
}

const NONE = { count: 0, reduction: "0.00", cancelledNominalValue: "0.00" };

function tally(count: number, reduction: string, cancelledNominalValue: string) {
  return { count, reduction, cancelledNominalValue };
}

const EMPTY_TOTALS = {
  ...NONE,
  byAction: { cancel: NONE, comp: NONE, discount_percent: NONE, discount_amount: NONE },
  byStage: { beforeFiring: NONE, afterFiring: NONE, afterServing: NONE, billDiscount: NONE },
  byReason: [],
};

function personRow(report: AdjustmentReport, personId: string) {
  const row = report.people.find((candidate) => candidate.personId === personId);
  if (row === undefined) throw new Error(`no row for ${personId}`);
  return row;
}

describe("the fixture day (spec §7)", () => {
  async function fixtureDay() {
    const alex = await person("Alex");
    const sam = await person("Sam");
    const mia = await person("Mia");
    const complaint = await seedReason(db);
    const mistake = await seedReason(db);
    const regular = await seedReason(db);

    // Alex's €800.00 of credited sales: €763.00 still on the bill, and the Burger and the Steak his
    // cancellations took off it.
    const alexBill = await bill();
    await line(alexBill.id, {
      name: "Tasting menu",
      quantity: "7",
      unit: "109.00",
      creditedTo: alex,
    });
    const burger = { name: "Burger", list: "12.00", creditedTo: alex, stage: "served" as const };
    const comp = await adjust({
      bill: alexBill.id,
      reason: complaint,
      reasonName: "Cold food",
      action: "comp",
      line: burger,
      before: "12.00",
      after: "0.00",
      nominal: "12.00",
      by: alex,
      approvedBy: mia,
      note: "Sent back cold",
      at: "2026-09-15T19:00:00.000Z",
    });
    const cancelComped = await adjust({
      bill: alexBill.id,
      reason: mistake,
      reasonName: "Mistake",
      action: "cancel",
      line: burger,
      before: "0.00",
      after: "0.00",
      nominal: "12.00",
      by: alex,
      note: "Guest left it",
      at: "2026-09-15T19:30:00.000Z",
    });
    const cancelSteak = await adjust({
      bill: alexBill.id,
      reason: mistake,
      reasonName: "Mistake",
      action: "cancel",
      line: { name: "Steak", list: "25.00", creditedTo: alex, stage: "fired" },
      before: "25.00",
      after: "0.00",
      nominal: "25.00",
      by: alex,
      note: "Wrong table",
      at: "2026-09-15T20:00:00.000Z",
    });

    // Sam's €200.00, with €3.00 off the whole bill.
    const samBill = await bill();
    await line(samBill.id, { name: "Paella", unit: "197.00", list: "200.00", creditedTo: sam });
    await adjust({
      bill: samBill.id,
      reason: regular,
      reasonName: "Regular",
      action: "discount_amount",
      before: "200.00",
      after: "197.00",
      nominal: "200.00",
      by: sam,
      at: "2026-09-15T21:00:00.000Z",
    });
    return {
      alex,
      sam,
      mia,
      complaint,
      mistake,
      regular,
      alexBill,
      comp,
      cancelComped,
      cancelSteak,
    };
  }

  it("gives Alex three actions, €37.00 off, a 4.6% rate and one approval by Mia, and Sam a 1.5% rate", async () => {
    const day = await fixtureDay();

    const read = await report();

    expect(personRow(read, day.alex)).toEqual({
      personId: day.alex,
      name: "Alex",
      ...tally(3, "37.00", "37.00"),
      sales: "800.00",
      ratePercent: "4.6",
      byAction: {
        cancel: tally(2, "25.00", "37.00"),
        comp: tally(1, "12.00", "0.00"),
        discount_percent: NONE,
        discount_amount: NONE,
      },
      byStage: {
        beforeFiring: NONE,
        afterFiring: tally(1, "25.00", "25.00"),
        afterServing: tally(2, "12.00", "12.00"),
        billDiscount: NONE,
      },
      byReason: [
        { reasonId: day.mistake.id, reasonName: "Mistake", ...tally(2, "25.00", "37.00") },
        { reasonId: day.complaint.id, reasonName: "Cold food", ...tally(1, "12.00", "0.00") },
      ],
      approvers: [{ personId: day.mia, name: "Mia", count: 1 }],
      approvalsGiven: 0,
    });
    expect(personRow(read, day.sam)).toMatchObject({
      ...tally(1, "3.00", "0.00"),
      sales: "200.00",
      ratePercent: "1.5",
      byStage: { billDiscount: tally(1, "3.00", "0.00") },
    });
  });

  it("keeps the cancellations' €37.00 list value apart from their €25.00 reduction: the comped-then-cancelled Burger's €12.00 reduction is counted once, under the comp, and its list value under the cancel", async () => {
    const day = await fixtureDay();

    const alex = personRow(await report(), day.alex);

    expect(alex.byAction.cancel).toEqual(tally(2, "25.00", "37.00"));
    expect(alex.byAction.comp).toEqual(tally(1, "12.00", "0.00"));
    expect(alex.reduction).toBe("37.00");
  });

  it("keeps a comp's and a bill discount's list value out of every total's cancelled value", async () => {
    const alex = await person("Alex");
    const reason = await seedReason(db);
    const visit = await bill();
    const base = { bill: visit.id, reason, reasonName: "House", by: alex };
    await adjust({
      ...base,
      action: "comp",
      line: { name: "Burger", list: "12.00", creditedTo: alex, stage: "served" },
      before: "12.00",
      after: "0.00",
      nominal: "12.00",
      at: "2026-09-15T19:00:00.000Z",
    });
    await adjust({
      ...base,
      action: "discount_amount",
      before: "200.00",
      after: "197.00",
      nominal: "200.00",
      at: "2026-09-15T19:30:00.000Z",
    });
    await adjust({
      ...base,
      action: "cancel",
      line: { name: "Olives", list: "5.00", creditedTo: alex, stage: "fired" },
      before: "5.00",
      after: "0.00",
      nominal: "5.00",
      at: "2026-09-15T20:00:00.000Z",
    });

    const read = await report();

    for (const totals of [read.overall, personRow(read, alex)]) {
      expect(totals).toMatchObject({
        ...tally(3, "20.00", "5.00"),
        byAction: {
          cancel: tally(1, "5.00", "5.00"),
          comp: tally(1, "12.00", "0.00"),
          discount_amount: tally(1, "3.00", "0.00"),
        },
        byStage: {
          afterFiring: tally(1, "5.00", "5.00"),
          afterServing: tally(1, "12.00", "0.00"),
          billDiscount: tally(1, "3.00", "0.00"),
        },
        byReason: [{ reasonId: reason.id, reasonName: "House", ...tally(3, "20.00", "5.00") }],
      });
    }
    // The drill-down keeps each row's own list value.
    expect((await entries()).map((row) => [row.action, row.nominalValue])).toEqual([
      ["cancel", "5.00"],
      ["discount_amount", "200.00"],
      ["comp", "12.00"],
    ]);
  });

  it("lists the approver as a person of their own, who requested nothing and gave one approval", async () => {
    const day = await fixtureDay();

    const read = await report();

    expect(read.people.map((row) => row.name)).toEqual(["Alex", "Mia", "Sam"]);
    expect(personRow(read, day.mia)).toEqual({
      personId: day.mia,
      name: "Mia",
      ...EMPTY_TOTALS,
      sales: "0.00",
      ratePercent: null,
      approvers: [],
      approvalsGiven: 1,
    });
  });

  it("totals the whole day and leaves the guests' row empty", async () => {
    const day = await fixtureDay();

    const read = await report();

    expect(read.fromBusinessDay).toBe(DAY);
    expect(read.toBusinessDay).toBe(DAY);
    expect(read.overall).toEqual({
      ...tally(4, "40.00", "37.00"),
      sales: "1000.00",
      ratePercent: "4.0",
      byAction: {
        cancel: tally(2, "25.00", "37.00"),
        comp: tally(1, "12.00", "0.00"),
        discount_percent: NONE,
        discount_amount: tally(1, "3.00", "0.00"),
      },
      byStage: {
        beforeFiring: NONE,
        afterFiring: tally(1, "25.00", "25.00"),
        afterServing: tally(2, "12.00", "12.00"),
        billDiscount: tally(1, "3.00", "0.00"),
      },
      byReason: [
        { reasonId: day.mistake.id, reasonName: "Mistake", ...tally(2, "25.00", "37.00") },
        { reasonId: day.complaint.id, reasonName: "Cold food", ...tally(1, "12.00", "0.00") },
        { reasonId: day.regular.id, reasonName: "Regular", ...tally(1, "3.00", "0.00") },
      ],
    });
    expect(read.guests).toEqual(EMPTY_TOTALS);
  });

  it("drills down to Alex's three rows, newest first, each with its reason as snapshotted, its note and its time", async () => {
    const day = await fixtureDay();

    const rows = await entries({ personId: day.alex });

    expect(rows).toEqual([
      {
        id: day.cancelSteak,
        createdAt: "2026-09-15T20:00:00.000Z",
        action: "cancel",
        stage: "fired",
        reasonId: day.mistake.id,
        reasonName: "Mistake",
        note: "Wrong table",
        lineName: "Steak",
        quantity: "1.000",
        percentBp: null,
        beforeAmount: "25.00",
        afterAmount: "0.00",
        reduction: "25.00",
        nominalValue: "25.00",
        requestedBy: { personId: day.alex, name: "Alex" },
        approvedBy: null,
        creditedTo: { personId: day.alex, name: "Alex" },
        byGuest: false,
        workingOrderId: day.alexBill.id,
        orderNumber: day.alexBill.orderNumber,
      },
      expect.objectContaining({
        id: day.cancelComped,
        createdAt: "2026-09-15T19:30:00.000Z",
        action: "cancel",
        stage: "served",
        reasonName: "Mistake",
        note: "Guest left it",
        reduction: "0.00",
        nominalValue: "12.00",
      }),
      expect.objectContaining({
        id: day.comp,
        createdAt: "2026-09-15T19:00:00.000Z",
        action: "comp",
        reasonName: "Cold food",
        note: "Sent back cold",
        approvedBy: { personId: day.mia, name: "Mia" },
      }),
    ]);
    expect((await entries()).map((row) => row.id)).toEqual([
      expect.any(String),
      day.cancelSteak,
      day.cancelComped,
      day.comp,
    ]);
  });
});

describe("credit versus actor (plan D21)", () => {
  it("keeps Alex's cancelled Steak in his sales through the adjustment's snapshot, and counts its €25.00 against Mia, who cancelled it", async () => {
    const alex = await person("Alex");
    const mia = await person("Mia");
    const reason = await seedReason(db);
    const visit = await bill();
    // The Steak is gone from the bill: a whole-line cancel deletes the line.
    await line(visit.id, { name: "Burger", unit: "12.00", creditedTo: alex });
    await line(visit.id, { name: "Wine", unit: "30.00", creditedTo: mia });
    await adjust({
      bill: visit.id,
      reason,
      reasonName: "Mistake",
      action: "cancel",
      line: { name: "Steak", list: "25.00", creditedTo: alex, stage: "fired" },
      before: "25.00",
      after: "0.00",
      nominal: "25.00",
      by: mia,
      at: "2026-09-15T19:00:00.000Z",
    });

    const read = await report();

    expect(personRow(read, alex)).toMatchObject({
      ...tally(0, "0.00", "0.00"),
      sales: "37.00",
      ratePercent: "0.0",
    });
    expect(personRow(read, mia)).toMatchObject({
      ...tally(1, "25.00", "25.00"),
      sales: "30.00",
      ratePercent: "83.3",
    });
    expect(read.overall).toMatchObject({ sales: "67.00", ratePercent: "37.3" });
  });
});

describe("which bills and lines a range holds", () => {
  it("takes a bill by the business day it was opened on, its adjustments with it, whenever they were made", async () => {
    const alex = await person("Alex");
    const reason = await seedReason(db);
    const lastMinute = await bill({ openedAt: "2026-09-16T02:59:59.999Z" });
    const nextDay = await bill({ openedAt: "2026-09-16T03:00:00.000Z" });
    const dayBefore = await bill({ openedAt: "2026-09-15T02:59:59.999Z" });
    for (const [visit, unit] of [
      [lastMinute, "10.00"],
      [nextDay, "20.00"],
      [dayBefore, "40.00"],
    ] as const) {
      await line(visit.id, { name: "Menu", unit, creditedTo: alex });
      await adjust({
        bill: visit.id,
        reason,
        reasonName: "House",
        action: "discount_amount",
        before: unit,
        after: "5.00",
        nominal: unit,
        by: alex,
        // Every adjustment is made inside business day 2026-09-15.
        at: "2026-09-15T12:00:00.000Z",
      });
    }

    const day15 = await report();
    const day16 = await report(range("2026-09-16"));
    const both = await report(range("2026-09-14", "2026-09-16"));

    expect(personRow(day15, alex)).toMatchObject({ ...tally(1, "5.00", "0.00"), sales: "10.00" });
    expect(personRow(day16, alex)).toMatchObject({ ...tally(1, "15.00", "0.00"), sales: "20.00" });
    expect(personRow(both, alex)).toMatchObject({ ...tally(3, "55.00", "0.00"), sales: "70.00" });
    expect(
      (await entries(undefined, range("2026-09-16"))).map((row) => row.workingOrderId),
    ).toEqual([nextDay.id]);
  });

  it("leaves an abandoned bill's lines out of the sales, and keeps its cancellations' nominal value and its adjustments in", async () => {
    const alex = await person("Alex");
    const reason = await seedReason(db);
    const abandoned = await bill();
    await line(abandoned.id, { name: "Menu", unit: "50.00", creditedTo: alex });
    await db
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(eq(workingOrders.id, abandoned.id));
    await adjust({
      bill: abandoned.id,
      reason,
      reasonName: "Mistake",
      action: "cancel",
      line: { name: "Steak", list: "10.00", creditedTo: alex, stage: "unsent" },
      before: "10.00",
      after: "0.00",
      nominal: "10.00",
      by: alex,
      at: "2026-09-15T19:00:00.000Z",
    });

    const alexRow = personRow(await report(), alex);

    expect(alexRow).toMatchObject({ ...tally(1, "10.00", "10.00"), sales: "10.00" });
  });

  it("counts a line at its first price times its quantity, rounded as a line total is, and a line no adjustment touched at its price", async () => {
    const alex = await person("Alex");
    const visit = await bill();
    // 2.5 kg at €12.99 is €32.475, which a line total rounds half away from zero to €32.48.
    await line(visit.id, {
      name: "Fish",
      quantity: "2.5",
      unit: "11.00",
      list: "12.99",
      creditedTo: alex,
    });
    await line(visit.id, { name: "Bread", quantity: "3", unit: "2.50", creditedTo: alex });
    // Nobody's: counted in the day's total only.
    await line(visit.id, { name: "Water", unit: "2.00", creditedTo: null });

    const read = await report();

    expect(personRow(read, alex)).toMatchObject({ sales: "39.98", ratePercent: "0.0" });
    expect(read.overall).toMatchObject({ sales: "41.98", ratePercent: "0.0" });
    expect(read.people).toHaveLength(1);
  });

  it("rounds each line half away from zero, as grossOf does, before summing", async () => {
    const [ana, bea] = [await person("Ana"), await person("Bea")];
    const visit = await bill();
    // Ana: €32.475 and €0.005 each round up, to €32.49; rounding half to even gives €32.48.
    await line(visit.id, { name: "Fish", quantity: "2.5", unit: "12.99", creditedTo: ana });
    await line(visit.id, { name: "Mint", quantity: "0.5", unit: "0.01", creditedTo: ana });
    // Bea: -€0.045 rounds away from zero to -€0.05; half to even, or half up, gives -€0.04.
    await line(visit.id, { name: "Refund", quantity: "-1.5", unit: "0.03", creditedTo: bea });

    const read = await report();

    expect(personRow(read, ana).sales).toBe("32.49");
    expect(personRow(read, bea)).toMatchObject({ sales: "-0.05", ratePercent: null });
    expect(personRow(read, ana).sales).toBe(
      addDecimal(grossOf("12.99", "2.5"), grossOf("0.01", "0.5")),
    );
    expect(personRow(read, bea).sales).toBe(grossOf("0.03", "-1.5"));
  });

  it("answers an empty range with no people, zero sales and no rate", async () => {
    const read = await report();

    expect(read).toEqual({
      fromBusinessDay: DAY,
      toBusinessDay: DAY,
      overall: { ...EMPTY_TOTALS, sales: "0.00", ratePercent: null },
      people: [],
      guests: EMPTY_TOTALS,
    });
    expect(await entries()).toEqual([]);
  });
});

describe("stages, reasons and guests", () => {
  it("puts unsent and held together before firing, and keeps percentage discounts apart from amounts", async () => {
    const alex = await person("Alex");
    const reason = await seedReason(db);
    const visit = await bill();
    const base = {
      bill: visit.id,
      reason,
      reasonName: "House",
      by: alex,
      at: "2026-09-15T19:00:00.000Z",
    };
    await adjust({
      ...base,
      action: "cancel",
      line: { name: "Olives", list: "4.00", creditedTo: alex, stage: "unsent" },
      before: "4.00",
      after: "0.00",
      nominal: "4.00",
    });
    await adjust({
      ...base,
      action: "discount_percent",
      percentBp: 1000,
      line: { name: "Salad", list: "10.00", creditedTo: alex, stage: "held" },
      before: "10.00",
      after: "9.00",
      nominal: "10.00",
      at: "2026-09-15T19:30:00.000Z",
    });

    const alexRow = personRow(await report(), alex);

    expect(alexRow.byStage).toEqual({
      beforeFiring: tally(2, "5.00", "4.00"),
      afterFiring: NONE,
      afterServing: NONE,
      billDiscount: NONE,
    });
    expect(alexRow.byAction).toMatchObject({
      discount_percent: tally(1, "1.00", "0.00"),
      discount_amount: NONE,
    });
    const [discount] = await entries({ personId: alex });
    expect(discount).toMatchObject({ action: "discount_percent", percentBp: 1000 });
  });

  it("names a reason by its most recent row, and the drill-down shows each row's own name", async () => {
    const alex = await person("Alex");
    const reason = await seedReason(db);
    const visit = await bill();
    const comp = (reasonName: string, at: string) =>
      adjust({
        bill: visit.id,
        reason,
        reasonName,
        action: "comp",
        line: { name: "Coffee", list: "1.50", creditedTo: alex, stage: "served" },
        before: "1.50",
        after: "0.00",
        nominal: "1.50",
        by: alex,
        at,
      });
    await comp("Queja", "2026-09-15T20:00:00.000Z");
    await comp("Complaint", "2026-09-15T19:00:00.000Z");

    const read = await report();

    expect(read.overall.byReason).toEqual([
      { reasonId: reason.id, reasonName: "Queja", ...tally(2, "3.00", "0.00") },
    ]);
    expect((await entries()).map((row) => row.reasonName)).toEqual(["Queja", "Complaint"]);
  });

  it("names a reason by the row with the larger id when its two newest rows share a time", async () => {
    const alex = await person("Alex");
    const reason = await seedReason(db);
    const visit = await bill();
    const comp = (reasonName: string) =>
      adjust({
        bill: visit.id,
        reason,
        reasonName,
        action: "comp",
        line: { name: "Coffee", list: "1.50", creditedTo: alex, stage: "served" },
        before: "1.50",
        after: "0.00",
        nominal: "1.50",
        by: alex,
        at: "2026-09-15T20:00:00.000Z",
      });
    const named = [
      { id: await comp("Queja"), name: "Queja" },
      { id: await comp("Complaint"), name: "Complaint" },
    ].sort((a, b) => b.id.localeCompare(a.id));

    const read = await report();

    expect(read.overall.byReason.map((row) => row.reasonName)).toEqual([named[0]!.name]);
    expect((await entries()).map((row) => row.reasonName)).toEqual(named.map((row) => row.name));
  });

  it("gives guests' actions their own row, never the requester's, and counts the approval they needed", async () => {
    const alex = await person("Alex");
    const mia = await person("Mia");
    const reason = await seedReason(db);
    const visit = await bill();
    const guestCancel = await adjust({
      bill: visit.id,
      reason,
      reasonName: "Changed their mind",
      action: "cancel",
      line: { name: "Dessert", list: "6.00", creditedTo: alex, stage: "unsent" },
      before: "6.00",
      after: "0.00",
      nominal: "6.00",
      by: alex,
      approvedBy: mia,
      byGuest: true,
      at: "2026-09-15T19:00:00.000Z",
    });
    await adjust({
      bill: visit.id,
      reason,
      reasonName: "Changed their mind",
      action: "comp",
      line: { name: "Coffee", list: "1.50", creditedTo: alex, stage: "served" },
      before: "1.50",
      after: "0.00",
      nominal: "1.50",
      by: alex,
      approvedBy: alex,
      at: "2026-09-15T19:30:00.000Z",
    });

    const read = await report();

    expect(read.guests).toMatchObject({
      ...tally(1, "6.00", "6.00"),
      byAction: { cancel: tally(1, "6.00", "6.00") },
      byStage: { beforeFiring: tally(1, "6.00", "6.00") },
    });
    // Alex approved his own comp: an approval given to nobody else.
    expect(personRow(read, alex)).toMatchObject({
      ...tally(1, "1.50", "0.00"),
      sales: "6.00",
      approvers: [{ personId: alex, name: "Alex", count: 1 }],
      approvalsGiven: 0,
    });
    expect(personRow(read, mia)).toMatchObject({ ...tally(0, "0.00", "0.00"), approvalsGiven: 1 });
    expect(read.overall.count).toBe(2);
    expect((await entries("guests")).map((row) => [row.id, row.byGuest])).toEqual([
      [guestCancel, true],
    ]);
    expect((await entries({ personId: alex })).map((row) => row.action)).toEqual(["comp"]);
  });

  it("names a person the directory no longer holds as nobody", async () => {
    const reason = await seedReason(db);
    const visit = await bill();
    const gone = randomUUID();
    await adjust({
      bill: visit.id,
      reason,
      reasonName: "House",
      action: "discount_amount",
      before: "10.00",
      after: "9.00",
      nominal: "10.00",
      by: gone,
      at: "2026-09-15T19:00:00.000Z",
    });

    const read = await report();

    expect(read.people).toMatchObject([{ personId: gone, name: null }]);
    expect(await entries()).toMatchObject([{ requestedBy: { personId: gone, name: null } }]);
  });
});

describe("the order of the rows", () => {
  it("orders people by name, a namesake by id and the unknown last; approvers by count, then name; reasons by reduction, then name, then id", async () => {
    // A suspended person's name is free for someone else.
    const [firstAna, secondAna] = [await person("Ana"), await person("Ana", "suspended")].sort();
    const bea = await person("Bea");
    const carl = await person("Carl");
    const [gone, alsoGone] = [randomUUID(), randomUUID()].sort();
    const house = await seedReason(db);
    const late = await seedReason(db);
    const large = await seedReason(db);
    const [twinA, twinB] = [await seedReason(db), await seedReason(db)].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const visit = await bill();
    let minute = 0;
    const comp = (
      by: string,
      approvedBy: string | undefined,
      reason: AdjustmentReason,
      name: string,
      price = "1.50",
    ) =>
      adjust({
        bill: visit.id,
        reason,
        reasonName: name,
        action: "comp",
        line: { name: "Coffee", list: price, creditedTo: by, stage: "served" },
        before: price,
        after: "0.00",
        nominal: price,
        by,
        approvedBy,
        at: `2026-09-15T19:${String((minute += 1)).padStart(2, "0")}:00.000Z`,
      });
    // Bea's four requests: two approved by Carl, one by each Ana. Every reason but "Zulu" takes
    // €3.00 off.
    await comp(bea, carl, house, "House");
    await comp(bea, carl, house, "House");
    await comp(bea, secondAna, late, "Late");
    await comp(bea, firstAna, late, "Late");
    await comp(alsoGone, undefined, twinB, "Twin");
    await comp(gone, undefined, twinA, "Twin");
    await comp(carl, undefined, twinA, "Twin");
    await comp(secondAna, undefined, twinB, "Twin");
    await comp(carl, undefined, large, "Zulu", "9.00");

    const read = await report();

    expect(read.people.map((row) => row.personId)).toEqual([
      firstAna,
      secondAna,
      bea,
      carl,
      gone,
      alsoGone,
    ]);
    expect(personRow(read, bea).approvers).toEqual([
      { personId: carl, name: "Carl", count: 2 },
      { personId: firstAna, name: "Ana", count: 1 },
      { personId: secondAna, name: "Ana", count: 1 },
    ]);
    expect(read.overall.byReason.map((row) => [row.reasonId, row.reasonName])).toEqual([
      [large.id, "Zulu"],
      [house.id, "House"],
      [late.id, "Late"],
      [twinA.id, "Twin"],
      [twinB.id, "Twin"],
    ]);
  });
});
