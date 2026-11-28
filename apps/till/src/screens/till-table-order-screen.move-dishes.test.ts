import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  cleanupWidgets,
  mountWidget,
  panelBackButton,
  quantityButton,
} from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./till-table-order-screen.js";
import type { OtherDraft, TillTableOrderScreen } from "./till-table-order-screen.js";
import type { PartyBill, TableParty, TableState } from "../api/floor-api.js";
import type { BillBalance } from "../api/payments-api.js";
import type { OrderGroup, TabLine } from "../api/kitchen-api.js";
import { partyBill, switcherParty } from "./till-table-order-screen.bill-switcher.test-helpers.js";
import type { TillPortionPicker } from "../widgets/portion-picker.js";
import { DraftStore } from "../state/draft-sync.js";
import { resized } from "./till-table-order-screen.test-helpers.js";

function line(id: string, lineNo: number, over: Partial<TabLine> = {}): TabLine {
  return {
    id,
    lineNo,
    stationId: "bar",
    changesAfterSending: null,
    movable: true,
    name: "Caña",
    productId: "cana",
    parentProductId: null,
    parentLineNo: null,
    quantity: "1.000",
    priceQuantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "5.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    groupId: null,
    note: null,
    listId: null,
    menuItemId: "offer-cana",
    portion: true,
    ...over,
  };
}

const BEERS = [line("c1", 1), line("c2", 2), line("c3", 3), line("c4", 4)];
const HAM = line("h1", 5, {
  name: "Ham",
  productId: "ham",
  menuItemId: "ham",
  unitPriceGross: "12.00",
});
const party: TableParty = { ...switcherParty, billCount: 5 };

function table(id: string): TableState {
  return {
    id,
    label: id,
    shortName: id,
    party,
    signals: [],
    zoneId: null,
    state: "open-tab",
    hasOpenTab: true,
    condition: "held",
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
  } as TableState;
}

/** Bill 2 on screen; Bill 1, Bill 3 (holding a payment) and Bill 4 take dishes; Bill 5 is
 * presented, so it does not. Given out of number order. */
const BILLS = [
  partyBill("wo-4", 4, "0.00"),
  partyBill("wo-2", 2, "32.00"),
  partyBill("wo-3", 3, "5.00", { total: "10.00", hasPayments: true }),
  partyBill("wo-1", 1, "10.00", { billName: "Ana" }),
  partyBill("wo-5", 5, "8.00", { status: "placed" }),
];

async function mountScreen(
  over: {
    bills?: PartyBill[];
    balance?: BillBalance | null;
    party?: TableParty | null;
    lines?: TabLine[];
    draftStore?: DraftStore;
    otherDrafts?: OtherDraft[];
    groups?: OrderGroup[];
    tables?: TableState[];
  } = {},
) {
  const shownParty = over.party === undefined ? party : over.party;
  const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products: [],
    lines: over.lines ?? [...BEERS, HAM],
    ...(over.draftStore === undefined ? {} : { draftStore: over.draftStore }),
    ...(over.otherDrafts === undefined ? {} : { otherDrafts: over.otherDrafts }),
    ...(over.groups === undefined ? {} : { groups: over.groups }),
    orderId: "wo-2",
    party: shownParty,
    bills: over.bills ?? BILLS,
    billBalance: over.balance ?? null,
    tables: over.tables ?? (shownParty === null ? [] : [table("t4")]),
  });
  return el;
}

const menu = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-table-menu]")!;
const moveItem = (el: TillTableOrderScreen) =>
  menu(el).querySelector<HTMLElement>('[data-action="move-dishes"]');
const panel = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-move-dishes]");
const picker = (el: TillTableOrderScreen) =>
  panel(el)!.querySelector<TillPortionPicker>("till-portion-picker")!;
const destinations = (el: TillTableOrderScreen) => [
  ...panel(el)!.querySelectorAll<HTMLElementTagNameMap["wt-choice-tile"]>("[data-move-dishes-to]"),
];
const destination = (el: TillTableOrderScreen, id: string) =>
  panel(el)!.querySelector<HTMLElement>(`[data-move-dishes-to="${id}"]`)!;
const confirm = (el: TillTableOrderScreen) =>
  panel(el)!.querySelector<HTMLElement & { disabled: boolean }>("[data-move-dishes-confirm]")!;
const textOf = (node: Element) => node.textContent!.replace(/\s+/g, " ").trim();
const pressed = (el: TillTableOrderScreen) =>
  destinations(el)
    .filter(
      (choice) =>
        choice.shadowRoot!.querySelector("button")!.getAttribute("aria-pressed") === "true",
    )
    .map((choice) => choice.dataset.moveDishesTo);

async function openMoveDishes(el: TillTableOrderScreen) {
  await userEvent.click(menu(el));
  await userEvent.click(moveItem(el)!);
  await el.updateComplete;
}

const quantity = (el: TillTableOrderScreen, id: string) =>
  picker(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-stepper"]>(`[data-pick="${id}"]`)!;

async function toggleRow(el: TillTableOrderScreen, id: string) {
  const control = quantity(el, id);
  const target = control.value > 0 ? 0 : control.max!;
  const step = target > control.value ? 1 : -1;
  for (let left = Math.abs(target - control.value); left > 0; left--) {
    await changeCount(el, id, step);
  }
}

async function changeCount(el: TillTableOrderScreen, id: string, step: -1 | 1) {
  quantityButton(quantity(el, id), step).click();
  await el.updateComplete;
  await picker(el).updateComplete;
}

/** Counts reads of the screen's bill lines. */
function countLineReads(el: TillTableOrderScreen): { count: number } {
  let owner: object | null = Object.getPrototypeOf(el);
  let accessor: PropertyDescriptor | undefined;
  while (owner !== null && accessor === undefined) {
    accessor = Object.getOwnPropertyDescriptor(owner, "lines");
    owner = Object.getPrototypeOf(owner);
  }
  const reads = { count: 0 };
  Object.defineProperty(el, "lines", {
    configurable: true,
    get() {
      reads.count++;
      return accessor!.get!.call(this);
    },
    set(value: TabLine[]) {
      accessor!.set!.call(this, value);
    },
  });
  return reads;
}

function capture(el: TillTableOrderScreen, type: string): unknown[] {
  const seen: unknown[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent).detail));
  return seen;
}

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

describe("A803 move dishes panel", () => {
  it("a dish in a held group, which the server moves and keeps in its group, carries the same mark as Split a table's, from its row alone", async () => {
    const mains = { id: "c-mains", name: "Mains", displayOrder: 2, fireNowZoneIds: [] };
    const held = {
      id: "g-held",
      position: 1,
      displayNumber: 1,
      numberPartyId: "p",
      state: "held" as const,
      firedAt: null,
      remindAt: null,
      lineIds: [],
      courseIds: [],
      summary: "",
    };
    const el = await mountScreen({
      lines: [
        { ...HAM, groupId: "g-held" },
        {
          ...BEERS[0]!,
          groupId: "g-new",
          courseId: mains.id,
          course: mains,
          waitsInHeldGroup: true,
        },
      ],
      groups: [held],
    });
    await openMoveDishes(el);
    await picker(el).updateComplete;
    const marks = [...picker(el).shadowRoot!.querySelectorAll("[data-pick-mark]")];
    expect(marks.map(textOf)).toEqual([`${t("table.group_held")} · Mains`]);
  });

  it("the ⋮ of an open bill of a party lists Move dishes before Merge bills", async () => {
    const el = await mountScreen();
    const items = [...menu(el).querySelectorAll<HTMLElement>("[data-action]")].map(
      (button) => button.dataset.action,
    );
    expect(items.indexOf("move-dishes")).toBeGreaterThanOrEqual(0);
    expect(items[items.indexOf("move-dishes") + 1]).toBe("merge");
    expect(moveItem(el)!.querySelector("wt-menu-row")!.label).toBe("Move dishes");
  });

  it("is offered on a part-paid open bill too", async () => {
    const el = await mountScreen({
      bills: [partyBill("wo-2", 2, "12.00", { total: "32.00", hasPayments: true })],
    });
    expect(moveItem(el)).not.toBeNull();
  });

  it("is not offered on a presented or a paid bill", async () => {
    for (const status of ["placed", "settled"] as const) {
      const el = await mountScreen({
        bills: [partyBill("wo-2", 2, "0.00", { status, total: "32.00", hasPayments: true })],
      });
      expect(moveItem(el)).toBeNull();
      cleanupWidgets();
    }
  });

  it("is not offered with no party", async () => {
    const el = await mountScreen({ party: null, bills: [] });
    expect(el.shadowRoot!.querySelector('[data-party-menu] [data-action="join"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-action="move-dishes"]')).toBeNull();
  });

  it("choosing it opens the panel with its heading focused", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    const heading = panel(el)!.querySelector("[data-action-heading]")!;
    expect(textOf(heading)).toBe("Move dishes");
    expect(panel(el)!.querySelector("wt-top-bar")!.subtitle).toBe("from Bill 2");
    await expect.poll(() => el.shadowRoot!.activeElement).toBe(heading);
    expect(panel(el)!.closest("[data-action-panel]")).not.toBeNull();
    expect(picker(el).rows.map((row) => row.members.map((member) => member.id))).toEqual([
      ["c1", "c2", "c3", "c4"],
      ["h1"],
    ]);
  });

  it("names each row's extras as the bill's list names them, and a weighed dish's weight", async () => {
    const burger = (id: string, lineNo: number) =>
      line(id, lineNo, {
        name: "Burger",
        productId: "burger",
        menuItemId: "burger",
        unitPriceGross: "9.00",
      });
    const extra = (id: string, lineNo: number, parent: number, over: Partial<TabLine>) =>
      line(id, lineNo, { parentLineNo: parent, unitPriceGross: "1.00", portion: false, ...over });
    const ham = line("ham", 5, {
      name: "Iberian ham",
      productId: "ham",
      menuItemId: "ham",
      quantity: "0.320",
      priceQuantity: "0.320",
      unitPrecision: 3,
      unitPriceGross: "89.00",
      portion: false,
    });
    const el = await mountScreen({
      lines: [
        burger("b1", 1),
        extra("x2", 2, 1, { name: "Cheese", productId: "cheese" }),
        burger("b3", 3),
        extra("x4", 4, 3, { name: undefined, productId: "bacon" }),
        ham,
      ],
    });
    await openMoveDishes(el);
    await picker(el).updateComplete;
    const labels = [...picker(el).shadowRoot!.querySelectorAll("[data-pick-row] .name")].map(
      textOf,
    );
    expect(labels).toHaveLength(3);
    expect(labels[0]).toContain("Cheese");
    expect(labels[0]).not.toContain("bacon");
    expect(labels[1]).toContain("bacon");
    expect(labels[2]).toContain("Iberian ham ×0.32");
  });

  it("offers the party's other open bills, one holding a payment included, in number order, then New bill", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    expect(destinations(el).map((choice) => choice.dataset.moveDishesTo)).toEqual([
      "wo-1",
      "wo-3",
      "wo-4",
      "new",
    ]);
    expect(destinations(el).map((choice) => choice.label)).toEqual([
      "Bill 1 · Ana",
      "Bill 3",
      "Bill 4",
      "New bill",
    ]);
    expect(
      destinations(el).map((choice) =>
        choice.shadowRoot!.querySelector("button")!.getAttribute("aria-pressed"),
      ),
    ).toEqual(["false", "false", "false", "false"]);
    expect(textOf(panel(el)!.querySelector("[data-move-dishes-to-heading]")!)).toBe("Move them to");
  });

  it("offers a bill holding a pending payment, which still owes its total", async () => {
    const el = await mountScreen({
      bills: [
        partyBill("wo-2", 2, "32.00"),
        partyBill("wo-1", 1, "10.00"),
        partyBill("wo-3", 3, "20.00", { total: "20.00", hasPayments: true }),
      ],
    });
    await openMoveDishes(el);
    expect(destinations(el).map((choice) => choice.dataset.moveDishesTo)).toEqual([
      "wo-1",
      "wo-3",
      "new",
    ]);
  });

  it("a chosen bill that gains a payment on a re-read stays chosen, and Move sends it", async () => {
    const el = await mountScreen();
    const sent = capture(el, "move-dishes");
    await openMoveDishes(el);
    await toggleRow(el, "h1");
    await userEvent.click(destination(el, "wo-4"));
    await el.updateComplete;
    el.bills = BILLS.map((bill) =>
      bill.workingOrderId === "wo-4" ? { ...bill, hasPayments: true } : bill,
    );
    await el.updateComplete;
    expect(pressed(el)).toEqual(["wo-4"]);
    expect(confirm(el).disabled).toBe(false);
    await userEvent.click(confirm(el));
    expect(sent).toEqual([{ lineIds: ["h1"], toBillId: "wo-4", review: expect.any(Function) }]);
  });

  it("keeps the quantity when Back returns from the table picker", async () => {
    const el = await mountScreen({
      tables: [
        table("t4"),
        { ...table("t7"), party: { ...party, id: "other-party", displayName: "7", guestCount: 3 } },
      ],
    });
    await openMoveDishes(el);
    await changeCount(el, "c1", 1);
    const root = el.shadowRoot!;
    const another = () => root.querySelector<HTMLElement>('[data-move-dishes-to="table"]')!;
    expect(another()).not.toBeNull();
    await userEvent.click(another());
    const target = root.querySelector("[data-target-picker]")!;
    expect(textOf(target.querySelector("[data-action-heading]")!)).toBe("Move dishes");
    expect(target.querySelector("wt-top-bar")!.subtitle).toBe("from Bill 2");
    expect(
      target.querySelector<HTMLElementTagNameMap["wt-choice-tile"]>('[data-target="t7"]')!.hint,
    ).toBe("3 guests");
    await userEvent.click(panelBackButton(root.querySelector<HTMLElement>("[data-action-back]")!));

    expect(quantity(el, "c1").value).toBe(1);
    expect(confirm(el).disabled).toBe(true);
    await expect
      .poll(() => root.activeElement)
      .toBe(panel(el)!.querySelector("[data-action-heading]"));
  });

  it("Move is quiet until a dish and a destination are chosen", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    expect(textOf(confirm(el))).toBe("Move");
    expect(confirm(el).disabled).toBe(true);
    await toggleRow(el, "h1");
    expect(confirm(el).disabled).toBe(true);
    await toggleRow(el, "h1");
    await userEvent.click(destinations(el)[0]!);
    await el.updateComplete;
    expect(pressed(el)).toEqual(["wo-1"]);
    expect(confirm(el).disabled).toBe(true);
    await toggleRow(el, "h1");
    expect(confirm(el).disabled).toBe(false);
  });

  it("starts at zero and names the first two Cañas and their destination before moving them", async () => {
    const el = await mountScreen();
    const sent = capture(el, "move-dishes");
    await openMoveDishes(el);
    await userEvent.click(destination(el, "wo-4"));
    await el.updateComplete;
    expect(confirm(el).disabled).toBe(true);
    const control = quantity(el, "c1");
    expect(control.value).toBe(0);
    const plus = quantityButton(control);
    await userEvent.click(plus);
    await el.updateComplete;
    expect(textOf(confirm(el))).toBe("Move 1 dish to Bill 4");
    await userEvent.click(plus);
    await el.updateComplete;
    expect(textOf(confirm(el))).toBe("Move 2 dishes to Bill 4");
    await userEvent.click(confirm(el));
    await el.updateComplete;
    expect(sent).toEqual([
      { lineIds: ["c1", "c2"], toBillId: "wo-4", review: expect.any(Function) },
    ]);
    expect(panel(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-action-panel]")).toBeNull();
  });

  it("with New bill, Move sends toBillId null", async () => {
    const el = await mountScreen();
    const sent = capture(el, "move-dishes");
    await openMoveDishes(el);
    await toggleRow(el, "h1");
    await userEvent.click(destinations(el).at(-1)!);
    await el.updateComplete;
    expect(textOf(confirm(el))).toBe("Move 1 dish to a new bill");
    await userEvent.click(confirm(el));
    expect(sent).toEqual([{ lineIds: ["h1"], toBillId: null, review: expect.any(Function) }]);
  });

  it("the picker reads the bill on screen's balance: the floor greys what would break it", async () => {
    const balance: BillBalance = {
      workingOrderId: "wo-2",
      status: "open",
      total: "32.00",
      received: "21.00",
      reserved: "0.00",
      outstanding: "11.00",
      tips: "0.00",
      payments: [],
    };
    const el = await mountScreen({
      bills: [
        ...BILLS.filter((bill) => bill.workingOrderId !== "wo-2"),
        partyBill("wo-2", 2, "11.00", { total: "32.00", hasPayments: true }),
      ],
      balance,
    });
    await openMoveDishes(el);
    const [beerRow, ham] = picker(el).rows;
    expect(beerRow!.blocked).toBeNull();
    expect(ham!.blocked).toEqual({ reason: "floor", kept: "21.00" });
    await toggleRow(el, "c1");
    expect(picker(el).picks).toEqual(new Set(["c1", "c2"]));
  });
  it("the Move to choices are a group named by their heading", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    const group = panel(el)!.querySelector<HTMLElement>('[role="group"]')!;
    await expect.element(group).toHaveAccessibleName("Move them to");
    expect([...group.querySelectorAll<HTMLElement>("[data-move-dishes-to]")]).toEqual(
      destinations(el),
    );
  });

  for (const [what, reread] of [
    [
      "is presented",
      (bills: PartyBill[]) =>
        bills.map((bill) =>
          bill.workingOrderId === "wo-4" ? { ...bill, status: "placed" as const } : bill,
        ),
    ],
    [
      "leaves the party's bills",
      (bills: PartyBill[]) => bills.filter((bill) => bill.workingOrderId !== "wo-4"),
    ],
  ] as const) {
    it(`a chosen bill that ${what} on a re-read is no longer chosen, and Move sends nothing`, async () => {
      const el = await mountScreen();
      const sent = capture(el, "move-dishes");
      await openMoveDishes(el);
      await toggleRow(el, "h1");
      await userEvent.click(destination(el, "wo-4"));
      await el.updateComplete;
      expect(pressed(el)).toEqual(["wo-4"]);
      expect(confirm(el).disabled).toBe(false);
      el.bills = reread(BILLS);
      await el.updateComplete;
      expect(destinations(el).map((choice) => choice.dataset.moveDishesTo)).toEqual([
        "wo-1",
        "wo-3",
        "new",
      ]);
      expect(pressed(el)).toEqual([]);
      expect(confirm(el).disabled).toBe(true);
      expect(confirm(el).getAttribute("variant")).toBe("secondary");
      // A click on the host reaches the handler even while the inner button is disabled.
      confirm(el).click();
      await el.updateComplete;
      expect(sent).toEqual([]);
      expect(panel(el)).not.toBeNull();
    });
  }

  it.each(["ready", "Back", "bill change"])(
    "a delayed Move dishes opening follows %s",
    async (outcome) => {
      const el = await mountScreen();
      let ready!: () => void;
      el.addEventListener("move-dishes-open", (event) => {
        event.preventDefault();
        ready = (event as CustomEvent<{ ready: () => void }>).detail.ready;
      });
      await openMoveDishes(el);
      expect(panel(el)).toBeNull();
      expect(ready).toBeTypeOf("function");
      if (outcome === "Back") {
        await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-back]")!);
      } else if (outcome === "bill change") {
        el.orderId = "wo-1";
        await el.updateComplete;
      }
      ready();
      await el.updateComplete;
      expect(panel(el) !== null).toBe(outcome === "ready");
    },
  );

  it("Back closes the panel and sends nothing", async () => {
    const el = await mountScreen();
    const sent = capture(el, "move-dishes");
    await openMoveDishes(el);
    await toggleRow(el, "h1");
    await userEvent.click(
      panel(el)!.querySelector("wt-top-bar")!.shadowRoot!.querySelector("wt-button")!,
    );
    await expect.poll(() => panel(el)).toBeNull();
    expect(panel(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-action-panel]")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("Escape closes the panel and sends nothing", async () => {
    const el = await mountScreen();
    const sent = capture(el, "move-dishes");
    await openMoveDishes(el);
    await expect
      .poll(() => el.shadowRoot!.activeElement?.hasAttribute("data-action-heading"))
      .toBe(true);
    await toggleRow(el, "h1");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => panel(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-action-panel]")).toBeNull();
    expect(sent).toEqual([]);
  });

  describe("while busy", () => {
    async function busyPanel() {
      const el = await mountScreen();
      const sent = capture(el, "move-dishes");
      await openMoveDishes(el);
      await toggleRow(el, "h1");
      await userEvent.click(destinations(el).at(-1)!);
      await el.updateComplete;
      el.busy = true;
      await el.updateComplete;
      return { el, sent };
    }

    it("a quantity attempt changes nothing", async () => {
      const { el } = await busyPanel();
      await toggleRow(el, "c1");
      expect(picker(el).picks).toEqual(new Set(["h1"]));
    });

    it("a destination tap changes nothing", async () => {
      const { el } = await busyPanel();
      destinations(el)[0]!.shadowRoot!.querySelector("button")!.click();
      await el.updateComplete;
      expect(pressed(el)).toEqual(["new"]);
    });

    it("Move sends nothing and the panel stays", async () => {
      const { el, sent } = await busyPanel();
      confirm(el).click();
      await el.updateComplete;
      expect(sent).toEqual([]);
      expect(panel(el)).not.toBeNull();
    });
  });
});

describe("A803 move dishes refresh:", () => {
  async function moveTo(el: TillTableOrderScreen) {
    const sent = capture(el, "move-dishes");
    await userEvent.click(destinations(el).at(-1)!);
    await el.updateComplete;
    await userEvent.click(confirm(el));
    await el.updateComplete;
    return sent;
  }

  it("a re-read in which one picked dish left the bill keeps the row's first members", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    await toggleRow(el, "c1");
    await changeCount(el, "c1", -1);
    await changeCount(el, "c1", -1);
    expect(picker(el).picks).toEqual(new Set(["c1", "c2"]));
    el.lines = [...BEERS.slice(1), HAM];
    el.billBalance = {
      workingOrderId: "wo-2",
      status: "open",
      total: "27.00",
      received: "0.00",
      reserved: "0.00",
      outstanding: "27.00",
      tips: "0.00",
      payments: [],
    };
    await el.updateComplete;
    await picker(el).updateComplete;
    expect(picker(el).picks).toEqual(new Set(["c2", "c3"]));
    expect(await moveTo(el)).toEqual([
      { lineIds: ["c2", "c3"], toBillId: null, review: expect.any(Function) },
    ]);
  });

  it("a re-read in which identical dishes join a ticked row keeps its count from the row's first members, and Move sends exactly those", async () => {
    const noted = (dish: TabLine) => ({ ...dish, note: "no ice" });
    const el = await mountScreen({
      lines: [BEERS[0]!, BEERS[1]!, noted(BEERS[2]!), noted(BEERS[3]!), HAM],
    });
    await openMoveDishes(el);
    await toggleRow(el, "c3");
    expect(picker(el).picks).toEqual(new Set(["c3", "c4"]));
    el.lines = [...BEERS, HAM];
    await el.updateComplete;
    await picker(el).updateComplete;
    expect(picker(el).rows[0]!.members.map((member) => member.id)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
    ]);
    expect(picker(el).picks).toEqual(new Set(["c1", "c2"]));
    expect(await moveTo(el)).toEqual([
      { lineIds: ["c1", "c2"], toBillId: null, review: expect.any(Function) },
    ]);
  });

  it("an update that changes nothing the rows are drawn from does not group the bill's dishes again", async () => {
    const offerReads = { count: 0 };
    const counted = (dish: TabLine): TabLine => {
      const { menuItemId, ...rest } = dish;
      return Object.defineProperty(rest, "menuItemId", {
        enumerable: true,
        get() {
          offerReads.count++;
          return menuItemId;
        },
      }) as TabLine;
    };
    const el = await mountScreen({ lines: [...BEERS, HAM].map(counted) });
    await openMoveDishes(el);
    await toggleRow(el, "c1");
    expect(offerReads.count).toBeGreaterThan(0);
    offerReads.count = 0;
    el.requestUpdate();
    await el.updateComplete;
    expect(offerReads.count).toBe(0);
  });

  it("an update that changes nothing the rows are drawn from draws them no more often with every dish picked than with none", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    const reads = countLineReads(el);
    const update = async () => {
      reads.count = 0;
      el.requestUpdate();
      await el.updateComplete;
      return reads.count;
    };
    const nonePicked = await update();
    await toggleRow(el, "c1");
    await toggleRow(el, "h1");
    expect(picker(el).picks).toEqual(new Set(["c1", "c2", "c3", "c4", "h1"]));
    const oneDrawing = [...BEERS, HAM].length + 1;
    expect(await update()).toBeLessThan(nonePicked + oneDrawing);
  });

  it("a re-read with every dish picked works each dish out no more than one drawing beyond a re-read with none", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    const reads = countLineReads(el);
    const reread = async () => {
      reads.count = 0;
      el.lines = el.lines.map((dish) => ({ ...dish }));
      await el.updateComplete;
      return reads.count;
    };
    const nonePicked = await reread();
    await toggleRow(el, "c1");
    await toggleRow(el, "h1");
    const oneDrawing = [...BEERS, HAM].length + 1;
    expect(await reread()).toBeLessThanOrEqual(nonePicked + oneDrawing);
    expect(picker(el).picks).toEqual(new Set(["c1", "c2", "c3", "c4", "h1"]));
  });

  it("with nothing picked, a re-read draws the rows no more often than an update that changes nothing", async () => {
    const balance: BillBalance = {
      workingOrderId: "wo-2",
      status: "open",
      total: "32.00",
      received: "0.00",
      reserved: "0.00",
      outstanding: "32.00",
      tips: "0.00",
      payments: [],
    };
    const el = await mountScreen({ balance });
    await openMoveDishes(el);
    const reads = countLineReads(el);
    el.requestUpdate();
    await el.updateComplete;
    reads.count = 0;
    el.requestUpdate();
    await el.updateComplete;
    const unchanged = reads.count;
    reads.count = 0;
    el.billBalance = { ...balance };
    await el.updateComplete;
    expect(picker(el).picks).toEqual(new Set());
    expect(reads.count).toBe(unchanged);
  });
});

describe("A803 move dishes, as Split by item and Transfer items did:", () => {
  async function send(el: TillTableOrderScreen, to = "new") {
    await userEvent.click(panel(el)!.querySelector<HTMLElement>(`[data-move-dishes-to="${to}"]`)!);
    await el.updateComplete;
    const sent = capture(el, "move-dishes");
    await userEvent.click(confirm(el));
    await el.updateComplete;
    return sent;
  }

  it("Move sends the picked dishes' ids in a composed, bubbling move-dishes event and closes the panel", async () => {
    const el = await mountScreen();
    let captured: CustomEvent | undefined;
    el.addEventListener("move-dishes", (event) => (captured = event as CustomEvent));
    await openMoveDishes(el);
    await toggleRow(el, "h1");
    await send(el, "wo-1");
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
    expect(captured!.detail).toEqual({
      lineIds: ["h1"],
      toBillId: "wo-1",
      review: expect.any(Function),
    });
    expect(el.shadowRoot!.querySelector("[data-action-panel]")).toBeNull();
  });

  it("sends nothing while no dish is picked, even when Move's native button is pressed", async () => {
    const el = await mountScreen();
    const sent = capture(el, "move-dishes");
    await openMoveDishes(el);
    await userEvent.click(destinations(el)[0]!);
    await el.updateComplete;
    confirm(el).shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    await el.updateComplete;
    expect(sent).toEqual([]);
    expect(panel(el)).not.toBeNull();
  });

  it("offers dishes only, never a child extras row", async () => {
    const extra = line("x1", 6, { name: "Cheese", parentLineNo: 5, portion: false });
    const el = await mountScreen({ lines: [...BEERS, HAM, extra] });
    await openMoveDishes(el);
    const ids = picker(el).rows.flatMap((row) => row.members.map((member) => member.id));
    expect(ids).toContain("h1");
    expect(ids).not.toContain("x1");
  });

  it("Back clears the picks, so a new opening starts at zero", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    await toggleRow(el, "c1");
    await changeCount(el, "c1", -1);
    expect(picker(el).picks).toEqual(new Set(["c1", "c2", "c3"]));
    await userEvent.click(
      panel(el)!.querySelector("wt-top-bar")!.shadowRoot!.querySelector("wt-button")!,
    );
    await expect.poll(() => panel(el)).toBeNull();
    await openMoveDishes(el);
    await toggleRow(el, "c1");
    expect(picker(el).picks).toEqual(new Set(["c1", "c2", "c3", "c4"]));
  });

  it("a − or + left over from a closed panel does not replace a new panel's picks", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    await toggleRow(el, "c1");
    await changeCount(el, "c1", -1);
    const old = quantity(el, "c1");
    const oldDec = quantityButton(old, -1);
    const oldInc = quantityButton(old);
    expect([oldDec.disabled, oldInc.disabled]).toEqual([false, false]);
    expect(await send(el)).toHaveLength(1);
    await openMoveDishes(el);
    await toggleRow(el, "h1");
    for (const old of [oldDec, oldInc]) {
      old.click();
      await el.updateComplete;
      await picker(el).updateComplete;
      expect(picker(el).picks).toEqual(new Set(["h1"]));
    }
  });

  it("choosing every portion of a grouped row sends every member's id", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    await toggleRow(el, "c1");
    expect(await send(el)).toEqual([
      { lineIds: ["c1", "c2", "c3", "c4"], toBillId: null, review: expect.any(Function) },
    ]);
  });

  it("reducing a grouped row to zero leaves none of its members", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    await toggleRow(el, "c1");
    await toggleRow(el, "c1");
    expect(picker(el).picks).toEqual(new Set());
    expect(confirm(el).disabled).toBe(true);
  });

  it("stepping a grouped row back up adds the next member", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    await toggleRow(el, "c1");
    await changeCount(el, "c1", -1);
    await changeCount(el, "c1", -1);
    await changeCount(el, "c1", 1);
    expect(await send(el)).toEqual([
      { lineIds: ["c1", "c2", "c3"], toBillId: null, review: expect.any(Function) },
    ]);
  });

  it("a picked dish that joins a group on a refresh keeps its count, taken from the group's first dishes", async () => {
    const decaf = { ...BEERS[3]!, note: "Decaf" };
    const el = await mountScreen({ lines: [BEERS[0]!, BEERS[1]!, BEERS[2]!, decaf, HAM] });
    await openMoveDishes(el);
    await toggleRow(el, "c4");
    el.lines = [...BEERS, HAM];
    await el.updateComplete;
    await picker(el).updateComplete;
    expect(picker(el).picks).toEqual(new Set(["c1"]));
    expect(await send(el)).toEqual([
      { lineIds: ["c1"], toBillId: null, review: expect.any(Function) },
    ]);
  });

  it("heads the panel from a bill named after a slot with the name as typed", async () => {
    const el = await mountScreen({
      bills: [partyBill("wo-2", 2, "32.00", { billName: "{bill}" }), partyBill("wo-1", 1, "10.00")],
    });
    await openMoveDishes(el);
    expect(panel(el)!.querySelector("wt-top-bar")!.subtitle).toBe("from Bill 2 · {bill}");
  });

  const buttonFill = (host: Element) =>
    getComputedStyle(host.shadowRoot!.querySelector("button")!).backgroundColor;

  it.each(["light", "dark"] as const)(
    "draws Move quiet until it can send, then in the primary colour (%s theme)",
    async (theme) => {
      const el = await mountScreen();
      el.parentElement!.setAttribute("data-theme", theme);
      await openMoveDishes(el);
      await userEvent.click(destinations(el)[0]!);
      await el.updateComplete;
      await (confirm(el) as unknown as { updateComplete: Promise<unknown> }).updateComplete;
      expect(confirm(el).hasAttribute("disabled")).toBe(true);
      expect(confirm(el).getAttribute("variant")).toBe("secondary");
      const quiet = buttonFill(confirm(el));
      await toggleRow(el, "h1");
      await (confirm(el) as unknown as { updateComplete: Promise<unknown> }).updateComplete;
      expect(confirm(el).hasAttribute("disabled")).toBe(false);
      expect(confirm(el).getAttribute("variant")).toBe("primary");
      expect(buttonFill(confirm(el))).not.toBe(quiet);
    },
  );
});

describe("on a phone with the order's foot held at the bottom", () => {
  it("draws the dish rows edge to edge and keeps the action above the foot", async () => {
    const { width, height } = { width: innerWidth, height: innerHeight };
    await page.viewport(390, 600);
    try {
      const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
        products: [],
        lines: [...BEERS, HAM],
        orderId: "wo-2",
        party,
        bills: [BILLS[1]!, BILLS[3]!],
        billBalance: null,
        tables: [table("t4"), table("t7")],
        handheld: true,
      });
      await resized(el);
      await openMoveDishes(el);
      await resized(el);
      const button = confirm(el).getBoundingClientRect();
      const dialog = el.shadowRoot!.querySelector("wt-dialog[data-action-panel]")!;
      const viewport = dialog.shadowRoot!.querySelector("dialog")!.getBoundingClientRect();
      expect(viewport).toMatchObject({ width: 390, height: 600 });
      expect(button.bottom).toBeLessThan(viewport.bottom);
      expect(button).toMatchObject({ left: 12, width: 366 });
      const row = picker(el).shadowRoot!.querySelector('[data-pick-row="c1"]')!;
      expect(row.getBoundingClientRect()).toMatchObject({ left: 0, width: 390 });
      const name = row.querySelector(".name")!;
      expect(name.getBoundingClientRect().left).toBe(16);
      expect(getComputedStyle(name)).toMatchObject({ fontSize: "16px", fontWeight: "500" });
      expect(getComputedStyle(row.querySelector(".extra")!).fontSize).toBe("13px");
      expect(getComputedStyle(confirm(el).shadowRoot!.querySelector("button")!).fontSize).toBe(
        "16px",
      );
      const pill = destinations(el)[0]!.shadowRoot!.querySelector("button")!;
      expect(getComputedStyle(pill).fontSize).toBe("15px");
      const [bill, newBill, anotherTable] = destinations(el).map((choice) =>
        choice.getBoundingClientRect(),
      );
      expect(bill!.left).toBe(12);
      expect(newBill!.top).toBe(bill!.top);
      expect(anotherTable!.top).toBe(bill!.top);
    } finally {
      await page.viewport(width, height);
    }
  });
});

it("fallback layout returns to the bill menu after Escape closes Move dishes", async () => {
  const el = await mountScreen();
  await openMoveDishes(el);
  const dialog = el.shadowRoot!.querySelector("wt-dialog[data-action-panel]")!;
  const closed = new Promise((resolve) =>
    dialog.addEventListener("wt-close", resolve, { once: true }),
  );
  await userEvent.keyboard("{Escape}");
  await closed;
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(menu(el));
  expect(panel(el)).toBeNull();
});
