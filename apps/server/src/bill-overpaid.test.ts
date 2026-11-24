import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { activityLog, billPayments, sales } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createProduct } from "@waitron/menu";
import { centsToDecimal } from "@waitron/shared";
import type { RefundAnswer } from "@waitron/payments";
import { clockAtIso, filedFor } from "./testing/later-sale-date-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { recoverTenderRefunds } from "./tender-refund-recovery.js";
import { readBillEditState } from "./bill-editing.js";
import { cancelItemHttp } from "./testing/cancel-line.js";
import { setTipsForTest } from "./testing/payment-settings.js";
import { offerProducts } from "./testing/zone-offers.js";
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

/** One Croquettes of line 1, 10.00, paid for in cash on a bill of its own. */
async function payForCroquettes(partyId: string, billId: string) {
  const paid = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/item-payments`,
    {
      submissionId: randomUUID(),
      picks: [{ lineId: lineIdOf(billId, 1), quantity: "1" }],
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

function keepAsTip(billId: string, submissionId = randomUUID()) {
  return send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/overpaid/keep-as-tip`,
    { submissionId },
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

  it("keeping the excess as a tip issues the bill", async () => {
    const { billId, paymentId } = await overpaidBill();

    const submissionId = randomUUID();
    const kept = await keepAsTip(billId, submissionId);

    expect(kept.status, JSON.stringify(kept.json)).toBe(200);
    expect(kept.json).toMatchObject({ status: "settled", overpaid: "0.00" });
    const again = await keepAsTip(billId, submissionId);
    expect(again.status).toBe(409);
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

  it("keeps as a tip only what a payment's refunds have left of it, the newest first", async () => {
    const { billId, paymentIds } = await overpaidBill("cash", false, ["12.00", "3.00"]);
    const [older, newer] = paymentIds;
    expect((await giveBack(billId, newer!, "2.00")).status).toBe(200);

    const kept = await keepAsTip(billId);

    expect(kept.status, JSON.stringify(kept.json)).toBe(200);
    expect(await paymentOf(newer!)).toEqual({ applied: "2.00", tip: "1.00" });
    expect(await paymentOf(older!)).toEqual({ applied: "10.00", tip: "2.00" });
    expect(await invoicesOf(billId)).toEqual(["10.00"]);
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

  it("gives back a payment's tip with applied money within the excess, needing no refund permission", async () => {
    const party = await seatedWith(venue, "Croquettes", "Croquettes");
    const billId = party.tabId;
    await take(billId, "cash", "11.00");
    const tipped = await take(billId, "cash", "4.00", "2.00");
    await payForCroquettes(party.partyId, billId);

    const given = await giveBack(billId, tipped, "4.00", randomUUID(), { tip: "2.00" });

    expect(given.status, JSON.stringify(given.json)).toBe(200);
    expect(await balanceOf(billId)).toMatchObject({ overpaid: "1.00" });
  });

  it("keeps as a tip none of a payment for chosen items taken the old way", async () => {
    const party = await seatedWith(venue, "Croquettes", "Croquettes");
    const billId = party.tabId;
    const contribution = await take(billId, "cash", "5.00");
    const items = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "items",
        lines: [{ lineNo: 2 }],
        method: "cash",
        tendered: "10.00",
        applied: "10.00",
        tip: "0.00",
      },
    );
    expect(items.status, JSON.stringify(items.json)).toBe(200);
    const itemsId = (items.json.payment as { id: string }).id;
    await payForCroquettes(party.partyId, billId);
    expect(await balanceOf(billId)).toMatchObject({ overpaid: "5.00" });

    const kept = await keepAsTip(billId);

    expect(kept.status, JSON.stringify(kept.json)).toBe(200);
    expect(await paymentOf(itemsId)).toEqual({ applied: "10.00", tip: "0.00" });
    expect(await paymentOf(contribution)).toEqual({ applied: "0.00", tip: "5.00" });
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

  it("keep as tip is refused when tips are off", async () => {
    const { billId, paymentId } = await overpaidBill();
    await setTipsForTest(venue.db, false);
    try {
      const kept = await keepAsTip(billId);

      expect(kept.status).toBe(422);
      expect(kept.json).toMatchObject({ code: "bill.tip_not_allowed" });
    } finally {
      await setTipsForTest(venue.db, true);
    }
    expect(await paymentOf(paymentId)).toEqual({ applied: "15.00", tip: "0.00" });
    expect(await balanceOf(billId)).toMatchObject({ overpaid: "5.00" });
  });

  it("keep as tip is refused when nothing is overpaid", async () => {
    const party = await seatedWith(venue, "Croquettes", "Croquettes");
    await take(party.tabId, "cash", "15.00");

    const kept = await keepAsTip(party.tabId);

    expect(kept).toEqual({
      status: 409,
      json: { code: "bill.not_overpaid", params: { workingOrderId: party.tabId } },
    });
  });

  it("a card give-back completed by a recovery pass a day later files the day the payments were taken", async () => {
    const { billId, paymentId } = await overpaidBill("card");
    venue.card.scriptNextRefund({ made: "completed", answer: LOST });
    const asked = await giveBack(billId, paymentId, "5.00");
    expect(asked.json).toMatchObject({ refund: { state: "pending" } });
    const [paid] = await inTx(venue, (tx) =>
      tx
        .select({ receivedAt: billPayments.receivedAt })
        .from(billPayments)
        .where(eq(billPayments.id, paymentId)),
    );
    const takenAt = Date.parse(paid!.receivedAt!);
    const nextDay = new Date(takenAt + 24 * 60 * 60 * 1000).toISOString();

    await recoverTenderRefunds({
      admission: testTradingAdmission(),
      db: venue.db,
      backend: venue.backend,
      clock: clockAtIso(nextDay),
      cfg: venue.cfg,
      refundProviderFor: (name) => venue.pool.get(name),
    });

    expect(await statusOf(venue, billId)).toBe("settled");
    // The venue's business day in Madrid, which turns at 05:00.
    const madridDay = (at: number) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(
        new Date(at - 5 * 60 * 60 * 1000),
      );
    const { supplyDay, record } = await filedFor(venue, billId);
    expect(supplyDay).toBe(madridDay(takenAt));
    expect(record.operationDate).toBe(madridDay(takenAt));
  });
});
