import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billAdvances,
  billPaymentRefunds,
  invoiceCorrections,
  invoiceSeries,
  parties,
  saleLines,
  sales,
  tenderRefunds,
  tenders,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { createCategory, createProduct } from "@waitron/menu";
import { payments } from "@waitron/payments";
import { formatInvoiceNumber } from "@waitron/core";
import { readBillEditState } from "./bill-editing.js";
import { readBillBalance } from "./bill-payments.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { endMeal } from "./meal-end.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { gateSeatOnStartClock } from "./start-clock-gate.js";
import { readOrderRevision } from "./working-order.js";
import { createTable } from "./testing/live-table.js";
import { fireAll, openPartyTab } from "./testing/serve-line.js";
import { offerProducts } from "./testing/zone-offers.js";
import { setOrderInvoiceChoice } from "./testing/order-writer-fixture.js";
import { finishTable } from "./testing/party-close-fixture.js";
import { RECIPIENT } from "./testing/deferred-close-fixture.js";
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

// The money a bill holds once an advance was taken on it, and the cards that paid advances, driven
// through the till's routes against a venue that files real Veri*Factu records. Each case's bill is
// at a table of its own.
let venue: BillVenue;
let offerFor: (name: string) => string;

const DISHES: { name: string; price: string }[] = [
  { name: "Tasting menu", price: "120.00" },
  { name: "Side dish", price: "10.00" },
  { name: "Starter plate", price: "11.00" },
];

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    const ids = new Map<string, string>();
    const offers = await inTx(venue, async (tx) => {
      const category = await createCategory(tx, { name: "Advance money dishes" });
      for (const dish of DISHES) {
        const product = await createProduct(tx, {
          categoryId: category.id,
          name: dish.name,
          customerName: { es: `${dish.name} (customer)` },
          kitchenName: dish.name.toUpperCase(),
          pricingUnit: "each",
          unitPrice: dish.price,
          vatClass: "reduced",
        });
        ids.set(dish.name, product.id);
      }
      return offerProducts(tx, venue.cfg, { zone: { zoneId: venue.zoneId }, orderStart: "table" });
    });
    offerFor = (name) => offers.offerFor(ids.get(name)!);
  },
});

type Bill = { billId: string; partyId: string };

/** A party at a fresh table whose bill carries one line per named dish, its dishes sent. */
async function seated(...names: string[]): Promise<Bill> {
  return withTransaction(venue.db, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `M-${randomUUID().slice(0, 8)}`,
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

function pay(billId: string, body: Record<string, unknown>): Promise<Answer> {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    tip: "0.00",
    ...body,
  });
}

function cash(billId: string, amount: string, extra: Record<string, unknown> = {}) {
  return pay(billId, { amount, method: "cash", tendered: amount, applied: amount, ...extra });
}

function readerCard(billId: string, amount: string, extra: Record<string, unknown> = {}) {
  return pay(billId, { amount, method: "card", entry: "reader", applied: amount, ...extra });
}

const settle = () =>
  settlePendingBillPayments({
    admission: testTradingAdmission(),
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
    cfg: venue.cfg,
  });

/** The bill's one advance's sale id, once `paid` answered. */
async function advanceOf(billId: string, paid: Answer): Promise<string> {
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  const rows = await inTx(venue, (tx) =>
    tx.select().from(billAdvances).where(eq(billAdvances.workingOrderId, billId)),
  );
  expect(rows).toHaveLength(1);
  return rows[0]!.advanceSaleId;
}

async function restOf(billId: string) {
  const rows = await inTx(venue, (tx) =>
    tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
  );
  expect(rows.length).toBeLessThanOrEqual(1);
  return rows[0];
}

/** The sale each of the bill's card payments is linked to, oldest payment first. */
async function cardSalesOf(billId: string): Promise<(string | null)[]> {
  const rows = await paymentRows(venue, billId);
  return inTx(venue, async (tx) => {
    const linked: (string | null)[] = [];
    for (const row of rows) {
      const [card] = await tx
        .select({ saleId: payments.saleId })
        .from(payments)
        .where(eq(payments.billPaymentId, row.id));
      linked.push(card?.saleId ?? null);
    }
    return linked;
  });
}

const supervisor = () => ({ personId: venue.adminId, pin: "1234" });

/** Corrects the advance `saleId` by `gross` at 10% through Correct invoice, giving it back in cash. */
async function correctAdvance(
  saleId: string,
  gross: string,
  split: { base: string; tax: string },
): Promise<void> {
  const [reason] = await inTx(venue, (tx) => listAdjustmentReasons(tx));
  const opened = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/transactions/${saleId}/corrections`,
    {
      submissionId: randomUUID(),
      gross,
      reasonId: reason!.id,
      note: "Paid too much",
      expectedSplit: [{ rate: "10.00", ...split }],
      override: supervisor(),
    },
  );
  expect(opened.status, JSON.stringify(opened.json)).toBe(200);
  const correctionId = (opened.json as { correction: { id: string } }).correction.id;
  const filed = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/invoice-corrections/${correctionId}/cash`,
    { submissionId: randomUUID(), amount: gross, override: supervisor() },
  );
  expect(filed.status, JSON.stringify(filed.json)).toBe(200);
  expect(filed.json).toMatchObject({ correction: { state: "filed" } });
}

async function partyRevision(partyId: string): Promise<number> {
  const [row] = await inTx(venue, (tx) =>
    tx.select({ revision: parties.revision }).from(parties).where(eq(parties.id, partyId)),
  );
  return row!.revision;
}

/** Takes the bill's line `name` off it, as the till's cancel does. */
async function removeDish(bill: Bill, name: string): Promise<Answer> {
  const [line] = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(
        and(eq(workingOrderLines.workingOrderId, bill.billId), eq(workingOrderLines.name, name)),
      ),
  );
  const ask = await inTx(venue, async (tx) => ({
    expectedEdit: await readBillEditState(tx, bill.billId),
    expectedPartyRevision: (await tx.select().from(parties).where(eq(parties.id, bill.partyId)))[0]!
      .revision,
    expectedBillRevision: await readOrderRevision(tx, bill.billId),
    expectedContext: await readCancellationContext(tx, bill.partyId, line!.id),
    submissionId: randomUUID(),
  }));
  return send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/parties/${bill.partyId}/lines/${line!.id}/cancel-item`,
    { ...ask, quantity: "1", outcome: "remove_charge" },
  );
}

/** Print the bill, as the till's end of meal does, without waiting for the dishes to be served. */
async function printTheBill(bill: Bill) {
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
      venue.cfg,
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

/** Closes the bill's table, as the till's Finish table does. */
async function closeTable(bill: Bill): Promise<void> {
  await inTx(venue, async (tx) =>
    finishTable(tx, {
      partyId: bill.partyId,
      expectedPartyRevision: (
        await tx.select().from(parties).where(eq(parties.id, bill.partyId))
      )[0]!.revision,
      operatorId: venue.operatorId,
    }),
  );
}

async function statusOf(billId: string): Promise<string> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId)),
  );
  return row!.status;
}

describe("money and cards around an advance", () => {
  it("the bill invariant counts an advance by what is left of it", async () => {
    const bill = await seated("Tasting menu", "Side dish", "Starter plate");
    const advanceId = await advanceOf(
      bill.billId,
      await cash(bill.billId, "30.00", { ownReceipt: true }),
    );
    await correctAdvance(advanceId, "10.00", { base: "9.09", tax: "0.91" });
    // €141 of dishes, €20 left of the advance and €111 paid: €10 is still owed.
    expect((await cash(bill.billId, "111.00")).status).toBe(200);

    const refused = await removeDish(bill, "Starter plate");

    expect(refused.status, JSON.stringify(refused.json)).toBe(409);
    expect(refused.json).toMatchObject({
      code: "bill.received_exceeds_total",
      params: { excess: "1.00" },
    });

    const removed = await removeDish(bill, "Side dish");

    expect(removed.status, JSON.stringify(removed.json)).toBe(200);
    expect(await restOf(bill.billId)).toMatchObject({ total: 11100 });
    expect(await statusOf(bill.billId)).toBe("settled");
  });

  it("card advance, then card payment of the rest: each card is linked to its own invoice", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advanceOf(
      bill.billId,
      await readerCard(bill.billId, "30.00", { ownReceipt: true }),
    );

    const paid = await readerCard(bill.billId, "90.00");

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const rest = await restOf(bill.billId);
    expect(rest).toMatchObject({ total: 9000 });
    expect(await cardSalesOf(bill.billId)).toEqual([advanceId, rest!.id]);
    expect(await statusOf(bill.billId)).toBe("settled");
  });

  it("card advance, then a card for the rest captured and recovered: the recovery issues the rest once and stops", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advanceOf(
      bill.billId,
      await readerCard(bill.billId, "30.00", { ownReceipt: true }),
    );
    venue.card.crashNextCollect("captured");
    expect((await readerCard(bill.billId, "90.00")).status).toBe(500);
    expect(await restOf(bill.billId)).toBeUndefined();

    await settle();
    await settle();

    const rest = await restOf(bill.billId);
    expect(rest).toMatchObject({ total: 9000 });
    expect((await paymentRows(venue, bill.billId)).map((row) => row.state)).toEqual([
      "received",
      "received",
    ]);
    expect(await cardSalesOf(bill.billId)).toEqual([advanceId, rest!.id]);
    expect(await statusOf(bill.billId)).toBe("settled");
  });

  it("card advance, then Print the bill: the advance's card stays on the advance", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advanceOf(
      bill.billId,
      await readerCard(bill.billId, "30.00", { ownReceipt: true }),
    );

    expect(await printTheBill(bill)).toMatchObject({ total: "90.00" });

    const rest = await restOf(bill.billId);
    expect(rest).toMatchObject({ total: 9000 });
    expect(await cardSalesOf(bill.billId)).toEqual([advanceId]);
    const paid = await readerCard(bill.billId, "90.00");
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await cardSalesOf(bill.billId)).toEqual([advanceId, rest!.id]);
    expect(await statusOf(bill.billId)).toBe("settled");
  });

  it("advance refunded by Correct invoice, then the emptied bill closes", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advanceOf(
      bill.billId,
      await cash(bill.billId, "30.00", { ownReceipt: true }),
    );
    await correctAdvance(advanceId, "30.00", { base: "27.27", tax: "2.73" });

    const removed = await removeDish(bill, "Tasting menu");
    expect(removed.status, JSON.stringify(removed.json)).toBe(200);
    await closeTable(bill);

    expect(await statusOf(bill.billId)).toBe("abandoned");
    expect(await restOf(bill.billId)).toBeUndefined();
  });

  it("an advance's tip given back: the table stays open while the tip is held and closes once it is refunded", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advanceOf(
      bill.billId,
      await pay(bill.billId, {
        amount: "30.00",
        method: "cash",
        tendered: "32.00",
        addedTip: "2.00",
        applied: "30.00",
        tip: "2.00",
        ownReceipt: true,
      }),
    );
    await correctAdvance(advanceId, "30.00", { base: "27.27", tax: "2.73" });
    const removed = await removeDish(bill, "Tasting menu");
    expect(removed.status, JSON.stringify(removed.json)).toBe(200);

    await expect(closeTable(bill)).rejects.toMatchObject({ code: "bill.payments_received" });
    expect(await statusOf(bill.billId)).toBe("open");

    const [tender] = await inTx(venue, (tx) =>
      tx.select({ id: tenders.id }).from(tenders).where(eq(tenders.saleId, advanceId)),
    );
    const refunded = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/transactions/${advanceId}/refunds`,
      {
        submissionId: randomUUID(),
        tenderId: tender!.id,
        appliedAmount: "0.00",
        tipAmount: "2.00",
        reason: "Tip given back",
        override: supervisor(),
      },
    );
    expect(refunded.status, JSON.stringify(refunded.json)).toBe(200);
    expect(refunded.json).toMatchObject({ state: "completed" });

    await closeTable(bill);

    expect(await statusOf(bill.billId)).toBe("abandoned");
    expect(await restOf(bill.billId)).toBeUndefined();
  });

  it("a bill refund of an advance's payment is refused, naming the advance's ticket, and an ordinary payment on the bill is still refunded", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advanceOf(
      bill.billId,
      await cash(bill.billId, "30.00", { ownReceipt: true }),
    );
    expect((await cash(bill.billId, "20.00")).status).toBe(200);
    const [advancePayment, ordinary] = await paymentRows(venue, bill.billId);
    const [ticket] = await inTx(venue, (tx) =>
      tx
        .select({ code: invoiceSeries.code, number: sales.invoiceNumber })
        .from(sales)
        .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
        .where(eq(sales.id, advanceId)),
    );
    const refundsOf = () =>
      inTx(venue, async (tx) => ({
        bill: await tx.select().from(billPaymentRefunds),
        tender: await tx.select().from(tenderRefunds).where(eq(tenderRefunds.saleId, advanceId)),
        balance: await readBillBalance(tx, bill.billId),
      }));
    const before = await refundsOf();
    const billRefund = (paymentId: string, amount: string) =>
      send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${bill.billId}/payments/${paymentId}/refunds`,
        {
          submissionId: randomUUID(),
          appliedAmount: amount,
          tipAmount: "0.00",
          reason: "Paid too much",
          override: supervisor(),
        },
      );

    const refused = await billRefund(advancePayment!.id, "30.00");

    expect(refused.status, JSON.stringify(refused.json)).toBe(409);
    expect(refused.json).toEqual({
      code: "bill.refund_of_advance",
      params: {
        paymentId: advancePayment!.id,
        saleId: advanceId,
        invoiceNumber: formatInvoiceNumber(ticket!.code, ticket!.number),
      },
    });
    expect(await refundsOf()).toEqual(before);
    expect(before.balance).toMatchObject({ received: "50.00", outstanding: "70.00" });

    const refunded = await billRefund(ordinary!.id, "20.00");

    expect(refunded.status, JSON.stringify(refunded.json)).toBe(200);
    expect(refunded.json).toMatchObject({
      refund: { paymentId: ordinary!.id, state: "completed", appliedAmount: "20.00" },
      balance: { received: "30.00", outstanding: "90.00" },
    });
  });

  it("an advance paid for dishes, given back through Correct invoice, frees its dishes: one can be taken off and the other paid again by dish", async () => {
    const bill = await seated("Tasting menu", "Side dish", "Starter plate");
    const advanceId = await advanceOf(
      bill.billId,
      await pay(bill.billId, {
        kind: "items",
        lines: [{ lineNo: 2 }, { lineNo: 3 }],
        method: "cash",
        tendered: "21.00",
        applied: "21.00",
        ownReceipt: true,
      }),
    );
    await correctAdvance(advanceId, "21.00", { base: "19.09", tax: "1.91" });

    const removed = await removeDish(bill, "Side dish");
    expect(removed.status, JSON.stringify(removed.json)).toBe(200);

    const paidAgain = await pay(bill.billId, {
      kind: "items",
      lines: [{ lineNo: 3 }],
      method: "cash",
      tendered: "11.00",
      applied: "11.00",
    });
    expect(paidAgain.status, JSON.stringify(paidAgain.json)).toBe(200);
    expect(paidAgain.json).toMatchObject({
      balance: { total: "131.00", received: "11.00", outstanding: "120.00" },
    });
  });

  it("switching the bill between ticket and full invoice after an advance is allowed and changes only the rest's invoice", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advanceOf(
      bill.billId,
      await cash(bill.billId, "30.00", { ownReceipt: true }),
    );
    const advanceBefore = await inTx(venue, (tx) =>
      tx.select().from(sales).where(eq(sales.id, advanceId)),
    );
    const choose = async (choice: {
      invoiceType: "F1" | "F2";
      recipient: typeof RECIPIENT | null;
    }) =>
      setOrderInvoiceChoice(venue.db, venue.backend, venue.cfg, bill.billId, {
        revision: await inTx(venue, (tx) => readOrderRevision(tx, bill.billId)),
        ...choice,
      });

    await choose({ invoiceType: "F1", recipient: RECIPIENT });
    await choose({ invoiceType: "F2", recipient: null });
    const paid = await cash(bill.billId, "90.00");

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const rest = await restOf(bill.billId);
    expect(rest).toMatchObject({ total: 9000, counterpartyTaxId: null });
    expect(
      await inTx(venue, (tx) => tx.select().from(sales).where(eq(sales.id, advanceId))),
    ).toEqual(advanceBefore);
  });
});

describe("a card for the rest while the advance has a correction open", () => {
  /** Opens Correct invoice on the advance `saleId` for its whole €30; the correction's id. */
  async function openWhole(saleId: string): Promise<string> {
    const [reason] = await inTx(venue, (tx) => listAdjustmentReasons(tx));
    const opened = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/transactions/${saleId}/corrections`,
      {
        submissionId: randomUUID(),
        gross: "30.00",
        reasonId: reason!.id,
        note: "Paid too much",
        expectedSplit: [{ rate: "10.00", base: "27.27", tax: "2.73" }],
        override: supervisor(),
      },
    );
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    return (opened.json as { correction: { id: string } }).correction.id;
  }

  it("is refused before the reader when it would pay the bill off", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advanceOf(
      bill.billId,
      await cash(bill.billId, "30.00", { ownReceipt: true }),
    );
    await openWhole(advanceId);

    const paid = await readerCard(bill.billId, "90.00");

    expect(paid.status, JSON.stringify(paid.json)).toBe(409);
    expect(paid.json).toMatchObject({
      code: "advance.correction_open",
      params: { workingOrderId: bill.billId, saleId: advanceId },
    });
    expect(await paymentRows(venue, bill.billId)).toHaveLength(1);
    expect(await restOf(bill.billId)).toBeUndefined();
  });

  it("a dish taken off that would leave the bill paid is refused, and the dish stays", async () => {
    const bill = await seated("Tasting menu", "Side dish");
    const advanceId = await advanceOf(
      bill.billId,
      await cash(bill.billId, "30.00", { ownReceipt: true }),
    );
    expect((await cash(bill.billId, "90.00")).status).toBe(200);
    await openWhole(advanceId);

    const refused = await removeDish(bill, "Side dish");

    expect(refused.status, JSON.stringify(refused.json)).toBe(409);
    expect(refused.json).toMatchObject({
      code: "advance.correction_open",
      params: { workingOrderId: bill.billId, saleId: advanceId },
    });
    expect(await restOf(bill.billId)).toBeUndefined();
    const lines = await inTx(venue, (tx) =>
      tx
        .select({ name: workingOrderLines.name })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, bill.billId)),
    );
    expect(lines.map((line) => line.name).sort()).toEqual(["Side dish", "Tasting menu"]);
  });

  /** Sends `path` on the correction `correctionId` with a supervisor's PIN; the route's answer. */
  async function endCorrection(
    correctionId: string,
    path: "close" | "file" | "cash",
    body: Record<string, unknown> = {},
  ): Promise<Answer> {
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/invoice-corrections/${correctionId}/${path}`,
      { ...body, override: supervisor() },
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    return answer;
  }

  /** The bill is settled, and its rest's invoice takes `cents` off for the advance `advanceId`. */
  async function takesOff(billId: string, advanceId: string, cents: number): Promise<void> {
    const rest = await restOf(billId);
    expect(rest).toBeDefined();
    const deductions = await inTx(venue, (tx) =>
      tx
        .select({ deductsSaleId: saleLines.deductsSaleId, lineGross: saleLines.lineGross })
        .from(saleLines)
        .where(and(eq(saleLines.saleId, rest!.id), eq(saleLines.advanceRole, "deduction"))),
    );
    expect(deductions).toEqual([{ deductsSaleId: advanceId, lineGross: cents }]);
    expect(await statusOf(billId)).toBe("settled");
  }

  it("captured before the correction was opened, is kept on recovery, and Discard then issues the rest's invoice taking the whole €30 off", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advanceOf(
      bill.billId,
      await cash(bill.billId, "30.00", { ownReceipt: true }),
    );
    venue.card.crashNextCollect("captured");
    expect((await readerCard(bill.billId, "90.00")).status).toBe(500);
    const correctionId = await openWhole(advanceId);

    await settle();

    expect((await paymentRows(venue, bill.billId)).map((row) => row.state)).toEqual([
      "received",
      "received",
    ]);
    expect(await restOf(bill.billId)).toBeUndefined();
    expect(await statusOf(bill.billId)).toBe("open");

    expect((await endCorrection(correctionId, "close")).json).toMatchObject({
      state: "discarded",
    });

    await takesOff(bill.billId, advanceId, -3000);
  });

  it("started before the correction was opened, is taken with no invoice, which Discard then issues taking the whole €30 off", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advanceOf(
      bill.billId,
      await cash(bill.billId, "30.00", { ownReceipt: true }),
    );
    const release = venue.card.holdNextCollect();
    const calls = venue.card.collectCalls.length;
    const paying = readerCard(bill.billId, "90.00");
    await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));
    const correctionId = await openWhole(advanceId);
    release();

    expect((await paying).status).toBe(200);
    expect(await restOf(bill.billId)).toBeUndefined();

    expect((await endCorrection(correctionId, "close")).json).toMatchObject({
      state: "discarded",
    });

    await takesOff(bill.billId, advanceId, -3000);
  });

  it("started before the correction was opened: Discard is refused while the box waits for its time, keeping the correction open, and issues the rest's invoice once the time is confirmed", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advanceOf(
      bill.billId,
      await cash(bill.billId, "30.00", { ownReceipt: true }),
    );
    const release = venue.card.holdNextCollect();
    const calls = venue.card.collectCalls.length;
    const paying = readerCard(bill.billId, "90.00");
    await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));
    const correctionId = await openWhole(advanceId);
    release();
    expect((await paying).status).toBe(200);
    let unconfirmed = true;
    const gated = venue.appWith({
      backend: gateSeatOnStartClock(venue.backend, () => unconfirmed),
    });
    const discard = () =>
      send(gated, venue.cookie, "POST", `/api/invoice-corrections/${correctionId}/close`, {
        override: supervisor(),
      });

    const refused = await discard();

    expect(refused).toMatchObject({ status: 409, json: { code: "clock.unconfirmed" } });
    const [row] = await inTx(venue, (tx) =>
      tx
        .select({ state: invoiceCorrections.state })
        .from(invoiceCorrections)
        .where(eq(invoiceCorrections.id, correctionId)),
    );
    expect(row).toEqual({ state: "open" });
    expect(await restOf(bill.billId)).toBeUndefined();

    unconfirmed = false;
    const discarded = await discard();

    expect(discarded.status, JSON.stringify(discarded.json)).toBe(200);
    expect(discarded.json).toMatchObject({ state: "discarded" });
    await takesOff(bill.billId, advanceId, -3000);
  });

  it("started before the correction was opened, and €10 of the advance filed back: the rest's invoice takes off only €20 once the €10 owed is paid", async () => {
    const bill = await seated("Tasting menu");
    const advanceId = await advanceOf(
      bill.billId,
      await cash(bill.billId, "30.00", { ownReceipt: true }),
    );
    const release = venue.card.holdNextCollect();
    const calls = venue.card.collectCalls.length;
    const paying = readerCard(bill.billId, "90.00");
    await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));
    const correctionId = await openWhole(advanceId);
    release();
    expect((await paying).status).toBe(200);
    const gaveBack = await endCorrection(correctionId, "cash", {
      submissionId: randomUUID(),
      amount: "10.00",
    });
    expect(gaveBack.status, JSON.stringify(gaveBack.json)).toBe(200);

    const filed = await endCorrection(correctionId, "file", {
      expectedSplit: [{ rate: "10.00", base: "9.09", tax: "0.91" }],
    });

    expect(filed.json).toMatchObject({ state: "filed" });
    expect(await restOf(bill.billId)).toBeUndefined();
    expect((await cash(bill.billId, "10.00")).status).toBe(200);
    await takesOff(bill.billId, advanceId, -2000);
  });
});
