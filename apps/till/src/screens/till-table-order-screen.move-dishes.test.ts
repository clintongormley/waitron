import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { BillBalance, PartyBill, TableParty, TableState, TabLine } from "../api/client.js";
import { partyBill, switcherParty } from "./till-table-order-screen.bill-switcher.test-helpers.js";
import type { TillPortionPicker } from "../widgets/portion-picker.js";

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

const CANAS = [line("c1", 1), line("c2", 2), line("c3", 3), line("c4", 4)];
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

/** Bill 2 on screen; Bill 1 and Bill 4 take dishes; Bill 3 holds a payment and Bill 5 is
 * presented, so neither does. Given out of number order. */
const BILLS = [
  partyBill("wo-4", 4, "0.00"),
  partyBill("wo-2", 2, "32.00"),
  partyBill("wo-3", 3, "5.00", { total: "10.00", hasPayments: true }),
  partyBill("wo-1", 1, "10.00", { billName: "Ana" }),
  partyBill("wo-5", 5, "8.00", { status: "placed" }),
];

async function mountScreen(
  over: { bills?: PartyBill[]; balance?: BillBalance | null; party?: TableParty | null } = {},
) {
  const shownParty = over.party === undefined ? party : over.party;
  const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products: [],
    lines: [...CANAS, HAM],
    orderId: "wo-2",
    party: shownParty,
    bills: over.bills ?? BILLS,
    billBalance: over.balance ?? null,
    tables: shownParty === null ? [] : [table("t4")],
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
  ...panel(el)!.querySelectorAll<HTMLElement>("[data-move-dishes-to]"),
];
const confirm = (el: TillTableOrderScreen) =>
  panel(el)!.querySelector<HTMLElement & { disabled: boolean }>("[data-move-dishes-confirm]")!;
const textOf = (node: Element) => node.textContent!.replace(/\s+/g, " ").trim();
const pressed = (el: TillTableOrderScreen) =>
  destinations(el)
    .filter((choice) => choice.getAttribute("aria-pressed") === "true")
    .map((choice) => choice.dataset.moveDishesTo);

async function openMoveDishes(el: TillTableOrderScreen) {
  await userEvent.click(menu(el));
  await userEvent.click(moveItem(el)!);
  await el.updateComplete;
}

async function tick(el: TillTableOrderScreen, id: string) {
  const box = picker(el).shadowRoot!.querySelector<HTMLInputElement>(`[data-pick="${id}"]`)!;
  await userEvent.click(box);
  await el.updateComplete;
  await picker(el).updateComplete;
}

async function step(el: TillTableOrderScreen, which: "dec" | "inc", id: string) {
  const button = picker(el).shadowRoot!.querySelector<HTMLElement>(`[data-pick-${which}="${id}"]`)!;
  await userEvent.click(button);
  await el.updateComplete;
  await picker(el).updateComplete;
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
  it("the ⋮ of an open bill of a party lists Move dishes… where Split by item is", async () => {
    const el = await mountScreen();
    const items = [...menu(el).querySelectorAll<HTMLElement>("[data-action]")].map(
      (button) => button.dataset.action,
    );
    expect(items.indexOf("move-dishes")).toBeGreaterThanOrEqual(0);
    expect(items[items.indexOf("move-dishes") + 1]).toBe("split");
    expect(textOf(moveItem(el)!)).toBe("Move dishes…");
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
    expect(menu(el).querySelector('[data-action="split"]')).not.toBeNull();
    expect(moveItem(el)).toBeNull();
  });

  it("choosing it opens the panel with its heading focused", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    const heading = panel(el)!.querySelector("h2")!;
    expect(textOf(heading)).toBe("Move dishes from Bill 2");
    await expect.poll(() => el.shadowRoot!.activeElement).toBe(heading);
    expect(panel(el)!.closest("[data-action-panel]")).not.toBeNull();
    expect(picker(el).rows.map((row) => row.members.map((member) => member.id))).toEqual([
      ["c1", "c2", "c3", "c4"],
      ["h1"],
    ]);
  });

  it("offers the party's other open bills with no payment in number order, then + New bill", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    expect(destinations(el).map((choice) => choice.dataset.moveDishesTo)).toEqual([
      "wo-1",
      "wo-4",
      "new",
    ]);
    expect(destinations(el).map(textOf)).toEqual(["Bill 1 · Ana", "Bill 4", "+ New bill"]);
    expect(destinations(el).map((choice) => choice.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "false",
    ]);
    expect(textOf(panel(el)!.querySelector("[data-move-dishes-to-heading]")!)).toBe("Move to");
  });

  it("Move is quiet until a dish and a destination are chosen", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    expect(textOf(confirm(el))).toBe("Move");
    expect(confirm(el).disabled).toBe(true);
    await tick(el, "h1");
    expect(confirm(el).disabled).toBe(true);
    await tick(el, "h1");
    await userEvent.click(destinations(el)[0]!);
    await el.updateComplete;
    expect(destinations(el)[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(confirm(el).disabled).toBe(true);
    await tick(el, "h1");
    expect(confirm(el).disabled).toBe(false);
  });

  it("ticking the Caña row and pressing − twice, then Move, sends the first two Cañas to Bill 4", async () => {
    const el = await mountScreen();
    const sent = capture(el, "move-dishes");
    await openMoveDishes(el);
    await tick(el, "c1");
    await step(el, "dec", "c1");
    await step(el, "dec", "c1");
    await userEvent.click(destinations(el)[1]!);
    await el.updateComplete;
    await userEvent.click(confirm(el));
    await el.updateComplete;
    expect(sent).toEqual([{ lineIds: ["c1", "c2"], toBillId: "wo-4" }]);
    expect(panel(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-action-panel]")).toBeNull();
  });

  it("with + New bill, Move sends toBillId null", async () => {
    const el = await mountScreen();
    const sent = capture(el, "move-dishes");
    await openMoveDishes(el);
    await tick(el, "h1");
    await userEvent.click(destinations(el).at(-1)!);
    await el.updateComplete;
    await userEvent.click(confirm(el));
    expect(sent).toEqual([{ lineIds: ["h1"], toBillId: null }]);
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
      paidLines: [],
    };
    const el = await mountScreen({
      bills: [
        ...BILLS.filter((bill) => bill.workingOrderId !== "wo-2"),
        partyBill("wo-2", 2, "11.00", { total: "32.00", hasPayments: true }),
      ],
      balance,
    });
    await openMoveDishes(el);
    const [canas, ham] = picker(el).rows;
    expect(canas!.blocked).toBeNull();
    expect(ham!.blocked).toEqual({ reason: "floor", kept: "21.00" });
    await tick(el, "c1");
    expect(picker(el).picks).toEqual(new Set(["c1", "c2"]));
  });
  it("the Move to choices are a group named by their heading", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    const group = panel(el)!.querySelector<HTMLElement>('[role="group"]')!;
    await expect.element(group).toHaveAccessibleName("Move to");
    expect([...group.querySelectorAll<HTMLElement>("[data-move-dishes-to]")]).toEqual(
      destinations(el),
    );
  });

  for (const [what, reread] of [
    [
      "gains a payment",
      (bills: PartyBill[]) =>
        bills.map((bill) =>
          bill.workingOrderId === "wo-4" ? { ...bill, hasPayments: true } : bill,
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
      await tick(el, "h1");
      await userEvent.click(destinations(el)[1]!);
      await el.updateComplete;
      expect(pressed(el)).toEqual(["wo-4"]);
      expect(confirm(el).disabled).toBe(false);
      el.bills = reread(BILLS);
      await el.updateComplete;
      expect(destinations(el).map((choice) => choice.dataset.moveDishesTo)).toEqual([
        "wo-1",
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

  it("Back closes the panel and sends nothing", async () => {
    const el = await mountScreen();
    const sent = capture(el, "move-dishes");
    await openMoveDishes(el);
    await tick(el, "h1");
    await userEvent.click(panel(el)!.querySelector<HTMLElement>("[data-action-back]")!);
    await el.updateComplete;
    expect(panel(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-action-panel]")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("Escape closes the panel and sends nothing", async () => {
    const el = await mountScreen();
    const sent = capture(el, "move-dishes");
    await openMoveDishes(el);
    await expect.poll(() => el.shadowRoot!.activeElement?.tagName).toBe("H2");
    await tick(el, "h1");
    await userEvent.keyboard("{Escape}");
    await el.updateComplete;
    expect(panel(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-action-panel]")).toBeNull();
    expect(sent).toEqual([]);
  });

  describe("while busy", () => {
    async function busyPanel() {
      const el = await mountScreen();
      const sent = capture(el, "move-dishes");
      await openMoveDishes(el);
      await tick(el, "h1");
      await userEvent.click(destinations(el).at(-1)!);
      await el.updateComplete;
      el.busy = true;
      await el.updateComplete;
      return { el, sent };
    }

    it("a tick changes nothing", async () => {
      const { el } = await busyPanel();
      await tick(el, "c1");
      expect(picker(el).picks).toEqual(new Set(["h1"]));
    });

    it("a destination tap changes nothing", async () => {
      const { el } = await busyPanel();
      await userEvent.click(destinations(el)[0]!);
      await el.updateComplete;
      expect(pressed(el)).toEqual(["new"]);
    });

    it("Move sends nothing and the panel stays", async () => {
      const { el, sent } = await busyPanel();
      await userEvent.click(confirm(el));
      await el.updateComplete;
      expect(sent).toEqual([]);
      expect(panel(el)).not.toBeNull();
    });
  });

  it("choosing Move dishes… again from the ⋮ while it is open starts with nothing picked and no destination", async () => {
    const el = await mountScreen();
    await openMoveDishes(el);
    await tick(el, "h1");
    await userEvent.click(destinations(el)[0]!);
    await el.updateComplete;
    expect(picker(el).picks).toEqual(new Set(["h1"]));
    expect(pressed(el)).toEqual(["wo-1"]);
    await openMoveDishes(el);
    expect(picker(el).picks).toEqual(new Set());
    expect(pressed(el)).toEqual([]);
    expect(confirm(el).disabled).toBe(true);
  });
});
