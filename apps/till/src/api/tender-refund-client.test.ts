import { describe, expect, it, vi } from "vitest";
import { TillApi } from "./client.js";

const view = {
  id: "refund/1",
  saleId: "sale/1",
  tenderId: "cash-1",
  state: "pending",
  appliedAmount: "12.50",
  tipAmount: "1.00",
  createdAt: "2026-10-16T12:00:00.000Z",
  completedAt: null,
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("settled tender refund client", () => {
  it.each([
    ["balance", "/api/transactions/sale%2F1/refundable-tenders"],
    ["status", "/api/tender-refunds/refund%2F1"],
  ])("reads scoped %s with cancellation and encoded identity", async (kind, url) => {
    const body =
      kind === "balance"
        ? [
            {
              tenderId: "cash-1",
              method: "cash",
              last4: null,
              appliedRemaining: "12.50",
              tipRemaining: "1.00",
              pendingRefundId: "refund/1",
              manual: false,
            },
          ]
        : view;
    const fetcher = vi.fn().mockResolvedValue(response(body));
    const api = new TillApi("", fetcher);
    const signal = new AbortController().signal;
    const result =
      kind === "balance"
        ? await api.getRefundableTenders("sale/1", { signal })
        : await api.getTenderRefund("refund/1", { signal });
    expect(result).toEqual(body);
    expect(fetcher).toHaveBeenCalledWith(url, { method: "GET", credentials: "include", signal });
  });

  it("sends the complete immutable request and returns its attempt instead of an invoice", async () => {
    const request = {
      submissionId: "submission-1",
      tenderId: "cash-1",
      appliedAmount: "12.50",
      tipAmount: "1.00",
      reason: "Guest returned",
      cashConfirmed: true,
      manualConfirmed: false,
      override: { personId: "manager", pin: "0123" },
    };
    const fetcher = vi.fn().mockResolvedValue(response(view));
    expect(await new TillApi("", fetcher).refundTransaction("sale/1", request)).toEqual(view);
    expect(fetcher).toHaveBeenCalledWith("/api/transactions/sale%2F1/refunds", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  });

  it.each([undefined, { personId: "manager", pin: "0123" }])(
    "retries the same attempt with current authorization %j",
    async (override) => {
      const fetcher = vi.fn().mockResolvedValue(response(view));
      expect(await new TillApi("", fetcher).retryTenderRefund("refund/1", override)).toEqual(view);
      expect(fetcher).toHaveBeenCalledWith("/api/tender-refunds/refund%2F1/retry", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(override === undefined ? {} : { override }),
      });
    },
  );

  it("keeps a permission refusal available for operator-first PIN fallback", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ error: { code: "authorization.not_permitted" } }, 403));
    await expect(new TillApi("", fetcher).retryTenderRefund("refund/1")).rejects.toMatchObject({
      code: "authorization.not_permitted",
    });
  });
});

it("reads the separate refund acknowledgment with cancellation and an encoded refund id", async () => {
  const body = {
    refund: { ...view, state: "completed", completedAt: "2026-10-16T12:01:00.000Z" },
    invoiceNumber: "A/12",
    issuer: { venueName: "Original issuer", nif: "61000002T" },
    customerName: null,
    method: "cash",
    last4: null,
  };
  const fetcher = vi.fn().mockResolvedValue(response(body));
  const api = new TillApi("", fetcher),
    signal = new AbortController().signal;
  expect(api.getTenderRefundAcknowledgment).toBeTypeOf("function");
  expect(await api.getTenderRefundAcknowledgment("refund/1", { signal })).toEqual(body);
  expect(fetcher).toHaveBeenCalledWith("/api/tender-refunds/refund%2F1/receipt", {
    method: "GET",
    credentials: "include",
    signal,
  });
});
it.each([undefined, "es-ES"])(
  "reprints a payment acknowledgment in language %j without posting another refund",
  async (language) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const api = new TillApi("", fetcher);
    expect(api.reprintTenderRefund).toBeTypeOf("function");
    await api.reprintTenderRefund("refund/1", language);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/tender-refunds/refund%2F1/reprint", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(language === undefined ? {} : { language }),
    });
  },
);
