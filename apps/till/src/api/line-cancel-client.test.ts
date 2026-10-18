import { describe, expect, it, vi } from "vitest";
import { TillApi } from "./client.js";

const context = {
  billStatus: "open" as const,
  stage: "started" as const,
  components: [
    {
      id: "ticket-1",
      lineId: "dish-3",
      state: "preparing" as const,
      firedAt: "2026-10-17T10:00:00.000Z",
      quantity: "2.000",
      kitchenQuantity: "2.000",
      servedQuantity: "0.000",
      cancelledQuantity: "0.000",
    },
  ],
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const expectedEdit = {
  billId: "bill-4",
  editorVersion: 7,
  draftId: null,
  draftRevision: null,
};
const command = {
  expectedEdit,
  submissionId: "cancel-1",
  expectedPartyRevision: 8,
  expectedBillRevision: 4,
  quantity: "1",
  outcome: "remove_charge" as const,
  expectedContext: context,
  reasonId: "reason-1",
  note: "Guest changed their mind",
  approver: { personId: "manager-1", pin: "1234" },
};

describe("the cancellation HTTP client", () => {
  it("reads the full line context with its bill, revisions and abort signal", async () => {
    const answer = { billId: "bill-4", revision: 8, billRevision: 4, context };
    const fetcher = vi.fn().mockResolvedValue(json(answer));
    const signal = new AbortController().signal;
    const result = await new TillApi("https://venue.test", fetcher).getCancellation(
      "party-1",
      "dish-3",
      { signal },
    );
    expect(result).toEqual(answer);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "https://venue.test/api/parties/party-1/lines/dish-3/cancellation",
      { method: "GET", credentials: "include", signal },
    );
  });

  it("submits the exact confirmed quantities, context and approval without changing its identity", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ revision: 9 }));
    const signal = new AbortController().signal;
    const result = await new TillApi("", fetcher).cancelItem("party-1", "dish-3", command, {
      signal,
    });
    expect(result).toEqual({ revision: 9 });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "/api/parties/party-1/lines/dish-3/cancel-item",
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
        signal,
      },
    );
  });

  it("preserves refreshed context from a confirmation race refusal", async () => {
    const changed = { ...context, billStatus: "settled" };
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        json({ error: { code: "tab.cancel_context_changed", params: { context: changed } } }, 409),
      );
    await expect(new TillApi("", fetcher).cancelItem("party-1", "dish-3", command)).rejects.toEqual(
      { code: "tab.cancel_context_changed", status: 409, context: changed },
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("returns paid context and sends a reason-free keep-payment confirmation", async () => {
    const paid = { ...context, billStatus: "settled" as const };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({ billId: "bill-4", revision: 8, billRevision: 4, context: paid }),
      )
      .mockResolvedValueOnce(json({ revision: 9 }));
    const api = new TillApi("", fetcher);
    const read = await api.getCancellation("party-1", "dish-3");
    const keep = {
      expectedEdit,
      submissionId: "keep-1",
      expectedPartyRevision: read.revision,
      expectedBillRevision: read.billRevision,
      quantity: "2",
      outcome: "keep_charge" as const,
      expectedContext: read.context,
    };
    expect(await api.cancelItem("party-1", "dish-3", keep)).toEqual({ revision: 9 });
    expect(JSON.parse(fetcher.mock.calls[1]![1].body as string)).toEqual(keep);
  });

  it("propagates a failed context read without a follow-up command", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        json({ error: { code: "service_zone.not_allowed", params: { zoneId: "zone-2" } } }, 403),
      );
    await expect(new TillApi("", fetcher).getCancellation("party-1", "dish-3")).rejects.toEqual({
      code: "service_zone.not_allowed",
      status: 403,
      zoneId: "zone-2",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
