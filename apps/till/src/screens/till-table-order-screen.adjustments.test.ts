import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decimal, formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import "./till-table-order-screen.js";
import type { AdjustDetail, TillTableOrderScreen } from "./till-table-order-screen.js";
import type { PartyBill, TabLine, TableParty } from "../api/client.js";

// The table screen's Give away and Discount actions, and the original price of an adjusted line
// (service plan Task 11, part B).

const money = (amount: string) => formatMoney(decimal(amount), currentLocale());
const olivesWithPizza = () =>
  t("table.extra_of").replace("{extra}", "Olives").replace("{dish}", "Pizza");

const party: TableParty = {
  id: "v1",
  revision: 4,
  guestCount: 3,
  state: "open",
  name: "Ana",
  displayName: "Ana",
  mainBillId: "wo-4",
  outstanding: "74.50",
  billCount: 1,
  tableIds: ["t4"],
  unsentDrafts: [],
  reminder: null,
};

const openBill: PartyBill = {
  workingOrderId: "wo-4",
  partyId: "v1",
  label: null,
  status: "open",
  total: "74.50",
  outstanding: "74.50",
  hasPayments: false,
  receiptAvailable: false,
};

function line(lineNo: number, over: Partial<TabLine>): TabLine {
  return {
    id: `line-${lineNo}`,
    groupId: null,
    lineNo,
    productId: null,
    quantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "1.00",
    servedAt: null,
    courseId: null,
    sentAt: "2026-09-30T09:00:00.000Z",
    firedAt: "2026-09-30T09:00:00.000Z",
    state: "queued",
    note: null,
    listId: null,
    menuItemId: null,
    parentProductId: null,
    ...over,
  };
}

const steaks = line(1, { name: "Steak", quantity: "2.000", unitPriceGross: "25.00" });
const pizza = line(2, { name: "Pizza", unitPriceGross: "9.00" });
const olives = line(3, {
  name: "Olives",
  parentLineNo: 2,
  unitPrecision: null,
  unitPriceGross: "1.50",
  state: null,
});
const ham = line(4, { name: "Ham", quantity: "0.333", unitPrecision: 3, unitPriceGross: "24.00" });
const servedBread = line(5, {
  name: "Bread",
  unitPriceGross: "2.50",
  servedAt: "2026-09-30T09:10:00.000Z",
});
const lines = [steaks, pizza, olives, ham, servedBread];

async function mountScreen(over: Partial<TillTableOrderScreen> = {}) {
  const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products: [],
    lines,
    statuses: [],
    orderId: "wo-4",
    party,
    bills: [openBill],
    ...over,
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
  await el.updateComplete;
  return el;
}

const action = (el: TillTableOrderScreen, kind: "comp" | "discount", lineNo: number) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-${kind}-line="${lineNo}"]`);

function capture(el: TillTableOrderScreen): AdjustDetail[] {
  const seen: AdjustDetail[] = [];
  el.addEventListener("adjust", (event) => {
    expect(event.bubbles && event.composed).toBe(true);
    seen.push((event as CustomEvent<AdjustDetail>).detail);
  });
  return seen;
}

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-table-order-screen: giving away and discounting a dish", () => {
  it("offers Give away and Discount on each dish of an open bill and on each extra, naming the extra with its dish", async () => {
    const el = await mountScreen();
    for (const lineNo of [1, 2, 3, 4, 5]) {
      expect(action(el, "comp", lineNo)).not.toBeNull();
      expect(action(el, "discount", lineNo)).not.toBeNull();
    }
    expect(action(el, "comp", 1)!.getAttribute("aria-label")).toBe(
      `${t("table.comp_line")} · Steak`,
    );
    expect(action(el, "discount", 1)!.getAttribute("aria-label")).toBe(
      `${t("table.discount_line")} · Steak`,
    );
    expect(action(el, "comp", 3)!.getAttribute("aria-label")).toBe(
      `${t("table.comp_line")} · ${olivesWithPizza()}`,
    );
    expect(action(el, "discount", 3)!.getAttribute("aria-label")).toBe(
      `${t("table.discount_line")} · ${olivesWithPizza()}`,
    );
  });

  it("gives away or discounts an extra on its own and whole, even when it is several", async () => {
    const el = await mountScreen({
      lines: [
        { ...pizza, quantity: "2.000" },
        { ...olives, quantity: "2.000", unitPrecision: 0 },
      ],
    });
    const asked = capture(el);
    action(el, "comp", 3)!.click();
    action(el, "discount", 3)!.click();
    const target = {
      lineId: "line-3",
      name: olivesWithPizza(),
      quantity: "2",
      total: "3.00",
      unitTotal: null,
      started: false,
      extra: true,
      kitchenTold: true,
    };
    expect(asked).toEqual([
      { kind: "comp", target },
      { kind: "discount", target },
    ]);
  });

  it("names an extra in Spanish with its dish", async () => {
    setLocale("es-ES");
    const el = await mountScreen();
    expect(action(el, "comp", 3)!.getAttribute("aria-label")).toBe("Invitar · Olives (con Pizza)");
  });

  it("asks the app to adjust a dish of several whole units, which may be done one at a time", async () => {
    const el = await mountScreen();
    const asked = capture(el);
    action(el, "comp", 1)!.click();
    action(el, "discount", 1)!.click();
    const target = {
      lineId: "line-1",
      name: "Steak",
      quantity: "2",
      total: "50.00",
      unitTotal: "25.00",
      started: false,
    };
    expect(asked).toEqual([
      { kind: "comp", target },
      { kind: "discount", target },
    ]);
  });

  it("covers a dish with its extras, and one of several with its share of them", async () => {
    const el = await mountScreen({ lines: [{ ...pizza, quantity: "2.000" }, olives] });
    const asked = capture(el);
    action(el, "comp", 2)!.click();
    action(el, "discount", 2)!.click();
    for (const { target } of asked)
      expect(target).toMatchObject({
        lineId: "line-2",
        name: "Pizza",
        quantity: "2",
        total: "19.50",
        unitTotal: "9.75",
      });
    expect(asked).toHaveLength(2);
  });

  it("does a weighed dish whole, and says it is weighed", async () => {
    const el = await mountScreen();
    const asked = capture(el);
    action(el, "discount", 4)!.click();
    action(el, "comp", 4)!.click();
    for (const { target } of asked)
      expect(target).toMatchObject({
        quantity: "0.333",
        total: "7.99",
        unitTotal: null,
        weighed: true,
      });
    expect(asked).toHaveLength(2);
  });

  it("offers them on a dish already served", async () => {
    const el = await mountScreen();
    const asked = capture(el);
    action(el, "comp", 5)!.click();
    expect(asked[0]!.target).toMatchObject({ lineId: "line-5", name: "Bread", total: "2.50" });
  });

  it("offers neither on a bill with no party, nor on a paid one", async () => {
    const noParty = await mountScreen({ party: null, bills: [] });
    expect(action(noParty, "comp", 1)).toBeNull();
    expect(noParty.shadowRoot!.querySelector("[data-discount-bill]")).toBeNull();

    const paid = await mountScreen({ bills: [{ ...openBill, status: "settled" }] });
    expect(action(paid, "comp", 1)).toBeNull();
    expect(action(paid, "discount", 1)).toBeNull();
    expect(paid.shadowRoot!.querySelector("[data-discount-bill]")).toBeNull();
  });
});

describe("till-table-order-screen: cancelling a dish", () => {
  it("asks the app to cancel a dish, which one at a time covers even with its extras, as Give away does", async () => {
    const el = await mountScreen({ lines: [{ ...pizza, quantity: "2.000" }, olives] });
    const asked = capture(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-cancel-line="2"]')!.click();
    action(el, "comp", 2)!.click();
    expect(asked).toEqual([
      {
        kind: "cancel",
        target: {
          lineId: "line-2",
          name: "Pizza",
          quantity: "2",
          total: "19.50",
          unitTotal: "9.75",
          started: false,
        },
      },
      { kind: "comp", target: expect.objectContaining({ unitTotal: "9.75" }) },
    ]);
  });

  const cancelOf = (el: TillTableOrderScreen, lineNo: number) =>
    el.shadowRoot!.querySelector<HTMLElement>(`[data-cancel-line="${lineNo}"]`);

  it("cancels an extra on its own and whole, as coming off the bill and telling the kitchen, where its dish offers Cancel", async () => {
    const el = await mountScreen({
      lines: [
        { ...pizza, quantity: "2.000", state: "preparing" },
        { ...olives, quantity: "2.000" },
      ],
    });
    const asked = capture(el);
    expect(cancelOf(el, 3)!.getAttribute("aria-label")).toBe(
      `${t("table.cancel_line")} · ${olivesWithPizza()}`,
    );
    cancelOf(el, 3)!.click();
    expect(asked).toEqual([
      {
        kind: "cancel",
        target: {
          lineId: "line-3",
          name: olivesWithPizza(),
          quantity: "2",
          total: "3.00",
          unitTotal: null,
          started: false,
          extra: true,
          kitchenTold: true,
        },
      },
    ]);
  });

  it("offers no Cancel on an extra whose dish offers none", async () => {
    const held = { ...pizza, sentAt: null, firedAt: null };
    const el = await mountScreen({ lines: [held, olives] });
    expect(el.shadowRoot!.querySelector('[data-send-line="2"]')).not.toBeNull();
    expect(cancelOf(el, 2)).toBeNull();
    expect(cancelOf(el, 3)).toBeNull();
    expect(action(el, "comp", 3)).not.toBeNull();
  });
});

describe("till-table-order-screen: a dish split by a give-away", () => {
  const total = (row: Element) =>
    row
      .querySelector(".line-total")!
      .textContent!.replace(/[ \n\t]+/g, " ")
      .trim();

  it("shows the part given away with its own extra under it, and the part left with its own", async () => {
    // As the server lists Pizza x2 with an olive each once one was given away: the part split off
    // and its olive are numbered after every other row, the olive straight after its dish.
    const el = await mountScreen({
      lines: [
        pizza,
        olives,
        steaks,
        { ...pizza, id: "line-6", lineNo: 6, unitPriceGross: "0.00", listUnitPriceGross: "9.00" },
        {
          ...olives,
          id: "line-7",
          lineNo: 7,
          parentLineNo: 6,
          unitPriceGross: "0.00",
          listUnitPriceGross: "1.50",
        },
      ],
    });
    const rows = [...el.shadowRoot!.querySelectorAll(".pending-line")];
    const rowOf = (lineNo: number) =>
      rows.findIndex((row) => row.querySelector(`[data-comp-line="${lineNo}"]`) !== null);

    expect([2, 3, 1, 6, 7].map(rowOf)).toEqual([0, 1, 2, 3, 4]);
    expect(rows.map((row) => row.classList.contains("child-line"))).toEqual([
      false,
      true,
      false,
      false,
      true,
    ]);
    expect(total(rows[1]!)).toBe(money("1.50"));
    expect(total(rows[3]!)).toBe(`${t("table.price_was")} ${money("9.00")} ${money("0.00")}`);
    expect(total(rows[4]!)).toBe(`${t("table.price_was")} ${money("1.50")} ${money("0.00")}`);
  });
});

describe("till-table-order-screen: discounting the whole bill", () => {
  it("asks the app to discount the bill on screen, naming it and its total", async () => {
    const el = await mountScreen();
    const asked = capture(el);
    const button = el.shadowRoot!.querySelector<HTMLElement>("[data-discount-bill]")!;
    expect(button.textContent!.trim()).toBe(t("table.discount_bill"));

    button.click();

    expect(asked).toEqual([
      {
        kind: "discount",
        target: {
          lineId: null,
          name: t("table.bill_of").replace("{party}", "Ana").replace("{n}", "1"),
          quantity: null,
          total: "70.99",
          unitTotal: null,
        },
      },
    ]);
  });

  it("offers no bill discount on an empty bill", async () => {
    const el = await mountScreen({ lines: [] });
    expect(el.shadowRoot!.querySelector("[data-discount-bill]")).toBeNull();
  });
});

describe("till-table-order-screen: the price an adjusted line had", () => {
  const total = (row: Element) =>
    row
      .querySelector(".line-total")!
      .textContent!.replace(/[ \n\t]+/g, " ")
      .trim();

  it("shows a given-away dish's original price struck through before its new one, with its extras", async () => {
    const el = await mountScreen({
      lines: [
        { ...pizza, unitPriceGross: "0.00", listUnitPriceGross: "9.00" },
        { ...olives, unitPriceGross: "0.00", listUnitPriceGross: "1.50" },
        steaks,
      ],
    });
    const rows = [...el.shadowRoot!.querySelectorAll(".pending-line")];

    expect(rows[0]!.querySelector("s")!.textContent).toBe(money("9.00"));
    expect(total(rows[0]!)).toBe(`${t("table.price_was")} ${money("9.00")} ${money("0.00")}`);
    expect(total(rows[1]!)).toBe(`${t("table.price_was")} ${money("1.50")} ${money("0.00")}`);
    // A line never adjusted shows its price alone.
    expect(rows[2]!.querySelector("s")).toBeNull();
    expect(total(rows[2]!)).toBe(money("50.00"));
    // The struck price is read as the old one, not as a second price.
    const was = rows[0]!.querySelector<HTMLElement>("[data-price-was]")!;
    expect(was.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  it("shows a discounted served line's original total, and a split-off part at its own price plainly", async () => {
    const el = await mountScreen({
      lines: [
        { ...servedBread, quantity: "2.000", unitPriceGross: "2.25", listUnitPriceGross: "2.50" },
        { ...steaks, quantity: "1.000", listUnitPriceGross: "25.00" },
      ],
    });
    const served = el.shadowRoot!.querySelector(".served-line")!;
    const pending = el.shadowRoot!.querySelector(".pending-line")!;
    expect(total(served)).toBe(`${t("table.price_was")} ${money("5.00")} ${money("4.50")}`);
    expect(total(pending)).toBe(money("25.00"));
  });
});
