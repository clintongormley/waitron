import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { PartyBill, SplitSources, TabLine } from "./api/client.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { partyBill } from "./screens/till-table-order-screen.bill-switcher.test-helpers.js";
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
  lock,
  mountApp,
  party,
  resetAllergyFixture,
  server,
  shell,
  table,
  table7,
  tableOrder,
  till,
} from "../test/allergy-app-fixture.js";

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

const FIRST_SEED = 1;
const HISTORIES = 40;
const STEPS_PER_HISTORY = 12;

function seededRandom(seed: number): () => number {
  let state = seed * 2654435761;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** A party whose revision and rows move together, as the real route's one transaction answers them,
 * and reads that answer at once, fail, or wait until the history says. */
class Venue {
  revision = 3;
  billTwo = 20;
  billTwoRevision = 0;
  editorVersion = 0;
  firstBill = false;
  reads = 0;
  chaos = false;
  random: () => number = Math.random;
  readonly drawnBy = new WeakMap<SplitSources, { read: number; revision: number }>();
  readonly waiting: { answer: () => void; fail: () => void }[] = [];

  constructor(readonly noBill: boolean) {}

  get bills(): PartyBill[] {
    if (this.noBill)
      return this.firstBill
        ? [partyBill("b9", 1, `${this.billTwo}.00`, { revision: this.billTwoRevision })]
        : [];
    return listAt(`${this.billTwo}.00`, this.billTwoRevision);
  }

  floor() {
    return this.noBill
      ? atFloor(this.revision, {
          billCount: this.firstBill ? 1 : 0,
          openingBillId: this.firstBill ? "b9" : null,
        })
      : atFloor(this.revision);
  }

  /** Each read's rows name it, so the screen can be asked which read it is drawing. */
  sources(): SplitSources {
    const read = ++this.reads;
    const lines = (id: string) => [dish(id, 1, `${id}@${read}`)];
    const answer: SplitSources = {
      partyRevision: this.revision,
      bills: this.noBill
        ? this.firstBill
          ? [{ billId: "b9", lines: lines("steak"), balance: balance("b9", `${this.billTwo}.00`) }]
          : []
        : [
            { billId: "wo-4", lines: lines("soup"), balance: balance("wo-4", "10.00") },
            { billId: "b2", lines: lines("steak"), balance: balance("b2", `${this.billTwo}.00`) },
          ],
    };
    this.drawnBy.set(answer, { read, revision: this.revision });
    return answer;
  }

  /** The server reads now, whenever the answer reaches the till. */
  answer<T>(read: () => T): Promise<T> {
    const value = read();
    const roll = this.chaos ? this.random() : 0;
    if (roll < 0.6) return Promise.resolve(value);
    if (roll < 0.8) return Promise.reject(lost());
    return new Promise<T>((resolve, reject) =>
      this.waiting.push({ answer: () => resolve(value), fail: () => reject(lost()) }),
    );
  }

  anotherTillChanges(): void {
    this.revision++;
    if (this.noBill && !this.firstBill) {
      this.firstBill = true;
      server.bills.add("b9");
      return;
    }
    this.billTwo += 10;
    this.billTwoRevision++;
  }
}

let venue: Venue;

async function interleavedApp(): Promise<TillApp> {
  venue = new Venue(false);
  server.bills.add("wo-4");
  server.bills.add("b2");
  const { el } = await mountApp({
    getTablesState: vi.fn(() => venue.answer(() => venue.floor())),
    getPartyBills: vi.fn(() => venue.answer(() => venue.bills)),
    getSplitSources: vi.fn(() => venue.answer(() => venue.sources())),
    listDrafts: vi.fn(async (partyId: string) => {
      const snapshot = await server.listDrafts(partyId);
      return {
        ...snapshot,
        billEdits: snapshot.billEdits.map((edit) => ({
          ...edit,
          editorVersion: venue.editorVersion,
        })),
      };
    }),
    setPartyName: vi.fn(async () => ({ revision: ++venue.revision })),
    setKitchenNote: vi.fn().mockRejectedValue({ code: "kitchen_note.out_of_date" }),
    getKitchenNote: vi.fn(async () => ({
      scope: { partyId: "v1" },
      note: null,
      revision: 1,
      ownerRevision: venue.revision,
    })),
    splitTable: vi.fn((partyId: string, _table: string, _picked: unknown, revision: number) => {
      if (revision !== venue.revision)
        return Promise.reject({ code: "party.out_of_date", partyId, revision: venue.revision });
      const roll = venue.random();
      if (roll < 0.25) return Promise.resolve({ partyId: "v-split", billIds: [] });
      if (roll < 0.5) return Promise.reject({ code: "table.not_shared" });
      if (roll < 0.75) return Promise.reject(lost());
      return Promise.reject({ code: "tab.split_held_line" });
    }),
  });
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
  await flush(el);
  emit(shell(el), "screen-select", { screen: "floor" });
  await flush(el);
  return el;
}

function ensureTick(el: TillApp): void {
  if (venue.noBill || picker(el) === null) return;
  const box = tickBox(el, "b2");
  if (box !== null && !box.checked) box.click();
}

/** Which read drew the rows on screen, by the words on the rows where there are any. */
function drawnRead(el: TillApp): { read: number; revision: number } {
  const drawn = tableOrder(el)!.splitRead as SplitSources;
  const known = venue.drawnBy.get(drawn);
  expect(known, "the rows on screen are one read's answer, as it arrived").toBeDefined();
  const words = [...picker(el)!.shadowRoot!.querySelectorAll("till-portion-picker")]
    .map((rows) => rows.shadowRoot!.textContent ?? "")
    .join(" ");
  const named = /@(\d+)/.exec(words)?.[1];
  if (named !== undefined) expect(Number(named)).toBe(known!.read);
  return known!;
}

function discardIfAsked(el: TillApp): void {
  el.shadowRoot!.querySelector("wt-unsaved-changes")
    ?.shadowRoot?.querySelector<HTMLElement>("[data-choice=discard]")
    ?.click();
}

async function reopenPanel(el: TillApp): Promise<void> {
  if (q(el, "[data-action-back]") !== null) {
    await press(el, "[data-action-back]");
    discardIfAsked(el);
    await flush(el, 3);
  }
  if (q(el, '[data-target="t5"]') !== null) await press(el, '[data-target="t5"]');
}

async function pressStep(el: TillApp, totals: Record<string, number>): Promise<void> {
  const screen = tableOrder(el)!;
  const read = screen.splitRead;
  if (picker(el) === null) {
    expect(read === null || read === "failed", "no rows only until a first read has answered").toBe(
      true,
    );
    expect(splitButton(el)!.disabled).toBe(true);
    totals.blank!++;
    return;
  }
  expect(splitButton(el)!.disabled, "Split is never held by a read").toBe(false);
  expect(splitButton(el)!.variant).toBe("primary");
  totals.pressable!++;
  const shown = drawnRead(el);
  const before = api.splitTable!.mock.calls.length;
  splitButton(el)!.click();
  await flush(el, 3);
  const calls = api.splitTable!.mock.calls;
  if (calls.length === before) {
    expect(said(el), "a press that sends nothing says why").not.toBeNull();
    totals.stopped!++;
    return;
  }
  expect(calls.length).toBe(before + 1);
  expect(calls[before]![3], "the revision sent is that of the read drawing the rows").toBe(
    shown.revision,
  );
  totals.sent!++;
  if (shown.revision !== venue.revision) totals.stale!++;
}

async function runHistory(
  el: TillApp,
  seed: number,
  ops: string[],
  totals: Record<string, number>,
): Promise<void> {
  const random = seededRandom(seed);
  venue.chaos = false;
  for (const waiting of venue.waiting.splice(0)) waiting.fail();
  await flush(el, 3);
  if (tableOrder(el) !== null) {
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el, 3);
    discardIfAsked(el);
    await flush(el, 3);
  }
  // Rising across histories: the till keeps the highest revision it has seen, and no server falls behind it.
  venue = Object.assign(new Venue(random() < 0.25), { random, revision: venue.revision });
  server.drafts.length = 0;
  api.getTablesState!.mockClear();
  emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
  await flush(el, 3);
  await toPanel(el);
  venue.chaos = true;
  ensureTick(el);
  await flush(el, 2);
  for (let step = 0; step < STEPS_PER_HISTORY; step++) {
    totals.steps!++;
    const roll = random();
    const open = panelOpen(el);
    if (!open && venue.waiting.length === 0 && roll >= 0.5) break;
    if (!open || roll < 0.1) {
      ops.push("late");
      const waiting = venue.waiting.splice(Math.floor(random() * venue.waiting.length), 1)[0];
      if (random() < 0.8) waiting?.answer();
      else waiting?.fail();
      await flush(el, 3);
    } else if (roll < 0.35) {
      ops.push("press");
      await pressStep(el, totals);
      if (
        api.splitTable!.mock.results.at(-1)?.value !== undefined &&
        !panelOpen(el) &&
        venue.waiting.length === 0
      )
        await flush(el, 3);
    } else if (roll < 0.55) {
      ops.push("change");
      venue.anotherTillChanges();
    } else if (roll < 0.62) {
      ops.push("rename-elsewhere");
      venue.revision++;
    } else if (roll < 0.82) {
      ops.push("timed");
      await vi.advanceTimersByTimeAsync(15_000);
      await flush(el, 3);
    } else if (roll < 0.88) {
      ops.push("rename");
      emit(tableOrder(el)!, "name-party", { name: "Ana" });
      await flush(el, 3);
    } else if (roll < 0.92) {
      ops.push("note");
      const note = q<HTMLElementTagNameMap["till-order-kitchen-note"]>(
        el,
        "till-order-kitchen-note",
      );
      if (note !== null)
        emit(note, "save-kitchen-note", {
          scopeKey: note.scopeKey,
          revision: note.revision,
          visit: note.visit,
          note: "Together",
        });
      await flush(el, 3);
    } else if (roll < 0.97) {
      ops.push("edit");
      venue.editorVersion++;
      window.dispatchEvent(new Event("focus"));
      await flush(el, 3);
    } else {
      ops.push("reopen");
      await reopenPanel(el);
    }
    if (panelOpen(el)) ensureTick(el);
    await flush(el, 1);
  }
  totals.histories!++;
}

describe("till-app: Split a table's rows and its revision are one read (D16)", () => {
  describe("a reload behind the panel whose list is overtaken", () => {
    /** A timed read moves the list; its sources name a bill the list lacks, which starts the reload;
     * another change takes Bill 2 to 40.00 and the party to 9 before the reload's reads. */
    async function overtaken(answerLater: "answers" | "fails" | "never answers") {
      const bills = held<PartyBill[]>();
      const el = await billTwoTicked({
        getPartyBills: vi.fn().mockResolvedValue(listAt("20.00", 0)),
      });
      api.getTablesState!.mockResolvedValue(atFloor(9));
      api
        .getPartyBills!.mockReset()
        .mockResolvedValueOnce(listAt("30.00", 1))
        .mockImplementation(bills.read);
      const rows = api
        .getSplitSources!.mockReset()
        .mockResolvedValueOnce(rowsAt(7, "30.00", ["b3"]));
      if (answerLater === "answers") rows.mockResolvedValue(rowsAt(9, "40.00", ["b3"]));
      else if (answerLater === "fails") rows.mockRejectedValue(lost());
      else rows.mockImplementation(() => new Promise(() => {}));
      await timedRead(el);
      expect(tableOrder(el)!.party?.revision).toBe(9);
      return { el, bills };
    }

    const amounts = { "30.00": 7, "40.00": 9 };

    it.each(["answers", "fails", "never answers"] as const)(
      "by the next timed read, and the floor's read of the rows %s",
      async (later) => {
        const { el, bills } = await overtaken(later);
        await timedRead(el);
        expect(bills.calls.length).toBeGreaterThanOrEqual(2);
        bills.calls[0]!.answer(listAt("40.00", 2, ["b3"]));
        await flush(el);

        await expectPressCarriesTheRows(el, amounts);
      },
    );

    it.each(["answers", "fails", "never answers"] as const)(
      "by another reader's bills read after a rename, and the floor's read of the rows %s",
      async (later) => {
        const { el, bills } = await overtaken(later);
        api.setPartyName = vi.fn().mockResolvedValue({ revision: 9 });
        (el.api as unknown as Record<string, unknown>).setPartyName = api.setPartyName;
        emit(tableOrder(el)!, "name-party", { name: "Ana" });
        await flush(el);
        bills.calls[0]!.answer(listAt("40.00", 2, ["b3"]));
        await flush(el);

        await expectPressCarriesTheRows(el, amounts);
      },
    );
  });

  it.each(["answers", "fails", "never answers"] as const)(
    "a refusal's list overtaken past the hold: the panel reads, and its rows' read %s",
    async (later) => {
      const bills = held<PartyBill[]>();
      const el = await billTwoTicked({
        splitTable: vi
          .fn()
          .mockRejectedValueOnce({ code: "party.out_of_date" })
          .mockResolvedValue({ partyId: "v-split", billIds: ["b2"] }),
      });
      api.getTablesState!.mockResolvedValue(atFloor(9));
      api.getPartyBills!.mockReset().mockImplementation(bills.read);
      const rows = api.getSplitSources!.mockReset();
      if (later === "answers") rows.mockResolvedValue(rowsAt(9, "30.00"));
      else if (later === "fails") rows.mockRejectedValue(lost());
      else rows.mockImplementation(() => new Promise(() => {}));

      await press(el, "[data-split-confirm]");
      expect(sent(0)).toBe(3);
      await vi.advanceTimersByTimeAsync(151_000);
      await flush(el);
      bills.calls[0]!.answer(listAt("20.00", 0));
      await flush(el);
      expect(panelOpen(el)).toBe(true);
      expect(rows).toHaveBeenCalled();

      await expectPressCarriesTheRows(el, { "20.00": 3, "30.00": 9 });
    },
  );

  describe("the till's own stop at Send", () => {
    it.each(["answers", "fails", "never answers"] as const)(
      "after a rename whose bills read is out, and the rows' read %s",
      async (later) => {
        const bills = held<PartyBill[]>();
        const { moved, listDrafts } = draftsMoving();
        const el = await billTwoTicked({
          listDrafts,
          setPartyName: vi.fn().mockResolvedValue({ revision: 4 }),
        });
        api.getTablesState!.mockResolvedValue(atFloor(9));
        api.getPartyBills!.mockReset().mockImplementation(bills.read);
        const rows = api.getSplitSources!.mockReset();
        if (later === "answers") rows.mockResolvedValue(rowsAt(9, "30.00"));
        else if (later === "fails") rows.mockRejectedValue(lost());
        else rows.mockImplementation(() => new Promise(() => {}));
        emit(tableOrder(el)!, "name-party", { name: "Ana" });
        await flush(el);
        moved.now = true;
        await refreshDrafts(el);

        await press(el, "[data-split-confirm]");
        await flush(el);
        expect(api.splitTable).not.toHaveBeenCalled();
        expect(said(el)).toContain("Bill 2");

        await expectPressCarriesTheRows(el, { "20.00": 3, "30.00": 9 });
      },
    );

    it.each(["answers", "fails", "never answers"] as const)(
      "after a refused kitchen note named a newer revision, with no read out, and the rows' read %s",
      async (later) => {
        const { moved, listDrafts } = draftsMoving();
        const el = await billTwoTicked({
          listDrafts,
          setKitchenNote: vi.fn().mockRejectedValue({ code: "kitchen_note.out_of_date" }),
          getKitchenNote: vi.fn().mockResolvedValue({
            scope: { partyId: "v1" },
            note: null,
            revision: 1,
            ownerRevision: 9,
          }),
        });
        const rows = api.getSplitSources!.mockReset();
        if (later === "answers") rows.mockResolvedValue(rowsAt(9, "30.00"));
        else if (later === "fails") rows.mockRejectedValue(lost());
        else rows.mockImplementation(() => new Promise(() => {}));
        const note = q<HTMLElementTagNameMap["till-order-kitchen-note"]>(
          el,
          "till-order-kitchen-note",
        )!;
        emit(note, "save-kitchen-note", {
          scopeKey: note.scopeKey,
          revision: note.revision,
          visit: note.visit,
          note: "Together",
        });
        await flush(el);
        expect(tableOrder(el)!.party?.revision).toBe(9);
        expect(rows).toHaveBeenCalledOnce();
        moved.now = true;
        await refreshDrafts(el);

        await press(el, "[data-split-confirm]");
        await flush(el);
        expect(api.splitTable).not.toHaveBeenCalled();
        expect(said(el)).toContain("Bill 2");

        await expectPressCarriesTheRows(el, { "20.00": 3, "30.00": 9 });
      },
    );
  });

  describe("a party's first bill arriving behind the panel", () => {
    const noBill = party({ tableIds: ["t4", "t5"], billCount: 0, openingBillId: null });
    const noBillFloor = [table("t4", "4", noBill), table("t5", "5", noBill), table7];
    const firstBill = () => [partyBill("b9", 1, "20.00")];
    const firstRows = (partyRevision: number): SplitSources => ({
      partyRevision,
      bills: [{ billId: "b9", lines: [dish("steak", 1)], balance: balance("b9", "20.00") }],
    });

    async function panelWithNoBill() {
      const rows = held<SplitSources>();
      const el = await mounted({
        getTablesState: vi.fn().mockResolvedValue(noBillFloor),
        getPartyBills: vi.fn().mockResolvedValue([]),
        getSplitSources: vi.fn().mockResolvedValue({ partyRevision: 3, bills: [] }),
      });
      await toPanel(el);
      expect(picker(el)!.sources).toEqual([]);
      server.bills.add("b9");
      api.getTablesState!.mockResolvedValue(atFloor(9, { billCount: 1, openingBillId: "b9" }));
      api.getPartyBills!.mockResolvedValue(firstBill());
      api.getSplitSources!.mockReset().mockImplementation(rows.read);
      await timedRead(el);
      expect(tableOrder(el)!.party?.revision).toBe(9);
      return { el, rows };
    }

    it("the read after the floor's failing: the press sends, at the rows' revision, and is not lost", async () => {
      const { el, rows } = await panelWithNoBill();
      expect(rows.calls.length).toBeGreaterThanOrEqual(2);
      rows.calls.at(-1)!.fail();
      await flush(el);
      expect(splitButton(el)!.disabled).toBe(false);

      await press(el, "[data-split-confirm]");
      await flush(el);

      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(sent(0)).toBe(3);
    });

    it("that read overtaken by a list that moved, and answered: the press sends, at that read's revision", async () => {
      const { el, rows } = await panelWithNoBill();
      api.getPartyBills!.mockResolvedValue([partyBill("b9", 1, "30.00", { revision: 1 })]);
      await timedRead(el);
      rows.calls.at(-1)!.answer(firstRows(10));
      await flush(el);
      expect(picker(el)!.sources.map((each) => each.bill.workingOrderId)).toEqual(["b9"]);

      await press(el, "[data-split-confirm]");
      await flush(el);

      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(sent(0)).toBe(10);
    });

    it("a press before any of that has landed is sent, for the server to judge", async () => {
      const rows = held<SplitSources>();
      const floors = held<ReturnType<typeof atFloor>>();
      const el = await mounted({
        getTablesState: vi.fn().mockResolvedValue(noBillFloor),
        getPartyBills: vi.fn().mockResolvedValue([]),
        getSplitSources: vi.fn().mockResolvedValue({ partyRevision: 3, bills: [] }),
      });
      await toPanel(el);
      server.bills.add("b9");
      api.getTablesState!.mockReset().mockImplementation(floors.read);
      api.getPartyBills!.mockResolvedValue(firstBill());
      api.getSplitSources!.mockReset().mockImplementation(rows.read);
      await timedRead(el);
      expect(floors.calls).toHaveLength(1);
      expect(splitButton(el)!.disabled).toBe(false);
      expect(splitButton(el)!.variant).toBe("primary");

      await press(el, "[data-split-confirm]");
      await flush(el);

      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(sent(0)).toBe(3);
    });
  });

  describe("the waiting mark travels in the rows' read", () => {
    const held = {
      id: "g-mains",
      position: 1,
      displayNumber: 1,
      numberPartyId: "p",
      state: "held" as const,
      firedAt: null,
      remindAt: null,
      lineIds: [],
      courseIds: ["c-mains"],
      summary: "",
    };
    const mains = { id: "c-mains", name: "Mains", displayOrder: 2, heldUntilFired: true };
    const rowsWith = (partyRevision: number, line: TabLine): SplitSources => ({
      partyRevision,
      bills: [
        { billId: "wo-4", lines: [dish("soup", 1)], balance: balance("wo-4", "10.00") },
        { billId: "b2", lines: [line], balance: balance("b2", "20.00") },
      ],
    });
    const steak = (over: Partial<TabLine>) => ({
      ...dish("steak", 1),
      groupId: "g-mains",
      courseId: "c-mains",
      course: mains,
      ...over,
    });
    const marks = (el: TillApp) =>
      [...picker(el)!.shadowRoot!.querySelectorAll("till-portion-picker")].flatMap((portions) =>
        [...portions.shadowRoot!.querySelectorAll("[data-pick-mark]")].map((mark) =>
          mark.textContent!.trim(),
        ),
      );

    it("goes at the next timed read from a dish whose group another till fired, whose fired time never comes, with no groups read", async () => {
      const el = await mounted({
        listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [held], printProblems: [] }),
        getSplitSources: vi.fn().mockResolvedValue(rowsWith(3, steak({ waitsInHeldGroup: true }))),
      });
      await toPanel(el);
      expect(marks(el)).toEqual(["Held · Mains"]);
      const groupsRead = api.listGroups!.mock.calls.length;
      const rowsRead = api.getSplitSources!.mock.calls.length;

      // Firing a group moves its bills' revision (`waiting-course-copy.test.ts`), which the timed
      // bills read sees.
      api.getPartyBills!.mockResolvedValue(listAt("20.00", 1));
      api.getSplitSources!.mockResolvedValue(rowsWith(4, steak({})));
      await timedRead(el);

      expect(api.getSplitSources!.mock.calls.length).toBe(rowsRead + 1);
      expect(marks(el)).toEqual([]);
      expect(api.listGroups!.mock.calls.length).toBe(groupsRead);
    });

    it("Move dishes draws it from its own rows' read, whatever the till's groups say, and neither the panel's timed reads nor closing the panel read those rows", async () => {
      const lines = (over: Partial<TabLine>) => ({ revision: 0, lines: [steak(over)] });
      const movePicker = (el: TillApp) =>
        q(el, "[data-move-dishes] till-portion-picker") as HTMLElement | null;
      const moveMarks = (el: TillApp) =>
        [...(movePicker(el)?.shadowRoot!.querySelectorAll("[data-pick-mark]") ?? [])].map((mark) =>
          mark.textContent!.trim(),
        );
      const el = await mounted({
        listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [], printProblems: [] }),
        getTabLines: vi.fn().mockResolvedValue(lines({ waitsInHeldGroup: true })),
      });
      await press(el, "[data-move-split]");
      await press(el, '[data-action="move-dishes"]');
      expect(movePicker(el)).not.toBeNull();
      expect(moveMarks(el)).toEqual(["Held · Mains"]);
      const linesRead = api.getTabLines!.mock.calls.length;

      api.getTabLines!.mockResolvedValue(lines({}));
      api.getPartyBills!.mockResolvedValue(listAt("20.00", 1));
      await timedRead(el);
      await timedRead(el);

      expect(api.getTabLines!.mock.calls.length).toBe(linesRead);
      expect(moveMarks(el)).toEqual(["Held · Mains"]);

      await press(el, "[data-action-back]");
      await press(el, '[data-action="move-dishes"]');
      expect(api.getTabLines!.mock.calls.length).toBe(linesRead);
      expect(moveMarks(el)).toEqual(["Held · Mains"]);
    });

    it("comes at the next timed read on a dish arriving in a held group the till has not read, with no groups read", async () => {
      const el = await mounted({
        listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [], printProblems: [] }),
        getSplitSources: vi.fn().mockResolvedValue(rowsWith(3, dish("steak", 1))),
      });
      await toPanel(el);
      expect(marks(el)).toEqual([]);
      const groupsRead = api.listGroups!.mock.calls.length;
      const rowsRead = api.getSplitSources!.mock.calls.length;

      api.getPartyBills!.mockResolvedValue(listAt("20.00", 1));
      api.getSplitSources!.mockResolvedValue(rowsWith(4, steak({ waitsInHeldGroup: true })));
      await timedRead(el);

      expect(api.getSplitSources!.mock.calls.length).toBe(rowsRead + 1);
      expect(marks(el)).toEqual(["Held · Mains"]);
      expect(api.listGroups!.mock.calls.length).toBe(groupsRead);
    });
  });

  describe("a read that never answers", () => {
    const never = () => new Promise(() => {});

    it("the rows' read a reload's floor started, five minutes on: Split can be pressed, and the press carries the rows", async () => {
      const el = await billTwoTicked();
      api.getTablesState!.mockResolvedValue(atFloor(9));
      api.getPartyBills!.mockResolvedValue(listAt("30.00", 1));
      api
        .getSplitSources!.mockReset()
        .mockImplementationOnce(() => {
          api.getPartyBills!.mockResolvedValue(listAt("30.00", 1, ["b3"]));
          return Promise.resolve(rowsAt(7, "30.00", ["b3"]));
        })
        .mockImplementation(never);
      await timedRead(el);
      expect(tableOrder(el)!.party?.revision).toBe(9);
      expect(api.getSplitSources!.mock.calls.length).toBeGreaterThanOrEqual(2);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await flush(el);

      expect(takes(el)).toContain("30.00");
      expect(splitButton(el)!.variant).toBe("primary");
      await expectPressCarriesTheRows(el, { "30.00": 7 });
    });

    it.each(["floor", "bills"] as const)(
      "the first bill reload's %s read: Split stays pressable, also across Back, reopening and leaving",
      async (stuck) => {
        const noBill = party({ tableIds: ["t4", "t5"], billCount: 0, openingBillId: null });
        const el = await mounted({
          getTablesState: vi
            .fn()
            .mockResolvedValue([table("t4", "4", noBill), table("t5", "5", noBill), table7]),
          getPartyBills: vi.fn().mockResolvedValue([]),
          getSplitSources: vi.fn().mockResolvedValue({ partyRevision: 3, bills: [] }),
        });
        await toPanel(el);
        server.bills.add("b9");
        const firstList = [partyBill("b9", 1, "20.00")];
        const rows: SplitSources = {
          partyRevision: 3,
          bills: [{ billId: "b9", lines: [dish("steak", 1)], balance: balance("b9", "20.00") }],
        };
        api.getSplitSources!.mockResolvedValue(rows);
        if (stuck === "floor") {
          api.getPartyBills!.mockResolvedValue(firstList);
          api.getTablesState!.mockReset().mockImplementationOnce(never);
          api.getTablesState!.mockResolvedValue(atFloor(3, { billCount: 1, openingBillId: "b9" }));
        } else {
          api
            .getPartyBills!.mockReset()
            .mockResolvedValueOnce(firstList)
            .mockImplementationOnce(never);
          api.getPartyBills!.mockResolvedValue(firstList);
          api.getTablesState!.mockResolvedValue(atFloor(3, { billCount: 1, openingBillId: "b9" }));
        }
        await timedRead(el);
        const expectPressable = () => {
          expect(picker(el)).not.toBeNull();
          expect(splitButton(el)!.disabled).toBe(false);
          expect(splitButton(el)!.variant).toBe("primary");
        };
        expectPressable();

        const floorReads = api.getTablesState!.mock.calls.length;
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        await flush(el);
        expectPressable();
        expect(api.getTablesState!.mock.calls.length, "no second reload on that panel").toBe(
          floorReads,
        );

        await press(el, "[data-action-back]");
        await press(el, '[data-target="t5"]');
        await flush(el);
        expectPressable();
        await timedRead(el);
        expect(
          api.getTablesState!.mock.calls.length,
          "a new panel's timed read reloads",
        ).toBeGreaterThan(floorReads);

        emit(tableOrder(el)!, "back-to-floor");
        await flush(el);
        emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
        await flush(el);
        await toPanel(el);
        await flush(el);
        expectPressable();
      },
    );
  });

  describe("what a stale snapshot costs", () => {
    it("a rename elsewhere moves the revision alone: a read follows it, and the press carries that read", async () => {
      const el = await billTwoTicked({
        setPartyName: vi.fn().mockResolvedValue({ revision: 4 }),
      });
      api.getTablesState!.mockResolvedValue(atFloor(4));
      api.getSplitSources!.mockResolvedValue(rowsAt(4, "20.00"));
      const before = api.getSplitSources!.mock.calls.length;

      emit(tableOrder(el)!, "name-party", { name: "Ana" });
      await flush(el);

      expect(api.getSplitSources!.mock.calls.length).toBe(before + 1);
      await press(el, "[data-split-confirm]");
      await flush(el);
      expect(sent(0)).toBe(4);
    });

    it("the same revision and list seen again read nothing", async () => {
      const el = await billTwoTicked();
      const before = api.getSplitSources!.mock.calls.length;

      await timedRead(el);
      await timedRead(el);

      expect(api.getSplitSources!.mock.calls.length).toBe(before);
    });

    it("a failed read is tried again by the next timed read, with nothing else moved", async () => {
      const el = await billTwoTicked();
      api.getPartyBills!.mockResolvedValue(listAt("30.00", 1));
      api.getSplitSources!.mockRejectedValueOnce(lost()).mockResolvedValue(rowsAt(7, "30.00"));

      await timedRead(el);
      expect(takes(el)).toContain("20.00");
      await timedRead(el);

      expect(takes(el)).toContain("30.00");
    });

    it("only party.out_of_date reaches the sentence behind the failed read's words", async () => {
      const refusals: [string, unknown, boolean][] = [
        ["party.out_of_date", { code: "party.out_of_date" }, true],
        ["a lost reply", lost(), false],
        ["table.not_shared", { code: "table.not_shared" }, false],
      ];
      for (const [name, error, reaches] of refusals) {
        const el = await billTwoTicked({
          splitTable: vi.fn().mockRejectedValue(error),
        });
        api.getTablesState!.mockResolvedValue(atFloor(9));
        api.getPartyBills!.mockResolvedValue(listAt("30.00", 1));
        api.getSplitSources!.mockReset().mockRejectedValue(lost());
        await press(el, "[data-split-confirm]");
        await flush(el);
        expect(panelOpen(el), name).toBe(true);
        expect(said(el) === t("table.split_updated_elsewhere"), name).toBe(reaches);
        cleanupWidgets();
        resetAllergyFixture();
      }
    });
  });

  it("a seeded run of floor, bills and sources reads landing in any order: every press carries the read that drew its rows", async () => {
    const totals = {
      histories: 0,
      steps: 0,
      pressable: 0,
      blank: 0,
      sent: 0,
      stale: 0,
      stopped: 0,
    };
    const app = await interleavedApp();
    for (let seed = FIRST_SEED; seed < FIRST_SEED + HISTORIES; seed++) {
      const ops: string[] = [];
      try {
        await runHistory(app, seed, ops, totals);
      } catch (error) {
        throw new Error(`seed ${seed}, steps ${ops.join(" ")}: ${String(error)}`, { cause: error });
      }
    }
    console.log("A803 interleavings", JSON.stringify(totals));

    expect(totals.histories).toBe(HISTORIES);
    expect(totals.sent).toBeGreaterThan(0);
    expect(totals.stale).toBeGreaterThan(0);
    expect(totals.stopped).toBeGreaterThan(0);
  }, 300_000);

  it("the different-people question keeps what its press carried, whatever lands while it is open", async () => {
    const el = await mounted({
      getTill: vi.fn().mockResolvedValue({ ...till("till"), simplifiedInvoiceLimit: "15.00" }),
      setPartyName: vi.fn().mockResolvedValue({ revision: 9 }),
      getSplitSources: vi.fn().mockResolvedValue({
        partyRevision: 3,
        bills: [
          { billId: "wo-4", lines: [dish("soup", 1)], balance: balance("wo-4", "10.00") },
          {
            billId: "b2",
            lines: [dish("steak", 1), dish("wine", 2)],
            balance: balance("b2", "20.00"),
          },
        ],
      }),
    });
    await toPanel(el);
    picker(el)!
      .shadowRoot!.querySelector(`[data-split-bill="b2"] till-portion-picker`)!
      .shadowRoot!.querySelector<HTMLInputElement>('[data-pick="steak"]')!
      .click();
    await flush(el);
    await press(el, "[data-split-confirm]");
    const question = () =>
      el.shadowRoot!.querySelector<HTMLElement>("[data-confirm-different-people]");
    expect(question()).not.toBeNull();

    api.getTablesState!.mockResolvedValue(atFloor(9));
    emit(tableOrder(el)!, "name-party", { name: "Ana" });
    await flush(el);
    expect(tableOrder(el)!.party?.revision).toBe(9);
    question()!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);

    expect(api.splitTable).toHaveBeenCalledOnce();
    expect(sent(0)).toBe(3);
  });

  describe("the foot a refusal brought into view", () => {
    const onScreen = (control: HTMLElement) => {
      const box = control.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight;
    };
    const longRows = (partyRevision: number): SplitSources => ({
      partyRevision,
      bills: [
        {
          billId: "wo-4",
          lines: Array.from({ length: 16 }, (_, index) => dish(`dish-${index}`, index + 1)),
          balance: balance("wo-4", "160.00"),
        },
        { billId: "b2", lines: [dish("steak", 1)], balance: balance("b2", "20.00") },
      ],
    });

    async function refusedWithItsReadOut() {
      await page.viewport(390, 844);
      const rows = held<SplitSources>();
      const el = await billTwoTicked({
        splitTable: vi.fn().mockRejectedValue({ code: "party.out_of_date" }),
      });
      api.getTablesState!.mockResolvedValue(atFloor(9));
      api.getSplitSources!.mockReset().mockImplementation(rows.read);
      await press(el, "[data-split-confirm]");
      await flush(el);
      expect(rows.calls).toHaveLength(1);
      await expect.poll(() => said(el) !== null && onScreen(splitButton(el)!)).toBe(true);
      return { el, rows };
    }

    it("comes back into view when the read after it draws sixteen more dishes", async () => {
      const { el, rows } = await refusedWithItsReadOut();

      rows.calls[0]!.answer(longRows(9));
      await flush(el);

      expect(q(el, "[data-split-pick]")!.getBoundingClientRect().height).toBeGreaterThan(
        innerHeight,
      );
      await expect
        .poll(() => onScreen(q(el, "[data-split-refusal]")!) && onScreen(splitButton(el)!))
        .toBe(true);
    });

    it("is left where it is once the waiter has touched the screen", async () => {
      const { el, rows } = await refusedWithItsReadOut();
      tableOrder(el)!.dispatchEvent(new WheelEvent("wheel", { bubbles: true, composed: true }));

      rows.calls[0]!.answer(longRows(9));
      await flush(el);

      expect(q(el, "[data-split-pick]")!.getBoundingClientRect().height).toBeGreaterThan(
        innerHeight,
      );
      await flush(el);
      expect(onScreen(splitButton(el)!)).toBe(false);
    });
  });

  describe("what this does not reach", () => {
    const never = () => new Promise(() => {});

    it("a first read that never answers leaves a blank panel, Split quiet, with no words, until Back and the table read again", async () => {
      const el = await mounted({ getSplitSources: vi.fn().mockImplementation(never) });
      await toPanel(el);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await flush(el);

      expect(picker(el)).toBeNull();
      expect(splitButton(el)!.disabled).toBe(true);
      expect(splitButton(el)!.variant).toBe("secondary");
      expect(said(el)).toBeNull();

      const rowsRead = api.getSplitSources!.mock.calls.length;
      api.getSplitSources!.mockResolvedValue(rowsAt(3, "20.00"));
      await press(el, "[data-action-back]");
      await press(el, '[data-target="t5"]');
      await flush(el);

      expect(api.getSplitSources!.mock.calls.length, "Back and the table read again").toBe(
        rowsRead + 1,
      );
      expect(picker(el)).not.toBeNull();
      expect(splitButton(el)!.variant).toBe("primary");
    });
  });

  it("a failed first read draws no hint above its empty panel", async () => {
    const el = await mounted({ getSplitSources: vi.fn().mockRejectedValue(lost()) });
    await toPanel(el);

    expect(q(el, "[data-split-hint]")).toBeNull();
    expect((q(el, "[data-split-pick] wt-form-actions") as unknown as { error: string }).error).toBe(
      t("table.split_read_failed"),
    );
  });
});
