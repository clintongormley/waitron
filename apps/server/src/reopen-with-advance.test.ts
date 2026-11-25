import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billAdvances,
  billPayments,
  refunds,
  saleLines,
  sales,
  tenders,
  workingOrders,
} from "@waitron/db";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { payments } from "@waitron/payments";
import { addDecimal, decimal } from "@waitron/shared";
import { filedInvoicesOf } from "@waitron/fiscal-verifactu/test/invoice-records.js";
import { advancesTakenOff } from "./advance-taken-off.js";
import { readBillAdvances } from "./bill-advances.js";
import {
  advanceBills,
  printed,
  provisionAdvanceVenue,
  type AdvanceVenue,
} from "./testing/advance-bills.js";
import { billRefundFields } from "./testing/bill-payment-fixture.js";
import { inTx, paymentRows, send, statusOf } from "./testing/bill-venue.js";
import * as fixture from "./testing/split-after-print-fixture.js";
import "./errors.js";

// Reopen bill on a printed bill part of which was paid as an advance (a part payment on the
// payer's own receipt): the advance's payment moves to the reopened bill and counts there, against
// a venue that files real Veri*Factu records. Each case's bill is at a table of its own.
let advanceVenue: AdvanceVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    advanceVenue = await provisionAdvanceVenue(db);
    // Print the bill prints on the till's receipt printer, which the venue's till profile allows.
    db.run(sql`update device_profiles set capabilities = json_insert(capabilities, '$[#]', 'print-receipt')
      where name = 'Counter till'`);
  },
});

const venue = () => advanceVenue.venue;
const supervisor = () => ({ personId: venue().adminId, pin: "1234" });
const { seated, seatedTakeaway, cash, advance, caption, readTicket } = advanceBills(
  () => advanceVenue,
);

async function partyOf(billId: string): Promise<{ partyId: string; tabId: string }> {
  const [bill] = await inTx(venue(), (tx) =>
    tx
      .select({ partyId: workingOrders.partyId })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId)),
  );
  return { partyId: bill!.partyId!, tabId: billId };
}

/** Prints the bill and answers its receipt's id. */
async function print(billId: string): Promise<string> {
  await fixture.printed(venue(), await partyOf(billId));
  return (await fixture.invoiceOf(venue(), billId)).id;
}

/** Reopens the printed bill; answers the reopened bill and the printed receipt's corrective. */
async function reopen(billId: string): Promise<{ billId: string; correctiveId: string }> {
  const receiptId = (await fixture.invoiceOf(venue(), billId)).id;
  const answer = await fixture.split(venue(), billId, venue().cookie);
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  const [corrective] = await fixture.creditsOf(venue(), receiptId);
  return { billId: answer.json.billId as string, correctiveId: corrective!.id };
}

async function balanceOf(billId: string) {
  const balance = await fixture.balanceOf(venue(), billId);
  expect(balance.status, JSON.stringify(balance.json)).toBe(200);
  return balance.json;
}

/** The sale's one filed record, checked by AEAT's own rules: its total and VAT rows, by rate. */
function recordOf(saleId: string): { total: string; breakdown: string[][] } {
  const records = filedInvoicesOf(venue().db, saleId, new Date());
  expect(records).toHaveLength(1);
  expect(records[0]!.errors).toEqual([]);
  return {
    total: records[0]!.total,
    breakdown: records[0]!.breakdown.map((row) => [...row]).sort(),
  };
}

/** Each rate's base and tax added up over the sales' filed records. */
function sumOfRecords(saleIds: readonly string[]): string[][] {
  const sums = new Map<string, { base: string; tax: string }>();
  for (const saleId of saleIds)
    for (const [rate, base, tax] of recordOf(saleId).breakdown) {
      const seen = sums.get(rate!) ?? { base: "0.00", tax: "0.00" };
      sums.set(rate!, {
        base: String(addDecimal(decimal(seen.base), decimal(base!))),
        tax: String(addDecimal(decimal(seen.tax), decimal(tax!))),
      });
    }
  return [...sums].map(([rate, { base, tax }]) => [rate, base, tax]).sort();
}

function tendersOf(saleId: string) {
  return inTx(venue(), (tx) =>
    tx
      .select({ amount: tenders.amount, tip: tenders.tipAmount })
      .from(tenders)
      .where(eq(tenders.saleId, saleId))
      .orderBy(sql`${tenders}.rowid`),
  );
}

/** The receipt that took each advance off, by advance; none for one no receipt took off. */
async function takenOffBy(...advanceIds: string[]): Promise<(string | undefined)[]> {
  const taken = await inTx(venue(), (tx) => advancesTakenOff(tx, advanceIds));
  return advanceIds.map((id) => taken.get(id)?.saleId);
}

/** The bill payment that paid the advance. */
async function paymentOf(advanceId: string): Promise<string> {
  const [row] = await inTx(venue(), (tx) =>
    tx
      .select({ id: billAdvances.billPaymentId })
      .from(billAdvances)
      .where(eq(billAdvances.advanceSaleId, advanceId)),
  );
  return row!.id;
}

/** A 20.00 advance on a hand-keyed card: its bill payment and sale. */
async function cardAdvance(billId: string): Promise<{ paymentId: string; advanceId: string }> {
  const paid = await cash(billId, "20.00", {
    method: "card",
    entry: "manual",
    externalRef: `OP-${randomUUID().slice(0, 8)}`,
    tendered: undefined,
    ownReceipt: true,
  });
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  const paymentId = (paid.json.payment as { id: string }).id;
  return { paymentId, advanceId: await paymentAdvance(paymentId) };
}

/** The advance the bill payment paid. */
async function paymentAdvance(paymentId: string): Promise<string> {
  const [row] = await inTx(venue(), (tx) =>
    tx
      .select({ advanceId: billAdvances.advanceSaleId })
      .from(billAdvances)
      .where(eq(billAdvances.billPaymentId, paymentId)),
  );
  return row!.advanceId;
}

/** Opens Correct invoice on the whole of a 20.00 advance, giving nothing back yet. */
async function openCorrection(advanceId: string) {
  const [reason] = await inTx(venue(), (tx) => listAdjustmentReasons(tx));
  return send(venue().app, venue().cookie, "POST", `/api/transactions/${advanceId}/corrections`, {
    submissionId: randomUUID(),
    gross: "20.00",
    reasonId: reason!.id,
    note: "Sent back",
    expectedSplit: [{ rate: "10.00", base: "18.18", tax: "1.82" }],
    override: supervisor(),
  });
}

async function payRestOf(billId: string, amount: string): Promise<string> {
  const paid = await cash(billId, amount);
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  expect(await statusOf(venue(), billId)).toBe("settled");
  return (await fixture.invoiceOf(venue(), billId)).id;
}

const MIXED_RECEIPT = {
  total: "50.00",
  breakdown: [
    ["10.00", "-27.27", "-2.73"],
    ["21.00", "66.12", "13.88"],
  ],
};

describe("Reopen bill on a printed bill with an advance", () => {
  it("72.00 with a 20.00 advance: the 52.00 receipt is credited, the reopened bill counts the 20.00 and its receipt files 52.00", async () => {
    const x = await seated("Grill for two");
    const advanceId = await advance(x, "20.00");
    const xReceipt = await print(x);
    expect(recordOf(advanceId)).toEqual({
      total: "20.00",
      breakdown: [["10.00", "18.18", "1.82"]],
    });
    expect(recordOf(xReceipt)).toEqual({ total: "52.00", breakdown: [["10.00", "47.27", "4.73"]] });
    const advanceRow = await inTx(venue(), (tx) =>
      tx.select().from(billAdvances).where(eq(billAdvances.advanceSaleId, advanceId)),
    );

    const y = await reopen(x);

    expect(recordOf(y.correctiveId)).toEqual({
      total: "-52.00",
      breakdown: [["10.00", "-47.27", "-4.73"]],
    });
    expect(await balanceOf(y.billId)).toMatchObject({
      status: "open",
      total: "72.00",
      received: "20.00",
      outstanding: "52.00",
    });
    expect(await takenOffBy(advanceId)).toEqual([undefined]);
    const final = await payRestOf(y.billId, "52.00");
    expect(recordOf(final)).toEqual({ total: "52.00", breakdown: [["10.00", "47.27", "4.73"]] });
    expect(sumOfRecords([advanceId, xReceipt, y.correctiveId, final])).toEqual([
      ["10.00", "65.45", "6.55"],
    ]);
    expect(await takenOffBy(advanceId)).toEqual([final]);
    // The advance's receipt and its row are not touched: it was taken on the printed bill.
    expect(
      await inTx(venue(), (tx) =>
        tx.select().from(billAdvances).where(eq(billAdvances.advanceSaleId, advanceId)),
      ),
    ).toEqual(advanceRow);
    expect(await tendersOf(advanceId)).toEqual([{ amount: 2000, tip: 0 }]);
    expect(await tendersOf(final)).toEqual([{ amount: 5200, tip: 0 }]);
  });

  it("mixed rates taken away, reopened twice with 10.00 paid between: each receipt is X's, the final takes 10.00 and 40.00, and the records add up to the meal", async () => {
    const x = await seatedTakeaway("Salad bowl", "Wine case");
    const advanceId = await advance(x, "50.00");
    const xReceipt = await print(x);
    expect(recordOf(advanceId)).toEqual({
      total: "50.00",
      breakdown: [["10.00", "45.45", "4.55"]],
    });
    expect(recordOf(xReceipt)).toEqual(MIXED_RECEIPT);

    const y = await reopen(x);

    expect(recordOf(y.correctiveId)).toEqual({
      total: "-50.00",
      breakdown: [
        ["10.00", "27.27", "2.73"],
        ["21.00", "-66.12", "-13.88"],
      ],
    });
    expect(await balanceOf(y.billId)).toMatchObject({ received: "50.00", outstanding: "50.00" });
    const yReceipt = await print(y.billId);
    expect(recordOf(yReceipt)).toEqual(MIXED_RECEIPT);
    await fixture.payInCash(venue(), y.billId, "10.00");

    const z = await reopen(y.billId);

    expect(await balanceOf(z.billId)).toMatchObject({ received: "60.00", outstanding: "40.00" });
    const zReceipt = await print(z.billId);
    expect(recordOf(zReceipt)).toEqual(MIXED_RECEIPT);
    expect(await takenOffBy(advanceId)).toEqual([zReceipt]);
    expect(await payRestOf(z.billId, "40.00")).toBe(zReceipt);
    expect(await tendersOf(advanceId)).toEqual([{ amount: 5000, tip: 0 }]);
    expect(await tendersOf(zReceipt)).toEqual([
      { amount: 1000, tip: 0 },
      { amount: 4000, tip: 0 },
    ]);
    expect(await tendersOf(xReceipt)).toEqual([]);
    expect(await tendersOf(yReceipt)).toEqual([]);
    expect(
      sumOfRecords([advanceId, xReceipt, y.correctiveId, yReceipt, z.correctiveId, zReceipt]),
    ).toEqual([
      ["10.00", "18.18", "1.82"],
      ["21.00", "66.12", "13.88"],
    ]);
  });

  it("the printed bill shows no money once reopened, and its receipt reprints the advance at −50.00", async () => {
    const x = await seatedTakeaway("Salad bowl", "Wine case");
    const advanceId = await advance(x, "50.00");
    const xReceipt = await print(x);

    const y = await reopen(x);

    expect(await statusOf(venue(), x)).toBe("abandoned");
    expect(await paymentRows(venue(), x)).toEqual([]);
    expect(await inTx(venue(), (tx) => readBillAdvances(tx, [x]))).toEqual({
      credits: new Map(),
      payments: new Map(),
    });
    expect((await paymentRows(venue(), y.billId)).map((row) => row.id)).toEqual([
      await paymentOf(advanceId),
    ]);
    const words = await caption(advanceId);
    const lines = printed(await readTicket(xReceipt), true);
    expect(lines.filter((line) => line.includes(words))).toEqual([
      expect.stringMatching(new RegExp(`^1 .*-50,00`)),
    ]);
  });

  it("a second advance taken on the reopened bill: each receipt takes both off, and only the last receipt counts as having taken them off", async () => {
    const x = await seated("Tasting menu");
    const first = await advance(x, "30.00");
    const xReceipt = await print(x);
    expect(recordOf(xReceipt)).toEqual({ total: "90.00", breakdown: [["10.00", "81.82", "8.18"]] });
    expect(await takenOffBy(first)).toEqual([xReceipt]);
    const y = await reopen(x);
    expect(await takenOffBy(first)).toEqual([undefined]);

    const second = await advance(y.billId, "10.00");

    expect(await balanceOf(y.billId)).toMatchObject({ received: "40.00", outstanding: "80.00" });
    const yReceipt = await print(y.billId);
    expect(recordOf(yReceipt)).toEqual({ total: "80.00", breakdown: [["10.00", "72.73", "7.27"]] });
    expect(await takenOffBy(first, second)).toEqual([yReceipt, yReceipt]);
    const z = await reopen(y.billId);
    expect(await balanceOf(z.billId)).toMatchObject({ received: "40.00", outstanding: "80.00" });
    expect(await takenOffBy(first, second)).toEqual([undefined, undefined]);
    const zReceipt = await print(z.billId);
    expect(recordOf(zReceipt)).toEqual({ total: "80.00", breakdown: [["10.00", "72.73", "7.27"]] });
    expect(
      await inTx(venue(), (tx) =>
        tx
          .select({ deducts: saleLines.deductsSaleId, gross: saleLines.lineGross })
          .from(saleLines)
          .where(and(eq(saleLines.saleId, zReceipt), eq(saleLines.advanceRole, "deduction")))
          .orderBy(saleLines.lineNo),
      ),
    ).toEqual([
      { deducts: first, gross: -3000 },
      { deducts: second, gross: -1000 },
    ]);
    expect(await takenOffBy(first, second)).toEqual([zReceipt, zReceipt]);
  });

  it("a hand-keyed card advance moves its payment and leaves its provider row on the advance's sale", async () => {
    const x = await seated("Grill for two");
    const { paymentId, advanceId } = await cardAdvance(x);
    const providerRow = () =>
      inTx(venue(), (tx) =>
        tx
          .select({ workingOrderId: payments.workingOrderId, saleId: payments.saleId })
          .from(payments)
          .where(eq(payments.billPaymentId, paymentId)),
      );
    expect(await providerRow()).toEqual([{ workingOrderId: x, saleId: advanceId }]);
    await print(x);

    const y = await reopen(x);

    expect((await paymentRows(venue(), y.billId)).map((row) => row.id)).toEqual([paymentId]);
    expect(await providerRow()).toEqual([{ workingOrderId: x, saleId: advanceId }]);
    await payRestOf(y.billId, "52.00");
    expect(await providerRow()).toEqual([{ workingOrderId: x, saleId: advanceId }]);
  });

  it("a tip on the advance: the reopened bill counts the advance's applied money, and the tip stays on the advance's tender", async () => {
    const x = await seated("Grill for two");
    const paid = await cash(x, "20.00", {
      tendered: "22.00",
      addedTip: "2.00",
      applied: "20.00",
      tip: "2.00",
      ownReceipt: true,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const advanceId = await paymentAdvance((paid.json.payment as { id: string }).id);
    await print(x);

    const y = await reopen(x);

    expect(await balanceOf(y.billId)).toMatchObject({ received: "20.00", outstanding: "52.00" });
    const final = await payRestOf(y.billId, "52.00");
    expect(recordOf(final)).toEqual({ total: "52.00", breakdown: [["10.00", "47.27", "4.73"]] });
    expect(await tendersOf(advanceId)).toEqual([{ amount: 2200, tip: 200 }]);
  });

  it("a resend of the advance's payment to the printed bill answers the reopened bill and issues no second advance", async () => {
    const x = await seated("Grill for two");
    const body = { submissionId: randomUUID(), ownReceipt: true };
    const first = await cash(x, "20.00", body);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    await print(x);
    const y = await reopen(x);
    const salesBefore = await inTx(venue(), (tx) => tx.select({ id: sales.id }).from(sales));

    const again = await cash(x, "20.00", body);

    expect(again.status, JSON.stringify(again.json)).toBe(200);
    expect(again.json).toMatchObject({
      outcome: "received",
      payment: { id: (first.json.payment as { id: string }).id, applied: "20.00" },
      balance: { workingOrderId: y.billId, received: "20.00", outstanding: "52.00" },
    });
    expect(await inTx(venue(), (tx) => tx.select({ id: sales.id }).from(sales))).toEqual(
      salesBefore,
    );
    expect(
      await inTx(venue(), (tx) =>
        tx
          .select({ id: billAdvances.id })
          .from(billAdvances)
          .where(eq(billAdvances.workingOrderId, x)),
      ),
    ).toHaveLength(1);
  });

  it("a correction opened on the advance once its receipt was reopened holds the reopened bill's payment", async () => {
    const x = await seated("Grill for two");
    const advanceId = await advance(x, "20.00");
    await print(x);
    const y = await reopen(x);

    const opened = await openCorrection(advanceId);

    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    const refused = await cash(y.billId, "52.00");
    expect({ status: refused.status, code: refused.json.code }).toEqual({
      status: 409,
      code: "advance.correction_open",
    });
    expect(refused.json.params).toMatchObject({ workingOrderId: y.billId, saleId: advanceId });
  });

  it("a card taken on the reopened bill while a correction of the advance opens: closing the correction issues the reopened bill's receipt", async () => {
    const x = await seated("Grill for two");
    const advanceId = await advance(x, "20.00");
    await print(x);
    const y = await reopen(x);
    const release = venue().card.holdNextCollect();
    const calls = venue().card.collectCalls.length;
    const paying = cash(y.billId, "52.00", {
      method: "card",
      entry: "reader",
      tendered: undefined,
    });
    await vi.waitFor(() => expect(venue().card.collectCalls.length).toBe(calls + 1));
    const opened = await openCorrection(advanceId);
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    release();
    expect((await paying).status).toBe(200);
    expect(await statusOf(venue(), y.billId)).toBe("open");

    const closed = await send(
      venue().app,
      venue().cookie,
      "POST",
      `/api/invoice-corrections/${(opened.json.correction as { id: string }).id}/close`,
      { override: supervisor() },
    );

    expect(closed, JSON.stringify(closed.json)).toMatchObject({
      status: 200,
      json: { state: "discarded" },
    });
    expect(await statusOf(venue(), y.billId)).toBe("settled");
    expect(recordOf((await fixture.invoiceOf(venue(), y.billId)).id)).toEqual({
      total: "52.00",
      breakdown: [["10.00", "47.27", "4.73"]],
    });
  });

  it("a card refund of the advance still pending refuses bill.refund_in_progress, writing nothing", async () => {
    const x = await seated("Grill for two");
    const { paymentId, advanceId } = await cardAdvance(x);
    await print(x);
    const [tender] = await inTx(venue(), (tx) =>
      tx.select({ id: tenders.id }).from(tenders).where(eq(tenders.saleId, advanceId)),
    );
    await inTx(venue(), (tx) =>
      tx.insert(refunds).values({
        saleId: advanceId,
        tenderId: tender!.id,
        ...billRefundFields(tx, venue().cfg.nodeId, paymentId),
        submissionId: randomUUID(),
        fingerprint: "pending advance refund",
        appliedAmount: 500,
        reason: "error",
        authorizedBy: venue().adminId,
        requestedBy: venue().adminId,
        source: venue().cfg.origin.source,
        deviceId: venue().cfg.origin.deviceId,
        state: "pending",
      }),
    );

    const refused = await fixture.expectRefused(
      venue(),
      x,
      () => fixture.split(venue(), x, venue().cookie),
      { status: 409, code: "bill.refund_in_progress" },
    );

    expect(refused.json.params).toEqual({ workingOrderId: x });
    expect(
      await inTx(venue(), (tx) =>
        tx
          .select({ bill: billPayments.workingOrderId })
          .from(billPayments)
          .where(inArray(billPayments.id, [paymentId])),
      ),
    ).toEqual([{ bill: x }]);
  });
});
