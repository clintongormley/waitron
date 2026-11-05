import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { BillEditExpected, PartyBill, SplitSources } from "./api/client.js";
import { currentLocale, fill, setLocale, t } from "./i18n/t.js";
import { partyBill } from "./screens/till-table-order-screen.bill-switcher.test-helpers.js";
import { TABLE_REQUEST_LIMIT_MS } from "./state/draft-sync.js";
import {
  atFloor,
  balance,
  billTwoTicked,
  dish,
  draftsMoving,
  expectPressCarriesTheRows,
  flush,
  held,
  listAt,
  lost,
  mounted,
  panelOpen,
  picker,
  press,
  q,
  refreshDrafts,
  rowsAt,
  said,
  sent,
  splitButton,
  takes,
  tick,
  tickBox,
  timedRead,
  toPanel,
} from "./till-app-split-table.snapshot.test-helpers.js";
import type { TillApp } from "./till-app.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import {
  api,
  emit,
  floor,
  party,
  resetAllergyFixture,
  server,
  table,
  table7,
  tableOrder,
} from "../test/allergy-app-fixture.js";

const changed = (bill: string) => fill(t("table.split_changed"), { bill });
const noEdit = (billId: string, over: Partial<BillEditExpected> = {}): BillEditExpected => ({
  billId,
  editorVersion: 0,
  draftId: null,
  draftRevision: null,
  ...over,
});

const locale = currentLocale();
beforeEach(() => {
  setLocale("en");
  resetAllergyFixture();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(async () => {
  vi.useRealTimers();
  cleanupWidgets();
  setLocale(locale);
  await page.viewport(1280, 768);
});

describe("a refusal's own reads have a time limit", () => {
  // The till's limit on a floor read, `FLOOR_POLL_LIMIT_MS`.
  const LIMIT = 25_000;
  const never = () => new Promise(() => {});
  const noBanner = (el: TillApp) => el.shadowRoot!.querySelector(".error") === null;
  const refusedWith = (error: unknown) => ({ splitTable: vi.fn().mockRejectedValue(error) });

  /** Pressing Split with these reads stuck: nothing said one moment before `limit`, then the
   * panel back, with its tick, its sentence, and Split ready. */
  async function saysOnlyAtTheLimit(el: TillApp, limit: number, sentence: string, requests = 1) {
    await press(el, "[data-split-confirm]");
    await vi.advanceTimersByTimeAsync(limit - 1);
    await flush(el);
    expect(panelOpen(el), "still closed").toBe(false);
    expect(noBanner(el)).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    await flush(el);
    expect(panelOpen(el), "back at the limit").toBe(true);
    expect(said(el)).toBe(sentence);
    expect(noBanner(el)).toBe(true);
    expect(tickBox(el, "b2")!.checked).toBe(true);
    expect(splitButton(el)!.disabled).toBe(false);
    expect(splitButton(el)!.variant).toBe("primary");
    expect(api.splitTable).toHaveBeenCalledTimes(requests);
  }

  /** What a refused party.out_of_date says when its reads fail outright. */
  async function sentenceOfAFailedRead(fail: () => void): Promise<string> {
    const el = await billTwoTicked(refusedWith({ code: "party.out_of_date" }));
    fail();
    await press(el, "[data-split-confirm]");
    await flush(el);
    expect(panelOpen(el)).toBe(true);
    const words = said(el)!;
    expect(words).not.toBe("");
    cleanupWidgets();
    resetAllergyFixture();
    return words;
  }

  it.each([
    ["floor", "getTablesState"],
    ["bills", "getPartyBills"],
    ["lines", "getTabLines"],
    ["groups", "listGroups"],
    ["kitchen", "readCurrentOrders"],
  ] as const)(
    "party.out_of_date with its %s read never answering says at the limit what a failed read says",
    async (_read, method) => {
      const failed = await sentenceOfAFailedRead(() =>
        api[method]!.mockReset().mockRejectedValue(lost()),
      );
      const el = await billTwoTicked(refusedWith({ code: "party.out_of_date" }));
      api[method]!.mockReset().mockImplementation(never);
      await saysOnlyAtTheLimit(el, LIMIT, failed);
    },
  );

  it("a lost reply with its floor read never answering says table.error at the limit", async () => {
    const el = await billTwoTicked(refusedWith(lost()));
    api.getTablesState!.mockReset().mockImplementation(never);
    await saysOnlyAtTheLimit(el, LIMIT, t("table.error"));
  });

  it("tab.split_held_line with its rows' read never answering says its own words at the limit, and the old rows stay", async () => {
    const el = await billTwoTicked(refusedWith({ code: "tab.split_held_line" }));
    api.getSplitSources!.mockReset().mockImplementation(never);
    await saysOnlyAtTheLimit(el, LIMIT, t("table.split_held_error"));
    expect(takes(el)).toContain("20.00");
    await expectPressCarriesTheRows(el, { "20.00": 3 });
  });

  it("each read has the limit to itself: a bills read and then a rows read never answering take it twice over", async () => {
    const el = await billTwoTicked(refusedWith({ code: "tab.not_open", tabId: "b2" }));
    api.getPartyBills!.mockReset().mockImplementation(never);
    api.getSplitSources!.mockReset().mockImplementation(never);
    await saysOnlyAtTheLimit(el, 2 * LIMIT, fill(t("table.split_changed"), { bill: "Bill 2" }));
  });

  it.each(["draft.out_of_date", "draft.taken_over"] as const)(
    "%s with its drafts read never answering, and not honouring the cut-off, says at the limit",
    async (code) => {
      const el = await billTwoTicked(refusedWith({ code, billId: "b2" }));
      api.listDrafts!.mockReset().mockImplementation(never);
      await saysOnlyAtTheLimit(el, LIMIT, changed("Bill 2"));
    },
  );

  it("the till's own stop at Send, with its drafts read never answering, says at the limit and sends nothing", async () => {
    const { moved, listDrafts } = draftsMoving();
    const el = await billTwoTicked({ listDrafts });
    moved.now = true;
    await refreshDrafts(el);
    listDrafts.mockReset().mockImplementation(never as never);
    await saysOnlyAtTheLimit(el, LIMIT, changed("Bill 2"), 0);
  });

  it("a lost reply with its lines read never answering says table.error at the limit", async () => {
    const el = await billTwoTicked(refusedWith(lost()));
    api.getTabLines!.mockReset().mockImplementation(never);
    await saysOnlyAtTheLimit(el, LIMIT, t("table.error"));
  });

  it("party.out_of_date moving the screen off its bill, with the new bill's drafts read never answering, says at the limit", async () => {
    const el = await billTwoTicked(refusedWith({ code: "party.out_of_date" }));
    api.getPartyBills!.mockReset().mockResolvedValue([partyBill("b2", 2, "20.00")]);
    api.listDrafts!.mockReset().mockImplementation(never);
    await press(el, "[data-split-confirm]");
    await vi.advanceTimersByTimeAsync(LIMIT - 1);
    await flush(el);
    expect(panelOpen(el), "still closed").toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await flush(el);
    expect(panelOpen(el), "back at the limit").toBe(true);
    expect(said(el)).not.toBeNull();
  });

  describe("the rows' read behind a panel party.out_of_date reopened", () => {
    async function reopenedOverAHungRead() {
      const el = await billTwoTicked(refusedWith({ code: "party.out_of_date" }));
      api.getTablesState!.mockResolvedValue(atFloor(9));
      const rows = held<SplitSources>();
      api.getSplitSources!.mockReset().mockImplementation(rows.read);
      await press(el, "[data-split-confirm]");
      await flush(el);
      expect(panelOpen(el)).toBe(true);
      expect(rows.calls).toHaveLength(1);
      const before = said(el);
      expect(before).not.toBe(t("table.split_updated_elsewhere"));
      return { el, rows, before };
    }

    it("never answering: the foot stops saying the table was reloaded at the limit, and not before", async () => {
      const { el, before } = await reopenedOverAHungRead();
      await vi.advanceTimersByTimeAsync(LIMIT - 1);
      await flush(el);
      expect(said(el)).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      await flush(el);
      expect(said(el)).toBe(t("table.split_updated_elsewhere"));
      expect(takes(el)).toContain("20.00");
      expect(splitButton(el)!.disabled).toBe(false);
    });

    it("overtaken by timed reads that never answer either: they have the limit too", async () => {
      const { el, rows } = await reopenedOverAHungRead();
      api.getPartyBills!.mockResolvedValue(listAt("30.00", 1));
      await timedRead(el);
      expect(rows.calls).toHaveLength(2);
      // Past the first read's limit, so only the rows being owed still limits this one.
      api.getPartyBills!.mockResolvedValue(listAt("40.00", 2));
      await timedRead(el);
      expect(rows.calls).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(LIMIT);
      await flush(el);
      expect(said(el)).toBe(t("table.split_updated_elsewhere"));
    });

    it("answering late writes nothing: the rows and the words stay, and a press carries the rows", async () => {
      const { el, rows } = await reopenedOverAHungRead();
      await vi.advanceTimersByTimeAsync(LIMIT);
      await flush(el);
      rows.calls[0]!.answer(rowsAt(9, "30.00"));
      await flush(el);
      expect(takes(el)).toContain("20.00");
      expect(said(el)).toBe(t("table.split_updated_elsewhere"));
      api.splitTable!.mockReset().mockResolvedValue({ partyId: "v-split", billIds: ["b2"] });
      await expectPressCarriesTheRows(el, { "20.00": 3 });
    });

    it("answering inside the limit brings the rows, and the foot keeps the refusal's own words", async () => {
      const { el, rows, before } = await reopenedOverAHungRead();
      await vi.advanceTimersByTimeAsync(LIMIT - 1);
      rows.calls[0]!.answer(rowsAt(9, "30.00"));
      await flush(el);
      await vi.advanceTimersByTimeAsync(LIMIT);
      await flush(el);
      expect(takes(el)).toContain("30.00");
      expect(said(el)).toBe(before);
    });
  });

  it("a reopening's rows read with nothing owed: past the limit it counts as not started, so the next timed read tries again", async () => {
    const el = await billTwoTicked(refusedWith(lost()));
    api.getPartyBills!.mockResolvedValue(listAt("30.00", 1));
    const sources = api.getSplitSources!.mockReset().mockImplementation(never);
    await press(el, "[data-split-confirm]");
    await flush(el);
    expect(said(el)).toBe(t("table.error"));
    expect(sources).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(LIMIT);
    await timedRead(el);

    expect(sources).toHaveBeenCalledTimes(2);
  });

  it("a panel left with its rows still owed: the next panel's first read has no limit", async () => {
    const el = await billTwoTicked(refusedWith({ code: "party.out_of_date" }));
    api.getSplitSources!.mockReset().mockImplementation(never);
    await press(el, "[data-split-confirm]");
    await flush(el);
    expect(panelOpen(el)).toBe(true);
    await press(el, "[data-action-back]");
    el.shadowRoot!.querySelector("wt-unsaved-changes")
      ?.shadowRoot?.querySelector<HTMLElement>("[data-choice=discard]")
      ?.click();
    await flush(el);
    await vi.advanceTimersByTimeAsync(LIMIT);
    await flush(el);

    await press(el, '[data-target="t5"]');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await flush(el);

    expect(panelOpen(el)).toBe(true);
    expect(picker(el)).toBeNull();
    expect(tableOrder(el)!.splitRead).toBeNull();
  });

  it("a late drafts answer writes nothing: the edit state stays, and the retry carries it", async () => {
    const el = await billTwoTicked(refusedWith({ code: "draft.out_of_date", billId: "b2" }));
    const snapshot = await server.listDrafts("v1");
    const drafts = held<unknown>();
    api.listDrafts!.mockReset().mockImplementation(drafts.read);
    await press(el, "[data-split-confirm]");
    await vi.advanceTimersByTimeAsync(LIMIT);
    await flush(el);
    expect(panelOpen(el)).toBe(true);
    const tookEffect = {
      ...snapshot,
      billEdits: snapshot.billEdits.map((edit) =>
        edit.billId === "b2" ? { ...edit, editorVersion: 9 } : edit,
      ),
    };
    drafts.calls[0]!.answer(tookEffect);
    await flush(el);

    api.splitTable!.mockReset().mockResolvedValue({ partyId: "v-split", billIds: ["b2"] });
    await press(el, "[data-split-confirm]");
    await flush(el);
    expect(api.splitTable).toHaveBeenCalledOnce();
    expect(api.splitTable!.mock.calls[0]![4]).toEqual([noEdit("b2")]);
  });

  it("a late lines answer writes nothing", async () => {
    const el = await billTwoTicked(refusedWith(lost()));
    const lines = held<{ lines: unknown[]; revision: number }>();
    api.getTabLines!.mockReset().mockImplementation(lines.read);
    await press(el, "[data-split-confirm]");
    await vi.advanceTimersByTimeAsync(LIMIT);
    await flush(el);
    expect(said(el)).toBe(t("table.error"));
    const shown = tableOrder(el)!.lines;
    lines.calls[0]!.answer({ lines: [dish("late", 9)], revision: 99 });
    await flush(el);
    expect(tableOrder(el)!.lines).toBe(shown);
  });

  it("a drafts read answering inside the limit still brings what it says, and the retry carries it", async () => {
    const { moved, listDrafts } = draftsMoving();
    const el = await billTwoTicked({
      listDrafts,
      splitTable: vi
        .fn()
        .mockRejectedValueOnce({ code: "draft.out_of_date", billId: "b2" })
        .mockResolvedValue({ partyId: "v-split", billIds: ["b2"] }),
    });
    moved.now = true;
    await press(el, "[data-split-confirm]");
    await flush(el);
    expect(said(el)).toBe(changed("Bill 2"));
    await press(el, "[data-split-confirm]");
    await flush(el);
    expect(api.splitTable!.mock.calls[1]![4]).toEqual([noEdit("b2", { editorVersion: 2 })]);
  });

  it("with no refusal out, a timed drafts read still has a request's limit", async () => {
    const signals: AbortSignal[] = [];
    const el = await billTwoTicked();
    api
      .listDrafts!.mockReset()
      .mockImplementation((_party: string, options?: { signal?: AbortSignal }) => {
        signals.push(options!.signal!);
        return new Promise(() => {});
      });
    await refreshDrafts(el);
    expect(signals).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(LIMIT);
    expect(signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(TABLE_REQUEST_LIMIT_MS - LIMIT);
    expect(signals[0]!.aborted).toBe(true);
  });

  it("a late floor answer writes nothing: the party stays as it was, no read follows, and a press carries the rows", async () => {
    const el = await billTwoTicked(refusedWith({ code: "party.out_of_date" }));
    const floorRead = held<ReturnType<typeof atFloor>>();
    api.getTablesState!.mockReset().mockImplementation(floorRead.read);
    await press(el, "[data-split-confirm]");
    await vi.advanceTimersByTimeAsync(LIMIT);
    await flush(el);
    expect(panelOpen(el)).toBe(true);
    const rowsRead = api.getSplitSources!.mock.calls.length;
    const bills = tableOrder(el)!.bills;

    floorRead.calls[0]!.answer(atFloor(9));
    await flush(el);

    expect(tableOrder(el)!.party?.revision).toBe(3);
    expect(tableOrder(el)!.bills).toBe(bills);
    expect(api.getSplitSources!.mock.calls.length).toBe(rowsRead);
    await expectPressCarriesTheRows(el, { "20.00": 3 });
  });

  it("a late bills answer writes nothing: the list stays as it was, no read follows, and a press carries the rows", async () => {
    const el = await billTwoTicked(refusedWith({ code: "party.out_of_date" }));
    const billsRead = held<PartyBill[]>();
    api.getPartyBills!.mockReset().mockImplementation(billsRead.read);
    await press(el, "[data-split-confirm]");
    await vi.advanceTimersByTimeAsync(LIMIT);
    await flush(el);
    expect(panelOpen(el)).toBe(true);
    const rowsRead = api.getSplitSources!.mock.calls.length;
    const bills = tableOrder(el)!.bills;

    billsRead.calls[0]!.answer(listAt("30.00", 5));
    await flush(el);

    expect(tableOrder(el)!.bills).toBe(bills);
    expect(api.getSplitSources!.mock.calls.length).toBe(rowsRead);
    await expectPressCarriesTheRows(el, { "20.00": 3 });
  });

  it("a late rows answer writes nothing: the rows on screen stay, and a press carries them", async () => {
    const el = await billTwoTicked(refusedWith({ code: "tab.split_held_line" }));
    const rowsRead = held<SplitSources>();
    api.getSplitSources!.mockReset().mockImplementationOnce(rowsRead.read);
    api.getSplitSources!.mockResolvedValue(rowsAt(3, "20.00"));
    await press(el, "[data-split-confirm]");
    await vi.advanceTimersByTimeAsync(LIMIT);
    await flush(el);
    expect(panelOpen(el)).toBe(true);

    rowsRead.calls[0]!.answer(rowsAt(9, "30.00"));
    await flush(el);

    expect(takes(el)).toContain("20.00");
    await expectPressCarriesTheRows(el, { "20.00": 3 });
  });

  it("a read answering inside the limit still brings what it says", async () => {
    const el = await billTwoTicked(refusedWith({ code: "party.out_of_date" }));
    const floorRead = held<ReturnType<typeof atFloor>>();
    api.getTablesState!.mockReset().mockImplementation(floorRead.read);
    await press(el, "[data-split-confirm]");
    await vi.advanceTimersByTimeAsync(LIMIT - 1);
    await flush(el);
    expect(panelOpen(el)).toBe(false);
    api.getSplitSources!.mockResolvedValue(rowsAt(9, "20.00"));

    floorRead.calls[0]!.answer(atFloor(9));
    await flush(el);

    expect(panelOpen(el)).toBe(true);
    expect(tableOrder(el)!.party?.revision).toBe(9);
    await expectPressCarriesTheRows(el, { "20.00": 9 });
  });
});

describe("the sentence when party.out_of_date's table could not be read again (the owner's words, 2026-11-05)", () => {
  const WORDS = [
    ["en", "The table was updated by somebody else. Try to Split again."],
    ["es-ES", "Otra persona ha actualizado la mesa. Intenta Separar de nuevo."],
  ] as const;

  it.each(WORDS)(
    "in %s the foot says the owner's words, and no other refusal does",
    async (language, words) => {
      const el = await billTwoTicked({
        splitTable: vi.fn().mockRejectedValue({ code: "party.out_of_date" }),
      });
      setLocale(language);
      api.getTablesState!.mockResolvedValue(atFloor(9));
      api.getSplitSources!.mockReset().mockRejectedValue(lost());
      await press(el, "[data-split-confirm]");
      await flush(el);
      expect(said(el)).toBe(words);
    },
  );

  it.each(WORDS)(
    "in %s, with the table read again, the foot keeps party.changed's words",
    async (language, words) => {
      const el = await billTwoTicked({
        splitTable: vi.fn().mockRejectedValue({ code: "party.out_of_date" }),
      });
      setLocale(language);
      api.getTablesState!.mockResolvedValue(atFloor(9));
      api.getSplitSources!.mockReset().mockResolvedValue(rowsAt(9, "30.00"));
      await press(el, "[data-split-confirm]");
      await flush(el);
      expect(said(el)).not.toBe(words);
      expect(said(el)).toContain(t("party.changed_other"));
    },
  );

  it("table.reread_failed keeps its words for its other uses, in both languages", () => {
    expect(t("table.reread_failed")).toBe(
      "The order was updated, but the table could not be read again. Open the table again to check its amounts.",
    );
    setLocale("es-ES");
    expect(t("table.reread_failed")).toBe(
      "El pedido se actualizó, pero no se pudo volver a leer la mesa. Vuelve a abrir la mesa para comprobar sus importes.",
    );
  });
});

describe("a party's first bill arriving behind the panel, and a press", () => {
  const noBill = party({ tableIds: ["t4", "t5"], billCount: 0, openingBillId: null });
  const noBillFloor = [table("t4", "4", noBill), table("t5", "5", noBill), table7];
  const firstList = (): PartyBill[] => [partyBill("b9", 1, "20.00")];
  const firstRows = (partyRevision: number): SplitSources => ({
    partyRevision,
    bills: [{ billId: "b9", lines: [dish("steak", 1)], balance: balance("b9", "20.00") }],
  });
  /** The floor once the bill has come and the split has gone. */
  const afterSplit = () => {
    const stays = party({ tableIds: ["t4"], billCount: 1, openingBillId: "b9" });
    return [table("t4", "4", stays), table("t5", "5", null), table7];
  };
  const stillTogether = () => atFloor(3, { billCount: 1, openingBillId: "b9" });
  const taken = (edit: BillEditExpected) => ({
    ...edit,
    editorId: null,
    editorName: null,
  });

  /** The timed read has listed Bill 1 and started the reload, whose floor read is out. */
  async function reloadOut(over: Record<string, unknown> = {}) {
    const floors = held<ReturnType<typeof atFloor>>();
    const el = await mounted({
      getTablesState: vi.fn().mockResolvedValue(noBillFloor),
      getPartyBills: vi.fn().mockResolvedValue([]),
      getSplitSources: vi.fn().mockResolvedValue({ partyRevision: 3, bills: [] }),
      ...over,
    });
    await toPanel(el);
    server.bills.add("b9");
    api.getTablesState!.mockReset().mockImplementation(floors.read);
    api.getPartyBills!.mockResolvedValue(firstList());
    api.getSplitSources!.mockReset().mockResolvedValue(firstRows(3));
    await timedRead(el);
    expect(floors.calls).toHaveLength(1);
    expect(picker(el)!.sources.map((each) => each.bill.workingOrderId)).toEqual(["b9"]);
    expect(tableOrder(el)!.orderId).toBeUndefined();
    return { el, floors };
  }

  const pressSplit = async (el: TillApp) => {
    await press(el, "[data-split-confirm]");
    if (q(el, "[data-split-anyway]") !== null) await press(el, "[data-split-anyway]");
    await flush(el);
  };

  describe("the till shows the bill afterwards, whichever floor read lands first", () => {
    const orders = {
      together: (calls: { answer: (value: never) => void }[], first: never, then: never) => {
        calls[0]!.answer(first);
        calls[1]!.answer(then);
      },
      "the reload's first": (
        calls: { answer: (value: never) => void }[],
        first: never,
        then: never,
      ) => {
        calls[0]!.answer(first);
        return Promise.resolve().then(() => calls[1]!.answer(then));
      },
      "the split's first": (
        calls: { answer: (value: never) => void }[],
        first: never,
        then: never,
      ) => {
        calls[1]!.answer(then);
        return Promise.resolve().then(() => calls[0]!.answer(first));
      },
    };

    it.each(Object.keys(orders) as (keyof typeof orders)[])("%s", async (order) => {
      const { el, floors } = await reloadOut();
      const reads = server.listDrafts.mock.calls.length;
      await pressSplit(el);
      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(floors.calls).toHaveLength(2);

      await orders[order](floors.calls as never, afterSplit() as never, afterSplit() as never);
      await flush(el);
      await flush(el);

      expect(tableOrder(el)!.orderId).toBe("b9");
      expect(server.listDrafts.mock.calls.length).toBeGreaterThan(reads);
    });

    it("control: Back in place of the press shows the bill as well", async () => {
      const { el, floors } = await reloadOut();
      await press(el, "[data-action-back]");
      floors.calls[0]!.answer(stillTogether());
      await flush(el);
      expect(tableOrder(el)!.orderId).toBe("b9");
    });
  });

  describe("a first bill ticked before its edit state has arrived", () => {
    it("the press sends once, nothing known, for the server to judge, and says nothing", async () => {
      const { el, floors } = await reloadOut();
      await tick(el, "b9");
      await pressSplit(el);

      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(sent(0)).toBe(3);
      expect(api.splitTable!.mock.calls[0]![4]).toEqual([noEdit("b9")]);
      expect(floors.calls.length).toBeGreaterThanOrEqual(1);
    });

    it("a press after the state has arrived carries that state, once", async () => {
      const { el, floors } = await reloadOut({
        listDrafts: vi.fn(async (partyId: string) => {
          const snapshot = await server.listDrafts(partyId);
          return {
            ...snapshot,
            billEdits: snapshot.billEdits.map((edit) =>
              edit.billId === "b9" ? { ...edit, editorVersion: 4 } : edit,
            ),
          };
        }),
      });
      await tick(el, "b9");
      floors.calls[0]!.answer(stillTogether());
      await flush(el);
      await flush(el);
      expect(tableOrder(el)!.orderId).toBe("b9");

      await pressSplit(el);

      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(api.splitTable!.mock.calls[0]![4]).toEqual([noEdit("b9", { editorVersion: 4 })]);
      expect(said(el)).toBeNull();
    });

    it("the server refusing what the press could name: its sentence once, and the next press carries the server's state, with the reload still out", async () => {
      const state = noEdit("b9", { editorVersion: 4 });
      const { el } = await reloadOut({
        splitTable: vi
          .fn()
          .mockRejectedValueOnce({ code: "draft.out_of_date", billId: "b9", edit: taken(state) })
          .mockResolvedValue({ partyId: "v-split", billIds: ["b9"] }),
      });
      await tick(el, "b9");

      await pressSplit(el);
      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(panelOpen(el)).toBe(true);
      expect(said(el)).toBe(changed("Bill 1"));
      expect(tickBox(el, "b9")!.checked).toBe(true);

      await pressSplit(el);
      expect(api.splitTable).toHaveBeenCalledTimes(2);
      expect(api.splitTable!.mock.calls[1]![4]).toEqual([state]);
    });

    it("control: a state that was recorded and has moved still stops the press", async () => {
      const { moved, listDrafts } = draftsMoving();
      const el = await billTwoTicked({ listDrafts });
      moved.now = true;
      await refreshDrafts(el);
      await press(el, "[data-split-confirm]");
      await flush(el);
      expect(api.splitTable).not.toHaveBeenCalled();
      expect(said(el)).toBe(changed("Bill 2"));
    });
  });
});

describe("a refusal's read, once the waiter has left its party", () => {
  it("starts no rows read: the other party's panel keeps its own rows, and a press carries them", async () => {
    const other = party({
      id: "v2",
      revision: 50,
      tableIds: ["t6", "t7"],
      billCount: 1,
      openingBillId: "wo-6",
    });
    const both = [...atFloor(3), table("t6", "6", other), table("t7", "7", other)];
    const bills = held<PartyBill[]>();
    const el = await billTwoTicked({
      getTablesState: vi.fn().mockResolvedValue(both),
      splitTable: vi.fn().mockRejectedValueOnce({ code: "tab.not_open", tabId: "b2" }),
    });
    api.getPartyBills!.mockReset().mockImplementation(bills.read);
    await press(el, "[data-split-confirm]");
    await flush(el);

    server.bills.add("wo-6");
    api.getPartyBills!.mockReset().mockResolvedValue([partyBill("wo-6", 1, "50.00")]);
    const otherRows: SplitSources = {
      partyRevision: 50,
      bills: [{ billId: "wo-6", lines: [dish("pulpo", 1)], balance: balance("wo-6", "50.00") }],
    };
    const sources = api.getSplitSources!.mockReset().mockResolvedValue(otherRows);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t6", seated: true });
    await flush(el);
    await press(el, "[data-move-split]");
    await press(el, '[data-action="split-table"]');
    await press(el, '[data-target="t7"]');
    expect(picker(el)!.sources.map((each) => each.bill.workingOrderId)).toEqual(["wo-6"]);
    sources.mockClear();

    bills.calls[0]!.answer(listAt("20.00", 0));
    await flush(el);

    expect(sources).not.toHaveBeenCalled();
    expect(picker(el)!.sources.map((each) => each.bill.workingOrderId)).toEqual(["wo-6"]);
    api.splitTable!.mockReset().mockResolvedValue({ partyId: "v-split", billIds: [] });
    await press(el, "[data-split-confirm]");
    await flush(el);
    expect(api.splitTable!.mock.calls[0]![3]).toBe(50);
  });
});

describe("a press on a panel the app has stopped watching", () => {
  it("carries the revision it was pressed with, never the one the panel opened with", async () => {
    const el = await mounted({ getSplitSources: vi.fn().mockResolvedValue(rowsAt(5, "20.00")) });
    await press(el, "[data-move-split]");
    await press(el, '[data-action="split-table"]');
    let prompt: object | undefined;
    tableOrder(el)!.addEventListener(
      "split-table-open",
      (event) => (prompt = (event as CustomEvent<{ prompt: object }>).detail.prompt),
      { once: true },
    );
    await press(el, '[data-target="t5"]');
    await press(el, "[data-action-back]");
    expect(prompt).toBeDefined();

    emit(tableOrder(el)!, "split-table", {
      tableId: "t5",
      selection: { wholeBillIds: [], loose: [] },
      guestCounts: { staying: 2, leaving: null },
      prompt,
      partyRevision: 5,
    });
    await flush(el);

    expect(api.splitTable).toHaveBeenCalledOnce();
    expect(sent(0)).toBe(5);
  });
});
