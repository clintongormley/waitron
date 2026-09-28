import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftServer, type DraftServer } from "../widgets/test-helpers.js";
import { DRAFT_SAVE_DELAY_MS, DraftSync } from "./draft-sync.js";
import type { OrderLine } from "./working-order.js";
import type { Draft, DraftLine, TillProduct } from "../api/client.js";

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
    product: byOffer.get(line.menuItemId)!,
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

function sync(personId = "p1"): DraftSync {
  return new DraftSync({
    api: server,
    visitId: "v1",
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
    draftId: null,
    revision: 0,
    lines: products.map((product) => ({
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

describe("DraftSync: saving", () => {
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
    server.saveDraft.mockImplementationOnce(async (visitId, save) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return structuredClone(server.save(visitId, save));
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

    async function saveAnswered(change: (line: DraftLine) => void): Promise<DraftSync> {
      const draft = sync();
      await draft.load();
      draft.store.loadFrom(draft.store.id, [structuredClone(answered)]);
      draft.store.setLineExtras(0, { note: "no ice" });
      server.saveDraft.mockImplementationOnce(async (visitId, save) => {
        const saved = structuredClone(server.save(visitId, save));
        saved.lines[0]!.options.reverse();
        saved.lines[0]!.extras[0]!.picks.reverse();
        change(saved.lines[0]!);
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
    server.saveDraft.mockImplementationOnce(async (visitId, save) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return structuredClone(server.save(visitId, save));
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
    server.saveDraft.mockRejectedValueOnce({ code: "visit.not_open", status: 409 });
    draft.store.addProduct(beer, "1");

    expect(await draft.flush()).toEqual({ refused: "visit.not_open" });

    expect(server.listDrafts).toHaveBeenCalledOnce();
    expect(rows(draft)).toEqual(["Beer ×1"]);
    expect(refused).toEqual(["visit.not_open"]);
  });

  it("ignores a save answer overtaken by a read", async () => {
    let answer!: () => void;
    const draft = sync();
    await draft.load();
    server.saveDraft.mockImplementationOnce(async (visitId, save) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return structuredClone(server.save(visitId, save));
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
    server.saveDraft.mockRejectedValueOnce({ code: "visit.not_open", status: 409 });
    draft.store.addProduct(beer, "1");

    expect(await draft.flush()).toEqual({ refused: "visit.not_open" });
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
    server.saveDraft.mockImplementationOnce(async (visitId, save) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return structuredClone(server.save(visitId, save));
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
      expectedVisitRevision: 3,
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
    server.saveDraft.mockRejectedValueOnce({ code: "visit.not_open", status: 409 });
    draft.store.addProduct(beer, "1");

    expect(await draft.takeOver(theirs.id, theirs.revision)).toBe("unsaved");

    expect(server.takeOverDraft).not.toHaveBeenCalled();
    expect(refused).toEqual(["visit.not_open"]);
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
      visitId: "v1",
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
      expectedVisitRevision: 3,
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
    server.saveDraft.mockImplementationOnce(async (visitId, save) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return structuredClone(server.save(visitId, save));
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
