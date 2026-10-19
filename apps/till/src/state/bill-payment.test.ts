import { describe, expect, it } from "vitest";
import type { BillBalance, BillPaymentView, TabLine } from "../api/client.js";
import {
  confirmationOf,
  holdsReload,
  isUncertainFailure,
  lockFor,
  paidQuantities,
  payLines,
  paymentAsk,
  refundOffered,
  refundSubmissionFor,
  refundableOf,
  refusalOf,
  sendEnded,
  sendStarted,
  sendUnanswered,
  settledByBalance,
  submissionFor,
  unansweredAfter,
  type PendingPayments,
  type PendingSend,
  type Submission,
} from "./bill-payment.js";

describe("paymentAsk", () => {
  it("asks for whole lines without a quantity, and for units of a line as a whole-number quantity", () => {
    expect(
      paymentAsk(
        {
          kind: "items",
          picks: [{ lineNo: 1 }, { lineNo: 3, units: 2 }],
        },
        { method: "card" },
      ),
    ).toEqual({
      expectedEdit: null,
      kind: "items",
      lines: [{ lineNo: 1 }, { lineNo: 3, quantity: "2" }],
      method: "card",
    });
  });

  it("asks for a contribution with the cash handed over", () => {
    expect(
      paymentAsk({ kind: "contribution", amount: "25.00" }, { method: "cash", tendered: "50.00" }),
    ).toEqual({
      expectedEdit: null,
      kind: "contribution",
      amount: "25.00",
      method: "cash",
      tendered: "50.00",
    });
  });

  it("asks for an equal share by how many people are still to pay, leaving the share to the server", () => {
    expect(paymentAsk({ kind: "share", shareOf: 3 }, { method: "card" })).toEqual({
      expectedEdit: null,
      kind: "share",
      shareOf: 3,
      method: "card",
    });
  });

  it("carries a tip the payer adds, on cash and on a card", () => {
    expect(
      paymentAsk(
        { kind: "contribution", amount: "40.00" },
        { method: "cash", tendered: "50.00", addedTip: "10.00" },
      ),
    ).toEqual({
      expectedEdit: null,
      kind: "contribution",
      amount: "40.00",
      method: "cash",
      tendered: "50.00",
      addedTip: "10.00",
    });
    expect(
      paymentAsk({ kind: "items", picks: [{ lineNo: 2 }] }, { method: "card", addedTip: "10.00" }),
    ).toEqual({
      expectedEdit: null,
      kind: "items",
      lines: [{ lineNo: 2 }],
      method: "card",
      addedTip: "10.00",
    });
  });
});

describe("confirmationOf", () => {
  const ask = paymentAsk({ kind: "items", picks: [{ lineNo: 1 }] }, { method: "card" });

  it("sends the applied amount and tip the operator was shown", () => {
    expect(
      confirmationOf(
        ask,
        {
          kind: "allocated",
          choice: null,
          applied: "40.00",
          tip: "0.00",
          change: null,
          charged: "40.00",
        },
        { entry: "manual" },
      ),
    ).toEqual({ ...ask, applied: "40.00", tip: "0.00", entry: "manual" });
  });

  // The steak: €25.00 of lines against €15.00 left. The operator picks one of the two offered.
  it("names the choice the operator picked and sends that option's amounts", () => {
    expect(
      confirmationOf(
        ask,
        { choice: "full_with_tip", applied: "15.00", tip: "10.00" },
        { entry: "reader", readerId: "rd-1" },
      ),
    ).toEqual({
      ...ask,
      choice: "full_with_tip",
      applied: "15.00",
      tip: "10.00",
      entry: "reader",
      readerId: "rd-1",
    });
  });

  it("sends cash with no card entry", () => {
    const cash = paymentAsk({ kind: "share", shareOf: 2 }, { method: "cash", tendered: "20.00" });

    expect(
      confirmationOf(cash, {
        kind: "allocated",
        choice: null,
        applied: "15.00",
        tip: "0.00",
        change: "5.00",
        charged: null,
      }),
    ).toEqual({ ...cash, applied: "15.00", tip: "0.00" });
  });
});

describe("the submission id of a confirmation", () => {
  const tenEuros = confirmationOf(
    paymentAsk({ kind: "contribution", amount: "10.00" }, { method: "cash", tendered: "10.00" }),
    {
      kind: "allocated",
      choice: null,
      applied: "10.00",
      tip: "0.00",
      change: "0.00",
      charged: null,
    },
  );
  const ids = (...values: string[]) => {
    const queue = [...values];
    return () => queue.shift()!;
  };
  const noAnswer = new TypeError("Failed to fetch");

  it("is fresh for a first confirmation, and travels with it", () => {
    const sent = submissionFor("wo-1", tenEuros, null, ids("sub-1"));

    expect(sent.request).toEqual({ ...tenEuros, submissionId: "sub-1" });
    expect(sent.key).toBe(JSON.stringify(["wo-1", { ...tenEuros, expectedEdit: undefined }]));
  });

  it("is reused when the same confirmation is sent again after it got no answer", () => {
    const first = submissionFor("wo-1", tenEuros, null, ids("sub-1", "sub-2"));
    const unanswered = unansweredAfter(first, noAnswer);

    expect(submissionFor("wo-1", tenEuros, unanswered, ids("sub-2")).request.submissionId).toBe(
      "sub-1",
    );
  });

  // The bottle: three people each hand over €10.00 for the same bill, and each is its own payment.
  it("is fresh for each of three identical payments that were answered", () => {
    const mint = ids("sub-1", "sub-2", "sub-3");
    let unanswered: Submission | null = null;
    const sentIds: string[] = [];
    for (let payer = 0; payer < 3; payer += 1) {
      const sent = submissionFor("wo-1", tenEuros, unanswered, mint);
      sentIds.push(sent.request.submissionId);
      unanswered = unansweredAfter(sent);
    }

    expect(sentIds).toEqual(["sub-1", "sub-2", "sub-3"]);
  });

  it("is kept after a refusal, which does not say what became of the send that got no answer", () => {
    const first = submissionFor("wo-1", tenEuros, null, ids("sub-1"));
    const kept = unansweredAfter(first, { code: "reader.provider_disconnected", status: 503 });

    expect(submissionFor("wo-1", tenEuros, kept, ids("sub-2")).request.submissionId).toBe("sub-1");
  });

  it("is fresh after the device changed profile, whose refusal fails the payment recorded under the id", () => {
    const first = submissionFor("wo-1", tenEuros, null, ids("sub-1"));
    const unanswered = unansweredAfter(first, { code: "device.profile_changed", status: 409 });

    expect(unanswered).toBeNull();
    expect(submissionFor("wo-1", tenEuros, unanswered, ids("sub-2")).request.submissionId).toBe(
      "sub-2",
    );
    const forbidden = unansweredAfter(first, { code: "device.forbidden_action", status: 403 });
    expect(submissionFor("wo-1", tenEuros, forbidden, ids("sub-3")).request.submissionId).toBe(
      "sub-1",
    );
  });

  it.each(["reader.not_held", "reader.payment_in_progress"])(
    "is fresh after %s, whose refusal at the payment's start fails the payment recorded under the id",
    (code) => {
      const first = submissionFor("wo-1", tenEuros, null, ids("sub-1"));
      const unanswered = unansweredAfter(first, { code, status: 409 });

      expect(unanswered).toBeNull();
      expect(submissionFor("wo-1", tenEuros, unanswered, ids("sub-2")).request.submissionId).toBe(
        "sub-2",
      );
    },
  );

  it("is fresh once the server says the id is taken by another request", () => {
    const first = submissionFor("wo-1", tenEuros, null, ids("sub-1"));
    const unanswered = unansweredAfter(first, { code: "submission.id_reused", status: 409 });

    expect(unanswered).toBeNull();
    expect(submissionFor("wo-1", tenEuros, unanswered, ids("sub-2")).request.submissionId).toBe(
      "sub-2",
    );
  });

  it("reconciles the original unknown payment before using a different confirmation", () => {
    const unanswered = unansweredAfter(
      submissionFor("wo-1", tenEuros, null, ids("sub-1")),
      noAnswer,
    );
    const moreCash = { ...tenEuros, tendered: "20.00" };

    expect(submissionFor("wo-1", moreCash, unanswered, ids("sub-2")).request).toEqual({
      ...tenEuros,
      submissionId: "sub-1",
    });
  });

  it("retains the complete unknown payment across an ownership and guest-count refresh", () => {
    const original = {
      ...tenEuros,
      expectedEdit: { billId: "wo-1", editorVersion: 2, draftId: null, draftRevision: null },
      guests: 4,
    };
    const first = submissionFor("wo-1", original, null, ids("sub-1"));
    const unanswered = unansweredAfter(first, noAnswer);
    const refreshed = {
      ...original,
      expectedEdit: { billId: "wo-1", editorVersion: 4, draftId: null, draftRevision: null },
      guests: 9,
      amount: "30.00",
      applied: "30.00",
    };

    expect(submissionFor("wo-1", refreshed, unanswered, ids("sub-2")).request).toEqual({
      ...original,
      submissionId: "sub-1",
    });
    expect(submissionFor("wo-1", refreshed, null, ids("sub-2")).request).toEqual({
      ...refreshed,
      submissionId: "sub-2",
    });
  });

  it("retains the original complete body when ownership changes after an authorization refusal", () => {
    const original = {
      ...tenEuros,
      expectedEdit: { billId: "wo-1", editorVersion: 2, draftId: null, draftRevision: null },
    };
    const first = submissionFor("wo-1", original, null, ids("sub-1"));
    const refused = unansweredAfter(first, { code: "session.expired", status: 401 });
    const refreshed = {
      ...original,
      expectedEdit: { billId: "wo-1", editorVersion: 4, draftId: null, draftRevision: null },
    };

    expect(submissionFor("wo-1", refreshed, refused, ids("sub-2")).request).toEqual({
      ...original,
      submissionId: "sub-1",
    });
  });

  it("is fresh for the same confirmation on another bill", () => {
    const unanswered = unansweredAfter(
      submissionFor("wo-1", tenEuros, null, ids("sub-1")),
      noAnswer,
    );

    expect(submissionFor("wo-2", tenEuros, unanswered, ids("sub-2")).request.submissionId).toBe(
      "sub-2",
    );
  });

  it.each([
    "draft.out_of_date",
    "draft.taken_over",
    "bill.unsent_dishes",
    "bill.allocation_changed",
  ])(
    "uses a fresh explicit payment after an initial %s refusal or a confirmed refusal of its unknown retry",
    (code) => {
      const original = {
        ...tenEuros,
        expectedEdit: {
          billId: "wo-1",
          editorVersion: 2,
          draftId: null,
          draftRevision: null,
        },
      };
      const first = submissionFor("wo-1", original, null, ids("sub-1"));
      const refused = unansweredAfter(first, { code, status: 409 });
      expect(refused).toBeNull();
      const refreshed = {
        ...original,
        expectedEdit: {
          billId: "wo-1",
          editorVersion: 4,
          draftId: null,
          draftRevision: null,
        },
      };
      expect(submissionFor("wo-1", refreshed, refused, ids("sub-2")).request).toEqual({
        ...refreshed,
        submissionId: "sub-2",
      });

      const unknown = unansweredAfter(first, noAnswer)!;
      const refusedRetry = unansweredAfter(unknown, { code, status: 409 });
      expect(refusedRetry).toBeNull();
      expect(submissionFor("wo-1", refreshed, refusedRetry, ids("sub-2")).request).toEqual({
        ...refreshed,
        submissionId: "sub-2",
      });
    },
  );

  it("is a new random id each time when no minting is given", () => {
    const first = submissionFor("wo-1", tenEuros, null).request.submissionId;
    const second = submissionFor("wo-1", tenEuros, null).request.submissionId;

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });
});

it.each(["draft.out_of_date", "draft.taken_over", "bill.unsent_dishes"])(
  "retains a refund submission after an unrelated ownership refusal %s",
  (code) => {
    const sent = refundSubmissionFor(
      "wo-1",
      "payment-1",
      {
        appliedAmount: "10.00",
        tipAmount: "0.00",
        reason: "Wrong bill",
      },
      null,
      () => "refund-sub-1",
    );
    expect(unansweredAfter(sent, { code, status: 409 })).toEqual(sent);
  },
);

describe("refusalOf", () => {
  it("keeps the code, and the field and most chargeable when the refusal names them as text", () => {
    expect(
      refusalOf({
        code: "bill.tip_not_allowed",
        status: 409,
        field: "addedTip",
        chargeable: "40.00",
      }),
    ).toEqual({ code: "bill.tip_not_allowed", field: "addedTip", chargeable: "40.00" });
    expect(refusalOf({ code: "management.request_invalid", field: 3, chargeable: 40 })).toEqual({
      code: "management.request_invalid",
    });
  });

  it("keeps the permission a refusal names as text", () => {
    expect(
      refusalOf({ code: "authorization.not_permitted", status: 403, permission: "sale.refund" }),
    ).toEqual({ code: "authorization.not_permitted", permission: "sale.refund" });
    expect(refusalOf({ code: "authorization.not_permitted", permission: 7 })).toEqual({
      code: "authorization.not_permitted",
    });
  });

  it("reads a refusal with no code of its own as the server's internal error", () => {
    expect(refusalOf({ status: 500 })).toEqual({ code: "server.internal" });
    expect(refusalOf({ code: 20 })).toEqual({ code: "server.internal" });
  });

  it("says a request that changes the bill and got no answer may have been made", () => {
    expect(refusalOf(new TypeError("Failed to fetch"))).toEqual({ code: "network" });
    expect(refusalOf(new DOMException("aborted", "AbortError"))).toEqual({ code: "network" });
  });

  it("reads no answer to a request that changes nothing as the server's internal error", () => {
    expect(refusalOf(new TypeError("Failed to fetch"), false)).toEqual({
      code: "server.internal",
    });
  });
});

describe("paidQuantities", () => {
  it("gives the quantity paid of each line by its number, the first listed when one is listed twice", () => {
    const paid = paidQuantities({
      workingOrderId: "wo-1",
      status: "open",
      total: "30.00",
      received: "15.00",
      reserved: "0.00",
      outstanding: "15.00",
      tips: "0.00",
      payments: [],
      paidLines: [
        { lineId: "line-1", lineNo: 1, paidQuantity: "1.000" },
        { lineId: "line-3", lineNo: 3, paidQuantity: "2.000" },
        { lineId: "line-3", lineNo: 3, paidQuantity: "9.000" },
      ],
    });

    expect([...paid]).toEqual([
      [1, "1.000"],
      [3, "2.000"],
    ]);
  });
});

describe("payLines", () => {
  const row = (over: Partial<TabLine>): TabLine => ({
    stationId: null,
    movable: false,
    id: `line-${over.lineNo}`,
    lineNo: 1,
    productId: "p",
    quantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "1.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    groupId: null,
    note: null,
    listId: null,
    menuItemId: null,
    parentProductId: null,
    ...over,
  });

  it("offers each dish with its extras, a unit at a time only when sold by the unit, in several units, with no extras", () => {
    const lines = [
      row({ lineNo: 1, name: "Beer", quantity: "3.000", unitPriceGross: "3.00" }),
      row({ lineNo: 2, name: "Burger", quantity: "2.000", unitPriceGross: "10.00" }),
      row({
        lineNo: 3,
        name: "Cheese",
        quantity: "2.000",
        unitPriceGross: "1.50",
        parentLineNo: 2,
      }),
      row({ lineNo: 4, name: "Ham", quantity: "0.250", unitPrecision: 3, unitPriceGross: "40.00" }),
      row({ lineNo: 5, name: "Tiramisu", unitPriceGross: "6.00" }),
    ];

    expect(payLines(lines, (line) => line.name!)).toEqual([
      { lineNo: 1, name: "Beer", quantity: "3", total: "9.00", unitTotal: "3.00" },
      { lineNo: 2, name: "Burger", quantity: "2", total: "23.00", unitTotal: null },
      { lineNo: 4, name: "Ham", quantity: "0.25", total: "10.00", unitTotal: null },
      { lineNo: 5, name: "Tiramisu", quantity: "1", total: "6.00", unitTotal: null },
    ]);
  });
});

describe("a payment's refunds", () => {
  const payment = (over: Partial<BillPaymentView> = {}): BillPaymentView => ({
    id: "pay-1",
    submissionId: "sub-1",
    kind: "contribution",
    shareOf: null,
    method: "card",
    entry: "reader",
    applied: "40.00",
    tip: "5.00",
    tendered: null,
    change: null,
    state: "received",
    createdAt: "2026-09-30T20:00:00.000Z",
    receivedAt: "2026-09-30T20:00:00.000Z",
    lines: [],
    refunds: [],
    ...over,
  });
  const refund = (
    appliedAmount: string,
    tipAmount: string,
    state: "pending" | "completed" | "failed",
  ) => ({
    id: `r-${appliedAmount}-${state}`,
    paymentId: "pay-1",
    submissionId: `s-${appliedAmount}-${state}`,
    appliedAmount,
    tipAmount,
    reason: "Mal cobrado",
    state,
    createdAt: "2026-09-30T20:10:00.000Z",
    completedAt: null,
  });

  it("leaves to give back what the payment took less its completed refunds, a failed one given back nothing", () => {
    const refunded = payment({
      refunds: [refund("10.00", "0.00", "completed"), refund("5.00", "0.00", "failed")],
    });

    expect(refundableOf(payment())).toEqual({ applied: "40.00", tip: "5.00" });
    expect(refundableOf(refunded)).toEqual({ applied: "30.00", tip: "5.00" });
  });

  it("offers a refund only of a received payment on an open bill with money left on it and no refund waiting", () => {
    expect(refundOffered(payment(), "open")).toBe(true);
    expect(refundOffered(payment({ state: "pending" }), "open")).toBe(false);
    expect(refundOffered(payment({ state: "declined" }), "open")).toBe(false);
    expect(refundOffered(payment(), "settled")).toBe(false);
    expect(
      refundOffered(payment({ refunds: [refund("40.00", "5.00", "completed")] }), "open"),
    ).toBe(false);
    expect(refundOffered(payment({ refunds: [refund("10.00", "0.00", "pending")] }), "open")).toBe(
      false,
    );
  });

  it("sends a refund that got no answer again under its submission id, and a new one under a fresh id", () => {
    const ask = { appliedAmount: "10.00", tipAmount: "0.00", reason: "Mal cobrado" };
    const mint = (() => {
      const queue = ["sub-1", "sub-2", "sub-3"];
      return () => queue.shift()!;
    })();

    const first = refundSubmissionFor("wo-1", "pay-1", ask, null, mint);
    const again = refundSubmissionFor(
      "wo-1",
      "pay-1",
      ask,
      unansweredAfter(first, new TypeError("Failed to fetch")),
      mint,
    );
    const confirmed = refundSubmissionFor(
      "wo-1",
      "pay-1",
      { ...ask, manualConfirmed: true },
      unansweredAfter(again, new TypeError("Failed to fetch")),
      mint,
    );
    const otherPayment = refundSubmissionFor(
      "wo-1",
      "pay-2",
      ask,
      unansweredAfter(first, new TypeError("Failed to fetch")),
      mint,
    );

    expect(first.request).toEqual({ ...ask, submissionId: "sub-1" });
    expect(first.key).toBe(JSON.stringify(["wo-1", "pay-1", ask]));
    expect(again.request.submissionId).toBe("sub-1");
    expect(confirmed.request).toEqual({ ...ask, manualConfirmed: true, submissionId: "sub-2" });
    expect(otherPayment.request.submissionId).toBe("sub-3");
  });
});

describe("a bill's payment that got no answer", () => {
  const tenEuros = confirmationOf(
    paymentAsk({ kind: "contribution", amount: "10.00" }, { method: "cash", tendered: "10.00" }),
    {
      kind: "allocated",
      choice: null,
      applied: "10.00",
      tip: "0.00",
      change: "0.00",
      charged: null,
    },
  );
  const sent = (billId: string, submissionId: string) =>
    submissionFor(billId, tenEuros, null, () => submissionId);
  const none: PendingPayments = new Map();
  const noAnswer = new TypeError("Failed to fetch");
  const internal = { code: "server.internal", status: 502 };
  const FRESH_ID_AFTER = [
    "submission.id_reused",
    "device.profile_changed",
    "reader.not_held",
    "reader.payment_in_progress",
  ];

  /** Mesa 4's send `sub-1`, turn 1 from dialog 7, ended at tick 5 with `error`. */
  const ended = (error?: unknown, pending: PendingPayments = none) =>
    sendEnded(sendStarted(pending, "wo-4", sent("wo-4", "sub-1"), 1, 7), "wo-4", 1, 5, error);
  /** Mesa 4's send `sub-1`, after an attempt of it got no answer, ended with `error`. */
  const endedAfterNoAnswer = (error?: unknown) =>
    sendEnded(
      sendUnanswered(sendStarted(none, "wo-4", sent("wo-4", "sub-1"), 1, 7), "wo-4", 1),
      "wo-4",
      1,
      5,
      error,
    );

  const payment = (submissionId: string, state: BillPaymentView["state"]): BillPaymentView => ({
    id: `pay-${submissionId}`,
    submissionId,
    kind: "contribution",
    shareOf: null,
    method: "cash",
    entry: null,
    applied: "10.00",
    tip: "0.00",
    tendered: "10.00",
    change: "0.00",
    state,
    createdAt: "2026-10-19T20:00:00.000Z",
    receivedAt: null,
    lines: [],
    refunds: [],
  });
  const balance = (workingOrderId: string, payments: BillPaymentView[]): BillBalance => ({
    workingOrderId,
    status: "open",
    total: "40.00",
    received: "0.00",
    reserved: "0.00",
    outstanding: "40.00",
    tips: "0.00",
    payments,
    paidLines: [],
  });

  describe("rule 1: isUncertainFailure", () => {
    it.each([
      ["a network failure", noAnswer],
      ["an aborted request", new DOMException("aborted", "AbortError")],
      [
        "a status of 500 or more with a code",
        { code: "reader.provider_disconnected", status: 503 },
      ],
      ["a coded error at exactly 500", { code: "reader.provider_disconnected", status: 500 }],
      ["a code-less error", { status: 400 }],
      ["server.internal", { code: "server.internal", status: 400 }],
    ])("is true for %s", (_name, error) => {
      expect(isUncertainFailure(error)).toBe(true);
    });

    it.each([
      [
        "reader.provider_disconnected at 409",
        { code: "reader.provider_disconnected", status: 409 },
      ],
      ["bill.nothing_outstanding at 409", { code: "bill.nothing_outstanding", status: 409 }],
      ["a coded error with a status of 499", { code: "session.required", status: 499 }],
    ])("is false for %s", (_name, error) => {
      expect(isUncertainFailure(error)).toBe(false);
    });
  });

  describe("rule 2: sendStarted", () => {
    it("writes the bill's entry in flight", () => {
      const submission = sent("wo-4", "sub-1");

      expect(sendStarted(none, "wo-4", submission, 1, 7).get("wo-4")).toEqual({
        billId: "wo-4",
        submission,
        turn: 1,
        dialogId: 7,
        inFlight: true,
        uncertain: false,
        endedTick: 0,
        refusal: null,
      } satisfies PendingSend);
    });

    it("keeps uncertain and the refusal when the same submission id is sent again", () => {
      const before = ended({ code: "reader.not_held", status: 409 }, endedAfterNoAnswer(noAnswer));
      const again = sendStarted(before, "wo-4", sent("wo-4", "sub-1"), 2, 8).get("wo-4")!;

      expect(again).toMatchObject({
        turn: 2,
        dialogId: 8,
        inFlight: true,
        endedTick: 0,
        uncertain: true,
        refusal: { code: "reader.not_held" },
      });
    });

    it("starts certain with no refusal under a new submission id", () => {
      const before = endedAfterNoAnswer({ code: "reader.not_held", status: 409 });
      const fresh = sendStarted(before, "wo-4", sent("wo-4", "sub-2"), 2, 7).get("wo-4")!;

      expect(fresh.submission.request.submissionId).toBe("sub-2");
      expect(fresh.uncertain).toBe(false);
      expect(fresh.refusal).toBeNull();
    });

    it("does not change the map it is given", () => {
      sendStarted(none, "wo-4", sent("wo-4", "sub-1"), 1, 7);

      expect(none.size).toBe(0);
    });
  });

  describe("rule 3: sendUnanswered", () => {
    it("marks the send uncertain at once, while it is still in flight", () => {
      const started = sendStarted(none, "wo-4", sent("wo-4", "sub-1"), 1, 7);
      const entry = sendUnanswered(started, "wo-4", 1).get("wo-4")!;

      expect(entry.uncertain).toBe(true);
      expect(entry.inFlight).toBe(true);
      expect(started.get("wo-4")!.uncertain).toBe(false);
    });

    it("changes nothing for an older turn's attempt", () => {
      const started = sendStarted(none, "wo-4", sent("wo-4", "sub-1"), 2, 7);

      expect(sendUnanswered(started, "wo-4", 1)).toBe(started);
    });

    it("changes nothing for a bill with no entry", () => {
      expect(sendUnanswered(none, "wo-4", 1)).toBe(none);
    });
  });

  describe("rule 4: sendEnded", () => {
    it("removes the entry on a result", () => {
      expect(ended().has("wo-4")).toBe(false);
    });

    it("is uncertain after a network failure", () => {
      expect(ended(noAnswer).get("wo-4")).toMatchObject({
        inFlight: false,
        endedTick: 5,
        uncertain: true,
        refusal: null,
      });
    });

    it("is uncertain with no refusal after a code-less server.internal at 502", () => {
      expect(ended(internal).get("wo-4")).toMatchObject({ uncertain: true, refusal: null });
    });

    it("is uncertain and records the code after a coded error of 500 or more", () => {
      expect(
        ended({ code: "reader.provider_disconnected", status: 503 }).get("wo-4"),
      ).toMatchObject({ uncertain: true, refusal: { code: "reader.provider_disconnected" } });
    });

    it("keeps a first send certain after reader.provider_disconnected at 409", () => {
      expect(
        ended({ code: "reader.provider_disconnected", status: 409 }).get("wo-4"),
      ).toMatchObject({
        inFlight: false,
        uncertain: false,
        refusal: { code: "reader.provider_disconnected" },
      });
    });

    it("keeps a certain send certain after bill.nothing_outstanding", () => {
      expect(ended({ code: "bill.nothing_outstanding", status: 409 }).get("wo-4")).toMatchObject({
        uncertain: false,
        refusal: { code: "bill.nothing_outstanding" },
      });
    });

    it.each(["reader.not_held", "device.profile_changed"])(
      "stays uncertain after an attempt got no answer and the retry was refused with %s",
      (code) => {
        expect(endedAfterNoAnswer({ code, status: 409 }).get("wo-4")).toMatchObject({
          inFlight: false,
          uncertain: true,
          refusal: { code },
        });
      },
    );

    it.each([
      "reader.not_held",
      "reader.payment_in_progress",
      "device.profile_changed",
      "submission.id_reused",
      "session.required",
    ])("keeps an uncertain entry uncertain after %s", (code) => {
      const uncertain = ended(noAnswer);
      const again = sendStarted(uncertain, "wo-4", sent("wo-4", "sub-1"), 2, 7);

      expect(sendEnded(again, "wo-4", 2, 9, { code, status: 409 }).get("wo-4")).toMatchObject({
        endedTick: 9,
        uncertain: true,
        refusal: { code },
      });
    });

    it.each([
      ["a network failure", noAnswer],
      ["a code-less server.internal at 502", internal],
    ])("keeps the earlier refusal of a resend of the same id that ends with %s", (_name, error) => {
      const refused = ended({ code: "reader.not_held", status: 409 }, endedAfterNoAnswer(noAnswer));
      const again = sendStarted(refused, "wo-4", sent("wo-4", "sub-1"), 2, 7);

      expect(sendEnded(again, "wo-4", 2, 9, error).get("wo-4")).toMatchObject({
        uncertain: true,
        refusal: { code: "reader.not_held" },
      });
    });

    it.each(FRESH_ID_AFTER)("removes a certain send after %s", (code) => {
      expect(ended({ code, status: 409 }).has("wo-4")).toBe(false);
    });

    it("leaves Mesa 4's uncertain entry when Mesa 9's send gets a result", () => {
      const mesa4 = ended(noAnswer);
      const both = sendStarted(mesa4, "wo-9", sent("wo-9", "sub-9"), 2, 7);
      const after = sendEnded(both, "wo-9", 2, 6);

      expect(after.has("wo-9")).toBe(false);
      expect(after.get("wo-4")).toBe(mesa4.get("wo-4"));
    });

    it("changes nothing for an older turn's answer", () => {
      const first = sendStarted(none, "wo-4", sent("wo-4", "sub-1"), 1, 7);
      const second = sendStarted(first, "wo-4", sent("wo-4", "sub-2"), 2, 7);

      expect(sendEnded(second, "wo-4", 1, 5)).toBe(second);
      expect(sendEnded(second, "wo-4", 1, 5, noAnswer)).toBe(second);
    });

    it("changes nothing for a bill with no entry", () => {
      expect(sendEnded(none, "wo-4", 1, 5)).toBe(none);
    });
  });

  describe("rule 5: settledByBalance", () => {
    it.each(["pending", "received", "failed", "declined"] as const)(
      "removes the entry whose submission id the balance lists as %s, and returns it as found",
      (state) => {
        const pending = ended(noAnswer);
        const paid = payment("sub-1", state);
        const settled = settledByBalance(
          pending,
          balance("wo-4", [payment("sub-0", "received"), paid]),
          6,
        );

        expect(settled.pending.has("wo-4")).toBe(false);
        expect(settled.found).toEqual({ payment: paid, entry: pending.get("wo-4") });
        expect(settled.freed).toBeNull();
      },
    );

    it("keeps an uncertain entry absent from the balance, made certain, and returns it as freed", () => {
      const pending = ended({ code: "reader.not_held", status: 409 }, endedAfterNoAnswer(noAnswer));
      const settled = settledByBalance(pending, balance("wo-4", [payment("sub-0", "received")]), 6);
      const kept = settled.pending.get("wo-4")!;

      expect(kept).toEqual({ ...pending.get("wo-4")!, uncertain: false });
      expect(settled.freed).toEqual(kept);
      expect(settled.found).toBeNull();
      expect(
        submissionFor("wo-4", tenEuros, kept.submission, () => "sub-2").request.submissionId,
      ).toBe("sub-1");
    });

    it("removes a certain kept entry whose submission id the balance lists, and returns it as found", () => {
      const pending = ended({ code: "bill.nothing_outstanding", status: 409 });
      const paid = payment("sub-1", "received");
      const settled = settledByBalance(pending, balance("wo-4", [paid]), 6);

      expect(settled.pending.has("wo-4")).toBe(false);
      expect(settled.found).toEqual({ payment: paid, entry: pending.get("wo-4") });
      expect(settled.freed).toBeNull();
    });

    it("leaves a certain entry absent from the balance as it is", () => {
      const pending = ended({ code: "bill.nothing_outstanding", status: 409 });
      const settled = settledByBalance(pending, balance("wo-4", []), 6);

      expect(settled).toEqual({ pending, found: null, freed: null });
    });

    it("does nothing with a read sent before the send ended", () => {
      const pending = ended(noAnswer);

      expect(settledByBalance(pending, balance("wo-4", [payment("sub-1", "received")]), 5)).toEqual(
        { pending, found: null, freed: null },
      );
      expect(settledByBalance(pending, balance("wo-4", []), 4)).toEqual({
        pending,
        found: null,
        freed: null,
      });
    });

    it("does nothing while the send is in flight", () => {
      const pending = sendUnanswered(
        sendStarted(none, "wo-4", sent("wo-4", "sub-1"), 1, 7),
        "wo-4",
        1,
      );

      expect(settledByBalance(pending, balance("wo-4", [payment("sub-1", "received")]), 6)).toEqual(
        { pending, found: null, freed: null },
      );
      expect(settledByBalance(pending, balance("wo-4", []), 6)).toEqual({
        pending,
        found: null,
        freed: null,
      });
    });

    it("acts only on the entry of the balance's own bill", () => {
      const pending = ended(noAnswer);

      expect(settledByBalance(pending, balance("wo-9", [payment("sub-1", "received")]), 6)).toEqual(
        { pending, found: null, freed: null },
      );
    });
  });

  describe("rule 6: lockFor", () => {
    it("returns an uncertain entry for any dialog, in flight or not", () => {
      const ended4 = ended(noAnswer);
      const inFlight = sendUnanswered(
        sendStarted(none, "wo-4", sent("wo-4", "sub-1"), 1, 7),
        "wo-4",
        1,
      );
      const checkingAgain = sendStarted(ended4, "wo-4", sent("wo-4", "sub-1"), 2, 7);

      for (const pending of [ended4, inFlight, checkingAgain])
        for (const dialogId of [7, 8])
          expect(lockFor(pending, "wo-4", dialogId)).toBe(pending.get("wo-4"));
    });

    it("returns a certain send in flight only for another dialog than the one that sent it", () => {
      const pending = sendStarted(none, "wo-4", sent("wo-4", "sub-1"), 1, 7);

      expect(lockFor(pending, "wo-4", 7)).toBeNull();
      expect(lockFor(pending, "wo-4", 8)).toBe(pending.get("wo-4"));
    });

    it("returns null for a certain kept entry", () => {
      const pending = ended({ code: "bill.nothing_outstanding", status: 409 });

      expect(lockFor(pending, "wo-4", 8)).toBeNull();
    });

    it("returns null for another bill", () => {
      expect(lockFor(ended(noAnswer), "wo-9", 7)).toBeNull();
    });
  });

  describe("rule 7: holdsReload", () => {
    it("is true while a send is in flight or uncertain", () => {
      expect(holdsReload(sendStarted(none, "wo-4", sent("wo-4", "sub-1"), 1, 7))).toBe(true);
      expect(holdsReload(ended(noAnswer))).toBe(true);
    });

    it("is false for a certain kept entry, and for none", () => {
      const certain = ended({ code: "bill.nothing_outstanding", status: 409 });
      const alsoCertain = sendEnded(
        sendStarted(certain, "wo-9", sent("wo-9", "sub-9"), 2, 7),
        "wo-9",
        2,
        6,
        { code: "bill.nothing_outstanding", status: 409 },
      );

      expect(holdsReload(alsoCertain)).toBe(false);
      expect(holdsReload(none)).toBe(false);
    });
  });

  describe("rule 8: submissionFor takes the bill's own entry", () => {
    it("reuses Mesa 4's kept id for Mesa 4, and not for Mesa 9", () => {
      const pending = ended(noAnswer);
      const mint = () => "sub-2";

      expect(
        submissionFor("wo-4", tenEuros, pending.get("wo-4")?.submission ?? null, mint).request
          .submissionId,
      ).toBe("sub-1");
      expect(
        submissionFor("wo-9", tenEuros, pending.get("wo-9")?.submission ?? null, mint).request
          .submissionId,
      ).toBe("sub-2");
    });
  });
});
