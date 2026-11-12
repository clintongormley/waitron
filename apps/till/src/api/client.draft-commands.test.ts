import { describe, expect, it, vi } from "vitest";
import { TillApi, type Draft } from "./client.js";

const draft: Draft = {
  id: "draft-1",
  partyId: "party-1",
  billId: "bill-2",
  ownerId: "ana",
  ownerName: "Ana",
  revision: 5,
  lines: [],
  takenOverFrom: null,
};
const expectedEdit = { billId: "bill-2", editorVersion: 2, draftId: "draft-1", draftRevision: 5 };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("TillApi draft source commands", () => {
  it("splits selected unsent rows with their original observation and returns both bill snapshots", async () => {
    const answer = {
      billId: "bill-3",
      revision: 10,
      source: { draft, edit: { ...expectedEdit, editorId: "ana", editorName: "Ana" } },
      destination: {
        draft: { ...draft, id: "draft-2", billId: "bill-3", revision: 0 },
        edit: {
          billId: "bill-3",
          editorId: "ana",
          editorName: "Ana",
          editorVersion: 1,
          draftId: "draft-2",
          draftRevision: 0,
        },
      },
    };
    const fetcher = vi.fn().mockResolvedValue(json(answer));
    const api = new TillApi("https://venue.test", fetcher);
    const signal = new AbortController().signal;
    const command = {
      submissionId: "split-draft-1",
      expectedPartyRevision: 9,
      expectedEdit,
      lineIds: ["fresh-1", "fresh-7"],
    };
    expect(await api.splitDraft("party-1", "draft-1", command, { signal })).toEqual(answer);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "https://venue.test/api/parties/party-1/drafts/draft-1/split",
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
        signal,
      },
    );
  });

  it("splits a held sent line through the public group command with session cancellation", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ revision: 10 }));
    const api = new TillApi("", fetcher);
    const signal = new AbortController().signal;
    const command = { submissionId: "split-source-1", expectedPartyRevision: 9, expectedEdit };
    expect(await api.splitHeldLineIntoUnits("party-1", "source-7", command, { signal })).toEqual({
      revision: 10,
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/parties/party-1/groups/split-line", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...command, lineId: "source-7" }),
      signal,
    });
  });

  it("discards exactly one owned draft at its draft and bill revisions without a cancellation reason", async () => {
    const answer = {
      draftId: "draft-1",
      billId: "bill-2",
      revision: 6,
      adjustmentIds: ["adjustment-1"],
      party: { id: "party-1", revision: 10 },
    };
    const fetcher = vi.fn().mockResolvedValue(json(answer));
    const api = new TillApi("", fetcher);
    const signal = new AbortController().signal;
    const command = {
      submissionId: "discard-1",
      revision: 5,
      expectedRevision: 12,
      expectedEdit,
    };
    expect(await api.discardDraft("party-1", "draft-1", command, { signal })).toEqual(answer);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/parties/party-1/drafts/draft-1/discard", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
      signal,
    });
  });

  it("sends fresh-only Discard without inventing a cancellation reason or approval", async () => {
    const answer = {
      draftId: "draft-1",
      billId: "bill-2",
      revision: 6,
      adjustmentIds: [],
      party: null,
    };
    const fetcher = vi.fn().mockResolvedValue(json(answer));
    const command = {
      submissionId: "discard-fresh",
      revision: 5,
      expectedRevision: 12,
      expectedEdit,
    };
    expect(await new TillApi("", fetcher).discardDraft("party-1", "draft-1", command)).toEqual(
      answer,
    );
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual(command);
  });
  it("preserves a Discard refusal and its new owner without resending", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        json(
          { error: { code: "draft.taken_over", params: { ownerId: "sam", ownerName: "Sam" } } },
          409,
        ),
      );
    const api = new TillApi("", fetcher);
    await expect(
      api.discardDraft("party-1", "draft-1", {
        submissionId: "discard-1",
        revision: 5,
        expectedRevision: 12,
        expectedEdit,
      }),
    ).rejects.toEqual({ code: "draft.taken_over", status: 409, ownerId: "sam", ownerName: "Sam" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
