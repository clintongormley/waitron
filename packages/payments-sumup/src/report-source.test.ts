import { describe, expect, it, vi } from "vitest";
import { decimal } from "@waitron/shared";
import { sumupSettlementReport as source } from "./report-source.js";
import { FakeSumUp } from "./testing/fake-sumup.js";
import type { SumUpHistoryItem } from "./client.js";

const period = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };
const item = (over: Partial<SumUpHistoryItem> = {}): SumUpHistoryItem => ({
  transaction_id: "tx",
  type: "PAYMENT",
  status: "SUCCESSFUL",
  currency: "EUR",
  amount: 10,
  timestamp: "2026-07-01T12:00:00Z",
  ...over,
});
describe("SumUp gross charge report", () => {
  it("reads every page once, deduplicates gross originals and never detail-reads app charges", async () => {
    const client = new FakeSumUp();
    const pages = vi
      .spyOn(client, "historyPage")
      .mockResolvedValueOnce({
        items: [
          item(),
          item({ transaction_id: "refund", type: "REFUND" }),
          item({ status: "PENDING" }),
        ],
        links: [{ rel: "next", href: "limit=100&oldest_ref=next&order=ascending" }],
      })
      .mockResolvedValueOnce({
        items: [item(), item({ transaction_id: "app", status: "REFUNDED" })],
        links: [],
      });
    const details = vi.spyOn(client, "findTransaction");
    const records = await source(client).fetch(period, ["tx"]);
    expect(records).toEqual([
      { references: ["tx"], amount: decimal("10.00"), settledAt: new Date("2026-07-01T12:00:00Z") },
      {
        references: ["app"],
        amount: decimal("10.00"),
        settledAt: new Date("2026-07-01T12:00:00Z"),
      },
    ]);
    expect(pages.mock.calls[0][0]).toContain("oldest_time=2026-07-01T00%3A00%3A00.000Z");
    expect(pages.mock.calls[1]).toEqual(["limit=100&oldest_ref=next&order=ascending"]);
    expect(details).not.toHaveBeenCalled();
  });

  it("looks up failed saved references and captures recovered on a later day, leaving pending recovery alone", async () => {
    const client = new FakeSumUp();
    const details = vi.spyOn(client, "findTransaction").mockImplementation(async (query) => ({
      id: "id" in query ? query.id : "lost-charge",
      amount: decimal("10.00"),
      status: "REFUNDED",
      currency: "EUR",
      timestamp: "2026-06-01T12:00:00Z",
      foreignTransactionId: "failed",
    }));
    const records = await source(client, [
      { state: "failed", paymentRef: "failed", externalRef: null, workingOrderId: "order" },
      {
        state: "attempting",
        paymentRef: "pending",
        externalRef: "pending-client",
        workingOrderId: "order",
      },
    ]).fetch(period, ["recovered"]);
    expect(records).toEqual([
      {
        references: ["recovered"],
        amount: decimal("10.00"),
        settledAt: new Date("2026-06-01T12:00:00Z"),
      },
      {
        references: ["lost-charge"],
        amount: decimal("10.00"),
        settledAt: new Date("2026-06-01T12:00:00Z"),
        hint: { workingOrderId: "order", paymentRef: "failed" },
      },
    ]);
    expect(details.mock.calls).toEqual([
      [{ id: "recovered" }],
      [{ foreignTransactionId: "failed" }],
    ]);
  });

  it.each([{ currency: "USD" }, { amount: -1 }, { timestamp: "bad" }])(
    "rejects invalid known charges: %j",
    async (over) => {
      const client = new FakeSumUp();
      vi.spyOn(client, "historyPage").mockResolvedValue({ items: [item(over)], links: [] });
      await expect(source(client).fetch(period, ["tx"])).rejects.toMatchObject({
        code: "payment.audit_incomplete",
      });
    },
  );

  it("refuses conflicting duplicate evidence for a known charge", async () => {
    const client = new FakeSumUp();
    vi.spyOn(client, "historyPage").mockResolvedValue({
      items: [item(), item({ amount: 12 })],
      links: [],
    });
    await expect(source(client).fetch(period, ["tx"])).rejects.toMatchObject({
      code: "payment.audit_incomplete",
    });
  });

  it("uses a saved client reference and refuses a detail belonging to a different payment", async () => {
    const client = new FakeSumUp();
    const lookup = vi.spyOn(client, "findTransaction").mockResolvedValue({
      id: "tx",
      status: "SUCCESSFUL",
      amount: decimal("10.00"),
      currency: "EUR",
      timestamp: "2026-07-01T12:00:00Z",
      foreignTransactionId: "other",
    });
    await expect(
      source(client, [
        { state: "failed", paymentRef: "failed", externalRef: "client", workingOrderId: "order" },
      ]).fetch(period),
    ).rejects.toMatchObject({ code: "payment.audit_incomplete" });
    expect(lookup.mock.calls).toEqual([[{ clientTransactionId: "client" }]]);
  });

  it("counts malformed unrelated charges without failing the period", async () => {
    const client = new FakeSumUp();
    vi.spyOn(client, "historyPage").mockResolvedValue({
      items: [item({ currency: "USD" })],
      links: [],
    });
    const report = source(client);
    expect(await report.fetch(period)).toEqual([]);
    expect(report.unreadableUnlinked).toBe(1);
  });

  it("counts non-object entries and resets the count on the next report", async () => {
    const client = new FakeSumUp();
    vi.spyOn(client, "historyPage")
      .mockResolvedValueOnce({ items: [null, "bad"] as never })
      .mockResolvedValueOnce({ items: [] });
    const report = source(client);
    expect(await report.fetch(period)).toEqual([]);
    expect(report.unreadableUnlinked).toBe(2);
    expect(await report.fetch(period)).toEqual([]);
    expect(report.unreadableUnlinked).toBe(0);
  });

  it("keeps only the half-open report period even when history includes adjacent charges", async () => {
    const client = new FakeSumUp();
    vi.spyOn(client, "historyPage").mockResolvedValue({
      items: [
        item({ transaction_id: "before", timestamp: "2026-06-30T23:59:59.999Z" }),
        item({ transaction_id: "start", timestamp: "2026-07-01T00:00:00Z" }),
        item({ transaction_id: "end", timestamp: "2026-07-02T00:00:00Z" }),
      ],
    });
    expect(await source(client).fetch(period)).toEqual([
      { references: ["start"], amount: decimal("10.00"), settledAt: period.from },
    ]);
  });

  it("refuses a supplemental detail that names another charge", async () => {
    const client = new FakeSumUp();
    vi.spyOn(client, "findTransaction").mockResolvedValue({
      id: "other",
      status: "SUCCESSFUL",
      amount: decimal("10.00"),
      currency: "EUR",
      timestamp: "2026-07-01T12:00:00Z",
    });
    await expect(source(client).fetch(period, ["expected"])).rejects.toMatchObject({
      code: "payment.audit_incomplete",
    });
  });

  it("removes the order hint when two failed payments resolve to the same charge", async () => {
    const client = new FakeSumUp();
    vi.spyOn(client, "findTransaction").mockResolvedValue({
      id: "shared",
      status: "SUCCESSFUL",
      amount: decimal("10.00"),
      currency: "EUR",
      timestamp: "2026-07-01T12:00:00Z",
    });
    expect(
      await source(client, [
        { state: "failed", paymentRef: "first", externalRef: null, workingOrderId: "order-a" },
        { state: "failed", paymentRef: "second", externalRef: null, workingOrderId: "order-b" },
      ]).fetch(period),
    ).toEqual([
      {
        references: ["shared"],
        amount: decimal("10.00"),
        settledAt: new Date("2026-07-01T12:00:00Z"),
      },
    ]);
  });

  it("accepts the recorded empty last page without links", async () => {
    const client = new FakeSumUp();
    vi.spyOn(client, "historyPage").mockResolvedValue({ items: [] });
    expect(await source(client).fetch(period)).toEqual([]);
  });

  it("refuses pagination outside a query before requesting another page", async () => {
    const client = new FakeSumUp();
    const pages = vi.spyOn(client, "historyPage").mockResolvedValue({
      items: [],
      links: [{ rel: "next", href: "/another/path" }],
    });
    await expect(source(client).fetch(period)).rejects.toMatchObject({
      code: "payment.audit_incomplete",
    });
    expect(pages).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    { items: null },
    { items: [], links: "bad" },
    { items: [], links: [null] },
    { items: [], links: [{ rel: "next", href: "same=page" }] },
  ])("refuses incomplete or repeated pages", async (page) => {
    const client = new FakeSumUp();
    vi.spyOn(client, "historyPage").mockResolvedValue(page as never);
    await expect(source(client).fetch(period)).rejects.toMatchObject({
      code: "payment.audit_incomplete",
    });
  });
});

describe("SumUp refund evidence", () => {
  it("discovers refund parents without replacing gross charges and reuses each detail read", async () => {
    const client = new FakeSumUp();
    vi.spyOn(client, "historyPage").mockResolvedValue({
      items: [item(), item({ type: "REFUND" }), item({ type: "REFUND" })],
    });
    const event = {
      id: "r1",
      status: "REFUNDED",
      amount: decimal("2.35"),
      timestamp: "2026-07-01T13:00:00Z",
    };
    const find = vi.spyOn(client, "findTransaction").mockResolvedValue({
      id: "tx",
      status: "SUCCESSFUL",
      amount: decimal("10.00"),
      currency: "EUR",
      timestamp: "2026-06-01T12:00:00Z",
      refundEvents: [
        event,
        {
          timestamp: "2026-07-01T13:00:00.000Z",
          amount: decimal("2.35"),
          status: "SUCCESSFUL",
          id: "r1",
        },
      ],
    });
    const report = source(client);
    expect(await report.fetch(period)).toHaveLength(1);
    const evidence = await report.fetchRefundEvidence(["tx"], period.to);
    expect(evidence).toEqual({
      complete: true,
      checkedAt: period.to.toISOString(),
      parents: [
        {
          processorRef: "tx",
          capturedAt: "2026-06-01T12:00:00.000Z",
          events: [{ id: "r1", amount: "2.35", at: "2026-07-01T13:00:00.000Z" }],
        },
      ],
    });
    expect(find.mock.calls).toEqual([[{ id: "tx" }]]);
  });

  it.each([
    { kind: "failed read", detail: undefined, issue: "read_failed", retry: true },
    { kind: "not found", detail: null, issue: "not_found", retry: false },
    { kind: "missing events", detail: {}, issue: "missing_events", retry: false },
    {
      kind: "bad content",
      detail: { refundEvidenceInvalid: true, refundEvents: [] },
      issue: "invalid",
      retry: false,
    },
    {
      kind: "pending refund",
      detail: {
        refundEvents: [
          {
            id: "r",
            status: "PENDING",
            amount: decimal("2.00"),
            timestamp: "2026-07-01T13:00:00Z",
          },
        ],
      },
      issue: "pending",
      retry: true,
    },
    {
      kind: "conflict",
      detail: {
        refundEvents: [
          {
            id: "r",
            status: "REFUNDED",
            amount: decimal("2.00"),
            timestamp: "2026-07-01T13:00:00Z",
          },
          {
            id: "r",
            status: "REFUNDED",
            amount: decimal("3.00"),
            timestamp: "2026-07-01T13:00:00Z",
          },
        ],
      },
      issue: "invalid",
      retry: false,
    },
  ])(
    "isolates $kind from charges and retries only transient evidence",
    async ({ detail, issue, retry }) => {
      const client = new FakeSumUp();
      vi.spyOn(client, "historyPage").mockResolvedValue({
        items: [item(), item({ type: "REFUND" })],
      });
      vi.spyOn(client, "findTransaction").mockImplementation(async () => {
        if (detail === undefined) throw new Error("network");
        return detail === null
          ? null
          : {
              id: "tx",
              status: "SUCCESSFUL",
              amount: decimal("10.00"),
              currency: "EUR",
              ...detail,
            };
      });
      const report = source(client);
      expect(await report.fetch(period)).toHaveLength(1);
      expect(await report.fetchRefundEvidence([], period.to)).toMatchObject({
        complete: false,
        parents: [{ processorRef: "tx", issue }],
      });
      expect(report.retryRefunds).toBe(retry);
    },
  );
});
