import { describe, expect, it, vi } from "vitest";
import { TillApi, type KitchenNoteSnapshot } from "./client.js";

const snapshot: KitchenNoteSnapshot = {
  scope: { partyId: "party-1" },
  note: "Train at 14:30",
  revision: 3,
  ownerRevision: 8,
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("kitchen note client", () => {
  it.each([{ workingOrderId: "order-1" }, { partyId: "party-1" }])(
    "reads canonical ownership passively for %j",
    async (scope) => {
      const fetcher = vi.fn().mockResolvedValue(response(snapshot));
      const api = new TillApi("", fetcher);
      const abort = new AbortController();
      expect(await api.getKitchenNote(scope, { signal: abort.signal })).toEqual(snapshot);
      const path =
        "partyId" in scope
          ? "/api/parties/party-1/kitchen-note"
          : "/api/working-orders/order-1/kitchen-note";
      expect(fetcher).toHaveBeenCalledWith(path, {
        method: "GET",
        credentials: "include",
        signal: abort.signal,
      });
    },
  );
  it.each([{ workingOrderId: "order-1" }, { partyId: "party-1" }])(
    "saves the captured scope and revisions actively for %j",
    async (scope) => {
      const fetcher = vi.fn().mockResolvedValue(response(snapshot));
      const api = new TillApi("", fetcher);
      const request = {
        submissionId: "once",
        expectedNoteRevision: 2,
        note: "Train at 14:30",
        ...("partyId" in scope
          ? { expectedPartyRevision: 7 }
          : { expectedOrderRevision: 7, partyId: null }),
      };
      expect(await api.setKitchenNote(scope, request)).toEqual(snapshot);
      const path =
        "partyId" in scope
          ? "/api/parties/party-1/kitchen-note"
          : "/api/working-orders/order-1/kitchen-note";
      expect(fetcher).toHaveBeenCalledWith(path, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
    },
  );
  it("preserves a stale-note refusal", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response({ error: { code: "kitchen_note.out_of_date", params: {} } }, 409),
      );
    await expect(
      new TillApi("", fetcher).setKitchenNote(
        { partyId: "party-1" },
        { submissionId: "once", expectedNoteRevision: 2, expectedPartyRevision: 7, note: null },
      ),
    ).rejects.toMatchObject({ code: "kitchen_note.out_of_date", status: 409 });
  });
  it("passes the initial note through cash, integrated card and Hold requests", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response({})));
    const api = new TillApi("", fetcher);
    await api.recordSale(
      [],
      { method: "cash", amount: "5.00" },
      "o",
      undefined,
      undefined,
      undefined,
      "Together",
    );
    await api.pay({ id: "o", lines: [], kitchenNote: "Together" });
    await api.parkOrder({ id: "o", lines: [], kitchenNote: "Together" });
    expect(fetcher.mock.calls.map((call) => JSON.parse(call[1].body))).toEqual([
      {
        lines: [],
        tender: { method: "cash", amount: "5.00" },
        workingOrderId: "o",
        kitchenNote: "Together",
      },
      { id: "o", lines: [], kitchenNote: "Together" },
      { id: "o", lines: [], kitchenNote: "Together" },
    ]);
  });
});
