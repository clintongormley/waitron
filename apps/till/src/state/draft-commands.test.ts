import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Draft, DraftLine, RecalledDraftLine, TillProduct } from "../api/client.js";
import { draftServer } from "../widgets/test-helpers.js";
import { fromDraftLine } from "./draft-lines.js";
import { DraftSync, DRAFT_SAVE_DELAY_MS } from "./draft-sync.js";
import { lineGross } from "./order-line.js";

const beer: TillProduct = {
  id: "beer",
  menuItemId: "offer-beer",
  name: "Beer",
  pricingUnit: "each",
  unitPrice: "3.00",
  vatClass: "general",
  category: null,
  allergens: null,
};
const source = (): RecalledDraftLine => ({
  id: "reference-7",
  sourceLineId: "recorded-7",
  quantity: "2.000",
  note: "no salt",
  courseId: "mains",
  makeAt: "grill",
  noMerge: true,
  unavailable: false,
  slot: 0,
  joinGroupId: "held-3",
  afterGroupId: null,
  source: {
    line: {
      id: "recorded-7",
      lineNo: 7,
      parentLineNo: null,
      productId: "retired-variant",
      parentProductId: "retired-product",
      menuItemId: null,
      name: "Recorded steak",
      quantity: "2.000",
      priceQuantity: "1.000",
      unitPrecision: 0,
      unitPriceGross: "7.50",
      listUnitPriceGross: "10.00",
      servedAt: null,
      courseId: "mains",
      sentAt: "2026-10-16T18:00:00.000Z",
      firedAt: null,
      state: null,
      stationId: "grill",
      movable: true,
      groupId: "held-3",
      note: "no salt",
      listId: null,
    },
    extras: [],
    netAmount: "13.50",
  },
});
const own = (lines: DraftLine[], revision = 1): Draft => ({
  id: "draft-1",
  partyId: "party-1",
  billId: "bill-1",
  ownerId: "p1",
  ownerName: "Ana",
  revision,
  lines,
  takenOverFrom: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(initial?: Draft) {
  const server = draftServer();
  server.drafts = initial === undefined ? [] : [structuredClone(initial)];
  const refused = vi.fn();
  const sync = new DraftSync({
    api: server,
    partyId: "party-1",
    billId: "bill-1",
    personId: "p1",
    rebuild: (lines) =>
      lines.map((line) =>
        line.sourceLineId == null
          ? { product: beer, quantity: line.quantity.replace(/\.0+$/, "") }
          : fromDraftLine(line, new Map()),
      ),
    onRefused: refused,
    requestLimitMs: 5_000,
  });
  return { server, sync, refused };
}

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => {
  vi.useRealTimers();
});

describe("draft source commands", () => {
  it("finishes pending saves before a source command and reloads its recorded family", async () => {
    const { server, sync } = setup();
    await sync.load();
    sync.store.addProduct(beer, "1");
    const saved = deferred<void>();
    server.saveDraft.mockImplementationOnce(async (party, input) => {
      await saved.promise;
      return structuredClone(server.save(party, input));
    });
    const requests: unknown[] = [];
    const command = sync.runCommand(async (state, options) => {
      requests.push({ ...state, aborted: options.signal.aborted });
      const draft = server.drafts[0]!;
      server.drafts = [{ ...draft, revision: 2, lines: [...draft.lines, source()] }];
      return { revision: 4 };
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toEqual([]);
    expect(sync.store.sending).toBe(true);
    sync.store.addProduct(beer, "1");
    saved.resolve();
    expect(await command).toEqual({ applied: { revision: 4 }, reloaded: true });
    expect(requests).toEqual([{ draftId: server.drafts[0]!.id, revision: 1, aborted: false }]);
    expect(sync.revision).toBe(2);
    expect(sync.store.lines.map((line) => [line.draftLineId, line.quantity])).toEqual([
      [server.drafts[0]!.lines[0]!.id, "1"],
      ["reference-7", "2"],
    ]);
    const recalled = sync.store.lines[1]!;
    expect(recalled.workingOrderLineId).toBe("recorded-7");
    expect(recalled.place).toEqual({ kind: "join", groupId: "held-3" });
    expect(lineGross(recalled)).toBe("13.50");
    expect(sync.store.sending).toBe(false);
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS);
    expect(server.saveDraft).toHaveBeenCalledOnce();
    sync.drop();
  });

  it("does not send a source command over an unsaved refusal", async () => {
    const { server, sync, refused } = setup();
    await sync.load();
    sync.store.addProduct(beer, "1");
    server.saveDraft.mockRejectedValueOnce({ code: "party.not_open" });
    const requests: unknown[] = [];
    expect(
      await sync.runCommand(async () => {
        requests.push("sent");
      }),
    ).toBe("unsaved");
    expect(requests).toEqual([]);
    expect(sync.store.lines[0]!.quantity).toBe("1");
    expect(refused).toHaveBeenCalledExactlyOnceWith("party.not_open", undefined);
    expect(sync.store.sending).toBe(false);
    expect(await sync.flush()).toBe("saved");
    sync.drop();
  });

  it("locks edits, additional commands and takeover until the authoritative read finishes", async () => {
    const { server, sync } = setup(own([source()]));
    await sync.load();
    const answer = deferred<void>();
    const read = deferred<Draft[]>();
    server.listDrafts.mockImplementationOnce(() => read.promise);
    const command = sync.runCommand(async () => {
      await answer.promise;
      return "split";
    });
    await vi.advanceTimersByTimeAsync(0);
    const requests: unknown[] = [];
    expect(
      await sync.runCommand(async () => {
        requests.push("second");
      }),
    ).toBe("failed");
    expect(await sync.takeOver("colleague", 2)).toBe("failed");
    expect(await sync.load()).toBe(false);
    expect(await sync.flush()).toBe("failed");
    sync.store.setLineQuantity(0, "3");
    expect(sync.store.lines[0]!.quantity).toBe("2");
    expect(requests).toEqual([]);
    expect(server.takeOverDraft).not.toHaveBeenCalled();
    answer.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.store.sending).toBe(true);
    read.resolve([own([source()], 2)]);
    expect(await command).toEqual({ applied: "split", reloaded: true });
    expect(sync.store.sending).toBe(false);
    sync.drop();
  });

  it("keeps a committed cancellation distinct from a failed refresh and blocks stale saves until recovery", async () => {
    const { server, sync } = setup(own([source()]));
    await sync.load();
    server.listDrafts.mockRejectedValueOnce(new TypeError("offline"));
    const calls: string[] = [];
    expect(
      await sync.runCommand(async () => {
        calls.push("cancel");
        server.drafts = [];
        return { revision: 3 };
      }),
    ).toEqual({ applied: { revision: 3 }, reloaded: false });
    expect(sync.store.sending).toBe(false);
    expect(sync.store.editsLocked).toBe(true);
    sync.store.setLineQuantity(0, "3");
    expect(sync.store.lines[0]!.quantity).toBe("2");
    expect(await sync.flush()).toBe("failed");
    expect(
      await sync.runCommand(async () => {
        calls.push("repeat");
      }),
    ).toBe("failed");
    expect(await sync.takeOver("colleague", 2)).toBe("failed");
    expect(calls).toEqual(["cancel"]);
    expect(server.saveDraft).not.toHaveBeenCalled();
    expect(await sync.load()).toBe(true);
    expect(sync.store.lineCount).toBe(0);
    expect(sync.draftId).toBeNull();
    expect(sync.store.editsLocked).toBe(false);
    sync.store.addProduct(beer, "1");
    expect(await sync.flush()).toBe("saved");
    sync.drop();
  });

  it("reconciles a lost split answer without issuing another split", async () => {
    const { server, sync } = setup(own([source()]));
    await sync.load();
    const calls: string[] = [];
    expect(
      await sync.runCommand(async () => {
        calls.push("split");
        server.drafts = [
          own(
            [
              { ...source(), quantity: "1.000", source: { ...source().source, netAmount: "6.75" } },
              {
                ...source(),
                id: "reference-8",
                sourceLineId: "recorded-8",
                quantity: "1.000",
                source: {
                  line: { ...source().source.line, id: "recorded-8", lineNo: 8 },
                  extras: [],
                  netAmount: "6.75",
                },
              },
            ],
            2,
          ),
        ];
        throw new TypeError("Failed to fetch");
      }),
    ).toBe("failed");
    expect(calls).toEqual(["split"]);
    expect(sync.revision).toBe(2);
    expect(
      sync.store.lines.map((line) => [line.draftLineId, line.workingOrderLineId, lineGross(line)]),
    ).toEqual([
      ["reference-7", "recorded-7", "6.75"],
      ["reference-8", "recorded-8", "6.75"],
    ]);
    expect(sync.store.sending).toBe(false);
    expect(sync.store.editsLocked).toBe(false);
    sync.drop();
  });
  it("ignores a read begun before the command while its preceding save is still out", async () => {
    const { server, sync } = setup(own([source()]));
    await sync.load();
    const stale = deferred<Draft[]>();
    const save = deferred<void>();
    server.listDrafts.mockImplementationOnce(() => stale.promise);
    const oldRead = sync.load();
    sync.store.setLineQuantity(0, "3");
    server.saveDraft.mockImplementationOnce(async (party, input) => {
      await save.promise;
      return structuredClone(server.save(party, input));
    });
    const command = sync.runCommand(async (state) => state.revision);
    await vi.advanceTimersByTimeAsync(0);
    stale.resolve([]);
    expect(await oldRead).toBe(false);
    expect(sync.store.lines[0]!.quantity).toBe("3");
    save.resolve();
    expect(await command).toEqual({ applied: 2, reloaded: true });
    expect(sync.store.lines[0]!.quantity).toBe("3");
    sync.drop();
  });

  it("reconciles a save refused as taken over before declining the source command", async () => {
    const { server, sync } = setup(own([source()]));
    await sync.load();
    sync.store.setLineQuantity(0, "3");
    server.saveDraft.mockRejectedValueOnce({ code: "draft.taken_over", ownerName: "Sam" });
    server.drafts = [{ ...own([source()], 2), ownerId: "p2", ownerName: "Sam" }];
    const calls: string[] = [];
    expect(
      await sync.runCommand(async () => {
        calls.push("sent");
      }),
    ).toBe("unsaved");
    expect(calls).toEqual([]);
    expect(sync.draftId).toBeNull();
    expect(sync.store.lines).toEqual([]);
    expect(sync.others.map((draft) => draft.ownerName)).toEqual(["Sam"]);
    sync.drop();
  });

  it("cannot begin a command during a takeover or an existing send", async () => {
    const { server, sync } = setup();
    await sync.load();
    const taken = deferred<Draft>();
    server.takeOverDraft.mockImplementationOnce(() => taken.promise);
    const takeover = sync.takeOver("theirs", 1);
    await vi.advanceTimersByTimeAsync(0);
    const calls: string[] = [];
    expect(
      await sync.runCommand(async () => {
        calls.push("during takeover");
      }),
    ).toBe("failed");
    taken.resolve(own([source()], 2));
    expect(await takeover).toBe("taken");
    sync.store.sending = true;
    expect(
      await sync.runCommand(async () => {
        calls.push("during send");
      }),
    ).toBe("failed");
    expect(calls).toEqual([]);
    expect(sync.store.sending).toBe(true);
    sync.drop();
  });

  it.each(["close", "drop"] as const)(
    "aborts a command on %s and ignores its late answer",
    async (end) => {
      const { server, sync } = setup(own([source()]));
      await sync.load();
      const answer = deferred<void>();
      let signal!: AbortSignal;
      const command = sync.runCommand(async (_state, options) => {
        signal = options.signal;
        await answer.promise;
        return "recalled";
      });
      await vi.advanceTimersByTimeAsync(0);
      if (end === "close") await sync.close();
      else sync.drop();
      expect(signal.aborted).toBe(true);
      answer.resolve();
      expect(await command).toBe("failed");
      expect(sync.revision).toBe(1);
      expect(server.listDrafts).toHaveBeenCalledOnce();
      expect(await sync.runCommand(async () => "late")).toBe("failed");
    },
  );

  it("does not issue a command when dropped while its preceding save is out", async () => {
    const { server, sync } = setup();
    await sync.load();
    sync.store.addProduct(beer, "1");
    const saved = deferred<void>();
    server.saveDraft.mockImplementationOnce(async (party, input) => {
      await saved.promise;
      return structuredClone(server.save(party, input));
    });
    const calls: string[] = [];
    const command = sync.runCommand(async () => {
      calls.push("late");
    });
    await vi.advanceTimersByTimeAsync(0);
    sync.drop();
    saved.resolve();
    expect(await command).toBe("failed");
    expect(calls).toEqual([]);
  });

  it("returns the command's refusal and reloads the new owner", async () => {
    const { server, sync } = setup(own([source()]));
    await sync.load();
    expect(
      await sync.runCommand(async () => {
        server.drafts = [{ ...own([source()], 2), ownerId: "p2", ownerName: "Sam" }];
        throw { code: "draft.taken_over", ownerName: "Sam" };
      }),
    ).toEqual({ refused: "draft.taken_over", ownerName: "Sam" });
    expect(sync.store.lines).toEqual([]);
    expect(sync.others.map((draft) => draft.ownerName)).toEqual(["Sam"]);
    expect(sync.store.editsLocked).toBe(false);
    sync.drop();
  });

  it("bounds an unanswered command and reads the stored draft when that wait ends", async () => {
    const { server, sync } = setup(own([source()]));
    await sync.load();
    const command = sync.runCommand(
      async (_state, { signal }) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    let outcome: unknown;
    void command.then((answer) => {
      outcome = answer;
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(outcome).toBeUndefined();
    expect(sync.store.sending).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(await command).toBe("failed");
    expect(server.listDrafts).toHaveBeenCalledTimes(2);
    expect(sync.store.sending).toBe(false);
    sync.drop();
  });

  it.each(["close", "drop"] as const)(
    "ignores an authoritative read arriving after %s",
    async (end) => {
      const { server, sync } = setup(own([source()]));
      await sync.load();
      const read = deferred<Draft[]>();
      server.listDrafts.mockImplementationOnce(() => read.promise);
      const command = sync.runCommand(async () => "discarded");
      await vi.advanceTimersByTimeAsync(0);
      expect(server.listDrafts).toHaveBeenCalledTimes(2);
      if (end === "close") await sync.close();
      else sync.drop();
      read.resolve([]);
      expect(await command).toBe("failed");
      expect(sync.draftId).toBe("draft-1");
      expect(sync.revision).toBe(1);
      expect(sync.store.lines.map((line) => line.workingOrderLineId)).toEqual(["recorded-7"]);
    },
  );

  it("keeps a failed ownership refresh locked until an explicit read recovers it", async () => {
    const { server, sync } = setup(own([source()]));
    await sync.load();
    sync.store.setLineQuantity(0, "3");
    server.saveDraft.mockRejectedValueOnce({ code: "draft.taken_over", ownerName: "Sam" });
    server.listDrafts.mockRejectedValueOnce(new TypeError("offline"));
    expect(await sync.runCommand(async () => "never")).toBe("unsaved");
    expect(sync.store.editsLocked).toBe(true);
    sync.store.setLineQuantity(0, "4");
    expect(sync.store.lines[0]!.quantity).toBe("3");
    expect(await sync.flush()).toBe("failed");
    expect(await sync.load()).toBe(true);
    expect(sync.store.lines[0]!.quantity).toBe("2");
    expect(sync.store.editsLocked).toBe(false);
    sync.drop();
  });
  it.each(["close", "drop"] as const)("cancels the command's recovery read on %s", async (end) => {
    const { server, sync } = setup(own([source()]));
    await sync.load();
    let signal!: AbortSignal;
    server.listDrafts.mockImplementationOnce(async (...args: unknown[]) => {
      signal = (args[1] as { signal: AbortSignal }).signal;
      return new Promise<Draft[]>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true,
        });
      });
    });
    const command = sync.runCommand(async () => "discarded");
    await vi.advanceTimersByTimeAsync(0);
    if (end === "close") await sync.close();
    else sync.drop();
    expect(signal.aborted).toBe(true);
    expect(await command).toBe("failed");
  });

  it("leaves an existing refresh lock alone and sends no command during it", async () => {
    const { sync } = setup(own([source()]));
    await sync.load();
    const unlock = sync.store.lockEdits();
    const calls: string[] = [];
    expect(
      await sync.runCommand(async () => {
        calls.push("sent");
      }),
    ).toBe("failed");
    expect(calls).toEqual([]);
    expect(sync.store.editsLocked).toBe(true);
    unlock();
    expect(sync.store.editsLocked).toBe(false);
    sync.drop();
  });
  it("cancels the old save timer instead of automatically retrying a refused pre-command save", async () => {
    const { server, sync } = setup();
    await sync.load();
    sync.store.addProduct(beer, "1");
    server.saveDraft.mockRejectedValueOnce({ code: "party.not_open" });
    expect(await sync.runCommand(async () => "never")).toBe("unsaved");
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS);
    expect(server.saveDraft).toHaveBeenCalledOnce();
    expect(sync.lineIds([0])).toBeNull();
    sync.drop();
  });
});
