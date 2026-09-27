import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPaymentPolicy } from "@waitron/payments/test/seed.js";
import { insertAcceptedOffline, payments } from "@waitron/payments";
import { centsToDecimal } from "@waitron/shared";
import {
  inTx,
  paymentRows,
  provisionBillVenue,
  registroCount,
  send,
  statusOf,
  tabWith,
  tendersOfBill,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

// A card on a reader against a bill (bill payments design §5, §8 tests 1, 3, 10 and 12): three
// phases, the reservation a pending card holds, retries, and two devices in both orders. Every
// case opens its own bill, so what it reads back is its own.
let venue: BillVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

interface Body {
  submissionId?: string;
  kind: "items" | "contribution" | "share";
  lines?: { lineNo: number; quantity?: string }[];
  amount?: string;
  shareOf?: number;
  method: "cash" | "card";
  entry?: "manual" | "reader";
  tendered?: string;
  addedTip?: string;
  choice?: "full_with_tip" | "use_pool";
  allowOffline?: boolean;
  readerId?: string;
  applied: string;
  tip: string;
}

const tabWithDishes = (...names: string[]) => tabWith(venue, ...names);

function pay(billId: string, body: Body, opts: { cookie?: string; tipsOff?: boolean } = {}) {
  return send(
    opts.tipsOff === true ? venue.appTipsOff : venue.app,
    opts.cookie ?? venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    { submissionId: randomUUID(), ...body },
  );
}

function preview(billId: string, body: Omit<Body, "applied" | "tip">, tipsOff = false) {
  return send(
    tipsOff ? venue.appTipsOff : venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments/preview`,
    body,
  );
}

/** A card contribution of `amount` on the reader, the payer adding nothing. */
function cardContribution(billId: string, amount: string, opts: { cookie?: string } = {}) {
  return pay(
    billId,
    {
      kind: "contribution",
      amount,
      method: "card",
      entry: "reader",
      applied: amount,
      tip: "0.00",
    },
    opts,
  );
}

function cashContribution(billId: string, amount: string, opts: { cookie?: string } = {}) {
  return pay(
    billId,
    {
      kind: "contribution",
      amount,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
    },
    opts,
  );
}

function balance(billId: string) {
  return send(venue.app, venue.cookie, "GET", `/api/working-orders/${billId}/payments`);
}

/** Starts a card contribution whose collect waits; answers the request and its release. */
async function heldCard(billId: string, amount: string, opts: { cookie?: string } = {}) {
  const release = venue.card.holdNextCollect();
  const calls = venue.card.collectCalls.length;
  const answer = cardContribution(billId, amount, opts);
  await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));
  return { answer, release };
}

async function providerRowOf(billPaymentId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ state: payments.state, saleId: payments.saleId, amount: payments.amount })
      .from(payments)
      .where(eq(payments.billPaymentId, billPaymentId)),
  );
  return row;
}

describe("a card on a reader: the three phases (design §5.3)", () => {
  it("reserves the payment while the reader runs, then records it received", async () => {
    const billId = await tabWithDishes("Paella", "Tarta");
    const { answer, release } = await heldCard(billId, "20.00");

    const during = await balance(billId);
    const rows = await paymentRows(venue, billId);
    release();
    const paid = await answer;

    expect(rows).toMatchObject([{ state: "pending", method: "card", applied: 2000 }]);
    expect(during.json).toMatchObject({ reserved: "20.00", outstanding: "33.00" });
    expect(venue.card.collectCalls.at(-1)).toMatchObject({
      amount: "20.00",
      billPaymentId: rows[0]!.id,
    });
    expect(paid.status).toBe(200);
    expect(paid.json).toMatchObject({
      outcome: "received",
      payment: { state: "received", applied: "20.00" },
      balance: { received: "20.00", reserved: "0.00", outstanding: "33.00" },
    });
    expect(await providerRowOf(rows[0]!.id)).toMatchObject({ state: "captured" });
  });

  it("charges the reader on the device's own reader, never the other till's", async () => {
    const billId = await tabWithDishes("Tarta");
    await cardContribution(billId, "5.00", { cookie: venue.cookie2 });
    await cardContribution(billId, "5.00");

    expect(venue.card.collectCalls.slice(-2).map((call) => call.readerRef)).toEqual([
      "reader-2",
      "reader-1",
    ]);
  });

  it("charges the reader the request names when it names one", async () => {
    const billId = await tabWithDishes("Tarta");
    const [other] = venue.db.all<{ id: string }>(
      sql`select id from card_readers where provider_ref = 'reader-2'`,
    );

    const paid = await pay(billId, {
      kind: "contribution",
      amount: "5.00",
      method: "card",
      entry: "reader",
      readerId: other!.id,
      applied: "5.00",
      tip: "0.00",
    });

    expect(paid.status).toBe(200);
    expect(venue.card.collectCalls.at(-1)).toMatchObject({ readerRef: "reader-2" });
  });

  it("marks a declined card failed and releases its reservation", async () => {
    const billId = await tabWithDishes("Paella");
    venue.card.failNextCollect();

    const paid = await cardContribution(billId, "20.00");

    expect(paid.status).toBe(200);
    expect(paid.json).toMatchObject({
      outcome: "declined",
      payment: { state: "failed" },
      balance: { received: "0.00", reserved: "0.00", outstanding: "35.00" },
    });
  });

  it("keeps a card the reader stopped answering pending, holding its reservation", async () => {
    const billId = await tabWithDishes("Paella");
    venue.card.stallNextCollect();

    const paid = await cardContribution(billId, "20.00");

    expect(paid.json).toMatchObject({
      outcome: "timeout",
      payment: { state: "pending" },
      balance: { reserved: "20.00", outstanding: "15.00" },
    });
  });

  it("marks a card the network refused offline failed: no money moved", async () => {
    const billId = await tabWithDishes("Paella");
    venue.card.offlineNextCollect();

    const paid = await cardContribution(billId, "20.00");

    expect(paid.json).toMatchObject({
      outcome: "network_unavailable",
      payment: { state: "failed" },
      balance: { reserved: "0.00", outstanding: "35.00" },
    });
  });

  it("keeps a card the provider accepted offline pending: money may have moved", async () => {
    const billId = await tabWithDishes("Paella");
    vi.spyOn(venue.card, "collect").mockImplementationOnce(async (params) => {
      const settledAt = new Date();
      const row = {
        workingOrderId: params.workingOrderId,
        provider: venue.card.provider,
        paymentRef: randomUUID(),
        amount: params.amount,
        settledAt,
        billPaymentId: params.billPaymentId,
      };
      await inTx(venue, (tx) => insertAcceptedOffline(tx, row));
      return { ...row, state: "accepted_offline", offline: true };
    });

    const paid = await cardContribution(billId, "20.00");

    expect(paid.json).toMatchObject({
      outcome: "timeout",
      payment: { state: "pending" },
      balance: { reserved: "20.00", outstanding: "15.00" },
    });
  });

  it("refuses to let a card be accepted offline, asking no reader and writing nothing (design §11.9)", async () => {
    const billId = await tabWithDishes("Paella");
    await seedPaymentPolicy(venue.db, "accept_offline", "50.00");
    const calls = venue.card.collectCalls.length;

    const paid = await pay(billId, {
      kind: "contribution",
      amount: "20.00",
      method: "card",
      entry: "reader",
      allowOffline: true,
      applied: "20.00",
      tip: "0.00",
    });

    expect(paid.status).toBe(400);
    expect(paid.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "allowOffline" },
    });
    expect(venue.card.collectCalls).toHaveLength(calls);
    expect(await paymentRows(venue, billId)).toEqual([]);
  });

  it("issues the invoice from the capture that pays the bill, on the device's till", async () => {
    const billId = await tabWithDishes("Paella", "Tarta");
    await cashContribution(billId, "23.00");

    const paid = await cardContribution(billId, "30.00");

    expect(paid.json).toMatchObject({ outcome: "received", invoice: { total: "53.00" } });
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(registroCount(venue, billId)).toBe(1);
    const cardPayment = (await paymentRows(venue, billId)).find((row) => row.method === "card")!;
    const filed = await tendersOfBill(venue, billId);
    expect(filed).toHaveLength(2);
    expect(filed.find((tender) => tender.method === "card")).toMatchObject({
      amount: 3000,
      billPaymentId: cardPayment.id,
      saleTillId: venue.deviceTillId,
    });
    expect((await providerRowOf(cardPayment.id))?.saleId).not.toBeNull();
  });

  it("files the invoice a capture completes even when a line never sent has since sold out", async () => {
    const billId = await tabWithDishes("Paella");
    const round = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/round`,
      {
        lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1", hold: true }],
      },
    );
    expect(round.status).toBe(200);
    const card = await heldCard(billId, "38.00");
    venue.db.run(sql`update products set available = 0 where name = 'Caña'`);
    try {
      card.release();
      const paid = await card.answer;

      expect(paid.json).toMatchObject({ outcome: "received", invoice: { total: "38.00" } });
      expect(registroCount(venue, billId)).toBe(1);
    } finally {
      venue.db.run(sql`update products set available = 1 where name = 'Caña'`);
    }
  });

  it("refuses a reader card on a device whose profile does not take integrated cards", async () => {
    const billId = await tabWithDishes("Paella");
    const calls = venue.card.collectCalls.length;

    const paid = await cardContribution(billId, "10.00", { cookie: venue.cookieNoCard });

    expect(paid.status).toBe(403);
    expect(paid.json).toMatchObject({ code: "device.forbidden_action", params: { action: "pay" } });
    expect(venue.card.collectCalls).toHaveLength(calls);
    expect(await paymentRows(venue, billId)).toEqual([]);
  });

  it("refuses a practice outcome outside practice mode", async () => {
    const billId = await tabWithDishes("Paella");

    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "10.00",
        method: "card",
        entry: "reader",
        simulationOutcome: "captured",
        applied: "10.00",
        tip: "0.00",
      },
    );

    expect(paid.status).toBe(400);
    expect(paid.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "simulationOutcome" },
    });
    expect(await paymentRows(venue, billId)).toEqual([]);
  });

  it("refuses a card on a device-less request before any charge", async () => {
    const billId = await tabWithDishes("Paella");
    const calls = venue.card.collectCalls.length;
    const cookie = venue.cookie.split("; ")[0]!;

    const paid = await cardContribution(billId, "10.00", { cookie });

    expect(paid.status).toBe(401);
    expect(paid.json).toMatchObject({ code: "device.unauthorized" });
    expect(venue.card.collectCalls).toHaveLength(calls);
    expect(await paymentRows(venue, billId)).toEqual([]);
  });
});

describe("a malformed payment body", () => {
  const card = {
    submissionId: "s-1",
    kind: "contribution",
    amount: "5.00",
    method: "card",
    entry: "reader",
    applied: "5.00",
    tip: "0.00",
  };
  const cash = { ...card, method: "cash", entry: undefined, tendered: "5.00" };

  it.each([
    ["a list for a body", [], "body"],
    ["an unknown kind", { ...card, kind: "gift" }, "kind"],
    ["an unknown method", { ...card, method: "cheque" }, "method"],
    ["lines that are not a list", { ...card, kind: "items", amount: undefined, lines: 1 }, "lines"],
    [
      "a line numbered 0",
      { ...card, kind: "items", amount: undefined, lines: [{ lineNo: 0 }] },
      "lines",
    ],
    ["lines on a contribution", { ...card, lines: [{ lineNo: 1 }] }, "lines"],
    ["an amount on a share", { ...card, kind: "share", shareOf: 2 }, "amount"],
    ["a share of none", { ...card, kind: "share", amount: undefined, shareOf: 0 }, "shareOf"],
    ["a share count on a contribution", { ...card, shareOf: 2 }, "shareOf"],
    ["money with three decimals", { ...card, amount: "5.001" }, "amount"],
    ["cash handed over for a card", { ...card, tendered: "5.00" }, "tendered"],
    ["a malformed added tip", { ...card, addedTip: "-1" }, "addedTip"],
    ["an unknown choice", { ...card, choice: "both" }, "choice"],
    ["no submission id", { ...card, submissionId: "" }, "submissionId"],
    ["a malformed applied amount", { ...card, applied: "five" }, "applied"],
    ["an unknown entry", { ...card, entry: "swipe" }, "entry"],
    ["an entry on cash", { ...cash, entry: "reader" }, "entry"],
    ["a terminal reference on a reader card", { ...card, externalRef: "OP-1" }, "externalRef"],
    [
      "a terminal reference that is not text",
      { ...card, entry: "manual", externalRef: 7 },
      "externalRef",
    ],
    [
      "an offline consent that is not true or false",
      { ...card, allowOffline: "yes" },
      "allowOffline",
    ],
    ["an unknown practice outcome", { ...card, simulationOutcome: "maybe" }, "simulationOutcome"],
    ["an offline consent on cash", { ...cash, allowOffline: true }, "allowOffline"],
    [
      "a reader named on a hand-keyed card",
      { ...card, entry: "manual", readerId: "r" },
      "readerId",
    ],
    ["a reader id that is not an id", { ...card, readerId: "nope" }, "readerId"],
  ] as const)("refuses %s, naming the field", async (_name, body, field) => {
    const billId = await tabWithDishes("Paella");

    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      body,
    );

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({ code: "management.request_invalid", params: { field } });
    expect(await paymentRows(venue, billId)).toEqual([]);
  });
});

describe("change versus tip (design §8 test 1)", () => {
  // Chuletón €25.00 + Ensalada €12.00 + Caña €3.00 = €40.00, and a Tarta that stays unpaid.
  const items = [{ lineNo: 1 }, { lineNo: 2 }, { lineNo: 3 }];
  const bill = () => tabWithDishes("Chuletón", "Ensalada", "Caña", "Tarta");

  it("gives €10.00 change on €50.00 cash for €40.00 of items", async () => {
    const billId = await bill();

    const paid = await pay(billId, {
      kind: "items",
      lines: items,
      method: "cash",
      tendered: "50.00",
      applied: "40.00",
      tip: "0.00",
    });

    expect(paid.json).toMatchObject({
      payment: { applied: "40.00", change: "10.00", tip: "0.00" },
    });
  });

  it("records the €10.00 as a tip, not change, when the operator marks it so", async () => {
    const billId = await bill();

    const paid = await pay(billId, {
      kind: "items",
      lines: items,
      method: "cash",
      tendered: "50.00",
      addedTip: "10.00",
      applied: "40.00",
      tip: "10.00",
    });

    expect(paid.json).toMatchObject({
      payment: { applied: "40.00", change: "0.00", tip: "10.00" },
    });
  });

  it("shows €40.00 applied and a €10.00 tip for €50.00 by card BEFORE the reader is asked", async () => {
    const billId = await bill();
    const calls = venue.card.collectCalls.length;

    const shown = await preview(billId, {
      kind: "items",
      lines: items,
      method: "card",
      addedTip: "10.00",
    });
    const collectsAfterPreview = venue.card.collectCalls.length;
    const paid = await pay(billId, {
      kind: "items",
      lines: items,
      method: "card",
      entry: "reader",
      addedTip: "10.00",
      applied: "40.00",
      tip: "10.00",
    });

    expect(shown.json).toMatchObject({ kind: "allocated", applied: "40.00", tip: "10.00" });
    expect(collectsAfterPreview).toBe(calls);
    expect(venue.card.collectCalls.at(-1)).toMatchObject({ amount: "50.00" });
    expect(paid.json).toMatchObject({
      outcome: "received",
      payment: { applied: "40.00", tip: "10.00", change: null },
      balance: { received: "40.00", tips: "10.00", outstanding: "18.00" },
    });
  });
});

describe("the steak (design §8 test 3, §3.3)", () => {
  // Paella 35 + Chuletón 25 + Botella 30 + Ensalada 12 + Tarta 18 = €120.00; the steak is line 2.
  const steak = [{ lineNo: 2 }];

  /** €105.00 contributed, one payment of it carrying a €5.00 tip that must never count. */
  async function billWith105(): Promise<string> {
    const billId = await tabWithDishes("Paella", "Chuletón", "Botella tinto", "Ensalada", "Tarta");
    await cashContribution(billId, "100.00");
    const tipped = await pay(billId, {
      kind: "contribution",
      amount: "5.00",
      method: "cash",
      tendered: "10.00",
      addedTip: "5.00",
      applied: "5.00",
      tip: "5.00",
    });
    expect(tipped.json).toMatchObject({ balance: { tips: "5.00", outstanding: "15.00" } });
    return billId;
  }

  it("offers exactly the two choices with tips on and nothing pending", async () => {
    const billId = await billWith105();

    const shown = await preview(billId, { kind: "items", lines: steak, method: "card" });

    expect(shown.json).toEqual({
      kind: "choose",
      options: [
        { choice: "full_with_tip", applied: "15.00", tip: "10.00" },
        { choice: "use_pool", applied: "15.00", tip: "0.00" },
      ],
    });
  });

  it("paying the full price by card leaves nothing outstanding and records a €10.00 tip", async () => {
    const billId = await billWith105();

    const paid = await pay(billId, {
      kind: "items",
      lines: steak,
      method: "card",
      entry: "reader",
      choice: "full_with_tip",
      applied: "15.00",
      tip: "10.00",
    });

    expect(venue.card.collectCalls.at(-1)).toMatchObject({ amount: "25.00" });
    expect(paid.json).toMatchObject({
      outcome: "received",
      payment: { applied: "15.00", tip: "10.00" },
      invoice: { total: "120.00" },
    });
    expect(await statusOf(venue, billId)).toBe("settled");
  });

  it("paying what is left from the pool leaves nothing outstanding and records no tip", async () => {
    const billId = await billWith105();

    const paid = await pay(billId, {
      kind: "items",
      lines: steak,
      method: "card",
      entry: "reader",
      choice: "use_pool",
      applied: "15.00",
      tip: "0.00",
    });

    expect(venue.card.collectCalls.at(-1)).toMatchObject({ amount: "15.00" });
    expect(paid.json).toMatchObject({
      payment: { applied: "15.00", tip: "0.00" },
      invoice: { total: "120.00" },
    });
  });

  it("offers only the pool with tips off", async () => {
    const billId = await billWith105();

    const shown = await preview(billId, { kind: "items", lines: steak, method: "card" }, true);

    expect(shown.json).toEqual({
      kind: "choose",
      options: [{ choice: "use_pool", applied: "15.00", tip: "0.00" }],
    });
  });

  it("offers only the full price with a card pending, and that choice is taken", async () => {
    const billId = await billWith105();
    venue.card.stallNextCollect();
    await cardContribution(billId, "5.00");

    const shown = await preview(billId, { kind: "items", lines: steak, method: "card" });
    const paid = await pay(billId, {
      kind: "items",
      lines: steak,
      method: "cash",
      tendered: "25.00",
      choice: "full_with_tip",
      applied: "10.00",
      tip: "15.00",
    });

    expect(shown.json).toEqual({
      kind: "choose",
      options: [{ choice: "full_with_tip", applied: "10.00", tip: "15.00" }],
    });
    expect(paid.json).toMatchObject({
      payment: { applied: "10.00", tip: "15.00", change: "0.00" },
      balance: { reserved: "5.00", outstanding: "0.00" },
    });
  });

  it("offers neither with tips off and a card pending: order.payment_in_flight", async () => {
    const billId = await billWith105();
    venue.card.stallNextCollect();
    await cardContribution(billId, "5.00");

    const shown = await preview(billId, { kind: "items", lines: steak, method: "card" }, true);

    expect(shown.status).toBe(409);
    expect(shown.json).toMatchObject({ code: "order.payment_in_flight" });
  });

  it("refuses an item payment naming the line a pending card pays for: bill.line_paid", async () => {
    const billId = await tabWithDishes("Chuletón", "Tarta");
    venue.card.stallNextCollect();
    await pay(billId, {
      kind: "items",
      lines: [{ lineNo: 1 }],
      method: "card",
      entry: "reader",
      applied: "25.00",
      tip: "0.00",
    });

    const again = await pay(billId, {
      kind: "items",
      lines: [{ lineNo: 1 }],
      method: "cash",
      tendered: "25.00",
      applied: "25.00",
      tip: "0.00",
    });

    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ code: "bill.line_paid", params: { lineNo: 1 } });
  });
});

describe("retries (design §8 test 10, §5.1)", () => {
  it("the same submission id twice makes one bill payment, one collect and one tender", async () => {
    const billId = await tabWithDishes("Tarta");
    const submissionId = randomUUID();
    const calls = venue.card.collectCalls.length;
    const body: Body = {
      submissionId,
      kind: "contribution",
      amount: "18.00",
      method: "card",
      entry: "reader",
      applied: "18.00",
      tip: "0.00",
    };

    const first = await pay(billId, body);
    const second = await pay(billId, body);

    expect(first.json).toMatchObject({ outcome: "received", invoice: { total: "18.00" } });
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ outcome: "received", invoice: { total: "18.00" } });
    expect(venue.card.collectCalls.length).toBe(calls + 1);
    expect(await paymentRows(venue, billId)).toHaveLength(1);
    expect(await tendersOfBill(venue, billId)).toHaveLength(1);
    expect(registroCount(venue, billId)).toBe(1);
  });

  it("answers a retry of a card still at the reader 'pending' and starts no second collect", async () => {
    const billId = await tabWithDishes("Paella");
    const submissionId = randomUUID();
    const body: Body = {
      submissionId,
      kind: "contribution",
      amount: "10.00",
      method: "card",
      entry: "reader",
      applied: "10.00",
      tip: "0.00",
    };
    const release = venue.card.holdNextCollect();
    const calls = venue.card.collectCalls.length;
    const first = pay(billId, body);
    await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));

    const retry = await pay(billId, body);
    release();
    await first;

    expect(retry.json).toMatchObject({ outcome: "pending", payment: { state: "pending" } });
    expect(venue.card.collectCalls.length).toBe(calls + 1);
    expect(await paymentRows(venue, billId)).toHaveLength(1);
  });

  it("answers a retry of a declined card 'failed' and charges nothing more", async () => {
    const billId = await tabWithDishes("Paella");
    const body: Body = {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "10.00",
      method: "card",
      entry: "reader",
      applied: "10.00",
      tip: "0.00",
    };
    venue.card.failNextCollect();
    await pay(billId, body);
    const calls = venue.card.collectCalls.length;

    const retry = await pay(billId, body);

    expect(retry.json).toMatchObject({ outcome: "failed", payment: { state: "failed" } });
    expect(venue.card.collectCalls.length).toBe(calls);
  });

  it("refuses the id with another amount: submission.id_reused, charging nothing", async () => {
    const billId = await tabWithDishes("Paella");
    const submissionId = randomUUID();
    await pay(billId, {
      submissionId,
      kind: "contribution",
      amount: "5.00",
      method: "card",
      entry: "reader",
      applied: "5.00",
      tip: "0.00",
    });
    const calls = venue.card.collectCalls.length;

    const reused = await pay(billId, {
      submissionId,
      kind: "contribution",
      amount: "6.00",
      method: "card",
      entry: "reader",
      applied: "6.00",
      tip: "0.00",
    });

    expect(reused.status).toBe(409);
    expect(reused.json).toMatchObject({ code: "submission.id_reused" });
    expect(venue.card.collectCalls.length).toBe(calls);
  });
});

describe("several devices (design §8 test 12, §5.2), each race in both orders", () => {
  it("cash first, then a card for the same last €40.00: the cash issues the invoice, and the card is refused before any charge", async () => {
    // Chuletón 25 + Ensalada 12 + Caña 3 = €40.00.
    const billId = await tabWithDishes("Chuletón", "Ensalada", "Caña");
    const calls = venue.card.collectCalls.length;

    const cash = await cashContribution(billId, "40.00");
    const card = await cardContribution(billId, "40.00", { cookie: venue.cookie2 });

    expect(cash.json).toMatchObject({ outcome: "received", invoice: { total: "40.00" } });
    expect(card.status).toBe(409);
    expect(card.json).toMatchObject({ code: "working_order.not_open" });
    expect(venue.card.collectCalls.length).toBe(calls);
    expect(await paymentRows(venue, billId)).toHaveLength(1);
  });

  it("cash first while a third card is at the reader: the card for the same last €30.00 is refused order.payment_in_flight", async () => {
    // €58.00: the Tarta paid, a €10.00 card at the reader, then the last €30.00 twice.
    const billId = await tabWithDishes("Chuletón", "Ensalada", "Caña", "Tarta");
    await pay(billId, {
      kind: "items",
      lines: [{ lineNo: 4 }],
      method: "cash",
      tendered: "18.00",
      applied: "18.00",
      tip: "0.00",
    });
    const third = await heldCard(billId, "10.00");
    const calls = venue.card.collectCalls.length;

    const cash = await cashContribution(billId, "30.00");
    const card = await cardContribution(billId, "30.00", { cookie: venue.cookie2 });
    third.release();
    await third.answer;

    expect(cash.json).toMatchObject({ outcome: "received", balance: { outstanding: "0.00" } });
    expect(card.status).toBe(409);
    expect(card.json).toMatchObject({ code: "order.payment_in_flight" });
    expect(venue.card.collectCalls.length).toBe(calls);
    expect(registroCount(venue, billId)).toBe(1);
  });

  it("a card first, then cash for the same last €40.00: the cash is refused, and the card's capture issues the invoice", async () => {
    const billId = await tabWithDishes("Chuletón", "Ensalada", "Caña");
    const card = await heldCard(billId, "40.00");

    const cash = await cashContribution(billId, "40.00", { cookie: venue.cookie2 });
    card.release();
    const captured = await card.answer;

    expect(cash.status).toBe(409);
    expect(cash.json).toMatchObject({ code: "order.payment_in_flight" });
    expect(captured.json).toMatchObject({ outcome: "received", invoice: { total: "40.00" } });
    expect((await paymentRows(venue, billId)).map((row) => row.method)).toEqual(["card"]);
  });

  it.each([
    ["the €30.00 card captured first", 0],
    ["the €40.00 card captured first", 1],
  ])(
    "two cards of €30.00 and €40.00 on €70.00, %s: only the second capture issues the invoice",
    async (_name, firstIndex) => {
      // Botella 30 + Chuletón 25 + Ensalada 12 + Caña 3 = €70.00.
      const billId = await tabWithDishes("Botella tinto", "Chuletón", "Ensalada", "Caña");
      const cards = [
        await heldCard(billId, "30.00"),
        await heldCard(billId, "40.00", { cookie: venue.cookie2 }),
      ];
      const first = cards[firstIndex]!;
      const second = cards[1 - firstIndex]!;

      first.release();
      const firstAnswer = await first.answer;
      const afterFirst = {
        status: await statusOf(venue, billId),
        filed: registroCount(venue, billId),
      };
      second.release();
      const secondAnswer = await second.answer;

      expect(firstAnswer.json).toMatchObject({ outcome: "received" });
      expect(firstAnswer.json.invoice).toBeUndefined();
      expect(afterFirst).toEqual({ status: "open", filed: 0 });
      expect(secondAnswer.json).toMatchObject({ outcome: "received", invoice: { total: "70.00" } });
      expect(registroCount(venue, billId)).toBe(1);
      const filed = await tendersOfBill(venue, billId);
      expect(filed.map((tender) => centsToDecimal(tender.amount)).sort()).toEqual([
        "30.00",
        "40.00",
      ]);
    },
  );

  it("takes cash on another device while a card is at the reader, against what the card leaves", async () => {
    const billId = await tabWithDishes("Botella tinto", "Chuletón", "Ensalada", "Caña");
    const card = await heldCard(billId, "30.00");

    const cash = await cashContribution(billId, "40.00", { cookie: venue.cookie2 });
    const beforeCapture = registroCount(venue, billId);
    card.release();
    const captured = await card.answer;

    expect(cash.json).toMatchObject({
      outcome: "received",
      balance: { received: "40.00", reserved: "30.00", outstanding: "0.00" },
    });
    expect(cash.json.invoice).toBeUndefined();
    expect(beforeCapture).toBe(0);
    expect(captured.json).toMatchObject({ invoice: { total: "70.00" } });
  });

  it("refuses every line write and abandoning the bill while its card is at the reader, and leaves another bill of the party alone", async () => {
    const billId = await tabWithDishes("Paella", "Tarta", "Caña", "Caña");
    const split = await send(venue.app, venue.cookie, "POST", `/api/tabs/${billId}/split`, {
      transfers: [{ lineNo: 3 }, { lineNo: 4 }],
    });
    const otherBill = split.json.checkId as string;
    const card = await heldCard(billId, "10.00");

    const voided = await send(
      venue.app,
      venue.cookie,
      "DELETE",
      `/api/working-orders/${billId}/lines/2`,
    );
    const round = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/round`,
      {
        lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
      },
    );
    const abandoned = await send(
      venue.app,
      venue.cookie,
      "DELETE",
      `/api/working-orders/${billId}`,
    );
    const otherLines = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/working-orders/${otherBill}/lines`,
    );
    const otherNote = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${otherBill}/lines/1`,
      { revision: otherLines.json.revision, note: "sin espuma" },
    );
    card.release();
    await card.answer;

    for (const refused of [voided, round, abandoned]) {
      expect(refused.status).toBe(409);
      expect(refused.json).toMatchObject({ code: "order.payment_in_flight" });
    }
    expect(otherNote.status).toBe(200);
    expect(await statusOf(venue, billId)).toBe("open");
    expect((await balance(billId)).json).toMatchObject({ total: "53.00", received: "10.00" });
  });
});
