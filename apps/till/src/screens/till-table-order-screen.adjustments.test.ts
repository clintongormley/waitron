import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decimal, formatMoney, grossOf } from "@waitron/shared";
import { userEvent } from "vitest/browser";
import { openSentDish, openSentMore } from "./till-table-order-screen.sent.test-helpers.js";
import { current, row } from "./till-table-order-screen.current-orders.test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import "./till-table-order-screen.js";
import type { AdjustDetail, TillTableOrderScreen } from "./till-table-order-screen.js";
import type { PartyBill, TabLine, TableParty } from "../api/client.js";

const money = (amount: string) => formatMoney(decimal(amount), currentLocale());
const olivesWithPizza = () =>
  t("table.extra_of").replace("{extra}", "Olives").replace("{dish}", "Pizza");

const party: TableParty = {
  kitchenNote: { scope: { partyId: "v1" }, note: null, revision: 0, ownerRevision: 4 },
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
  revision: 0,
  invoiceType: "F2",
  recipient: null,
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
    stationId: null,
    movable: false,
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
  const shown = over.lines ?? lines;
  const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products: [],
    lines,
    orderId: "wo-4",
    party,
    bills: [openBill],
    currentOrders: current({
      groups: [],
      reminder: null,
      ungrouped: shown
        .filter((line) => line.parentLineNo == null)
        .map((line) =>
          row(line.id, line.name!, line.quantity, {
            lineNo: line.lineNo,
            unitPrecision: line.unitPrecision,
            netAmount: grossOf(line.unitPriceGross, line.quantity),
            billStatus: over.bills?.[0]?.status ?? "open",
            servedAt: line.servedAt,
            servedQuantity: line.servedAt === null ? "0.000" : line.quantity,
            extras: shown
              .filter((extra) => extra.parentLineNo === line.lineNo)
              .map((extra) => ({
                lineId: extra.id,
                name: extra.name!,
                quantity: extra.quantity,
                unitPriceGross: extra.unitPriceGross,
                priceQuantity: "1.000",
                netAmount: grossOf(extra.unitPriceGross, extra.quantity),
              })),
          }),
        ),
    }),
    ...over,
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
  await el.updateComplete;
  return el;
}

async function comp(el: TillTableOrderScreen, lineNo: number) {
  if (el.shadowRoot!.querySelector("[data-drawer]") !== null) {
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await el.updateComplete;
  }
  const line = el.lines.find((line) => line.lineNo === lineNo)!;
  await openSentDish(el, line.id, line.servedAt === null ? "fired" : "served");
  await openSentMore(el);
  const action = el.shadowRoot!.querySelector<HTMLElement>("[data-sent-line-comp]")!;
  expect(action.textContent!.trim()).toBe(t("comp.title"));
  await userEvent.click(action);
  await el.updateComplete;
}

function capture(el: TillTableOrderScreen): AdjustDetail[] {
  const seen: AdjustDetail[] = [];
  el.addEventListener("adjust", (event) => {
    expect(event.bubbles && event.composed).toBe(true);
    seen.push((event as CustomEvent<AdjustDetail>).detail);
  });
  return seen;
}

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

describe("till-table-order-screen: giving away and discounting a dish", () => {
  it("offers one Comp on each sent dish and names its priced extras inside the combined target", async () => {
    const el = await mountScreen();
    const asked = capture(el);
    expect(el.shadowRoot!.querySelector("[data-comp-line], [data-discount-line]")).toBeNull();
    for (const lineNo of [1, 2, 4, 5]) await comp(el, lineNo);
    expect(
      asked.map(({ kind, combined, target }) => [kind, combined, target.lineId, target.name]),
    ).toEqual([
      ["comp", true, "line-1", "Steak"],
      ["comp", true, "line-2", "Pizza"],
      ["comp", true, "line-4", "Ham"],
      ["comp", true, "line-5", "Bread"],
    ]);
    expect(asked[1]!.target.extras!.map((extra) => [extra.lineId, extra.name])).toEqual([
      ["line-3", olivesWithPizza()],
    ]);
  });

  it("offers an extra on its own and whole inside Comp, even when it is several", async () => {
    const el = await mountScreen({
      lines: [
        { ...pizza, quantity: "2.000" },
        { ...olives, quantity: "2.000", unitPrecision: 0 },
      ],
    });
    const asked = capture(el);
    await comp(el, 2);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.target.extras).toEqual([
      {
        lineId: "line-3",
        name: olivesWithPizza(),
        quantity: "2",
        total: "3.00",
        unitTotal: null,
        started: false,
        extra: true,
        kitchenTold: true,
      },
    ]);
  });

  it("names an extra in Spanish with its dish inside Comp", async () => {
    setLocale("es-ES");
    const el = await mountScreen();
    const asked = capture(el);
    await comp(el, 2);
    expect(asked[0]!.target.extras![0]!.name).toBe("Olives (con Pizza)");
  });

  it("asks the app to adjust a dish of several whole units, which may be done one at a time", async () => {
    const el = await mountScreen();
    const asked = capture(el);
    await comp(el, 1);
    expect(asked).toEqual([
      {
        kind: "comp",
        combined: true,
        target: {
          lineId: "line-1",
          name: "Steak",
          quantity: "2",
          total: "50.00",
          unitTotal: "25.00",
          started: false,
          extras: [],
        },
      },
    ]);
  });

  it("covers a dish with its extras, and one of several with its share of them", async () => {
    const el = await mountScreen({ lines: [{ ...pizza, quantity: "2.000" }, olives] });
    const asked = capture(el);
    await comp(el, 2);
    for (const { target } of asked)
      expect(target).toMatchObject({
        lineId: "line-2",
        name: "Pizza",
        quantity: "2",
        total: "19.50",
        unitTotal: "9.75",
      });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.target.extras).toEqual([
      {
        lineId: "line-3",
        name: olivesWithPizza(),
        quantity: "1",
        total: "1.50",
        unitTotal: null,
        started: false,
        extra: true,
        kitchenTold: true,
      },
    ]);
  });

  it("does a weighed dish whole, and says it is weighed", async () => {
    const el = await mountScreen();
    const asked = capture(el);
    await comp(el, 4);
    for (const { target } of asked)
      expect(target).toMatchObject({
        quantity: "0.333",
        total: "7.99",
        unitTotal: null,
        weighed: true,
      });
    expect(asked).toHaveLength(1);
  });

  it("offers Comp on a dish already served", async () => {
    const el = await mountScreen();
    const asked = capture(el);
    await comp(el, 5);
    expect(asked[0]!.target).toMatchObject({ lineId: "line-5", name: "Bread", total: "2.50" });
  });

  it("offers no Comp on a bill with no party, nor on a paid one", async () => {
    const noParty = await mountScreen({ party: null, bills: [] });
    expect(noParty.shadowRoot!.querySelector("[data-sent-line-comp], [data-comp-line]")).toBeNull();
    expect(noParty.shadowRoot!.querySelector("[data-discount-bill]")).toBeNull();
    cleanupWidgets();
    const paid = await mountScreen({ bills: [{ ...openBill, status: "settled" }] });
    await userEvent.click(paid.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await paid.updateComplete;
    await openSentDish(paid, "line-1");
    await openSentMore(paid);
    expect(paid.shadowRoot!.querySelector("[data-sent-line-comp]")).toBeNull();
    expect(paid.shadowRoot!.querySelector("[data-discount-line]")).toBeNull();
    expect(paid.shadowRoot!.querySelector("[data-discount-bill]")).toBeNull();
  });
});

describe("till-table-order-screen: cancelling a dish", () => {
  it("keeps the app cancellation offer target and native Sent Void on the whole dish with its extras", async () => {
    const el = await mountScreen({ lines: [{ ...pizza, quantity: "2.000" }, olives] });
    const asked = capture(el);
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await el.updateComplete;
    await openSentDish(el, "line-2");
    await openSentMore(el);
    const cancelled: CustomEvent[] = [];
    el.addEventListener("cancel-item", (event) => cancelled.push(event as CustomEvent));
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-sent-line-void]")!);
    expect(cancelled.map((event) => [event.detail, event.bubbles, event.composed])).toEqual([
      [{ lineId: "line-2" }, true, true],
    ]);
    el.cancelOffer = 2;
    await el.updateComplete;
    await comp(el, 2);
    expect(asked).toEqual([
      {
        kind: "cancel",
        offered: true,
        target: {
          lineId: "line-2",
          name: "Pizza",
          quantity: "2",
          total: "19.50",
          unitTotal: "9.75",
          started: false,
        },
      },
      { kind: "comp", combined: true, target: expect.objectContaining({ unitTotal: "9.75" }) },
    ]);
  });

  const cancelOf = (el: TillTableOrderScreen, lineNo: number) =>
    el.shadowRoot!.querySelector<HTMLElement>(`[data-cancel-line="${lineNo}"]`);

  it("keeps a whole extra as a Comp target without a separate Cancel action", async () => {
    const el = await mountScreen({
      lines: [
        { ...pizza, quantity: "2.000", state: "preparing" },
        { ...olives, quantity: "2.000" },
      ],
    });
    const asked = capture(el);
    expect(cancelOf(el, 3)).toBeNull();
    await comp(el, 2);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.kind).toBe("comp");
    expect(asked[0]!.combined).toBe(true);
    expect(asked[0]!.target.extras).toEqual([
      {
        lineId: "line-3",
        name: olivesWithPizza(),
        quantity: "2",
        total: "3.00",
        unitTotal: null,
        started: false,
        extra: true,
        kitchenTold: true,
      },
    ]);
  });

  it("offers no Cancel on an extra whose dish offers none", async () => {
    const held = { ...pizza, sentAt: null, firedAt: null };
    const el = await mountScreen({ lines: [held, olives] });
    expect(el.shadowRoot!.querySelector('[data-send-line="2"]')).toBeNull();
    expect(cancelOf(el, 2)).toBeNull();
    expect(cancelOf(el, 3)).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-comp-line="3"]')).toBeNull();
    const asked = capture(el);
    await comp(el, 2);
    expect(asked[0]!.target.extras).toEqual([
      {
        lineId: "line-3",
        name: olivesWithPizza(),
        quantity: "1",
        total: "1.50",
        unitTotal: null,
        started: false,
        extra: true,
        kitchenTold: true,
      },
    ]);
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
      draftStore: null,
      currentOrders: null,
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
    const fallback = el.shadowRoot!.querySelector<HTMLElement>("[data-sent-fallback]")!;
    expect(fallback.checkVisibility()).toBe(true);
    const rows = [...fallback.querySelectorAll(".sent-fallback-row")];
    expect(
      rows.map((row) =>
        row
          .querySelector(".sent-fallback-name")!
          .textContent!.trim()
          .replace(/ ×[\d.]+[\s\S]*$/, ""),
      ),
    ).toEqual(["Pizza", "Olives", "Steak", "Pizza", "Olives"]);
    expect(rows.map((row) => row.parentElement!.hasAttribute("data-sent-fallback-extra"))).toEqual([
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
  async function inspect(el: TillTableOrderScreen, line: TabLine) {
    const previous =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>("[data-sent-line-dialog]")!;
    if (previous.open) {
      const closed = new Promise<void>((resolve) =>
        previous.addEventListener("wt-close", () => resolve(), { once: true }),
      );
      await userEvent.click(previous.querySelector<HTMLElement>("[data-sent-line-close]")!);
      await closed;
    }
    if (el.shadowRoot!.querySelector("[data-drawer]") !== null) {
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
      await el.updateComplete;
    }
    return openSentDish(el, line.id, line.servedAt === null ? "fired" : "served");
  }
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
    const dialog = await inspect(el, pizza);
    const rows = [
      dialog.querySelector("[data-sent-line-amount]")!,
      dialog.querySelector('[data-sent-extra="line-3"]')!,
    ];

    expect(rows[0]!.querySelector("s")!.textContent).toBe(money("9.00"));
    expect(total(rows[0]!)).toBe(`${t("table.price_was")} ${money("9.00")} ${money("0.00")}`);
    expect(total(rows[1]!)).toBe(`${t("table.price_was")} ${money("1.50")} ${money("0.00")}`);
    const was = rows[0]!.querySelector<HTMLElement>("[data-price-was]")!;
    expect(was.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    const unadjusted = await inspect(el, steaks);
    rows.push(unadjusted.querySelector("[data-sent-line-amount]")!);
    expect(rows[2]!.querySelector("s")).toBeNull();
    expect(total(rows[2]!)).toBe(money("50.00"));
  });

  it("shows a discounted served line's original total, and a split-off part at its own price plainly", async () => {
    const el = await mountScreen({
      lines: [
        { ...servedBread, quantity: "2.000", unitPriceGross: "2.25", listUnitPriceGross: "2.50" },
        { ...steaks, quantity: "1.000", listUnitPriceGross: "25.00" },
      ],
    });
    const served = await inspect(el, servedBread);
    expect(total(served)).toBe(`${t("table.price_was")} ${money("5.00")} ${money("4.50")}`);
    const pending = await inspect(el, steaks);
    expect(total(pending)).toBe(money("25.00"));
  });
});
