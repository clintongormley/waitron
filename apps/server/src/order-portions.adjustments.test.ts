import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  adjustmentLines,
  adjustmentRefunds,
  adjustments,
  createAdjustmentReason,
  type AdjustmentAction,
} from "@waitron/adjustments";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billPayments,
  lineServiceCancellations,
  orderPortionEvents,
  parties,
  printJobs,
  saleLines,
  sales,
  tenants,
  tenders,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  centsToDecimal,
  decimal,
  decimalToCents,
  sumDecimals,
  thousandthsToDecimal,
  toScale,
} from "@waitron/shared";
import { writePartyAllergy } from "@waitron/venue-service";
import { applyAdjustment, previewAdjustment, type AdjustmentArgs } from "./adjustments-apply.js";
import { mergeCheckedBills, transferItems } from "./bill-actions.js";
import { readBillEditState } from "./bill-editing.js";
import { completeBillPayment } from "./bill-payments.js";
import { setOrderInvoiceChoice } from "./testing/order-writer-fixture.js";
import { partyRevision, partyRevisionOfOrder, seatTable } from "./parties.js";
import { createCourse } from "./kitchen.js";
import type { BillDraftSnapshot, Draft } from "./order-drafts.js";
import { cancelItem, type CancelItemAsk } from "./line-cancel.js";
import { readCancellationContext } from "./line-cancel-context.js";
import {
  moveLinesToGroup,
  printHoldTickets,
  splitHeldLineIntoUnits,
  startGroup,
} from "./order-groups.js";
import { formatReceipt } from "./receipt-ticket.js";
import {
  inTx,
  PINS,
  provisionAdjustmentVenue,
  REASONS,
  rowsOf,
  type AdjustmentVenue,
  type RoundLine,
} from "./testing/adjustment-venue.js";
import { send } from "./testing/bill-venue.js";
import { printedLines } from "./testing/decode-ticket.js";
import { createTable } from "./testing/live-table.js";
import { addPortionRound } from "./testing/portion-bill.js";
import { splitPartyBill } from "./testing/serve-line.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import {
  bumpRevision,
  fireableLineColumns,
  fireLines,
  insertTabRound,
  markServed,
  priceTabRound,
  readOrderRevision,
  readStoredOrder,
  updateOrderLine,
  type TabRoundLine,
} from "./working-order.js";
import {
  watchDerivationsAndLock,
  watchedDerivationCount,
  watchedOrder,
} from "./testing/watched-scrypt.js";
import "./errors.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

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
    // Each extra names its dish by what it shows, not by its position (stated difference 1).
    receiptLines: sortedJson(
      result.lines.map(({ parentLineNo, ...line }) => {
        const dish = parentLineNo == null ? undefined : result.lines[parentLineNo - 1];
        return {
          ...line,
          under: dish === undefined ? null : `${dish.descriptions["es-ES"]} ${dish.gross}`,
        };
      }),
    ),
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

/** Files the bill as a full invoice to a business, paid by card, and answers the invoice's lines. */
async function invoiceOf(billId: string) {
  const [taxpayer] = await inTx(venue, (tx) => tx.select().from(tenants));
  try {
    await inTx(venue, (tx) =>
      tx
        .update(tenants)
        .set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" })
        .where(eq(tenants.id, 1)),
    );
    const [order] = await inTx(venue, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
    );
    await setOrderInvoiceChoice(venue.db, venue.backend, venue.cfg, billId, {
      revision: order!.revision,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    return await inTx(venue, async (tx) => {
      const stored = await readStoredOrder(tx, billId);
      const [payment] = await tx
        .insert(billPayments)
        .values({
          workingOrderId: billId,
          submissionId: randomUUID(),
          fingerprint: `a803-portions-f1-${billId}`,
          kind: "contribution",
          method: "card",
          applied: decimalToCents(sumDecimals(stored.gross.lines.map((line) => line.lineGross))),
          state: "pending",
          requestedBy: venue.supervisorId,
          source: venue.cfg.origin.source,
          deviceId: venue.cfg.origin.deviceId,
        })
        .returning();
      return (await completeBillPayment(tx, venue, venue.cfg, payment!.id, new Date())).invoice!
        .lines;
    });
  } finally {
    await inTx(venue, (tx) =>
      tx
        .update(tenants)
        .set({ taxpayerDomicile: taxpayer!.taxpayerDomicile })
        .where(eq(tenants.id, 1)),
    );
  }
}

/** A full invoice's lines as `[name, quantity, gross, family, entries]`, as a set. */
const invoiceRows = (lines: Awaited<ReturnType<typeof invoiceOf>>) =>
  sortedJson(
    lines.map((line) => [
      line.descriptions["es-ES"],
      line.quantity,
      line.gross,
      line.dishFamily ?? null,
      line.adjustments ?? [],
    ]),
  );

/** Each working line as `[name, unit price, list price]`, in line order. */
const pricesOf = async (billId: string) =>
  (await rowsOf(venue, billId)).map((row) => [
    row.name,
    row.unitPriceGross,
    row.listUnitPriceGross,
  ]);

describe("A803 portions: part of a row, and a row's extras", () => {
  it("A803 portions: 10% off 1 of a row of three takes the last portion, keeps the other two at €3.33 with their list price stamped, and records 1 of 3 on the row's first portion with a split to the portion taken", async () => {
    const lines = [{ name: "Croquetas", quantity: "3" }, bread];
    const ask = { ...tenOff, quantity: "1" };
    const { grouped, portions, portionsBill: bill } = await bothShapes(lines, "Croquetas", ask);

    expect(grouped.record).toMatchObject({ reduction: 33, quantity: 1000, lineQuantity: 3000 });
    expectSameMoney(grouped, portions);
    expect(await pricesOf(bill.billId)).toEqual([
      ["Croquetas", "3.33", "3.33"],
      ["Croquetas", "3.33", "3.33"],
      ["Croquetas", "3.00", "3.33"],
      ["Bread", "2.50", null],
    ]);
    const members = await dishesNamed(bill.billId, "Croquetas");
    expect(await recordedOn(bill.billId)).toMatchObject([
      { lineId: members[0], splits: [{ from: members[0], to: members[2] }] },
    ]);

    // A full invoice places the entry under the portion taken and marks the family, as today.
    const groupedF1 = await groupedBill(lines);
    const portionsF1 = await portionsBill(lines);
    const [line] = await dishesNamed(groupedF1.billId, "Croquetas");
    const row = await dishesNamed(portionsF1.billId, "Croquetas");
    await adjust(groupedF1.billId, { ...ask, lineId: line! });
    await adjust(portionsF1.billId, { ...ask, lineId: row[0]!, lineIds: row });
    const today = await invoiceOf(groupedF1.billId);
    expect(today.some((one) => one.dishFamily === 0)).toBe(true);
    expect(invoiceRows(await invoiceOf(portionsF1.billId))).toEqual(invoiceRows(today));
  });

  it("A803 portions: 10% off 2 of a row of three croquetas prices them €3.00 and €2.99 and records today's second-price split from the first portion taken", async () => {
    const {
      grouped,
      portions,
      portionsBill: bill,
    } = await bothShapes([{ name: "Croquetas", quantity: "3" }, bread], "Croquetas", {
      ...tenOff,
      quantity: "2",
    });

    expectSameMoney(grouped, portions);
    expect(grouped.record.splits).toHaveLength(2);
    const members = await dishesNamed(bill.billId, "Croquetas");
    expect((await pricesOf(bill.billId)).map(([, unit]) => unit)).toEqual([
      "3.33",
      "3.00",
      "2.99",
      "2.50",
    ]);
    expect(await recordedOn(bill.billId)).toMatchObject([
      {
        splits: [
          { from: members[0], to: members[1] },
          { from: members[1], to: members[2] },
        ],
      },
    ]);
  });

  it("A803 portions: €0.01 off 2 of a row of three breads files the full-price bread taken with the one not taken, as one row (a stated difference from today's three rows)", async () => {
    const { grouped, portions } = await bothShapes([{ name: "Bread", quantity: "3" }], "Bread", {
      action: "discount_amount",
      amount: "0.01",
      quantity: "2",
    });
    // Each filed row as [quantity, base, gross], in thousandths and cents.
    const shape = (filed: string[]) =>
      filed
        .map((row) => {
          const { quantity, base, gross } = JSON.parse(row) as Record<string, number>;
          return [quantity, base, gross];
        })
        .sort((x, y) => x[0]! - y[0]! || x[2]! - y[2]!);

    expect(portions.total).toBe(grouped.total);
    expect(portions.record).toEqual(grouped.record);
    expect(shape(grouped.filed)).toEqual([
      [1000, 226, 249],
      [1000, 227, 250],
      [1000, 227, 250],
    ]);
    expect(shape(portions.filed)).toEqual([
      [1000, 226, 249],
      [2000, 455, 500],
    ]);
  });

  it("A803 portions: a comp of 1 of a row of two pizzas with an olive each takes the last pizza and its olive, with a split for each", async () => {
    const {
      grouped,
      portions,
      portionsBill: bill,
    } = await bothShapes([{ name: "Pizza", quantity: "2", olives: 1 }, bread], "Pizza", {
      action: "comp",
      reasonId: venue.reasonId.complaint,
      quantity: "1",
    });

    expect(grouped.record).toMatchObject({ reduction: 1050, quantity: 1000, lineQuantity: 2000 });
    expectSameMoney(grouped, portions);
    expect(await pricesOf(bill.billId)).toEqual([
      ["Pizza", "9.00", "9.00"],
      ["Olives", "1.50", "1.50"],
      ["Pizza", "0.00", "9.00"],
      ["Olives", "0.00", "1.50"],
      ["Bread", "2.50", null],
    ]);
    const ids = (await rowsOf(venue, bill.billId)).map((row) => row.id);
    expect(await recordedOn(bill.billId)).toMatchObject([
      {
        lineId: ids[0],
        splits: [
          { from: ids[0], to: ids[2] },
          { from: ids[1], to: ids[3] },
        ],
      },
    ]);
  });

  /** The olives of the bill's pizzas: today's one line, or every portion's, in line order. */
  const olivesOf = async (billId: string) =>
    (await rowsOf(venue, billId)).filter((row) => row.name === "Olives").map((row) => row.id);

  it("A803 portions: the olives of a row of two pizzas, named together, are discounted as one olives line", async () => {
    const lines = [{ name: "Pizza", quantity: "2", olives: 2 }, bread];
    const grouped = await groupedBill(lines);
    const portions = await portionsBill(lines);
    const [line] = await olivesOf(grouped.billId);
    const members = await olivesOf(portions.billId);
    expect(members).toHaveLength(2);
    const ask = { action: "discount_amount", amount: "0.03" } as const;
    await adjust(grouped.billId, { ...ask, lineId: line! });
    await adjust(portions.billId, { ...ask, lineId: members[1]!, lineIds: members });

    const today = await outcomeOf(grouped.billId);
    // Today's olives line takes a whole cent off each olive.
    expect(today.record).toMatchObject({ reduction: 4, lineQuantity: 4000 });
    const rows = await outcomeOf(portions.billId);
    expectSameMoney(today, rows);
    expect(await recordedOn(portions.billId)).toMatchObject([{ lineId: members[0] }]);
  });

  it("A803 portions: part of a row takes the last portion not already cancelled", async () => {
    const { billId } = await portionsBill([{ name: "Croquetas", quantity: "3" }]);
    const members = await dishesNamed(billId, "Croquetas");
    await inTx(venue, (tx) =>
      tx.insert(lineServiceCancellations).values({
        lineId: members[2]!,
        quantity: 1000,
        cancelledAt: new Date().toISOString(),
        wasStarted: true,
        actorId: venue.staffId,
      }),
    );

    await adjust(billId, { ...tenOff, lineId: members[0]!, lineIds: members, quantity: "1" });

    expect((await pricesOf(billId)).map(([, unit]) => unit)).toEqual(["3.33", "3.00", "3.33"]);
  });

  it("A803 portions: half a portion of a row is refused adjustment.quantity_invalid", async () => {
    const { billId } = await portionsBill([{ name: "Croquetas", quantity: "3" }]);
    const members = await dishesNamed(billId, "Croquetas");

    await refusedWith(
      billId,
      { ...tenOff, lineId: members[0]!, lineIds: members, quantity: "1.5" },
      "adjustment.quantity_invalid",
    );
  });

  it("A803 portions: a row's olives are refused when one of their pizzas was paid by item, as today's olives line is", async () => {
    const lines = [{ name: "Pizza", quantity: "2", olives: 1 }, bread];
    const grouped = await groupedBill(lines);
    const portions = await portionsBill(lines);
    // A dish with extras is paid by item only whole, with its extras.
    const payOne = async (billId: string, lineNo: number, amount: string) => {
      const answer = await send(
        venue.app,
        venue.cookie.staff,
        "POST",
        `/api/working-orders/${billId}/payments`,
        {
          submissionId: randomUUID(),
          expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
          tip: "0.00",
          kind: "items",
          lines: [{ lineNo }],
          method: "cash",
          tendered: amount,
          applied: amount,
        },
      );
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    };
    await payOne(grouped.billId, 1, "21.00");
    await payOne(portions.billId, 3, "10.50");
    const [line] = await olivesOf(grouped.billId);
    const members = await olivesOf(portions.billId);

    const today = await refusalOf(grouped.billId, { ...tenOff, lineId: line! });
    expect(today).toEqual({ code: "bill.line_paid" });
    expect(
      await refusalOf(portions.billId, { ...tenOff, lineId: members[0]!, lineIds: members }),
    ).toEqual(today);
  });

  it("A803 portions: part of a row's olives is refused adjustment.quantity_invalid, changing nothing", async () => {
    const { billId } = await portionsBill([{ name: "Pizza", quantity: "2", olives: 1 }]);
    const members = await olivesOf(billId);

    await refusedWith(
      billId,
      { ...tenOff, lineId: members[0]!, lineIds: members, quantity: "1" },
      "adjustment.quantity_invalid",
    );
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

  it("A803 portions: more of a row than it holds is refused adjustment.quantity_invalid", async () => {
    const { billId } = await portionsBill([{ name: "Croquetas", quantity: "3" }]);
    const members = await dishesNamed(billId, "Croquetas");

    await refusedWith(
      billId,
      { ...tenOff, lineId: members[0]!, lineIds: members, quantity: "4" },
      "adjustment.quantity_invalid",
    );
  });

  it("A803 portions: olives of two different rows' pizzas named together are refused management.request_invalid on lineIds", async () => {
    const { billId } = await portionsBill([{ name: "Pizza", olives: 1 }]);
    await inTx(venue, (tx) =>
      addPortionRound(tx, venue.cfg, billId, [
        { ...roundOf([{ name: "Pizza", olives: 1 }])[0]!, note: "well done" },
      ]),
    );
    const olives = (await rowsOf(venue, billId))
      .filter((row) => row.parentLineId !== null)
      .map((row) => row.id);
    expect(olives).toHaveLength(2);

    await refusedWith(
      billId,
      { ...tenOff, lineId: olives[0]!, lineIds: olives },
      "management.request_invalid",
      fieldLineIds,
    );
  });

  describe("A803 portions: a row's pizzas each holding olives and capers", () => {
    /** A row of two pizzas, each with its olive and, copied from it, a second extra named Capers;
     * answers each pizza's `[olives, capers]` ids. */
    async function twoExtras(billId: string): Promise<string[][]> {
      return inTx(venue, async (tx) => {
        const rows = await tx
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, billId))
          .orderBy(workingOrderLines.lineNo);
        let lineNo = Math.max(...rows.map((row) => row.lineNo));
        const olives = rows.filter((row) => row.parentLineId !== null);
        const pairs: string[][] = [];
        for (const olive of olives) {
          const capers = { ...olive, id: randomUUID(), lineNo: ++lineNo, name: "Capers" };
          await tx.insert(workingOrderLines).values(capers);
          pairs.push([olive.id, capers.id]);
        }
        return pairs;
      });
    }

    it("A803 portions: two extras of one pizza named together are refused management.request_invalid on lineIds", async () => {
      const { billId } = await portionsBill([{ name: "Pizza", quantity: "2", olives: 1 }]);
      const [[olives, capers]] = await twoExtras(billId);
      // The control: the capers of both pizzas are a row's extras.
      const control = await portionsBill([{ name: "Pizza", quantity: "2", olives: 1 }]);
      const [[, first], [, second]] = await twoExtras(control.billId);
      expect(
        await refusalOf(control.billId, { ...tenOff, lineId: first!, lineIds: [first!, second!] }),
      ).toBeNull();

      await refusedWith(
        billId,
        { ...tenOff, lineId: olives!, lineIds: [olives!, capers!] },
        "management.request_invalid",
        fieldLineIds,
      );
    });

    it("A803 portions: the olives of one pizza and the capers of the other are refused the same way", async () => {
      const { billId } = await portionsBill([{ name: "Pizza", quantity: "2", olives: 1 }]);
      const [[olives], [, capers]] = await twoExtras(billId);

      await refusedWith(
        billId,
        { ...tenOff, lineId: olives!, lineIds: [olives!, capers!] },
        "management.request_invalid",
        fieldLineIds,
      );
    });
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

/** What a request names: one line, or a till row's lines with the first among them. */
type Target = { lineId: string; lineIds?: string[] };

const rowOf = (ids: readonly string[]): Target =>
  ids.length === 1 ? { lineId: ids[0]! } : { lineId: ids[0]!, lineIds: [...ids] };

/** Crew meal (50% an item) at `percentBp`, by a manager, who is never asked, so a history never
 * stops; the ask a case judges is a member of staff's. */
const crew = (target: Target, quantity?: string, percentBp = 5000): Ask => ({
  ...target,
  action: "discount_percent",
  percentBp,
  reasonId: venue.reasonId.staffMeal,
  operatorId: venue.managerId,
  ...(quantity === undefined ? {} : { quantity }),
});

/** Whether staff asking `ask` would need approval, writing nothing. */
async function asked(billId: string, ask: Ask) {
  const preview = await inTx(venue, async (tx) =>
    previewAdjustment(
      tx,
      await argsFor(tx, billId, { ...ask, operatorId: venue.staffId }),
      venue.venueLocale,
    ),
  );
  return preview.needsApproval;
}

const ASKS = { by: "reason", roles: ["manager", "admin"] };

/** Marks `quantity` of the line served, as the till's serve does. */
function serve(billId: string, lineId: string, quantity = "1.000") {
  return inTx(venue, async (tx) => {
    const party = await partyRevisionOfOrder(tx, billId);
    return markServed(tx, venue.cfg, party!.id, [{ lineId, quantity }], {
      submissionId: randomUUID(),
      expectedPartyRevision: party!.revision,
      operatorId: venue.staffId,
    });
  });
}

const burgers = (quantity: string): RoundLine[] => [{ name: "Burger", quantity }, bread];

describe("A803 portions: the lines a comp or discount covered", () => {
  it("A803 portions: a whole row records its portions, a part the portions taken, a row's olives the olives named, and one portion itself", async () => {
    const { billId } = await portionsBill([
      { name: "Croquetas", quantity: "3" },
      { name: "Pizza", quantity: "2", olives: 1 },
      { name: "Burger", quantity: "2" },
    ]);
    const croquetas = await dishesNamed(billId, "Croquetas");
    const olives = (await rowsOf(venue, billId))
      .filter((row) => row.name === "Olives")
      .map((row) => row.id);
    const burger = await dishesNamed(billId, "Burger");
    await adjust(billId, { ...tenOff, ...rowOf(croquetas), quantity: "2" });
    await adjust(billId, { ...tenOff, ...rowOf(olives) });
    await adjust(billId, { ...tenOff, lineId: burger[0]! });
    await adjust(billId, { ...tenOff, ...rowOf([croquetas[0]!]) });

    const records = await recordedOn(billId);
    const rows = await inTx(venue, (tx) => tx.select().from(adjustmentLines));
    const covered = records.map((record) =>
      rows
        .filter((row) => row.adjustmentId === record.id)
        .map((row) => row.lineId)
        .sort(),
    );
    expect(covered).toEqual([
      [croquetas[1]!, croquetas[2]!].sort(),
      [...olives].sort(),
      [burger[0]!],
      [croquetas[0]!],
    ]);
  });

  it("A803 portions: a discount of the whole bill, and one on an unbound line, record what they took off each line", async () => {
    const portions = await portionsBill([{ name: "Croquetas", quantity: "3" }]);
    await adjust(portions.billId, tenOff);
    const grouped = await groupedBill([{ name: "Croquetas", quantity: "3" }]);
    const [line] = await dishesNamed(grouped.billId, "Croquetas");
    await adjust(grouped.billId, { ...tenOff, lineId: line!, quantity: "1" });

    expect(await takenOn(portions.billId)).toEqual([
      [
        "Croquetas 2.99 off 0.34 of 1.000",
        "Croquetas 3.00 off 0.33 of 1.000",
        "Croquetas 3.00 off 0.33 of 1.000",
      ],
    ]);
    expect(await takenOn(grouped.billId)).toEqual([["Croquetas 3.00 off 0.33 of 1.000"]]);
  });
});

/** What each of the bill's comps and discounts took off each line, as `name unit-price off amount
 * of quantity`, in record order; and, unless `copied` (a copy carries its original's rows), that
 * each record's rows, each prorated by the quantity its line holds now, add up to its reduction.
 * The sum cannot see a row's amount and quantity scaled alike; the strings do. */
async function takenOn(billId: string, copied = false): Promise<string[][]> {
  const ids = await describeIds(billId);
  const quantityNow = new Map(
    (await rowsOf(venue, billId)).map((row) => [row.id, Number(row.quantity) * 1000]),
  );
  const records = await recordedOn(billId);
  const rows = await inTx(venue, (tx) => tx.select().from(adjustmentLines));
  return records.map((record) => {
    const own = rows.filter((row) => row.adjustmentId === record.id);
    if (!copied)
      expect(
        own.reduce(
          (sum, row) => sum + (row.reduction * (quantityNow.get(row.lineId) ?? 0)) / row.quantity,
          0,
        ),
      ).toBeCloseTo(record.reduction, 6);
    return own
      .map(
        (row) =>
          `${ids.get(row.lineId) ?? row.lineId} off ${centsToDecimal(row.reduction)} of ${thousandthsToDecimal(row.quantity)}`,
      )
      .sort();
  });
}

describe("A803 portions: what each comp or discount took off each line (plan D37)", () => {
  it("A803 portions: 10% off a pizza with olives records what it took off the pizza and off the olives, with each line's quantity", async () => {
    const { billId } = await portionsBill([{ name: "Pizza", quantity: "1", olives: 2 }]);
    const [pizzaLine] = await dishesNamed(billId, "Pizza");
    await adjust(billId, { ...tenOff, lineId: pizzaLine! });

    expect(await takenOn(billId)).toEqual([
      ["Olives 1.35 off 0.30 of 2.000", "Pizza 8.10 off 0.90 of 1.000"],
    ]);
  });

  it("A803 portions: a whole-bill discount records its share on every line it changed", async () => {
    const { billId } = await portionsBill([{ name: "Burger", quantity: "2" }, bread]);
    await adjust(billId, tenOff);

    expect(await takenOn(billId)).toEqual([
      [
        "Bread 2.25 off 0.25 of 1.000",
        "Burger 10.80 off 1.20 of 1.000",
        "Burger 10.80 off 1.20 of 1.000",
      ],
    ]);
  });

  it("A803 portions: a whole-bill discount that leaves an unbound line beside bound portions at two prices records a row on each line it leaves", async () => {
    const billId = await inTx(venue, async (tx) => {
      const bill = await seated(tx);
      await addPortionRound(tx, venue.cfg, bill.billId, roundOf([{ name: "Burger" }]), {
        fire: true,
      });
      const round = await priceTabRound(
        tx,
        venue.cfg,
        bill.billId,
        roundOf([{ name: "Croquetas", quantity: "3" }]),
        "checked",
      );
      await insertTabRound(tx, venue.cfg, round, round.rows);
      await bumpRevision(tx, [bill.billId]);
      return bill.billId;
    });
    await adjust(billId, tenOff);

    expect(await dishesNamed(billId, "Croquetas")).toHaveLength(2);
    expect(await takenOn(billId)).toEqual([
      [
        "Burger 10.80 off 1.20 of 1.000",
        "Croquetas 2.99 off 0.34 of 1.000",
        "Croquetas 3.00 off 0.66 of 2.000",
      ],
    ]);
  });

  it("A803 portions: a discount on an unbound line of three records one row", async () => {
    const { billId } = await groupedBill([{ name: "Burger", quantity: "3" }]);
    const [line] = await dishesNamed(billId, "Burger");
    await adjust(billId, { ...tenOff, lineId: line! });

    expect(await takenOn(billId)).toEqual([["Burger 10.80 off 3.60 of 3.000"]]);
  });

  it("A803 portions: a discount that leaves an unbound line at two prices records a row on each line it leaves", async () => {
    const { billId } = await groupedBill([{ name: "Croquetas", quantity: "3" }]);
    const [line] = await dishesNamed(billId, "Croquetas");
    await adjust(billId, { ...tenOff, lineId: line! });

    expect(await dishesNamed(billId, "Croquetas")).toHaveLength(2);
    expect(await takenOn(billId)).toEqual([
      ["Croquetas 2.99 off 0.34 of 1.000", "Croquetas 3.00 off 0.66 of 2.000"],
    ]);
  });

  it("A803 portions: a part of an unbound line records its row on the part carved off", async () => {
    const { billId } = await groupedBill([{ name: "Burger", quantity: "3" }]);
    const [line] = await dishesNamed(billId, "Burger");
    await adjust(billId, { ...tenOff, lineId: line!, quantity: "1" });

    expect(await takenOn(billId)).toEqual([["Burger 10.80 off 1.20 of 1.000"]]);
  });

  it("A803 portions: €0.01 off 2 of a row of three breads records a row only on the bread it took the cent off", async () => {
    const { billId } = await portionsBill([{ name: "Bread", quantity: "3" }]);
    const breads = await dishesNamed(billId, "Bread");
    await adjust(billId, {
      action: "discount_amount",
      amount: "0.01",
      ...rowOf(breads),
      quantity: "2",
    });

    expect(await takenOn(billId)).toEqual([["Bread 2.49 off 0.01 of 1.000"]]);
  });

  it("A803 portions: a comp of a pizza records the pizza and its olives at their whole price", async () => {
    const { billId } = await groupedBill([{ name: "Pizza", quantity: "2", olives: 1 }]);
    const [pizzaLine] = await dishesNamed(billId, "Pizza");
    await adjust(billId, { action: "comp", lineId: pizzaLine! });

    expect(await takenOn(billId)).toEqual([
      ["Olives 0.00 off 3.00 of 2.000", "Pizza 0.00 off 18.00 of 2.000"],
    ]);
  });
});

describe("A803 portions: a row's approval verdicts are one line's", () => {
  it("A803 portions: a second 50% Crew meal on the same row asks, as a second one on one line does", async () => {
    const grouped = await groupedBill(burgers("3"));
    const portions = await portionsBill(burgers("3"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const row = await dishesNamed(portions.billId, "Burger");
    await adjust(grouped.billId, crew({ lineId: line! }));
    await adjust(portions.billId, crew(rowOf(row)));

    const today = await asked(grouped.billId, crew({ lineId: line! }));
    expect(today).toMatchObject(ASKS);
    expect(await asked(portions.billId, crew(rowOf(row)))).toEqual(today);
  });

  it("A803 portions: S2 — Crew meal 50% off one of two burgers, then 50% off the other, goes straight through", async () => {
    const grouped = await groupedBill(burgers("2"));
    const portions = await portionsBill(burgers("2"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const row = await dishesNamed(portions.billId, "Burger");
    await adjust(grouped.billId, crew({ lineId: line! }, "1"));
    await adjust(portions.billId, crew(rowOf(row), "1"));

    const today = await asked(grouped.billId, crew({ lineId: line! }));
    expect(today).toBeNull();
    // The part took the last portion; the first is left alone.
    expect(await asked(portions.billId, crew({ lineId: row[0]! }))).toEqual(today);
  });

  it("A803 portions: S1 — 50% off a row of three, the first served, then 50% off the remaining two asks", async () => {
    const grouped = await groupedBill(burgers("3"));
    const portions = await portionsBill(burgers("3"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const row = await dishesNamed(portions.billId, "Burger");
    await adjust(grouped.billId, crew({ lineId: line! }));
    await adjust(portions.billId, crew(rowOf(row)));
    await serve(grouped.billId, line!);
    await serve(portions.billId, row[0]!);

    const today = await asked(grouped.billId, crew({ lineId: line! }, "2"));
    expect(today).toMatchObject(ASKS);
    expect(await asked(portions.billId, crew(rowOf(row.slice(1))))).toEqual(today);
  });

  it("A803 portions: S3 — 50% off 2 of a row of three, one of those served, then 50% off the last asks, and the one not taken does not", async () => {
    const grouped = await groupedBill(burgers("3"));
    const portions = await portionsBill(burgers("3"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const row = await dishesNamed(portions.billId, "Burger");
    await adjust(grouped.billId, crew({ lineId: line! }, "2"));
    await adjust(portions.billId, crew(rowOf(row), "2"));
    const [kept, carved] = await dishesNamed(grouped.billId, "Burger");
    await serve(grouped.billId, carved!);
    await serve(portions.billId, row[1]!);

    const last = await asked(grouped.billId, crew({ lineId: carved! }, "1"));
    expect(last).toMatchObject(ASKS);
    expect(await asked(portions.billId, crew({ lineId: row[2]! }))).toEqual(last);
    const untaken = await asked(grouped.billId, crew({ lineId: kept! }));
    expect(untaken).toBeNull();
    expect(await asked(portions.billId, crew({ lineId: row[0]! }))).toEqual(untaken);
  });

  for (const [history, other] of [
    ["S6 — comped", { action: "comp", reasonId: "complaint" }],
    ["S6b — given 10%", { action: "discount_percent", percentBp: 1000, reasonId: "complaint" }],
  ] as const) {
    it(`A803 portions: ${history} by another reason after being served, the first of a 50%-off row leaves 50% off the remaining two asking`, async () => {
      const grouped = await groupedBill(burgers("3"));
      const portions = await portionsBill(burgers("3"));
      const [line] = await dishesNamed(grouped.billId, "Burger");
      const row = await dishesNamed(portions.billId, "Burger");
      await adjust(grouped.billId, crew({ lineId: line! }));
      await adjust(portions.billId, crew(rowOf(row)));
      await serve(grouped.billId, line!);
      await serve(portions.billId, row[0]!);
      const byOther = { ...other, reasonId: venue.reasonId[other.reasonId] };
      await adjust(grouped.billId, { ...byOther, lineId: line!, quantity: "1" });
      await adjust(portions.billId, { ...byOther, lineId: row[0]! });

      const [rest] = await dishesNamed(grouped.billId, "Burger");
      const today = await asked(grouped.billId, crew({ lineId: rest! }, "2"));
      expect(today).toMatchObject(ASKS);
      expect(await asked(portions.billId, crew(rowOf(row.slice(1))))).toEqual(today);
    });
  }

  it("A803 portions: S9 — 50% off a row of three, Split bill moves two to another bill, and 50% off those two there asks: each is already at its floor", async () => {
    const grouped = await groupedBill(burgers("3"));
    const portions = await portionsBill(burgers("3"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const row = await dishesNamed(portions.billId, "Burger");
    await adjust(grouped.billId, crew({ lineId: line! }));
    await adjust(portions.billId, crew(rowOf(row)));
    const groupedB = await inTx(venue, (tx) =>
      splitPartyBill(tx, venue.cfg, grouped.billId, [{ lineNo: 1, quantity: "2" }]),
    );
    const portionsB = await inTx(venue, (tx) =>
      splitPartyBill(tx, venue.cfg, portions.billId, [{ lineNo: 1 }, { lineNo: 2 }]),
    );

    const [moved] = await dishesNamed(groupedB.billId, "Burger");
    const today = await asked(groupedB.billId, crew({ lineId: moved! }));
    expect(today).toMatchObject(ASKS);
    const there = await dishesNamed(portionsB.billId, "Burger");
    expect(there).toEqual(row.slice(0, 2));
    expect(await asked(portionsB.billId, crew(rowOf(there)))).toEqual(today);
  });

  it("A803 portions: S5 — 50% off a row of three, Split bill moves the first two to a new bill, then 50% off the one left asks, and the staying bill files and prints as one line's", async () => {
    const grouped = await groupedBill(burgers("3"));
    const portions = await portionsBill(burgers("3"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const row = await dishesNamed(portions.billId, "Burger");
    await adjust(grouped.billId, crew({ lineId: line! }));
    await adjust(portions.billId, crew(rowOf(row)));
    await inTx(venue, (tx) =>
      splitPartyBill(tx, venue.cfg, grouped.billId, [{ lineNo: 1, quantity: "2" }]),
    );
    await inTx(venue, (tx) =>
      splitPartyBill(tx, venue.cfg, portions.billId, [{ lineNo: 1 }, { lineNo: 2 }]),
    );

    const [left] = await dishesNamed(grouped.billId, "Burger");
    expect(await dishesNamed(portions.billId, "Burger")).toEqual([row[2]]);
    const today = await asked(grouped.billId, crew({ lineId: left! }));
    expect(today).toMatchObject(ASKS);
    expect(await asked(portions.billId, crew({ lineId: row[2]! }))).toEqual(today);

    // The record names a line that left the bill on portions and one that stayed today.
    const filedAndPrinted = ({ record, ...rest }: Awaited<ReturnType<typeof outcomeOf>>) => {
      const { lineId, ...kept } = record;
      void lineId;
      return { ...rest, record: kept };
    };
    expect(filedAndPrinted(await outcomeOf(portions.billId))).toEqual(
      filedAndPrinted(await outcomeOf(grouped.billId)),
    );
  });

  it("A803 portions: a reason's 50% off a row and its discount of the whole bill, the first portion served, then each discount of the remaining two gets one line's verdict", async () => {
    const grouped = await groupedBill(burgers("3"));
    const portions = await portionsBill(burgers("3"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const row = await dishesNamed(portions.billId, "Burger");
    await adjust(grouped.billId, crew({ lineId: line! }, undefined, 2000));
    await adjust(portions.billId, crew(rowOf(row), undefined, 2000));
    const wholeBill: Ask = {
      action: "discount_percent",
      percentBp: 1000,
      reasonId: venue.reasonId.staffMeal,
      operatorId: venue.managerId,
    };
    await adjust(grouped.billId, wholeBill);
    await adjust(portions.billId, wholeBill);
    await serve(grouped.billId, line!);
    await serve(portions.billId, row[0]!);

    // Every quarter step from 5% to 40%, which crosses the dishes' floor.
    for (let percentBp = 500; percentBp <= 4000; percentBp += 250) {
      const today = await asked(grouped.billId, crew({ lineId: line! }, "2", percentBp));
      expect(await asked(portions.billId, crew(rowOf(row.slice(1)), undefined, percentBp))).toEqual(
        today,
      );
    }
  });

  it("A803 portions: another reason's 10% off the row counts toward Crew meal's floor: 50% more asks, as on one line", async () => {
    const grouped = await groupedBill(burgers("3"));
    const portions = await portionsBill(burgers("3"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const row = await dishesNamed(portions.billId, "Burger");
    const byOther: Ask = { ...tenOff, reasonId: venue.reasonId.complaint };
    await adjust(grouped.billId, { ...byOther, lineId: line! });
    await adjust(portions.billId, { ...byOther, ...rowOf(row) });

    const today = await asked(grouped.billId, crew({ lineId: line! }));
    expect(today).toMatchObject(ASKS);
    expect(await asked(portions.billId, crew(rowOf(row)))).toEqual(today);
  });

  it("A803 portions: a row priced at two prices by a reason, beside its discount of the whole bill, gets one line's verdicts", async () => {
    const lines = [{ name: "Croquetas", quantity: "3" }, bread];
    const grouped = await groupedBill(lines);
    const portions = await portionsBill(lines);
    const [line] = await dishesNamed(grouped.billId, "Croquetas");
    const row = await dishesNamed(portions.billId, "Croquetas");
    await adjust(grouped.billId, crew({ lineId: line! }, undefined, 1000));
    await adjust(portions.billId, crew(rowOf(row), undefined, 1000));
    const wholeBill: Ask = {
      action: "discount_percent",
      percentBp: 1000,
      reasonId: venue.reasonId.staffMeal,
      operatorId: venue.managerId,
    };
    await adjust(grouped.billId, wholeBill);
    await adjust(portions.billId, wholeBill);
    // The first two still share a price, so the till draws them as one row.
    const [one, two] = await pricesOf(portions.billId);
    expect(one).toEqual(two);

    const verdicts = async (billId: string, target: Target) => {
      const out = [];
      for (let percentBp = 500; percentBp <= 4000; percentBp += 250) {
        out.push([percentBp, await asked(billId, crew(target, undefined, percentBp))]);
      }
      return out;
    };
    const [first] = await dishesNamed(grouped.billId, "Croquetas");
    const today = await verdicts(grouped.billId, { lineId: first! });
    expect(today.some(([, verdict]) => verdict === null)).toBe(true);
    expect(today.some(([, verdict]) => verdict !== null)).toBe(true);
    expect(await verdicts(portions.billId, rowOf(row.slice(0, 2)))).toEqual(today);
  });

  describe("A803 portions: an unbound line of three gets the floor's verdicts and records what each discount took", () => {
    // 25% steps, then 20%: a burger 25% off stays above its floor after 20% more, one 25% off twice
    // does not.
    const quarter = (target: Target, quantity?: string) => crew(target, quantity, 2500);
    const fifth = (lineId: string) => crew({ lineId }, undefined, 2000);

    it("A803 portions: H1 and H1b — 25% off the whole line, then 1 of it: 20% on the rest goes through, on the part asks", async () => {
      const { billId } = await groupedBill(burgers("3"));
      const [line] = await dishesNamed(billId, "Burger");
      await adjust(billId, quarter({ lineId: line! }));
      await adjust(billId, quarter({ lineId: line! }, "1"));
      const [rest, part] = await dishesNamed(billId, "Burger");

      expect(await asked(billId, fifth(rest!))).toBeNull();
      expect(await asked(billId, fifth(part!))).toMatchObject(ASKS);
      expect(await takenOn(billId)).toEqual([
        ["Burger 6.75 off 9.00 of 3.000", "Burger 9.00 off 9.00 of 3.000"],
        ["Burger 6.75 off 2.25 of 1.000"],
      ]);
    });

    it("A803 portions: H1c — 25% off 2 of 3, then 1 of that part: 20% on the last part asks", async () => {
      const { billId } = await groupedBill(burgers("3"));
      const [line] = await dishesNamed(billId, "Burger");
      await adjust(billId, quarter({ lineId: line! }, "2"));
      const [, part] = await dishesNamed(billId, "Burger");
      await adjust(billId, quarter({ lineId: part! }, "1"));
      const [, , last] = await dishesNamed(billId, "Burger");

      expect(await asked(billId, fifth(last!))).toMatchObject(ASKS);
      expect(await takenOn(billId)).toEqual([
        ["Burger 6.75 off 6.00 of 2.000", "Burger 9.00 off 6.00 of 2.000"],
        ["Burger 6.75 off 2.25 of 1.000"],
      ]);
    });
  });

  it("A803 portions: a row of unserved portions beside a served one records stage fired, where today's partly served line records served, and a comp on it gets one line's verdict", async () => {
    const grouped = await groupedBill(burgers("3"));
    const portions = await portionsBill(burgers("3"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const row = await dishesNamed(portions.billId, "Burger");
    await serve(grouped.billId, line!);
    await serve(portions.billId, row[0]!);
    const comp: Ask = { action: "comp", reasonId: venue.reasonId.complaint };

    const today = await asked(grouped.billId, { ...comp, lineId: line!, quantity: "2" });
    expect(await asked(portions.billId, { ...comp, ...rowOf(row.slice(1)) })).toEqual(today);
    await adjust(grouped.billId, { ...comp, lineId: line!, quantity: "2" });
    await adjust(portions.billId, { ...comp, ...rowOf(row.slice(1)) });

    expect((await recordedOn(grouped.billId)).map((record) => record.stage)).toEqual(["served"]);
    expect((await recordedOn(portions.billId)).map((record) => record.stage)).toEqual(["fired"]);
  });
});

describe("A803 portions: a row of two sends", () => {
  it("A803 portions: 10% off a row of four croquetas from two sends takes what one line of four does, each send filed as its own rows", async () => {
    const twoSends = await inTx(venue, async (tx) => {
      const bill = await seated(tx);
      for (let send = 0; send < 2; send++) {
        await addPortionRound(
          tx,
          venue.cfg,
          bill.billId,
          roundOf([{ name: "Croquetas", quantity: "2" }]),
          {
            fire: true,
          },
        );
      }
      return bill;
    });
    const row = await dishesNamed(twoSends.billId, "Croquetas");
    expect(row).toHaveLength(4);
    const today = await groupedBill([{ name: "Croquetas", quantity: "4" }]);
    const [line] = await dishesNamed(today.billId, "Croquetas");
    await adjust(today.billId, { ...tenOff, lineId: line! });
    await adjust(twoSends.billId, { ...tenOff, ...rowOf(row) });

    const one = await outcomeOf(today.billId);
    const sends = await outcomeOf(twoSends.billId);
    expect(sends.record).toEqual(one.record);
    expect(sends.total).toBe(one.total);
    // €13.32 less €1.33: three at €3.00 and one at €2.99. One line files two rows; each send's
    // portions are filed apart, the €2.99 one with its send's €3.00 one apart from it.
    expect(one.total).toBe(1199);
    const shape = (filed: string[]) =>
      filed
        .map((row) => {
          const { quantity, gross } = JSON.parse(row) as Record<string, number>;
          return [quantity, gross];
        })
        .sort((x, y) => x[0]! - y[0]! || x[1]! - y[1]!);
    expect(shape(one.filed)).toEqual([
      [1000, 299],
      [3000, 900],
    ]);
    expect(shape(sends.filed)).toEqual([
      [1000, 299],
      [1000, 300],
      [2000, 600],
    ]);
  });
});

describe("A803 portions: approval differences no single line can show", () => {
  it("A803 portions: a reason's 20% off the two unserved burgers of three, then its 10% off the whole bill: 30% more on the two goes through and 32.5% asks, on one line and on portions", async () => {
    const grouped = await groupedBill(burgers("3"));
    const portions = await portionsBill(burgers("3"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const row = await dishesNamed(portions.billId, "Burger");
    await serve(grouped.billId, line!);
    await serve(portions.billId, row[0]!);
    // Today the 20% is part of a line of three; on portions it covers the whole two-burger row.
    await adjust(grouped.billId, crew({ lineId: line! }, "2", 2000));
    await adjust(portions.billId, crew(rowOf(row.slice(1)), undefined, 2000));
    const wholeBill: Ask = {
      action: "discount_percent",
      percentBp: 1000,
      reasonId: venue.reasonId.staffMeal,
      operatorId: venue.managerId,
    };
    await adjust(grouped.billId, wholeBill);
    await adjust(portions.billId, wholeBill);

    const [, carved] = await dishesNamed(grouped.billId, "Burger");
    for (const [percentBp, verdict] of [
      [3000, null],
      [3250, ASKS],
    ] as const) {
      const today = await asked(grouped.billId, crew({ lineId: carved! }, undefined, percentBp));
      expect(today).toEqual(verdict === null ? null : expect.objectContaining(verdict));
      expect(await asked(portions.billId, crew(rowOf(row.slice(1)), undefined, percentBp))).toEqual(
        today,
      );
    }
  });

  it("A803 portions: S7 — two parts carved off one row by different reasons at one price show as one row, and Crew meal's 10% more asks on the row and on the portion the other reason took to its floor", async () => {
    const { billId } = await portionsBill(burgers("3"));
    const row = await dishesNamed(billId, "Burger");
    await adjust(billId, crew(rowOf(row), "1"));
    await adjust(billId, {
      ...crew(rowOf(row.slice(0, 2)), "1"),
      reasonId: venue.reasonId.complaint,
    });
    expect((await pricesOf(billId)).map(([, unit]) => unit)).toEqual([
      "12.00",
      "6.00",
      "6.00",
      "2.50",
    ]);

    expect(await asked(billId, crew(rowOf(row.slice(1)), undefined, 1000))).toMatchObject(ASKS);
    expect(await asked(billId, crew({ lineId: row[1]! }, undefined, 1000))).toMatchObject(ASKS);
  });
  it("A803 portions: S5 with a bill discount — a reason's 20% off a row of three and its 10% off the whole bill, Split bill moving the first two away: 30% more on the one left goes through and 32.5% asks, on one line and on portions", async () => {
    const grouped = await groupedBill(burgers("3"));
    const portions = await portionsBill(burgers("3"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const row = await dishesNamed(portions.billId, "Burger");
    await adjust(grouped.billId, crew({ lineId: line! }, undefined, 2000));
    await adjust(portions.billId, crew(rowOf(row), undefined, 2000));
    const wholeBill: Ask = {
      action: "discount_percent",
      percentBp: 1000,
      reasonId: venue.reasonId.staffMeal,
      operatorId: venue.managerId,
    };
    await adjust(grouped.billId, wholeBill);
    await adjust(portions.billId, wholeBill);
    await inTx(venue, (tx) =>
      splitPartyBill(tx, venue.cfg, grouped.billId, [{ lineNo: 1, quantity: "2" }]),
    );
    await inTx(venue, (tx) =>
      splitPartyBill(tx, venue.cfg, portions.billId, [{ lineNo: 1 }, { lineNo: 2 }]),
    );

    const [left] = await dishesNamed(grouped.billId, "Burger");
    for (const [percentBp, verdict] of [
      [3000, null],
      [3250, ASKS],
    ] as const) {
      const today = await asked(grouped.billId, crew({ lineId: left! }, undefined, percentBp));
      expect(today).toEqual(verdict === null ? null : expect.objectContaining(verdict));
      expect(await asked(portions.billId, crew({ lineId: row[2]! }, undefined, percentBp))).toEqual(
        today,
      );
    }
  });

  /** A bill whose lines wait in one held group of its party: as portions, or today's grouped lines. */
  function heldBill(lines: RoundLine[], bound: boolean): Promise<Bill> {
    return inTx(venue, async (tx) => {
      const bill = await seated(tx);
      if (bound) await addPortionRound(tx, venue.cfg, bill.billId, roundOf(lines));
      else {
        const round = await priceTabRound(tx, venue.cfg, bill.billId, roundOf(lines), "checked");
        await insertTabRound(tx, venue.cfg, round, round.rows);
      }
      const groupId = await startGroup(tx, bill.partyId, "hold", venue.staffId);
      await tx
        .update(workingOrderLines)
        .set({ groupId })
        .where(eq(workingOrderLines.workingOrderId, bill.billId));
      await bumpRevision(tx, [bill.billId]);
      return bill;
    });
  }

  function toNewGroup(bill: Bill, lineId: string, quantity: string) {
    return inTx(venue, async (tx) =>
      moveLinesToGroup(tx, venue.cfg, bill.partyId, [{ lineId, quantity }], "new", {
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(tx, bill.partyId),
        operatorId: venue.managerId,
        expectedEdits: [await readBillEditState(tx, bill.billId)],
      }),
    );
  }

  it("A803 portions: S10 — a portion of a held row 50% off, moved to another group, asks for 50% more, as today's split-off unit does", async () => {
    const grouped = await heldBill(burgers("3"), false);
    const portions = await heldBill(burgers("3"), true);
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const row = await dishesNamed(portions.billId, "Burger");
    await adjust(grouped.billId, crew({ lineId: line! }));
    await adjust(portions.billId, crew(rowOf(row)));
    await toNewGroup(grouped, line!, "1.000");
    await toNewGroup(portions, row[2]!, "1.000");

    const [, unit] = await dishesNamed(grouped.billId, "Burger");
    expect(unit).toBeDefined();
    const today = await asked(grouped.billId, crew({ lineId: unit! }));
    expect(today).toMatchObject(ASKS);
    expect(await asked(portions.billId, crew({ lineId: row[2]! }))).toEqual(today);
  });

  it("A803 portions: S11 — a portion of a row 50% off, moved to another bill and back, asks for 50% more, as today's part moved back does", async () => {
    const grouped = await groupedBill(burgers("3"));
    const portions = await portionsBill(burgers("3"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const row = await dishesNamed(portions.billId, "Burger");
    await adjust(grouped.billId, crew({ lineId: line! }));
    await adjust(portions.billId, crew(rowOf(row)));
    for (const [bill, transfers] of [
      [grouped, [{ lineNo: 1, quantity: "1" }]],
      [portions, [{ lineNo: 3 }]],
    ] as const) {
      const other = await inTx(venue, (tx) =>
        splitPartyBill(tx, venue.cfg, bill.billId, [...transfers]),
      );
      await inTx(venue, async (tx) => {
        const expectedEdits = [];
        for (const id of [bill.billId, other.billId].sort())
          expectedEdits.push(await readBillEditState(tx, id));
        await mergeCheckedBills(tx, venue.cfg, bill.partyId, bill.billId, other.billId, {
          operatorId: venue.managerId,
          expectedEdits,
        });
      });
    }

    const back = (await dishesNamed(grouped.billId, "Burger")).find((id) => id !== line);
    expect(back).toBeDefined();
    const today = await asked(grouped.billId, crew({ lineId: back! }));
    expect(today).toMatchObject(ASKS);
    expect(await dishesNamed(portions.billId, "Burger")).toEqual(row);
    expect(await asked(portions.billId, crew({ lineId: row[2]! }))).toEqual(today);
  });
});

describe("A803 portions: a copy of a portion keeps the lines its discounts covered", () => {
  /** Recall `lineId` into the manager's draft, save it raised to `quantity`, and send it again. */
  async function raiseRecalled(bill: Bill, lineId: string, quantity: string) {
    const expected = async () => ({
      expectedPartyRevision: await inTx(venue, (tx) => partyRevision(tx, bill.partyId)),
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, bill.billId)),
    });
    const ok = (answer: { status: number; json: unknown }) => {
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
      return answer.json as Record<string, unknown>;
    };
    const party = `/api/parties/${bill.partyId}`;
    const recalled = ok(
      await send(venue.app, venue.cookie.manager, "POST", `${party}/lines/${lineId}/recall`, {
        submissionId: randomUUID(),
        ...(await expected()),
      }),
    ).draft as Draft;
    const saved = (
      ok(
        await send(venue.app, venue.cookie.manager, "PUT", `${party}/drafts`, {
          billId: bill.billId,
          draftId: recalled.id,
          revision: recalled.revision,
          expectedEdit: (await expected()).expectedEdit,
          lines: [{ ...recalled.lines[0]!, quantity }],
          personId: venue.managerId,
        }),
      ) as unknown as BillDraftSnapshot
    ).draft!;
    ok(
      await send(venue.app, venue.cookie.manager, "POST", `${party}/drafts/${saved.id}/submit`, {
        submissionId: randomUUID(),
        ...(await expected()),
        draftRevision: saved.revision,
        groups: [{ release: "fire", lineIds: saved.lines.map((line) => line.id) }],
      }),
    );
  }

  it("A803 portions: H2 — 50% off one burger, recalled and raised to two, the first served: 50% off the copy asks, as today's widened line does", async () => {
    const grouped = await groupedBill(burgers("1"));
    const portions = await portionsBill(burgers("1"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const [burger] = await dishesNamed(portions.billId, "Burger");
    await adjust(grouped.billId, crew({ lineId: line! }));
    await adjust(portions.billId, crew({ lineId: burger! }));
    await raiseRecalled(grouped, line!, "2.000");
    await raiseRecalled(portions, burger!, "2.000");
    await serve(grouped.billId, line!);
    await serve(portions.billId, burger!);

    const [, copy] = await dishesNamed(portions.billId, "Burger");
    expect(copy).toBeDefined();
    const today = await asked(grouped.billId, crew({ lineId: line! }, "1"));
    expect(today).toMatchObject(ASKS);
    expect(await asked(portions.billId, crew({ lineId: copy! }))).toEqual(today);
  });

  it("A803 portions: B8 — a burger 50% off under Guest complaint, recalled and raised to two at its discounted price, has €12.00 off toward the €30", async () => {
    for (const shape of ["grouped", "portions"] as const) {
      const lines = [
        { name: "Burger", quantity: "1" },
        { name: "Steak", quantity: "1" },
      ];
      const bill = await (shape === "grouped" ? groupedBill(lines) : portionsBill(lines));
      const [burger] = await dishesNamed(bill.billId, "Burger");
      await adjust(
        bill.billId,
        complaint({ lineId: burger! }, { action: "discount_percent", percentBp: 5000 }),
      );

      await raiseRecalled(bill, burger!, "2.000");

      expect(await steakOff(bill.billId, "18.00"), shape).toBe("through");
      expect(await steakOff(bill.billId, "18.01"), shape).toEqual(ASKS);
    }
  });
  /** A bill holding `lines`, not sent: as portions, or (`bound: false`) as today's grouped lines. */
  function unsentBill(lines: RoundLine[], bound: boolean): Promise<Bill> {
    return inTx(venue, async (tx) => {
      const bill = await seated(tx);
      if (bound) await addPortionRound(tx, venue.cfg, bill.billId, roundOf(lines));
      else {
        const round = await priceTabRound(tx, venue.cfg, bill.billId, roundOf(lines), "checked");
        await insertTabRound(tx, venue.cfg, round, round.rows);
      }
      await bumpRevision(tx, [bill.billId]);
      return bill;
    });
  }

  /** Raise the bill's line `lineNo` to `quantity` through an order edit. */
  function raise(billId: string, lineNo: number, quantity: string) {
    return inTx(venue, async (tx) =>
      updateOrderLine(
        tx,
        venue.cfg,
        billId,
        lineNo,
        { quantity },
        await readOrderRevision(tx, billId),
        { operatorId: venue.managerId, expectedEdit: await readBillEditState(tx, billId) },
      ),
    );
  }

  const olivesOf = async (billId: string) =>
    (await rowsOf(venue, billId)).filter((row) => row.name === "Olives").map((row) => row.id);

  const pizza: RoundLine[] = [{ name: "Pizza", quantity: "1", olives: 1 }, bread];

  it("A803 portions: a copy carries every discount that covered its original: a house 10% then 50% Crew meal on one burger, recalled and raised to two, the first served: Crew meal again on the copy asks, as on today's widened line", async () => {
    const grouped = await groupedBill(burgers("1"));
    const portions = await portionsBill(burgers("1"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const [burger] = await dishesNamed(portions.billId, "Burger");
    await adjust(grouped.billId, { ...tenOff, lineId: line! });
    await adjust(portions.billId, { ...tenOff, lineId: burger! });
    await adjust(grouped.billId, crew({ lineId: line! }));
    await adjust(portions.billId, crew({ lineId: burger! }));
    await raiseRecalled(grouped, line!, "2.000");
    await raiseRecalled(portions, burger!, "2.000");
    await serve(grouped.billId, line!);
    await serve(portions.billId, burger!);

    const [, copy] = await dishesNamed(portions.billId, "Burger");
    const today = await asked(grouped.billId, crew({ lineId: line! }, "1"));
    expect(today).toMatchObject(ASKS);
    expect(await asked(portions.billId, crew({ lineId: copy! }))).toEqual(today);
    expect(await takenOn(portions.billId, true)).toEqual([
      ["Burger 5.40 off 1.20 of 1.000", "Burger 5.40 off 1.20 of 1.000"],
      ["Burger 5.40 off 5.40 of 1.000", "Burger 5.40 off 5.40 of 1.000"],
    ]);
  });

  /** Crew meal's 20% off one burger and its 10% off the whole bill, the bill discount taken before
   * or after the burger is recalled and raised to two; then the first is served. Answers whether
   * `percentBp` more on the copy asks, today and on portions. */
  async function copyBesideBillDiscount(billDiscount: "before" | "after", percentBp: number) {
    const wholeBill: Ask = {
      action: "discount_percent",
      percentBp: 1000,
      reasonId: venue.reasonId.staffMeal,
      operatorId: venue.managerId,
    };
    const grouped = await groupedBill(burgers("1"));
    const portions = await portionsBill(burgers("1"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const [burger] = await dishesNamed(portions.billId, "Burger");
    await adjust(grouped.billId, crew({ lineId: line! }, undefined, 2000));
    await adjust(portions.billId, crew({ lineId: burger! }, undefined, 2000));
    if (billDiscount === "before") {
      await adjust(grouped.billId, wholeBill);
      await adjust(portions.billId, wholeBill);
    }
    await raiseRecalled(grouped, line!, "2.000");
    await raiseRecalled(portions, burger!, "2.000");
    if (billDiscount === "after") {
      await adjust(grouped.billId, wholeBill);
      await adjust(portions.billId, wholeBill);
    }
    await serve(grouped.billId, line!);
    await serve(portions.billId, burger!);
    const [, copy] = await dishesNamed(portions.billId, "Burger");
    return {
      today: await asked(grouped.billId, crew({ lineId: line! }, "1", percentBp)),
      portions: await asked(portions.billId, crew({ lineId: copy! }, undefined, percentBp)),
    };
  }

  for (const when of ["before", "after"] as const) {
    it(`A803 portions: H2 with the reason's bill discount taken ${when} the raise: 30% more on the copy goes through and 32.5% asks, on today's widened line and on portions`, async () => {
      const thirty = await copyBesideBillDiscount(when, 3000);
      expect(thirty).toEqual({ today: null, portions: null });
      const more = await copyBesideBillDiscount(when, 3250);
      expect(more.today).toMatchObject(ASKS);
      expect(more.portions).toEqual(more.today);
    });
  }

  it("A803 portions: 50% off a pizza's olive, the pizza recalled and raised to two: 50% off the copy's olive goes through, as on today's widened olives line, the pizza staying above its floor", async () => {
    const grouped = await groupedBill(pizza);
    const portions = await portionsBill(pizza);
    const [olive] = await olivesOf(grouped.billId);
    const [portionOlive] = await olivesOf(portions.billId);
    await adjust(grouped.billId, crew({ lineId: olive! }));
    await adjust(portions.billId, crew({ lineId: portionOlive! }));
    await raiseRecalled(grouped, (await dishesNamed(grouped.billId, "Pizza"))[0]!, "2.000");
    await raiseRecalled(portions, (await dishesNamed(portions.billId, "Pizza"))[0]!, "2.000");

    const copyOlive = (await olivesOf(portions.billId)).find((id) => id !== portionOlive);
    expect(copyOlive).toBeDefined();
    // Today an olives line is discounted only whole.
    const today = await asked(grouped.billId, crew({ lineId: olive! }));
    expect(today).toBeNull();
    expect(await asked(portions.billId, crew({ lineId: copyOlive! }))).toEqual(today);
    expect(await takenOn(portions.billId, true)).toEqual([
      ["Olives 0.75 off 0.75 of 1.000", "Olives 0.75 off 0.75 of 1.000"],
    ]);
  });

  it("A803 portions: 50% off an unsent pizza's olive, the pizza raised to two by an edit: 50% off the copy's olive goes through, as on today's widened olives line, the pizza staying above its floor", async () => {
    const grouped = await unsentBill(pizza, false);
    const portions = await unsentBill(pizza, true);
    const [olive] = await olivesOf(grouped.billId);
    const [portionOlive] = await olivesOf(portions.billId);
    await adjust(grouped.billId, crew({ lineId: olive! }));
    await adjust(portions.billId, crew({ lineId: portionOlive! }));
    await raise(grouped.billId, 1, "2");
    await raise(portions.billId, 1, "2");

    expect(await dishesNamed(portions.billId, "Pizza")).toHaveLength(2);
    const copyOlive = (await olivesOf(portions.billId)).find((id) => id !== portionOlive);
    expect(copyOlive).toBeDefined();
    // Today an olives line is discounted only whole.
    const today = await asked(grouped.billId, crew({ lineId: olive! }));
    expect(today).toBeNull();
    expect(await asked(portions.billId, crew({ lineId: copyOlive! }))).toEqual(today);
    expect(await takenOn(portions.billId, true)).toEqual([
      ["Olives 0.75 off 0.75 of 1.000", "Olives 0.75 off 0.75 of 1.000"],
    ]);
  });

  it("A803 portions: 50% off an unsent burger, raised to two by an edit, adds a burger at a fresh price that takes 50% off without asking, as today's separately priced line does", async () => {
    const grouped = await unsentBill(burgers("1"), false);
    const portions = await unsentBill(burgers("1"), true);
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const [burger] = await dishesNamed(portions.billId, "Burger");
    await adjust(grouped.billId, crew({ lineId: line! }));
    await adjust(portions.billId, crew({ lineId: burger! }));
    await raise(grouped.billId, 1, "2");
    await raise(portions.billId, 1, "2");

    const [, added] = await dishesNamed(grouped.billId, "Burger");
    const [, portionAdded] = await dishesNamed(portions.billId, "Burger");
    expect((await pricesOf(portions.billId)).map(([, unit]) => unit)).toEqual(
      (await pricesOf(grouped.billId)).map(([, unit]) => unit),
    );
    const today = await asked(grouped.billId, crew({ lineId: added! }));
    expect(today).toBeNull();
    expect(await asked(portions.billId, crew({ lineId: portionAdded! }))).toEqual(today);
    expect(await takenOn(portions.billId)).toEqual([["Burger 6.00 off 6.00 of 1.000"]]);
  });

  it("A803 portions: an undiscounted unsent burger raised to two by an edit copies no covered lines", async () => {
    const portions = await unsentBill(burgers("1"), true);
    await raise(portions.billId, 1, "2");

    expect(await dishesNamed(portions.billId, "Burger")).toHaveLength(2);
    expect(await inTx(venue, (tx) => tx.select().from(adjustmentLines))).not.toContainEqual(
      expect.objectContaining({
        lineId: expect.toBeOneOf(await dishesNamed(portions.billId, "Burger")),
      }),
    );
  });
});

/** Guest complaint (€30.00 a bill, managers and admins approve) on `target`, by the supervisor,
 * who may apply it. */
const complaint = (target: Target, rest: Partial<Ask> = {}): Ask => ({
  ...target,
  action: "comp",
  reasonId: venue.reasonId.complaint,
  ...rest,
});

/** `amount` off the bill's steak under Guest complaint: whether the supervisor is asked. */
async function steakOff(billId: string, amount: string) {
  const [steak] = await dishesNamed(billId, "Steak");
  const preview = await inTx(venue, async (tx) =>
    previewAdjustment(
      tx,
      await argsFor(
        tx,
        billId,
        complaint({ lineId: steak! }, { action: "discount_amount", amount }),
      ),
      venue.venueLocale,
    ),
  );
  return preview.needsApproval ?? "through";
}

describe("A803 portions: a reason's euro limit counts what is still off the bill (owner, 2026-10-28; plan D37 rules 3 and 5)", () => {
  const steak: RoundLine = { name: "Steak", quantity: "1" };

  it("A803 portions: on a row of two €12.00 burgers, 50% off the row, then one cancelled: the reason has €6.00 off, not €12.00", async () => {
    for (const shape of ["grouped", "portions"] as const) {
      const lines = [{ name: "Burger", quantity: "2" }, steak];
      const { billId } = await (shape === "grouped" ? groupedBill(lines) : portionsBill(lines));
      const burgers = await dishesNamed(billId, "Burger");
      await adjust(
        billId,
        complaint(rowOf(burgers), { action: "discount_percent", percentBp: 5000 }),
      );
      expect(await steakOff(billId, "18.01"), shape).toEqual(ASKS);

      await adjust(
        billId,
        shape === "grouped"
          ? { lineId: burgers[0]!, action: "cancel", quantity: "1" }
          : { lineId: burgers[1]!, action: "cancel" },
      );

      expect(await steakOff(billId, "24.00"), shape).toBe("through");
      expect(await steakOff(billId, "24.01"), shape).toEqual(ASKS);
    }
  });
});

describe("A803 portions: the per-dish floor (plan D36)", () => {
  /** `amount` off under Crew meal (50% an item) unless `reasonId` says otherwise, by a manager. */
  const off = (target: Target, amount: string, reasonId = venue.reasonId.staffMeal): Ask => ({
    ...target,
    action: "discount_amount",
    amount,
    reasonId,
    operatorId: venue.managerId,
  });
  const wholeBill = (percentBp: number, reasonId: string): Ask => ({
    action: "discount_percent",
    percentBp,
    reasonId,
    operatorId: venue.managerId,
  });
  const oliveOf = async (billId: string): Promise<Target> => ({
    lineId: (await rowsOf(venue, billId)).find((row) => row.name === "Olives")!.id,
  });

  type Step = (billId: string, dish: Target) => Promise<Ask>;

  /**
   * Builds `lines` as today's one line of each and as portions, runs each of `before` on both (by a
   * manager, who is never asked), and answers whether staff asking `ask` would need approval: one
   * verdict, the same on both shapes (plan D36 reading 1). `free` names lines whose price is set to
   * €0.00 first.
   */
  async function oneVerdict(
    lines: RoundLine[],
    dish: string,
    ask: Step,
    before: Step[] = [],
    free?: string,
  ) {
    const verdicts = [];
    for (const bound of [false, true]) {
      const { billId } = bound ? await portionsBill(lines) : await groupedBill(lines);
      if (free !== undefined) {
        await inTx(venue, (tx) =>
          tx
            .update(workingOrderLines)
            .set({ unitPriceGross: 0, lineTotal: 0 })
            .where(
              and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.name, free)),
            ),
        );
      }
      const ids = await dishesNamed(billId, dish);
      const target = bound ? rowOf(ids) : { lineId: ids[0]! };
      for (const step of before) await adjust(billId, await step(billId, target));
      verdicts.push(await asked(billId, await ask(billId, target)));
    }
    expect(verdicts[1]).toEqual(verdicts[0]);
    return verdicts[0];
  }

  const reasonAllowing = (maxPercentBp: number) =>
    inTx(
      venue,
      async (tx) =>
        (
          await createAdjustmentReason(tx, {
            ...REASONS.staffMeal,
            name: `Up to ${maxPercentBp}`,
            names: {},
            maxPercentBp,
          })
        ).id,
    );

  it("A803 portions: Crew meal's €6.00 off one €12.00 burger goes through and €6.01 asks", async () => {
    const burger = burgers("1");
    expect(await oneVerdict(burger, "Burger", async (_, dish) => off(dish, "6.00"))).toBeNull();
    expect(await oneVerdict(burger, "Burger", async (_, dish) => off(dish, "6.01"))).toMatchObject(
      ASKS,
    );
  });

  it("A803 portions: another reason's discount counts: Complaint's 10% off a row of three, then Crew meal 42.5% goes through and 45% asks", async () => {
    const complaint = async (_: string, dish: Target): Promise<Ask> => ({
      ...tenOff,
      ...dish,
      reasonId: venue.reasonId.complaint,
      operatorId: venue.managerId,
    });
    const crewAt = (percentBp: number) => async (_: string, dish: Target) =>
      crew(dish, undefined, percentBp);
    expect(await oneVerdict(burgers("3"), "Burger", crewAt(4250), [complaint])).toBeNull();
    expect(await oneVerdict(burgers("3"), "Burger", crewAt(4500), [complaint])).toMatchObject(ASKS);
  });

  it("A803 portions: a whole-bill discount counts whoever gave it: Complaint's 10% off the whole bill, then Crew meal 42.5% off the burger goes through and 45% asks", async () => {
    const complaint = async () => wholeBill(1000, venue.reasonId.complaint);
    const crewAt = (percentBp: number) => async (_: string, dish: Target) =>
      crew(dish, undefined, percentBp);
    expect(await oneVerdict(burgers("1"), "Burger", crewAt(4250), [complaint])).toBeNull();
    expect(await oneVerdict(burgers("1"), "Burger", crewAt(4500), [complaint])).toMatchObject(ASKS);
  });

  it("A803 portions: a pizza with its olives is one dish: Crew meal 30% off a €9.00 pizza with €1.50 olives, then 30% off its olives alone, goes through; 50% off the pizza, then 10% off its olives alone, asks; 90% off the olives alone goes through", async () => {
    const pizza: RoundLine[] = [{ name: "Pizza", quantity: "1", olives: 1 }, bread];
    const onPizza = (percentBp: number) => async (_: string, dish: Target) =>
      crew(dish, undefined, percentBp);
    const onOlives = (percentBp: number) => async (billId: string) =>
      crew(await oliveOf(billId), undefined, percentBp);
    expect(await oneVerdict(pizza, "Pizza", onOlives(3000), [onPizza(3000)])).toBeNull();
    expect(await oneVerdict(pizza, "Pizza", onOlives(1000), [onPizza(5000)])).toMatchObject(ASKS);
    expect(await oneVerdict(pizza, "Pizza", onOlives(9000))).toBeNull();
  });

  it("A803 portions: exactly 50% never asks on rounding: 50% off one €3.33 croqueta (€1.66 left) and 50% off a row of three (€4.99 left) go through, as €1.67 off one does; €1.68 off one asks", async () => {
    const croquetas = (quantity: string): RoundLine[] => [{ name: "Croquetas", quantity }, bread];
    const half = async (_: string, dish: Target) => crew(dish);
    expect(await oneVerdict(croquetas("1"), "Croquetas", half)).toBeNull();
    expect(await oneVerdict(croquetas("3"), "Croquetas", half)).toBeNull();
    const amount = (value: string) => async (_: string, dish: Target) => off(dish, value);
    expect(await oneVerdict(croquetas("1"), "Croquetas", amount("1.67"))).toBeNull();
    expect(await oneVerdict(croquetas("1"), "Croquetas", amount("1.68"))).toMatchObject(ASKS);
  });

  it("A803 portions: each portion of a row is checked: €5.01 off three €3.33 croquetas leaves each at €1.66 and goes through; €5.02 leaves one at €1.65 and asks", async () => {
    const three: RoundLine[] = [{ name: "Croquetas", quantity: "3" }, bread];
    const amount = (value: string) => async (_: string, dish: Target) => off(dish, value);
    expect(await oneVerdict(three, "Croquetas", amount("5.01"))).toBeNull();
    expect(await oneVerdict(three, "Croquetas", amount("5.02"))).toMatchObject(ASKS);
  });

  it("A803 portions: 50% off 3 kg of €12.99 Fish under Crew meal goes through (it takes €19.50 against an exact €19.485); €19.53 off asks", async () => {
    const fish: RoundLine[] = [{ name: "Fish", quantity: "3" }, bread];
    expect(await oneVerdict(fish, "Fish", async (_, dish) => crew(dish))).toBeNull();
    expect(await oneVerdict(fish, "Fish", async (_, dish) => off(dish, "19.53"))).toMatchObject(
      ASKS,
    );
  });

  it("A803 portions: three pizzas with two olives each, under reasons allowing exactly 34.41% and 63.82%: each limit's own percentage goes through", async () => {
    const pizzas: RoundLine[] = [{ name: "Pizza", quantity: "3", olives: 2 }, bread];
    for (const percentBp of [3441, 6382]) {
      const reasonId = await reasonAllowing(percentBp);
      const ask = async (_: string, dish: Target) => ({
        ...crew(dish, undefined, percentBp),
        reasonId,
      });
      expect(await oneVerdict(pizzas, "Pizza", ask)).toBeNull();
    }
  });

  it("A803 portions: part of a dish with extras: €5.26 off one of three pizzas with an olive each goes through and €5.27 asks", async () => {
    const pizzas: RoundLine[] = [{ name: "Pizza", quantity: "3", olives: 1 }, bread];
    const ofOne = (value: string) => async (_: string, dish: Target) => ({
      ...off(dish, value),
      quantity: "1",
    });
    expect(await oneVerdict(pizzas, "Pizza", ofOne("5.26"))).toBeNull();
    expect(await oneVerdict(pizzas, "Pizza", ofOne("5.27"))).toMatchObject(ASKS);
  });

  it("A803 portions: a free pizza with a €1.50 olive is checked on the part asked for: €0.76 off one of three goes through and €0.77 asks", async () => {
    const pizzas: RoundLine[] = [{ name: "Pizza", quantity: "3", olives: 1 }, bread];
    const ofOne = (value: string) => async (_: string, dish: Target) => ({
      ...off(dish, value),
      quantity: "1",
    });
    expect(await oneVerdict(pizzas, "Pizza", ofOne("0.76"), [], "Pizza")).toBeNull();
    expect(await oneVerdict(pizzas, "Pizza", ofOne("0.77"), [], "Pizza")).toMatchObject(ASKS);
  });
  it("A803 portions: Crew meal 50% off 0.350 kg of Ham goes through and 60% asks", async () => {
    const ham: RoundLine[] = [{ name: "Ham", quantity: "0.350" }, bread];
    const crewAt = (percentBp: number) => async (_: string, dish: Target) =>
      crew(dish, undefined, percentBp);
    expect(await oneVerdict(ham, "Ham", crewAt(5000))).toBeNull();
    expect(await oneVerdict(ham, "Ham", crewAt(6000))).toMatchObject(ASKS);
  });

  it("A803 portions: a reason allowing 80% takes 40% off a burger (€7.20); Crew meal 20% more (€5.76) asks and the 80% reason's 30% more (€5.04) goes through", async () => {
    const reasonId = await reasonAllowing(8000);
    const generous = (percentBp: number) => async (_: string, dish: Target) => ({
      ...crew(dish, undefined, percentBp),
      reasonId,
    });
    const crewAt = (percentBp: number) => async (_: string, dish: Target) =>
      crew(dish, undefined, percentBp);
    expect(await oneVerdict(burgers("1"), "Burger", crewAt(2000), [generous(4000)])).toMatchObject(
      ASKS,
    );
    expect(await oneVerdict(burgers("1"), "Burger", generous(3000), [generous(4000)])).toBeNull();
  });

  it("A803 portions: Crew meal's 10% off the whole bill asks where it would take a burger Crew meal already took 50% off to €5.40, and goes through on a bill none of whose dishes is at its floor", async () => {
    const tenOffBill = async () => wholeBill(1000, venue.reasonId.staffMeal);
    const half = async (_: string, dish: Target) => crew(dish);
    expect(await oneVerdict(burgers("1"), "Burger", tenOffBill, [half])).toMatchObject(ASKS);
    expect(await oneVerdict(burgers("1"), "Burger", tenOffBill)).toBeNull();
  });

  it("A803 portions: a free dish takes nothing of a whole-bill discount and is not checked: a burger given free, then Crew meal's 10% off the whole bill goes through", async () => {
    const free = async (_: string, dish: Target): Promise<Ask> => ({
      ...dish,
      action: "comp",
      reasonId: venue.reasonId.complaint,
      operatorId: venue.managerId,
    });
    const tenOffBill = async () => wholeBill(1000, venue.reasonId.staffMeal);
    expect(await oneVerdict(burgers("1"), "Burger", tenOffBill, [free])).toBeNull();
  });
});

describe("A803 portions: what a comp or discount took follows each line it is split into (plan D37)", () => {
  /** Every row naming a line of these bills, as `B<n> name unit-price off amount of quantity`, `n`
   * the bill's place in `billIds`. */
  async function takenAcross(billIds: readonly string[]): Promise<string[]> {
    const ids = new Map<string, string>();
    for (const [index, billId] of billIds.entries())
      for (const row of await rowsOf(venue, billId))
        ids.set(row.id, `B${index + 1} ${row.name} ${row.unitPriceGross}`);
    const rows = await inTx(venue, (tx) => tx.select().from(adjustmentLines));
    return rows
      .filter((row) => ids.has(row.lineId))
      .map(
        (row) =>
          `${ids.get(row.lineId)} off ${centsToDecimal(row.reduction)} of ${thousandthsToDecimal(row.quantity)}`,
      )
      .sort();
  }

  /** 10% off the bill's line of three burgers, as one unbound line; answers its id. */
  async function tenOffThreeBurgers(bill: Bill): Promise<string> {
    const [line] = await dishesNamed(bill.billId, "Burger");
    await adjust(bill.billId, { ...tenOff, lineId: line! });
    return line!;
  }

  const takenFromThree = "Burger 10.80 off 3.60 of 3.000";

  it("A803 portions: Split bill moving 2 of an unbound line of three carries its row to the part moved", async () => {
    const bill = await groupedBill(burgers("3"));
    await tenOffThreeBurgers(bill);
    const other = await inTx(venue, (tx) =>
      splitPartyBill(tx, venue.cfg, bill.billId, [{ lineNo: 1, quantity: "2" }]),
    );

    expect(await takenAcross([bill.billId, other.billId])).toEqual([
      `B1 ${takenFromThree}`,
      `B2 ${takenFromThree}`,
    ]);
  });

  it("A803 portions: Transfer items of part of a line carries its row to the part moved", async () => {
    const bill = await groupedBill(burgers("3"));
    await tenOffThreeBurgers(bill);
    const other = await inTx(venue, (tx) =>
      splitPartyBill(tx, venue.cfg, bill.billId, [{ lineNo: 2 }]),
    );
    await inTx(venue, async (tx) => {
      const expectedEdits = [];
      for (const id of [bill.billId, other.billId].sort())
        expectedEdits.push(await readBillEditState(tx, id));
      await transferItems(
        tx,
        venue.cfg,
        bill.billId,
        other.billId,
        [{ lineNo: 1, quantity: "1" }],
        {
          partyId: bill.partyId,
          expectedPartyRevision: await partyRevision(tx, bill.partyId),
          operatorId: venue.managerId,
          expectedEdits,
        },
      );
    });

    expect(await takenAcross([bill.billId, other.billId])).toEqual([
      `B1 ${takenFromThree}`,
      `B2 ${takenFromThree}`,
    ]);
  });

  /** Three burgers as one unbound line waiting in a held group, 10% off. */
  async function heldThree(): Promise<Bill & { line: string }> {
    const bill = await inTx(venue, async (tx) => {
      const seatedBill = await seated(tx);
      const round = await priceTabRound(
        tx,
        venue.cfg,
        seatedBill.billId,
        roundOf(burgers("3")),
        "checked",
      );
      await insertTabRound(tx, venue.cfg, round, round.rows);
      const groupId = await startGroup(tx, seatedBill.partyId, "hold", venue.staffId);
      await tx
        .update(workingOrderLines)
        .set({ groupId })
        .where(eq(workingOrderLines.workingOrderId, seatedBill.billId));
      await bumpRevision(tx, [seatedBill.billId]);
      return seatedBill;
    });
    return { ...bill, line: await tenOffThreeBurgers(bill) };
  }

  it("A803 portions: a course move of one unit carries its row to the unit moved", async () => {
    const bill = await heldThree();
    await inTx(venue, async (tx) =>
      moveLinesToGroup(
        tx,
        venue.cfg,
        bill.partyId,
        [{ lineId: bill.line, quantity: "1.000" }],
        "new",
        {
          submissionId: randomUUID(),
          expectedPartyRevision: await partyRevision(tx, bill.partyId),
          operatorId: venue.managerId,
          expectedEdits: [await readBillEditState(tx, bill.billId)],
        },
      ),
    );

    expect(await dishesNamed(bill.billId, "Burger")).toHaveLength(2);
    expect(await takenAcross([bill.billId])).toEqual([
      `B1 ${takenFromThree}`,
      `B1 ${takenFromThree}`,
    ]);
  });

  it("A803 portions: a held line split into its units carries its row to every unit", async () => {
    const bill = await heldThree();
    await inTx(venue, async (tx) =>
      splitHeldLineIntoUnits(tx, venue.cfg, bill.partyId, bill.line, {
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(tx, bill.partyId),
        operatorId: venue.managerId,
        expectedEdit: await readBillEditState(tx, bill.billId),
      }),
    );

    expect(await dishesNamed(bill.billId, "Burger")).toHaveLength(3);
    expect(await takenAcross([bill.billId])).toEqual(Array(3).fill(`B1 ${takenFromThree}`));
  });

  it("A803 portions: a discount on part of a pizza line carries the earlier discount's rows to the pizza and the olives it carves off", async () => {
    const { billId } = await groupedBill([{ name: "Pizza", quantity: "2", olives: 1 }]);
    const [line] = await dishesNamed(billId, "Pizza");
    await adjust(billId, { ...tenOff, lineId: line! });
    await adjust(billId, { ...tenOff, lineId: line!, quantity: "1" });

    expect(await takenOn(billId)).toEqual([
      [
        "Olives 1.21 off 0.30 of 2.000",
        "Olives 1.35 off 0.30 of 2.000",
        "Pizza 7.29 off 1.80 of 2.000",
        "Pizza 8.10 off 1.80 of 2.000",
      ],
      ["Olives 1.21 off 0.14 of 1.000", "Pizza 7.29 off 0.81 of 1.000"],
    ]);
  });

  it("A803 portions: a second carve off the same line carries the original's row again, so the three parts' rows each read one third of it at their quantity", async () => {
    const bill = await groupedBill(burgers("3"));
    await tenOffThreeBurgers(bill);
    const second = await inTx(venue, (tx) =>
      splitPartyBill(tx, venue.cfg, bill.billId, [{ lineNo: 1, quantity: "1" }]),
    );
    const third = await inTx(venue, (tx) =>
      splitPartyBill(tx, venue.cfg, bill.billId, [{ lineNo: 1, quantity: "1" }]),
    );
    const billIds = [bill.billId, second.billId, third.billId];

    expect(await takenAcross(billIds)).toEqual([
      `B1 ${takenFromThree}`,
      `B2 ${takenFromThree}`,
      `B3 ${takenFromThree}`,
    ]);
    // Each row prorated by its line's quantity now.
    const quantityNow = new Map<string, number>();
    for (const billId of billIds)
      for (const row of await rowsOf(venue, billId))
        quantityNow.set(row.id, Number(row.quantity) * 1000);
    const rows = await inTx(venue, (tx) => tx.select().from(adjustmentLines));
    const standing = rows
      .filter((row) => quantityNow.has(row.lineId))
      .map((row) => (row.reduction * quantityNow.get(row.lineId)!) / row.quantity);
    expect(standing).toEqual([120, 120, 120]);
  });
});

describe("A803 portions: a cancel on a row of identical portions", () => {
  const burgerRow = (quantity: string): RoundLine[] => [{ name: "Burger", quantity }, bread];

  async function newJobs<T>(work: () => Promise<T>): Promise<{ result: T; jobs: string[][] }> {
    const before = new Set(
      (await inTx(venue, (tx) => tx.select({ id: printJobs.id }).from(printJobs))).map(
        ({ id }) => id,
      ),
    );
    const result = await work();
    const jobs = (await inTx(venue, (tx) => tx.select().from(printJobs)))
      .filter((job) => !before.has(job.id))
      .map((job) => printedLines(job.payload).filter((line) => / x /.test(line)));
    return { result, jobs };
  }

  type CancelAsk = Pick<CancelItemAsk, "quantity" | "outcome"> &
    Partial<Pick<CancelItemAsk, "refundHandoff" | "preparationStarted" | "lineIds">>;

  function cancelOn(bill: Bill, lineId: string, ask: CancelAsk) {
    return inTx(venue, async (tx) => {
      const [party] = await tx.select().from(parties).where(eq(parties.id, bill.partyId));
      const [order] = await tx
        .select()
        .from(workingOrders)
        .where(eq(workingOrders.id, bill.billId));
      return cancelItem(
        tx,
        venue.cfg,
        bill.partyId,
        lineId,
        {
          expectedEdit: await readBillEditState(tx, bill.billId),
          reasonId: venue.reasonId.houseVoid,
          expectedPartyRevision: party!.revision,
          expectedBillRevision: order!.revision,
          expectedContext: await readCancellationContext(tx, bill.partyId, lineId),
          submissionId: randomUUID(),
          ...ask,
        },
        venue.managerId,
      );
    });
  }

  async function paid(bill: Bill) {
    const rows = await rowsOf(venue, bill.billId);
    const due = toScale(sumDecimals(rows.map((row) => decimal(row.lineTotal))), 2);
    await payWorkingOrder({ db: venue.db, backend: venue.backend, clock: venue.clock }, venue.cfg, {
      id: bill.billId,
      tender: { method: "cash", amount: due },
      lines: [],
    });
    const [sale] = await inTx(venue, (tx) =>
      tx.select().from(sales).where(eq(sales.workingOrderId, bill.billId)),
    );
    const [tender] = await inTx(venue, (tx) =>
      tx.select().from(tenders).where(eq(tenders.saleId, sale!.id)),
    );
    return { saleId: sale!.id, tenderId: tender!.id };
  }

  async function capOf(adjustmentId: string) {
    const [row] = await inTx(venue, (tx) =>
      tx.select().from(adjustments).where(eq(adjustments.id, adjustmentId)),
    );
    return row!.refundValue;
  }

  async function refundLinked(
    sale: { saleId: string; tenderId: string },
    appliedAmount: string,
    cancellationIds: string[],
  ) {
    const answer = await send(
      venue.app,
      venue.cookie.manager,
      "POST",
      `/api/transactions/${sale.saleId}/refunds`,
      {
        submissionId: randomUUID(),
        tenderId: sale.tenderId,
        appliedAmount,
        tipAmount: "0.00",
        reason: "Dish never served",
        cancellationIds,
      },
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const links = await inTx(venue, (tx) =>
      tx
        .select()
        .from(adjustmentRefunds)
        .where(eq(adjustmentRefunds.tenderRefundId, (answer.json as { id: string }).id)),
    );
    return links.map((row) => ({ adjustmentId: row.adjustmentId, amount: row.amount }));
  }

  const cancelledOf = (lineIds: readonly string[]) =>
    inTx(venue, async (tx) =>
      Object.fromEntries(
        (await tx.select().from(lineServiceCancellations))
          .filter((row) => lineIds.includes(row.lineId))
          .map((row) => [row.lineId, row.quantity]),
      ),
    );

  /** The cancel the bill recorded, its line named by position in `members`. */
  async function cancelRecord(billId: string, members: readonly string[]) {
    const records = (await recordedOn(billId)).filter((row) => row.action === "cancel");
    expect(records).toHaveLength(1);
    const [record] = records;
    return {
      line: members.indexOf(record!.lineId!),
      quantity: record!.quantity,
      lineQuantity: record!.lineQuantity,
      reduction: record!.reduction,
      nominalValue: record!.nominalValue,
      stage: record!.stage,
    };
  }

  it("A803 portions: cancelling 2 of a row of three fired burgers removes the last two, records one cancel of 2 on the row's first portion, and prints one VOID 2 x BURG slip, as one line of three does", async () => {
    const grouped = await groupedBill(burgerRow("3"));
    const portions = await portionsBill(burgerRow("3"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const members = await dishesNamed(portions.billId, "Burger");

    const today = await newJobs(() =>
      adjust(grouped.billId, { lineId: line!, action: "cancel", quantity: "2" }),
    );
    const row = await newJobs(() =>
      adjust(portions.billId, {
        lineId: members[0]!,
        lineIds: members,
        action: "cancel",
        quantity: "2",
      }),
    );

    expect(today.jobs).toHaveLength(1);
    expect(today.jobs[0]!.join("\n")).toContain("2.000 x BURG");
    expect(row.jobs).toEqual(today.jobs);
    expect(await dishesNamed(portions.billId, "Burger")).toEqual([members[0]]);
    expect(await cancelRecord(portions.billId, members)).toEqual({
      ...(await cancelRecord(grouped.billId, [line!])),
      line: 0,
    });
    expect((await rowsOf(venue, portions.billId)).map((r) => r.lineTotal)).toEqual(
      (await rowsOf(venue, grouped.billId)).map((r) => r.lineTotal),
    );
  });

  /** A bill whose lines wait in one held group whose HOLD paper printed. */
  function heldPrinted(lines: RoundLine[], bound: boolean): Promise<Bill> {
    return inTx(venue, async (tx) => {
      const bill = await seated(tx);
      if (bound) await addPortionRound(tx, venue.cfg, bill.billId, roundOf(lines));
      else {
        const round = await priceTabRound(tx, venue.cfg, bill.billId, roundOf(lines), "checked");
        await insertTabRound(tx, venue.cfg, round, round.rows);
      }
      const groupId = await startGroup(tx, bill.partyId, "hold", venue.staffId);
      const stored = await tx
        .update(workingOrderLines)
        .set({ groupId })
        .where(eq(workingOrderLines.workingOrderId, bill.billId))
        .returning({ ...fireableLineColumns, groupId: workingOrderLines.groupId });
      await fireLines(
        tx,
        venue.cfg,
        bill.billId,
        stored.map((row) => ({ ...row, hold: true, release: false })),
      );
      await printHoldTickets(tx, venue.cfg, [groupId]);
      await bumpRevision(tx, [bill.billId]);
      return bill;
    });
  }

  it("A803 portions: a not-started cancel of 2 of a held row of three prints one HOLD CANCELLED of 2 and records two cancelled portion events", async () => {
    await inTx(venue, (tx) => setStationPrinting(tx, { printHeldWork: true }));
    try {
      const grouped = await heldPrinted(burgerRow("3"), false);
      const portions = await heldPrinted(burgerRow("3"), true);
      const [line] = await dishesNamed(grouped.billId, "Burger");
      const members = await dishesNamed(portions.billId, "Burger");

      const today = await newJobs(() =>
        cancelOn(grouped, line!, { quantity: "2", outcome: "remove_charge" }),
      );
      const row = await newJobs(() =>
        cancelOn(portions, members[0]!, {
          quantity: "2",
          outcome: "remove_charge",
          lineIds: members,
        }),
      );

      expect(today.jobs).toHaveLength(1);
      expect(today.jobs[0]!.join("\n")).toContain("2.000 x BURG");
      expect(row.jobs).toEqual(today.jobs);
      expect(await dishesNamed(portions.billId, "Burger")).toEqual([members[0]]);
      const events = await inTx(venue, (tx) =>
        tx
          .select({ kind: orderPortionEvents.kind })
          .from(orderPortionEvents)
          .where(eq(orderPortionEvents.fromOrderId, portions.billId)),
      );
      expect(events).toEqual([{ kind: "cancelled" }, { kind: "cancelled" }]);
    } finally {
      await inTx(venue, (tx) => setStationPrinting(tx, { printHeldWork: false }));
    }
  });

  it("A803 portions: a started cancel of 2 of a fired row of three passes the row on: it removes the last two and records one cancel of 2 on the row's first portion", async () => {
    const grouped = await groupedBill(burgerRow("3"));
    const portions = await portionsBill(burgerRow("3"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const members = await dishesNamed(portions.billId, "Burger");
    const ask = { quantity: "2", outcome: "remove_charge", preparationStarted: true } as const;

    await cancelOn(grouped, line!, ask);
    await cancelOn(portions, members[0]!, { ...ask, lineIds: members });

    expect(await dishesNamed(portions.billId, "Burger")).toEqual([members[0]]);
    expect(await cancelRecord(portions.billId, members)).toEqual({
      ...(await cancelRecord(grouped.billId, [line!])),
      line: 0,
    });
  });

  it("A803 portions: a keep-charge cancel of 1 of a paid row of three burgers, refund ticked, caps €12.00 and links the row's first portion; a second one naming the two not cancelled caps €12.00 too; a €20.00 refund naming both links 1200 and 800", async () => {
    const bill = await portionsBill(burgerRow("3"));
    const members = await dishesNamed(bill.billId, "Burger");
    const sale = await paid(bill);

    const first = await cancelOn(bill, members[0]!, {
      quantity: "1",
      outcome: "keep_charge",
      refundHandoff: true,
      lineIds: members,
    });
    expect(first.refundLinks).toEqual([{ lineId: members[0], adjustmentId: expect.any(String) }]);
    const one = first.refundLinks![0]!.adjustmentId;
    expect(await cancelledOf(members)).toEqual({ [members[2]!]: 1000 });

    const second = await cancelOn(bill, members[0]!, {
      quantity: "1",
      outcome: "keep_charge",
      refundHandoff: true,
      lineIds: members.slice(0, 2),
    });
    const two = second.refundLinks![0]!.adjustmentId;
    expect(await cancelledOf(members)).toEqual({ [members[1]!]: 1000, [members[2]!]: 1000 });

    expect([await capOf(one), await capOf(two)]).toEqual([1200, 1200]);
    expect(await refundLinked(sale, "20.00", [one, two])).toEqual([
      { adjustmentId: one, amount: 1200 },
      { adjustmentId: two, amount: 800 },
    ]);
  });

  it("A803 portions: a keep-charge cancel of 1 of a row of three records one cancel on the row's first portion with the row's count, as one line of three does", async () => {
    const grouped = await groupedBill(burgerRow("3"));
    const portions = await portionsBill(burgerRow("3"));
    const [line] = await dishesNamed(grouped.billId, "Burger");
    const members = await dishesNamed(portions.billId, "Burger");
    const ask = { quantity: "1", outcome: "keep_charge", preparationStarted: true } as const;

    await cancelOn(grouped, line!, ask);
    await cancelOn(portions, members[0]!, { ...ask, lineIds: members });

    expect(await cancelRecord(portions.billId, members)).toEqual({
      ...(await cancelRecord(grouped.billId, [line!])),
      line: 0,
    });
  });

  it("A803 portions: after a don't-charge cancel of 1 of a row of seven, a keep-charge cancel of 1 is valued €12.00 and a €12.00 refund links 1200", async () => {
    const bill = await portionsBill(burgerRow("7"));
    const members = await dishesNamed(bill.billId, "Burger");
    await cancelOn(bill, members[0]!, {
      quantity: "1",
      outcome: "remove_charge",
      lineIds: members,
    });
    const left = await dishesNamed(bill.billId, "Burger");
    expect(left).toEqual(members.slice(0, 6));
    const sale = await paid(bill);

    const answer = await cancelOn(bill, left[0]!, {
      quantity: "1",
      outcome: "keep_charge",
      refundHandoff: true,
      lineIds: left,
    });
    const id = answer.refundLinks![0]!.adjustmentId;
    expect(await capOf(id)).toBe(1200);
    expect(await refundLinked(sale, "12.00", [id])).toEqual([{ adjustmentId: id, amount: 1200 }]);
  });

  it("A803 portions: a request whose lineIds still name an already cancelled portion takes the last one still active", async () => {
    const bill = await portionsBill(burgerRow("3"));
    const members = await dishesNamed(bill.billId, "Burger");
    await paid(bill);
    const ask = { quantity: "1", outcome: "keep_charge", refundHandoff: true } as const;

    await cancelOn(bill, members[0]!, { ...ask, lineIds: members });
    const again = await cancelOn(bill, members[0]!, { ...ask, lineIds: members });

    expect(await cancelledOf(members)).toEqual({ [members[1]!]: 1000, [members[2]!]: 1000 });
    expect(await capOf(again.refundLinks![0]!.adjustmentId)).toBe(1200);
    await expect(
      cancelOn(bill, members[0]!, { quantity: "2", outcome: "keep_charge", lineIds: members }),
    ).rejects.toMatchObject({ code: "adjustment.quantity_invalid" });
  });

  it("A803 portions: a keep-charge cancel of 1 of a row of three discounted 10% caps the refund as one line of three does", async () => {
    const caps = [];
    for (const shape of ["grouped", "portions"] as const) {
      const bill = await (shape === "grouped" ? groupedBill : portionsBill)(burgerRow("3"));
      const members = await dishesNamed(bill.billId, "Burger");
      await adjust(bill.billId, { ...rowOf(members), action: "discount_percent", percentBp: 1000 });
      await paid(bill);
      const answer = await cancelOn(bill, members[0]!, {
        quantity: "1",
        outcome: "keep_charge",
        refundHandoff: true,
        ...(shape === "portions" ? { lineIds: members } : {}),
      });
      caps.push(await capOf(answer.refundLinks![0]!.adjustmentId));
    }
    expect(caps[0]).toBe(1080);
    expect(caps[1]).toBe(caps[0]);
  });

  async function postCancel(
    bill: Bill,
    lineId: string,
    body: Record<string, unknown>,
    cookie = venue.cookie.manager,
  ) {
    const ask = await inTx(venue, async (tx) => {
      const [party] = await tx.select().from(parties).where(eq(parties.id, bill.partyId));
      const [order] = await tx
        .select()
        .from(workingOrders)
        .where(eq(workingOrders.id, bill.billId));
      return {
        expectedEdit: await readBillEditState(tx, bill.billId),
        reasonId: venue.reasonId.houseVoid,
        expectedPartyRevision: party!.revision,
        expectedBillRevision: order!.revision,
        expectedContext: await readCancellationContext(tx, bill.partyId, lineId),
        submissionId: randomUUID(),
      };
    });
    return send(
      venue.app,
      cookie,
      "POST",
      `/api/parties/${bill.partyId}/lines/${lineId}/cancel-item`,
      { ...ask, ...body },
    );
  }

  it("A803 portions: the cancel-item route takes the row: a started cancel of 2 of a row of three removes the last two", async () => {
    const bill = await portionsBill(burgerRow("3"));
    const members = await dishesNamed(bill.billId, "Burger");
    const answer = await postCancel(bill, members[0]!, {
      quantity: "2",
      outcome: "remove_charge",
      preparationStarted: true,
      lineIds: members,
    });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await dishesNamed(bill.billId, "Burger")).toEqual([members[0]]);
  });

  it("A803 portions: the cancel-item route checks the approver's PIN for the row before the write lock: a staff member's started cancel of 2 of a row of three under a manager's reason goes through with the manager's PIN", async () => {
    const reason = await inTx(venue, (tx) =>
      createAdjustmentReason(tx, {
        name: `Manager cancel ${randomUUID()}`,
        names: { en: "Manager cancel" },
        kind: "void",
        actions: ["cancel"],
        maxPercentBp: null,
        maxAmount: null,
        applyRoles: [],
        approverRoles: [],
        noteRequired: false,
      }),
    );
    const bill = await portionsBill(burgerRow("3"));
    const members = await dishesNamed(bill.billId, "Burger");
    watchDerivationsAndLock(venue.db, PINS.manager);
    const answer = await postCancel(
      bill,
      members[0]!,
      {
        quantity: "2",
        outcome: "remove_charge",
        preparationStarted: true,
        reasonId: reason.id,
        lineIds: members,
        approver: { personId: venue.managerId, pin: PINS.manager },
      },
      venue.cookie.staff,
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(watchedDerivationCount()).toBe(1);
    expect(await watchedOrder()).toEqual([]);
    expect(await dishesNamed(bill.billId, "Burger")).toEqual([members[0]]);
    const [record] = (await recordedOn(bill.billId)).filter((row) => row.action === "cancel");
    expect(record).toMatchObject({ approvedBy: venue.managerId, requestedBy: venue.staffId });
  });

  it.each([["a string"], [[1, 2]]])(
    "A803 portions: the cancel-item route refuses lineIds %j management.request_invalid on lineIds",
    async (lineIds) => {
      const bill = await portionsBill(burgerRow("2"));
      const members = await dishesNamed(bill.billId, "Burger");
      const answer = await postCancel(bill, members[0]!, {
        quantity: "1",
        outcome: "remove_charge",
        lineIds,
      });
      expect(answer.status).toBe(400);
      expect(answer.json).toEqual({
        code: "management.request_invalid",
        params: { field: "lineIds" },
      });
    },
  );

  it("A803 portions: a cancel naming portions of two different rows is refused management.request_invalid on lineIds, changing nothing", async () => {
    const bill = await portionsBill([
      { name: "Burger", quantity: "2" },
      { name: "Croquetas", quantity: "2" },
    ]);
    const burgersHere = await dishesNamed(bill.billId, "Burger");
    const croquetas = await dishesNamed(bill.billId, "Croquetas");
    const before = await rowsOf(venue, bill.billId);
    for (const outcome of ["remove_charge", "keep_charge"] as const) {
      await expect(
        cancelOn(bill, burgersHere[0]!, {
          quantity: "1",
          outcome,
          preparationStarted: true,
          lineIds: [burgersHere[0]!, croquetas[0]!],
        }),
      ).rejects.toMatchObject({ code: "management.request_invalid", params: { field: "lineIds" } });
    }
    expect(await rowsOf(venue, bill.billId)).toEqual(before);
  });
});
