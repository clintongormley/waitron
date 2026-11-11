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
  shell,
  table,
  table7,
  tableOrder,
  till,
} from "../test/allergy-app-fixture.js";

const changed = (bill: string) => fill(t("table.split_changed"), { bill });
const takeOverFrom = (who: string) => fill(t("table.split_taken"), { who });
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

  it("tab.not_open with its rows' read never answering says the changed bill at the limit, and the old rows stay", async () => {
    const el = await billTwoTicked(refusedWith({ code: "tab.not_open", tabId: "b2" }));
    api.getSplitSources!.mockReset().mockImplementation(never);
    await saysOnlyAtTheLimit(el, LIMIT, fill(t("table.split_changed"), { bill: "Bill 2" }));
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
    const floorList = tableOrder(el)!.tables;

    floorRead.calls[0]!.answer(atFloor(9));
    await flush(el);

    expect(tableOrder(el)!.party?.revision).toBe(3);
    expect(tableOrder(el)!.tables).toBe(floorList);
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
    const el = await billTwoTicked(refusedWith({ code: "tab.not_open", tabId: "b2" }));
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

  describe("a refusal's reads end with the visit and the press they were for", () => {
    const stranger = party({
      id: "v7",
      revision: 50,
      tableIds: ["t6"],
      billCount: 1,
      openingBillId: "wo-6",
    });
    const withStranger = [...atFloor(3), table("t6", "6", stranger)];
    const billIds = (el: TillApp) => tableOrder(el)!.bills.map((bill) => bill.workingOrderId);

    /** Back to the floor, then the same table's panel again with Bill 2 ticked. */
    async function backToThePanel(el: TillApp): Promise<void> {
      emit(tableOrder(el)!, "back-to-floor");
      await flush(el);
      emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
      await flush(el);
      await toPanel(el);
      await tick(el, "b2");
    }

    describe("another party's table, whose bills read fails", () => {
      it.each([
        ["with a refused press's floor read still out", "getTablesState"],
        ["with a refused press's bills read still out", "getPartyBills"],
        ["control: with no press refused", null],
      ] as const)("%s: none of the last party's bills on screen", async (_case, hung) => {
        const el = await billTwoTicked({
          getTablesState: vi.fn().mockResolvedValue(withStranger),
          ...refusedWith({ code: "party.out_of_date" }),
        });
        if (hung !== null) {
          api[hung]!.mockReset().mockImplementation(never);
          await press(el, "[data-split-confirm]");
        }
        await vi.advanceTimersByTimeAsync(1_000);
        emit(tableOrder(el)!, "back-to-floor");
        await flush(el);

        api.getPartyBills!.mockReset().mockRejectedValue(lost());
        emit(floor(el)!, "open-table", { tableId: "t6", seated: true });
        await flush(el);

        expect(tableOrder(el)!.party!.id).toBe("v7");
        expect(billIds(el)).toEqual([]);
        await vi.advanceTimersByTimeAsync(2 * LIMIT);
        await flush(el);
        expect(billIds(el)).toEqual([]);
      });
    });

    it("the other party's reads have no refusal's limit", async () => {
      const el = await billTwoTicked({
        getTablesState: vi.fn().mockResolvedValue(withStranger),
        ...refusedWith({ code: "party.out_of_date" }),
      });
      api.getTablesState!.mockReset().mockImplementation(never);
      await press(el, "[data-split-confirm]");
      emit(tableOrder(el)!, "back-to-floor");
      await flush(el);

      const bills = held<PartyBill[]>();
      api.getPartyBills!.mockReset().mockImplementation(bills.read);
      server.bills.add("wo-6");
      emit(floor(el)!, "open-table", { tableId: "t6", seated: true });
      await flush(el);
      await vi.advanceTimersByTimeAsync(LIMIT + 1_000);
      await flush(el);
      bills.calls[0]!.answer([partyBill("wo-6", 1, "50.00")]);
      await flush(el);

      expect(billIds(el)).toEqual(["wo-6"]);
    });

    it("the other party's drafts read, slower than the limit with a refusal's bills read still out, keeps its own limit", async () => {
      const el = await billTwoTicked({
        getTablesState: vi.fn().mockResolvedValue(withStranger),
        ...refusedWith({ code: "party.out_of_date" }),
      });
      api.getPartyBills!.mockReset().mockImplementation(never);
      await press(el, "[data-split-confirm]");
      await vi.advanceTimersByTimeAsync(1_000);
      emit(tableOrder(el)!, "back-to-floor");
      await flush(el);

      api.getPartyBills!.mockReset().mockResolvedValue([partyBill("wo-6", 1, "50.00")]);
      server.bills.add("wo-6");
      const slow = vi.fn(
        (partyId: string) =>
          new Promise((resolve) => setTimeout(() => resolve(server.listDrafts(partyId)), 30_000)),
      );
      api.listDrafts!.mockReset().mockImplementation(slow);
      emit(floor(el)!, "open-table", { tableId: "t6", seated: true });
      await flush(el);
      expect(slow.mock.calls.map(([partyId]) => partyId)).toContain("v7");
      await vi.advanceTimersByTimeAsync(LIMIT + 1_000);
      await flush(el);
      expect(noBanner(el), "past the limit").toBe(true);

      await vi.advanceTimersByTimeAsync(5_000);
      await flush(el);
      expect(noBanner(el), "once it answers").toBe(true);
      expect(tableOrder(el)!.orderId).toBe("wo-6");
    });

    it("a party that took the table while the refusal read: its own reads have no refusal's limit", async () => {
      const el = await billTwoTicked(refusedWith({ code: "party.out_of_date" }));
      const bills = held<PartyBill[]>();
      const newcomer = party({ id: "v9", revision: 9, tableIds: ["t4"], openingBillId: "wo-9" });
      api.getTablesState!.mockReset().mockResolvedValue([table("t4", "4", newcomer), table7]);
      api.getPartyBills!.mockReset().mockImplementation(bills.read);
      server.bills.add("wo-9");
      await press(el, "[data-split-confirm]");
      expect(tableOrder(el)!.party!.id).toBe("v9");

      await vi.advanceTimersByTimeAsync(LIMIT + 1_000);
      await flush(el);
      bills.calls.at(-1)!.answer([partyBill("wo-9", 1, "90.00")]);
      await flush(el);

      expect(billIds(el)).toEqual(["wo-9"]);
    });

    describe("a second press refused within the first's limit, its floor read hung as well", () => {
      async function secondPressHung(again: (el: TillApp) => Promise<void>) {
        const words = await sentenceOfAFailedRead(() =>
          api.getTablesState!.mockReset().mockRejectedValue(lost()),
        );
        const el = await billTwoTicked(refusedWith({ code: "party.out_of_date" }));
        const shownFloor = tableOrder(el)!.tables;
        api.getTablesState!.mockReset().mockImplementation(never);
        await press(el, "[data-split-confirm]");
        await vi.advanceTimersByTimeAsync(20_000);
        await flush(el);
        await again(el);
        expect(shownFloor.length).toBeGreaterThan(0);
        await press(el, "[data-split-confirm]");
        expect(api.splitTable).toHaveBeenCalledTimes(2);
        return { el, shownFloor, words };
      }

      async function thenTheSecondsLimitPasses(el: TillApp, shownFloor: unknown, words: string) {
        await vi.advanceTimersByTimeAsync(5_000);
        await flush(el);
        expect(panelOpen(el), "the first's limit does not reopen it").toBe(false);
        expect(tableOrder(el)!.tables).toBe(shownFloor);

        await vi.advanceTimersByTimeAsync(LIMIT);
        await flush(el);
        expect(panelOpen(el)).toBe(true);
        expect(tableOrder(el)!.tables.length).toBeGreaterThan(0);
        expect(said(el)).toBe(words);
        expect(said(el)).not.toContain(t("party.changed_gone"));
      }

      it("after going back to the floor: the floor stays, and the foot says what a failed read says", async () => {
        const { el, shownFloor, words } = await secondPressHung(backToThePanel);
        await thenTheSecondsLimitPasses(el, shownFloor, words);
      });

      it("from a panel opened again without leaving: the same", async () => {
        const { el, shownFloor, words } = await secondPressHung(async (at) => {
          await toPanel(at);
          await tick(at, "b2");
        });
        await thenTheSecondsLimitPasses(el, shownFloor, words);
      });
    });

    describe("a later press, its answer still out, with an earlier refusal's reads hung", () => {
      async function pressedAgain(el: TillApp) {
        await toPanel(el);
        await tick(el, "b2");
        api.splitTable!.mockReset().mockImplementation(never);
        await press(el, "[data-split-confirm]");
        expect(api.splitTable).toHaveBeenCalledOnce();
      }

      it.each([
        [
          "every read of the order hung",
          ["getPartyBills", "getTabLines", "listGroups", "readCurrentOrders"],
          ["bills", "lines", "groups", "currentOrders"],
        ],
        [
          "its groups and kitchen reads hung",
          ["listGroups", "readCurrentOrders"],
          ["groups", "currentOrders"],
        ],
      ] as const)("%s: what they were to bring stays on screen", async (_case, hung, kept) => {
        const el = await billTwoTicked({
          ...refusedWith({ code: "party.out_of_date" }),
          getTabLines: vi.fn().mockResolvedValue({ lines: [dish("soup", 1)], revision: 0 }),
        });
        const screen = tableOrder(el)!;
        const shown = kept.map((field) => screen[field]);
        expect(screen.bills.length).toBeGreaterThan(0);
        expect(screen.lines.length).toBeGreaterThan(0);
        expect(screen.currentOrders).not.toBeNull();
        for (const read of hung) api[read]!.mockReset().mockImplementation(never);
        await press(el, "[data-split-confirm]");

        await pressedAgain(el);

        expect(kept.map((field) => tableOrder(el)![field])).toEqual(shown);
        kept.forEach((field, at) => expect(tableOrder(el)![field], field).toBe(shown[at]));
      });

      it("the earlier refusal's drafts read says nothing over it", async () => {
        const el = await billTwoTicked(refusedWith({ code: "draft.out_of_date", billId: "b2" }));
        api.listDrafts!.mockReset().mockImplementation(never);
        await press(el, "[data-split-confirm]");

        await pressedAgain(el);
        await vi.advanceTimersByTimeAsync(2 * LIMIT);
        await flush(el);

        expect(panelOpen(el)).toBe(false);
        expect(noBanner(el)).toBe(true);
      });
    });

    it("a press that goes through stops an earlier refusal's reads: its own failed floor read empties the floor as ever, and nothing is said", async () => {
      const el = await billTwoTicked(refusedWith({ code: "party.out_of_date" }));
      api.getTablesState!.mockReset().mockImplementation(never);
      await press(el, "[data-split-confirm]");
      await toPanel(el);
      await tick(el, "b2");
      api.splitTable!.mockReset().mockResolvedValue({ partyId: "v-split", billIds: ["b2"] });
      api.getTablesState!.mockReset().mockRejectedValue(lost());
      await press(el, "[data-split-confirm]");
      await flush(el);

      expect(tableOrder(el)!.tables).toEqual([]);
      expect(panelOpen(el)).toBe(false);
      await vi.advanceTimersByTimeAsync(2 * LIMIT);
      await flush(el);
      expect(panelOpen(el)).toBe(false);
      expect(noBanner(el)).toBe(true);
    });

    describe("no limit's timer outlives the screen", () => {
      /** The 25-second timers armed from here on, other than the floor poll's own. */
      function limitTimers() {
        const pending = new Set<unknown>();
        let armed = 0;
        const arm = globalThis.setTimeout;
        const disarm = globalThis.clearTimeout;
        vi.spyOn(globalThis, "setTimeout").mockImplementation(((run: () => void, ms?: number) => {
          const timer = arm(() => {
            pending.delete(timer);
            run();
          }, ms);
          if (ms === LIMIT && !new Error().stack!.includes("pollFloor")) {
            armed++;
            pending.add(timer);
          }
          return timer;
        }) as never);
        vi.spyOn(globalThis, "clearTimeout").mockImplementation(((timer: never) => {
          pending.delete(timer);
          disarm(timer);
        }) as never);
        return {
          get armed() {
            return armed;
          },
          get pending() {
            return pending.size;
          },
        };
      }
      const readsOfTheOrder = () =>
        [api.getPartyBills!, api.getTabLines!, api.listGroups!, api.readCurrentOrders!].map(
          (read) => read.mock.calls.length,
        );
      const leavings = {
        "Back to the floor": async (el: TillApp) => {
          emit(tableOrder(el)!, "back-to-floor");
          await flush(el);
          el.shadowRoot!.querySelector("wt-unsaved-changes")
            ?.shadowRoot?.querySelector<HTMLElement>("[data-choice=discard]")
            ?.click();
        },
        "the till taken off the page": (el: TillApp) => el.remove(),
      };

      it("the till's server replaced, with the floor read hung: none left", async () => {
        const el = await billTwoTicked(refusedWith({ code: "party.out_of_date" }));
        api.getTablesState!.mockReset().mockImplementation(never);
        const timers = limitTimers();
        await press(el, "[data-split-confirm]");
        await flush(el);
        expect(timers.pending).toBeGreaterThan(0);

        el.api = { ...api } as unknown as TillApp["api"];
        await flush(el);
        expect(timers.pending).toBe(0);
      });

      describe.each(Object.keys(leavings) as (keyof typeof leavings)[])("%s", (how) => {
        it.each([
          ["floor", "getTablesState"],
          ["bills", "getPartyBills"],
          ["lines", "getTabLines"],
          ["groups", "listGroups"],
          ["kitchen", "readCurrentOrders"],
        ] as const)(
          "with the %s read hung: none left, and no read starts after",
          async (_r, read) => {
            const el = await billTwoTicked(refusedWith({ code: "party.out_of_date" }));
            api[read]!.mockReset().mockImplementation(never);
            const timers = limitTimers();
            await press(el, "[data-split-confirm]");
            await vi.advanceTimersByTimeAsync(1_000);
            await flush(el);
            expect(timers.armed, "the probe saw the limit").toBeGreaterThan(0);
            expect(timers.pending).toBeGreaterThan(0);
            const before = readsOfTheOrder();

            await leavings[how](el);
            await flush(el);
            expect(timers.pending).toBe(0);

            const armed = timers.armed;
            await vi.advanceTimersByTimeAsync(4 * LIMIT);
            await flush(el);
            expect(readsOfTheOrder()).toEqual(before);
            expect(timers.armed).toBe(armed);
            expect(timers.pending).toBe(0);
          },
        );

        it("a lost reply with the floor read hung: none left, and no read starts after", async () => {
          const el = await billTwoTicked(refusedWith(lost()));
          api.getTablesState!.mockReset().mockImplementation(never);
          const timers = limitTimers();
          await press(el, "[data-split-confirm]");
          await flush(el);
          expect(timers.pending).toBeGreaterThan(0);
          const before = readsOfTheOrder();

          await leavings[how](el);
          await flush(el);
          expect(timers.pending).toBe(0);

          await vi.advanceTimersByTimeAsync(4 * LIMIT);
          await flush(el);
          expect(readsOfTheOrder()).toEqual(before);
        });

        it("with the drafts read hung: none left", async () => {
          const el = await billTwoTicked(refusedWith({ code: "draft.out_of_date", billId: "b2" }));
          api.listDrafts!.mockReset().mockImplementation(never);
          const timers = limitTimers();
          await press(el, "[data-split-confirm]");
          await flush(el);
          expect(timers.pending).toBeGreaterThan(0);

          await leavings[how](el);
          await flush(el);
          expect(timers.pending).toBe(0);
        });

        it("with the rows' read behind a reopened panel hung: none left", async () => {
          const el = await billTwoTicked(refusedWith({ code: "party.out_of_date" }));
          api.getSplitSources!.mockReset().mockImplementation(never);
          const timers = limitTimers();
          await press(el, "[data-split-confirm]");
          await flush(el);
          expect(panelOpen(el)).toBe(true);
          expect(timers.pending).toBeGreaterThan(0);

          await leavings[how](el);
          await flush(el);
          expect(timers.pending).toBe(0);
        });
      });
    });
  });
});

describe("the sentence when party.out_of_date's table could not be read again (the owner's words, 2026-11-05)", () => {
  const WORDS = [
    ["en", "The table was updated by somebody else. Try to Split again."],
    ["es-ES", "Otra persona ha actualizado la mesa. Intenta Separar de nuevo."],
  ] as const;

  it.each(WORDS)("in %s the foot says the owner's words", async (language, words) => {
    const el = await billTwoTicked({
      splitTable: vi.fn().mockRejectedValue({ code: "party.out_of_date" }),
    });
    setLocale(language);
    api.getTablesState!.mockResolvedValue(atFloor(9));
    api.getSplitSources!.mockReset().mockRejectedValue(lost());
    await press(el, "[data-split-confirm]");
    await flush(el);
    expect(said(el)).toBe(words);
  });

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
  async function reloadOut(over: Record<string, unknown> = {}, rows = firstRows(3)) {
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
    api.getSplitSources!.mockReset().mockResolvedValue(rows);
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

    it("a press after the state has arrived: no request and the sentence, then the next press carries that state, once", async () => {
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
      expect(api.splitTable).not.toHaveBeenCalled();
      expect(said(el)).toBe(changed("Bill 1"));
      expect(el.shadowRoot!.querySelector(".error")).toBeNull();

      await pressSplit(el);
      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(api.splitTable!.mock.calls[0]![4]).toEqual([noEdit("b9", { editorVersion: 4 })]);
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

    it("the server's state naming this person: the next press carries it", async () => {
      const state = noEdit("b9", { editorVersion: 4, draftId: "d-ana", draftRevision: 2 });
      const { el } = await reloadOut({
        splitTable: vi
          .fn()
          .mockRejectedValueOnce({
            code: "draft.out_of_date",
            billId: "b9",
            edit: { ...state, editorId: "p1", editorName: "Ana" },
          })
          .mockResolvedValue({ partyId: "v-split", billIds: ["b9"] }),
      });
      await tick(el, "b9");
      await pressSplit(el);
      expect(said(el)).toBe(changed("Bill 1"));

      await pressSplit(el);
      expect(api.splitTable).toHaveBeenCalledTimes(2);
      expect(api.splitTable!.mock.calls[1]![4]).toEqual([state]);
    });

    it.each([
      ["Luis", takeOverFrom("Luis")],
      [null, t("table.split_taken_unnamed")],
    ] as const)(
      "the server's state naming someone else (%s), its floor read hung: the next press sends nothing and the foot says to take over",
      async (editorName, words) => {
        const state = noEdit("b9", { editorVersion: 1, draftId: "d-luis", draftRevision: 1 });
        const { el } = await reloadOut({
          splitTable: vi
            .fn()
            .mockRejectedValueOnce({
              code: "draft.out_of_date",
              billId: "b9",
              edit: { ...state, editorId: "p-luis", editorName },
            })
            .mockResolvedValue({ partyId: "v-split", billIds: ["b9"] }),
        });
        await tick(el, "b9");
        await pressSplit(el);
        expect(api.splitTable).toHaveBeenCalledOnce();
        expect(said(el)).toBe(changed("Bill 1"));

        await pressSplit(el);
        expect(api.splitTable).toHaveBeenCalledOnce();
        expect(panelOpen(el)).toBe(true);
        expect(said(el)).toBe(words);
        expect(tickBox(el, "b9")!.checked).toBe(true);
        expect(el.shadowRoot!.querySelector(".error")).toBeNull();
      },
    );

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

  describe("the different-people question open while the first bill's draft arrives", () => {
    const limited = {
      getTill: vi.fn().mockResolvedValue({ ...till("till"), simplifiedInvoiceLimit: "15.00" }),
    };
    const twoDishes: SplitSources = {
      partyRevision: 3,
      bills: [
        {
          billId: "b9",
          lines: [dish("steak", 1), dish("wine", 2)],
          balance: balance("b9", "20.00"),
        },
      ],
    };
    const loose = { wholeBillIds: [], loose: [{ billId: "b9", lineIds: ["steak"] }] };
    const question = (el: TillApp) =>
      el.shadowRoot!.querySelector<HTMLElement>("[data-confirm-different-people]");
    const steakBox = (el: TillApp) =>
      picker(el)!
        .shadowRoot!.querySelector(`[data-split-bill="b9"] till-portion-picker`)
        ?.shadowRoot!.querySelector<HTMLInputElement>('[data-pick="steak"]');
    const pickSteak = async (el: TillApp) => {
      steakBox(el)!.click();
      await flush(el);
    };

    /** Bill 1 comes on screen with its lines read out, so it has no draft when Split asks. */
    async function askedBeforeItsDraft(over: Record<string, unknown> = {}) {
      const lines = held<{ lines: never[]; revision: number }>();
      const { el, floors } = await reloadOut({ ...limited, ...over }, twoDishes);
      api.getTabLines!.mockImplementation(lines.read);
      await pickSteak(el);
      floors.calls[0]!.answer(stillTogether());
      await flush(el);
      await flush(el);
      expect(tableOrder(el)!.orderId).toBe("b9");
      expect(lines.calls.length).toBeGreaterThan(0);

      await press(el, "[data-split-confirm]");
      expect(question(el)).not.toBeNull();
      expect(panelOpen(el)).toBe(false);
      expect(api.splitTable).not.toHaveBeenCalled();
      return { el, lines };
    }

    it("its drafts read still out at Confirm: the press sends once, nothing known, for the server to judge", async () => {
      const drafts = held<unknown>();
      const { el, lines } = await askedBeforeItsDraft({ listDrafts: vi.fn(() => drafts.read()) });
      lines.calls.forEach((call) => call.answer({ lines: [], revision: 0 }));
      await flush(el);
      expect(drafts.calls.length).toBeGreaterThan(0);

      question(el)!.querySelector<HTMLElement>("[data-confirm]")!.click();
      await flush(el);
      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(api.splitTable!.mock.calls[0]![2]).toEqual(loose);
      expect(api.splitTable!.mock.calls[0]![4]).toEqual([noEdit("b9")]);
    });

    it("its drafts read answered before Confirm: no request and the sentence, the panel back with its pick", async () => {
      const { el, lines } = await askedBeforeItsDraft({
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
      lines.calls.forEach((call) => call.answer({ lines: [], revision: 0 }));
      await flush(el);
      await flush(el);

      question(el)!.querySelector<HTMLElement>("[data-confirm]")!.click();
      await flush(el);
      await flush(el);
      expect(api.splitTable).not.toHaveBeenCalled();
      expect(panelOpen(el)).toBe(true);
      expect(said(el)).toBe(changed("Bill 1"));
      expect(steakBox(el)!.checked).toBe(true);
    });

    /** Split asks with no bill on screen; then the reload brings Bill 1, its lines read out. */
    async function askedBeforeTheBill() {
      const lines = held<{ lines: never[]; revision: number }>();
      const { el, floors } = await reloadOut(limited, twoDishes);
      api.getTabLines!.mockImplementation(lines.read);
      await pickSteak(el);
      await press(el, "[data-split-confirm]");
      expect(question(el)).not.toBeNull();
      expect(panelOpen(el)).toBe(false);
      expect(tableOrder(el)!.orderId).toBeUndefined();

      floors.calls[0]!.answer(stillTogether());
      await flush(el);
      await flush(el);
      expect(tableOrder(el)!.orderId).toBe("b9");
      expect(question(el)).not.toBeNull();
      return el;
    }

    it("the bill arriving while it is open: Confirm sends once, nothing known", async () => {
      const el = await askedBeforeTheBill();
      question(el)!.querySelector<HTMLElement>("[data-confirm]")!.click();
      await flush(el);
      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(api.splitTable!.mock.calls[0]![2]).toEqual(loose);
      expect(api.splitTable!.mock.calls[0]![4]).toEqual([noEdit("b9")]);
    });

    it("the bill arriving while it is open: Cancel brings the panel back with its pick", async () => {
      const el = await askedBeforeTheBill();
      question(el)!.querySelector<HTMLElement>("[data-cancel]")!.click();
      await flush(el);
      expect(api.splitTable).not.toHaveBeenCalled();
      expect(panelOpen(el)).toBe(true);
      expect(steakBox(el)!.checked).toBe(true);
    });
  });
});

describe("a refusal's read, once the waiter has left its party", () => {
  it("starts no rows read, from Back on: the other party's panel keeps its own rows, and a press carries them", async () => {
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
    const left = tableOrder(el)!.party!.id;
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t6", seated: true });
    await flush(el);
    await press(el, "[data-move-split]");
    await press(el, '[data-action="split-table"]');
    await press(el, '[data-target="t7"]');
    expect(picker(el)!.sources.map((each) => each.bill.workingOrderId)).toEqual(["wo-6"]);
    expect(sources.mock.calls.filter(([partyId]) => partyId === left)).toEqual([]);
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

describe("a refusal naming someone else's hold on a bill whose drafts did not answer", () => {
  const LIMIT = 25_000;
  const luisHolds = noEdit("b2", { editorVersion: 1, draftId: "d-luis", draftRevision: 1 });
  const refusedFor = () =>
    vi
      .fn()
      .mockRejectedValueOnce({
        code: "draft.out_of_date",
        billId: "b2",
        edit: { ...luisHolds, editorId: "p-luis", editorName: "Luis" },
      })
      .mockResolvedValue({ partyId: "v-split", billIds: ["b2"] });

  async function secondPressStops(el: TillApp): Promise<void> {
    expect(api.splitTable).toHaveBeenCalledOnce();
    expect(said(el)).toBe(changed("Bill 2"));
    await press(el, "[data-split-confirm]");
    await flush(el);
    expect(api.splitTable).toHaveBeenCalledOnce();
    expect(panelOpen(el)).toBe(true);
    expect(said(el)).toBe(takeOverFrom("Luis"));
    expect(tickBox(el, "b2")!.checked).toBe(true);
    expect(el.shadowRoot!.querySelector(".error")).toBeNull();
  }

  it("its drafts reads failing since the table opened: the next press sends nothing and the foot says to take over", async () => {
    const el = await billTwoTicked({
      listDrafts: vi.fn().mockRejectedValue(lost()),
      splitTable: refusedFor(),
    });
    await press(el, "[data-split-confirm]");
    await flush(el);
    await secondPressStops(el);
  });

  it("its drafts reads failing since the table opened, and hung from the press: the sentence at the limit, then the next press sends nothing and the foot says to take over", async () => {
    const el = await billTwoTicked({
      listDrafts: vi.fn().mockRejectedValue(lost()),
      splitTable: refusedFor(),
    });
    api.listDrafts!.mockReset().mockImplementation(() => new Promise(() => {}));
    await press(el, "[data-split-confirm]");
    await vi.advanceTimersByTimeAsync(LIMIT - 1);
    await flush(el);
    expect(panelOpen(el), "not before the limit").toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await flush(el);
    await secondPressStops(el);
  });

  it("a state recorded at the tick, its drafts reads failing since: the next press sends nothing and the foot says to take over", async () => {
    const el = await billTwoTicked({ splitTable: refusedFor() });
    api.listDrafts!.mockReset().mockRejectedValue(lost());
    await press(el, "[data-split-confirm]");
    await flush(el);
    await secondPressStops(el);
  });

  it("control: a drafts read answering after the refusal with the hold gone: the state it brought is a change, once, and then sent", async () => {
    const el = await billTwoTicked({
      listDrafts: vi.fn().mockRejectedValue(lost()),
      splitTable: refusedFor(),
    });
    await press(el, "[data-split-confirm]");
    await flush(el);
    expect(said(el)).toBe(changed("Bill 2"));

    const freed = noEdit("b2", { editorVersion: 2 });
    api.listDrafts!.mockReset().mockImplementation(async (partyId: string) => {
      const snapshot = await server.listDrafts(partyId);
      return {
        ...snapshot,
        billEdits: snapshot.billEdits.map((edit) =>
          edit.billId === "b2" ? { ...edit, ...freed } : edit,
        ),
      };
    });
    await refreshDrafts(el);
    await flush(el);
    await press(el, "[data-split-confirm]");
    await flush(el);
    expect(api.splitTable).toHaveBeenCalledOnce();
    expect(said(el)).toBe(changed("Bill 2"));
    await press(el, "[data-split-confirm]");
    await flush(el);

    expect(api.splitTable).toHaveBeenCalledTimes(2);
    expect(api.splitTable!.mock.calls[1]![4]).toEqual([freed]);
  });
});

describe("party.out_of_date answering while Find bill is open, after a failed floor read emptied the floor", () => {
  it("still reads the panel's rows again, though the till cannot say what changed", async () => {
    const el = await billTwoTicked({ setPartyName: vi.fn() });
    const partyId = tableOrder(el)!.party!.id;
    let refuse: (error: unknown) => void = () => {};
    api
      .splitTable!.mockReset()
      .mockImplementationOnce(() => new Promise((_, reject) => (refuse = reject)));
    await press(el, "[data-split-confirm]");
    expect(api.splitTable).toHaveBeenCalledOnce();

    // Another device has changed the party, so a rename is refused too, and the reload after it has
    // its floor read fail: with the panel closed by the press, that empties the floor.
    api
      .setPartyName!.mockReset()
      .mockRejectedValue({ code: "party.out_of_date", partyId, revision: 9 });
    api.getTablesState!.mockReset().mockRejectedValue(lost());
    emit(tableOrder(el)!, "name-party", { name: "Ana" });
    await flush(el);
    expect(api.setPartyName).toHaveBeenCalledOnce();
    expect(tableOrder(el)!.party!.revision).toBe(3);
    expect(tableOrder(el)!.tables).toEqual([]);
    emit(shell(el), "find-bill");
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-find-bill-screen")).not.toBeNull();
    const rowsRead = api.getSplitSources!.mock.calls.length;

    refuse({ code: "party.out_of_date", partyId, revision: 9 });
    await flush(el);

    expect(api.getSplitSources!.mock.calls.slice(rowsRead).map(([id]) => id)).toEqual([partyId]);
  });
});
