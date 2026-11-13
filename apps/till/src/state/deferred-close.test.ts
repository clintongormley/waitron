import { describe, expect, it } from "vitest";
import { billOf, paymentOf } from "../../test/bill-pay-app.js";
import type { BillRefundView } from "../api/client.js";
import {
  type DeferredDishRow,
  type DeferredOfferInput,
  deferredCloseRequest,
  deferredGoneReason,
  deferredOffered,
  paymentsHoldMoney,
} from "./deferred-close.js";

const dish = (over: Partial<DeferredDishRow> = {}): DeferredDishRow => ({
  workingOrderId: "wo-4",
  quantity: "2",
  servedQuantity: "2",
  servedAt: "2026-11-12T13:00:00.000Z",
  ...over,
});

function input(over: Partial<DeferredOfferInput> = {}): DeferredOfferInput {
  return {
    capabilities: ["take-orders", "close-deferred"],
    bill: billOf({ outstanding: "120.00", total: "120.00" }),
    paymentUnconfirmed: false,
    currentOrdersUnread: false,
    currentOrders: { groups: [{ rows: [dish()] }], ungrouped: [dish({ quantity: "1" })] },
    ...over,
  };
}

describe("deferredOffered", () => {
  it("offers the close only when every condition holds", () => {
    const cases: [string, Partial<DeferredOfferInput>, ReturnType<typeof deferredOffered>][] = [
      ["every condition holds", {}, { state: "offered" }],
      ["a presented bill", { bill: billOf({ status: "placed" }) }, { state: "offered" }],
      [
        "a part served and the rest cancelled",
        {
          currentOrders: {
            groups: [],
            ungrouped: [
              dish({ quantity: "3", servedQuantity: "1", cancelledQuantity: "2", servedAt: null }),
            ],
          },
        },
        { state: "offered" },
      ],
      [
        "another bill's dish unserved",
        {
          currentOrders: {
            groups: [{ rows: [dish(), dish({ workingOrderId: "wo-9", servedAt: null })] }],
            ungrouped: [],
          },
        },
        { state: "offered" },
      ],
      ["the profile lacks close-deferred", { capabilities: ["take-orders"] }, { state: "hidden" }],
      [
        "the bill holds money",
        { bill: billOf({ hasPayments: true, holdsMoney: true }) },
        { state: "hidden" },
      ],
      [
        "the bill's payments were all given back in full",
        { bill: billOf({ hasPayments: true }) },
        { state: "offered" },
      ],
      ["the bill owes nothing", { bill: billOf({ outstanding: "0.00" }) }, { state: "hidden" }],
      ["the bill is settled", { bill: billOf({ status: "settled" }) }, { state: "hidden" }],
      ["the bill is abandoned", { bill: billOf({ status: "abandoned" }) }, { state: "hidden" }],
      [
        "a payment's outcome is unknown",
        { paymentUnconfirmed: true },
        { state: "off", reason: "deferred_close.payment_unconfirmed" },
      ],
      [
        "a dish of the bill is not served",
        {
          currentOrders: {
            groups: [{ rows: [dish({ servedQuantity: "1", servedAt: null })] }],
            ungrouped: [],
          },
        },
        { state: "off", reason: "deferred_close.unserved" },
      ],
      [
        "an ungrouped dish of the bill is not served",
        {
          currentOrders: {
            groups: [],
            ungrouped: [dish({ servedQuantity: "0", servedAt: null })],
          },
        },
        { state: "off", reason: "deferred_close.unserved" },
      ],
      [
        "Current orders are still being read",
        { currentOrders: null },
        { state: "off", reason: "table.loading" },
      ],
      [
        "Current orders could not be read",
        { currentOrders: null, currentOrdersUnread: true },
        { state: "off", reason: "deferred_close.orders_unread" },
      ],
      [
        "a Counter bill, whose dishes are not checked",
        { counter: { fullInvoice: false }, currentOrders: null, currentOrdersUnread: true },
        { state: "offered" },
      ],
      [
        "a Counter bill staged for a full invoice",
        { counter: { fullInvoice: true }, currentOrders: null },
        { state: "off", reason: "deferred_close.counter_full_invoice" },
      ],
      [
        "a Counter bill whose payment's outcome is unknown",
        { counter: { fullInvoice: false }, currentOrders: null, paymentUnconfirmed: true },
        { state: "off", reason: "deferred_close.payment_unconfirmed" },
      ],
      [
        "a Counter bill holding money",
        { counter: { fullInvoice: true }, bill: billOf({ hasPayments: true, holdsMoney: true }) },
        { state: "hidden" },
      ],
    ];
    for (const [name, over, expected] of cases)
      expect([name, deferredOffered(input(over))]).toEqual([name, expected]);
  });
});

describe("deferredGoneReason", () => {
  it("names why the bill can no longer be closed this way, the first that applies", () => {
    const cases: [string, Parameters<typeof deferredGoneReason>[0], string | undefined][] = [
      ["the bill is gone", undefined, undefined],
      [
        "a payment settled it",
        billOf({ hasPayments: true, holdsMoney: true, status: "settled", outstanding: "0.00" }),
        "prior_payment",
      ],
      ["a payment given back in full", billOf({ hasPayments: true }), undefined],
      ["settled with no payment", billOf({ status: "settled" }), "final_without_deferral"],
      ["abandoned", billOf({ status: "abandoned" }), "void"],
      ["owes nothing", billOf({ outstanding: "0.00" }), "non_positive"],
      ["still closable", billOf({ outstanding: "120.00" }), undefined],
    ];
    for (const [name, bill, expected] of cases)
      expect([name, deferredGoneReason(bill)]).toEqual([name, expected]);
  });
});

describe("deferredCloseRequest", () => {
  const party = {
    id: "v1",
    revision: 7,
    expectedEdits: [{ billId: "wo-4", editorVersion: 3, draftId: null, draftRevision: null }],
  };
  const expectedEdit = party.expectedEdits[0]!;
  const recipient = {
    taxId: "B12345678",
    legalName: "Talleres Mar SL",
    address: "Carrer Major 1, Valencia",
    countryCode: "ES",
  };

  it("builds the request from the bill, sending an issued invoice's language as stored", () => {
    const bill = billOf({
      revision: 5,
      total: "120.00",
      outstanding: "120.00",
      invoiceType: "F1",
      recipient,
      invoiceDelivery: { medium: "email", recipient: "cuentas@talleresmar.es" },
      invoiceNumber: "A/12",
      receiptLanguage: "ca",
    });
    const { submissionId, ...body } = deferredCloseRequest({
      bill,
      offeredLanguages: ["es", "en"],
      expectedEdit,
      party,
    });

    expect(submissionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toEqual({
      expectedRevision: 5,
      expectedEdit,
      expectedTotal: "120.00",
      invoiceType: "F1",
      recipient,
      receiptLanguage: "ca",
      delivery: { medium: "email", recipient: "cuentas@talleresmar.es" },
      partyFinish: { partyId: "v1", expectedPartyRevision: 7, expectedEdits: party.expectedEdits },
    });
  });

  it("sends the shown receipt language for a bill with no invoice yet", () => {
    const request = (receiptLanguage: string | undefined) =>
      deferredCloseRequest({
        bill: billOf({ receiptLanguage }),
        offeredLanguages: ["es", "en"],
        expectedEdit: null,
        party: null,
      });

    expect(request("ca")).toMatchObject({
      receiptLanguage: "es",
      expectedEdit: null,
      delivery: null,
      invoiceType: "F2",
      recipient: null,
      partyFinish: null,
    });
    expect(request("en").receiptLanguage).toBe("en");
  });

  it("gives every request a new submission id", () => {
    const args = { bill: billOf(), offeredLanguages: ["es"], expectedEdit: null, party: null };
    expect(deferredCloseRequest(args).submissionId).not.toBe(
      deferredCloseRequest(args).submissionId,
    );
  });
});

describe("paymentsHoldMoney", () => {
  const refund = (over: Partial<BillRefundView>): BillRefundView => ({
    id: "refund-1",
    paymentId: "pay-1",
    submissionId: "refund-sub-1",
    appliedAmount: "10.00",
    tipAmount: "0.00",
    reason: "error",
    state: "completed",
    createdAt: "2026-09-30T20:05:00.000Z",
    completedAt: "2026-09-30T20:05:00.000Z",
    ...over,
  });
  const received = (refunds: BillRefundView[], tip = "0.00") =>
    paymentOf({ applied: "10.00", tip, state: "received", refunds });

  it("holds money as the server's close reads it: pending, or received and not all given back", () => {
    const cases: [string, Parameters<typeof paymentsHoldMoney>[0], boolean][] = [
      ["no payment", [], false],
      ["a pending card", [paymentOf({ method: "card", state: "pending" })], true],
      ["a received payment", [received([])], true],
      ["a declined card", [paymentOf({ method: "card", state: "declined" })], false],
      ["a failed card", [paymentOf({ method: "card", state: "failed" })], false],
      ["given back in full", [received([refund({})])], false],
      [
        "given back in full over two refunds, tip included",
        [
          received(
            [
              refund({ appliedAmount: "6.00" }),
              refund({ id: "refund-2", appliedAmount: "4.00", tipAmount: "1.00" }),
            ],
            "1.00",
          ),
        ],
        false,
      ],
      ["given back in part", [received([refund({ appliedAmount: "5.00" })])], true],
      ["its money given back but not its tip", [received([refund({})], "1.00")], true],
      [
        "a refund still pending",
        [received([refund({ state: "pending", completedAt: null })])],
        true,
      ],
      ["a refund that failed", [received([refund({ state: "failed", completedAt: null })])], true],
      [
        "one given back in full beside one still held",
        [received([refund({})]), received([])],
        true,
      ],
    ];
    for (const [name, payments, expected] of cases)
      expect([name, paymentsHoldMoney(payments)]).toEqual([name, expected]);
  });
});
