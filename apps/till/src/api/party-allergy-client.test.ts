import { describe, expect, it, vi } from "vitest";
import type { AllergyCommand, AllergySendTarget, PartyAllergyRead } from "@waitron/module";
import { TillApi } from "./client.js";

const view: PartyAllergyRead = {
  partyId: "party-1",
  snapshot: { answer: null, guests: [], ticks: [], changedAt: null, changedBy: null, revision: 8 },
  dishes: [],
};
const command: AllergyCommand = {
  submissionId: "once",
  expectedPartyRevision: 8,
  allergy: { party: { answer: "none", guests: [] }, ticks: [] },
};
const expectedEdit = { billId: "bill-1", editorVersion: 4, draftId: null, draftRevision: null };
const reply = () =>
  new Response(JSON.stringify(view), { headers: { "content-type": "application/json" } });

describe("A669 allergy client", () => {
  it.each(["lines", "group", "held-line"] as const)(
    "cancels the %s release request without changing its command",
    async (kind) => {
      const fetcher = vi.fn().mockImplementation(reply);
      const api = new TillApi("", fetcher);
      const abort = new AbortController();
      if (kind === "lines")
        await api.sendLines("bill-1", [2], expectedEdit, command, { signal: abort.signal });
      else if (kind === "group")
        await api.fireGroup("party-1", "group-1", command, { signal: abort.signal });
      else await api.fireHeldLine("party-1", "line-1", command, { signal: abort.signal });
      expect(fetcher.mock.calls[0]![1].signal).toBe(abort.signal);
      expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual(
        kind === "lines"
          ? { lineNos: [2], expectedEdit, ...command }
          : kind === "group"
            ? command
            : { ...command, lineId: "line-1" },
      );
    },
  );
  it.each(["listGroups", "readCurrentOrders"] as const)(
    "cancels the %s metadata read used before allergy reconfirmation",
    async (method) => {
      const fetcher = vi.fn().mockImplementation(reply);
      const abort = new AbortController();
      const api = new TillApi("", fetcher);
      await (api[method] as (id: string, options: { signal: AbortSignal }) => Promise<unknown>)(
        "party-1",
        { signal: abort.signal },
      );
      expect(fetcher.mock.calls[0]![1].signal).toBe(abort.signal);
    },
  );
  it("keeps the bill edit observation and allergy command together on per-line Send", async () => {
    const fetcher = vi.fn().mockImplementation(reply);
    await new TillApi("", fetcher).sendLines("bill-1", [2, 4], expectedEdit, command);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      lineNos: [2, 4],
      expectedEdit,
      ...command,
    });
  });
  it("preserves a legacy counter body when no allergy command is supplied", async () => {
    const fetcher = vi.fn().mockImplementation(reply);
    await new TillApi("", fetcher).sendLines("bill-1", [], expectedEdit);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ lineNos: [], expectedEdit });
  });
  it("reads the authoritative editor view with a cancellable GET", async () => {
    const fetcher = vi.fn().mockImplementation(reply);
    const abort = new AbortController();
    expect(
      await new TillApi("/box", fetcher).readPartyAllergy("party-1", { signal: abort.signal }),
    ).toEqual(view);
    expect(fetcher).toHaveBeenCalledWith("/box/api/parties/party-1/allergy", {
      method: "GET",
      credentials: "include",
      signal: abort.signal,
    });
  });
  it.each<AllergySendTarget>([
    { kind: "draft", draftId: "draft-1", lineIds: ["saved-2", "saved-1"] },
    { kind: "lines", orderId: "bill-1", lineNos: [] },
    { kind: "group", groupId: "group-1" },
    { kind: "held-line", lineId: "line-1" },
    { kind: "course", orderId: "bill-1", courseId: "course-1" },
  ])("previews the actual server target %j through active POST", async (target) => {
    const fetcher = vi.fn().mockImplementation(reply);
    const abort = new AbortController();
    expect(
      await new TillApi("", fetcher).previewPartyAllergy("party-1", target, {
        signal: abort.signal,
      }),
    ).toEqual(view);
    expect(fetcher).toHaveBeenCalledWith("/api/parties/party-1/allergy/send-preview", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(target),
      signal: abort.signal,
    });
  });
  it("saves one replayable command and retains a field refusal", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(reply)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "allergy.invalid", params: { field: "who", guestIndex: 0 } },
          }),
          { status: 400 },
        ),
      );
    const api = new TillApi("", fetcher);
    const abort = new AbortController();
    expect(await api.savePartyAllergy("party-1", command, { signal: abort.signal })).toEqual(view);
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/parties/party-1/allergy", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
      signal: abort.signal,
    });
    await expect(api.savePartyAllergy("party-1", command)).rejects.toEqual({
      code: "allergy.invalid",
      field: "who",
      guestIndex: 0,
      status: 400,
    });
  });
});
