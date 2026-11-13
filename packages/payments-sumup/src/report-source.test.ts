import { describe, expect, it, vi } from "vitest";
import { decimal } from "@waitron/shared";
import * as sumup from "./index.js";
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
function source(
  client = new FakeSumUp(),
  candidates: Parameters<typeof sumup.sumupSettlementReport>[1] = [],
) {
  expect(sumup.sumupSettlementReport).toBeTypeOf("function");
  return sumup.sumupSettlementReport(client, candidates);
}

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

  it("accepts the recorded empty last page without links", async () => {
    const client = new FakeSumUp();
    vi.spyOn(client, "historyPage").mockResolvedValue({ items: [] });
    expect(await source(client).fetch(period)).toEqual([]);
  });

  it.each([
    { items: [], links: "bad" },
    { items: [], links: [{ rel: "next", href: "same=page" }] },
  ])("refuses incomplete or repeated pages", async (page) => {
    const client = new FakeSumUp();
    vi.spyOn(client, "historyPage").mockResolvedValue(page as never);
    await expect(source(client).fetch(period)).rejects.toMatchObject({
      code: "payment.audit_incomplete",
    });
  });
});
