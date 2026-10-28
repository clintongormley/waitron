import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { adjustments, type AdjustmentAction } from "@waitron/adjustments";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  parties,
  saleLines,
  sales,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decimal, sumDecimals, toScale } from "@waitron/shared";
import { writePartyAllergy } from "@waitron/venue-service";
import { applyAdjustment, type AdjustmentArgs } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { seatTable } from "./parties.js";
import { createCourse } from "./kitchen.js";
import { formatReceipt } from "./receipt-ticket.js";
import {
  inTx,
  provisionAdjustmentVenue,
  rowsOf,
  type AdjustmentVenue,
  type RoundLine,
} from "./testing/adjustment-venue.js";
import { send } from "./testing/bill-venue.js";
import { printedLines } from "./testing/decode-ticket.js";
import { createTable } from "./testing/live-table.js";
import { addPortionRound } from "./testing/portion-bill.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import {
  bumpRevision,
  fireableLineColumns,
  fireLines,
  insertTabRound,
  priceTabRound,
  type TabRoundLine,
} from "./working-order.js";
import "./errors.js";

// A803 slice 1, Tasks 25a-1 to 25f: a discount or a comp on a row of identical portions acts as
// today's one line of the same count does. Every comparison builds the same bill twice — today's
// grouped shape, one line of n, and portions, n bound lines of one — applies the same request, and
// compares the money, the record, the filed rows and the receipt.
let venue: AdjustmentVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});

function roundOf(lines: RoundLine[]): TabRoundLine[] {
  return lines.map((line) => ({
    menuItemId: venue.item(line.name),
    quantity: line.quantity ?? "1",
    ...(line.olives === undefined
      ? {}
      : {
          extras: [
            {
              listId: venue.pizzaExtras,
              picks: [{ productId: venue.olivesId, quantity: line.olives }],
            },
          ],
        }),
  }));
}

async function seated(tx: Transaction): Promise<{ billId: string; partyId: string }> {
  const table = await createTable(tx, venue.cfg, {
    label: `R-${randomUUID().slice(0, 8)}`,
    zoneId: venue.tables.zoneId,
  });
  const party = await seatTable(tx, venue.cfg, {
    tableId: table.id,
    guestCount: null,
    operatorId: venue.staffId,
  });
  await writePartyAllergy(tx, party.partyId, { answer: "none", guests: [] }, venue.staffId);
  return { billId: party.tabId, partyId: party.partyId };
}

interface Bill {
  billId: string;
  partyId: string;
}

/** Today's shape: each request line one stored line of its count, fired. */
function groupedBill(lines: RoundLine[]): Promise<Bill> {
  return inTx(venue, async (tx) => {
    const bill = await seated(tx);
    const round = await priceTabRound(tx, venue.cfg, bill.billId, roundOf(lines), "checked");
    await insertTabRound(tx, venue.cfg, round, round.rows);
    const stored = await tx
      .select(fireableLineColumns)
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, bill.billId))
      .orderBy(workingOrderLines.lineNo);
    await fireLines(tx, venue.cfg, bill.billId, stored);
    await bumpRevision(tx, [bill.billId]);
    return bill;
  });
}

/** The same lines as bound portions, one dish per line, fired. */
function portionsBill(lines: RoundLine[]): Promise<Bill> {
  return inTx(venue, async (tx) => {
    const bill = await seated(tx);
    await addPortionRound(tx, venue.cfg, bill.billId, roundOf(lines), { fire: true });
    return bill;
  });
}

/** The ids of the bill's dish lines named `name`, in line order. */
async function dishesNamed(billId: string, name: string): Promise<string[]> {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, billId),
          eq(workingOrderLines.name, name),
          isNull(workingOrderLines.parentLineId),
        ),
      )
      .orderBy(asc(workingOrderLines.lineNo)),
  );
  return rows.map((row) => row.id);
}

type Ask = Partial<Omit<AdjustmentArgs, "amount">> & {
  action: AdjustmentAction;
  amount?: string;
};

async function argsFor(tx: Transaction, billId: string, ask: Ask): Promise<AdjustmentArgs> {
  const [order] = await tx
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  const { amount, ...rest } = ask;
  return {
    orderId: billId,
    expectedEdit: await readBillEditState(tx, billId),
    submissionId: randomUUID(),
    expectedRevision: order!.revision,
    lineId: null,
    reasonId: ask.action === "cancel" ? venue.reasonId.houseVoid : venue.reasonId.house,
    note: null,
    operatorId: venue.supervisorId,
    ...rest,
    ...(amount === undefined ? {} : { amount: decimal(amount) }),
  };
}

function adjust(billId: string, ask: Ask) {
  return inTx(venue, async (tx) =>
    applyAdjustment(tx, venue.cfg, await argsFor(tx, billId, ask), venue.venueLocale),
  );
}

/** Each working line by id, as `name unit-price`: what a recorded id stands for. */
async function describeIds(billId: string): Promise<Map<string, string>> {
  return new Map(
    (await rowsOf(venue, billId)).map((row) => [row.id, `${row.name} ${row.unitPriceGross}`]),
  );
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

/** The printed receipt's goods, from the first goods row to the rule under them: each row with the
 * adjustment lines indented under it, as one block. */
function goodsBlocks(printed: string[], invoiceNumber: string): string[][] {
  const start = printed.findIndex((line) => line.startsWith(`${invoiceNumber} `)) + 2;
  const rule = printed.findIndex((line, at) => at > start && /^-+$/.test(line));
  const blocks: string[][] = [];
  for (const line of printed.slice(start, rule)) {
    if (line.startsWith(" ") && blocks.length > 0) blocks.at(-1)!.push(line);
    else blocks.push([line]);
  }
  return blocks;
}

const sortedJson = (values: readonly unknown[]) => values.map((v) => JSON.stringify(v)).sort();

/**
 * Everything the request changed that a person or the tax agency sees: the bill's rows' money, the
 * recorded adjustment (ids as what they stand for), the filed rows and VAT, and the receipt. The
 * bill is paid in cash to file it.
 */
async function outcomeOf(billId: string) {
  const ids = await describeIds(billId);
  const [record, ...more] = await recordedOn(billId);
  expect(more).toEqual([]);
  const rows = await rowsOf(venue, billId);
  const due = toScale(sumDecimals(rows.map((row) => decimal(row.lineTotal))), 2);
  const result = await payWorkingOrder(
    { db: venue.db, backend: venue.backend, clock: venue.clock },
    venue.cfg,
    { id: billId, tender: { method: "cash", amount: due }, lines: [] },
  );
  const [sale] = await inTx(venue, (tx) =>
    tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
  );
  const filed = await inTx(venue, (tx) =>
    tx
      .select({
        id: saleLines.id,
        name: saleLines.name,
        quantity: saleLines.quantity,
        unit: saleLines.unitPrice,
        base: saleLines.lineTotal,
        gross: saleLines.lineGross,
        listGross: saleLines.listGross,
        listUnit: saleLines.listUnitPriceGross,
        parent: saleLines.parentLineId,
      })
      .from(saleLines)
      .where(eq(saleLines.saleId, sale!.id)),
  );
  const printed = printedLines(
    formatReceipt({
      result,
      issuer: { venueName: "Ajustes SL", nif: "62000003K" },
      receipt: {},
      invoiceLocale: "es-ES",
      printer: { paperWidth: "80mm", resolution: "180dpi" },
    }),
  );
  const blocks = goodsBlocks(printed, result.invoiceNumber);
  return {
    due,
    record: {
      lineId: record!.lineId === null ? null : ids.get(record!.lineId),
      action: record!.action,
      quantity: record!.quantity,
      lineQuantity: record!.lineQuantity,
      reduction: record!.reduction,
      nominalValue: record!.nominalValue,
      beforeAmount: record!.beforeAmount,
      afterAmount: record!.afterAmount,
      stage: record!.stage,
      lineName: record!.lineName,
      lineListUnitPrice: record!.lineListUnitPrice,
      splits: sortedJson(
        (record!.splits ?? []).map(({ from, to }) => ({ from: ids.get(from), to: ids.get(to) })),
      ),
      compedExtras: (record!.compedExtras ?? []).map((id) => ids.get(id)).sort(),
    },
    filed: sortedJson(
      filed.map(({ id, parent, ...row }) => {
        void id;
        const dish = filed.find((other) => other.id === parent);
        return { ...row, under: dish === undefined ? null : `${dish.name} ${dish.unit}` };
      }),
    ),
    total: sale!.total,
    vat: sale!.vatBreakdown,
    receiptLines: sortedJson(result.lines),
    billAdjustments: result.billAdjustments ?? null,
    printed: sortedJson(blocks),
    printedTotal: printed.find((line) => line.startsWith("TOTAL")),
    blocks,
  };
}

/**
 * Applies `ask` to the dishes named `target` on both shapes — today's one line, and every portion
 * of the row named in `lineIds` — and answers both outcomes.
 */
async function bothShapes(lines: RoundLine[], target: string, ask: Ask) {
  const grouped = await groupedBill(lines);
  const portions = await portionsBill(lines);
  const [line] = await dishesNamed(grouped.billId, target);
  const members = await dishesNamed(portions.billId, target);
  await adjust(grouped.billId, { ...ask, lineId: line! });
  await adjust(portions.billId, { ...ask, lineId: members[0]!, lineIds: members });
  return {
    grouped: await outcomeOf(grouped.billId),
    portions: await outcomeOf(portions.billId),
    portionsBill: portions,
  };
}

/** The two outcomes equal on everything but the receipt's row order and the comped extras' ids
 * (one per portion where today has one per line). */
function expectSameMoney(
  grouped: Awaited<ReturnType<typeof outcomeOf>>,
  portions: Awaited<ReturnType<typeof outcomeOf>>,
) {
  const strip = ({ blocks, record, ...rest }: typeof grouped) => {
    void blocks;
    const { compedExtras, ...kept } = record;
    void compedExtras;
    return { ...rest, record: kept };
  };
  expect(strip(portions)).toEqual(strip(grouped));
}

const bread: RoundLine = { name: "Bread" };

describe("A803 portions: a discount or comp on a whole row of identical portions", () => {
  it("A803 portions: 10% off a row of three €3.33 croquetas files 2 × €3.00 and 1 × €2.99 and prints one 10% line under the row, as one line of three does", async () => {
    const {
      grouped,
      portions,
      portionsBill: bill,
    } = await bothShapes([{ name: "Croquetas", quantity: "3" }, bread], "Croquetas", {
      action: "discount_percent",
      percentBp: 1000,
    });

    expect(grouped.record.reduction).toBe(100);
    expect(grouped.due).toBe("11.49");
    expectSameMoney(grouped, portions);
    // Each portion holds its own price, the higher to the earlier; the Bread keeps its own.
    expect(
      (await rowsOf(venue, bill.billId)).map((row) => [
        row.name,
        row.unitPriceGross,
        row.listUnitPriceGross,
      ]),
    ).toEqual([
      ["Croquetas", "3.00", "3.33"],
      ["Croquetas", "3.00", "3.33"],
      ["Croquetas", "2.99", "3.33"],
      ["Bread", "2.50", null],
    ]);
    // Stated difference 1: today the cheaper part is numbered, and printed, after the Bread. Each
    // goods row as its count and its amount before the discount line under it.
    const countAndAmount = (blocks: string[][]) =>
      blocks.map((block) => [block[0]!.split(" ")[0], block[0]!.split(" ").at(-1)]);
    expect(countAndAmount(grouped.blocks)).toEqual([
      ["2", "6,66"],
      ["1", "2,50"],
      ["1", "3,33"],
    ]);
    expect(countAndAmount(portions.blocks)).toEqual([
      ["2", "6,66"],
      ["1", "3,33"],
      ["1", "2,50"],
    ]);
  });

  it("A803 portions: €1.00 off a row of seven croquetas prices five at €3.19 and two at €3.18, as one line of seven", async () => {
    const { grouped, portions } = await bothShapes(
      [{ name: "Croquetas", quantity: "7" }, bread],
      "Croquetas",
      { action: "discount_amount", amount: "1.00" },
    );

    expect(grouped.record.reduction).toBe(100);
    expect(grouped.due).toBe("24.81");
    expectSameMoney(grouped, portions);
  });

  it("A803 portions: €0.05 off a row of three pizzas with an olive each takes €0.03, as one line of three does, not €0.05", async () => {
    const { grouped, portions } = await bothShapes(
      [{ name: "Pizza", quantity: "3", olives: 1 }, bread],
      "Pizza",
      { action: "discount_amount", amount: "0.05" },
    );

    expect(grouped.record.reduction).toBe(3);
    expectSameMoney(grouped, portions);

    // The control: the same three portions named one at a time take a different amount.
    const alone = await portionsBill([{ name: "Pizza", quantity: "3", olives: 1 }, bread]);
    for (const lineId of await dishesNamed(alone.billId, "Pizza")) {
      await adjust(alone.billId, { lineId, action: "discount_amount", amount: "0.05" });
    }
    const taken = (await recordedOn(alone.billId)).reduce((sum, row) => sum + row.reduction, 0);
    expect(taken).not.toBe(3);
  });

  it("A803 portions: 10% off a row of three pizzas with two olives each takes €3.60 off €36.00, as one line of three does", async () => {
    const { grouped, portions } = await bothShapes(
      [{ name: "Pizza", quantity: "3", olives: 2 }, bread],
      "Pizza",
      { action: "discount_percent", percentBp: 1000 },
    );

    expect(grouped.record.reduction).toBe(360);
    expectSameMoney(grouped, portions);
  });

  it("A803 portions: €0.02 off a row of two pizzas with two olives each breaks the cent's tie on the pizza, as one line of two does", async () => {
    const { grouped, portions } = await bothShapes(
      [{ name: "Pizza", quantity: "2", olives: 2 }, bread],
      "Pizza",
      { action: "discount_amount", amount: "0.02" },
    );

    expectSameMoney(grouped, portions);
  });

  it("A803 portions: a comp of a row of three croquetas zeroes all three, lists none as comped extras, and prints one comp under the row", async () => {
    const {
      grouped,
      portions,
      portionsBill: bill,
    } = await bothShapes([{ name: "Croquetas", quantity: "3" }, bread], "Croquetas", {
      action: "comp",
      reasonId: venue.reasonId.complaint,
    });

    expect(grouped.record.reduction).toBe(999);
    expect(grouped.record.compedExtras).toEqual([]);
    expectSameMoney(grouped, portions);
    expect((await rowsOf(venue, bill.billId)).map((row) => [row.name, row.unitPriceGross])).toEqual(
      [
        ["Croquetas", "0.00"],
        ["Croquetas", "0.00"],
        ["Croquetas", "0.00"],
        ["Bread", "2.50"],
      ],
    );
  });

  it("A803 portions: a comp of a row of two pizzas with an olive each records both olives as comped extras", async () => {
    const { grouped, portions } = await bothShapes(
      [{ name: "Pizza", quantity: "2", olives: 1 }, bread],
      "Pizza",
      { action: "comp", reasonId: venue.reasonId.complaint },
    );

    expectSameMoney(grouped, portions);
    // Today's one olives line is one comped extra; the row's two olives lines are both listed.
    expect(grouped.record.compedExtras).toEqual(["Olives 0.00"]);
    expect(portions.record.compedExtras).toEqual(["Olives 0.00", "Olives 0.00"]);
  });
});

/** Everything an adjustment could change on a bill, to show that a refused one changed nothing. */
async function stateOf(billId: string) {
  const state = await inTx(venue, async (tx) => {
    const [order] = await tx
      .select({ revision: workingOrders.revision, party: parties.revision })
      .from(workingOrders)
      .innerJoin(parties, eq(parties.id, workingOrders.partyId))
      .where(eq(workingOrders.id, billId));
    return { order };
  });
  return { ...state, recorded: await recordedOn(billId), rows: await rowsOf(venue, billId) };
}

/** `ask` is refused with `code` (and `params`, when given), changing nothing. */
async function refusedWith(billId: string, ask: Ask, code: string, params?: object) {
  const before = await stateOf(billId);
  await expect(adjust(billId, ask)).rejects.toMatchObject({
    code,
    ...(params === undefined ? {} : { params }),
  });
  expect(await stateOf(billId)).toEqual(before);
}

/** What refused `ask`, or null when it went through. */
async function refusalOf(billId: string, ask: Ask): Promise<unknown> {
  try {
    await adjust(billId, ask);
    return null;
  } catch (error) {
    return { code: (error as { code?: string }).code };
  }
}

const tenOff = { action: "discount_percent", percentBp: 1000 } as const;
const fieldLineIds = { field: "lineIds" };

describe("A803 portions: refusing a row the till could not have drawn", () => {
  it("A803 portions: portions of two different rows, one already discounted, are refused management.request_invalid on lineIds", async () => {
    const { billId } = await portionsBill([{ name: "Croquetas", quantity: "2" }]);
    const [first, second] = await dishesNamed(billId, "Croquetas");
    await adjust(billId, { ...tenOff, lineId: first! });

    await refusedWith(
      billId,
      { ...tenOff, lineId: first!, lineIds: [first!, second!] },
      "management.request_invalid",
      fieldLineIds,
    );
  });

  it("A803 portions: a line not on the bill is refused the same way", async () => {
    const { billId } = await portionsBill([{ name: "Croquetas", quantity: "2" }]);
    const [first] = await dishesNamed(billId, "Croquetas");

    await refusedWith(
      billId,
      { ...tenOff, lineId: first!, lineIds: [first!, randomUUID()] },
      "management.request_invalid",
      fieldLineIds,
    );
  });

  it("A803 portions: two measured portions are refused the same way", async () => {
    const { billId } = await portionsBill([
      { name: "Ham", quantity: "0.250" },
      { name: "Ham", quantity: "0.250" },
    ]);
    const hams = await dishesNamed(billId, "Ham");
    expect(hams).toHaveLength(2);

    await refusedWith(
      billId,
      { ...tenOff, lineId: hams[0]!, lineIds: hams },
      "management.request_invalid",
      fieldLineIds,
    );
  });

  it("A803 portions: one id twice is refused the same way", async () => {
    const { billId } = await portionsBill([{ name: "Croquetas", quantity: "2" }]);
    const [first] = await dishesNamed(billId, "Croquetas");

    await refusedWith(
      billId,
      { ...tenOff, lineId: first!, lineIds: [first!, first!] },
      "management.request_invalid",
      fieldLineIds,
    );
  });

  it("A803 portions: an extra named among a row's dishes is refused the same way", async () => {
    const { billId } = await portionsBill([{ name: "Pizza", quantity: "2", olives: 1 }]);
    const [first] = await dishesNamed(billId, "Pizza");
    const olives = (await rowsOf(venue, billId)).find((row) => row.parentLineId === first)!;

    await refusedWith(
      billId,
      { ...tenOff, lineId: first!, lineIds: [first!, olives.id] },
      "management.request_invalid",
      fieldLineIds,
    );
  });

  it("A803 portions: two croquetas from two rounds, one with a kitchen note, are refused the same way", async () => {
    const { billId } = await portionsBill([{ name: "Croquetas" }]);
    await inTx(venue, (tx) =>
      addPortionRound(tx, venue.cfg, billId, [
        { ...roundOf([{ name: "Croquetas" }])[0]!, note: "no salt" },
      ]),
    );
    const croquetas = await dishesNamed(billId, "Croquetas");

    await refusedWith(
      billId,
      { ...tenOff, lineId: croquetas[0]!, lineIds: croquetas },
      "management.request_invalid",
      fieldLineIds,
    );
  });

  it("A803 portions: two croquetas from two rounds, one in a course, are refused the same way", async () => {
    const { billId } = await portionsBill([{ name: "Croquetas" }]);
    await inTx(venue, async (tx) => {
      const course = await createCourse(tx, venue.cfg, { name: "Starters", displayOrder: 90 });
      await addPortionRound(tx, venue.cfg, billId, [
        { ...roundOf([{ name: "Croquetas" }])[0]!, courseId: course.id },
      ]);
    });
    const croquetas = await dishesNamed(billId, "Croquetas");

    await refusedWith(
      billId,
      { ...tenOff, lineId: croquetas[0]!, lineIds: croquetas },
      "management.request_invalid",
      fieldLineIds,
    );
  });

  it("A803 portions: two identical unbound one-unit lines named together are refused the same way", async () => {
    const { billId } = await groupedBill([{ name: "Burger" }, { name: "Burger" }]);
    const burgers = await dishesNamed(billId, "Burger");
    expect(burgers).toHaveLength(2);

    await refusedWith(
      billId,
      { ...tenOff, lineId: burgers[0]!, lineIds: burgers },
      "management.request_invalid",
      fieldLineIds,
    );
  });

  it("A803 portions: part of a row is refused until a part can be taken", async () => {
    const { billId } = await portionsBill([{ name: "Croquetas", quantity: "3" }]);
    const members = await dishesNamed(billId, "Croquetas");

    await refusedWith(
      billId,
      { ...tenOff, lineId: members[0]!, lineIds: members, quantity: "1" },
      "adjustment.quantity_invalid",
    );
  });

  it("A803 portions: a row one of whose portions was paid by item is refused as a line paid in part is today", async () => {
    const pay = async (
      billId: string,
      line: { lineNo: number; quantity?: string },
      amount: string,
    ) =>
      send(venue.app, venue.cookie.staff, "POST", `/api/working-orders/${billId}/payments`, {
        submissionId: randomUUID(),
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
        tip: "0.00",
        kind: "items",
        lines: [line],
        method: "cash",
        tendered: amount,
        applied: amount,
      });
    const grouped = await groupedBill([{ name: "Burger", quantity: "2" }, bread]);
    const portions = await portionsBill([{ name: "Burger", quantity: "2" }, bread]);
    const paidGrouped = await pay(grouped.billId, { lineNo: 1, quantity: "1" }, "12.00");
    expect(paidGrouped.status, JSON.stringify(paidGrouped.json)).toBe(200);
    const paidPortion = await pay(portions.billId, { lineNo: 2 }, "12.00");
    expect(paidPortion.status, JSON.stringify(paidPortion.json)).toBe(200);
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const members = await dishesNamed(portions.billId, "Burger");

    const today = await refusalOf(grouped.billId, { action: "comp", lineId: line! });
    expect(today).toEqual({ code: "bill.line_paid" });
    const before = await stateOf(portions.billId);
    expect(
      await refusalOf(portions.billId, { action: "comp", lineId: members[0]!, lineIds: members }),
    ).toEqual(today);
    expect(await stateOf(portions.billId)).toEqual(before);
  });

  it("A803 portions: a row one of whose portions another draft holds is refused as a recalled line is", async () => {
    const recall = async (bill: Bill, lineId: string) => {
      const answer = await send(
        venue.app,
        venue.cookie.staff,
        "POST",
        `/api/parties/${bill.partyId}/lines/${lineId}/recall`,
        {
          submissionId: randomUUID(),
          expectedPartyRevision: (
            await inTx(venue, (tx) =>
              tx
                .select({ revision: parties.revision })
                .from(parties)
                .where(eq(parties.id, bill.partyId)),
            )
          )[0]!.revision,
          expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, bill.billId)),
        },
      );
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    };
    // The person whose draft holds the recalled dish, acting outside that draft.
    const asStaff = { ...tenOff, operatorId: venue.staffId };
    const grouped = await groupedBill([{ name: "Burger", quantity: "2" }]);
    const portions = await portionsBill([{ name: "Burger", quantity: "2" }]);
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const members = await dishesNamed(portions.billId, "Burger");
    await recall(grouped, line!);
    await recall(portions, members[1]!);

    const today = await refusalOf(grouped.billId, { ...asStaff, lineId: line! });
    expect(today).toEqual({ code: "draft.out_of_date" });
    const before = await stateOf(portions.billId);
    expect(
      await refusalOf(portions.billId, { ...asStaff, lineId: members[0]!, lineIds: members }),
    ).toEqual(today);
    expect(await stateOf(portions.billId)).toEqual(before);
  });
});

describe("A803 portions: a replayed row request", () => {
  it("A803 portions: a replayed request with the same submission id records one adjustment", async () => {
    const { billId } = await portionsBill([{ name: "Croquetas", quantity: "3" }]);
    const members = await dishesNamed(billId, "Croquetas");
    const args = await inTx(venue, (tx) =>
      argsFor(tx, billId, { ...tenOff, lineId: members[0]!, lineIds: members }),
    );

    const first = await inTx(venue, (tx) =>
      applyAdjustment(tx, venue.cfg, args, venue.venueLocale),
    );
    const again = await inTx(venue, (tx) =>
      applyAdjustment(tx, venue.cfg, args, venue.venueLocale),
    );

    expect(again).toEqual(first);
    expect(await recordedOn(billId)).toMatchObject([{ reduction: 100, lineQuantity: 3000 }]);
  });
});

describe("A803 portions: the adjustment routes name a row", () => {
  async function post(billId: string, body: Record<string, unknown>, path = "") {
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, billId)),
    );
    return send(
      venue.app,
      venue.cookie.supervisor,
      "POST",
      `/api/working-orders/${billId}/adjustments${path}`,
      {
        submissionId: randomUUID(),
        expectedRevision: order!.revision,
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
        reasonId: venue.reasonId.house,
        note: null,
        ...body,
      },
    );
  }

  it("A803 portions: 10% off a row through the route takes €1.00 off the three, and its preview names the row's first portion", async () => {
    const { billId } = await portionsBill([{ name: "Croquetas", quantity: "3" }]);
    const members = await dishesNamed(billId, "Croquetas");
    const body = { ...tenOff, lineId: members[1], lineIds: [members[1], members[0], members[2]] };

    const preview = await post(billId, body, "/preview");
    expect(preview.status, JSON.stringify(preview.json)).toBe(200);
    expect(preview.json).toMatchObject({
      reduction: "1.00",
      lines: [
        {
          lineId: members[0],
          lineNo: 1,
          reduction: "1.00",
          rows: [
            { quantity: "2.000", unitGross: "3.00" },
            { quantity: "1.000", unitGross: "2.99" },
          ],
        },
      ],
    });
    const applied = await post(billId, body);
    expect(applied.status, JSON.stringify(applied.json)).toBe(200);
    expect(await recordedOn(billId)).toMatchObject([
      { lineId: members[0], reduction: 100, quantity: 3000, lineQuantity: 3000 },
    ]);
  });

  it.each([
    ["not a list", () => "x"],
    ["one line", (ids: string[]) => [ids[0]]],
    ["a line that is not an id", (ids: string[]) => [ids[0], "nope"]],
    ["without the line named", (ids: string[]) => [ids[1], ids[2]]],
    ["one line twice", (ids: string[]) => [ids[0], ids[0]]],
  ])(
    "A803 portions: lineIds %s is refused management.request_invalid on lineIds",
    async (_, of) => {
      const { billId } = await portionsBill([{ name: "Croquetas", quantity: "3" }]);
      const members = await dishesNamed(billId, "Croquetas");

      const answer = await post(billId, { ...tenOff, lineId: members[0], lineIds: of(members) });

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: "lineIds" },
      });
      expect(await recordedOn(billId)).toEqual([]);
    },
  );
});
