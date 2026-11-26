import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { activityLog, billPayments, sales, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createProduct } from "@waitron/menu";
import { centsToDecimal } from "@waitron/shared";
import { payments, type RefundAnswer } from "@waitron/payments";
import { liftPaymentGuard } from "@waitron/payments/src/testing/lift-payment-guard.js";
import { clockAtIso, filedFor } from "./testing/later-sale-date-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { recoverTenderRefunds } from "./tender-refund-recovery.js";
import { readBillEditState, readPartyBillIds } from "./bill-editing.js";
import { numberBill } from "./testing/bill-identities.js";
import { cancelItemHttp } from "./testing/cancel-line.js";
import { setTipsForTest } from "./testing/payment-settings.js";
import { offerProducts } from "./testing/zone-offers.js";
import { zeroBillHoldingMoney } from "./testing/zero-bill-holding-money.js";
import {
  inTx,
  partyRevisionOf,
  provisionBillVenue,
  send,
  seatedWith,
  statusOf,
  tendersOfBill,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

let venue: BillVenue;
let coffee: string;
let water: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    ({ coffee, water } = await inTx(venue, async (tx) => {
      const [{ categoryId }] = await tx.all<{ categoryId: string }>(
        sql`select category_id as categoryId from products where name = 'Croquettes'`,
      );
      const product = async (name: string, customer: string, unitPrice: string) =>
        (
          await createProduct(tx, {
            categoryId: categoryId!,
            name,
            customerName: { es: customer },
            kitchenName: name.toUpperCase(),
            pricingUnit: "each",
            unitPrice,
            vatClass: "general",
          })
        ).id;
      const ids = [
        await product("Coffee", "Coffee (customer)", "3.00"),
        await product("Water", "Water (customer)", "2.00"),
      ];
      const offers = await offerProducts(tx, { zone: "tables" });
      return { coffee: offers.offerFor(ids[0]!), water: offers.offerFor(ids[1]!) };
    }));
  },
});

const LOST: RefundAnswer = { kind: "uncertain", reason: "timeout" };

function lineIdOf(billId: string, lineNo: number): string {
  const [row] = venue.db.all<{ id: string }>(
    sql`select id from working_order_lines where working_order_id = ${billId} and line_no = ${lineNo}`,
  );
  return row!.id;
}

async function take(
  billId: string,
  method: "cash" | "card" | "hand-keyed",
  amount: string,
  tip = "0.00",
) {
  const answer = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method: method === "cash" ? "cash" : "card",
      ...(method === "cash"
        ? { tendered: (Number(amount) + Number(tip)).toFixed(2) }
        : method === "card"
          ? { entry: "reader" }
          : { entry: "manual" }),
      applied: amount,
      tip,
      ...(tip === "0.00" ? {} : { addedTip: tip }),
    },
  );
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return (answer.json.payment as { id: string }).id;
}

/**
 * A party's 20.00 bill (two Croquettes, and a 3.00 coffee with `extra`) holding 15.00 received by
 * `method` (18.00 with the coffee), of which one Croquettes, 10.00, is then paid for in cash on a
 * bill of its own: the bill is left owing 5.00 less than it was paid.
 */
async function overpaidBill(
  method: "cash" | "card" | "hand-keyed" = "cash",
  extra = false,
  amounts = [extra ? "18.00" : "15.00"],
) {
  const party = await seatedWith(venue, "Croquettes", "Croquettes");
  const billId = party.tabId;
  if (extra) expect((await sendDish(party.partyId, billId, coffee)).status).toBe(200);
  const paymentIds: string[] = [];
  for (const amount of amounts) paymentIds.push(await take(billId, method, amount));
  const paymentId = paymentIds[0]!;
  await payForCroquettes(party.partyId, billId);
  return { billId, partyId: party.partyId, paymentId, paymentIds };
}

/** One Croquettes of line `lineNo`, 10.00, paid for in cash on a bill of its own. */
async function payForCroquettes(partyId: string, billId: string, lineNo = 1) {
  const paid = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/item-payments`,
    {
      submissionId: randomUUID(),
      picks: [{ lineId: lineIdOf(billId, lineNo), quantity: "1" }],
      partyId,
      expectedPartyRevision: await partyRevisionOf(venue, billId),
      expectedEdits: [await inTx(venue, (tx) => readBillEditState(tx, billId))],
      method: "cash",
      tendered: "10.00",
      applied: "10.00",
      tip: "0.00",
    },
  );
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
}

/** Runs `fn` with the signed-in till's profile allowed to print receipts when `prints`. */
async function printingReceipts(prints: boolean, fn: () => Promise<void>) {
  const profileId = venue.db.all<{ id: string }>(
    sql`select device_profile_id as id from devices where id = ${venue.deviceId}`,
  )[0]!.id;
  const original = venue.db.all<{ c: string }>(
    sql`select capabilities as c from device_profiles where id = ${profileId}`,
  )[0]!.c;
  const next = prints
    ? JSON.stringify([...(JSON.parse(original) as string[]), "print-receipt"])
    : original;
  venue.db.run(sql`update device_profiles set capabilities = ${next} where id = ${profileId}`);
  try {
    await fn();
  } finally {
    venue.db.run(
      sql`update device_profiles set capabilities = ${original} where id = ${profileId}`,
    );
  }
}

/** Print the bill, anyway for the dishes not yet served. */
async function printBill(partyId: string, billId: string) {
  return send(venue.app, venue.cookie, "POST", `/api/parties/${partyId}/end-meal`, {
    billId,
    expectedPartyRevision: await partyRevisionOf(venue, billId),
    expectedEdits: [await inTx(venue, (tx) => readBillEditState(tx, billId))],
    submissionId: randomUUID(),
    printAnyway: true,
  });
}

async function balanceOf(billId: string) {
  const answer = await send(
    venue.app,
    venue.cookie,
    "GET",
    `/api/working-orders/${billId}/payments`,
  );
  return answer.json;
}

async function invoicesOf(billId: string): Promise<string[]> {
  const rows = await inTx(venue, (tx) =>
    tx.select({ total: sales.total }).from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return rows.map(({ total }) => centsToDecimal(total));
}

async function paymentOf(paymentId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ applied: billPayments.applied, tip: billPayments.tip })
      .from(billPayments)
      .where(eq(billPayments.id, paymentId)),
  );
  return { applied: centsToDecimal(row!.applied), tip: centsToDecimal(row!.tip) };
}

/** Keep as tip, as a till showing the bill paid `overpaid` over its total asks for it. */
function keepAsTip(billId: string, overpaid: string, submissionId: string = randomUUID()) {
  return send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/overpaid/keep-as-tip`,
    { submissionId, overpaid },
  );
}

/** A give-back by the signed-in waiter, who may take payments but not give refunds, with no PIN. */
function giveBack(
  billId: string,
  paymentId: string,
  applied: string,
  submissionId = randomUUID(),
  more: { tip?: string; manualConfirmed?: true } = {},
) {
  return send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments/${paymentId}/refunds`,
    {
      submissionId,
      appliedAmount: applied,
      tipAmount: more.tip ?? "0.00",
      reason: "Paid more than the bill",
      ...(more.manualConfirmed === undefined ? {} : { manualConfirmed: true }),
    },
  );
}

async function sendDish(partyId: string, billId: string, menuItemId: string) {
  const saved = await send(venue.app, venue.cookie, "PUT", `/api/parties/${partyId}/drafts`, {
    billId,
    draftId: null,
    revision: 0,
    expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
    lines: [{ menuItemId, quantity: "1" }],
  });
  expect(saved.status, JSON.stringify(saved.json)).toBe(200);
  const draft = saved.json.draft as { id: string; revision: number; lines: { id: string }[] };
  return send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/parties/${partyId}/drafts/${draft.id}/submit`,
    {
      dining: "eat_in",
      submissionId: randomUUID(),
      expectedPartyRevision: await partyRevisionOf(venue, billId),
      draftRevision: draft.revision,
      groups: [{ lineIds: [draft.lines[0]!.id], release: "fire" }],
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
    },
  );
}

describe("A1515 a bill left owing less than it was paid", () => {
  it("a bill left owing less than it was paid issues nothing", async () => {
    const { billId } = await overpaidBill();

    expect(await balanceOf(billId)).toMatchObject({
      status: "open",
      total: "10.00",
      received: "15.00",
      overpaid: "5.00",
    });
    expect(await invoicesOf(billId)).toEqual([]);
  });

  it("refuses to keep the excess using the original payment's submission ID", async () => {
    const { billId, paymentId } = await overpaidBill();
    const [payment] = await inTx(venue, (tx) =>
      tx
        .select({ submissionId: billPayments.submissionId })
        .from(billPayments)
        .where(eq(billPayments.id, paymentId)),
    );

    expect(await keepAsTip(billId, "5.00", payment!.submissionId)).toEqual({
      status: 409,
      json: { code: "submission.id_reused", params: { submissionId: payment!.submissionId } },
    });
    expect(await paymentOf(paymentId)).toEqual({ applied: "15.00", tip: "0.00" });
    expect(await invoicesOf(billId)).toEqual([]);
  });

  it("keeping the excess as a tip issues the bill", async () => {
    const { billId, paymentId } = await overpaidBill();

    const submissionId = randomUUID();
    const kept = await keepAsTip(billId, "5.00", submissionId);

    expect(kept.status, JSON.stringify(kept.json)).toBe(200);
    expect(kept.json).toMatchObject({ status: "settled", overpaid: "0.00" });
    const again = await keepAsTip(billId, "5.00", submissionId);
    expect(again).toEqual({
      status: 409,
      json: { code: "working_order.not_open", params: { workingOrderId: billId } },
    });
    expect(await paymentOf(paymentId)).toEqual({ applied: "10.00", tip: "5.00" });
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(await invoicesOf(billId)).toEqual(["10.00"]);
    expect(await tendersOfBill(venue, billId)).toMatchObject([
      { method: "cash", amount: 1500, tip: 500, billPaymentId: paymentId },
    ]);
    const [entry] = await inTx(venue, (tx) =>
      tx
        .select()
        .from(activityLog)
        .where(
          and(eq(activityLog.kind, "bill.overpaid_kept_as_tip"), eq(activityLog.subjectId, billId)),
        ),
    );
    expect(entry).toMatchObject({
      personId: venue.operatorId,
      data: { amount: "5.00", payments: [{ billPaymentId: paymentId, amount: "5.00" }] },
    });
  });

  it.each([false, true])(
    "keeping the excess as a tip queues no receipt, whether or not the till may print receipts (may print: %s)",
    async (printsReceipts) => {
      const { billId } = await overpaidBill();
      const jobs = () =>
        venue.db.all<{ n: number }>(sql`select count(*) as n from print_jobs`)[0]!.n;
      const before = jobs();
      await printingReceipts(printsReceipts, async () => {
        const kept = await keepAsTip(billId, "5.00");

        expect(kept.status, JSON.stringify(kept.json)).toBe(200);
        expect(await invoicesOf(billId)).toEqual(["10.00"]);
        expect(jobs()).toBe(before);
        // The receipt is its own request, which only a till that may print receipts is answered.
        const receipt = await send(
          venue.app,
          venue.cookie,
          "POST",
          `/api/sales/${billId}/receipt`,
          {},
        );
        expect(receipt.status).toBe(printsReceipts ? 200 : 403);
        expect(jobs()).toBe(printsReceipts ? before + 1 : before);
      });
    },
  );

  it("keeps as a tip only what a payment's refunds have left of it, the newest first", async () => {
    const { billId, paymentIds } = await overpaidBill("cash", false, ["12.00", "3.00"]);
    const [older, newer] = paymentIds;
    expect((await giveBack(billId, newer!, "2.00")).status).toBe(200);

    const kept = await keepAsTip(billId, "3.00");

    expect(kept.status, JSON.stringify(kept.json)).toBe(200);
    expect(await paymentOf(newer!)).toEqual({ applied: "2.00", tip: "1.00" });
    expect(await paymentOf(older!)).toEqual({ applied: "10.00", tip: "2.00" });
    expect(await invoicesOf(billId)).toEqual(["10.00"]);
  });

  it("keeps the excess from payments that still hold money, leaving the oldest alone", async () => {
    const { billId, paymentIds } = await overpaidBill("cash", false, [
      "8.00",
      "4.00",
      "1.00",
      "2.00",
    ]);
    const [oldest, middle, newer, newest] = paymentIds;
    expect((await giveBack(billId, newest!, "2.00")).json).toMatchObject({
      refund: { state: "completed" },
    });

    const kept = await keepAsTip(billId, "3.00");

    expect(kept.status, JSON.stringify(kept.json)).toBe(200);
    expect(await paymentOf(oldest!)).toEqual({ applied: "8.00", tip: "0.00" });
    expect(await paymentOf(middle!)).toEqual({ applied: "2.00", tip: "2.00" });
    expect(await paymentOf(newer!)).toEqual({ applied: "0.00", tip: "1.00" });
    expect(await paymentOf(newest!)).toEqual({ applied: "2.00", tip: "0.00" });
    expect(await invoicesOf(billId)).toEqual(["10.00"]);
    const [entry] = await inTx(venue, (tx) =>
      tx
        .select({ data: activityLog.data })
        .from(activityLog)
        .where(
          and(eq(activityLog.kind, "bill.overpaid_kept_as_tip"), eq(activityLog.subjectId, billId)),
        ),
    );
    expect(entry!.data).toEqual({
      amount: "3.00",
      payments: [
        { billPaymentId: newer, amount: "1.00" },
        { billPaymentId: middle, amount: "2.00" },
      ],
    });
  });

  it("giving back the excess in cash issues the bill", async () => {
    const { billId, paymentId } = await overpaidBill();

    const given = await giveBack(billId, paymentId, "5.00");

    expect(given.status, JSON.stringify(given.json)).toBe(200);
    expect(given.json).toMatchObject({
      refund: { state: "completed" },
      balance: { status: "settled" },
    });
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(await invoicesOf(billId)).toEqual(["10.00"]);
  });

  it("giving back by connected card issues the bill when the refund completes", async () => {
    const { billId, paymentId } = await overpaidBill("card");
    venue.card.scriptNextRefund({ made: "completed", answer: LOST });
    const submissionId = randomUUID();

    const asked = await giveBack(billId, paymentId, "5.00", submissionId);

    expect(asked.status, JSON.stringify(asked.json)).toBe(200);
    expect(asked.json).toMatchObject({ refund: { state: "pending" } });
    expect(await statusOf(venue, billId)).toBe("open");
    expect(await invoicesOf(billId)).toEqual([]);
    expect(await keepAsTip(billId, "5.00")).toEqual({
      status: 409,
      json: { code: "bill.refund_in_progress", params: { workingOrderId: billId } },
    });
    expect(await paymentOf(paymentId)).toEqual({ applied: "15.00", tip: "0.00" });

    const again = await giveBack(billId, paymentId, "5.00", submissionId);

    expect(again.json).toMatchObject({ refund: { state: "completed" } });
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(await invoicesOf(billId)).toEqual(["10.00"]);
  });

  it("a waiter without the refund permission gives back the excess with no approver's PIN", async () => {
    const { billId, paymentId } = await overpaidBill();

    const given = await giveBack(billId, paymentId, "5.00");

    expect(given.status, JSON.stringify(given.json)).toBe(200);
    expect(given.json).toMatchObject({ refund: { state: "completed" } });
  });

  it("answers a waiter's resent give-back of the excess as the first, with no refund permission", async () => {
    const { billId, paymentId } = await overpaidBill();
    const submissionId = randomUUID();
    const given = await giveBack(billId, paymentId, "5.00", submissionId);
    expect(given.status, JSON.stringify(given.json)).toBe(200);

    const again = await giveBack(billId, paymentId, "5.00", submissionId);

    expect(again.status, JSON.stringify(again.json)).toBe(200);
    expect(again.json).toEqual(given.json);
    expect(await invoicesOf(billId)).toEqual(["10.00"]);
  });

  it("giving back more than the excess still needs the refund permission", async () => {
    const { billId, paymentId } = await overpaidBill();

    const given = await giveBack(billId, paymentId, "6.00");

    expect(given).toEqual({
      status: 403,
      json: { code: "authorization.not_permitted", params: { permission: "sale.refund" } },
    });
    expect(await balanceOf(billId)).toMatchObject({ overpaid: "5.00" });
  });

  it("a waiter gives back the excess of a card keyed on a separate terminal with no approver's PIN", async () => {
    const { billId, paymentId } = await overpaidBill("hand-keyed");

    const given = await giveBack(billId, paymentId, "5.00", randomUUID(), {
      manualConfirmed: true,
    });

    expect(given.status, JSON.stringify(given.json)).toBe(200);
    expect(given.json).toMatchObject({
      refund: { state: "completed" },
      balance: { status: "settled" },
    });
    expect(await invoicesOf(billId)).toEqual(["10.00"]);
  });

  it("giving back more than the excess of a card keyed on a separate terminal still needs the refund permission", async () => {
    const { billId, paymentId } = await overpaidBill("hand-keyed");

    const given = await giveBack(billId, paymentId, "6.00", randomUUID(), {
      manualConfirmed: true,
    });

    expect(given).toEqual({
      status: 403,
      json: { code: "authorization.not_permitted", params: { permission: "sale.refund" } },
    });
    expect(await balanceOf(billId)).toMatchObject({ overpaid: "5.00" });
  });

  it("gives back a payment's tip with its applied money, needing no refund permission when both together are within the excess", async () => {
    const party = await seatedWith(venue, "Croquettes", "Croquettes");
    const billId = party.tabId;
    await take(billId, "cash", "12.00");
    const tipped = await take(billId, "cash", "3.00", "2.00");
    await payForCroquettes(party.partyId, billId);

    const given = await giveBack(billId, tipped, "3.00", randomUUID(), { tip: "2.00" });

    expect(given.status, JSON.stringify(given.json)).toBe(200);
    expect(await balanceOf(billId)).toMatchObject({ overpaid: "2.00" });
  });

  it("a tip given back with no refund permission uses up the excess for the next give-back", async () => {
    const party = await seatedWith(venue, "Croquettes", "Croquettes");
    const billId = party.tabId;
    const first = await take(billId, "cash", "12.00");
    const tipped = await take(billId, "cash", "3.00", "2.00");
    await payForCroquettes(party.partyId, billId);
    const given = await giveBack(billId, tipped, "3.00", randomUUID(), { tip: "2.00" });
    expect(given.status, JSON.stringify(given.json)).toBe(200);

    const more = await giveBack(billId, first, "2.00");

    expect(more).toEqual({
      status: 403,
      json: { code: "authorization.not_permitted", params: { permission: "sale.refund" } },
    });
    expect(await paymentOf(first)).toEqual({ applied: "12.00", tip: "0.00" });
  });

  it("what a given-back tip leaves of the excess can still go back with no refund permission", async () => {
    const party = await seatedWith(venue, "Croquettes", "Croquettes");
    const billId = party.tabId;
    const first = await take(billId, "cash", "13.00");
    const tipped = await take(billId, "cash", "3.00", "2.00");
    await payForCroquettes(party.partyId, billId);
    const given = await giveBack(billId, tipped, "3.00", randomUUID(), { tip: "2.00" });
    expect(given.status, JSON.stringify(given.json)).toBe(200);

    const rest = await giveBack(billId, first, "1.00");

    expect(rest.status, JSON.stringify(rest.json)).toBe(200);
    expect(await balanceOf(billId)).toMatchObject({ overpaid: "2.00" });
  });

  it("giving back a payment's tip with applied money that together exceed the excess needs the refund permission", async () => {
    const party = await seatedWith(venue, "Croquettes", "Croquettes");
    const billId = party.tabId;
    await take(billId, "cash", "11.00");
    const tipped = await take(billId, "cash", "4.00", "2.00");
    await payForCroquettes(party.partyId, billId);

    const given = await giveBack(billId, tipped, "4.00", randomUUID(), { tip: "2.00" });

    expect(given).toEqual({
      status: 403,
      json: { code: "authorization.not_permitted", params: { permission: "sale.refund" } },
    });
    expect(await balanceOf(billId)).toMatchObject({ overpaid: "5.00" });
  });

  it("adding a dish uses up the excess", async () => {
    const { billId, partyId } = await overpaidBill();

    const sent = await sendDish(partyId, billId, coffee);

    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
    expect(await balanceOf(billId)).toMatchObject({ status: "open", overpaid: "2.00" });

    const drink = await sendDish(partyId, billId, water);

    expect(drink.status, JSON.stringify(drink.json)).toBe(200);
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(await invoicesOf(billId)).toEqual(["15.00"]);
  });

  it("raising a dish's count by less than the excess is accepted", async () => {
    const { billId } = await overpaidBill("cash", true);
    const lines = await send(venue.app, venue.cookie, "GET", `/api/working-orders/${billId}/lines`);
    const added = (lines.json.lines as { lineNo: number }[]).at(-1)!;

    const raised = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${billId}/lines/${added.lineNo}`,
      {
        portionLineNos: [],
        revision: lines.json.revision,
        quantity: "2",
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
      },
    );

    expect(raised.status, JSON.stringify(raised.json)).toBe(200);
    expect(await balanceOf(billId)).toMatchObject({ total: "16.00", overpaid: "2.00" });
  });

  it("taking a dish off an overpaid bill is refused", async () => {
    const { billId } = await overpaidBill();

    const cancelled = await cancelItemHttp(venue.db, venue.app, venue.cookie, billId, 2);

    expect(cancelled.status).toBe(409);
    expect(cancelled.json).toMatchObject({ code: "bill.received_exceeds_total" });
  });

  it("printing a bill whose total is zero but which holds money is refused and issues nothing", async () => {
    const { partyId, billId } = await zeroBillHoldingMoney(venue);
    expect(await balanceOf(billId)).toMatchObject({ total: "0.00", overpaid: "15.00" });

    await printingReceipts(true, async () => {
      const printed = await printBill(partyId, billId);

      expect(printed.status, JSON.stringify(printed.json)).toBe(409);
      expect(printed.json).toEqual({ code: "bill.overpaid", params: { workingOrderId: billId } });
    });
    expect(await invoicesOf(billId)).toEqual([]);
    expect(await balanceOf(billId)).toMatchObject({
      status: "open",
      total: "0.00",
      received: "15.00",
      overpaid: "15.00",
    });
  });

  it("printing a bill that holds more than its total is refused as overpaid and issues nothing", async () => {
    const { billId, partyId } = await overpaidBill();

    await printingReceipts(true, async () => {
      const printed = await printBill(partyId, billId);

      expect(printed).toEqual({
        status: 409,
        json: { code: "bill.overpaid", params: { workingOrderId: billId } },
      });
    });
    expect(await invoicesOf(billId)).toEqual([]);
    expect(await balanceOf(billId)).toMatchObject({ status: "open", overpaid: "5.00" });
  });

  it("Finish table counts an overpaid bill as unpaid and an empty bill beside it as not", async () => {
    const { billId, partyId } = await overpaidBill();
    const empty = await inTx(venue, async (tx) => {
      const row = await seedWorkingOrder(tx, { source: "dashboard", partyId });
      await numberBill(tx, row.id, partyId);
      return row.id;
    });
    const finish = async () =>
      send(venue.app, venue.cookie, "POST", `/api/parties/${partyId}/finish`, {
        expectedPartyRevision: await partyRevisionOf(venue, billId),
        expectedEdits: await inTx(venue, async (tx) => {
          const edits = [];
          for (const id of await readPartyBillIds(tx, [partyId]))
            edits.push(await readBillEditState(tx, id));
          return edits;
        }),
      });

    expect(await finish()).toMatchObject({
      status: 409,
      json: { code: "party.bill_outstanding" },
    });
    expect((await keepAsTip(billId, "5.00")).status).toBe(200);

    // The unserved Croquettes are the next thing Finish asks about, after every bill is paid.
    expect(await finish()).toMatchObject({
      status: 409,
      json: { code: "party.unserved_dishes" },
    });
    expect(await statusOf(venue, empty)).toBe("open");
  });

  it("keep as tip is refused when tips are off", async () => {
    const { billId, paymentId } = await overpaidBill();
    await setTipsForTest(venue.db, false);
    try {
      const kept = await keepAsTip(billId, "5.00");

      expect(kept).toEqual({
        status: 409,
        json: { code: "bill.tip_not_allowed_on_excess", params: { workingOrderId: billId } },
      });
    } finally {
      await setTipsForTest(venue.db, true);
    }
    expect(await paymentOf(paymentId)).toEqual({ applied: "15.00", tip: "0.00" });
    expect(await balanceOf(billId)).toMatchObject({ overpaid: "5.00" });
  });

  it("keep as tip is refused on a bill whose total is zero, and writes nothing", async () => {
    const { billId } = await zeroBillHoldingMoney(venue);
    const [contribution] = venue.db.all<{ id: string }>(
      sql`select id from bill_payments where working_order_id = ${billId}`,
    );

    const kept = await keepAsTip(billId, "15.00");

    expect(kept).toEqual({
      status: 409,
      json: { code: "bill.tip_needs_a_sale", params: { workingOrderId: billId } },
    });
    expect(await paymentOf(contribution!.id)).toEqual({ applied: "15.00", tip: "0.00" });
    expect(await balanceOf(billId)).toMatchObject({
      status: "open",
      total: "0.00",
      overpaid: "15.00",
    });
    expect(await invoicesOf(billId)).toEqual([]);
    const kepts = await inTx(venue, (tx) =>
      tx
        .select()
        .from(activityLog)
        .where(
          and(eq(activityLog.kind, "bill.overpaid_kept_as_tip"), eq(activityLog.subjectId, billId)),
        ),
    );
    expect(kepts).toEqual([]);
  });

  it("keep as tip is refused when nothing is overpaid", async () => {
    const party = await seatedWith(venue, "Croquettes", "Croquettes");
    await take(party.tabId, "cash", "15.00");

    const kept = await keepAsTip(party.tabId, "5.00");

    expect(kept).toEqual({
      status: 409,
      json: { code: "bill.not_overpaid", params: { workingOrderId: party.tabId } },
    });
  });

  it("keep as tip is refused, writing nothing, when the bill is paid over its total by more than the till showed", async () => {
    const { billId, partyId, paymentId } = await overpaidBill("cash", true);
    expect(await balanceOf(billId)).toMatchObject({ total: "13.00", overpaid: "5.00" });
    await payForCroquettes(partyId, billId, 2);
    expect(await balanceOf(billId)).toMatchObject({ total: "3.00", overpaid: "15.00" });

    const stale = await keepAsTip(billId, "5.00");

    expect(stale).toEqual({
      status: 409,
      json: {
        code: "bill.overpaid_changed",
        params: { workingOrderId: billId, overpaid: "15.00" },
      },
    });
    expect(await paymentOf(paymentId)).toEqual({ applied: "18.00", tip: "0.00" });
    expect(await balanceOf(billId)).toMatchObject({ status: "open", overpaid: "15.00" });
    expect(await invoicesOf(billId)).toEqual([]);
    const kepts = await inTx(venue, (tx) =>
      tx
        .select()
        .from(activityLog)
        .where(
          and(eq(activityLog.kind, "bill.overpaid_kept_as_tip"), eq(activityLog.subjectId, billId)),
        ),
    );
    expect(kepts).toEqual([]);

    const confirmed = await keepAsTip(billId, "15.00");

    expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);
    expect(await paymentOf(paymentId)).toEqual({ applied: "3.00", tip: "15.00" });
    expect(await invoicesOf(billId)).toEqual(["3.00"]);
  });

  it("keep as tip that names no amount is refused, and writes nothing", async () => {
    const { billId, paymentId } = await overpaidBill();

    const kept = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/overpaid/keep-as-tip`,
      { submissionId: randomUUID() },
    );

    expect(kept.json).toEqual({
      code: "management.request_invalid",
      params: { field: "overpaid" },
    });
    expect(await paymentOf(paymentId)).toEqual({ applied: "15.00", tip: "0.00" });
    expect(await invoicesOf(billId)).toEqual([]);
  });

  it("a card give-back completed by a recovery pass a day later files the day the payments were taken", async () => {
    const { billId, paymentId } = await overpaidBill("card");
    await inTx(venue, async (tx) => {
      // Close of day would give the same calendar date if recovery ignored the payment.
      await tx
        .update(workingOrders)
        .set({ trustedOpenedAt: null })
        .where(eq(workingOrders.id, billId));
      await liftPaymentGuard(tx, () =>
        tx
          .update(payments)
          .set({ settledAt: "2026-11-24T23:03:00.000Z" })
          .where(eq(payments.billPaymentId, paymentId)),
      );
    });
    venue.card.scriptNextRefund({ made: "completed", answer: LOST });
    const asked = await giveBack(billId, paymentId, "5.00");
    expect(asked.json).toMatchObject({ refund: { state: "pending" } });

    await recoverTenderRefunds({
      admission: testTradingAdmission(),
      db: venue.db,
      backend: venue.backend,
      clock: clockAtIso("2026-11-25T23:03:00.000Z"),
      cfg: venue.cfg,
      refundProviderFor: (name) => venue.pool.get(name),
    });

    expect(await statusOf(venue, billId)).toBe("settled");
    const { supplyDay, record } = await filedFor(venue, billId);
    expect(supplyDay).toBe("2026-11-25");
    expect(record).toEqual({ operationDate: "2026-11-25", issueDate: "2026-11-26" });
  });
});
