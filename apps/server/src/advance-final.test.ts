import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billAdvances,
  parties,
  readVenueClock,
  saleLines,
  sales,
  taxpayer,
  tenders,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { createCategory, createProduct } from "@waitron/menu";
import { receiptLabelsFor } from "@waitron/country-packs";
import { addDecimal, decimal } from "@waitron/shared";
import {
  filedInvoicesOf,
  type FiledInvoice,
} from "@waitron/fiscal-verifactu/test/invoice-records.js";
import { readBillEditState } from "./bill-editing.js";
import type { BillPaymentRequest } from "./bill-payments.js";
import { closeOfDayConfig, issueBillAtClose } from "./close-of-day.js";
import { endMeal } from "./meal-end.js";
import { owesOriginal } from "./owed-receipts.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { readOrderRevision } from "./working-order.js";
import { createTable } from "./testing/live-table.js";
import { fireAll, openPartyTab } from "./testing/serve-line.js";
import { offerProducts } from "./testing/zone-offers.js";
import { setOrderInvoiceChoice } from "./testing/order-writer-fixture.js";
import {
  deferredCloseKit,
  RECIPIENT,
  type DeferredCloseKit,
} from "./testing/deferred-close-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import {
  inTx,
  paymentRows,
  provisionBillVenue,
  send,
  type Answer,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

// The rest's invoice of a bill on which an advance was taken, on every path that issues it,
// against a venue that files real Veri*Factu records. Each case's bill is at a table of its own.
let venue: BillVenue;
let kit: DeferredCloseKit;
let offerFor: (name: string) => string;

/** Dishes at 10% and 21%, each priced so one line is one of the plan's worked examples. */
const DISHES: { name: string; price: string; vatClass: "reduced" | "general" }[] = [
  { name: "Tasting menu", price: "120.00", vatClass: "reduced" },
  { name: "Bread roll", price: "1.05", vatClass: "reduced" },
  { name: "Salad bowl", price: "20.00", vatClass: "reduced" },
  { name: "Seafood platter", price: "30.05", vatClass: "reduced" },
  { name: "Wine case", price: "80.00", vatClass: "general" },
  { name: "Cava bottle", price: "30.00", vatClass: "general" },
  { name: "Reserva bottle", price: "50.00", vatClass: "general" },
];

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, (tx) =>
      tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" }),
    );
    const ids = new Map<string, string>();
    const offers = await inTx(venue, async (tx) => {
      const category = await createCategory(tx, { name: "Advance dishes" });
      for (const dish of DISHES) {
        const product = await createProduct(tx, {
          categoryId: category.id,
          name: dish.name,
          customerName: { es: `${dish.name} (customer)` },
          kitchenName: dish.name.toUpperCase(),
          pricingUnit: "each",
          unitPrice: dish.price,
          vatClass: dish.vatClass,
        });
        ids.set(dish.name, product.id);
      }
      return offerProducts(tx, venue.cfg, { zone: { zoneId: venue.zoneId }, orderStart: "table" });
    });
    offerFor = (name) => offers.offerFor(ids.get(name)!);
    kit = deferredCloseKit(venue, venue.zoneId);
  },
});

/** A party at a fresh table whose bill carries one line per named dish, in order, its dishes sent. */
async function seated(...names: string[]): Promise<{ billId: string; partyId: string }> {
  return withTransaction(venue.db, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `A-${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    });
    const { tabId, partyId } = await openPartyTab(tx, venue.cfg, {
      tableId: table.id,
      lines: names.map((name) => ({ menuItemId: offerFor(name), quantity: "1" })),
    });
    await fireAll(tx, venue.cfg, tabId);
    return { billId: tabId, partyId };
  });
}

function cashBody(amount: string, extra: Record<string, unknown> = {}): BillPaymentRequest {
  return {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "cash",
    tendered: amount,
    applied: amount,
    tip: "0.00",
    ...extra,
  } as BillPaymentRequest;
}

function cash(
  billId: string,
  amount: string,
  extra: Record<string, unknown> = {},
): Promise<Answer> {
  return send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    cashBody(amount, extra),
  );
}

/** A cash advance of `amount` on the bill, its payer wanting their own receipt; its sale's id. */
async function advance(billId: string, amount: string): Promise<string> {
  const paid = await cash(billId, amount, { ownReceipt: true });
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  const rows = await inTx(venue, (tx) =>
    tx.select().from(billAdvances).where(eq(billAdvances.workingOrderId, billId)),
  );
  return rows.at(-1)!.advanceSaleId;
}

async function restOf(billId: string) {
  const [sale] = await inTx(venue, (tx) =>
    tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return sale;
}

function deductionLinesOf(saleId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({
        deductsSaleId: saleLines.deductsSaleId,
        lineTotal: saleLines.lineTotal,
        lineGross: saleLines.lineGross,
        vatRate: saleLines.vatRate,
      })
      .from(saleLines)
      .where(and(eq(saleLines.saleId, saleId), eq(saleLines.advanceRole, "deduction")))
      .orderBy(saleLines.lineNo),
  );
}

function tendersOf(saleId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({
        method: tenders.method,
        amount: tenders.amount,
        billPaymentId: tenders.billPaymentId,
      })
      .from(tenders)
      .where(eq(tenders.saleId, saleId)),
  );
}

/** The sale's record as filed, after AEAT's own checks found nothing wrong with it. */
function filedRecord(saleId: string): FiledInvoice {
  const records = filedInvoicesOf(venue.db, saleId, new Date());
  expect(records).toHaveLength(1);
  expect(records[0]!.errors).toEqual([]);
  return records[0]!;
}

async function partyRevision(partyId: string): Promise<number> {
  const [row] = await inTx(venue, (tx) =>
    tx.select({ revision: parties.revision }).from(parties).where(eq(parties.id, partyId)),
  );
  return row!.revision;
}

/** Takes the bill's line `name` off it before its preparation starts, as the till's cancel does. */
async function removeDish(bill: { billId: string; partyId: string }, name: string) {
  const [line] = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(
        and(eq(workingOrderLines.workingOrderId, bill.billId), eq(workingOrderLines.name, name)),
      ),
  );
  const ask = await inTx(venue, async (tx) => {
    const [order] = await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, bill.billId));
    return {
      expectedEdit: await readBillEditState(tx, bill.billId),
      expectedPartyRevision: (
        await tx.select().from(parties).where(eq(parties.id, bill.partyId))
      )[0]!.revision,
      expectedBillRevision: order!.revision,
      expectedContext: await readCancellationContext(tx, bill.partyId, line!.id),
      submissionId: randomUUID(),
    };
  });
  return send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/parties/${bill.partyId}/lines/${line!.id}/cancel-item`,
    { ...ask, quantity: "1", outcome: "remove_charge" },
  );
}

/** Print the bill, as the till's end of meal does, without waiting for the dishes to be served. */
async function printTheBill(bill: { billId: string; partyId: string }, cfg = venue.cfg) {
  const expectedEdits = await inTx(venue, async (tx) => {
    const { billId, editorVersion, draftId, draftRevision } = await readBillEditState(
      tx,
      bill.billId,
    );
    return [{ billId, editorVersion, draftId, draftRevision }];
  });
  const expectedPartyRevision = await partyRevision(bill.partyId);
  return inTx(venue, (tx) =>
    endMeal(
      tx,
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      cfg,
      bill.partyId,
      {
        billId: bill.billId,
        expectedPartyRevision,
        expectedEdits,
        submissionId: randomUUID(),
        printAnyway: true,
      },
      venue.operatorId,
      null,
    ),
  );
}

const english = receiptLabelsFor("en-GB");

describe("the rest's invoice takes the advances off", () => {
  it("example 1 by the last payment: the rest files 81.82 and 8.18, names A/12 on its deduction line, and lists only the €90", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advance(bill.billId, "30.00");

    const paid = await cash(bill.billId, "90.00");

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json.invoice).toBeDefined();
    const rest = await restOf(bill.billId);
    expect(rest).toMatchObject({
      total: 9000,
      vatBreakdown: [{ rate: "10.00", base: "81.82", tax: "8.18" }],
    });
    expect(await deductionLinesOf(rest!.id)).toEqual([
      { deductsSaleId: advanceId, lineTotal: -2727, lineGross: -3000, vatRate: 1000 },
    ]);
    const [, last] = await paymentRows(venue, bill.billId);
    expect(await tendersOf(rest!.id)).toEqual([
      { method: "cash", amount: 9000, billPaymentId: last!.id },
    ]);
    const record = filedRecord(rest!.id);
    expect(record).toMatchObject({ total: "90.00", vatTotal: "8.18", kind: "F2" });
    expect(record.breakdown).toEqual([["10.00", "81.82", "8.18"]]);
    expect(await inTx(venue, (tx) => owesOriginal(tx, rest!.id))).toBe(true);
    const [line] = await inTx(venue, (tx) =>
      tx
        .select({ name: saleLines.name, descriptions: saleLines.descriptions })
        .from(saleLines)
        .where(and(eq(saleLines.saleId, rest!.id), eq(saleLines.advanceRole, "deduction"))),
    );
    expect(line).toEqual({
      name: english.paymentOnAccount,
      descriptions: { "es-ES": receiptLabelsFor("es-ES").paymentOnAccount },
    });
  });

  it("example 1 by Print the bill, then paid: the printed bill files the rest, and the €90 settles it", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advance(bill.billId, "30.00");

    const printed = await printTheBill(bill);

    expect(printed).toMatchObject({ total: "90.00" });
    const rest = await restOf(bill.billId);
    expect(rest).toMatchObject({
      total: 9000,
      vatBreakdown: [{ rate: "10.00", base: "81.82", tax: "8.18" }],
    });
    expect(await deductionLinesOf(rest!.id)).toEqual([
      { deductsSaleId: advanceId, lineTotal: -2727, lineGross: -3000, vatRate: 1000 },
    ]);
    expect(filedRecord(rest!.id).breakdown).toEqual([["10.00", "81.82", "8.18"]]);

    const paid = await cash(bill.billId, "90.00");

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const [, last] = await paymentRows(venue, bill.billId);
    expect(await tendersOf(rest!.id)).toEqual([
      { method: "cash", amount: 9000, billPaymentId: last!.id },
    ]);
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, bill.billId)),
    );
    expect(order!.status).toBe("settled");
  });

  it("example 1 by Print the bill: the rest's ticket owes the €90 and lists no payment, the advance's €30 being on its own ticket", async () => {
    const bill = await seated("Tasting menu");
    await advance(bill.billId, "30.00");

    const printed = await printTheBill(bill);
    const rest = await restOf(bill.billId);
    const ticket = await inTx(venue, (tx) =>
      readTransactionReceipt(venue.backend, tx, venue.cfg, rest!.id),
    );

    expect(printed).toMatchObject({ total: "90.00", owed: "90.00" });
    expect(ticket).toMatchObject({ total: "90.00", owed: "90.00" });
    expect(ticket).not.toHaveProperty("payments");
  });

  it("a €10 advance and a plain €5, then Print the bill: the ticket takes the advance off, lists the €5 and owes €105", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advance(bill.billId, "10.00");
    const plain = await cash(bill.billId, "5.00");
    expect(plain.status, JSON.stringify(plain.json)).toBe(200);

    await printTheBill(bill);
    const rest = await restOf(bill.billId);
    const ticket = await inTx(venue, (tx) =>
      readTransactionReceipt(venue.backend, tx, venue.cfg, rest!.id),
    );

    expect(await deductionLinesOf(rest!.id)).toEqual([
      expect.objectContaining({ deductsSaleId: advanceId, lineGross: -1000 }),
    ]);
    expect(ticket).toMatchObject({ total: "110.00", owed: "105.00" });
    expect(ticket.payments).toEqual([expect.objectContaining({ method: "cash", amount: "5.00" })]);
  });

  it("example 8 by the last payment: seven €1.05 dishes less a €3.00 advance file 3.92 and 0.43, and the two records' bases add up to the meal's 6.65", async () => {
    const bill = await seated(...Array<string>(7).fill("Bread roll"));
    const advanceId = await advance(bill.billId, "3.00");

    const paid = await cash(bill.billId, "4.35");

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const rest = await restOf(bill.billId);
    expect(rest).toMatchObject({
      total: 435,
      vatBreakdown: [{ rate: "10.00", base: "3.92", tax: "0.43" }],
    });
    expect(await deductionLinesOf(rest!.id)).toEqual([
      { deductsSaleId: advanceId, lineTotal: -273, lineGross: -300, vatRate: 1000 },
    ]);
    const restRecord = filedRecord(rest!.id);
    expect(restRecord).toMatchObject({ total: "4.35", vatTotal: "0.43" });
    const advanceRecord = filedRecord(advanceId);
    expect(advanceRecord.breakdown).toEqual([["10.00", "2.73", "0.27"]]);
    const bases = [restRecord, advanceRecord].map((record) => decimal(record.breakdown[0]![1]));
    expect(addDecimal(bases[0]!, bases[1]!)).toBe("6.65");
  });

  it("example 4: a bill left without paying after an advance files the rest's €90, and €90 is owed", async () => {
    const bill = await seated("Tasting menu");
    await advance(bill.billId, "30.00");

    const departed = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${bill.partyId}/unpaid-departure`,
      {
        billId: bill.billId,
        expectedPartyRevision: await partyRevision(bill.partyId),
        reason: "Left without paying",
        override: { personId: venue.adminId, pin: "1234" },
      },
    );

    expect(departed.status, JSON.stringify(departed.json)).toBe(200);
    const rest = await restOf(bill.billId);
    expect(rest).toMatchObject({
      total: 9000,
      vatBreakdown: [{ rate: "10.00", base: "81.82", tax: "8.18" }],
    });
    expect(filedRecord(rest!.id)).toMatchObject({ total: "90.00", vatTotal: "8.18" });
    expect(departed.json).toMatchObject({ departures: [{ amount: "90.00" }] });
  });

  it("advances equal to the meal issue and print a €0.00 rest's invoice, at one rate", async () => {
    const bill = await seated("Tasting menu", "Salad bowl");
    const advanceId = await advance(bill.billId, "120.00");

    const removed = await removeDish(bill, "Salad bowl");

    expect(removed.status, JSON.stringify(removed.json)).toBe(200);
    const rest = await restOf(bill.billId);
    expect(rest).toMatchObject({
      total: 0,
      vatBreakdown: [{ rate: "10.00", base: "0.00", tax: "0.00" }],
    });
    expect(await deductionLinesOf(rest!.id)).toEqual([
      { deductsSaleId: advanceId, lineTotal: -10909, lineGross: -12000, vatRate: 1000 },
    ]);
    expect(await tendersOf(rest!.id)).toEqual([]);
    expect(filedRecord(rest!.id)).toMatchObject({ total: "0.00", vatTotal: "0.00" });
    expect(removed.json).toMatchObject({ invoice: { total: "0.00" } });
    expect(await inTx(venue, (tx) => owesOriginal(tx, rest!.id))).toBe(true);
  });

  it("advances equal to the meal issue and print a €0.00 rest's invoice: example 2 with €50 of the wine removed", async () => {
    const bill = await seated("Salad bowl", "Cava bottle", "Reserva bottle");
    await advance(bill.billId, "50.00");

    const removed = await removeDish(bill, "Reserva bottle");

    expect(removed.status, JSON.stringify(removed.json)).toBe(200);
    const rest = await restOf(bill.billId);
    expect(rest).toMatchObject({ total: 0 });
    const record = filedRecord(rest!.id);
    expect(record).toMatchObject({ total: "0.00" });
    expect(record.breakdown.sort()).toEqual([
      ["10.00", "-27.27", "-2.73"],
      ["21.00", "24.79", "5.21"],
    ]);
    expect(removed.json).toMatchObject({ invoice: { total: "0.00" } });
    expect(await inTx(venue, (tx) => owesOriginal(tx, rest!.id))).toBe(true);
  });

  it("example 2 through the route: a €50 advance at 10% on a bill mostly at 21% leaves 10% negative", async () => {
    const bill = await seated("Salad bowl", "Wine case");
    const advanceId = await advance(bill.billId, "50.00");

    const paid = await cash(bill.billId, "50.00");

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const rest = await restOf(bill.billId);
    expect(rest).toMatchObject({ total: 5000 });
    const record = filedRecord(rest!.id);
    expect(record).toMatchObject({ total: "50.00", vatTotal: "11.15" });
    expect(record.breakdown.sort()).toEqual([
      ["10.00", "-27.27", "-2.73"],
      ["21.00", "66.12", "13.88"],
    ]);
    expect(await deductionLinesOf(rest!.id)).toEqual([
      { deductsSaleId: advanceId, lineTotal: -4545, lineGross: -5000, vatRate: 1000 },
    ]);
  });

  it("a bill set for a full invoice takes off an advance ticket", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advance(bill.billId, "30.00");
    await setOrderInvoiceChoice(venue.db, venue.backend, venue.cfg, bill.billId, {
      revision: await inTx(venue, (tx) => readOrderRevision(tx, bill.billId)),
      invoiceType: "F1",
      recipient: RECIPIENT,
    });

    const paid = await cash(bill.billId, "90.00");

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const rest = await restOf(bill.billId);
    expect(rest).toMatchObject({ total: 9000, counterpartyTaxId: RECIPIENT.taxId });
    expect(filedRecord(rest!.id)).toMatchObject({ kind: "F1", total: "90.00" });
    expect(filedRecord(advanceId)).toMatchObject({ kind: "F2", total: "30.00" });
    expect(await deductionLinesOf(rest!.id)).toEqual([
      { deductsSaleId: advanceId, lineTotal: -2727, lineGross: -3000, vatRate: 1000 },
    ]);
  });

  it("the ticket limit checks the meal, not what is left", async () => {
    const bill = await seated("Tasting menu");
    await advance(bill.billId, "30.00");

    const refused = printTheBill(bill, {
      ...venue.cfg,
      simplifiedInvoiceLimit: decimal("100.00"),
    });

    await expect(refused).rejects.toMatchObject({
      code: "sale.total_exceeds_simplified_limit",
      params: { total: "120.00", limit: "100.00" },
    });
    expect(await restOf(bill.billId)).toBeUndefined();
  });

  it("example 6: what is left rounds to nothing, so the rest files 0.04 and 0.01 and its deduction line's base is −27.28", async () => {
    const bill = await seated("Seafood platter");
    const advanceId = await advance(bill.billId, "30.00");

    const paid = await cash(bill.billId, "0.05");

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const rest = await restOf(bill.billId);
    expect(rest).toMatchObject({
      total: 5,
      vatBreakdown: [{ rate: "10.00", base: "0.04", tax: "0.01" }],
    });
    expect(await deductionLinesOf(rest!.id)).toEqual([
      { deductsSaleId: advanceId, lineTotal: -2728, lineGross: -3000, vatRate: 1000 },
    ]);
    expect(filedRecord(rest!.id)).toMatchObject({ total: "0.05", vatTotal: "0.01" });
  });

  it("deferred close takes off a till advance: its record carries 81.82 and 8.18 and €90 is owed", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advance(bill.billId, "30.00");
    const request = await kit.requestFor(bill.billId, "90.00", bill.partyId, { partyFinish: null });

    await kit.close(request);

    const rest = await restOf(bill.billId);
    expect(rest).toMatchObject({
      total: 9000,
      vatBreakdown: [{ rate: "10.00", base: "81.82", tax: "8.18" }],
    });
    expect(filedRecord(rest!.id).breakdown).toEqual([["10.00", "81.82", "8.18"]]);
    expect(await deductionLinesOf(rest!.id)).toEqual([
      { deductsSaleId: advanceId, lineTotal: -2727, lineGross: -3000, vatRate: 1000 },
    ]);
    expect(await tendersOf(rest!.id)).toEqual([
      { method: "deferred", amount: 9000, billPaymentId: null },
    ]);
  });

  it("the close of the business day takes off a till advance: the rest files 81.82 and 8.18, and its ticket owes the €90", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advance(bill.billId, "30.00");
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ trustedOpenedAt: new Date(Date.now() - 60_000).toISOString() })
        .where(eq(workingOrders.id, bill.billId)),
    );

    const outcome = await withTransaction(venue.db, async (tx) =>
      issueBillAtClose(
        tx,
        {
          admission: testTradingAdmission(),
          db: venue.db,
          backend: venue.backend,
          clock: venue.clock,
        },
        closeOfDayConfig(venue.cfg),
        bill.billId,
        { dayStartedAt: new Date(Date.now() + 60_000), venueClock: await readVenueClock(tx) },
      ),
    );

    expect(outcome).toMatchObject({ kind: "issued" });
    const rest = await restOf(bill.billId);
    expect(rest).toMatchObject({
      total: 9000,
      vatBreakdown: [{ rate: "10.00", base: "81.82", tax: "8.18" }],
    });
    expect(filedRecord(rest!.id).breakdown).toEqual([["10.00", "81.82", "8.18"]]);
    expect(await deductionLinesOf(rest!.id)).toEqual([
      { deductsSaleId: advanceId, lineTotal: -2727, lineGross: -3000, vatRate: 1000 },
    ]);
    const ticket = await inTx(venue, (tx) =>
      readTransactionReceipt(venue.backend, tx, venue.cfg, rest!.id),
    );
    expect(ticket).toMatchObject({ total: "90.00", owed: "90.00" });
    expect(ticket).not.toHaveProperty("payments");
  });
});
