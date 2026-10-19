import { describe, expect, it, vi } from "vitest";
import { TillApi } from "./client.js";

const empty = {
  billId: "bill-1",
  editorId: null,
  editorName: null,
  editorVersion: 4,
  draftId: null,
  draftRevision: null,
};
const owned = {
  billId: "bill-2",
  editorId: "ana",
  editorName: "Ana",
  editorVersion: 7,
  draftId: "draft-2",
  draftRevision: 3,
};

describe("bill editing over the till client", () => {
  it.each([null, { billId: "bill-2", editorVersion: 7, draftId: "draft-2", draftRevision: 3 }])(
    "places an order with its explicit editing observation %j",
    async (expectedEdit) => {
      const result = { id: "bill-2", status: "placed" };
      const fetch = vi.fn(async () => Response.json(result));
      expect(await new TillApi("", fetch).placeOrder("bill-2", expectedEdit)).toEqual(result);
      expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/working-orders/bill-2/place", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedEdit }),
      });
    },
  );

  it("retains empty and owned bill observations from the same draft read", async () => {
    const answer = { drafts: [], billEdits: [empty, owned] };
    const fetch = vi.fn(async () => Response.json(answer));
    const controller = new AbortController();
    expect(await new TillApi("", fetch).listDrafts("party", { signal: controller.signal })).toEqual(
      answer,
    );
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/parties/party/drafts", {
      method: "GET",
      credentials: "include",
      signal: controller.signal,
    });
  });

  it("sends the shown bill observation and command identity in a takeover", async () => {
    const ask = {
      revision: 3,
      expectedEdit: { billId: "bill-2", editorVersion: 7, draftId: "draft-2", draftRevision: 3 },
      submissionId: "takeover-1",
    };
    const answer = { draft: null, edit: { ...empty, billId: "bill-2", editorVersion: 8 } };
    const fetch = vi.fn(async () => Response.json(answer));
    const controller = new AbortController();
    expect(
      await new TillApi("", fetch).takeOverDraft("party", "draft-2", ask, {
        signal: controller.signal,
      }),
    ).toEqual(answer);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/parties/party/drafts/draft-2/take-over", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ask),
      signal: controller.signal,
    });
  });

  it("keeps the current edit state and original conflict facts on a refused save", async () => {
    const params = {
      billId: "bill-2",
      draftId: "draft-2",
      ownerId: "ana",
      ownerName: "Ana",
      edit: owned,
    };
    const fetch = vi.fn(async () =>
      Response.json(
        { error: { code: "draft.taken_over", params } },
        {
          status: 409,
        },
      ),
    );
    await expect(
      new TillApi("", fetch).saveDraft("party", {
        billId: "bill-2",
        draftId: "draft-2",
        revision: 3,
        lines: [],
        expectedEdit: { billId: "bill-2", editorVersion: 6, draftId: "draft-2", draftRevision: 3 },
      }),
    ).rejects.toEqual({ ...params, code: "draft.taken_over", status: 409 });
  });
});

describe("split-table editing request", () => {
  it.each(["bill-2", null])("carries an explicit affected set for %s", async (billId) => {
    const expectedEdits =
      billId === null
        ? []
        : [{ billId: "bill-2", editorVersion: 7, draftId: "draft-2", draftRevision: 3 }];
    const fetch = vi.fn(async () => Response.json({ partyId: "new-party", mainBillId: billId }));
    const guests = { staying: 2, leaving: null };
    await new TillApi("", fetch).splitTable("party", "table", billId, 4, expectedEdits, guests);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/parties/party/split-table", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tableId: "table",
        billId,
        expectedPartyRevision: 4,
        expectedEdits,
        guests,
      }),
    });
  });
});

describe("direct line editing observation", () => {
  it.each([null, { billId: "bill-2", editorVersion: 7, draftId: "draft-2", draftRevision: 3 }])(
    "carries the explicit editing observation %j with the original patch and revision",
    async (expectedEdit) => {
      const result = { revision: 8, party: { id: "party", revision: 9 } };
      const fetch = vi.fn(async () => Response.json(result));
      const patch = { note: "no salt", quantity: "2" };
      expect(
        await new TillApi("", fetch).updateOrderLine("bill-2", 3, patch, 7, expectedEdit),
      ).toEqual(result);
      expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/working-orders/bill-2/lines/3", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...patch, revision: 7, expectedEdit }),
      });
    },
  );
});

describe("direct course and send editing observations", () => {
  it.each([null, { billId: "bill-2", editorVersion: 7, draftId: "draft-2", draftRevision: 3 }])(
    "sends the explicit observation %j with the course or held-line request",
    async (expectedEdit) => {
      const fetch = vi.fn(async () => new Response(null, { status: 200 }));
      const api = new TillApi("", fetch);
      await api.setLineCourse("bill-2", 3, null, expectedEdit);
      await api.sendLines("bill-2", [3, 5], expectedEdit);
      expect(fetch).toHaveBeenNthCalledWith(1, "/api/working-orders/bill-2/lines/3/course", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId: null, expectedEdit }),
      });
      expect(fetch).toHaveBeenNthCalledWith(2, "/api/working-orders/bill-2/lines/send", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineNos: [3, 5], expectedEdit }),
      });
    },
  );
});
