import { describe, expect, it } from "vitest";
import type { BillPaymentView, TabLine } from "../api/client.js";
import {
  confirmationOf,
  payLines,
  paymentAsk,
  refundOffered,
  refundSubmissionFor,
  refundableOf,
  submissionFor,
  unansweredAfter,
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
      kind: "items",
      lines: [{ lineNo: 1 }, { lineNo: 3, quantity: "2" }],
      method: "card",
    });
  });

  it("asks for a contribution with the cash handed over", () => {
    expect(
      paymentAsk({ kind: "contribution", amount: "25.00" }, { method: "cash", tendered: "50.00" }),
    ).toEqual({ kind: "contribution", amount: "25.00", method: "cash", tendered: "50.00" });
  });

  it("asks for an equal share by how many people are still to pay, leaving the share to the server", () => {
    expect(paymentAsk({ kind: "share", shareOf: 3 }, { method: "card" })).toEqual({
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
      kind: "contribution",
      amount: "40.00",
      method: "cash",
      tendered: "50.00",
      addedTip: "10.00",
    });
    expect(
      paymentAsk({ kind: "items", picks: [{ lineNo: 2 }] }, { method: "card", addedTip: "10.00" }),
    ).toEqual({ kind: "items", lines: [{ lineNo: 2 }], method: "card", addedTip: "10.00" });
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

  it("is fresh once the server says the id is taken by another request", () => {
    const first = submissionFor("wo-1", tenEuros, null, ids("sub-1"));
    const unanswered = unansweredAfter(first, { code: "submission.id_reused", status: 409 });

    expect(unanswered).toBeNull();
    expect(submissionFor("wo-1", tenEuros, unanswered, ids("sub-2")).request.submissionId).toBe(
      "sub-2",
    );
  });

  it("is fresh for a different confirmation, even while an earlier one is unanswered", () => {
    const unanswered = unansweredAfter(
      submissionFor("wo-1", tenEuros, null, ids("sub-1")),
      noAnswer,
    );
    const moreCash = { ...tenEuros, tendered: "20.00" };

    expect(submissionFor("wo-1", moreCash, unanswered, ids("sub-2")).request.submissionId).toBe(
      "sub-2",
    );
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

  it("is a new random id each time when no minting is given", () => {
    const first = submissionFor("wo-1", tenEuros, null).request.submissionId;
    const second = submissionFor("wo-1", tenEuros, null).request.submissionId;

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });
});

describe("payLines", () => {
  const row = (over: Partial<TabLine>): TabLine => ({
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
    expect(again.request.submissionId).toBe("sub-1");
    expect(confirmed.request).toEqual({ ...ask, manualConfirmed: true, submissionId: "sub-2" });
    expect(otherPayment.request.submissionId).toBe("sub-3");
  });
});
