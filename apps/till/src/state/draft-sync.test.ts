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

let server: DraftServer;
let refused: string[];

function sync(personId = "p1"): DraftSync {
  return new DraftSync({
    api: server,
    visitId: "v1",
    personId,
    rebuild,
    onRefused: (code) => refused.push(code),
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
    expect(server.saveDraft).toHaveBeenCalledWith("v1", {
      draftId: null,
      revision: 0,
      lines: [expect.objectContaining({ menuItemId: "offer-beer", quantity: "3" })],
    });
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

    expect(server.saveDraft).toHaveBeenLastCalledWith("v1", {
      draftId: server.drafts[0]!.id,
      revision: 1,
      lines: [expect.anything(), expect.anything()],
    });
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
