import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftServer, type DraftServer } from "../widgets/test-helpers.js";
import {
  DRAFT_SAVE_DELAY_MS,
  DraftSync,
  DraftStore,
  SUBMIT_RETRIES,
  SUBMIT_RETRY_PAUSE_MS,
  pause,
  resendUnanswered,
} from "./draft-sync.js";
import type { OrderLine } from "./working-order.js";
import type { Draft, DraftLine, FreshDraftLine, TillProduct } from "../api/client.js";
import type { Place } from "./draft-place.js";
import { fromDraftLine } from "./draft-lines.js";

const dish = (id: string, name: string): TillProduct => ({
  id,
  menuItemId: `offer-${id}`,
  name,
  pricingUnit: "each",
  unitPrice: "3.00",
  vatClass: "general",
  category: null,
  allergens: null,
});
const beer = dish("beer", "Beer");
const steak = dish("steak", "Steak");
const byOffer = new Map([beer, steak].map((product) => [product.menuItemId!, product]));

/** Rebuilds a saved line as the app does from the table's offers, trimming a whole count. */
const rebuild = (lines: readonly DraftLine[]): OrderLine[] =>
  lines.map((line) => ({
    product: byOffer.get(line.menuItemId!)!,
    quantity: line.quantity.replace(/\.0+$/, ""),
    ...(line.note === null ? {} : { note: line.note }),
  }));

const rows = (sync: DraftSync) =>
  sync.store.lines.map((line) => `${line.product.name} ×${line.quantity}`);

/** Each request's own time limit in these tests. */
const LIMIT = 5_000;

/** A request that gets no answer: it rejects only when the signal among its arguments is aborted. */
const noAnswer = (...args: unknown[]) =>
  new Promise<never>((_resolve, reject) => {
    const { signal } = args.at(-1) as { signal: AbortSignal };
    signal.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError")),
    );
  });

let server: DraftServer;
let refused: string[];

let replaced: number;

function sync(personId = "p1", billId = "wo-4"): DraftSync {
  return new DraftSync({
    api: server,
    partyId: "v1",
    billId,
    personId,
    rebuild,
    onRefused: (code) => refused.push(code),
    onReplaced: () => (replaced += 1),
    requestLimitMs: LIMIT,
  });
}

/** Lets the debounce fire and every answer land. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS);
}

/** A saved draft of another device, or another person, straight into the server. */
function seed(ownerId: string, ...products: TillProduct[]): Draft {
  const personId = server.personId;
  server.personId = ownerId;
  const draft = server.save("v1", {
    billId: "wo-4",
    draftId: null,
    revision: 0,
    lines: products.map((product) => ({
      slot: 0,
      joinGroupId: null,
      afterGroupId: null,
      menuItemId: product.menuItemId!,
      variantId: null,
      menuVersionId: null,
      options: [],
      extras: [],
      note: null,
      quantity: "1",
      courseId: null,
      noMerge: false,
    })),
  });
  server.personId = personId;
  return draft;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  server = draftServer();
  refused = [];
  replaced = 0;
});
afterEach(() => vi.useRealTimers());

describe("DraftSync: reading a party's drafts", () => {
  it("shows the signed-in person's own draft and keeps the others' apart", async () => {
    const theirs = seed("p2", steak);
    seed("p1", beer, beer);
    const draft = sync();

    expect(await draft.load()).toBe(true);

    expect(rows(draft)).toEqual(["Beer ×2"]);
    expect(draft.others.map((other) => other.id)).toEqual([theirs.id]);
    expect(draft.draftId).toBe(server.drafts[1]!.id);
    expect(draft.revision).toBe(1);
    expect(draft.store.dirty).toBe(false);
    await settle();
    expect(server.saveDraft).not.toHaveBeenCalled();
  });

  it("starts an empty draft with no id when the person has none, and says a failed read", async () => {
    const draft = sync();
    expect(await draft.load()).toBe(true);
    expect(draft.store.lineCount).toBe(0);
    expect(draft.draftId).toBeNull();

    server.listDrafts.mockRejectedValueOnce(new TypeError("offline"));
    expect(await draft.load()).toBe(false);
  });
});

describe("DraftSync: bill ownership", () => {
  it("loads only this bill's own draft and colleagues", async () => {
    const ownOther = seed("p1", steak);
    const colleagueOther = seed("p2", beer);
    server.drafts = [
      { ...ownOther, billId: "wo-check" },
      { ...colleagueOther, billId: "wo-check" },
      { ...ownOther, id: "own-here", billId: "wo-4", lines: colleagueOther.lines },
      { ...colleagueOther, id: "colleague-here", billId: "wo-4", lines: ownOther.lines },
    ];
    const draft = sync();

    expect(await draft.load()).toBe(true);

    expect(draft.draftId).toBe("own-here");
    expect(rows(draft)).toEqual(["Beer ×1"]);
    expect(draft.others.map((other) => other.id)).toEqual(["colleague-here"]);
  });

  it("starts empty on another bill owned by the same person", async () => {
    const other = seed("p1", steak);
    server.drafts = [{ ...other, billId: "wo-4" }];
    const draft = sync("p1", "wo-check");

    expect(await draft.load()).toBe(true);

    expect(draft.draftId).toBeNull();
    expect(rows(draft)).toEqual([]);
    expect(draft.others).toEqual([]);
  });

  it("takes over this bill's colleague without absorbing another bill's own draft", async () => {
    const elsewhere = seed("p1", beer);
    elsewhere.billId = "wo-check";
    const theirs = seed("p2", steak);
    const draft = sync();
    await draft.load();

    expect(await draft.takeOver(theirs.id, theirs.revision)).toBe("taken");

    expect(rows(draft)).toEqual(["Steak ×1"]);
    expect(
      server.drafts.map((each) => [each.billId, each.ownerId, each.lines[0]!.menuItemId]),
    ).toEqual([
      ["wo-check", "p1", "offer-beer"],
      ["wo-4", "p1", "offer-steak"],
    ]);
    expect(draft.others).toEqual([]);
  });

  it("saves each edit with the sync's recorded bill", async () => {
    const draft = sync("p1", "wo-check");
    await draft.load();
    draft.store.addProduct(beer, "1");

    expect(await draft.flush()).toBe("saved");

    expect(server.saveDraft).toHaveBeenCalledWith(
      "v1",
      expect.objectContaining({ billId: "wo-check" }),
      { signal: expect.any(AbortSignal) },
    );
  });
});

describe("DraftSync: saving", () => {
  it("retains saved row IDs on load, save answers and later edits", async () => {
    const initial = seed("p1", beer);
    const draft = sync();
    await draft.load();
    expect(draft.store.lines[0]).toHaveProperty("draftLineId", initial.lines[0]!.id);
    draft.store.setLineQuantity(0, "2");
    await draft.flush();
    expect(server.saveDraft.mock.calls[0]![1].lines[0]).toMatchObject({
      id: initial.lines[0]!.id,
      quantity: "2",
    });
    draft.store.addProduct(steak, "1");
    await draft.flush();
    const saved = server.drafts[0]!;
    expect(draft.store.lines[1]).toHaveProperty("draftLineId", saved.lines[1]!.id);
    draft.store.setLineQuantity(1, "3");
    await draft.flush();
    expect(server.saveDraft.mock.calls[2]![1].lines).toMatchObject([
      { id: saved.lines[0]!.id },
      { id: saved.lines[1]!.id, quantity: "3" },
    ]);
  });

  it("attaches an answering save's IDs to the same lines after an in-flight edit", async () => {
    let answer!: () => void;
    server.saveDraft.mockImplementationOnce(async (partyId, save) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return structuredClone(server.save(partyId, save));
    });
    const draft = sync();
    await draft.load();
    draft.store.addProduct(beer, "1");
    draft.store.addProduct(steak, "1");
    const saving = draft.flush();
    await vi.waitFor(() => expect(server.saveDraft).toHaveBeenCalledOnce());
    draft.store.removeLine(0);
    draft.store.setLineQuantity(0, "3");
    answer();
    await saving;
    const steakId = server.drafts[0]!.lines[1]!.id;
    expect(draft.store.lines[0]).toMatchObject({ draftLineId: steakId, quantity: "3" });
    await draft.flush();
    expect(server.saveDraft.mock.calls[1]![1].lines).toMatchObject([
      { id: steakId, menuItemId: "offer-steak", quantity: "3" },
    ]);
  });

  it("saves three taps on Beer once, as one Beer ×3, after the edits stop", async () => {
    const draft = sync();
    await draft.load();
    for (let tap = 0; tap < 3; tap += 1) {
      draft.store.addProduct(beer, "1");
      await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS - 1);
    }
    expect(server.saveDraft).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(rows(draft)).toEqual(["Beer ×3"]);
    expect(server.saveDraft).toHaveBeenCalledOnce();
    expect(server.saveDraft).toHaveBeenCalledWith(
      "v1",
      {
        billId: "wo-4",
        draftId: null,
        revision: 0,
        lines: [expect.objectContaining({ menuItemId: "offer-beer", quantity: "3" })],
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(draft.draftId).toBe(server.drafts[0]!.id);
    expect(draft.revision).toBe(1);
  });

  it("sends the next save with the id and revision the last one answered", async () => {
    const draft = sync();
    await draft.load();
    draft.store.addProduct(beer, "1");
    await settle();
    draft.store.addProduct(steak, "1");
    await settle();

    expect(server.saveDraft).toHaveBeenLastCalledWith(
      "v1",
      {
        billId: "wo-4",
        draftId: server.drafts[0]!.id,
        revision: 1,
        lines: [expect.anything(), expect.anything()],
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(draft.revision).toBe(2);
  });

  it("never has two saves out: edits made while one is out go in one save after it answers", async () => {
    let answer!: () => void;
    const draft = sync();
    await draft.load();
    server.saveDraft.mockImplementationOnce(async (partyId, save) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return structuredClone(server.save(partyId, save));
    });
    draft.store.addProduct(beer, "1");
    await settle();
    draft.store.addProduct(steak, "1");
    await settle();
    draft.store.addProduct(steak, "1");
    await settle();
    expect(server.saveDraft).toHaveBeenCalledOnce();

    answer();
    await settle();

    expect(server.saveDraft).toHaveBeenCalledTimes(2);
    expect(server.saveDraft.mock.calls[1]![1]).toEqual({
      billId: "wo-4",
      draftId: server.drafts[0]!.id,
      revision: 1,
      lines: [
        expect.objectContaining({ menuItemId: "offer-beer", quantity: "1" }),
        expect.objectContaining({ menuItemId: "offer-steak", quantity: "2" }),
      ],
    });
  });

  it("saves at once on a flush, and answers once every save has", async () => {
    const draft = sync();
    await draft.load();
    draft.store.addProduct(beer, "1");

    expect(await draft.flush()).toBe("saved");

    expect(server.saveDraft).toHaveBeenCalledOnce();
    await settle();
    expect(server.saveDraft).toHaveBeenCalledOnce();
    expect(await draft.flush()).toBe("saved");
    expect(server.saveDraft).toHaveBeenCalledOnce();
  });

  it("keeps an edit a save did not reach unsaved, and sends it at the next flush", async () => {
    const draft = sync();
    await draft.load();
    server.saveDraft.mockRejectedValueOnce(new TypeError("offline"));
    draft.store.addProduct(beer, "1");

    expect(await draft.flush()).toBe("failed");
    expect(draft.lineIds([0])).toBeNull();
    expect(await draft.flush()).toBe("saved");

    expect(server.saveDraft).toHaveBeenCalledTimes(2);
    expect(draft.lineIds([0])).toEqual([server.drafts[0]!.lines[0]!.id]);
  });

  it("takes the server's lines when a save merged two of the till's", async () => {
    const draft = sync();
    await draft.load();
    draft.store.loadFrom(draft.store.id, [
      { product: beer, quantity: "1", note: "cold" },
      { product: beer, quantity: "1" },
    ]);
    draft.store.setLineExtras(1, { note: "cold" });

    await draft.flush();

    expect(rows(draft)).toEqual(["Beer ×2"]);
    expect(draft.lineIds([0])).toEqual([server.drafts[0]!.lines[0]!.id]);
    await settle();
    expect(server.saveDraft).toHaveBeenCalledOnce();
  });

  describe("an answer naming the same answers and picks in another order", () => {
    const answered: OrderLine = {
      product: beer,
      quantity: "1",
      options: [
        { listId: "size", labelId: "pint" },
        { listId: "glass", labelId: "cold" },
      ],
      extras: [
        { listId: "snacks", productId: "olives", name: "Olives", price: "1.00", quantity: 1 },
        { listId: "snacks", productId: "nuts", name: "Nuts", price: "1.00", quantity: 1 },
      ],
    };

    async function saveAnswered(change: (line: FreshDraftLine) => void): Promise<DraftSync> {
      const draft = sync();
      await draft.load();
      draft.store.loadFrom(draft.store.id, [structuredClone(answered)]);
      draft.store.setLineExtras(0, { note: "no ice" });
      server.saveDraft.mockImplementationOnce(async (partyId, save) => {
        const saved = structuredClone(server.save(partyId, save));
        (saved.lines[0] as FreshDraftLine).options.reverse();
        (saved.lines[0] as FreshDraftLine).extras[0]!.picks.reverse();
        change(saved.lines[0] as FreshDraftLine);
        return saved;
      });
      await draft.flush();
      return draft;
    }

    it("keeps the till's own line", async () => {
      const draft = await saveAnswered(() => {});
      expect(draft.store.lines[0]!.extras).toHaveLength(2);
    });

    it("takes the server's line when a pick's count differs", async () => {
      const draft = await saveAnswered((line) => (line.extras[0]!.picks[0]!.quantity = 2));
      expect(draft.store.lines[0]!.extras).toBeUndefined();
    });
  });

  it("does not send a save once dropped, nor take an answer that lands after", async () => {
    let answer!: () => void;
    const draft = sync();
    await draft.load();
    server.saveDraft.mockImplementationOnce(async (partyId, save) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return structuredClone(server.save(partyId, save));
    });
    draft.store.addProduct(beer, "1");
    await settle();
    draft.store.addProduct(steak, "1");
    const queued = draft.flush();

    draft.drop();
    answer();
    await settle();
    draft.store.addProduct(steak, "1");
    await settle();

    expect(await queued).toBe("failed");
    expect(server.saveDraft).toHaveBeenCalledOnce();
    expect(draft.draftId).toBeNull();
    expect(await draft.flush()).toBe("failed");
  });
});

describe("DraftSync: a refused save", () => {
  it("re-reads the draft another device changed and shows it, never saving over it", async () => {
    const draft = sync();
    await draft.load();
    seed("p1", steak);
    draft.store.addProduct(beer, "1");

    expect(await draft.flush()).toEqual({ refused: "draft.out_of_date" });

    expect(rows(draft)).toEqual(["Steak ×1"]);
    expect(draft.draftId).toBe(server.drafts[0]!.id);
    expect(refused).toEqual(["draft.out_of_date"]);
    await settle();
    expect(server.saveDraft).toHaveBeenCalledOnce();
    expect(server.drafts[0]!.lines.map((line) => line.menuItemId)).toEqual(["offer-steak"]);
  });

  it.each(["draft.taken_over", "draft.not_found", "draft.already_submitted"])(
    "re-reads the drafts after %s and says so",
    async (code) => {
      const theirs = seed("p2", steak);
      const draft = sync();
      await draft.load();
      server.saveDraft.mockRejectedValueOnce({ code, status: 409 });
      draft.store.addProduct(beer, "1");

      expect(await draft.flush()).toEqual({ refused: code });

      expect(server.listDrafts).toHaveBeenCalledTimes(2);
      expect(draft.store.lineCount).toBe(0);
      expect(draft.others.map((other) => other.id)).toEqual([theirs.id]);
      expect(refused).toEqual([code]);
    },
  );

  it("keeps the edit unsaved after a save rejected with nothing at all", async () => {
    const draft = sync();
    await draft.load();
    server.saveDraft.mockRejectedValueOnce(undefined);
    draft.store.addProduct(beer, "1");

    expect(await draft.flush()).toBe("failed");
    expect(refused).toEqual([]);
    expect(await draft.flush()).toBe("saved");
    expect(server.saveDraft).toHaveBeenCalledTimes(2);
  });

  it("says any other refusal without reading the drafts again", async () => {
    const draft = sync();
    await draft.load();
    server.saveDraft.mockRejectedValueOnce({ code: "party.not_open", status: 409 });
    draft.store.addProduct(beer, "1");

    expect(await draft.flush()).toEqual({ refused: "party.not_open" });

    expect(server.listDrafts).toHaveBeenCalledOnce();
    expect(rows(draft)).toEqual(["Beer ×1"]);
    expect(refused).toEqual(["party.not_open"]);
  });

  it("ignores a save answer overtaken by a read", async () => {
    let answer!: () => void;
    const draft = sync();
    await draft.load();
    server.saveDraft.mockImplementationOnce(async (partyId, save) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return structuredClone(server.save(partyId, save));
    });
    draft.store.addProduct(beer, "1");
    const saving = draft.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.saveDraft).toHaveBeenCalledOnce();
    await draft.load();

    answer();
    await saving;

    expect(draft.draftId).toBeNull();
    expect(draft.store.lineCount).toBe(0);
  });
});

describe("DraftSync: a save or read that does not come back", () => {
  it("sends the edits again at the next flush after a refusal that is not about the draft", async () => {
    const draft = sync();
    await draft.load();
    server.saveDraft.mockRejectedValueOnce({ code: "party.not_open", status: 409 });
    draft.store.addProduct(beer, "1");

    expect(await draft.flush()).toEqual({ refused: "party.not_open" });
    expect(await draft.flush()).toBe("saved");

    expect(server.saveDraft).toHaveBeenCalledTimes(2);
  });

  it("gives up on a save with no answer at its limit, and keeps the edit unsaved", async () => {
    const draft = sync();
    await draft.load();
    server.saveDraft.mockImplementationOnce(noAnswer);
    draft.store.addProduct(beer, "1");
    let outcome: unknown;
    void draft.flush().then((value) => (outcome = value));

    await vi.advanceTimersByTimeAsync(LIMIT - 1);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe("failed");

    expect(await draft.flush()).toBe("saved");
    expect(server.saveDraft).toHaveBeenCalledTimes(2);
  });

  it("answers failed when the caller's signal is cut off, and cuts the save off with it", async () => {
    const draft = sync();
    await draft.load();
    server.saveDraft.mockImplementationOnce(noAnswer);
    draft.store.addProduct(beer, "1");
    const caller = new AbortController();
    const flushed = draft.flush(caller.signal);
    await vi.advanceTimersByTimeAsync(0);

    caller.abort();

    expect(await flushed).toBe("failed");
    const [, , options] = server.saveDraft.mock.calls[0] as unknown as [
      string,
      unknown,
      { signal: AbortSignal },
    ];
    expect(options.signal.aborted).toBe(true);
  });

  it("gives up on a read with no answer at its limit", async () => {
    const draft = sync();
    server.listDrafts.mockImplementationOnce(noAnswer);
    let read: boolean | undefined;
    void draft.load().then((value) => (read = value));

    await vi.advanceTimersByTimeAsync(LIMIT - 1);
    expect(read).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toBe(false);
  });
});

describe("DraftSync: signing out", () => {
  it("sends what is unsaved at once when no save is out, and nothing after", async () => {
    const draft = sync();
    await draft.load();
    draft.store.addProduct(beer, "1");

    const closed = draft.close();
    expect(await closed).toBe("saved");
    expect(server.saveDraft).toHaveBeenCalledOnce();

    draft.store.addProduct(steak, "1");
    await settle();
    expect(await draft.flush()).toBe("failed");
    expect(server.saveDraft).toHaveBeenCalledOnce();
  });

  it("sends nothing more while a save is out, since it could go out under the next session", async () => {
    let answer!: () => void;
    const draft = sync();
    await draft.load();
    server.saveDraft.mockImplementationOnce(async (partyId, save) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return structuredClone(server.save(partyId, save));
    });
    draft.store.addProduct(beer, "1");
    await settle();
    draft.store.addProduct(steak, "1");
    const queued = draft.flush();

    const closed = draft.close();
    answer();
    await closed;
    await queued;
    await settle();

    expect(server.saveDraft).toHaveBeenCalledOnce();
  });
});

describe("DraftSync: after a submission", () => {
  it("takes the sent lines out and keeps the rest as they are, when the server kept the same", async () => {
    const draft = sync();
    await draft.load();
    draft.store.addProduct(beer, "1");
    draft.store.addProduct(steak, "1");
    await draft.flush();
    const [sentLine, kept] = draft.store.lines;
    const answered = server.apply("v1", draft.draftId!, {
      submissionId: "s1",
      expectedPartyRevision: 3,
      draftRevision: draft.revision,
      groups: [{ lineIds: draft.lineIds([0])!, release: "fire" }],
    });

    draft.submitted(answered.draft, [sentLine!]);

    expect(draft.store.lines).toEqual([kept]);
    expect(draft.store.lines[0]).toBe(kept);
    expect(draft.revision).toBe(2);
    expect(draft.lineIds([0])).toEqual([answered.draft!.lines[0]!.id]);
    await settle();
    expect(server.saveDraft).toHaveBeenCalledOnce();
  });

  it("empties the draft and forgets its id once every line went", async () => {
    const draft = sync();
    await draft.load();
    draft.store.addProduct(beer, "1");
    await draft.flush();

    draft.submitted(null, draft.store.lines);

    expect(draft.store.lineCount).toBe(0);
    expect(draft.draftId).toBeNull();
    expect(draft.revision).toBe(0);
    draft.store.addProduct(steak, "1");
    await settle();
    expect(server.saveDraft).toHaveBeenLastCalledWith(
      "v1",
      expect.objectContaining({ draftId: null }),
      expect.anything(),
    );
  });

  it("shows the server's rest when it differs from the till's", async () => {
    const draft = sync();
    await draft.load();
    draft.store.addProduct(beer, "1");
    await draft.flush();
    const rest = seed("p9", steak);

    draft.submitted(rest, []);

    expect(rows(draft)).toEqual(["Steak ×1"]);
    expect(draft.lineIds([0])).toEqual([rest.lines[0]!.id]);
  });
});

describe("DraftSync: a party's draft store", () => {
  it.each([
    { slot: 2, joinGroupId: null, afterGroupId: null },
    { slot: 0, joinGroupId: "g3", afterGroupId: null },
    { slot: 1, joinGroupId: null, afterGroupId: "g3" },
  ])(
    "takes a save's changed placement %j instead of keeping a different arrangement",
    async (wire) => {
      const draft = new DraftSync({
        api: server,
        partyId: "v1",
        billId: "wo-4",
        personId: "p1",
        rebuild: (lines) => lines.map((line) => fromDraftLine(line, new Map())),
        onRefused: (code) => refused.push(code),
        requestLimitMs: LIMIT,
      });
      await draft.load();
      draft.store.placer = () => ({ place: { kind: "new", slot: 1 } });
      draft.store.addProduct(steak, "1");
      server.saveDraft.mockImplementationOnce(async (party, input) => {
        const result = server.save(party, input);
        return { ...result, lines: result.lines.map((line) => ({ ...line, ...wire })) };
      });
      expect(await draft.flush()).toBe("saved");
      expect(draft.store.lines[0]!.place).toEqual(
        wire.joinGroupId === null
          ? {
              kind: "new",
              slot: wire.slot,
              ...(wire.afterGroupId === null ? {} : { afterGroupId: wire.afterGroupId }),
            }
          : { kind: "join", groupId: "g3" },
      );
      expect(refused).toEqual([]);
      draft.drop();
    },
  );

  it("keeps line identity when the saved arrangement matches", async () => {
    const draft = sync();
    await draft.load();
    draft.store.placer = () => ({ place: { kind: "new", slot: 2, afterGroupId: "g3" } });
    draft.store.addProduct(steak, "1");
    const line = draft.store.lines[0];
    expect(await draft.flush()).toBe("saved");
    expect(draft.store.lines[0]).toBe(line);
    expect(server.drafts[0]!.lines[0]).toMatchObject({
      slot: 2,
      joinGroupId: null,
      afterGroupId: "g3",
    });
    draft.drop();
  });

  it("does not shift another line when an addition exceeds the order limit", () => {
    const store = new DraftStore();
    store.addProduct(beer, "1");
    store.lines[0]!.place = { kind: "new", slot: 1 };
    store.simplifiedInvoiceLimit = "3.00";
    store.placer = () => ({ place: { kind: "new", slot: 1 }, shift: { from: 1 } });
    store.markPersisted();
    const changed = vi.fn();
    store.subscribe(changed);
    store.addProduct(steak, "1");
    expect(store.lines.map((line) => ({ product: line.product.id, place: line.place }))).toEqual([
      { product: "beer", place: { kind: "new", slot: 1 } },
    ]);
    expect(changed).not.toHaveBeenCalled();
    expect(store.dirty).toBe(false);
  });

  it("shifts other groups when changing a line's course inserts an earlier slot", () => {
    const store = new DraftStore();
    store.loadFrom("draft", [
      { product: steak, quantity: "1", place: { kind: "new", slot: 1 } },
      { product: beer, quantity: "1", place: { kind: "fire" } },
    ]);
    store.placer = () => ({ place: { kind: "new", slot: 1 }, shift: { from: 1 } });
    store.setLineCourse(1, "mains");
    expect(store.lines.map((line) => line.place)).toEqual([
      { kind: "new", slot: 2 },
      { kind: "new", slot: 1 },
    ]);
  });

  it("places additions by their effective course and merges only matching places", () => {
    const store = new DraftStore();
    let place: Place = { kind: "new", slot: 1 };
    const courses: (string | null)[] = [];
    store.placer = (courseId) => {
      courses.push(courseId);
      return { place };
    };
    store.addProduct({ ...steak, courseId: "mains" }, "1");
    store.addProduct({ ...steak, courseId: "mains" }, "2");
    place = { kind: "fire" };
    store.addProduct({ ...steak, courseId: "mains" }, "1");
    expect(store.lines.map((line) => ({ quantity: line.quantity, place: line.place }))).toEqual([
      { quantity: "3", place: { kind: "new", slot: 1 } },
      { quantity: "1", place: { kind: "fire" } },
    ]);
    expect(courses).toEqual(["mains", "mains", "mains"]);
  });

  it("shifts existing slots before adding a line without merging into the displaced slot", () => {
    const store = new DraftStore();
    store.loadFrom("draft", [{ product: steak, quantity: "1", place: { kind: "new", slot: 1 } }]);
    const changed = vi.fn();
    store.subscribe(changed);
    store.placer = () => ({ place: { kind: "new", slot: 1 }, shift: { from: 1 } });
    store.addMerging(steak, "1");
    expect(store.lines.map((line) => line.place)).toEqual([
      { kind: "new", slot: 2 },
      { kind: "new", slot: 1 },
    ]);
    expect(store.lines.map((line) => line.quantity)).toEqual(["1", "1"]);
    expect(changed).toHaveBeenCalledOnce();
  });

  it("re-places only the changed course, excluding that line from the placement context", () => {
    const store = new DraftStore();
    store.loadFrom("draft", [
      { product: { ...steak, courseId: "mains" }, quantity: "1", place: { kind: "new", slot: 1 } },
      { product: beer, quantity: "1", place: { kind: "fire" } },
    ]);
    const calls: unknown[] = [];
    store.placer = (courseId, exceptIndex) => {
      calls.push([courseId, exceptIndex]);
      return { place: { kind: "join", groupId: "g3" } };
    };
    const changed = vi.fn();
    store.subscribe(changed);
    store.setLineCourse(0, "desserts");
    expect(store.lines.map((line) => line.place)).toEqual([
      { kind: "join", groupId: "g3" },
      { kind: "fire" },
    ]);
    expect(calls).toEqual([["desserts", 0]]);
    expect(changed).toHaveBeenCalledOnce();
    store.setLineCourse(0, undefined);
    expect(calls).toEqual([
      ["desserts", 0],
      ["mains", 0],
    ]);
    expect(store.lines[0]!.courseId).toBeUndefined();
  });

  it("leaves an unseated store's additions unplaced", () => {
    const store = new DraftStore();
    store.addProduct(steak, "1");
    expect(store.lines[0]).not.toHaveProperty("place");
  });

  it("adds a tap into the line ordering the same thing", () => {
    const draft = sync();
    draft.store.addProduct(beer, "1");
    draft.store.addProduct(steak, "1");
    draft.store.addProduct(beer, "2");
    expect(rows(draft)).toEqual(["Beer ×3", "Steak ×1"]);
  });
});

describe("DraftSync: taking over another person's draft", () => {
  it("takes the draft over as the person's own, under its id and the answered revision", async () => {
    const theirs = structuredClone(seed("p2", steak));
    const draft = sync();
    await draft.load();

    expect(await draft.takeOver(theirs.id, theirs.revision)).toBe("taken");

    expect(server.takeOverDraft).toHaveBeenCalledExactlyOnceWith(
      "v1",
      theirs.id,
      theirs.revision,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(rows(draft)).toEqual(["Steak ×1"]);
    expect(draft.draftId).toBe(theirs.id);
    expect(draft.revision).toBe(theirs.revision + 1);
    expect(draft.others).toEqual([]);
    expect(server.saveDraft).not.toHaveBeenCalled();
    draft.store.addProduct(beer, "1");
    await settle();
    expect(server.saveDraft).toHaveBeenLastCalledWith(
      "v1",
      expect.objectContaining({ draftId: theirs.id, revision: theirs.revision + 1 }),
      expect.anything(),
    );
    expect(refused).toEqual([]);
  });

  it("saves the person's own edit first, then takes the draft the server added into theirs", async () => {
    const theirs = seed("p2", steak);
    const draft = sync();
    await draft.load();
    draft.store.addProduct(beer, "1");

    expect(await draft.takeOver(theirs.id, theirs.revision)).toBe("taken");

    const saved = server.saveDraft.mock.invocationCallOrder[0]!;
    expect(saved).toBeLessThan(server.takeOverDraft.mock.invocationCallOrder[0]!);
    const own = server.drafts.find((each) => each.ownerId === "p1")!;
    expect(draft.draftId).toBe(own.id);
    expect(draft.draftId).not.toBe(theirs.id);
    expect(rows(draft)).toEqual(["Beer ×1", "Steak ×1"]);
    expect(draft.lineIds([0, 1])).toEqual(own.lines.map((line) => line.id));
    expect(draft.others).toEqual([]);
  });

  it("keeps the other people's drafts it did not take", async () => {
    const theirs = seed("p2", steak);
    const another = seed("p3", beer);
    const draft = sync();
    await draft.load();

    expect(await draft.takeOver(theirs.id, theirs.revision)).toBe("taken");

    expect(draft.others.map((other) => other.id)).toEqual([another.id]);
  });

  it("takes nothing over when the person's own edit could not be saved", async () => {
    const theirs = seed("p2", steak);
    const draft = sync();
    await draft.load();
    server.saveDraft.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    draft.store.addProduct(beer, "1");

    expect(await draft.takeOver(theirs.id, theirs.revision)).toBe("unsaved");

    expect(server.takeOverDraft).not.toHaveBeenCalled();
    expect(rows(draft)).toEqual(["Beer ×1"]);
    expect(draft.lineIds([0])).toBeNull();
  });

  it("takes nothing over when the person's own edit was refused, which it has already said", async () => {
    const theirs = seed("p2", steak);
    const draft = sync();
    await draft.load();
    server.saveDraft.mockRejectedValueOnce({ code: "party.not_open", status: 409 });
    draft.store.addProduct(beer, "1");

    expect(await draft.takeOver(theirs.id, theirs.revision)).toBe("unsaved");

    expect(server.takeOverDraft).not.toHaveBeenCalled();
    expect(refused).toEqual(["party.not_open"]);
  });

  it("reads the drafts again, and sends nothing more, when the draft moved on since it was read", async () => {
    const theirs = seed("p2", steak);
    const draft = sync();
    await draft.load();
    const reads = server.listDrafts.mock.calls.length;

    expect(await draft.takeOver(theirs.id, theirs.revision - 1)).toEqual({
      refused: "draft.out_of_date",
    });

    expect(server.takeOverDraft).toHaveBeenCalledOnce();
    expect(server.listDrafts).toHaveBeenCalledTimes(reads + 1);
    expect(draft.others.map((other) => other.ownerId)).toEqual(["p2"]);
    expect(draft.draftId).toBeNull();
    expect(rows(draft)).toEqual([]);
    await settle();
    expect(server.takeOverDraft).toHaveBeenCalledOnce();
    expect(server.saveDraft).not.toHaveBeenCalled();
  });

  it("reads the drafts again when the take-over got no answer by its limit", async () => {
    const theirs = seed("p2", steak);
    const draft = sync();
    await draft.load();
    server.takeOverDraft.mockImplementationOnce(noAnswer);
    const reads = server.listDrafts.mock.calls.length;

    const outcome = draft.takeOver(theirs.id, theirs.revision);
    await vi.advanceTimersByTimeAsync(LIMIT);

    expect(await outcome).toBe("failed");
    expect(server.listDrafts).toHaveBeenCalledTimes(reads + 1);
    expect(server.takeOverDraft).toHaveBeenCalledOnce();
  });

  it("takes no answer, and reads nothing, once dropped while the take-over was out", async () => {
    const theirs = seed("p2", steak);
    const draft = sync();
    await draft.load();
    let answer!: (value: Draft) => void;
    server.takeOverDraft.mockImplementationOnce(
      () => new Promise<Draft>((resolve) => (answer = resolve)),
    );
    const reads = server.listDrafts.mock.calls.length;

    const outcome = draft.takeOver(theirs.id, theirs.revision);
    await vi.advanceTimersByTimeAsync(0);
    draft.drop();
    answer(structuredClone(server.takeOver("v1", theirs.id, theirs.revision)));

    expect(await outcome).toBe("failed");
    expect(rows(draft)).toEqual([]);
    expect(draft.draftId).toBeNull();
    expect(server.listDrafts).toHaveBeenCalledTimes(reads);
  });

  it("reads nothing again for a refusal answering once dropped", async () => {
    const theirs = seed("p2", steak);
    const draft = sync();
    await draft.load();
    let refuse!: (error: unknown) => void;
    server.takeOverDraft.mockImplementationOnce(
      () => new Promise<Draft>((_resolve, reject) => (refuse = reject)),
    );
    const reads = server.listDrafts.mock.calls.length;

    const outcome = draft.takeOver(theirs.id, theirs.revision);
    await vi.advanceTimersByTimeAsync(0);
    draft.drop();
    refuse({ code: "draft.out_of_date", status: 409 });

    expect(await outcome).toBe("failed");
    expect(server.listDrafts).toHaveBeenCalledTimes(reads);
  });

  it("takes no edit while the take-over is out, so none is lost to the answer", async () => {
    const theirs = structuredClone(seed("p2", steak));
    const draft = sync();
    await draft.load();
    let answer!: (value: Draft) => void;
    server.takeOverDraft.mockImplementationOnce(
      () => new Promise<Draft>((resolve) => (answer = resolve)),
    );

    const outcome = draft.takeOver(theirs.id, theirs.revision);
    await vi.advanceTimersByTimeAsync(0);
    expect(draft.store.sending).toBe(true);
    draft.store.addProduct(beer, "1");
    answer(structuredClone(server.takeOver("v1", theirs.id, theirs.revision)));

    expect(await outcome).toBe("taken");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(rows(draft)).toEqual(["Steak ×1"]);
    expect(server.saveDraft).not.toHaveBeenCalled();
    expect(draft.store.sending).toBe(false);
    draft.store.addProduct(beer, "1");
    await settle();
    expect(server.saveDraft).toHaveBeenCalledOnce();
  });

  it("leaves a send's lock in place when a take-over ends during it", async () => {
    const theirs = seed("p2", steak);
    const draft = sync();
    await draft.load();
    draft.store.sending = true;

    await draft.takeOver(theirs.id, theirs.revision);

    expect(draft.store.sending).toBe(true);
  });

  it("passes the new owner's name on with a save refused as taken over", async () => {
    const names: (string | undefined)[] = [];
    const draft = new DraftSync({
      api: server,
      partyId: "v1",
      billId: "wo-4",
      personId: "p1",
      rebuild,
      onRefused: (_code, ownerName) => names.push(ownerName),
      requestLimitMs: LIMIT,
    });
    await draft.load();
    server.saveDraft.mockRejectedValueOnce({
      code: "draft.taken_over",
      status: 409,
      ownerId: "p2",
      ownerName: "Sam",
    });
    draft.store.addProduct(beer, "1");

    expect(await draft.flush()).toEqual({ refused: "draft.taken_over", ownerName: "Sam" });
    expect(names).toEqual(["Sam"]);
  });
});

describe("DraftSync: what the server says about each line", () => {
  const flags = (draft: DraftSync) => draft.store.lines.map((line) => line.unavailableOnServer);

  it("takes the server's flag onto the till's own lines from a save answer that matches them", async () => {
    const draft = sync();
    await draft.load();
    draft.store.addProduct(beer, "1");
    const [tapped] = draft.store.lines;
    server.unavailable.add("offer-beer");

    await draft.flush();

    expect(draft.store.lines[0]).toBe(tapped);
    expect(flags(draft)).toEqual([true]);
    server.unavailable.clear();
    draft.store.addProduct(steak, "1");
    await draft.flush();
    expect(flags(draft)).toEqual([undefined, undefined]);
    await settle();
    expect(server.saveDraft).toHaveBeenCalledTimes(2);
  });

  it("takes the flag from a submission's answer onto the lines it keeps", async () => {
    const draft = sync();
    await draft.load();
    draft.store.addProduct(beer, "1");
    draft.store.addProduct(steak, "1");
    await draft.flush();
    const [sentLine] = draft.store.lines;
    server.unavailable.add("offer-steak");
    const answered = server.apply("v1", draft.draftId!, {
      submissionId: "s1",
      expectedPartyRevision: 3,
      draftRevision: draft.revision,
      groups: [{ lineIds: draft.lineIds([0])!, release: "fire" }],
    });

    draft.submitted(answered.draft, [sentLine!]);

    expect(flags(draft)).toEqual([true]);
  });

  it("says when the server's draft has replaced what the store held, and not when a save matched it", async () => {
    seed("p1", beer);
    const draft = sync();
    await draft.load();
    expect(replaced).toBe(1);

    draft.store.addProduct(steak, "1");
    await draft.flush();
    expect(replaced).toBe(1);
  });

  it("shows lines re-priced by position without saving them, and keeps an unsaved edit to save", async () => {
    seed("p1", beer);
    const draft = sync();
    await draft.load();
    const [shown] = draft.store.lines;
    const repriced = (price: string) =>
      new Map([[0, { product: { ...beer, unitPrice: price }, quantity: "1" }]]);

    draft.reshow(repriced("3.50"));
    draft.reshow(new Map());
    await settle();
    expect(draft.store.lines[0]).toBe(shown);
    expect(draft.store.lines[0]!.product.unitPrice).toBe("3.50");
    expect(server.saveDraft).not.toHaveBeenCalled();

    draft.store.addProduct(steak, "1");
    draft.reshow(repriced("4.00"));
    await settle();
    expect(server.saveDraft).toHaveBeenCalledOnce();
    expect(server.drafts[0]!.lines.map((line) => line.menuItemId)).toEqual([
      "offer-beer",
      "offer-steak",
    ]);
  });

  it("says whether a save is out", async () => {
    let answer!: () => void;
    const draft = sync();
    await draft.load();
    server.saveDraft.mockImplementationOnce(async (partyId, save) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return structuredClone(server.save(partyId, save));
    });
    draft.store.addProduct(beer, "1");
    expect(draft.saving).toBe(false);
    await settle();
    expect(draft.saving).toBe(true);

    answer();
    await settle();
    expect(draft.saving).toBe(false);
  });
});

describe("pause", () => {
  it("settles at once for a signal already aborted", async () => {
    const settled = vi.fn();
    void pause(AbortSignal.abort()).then(settled);
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toHaveBeenCalledOnce();
  });

  it("settles after its time, or as soon as the signal aborts", async () => {
    const timed = vi.fn();
    const cut = vi.fn();
    const abort = new AbortController();
    void pause(new AbortController().signal, 20).then(timed);
    void pause(abort.signal, 60_000).then(cut);

    abort.abort();
    await vi.advanceTimersByTimeAsync(19);
    expect(cut).toHaveBeenCalledOnce();
    expect(timed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(timed).toHaveBeenCalledOnce();
  });
});

describe("resendUnanswered", () => {
  const noAnswer = new TypeError("Failed to fetch");
  const unanswered = () =>
    vi.fn<(signal: AbortSignal) => Promise<string>>(() => Promise.reject(noAnswer));
  const outcome = (sent: Promise<string>) => sent.catch((error: unknown) => error);

  it("sends again after each pause while there is no answer, up to its retries, then gives up", async () => {
    const send = unanswered();
    const settled = outcome(resendUnanswered(send, new AbortController().signal, () => true));

    await vi.advanceTimersByTimeAsync(SUBMIT_RETRY_PAUSE_MS - 1);
    expect(send).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(SUBMIT_RETRIES * SUBMIT_RETRY_PAUSE_MS);

    expect(send).toHaveBeenCalledTimes(SUBMIT_RETRIES + 1);
    expect(await settled).toBe(noAnswer);
  });

  it("sends nothing more once the session it was sent for has ended", async () => {
    const send = unanswered();
    let live = true;
    const settled = outcome(resendUnanswered(send, new AbortController().signal, () => live));

    live = false;
    await vi.advanceTimersByTimeAsync(SUBMIT_RETRIES * SUBMIT_RETRY_PAUSE_MS);

    expect(send).toHaveBeenCalledOnce();
    expect(await settled).toBe(noAnswer);
  });

  it("sends nothing more once its signal ends the wait", async () => {
    const send = unanswered();
    const limit = new AbortController();
    const settled = outcome(resendUnanswered(send, limit.signal, () => true));

    await vi.advanceTimersByTimeAsync(SUBMIT_RETRY_PAUSE_MS - 1);
    limit.abort();
    await vi.advanceTimersByTimeAsync(SUBMIT_RETRIES * SUBMIT_RETRY_PAUSE_MS);

    expect(send).toHaveBeenCalledOnce();
    expect(await settled).toBe(noAnswer);
  });

  it("returns the first answer without sending again", async () => {
    const send = vi.fn<(signal: AbortSignal) => Promise<string>>(() => Promise.resolve("answered"));

    expect(await resendUnanswered(send, new AbortController().signal, () => true)).toBe("answered");
    expect(send).toHaveBeenCalledOnce();
  });
});

describe("A773 drafts on a bill that is no longer open", () => {
  it.each(["placed", "settled", "abandoned"] as const)(
    "%s refuses edits and saves without losing the pending dishes",
    async (status) => {
      const s = sync();
      s.store.addProduct(beer, "1");
      s.billStatus = status;
      s.store.addProduct(steak, "1");
      s.store.setLineQuantity(0, "2");
      s.store.setLineModifiers(0, { note: "changed" });
      s.store.setLineCourse(0, "mains");
      s.store.setLineMakeAt(0, "grill");
      s.store.setLinePlaces([0], { kind: "new", slot: 2 });
      s.store.removeLine(0);
      await settle();
      expect(
        s.store.lines.map((line) => [
          line.product.name,
          line.quantity,
          line.note,
          line.courseId,
          line.makeAt,
          line.place,
        ]),
      ).toEqual([["Beer", "1", undefined, undefined, undefined, undefined]]);
      expect(server.drafts).toEqual([]);
      expect(await s.flush()).toEqual({
        refused:
          status === "placed"
            ? "bill.presented"
            : status === "abandoned"
              ? "tab.not_open"
              : "bill.paid",
      });
      expect(server.drafts).toEqual([]);
      expect(s.store.lines[0]!.product.name).toBe("Beer");
      s.drop();
    },
  );

  it("an authoritative read cannot clear the bill's edit restriction", async () => {
    seed("p1", beer);
    const s = sync();
    s.billStatus = "settled";
    expect(await s.load()).toBe(true);
    s.store.addProduct(steak, "1");
    expect(s.store.lines.map((line) => line.product.name)).toEqual(["Beer"]);
    expect(s.store.editsLocked).toBe(true);
    s.drop();
  });

  it("a bill reopening permits retained edits to save without clearing a separate read lock", async () => {
    const s = sync();
    s.store.addProduct(beer, "1");
    s.billStatus = "placed";
    const unlock = s.store.lockEdits();
    s.billStatus = "open";
    s.store.addProduct(steak, "1");
    expect(s.store.lines.map((line) => line.product.name)).toEqual(["Beer"]);
    unlock();
    s.store.addProduct(steak, "1");
    expect(await s.flush()).toBe("saved");
    expect(server.drafts[0]!.lines.map((line) => [line.menuItemId, line.quantity])).toEqual([
      ["offer-beer", "1"],
      ["offer-steak", "1"],
    ]);
    s.drop();
  });

  it("cannot take over a colleague's draft on a presented bill", async () => {
    const theirs = seed("p2", steak);
    const s = sync();
    await s.load();
    s.billStatus = "placed";
    expect(await s.takeOver(theirs.id, theirs.revision)).toEqual({ refused: "bill.presented" });
    expect(server.drafts[0]!.ownerId).toBe("p2");
    expect(s.store.lines).toEqual([]);
    s.drop();
  });

  it("sign-out does not write pending dishes onto a paid bill", async () => {
    const s = sync();
    s.store.addProduct(beer, "1");
    s.billStatus = "settled";
    expect(await s.close()).toEqual({ refused: "bill.paid" });
    expect(server.drafts).toEqual([]);
    expect(s.store.lines[0]!.product.name).toBe("Beer");
    s.drop();
  });
});
