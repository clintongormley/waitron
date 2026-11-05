import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { BillBalance, Draft, PartyBill, SplitSources, TabLine } from "./api/client.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { partyBill } from "./screens/till-table-order-screen.bill-switcher.test-helpers.js";
import type { TillApp } from "./till-app.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import type { TillSplitPicker } from "./widgets/split-picker.js";
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
  screen.splitPanelLive = true;
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

  it("still does what it did for the old event, which names a bill: no read, and its prompt sends", async () => {
    server.bills.add("b2");
    const el = await mounted("desktop", {
      splitTable: vi.fn().mockResolvedValue({ partyId: "v2", billId: "b2" }),
    });
    const prompt = {};
    emit(tableOrder(el)!, "split-table-open", { tableId: "t5", billId: "b2", prompt });
    await flush(el);
    expect(api.getSplitSources).not.toHaveBeenCalled();

    emit(tableOrder(el)!, "split-table", {
      tableId: "t5",
      billId: "b2",
      guestCounts: { staying: null, leaving: null },
      prompt,
    });
    await flush(el);
    expect(api.splitTable).toHaveBeenCalledTimes(1);
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
      getSplitSources: vi.fn().mockResolvedValue({ bills: [] }),
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
      expect(text(el, "[data-split-keeps]")).toBe("4 keeps an empty bill · €0.00");
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

    it("sends the old event's bill as a selection of that bill", async () => {
      const el = await sending(after(...threeBills()));

      emit(tableOrder(el)!, "split-table", { tableId: "t5", billId: "b2", guestCounts: guests });
      await flush(el, 6);

      expect(api.splitTable).toHaveBeenCalledWith(
        "v1",
        "t5",
        { wholeBillIds: ["b2"], loose: [] },
        3,
        [noEdit("b2")],
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
      api.splitTable!.mockImplementation(async () => {
        api.getTablesState!.mockResolvedValue(after().tables);
        api.getPartyBills!.mockRejectedValue(new Error("read failed"));
        return { partyId: "v-split", billIds: ["b9"] };
      });

      split(el, { wholeBillIds: [], loose: [{ billId: "wo-4", lineIds: ["soup"] }] });
      await flush(el, 6);

      expect(tableOrder(el)!.orderId).toBe("wo-4");
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

      expect(tableOrder(el)!.orderId).toBe("wo-4");
      expect(tableOrder(el)!.billGone).toBeNull();
      expect(banner(el)).toBeNull();
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
    const fromBill2 = { wholeBillIds: [], loose: [{ billId: "b2", lineIds: ["steak"] }] };

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
        getSplitSources: vi.fn().mockResolvedValue({ bills: [] }),
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
