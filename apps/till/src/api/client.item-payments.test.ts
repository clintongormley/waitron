import { describe, expect, it, vi } from "vitest";
import { TillApi, type BillBalance } from "./client.js";
import type {
  ItemPaymentAsk,
  ItemPaymentPreview,
  ItemPaymentRequest,
  ItemPaymentResult,
} from "./item-payment-types.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const balance: BillBalance = {
  workingOrderId: "wo-9",
  status: "settled",
  total: "17.50",
  received: "17.50",
  reserved: "0.00",
  outstanding: "0.00",
  overpaid: "0.00",
  tips: "0.00",
  payments: [],
  paidLines: [],
};

describe("TillApi: Pay for items", () => {
  it("previewItemPayment POSTs the picks and payment to the items preview route", async () => {
    const ask: ItemPaymentAsk = {
      picks: [{ lineId: "line-1", quantity: "1" }, { lineId: "line-2" }],
      method: "cash",
      tendered: "20",
    };
    const preview: ItemPaymentPreview = {
      total: "17.50",
      applied: "17.50",
      tip: "0.00",
      change: "2.50",
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(preview));

    await expect(new TillApi("", fetchStub).previewItemPayment("wo-4", ask)).resolves.toEqual(
      preview,
    );
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo-4/item-payments/preview",
      expect.objectContaining({ method: "POST", body: JSON.stringify(ask) }),
    );
  });

  it("payForItems POSTs the request under the caller's signal and answers the new bill and its payment", async () => {
    const request: ItemPaymentRequest = {
      submissionId: "sub-1",
      picks: [{ lineId: "line-1" }],
      expectedEdits: [{ billId: "wo-4", editorVersion: 2, draftId: null, draftRevision: null }],
      expectedPartyRevision: 3,
      partyId: "v1",
      method: "card",
      applied: "17.50",
      tip: "0.00",
      externalRef: "OP-9",
      externalProvider: "other",
    };
    const answer: ItemPaymentResult = {
      billId: "wo-9",
      payment: {
        outcome: "received",
        payment: {
          id: "pay-1",
          submissionId: "sub-1",
          kind: "share",
          shareOf: 1,
          method: "card",
          entry: "manual",
          applied: "17.50",
          tip: "0.00",
          tendered: null,
          change: null,
          state: "received",
          createdAt: "2026-11-24T20:00:00.000Z",
          receivedAt: "2026-11-24T20:00:00.000Z",
          lines: [],
          refunds: [],
        },
        balance,
      },
      sourceBalance: { ...balance, workingOrderId: "wo-4" },
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(answer));
    const signal = new AbortController().signal;

    await expect(
      new TillApi("", fetchStub).payForItems("wo-4", request, { signal }),
    ).resolves.toEqual(answer);
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo-4/item-payments",
      expect.objectContaining({ method: "POST", body: JSON.stringify(request), signal }),
    );
  });

  it("keepOverpaidAsTip POSTs the submission id and the amount staff saw under the caller's signal and answers the balance", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(balance));
    const signal = new AbortController().signal;

    await expect(
      new TillApi("", fetchStub).keepOverpaidAsTip("wo-4", "sub-7", "5.00", { signal }),
    ).resolves.toEqual(balance);
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo-4/overpaid/keep-as-tip",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ submissionId: "sub-7", overpaid: "5.00" }),
        signal,
      }),
    );
  });
});
