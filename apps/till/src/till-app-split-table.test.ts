import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { BillBalance, Draft, PartyBill, SplitSources, TabLine } from "./api/client.js";
import { codeMessage } from "./i18n/codes.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { formatMoney } from "@waitron/shared";
import { partyBill } from "./screens/till-table-order-screen.bill-switcher.test-helpers.js";
import type { TillApp } from "./till-app.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import type { TillSplitPicker } from "./widgets/split-picker.js";
import type { TillBillRefundDialog } from "./widgets/bill-refund-dialog.js";
import {
  api,
  emit,
  lock,
  mountApp,
  party,
  resetAllergyFixture,
  server,
  shell,
  floor,
  stubApi,
  table,
  table7,
  tableOrder,
  till,
} from "../test/allergy-app-fixture.js";

const locale = currentLocale();
beforeEach(() => {
  setLocale("en");
  resetAllergyFixture();
});
afterEach(async () => {
  vi.useRealTimers();
  cleanupWidgets();
  setLocale(locale);
  await page.viewport(1280, 768);
});

async function flush(el: TillApp, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

const shared = party({ tableIds: ["t4", "t5"], billCount: 2 });
const tables = [table("t4", "4", shared), table("t5", "5", shared), table7];
const bills = (revision = 0): PartyBill[] => [
  partyBill("wo-4", 1, "10.00", { revision }),
  partyBill("b2", 2, "20.00"),
];

function dish(id: string, lineNo: number): TabLine {
  return {
    id,
    lineNo,
    stationId: "bar",
    changesAfterSending: null,
    movable: true,
    name: id,
    productId: id,
    parentProductId: null,
    parentLineNo: null,
    quantity: "1.000",
    priceQuantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "10.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    groupId: null,
    note: null,
    listId: null,
    menuItemId: `offer-${id}`,
    portion: true,
  };
}

function balance(workingOrderId: string, total: string): BillBalance {
  return {
    workingOrderId,
    status: "open",
    total,
    received: "0.00",
    reserved: "0.00",
    outstanding: total,
    tips: "0.00",
    payments: [],
    paidLines: [],
  };
}

const answered = (): SplitSources => ({
  partyRevision: 3,
  bills: [
    { billId: "wo-4", lines: [dish("soup", 1)], balance: balance("wo-4", "10.00") },
    { billId: "b2", lines: [dish("steak", 1)], balance: balance("b2", "20.00") },
  ],
});

/** Each call waits for its own answer and, like a server already replying, ignores an abort. */
function heldReads() {
  const calls: {
    partyId: string;
    signal: AbortSignal | undefined;
    answer: (read: SplitSources) => void;
    fail: () => void;
  }[] = [];
  const read = vi.fn(
    (partyId: string, options: { signal?: AbortSignal } = {}) =>
      new Promise<SplitSources>((resolve, reject) =>
        calls.push({
          partyId,
          signal: options.signal,
          answer: resolve,
          fail: () => reject(new Error("read failed")),
        }),
      ),
  );
  return { calls, read };
}

function savedDraft(billId: string, ownerId: string, ownerName: string): Draft {
  return {
    id: `draft-${billId}`,
    partyId: "v1",
    billId,
    ownerId,
    ownerName,
    revision: 1,
    lines: [],
    takenOverFrom: null,
  };
}

const onPhone = {
  getTill: vi.fn().mockResolvedValue(till("phone-portrait")),
  getDeviceIdentity: vi.fn().mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait" }),
};

type Binding = "desktop" | "handheld";

async function mounted(binding: Binding, overrides: Record<string, unknown> = {}) {
  const { el } = await mountApp({
    getTablesState: vi.fn().mockResolvedValue(tables),
    getPartyBills: vi.fn().mockResolvedValue(bills()),
    getSplitSources: vi.fn().mockResolvedValue(answered()),
    ...(binding === "handheld" ? onPhone : {}),
    ...overrides,
  });
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
  await flush(el);
  if (binding === "handheld") {
    emit(shell(el), "open-table", { tableId: "t4", seated: true });
  } else {
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
  }
  await flush(el);
  const screen = tableOrder(el)!;
  expect(screen.hasAttribute("embedded")).toBe(binding === "handheld");
  return el;
}

const q = <T extends HTMLElement = HTMLElement>(el: TillApp, selector: string) =>
  tableOrder(el)!.shadowRoot!.querySelector<T>(selector);

async function press(el: TillApp, selector: string): Promise<void> {
  q(el, selector)!.click();
  await flush(el);
}

async function toPanel(el: TillApp): Promise<void> {
  await press(el, "[data-move-split]");
  await press(el, '[data-action="split-table"]');
  await press(el, '[data-target="t5"]');
}

async function backAndAgain(el: TillApp): Promise<void> {
  await press(el, "[data-action-back]");
  await press(el, '[data-target="t5"]');
}

const picker = (el: TillApp) => q<TillSplitPicker>(el, "till-split-picker");
const splitButton = (el: TillApp) =>
  q<HTMLElementTagNameMap["wt-button"]>(el, "[data-split-confirm]")!;
const bottom = (el: TillApp) =>
  q<HTMLElementTagNameMap["wt-form-actions"]>(el, "[data-split-pick] wt-form-actions")!;

function expectBlank(el: TillApp): void {
  expect(picker(el)).toBeNull();
  expect(splitButton(el).variant).toBe("secondary");
  expect(splitButton(el).disabled).toBe(true);
  expect(bottom(el).error).toBe("");
}

/** Its 15-second timer is what reads the bills, so a case using this starts on {@link fakeTimers}. */
async function rereadBills(el: TillApp, next: PartyBill[]): Promise<void> {
  api.getPartyBills!.mockResolvedValue(next);
  const reads = api.getPartyBills!.mock.calls.length;
  await vi.advanceTimersByTimeAsync(15_000);
  await flush(el, 6);
  expect(api.getPartyBills!.mock.calls.length).toBeGreaterThan(reads);
}

const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

describe("till-app: the read behind Split a table's panel", () => {
  it("reads every bill once for an opening and hands the answer to the screen", async () => {
    const read = answered();
    const el = await mounted("desktop", { getSplitSources: vi.fn().mockResolvedValue(read) });
    emit(tableOrder(el)!, "split-table-open", { tableId: "t5", prompt: {} });
    await flush(el);

    expect(api.getSplitSources).toHaveBeenCalledTimes(1);
    expect(api.getSplitSources!.mock.calls[0]![0]).toBe("v1");
    expect(tableOrder(el)!.splitRead).toBe(read);
  });

  it.each<Binding>(["desktop", "handheld"])(
    "hands the party's drafts to the %s screen, and a drafts read replaces them",
    async (binding) => {
      server.bills.add("b2");
      const first = savedDraft("b2", "p2", "Luis");
      server.drafts.push(first);
      const el = await mounted(binding);
      expect(tableOrder(el)!.partyDrafts.map((each) => each.id)).toEqual([first.id]);

      server.drafts.splice(0, 1, { ...savedDraft("b2", "p3", "Eva"), id: "draft-later" });
      window.dispatchEvent(new Event("focus"));
      await flush(el, 6);
      expect(tableOrder(el)!.partyDrafts.map((each) => each.id)).toEqual(["draft-later"]);
    },
  );

  it.each<Binding>(["desktop", "handheld"])(
    "knows the signed-in person on the %s screen, so their own saved draft is theirs",
    async (binding) => {
      server.bills.add("b2");
      server.drafts.push(savedDraft("b2", "p1", "Ana"));
      const el = await mounted(binding);
      await toPanel(el);

      expect(picker(el)).not.toBeNull();
      expect(tableOrder(el)!.personId).toBe("p1");
      const tick =
        picker(el)!.shadowRoot!.querySelector<HTMLInputElement>('[data-split-tick="b2"]')!;
      expect(tick.disabled).toBe(false);
      expect(picker(el)!.shadowRoot!.querySelector('[data-split-take-over="b2"]')).toBeNull();
      const bill2 = picker(el)!.sources.find((each) => each.bill.workingOrderId === "b2")!;
      expect(bill2.ownUnsent).toBe(true);
    },
  );

  it("reads again when a later bills read shows a changed revision, and not when it does not", async () => {
    fakeTimers();
    const el = await mounted("desktop");
    emit(tableOrder(el)!, "split-table-open", { tableId: "t5", prompt: {} });
    await flush(el);

    await rereadBills(el, bills());
    expect(api.getSplitSources).toHaveBeenCalledTimes(1);

    const later = answered();
    api.getSplitSources!.mockResolvedValue(later);
    await rereadBills(el, bills(1));
    expect(api.getSplitSources).toHaveBeenCalledTimes(2);
    expect(tableOrder(el)!.splitRead).toBe(later);
  });

  it.each<[string, Partial<PartyBill>]>([
    ["money received", { outstanding: "5.00", hasPayments: true }],
    ["only a changed outstanding", { outstanding: "5.00" }],
    ["only hasPayments changed", { hasPayments: true }],
    ["a changed status", { status: "settled" }],
  ])(
    "reads again when a bills read with the same revisions shows %s, and not on one more like it",
    async (_change, over) => {
      fakeTimers();
      const el = await mounted("desktop");
      emit(tableOrder(el)!, "split-table-open", { tableId: "t5", prompt: {} });
      await flush(el);

      const later = answered();
      api.getSplitSources!.mockResolvedValue(later);
      const changed = [partyBill("wo-4", 1, "10.00"), partyBill("b2", 2, "20.00", over)];
      await rereadBills(el, changed);
      expect(api.getSplitSources).toHaveBeenCalledTimes(2);
      expect(tableOrder(el)!.splitRead).toBe(later);

      await rereadBills(el, changed);
      expect(api.getSplitSources).toHaveBeenCalledTimes(2);
    },
  );

  it("does not read again after a changed revision until the bills change once more", async () => {
    fakeTimers();
    const el = await mounted("desktop");
    emit(tableOrder(el)!, "split-table-open", { tableId: "t5", prompt: {} });
    await flush(el);

    await rereadBills(el, bills(1));
    expect(api.getSplitSources).toHaveBeenCalledTimes(2);
    await rereadBills(el, bills(1));
    expect(api.getSplitSources).toHaveBeenCalledTimes(2);
    await rereadBills(el, bills(2));
    expect(api.getSplitSources).toHaveBeenCalledTimes(3);
  });

  it("does not read on a changed revision once the panel is left", async () => {
    fakeTimers();
    const el = await mounted("desktop");
    await toPanel(el);
    await press(el, "[data-action-back]");

    await rereadBills(el, bills(1));
    expect(api.getSplitSources).toHaveBeenCalledTimes(1);
  });

  it("drops an answer another read has overtaken", async () => {
    fakeTimers();
    const { calls, read } = heldReads();
    const el = await mounted("desktop", { getSplitSources: read });
    emit(tableOrder(el)!, "split-table-open", { tableId: "t5", prompt: {} });
    await flush(el);
    await rereadBills(el, bills(1));
    expect(calls).toHaveLength(2);
    expect(calls[0]!.signal!.aborted).toBe(true);

    const newer = answered();
    calls[1]!.answer(newer);
    await flush(el);
    calls[0]!.answer(answered());
    await flush(el);
    expect(tableOrder(el)!.splitRead).toBe(newer);
  });

  it("does not take an overtaken read's failure for the panel's own", async () => {
    fakeTimers();
    const { calls, read } = heldReads();
    const el = await mounted("desktop", { getSplitSources: read });
    emit(tableOrder(el)!, "split-table-open", { tableId: "t5", prompt: {} });
    await flush(el);
    await rereadBills(el, bills(1));

    calls[0]!.fail();
    await flush(el);
    expect(tableOrder(el)!.splitRead).toBeNull();
  });

  it("drops the answer when the app moves to another party", async () => {
    const { calls, read } = heldReads();
    const el = await mounted("desktop", { getSplitSources: read });
    emit(tableOrder(el)!, "split-table-open", { tableId: "t5", prompt: {} });
    await flush(el);

    emit(shell(el), "open-table", { tableId: "t7", seated: true });
    await flush(el, 6);
    expect(tableOrder(el)!.party?.id).toBe("v7");
    expect(calls[0]!.signal!.aborted).toBe(true);

    calls[0]!.answer(answered());
    await flush(el);
    expect(tableOrder(el)!.splitRead).toBeNull();
  });

  it("forgets the panel's answer when the app moves to another party", async () => {
    const el = await mounted("desktop");
    emit(tableOrder(el)!, "split-table-open", { tableId: "t5", prompt: {} });
    await flush(el);
    expect(tableOrder(el)!.splitRead).not.toBeNull();

    emit(shell(el), "open-table", { tableId: "t7", seated: true });
    await flush(el, 6);
    expect(tableOrder(el)!.party?.id).toBe("v7");
    expect(tableOrder(el)!.splitRead).toBeNull();
  });

  it("aborts the read when the waiter leaves the step, and drops its answer", async () => {
    const { calls, read } = heldReads();
    const el = await mounted("desktop", { getSplitSources: read });
    await toPanel(el);
    expect(calls[0]!.signal!.aborted).toBe(false);

    await press(el, "[data-action-back]");
    expect(calls[0]!.signal!.aborted).toBe(true);

    calls[0]!.answer(answered());
    await flush(el);
    expect(tableOrder(el)!.splitRead).toBeNull();
  });

  it("aborts the read when sign-out takes the screen away, and the next session gets no answer from it", async () => {
    const { calls, read } = heldReads();
    const el = await mounted("desktop", { getSplitSources: read });
    await toPanel(el);
    expect(calls[0]!.signal!.aborted).toBe(false);

    emit(shell(el), "logout");
    await flush(el);
    expect(tableOrder(el)).toBeNull();
    expect(calls[0]!.signal!.aborted).toBe(true);

    calls[0]!.answer(answered());
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flush(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(tableOrder(el)!.splitRead).toBeNull();
  });

  it("stops reading when another tab takes the screen away, also once back on the same table", async () => {
    fakeTimers();
    const { calls, read } = heldReads();
    const el = await mounted("desktop", { getSplitSources: read });
    await toPanel(el);
    const opened = tableOrder(el)!;

    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    expect(opened.isConnected).toBe(false);
    expect(calls[0]!.signal!.aborted).toBe(true);

    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(tableOrder(el)).not.toBe(opened);
    expect(q(el, "[data-split-pick]")).toBeNull();

    for (const revision of [1, 2, 3]) await rereadBills(el, bills(revision));
    expect(calls).toHaveLength(1);
  });

  it("tells the screen a first read failed, and the words are on the panel", async () => {
    const el = await mounted("desktop", {
      getSplitSources: vi.fn().mockRejectedValue(new Error("read failed")),
    });
    await toPanel(el);

    expect(tableOrder(el)!.splitRead).toBe("failed");
    expect(picker(el)).toBeNull();
    expect(bottom(el).error).toBe(t("table.split_read_failed"));
  });

  it("keeps the last answer when a later read fails", async () => {
    fakeTimers();
    const read = answered();
    const el = await mounted("desktop", { getSplitSources: vi.fn().mockResolvedValue(read) });
    await toPanel(el);
    expect(tableOrder(el)!.splitRead).toBe(read);

    api.getSplitSources!.mockRejectedValue(new Error("read failed"));
    await rereadBills(el, bills(1));
    expect(api.getSplitSources).toHaveBeenCalledTimes(2);
    expect(tableOrder(el)!.splitRead).toBe(read);
    expect(picker(el)).not.toBeNull();
    expect(bottom(el).error).toBe("");
  });

  it("says a new opening's read failed even after an earlier opening had an answer", async () => {
    const el = await mounted("desktop");
    await toPanel(el);
    expect(picker(el)).not.toBeNull();

    api.getSplitSources!.mockRejectedValue(new Error("read failed"));
    await backAndAgain(el);
    expect(api.getSplitSources).toHaveBeenCalledTimes(2);
    expect(tableOrder(el)!.splitRead).toBe("failed");
    expect(picker(el)).toBeNull();
    expect(bottom(el).error).toBe(t("table.split_read_failed"));
  });

  it("reads again on Back and the same table, and that answer replaces the failure", async () => {
    const el = await mounted("desktop", {
      getSplitSources: vi.fn().mockRejectedValue(new Error("read failed")),
    });
    await toPanel(el);
    expect(tableOrder(el)!.splitRead).toBe("failed");

    const read = answered();
    api.getSplitSources!.mockResolvedValue(read);
    await backAndAgain(el);
    expect(api.getSplitSources).toHaveBeenCalledTimes(2);
    expect(tableOrder(el)!.splitRead).toBe(read);
    expect(picker(el)).not.toBeNull();
    expect(bottom(el).error).toBe("");
  });

  it.each([
    ["answered", (call: ReturnType<typeof heldReads>["calls"][number]) => call.answer(answered())],
    ["failed", (call: ReturnType<typeof heldReads>["calls"][number]) => call.fail()],
  ] as const)(
    "starts a second opening blank after a read that %s, until its own answer draws the rows",
    async (_outcome, finish) => {
      const { calls, read } = heldReads();
      const el = await mounted("desktop", { getSplitSources: read });
      await toPanel(el);
      finish(calls[0]!);
      await flush(el);

      await press(el, "[data-action-back]");
      q(el, '[data-target="t5"]')!.click();
      // Before and after the app's own update: neither may draw the earlier answer.
      await tableOrder(el)!.updateComplete;
      expect(picker(el)).toBeNull();
      await flush(el);
      expect(calls).toHaveLength(2);
      expect(tableOrder(el)!.splitRead).toBeNull();
      expectBlank(el);

      calls[1]!.answer(answered());
      await flush(el);
      expect(picker(el)!.sources.map((each) => each.bill.workingOrderId)).toEqual(["wo-4", "b2"]);
      expect(splitButton(el).variant).toBe("primary");
      expect(splitButton(el).disabled).toBe(false);
    },
  );

  describe("a party with no bill", () => {
    const noBill = party({ tableIds: ["t4", "t5"], billCount: 0, openingBillId: null });
    const noBillRead = {
      getTablesState: vi
        .fn()
        .mockResolvedValue([table("t4", "4", noBill), table("t5", "5", noBill), table7]),
      getPartyBills: vi.fn().mockResolvedValue([]),
      getSplitSources: vi.fn().mockResolvedValue({ partyRevision: 3, bills: [] }),
    };
    const text = (el: TillApp, selector: string) =>
      q(el, selector)!.textContent!.replace(/\s+/g, " ").trim();

    function expectEmptyPanel(el: TillApp): void {
      expect(picker(el)).not.toBeNull();
      expect(picker(el)!.sources).toEqual([]);
      expect(splitButton(el).variant).toBe("primary");
      expect(splitButton(el).disabled).toBe(false);
      expect(bottom(el).error).toBe("");
      expect(text(el, "[data-split-takes]")).toBe("5 takes an empty bill · €0.00");
      expect(text(el, "[data-split-keeps]")).toBe("4 is left with nothing to pay");
    }

    it.each<Binding>(["desktop", "handheld"])(
      "on the %s screen draws the panel with no bills, Split primary, for the signed-in person",
      async (binding) => {
        const el = await mounted(binding, noBillRead);
        expect(tableOrder(el)!.orderId).toBeUndefined();
        await toPanel(el);

        expect(tableOrder(el)!.personId).toBe("p1");
        expectEmptyPanel(el);
      },
    );

    it("draws the same panel when the bills read turns empty while its table is on screen", async () => {
      fakeTimers();
      const el = await mounted("desktop", { getSplitSources: noBillRead.getSplitSources });
      await rereadBills(el, []);
      expect(tableOrder(el)!.orderId).toBeUndefined();
      await toPanel(el);

      expect(tableOrder(el)!.personId).toBe("p1");
      expectEmptyPanel(el);
    });

    it("is the next person's once someone else has signed out and they have signed in", async () => {
      const el = await mounted("desktop", noBillRead);
      emit(shell(el), "logout");
      await flush(el);
      expect(tableOrder(el)).toBeNull();

      emit(lock(el), "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
      await flush(el);
      emit(shell(el), "screen-select", { screen: "floor" });
      await flush(el);
      emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
      await flush(el);
      expect(tableOrder(el)!.personId).toBe("p2");
    });

    describe("gaining its first bill while the panel is open", () => {
      const noBillApi = () => ({
        getTablesState: vi
          .fn()
          .mockResolvedValue([table("t4", "4", noBill), table("t5", "5", noBill), table7]),
        getPartyBills: vi.fn().mockResolvedValue([]),
        getSplitSources: vi.fn().mockResolvedValue({ partyRevision: 3, bills: [] }),
      });
      const firstBill = () => [partyBill("b9", 1, "20.00")];
      const firstBillRead = (): SplitSources => ({
        partyRevision: 3,
        bills: [{ billId: "b9", lines: [dish("steak", 1)], balance: balance("b9", "20.00") }],
      });
      const tick = (el: TillApp, billId: string) =>
        picker(el)!.shadowRoot!.querySelector<HTMLInputElement>(`[data-split-tick="${billId}"]`);
      const takeOver = (el: TillApp, billId: string) =>
        picker(el)!.shadowRoot!.querySelector(`[data-split-take-over="${billId}"]`);
      /** What another till starting a bill leaves: the bill and Luis's saved draft on it. */
      function anotherTillStartsTheBill(): void {
        server.bills.add("b9");
        server.drafts.push(savedDraft("b9", "p2", "Luis"));
        api.getPartyBills!.mockResolvedValue(firstBill());
        api.getSplitSources!.mockResolvedValue(firstBillRead());
      }
      function expectHeldByLuis(el: TillApp): void {
        expect(tableOrder(el)!.orderId).toBe("b9");
        expect(tableOrder(el)!.partyDrafts.map((each) => each.ownerName)).toEqual(["Luis"]);
        expect(q(el, "[data-split-pick]")).not.toBeNull();
        expect(tick(el, "b9")!.disabled).toBe(true);
        expect(takeOver(el, "b9")).not.toBeNull();
      }

      describe("what a read behind the panel leaves", () => {
        const lost = () => new TypeError("Failed to fetch");
        const heading = (el: TillApp) => q(el, "[data-split-pick] h2")!.textContent ?? "";

        it("Split stays primary while the first bill's reads are out, and a press goes to the server", async () => {
          fakeTimers();
          const el = await mounted("desktop", {
            ...noBillApi(),
            splitTable: vi.fn().mockResolvedValue({ partyId: "v-split", billIds: [] }),
          });
          await toPanel(el);
          const reading = server.listDrafts("v1");
          anotherTillStartsTheBill();
          server.drafts.length = 0;
          api.listDrafts!.mockImplementationOnce(() => reading.then(() => new Promise(() => {})));

          await rereadBills(el, firstBill());
          expect(tableOrder(el)!.orderId).toBe("b9");
          expect(q(el, "[data-split-pick]")).not.toBeNull();
          expect(splitButton(el).variant).toBe("primary");
          expect(splitButton(el).disabled).toBe(false);

          await press(el, "[data-split-confirm]");
          await flush(el, 6);
          expect(api.splitTable).toHaveBeenCalledOnce();
        });

        it("on a handheld, Split stays primary while the first bill's reads are out", async () => {
          fakeTimers();
          const el = await mounted("handheld", {
            ...noBillApi(),
            splitTable: vi.fn().mockResolvedValue({ partyId: "v-split", billIds: [] }),
          });
          await toPanel(el);
          const reading = server.listDrafts("v1");
          anotherTillStartsTheBill();
          server.drafts.length = 0;
          api.listDrafts!.mockImplementationOnce(() => reading.then(() => new Promise(() => {})));

          await rereadBills(el, firstBill());
          expect(q(el, "[data-split-pick]")).not.toBeNull();
          expect(splitButton(el).variant).toBe("primary");
          expect(splitButton(el).disabled).toBe(false);
        });

        it("a panel opened again while that read is out can be pressed once its rows are drawn", async () => {
          fakeTimers();
          const el = await mounted("desktop", {
            ...noBillApi(),
            splitTable: vi.fn().mockResolvedValue({ partyId: "v-split", billIds: [] }),
          });
          await toPanel(el);
          anotherTillStartsTheBill();
          server.drafts.length = 0;
          api.getTabLines!.mockImplementationOnce(() => new Promise(() => {}));
          await rereadBills(el, firstBill());

          await backAndAgain(el);
          await flush(el, 6);

          expect(splitButton(el).variant).toBe("primary");
          expect(splitButton(el).disabled).toBe(false);
          await press(el, "[data-split-confirm]");
          await flush(el, 6);
          expect(api.splitTable).toHaveBeenCalledOnce();
        });

        it("a floor read failing during the reload keeps the table names", async () => {
          fakeTimers();
          const el = await mounted("desktop", noBillApi());
          await toPanel(el);
          const before = heading(el);
          anotherTillStartsTheBill();
          api.getTablesState!.mockRejectedValueOnce(lost());

          await rereadBills(el, firstBill());

          expect(before).toContain("5");
          expect(heading(el)).toBe(before);
        });

        it("a drafts read failing during the reload puts up no banner, and the next timed read recovers", async () => {
          fakeTimers();
          const el = await mounted("desktop", noBillApi());
          await toPanel(el);
          anotherTillStartsTheBill();
          api.listDrafts!.mockRejectedValueOnce(lost());

          await rereadBills(el, firstBill());
          expect(el.shadowRoot!.querySelector(".error")).toBeNull();

          await rereadBills(el, firstBill());
          expect(el.shadowRoot!.querySelector(".error")).toBeNull();
          expectHeldByLuis(el);
        });

        it("the read the first bill started is still out when the floor's revision lands: another starts, Split stays pressable, and the press carries the rows", async () => {
          fakeTimers();
          const el = await mounted("desktop", {
            ...noBillApi(),
            splitTable: vi.fn().mockResolvedValue({ partyId: "v-split", billIds: [] }),
          });
          await toPanel(el);
          anotherTillStartsTheBill();
          server.drafts.length = 0;
          const later = party({ revision: 9, tableIds: ["t4", "t5"], billCount: 1 });
          api.getTablesState!.mockResolvedValue([
            table("t4", "4", later),
            table("t5", "5", later),
            table7,
          ]);
          const held = heldReads();
          api.getSplitSources!.mockImplementation(held.read);

          await rereadBills(el, firstBill());

          expect(tableOrder(el)!.party?.revision).toBe(9);
          expect(held.calls).toHaveLength(2);
          expect(splitButton(el).disabled).toBe(false);

          held.calls[1]!.answer({ ...firstBillRead(), partyRevision: 9 });
          await flush(el, 6);
          await press(el, "[data-split-confirm]");
          await flush(el, 6);

          expect(api.splitTable!.mock.calls[0]![3]).toBe(9);
        });

        it("the bills read failing leaves the rows and their revision as they were", async () => {
          fakeTimers();
          const el = await mounted("desktop", {
            ...noBillApi(),
            splitTable: vi.fn().mockResolvedValue({ partyId: "v-split", billIds: [] }),
          });
          await toPanel(el);
          const later = party({ revision: 9, tableIds: ["t4", "t5"], billCount: 1 });
          api.getTablesState!.mockResolvedValue([
            table("t4", "4", later),
            table("t5", "5", later),
            table7,
          ]);
          api.getPartyBills!.mockResolvedValueOnce(firstBill()).mockRejectedValueOnce(lost());
          await vi.advanceTimersByTimeAsync(15_000);
          await flush(el, 6);
          expect(tableOrder(el)!.party?.revision).toBe(9);

          await press(el, "[data-split-confirm]");
          await flush(el, 6);

          expect(api.splitTable).toHaveBeenCalledOnce();
          expect(api.splitTable!.mock.calls[0]![3]).toBe(noBill.revision);
        });

        describe("the panel closing during the reload, on the same party", () => {
          const reads = () => ({
            partyRevision: 3,
            bills: api.getPartyBills!.mock.calls.length,
            drafts: api.listDrafts!.mock.calls.length,
          });

          it("the floor leaving the party on one table: the panel closes, the bill shows and the reads go on", async () => {
            fakeTimers();
            const el = await mounted("desktop", noBillApi());
            await toPanel(el);
            anotherTillStartsTheBill();
            const alone = party({ tableIds: ["t4"], billCount: 1, openingBillId: "b9" });
            api.getTablesState!.mockResolvedValue([
              table("t4", "4", alone),
              table("t5", "5", null),
              table7,
            ]);

            await rereadBills(el, firstBill());

            expect(q(el, "[data-split-pick]")).toBeNull();
            expect(tableOrder(el)!.party?.id).toBe("v1");
            expect(tableOrder(el)!.orderId).toBe("b9");
            const before = reads();
            await rereadBills(el, firstBill());
            expect(reads().bills).toBeGreaterThan(before.bills);
            expect(reads().drafts).toBeGreaterThan(before.drafts);
          });

          it("Back while the floor read is out: the bill still shows and the reads go on", async () => {
            fakeTimers();
            const el = await mounted("desktop", noBillApi());
            await toPanel(el);
            anotherTillStartsTheBill();
            const later = party({ tableIds: ["t4", "t5"], billCount: 1, openingBillId: "b9" });
            let answerFloor = () => {};
            api.getTablesState!.mockImplementationOnce(
              () =>
                new Promise((resolve) => {
                  answerFloor = () =>
                    resolve([table("t4", "4", later), table("t5", "5", later), table7]);
                }),
            );
            await rereadBills(el, firstBill());
            await press(el, "[data-action-back]");
            expect(q(el, "[data-split-pick]")).toBeNull();

            answerFloor();
            await flush(el, 6);

            expect(tableOrder(el)!.orderId).toBe("b9");
            const before = reads();
            await rereadBills(el, firstBill());
            expect(reads().drafts).toBeGreaterThan(before.drafts);
          });
        });

        describe("leaving the table during the reload", () => {
          const reopen = async (el: TillApp) => {
            emit(tableOrder(el)!, "back-to-floor");
            await flush(el);
            emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
            await flush(el, 6);
          };

          it("while the floor read is out: the bills are not read for the table left", async () => {
            fakeTimers();
            const el = await mounted("desktop", noBillApi());
            await toPanel(el);
            anotherTillStartsTheBill();
            let answerFloor = () => {};
            api.getTablesState!.mockImplementationOnce(
              () =>
                new Promise((resolve) => {
                  answerFloor = () =>
                    resolve([table("t4", "4", noBill), table("t5", "5", noBill), table7]);
                }),
            );
            await rereadBills(el, firstBill());
            emit(tableOrder(el)!, "back-to-floor");
            await flush(el);
            const bills = api.getPartyBills!.mock.calls.length;

            answerFloor();
            await flush(el, 6);

            expect(tableOrder(el)).toBeNull();
            expect(api.getPartyBills!.mock.calls.length).toBe(bills);
          });

          it("while the bills read is out, and back to a new panel: its answer leaves that panel's revision alone", async () => {
            fakeTimers();
            const el = await mounted("desktop", {
              ...noBillApi(),
              setPartyName: vi.fn().mockResolvedValue({ revision: 9 }),
              splitTable: vi.fn().mockResolvedValue({ partyId: "v-split", billIds: [] }),
            });
            await toPanel(el);
            anotherTillStartsTheBill();
            let answerBills = () => {};
            api.getPartyBills!.mockResolvedValueOnce(firstBill()).mockImplementationOnce(
              () =>
                new Promise((resolve) => {
                  answerBills = () => resolve(firstBill());
                }),
            );
            await vi.advanceTimersByTimeAsync(15_000);
            await flush(el, 6);

            await reopen(el);
            await toPanel(el);
            const opened = tableOrder(el)!.party!.revision;
            const later = party({
              revision: 9,
              tableIds: ["t4", "t5"],
              billCount: 1,
              openingBillId: "b9",
            });
            api.getTablesState!.mockResolvedValue([
              table("t4", "4", later),
              table("t5", "5", later),
              table7,
            ]);
            emit(tableOrder(el)!, "name-party", { name: "Ana" });
            await flush(el, 6);
            expect(tableOrder(el)!.party?.revision).toBe(9);

            answerBills();
            await flush(el, 6);
            await press(el, "[data-split-confirm]");
            await flush(el, 6);

            expect(api.splitTable).toHaveBeenCalledOnce();
            expect(api.splitTable!.mock.calls[0]![3]).toBe(opened);
          });
        });

        it("the floor giving this table to another party opens that party's bill", async () => {
          fakeTimers();
          const el = await mounted("desktop", noBillApi());
          await toPanel(el);
          const other = party({ id: "v9", tableIds: ["t4"], billCount: 1, openingBillId: "b7" });
          anotherTillStartsTheBill();
          server.bills.add("b7");
          api.getTablesState!.mockResolvedValue([
            table("t4", "4", other),
            table("t5", "5", noBill),
            table7,
          ]);
          const b7 = partyBill("b7", 1, "30.00");
          api.getPartyBills!.mockResolvedValueOnce(firstBill()).mockResolvedValue([b7]);

          await vi.advanceTimersByTimeAsync(15_000);
          await flush(el, 8);

          expect(tableOrder(el)!.party?.id).toBe("v9");
          expect(q(el, "[data-split-pick]")).toBeNull();
          expect(tableOrder(el)!.orderId).toBe("b7");
        });
      });

      it("keeps the bills read going every 15 seconds, and stops once the panel is left", async () => {
        fakeTimers();
        const el = await mounted("desktop", noBillApi());
        await vi.advanceTimersByTimeAsync(15_000);
        const reads = api.getPartyBills!.mock.calls.length;
        await vi.advanceTimersByTimeAsync(15_000);
        expect(api.getPartyBills!.mock.calls.length).toBe(reads);

        await toPanel(el);
        await rereadBills(el, []);
        await rereadBills(el, []);

        await press(el, "[data-action-back]");
        const left = api.getPartyBills!.mock.calls.length;
        await vi.advanceTimersByTimeAsync(45_000);
        expect(api.getPartyBills!.mock.calls.length).toBe(left);
      });

      it("a timer's read finding the bill makes the sync, so its draft holds the tick", async () => {
        fakeTimers();
        const el = await mounted("desktop", noBillApi());
        await toPanel(el);
        expect(tableOrder(el)!.orderId).toBeUndefined();

        anotherTillStartsTheBill();
        await rereadBills(el, firstBill());

        expectHeldByLuis(el);
      });

      it("reads the floor too, so the party's revision is the one that bill made", async () => {
        fakeTimers();
        const el = await mounted("desktop", noBillApi());
        await toPanel(el);

        const later = party({ revision: 9, tableIds: ["t4", "t5"], billCount: 1 });
        api.getTablesState!.mockResolvedValue([
          table("t4", "4", later),
          table("t5", "5", later),
          table7,
        ]);
        anotherTillStartsTheBill();
        await rereadBills(el, firstBill());

        expect(tableOrder(el)!.party?.revision).toBe(9);
      });

      it("a bills list already holding the bill, from this till's own write, makes the sync when the panel's answer comes", async () => {
        const el = await mounted("desktop", {
          ...noBillApi(),
          setPartyName: vi.fn().mockResolvedValue({ revision: 4 }),
        });
        anotherTillStartsTheBill();
        emit(tableOrder(el)!, "name-party", { name: "Ana" });
        await flush(el, 6);
        expect(tableOrder(el)!.bills.map((bill) => bill.workingOrderId)).toEqual(["b9"]);
        expect(tableOrder(el)!.orderId).toBeUndefined();

        await toPanel(el);
        await flush(el, 6);

        expectHeldByLuis(el);
      });

      it("Back and the same table, whose answer lists a bill the app lacks, draws it", async () => {
        const el = await mounted("desktop", noBillApi());
        await toPanel(el);
        expect(picker(el)!.sources).toEqual([]);

        anotherTillStartsTheBill();
        await backAndAgain(el);
        await flush(el, 6);

        expectHeldByLuis(el);
        expect(picker(el)!.sources.map((each) => each.bill.workingOrderId)).toEqual(["b9"]);
        expect(text(el, "[data-split-keeps]")).toBe("4 keeps Bill 1 · €20.00");
      });

      it("a bill nobody is working on is ticked as any other", async () => {
        const el = await mounted("desktop", noBillApi());
        await toPanel(el);

        server.bills.add("b9");
        api.getPartyBills!.mockResolvedValue(firstBill());
        api.getSplitSources!.mockResolvedValue(firstBillRead());
        await backAndAgain(el);
        await flush(el, 6);

        expect(tableOrder(el)!.orderId).toBe("b9");
        expect(tick(el, "b9")!.disabled).toBe(false);
        expect(takeOver(el, "b9")).toBeNull();
        expect(tableOrder(el)!.billGone).toBeNull();
      });

      it("a reload whose bills read fails keeps what it had, and the next timer's read makes the sync", async () => {
        fakeTimers();
        const el = await mounted("desktop", noBillApi());
        await toPanel(el);

        anotherTillStartsTheBill();
        api
          .getPartyBills!.mockResolvedValueOnce(firstBill())
          .mockRejectedValueOnce(new Error("read failed"));
        const reads = api.getPartyBills!.mock.calls.length;
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el, 6);
        expect(api.getPartyBills!.mock.calls.length).toBe(reads + 2);
        expect(tableOrder(el)!.orderId).toBeUndefined();
        expect(tableOrder(el)!.bills.map((bill) => bill.workingOrderId)).toEqual(["b9"]);

        await rereadBills(el, firstBill());
        expectHeldByLuis(el);
      });

      it("a party whose only bill leaves closes the panel, and with it the read", async () => {
        fakeTimers();
        const el = await mounted("desktop", {
          getPartyBills: vi.fn().mockResolvedValue([partyBill("wo-4", 1, "10.00")]),
        });
        await toPanel(el);

        await rereadBills(el, []);
        expect(tableOrder(el)!.orderId).toBeUndefined();
        expect(q(el, "[data-split-pick]")).toBeNull();

        const left = api.getPartyBills!.mock.calls.length;
        await vi.advanceTimersByTimeAsync(45_000);
        expect(api.getPartyBills!.mock.calls.length).toBe(left);
      });
    });
  });

  it("an answer listing a bill the app lacks reads the bills at once, and a party with a sync keeps its bill on screen", async () => {
    const el = await mounted("desktop");
    await toPanel(el);

    server.bills.add("b7");
    const withB7 = [...bills(), partyBill("b7", 3, "30.00")];
    api.getPartyBills!.mockResolvedValue(withB7);
    api.getSplitSources!.mockResolvedValue({
      partyRevision: 3,
      bills: [
        ...answered().bills,
        { billId: "b7", lines: [dish("wine", 1)], balance: balance("b7", "30.00") },
      ],
    });
    await backAndAgain(el);
    await flush(el, 6);

    expect(picker(el)!.sources.map((each) => each.bill.workingOrderId)).toContain("b7");
    expect(tableOrder(el)!.orderId).toBe("wo-4");
    expect(tableOrder(el)!.billGone).toBeNull();
  });

  describe("an answer left behind", () => {
    const leave: [string, (el: TillApp) => Promise<void>][] = [
      [
        "Back",
        async (el) => {
          await press(el, "[data-action-back]");
          emit(shell(el), "open-table", { tableId: "t7", seated: true });
        },
      ],
      [
        "Floor",
        async (el) => {
          emit(shell(el), "screen-select", { screen: "floor" });
          await flush(el);
          emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
        },
      ],
      [
        "sign-out",
        async (el) => {
          emit(shell(el), "logout");
          await flush(el);
          emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
          await flush(el);
          emit(shell(el), "screen-select", { screen: "floor" });
          await flush(el);
          emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
        },
      ],
    ];

    it.each(leave)("does not reach another party's screen after %s", async (_route, go) => {
      const el = await mounted("desktop");
      await toPanel(el);
      expect(tableOrder(el)!.splitRead).not.toBeNull();

      await go(el);
      await flush(el, 6);

      expect(tableOrder(el)!.party?.id).toBe("v7");
      expect(tableOrder(el)!.splitRead).toBeNull();
    });

    it("stays while the app is still on that party, for a refusal's reopen", async () => {
      const read = answered();
      const el = await mounted("desktop", { getSplitSources: vi.fn().mockResolvedValue(read) });
      await toPanel(el);

      await press(el, "[data-action-back]");

      expect(tableOrder(el)!.party?.id).toBe("v1");
      expect(tableOrder(el)!.splitRead).toBe(read);
    });
  });
});

describe("till-app: Split a table sends the selection and follows it", () => {
  const guests = { staying: 3, leaving: 2 };
  const noEdit = (billId: string) => ({
    billId,
    editorVersion: 0,
    draftId: null,
    draftRevision: null,
  });
  const threeBills = () => [
    partyBill("wo-4", 1, "10.00"),
    partyBill("b2", 2, "20.00"),
    partyBill("b3", 3, "30.00"),
  ];
  const after = (...next: PartyBill[]) => {
    const staying = party({ revision: 4, tableIds: ["t4"], billCount: next.length });
    return {
      tables: [
        table("t4", "4", staying),
        table("t5", "5", party({ id: "v-split", revision: 0, tableIds: ["t5"] })),
        table7,
      ],
      bills: next,
    };
  };

  async function sending(
    state: { tables: unknown[]; bills: PartyBill[] },
    over: Record<string, unknown> = {},
  ) {
    server.bills.add("b2");
    server.bills.add("b3");
    const el = await mounted("desktop", {
      getPartyBills: vi.fn().mockResolvedValue(threeBills()),
      splitTable: vi.fn(async () => {
        api.getTablesState!.mockResolvedValue(state.tables);
        api.getPartyBills!.mockResolvedValue(state.bills);
        return { partyId: "v-split", billIds: ["b9"] };
      }),
      ...over,
    });
    return el;
  }

  const split = (
    el: TillApp,
    selection: {
      wholeBillIds: string[];
      loose: { billId: string; lineIds: string[] }[];
    },
    tableId = "t5",
  ) => emit(tableOrder(el)!, "split-table", { tableId, selection, guestCounts: guests });
  const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
  const question = (el: TillApp) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-confirm-different-people]");

  describe("send", () => {
    it("sends the whole bills' and loose sources' states, sorted, the shown party's revision, and what was dispatched", async () => {
      const el = await sending(after(...threeBills()));
      const selection = { wholeBillIds: ["b3"], loose: [{ billId: "b2", lineIds: ["steak"] }] };

      split(el, selection);
      await flush(el, 6);

      expect(api.splitTable).toHaveBeenCalledTimes(1);
      expect(api.splitTable).toHaveBeenCalledWith(
        "v1",
        "t5",
        selection,
        3,
        [noEdit("b2"), noEdit("b3")],
        guests,
      );
    });

    it("sends the bill on screen's state only when the bill on screen is picked from", async () => {
      const el = await sending(after(...threeBills()));
      const selection = { wholeBillIds: ["b2"], loose: [{ billId: "wo-4", lineIds: ["soup"] }] };

      split(el, selection);
      await flush(el, 6);

      expect(api.splitTable).toHaveBeenCalledWith(
        "v1",
        "t5",
        selection,
        3,
        [noEdit("b2"), noEdit("wo-4")],
        guests,
      );
    });

    it("holds off the background bills read while it is out, so nothing says the bill left this table", async () => {
      fakeTimers();
      let answer!: (value: { partyId: string; billIds: string[] }) => void;
      const el = await sending(after(partyBill("b2", 2, "20.00")), {
        splitTable: vi.fn(() => new Promise((resolve) => (answer = resolve))),
      });
      api.getPartyBills!.mockResolvedValue([partyBill("b2", 2, "20.00")]);
      const reads = api.getPartyBills!.mock.calls.length;

      split(el, { wholeBillIds: ["wo-4"], loose: [] });
      await flush(el);
      await vi.advanceTimersByTimeAsync(15_000);
      await flush(el, 6);

      expect(api.getPartyBills!.mock.calls.length).toBe(reads);
      expect(tableOrder(el)!.orderId).toBe("wo-4");
      expect(tableOrder(el)!.billGone).toBeNull();

      answer({ partyId: "v-split", billIds: ["wo-4"] });
      await flush(el, 6);
      expect(tableOrder(el)!.orderId).toBe("b2");
      expect(tableOrder(el)!.billGone).toBeNull();
    });
  });

  describe("send, past the different-people question", () => {
    const limited = {
      getTill: vi.fn().mockResolvedValue({ ...till("till"), simplifiedInvoiceLimit: "15.00" }),
    };
    const fromBill2 = { wholeBillIds: [], loose: [{ billId: "b2", lineIds: ["steak"] }] };
    const confirm = (el: TillApp) =>
      question(el)!.querySelector<HTMLElement>("[data-confirm]")!.click();
    /** Whatever the server says, this bill's edit state moved once `newer` is set. */
    function draftsMoving(billId: string) {
      const moved = { newer: false };
      const listDrafts = vi.fn(async (...args: Parameters<typeof server.listDrafts>) => {
        const snapshot = await server.listDrafts(...args);
        if (!moved.newer) return snapshot;
        return {
          ...snapshot,
          billEdits: snapshot.billEdits.map((edit) =>
            edit.billId === billId ? { ...edit, editorVersion: 8 } : edit,
          ),
        };
      });
      return { moved, listDrafts };
    }
    async function refreshDrafts(el: TillApp): Promise<void> {
      const reads = api.listDrafts!.mock.calls.length;
      window.dispatchEvent(new Event("focus"));
      await expect.poll(() => api.listDrafts!.mock.calls.length).toBeGreaterThan(reads);
      await flush(el, 6);
    }

    it("holds off the background bills read while a confirmed send is out", async () => {
      fakeTimers();
      let answer!: (value: { partyId: string; billIds: string[] }) => void;
      const el = await sending(after(...threeBills()), {
        ...limited,
        splitTable: vi.fn(() => new Promise((resolve) => (answer = resolve))),
      });

      split(el, fromBill2);
      await flush(el, 6);
      confirm(el);
      await flush(el, 6);
      expect(api.splitTable).toHaveBeenCalledTimes(1);
      const reads = api.getPartyBills!.mock.calls.length;

      await vi.advanceTimersByTimeAsync(15_000);
      await flush(el, 6);
      expect(api.getPartyBills!.mock.calls.length).toBe(reads);

      answer({ partyId: "v-split", billIds: [] });
      await flush(el, 6);
    });

    it("sends what the waiter saw: an edit moved while the question is open stops it", async () => {
      const { moved, listDrafts } = draftsMoving("b2");
      const el = await sending(after(...threeBills()), { ...limited, listDrafts });

      split(el, fromBill2);
      await flush(el, 6);
      expect(question(el)).not.toBeNull();

      moved.newer = true;
      await refreshDrafts(el);
      confirm(el);
      await flush(el, 6);

      expect(api.splitTable).not.toHaveBeenCalled();
      expect(banner(el)!.textContent).toContain(codeMessage("draft.out_of_date"));
    });

    it("an edit moved while the question reads a bill's balance stops it", async () => {
      let balanceRead!: (value: BillBalance) => void;
      const { moved, listDrafts } = draftsMoving("b9");
      server.bills.add("b9");
      const el = await sending(after(...threeBills()), {
        ...limited,
        listDrafts,
        getBillBalance: vi.fn(() => new Promise((resolve) => (balanceRead = resolve))),
      });
      await flush(el, 6);

      split(el, { wholeBillIds: [], loose: [{ billId: "b9", lineIds: ["wine"] }] });
      await flush(el, 6);
      moved.newer = true;
      await refreshDrafts(el);
      balanceRead(balance("b9", "5.00"));
      await flush(el, 6);

      expect(question(el)).toBeNull();
      expect(api.splitTable).not.toHaveBeenCalled();
      expect(banner(el)!.textContent).toContain(codeMessage("draft.out_of_date"));
    });
  });

  describe("follow", () => {
    it("stays with the staying party at its other table when the table on screen leaves", async () => {
      const staying = party({ revision: 4, tableIds: ["t5"] });
      const el = await sending({
        tables: [
          table("t4", "4", party({ id: "v-split", revision: 0, tableIds: ["t4"] })),
          table("t5", "5", staying),
          table7,
        ],
        bills: threeBills(),
      });

      split(el, { wholeBillIds: ["b2"], loose: [] }, "t4");
      await flush(el, 6);

      expect(tableOrder(el)!.party?.id).toBe("v1");
      expect(tableOrder(el)!.party?.revision).toBe(4);
      expect(tableOrder(el)!.party?.tableIds).toEqual(["t5"]);
      expect(banner(el)).toBeNull();
    });

    it("shows the lowest-numbered bill still owing when the bill on screen left whole, with no notice", async () => {
      const el = await sending(
        after(partyBill("b3", 3, "30.00"), partyBill("b2", 2, "20.00", { status: "settled" })),
      );

      split(el, { wholeBillIds: ["wo-4"], loose: [] });
      await flush(el, 6);

      expect(tableOrder(el)!.orderId).toBe("b3");
      expect(tableOrder(el)!.billGone).toBeNull();
      expect(api.getTabLines).toHaveBeenLastCalledWith("b3");
    });

    it("keeps the bill on screen and reads its lines again when dishes left it and it still owes", async () => {
      const el = await sending(after(...threeBills()));
      const lineReads = api.getTabLines!.mock.calls.length;

      split(el, { wholeBillIds: [], loose: [{ billId: "wo-4", lineIds: ["soup"] }] });
      await flush(el, 6);

      expect(tableOrder(el)!.orderId).toBe("wo-4");
      expect(api.getTabLines!.mock.calls.length).toBeGreaterThan(lineReads);
      expect(api.getTabLines).toHaveBeenLastCalledWith("wo-4");
      expect(tableOrder(el)!.billGone).toBeNull();
    });

    it("keeps the bill on screen when dishes left it and the bills read after fails", async () => {
      const el = await sending(after(...threeBills()));
      emit(tableOrder(el)!, "switch-bill", { workingOrderId: "b2" });
      await flush(el, 6);
      expect(tableOrder(el)!.orderId).toBe("b2");
      api.splitTable!.mockImplementation(async () => {
        api.getTablesState!.mockResolvedValue(after().tables);
        api.getPartyBills!.mockRejectedValue(new Error("read failed"));
        return { partyId: "v-split", billIds: ["b9"] };
      });

      split(el, { wholeBillIds: [], loose: [{ billId: "b2", lineIds: ["steak"] }] });
      await flush(el, 6);

      expect(api.splitTable).toHaveBeenCalledTimes(1);
      expect(tableOrder(el)!.orderId).toBe("b2");
    });

    it("shows a bill the failed read could not name when two whole bills left, the one on screen among them", async () => {
      const el = await sending(after(partyBill("b3", 3, "30.00")));
      api.splitTable!.mockImplementation(async () => {
        api.getTablesState!.mockResolvedValue(after().tables);
        api.getPartyBills!.mockRejectedValue(new Error("read failed"));
        return { partyId: "v-split", billIds: ["wo-4", "b2"] };
      });

      split(el, { wholeBillIds: ["wo-4", "b2"], loose: [] });
      await flush(el, 6);

      expect(api.splitTable).toHaveBeenCalledTimes(1);
      expect(tableOrder(el)!.orderId).toBe("b3");
    });

    /** `GET lines` refuses a settled bill, which `#loadTabLines` turns into an empty list. */
    function linesOfOpenBills() {
      return vi.fn(async (billId: string) => {
        if (billId === "wo-4") throw new Error("bill is settled");
        return { lines: [dish(`dish-of-${billId}`, 1)], revision: 0 };
      });
    }

    it("shows the lowest-numbered bill still owing when the last unpaid dishes left the bill on screen, now paid, with no notice", async () => {
      const el = await sending(
        after(
          partyBill("wo-4", 1, "0.00", { status: "settled" }),
          partyBill("b3", 3, "30.00"),
          partyBill("b2", 2, "20.00"),
        ),
      );
      api.getTabLines!.mockImplementation(linesOfOpenBills());

      split(el, { wholeBillIds: [], loose: [{ billId: "wo-4", lineIds: ["soup"] }] });
      await flush(el, 6);

      expect(tableOrder(el)!.lines.map((line) => line.id)).toEqual(["dish-of-b2"]);
      expect(tableOrder(el)!.orderId).toBe("b2");
      expect(tableOrder(el)!.billGone).toBeNull();
      expect(banner(el)).toBeNull();
    });

    it("shows the paid bill when the last unpaid dishes left the bill on screen and no bill still owes, with no notice", async () => {
      const el = await sending(after(partyBill("wo-4", 1, "0.00", { status: "settled" })));

      split(el, { wholeBillIds: ["b2", "b3"], loose: [{ billId: "wo-4", lineIds: ["soup"] }] });
      await flush(el, 6);

      expect(api.splitTable).toHaveBeenCalledTimes(1);
      expect(tableOrder(el)!.orderId).toBe("wo-4");
      expect(tableOrder(el)!.billGone).toBeNull();
      expect(banner(el)).toBeNull();
    });

    it("still moves off a bill left paid when the first bills read after the split fails and the next answers", async () => {
      const next = after(
        partyBill("wo-4", 1, "0.00", { status: "settled" }),
        partyBill("b2", 2, "20.00"),
      );
      const el = await sending(next);
      api.getTabLines!.mockImplementation(linesOfOpenBills());
      api.splitTable!.mockImplementation(async () => {
        api.getTablesState!.mockResolvedValue(next.tables);
        api.getPartyBills!.mockReset();
        api
          .getPartyBills!.mockRejectedValueOnce(new Error("read failed"))
          .mockResolvedValue(next.bills);
        return { partyId: "v-split", billIds: ["b9"] };
      });

      split(el, { wholeBillIds: [], loose: [{ billId: "wo-4", lineIds: ["soup"] }] });
      await flush(el, 8);

      expect(api.splitTable).toHaveBeenCalledTimes(1);
      expect(tableOrder(el)!.orderId).toBe("b2");
      expect(tableOrder(el)!.lines.map((line) => line.id)).toEqual(["dish-of-b2"]);
      expect(tableOrder(el)!.billGone).toBeNull();
      expect(banner(el)).toBeNull();
    });

    it("stays on a bill left paid, after that failed read, when no bill still owes", async () => {
      const next = after(partyBill("wo-4", 1, "0.00", { status: "settled" }));
      const el = await sending(next);
      api.splitTable!.mockImplementation(async () => {
        api.getTablesState!.mockResolvedValue(next.tables);
        api.getPartyBills!.mockReset();
        api
          .getPartyBills!.mockRejectedValueOnce(new Error("read failed"))
          .mockResolvedValue(next.bills);
        return { partyId: "v-split", billIds: ["b9"] };
      });

      split(el, { wholeBillIds: ["b2", "b3"], loose: [{ billId: "wo-4", lineIds: ["soup"] }] });
      await flush(el, 8);

      expect(tableOrder(el)!.orderId).toBe("wo-4");
      expect(api.getPartyBills).toHaveBeenCalledTimes(2);
      expect(tableOrder(el)!.billGone).toBeNull();
    });

    it("stays on the bill when the first read fails and the next shows it still owes, a lower-numbered bill owing too", async () => {
      const next = after(partyBill("wo-4", 1, "10.00"), partyBill("b2", 2, "5.00"));
      const el = await sending(next);
      emit(tableOrder(el)!, "switch-bill", { workingOrderId: "b2" });
      await flush(el, 6);
      expect(tableOrder(el)!.orderId).toBe("b2");
      api.splitTable!.mockImplementation(async () => {
        api.getTablesState!.mockResolvedValue(next.tables);
        api.getPartyBills!.mockReset();
        api
          .getPartyBills!.mockRejectedValueOnce(new Error("read failed"))
          .mockResolvedValue(next.bills);
        return { partyId: "v-split", billIds: ["b9"] };
      });

      split(el, { wholeBillIds: [], loose: [{ billId: "b2", lineIds: ["steak"] }] });
      await flush(el, 8);

      expect(api.splitTable).toHaveBeenCalledTimes(1);
      expect(tableOrder(el)!.orderId).toBe("b2");
    });

    it("leaves the bill on screen alone when the split took another bill", async () => {
      const el = await sending(after(partyBill("wo-4", 1, "10.00"), partyBill("b3", 3, "30.00")));

      split(el, { wholeBillIds: ["b2"], loose: [] });
      await flush(el, 6);

      expect(tableOrder(el)!.orderId).toBe("wo-4");
      expect(tableOrder(el)!.bills.map((bill) => bill.workingOrderId)).toEqual(["wo-4", "b3"]);
      expect(tableOrder(el)!.billGone).toBeNull();
    });

    it("reads the drafts again once the split has gone", async () => {
      const el = await sending(after(partyBill("wo-4", 1, "10.00"), partyBill("b3", 3, "30.00")));
      const draftReads = api.listDrafts!.mock.calls.length;

      split(el, { wholeBillIds: ["b2"], loose: [] });
      await flush(el, 6);

      expect(tableOrder(el)!.orderId).toBe("wo-4");
      expect(api.listDrafts!.mock.calls.length).toBeGreaterThan(draftReads);
    });
  });

  describe("different people", () => {
    const limited = (limit: string | null) => ({
      getTill: vi.fn().mockResolvedValue({ ...till("till"), simplifiedInvoiceLimit: limit }),
    });
    const fromBill2Loose = { loose: [{ billId: "b2", lineIds: ["steak"] }] };
    const fromBill2 = { wholeBillIds: [], ...fromBill2Loose };

    it("asks once for a loose pick off a bill over the limit, and sends only after confirming", async () => {
      const el = await sending(after(...threeBills()), limited("15.00"));

      split(el, fromBill2);
      await flush(el, 6);
      expect(question(el)).not.toBeNull();
      expect(api.splitTable).not.toHaveBeenCalled();

      question(el)!.querySelector<HTMLElement>("[data-confirm]")!.click();
      await flush(el, 6);
      expect(question(el)).toBeNull();
      expect(api.splitTable).toHaveBeenCalledTimes(1);
      expect(api.splitTable!.mock.calls[0]![2]).toEqual(fromBill2);
    });

    it("sends nothing when the question is cancelled", async () => {
      const el = await sending(after(...threeBills()), limited("15.00"));

      split(el, fromBill2);
      await flush(el, 6);
      question(el)!.querySelector<HTMLElement>("[data-cancel]")!.click();
      await flush(el, 6);

      expect(question(el)).toBeNull();
      expect(api.splitTable).not.toHaveBeenCalled();
    });

    it("asks nothing for a whole bill over the limit", async () => {
      const el = await sending(after(...threeBills()), limited("15.00"));

      split(el, { wholeBillIds: ["b2"], loose: [] });
      await flush(el, 6);

      expect(question(el)).toBeNull();
      expect(api.splitTable).toHaveBeenCalledTimes(1);
    });

    it("asks nothing for a whole bill over the limit beside a loose source under it", async () => {
      const el = await sending(after(...threeBills()), {
        ...limited("25.00"),
        getPartyBills: vi.fn().mockResolvedValue(threeBills()),
      });

      split(el, { wholeBillIds: ["b3"], loose: [{ billId: "b2", lineIds: ["steak"] }] });
      await flush(el, 6);

      expect(question(el)).toBeNull();
      expect(api.splitTable).toHaveBeenCalledTimes(1);
    });

    it("asks nothing when the limit is null", async () => {
      const el = await sending(after(...threeBills()), limited(null));

      split(el, fromBill2);
      await flush(el, 6);

      expect(question(el)).toBeNull();
      expect(api.splitTable).toHaveBeenCalledTimes(1);
    });

    it("asks nothing for a loose source under the limit, the bill on screen over it", async () => {
      const el = await sending(after(...threeBills()), {
        ...limited("15.00"),
        getPartyBills: vi
          .fn()
          .mockResolvedValue([partyBill("wo-4", 1, "90.00"), partyBill("b2", 2, "10.00")]),
      });

      split(el, fromBill2);
      await flush(el, 6);

      expect(question(el)).toBeNull();
      expect(api.splitTable).toHaveBeenCalledTimes(1);
    });

    it("asks when the second of two loose sources is the one over the limit", async () => {
      const el = await sending(after(...threeBills()), limited("15.00"));

      split(el, {
        wholeBillIds: [],
        loose: [
          { billId: "wo-4", lineIds: ["soup"] },
          { billId: "b2", lineIds: ["steak"] },
        ],
      });
      await flush(el, 6);

      expect(question(el)).not.toBeNull();
      expect(api.splitTable).not.toHaveBeenCalled();
    });

    it("asks for a loose source over the limit beside a whole bill", async () => {
      const el = await sending(after(...threeBills()), limited("15.00"));

      split(el, { wholeBillIds: ["b3"], ...fromBill2Loose });
      await flush(el, 6);

      expect(question(el)).not.toBeNull();
      expect(api.splitTable).not.toHaveBeenCalled();
    });

    it("asks for a loose source over the limit, the bill on screen under it", async () => {
      const el = await sending(after(...threeBills()), limited("15.00"));
      expect(tableOrder(el)!.orderId).toBe("wo-4");

      split(el, fromBill2);
      await flush(el, 6);

      expect(question(el)).not.toBeNull();
    });
  });

  describe("no bill", () => {
    const noBill = party({ tableIds: ["t4", "t5"], billCount: 0, openingBillId: null });

    it("sends an empty selection for a party with no bill and stays with it", async () => {
      const staying = party({ revision: 4, tableIds: ["t4"], billCount: 0, openingBillId: null });
      const el = await mounted("desktop", {
        getTablesState: vi
          .fn()
          .mockResolvedValue([table("t4", "4", noBill), table("t5", "5", noBill), table7]),
        getPartyBills: vi.fn().mockResolvedValue([]),
        getSplitSources: vi.fn().mockResolvedValue({ partyRevision: 3, bills: [] }),
        splitTable: vi.fn(async () => {
          api.getTablesState!.mockResolvedValue([
            table("t4", "4", staying),
            table("t5", "5", party({ id: "v-split", revision: 0, tableIds: ["t5"] })),
            table7,
          ]);
          return { partyId: "v-split", billIds: ["b9"] };
        }),
      });
      expect(tableOrder(el)!.orderId).toBeUndefined();
      const selection = { wholeBillIds: [], loose: [] };

      split(el, selection);
      await flush(el, 6);

      expect(banner(el)).toBeNull();
      expect(api.splitTable).toHaveBeenCalledTimes(1);
      expect(api.splitTable).toHaveBeenCalledWith("v1", "t5", selection, 3, [], guests);
      expect(tableOrder(el)!.party?.revision).toBe(4);
      expect(tableOrder(el)!.party?.tableIds).toEqual(["t4"]);
      expect(tableOrder(el)!.orderId).toBeUndefined();
    });
  });
});

describe("till-app: Split a table's panel compares what the waiter saw", () => {
  const noEdit = (billId: string, over: Record<string, unknown> = {}) => ({
    billId,
    editorVersion: 0,
    draftId: null,
    draftRevision: null,
    ...over,
  });
  const whole = (...wholeBillIds: string[]) => ({ wholeBillIds, loose: [] });
  const noGuests = { staying: 2, leaving: null };
  const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
  const refusal = (el: TillApp) => q(el, "[data-split-refusal]");
  const changedWords = (bill: string) => t("table.split_changed").replace("{bill}", bill);
  const tickBox = (el: TillApp, billId: string) =>
    picker(el)!.shadowRoot!.querySelector<HTMLInputElement>(`[data-split-tick="${billId}"]`)!;
  const dishRows = (el: TillApp, billId: string) =>
    picker(el)!.shadowRoot!.querySelector(`[data-split-bill="${billId}"] till-portion-picker`)!
      .shadowRoot!;

  async function tick(el: TillApp, billId: string): Promise<void> {
    tickBox(el, billId).click();
    await flush(el);
  }

  async function pickDish(el: TillApp, billId: string, row: string): Promise<void> {
    dishRows(el, billId).querySelector<HTMLInputElement>(`[data-pick="${row}"]`)!.click();
    await flush(el);
  }

  async function refreshDrafts(el: TillApp): Promise<void> {
    const reads = api.listDrafts!.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await expect.poll(() => api.listDrafts!.mock.calls.length).toBeGreaterThan(reads);
    await flush(el, 6);
  }

  async function pressSplit(el: TillApp): Promise<void> {
    await press(el, "[data-split-confirm]");
    await flush(el, 6);
  }

  /** Whatever the server says, `change` has moved this bill's edit state once `moved.now` is set. */
  function draftsMoving(billId: string, change: Record<string, unknown> = { editorVersion: 2 }) {
    const moved = { now: false };
    const listDrafts = vi.fn(async (partyId: string) => {
      const snapshot = await server.listDrafts(partyId);
      return moved.now
        ? {
            ...snapshot,
            billEdits: snapshot.billEdits.map((edit) =>
              edit.billId === billId ? { ...edit, ...change } : edit,
            ),
          }
        : snapshot;
    });
    return { moved, listDrafts };
  }

  async function panelWith(over: Record<string, unknown>) {
    server.bills.add("b2");
    const el = await mounted("desktop", {
      splitTable: vi.fn().mockResolvedValue({ partyId: "v-split", billIds: ["b9"] }),
      ...over,
    });
    await toPanel(el);
    return el;
  }

  const changes = {
    owner: { before: {}, after: { editorVersion: 2 } },
    draft: { before: {}, after: { draftId: "new-draft", draftRevision: 1 } },
    revision: {
      before: { draftId: "saved-draft", draftRevision: 1 },
      after: { draftId: "saved-draft", draftRevision: 2 },
    },
  };
  for (const name of ["owner", "draft", "revision"] as const) {
    it(`refuses a refreshed ${name} on a ticked bill while the panel stays open`, async () => {
      const moved = { now: false };
      const listDrafts = vi.fn(async (partyId: string) => {
        const snapshot = await server.listDrafts(partyId);
        return {
          ...snapshot,
          billEdits: snapshot.billEdits.map((edit) =>
            edit.billId === "b2"
              ? { ...edit, ...(moved.now ? changes[name].after : changes[name].before) }
              : edit,
          ),
        };
      });
      const el = await panelWith({ listDrafts });
      await tick(el, "b2");
      const panel = q(el, "[data-split-pick]");

      moved.now = true;
      await refreshDrafts(el);
      expect(q(el, "[data-split-pick]")).toBe(panel);
      await pressSplit(el);

      expect(api.splitTable).not.toHaveBeenCalled();
      expect(refusal(el)!.textContent).toContain(changedWords("Bill 2"));
      expect(banner(el)).toBeNull();
      expect(tickBox(el, "b2").checked).toBe(true);
      expect(server.saveDraft).not.toHaveBeenCalled();
      expect(server.takeOverDraft).not.toHaveBeenCalled();
    });
  }

  it("keeps missing metadata at prompt opening from becoming permission after refresh", async () => {
    const state = { missing: true };
    const listDrafts = vi.fn(async (partyId: string) => {
      const snapshot = await server.listDrafts(partyId);
      return {
        ...snapshot,
        billEdits: state.missing
          ? snapshot.billEdits.filter((edit) => edit.billId !== "b2")
          : snapshot.billEdits.map((edit) =>
              edit.billId === "b2" ? { ...edit, editorVersion: 3 } : edit,
            ),
      };
    });
    const el = await panelWith({ listDrafts });
    await tick(el, "b2");

    state.missing = false;
    await refreshDrafts(el);
    await pressSplit(el);

    expect(api.splitTable).not.toHaveBeenCalled();
    expect(refusal(el)!.textContent).toContain(changedWords("Bill 2"));
    expect(banner(el)).toBeNull();

    await pressSplit(el);
    expect(api.splitTable).toHaveBeenCalledExactlyOnceWith(
      "v1",
      "t5",
      whole("b2"),
      3,
      [noEdit("b2", { editorVersion: 3 })],
      noGuests,
    );
  });

  it.each(["b2", "none"])("allows %s when only an unrelated bill changed", async (billId) => {
    const { moved, listDrafts } = draftsMoving("wo-4");
    const el = await panelWith({ listDrafts });
    if (billId !== "none") await tick(el, billId);

    moved.now = true;
    await refreshDrafts(el);
    await pressSplit(el);

    expect(api.splitTable).toHaveBeenCalledExactlyOnceWith(
      "v1",
      "t5",
      billId === "none" ? whole() : whole(billId),
      3,
      billId === "none" ? [] : [noEdit(billId)],
      noGuests,
    );
    expect(banner(el)).toBeNull();
  });

  it("refuses a panel carried across a bill switch", async () => {
    const el = await panelWith({});
    const order = tableOrder(el)!;
    await press(el, "[data-action-back]");
    let prompt: object | undefined;
    order.addEventListener(
      "split-table-open",
      (event) => (prompt = (event as CustomEvent<{ prompt: object }>).detail.prompt),
      { once: true },
    );
    await press(el, '[data-target="t5"]');
    await tick(el, "wo-4");
    expect(prompt).toBeDefined();

    emit(order, "take-payment", { workingOrderId: "b2" });
    await flush(el, 6);
    expect(tableOrder(el)!.orderId).toBe("b2");
    emit(tableOrder(el)!, "split-table", {
      tableId: "t5",
      selection: whole("wo-4"),
      guestCounts: noGuests,
      prompt,
    });
    await flush(el, 6);

    expect(api.splitTable).not.toHaveBeenCalled();
  });

  it("allows a new panel after Back and a refreshed bill", async () => {
    const { moved, listDrafts } = draftsMoving("b2");
    const el = await panelWith({ listDrafts });
    await tick(el, "b2");
    await press(el, "[data-action-back]");
    el.shadowRoot!.querySelector("wt-unsaved-changes")!
      .shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!
      .click();
    await flush(el, 6);
    expect(q(el, "[data-split-pick]")).toBeNull();

    moved.now = true;
    await refreshDrafts(el);
    await press(el, '[data-target="t5"]');
    await tick(el, "b2");
    await pressSplit(el);

    expect(api.splitTable).toHaveBeenCalledExactlyOnceWith(
      "v1",
      "t5",
      whole("b2"),
      3,
      [noEdit("b2", { editorVersion: 2 })],
      noGuests,
    );
    expect(banner(el)).toBeNull();
  });

  it.each(["while the request is out", "while the count is corrected"])(
    "retains the original observation when a refused guest count is corrected, the bill changing %s",
    async (when) => {
      const { moved, listDrafts } = draftsMoving("b2");
      let refuse = () => {};
      const el = await panelWith({
        listDrafts,
        splitTable: vi.fn(
          () =>
            new Promise((_resolve, reject) => {
              refuse = () =>
                reject({ code: "management.request_invalid", field: "guestCounts.leaving" });
            }),
        ),
      });
      await tick(el, "b2");
      await pressSplit(el);
      expect(api.splitTable).toHaveBeenCalledOnce();
      if (when === "while the request is out") {
        moved.now = true;
        await refreshDrafts(el);
      }
      refuse();
      await flush(el, 6);
      const leaving = q<HTMLElementTagNameMap["wt-number-stepper"]>(
        el,
        'wt-number-stepper[name="leavingGuests"]',
      )!;
      expect(leaving.error).toBe(t("seat.guest_count_invalid"));
      expect(tickBox(el, "b2").checked).toBe(true);
      expect(banner(el)).toBeNull();

      const input = leaving.shadowRoot!.querySelector<HTMLInputElement>("input")!;
      input.value = "1";
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      if (when === "while the count is corrected") {
        moved.now = true;
        await refreshDrafts(el);
      }
      await pressSplit(el);

      expect(api.splitTable).toHaveBeenCalledTimes(1);
      expect(refusal(el)!.textContent).toContain(changedWords("Bill 2"));
      expect(banner(el)).toBeNull();
    },
  );

  it("does not send an old panel to a replacement API", async () => {
    const el = await panelWith({});
    await tick(el, "b2");
    const original = api;
    const replacement = stubApi({
      getTablesState: vi.fn().mockResolvedValue(tables),
      splitTable: vi.fn(),
    });
    const button = splitButton(el);
    el.api = replacement as unknown as TillApp["api"];
    await flush(el);
    button.click();
    await flush(el, 6);

    expect(original.splitTable).not.toHaveBeenCalled();
    expect(replacement.splitTable).not.toHaveBeenCalled();
  });

  it("the worked example: my own draft saved elsewhere is refused once, then sent with the new state", async () => {
    server.drafts.push({
      ...savedDraft("b2", "p1", "Ana"),
      lines: [{ id: "mine", sourceLineId: null, source: null } as Draft["lines"][number]],
    });
    const el = await panelWith({});
    await tick(el, "b2");
    expect(q(el, "till-split-picker")!.shadowRoot!.querySelector("[data-split-take-over]")).toBe(
      null,
    );

    server.drafts[0]!.revision = 2;
    await refreshDrafts(el);
    await pressSplit(el);

    expect(api.splitTable).not.toHaveBeenCalled();
    expect(refusal(el)!.textContent).toContain(changedWords("Bill 2"));
    expect(tickBox(el, "b2").checked).toBe(true);

    await pressSplit(el);

    expect(api.splitTable).toHaveBeenCalledExactlyOnceWith(
      "v1",
      "t5",
      whole("b2"),
      3,
      [noEdit("b2", { editorVersion: 1, draftId: "draft-b2", draftRevision: 2 })],
      noGuests,
    );
    expect(refusal(el)).toBeNull();
  });

  it("sends with no refusal a bill changed before it was ticked", async () => {
    const { moved, listDrafts } = draftsMoving("b2");
    const el = await panelWith({ listDrafts });

    moved.now = true;
    await refreshDrafts(el);
    await tick(el, "b2");
    await pressSplit(el);

    expect(api.splitTable).toHaveBeenCalledExactlyOnceWith(
      "v1",
      "t5",
      whole("b2"),
      3,
      [noEdit("b2", { editorVersion: 2 })],
      noGuests,
    );
  });

  it("sends with no refusal a bill ticked, changed, unticked and ticked again", async () => {
    const { moved, listDrafts } = draftsMoving("b2");
    const el = await panelWith({ listDrafts });
    await tick(el, "b2");

    moved.now = true;
    await refreshDrafts(el);
    await tick(el, "b2");
    await tick(el, "b2");
    await pressSplit(el);

    expect(api.splitTable).toHaveBeenCalledExactlyOnceWith(
      "v1",
      "t5",
      whole("b2"),
      3,
      [noEdit("b2", { editorVersion: 2 })],
      noGuests,
    );
  });

  it("a server's draft.out_of_date retakes the observation, so the retry sends once", async () => {
    const { moved, listDrafts } = draftsMoving("b2");
    const splitTable = vi
      .fn()
      .mockImplementationOnce(async () => {
        moved.now = true;
        throw { code: "draft.out_of_date", billId: "b2" };
      })
      .mockResolvedValue({ partyId: "v-split", billIds: ["b9"] });
    const el = await panelWith({ listDrafts, splitTable });
    await tick(el, "b2");
    const reads = listDrafts.mock.calls.length;

    await pressSplit(el);

    expect(splitTable).toHaveBeenCalledTimes(1);
    expect(listDrafts.mock.calls.length).toBeGreaterThan(reads);
    expect(refusal(el)!.textContent).toContain(changedWords("Bill 2"));
    expect(banner(el)).toBeNull();
    expect(tickBox(el, "b2").checked).toBe(true);

    await pressSplit(el);

    expect(splitTable).toHaveBeenCalledTimes(2);
    expect(splitTable).toHaveBeenLastCalledWith(
      "v1",
      "t5",
      whole("b2"),
      3,
      [noEdit("b2", { editorVersion: 2 })],
      noGuests,
    );
  });

  it("says a draft.out_of_date naming no bill the till lists on the banner, with no panel", async () => {
    const el = await panelWith({
      splitTable: vi.fn().mockRejectedValue({ code: "draft.out_of_date", billId: "elsewhere" }),
    });
    await tick(el, "b2");
    await pressSplit(el);

    expect(api.splitTable).toHaveBeenCalledOnce();
    expect(banner(el)!.textContent).toContain(codeMessage("draft.out_of_date"));
    expect(q(el, "[data-split-pick]")).toBeNull();
  });

  it("compares a loose source as it does a whole bill", async () => {
    const { moved, listDrafts } = draftsMoving("b2");
    const el = await panelWith({
      listDrafts,
      getSplitSources: vi.fn().mockResolvedValue({
        partyRevision: 3,
        bills: [
          answered().bills[0],
          {
            billId: "b2",
            lines: [dish("steak", 1), dish("chips", 2)],
            balance: balance("b2", "20.00"),
          },
        ],
      }),
    });
    await pickDish(el, "b2", "steak");

    moved.now = true;
    await refreshDrafts(el);
    await pressSplit(el);

    expect(api.splitTable).not.toHaveBeenCalled();
    expect(refusal(el)!.textContent).toContain(changedWords("Bill 2"));

    await pressSplit(el);

    expect(api.splitTable).toHaveBeenCalledExactlyOnceWith(
      "v1",
      "t5",
      { wholeBillIds: [], loose: [{ billId: "b2", lineIds: ["steak"] }] },
      3,
      [noEdit("b2", { editorVersion: 2 })],
      noGuests,
    );
  });

  it("a dish recalled on a bill not on screen is not offered, and cannot be sent", async () => {
    server.drafts.push({
      ...savedDraft("b2", "p1", "Ana"),
      lines: [
        { id: "back", sourceLineId: "steak", source: null } as unknown as Draft["lines"][number],
      ],
    });
    const el = await panelWith({
      getSplitSources: vi.fn().mockResolvedValue({
        partyRevision: 3,
        bills: [
          answered().bills[0],
          {
            billId: "b2",
            lines: [dish("steak", 1), dish("chips", 2)],
            balance: balance("b2", "20.00"),
          },
        ],
      }),
    });
    const rows = () =>
      [...dishRows(el, "b2").querySelectorAll<HTMLElement>("[data-pick-row]")].map(
        (row) => row.dataset.pickRow,
      );

    expect(rows()).toEqual(["chips"]);
    expect(dishRows(el, "b2").querySelector('[data-pick="steak"]')).toBeNull();

    await pickDish(el, "b2", "chips");
    await pressSplit(el);

    expect(api.splitTable).toHaveBeenCalledOnce();
    const selection = api.splitTable!.mock.calls[0]![2];
    expect(selection).toEqual({
      wholeBillIds: [],
      loose: [{ billId: "b2", lineIds: ["chips"] }],
    });
  });

  describe("the comparison beyond one ticked bill, and around the question", () => {
    const threeBills = () => [...bills(), partyBill("b3", 3, "5.00")];
    const threeRead = (): SplitSources => ({
      partyRevision: 3,
      bills: [
        ...answered().bills,
        { billId: "b3", lines: [dish("tea", 1)], balance: balance("b3", "5.00") },
      ],
    });
    const threeBillPanel = (over: Record<string, unknown> = {}) => {
      server.bills.add("b3");
      return panelWith({
        getPartyBills: vi.fn().mockResolvedValue(threeBills()),
        getSplitSources: vi.fn().mockResolvedValue(threeRead()),
        ...over,
      });
    };
    const limited = () => ({
      getTill: vi.fn().mockResolvedValue({ ...till("till"), simplifiedInvoiceLimit: "15.00" }),
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
    const question = (el: TillApp) =>
      el.shadowRoot!.querySelector<HTMLElement>("[data-confirm-different-people]");

    it("two bills ticked, the second moved: refused naming it, then sent sorted", async () => {
      const { moved, listDrafts } = draftsMoving("b3");
      const el = await threeBillPanel({ listDrafts });
      await tick(el, "b3");
      await tick(el, "b2");
      moved.now = true;
      await refreshDrafts(el);

      await pressSplit(el);

      expect(api.splitTable).not.toHaveBeenCalled();
      expect(refusal(el)!.textContent).toContain(changedWords("Bill 3"));

      await pressSplit(el);

      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(api.splitTable!.mock.calls[0]![2]).toEqual(whole("b2", "b3"));
      expect(api.splitTable!.mock.calls[0]![4]).toEqual([
        noEdit("b2"),
        noEdit("b3", { editorVersion: 2 }),
      ]);
    });

    it("a whole bill and a loose source: the edits go sorted by bill, not whole bills first", async () => {
      const el = await threeBillPanel({
        getSplitSources: vi.fn().mockResolvedValue({
          partyRevision: 3,
          bills: [
            ...threeRead().bills.filter(({ billId }) => billId !== "b2"),
            {
              billId: "b2",
              lines: [dish("steak", 1), dish("wine", 2)],
              balance: balance("b2", "20.00"),
            },
          ],
        }),
      });
      await tick(el, "b3");
      await pickDish(el, "b2", "steak");

      await pressSplit(el);

      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(api.splitTable!.mock.calls[0]![4]).toEqual([noEdit("b2"), noEdit("b3")]);
    });

    it("a bill moved before the press, past the limit: the sentence, and no question", async () => {
      const { moved, listDrafts } = draftsMoving("b2");
      const el = await panelWith({ listDrafts, ...limited() });
      await pickDish(el, "b2", "steak");
      moved.now = true;
      await refreshDrafts(el);

      await pressSplit(el);

      expect(question(el)).toBeNull();
      expect(refusal(el)!.textContent).toContain(changedWords("Bill 2"));
      expect(api.splitTable).not.toHaveBeenCalled();
    });

    it("a bill moved with the question open, then confirmed: the sentence, the panel, no request", async () => {
      const { moved, listDrafts } = draftsMoving("b2");
      const el = await panelWith({ listDrafts, ...limited() });
      await pickDish(el, "b2", "steak");
      await pressSplit(el);
      expect(question(el)).not.toBeNull();
      moved.now = true;
      await refreshDrafts(el);

      question(el)!.querySelector<HTMLElement>("[data-confirm]")!.click();
      await flush(el, 6);

      expect(api.splitTable).not.toHaveBeenCalled();
      expect(refusal(el)!.textContent).toContain(changedWords("Bill 2"));
      expect(q(el, "[data-split-pick]")).not.toBeNull();
      expect(banner(el)).toBeNull();
    });

    it("a bill moved while the question waits for a total the list lacks: no request", async () => {
      const { moved, listDrafts } = draftsMoving("b2");
      let answerBalance = () => {};
      const el = await panelWith({
        listDrafts,
        ...limited(),
        getPartyBills: vi
          .fn()
          .mockResolvedValue([
            partyBill("wo-4", 1, "10.00"),
            { ...partyBill("b2", 2, "20.00"), total: undefined } as unknown as PartyBill,
          ]),
      });
      await pickDish(el, "b2", "steak");
      api.getBillBalance!.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerBalance = () => resolve(balance("b2", "12.00"));
          }),
      );

      await pressSplit(el);
      moved.now = true;
      await refreshDrafts(el);
      answerBalance();
      await flush(el, 6);

      expect(api.splitTable).not.toHaveBeenCalled();
      expect(refusal(el)!.textContent).toContain(changedWords("Bill 2"));
    });

    it("a bill taken over unticked and moved before its tick is compared from the tick", async () => {
      const luis = {
        ...savedDraft("b2", "p2", "Luis"),
        lines: [{ id: "luis-b2", sourceLineId: null, source: null } as Draft["lines"][number]],
      };
      server.drafts.push(luis);
      const { moved, listDrafts } = draftsMoving("b2", { editorVersion: 9 });
      const el = await threeBillPanel({ listDrafts });
      await tick(el, "wo-4");
      picker(el)!.shadowRoot!.querySelector<HTMLElement>('[data-split-take-over="b2"]')!.click();
      await flush(el);
      await press(el, "[data-take-over-confirm]");
      await flush(el, 6);
      moved.now = true;
      await refreshDrafts(el);
      await tick(el, "b2");

      await pressSplit(el);

      expect(refusal(el)).toBeNull();
      expect(api.splitTable).toHaveBeenCalledOnce();
    });
  });

  describe("refusals", () => {
    const refused = (error: unknown) => ({ splitTable: vi.fn().mockRejectedValue(error) });
    const reads = () => ({
      partyRevision: 3,
      bills: api.getPartyBills!.mock.calls.length,
      sources: api.getSplitSources!.mock.calls.length,
      floor: api.getTablesState!.mock.calls.length,
      drafts: api.listDrafts!.mock.calls.length,
    });
    const said = (el: TillApp) => refusal(el)?.textContent?.replace(/\s+/g, " ").trim();
    const onBill = (bill: string, code: string) =>
      t("table.refused_on_bill").replace("{bill}", bill).replace("{message}", codeMessage(code));
    const panelOpen = (el: TillApp) => q(el, "[data-split-pick]") !== null;
    const onOneTable = party({ tableIds: ["t4"], billCount: 2, revision: 99 });
    const oneTableFloor = () => [table("t4", "4", onOneTable), table("t5", "5", null), table7];

    async function refusedOn(billId: string, error: unknown, over: Record<string, unknown> = {}) {
      const el = await panelWith({ ...refused(error), ...over });
      await tick(el, billId);
      await pressSplit(el);
      return el;
    }

    /** A request out until `refuse` is called, the panel already closed. */
    async function requestOut(billId: string, over: Record<string, unknown> = {}) {
      let refuse: (error: unknown) => void = () => {};
      const el = await panelWith({
        getTabLines: vi.fn().mockResolvedValue({ lines: [dish("soup", 1)], revision: 0 }),
        setPartyName: vi.fn().mockResolvedValue({ revision: 3 }),
        splitTable: vi.fn(() => new Promise((_resolve, reject) => (refuse = reject))),
        ...over,
      });
      await tick(el, billId);
      await pressSplit(el);
      expect(panelOpen(el)).toBe(false);
      return { el, refuse: (error: unknown) => refuse(error) };
    }

    function holdBills() {
      let release = () => {};
      api.getPartyBills!.mockImplementationOnce(
        () =>
          new Promise<PartyBill[]>((resolve) => {
            release = () => resolve(bills());
          }),
      );
      return () => release();
    }

    async function openMoveDishes(el: TillApp): Promise<void> {
      await press(el, "[data-move-split]");
      await press(el, '[data-action="move-dishes"]');
    }

    async function pickMoveDish(el: TillApp): Promise<void> {
      q(el, "[data-move-dishes] till-portion-picker")!
        .shadowRoot!.querySelector<HTMLInputElement>("[data-pick]")!
        .click();
      await flush(el);
    }

    const movePicked = (el: TillApp) =>
      q(el, "[data-move-dishes] till-portion-picker")!.shadowRoot!.querySelector<HTMLInputElement>(
        "[data-pick]",
      )!.checked;

    const unsavedQuestion = (el: TillApp) =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
        "wt-unsaved-changes",
      )!;

    async function answer(el: TillApp, choice: "keep" | "discard"): Promise<void> {
      const question = unsavedQuestion(el);
      await expect.poll(() => question.open).toBe(true);
      question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
      await expect.poll(() => question.open).toBe(false);
      await flush(el, 6);
    }

    it("a refused Split's panel, taller than a phone's window, comes back with its sentence and Split on screen", async () => {
      await page.viewport(390, 844);
      const longBill = Array.from({ length: 16 }, (_, index) => dish(`dish-${index}`, index + 1));
      const el = await refusedOn(
        "b2",
        { code: "tab.split_held_line" },
        {
          getSplitSources: vi.fn().mockResolvedValue({
            partyRevision: 3,
            bills: [
              { billId: "wo-4", lines: longBill, balance: balance("wo-4", "160.00") },
              { billId: "b2", lines: [dish("steak", 1)], balance: balance("b2", "20.00") },
            ],
          }),
        },
      );
      const onScreen = (control: HTMLElement) => {
        const box = control.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight;
      };
      expect(q(el, "[data-split-pick]")!.getBoundingClientRect().height).toBeGreaterThan(
        innerHeight,
      );
      await expect.poll(() => onScreen(refusal(el)!) && onScreen(splitButton(el))).toBe(true);
    });

    describe("what each row says and reads again", () => {
      it.each([
        "bill.line_paid",
        "bill.refund_in_progress",
        "order.payment_in_flight",
        "working_order.not_open",
        "bill.presented",
        "bill.paid",
      ])(
        "%s on a bill not on screen is named in front, and reads bills and sources",
        async (code) => {
          const el = await panelWith(refused({ code, workingOrderId: "b2" }));
          await tick(el, "b2");
          const before = reads();
          await pressSplit(el);

          expect(said(el)).toBe(onBill("Bill 2", code));
          expect(banner(el)).toBeNull();
          expect(tickBox(el, "b2").checked).toBe(true);
          expect(api.splitTable).toHaveBeenCalledOnce();
          const after = reads();
          expect(after.bills).toBeGreaterThan(before.bills);
          expect(after.sources).toBeGreaterThan(before.sources);
          expect(after.floor).toBe(before.floor);
        },
      );

      it.each(["bill.line_paid", "bill.paid"])(
        "%s on the bill on screen is said in its own words",
        async (code) => {
          const el = await refusedOn("wo-4", { code, workingOrderId: "wo-4" });

          expect(said(el)).toBe(codeMessage(code));
          expect(banner(el)).toBeNull();
        },
      );

      it("reads the label before the re-read, for a bill the re-read no longer lists", async () => {
        const el = await panelWith(refused({ code: "bill.line_paid", workingOrderId: "b2" }));
        await tick(el, "b2");
        api.getPartyBills!.mockResolvedValue([partyBill("wo-4", 1, "10.00")]);
        await pressSplit(el);

        expect(said(el)).toBe(onBill("Bill 2", "bill.line_paid"));
      });

      it("reads the bill's balance again after a money refusal", async () => {
        const el = await panelWith({
          ...refused({ code: "bill.line_paid", workingOrderId: "wo-4" }),
          getPartyBills: vi
            .fn()
            .mockResolvedValue([
              partyBill("wo-4", 1, "10.00", { hasPayments: true }),
              partyBill("b2", 2, "20.00"),
            ]),
        });
        await tick(el, "wo-4");
        const balances = api.getBillBalance!.mock.calls.length;
        await pressSplit(el);

        expect(api.getBillBalance!.mock.calls.length).toBeGreaterThan(balances);
      });

      it("tab.split_held_line says its own sentence and reads the sources alone", async () => {
        const el = await panelWith(refused({ code: "tab.split_held_line", tabId: "b2" }));
        await tick(el, "b2");
        const before = reads();
        await pressSplit(el);

        expect(said(el)).toBe(t("table.split_held_error"));
        expect(banner(el)).toBeNull();
        const after = reads();
        expect(after.sources).toBeGreaterThan(before.sources);
        expect(after.bills).toBe(before.bills);
      });

      it("sale.total_exceeds_simplified_limit says its words and reads nothing", async () => {
        const el = await panelWith(refused({ code: "sale.total_exceeds_simplified_limit" }));
        await tick(el, "b2");
        const before = reads();
        await pressSplit(el);

        expect(said(el)).toBe(codeMessage("sale.total_exceeds_simplified_limit"));
        expect(banner(el)).toBeNull();
        expect(reads()).toEqual(before);
      });

      it("says a refusal naming no field at the bottom of the panel", async () => {
        const el = await panelWith(
          refused({ code: "management.request_invalid", field: "guestCounts" }),
        );
        await tick(el, "b2");
        const before = reads();
        await pressSplit(el);

        expect(tableOrder(el)!.splitRefusal).toMatchObject({
          tableId: "t5",
          selection: whole("b2"),
          message: t("table.error"),
        });
        expect(panelOpen(el)).toBe(true);
        expect(said(el)).toBe(t("table.error"));
        expect(banner(el)).toBeNull();
        expect(reads()).toEqual(before);
        expect(splitButton(el).disabled).toBe(false);
      });

      it("a reopening clears a banner something else raised while the request was out", async () => {
        const { el, refuse } = await requestOut("b2", {
          setPartyName: vi.fn().mockRejectedValue({ code: "table.not_found" }),
        });
        emit(tableOrder(el)!, "name-party", { name: "Ana" });
        await flush(el);
        expect(banner(el)).not.toBeNull();

        refuse({ code: "table.not_shared" });
        await flush(el, 6);

        expect(said(el)).toBe(codeMessage("table.not_shared"));
        expect(banner(el)).toBeNull();
      });

      it.each(["tab.not_open", "tab.line_not_found"])(
        "%s names the bill and reads bills and sources",
        async (code) => {
          const el = await panelWith(refused({ code, tabId: "b2" }));
          await tick(el, "b2");
          const before = reads();
          await pressSplit(el);

          expect(said(el)).toBe(changedWords("Bill 2"));
          expect(banner(el)).toBeNull();
          const after = reads();
          expect(after.bills).toBeGreaterThan(before.bills);
          expect(after.sources).toBeGreaterThan(before.sources);
        },
      );

      it("party.out_of_date goes to the bottom in #onTableRefusal's words, after order and floor", async () => {
        const el = await panelWith(refused({ code: "party.out_of_date" }));
        await tick(el, "b2");
        const before = reads();
        await pressSplit(el);

        expect(said(el)).toContain(t("party.try_again"));
        expect(banner(el)).toBeNull();
        expect(panelOpen(el)).toBe(true);
        const after = reads();
        expect(after.floor).toBeGreaterThan(before.floor);
        expect(after.bills).toBeGreaterThan(before.bills);
      });

      it("draft.taken_over with the read showing the bill held: D21's state, and no second request", async () => {
        const el = await panelWith(
          refused({ code: "draft.taken_over", billId: "b2", ownerId: "p2", ownerName: "Luis" }),
        );
        await tick(el, "b2");
        server.drafts.push(savedDraft("b2", "p2", "Luis"));
        await pressSplit(el);

        expect(tickBox(el, "b2").checked).toBe(true);
        expect(said(el)).toBe(t("table.split_taken").replace("{who}", "Luis"));
        expect(splitButton(el).disabled).toBe(true);
        expect(banner(el)).toBeNull();
        splitButton(el).click();
        await flush(el, 6);
        expect(api.splitTable).toHaveBeenCalledOnce();
      });

      it("draft.taken_over with the read failing names the refusal's bill, Split enabled", async () => {
        const el = await panelWith(
          refused({ code: "draft.taken_over", billId: "b2", ownerId: "p2", ownerName: "Luis" }),
        );
        await tick(el, "b2");
        api.listDrafts!.mockRejectedValue(new TypeError("Failed to fetch"));
        await pressSplit(el);

        expect(said(el)).toBe(changedWords("Bill 2"));
        expect(splitButton(el).disabled).toBe(false);
        expect(banner(el)).toBeNull();
      });

      it("pressing Split again takes the refusal back and sends", async () => {
        const el = await refusedOn("b2", { code: "table.not_shared" });
        expect(tableOrder(el)!.splitRefusal).not.toBeNull();

        api.splitTable!.mockResolvedValue({ partyId: "v-split", billIds: ["b2"] });
        await pressSplit(el);

        expect(api.splitTable).toHaveBeenCalledTimes(2);
        expect(tableOrder(el)!.splitRefusal).toBeNull();
      });
    });

    describe("a refused count", () => {
      async function typeCount(el: TillApp, name: string, value: string): Promise<void> {
        const input = q(el, `wt-number-stepper[name="${name}"]`)!.shadowRoot!.querySelector(
          "input",
        )!;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        await flush(el);
      }

      it.each([
        ["guestCounts.staying", "staying", "stayingGuests", "30", "2"],
        ["guestCounts.leaving", "leaving", "leavingGuests", "3", ""],
      ] as const)(
        "hands %s back to the panel, beside the field, without a banner",
        async (field, side, stepper, staying, leaving) => {
          const el = await panelWith(refused({ code: "management.request_invalid", field }));
          await tick(el, "b2");
          await typeCount(el, "stayingGuests", staying);
          await typeCount(el, "leavingGuests", leaving);
          const before = reads();
          await pressSplit(el);

          expect(tableOrder(el)!.splitRefusal).toEqual({
            tableId: "t5",
            selection: whole("b2"),
            staying,
            leaving,
            field: side,
            message: t("seat.guest_count_invalid"),
            prompt: expect.any(Object),
          });
          const steppers = (name: string) =>
            q<HTMLElementTagNameMap["wt-number-stepper"]>(el, `wt-number-stepper[name="${name}"]`)!;
          expect(String(steppers("stayingGuests").value)).toBe(staying);
          expect(String(steppers("leavingGuests").value)).toBe(leaving);
          expect(steppers(stepper).error).toBe(t("seat.guest_count_invalid"));
          expect(bottom(el).error).toBe(t("form.fix_fields"));
          expect(banner(el)).toBeNull();
          expect(reads()).toEqual(before);
        },
      );

      it("hands the refusal to the order card on a handheld", async () => {
        server.bills.add("b2");
        const el = await mounted(
          "handheld",
          refused({ code: "management.request_invalid", field: "guestCounts.leaving" }),
        );
        await toPanel(el);
        await tick(el, "b2");
        await pressSplit(el);

        expect(
          q<HTMLElementTagNameMap["wt-number-stepper"]>(
            el,
            'wt-number-stepper[name="leavingGuests"]',
          )!.error,
        ).toBe(t("seat.guest_count_invalid"));
      });

      it("a count refused on a party left on one table goes on the banner", async () => {
        const { el, refuse } = await requestOut("b2");
        api.getTablesState!.mockResolvedValue(oneTableFloor());
        emit(tableOrder(el)!, "name-party", { name: "Ana" });
        await flush(el, 6);

        refuse({ code: "management.request_invalid", field: "guestCounts.leaving" });
        await flush(el, 6);

        expect(banner(el)!.textContent).toContain(t("seat.guest_count_invalid"));
        expect(tableOrder(el)!.splitRefusal).toBeNull();
      });
    });

    describe("after leaving", () => {
      const inFlight = (code: string) => ({ code, field: "guestCounts.leaving" });

      it("drops a refusal that arrives after the waiter has opened another party's table", async () => {
        const { el, refuse } = await requestOut("b2");
        emit(tableOrder(el)!, "back-to-floor");
        await flush(el);
        emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
        await flush(el);

        refuse(inFlight("management.request_invalid"));
        await flush(el, 6);

        expect(tableOrder(el)!.party?.id).toBe("v7");
        expect(tableOrder(el)!.splitRefusal).toBeNull();
        expect(q(el, "[data-split-pick]")).toBeNull();
        expect(banner(el)).toBeNull();
      });

      it.each(["table.not_shared", "bill.line_paid", "party.out_of_date", "draft.taken_over"])(
        "%s arriving after the waiter left for the floor does nothing",
        async (code) => {
          const { el, refuse } = await requestOut("b2");
          emit(tableOrder(el)!, "back-to-floor");
          await flush(el);

          refuse({ code, billId: "b2", workingOrderId: "b2" });
          await flush(el, 6);

          expect(banner(el)).toBeNull();
          emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
          await flush(el, 6);
          expect(tableOrder(el)!.splitRefusal).toBeNull();
          expect(banner(el)).toBeNull();
        },
      );

      it("does not hand a refused split to the next table opened", async () => {
        const el = await refusedOn("b2", inFlight("management.request_invalid"));
        emit(tableOrder(el)!, "back-to-floor");
        await flush(el);
        emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
        await flush(el);

        expect(tableOrder(el)!.splitRefusal).toBeNull();
        expect(q(el, "[data-split-pick]")).toBeNull();
      });

      it("does not reopen the panel a refusal opened when a handheld comes back to its order card", async () => {
        server.bills.add("b2");
        const el = await mounted("handheld", refused(inFlight("management.request_invalid")));
        await toPanel(el);
        await tick(el, "b2");
        await pressSplit(el);
        expect(panelOpen(el)).toBe(true);
        await press(el, "[data-action-back]");
        await answer(el, "discard");
        expect(panelOpen(el)).toBe(false);

        emit(shell(el), "screen-select", { screen: "floor" });
        await flush(el);
        expect(tableOrder(el)).toBeNull();
        emit(shell(el), "screen-select", { screen: "order" });
        await flush(el);

        expect(tableOrder(el)).not.toBeNull();
        expect(panelOpen(el)).toBe(false);
      });
    });

    describe("no banner while a read is out", () => {
      it.each([
        ["the money row", { code: "bill.line_paid", workingOrderId: "b2" }],
        ["party.out_of_date", { code: "party.out_of_date" }],
      ])("%s says nothing until its read answers", async (_name, error) => {
        const { el, refuse } = await requestOut("b2");
        const release = holdBills();
        refuse(error);
        await flush(el, 6);

        expect(banner(el)).toBeNull();
        expect(refusal(el)).toBeNull();

        release();
        await flush(el, 6);

        expect(said(el)).toBeTruthy();
        expect(banner(el)).toBeNull();
      });
    });

    describe("the recovery link", () => {
      const conflict = {
        code: "sif.allocation_invalid",
        recoveryUrl: "/manage/recovery/fiscal-conflict",
      };

      it.each(["light", "dark"] as const)(
        "sits in the panel's message in its own colour (%s theme)",
        async (theme) => {
          const el = await panelWith(refused(conflict));
          el.parentElement!.setAttribute("data-theme", theme);
          await tick(el, "b2");
          await pressSplit(el);

          const link = refusal(el)!.querySelector<HTMLElement>("[data-recovery]")!;
          expect(link.getAttribute("style")).toContain("--wt-color-primary-text");
          const panelBackground = getComputedStyle(q(el, "[data-action-panel]")!).backgroundColor;
          expect(getComputedStyle(link).color).not.toBe(panelBackground);
          expect(banner(el)).toBeNull();
        },
      );

      it("on a party left on one table sits on the banner in the banner's colour", async () => {
        const { el, refuse } = await requestOut("b2");
        api.getTablesState!.mockResolvedValue(oneTableFloor());
        emit(tableOrder(el)!, "name-party", { name: "Ana" });
        await flush(el, 6);

        refuse(conflict);
        await flush(el, 6);

        expect(banner(el)!.querySelector("[data-recovery]")!.getAttribute("style")).toContain(
          "--wt-color-on-danger",
        );
        expect(panelOpen(el)).toBe(false);
      });
    });

    it("a recovery refusal naming the one table a party holds sits on the banner in the banner's colour", async () => {
      const el = await mounted("desktop", {
        getTablesState: vi.fn().mockResolvedValue(oneTableFloor()),
        ...refused({
          code: "sif.allocation_invalid",
          recoveryUrl: "/manage/recovery/fiscal-conflict",
        }),
      });
      emit(tableOrder(el)!, "split-table", {
        tableId: "t4",
        selection: whole("wo-4"),
        guestCounts: noGuests,
      });
      await flush(el, 6);

      expect(banner(el)!.querySelector("[data-recovery]")!.getAttribute("style")).toContain(
        "--wt-color-on-danger",
      );
      expect(tableOrder(el)!.splitRefusal).toBeNull();
    });

    describe("Two tables, words at the foot", () => {
      it.each(["table.not_shared", "group.held_leaves_party"])(
        "%s on a party the till shows at two tables is said at the foot",
        async (code) => {
          const el = await refusedOn("b2", { code });

          expect(said(el)).toBe(codeMessage(code));
          expect(banner(el)).toBeNull();
          expect(panelOpen(el)).toBe(true);
        },
      );
    });

    describe("a lost reply", () => {
      const lost = () => new TypeError("Failed to fetch");

      it("the re-read shows the table gone: no message, no panel, and the split is followed", async () => {
        const { el, refuse } = await requestOut("wo-4");
        const staying = party({ tableIds: ["t4"], billCount: 1, revision: 4 });
        const left = party({ id: "v-split", tableIds: ["t5"], billCount: 1 });
        api.getTablesState!.mockResolvedValue([
          table("t4", "4", staying),
          table("t5", "5", left),
          table7,
        ]);
        api.getPartyBills!.mockResolvedValue([partyBill("b2", 2, "20.00")]);
        refuse(lost());
        await flush(el, 8);

        expect(banner(el)).toBeNull();
        expect(refusal(el)).toBeNull();
        expect(panelOpen(el)).toBe(false);
        expect(tableOrder(el)!.splitRefusal).toBeNull();
        expect(tableOrder(el)!.orderId).toBe("b2");
      });

      it("the re-read shows the table still held: table.error at the bottom, the panel reopened", async () => {
        const { el, refuse } = await requestOut("b2");
        const before = reads();
        refuse(lost());
        await flush(el, 8);

        expect(said(el)).toBe(t("table.error"));
        expect(banner(el)).toBeNull();
        expect(tickBox(el, "b2").checked).toBe(true);
        expect(reads().floor).toBeGreaterThan(before.floor);
        expect(reads().bills).toBeGreaterThan(before.bills);
      });

      it("the re-read failing too says the same, and the next press's party.out_of_date as its row says", async () => {
        const { el, refuse } = await requestOut("b2");
        api.getTablesState!.mockRejectedValue(lost());
        api.getPartyBills!.mockRejectedValue(lost());
        refuse(lost());
        await flush(el, 8);

        expect(said(el)).toBe(t("table.error"));
        expect(banner(el)).toBeNull();
        expect(tickBox(el, "b2").checked).toBe(true);

        api.getTablesState!.mockResolvedValue(tables);
        api.getPartyBills!.mockResolvedValue(bills());
        api.splitTable!.mockRejectedValue({ code: "party.out_of_date" });
        await pressSplit(el);
        await flush(el, 6);

        expect(api.splitTable).toHaveBeenCalledTimes(2);
        expect(said(el)).toBeTruthy();
        expect(said(el)).not.toBe(t("table.error"));
        expect(banner(el)).toBeNull();
      });
    });

    describe("the table no longer held after a re-read", () => {
      it("party.out_of_date: the banner, no panel", async () => {
        const { el, refuse } = await requestOut("b2");
        api.getTablesState!.mockResolvedValue(oneTableFloor());
        refuse({ code: "party.out_of_date" });
        await flush(el, 8);

        expect(banner(el)).not.toBeNull();
        expect(panelOpen(el)).toBe(false);
        expect(tableOrder(el)!.splitRefusal).toBeNull();
      });

      it.each(["draft.out_of_date", "draft.taken_over"])(
        "%s: the banner in its own words, no panel",
        async (code) => {
          const { el, refuse } = await requestOut("b2");
          let answerDrafts = () => {};
          const reading = server.listDrafts("v1");
          api.listDrafts!.mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                answerDrafts = () => void reading.then(resolve);
              }),
          );
          refuse({ code, billId: "b2", ownerId: "p2", ownerName: "Luis" });
          await flush(el, 6);
          expect(banner(el)).toBeNull();

          api.getTablesState!.mockResolvedValue(oneTableFloor());
          emit(tableOrder(el)!, "name-party", { name: "Ana" });
          await flush(el, 6);
          answerDrafts();
          await flush(el, 6);

          expect(banner(el)!.textContent).toContain(codeMessage(code));
          expect(panelOpen(el)).toBe(false);
          expect(tableOrder(el)!.splitRefusal).toBeNull();
        },
      );

      it("a refusal with a code and a table gone from the party: the banner, no panel", async () => {
        const { el, refuse } = await requestOut("b2");
        api.getTablesState!.mockResolvedValue(oneTableFloor());
        emit(tableOrder(el)!, "name-party", { name: "Ana" });
        await flush(el, 6);

        refuse({ code: "table.not_shared" });
        await flush(el, 6);

        expect(banner(el)!.textContent).toContain(codeMessage("table.not_shared"));
        expect(panelOpen(el)).toBe(false);
      });
    });

    describe("Refund on the bill it names", () => {
      const paid = (workingOrderId: string, id: string): BillBalance => ({
        ...balance(workingOrderId, "20.00"),
        received: "20.00",
        outstanding: "0.00",
        payments: [
          {
            id,
            submissionId: `sub-${id}`,
            kind: "contribution",
            shareOf: null,
            method: "cash",
            entry: null,
            applied: "20.00",
            tip: "0.00",
            tendered: "20.00",
            change: "0.00",
            state: "received",
            createdAt: "2026-09-30T20:00:00.000Z",
            receivedAt: "2026-09-30T20:00:00.000Z",
            lines: [],
            refunds: [],
          },
        ],
      });
      const excess = (workingOrderId: string) => ({
        code: "bill.received_exceeds_total",
        workingOrderId,
        excess: "5.00",
      });
      const paidBills = () => [
        partyBill("wo-4", 1, "20.00", { hasPayments: true }),
        partyBill("b2", 2, "20.00", { hasPayments: true }),
      ];
      const withPayments = (error: unknown) => ({
        ...refused(error),
        getPartyBills: vi.fn().mockResolvedValue(paidBills()),
        getBillBalance: vi.fn(async (id: string) => paid(id, `pay-${id}`)),
      });
      const refundButton = (el: TillApp) =>
        refusal(el)!.querySelector<HTMLElement>("[data-refund-excess]")!;
      const refundDialog = (el: TillApp) =>
        el.shadowRoot!.querySelector<TillBillRefundDialog>("till-bill-refund-dialog");
      const amountOf = (dialog: TillBillRefundDialog) =>
        dialog.shadowRoot!.querySelector<HTMLElement & { value: string }>(
          'wt-input[name="amount"]',
        )!.value;

      it("Refund, bill on screen: the bottom message offers it and the dialog opens on that bill", async () => {
        const el = await panelWith(withPayments(excess("wo-4")));
        await tick(el, "wo-4");
        await pressSplit(el);

        expect(said(el)).toContain(
          t("bill.refund_excess").replace("{amount}", formatMoney("5.00", currentLocale())),
        );
        expect(banner(el)).toBeNull();
        expect(said(el)).not.toContain("Bill 1:");
        refundButton(el).click();
        await flush(el, 6);

        expect(tableOrder(el)!.orderId).toBe("wo-4");
        expect(refundDialog(el)!.payment.id).toBe("pay-wo-4");
        expect(amountOf(refundDialog(el)!)).toBe("5.00");
        expect(panelOpen(el)).toBe(true);
        expect(tickBox(el, "wo-4").checked).toBe(true);
      });

      it("Refund, bill not on screen: named in front, Discard switches and the dialog offers that bill's payment", async () => {
        const el = await panelWith(withPayments(excess("b2")));
        await tick(el, "b2");
        await pressSplit(el);

        expect(said(el)!.startsWith("Bill 2: ")).toBe(true);
        expect(tableOrder(el)!.orderId).toBe("wo-4");
        refundButton(el).click();
        await flush(el);
        expect(refundDialog(el)).toBeNull();
        await answer(el, "discard");

        expect(tableOrder(el)!.orderId).toBe("b2");
        expect(refundDialog(el)!.payment.id).toBe("pay-b2");
        expect(amountOf(refundDialog(el)!)).toBe("5.00");
      });

      it("Refund, bill not on screen: Keep switches nothing, opens nothing and the ticks stay", async () => {
        const el = await panelWith(withPayments(excess("b2")));
        await tick(el, "b2");
        await pressSplit(el);

        refundButton(el).click();
        await flush(el);
        await answer(el, "keep");

        expect(tableOrder(el)!.orderId).toBe("wo-4");
        expect(refundDialog(el)).toBeNull();
        expect(tickBox(el, "b2").checked).toBe(true);
        expect(said(el)!.startsWith("Bill 2: ")).toBe(true);
      });

      it("refund-excess sends billId: the event names the bill the refusal named, not the bill on screen", async () => {
        const el = await panelWith(withPayments(excess("b2")));
        await tick(el, "b2");
        await pressSplit(el);
        const heard: unknown[] = [];
        tableOrder(el)!.addEventListener("refund-excess", (event) =>
          heard.push((event as CustomEvent).detail),
        );

        refundButton(el).click();
        await flush(el);
        await answer(el, "discard");

        expect(heard).toEqual([{ excess: "5.00", billId: "b2", bill: "Bill 2" }]);
      });

      it("Refund for a bill the re-read no longer lists says it has left, opens nothing and keeps the panel", async () => {
        const el = await panelWith(withPayments(excess("b2")));
        await tick(el, "b2");
        api.getPartyBills!.mockResolvedValue([paidBills()[0]!]);
        api.getSplitSources!.mockResolvedValue({ partyRevision: 3, bills: [answered().bills[0]!] });
        await pressSplit(el);
        await flush(el, 6);

        refundButton(el).click();
        await flush(el, 6);

        expect(said(el)).toBe(t("table.split_bill_gone").replace("{bill}", "Bill 2"));
        expect(panelOpen(el)).toBe(true);
        expect(refundDialog(el)).toBeNull();
        expect(tableOrder(el)!.orderId).toBe("wo-4");
      });

      it("Refund for a bill that has left says so once: the next press sends", async () => {
        const el = await panelWith(withPayments(excess("b2")));
        await tick(el, "b2");
        api.getPartyBills!.mockResolvedValue([paidBills()[0]!]);
        api.getSplitSources!.mockResolvedValue({ partyRevision: 3, bills: [answered().bills[0]!] });
        await pressSplit(el);
        await flush(el, 6);
        refundButton(el).click();
        await flush(el, 6);
        const gone = t("table.split_bill_gone").replace("{bill}", "Bill 2");
        expect(said(el)).toBe(gone);
        expect(api.splitTable).toHaveBeenCalledOnce();

        await pressSplit(el);

        expect(api.splitTable).toHaveBeenCalledTimes(2);
        expect(said(el)).not.toBe(gone);
      });

      it("an excess refusal from Move dishes, with no billId, behaves as today", async () => {
        const el = await mounted("desktop", {
          getPartyBills: vi.fn().mockResolvedValue(paidBills()),
          getBillBalance: vi.fn(async (id: string) => paid(id, `pay-${id}`)),
          moveDishes: vi
            .fn()
            .mockRejectedValue({ code: "bill.received_exceeds_total", excess: "5.00" }),
        });
        emit(tableOrder(el)!, "move-dishes", { lineIds: ["soup"], toBillId: null });
        await flush(el, 6);

        const button = banner(el)!.querySelector<HTMLElement>("[data-refund-excess]")!;
        expect(banner(el)!.textContent).not.toContain("Bill");
        button.click();
        await flush(el, 6);

        expect(tableOrder(el)!.orderId).toBe("wo-4");
        expect(refundDialog(el)!.payment.id).toBe("pay-wo-4");
      });

      it("the banner's Refund, Discard: switches to that bill and offers its payment", async () => {
        const { el, refuse } = await requestOut("b2", {
          getPartyBills: vi
            .fn()
            .mockResolvedValue([
              partyBill("wo-4", 1, "10.00"),
              partyBill("b2", 2, "20.00", { hasPayments: true }),
            ]),
          getBillBalance: vi.fn(async (id: string) => paid(id, `pay-${id}`)),
        });
        await openMoveDishes(el);
        await pickMoveDish(el);
        refuse(excess("b2"));
        await flush(el, 6);

        banner(el)!.querySelector<HTMLElement>("[data-refund-excess]")!.click();
        await flush(el);
        await answer(el, "discard");

        await expect.poll(() => tableOrder(el)!.orderId).toBe("b2");
        expect(q(el, "[data-move-dishes]")).toBeNull();
        await expect.poll(() => refundDialog(el)).not.toBeNull();
      });

      it("the banner's Refund for a bill that has left says so on the banner, and leaves the work open", async () => {
        fakeTimers();
        const { el, refuse } = await requestOut("b2", {
          getPartyBills: vi
            .fn()
            .mockResolvedValue([
              partyBill("wo-4", 1, "10.00"),
              partyBill("b2", 2, "20.00", { hasPayments: true }),
            ]),
          getBillBalance: vi.fn(async (id: string) => paid(id, `pay-${id}`)),
        });
        await openMoveDishes(el);
        await pickMoveDish(el);
        refuse(excess("b2"));
        await flush(el, 6);
        const button = banner(el)!.querySelector<HTMLElement>("[data-refund-excess]")!;
        await rereadBills(el, [partyBill("wo-4", 1, "10.00")]);
        expect(button.isConnected).toBe(true);

        button.click();
        await flush(el, 6);

        expect(banner(el)!.textContent).toContain(
          t("table.split_bill_gone").replace("{bill}", "Bill 2"),
        );
        expect(movePicked(el)).toBe(true);
        expect(refundDialog(el)).toBeNull();
      });

      it("the banner's Refund for another bill, with Move dishes holding a pick, asks before it switches", async () => {
        const { el, refuse } = await requestOut("b2", {
          getPartyBills: vi
            .fn()
            .mockResolvedValue([
              partyBill("wo-4", 1, "10.00"),
              partyBill("b2", 2, "20.00", { hasPayments: true }),
            ]),
          getBillBalance: vi.fn(async (id: string) => paid(id, `pay-${id}`)),
        });
        await openMoveDishes(el);
        await pickMoveDish(el);
        refuse(excess("b2"));
        await flush(el, 6);

        banner(el)!.querySelector<HTMLElement>("[data-refund-excess]")!.click();
        await flush(el);
        expect(tableOrder(el)!.orderId).toBe("wo-4");
        await answer(el, "keep");

        expect(tableOrder(el)!.orderId).toBe("wo-4");
        expect(movePicked(el)).toBe(true);
        expect(refundDialog(el)).toBeNull();
      });
    });

    describe("a refusal while other work is open", () => {
      const noField = { code: "table.not_shared" };

      it("Move dishes holding a pick stays, and the sentence goes on the banner once the read is done", async () => {
        const { el, refuse } = await requestOut("b2");
        await openMoveDishes(el);
        await pickMoveDish(el);
        const release = holdBills();
        refuse({ code: "bill.line_paid", workingOrderId: "b2" });
        await flush(el, 6);
        expect(banner(el)).toBeNull();

        release();
        await flush(el, 6);

        expect(q(el, "[data-move-dishes]")).not.toBeNull();
        expect(movePicked(el)).toBe(true);
        expect(panelOpen(el)).toBe(false);
        expect(refusal(el)).toBeNull();
        expect(tableOrder(el)!.splitRefusal).toBeNull();
        expect(banner(el)!.textContent).toContain(onBill("Bill 2", "bill.line_paid"));
      });

      it("Move dishes' leave question stays open", async () => {
        const { el, refuse } = await requestOut("b2");
        await openMoveDishes(el);
        await pickMoveDish(el);
        await press(el, "[data-action-back]");
        await expect.poll(() => unsavedQuestion(el).open).toBe(true);

        refuse(noField);
        await flush(el, 6);

        expect(unsavedQuestion(el).open).toBe(true);
        expect(q(el, "[data-move-dishes]")).not.toBeNull();
        expect(banner(el)!.textContent).toContain(codeMessage("table.not_shared"));
        expect(tableOrder(el)!.splitRefusal).toBeNull();
      });

      it("a second Split panel holding a tick stays, and keeps reading", async () => {
        fakeTimers();
        const threeTables = party({ tableIds: ["t4", "t5", "t7"], billCount: 2 });
        const { el, refuse } = await requestOut("b2", {
          getTablesState: vi
            .fn()
            .mockResolvedValue([
              table("t4", "4", threeTables),
              table("t5", "5", threeTables),
              table("t7", "7", threeTables),
            ]),
        });
        await press(el, "[data-move-split]");
        await press(el, '[data-action="split-table"]');
        await press(el, '[data-target="t7"]');
        await tick(el, "wo-4");

        refuse(noField);
        await flush(el, 6);

        expect(tickBox(el, "wo-4").checked).toBe(true);
        expect(tickBox(el, "b2").checked).toBe(false);
        expect(refusal(el)).toBeNull();
        expect(banner(el)!.textContent).toContain(codeMessage("table.not_shared"));

        const sources = api.getSplitSources!.mock.calls.length;
        await rereadBills(el, bills(5));
        expect(api.getSplitSources!.mock.calls.length).toBeGreaterThan(sources);
      });

      it("a refusal naming a count: seat.guest_count_invalid on the banner", async () => {
        const { el, refuse } = await requestOut("b2");
        await openMoveDishes(el);
        await pickMoveDish(el);

        refuse({ code: "management.request_invalid", field: "guestCounts.leaving" });
        await flush(el, 6);

        expect(banner(el)!.textContent).toContain(t("seat.guest_count_invalid"));
        expect(q(el, "[data-move-dishes]")).not.toBeNull();
      });

      it("draft.taken_over: table.split_changed naming the bill on the banner", async () => {
        const { el, refuse } = await requestOut("b2");
        await openMoveDishes(el);
        await pickMoveDish(el);
        server.drafts.push(savedDraft("b2", "p2", "Luis"));

        refuse({ code: "draft.taken_over", billId: "b2", ownerId: "p2", ownerName: "Luis" });
        await flush(el, 6);

        expect(banner(el)!.textContent).toContain(changedWords("Bill 2"));
        expect(q(el, "[data-move-dishes]")).not.toBeNull();
      });

      it("a refusal carrying recoveryUrl: the banner's link, in the banner's colour", async () => {
        const { el, refuse } = await requestOut("b2");
        await openMoveDishes(el);
        await pickMoveDish(el);

        refuse({ code: "sif.allocation_invalid", recoveryUrl: "/manage/recovery/fiscal-conflict" });
        await flush(el, 6);

        expect(banner(el)!.querySelector("[data-recovery]")!.getAttribute("style")).toContain(
          "--wt-color-on-danger",
        );
      });

      it("an untouched open step: the panel reopens, with no banner", async () => {
        const { el, refuse } = await requestOut("b2");
        await openMoveDishes(el);

        refuse(noField);
        await flush(el, 6);

        expect(q(el, "[data-move-dishes]")).toBeNull();
        expect(tickBox(el, "b2").checked).toBe(true);
        expect(said(el)).toBe(codeMessage("table.not_shared"));
        expect(banner(el)).toBeNull();
      });

      it("a declined refusal that is no longer splitRefusal, because Split was pressed again, says nothing", async () => {
        const el = await refusedOn("b2", noField);
        const old = tableOrder(el)!.splitRefusal!;
        api.splitTable!.mockResolvedValue({ partyId: "v1", billIds: ["b2"] });
        await pressSplit(el);
        expect(tableOrder(el)!.splitRefusal).toBeNull();

        emit(tableOrder(el)!, "split-refusal-declined", { refusal: old });
        await flush(el);

        expect(banner(el)).toBeNull();
      });

      it("split-refusal-declined leaves nothing of the refusal to reopen later", async () => {
        const { el, refuse } = await requestOut("b2");
        await openMoveDishes(el);
        await pickMoveDish(el);
        refuse(noField);
        await flush(el, 6);
        expect(tableOrder(el)!.splitRefusal).toBeNull();

        await press(el, "[data-action-back]");
        await answer(el, "discard");
        await flush(el, 6);

        expect(panelOpen(el)).toBe(false);
      });
    });

    describe("a language change", () => {
      const noField = { code: "table.not_shared" };
      const spanish = (el: TillApp) => emit(shell(el), "wt-locale-selected", { code: "es-ES" });

      function heldSave() {
        let save: { resolve: () => void; reject: (error: unknown) => void };
        const held = new Promise<void>((resolve, reject) => (save = { resolve, reject }));
        return { putLocale: vi.fn(() => held), save: () => save };
      }

      /** A later bills read showing a changed revision is what makes a watched panel read again. */
      async function sourcesReadByNextBillsRead(el: TillApp): Promise<number> {
        const before = api.getSplitSources!.mock.calls.length;
        await rereadBills(el, bills(7));
        return api.getSplitSources!.mock.calls.length - before;
      }

      it("A803 split: a refusal landing while the language saves is said on the banner in the new language, and the reads stop", async () => {
        fakeTimers();
        const { putLocale, save } = heldSave();
        const { el, refuse } = await requestOut("b2", { putLocale });
        spanish(el);
        await flush(el);
        expect(putLocale).toHaveBeenCalledOnce();
        refuse(noField);
        await flush(el, 6);
        expect(panelOpen(el)).toBe(true);
        expect(said(el)).toBe(codeMessage("table.not_shared"));

        save().resolve();
        await flush(el, 6);

        expect(currentLocale()).toBe("es-ES");
        expect(panelOpen(el)).toBe(false);
        expect(banner(el)!.textContent).toContain(codeMessage("table.not_shared", "es-ES"));
        expect(api.splitTable).toHaveBeenCalledOnce();
        expect(await sourcesReadByNextBillsRead(el)).toBe(0);
      });

      it("A803 split: a refusal landing while a language save fails stays on its panel", async () => {
        const { putLocale, save } = heldSave();
        const { el, refuse } = await requestOut("b2", { putLocale });
        const before = currentLocale();
        spanish(el);
        await flush(el);
        refuse(noField);
        await flush(el, 6);

        save().reject({ code: "locale.unsupported" });
        await flush(el, 6);

        expect(currentLocale()).toBe(before);
        expect(panelOpen(el)).toBe(true);
        expect(said(el)).toBe(codeMessage("table.not_shared"));
        expect(tickBox(el, "b2").checked).toBe(true);
        expect(banner(el)!.textContent).toContain(t("locale.save_failed"));
      });

      it("A803 split: a refused panel discarded for a language says nothing more, and the reads stop", async () => {
        fakeTimers();
        const el = await refusedOn("b2", noField, {
          putLocale: vi.fn().mockResolvedValue(undefined),
        });
        expect(said(el)).toBe(codeMessage("table.not_shared"));

        spanish(el);
        await answer(el, "discard");

        expect(currentLocale()).toBe("es-ES");
        expect(panelOpen(el)).toBe(false);
        expect(banner(el)).toBeNull();
        expect(await sourcesReadByNextBillsRead(el)).toBe(0);
      });

      it("A803 split: the refused panel's reads carry on while it stays open", async () => {
        fakeTimers();
        const el = await refusedOn("b2", noField);
        expect(await sourcesReadByNextBillsRead(el)).toBe(1);
      });

      it.each(["locked", "the next person signed in"])(
        "A803 split: a language save finishing after a sign-out puts nothing on the banner, %s",
        async (state) => {
          const { putLocale, save } = heldSave();
          const { el, refuse } = await requestOut("b2", { putLocale });
          spanish(el);
          await flush(el);
          refuse(noField);
          await flush(el, 6);
          expect(said(el)).toBe(codeMessage("table.not_shared"));
          emit(shell(el), "logout");
          await answer(el, "discard");
          if (state !== "locked") {
            emit(lock(el), "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
            await flush(el);
          }

          save().resolve();
          await flush(el, 6);

          expect(el.shadowRoot!.querySelector(".error")).toBeNull();
        },
      );

      it("A803 split: a request answered after the language changed still reopens its panel", async () => {
        const { el, refuse } = await requestOut("b2", {
          putLocale: vi.fn().mockResolvedValue(undefined),
        });
        spanish(el);
        await flush(el, 6);
        expect(currentLocale()).toBe("es-ES");

        refuse(noField);
        await flush(el, 6);

        expect(panelOpen(el)).toBe(true);
        expect(tickBox(el, "b2").checked).toBe(true);
        expect(banner(el)).toBeNull();
      });
    });

    describe("a failed re-read after a refusal", () => {
      it("reopens with the last rows and Split enabled", async () => {
        const el = await panelWith(refused({ code: "tab.split_held_line", tabId: "b2" }));
        await tick(el, "b2");
        api.getSplitSources!.mockRejectedValue(new TypeError("Failed to fetch"));
        await pressSplit(el);

        expect(picker(el)).not.toBeNull();
        expect(tickBox(el, "b2").checked).toBe(true);
        expect(splitButton(el).disabled).toBe(false);
        expect(said(el)).toBe(t("table.split_held_error"));
        expect(bottom(el).error).toBe("");
      });
    });

    describe("a failed bills read never empties an open panel", () => {
      const failing = () => api.getPartyBills!.mockRejectedValue(new TypeError("Failed to fetch"));

      it("on a merge's read while the panel is open: rows, ticks and Split as they were, with no words", async () => {
        const el = await panelWith({ mergeBills: vi.fn().mockResolvedValue({}) });
        await tick(el, "b2");
        failing();
        emit(tableOrder(el)!, "merge-bills", { fromBillId: "b2" });
        await flush(el, 6);

        expect(tableOrder(el)!.bills.length).toBe(2);
        expect(tickBox(el, "b2").checked).toBe(true);
        expect(splitButton(el).disabled).toBe(false);
        expect(refusal(el)).toBeNull();
        expect(bottom(el).error).toBe("");
      });

      it("on a lost reply's re-read: the panel reopens with its rows", async () => {
        const { el, refuse } = await requestOut("b2");
        failing();
        refuse(new TypeError("Failed to fetch"));
        await flush(el, 8);

        expect(tableOrder(el)!.bills.length).toBe(2);
        expect(tickBox(el, "b2").checked).toBe(true);
        expect(said(el)).toBe(t("table.error"));
      });

      it("still empties the list with no panel open or due", async () => {
        server.bills.add("b2");
        const el = await mounted("desktop", { mergeBills: vi.fn().mockResolvedValue({}) });
        failing();
        emit(tableOrder(el)!, "merge-bills", { fromBillId: "b2" });
        await flush(el, 6);

        expect(tableOrder(el)!.bills).toEqual([]);
      });
    });

    describe("Cancelling the different-people question", () => {
      const limited = () => ({
        getTill: vi.fn().mockResolvedValue({ ...till("till"), simplifiedInvoiceLimit: "15.00" }),
      });
      const question = (el: TillApp) =>
        el.shadowRoot!.querySelector<HTMLElement>("[data-confirm-different-people]");

      it("reopens the panel with its ticks, picks and counts, no words, and sends nothing", async () => {
        const el = await panelWith({
          ...limited(),
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
        await pickDish(el, "b2", "steak");
        const leaving = q(el, 'wt-number-stepper[name="leavingGuests"]')!.shadowRoot!.querySelector(
          "input",
        )!;
        leaving.value = "2";
        leaving.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        await pressSplit(el);
        expect(question(el)).not.toBeNull();
        expect(panelOpen(el)).toBe(false);

        question(el)!.querySelector<HTMLElement>("[data-cancel]")!.click();
        await flush(el, 6);

        expect(question(el)).toBeNull();
        expect(panelOpen(el)).toBe(true);
        expect(tableOrder(el)!.splitRefusal).toMatchObject({
          selection: { wholeBillIds: [], loose: [{ billId: "b2", lineIds: ["steak"] }] },
          leaving: "2",
        });
        expect(
          String(
            q<HTMLElementTagNameMap["wt-number-stepper"]>(
              el,
              'wt-number-stepper[name="leavingGuests"]',
            )!.value,
          ),
        ).toBe("2");
        expect(refusal(el)).toBeNull();
        expect(bottom(el).error).toBe("");
        expect(banner(el)).toBeNull();
        expect(api.splitTable).not.toHaveBeenCalled();
      });

      it("keeps what the waiter had seen: a bill moved under the question still stops the next press", async () => {
        const { moved, listDrafts } = draftsMoving("b2");
        const el = await panelWith({
          ...limited(),
          listDrafts,
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
        await pickDish(el, "b2", "steak");
        await pressSplit(el);
        expect(question(el)).not.toBeNull();
        moved.now = true;
        await refreshDrafts(el);

        question(el)!.querySelector<HTMLElement>("[data-cancel]")!.click();
        await flush(el, 6);
        await pressSplit(el);

        expect(question(el)).toBeNull();
        expect(refusal(el)!.textContent).toContain(changedWords("Bill 2"));
        expect(api.splitTable).not.toHaveBeenCalled();
      });
    });

    describe("a refusal arriving while the screen is out of the page", () => {
      function takeOut(el: TillApp) {
        const screen = tableOrder(el)!;
        const parent = screen.parentNode!;
        const next = screen.nextSibling;
        screen.remove();
        return () => parent.insertBefore(screen, next);
      }

      it("waits for put-back, then the panel reopens with its ticks", async () => {
        const { el, refuse } = await requestOut("b2");
        const screen = tableOrder(el)!;
        const putBack = takeOut(el);
        refuse({ code: "table.not_shared" });
        await flush(el, 6);
        expect(banner(el)).toBeNull();
        expect(screen.shadowRoot!.querySelector("[data-split-pick]")).toBeNull();

        putBack();
        await flush(el, 6);

        expect(tickBox(el, "b2").checked).toBe(true);
        expect(said(el)).toBe(codeMessage("table.not_shared"));
        expect(banner(el)).toBeNull();
      });

      it("waits for put-back, then is declined if a step holds work", async () => {
        const { el, refuse } = await requestOut("b2");
        await openMoveDishes(el);
        await pickMoveDish(el);
        const putBack = takeOut(el);
        refuse({ code: "table.not_shared" });
        await flush(el, 6);
        expect(banner(el)).toBeNull();

        putBack();
        await flush(el, 6);

        expect(movePicked(el)).toBe(true);
        expect(banner(el)!.textContent).toContain(codeMessage("table.not_shared"));
        expect(tableOrder(el)!.splitRefusal).toBeNull();
      });
    });

    describe("the till taken off the page while a refusal's read is out, and put back", () => {
      type Read = "listDrafts" | "getTablesState";
      async function refusedThenOff(binding: Binding, error: unknown, read: Read) {
        server.bills.add("b2");
        const el = await mounted(binding, { splitTable: vi.fn().mockRejectedValue(error) });
        await toPanel(el);
        await tick(el, "b2");
        await hungThenOff(el, read, () => pressSplit(el));
        return el;
      }

      /** `act` with `read` never answering, then the till off the page and back, the read answering. */
      async function hungThenOff(el: TillApp, read: Read, act: () => Promise<void>) {
        const answers = api[read]!.getMockImplementation()!;
        api[read]!.mockImplementation(() => new Promise(() => {}));
        await act();
        expect(refusal(el)).toBeNull();
        const parent = el.parentNode!;
        el.remove();
        await flush(el, 6);
        api[read]!.mockImplementation(answers as never);
        parent.appendChild(el);
        await flush(el, 6);
      }

      it.each([
        [
          "draft.out_of_date",
          { code: "draft.out_of_date", billId: "b2" },
          "listDrafts",
          () => changedWords("Bill 2"),
        ],
        [
          "a lost reply",
          new TypeError("Failed to fetch"),
          "getTablesState",
          () => t("table.error"),
        ],
        ["party.out_of_date", { code: "party.out_of_date" }, "getTablesState", null],
      ] as const)(
        "%s, on a handheld, which stays on the order: the sentence once it is back",
        async (_case, error, read, words) => {
          const el = await refusedThenOff("handheld", error, read);

          expect(refusal(el), "the sentence").not.toBeNull();
          if (words !== null) expect(refusal(el)!.textContent).toContain(words());
          expect(tickBox(el, "b2").checked).toBe(true);
          expect(banner(el)?.textContent?.trim() ?? "").toBe("");
          expect(api.splitTable).toHaveBeenCalledOnce();
        },
      );

      it("the till's own stop at Send, on a handheld: the sentence once it is back, and no request", async () => {
        server.bills.add("b2");
        const { moved, listDrafts } = draftsMoving("b2");
        const el = await mounted("handheld", {
          listDrafts,
          splitTable: vi.fn().mockResolvedValue({ partyId: "v-split", billIds: ["b2"] }),
        });
        await toPanel(el);
        await tick(el, "b2");
        moved.now = true;
        await refreshDrafts(el);
        await hungThenOff(el, "listDrafts", () => pressSplit(el));

        expect(refusal(el)!.textContent).toContain(changedWords("Bill 2"));
        expect(api.splitTable).not.toHaveBeenCalled();
      });

      it("control: on a desktop, put back on the floor, the order left: nothing said", async () => {
        const el = await refusedThenOff(
          "desktop",
          { code: "draft.out_of_date", billId: "b2" },
          "listDrafts",
        );

        expect(tableOrder(el)).toBeNull();
        expect(banner(el)?.textContent ?? "").not.toContain(changedWords("Bill 2"));
        expect(banner(el)?.textContent ?? "").not.toContain(codeMessage("draft.out_of_date"));
        expect(api.splitTable).toHaveBeenCalledOnce();
      });
    });

    describe("the read after a refusal", () => {
      it("a later bills read with a changed revision reads the sources again", async () => {
        fakeTimers();
        const el = await refusedOn("b2", { code: "table.not_shared" });
        const sources = api.getSplitSources!.mock.calls.length;

        await rereadBills(el, bills(5));

        expect(api.getSplitSources!.mock.calls.length).toBeGreaterThan(sources);
      });

      it("a panel reopened on being put back into the page is watched too", async () => {
        fakeTimers();
        const { el, refuse } = await requestOut("b2");
        const screen = tableOrder(el)!;
        const parent = screen.parentNode!;
        const next = screen.nextSibling;
        screen.remove();
        refuse({ code: "table.not_shared" });
        await flush(el, 6);
        el.requestUpdate();
        await flush(el);
        parent.insertBefore(screen, next);
        await flush(el, 6);
        expect(said(el)).toBe(codeMessage("table.not_shared"));
        const sources = api.getSplitSources!.mock.calls.length;

        await rereadBills(el, bills(5));

        expect(api.getSplitSources!.mock.calls.length).toBeGreaterThan(sources);
      });

      it("a party with no sync gets its 15-second read back", async () => {
        fakeTimers();
        const noBill = party({ tableIds: ["t4", "t5"], billCount: 0, openingBillId: null });
        const el = await mounted("desktop", {
          getTablesState: vi
            .fn()
            .mockResolvedValue([table("t4", "4", noBill), table("t5", "5", noBill), table7]),
          getPartyBills: vi.fn().mockResolvedValue([]),
          getSplitSources: vi.fn().mockResolvedValue({ partyRevision: 3, bills: [] }),
          ...refused({ code: "table.not_shared" }),
        });
        await toPanel(el);
        await pressSplit(el);
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el, 6);
        expect(said(el)).toBe(codeMessage("table.not_shared"));

        const before = api.getPartyBills!.mock.calls.length;
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el, 6);

        expect(api.getPartyBills!.mock.calls.length).toBeGreaterThan(before);
      });

      it("leaving the reopened panel stops both", async () => {
        fakeTimers();
        const noBill = party({ tableIds: ["t4", "t5"], billCount: 0, openingBillId: null });
        const el = await mounted("desktop", {
          getTablesState: vi
            .fn()
            .mockResolvedValue([table("t4", "4", noBill), table("t5", "5", noBill), table7]),
          getPartyBills: vi.fn().mockResolvedValue([]),
          getSplitSources: vi.fn().mockResolvedValue({ partyRevision: 3, bills: [] }),
          ...refused({ code: "table.not_shared" }),
        });
        await toPanel(el);
        await pressSplit(el);
        await press(el, "[data-action-back]");
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el, 6);
        const before = reads();

        await vi.advanceTimersByTimeAsync(30_000);
        await flush(el, 6);

        expect(reads().bills).toBe(before.bills);
        expect(reads().sources).toBe(before.sources);
      });
    });

    describe("rows and revisions after a refusal", () => {
      const lost = () => new TypeError("Failed to fetch");
      const heading = (el: TillApp) => q(el, "[data-split-pick] h2")!.textContent ?? "";
      const atRevision = (revision: number) => {
        const later = party({ tableIds: ["t4", "t5"], billCount: 2, revision });
        return [table("t4", "4", later), table("t5", "5", later), table7];
      };
      const sentRevision = (call: number) => api.splitTable!.mock.calls[call]![3];
      const rowsAt = (partyRevision: number) => ({ ...answered(), partyRevision });

      it("party.out_of_date with the bills as they were: the reopening reads, and the second press carries that read's revision", async () => {
        const el = await panelWith({
          splitTable: vi
            .fn()
            .mockRejectedValueOnce({ code: "party.out_of_date" })
            .mockResolvedValue({ partyId: "v-split", billIds: ["b2"] }),
        });
        await tick(el, "b2");
        api.getTablesState!.mockResolvedValue(atRevision(7));
        api.getSplitSources!.mockResolvedValue(rowsAt(9));

        await pressSplit(el);
        await pressSplit(el);

        expect(sentRevision(0)).toBe(3);
        expect(sentRevision(1)).toBe(9);
      });

      it("a refused count's reopening reads what moved meanwhile", async () => {
        const { el, refuse } = await requestOut("b2");
        api.getTablesState!.mockResolvedValue(atRevision(7));
        api.getSplitSources!.mockResolvedValue(rowsAt(7));
        emit(tableOrder(el)!, "name-party", { name: "Ana" });
        await flush(el, 6);
        refuse({ code: "management.request_invalid", field: "guestCounts.leaving" });
        await flush(el, 6);
        expect(tableOrder(el)!.splitRefusal).toMatchObject({ field: "leaving" });

        api.splitTable!.mockResolvedValue({ partyId: "v-split", billIds: ["b2"] });
        await pressSplit(el);

        expect(sentRevision(1)).toBe(7);
      });

      it("the till's own stop writes no revision: its retry carries the read that a rename's floor read started", async () => {
        const { moved, listDrafts } = draftsMoving("b2");
        const el = await panelWith({
          listDrafts,
          setPartyName: vi.fn().mockResolvedValue({ revision: 7 }),
        });
        await tick(el, "b2");
        api.getTablesState!.mockResolvedValue(atRevision(7));
        api.getSplitSources!.mockResolvedValue(rowsAt(9));
        emit(tableOrder(el)!, "name-party", { name: "Ana" });
        await flush(el, 6);
        moved.now = true;
        await refreshDrafts(el);

        await pressSplit(el);
        expect(api.splitTable).not.toHaveBeenCalled();
        await pressSplit(el);

        expect(sentRevision(0)).toBe(9);
      });

      it("a refusal with words clears the observations, so a bill read moving while the request was out does not stop the retry", async () => {
        const { moved, listDrafts } = draftsMoving("b2");
        let refuse: (error: unknown) => void = () => {};
        const el = await panelWith({
          listDrafts,
          splitTable: vi
            .fn()
            .mockImplementationOnce(() => new Promise((_resolve, reject) => (refuse = reject)))
            .mockResolvedValue({ partyId: "v-split", billIds: ["b2"] }),
        });
        await tick(el, "b2");
        await pressSplit(el);
        moved.now = true;
        await refreshDrafts(el);
        refuse({ code: "table.not_shared" });
        await flush(el, 6);
        expect(said(el)).toBe(codeMessage("table.not_shared"));

        await pressSplit(el);

        expect(api.splitTable).toHaveBeenCalledTimes(2);
        expect(api.splitTable!.mock.calls[1]![4]).toEqual([noEdit("b2", { editorVersion: 2 })]);
      });

      it("a lost reply with the floor read failing keeps the table names at the panel", async () => {
        const { el, refuse } = await requestOut("b2");
        api.getTablesState!.mockRejectedValue(lost());
        refuse(lost());
        await flush(el, 8);

        expect(said(el)).toBe(t("table.error"));
        expect(heading(el)).toContain("5");
        expect(q(el, "[data-split-takes]")!.textContent).toContain("5 takes");
      });

      it("party.out_of_date with the floor read failing does not say the party has gone from a table it still holds", async () => {
        const { el, refuse } = await requestOut("b2");
        api.getTablesState!.mockRejectedValue(lost());
        refuse({ code: "party.out_of_date" });
        await flush(el, 8);

        expect(panelOpen(el)).toBe(true);
        expect(said(el)).not.toContain(t("party.changed_gone"));
        expect(heading(el)).toContain("5");
      });

      it("a failed floor read with no panel open or due still empties the floor", async () => {
        const el = await mounted("desktop", {
          setPartyName: vi.fn().mockResolvedValue({ revision: 4 }),
        });
        expect(tableOrder(el)!.tables.length).toBeGreaterThan(0);
        api.getTablesState!.mockRejectedValue(lost());

        emit(tableOrder(el)!, "name-party", { name: "Ana" });
        await flush(el, 6);

        expect(tableOrder(el)!.tables).toEqual([]);
      });
    });

    describe("the table check, and who is still here", () => {
      const threeTables = party({ tableIds: ["t4", "t5", "t6"], billCount: 2 });
      const t6 = table("t6", "6", threeTables);
      const onThree = () => [
        table("t4", "4", threeTables),
        table("t5", "5", threeTables),
        t6,
        table7,
      ];

      it("a table gone with two left: the banner, no panel", async () => {
        const { el, refuse } = await requestOut("b2", {
          getTablesState: vi.fn().mockResolvedValue(onThree()),
        });
        const left = party({ tableIds: ["t4", "t6"], billCount: 2, revision: 8 });
        api.getTablesState!.mockResolvedValue([
          table("t4", "4", left),
          table("t5", "5", null),
          table("t6", "6", left),
          table7,
        ]);
        emit(tableOrder(el)!, "name-party", { name: "Ana" });
        await flush(el, 6);

        refuse({ code: "table.not_shared" });
        await flush(el, 6);

        expect(banner(el)!.textContent).toContain(codeMessage("table.not_shared"));
        expect(panelOpen(el)).toBe(false);
        expect(tableOrder(el)!.splitRefusal).toBeNull();
      });

      it("the till's own comparison with the party left on one table: the banner, no panel, no request", async () => {
        const { moved, listDrafts } = draftsMoving("b2");
        const el = await panelWith({
          listDrafts,
          setPartyName: vi.fn().mockResolvedValue({ revision: 99 }),
        });
        await tick(el, "b2");
        moved.now = true;
        await refreshDrafts(el);
        let answerDrafts = () => {};
        const reading = listDrafts("v1");
        listDrafts.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              answerDrafts = () => void reading.then(resolve);
            }) as ReturnType<typeof listDrafts>,
        );

        await pressSplit(el);
        api.getTablesState!.mockResolvedValue(oneTableFloor());
        emit(tableOrder(el)!, "name-party", { name: "Ana" });
        await flush(el, 6);
        answerDrafts();
        await flush(el, 6);

        expect(api.splitTable).not.toHaveBeenCalled();
        expect(banner(el)!.textContent).toContain(codeMessage("draft.out_of_date"));
        expect(panelOpen(el)).toBe(false);
        expect(tableOrder(el)!.splitRefusal).toBeNull();
      });

      it("a refusal arriving after the API was replaced does nothing", async () => {
        const { el, refuse } = await requestOut("b2");
        const replacement = stubApi({ getTablesState: vi.fn().mockResolvedValue(tables) });
        el.api = replacement as unknown as TillApp["api"];
        await flush(el);

        refuse({ code: "table.not_shared" });
        await flush(el, 6);

        expect(tableOrder(el)!.splitRefusal).toBeNull();
        expect(banner(el)).toBeNull();
      });

      it("a refusal arriving on a handheld that left for the floor and came back does nothing", async () => {
        server.bills.add("b2");
        let refuse: (error: unknown) => void = () => {};
        const el = await mounted("handheld", {
          splitTable: vi.fn(() => new Promise((_resolve, reject) => (refuse = reject))),
        });
        await toPanel(el);
        await tick(el, "b2");
        await pressSplit(el);
        emit(shell(el), "screen-select", { screen: "floor" });
        await flush(el);
        emit(shell(el), "screen-select", { screen: "order" });
        await flush(el);
        expect(tableOrder(el)).not.toBeNull();

        refuse({ code: "table.not_shared" });
        await flush(el, 6);

        expect(tableOrder(el)!.splitRefusal).toBeNull();
        expect(panelOpen(el)).toBe(false);
        expect(banner(el)).toBeNull();
      });

      it("a bill switched while the request is out: the panel reopens with the sentence, and the second press sends once", async () => {
        const { el, refuse } = await requestOut("b2");
        emit(tableOrder(el)!, "take-payment", { workingOrderId: "b2" });
        await flush(el, 6);
        expect(tableOrder(el)!.orderId).toBe("b2");

        refuse({ code: "table.not_shared" });
        await flush(el, 6);
        expect(said(el)).toBe(codeMessage("table.not_shared"));
        expect(tickBox(el, "b2").checked).toBe(true);

        api.splitTable!.mockResolvedValue({ partyId: "v-split", billIds: ["b2"] });
        await pressSplit(el);
        expect(api.splitTable).toHaveBeenCalledTimes(2);
      });

      it("Cancel after the waiter moved to another bill reopens nothing", async () => {
        const el = await panelWith({
          getTill: vi.fn().mockResolvedValue({ ...till("till"), simplifiedInvoiceLimit: "15.00" }),
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
        await pickDish(el, "b2", "steak");
        await pressSplit(el);
        emit(tableOrder(el)!, "take-payment", { workingOrderId: "b2" });
        await flush(el, 6);
        expect(tableOrder(el)!.orderId).toBe("b2");

        el.shadowRoot!.querySelector<HTMLElement>(
          "[data-confirm-different-people] [data-cancel]",
        )!.click();
        await flush(el, 6);

        expect(tableOrder(el)!.splitRefusal).toBeNull();
        expect(panelOpen(el)).toBe(false);
      });
    });

    describe("what the rows were read against, across the closed panel", () => {
      const lost = () => new TypeError("Failed to fetch");
      const takes = (el: TillApp) => q(el, "[data-split-takes]")?.textContent ?? "";
      const movedSources = (): SplitSources => ({
        partyRevision: 7,
        bills: [
          { billId: "wo-4", lines: [dish("bread", 1)], balance: balance("wo-4", "10.00") },
          {
            billId: "b2",
            lines: [dish("steak", 1), dish("soup", 2)],
            balance: balance("b2", "30.00"),
          },
        ],
      });
      const movedList = () => [
        partyBill("wo-4", 1, "10.00", { revision: 1 }),
        partyBill("b2", 2, "30.00", { revision: 1 }),
      ];
      const atRevision = (revision: number) => {
        const later = party({ tableIds: ["t4", "t5"], billCount: 2, revision });
        return [table("t4", "4", later), table("t5", "5", later), table7];
      };
      /** Another till moves soup onto Bill 2, and the party's revision moves to 7. */
      function anotherTillMovesTheSoup(): void {
        api.getTablesState!.mockResolvedValue(atRevision(7));
        api.getPartyBills!.mockResolvedValue(movedList());
        api.getSplitSources!.mockResolvedValue(movedSources());
      }
      const firstRefused = (error: unknown) => ({
        splitTable: vi
          .fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValue({ partyId: "v-split", billIds: ["b2"] }),
      });

      it.each([
        ["party.out_of_date", { code: "party.out_of_date" }],
        ["a lost reply", lost()],
      ])(
        "%s: the rows show the change, and the second press carries what the waiter was shown",
        async (_name, error) => {
          const el = await panelWith(firstRefused(error));
          await tick(el, "b2");
          expect(takes(el)).toContain("20.00");
          anotherTillMovesTheSoup();

          await pressSplit(el);
          await flush(el, 6);

          expect(tickBox(el, "b2").checked).toBe(true);
          expect(takes(el)).toContain("30.00");
          expect(api.splitTable).toHaveBeenCalledOnce();
          expect(api.splitTable!.mock.calls[0]![3]).toBe(3);

          await pressSplit(el);

          expect(api.splitTable).toHaveBeenCalledTimes(2);
          expect(api.splitTable!.mock.calls[1]![2]).toEqual(whole("b2"));
          expect(api.splitTable!.mock.calls[1]![3]).toBe(7);
        },
      );

      it("party.out_of_date: a bill another till made gets its row", async () => {
        const el = await panelWith(refused({ code: "party.out_of_date" }));
        await tick(el, "b2");
        const made = partyBill("b3", 3, "5.00");
        api.getPartyBills!.mockResolvedValue([...bills(), made]);
        api.getSplitSources!.mockResolvedValue({
          partyRevision: 3,
          bills: [
            ...answered().bills,
            { billId: "b3", lines: [dish("tea", 1)], balance: balance("b3", "5.00") },
          ],
        });

        await pressSplit(el);
        await flush(el, 6);

        expect(tickBox(el, "b3")).not.toBeNull();
      });

      it("a question open across a timed read, then Cancel: the rows show the change", async () => {
        fakeTimers();
        const el = await panelWith({
          getTill: vi.fn().mockResolvedValue({ ...till("till"), simplifiedInvoiceLimit: "15.00" }),
          getSplitSources: vi.fn().mockResolvedValue({
            partyRevision: 3,
            bills: [
              { billId: "wo-4", lines: [dish("bread", 1)], balance: balance("wo-4", "10.00") },
              {
                billId: "b2",
                lines: [dish("steak", 1), dish("wine", 2)],
                balance: balance("b2", "20.00"),
              },
            ],
          }),
        });
        await pickDish(el, "b2", "steak");
        await pressSplit(el);
        expect(el.shadowRoot!.querySelector("[data-confirm-different-people]")).not.toBeNull();
        api.getSplitSources!.mockResolvedValue(movedSources());
        const sources = reads().sources;
        await rereadBills(el, movedList());
        expect(reads().sources).toBe(sources);

        el.shadowRoot!.querySelector<HTMLElement>(
          "[data-confirm-different-people] [data-cancel]",
        )!.click();
        await flush(el, 6);

        expect(reads().sources).toBe(sources + 1);
        expect(dishRows(el, "b2").querySelector('[data-pick="soup"]')).not.toBeNull();
      });

      it.each([
        ["a lost reply", lost()],
        ["table.not_shared", { code: "table.not_shared" }],
      ])("%s with nothing seen to have moved reads no sources", async (_name, error) => {
        const el = await panelWith(refused(error));
        await tick(el, "b2");
        const sources = reads().sources;

        await pressSplit(el);
        await flush(el, 6);

        expect(tableOrder(el)!.splitRefusal).not.toBeNull();
        expect(reads().sources).toBe(sources);
      });

      it("party.out_of_date reads the sources even with nothing seen to have moved: the server has said the rows are behind", async () => {
        const el = await panelWith(refused({ code: "party.out_of_date" }));
        await tick(el, "b2");
        const sources = reads().sources;

        await pressSplit(el);
        await flush(el, 6);

        expect(tableOrder(el)!.splitRefusal).not.toBeNull();
        expect(reads().sources).toBe(sources + 1);
      });

      it("a row that reads the bills and the sources reads the sources once, after the bills", async () => {
        const el = await panelWith(refused({ code: "tab.not_open", tabId: "b2" }));
        await tick(el, "b2");
        api.getPartyBills!.mockResolvedValue(movedList());
        api.getSplitSources!.mockResolvedValue(movedSources());
        const sources = reads().sources;

        await pressSplit(el);
        await flush(el, 6);

        expect(reads().sources).toBe(sources + 1);
        expect(takes(el)).toContain("30.00");
      });

      it("a press while that read is out carries the old revision, so the server decides", async () => {
        const el = await panelWith(firstRefused({ code: "party.out_of_date" }));
        await tick(el, "b2");
        anotherTillMovesTheSoup();
        const held = heldReads();
        api.getSplitSources!.mockImplementation(held.read);

        await pressSplit(el);
        await flush(el, 6);
        expect(held.calls).toHaveLength(1);
        expect(takes(el)).toContain("20.00");

        await pressSplit(el);

        expect(api.splitTable).toHaveBeenCalledTimes(2);
        expect(api.splitTable!.mock.calls[1]![3]).toBe(3);
      });

      it("once that read answers, the press carries the new revision", async () => {
        const el = await panelWith(firstRefused({ code: "party.out_of_date" }));
        await tick(el, "b2");
        anotherTillMovesTheSoup();
        const held = heldReads();
        api.getSplitSources!.mockImplementation(held.read);
        await pressSplit(el);
        await flush(el, 6);

        held.calls[0]!.answer(movedSources());
        await flush(el, 6);
        expect(takes(el)).toContain("30.00");
        await pressSplit(el);

        expect(api.splitTable!.mock.calls[1]![3]).toBe(7);
      });

      it("that read failing keeps the last rows and the old revision, and the next timed read tries again", async () => {
        fakeTimers();
        const el = await panelWith(firstRefused({ code: "party.out_of_date" }));
        await tick(el, "b2");
        anotherTillMovesTheSoup();
        api.getSplitSources!.mockRejectedValueOnce(lost());

        await pressSplit(el);
        await flush(el, 6);
        expect(takes(el)).toContain("20.00");
        expect(splitButton(el).disabled).toBe(false);

        await rereadBills(el, movedList());

        expect(takes(el)).toContain("30.00");
      });

      describe("the bills read failing while the floor read answers", () => {
        const lostBoth = [
          ["party.out_of_date", { code: "party.out_of_date" }, "table.split_updated_elsewhere"],
          ["a lost reply", lost(), "table.error"],
        ] as const;

        it.each(lostBoth)(
          "%s: the rows show the change, and the second press carries what the waiter was shown",
          async (_name, error) => {
            const el = await panelWith(firstRefused(error));
            await tick(el, "b2");
            expect(takes(el)).toContain("20.00");
            anotherTillMovesTheSoup();
            api.getPartyBills!.mockRejectedValueOnce(lost());
            const sources = reads().sources;

            await pressSplit(el);
            await flush(el, 6);

            expect(reads().sources).toBe(sources + 1);
            expect(tickBox(el, "b2").checked).toBe(true);
            expect(takes(el)).toContain("30.00");
            expect(api.splitTable!.mock.calls[0]![3]).toBe(3);

            await pressSplit(el);

            expect(api.splitTable).toHaveBeenCalledTimes(2);
            expect(api.splitTable!.mock.calls[1]![2]).toEqual(whole("b2"));
            expect(api.splitTable!.mock.calls[1]![3]).toBe(7);
          },
        );

        it.each(lostBoth)(
          "%s, the sources read failing as well: the old rows under the row's words and Split enabled, the second press carries the old revision, and the third what the waiter was shown",
          async (_name, error, words) => {
            const el = await panelWith({
              splitTable: vi
                .fn()
                .mockRejectedValueOnce(error)
                .mockRejectedValueOnce({ code: "party.out_of_date" })
                .mockResolvedValue({ partyId: "v-split", billIds: ["b2"] }),
            });
            await tick(el, "b2");
            anotherTillMovesTheSoup();
            api.getPartyBills!.mockRejectedValueOnce(lost());
            api.getSplitSources!.mockRejectedValueOnce(lost());

            await pressSplit(el);
            await flush(el, 6);

            expect(tickBox(el, "b2").checked).toBe(true);
            expect(takes(el)).toContain("20.00");
            expect(said(el)).toBe(t(words));
            expect(splitButton(el).disabled).toBe(false);

            await pressSplit(el);
            await flush(el, 6);

            expect(api.splitTable).toHaveBeenCalledTimes(2);
            expect(api.splitTable!.mock.calls[1]![3]).toBe(3);
            expect(takes(el)).toContain("30.00");

            await pressSplit(el);

            expect(api.splitTable).toHaveBeenCalledTimes(3);
            expect(api.splitTable!.mock.calls[2]![3]).toBe(7);
          },
        );

        it("the sources read failing as well, then a timed read: the rows show the change and the press carries that read's revision", async () => {
          fakeTimers();
          const el = await panelWith(firstRefused({ code: "party.out_of_date" }));
          await tick(el, "b2");
          anotherTillMovesTheSoup();
          api.getPartyBills!.mockRejectedValueOnce(lost());
          api.getSplitSources!.mockRejectedValueOnce(lost());
          await pressSplit(el);
          await flush(el, 6);

          await rereadBills(el, movedList());
          expect(takes(el)).toContain("30.00");
          await pressSplit(el);

          expect(api.splitTable!.mock.calls[1]![3]).toBe(7);
        });

        it("party.out_of_date, the rows read failing: the floor answering does not make it reloaded", async () => {
          const el = await panelWith(firstRefused({ code: "party.out_of_date" }));
          await tick(el, "b2");
          anotherTillMovesTheSoup();
          api.getPartyBills!.mockRejectedValueOnce(lost());
          api.getSplitSources!.mockRejectedValueOnce(lost());
          await pressSplit(el);
          await flush(el, 6);

          expect(takes(el)).toContain("20.00");
          expect(said(el)).toBe(t("table.split_updated_elsewhere"));
          expect(said(el)).not.toContain("reloaded");
        });

        it("party.out_of_date, the rows read failing and then a timed read answering: the rows are reloaded, and the row's own words are true again", async () => {
          fakeTimers();
          const el = await panelWith(firstRefused({ code: "party.out_of_date" }));
          await tick(el, "b2");
          anotherTillMovesTheSoup();
          api.getPartyBills!.mockRejectedValueOnce(lost());
          api.getSplitSources!.mockRejectedValueOnce(lost());
          await pressSplit(el);
          await flush(el, 6);
          expect(said(el)).toBe(t("table.split_updated_elsewhere"));

          await rereadBills(el, movedList());

          expect(takes(el)).toContain("30.00");
          expect(said(el)).toContain(t("party.changed").replace("{table}", "4, 5"));
        });

        it("party.out_of_date, the rows read answering: the row's own words, as they are true", async () => {
          const el = await panelWith(firstRefused({ code: "party.out_of_date" }));
          await tick(el, "b2");
          anotherTillMovesTheSoup();
          api.getPartyBills!.mockRejectedValueOnce(lost());
          await pressSplit(el);
          await flush(el, 6);

          expect(takes(el)).toContain("30.00");
          expect(said(el)).toContain(t("party.changed").replace("{table}", "4, 5"));
        });

        it("a later timed read failing after the rows were reloaded leaves the row's own words", async () => {
          fakeTimers();
          const el = await panelWith(firstRefused({ code: "party.out_of_date" }));
          await tick(el, "b2");
          anotherTillMovesTheSoup();
          api.getPartyBills!.mockRejectedValueOnce(lost());
          await pressSplit(el);
          await flush(el, 6);
          api.getSplitSources!.mockRejectedValueOnce(lost());

          await rereadBills(el, bills(9));

          expect(said(el)).toContain(t("party.changed").replace("{table}", "4, 5"));
        });

        it("a refused press after the rows read failed says its own words, not the old failure", async () => {
          const el = await panelWith({
            splitTable: vi
              .fn()
              .mockRejectedValueOnce({ code: "party.out_of_date" })
              .mockRejectedValueOnce({ code: "table.not_shared" }),
          });
          await tick(el, "b2");
          anotherTillMovesTheSoup();
          api.getPartyBills!.mockRejectedValueOnce(lost());
          api.getSplitSources!.mockRejectedValueOnce(lost());
          await pressSplit(el);
          await flush(el, 6);
          expect(said(el)).toBe(t("table.split_updated_elsewhere"));

          await pressSplit(el);
          await flush(el, 6);

          expect(api.splitTable).toHaveBeenCalledTimes(2);
          expect(said(el)).not.toBe(t("table.split_updated_elsewhere"));
        });

        it("with nothing changed, the reopening still reads the sources, once", async () => {
          const el = await panelWith(refused({ code: "party.out_of_date" }));
          await tick(el, "b2");
          api.getPartyBills!.mockRejectedValueOnce(lost());
          const sources = reads().sources;

          await pressSplit(el);
          await flush(el, 6);

          expect(tableOrder(el)!.splitRefusal).not.toBeNull();
          expect(reads().sources).toBe(sources + 1);
        });

        it("a bills read failing behind an open panel changes nothing: the floor's revision has started the read, and the press carries its answer", async () => {
          fakeTimers();
          const el = await panelWith(firstRefused({ code: "table.not_shared" }));
          await tick(el, "b2");
          api.getSplitSources!.mockResolvedValue({
            partyRevision: 7,
            bills: [
              ...movedSources().bills,
              { billId: "b3", lines: [dish("tea", 1)], balance: balance("b3", "5.00") },
            ],
          });
          api.getTablesState!.mockResolvedValue(atRevision(7));
          api.getPartyBills!.mockResolvedValueOnce(bills(7)).mockRejectedValueOnce(lost());
          const timed = api.getPartyBills!.mock.calls.length;
          await vi.advanceTimersByTimeAsync(15_000);
          await flush(el, 6);
          expect(api.getPartyBills!.mock.calls.length).toBe(timed + 2);
          expect(tableOrder(el)!.party?.revision).toBe(7);
          expect(takes(el)).toContain("30.00");

          await pressSplit(el);

          expect(api.splitTable!.mock.calls[0]![3]).toBe(7);
        });
      });

      describe("a reload behind the open panel", () => {
        const withNewBill = (): SplitSources => ({
          partyRevision: 7,
          bills: [
            ...movedSources().bills,
            { billId: "b3", lines: [dish("tea", 1)], balance: balance("b3", "5.00") },
          ],
        });
        const movedAgain = () => [
          partyBill("wo-4", 1, "10.00", { revision: 1 }),
          partyBill("b2", 2, "40.00", { revision: 2 }),
          partyBill("b3", 3, "5.00"),
        ];
        const newestRows = (): SplitSources => ({
          partyRevision: 9,
          bills: withNewBill().bills.map((each) =>
            each.billId === "b2" ? { ...each, balance: balance("b2", "40.00") } : each,
          ),
        });
        /** A timed read moves the list, its sources name a bill the list does not know, which starts
         * the reload, and another change has moved Bill 2 again before the reload's bills read. */
        async function reloadOverRowsBehind(
          el: TillApp,
          secondRead: (partyId: string) => Promise<SplitSources>,
        ) {
          api.getTablesState!.mockResolvedValue(atRevision(9));
          api
            .getPartyBills!.mockReset()
            .mockResolvedValueOnce(movedList())
            .mockResolvedValue(movedAgain());
          api
            .getSplitSources!.mockReset()
            .mockResolvedValueOnce(withNewBill())
            .mockImplementation(secondRead);
          await vi.advanceTimersByTimeAsync(15_000);
          await flush(el, 6);
          expect(tableOrder(el)!.party?.revision).toBe(9);
          expect(reads().sources).toBeGreaterThanOrEqual(2);
        }

        it("the rows' read failing: the press carries the rows' revision, not the floor's", async () => {
          fakeTimers();
          const el = await panelWith({});
          await tick(el, "b2");
          await reloadOverRowsBehind(el, () => Promise.reject(lost()));
          expect(takes(el)).toContain("30.00");

          await pressSplit(el);

          expect(api.splitTable).toHaveBeenCalledOnce();
          expect(api.splitTable!.mock.calls[0]![3]).toBe(7);
        });

        it("the rows' read still out: Split can be pressed over the rows it has, and carries the floor's revision once that read answers", async () => {
          fakeTimers();
          const el = await panelWith({});
          await tick(el, "b2");
          const held = heldReads();
          await reloadOverRowsBehind(el, held.read);
          expect(held.calls).toHaveLength(2);
          expect(held.calls[0]!.signal?.aborted).toBe(true);
          expect(takes(el)).toContain("30.00");
          expect(splitButton(el).disabled).toBe(false);

          held.calls[1]!.answer(newestRows());
          await flush(el, 6);
          expect(takes(el)).toContain("40.00");

          await pressSplit(el);

          expect(api.splitTable).toHaveBeenCalledOnce();
          expect(api.splitTable!.mock.calls[0]![3]).toBe(9);
        });

        it("that read failing as well: Split still sends, at the rows' revision", async () => {
          fakeTimers();
          const el = await panelWith({});
          await tick(el, "b2");
          const held = heldReads();
          await reloadOverRowsBehind(el, held.read);

          held.calls[1]!.fail();
          await flush(el, 6);
          expect(takes(el)).toContain("30.00");
          expect(splitButton(el).disabled).toBe(false);

          await pressSplit(el);

          expect(api.splitTable).toHaveBeenCalledOnce();
          expect(api.splitTable!.mock.calls[0]![3]).toBe(7);
        });

        it("a read that already answered at the floor's revision is not repeated when the floor lands", async () => {
          fakeTimers();
          const el = await panelWith({});
          await tick(el, "b2");
          api.getTablesState!.mockResolvedValue(atRevision(9));
          api.getPartyBills!.mockResolvedValue(movedList());
          api.getSplitSources!.mockResolvedValue({ ...withNewBill(), partyRevision: 9 });
          const before = reads().sources;
          await vi.advanceTimersByTimeAsync(15_000);
          await flush(el, 6);
          expect(tableOrder(el)!.party?.revision).toBe(9);
          expect(reads().sources).toBe(before + 1);

          await pressSplit(el);

          expect(api.splitTable!.mock.calls[0]![3]).toBe(9);
        });
      });

      it("a floor read landing while a reopening's read is out starts another, and only that one writes the rows and their revision", async () => {
        const el = await panelWith({
          ...firstRefused({ code: "party.out_of_date" }),
          setPartyName: vi.fn().mockResolvedValue({ revision: 9 }),
        });
        await tick(el, "b2");
        anotherTillMovesTheSoup();
        const held = heldReads();
        api.getSplitSources!.mockImplementation(held.read);
        await pressSplit(el);
        await flush(el, 6);
        expect(held.calls).toHaveLength(1);

        api.getTablesState!.mockResolvedValue(atRevision(9));
        emit(tableOrder(el)!, "name-party", { name: "Ana" });
        await flush(el, 6);
        expect(tableOrder(el)!.party?.revision).toBe(9);
        expect(held.calls).toHaveLength(2);
        held.calls[0]!.answer(movedSources());
        await flush(el, 6);
        expect(takes(el)).toContain("20.00");
        held.calls[1]!.answer({ ...movedSources(), partyRevision: 9 });
        await flush(el, 6);
        expect(takes(el)).toContain("30.00");

        await pressSplit(el);

        expect(api.splitTable!.mock.calls[1]![3]).toBe(9);
      });

      it("a read out when Split was pressed is dropped, so it does not count as seen", async () => {
        fakeTimers();
        const el = await panelWith(refused({ code: "table.not_shared" }));
        await tick(el, "b2");
        const held = heldReads();
        api.getSplitSources!.mockImplementation(held.read);
        await rereadBills(el, movedList());
        expect(held.calls).toHaveLength(1);

        await pressSplit(el);
        await flush(el, 6);

        expect(tableOrder(el)!.splitRefusal).not.toBeNull();
        expect(held.calls).toHaveLength(2);
        held.calls[1]!.answer(movedSources());
        await flush(el, 6);
        expect(takes(el)).toContain("30.00");
      });
    });
  });

  describe("take-over rows", () => {
    const luisOn = (billId: string): Draft => ({
      ...savedDraft(billId, "p2", "Luis"),
      lines: [
        {
          id: `luis-${billId}`,
          sourceLineId: null,
          source: null,
          menuItemId: "offer-flan",
          variantId: null,
          menuVersionId: null,
          options: [],
          extras: [],
          note: null,
          quantity: "1.000",
          courseId: null,
          noMerge: false,
          slot: 0,
          joinGroupId: null,
          afterGroupId: null,
          unavailable: false,
        },
      ],
    });
    const row = (el: TillApp, billId: string) =>
      picker(el)!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
        `[data-split-take-over="${billId}"]`,
      );
    const dialog = (el: TillApp) =>
      q<HTMLElementTagNameMap["wt-dialog"]>(el, "[data-take-over-dialog]")!;
    const footRefusal = (el: TillApp) =>
      q(el, "[data-split-take-over-refusal]")?.textContent?.replace(/\s+/g, " ").trim();
    const heldWords = () => t("table.split_taken").replace("{who}", "Luis");
    const sentEdits = () => api.splitTable!.mock.calls[0]![4];
    const b2Taken = { billId: "b2", editorVersion: 2, draftId: "draft-b2", draftRevision: 2 };

    async function asked(el: TillApp, billId = "b2"): Promise<void> {
      row(el, billId)!.click();
      await flush(el);
    }

    async function taken(el: TillApp, billId = "b2"): Promise<void> {
      await asked(el, billId);
      await press(el, "[data-take-over-confirm]");
      await flush(el, 6);
    }

    /** Another till's order reaches a bill the waiter has already ticked. */
    async function tickedThenHeld(over: Record<string, unknown> = {}) {
      const el = await panelWith(over);
      await tick(el, "b2");
      server.drafts.push(luisOn("b2"));
      await refreshDrafts(el);
      expect(row(el, "b2")).not.toBeNull();
      expect(tickBox(el, "b2").checked).toBe(true);
      expect(splitButton(el).disabled).toBe(true);
      return el;
    }

    it("a refused take-over's line comes up on a phone's window, with Split beside it", async () => {
      await page.viewport(390, 844);
      const longBill = Array.from({ length: 16 }, (_, index) => dish(`dish-${index}`, index + 1));
      const el = await tickedThenHeld({
        takeOverDraft: vi.fn().mockRejectedValue({ code: "draft.out_of_date" }),
        getSplitSources: vi.fn().mockResolvedValue({
          partyRevision: 3,
          bills: [
            { billId: "b2", lines: [dish("steak", 1)], balance: balance("b2", "20.00") },
            { billId: "wo-4", lines: longBill, balance: balance("wo-4", "160.00") },
          ],
        }),
      });
      row(el, "b2")!.scrollIntoView({ block: "nearest" });
      await taken(el);
      expect(footRefusal(el)).toBeDefined();
      const onScreen = (control: HTMLElement) => {
        const box = control.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight;
      };
      await expect
        .poll(() => onScreen(q(el, "[data-split-take-over-refusal]")!) && onScreen(splitButton(el)))
        .toBe(true);
    });

    function expectStillHeld(el: TillApp): void {
      expect(row(el, "b2")).not.toBeNull();
      expect(tickBox(el, "b2").checked).toBe(true);
      expect(refusal(el)!.textContent).toContain(heldWords());
      expect(splitButton(el).variant).toBe("secondary");
      expect(splitButton(el).disabled).toBe(true);
    }

    it("take-over: a row's button opens the screen's dialog, naming the holder, and Cancel sends nothing", async () => {
      server.drafts.push(luisOn("b2"));
      const el = await panelWith({});

      await asked(el);
      expect(dialog(el).open).toBe(true);
      expect(q(el, "[data-take-over-body]")!.textContent).toContain("Luis");

      await press(el, "[data-take-over-cancel]");
      expect(dialog(el).open).toBe(false);
      expect(server.takeOverDraft).not.toHaveBeenCalled();
      expect(row(el, "b2")).not.toBeNull();
    });

    it("take-over: another bill's sends that bill's own edit, not the on-screen bill's", async () => {
      server.drafts.push(luisOn("b2"));
      const el = await panelWith({});

      await taken(el);

      expect(server.takeOverDraft).toHaveBeenCalledExactlyOnceWith(
        "v1",
        "draft-b2",
        {
          revision: 1,
          expectedEdit: {
            billId: "b2",
            editorVersion: 1,
            draftId: "draft-b2",
            draftRevision: 1,
          },
          submissionId: expect.any(String),
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(row(el, "b2")).toBeNull();
      expect(tableOrder(el)!.orderId).toBe("wo-4");
    });

    it("take-over: the bill on screen goes through the sync's own take-over, and its row goes", async () => {
      server.drafts.push(luisOn("wo-4"));
      const el = await panelWith({});
      const reads = api.listDrafts!.mock.calls.length;

      await taken(el, "wo-4");

      expect(server.takeOverDraft).toHaveBeenCalledOnce();
      expect(server.takeOverDraft.mock.calls[0]![2].expectedEdit.billId).toBe("wo-4");
      // takeOverOn reads after its answer; the on-screen take-over applies the answer alone.
      expect(api.listDrafts!.mock.calls.length).toBe(reads);
      expect(row(el, "wo-4")).toBeNull();
      expect(tickBox(el, "wo-4").disabled).toBe(false);
    });

    it("take-over: the bill on screen, ticked, keeps its tick and sends once with the new state", async () => {
      const el = await panelWith({});
      await tick(el, "wo-4");
      server.drafts.push(luisOn("wo-4"));
      await refreshDrafts(el);
      expect(splitButton(el).disabled).toBe(true);

      await taken(el, "wo-4");

      expect(tickBox(el, "wo-4").checked).toBe(true);
      expect(splitButton(el).disabled).toBe(false);
      await pressSplit(el);
      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(sentEdits()).toEqual([
        { billId: "wo-4", editorVersion: 2, draftId: "draft-wo-4", draftRevision: 2 },
      ]);
    });

    it("take-over: the confirm stays off while one is out, and the dialog closes on its answer, a refusal included", async () => {
      server.drafts.push(luisOn("b2"));
      let refuse!: (error: unknown) => void;
      const el = await panelWith({});
      server.takeOverDraft.mockImplementationOnce(
        () => new Promise((_, reject) => (refuse = reject)),
      );
      const answered = tableOrder(el)!.takeOversAnswered;

      await asked(el);
      await press(el, "[data-take-over-confirm]");
      expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-take-over-confirm]")!.disabled).toBe(
        true,
      );
      expect(dialog(el).open).toBe(true);

      refuse({ code: "draft.out_of_date", status: 409 });
      await flush(el, 6);
      expect(tableOrder(el)!.takeOversAnswered).toBe(answered + 1);
      expect(dialog(el).open).toBe(false);
    });

    describe.each<Binding>(["desktop", "handheld"])("refused, %s", (binding) => {
      it("take-over: says so at the foot and not the banner, beside the held sentence", async () => {
        server.bills.add("b2");
        const el = await mounted(binding);
        await toPanel(el);
        await tick(el, "b2");
        server.drafts.push(luisOn("b2"));
        await refreshDrafts(el);
        server.takeOverDraft.mockRejectedValueOnce({ code: "draft.out_of_date", status: 409 });

        await taken(el);

        expect(footRefusal(el)).toBe(t("table.take_over_changed"));
        expect(banner(el)).toBeNull();
        expectStillHeld(el);
      });
    });

    it("take-over: a refusal on a ticked bill whose order is still there shows both lines at once, still held, and nothing is sent", async () => {
      const el = await tickedThenHeld();
      server.takeOverDraft.mockImplementationOnce(async () => {
        server.drafts[0] = { ...server.drafts[0]!, revision: 2 };
        throw { code: "draft.out_of_date", status: 409 };
      });

      await taken(el);

      expect(footRefusal(el)).toBe(t("table.take_over_changed"));
      expectStillHeld(el);
      expect(banner(el)).toBeNull();

      await refreshDrafts(el);
      expect(footRefusal(el)).toBe(t("table.take_over_changed"));
      expectStillHeld(el);

      splitButton(el).click();
      await flush(el, 6);
      expect(api.splitTable).not.toHaveBeenCalled();
    });

    it("take-over: refused with the read after it failing: the foot says so and the bill stays held", async () => {
      const el = await tickedThenHeld();
      server.takeOverDraft.mockRejectedValueOnce({ code: "draft.out_of_date", status: 409 });
      api.listDrafts!.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await taken(el);

      expect(footRefusal(el)).toBe(t("table.take_over_changed"));
      expectStillHeld(el);
    });

    it.each([
      ["draft.not_found", 404, "table.take_over_gone"],
      ["draft.out_of_date", 409, "table.take_over_changed"],
    ] as const)(
      "take-over: %s with the read after it showing the order gone: the foot says so, the row goes, the tick stays and Split comes back",
      async (code, status, words) => {
        const el = await tickedThenHeld();
        server.takeOverDraft.mockImplementationOnce(async () => {
          server.drafts.length = 0;
          throw { code, status };
        });

        await taken(el);

        expect(footRefusal(el)).toBe(t(words));
        expect(row(el, "b2")).toBeNull();
        expect(tickBox(el, "b2").checked).toBe(true);
        expect(splitButton(el).variant).toBe("primary");
        expect(splitButton(el).disabled).toBe(false);
        expect(banner(el)).toBeNull();
      },
    );

    it("take-over: refused on an unticked held bill beside a refused split: both sentences, in order above the actions, Split enabled, and the next take-over press clears only its own", async () => {
      server.drafts.push(luisOn("b2"));
      const el = await panelWith({
        splitTable: vi.fn().mockRejectedValue({ code: "table.not_shared" }),
      });
      await pressSplit(el);
      expect(refusal(el)).not.toBeNull();
      server.takeOverDraft.mockRejectedValueOnce({ code: "draft.out_of_date", status: 409 });

      await taken(el);

      expect(tickBox(el, "b2").checked).toBe(false);
      expect(footRefusal(el)).toBe(t("table.take_over_changed"));
      const foot = [...q(el, "[data-split-refusal]")!.parentElement!.children];
      expect(foot.indexOf(refusal(el)!)).toBeLessThan(
        foot.indexOf(q(el, "[data-split-take-over-refusal]")!),
      );
      expect(foot.indexOf(q(el, "[data-split-take-over-refusal]")!)).toBeLessThan(
        foot.indexOf(bottom(el)),
      );
      expect(splitButton(el).disabled).toBe(false);

      await asked(el);

      expect(footRefusal(el)).toBeUndefined();
      expect(refusal(el)).not.toBeNull();
    });

    it('take-over: "failed" says table.error at the foot, still held, nothing sent', async () => {
      const el = await tickedThenHeld();
      server.takeOverDraft.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await taken(el);

      expect(footRefusal(el)).toBe(t("table.error"));
      expectStillHeld(el);
      expect(banner(el)).toBeNull();
      splitButton(el).click();
      await flush(el, 6);
      expect(api.splitTable).not.toHaveBeenCalled();
    });

    it("take-over: the next take-over pressed clears the refusal", async () => {
      const el = await tickedThenHeld();
      server.takeOverDraft.mockRejectedValueOnce({ code: "draft.out_of_date", status: 409 });
      await taken(el);
      expect(footRefusal(el)).not.toBeUndefined();

      await asked(el);

      expect(footRefusal(el)).toBeUndefined();
    });

    it("take-over: closing the panel clears the refusal", async () => {
      server.drafts.push(luisOn("b2"));
      const el = await panelWith({});
      server.takeOverDraft.mockRejectedValueOnce({ code: "draft.out_of_date", status: 409 });
      await taken(el);
      expect(footRefusal(el)).not.toBeUndefined();

      await backAndAgain(el);

      expect(footRefusal(el)).toBeUndefined();
    });

    it("take-over: a refusal does not come back with the panel a refused split reopens", async () => {
      const el = await tickedThenHeld({
        splitTable: vi.fn().mockRejectedValue({ code: "table.not_shared" }),
      });
      server.takeOverDraft.mockRejectedValueOnce({ code: "draft.out_of_date", status: 409 });
      await taken(el);
      await tick(el, "b2");
      await tick(el, "wo-4");
      expect(footRefusal(el)).not.toBeUndefined();

      await pressSplit(el);

      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(q(el, "[data-split-pick]")).not.toBeNull();
      expect(footRefusal(el)).toBeUndefined();
    });

    it("take-over: a refusal goes when a press stays on the panel for a bad count", async () => {
      const el = await tickedThenHeld();
      server.takeOverDraft.mockRejectedValueOnce({ code: "draft.out_of_date", status: 409 });
      await taken(el);
      await tick(el, "b2");
      await tick(el, "wo-4");
      expect(footRefusal(el)).not.toBeUndefined();
      const leaving = q(el, 'wt-number-stepper[name="leavingGuests"]')!.shadowRoot!.querySelector(
        "input",
      )!;
      leaving.value = "abc";
      leaving.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await flush(el);

      await pressSplit(el);

      expect(api.splitTable).not.toHaveBeenCalled();
      expect(footRefusal(el)).toBeUndefined();
    });

    it("take-over: a refusal then a take-over that goes through leaves the foot empty", async () => {
      const el = await tickedThenHeld();
      server.takeOverDraft.mockRejectedValueOnce({ code: "draft.out_of_date", status: 409 });
      await taken(el);
      expect(footRefusal(el)).not.toBeUndefined();

      await taken(el);

      expect(row(el, "b2")).toBeNull();
      expect(footRefusal(el)).toBeUndefined();
    });

    it("take-over: a refusal with the panel gone from under the open dialog goes on the banner", async () => {
      server.drafts.push(luisOn("b2"));
      const el = await panelWith({ setPartyName: vi.fn().mockResolvedValue({ revision: 99 }) });
      await asked(el);
      const onOne = party({ tableIds: ["t4"], billCount: 2, revision: 99 });
      api.getTablesState!.mockResolvedValue([
        table("t4", "4", onOne),
        table("t5", "5", null),
        table7,
      ]);
      emit(tableOrder(el)!, "name-party", { name: "Ana" });
      await flush(el, 6);
      expect(q(el, "[data-split-pick]")).toBeNull();
      server.takeOverDraft.mockRejectedValueOnce({ code: "draft.out_of_date", status: 409 });

      await press(el, "[data-take-over-confirm]");
      await flush(el, 6);

      expect(server.takeOverDraft).toHaveBeenCalledOnce();
      expect(banner(el)!.textContent).toContain(t("table.take_over_changed"));
    });

    it("take-over: the bill on screen answered during a read says nothing and its row goes", async () => {
      server.drafts.push(luisOn("wo-4"));
      const el = await panelWith({});
      let release = () => {};
      const answering = server.takeOverDraft.getMockImplementation()!;
      server.takeOverDraft.mockImplementationOnce(
        (...args: Parameters<typeof answering>) =>
          new Promise((resolve) => {
            release = () => void Promise.resolve(answering(...args)).then(resolve);
          }) as ReturnType<typeof answering>,
      );
      await asked(el, "wo-4");
      await press(el, "[data-take-over-confirm]");
      await refreshDrafts(el);

      release();
      await flush(el, 6);

      expect(footRefusal(el)).toBeUndefined();
      expect(row(el, "wo-4")).toBeNull();
      expect(server.takeOverDraft).toHaveBeenCalledOnce();
    });

    it("take-over: focus goes to the row's button while it is still there", async () => {
      const el = await tickedThenHeld();
      server.takeOverDraft.mockRejectedValueOnce({ code: "draft.out_of_date", status: 409 });

      await taken(el);

      await expect
        .poll(() => picker(el)!.shadowRoot!.activeElement?.getAttribute("data-split-take-over"))
        .toBe("b2");
    });

    it("take-over: focus goes to the bill's tick once its row has gone", async () => {
      const el = await tickedThenHeld();

      await taken(el);

      await expect
        .poll(() => picker(el)!.shadowRoot!.activeElement?.getAttribute("data-split-tick"))
        .toBe("b2");
    });

    it("take-over: a tick taken afterwards records the new state, so Split sends with no refusal", async () => {
      server.drafts.push(luisOn("b2"));
      const el = await panelWith({});
      expect(tickBox(el, "b2").disabled).toBe(true);

      await taken(el);
      expect(tickBox(el, "b2").disabled).toBe(false);
      await tick(el, "b2");
      await pressSplit(el);

      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(sentEdits()).toEqual([b2Taken]);
      expect(refusal(el)).toBeNull();
    });

    it("take-over: a bill ticked whole keeps its tick, Split is held until the answer, and the first press sends once with the new state", async () => {
      const el = await tickedThenHeld();

      await taken(el);

      expect(tickBox(el, "b2").checked).toBe(true);
      expect(row(el, "b2")).toBeNull();
      expect(refusal(el)).toBeNull();
      expect(splitButton(el).variant).toBe("primary");
      expect(splitButton(el).disabled).toBe(false);

      await pressSplit(el);

      expect(refusal(el)).toBeNull();
      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(api.splitTable!.mock.calls[0]![2]).toEqual(whole("b2"));
      expect(sentEdits()).toEqual([b2Taken]);
    });

    it("take-over: a bill with picks keeps them, and sends once with the new state", async () => {
      const el = await panelWith({
        getSplitSources: vi.fn().mockResolvedValue({
          partyRevision: 3,
          bills: [
            { billId: "wo-4", lines: [dish("soup", 1)], balance: balance("wo-4", "10.00") },
            {
              billId: "b2",
              lines: [dish("steak", 1), dish("chips", 2)],
              balance: balance("b2", "20.00"),
            },
          ],
        } satisfies SplitSources),
      });
      await pickDish(el, "b2", "steak");
      expect(tickBox(el, "b2").indeterminate).toBe(true);
      server.drafts.push(luisOn("b2"));
      await refreshDrafts(el);
      expect(row(el, "b2")).not.toBeNull();

      await taken(el);

      expect(tickBox(el, "b2").indeterminate).toBe(true);
      expect(
        dishRows(el, "b2").querySelector<HTMLInputElement>('[data-pick="steak"]')!.checked,
      ).toBe(true);
      await pressSplit(el);

      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(sentEdits()).toEqual([b2Taken]);
    });

    it("take-over: Split stays held between the take-over's own answer and the read after it", async () => {
      const el = await tickedThenHeld();
      let release!: () => void;
      const reading = new Promise<void>((resolve) => (release = resolve));
      api.listDrafts!.mockImplementationOnce(async (partyId: string) => {
        await reading;
        return server.listDrafts(partyId);
      });

      await taken(el);
      expect(server.takeOverDraft).toHaveBeenCalledOnce();
      // The sync already holds the answer, so any redraw now would draw the bill as no longer held.
      el.requestUpdate();
      await flush(el);

      expect(splitButton(el).disabled).toBe(true);
      expect(splitButton(el).variant).toBe("secondary");
      splitButton(el).click();
      await flush(el);
      expect(api.splitTable).not.toHaveBeenCalled();

      release();
      await flush(el, 6);

      expect(splitButton(el).disabled).toBe(false);
      expect(splitButton(el).variant).toBe("primary");
    });

    it("take-over: with the read after it failing, the row goes with no message, other bills' rows stay as last read, and the first press sends once", async () => {
      const three = [...bills(), partyBill("b3", 3, "30.00")];
      const el = await panelWith({
        getPartyBills: vi.fn().mockResolvedValue(three),
        getSplitSources: vi.fn().mockResolvedValue({
          partyRevision: 3,
          bills: [
            ...answered().bills,
            { billId: "b3", lines: [dish("flan", 1)], balance: balance("b3", "30.00") },
          ],
        } satisfies SplitSources),
      });
      server.bills.add("b3");
      server.drafts.push({ ...luisOn("b3"), ownerName: "Eva", ownerId: "p3" });
      await refreshDrafts(el);
      await tick(el, "b2");
      server.drafts.push(luisOn("b2"));
      await refreshDrafts(el);
      expect(row(el, "b2")).not.toBeNull();
      expect(row(el, "b3")).not.toBeNull();

      server.drafts.splice(
        server.drafts.findIndex((draft) => draft.billId === "b3"),
        1,
      );
      api.listDrafts!.mockRejectedValue(new TypeError("Failed to fetch"));
      await taken(el);

      expect(row(el, "b2")).toBeNull();
      expect(row(el, "b3")).not.toBeNull();
      expect(tickBox(el, "b2").checked).toBe(true);
      expect(footRefusal(el)).toBeUndefined();
      expect(refusal(el)).toBeNull();
      expect(banner(el)).toBeNull();

      await pressSplit(el);

      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(sentEdits()).toEqual([b2Taken]);
    });

    describe("reached", () => {
      type DraftsRead = Awaited<ReturnType<typeof server.listDrafts>>;
      const title = (words: string) =>
        `A803 split: a ticked bill someone else's order reaches: ${words}`;
      const editOf = (read: DraftsRead, billId: string) =>
        read.billEdits.find((edit) => edit.billId === billId)!;
      const replacingEdit = (read: DraftsRead, billId: string, change: Record<string, unknown>) =>
        read.billEdits.map((edit) => (edit.billId === billId ? { ...edit, ...change } : edit));

      /** The shape another person's save through the real route answers: both lists move. */
      function withForeignDraft(snapshot: DraftsRead, billId: string): DraftsRead {
        const draft: Draft = { ...luisOn(billId), revision: 0 };
        return {
          drafts: [...snapshot.drafts, draft],
          billEdits: replacingEdit(snapshot, billId, {
            editorId: draft.ownerId,
            editorName: draft.ownerName,
            editorVersion: editOf(snapshot, billId).editorVersion + 1,
            draftId: draft.id,
            draftRevision: 0,
          }),
        };
      }

      /** After a send the draft has gone, and the edit state has moved on from what was ticked. */
      const withOrderSent = (snapshot: DraftsRead, billId: string): DraftsRead => ({
        drafts: snapshot.drafts,
        billEdits: replacingEdit(snapshot, billId, {
          editorVersion: editOf(snapshot, billId).editorVersion + 2,
        }),
      });

      const threeBills = () => [...bills(), partyBill("b3", 3, "30.00")];
      const threeAnswered = (): SplitSources => ({
        partyRevision: 3,
        bills: [
          ...answered().bills,
          { billId: "b3", lines: [dish("flan", 1)], balance: balance("b3", "30.00") },
        ],
      });
      const b3Whole = noEdit("b3");
      let reading: (snapshot: DraftsRead) => DraftsRead;
      beforeEach(() => {
        reading = (snapshot) => snapshot;
      });

      const threeBillApi = () => ({
        listDrafts: vi.fn(async (partyId: string) => reading(await server.listDrafts(partyId))),
        getPartyBills: vi.fn().mockResolvedValue(threeBills()),
        getSplitSources: vi.fn().mockResolvedValue(threeAnswered()),
      });

      async function panel(over: Record<string, unknown> = {}) {
        server.bills.add("b3");
        return panelWith({ ...threeBillApi(), ...over });
      }

      async function reached(el: TillApp, billId = "b2"): Promise<void> {
        reading = (snapshot) => withForeignDraft(snapshot, billId);
        await refreshDrafts(el);
      }

      const namesLuis = (el: TillApp) =>
        picker(el)!.shadowRoot!.querySelector("[data-split-bill='b2']")!.textContent;
      /** Clicks first, so that a split that does go out is what the failure prints. */
      async function expectNothingSends(el: TillApp): Promise<void> {
        await userEvent.click(splitButton(el), { force: true });
        await flush(el, 6);
        expect(api.splitTable!.mock.calls).toEqual([]);
        expect(q(el, "[data-split-pick]")).not.toBeNull();
        expect(row(el, "b2")).not.toBeNull();
        expect(namesLuis(el)).toContain("Luis");
        expect(refusal(el)!.textContent).toContain(heldWords());
        expect(splitButton(el).disabled).toBe(true);
        expect(splitButton(el).variant).toBe("secondary");

        q(el, 'wt-number-stepper[name="stayingGuests"]')!
          .shadowRoot!.querySelector("input")!
          .dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
          );
        await flush(el, 6);

        expect(api.splitTable!.mock.calls).toEqual([]);
        expect(server.saveDraft).not.toHaveBeenCalled();
        expect(server.takeOverDraft).not.toHaveBeenCalled();
      }

      const expectSentOnce = (selection: unknown, edits: unknown[]) =>
        expect(api.splitTable).toHaveBeenCalledExactlyOnceWith(
          "v1",
          "t5",
          selection,
          3,
          edits,
          noGuests,
        );

      const twoDishes = (): SplitSources => ({
        partyRevision: 3,
        bills: [
          answered().bills[0]!,
          {
            billId: "b2",
            lines: [dish("steak", 1), dish("chips", 2)],
            balance: balance("b2", "20.00"),
          },
          threeAnswered().bills[2]!,
        ],
      });

      it(title("the only tick, whole"), async () => {
        const el = await panel();
        await tick(el, "b2");

        await reached(el);

        await expectNothingSends(el);
        expect(tickBox(el, "b2").checked).toBe(true);
      });

      it(title("the only pick, loose"), async () => {
        const el = await panel({ getSplitSources: vi.fn().mockResolvedValue(twoDishes()) });
        await pickDish(el, "b2", "steak");
        expect(tickBox(el, "b2").indeterminate).toBe(true);

        await reached(el);

        await expectNothingSends(el);
        expect(tickBox(el, "b2").indeterminate).toBe(true);

        await tick(el, "b2");
        expect(tickBox(el, "b2").checked).toBe(false);
        expect(tickBox(el, "b2").indeterminate).toBe(false);
        await pressSplit(el);

        expectSentOnce(whole(), []);
      });

      it(title("with another bill ticked"), async () => {
        const el = await panel();
        await tick(el, "b2");
        await tick(el, "b3");

        await reached(el);

        await expectNothingSends(el);
        expect(tickBox(el, "b2").checked).toBe(true);
        expect(tickBox(el, "b3").checked).toBe(true);
      });

      it(title("untick"), async () => {
        const el = await panel();
        await tick(el, "b2");
        await tick(el, "b3");
        await reached(el);

        await tick(el, "b2");
        expect(tickBox(el, "b2").checked).toBe(false);
        expect(splitButton(el).disabled).toBe(false);
        await pressSplit(el);

        expectSentOnce(whole("b3"), [b3Whole]);
        expect(server.takeOverDraft).not.toHaveBeenCalled();
      });

      it(title("take over"), async () => {
        const mine = { billId: "b2", editorVersion: 2, draftId: "draft-b2", draftRevision: 1 };
        const el = await panel();
        await tick(el, "b2");
        await tick(el, "b3");
        await reached(el);
        const draft: Draft = {
          ...luisOn("b2"),
          ownerId: "p1",
          ownerName: "Ana",
          takenOverFrom: { personId: "p2", name: "Luis" },
        };
        const myEdit = { ...mine, editorId: "p1", editorName: "Ana" };
        server.takeOverDraft.mockImplementationOnce(async () => {
          reading = (snapshot) => ({
            drafts: [...snapshot.drafts, draft],
            billEdits: replacingEdit(snapshot, "b2", myEdit),
          });
          return { draft, edit: myEdit };
        });

        await taken(el);

        expect(server.takeOverDraft).toHaveBeenCalledExactlyOnceWith(
          "v1",
          "draft-b2",
          {
            revision: 0,
            expectedEdit: { billId: "b2", editorVersion: 1, draftId: "draft-b2", draftRevision: 0 },
            submissionId: expect.any(String),
          },
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
        expect(api.splitTable).not.toHaveBeenCalled();
        expect(tickBox(el, "b2").checked).toBe(true);
        await pressSplit(el);

        expectSentOnce(whole("b2", "b3"), [mine, b3Whole]);
      });

      it(title("the order goes"), async () => {
        const el = await panel();
        await tick(el, "b2");
        await reached(el);
        expect(splitButton(el).disabled).toBe(true);

        reading = (snapshot) => withOrderSent(snapshot, "b2");
        await refreshDrafts(el);

        expect(row(el, "b2")).toBeNull();
        expect(tickBox(el, "b2").checked).toBe(true);
        expect(splitButton(el).variant).toBe("primary");
        expect(splitButton(el).disabled).toBe(false);

        await pressSplit(el);
        expect(api.splitTable).not.toHaveBeenCalled();
        expect(refusal(el)!.textContent).toContain(changedWords("Bill 2"));

        await pressSplit(el);
        expectSentOnce(whole("b2"), [noEdit("b2", { editorVersion: 2 })]);
      });

      it(title("an old prompt"), async () => {
        const el = await panel();
        const order = tableOrder(el)!;
        await press(el, "[data-action-back]");
        let prompt: object | undefined;
        order.addEventListener(
          "split-table-open",
          (event) => (prompt = (event as CustomEvent<{ prompt: object }>).detail.prompt),
          { once: true },
        );
        await press(el, '[data-target="t5"]');
        await tick(el, "b2");
        await reached(el);

        emit(order, "split-table", {
          tableId: "t5",
          selection: whole("b2"),
          guestCounts: noGuests,
          prompt,
        });
        await flush(el, 6);

        expect(prompt).toBeDefined();
        expect(api.splitTable).not.toHaveBeenCalled();
        expect(banner(el)!.textContent).toContain(changedWords("Bill 2"));
        expect(refusal(el)!.textContent).toContain(heldWords());
      });

      it(title("a request already out"), async () => {
        const splitTable = vi.fn().mockImplementationOnce(async () => {
          reading = (snapshot) => withForeignDraft(snapshot, "b2");
          throw { code: "draft.out_of_date", billId: "b2" };
        });
        const el = await panel({ splitTable });
        await tick(el, "b2");
        const reads = api.listDrafts!.mock.calls.length;

        await pressSplit(el);

        expect(api.listDrafts!.mock.calls.length).toBeGreaterThan(reads);
        expect(splitTable).toHaveBeenCalledOnce();
        expect(tickBox(el, "b2").checked).toBe(true);
        expect(row(el, "b2")).not.toBeNull();
        expect(namesLuis(el)).toContain("Luis");
        expect(refusal(el)!.textContent).toContain(heldWords());
        expect(splitButton(el).variant).toBe("secondary");
        expect(splitButton(el).disabled).toBe(true);

        await userEvent.click(splitButton(el), { force: true });
        await flush(el, 6);
        expect(splitTable).toHaveBeenCalledOnce();
      });

      const without = (billId: string) => ({
        partyRevision: 3,
        bills: threeAnswered().bills.filter((bill) => bill.billId !== billId),
      });
      const billsWithout = (billId: string) =>
        threeBills().filter((bill) => bill.workingOrderId !== billId);

      it(title("a ticked bill gone"), async () => {
        fakeTimers();
        const el = await panel();
        await tick(el, "b2");
        await reached(el);

        api.getSplitSources!.mockResolvedValue(without("b2"));
        await rereadBills(el, billsWithout("b2"));
        expect(splitButton(el).disabled).toBe(false);

        await pressSplit(el);
        expect(api.splitTable).not.toHaveBeenCalled();
        expect(refusal(el)!.textContent).toContain(
          t("table.split_bill_gone").replace("{bill}", "Bill 2"),
        );

        await pressSplit(el);
        expectSentOnce(whole(), []);
      });

      it(title("in Spanish"), async () => {
        server.bills.add("b2");
        server.bills.add("b3");
        const el = await mounted("desktop", { ...threeBillApi(), splitTable: vi.fn() });
        setLocale("es-ES");
        await toPanel(el);
        await tick(el, "b2");

        await reached(el);

        expect(refusal(el)!.textContent).toContain(
          t("table.split_taken", "es-ES").replace("{who}", "Luis"),
        );
        expect(splitButton(el).textContent!.trim()).toBe(t("table.split_guests_confirm", "es-ES"));
        expect(api.splitTable).not.toHaveBeenCalled();
      });

      it(title("a ticked bill goes and comes back"), async () => {
        fakeTimers();
        const el = await panel();
        await tick(el, "b2");
        await tick(el, "b3");
        await reached(el);

        api.getSplitSources!.mockResolvedValue(without("b2"));
        await rereadBills(el, billsWithout("b2"));
        api.getSplitSources!.mockResolvedValue(threeAnswered());
        await rereadBills(el, [...billsWithout("b2"), partyBill("b2", 4, "20.00")]);

        expect(tickBox(el, "b2").checked).toBe(false);

        await pressSplit(el);
        expect(api.splitTable).not.toHaveBeenCalled();
        expect(refusal(el)!.textContent).toContain(changedWords("Bill 4"));

        await pressSplit(el);
        expectSentOnce(whole("b3"), [b3Whole]);
      });

      describe("A803 split: a pick lost as the order goes", () => {
        const threeDishes = (): SplitSources => ({
          partyRevision: 3,
          bills: twoDishes().bills.map((bill) =>
            bill.billId !== "b2"
              ? bill
              : { ...bill, lines: [dish("steak", 1), dish("chips", 2), dish("flan", 3)] },
          ),
        });
        const withDishes = (keep: string[], from: SplitSources): SplitSources => ({
          partyRevision: 3,
          bills: from.bills.map((bill) =>
            bill.billId !== "b2"
              ? bill
              : { ...bill, lines: bill.lines.filter(({ id }) => keep.includes(id)) },
          ),
        });
        const revised = () =>
          threeBills().map((bill) =>
            bill.workingOrderId === "b2" ? { ...bill, revision: 9 } : bill,
          );

        async function expectOneStop(el: TillApp, bill = "Bill 2"): Promise<void> {
          await pressSplit(el);
          expect(api.splitTable).not.toHaveBeenCalled();
          expect(refusal(el)!.textContent).toContain(changedWords(bill));
        }

        it("picks become the whole bill: one stop, then the whole bill", async () => {
          fakeTimers();
          const el = await panel({ getSplitSources: vi.fn().mockResolvedValue(twoDishes()) });
          await pickDish(el, "b2", "steak");
          await reached(el);
          api.getSplitSources!.mockResolvedValue(withDishes(["steak"], twoDishes()));
          await rereadBills(el, revised());
          reading = (snapshot) => withOrderSent(snapshot, "b2");
          await refreshDrafts(el);
          expect(tickBox(el, "b2").checked).toBe(true);

          await expectOneStop(el);

          await pressSplit(el);
          expectSentOnce(whole("b2"), [noEdit("b2", { editorVersion: 2 })]);
        });

        describe("a whole bill and a dish reaching it", () => {
          const withWine = (from: SplitSources): SplitSources => ({
            partyRevision: 3,
            bills: from.bills.map((bill) =>
              bill.billId !== "b2"
                ? bill
                : { ...bill, lines: [...bill.lines, dish("wine", bill.lines.length + 1)] },
            ),
          });

          it("ticked whole, a dish someone sends: one stop, then the whole bill", async () => {
            fakeTimers();
            const el = await panel();
            await tick(el, "b2");
            api.getSplitSources!.mockResolvedValue(withWine(threeAnswered()));
            await rereadBills(el, revised());
            reading = (snapshot) => withOrderSent(snapshot, "b2");
            await refreshDrafts(el);

            await expectOneStop(el);

            await pressSplit(el);
            expectSentOnce(whole("b2"), [noEdit("b2", { editorVersion: 2 })]);
          });

          it("ticked whole, a dish moved in, which leaves the edit state: no stop", async () => {
            fakeTimers();
            const el = await panel();
            await tick(el, "b2");
            api.getSplitSources!.mockResolvedValue(withWine(threeAnswered()));
            await rereadBills(el, revised());
            await refreshDrafts(el);

            await pressSplit(el);

            expectSentOnce(whole("b2"), [noEdit("b2")]);
          });

          it("picks turned whole and their one stop taken, a dish someone sends: one more stop", async () => {
            fakeTimers();
            const el = await panel({ getSplitSources: vi.fn().mockResolvedValue(twoDishes()) });
            await pickDish(el, "b2", "steak");
            api.getSplitSources!.mockResolvedValue(withDishes(["steak"], twoDishes()));
            await rereadBills(el, revised());
            expect(tickBox(el, "b2").checked).toBe(true);
            await expectOneStop(el);

            api.getSplitSources!.mockResolvedValue(withWine(withDishes(["steak"], twoDishes())));
            await rereadBills(
              el,
              revised().map((bill) => ({ ...bill, total: "30.00" })),
            );
            reading = (snapshot) => withOrderSent(snapshot, "b2");
            await refreshDrafts(el);

            await expectOneStop(el);
          });
        });

        it("a pick paid while held: one stop, then what is still picked", async () => {
          fakeTimers();
          const el = await panel({ getSplitSources: vi.fn().mockResolvedValue(threeDishes()) });
          await pickDish(el, "b2", "steak");
          await pickDish(el, "b2", "chips");
          await reached(el);
          api.getSplitSources!.mockResolvedValue(withDishes(["chips", "flan"], threeDishes()));
          await rereadBills(el, revised());
          reading = (snapshot) => withOrderSent(snapshot, "b2");
          await refreshDrafts(el);

          await expectOneStop(el);

          await pressSplit(el);
          expectSentOnce({ wholeBillIds: [], loose: [{ billId: "b2", lineIds: ["chips"] }] }, [
            noEdit("b2", { editorVersion: 2 }),
          ]);
        });

        it("my own dishes end elsewhere: one stop, then the whole bill", async () => {
          const steakOnly = withDishes(["steak"], twoDishes());
          const own: Draft = { ...luisOn("b2"), ownerId: "p1", ownerName: "Ana" };
          reading = (snapshot) => ({
            drafts: [...snapshot.drafts, own],
            billEdits: replacingEdit(snapshot, "b2", {
              editorId: "p1",
              editorName: "Ana",
              editorVersion: 1,
              draftId: own.id,
              draftRevision: 0,
            }),
          });
          const el = await panel({ getSplitSources: vi.fn().mockResolvedValue(steakOnly) });
          await pickDish(el, "b2", "steak");
          expect(tickBox(el, "b2").indeterminate).toBe(true);

          reading = (snapshot) => withOrderSent(snapshot, "b2");
          await refreshDrafts(el);
          expect(tickBox(el, "b2").checked).toBe(true);

          await expectOneStop(el);

          await pressSplit(el);
          expectSentOnce(whole("b2"), [noEdit("b2", { editorVersion: 2 })]);
        });

        it("the screen's stop answers for its own bill alone", async () => {
          fakeTimers();
          const el = await panel({ getSplitSources: vi.fn().mockResolvedValue(threeDishes()) });
          await pickDish(el, "b2", "steak");
          await pickDish(el, "b2", "chips");
          await tick(el, "b3");
          await reached(el);
          api.getSplitSources!.mockResolvedValue(withDishes(["chips", "flan"], threeDishes()));
          await rereadBills(el, revised());
          reading = (snapshot) => ({
            ...withOrderSent(snapshot, "b2"),
            billEdits: withOrderSent(snapshot, "b2").billEdits.map((edit) =>
              edit.billId === "b3" ? { ...edit, editorVersion: 1 } : edit,
            ),
          });
          await refreshDrafts(el);

          await expectOneStop(el);
          await expectOneStop(el, "Bill 3");

          await pressSplit(el);
          expectSentOnce({ wholeBillIds: ["b3"], loose: [{ billId: "b2", lineIds: ["chips"] }] }, [
            noEdit("b2", { editorVersion: 2 }),
            noEdit("b3", { editorVersion: 1 }),
          ]);
        });
      });
    });
  });

  describe("a party with no bill", () => {
    const noBill = party({ tableIds: ["t4", "t5"], billCount: 0, openingBillId: null });
    const noBillApi = () => ({
      getTablesState: vi
        .fn()
        .mockResolvedValue([table("t4", "4", noBill), table("t5", "5", noBill), table7]),
      getPartyBills: vi.fn().mockResolvedValue([]),
      getSplitSources: vi.fn().mockResolvedValue({ partyRevision: 3, bills: [] }),
      splitTable: vi.fn().mockResolvedValue({ partyId: "v-split", billIds: [] }),
    });

    it("a party with no bill sends through the real panel's Split, with no banner", async () => {
      const el = await mounted("desktop", noBillApi());
      expect(tableOrder(el)!.orderId).toBeUndefined();
      await toPanel(el);

      await pressSplit(el);

      expect(api.splitTable).toHaveBeenCalledExactlyOnceWith(
        "v1",
        "t5",
        whole(),
        noBill.revision,
        [],
        noGuests,
      );
      expect(banner(el)).toBeNull();
    });

    it("a party with no bill gaining its first bill sends it with the reloaded party's revision and the bill's own state", async () => {
      fakeTimers();
      const el = await mounted("desktop", noBillApi());
      await toPanel(el);

      server.bills.add("b9");
      const later = party({ revision: 9, tableIds: ["t4", "t5"], billCount: 1 });
      api.getTablesState!.mockResolvedValue([
        table("t4", "4", later),
        table("t5", "5", later),
        table7,
      ]);
      api.getSplitSources!.mockResolvedValue({
        partyRevision: 9,
        bills: [{ billId: "b9", lines: [dish("steak", 1)], balance: balance("b9", "20.00") }],
      });
      await rereadBills(el, [partyBill("b9", 1, "20.00")]);
      expect(tableOrder(el)!.orderId).toBe("b9");

      await tick(el, "b9");
      await pressSplit(el);
      expect(api.splitTable).not.toHaveBeenCalled();
      await press(el, "[data-split-anyway]");
      await flush(el, 6);

      expect(api.splitTable).toHaveBeenCalledExactlyOnceWith(
        "v1",
        "t5",
        whole("b9"),
        9,
        [noEdit("b9")],
        noGuests,
      );
      expect(banner(el)).toBeNull();
    });
  });
});
