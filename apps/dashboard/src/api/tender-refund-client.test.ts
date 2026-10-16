import { describe, expect, it, vi } from "vitest";
import { DashboardApi } from "./client.js";

const view = {
  id: "refund/1",
  saleId: "sale-1",
  tenderId: "tender-1",
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

describe("manager settled refund client", () => {
  it("reads unresolved refunds passively without turning manager writes passive", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async (_url, init) =>
        response(init.method === "GET" ? [view] : { outcome: "completed" }),
      );
    const api = new DashboardApi("", fetcher).background;
    expect(await api.listStuckTenderRefunds()).toEqual([view]);
    expect(fetcher).toHaveBeenLastCalledWith(
      "/management-api/payments/tender-refunds",
      expect.objectContaining({
        method: "GET",
        headers: expect.any(Headers),
      }),
    );
    expect(await api.resolveStuckTenderRefund("refund/1")).toEqual({ outcome: "completed" });
    expect(fetcher).toHaveBeenLastCalledWith(
      "/management-api/payments/tender-refunds/refund%2F1/resolve",
      expect.objectContaining({ method: "POST" }),
    );
    expect(new Headers(fetcher.mock.calls[0]![1].headers).get("x-waitron-live")).toBe("1");
    expect(new Headers(fetcher.mock.calls[1]![1].headers).has("x-waitron-live")).toBe(false);
  });

  it("sends a confirmed outcome with the manager's note and own PIN", async () => {
    const body = { outcome: "failed" as const, note: "Provider confirmed no return", pin: "0123" };
    const fetcher = vi.fn().mockResolvedValue(response({ outcome: "failed" }));
    expect(await new DashboardApi("", fetcher).attestStuckTenderRefund("refund/1", body)).toEqual({
      outcome: "failed",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/management-api/payments/tender-refunds/refund%2F1/attest",
      expect.objectContaining({ method: "POST", body: JSON.stringify(body) }),
    );
  });

  it("preserves an unknown outcome refusal for the recovery screen", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ error: { code: "tender.refund_outcome_unconfirmed" } }, 409));
    await expect(
      new DashboardApi("", fetcher).resolveStuckTenderRefund("refund/1"),
    ).rejects.toMatchObject({ code: "tender.refund_outcome_unconfirmed" });
  });
});
