import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BillDraftSnapshot,
  BillEditState,
  DraftSave,
  Draft,
  DraftLine,
  PartyDraftSnapshot,
  TillProduct,
  RecalledDraftLine,
} from "../api/client.js";
import { DraftSync, DRAFT_SAVE_DELAY_MS, type RetainedDraftCandidate } from "./draft-sync.js";
import { fromDraftLine } from "./draft-lines.js";

const salad: TillProduct = {
  id: "salad",
  menuItemId: "offer-salad",
  name: "Salad",
  pricingUnit: "each",
  unitPrice: "4.00",
  vatClass: "general",
  category: null,
  allergens: null,
};
const steak: TillProduct = { ...salad, id: "steak", menuItemId: "offer-steak", name: "Steak" };
const blank = (billId = "bill-1", editorVersion = 0): BillEditState => ({
  billId,
  editorId: null,
  editorName: null,
  editorVersion,
  draftId: null,
  draftRevision: null,
});
const row = (product: TillProduct, id = "line-1"): DraftLine => ({
  id,
  sourceLineId: null,
  source: null,
  menuItemId: product.menuItemId!,
  variantId: null,
  menuVersionId: null,
  options: [],
  extras: [],
  note: null,
  quantity: "1",
  courseId: null,
  noMerge: false,
  slot: 0,
  joinGroupId: null,
  afterGroupId: null,
  unavailable: false,
});
function saved(personId = "ana", version = 1, revision = 1): BillDraftSnapshot {
  const draft: Draft = {
    id: "draft-1",
    partyId: "party-1",
    billId: "bill-1",
    ownerId: personId,
    ownerName: personId === "ana" ? "Ana" : "Luis",
    revision,
    lines: [row(steak)],
    takenOverFrom: null,
  };
  return {
    draft,
    edit: {
      billId: draft.billId,
      editorId: personId,
      editorName: draft.ownerName,
      editorVersion: version,
      draftId: draft.id,
      draftRevision: revision,
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const syncs: DraftSync[] = [];
function fixture(
  initial: BillDraftSnapshot = { draft: null, edit: blank() },
  options: {
    candidates?: Map<string, RetainedDraftCandidate>;
    personId?: string;
    partyId?: string;
  } = {},
) {
  let current = structuredClone(initial);
  const wire = (): PartyDraftSnapshot => ({
    drafts: current.draft === null ? [] : [structuredClone(current.draft)],
    billEdits: [structuredClone(current.edit)],
  });
  const api = {
    listDrafts: vi.fn(async () => wire()),
    saveDraft: vi.fn<
      (
        _party: string,
        _save: DraftSave,
        _options?: { signal?: AbortSignal },
      ) => Promise<BillDraftSnapshot>
    >(async () => structuredClone(current)),
    takeOverDraft: vi.fn(async () => structuredClone(current)),
  };
  const onRefused = vi.fn();
  const sync = new DraftSync({
    api,
    partyId: options.partyId ?? "party-1",
    billId: "bill-1",
    personId: options.personId ?? "ana",
    candidates: options.candidates,
    rebuild: (lines) =>
      lines.map((line) =>
        line.sourceLineId !== null
          ? fromDraftLine(line, new Map())
          : {
              product: line.menuItemId === "offer-salad" ? salad : steak,
              quantity: line.quantity,
              draftLineId: line.id,
            },
      ),
    onRefused,
    requestLimitMs: 5000,
  });
  syncs.push(sync);
  return {
    sync,
    api,
    onRefused,
    wire,
    set: (next: BillDraftSnapshot) => {
      current = structuredClone(next);
    },
  };
}
afterEach(() => {
  for (const sync of syncs.splice(0)) sync.drop();
  vi.useRealTimers();
});

describe("bill-scoped saved work and retained local candidates", () => {
  it.each(["other-bill", "old-generation", "old-editor"] as const)(
    "does not replace the current outbox with an %s command snapshot",
    async (stale) => {
      const { sync, api } = fixture(saved("ana", 3, 4));
      await sync.load();
      const line = sync.store.lines[0]!;
      const before = sync.expectedEdit;
      const incoming = saved("luis", stale === "old-editor" ? 2 : 4, 5);
      if (stale === "other-bill") incoming.edit.billId = "bill-2";
      sync.applyBillSnapshot(incoming, sync.generation - (stale === "old-generation" ? 1 : 0));
      expect(sync.expectedEdit).toEqual(before);
      expect(sync.store.lines[0]).toBe(line);
      expect(sync.store.editsLocked).toBe(false);
      expect(sync.others).toEqual([]);
      expect(api.saveDraft).not.toHaveBeenCalled();
    },
  );

  it("keeps confirmed authority when a read names a draft it did not return", async () => {
    const { sync, api } = fixture(saved());
    await sync.load();
    const line = sync.store.lines[0]!;
    api.listDrafts.mockResolvedValueOnce({ drafts: [], billEdits: [saved("luis", 2).edit] });
    expect(await sync.load()).toBe(false);
    expect(sync.edit).toEqual(saved().edit);
    expect(sync.store.lines[0]).toBe(line);
    expect(sync.store.editsLocked).toBe(false);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("ignores candidate resolution when no local work was retained", async () => {
    const { sync, api } = fixture(saved());
    await sync.load();
    const line = sync.store.lines[0]!;
    sync.resolveCandidate([]);
    expect(sync.store.lines[0]).toBe(line);
    expect(sync.candidate).toBeNull();
    expect(await sync.flush()).toBe("saved");
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("applies a reviewed local candidate only after the new owner's saved view is read", async () => {
    const { sync, api, set } = fixture(saved());
    await sync.load();
    sync.store.addProduct(salad, "2");
    set(saved("ana", 2, 2));
    await sync.load();
    const candidate = sync.candidate!;
    expect(candidate.lines.map((line) => line.product.name)).toEqual(["Steak", "Salad"]);
    expect(sync.store.lines.map((line) => line.product.name)).toEqual(["Steak"]);
    sync.resolveCandidate(candidate.lines);
    expect(sync.candidate).toBeNull();
    expect(sync.store.editsLocked).toBe(false);
    expect(sync.store.lines.map((line) => [line.product.name, line.quantity])).toEqual([
      ["Steak", "1"],
      ["Salad", "2"],
    ]);
    expect(api.saveDraft).not.toHaveBeenCalled();
    await sync.flush();
    expect(api.saveDraft.mock.calls[0]![1].expectedEdit).toEqual({
      billId: "bill-1",
      editorVersion: 2,
      draftId: "draft-1",
      draftRevision: 2,
    });
  });

  it.each(["aborted", "left", "ended"] as const)(
    "does not save recovered placement after its read becomes %s",
    async (stale) => {
      const { sync, api, wire } = fixture(saved());
      await sync.load();
      const line = sync.store.lines[0]!;
      const pending = deferred<PartyDraftSnapshot>();
      api.listDrafts.mockImplementationOnce(() => pending.promise);
      const controller = new AbortController();
      let live = true;
      const correcting = sync.correctPlaces(
        new Map([[0, { ...line, place: { kind: "new", slot: 2 } }]]),
        controller.signal,
        () => live,
      );
      await vi.waitFor(() => expect(api.listDrafts).toHaveBeenCalledTimes(2));
      if (stale === "aborted") controller.abort();
      if (stale === "left") live = false;
      if (stale === "ended") sync.drop();
      pending.resolve(wire());
      expect(await correcting).toBe("failed");
      expect(api.saveDraft).not.toHaveBeenCalled();
      if (stale !== "ended")
        expect(sync.store.lines[0]!.place).not.toEqual({ kind: "new", slot: 2 });
    },
  );

  it("refuses recovered placement when a same-editor draft changes during the read", async () => {
    const { sync, api, wire } = fixture(saved());
    await sync.load();
    const line = sync.store.lines[0]!;
    const answer = wire();
    answer.drafts[0]!.revision++;
    api.listDrafts.mockResolvedValueOnce(answer);
    expect(
      await sync.correctPlaces(
        new Map([[0, { ...line, place: { kind: "new", slot: 2 } }]]),
        new AbortController().signal,
        () => true,
      ),
    ).toEqual({ refused: "draft.out_of_date" });
    expect(sync.store.lines[0]).toBe(line);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("does not begin a second placement recovery while the first read is held", async () => {
    const { sync, api, wire } = fixture(saved());
    await sync.load();
    const pending = deferred<PartyDraftSnapshot>();
    api.listDrafts.mockImplementationOnce(() => pending.promise);
    const replacements = new Map([
      [0, { ...sync.store.lines[0]!, place: { kind: "fire" as const } }],
    ]);
    const first = sync.correctPlaces(replacements, new AbortController().signal, () => true);
    await vi.waitFor(() => expect(api.listDrafts).toHaveBeenCalledTimes(2));
    expect(await sync.correctPlaces(replacements, new AbortController().signal, () => true)).toBe(
      "failed",
    );
    pending.resolve(wire());
    expect(await first).toBe("saved");
    expect(api.saveDraft).toHaveBeenCalledOnce();
  });

  it("shows the bill editor's saved dishes read-only and takes over without a preparatory save", async () => {
    const { sync, api, set } = fixture(saved("luis", 3, 4));
    expect(await sync.load()).toBe(true);
    expect(sync.store.lines.map((line) => line.product.name)).toEqual(["Steak"]);
    expect(sync.store.editsLocked).toBe(true);
    sync.store.addProduct(salad, "1");
    expect(sync.store.lineCount).toBe(1);
    set(saved("ana", 4, 5));
    expect(await sync.takeOver("draft-1", 4)).toBe("taken");
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(api.takeOverDraft).toHaveBeenCalledExactlyOnceWith(
      "party-1",
      "draft-1",
      {
        revision: 4,
        submissionId: expect.any(String),
        expectedEdit: { billId: "bill-1", editorVersion: 3, draftId: "draft-1", draftRevision: 4 },
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(sync.store.editsLocked).toBe(false);
    expect(sync.edit).toEqual(saved("ana", 4, 5).edit);
  });

  it.each(["adoptLines", "removeLines", "clear"] as const)(
    "keeps the retained candidate separate when %s runs during takeover",
    async (operation) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const { sync, api, set } = fixture();
      await sync.load();
      sync.store.addProduct(salad, "2", { note: "No salt" });
      set(saved("luis", 3, 4));
      await sync.load();
      const candidate = structuredClone(sync.candidate);
      expect(candidate).toMatchObject({
        personId: "ana",
        partyId: "party-1",
        billId: "bill-1",
        base: { billId: "bill-1", editorVersion: 0, draftId: null, draftRevision: null },
        lines: [{ product: { name: "Salad" }, quantity: "2", note: "No salt" }],
      });
      const pending = deferred<BillDraftSnapshot>();
      api.takeOverDraft.mockImplementationOnce(() => pending.promise);
      const taking = sync.takeOver("draft-1", 4);
      await vi.advanceTimersByTimeAsync(0);
      expect(api.takeOverDraft).toHaveBeenCalledOnce();
      expect(sync.store.sending).toBe(true);

      if (operation === "adoptLines")
        sync.store.adoptLines(new Map([[0, { product: salad, quantity: "7" }]]));
      else if (operation === "removeLines") sync.store.removeLines([...sync.store.lines]);
      else sync.store.clear();
      await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS);
      expect(api.saveDraft).not.toHaveBeenCalled();
      expect(sync.candidate).toEqual(candidate);

      const taken = saved("ana", 4, 5);
      set(taken);
      pending.resolve(taken);
      expect(await taking).toBe("taken");
      await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS);
      expect(sync.store.lines.map((line) => [line.product.name, line.quantity])).toEqual([
        ["Steak", "1"],
      ]);
      expect(sync.edit).toEqual({
        billId: "bill-1",
        editorId: "ana",
        editorName: "Ana",
        editorVersion: 4,
        draftId: "draft-1",
        draftRevision: 5,
      });
      expect(sync.candidate).toEqual(candidate);
      expect(sync.store.editsLocked).toBe(true);
      expect(await sync.flush()).toBe("failed");
      expect(api.saveDraft).not.toHaveBeenCalled();

      sync.resolveCandidate(null);
      expect(sync.candidate).toBeNull();
      expect(sync.store.editsLocked).toBe(false);
      sync.store.addProduct(salad, "3");
      expect(await sync.flush()).toBe("saved");
      expect(api.saveDraft).toHaveBeenCalledExactlyOnceWith(
        "party-1",
        {
          billId: "bill-1",
          draftId: "draft-1",
          revision: 5,
          expectedEdit: {
            billId: "bill-1",
            editorVersion: 4,
            draftId: "draft-1",
            draftRevision: 5,
          },
          lines: [
            expect.objectContaining({ menuItemId: "offer-steak", quantity: "1" }),
            expect.objectContaining({ menuItemId: "offer-salad", quantity: "3" }),
          ],
        },
        { signal: expect.any(AbortSignal) },
      );
    },
  );

  it("retains a local first-save loser separately, cancels autosave and never sends it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { sync, api, set } = fixture();
    await sync.load();
    sync.store.addProduct(salad, "2");
    set(saved("luis"));
    await sync.load();
    expect(sync.store.lines.map((line) => line.product.name)).toEqual(["Steak"]);
    expect(sync.candidate).toMatchObject({
      personId: "ana",
      partyId: "party-1",
      billId: "bill-1",
      base: { billId: "bill-1", editorVersion: 0, draftId: null, draftRevision: null },
      lines: [{ product: { name: "Salad" }, quantity: "2" }],
      localGeneration: 1,
    });
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS);
    expect(await sync.flush()).toEqual({ refused: "draft.taken_over", ownerName: "Luis" });
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("keeps local edits through an unchanged passive read and sends their original observation", async () => {
    const { sync, api } = fixture();
    await sync.load();
    sync.store.addProduct(salad, "1");
    await sync.load();
    expect(sync.store.lines.map((line) => line.product.name)).toEqual(["Salad"]);
    await sync.flush();
    expect(api.saveDraft).toHaveBeenCalledExactlyOnceWith(
      "party-1",
      {
        billId: "bill-1",
        draftId: null,
        revision: 0,
        expectedEdit: { billId: "bill-1", editorVersion: 0, draftId: null, draftRevision: null },
        lines: [expect.objectContaining({ menuItemId: "offer-salad", quantity: "1" })],
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("keeps a same-person revision conflict's candidate while showing today's saved view", async () => {
    const { sync, set } = fixture(saved());
    await sync.load();
    sync.store.addProduct(salad, "1");
    set(saved("ana", 1, 2));
    await sync.load();
    expect(sync.candidate?.lines.map((line) => line.product.name)).toEqual(["Steak", "Salad"]);
    expect(sync.store.lines.map((line) => line.product.name)).toEqual(["Steak"]);
    expect(sync.candidate?.base).toEqual({
      billId: "bill-1",
      editorVersion: 1,
      draftId: "draft-1",
      draftRevision: 1,
    });
    expect(sync.store.editsLocked).toBe(true);
    sync.resolveCandidate(null);
    expect(sync.candidate).toBeNull();
    expect(sync.store.editsLocked).toBe(false);
  });

  it("freezes writes on a failed first read, while a failed periodic read keeps confirmed authority", async () => {
    const { sync, api } = fixture();
    api.listDrafts.mockRejectedValueOnce(new TypeError("offline"));
    expect(await sync.load()).toBe(false);
    expect(sync.store.editsLocked).toBe(true);
    expect(await sync.flush()).toBe("failed");
    await sync.load();
    api.listDrafts.mockRejectedValueOnce(new TypeError("offline"));
    expect(await sync.load()).toBe(false);
    expect(sync.store.editsLocked).toBe(false);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("ignores a lower-version read which finishes after a newer command snapshot", async () => {
    const { sync, api } = fixture(saved());
    await sync.load();
    const pending = deferred<PartyDraftSnapshot>();
    api.listDrafts.mockImplementationOnce(() => pending.promise);
    const reading = sync.load();
    sync.applyBillSnapshot(saved("luis", 2, 2), sync.generation);
    pending.resolve({ drafts: [saved().draft!], billEdits: [saved().edit] });
    await reading;
    expect(sync.edit).toEqual(saved("luis", 2, 2).edit);
    expect(sync.store.editsLocked).toBe(true);
  });

  it("finds the same person's candidate after the bill moves, without rebasing its old observation", async () => {
    const candidates = new Map<string, RetainedDraftCandidate>();
    const first = fixture(undefined, { candidates });
    await first.sync.load();
    first.sync.store.addProduct(salad, "1");
    first.sync.drop();
    const moved = saved("ana", 4, 6);
    moved.draft!.partyId = "party-2";
    const second = fixture(moved, { candidates, partyId: "party-2" });
    await second.sync.load();
    expect(second.sync.candidate).toMatchObject({
      partyId: "party-1",
      base: { editorVersion: 0 },
      lines: [{ product: { name: "Salad" } }],
    });
    expect(second.sync.store.lines.map((line) => line.product.name)).toEqual(["Steak"]);
    expect(second.sync.store.editsLocked).toBe(true);
    const third = fixture(moved, { candidates, personId: "luis", partyId: "party-2" });
    await third.sync.load();
    expect(third.sync.candidate).toBeNull();
    expect(second.api.saveDraft).not.toHaveBeenCalled();
  });

  it("stops writes on sign-out and retains unsaved work for that person", async () => {
    const { sync, api } = fixture();
    await sync.load();
    sync.store.addProduct(salad, "1");
    expect(await sync.close()).toBe("failed");
    expect(sync.candidate?.lines[0]?.product.name).toBe("Salad");
    expect(await sync.flush()).toBe("failed");
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("uses a Send release's version for the next first save", async () => {
    const { sync, api } = fixture(saved());
    await sync.load();
    sync.submitted(null, [...sync.store.lines], blank("bill-1", 2));
    sync.store.addProduct(salad, "1");
    await sync.flush();
    expect(api.saveDraft.mock.calls[0]?.[1]).toMatchObject({
      draftId: null,
      revision: 0,
      expectedEdit: { billId: "bill-1", editorVersion: 2, draftId: null, draftRevision: null },
    });
  });

  it("keeps an unanswered save's candidate and reads before permitting any further write", async () => {
    const { sync, api } = fixture();
    await sync.load();
    sync.store.addProduct(salad, "1");
    api.saveDraft.mockRejectedValueOnce(new TypeError("lost reply"));
    api.listDrafts.mockRejectedValueOnce(new TypeError("offline"));
    expect(await sync.flush()).toBe("failed");
    expect(sync.store.editsLocked).toBe(true);
    expect(sync.candidate?.lines[0]?.product.name).toBe("Salad");
    await sync.flush();
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    expect(api.listDrafts).toHaveBeenCalledTimes(2);
    await sync.load();
    expect(sync.candidate?.lines[0]?.product.name).toBe("Salad");
    expect(sync.store.editsLocked).toBe(true);
    sync.resolveCandidate(sync.candidate!.lines);
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    expect(sync.store.lines[0]?.product.name).toBe("Salad");
    expect(sync.store.editsLocked).toBe(false);
  });

  it("a newer editor read fences an in-flight save and retains its original candidate", async () => {
    const { sync, api, set } = fixture();
    await sync.load();
    sync.store.addProduct(salad, "1");
    const pending = deferred<BillDraftSnapshot>();
    api.saveDraft.mockImplementationOnce(() => pending.promise);
    const saving = sync.flush();
    await vi.waitFor(() => expect(api.saveDraft).toHaveBeenCalledOnce());
    set(saved("luis", 2));
    await sync.load();
    pending.resolve(saved());
    expect(await saving).toBe("failed");
    expect(sync.edit).toEqual(saved("luis", 2).edit);
    expect(sync.candidate).toMatchObject({
      base: { editorVersion: 0 },
      lines: [{ product: { name: "Salad" } }],
    });
    expect(await sync.flush()).toEqual({ refused: "draft.taken_over", ownerName: "Luis" });
    expect(sync.store.editsLocked).toBe(true);
    set(saved("ana", 3));
    await sync.load();
    expect(sync.edit).toEqual(saved("ana", 3).edit);
    expect(sync.candidate?.base.editorVersion).toBe(0);
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
  });

  it("an unchanged passive read preserves a newer completing save", async () => {
    const { sync, api } = fixture();
    await sync.load();
    sync.store.addProduct(salad, "1");
    const pending = deferred<BillDraftSnapshot>();
    api.saveDraft.mockImplementationOnce(() => pending.promise);
    const saving = sync.flush();
    await vi.waitFor(() => expect(api.saveDraft).toHaveBeenCalledOnce());
    await sync.load();
    const answer = saved();
    answer.draft!.lines = [row(salad)];
    pending.resolve(answer);
    expect(await saving).toBe("saved");
    expect(sync.edit).toEqual(answer.edit);
    expect(sync.store.lines[0]?.product.name).toBe("Salad");
    expect(sync.candidate).toBeNull();
    expect(sync.store.editsLocked).toBe(false);
  });

  it("fences an in-flight save answer at sign-out without erasing that person's candidate", async () => {
    const { sync, api } = fixture();
    await sync.load();
    sync.store.addProduct(salad, "1");
    const pending = deferred<BillDraftSnapshot>();
    api.saveDraft.mockImplementationOnce(() => pending.promise);
    const saving = sync.flush();
    await vi.waitFor(() => expect(api.saveDraft).toHaveBeenCalledOnce());
    const closing = sync.close();
    pending.resolve(saved());
    await closing;
    expect(await saving).toBe("failed");
    expect(sync.edit).toEqual(blank());
    expect(sync.store.lines[0]?.product.name).toBe("Salad");
    expect(sync.candidate?.lines[0]?.product.name).toBe("Salad");
  });

  it("does not resolve a candidate into a paid bill", async () => {
    const { sync, api } = fixture();
    await sync.load();
    sync.store.addProduct(salad, "1");
    sync.retainCandidate();
    sync.billStatus = "settled";
    sync.resolveCandidate(sync.candidate!.lines);
    expect(sync.candidate?.lines[0]?.product.name).toBe("Salad");
    expect(sync.store.editsLocked).toBe(true);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("a lower-version recovery read cannot grant fresh authority after a lost takeover reply", async () => {
    const { sync, api } = fixture(saved("luis", 3, 4));
    await sync.load();
    api.takeOverDraft.mockRejectedValueOnce(new TypeError("lost reply"));
    api.listDrafts.mockResolvedValueOnce({ drafts: [], billEdits: [blank()] });
    expect(await sync.takeOver("draft-1", 4)).toBe("failed");
    expect(sync.edit).toEqual(saved("luis", 3, 4).edit);
    expect(sync.store.editsLocked).toBe(true);
    expect(await sync.takeOver("draft-1", 4)).toBe("failed");
    expect(api.takeOverDraft).toHaveBeenCalledTimes(1);
  });

  it("a late Send reply cannot replace a newer editor snapshot or unlock that bill", async () => {
    const { sync, set } = fixture(saved());
    await sync.load();
    const sent = [...sync.store.lines];
    set(saved("luis", 3, 2));
    await sync.load();
    sync.submitted(null, sent, blank("bill-1", 2));
    expect(sync.edit).toEqual(saved("luis", 3, 2).edit);
    expect(sync.store.lines.map((line) => line.product.name)).toEqual(["Steak"]);
    expect(sync.store.editsLocked).toBe(true);
  });

  it("explicit review cannot revive a recalled source absent from the current outbox", async () => {
    const source: RecalledDraftLine = {
      id: "reference",
      sourceLineId: "recorded",
      quantity: "1",
      note: null,
      courseId: null,
      makeAt: null,
      noMerge: true,
      slot: 0,
      joinGroupId: null,
      afterGroupId: null,
      unavailable: false,
      source: {
        extras: [],
        netAmount: "4.00",
        line: {
          id: "recorded",
          lineNo: 1,
          parentLineNo: null,
          productId: "steak",
          parentProductId: null,
          menuItemId: null,
          name: "Recorded steak",
          quantity: "1",
          priceQuantity: "1",
          unitPrecision: 0,
          unitPriceGross: "4.00",
          listUnitPriceGross: "4.00",
          servedAt: null,
          courseId: null,
          sentAt: "2026-10-17T18:00:00.000Z",
          firedAt: null,
          state: null,
          stationId: null,
          movable: true,
          groupId: "group-1",
          note: null,
          listId: null,
        },
      },
    };
    const initial = saved();
    initial.draft!.lines = [source];
    const { sync, api, onRefused, set } = fixture(initial);
    await sync.load();
    sync.store.setLineExtras(0, { note: "No salt" });
    set({ draft: null, edit: blank("bill-1", 2) });
    await sync.load();
    sync.resolveCandidate(sync.candidate!.lines);
    expect(onRefused).toHaveBeenCalledExactlyOnceWith("draft.out_of_date");
    expect(sync.candidate?.lines[0]?.source?.line.id).toBe("recorded");
    expect(sync.store.lineCount).toBe(0);
    expect(sync.store.editsLocked).toBe(true);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });
});
