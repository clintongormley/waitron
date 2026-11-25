import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billAdvances,
  billPayments,
  floorZones,
  refunds,
  saleLines,
  sales,
  tenders,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { loginWithPin } from "@waitron/identity";
import { setProfileServiceAccess } from "@waitron/venue-service";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { payments } from "@waitron/payments";
import { addDecimal, decimal } from "@waitron/shared";
import { filedInvoicesOf } from "@waitron/fiscal-verifactu/test/invoice-records.js";
import { advancesTakenOff } from "./advance-taken-off.js";
import { readBillAdvances } from "./bill-advances.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { resolveTransactionScope } from "./find-bill-transactions.js";
import type { GiveBackPlan, GiveBackRequest } from "./give-back-plan.js";
import {
  advanceBills,
  printed,
  provisionAdvanceVenue,
  type AdvanceVenue,
} from "./testing/advance-bills.js";
import { billRefundFields } from "./testing/bill-payment-fixture.js";
import { inTx, paymentRows, send, statusOf } from "./testing/bill-venue.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { BASIC_ACTIONS } from "./testing/session-device.js";
import { SESSION_COOKIE } from "./till-session.js";
import * as fixture from "./testing/split-after-print-fixture.js";
import "./errors.js";

// Reopen bill on a printed bill part of which was paid as an advance (a part payment on the
// payer's own receipt): the advance's payment moves to the reopened bill and counts there, against
// a venue that files real Veri*Factu records. Each case's bill is at a table of its own.
let advanceVenue: AdvanceVenue;
/** A till of its own, signed in by the waiter, whose profile serves only the venue's zone. */
let zonedTill: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    advanceVenue = await provisionAdvanceVenue(db);
    // Print the bill prints on the till's receipt printer, which the venue's till profile allows.
    db.run(sql`update device_profiles set capabilities = json_insert(capabilities, '$[#]', 'print-receipt')
      where name = 'Counter till'`);
    const profileId = await withTransaction(db, async (tx) => {
      const [profile] = await seedDeviceProfiles(tx, {
        name: "Zoned till",
        formFactor: "till",
        capabilities: [...BASIC_ACTIONS, "open-cash-drawer", "take-cash"],
      });
      const [zone] = await tx
        .select({ departmentId: floorZones.departmentId })
        .from(floorZones)
        .where(eq(floorZones.id, advanceVenue.venue.zoneId));
      await setProfileServiceAccess(tx, profile!.id, {
        departmentId: zone!.departmentId,
        allowedZoneIds: [advanceVenue.venue.zoneId],
        startingZoneId: advanceVenue.venue.zoneId,
      });
      return profile!.id;
    });
    const device = await enrolDeviceForTest(db, advanceVenue.venue.cfg, {
      name: "Zoned till",
      profileId,
    });
    const session = await withTransaction(db, (tx) =>
      loginWithPin(tx, {
        deviceId: device.deviceId,
        personId: advanceVenue.venue.operatorId,
        pin: "5555",
      }),
    );
    zonedTill = `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
  },
});

const venue = () => advanceVenue.venue;
const supervisor = () => ({ personId: venue().adminId, pin: "1234" });
const { seated, seatedTakeaway, cash, advance, advanceFacts, caption, readTicket } = advanceBills(
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

const giveBackPreview = (saleId: string, request: GiveBackRequest, cookie = venue().cookie) =>
  send(venue().app, cookie, "POST", `/api/transactions/${saleId}/give-back/preview`, request);

/** Gives `amount` of `saleId` back as goodwill through Give money back, in cash or on the card
 * tender `way`, as its preview answers; the write's answer. */
async function giveBack(saleId: string, amount: string, cookie = venue().cookie, way = "cash") {
  const request: GiveBackRequest = { purpose: "goodwill", amount, extra: "0.00", way };
  const shown = await giveBackPreview(saleId, request, cookie);
  expect(shown.status, JSON.stringify(shown.json)).toBe(200);
  const [reason] = await inTx(venue(), (tx) => listAdjustmentReasons(tx));
  return send(venue().app, cookie, "POST", `/api/transactions/${saleId}/give-back`, {
    ...request,
    reasonId: reason!.id,
    note: "Money given back",
    expected: (shown.json as unknown as GiveBackPlan).parts,
    submissionIds: {
      refund: randomUUID(),
      extra: randomUUID(),
      correction: randomUUID(),
      leg: randomUUID(),
    },
    override: supervisor(),
  });
}

/** Gives `amount` of `saleId` back and answers the corrective it filed. */
async function givenBack(saleId: string, amount: string, cookie = venue().cookie) {
  const given = await giveBack(saleId, amount, cookie);
  expect(given.status, JSON.stringify(given.json)).toBe(200);
  return (await correctivesOf(saleId)).at(-1)!;
}

async function correctivesOf(saleId: string): Promise<string[]> {
  const rows = await inTx(venue(), (tx) =>
    tx
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.correctsSaleId, saleId))
      .orderBy(sql`${sales}.rowid`),
  );
  return rows.map((row) => row.id);
}

function refundsOf(saleId: string) {
  return inTx(venue(), (tx) =>
    tx
      .select({ state: refunds.state, appliedAmount: refunds.appliedAmount })
      .from(refunds)
      .where(eq(refunds.saleId, saleId)),
  );
}

async function tenderIdOf(saleId: string): Promise<string> {
  const [tender] = await inTx(venue(), (tx) =>
    tx.select({ id: tenders.id }).from(tenders).where(eq(tenders.saleId, saleId)),
  );
  return tender!.id;
}

/** Refund a payment on the advance's own ticket, for `amount` of its tender. */
async function plainRefund(advanceId: string, amount: string) {
  return send(venue().app, venue().cookie, "POST", `/api/transactions/${advanceId}/refunds`, {
    submissionId: randomUUID(),
    tenderId: await tenderIdOf(advanceId),
    appliedAmount: amount,
    tipAmount: "0.00",
    reason: "Paid too much",
    override: supervisor(),
  });
}

const correctionPreview = (saleId: string, gross: string) =>
  send(venue().app, venue().cookie, "POST", `/api/transactions/${saleId}/corrections/preview`, {
    gross,
  });

/** `advance.taken_off_final_invoice` naming the receipt `finalSaleId`, still unsettled, whose bill
 * is reopened before the advance's money goes back. */
async function reopenFirst(advanceId: string, finalSaleId: string, finalMoneyLeft = "0.00") {
  return {
    code: "advance.taken_off_final_invoice",
    params: {
      saleId: advanceId,
      finalSaleId,
      invoiceNumber: (await advanceFacts(finalSaleId)).invoiceNumber,
      finalMoneyLeft,
      reopenBill: true,
    },
  };
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
    expect(await inTx(venue(), (tx) => resolveTransactionScope(tx, advanceId))).toEqual({
      workingOrderIds: [y.billId],
    });
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

describe("Giving back an advance on a bill printed, or reopened, after it was taken", () => {
  it("before printing, the whole 20.00 given back: the bill counts nothing and its receipt files 72.00", async () => {
    const x = await seated("Grill for two");
    const advanceId = await advance(x, "20.00");

    const corrective = await givenBack(advanceId, "20.00");

    expect(recordOf(corrective)).toEqual({
      total: "-20.00",
      breakdown: [["10.00", "-18.18", "-1.82"]],
    });
    expect(await balanceOf(x)).toMatchObject({ received: "0.00", outstanding: "72.00" });
    const xReceipt = await print(x);
    expect(recordOf(xReceipt)).toEqual({ total: "72.00", breakdown: [["10.00", "65.45", "6.55"]] });
  });

  it("before printing, 10.00 of a 30.00 advance given back: the bill counts 20.00 and its receipt files 100.00", async () => {
    const x = await seated("Tasting menu");
    const advanceId = await advance(x, "30.00");

    const corrective = await givenBack(advanceId, "10.00");

    expect(recordOf(corrective)).toEqual({
      total: "-10.00",
      breakdown: [["10.00", "-9.09", "-0.91"]],
    });
    expect(await balanceOf(x)).toMatchObject({ received: "20.00", outstanding: "100.00" });
    const xReceipt = await print(x);
    expect(recordOf(xReceipt)).toEqual({
      total: "100.00",
      breakdown: [["10.00", "90.91", "9.09"]],
    });
  });

  it("on the reopened bill, 10.00 of a 30.00 advance given back: it counts 20.00, its receipt files 100.00 and the records add up to the meal", async () => {
    const x = await seated("Tasting menu");
    const advanceId = await advance(x, "30.00");
    const xReceipt = await print(x);
    const y = await reopen(x);

    const corrective = await givenBack(advanceId, "10.00");

    expect(recordOf(corrective)).toEqual({
      total: "-10.00",
      breakdown: [["10.00", "-9.09", "-0.91"]],
    });
    expect(await refundsOf(advanceId)).toEqual([{ state: "completed", appliedAmount: 1000 }]);
    expect(await balanceOf(y.billId)).toMatchObject({ received: "20.00", outstanding: "100.00" });
    const final = await payRestOf(y.billId, "100.00");
    expect(recordOf(final)).toEqual({ total: "100.00", breakdown: [["10.00", "90.91", "9.09"]] });
    expect(sumOfRecords([advanceId, corrective, xReceipt, y.correctiveId, final])).toEqual([
      ["10.00", "109.09", "10.91"],
    ]);
  });

  it("on the reopened bill, the whole 30.00 given back: it counts nothing and its receipt files 120.00", async () => {
    const x = await seated("Tasting menu");
    const advanceId = await advance(x, "30.00");
    await print(x);
    const y = await reopen(x);

    const corrective = await givenBack(advanceId, "30.00");

    expect(recordOf(corrective)).toEqual({
      total: "-30.00",
      breakdown: [["10.00", "-27.27", "-2.73"]],
    });
    expect(await balanceOf(y.billId)).toMatchObject({ received: "0.00", outstanding: "120.00" });
    const final = await payRestOf(y.billId, "120.00");
    expect(recordOf(final)).toEqual({
      total: "120.00",
      breakdown: [["10.00", "109.09", "10.91"]],
    });
  });

  it("mixed rates taken away, 20.00 of the 50.00 advance given back on the reopened bill, then reopened again: it counts 30.00 and each receipt files 70.00", async () => {
    const x = await seatedTakeaway("Salad bowl", "Wine case");
    const advanceId = await advance(x, "50.00");
    const xReceipt = await print(x);
    const y = await reopen(x);

    const corrective = await givenBack(advanceId, "20.00");

    expect(recordOf(corrective)).toEqual({
      total: "-20.00",
      breakdown: [["10.00", "-18.18", "-1.82"]],
    });
    expect(await balanceOf(y.billId)).toMatchObject({ received: "30.00", outstanding: "70.00" });
    const seventy = {
      total: "70.00",
      breakdown: [
        ["10.00", "-9.09", "-0.91"],
        ["21.00", "66.12", "13.88"],
      ],
    };
    const yReceipt = await print(y.billId);
    expect(recordOf(yReceipt)).toEqual(seventy);
    const z = await reopen(y.billId);
    expect(await balanceOf(z.billId)).toMatchObject({ received: "30.00", outstanding: "70.00" });
    const zReceipt = await print(z.billId);
    expect(recordOf(zReceipt)).toEqual(seventy);
    expect(
      sumOfRecords([
        advanceId,
        corrective,
        xReceipt,
        y.correctiveId,
        yReceipt,
        z.correctiveId,
        zReceipt,
      ]),
    ).toEqual([
      ["10.00", "18.18", "1.82"],
      ["21.00", "66.12", "13.88"],
    ]);
  });

  it("Correct invoice on the advance is refused on the printed bill, allowed once it is reopened, and refused once the reopened bill is printed, naming its receipt", async () => {
    const x = await seated("Grill for two");
    const advanceId = await advance(x, "20.00");
    const xReceipt = await print(x);

    const onX = await correctionPreview(advanceId, "20.00");

    expect(onX.status, JSON.stringify(onX.json)).toBe(409);
    expect(onX.json).toEqual(await reopenFirst(advanceId, xReceipt));
    const y = await reopen(x);
    const onY = await correctionPreview(advanceId, "20.00");
    expect(onY.status, JSON.stringify(onY.json)).toBe(200);
    const yReceipt = await print(y.billId);
    const printedY = await correctionPreview(advanceId, "20.00");
    expect(printedY.status, JSON.stringify(printedY.json)).toBe(409);
    expect(printedY.json).toEqual(await reopenFirst(advanceId, yReceipt));
    expect(await correctivesOf(advanceId)).toEqual([]);
  });

  it("on the reopened bill, Refund a payment on the advance answers tender.refund_of_advance and a bill refund of its payment bill.refund_of_advance, giving nothing back", async () => {
    const x = await seated("Grill for two");
    const advanceId = await advance(x, "20.00");
    await print(x);
    const y = await reopen(x);
    const paymentId = await paymentOf(advanceId);
    const invoiceNumber = (await advanceFacts(advanceId)).invoiceNumber;

    const plain = await plainRefund(advanceId, "20.00");
    const bill = await send(
      venue().app,
      venue().cookie,
      "POST",
      `/api/working-orders/${y.billId}/payments/${paymentId}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "20.00",
        tipAmount: "0.00",
        reason: "Paid too much",
        override: supervisor(),
      },
    );

    expect({ status: plain.status, json: plain.json }).toEqual({
      status: 409,
      json: {
        code: "tender.refund_of_advance",
        params: { tenderId: await tenderIdOf(advanceId), saleId: advanceId, invoiceNumber },
      },
    });
    expect({ status: bill.status, json: bill.json }).toEqual({
      status: 409,
      json: {
        code: "bill.refund_of_advance",
        params: { paymentId, saleId: advanceId, invoiceNumber },
      },
    });
    expect(await refundsOf(advanceId)).toEqual([]);
    expect(await balanceOf(y.billId)).toMatchObject({ received: "20.00", outstanding: "52.00" });
  });

  it("RA-D4: on the printed unpaid bill the advance is not given back, so staff reopen the bill, give it back there and the receipt files the whole 72.00", async () => {
    const x = await seated("Grill for two");
    const advanceId = await advance(x, "20.00");
    const xReceipt = await print(x);
    const refusal = await reopenFirst(advanceId, xReceipt);
    const request: GiveBackRequest = {
      purpose: "goodwill",
      amount: "20.00",
      extra: "0.00",
      way: "cash",
    };

    const plain = await plainRefund(advanceId, "20.00");
    const previewed = await giveBackPreview(advanceId, request);
    const view = await send(
      venue().app,
      venue().cookie,
      "GET",
      `/api/transactions/${advanceId}/give-back`,
    );

    for (const refused of [plain, previewed]) {
      expect(refused.status, JSON.stringify(refused.json)).toBe(409);
      expect(refused.json).toEqual(refusal);
    }
    expect(view.json).toMatchObject({
      choices: { goodwill: { available: false, reason: refusal } },
    });
    expect(await refundsOf(advanceId)).toEqual([]);
    expect(await balanceOf(x)).toMatchObject({ received: "20.00", outstanding: "52.00" });

    const y = await reopen(x);
    const corrective = await givenBack(advanceId, "20.00");

    expect(recordOf(corrective)).toEqual({
      total: "-20.00",
      breakdown: [["10.00", "-18.18", "-1.82"]],
    });
    expect(await refundsOf(advanceId)).toEqual([{ state: "completed", appliedAmount: 2000 }]);
    expect(await balanceOf(y.billId)).toMatchObject({ received: "0.00", outstanding: "72.00" });
    const yReceipt = await print(y.billId);
    expect(recordOf(yReceipt)).toEqual({ total: "72.00", breakdown: [["10.00", "65.45", "6.55"]] });
  });

  it("RA-D4 on a part-paid printed bill: Refund a payment on the advance says to reopen the bill, naming what was paid on it", async () => {
    const x = await seated("Grill for two");
    const advanceId = await advance(x, "20.00");
    const xReceipt = await print(x);
    expect((await cash(x, "10.00")).status).toBe(200);

    const refused = await plainRefund(advanceId, "20.00");

    expect(refused.status, JSON.stringify(refused.json)).toBe(409);
    expect(refused.json).toEqual(await reopenFirst(advanceId, xReceipt, "10.00"));
    expect(await refundsOf(advanceId)).toEqual([]);
  });

  /** Records that the party of the printed bill `billId` left without paying. */
  async function leftUnpaid(billId: string): Promise<void> {
    const { partyId } = await partyOf(billId);
    const [party] = venue().db.all<{ revision: number }>(
      sql`select revision from parties where id = ${partyId}`,
    );
    const left = await send(
      venue().app,
      venue().cookie,
      "POST",
      `/api/parties/${partyId}/unpaid-departure`,
      {
        billId,
        expectedPartyRevision: party!.revision,
        reason: "Left without paying",
        override: supervisor(),
      },
    );
    expect(left.status, JSON.stringify(left.json)).toBe(200);
  }

  it("a printed bill its party left unpaid cannot be reopened, so Refund a payment still gives the advance back plainly", async () => {
    const x = await seated("Grill for two");
    const advanceId = await advance(x, "20.00");
    await print(x);
    await leftUnpaid(x);

    const given = await plainRefund(advanceId, "20.00");

    expect(given.status, JSON.stringify(given.json)).toBe(200);
    expect(await refundsOf(advanceId)).toEqual([{ state: "completed", appliedAmount: 2000 }]);
  });

  it("a part-paid printed bill its party left unpaid: Refund a payment on the advance waits until the receipt is fully paid, as before", async () => {
    const x = await seated("Grill for two");
    const advanceId = await advance(x, "20.00");
    const xReceipt = await print(x);
    expect((await cash(x, "10.00")).status).toBe(200);
    await leftUnpaid(x);

    const refused = await plainRefund(advanceId, "20.00");

    expect(refused.status, JSON.stringify(refused.json)).toBe(409);
    expect(refused.json).toEqual({
      code: "advance.taken_off_final_invoice",
      params: {
        saleId: advanceId,
        finalSaleId: xReceipt,
        invoiceNumber: (await advanceFacts(xReceipt)).invoiceNumber,
        finalMoneyLeft: "10.00",
        finalNotFullyPaid: true,
      },
    });
    expect(await refundsOf(advanceId)).toEqual([]);
  });

  it("a printed bill away from a table cannot be reopened, so Refund a payment still gives the advance back plainly", async () => {
    const x = await seated("Grill for two");
    const advanceId = await advance(x, "20.00");
    await print(x);
    // A bill with no party, as a counter order is; this venue sells at its tables only.
    venue().db.run(
      sql`update working_orders set party_id = null, bill_number = null where id = ${x}`,
    );

    const given = await plainRefund(advanceId, "20.00");

    expect(given.status, JSON.stringify(given.json)).toBe(200);
    expect(await refundsOf(advanceId)).toEqual([{ state: "completed", appliedAmount: 2000 }]);
  });

  it("on the reopened bill the advance is given back from the bill's payments and from its own ticket found in Find a bill, by a till that serves only the bill's zone", async () => {
    const x = await seated("Tasting menu");
    const advanceId = await advance(x, "30.00");
    await print(x);
    const y = await reopen(x);

    const payments = await send(
      venue().app,
      venue().cookie,
      "GET",
      `/api/working-orders/${y.billId}/payments`,
    );
    expect(payments.status, JSON.stringify(payments.json)).toBe(200);
    const fromBill = (payments.json as { payments: { saleId?: string }[] }).payments[0]!.saleId!;
    expect(fromBill).toBe(advanceId);
    await givenBack(fromBill, "10.00");
    expect(await balanceOf(y.billId)).toMatchObject({ received: "20.00", outstanding: "100.00" });

    const { invoiceNumber } = await advanceFacts(advanceId);
    const found = await send(
      venue().app,
      zonedTill,
      "GET",
      `/api/transactions?q=${encodeURIComponent(invoiceNumber)}`,
    );
    expect(found.status, JSON.stringify(found.json)).toBe(200);
    const row = (found.json as { rows: { saleId: string; scopeOrderIds: string[] }[] }).rows.find(
      (r) => r.saleId === advanceId,
    );
    expect(row).toMatchObject({ scopeOrderIds: [y.billId] });
    await givenBack(row!.saleId, "20.00", zonedTill);

    expect(await balanceOf(y.billId)).toMatchObject({ received: "0.00", outstanding: "120.00" });
    expect(await correctivesOf(advanceId)).toHaveLength(2);
  });

  it("a card-reader advance given back on the reopened bill reaches the provider with the card payment's own reference", async () => {
    const x = await seated("Grill for two");
    const paid = await cash(x, "20.00", {
      method: "card",
      entry: "reader",
      tendered: undefined,
      ownReceipt: true,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const paymentId = (paid.json.payment as { id: string }).id;
    const advanceId = await paymentAdvance(paymentId);
    const [card] = await inTx(venue(), (tx) =>
      tx
        .select({ ref: sql<string>`coalesce(${payments.externalRef}, ${payments.paymentRef})` })
        .from(payments)
        .where(eq(payments.billPaymentId, paymentId)),
    );
    await print(x);
    const y = await reopen(x);
    const calls = venue().card.refundCalls.length;

    const given = await giveBack(advanceId, "20.00", venue().cookie, await tenderIdOf(advanceId));

    expect(given.status, JSON.stringify(given.json)).toBe(200);
    expect(
      venue()
        .card.refundCalls.slice(calls)
        .map((call) => ({ processorRef: call.processorRef, amount: String(call.amount) })),
    ).toEqual([{ processorRef: card!.ref, amount: "20.00" }]);
    expect(await balanceOf(y.billId)).toMatchObject({ received: "0.00", outstanding: "72.00" });
  });
});
