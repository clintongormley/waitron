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
