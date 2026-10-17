import { describe, expect, it, vi } from "vitest";
import { TillApi } from "./client.js";

describe("party Recall client", () => {
  it("returns the authoritative draft and party revision from the party-scoped line command", async () => {
    const answer = {
      revision: 9,
      draft: { id: "draft-7", billId: "bill-4", lines: [{ id: "ref-2", sourceLineId: "dish-3" }] },
    };
    const request = { submissionId: "recall-1", expectedPartyRevision: 8 };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      new TillApi("", fetcher).recallToDraft("party-1", "dish-3", request),
    ).resolves.toEqual(answer);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/parties/party-1/lines/dish-3/recall",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify(request),
      }),
    );
  });

  it("preserves the domain refusal without returning a draft", async () => {
    const error = { code: "ticket.already_started", params: { ticketItemId: "ticket-1" } };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      new TillApi("", fetcher).recallToDraft("party-1", "dish-3", {
        submissionId: "recall-1",
        expectedPartyRevision: 8,
      }),
    ).rejects.toMatchObject({ code: error.code, ticketItemId: "ticket-1", status: 409 });
  });
});
