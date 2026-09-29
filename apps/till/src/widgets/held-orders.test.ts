import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMoney } from "@waitron/shared";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillHeldOrders } from "./held-orders.js";
import type { HeldOrderSummary, TableParty, TableState } from "../api/client.js";

const mesa: HeldOrderSummary = {
  id: "wo-1",
  orderNumber: 5,
  label: "Mesa 4",
  itemCount: 2,
  total: "3.00",
  outstanding: "3.00",
  hasPayments: false,
  partyId: null,
  openedAt: "2026-08-05T10:00:00.000Z",
};

const barra: HeldOrderSummary = {
  id: "wo-2",
  orderNumber: 6,
  label: null,
  itemCount: 1,
  total: "1.50",
  outstanding: "1.50",
  hasPayments: false,
  partyId: null,
  openedAt: "2026-08-05T10:05:00.000Z",
};

afterEach(cleanupWidgets);

describe("till-held-orders", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-held-orders")).toBe(TillHeldOrders);
  });

  it("shows the empty placeholder when there are no parked orders", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [] });
    expect(el.shadowRoot!.querySelectorAll(".order")).toHaveLength(0);
    expect(el.shadowRoot!.textContent).toContain(t("held.empty"));
  });

  it("shows the section title", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [] });
    expect(el.shadowRoot!.textContent).toContain(t("held.title"));
  });

  it("renders one row per parked order with its number, label, item count and total", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [mesa, barra] });
    const rows = el.shadowRoot!.querySelectorAll(".order");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("5");
    expect(rows[0]!.textContent).toContain("Mesa 4");
    expect(rows[0]!.textContent).toContain("2");
    expect(rows[0]!.textContent).toContain(formatMoney("3.00", currentLocale()));
  });

  it("renders an unlabelled order (label null) without crashing", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [barra] });
    const rows = el.shadowRoot!.querySelectorAll(".order");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("6");
    expect(rows[0]!.textContent).toContain(formatMoney("1.50", currentLocale()));
  });

  it("a Retrieve control emits a composed retrieve-order carrying its own id", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [mesa, barra] });
    let captured: CustomEvent<{ id: string }> | undefined;
    el.addEventListener("retrieve-order", (event) => {
      captured = event as CustomEvent<{ id: string }>;
    });
    el.shadowRoot!.querySelectorAll<HTMLElement>("wt-button.retrieve")[1]!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.detail).toEqual({ id: "wo-2" });
  });

  it("a Discard control emits a composed discard-order carrying its own id", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [mesa, barra] });
    let captured: CustomEvent<{ id: string }> | undefined;
    el.addEventListener("discard-order", (event) => {
      captured = event as CustomEvent<{ id: string }>;
    });
    el.shadowRoot!.querySelectorAll<HTMLElement>("wt-button.discard")[0]!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.detail).toEqual({ id: "wo-1" });
  });

  it("labels its Retrieve/Discard controls with the localised actions", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [mesa] });
    expect(el.shadowRoot!.querySelector("wt-button.retrieve")!.textContent).toContain(
      t("held.retrieve"),
    );
    expect(el.shadowRoot!.querySelector("wt-button.discard")!.textContent).toContain(
      t("held.discard"),
    );
  });

  it("gives each Retrieve/Discard control an order-specific accessible name", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [mesa, barra] });
    const retrieves = el.shadowRoot!.querySelectorAll("wt-button.retrieve");
    const discards = el.shadowRoot!.querySelectorAll("wt-button.discard");
    expect(retrieves[0]!.getAttribute("aria-label")).toBe(`${t("held.retrieve")} #5 Mesa 4`);
    expect(discards[0]!.getAttribute("aria-label")).toBe(`${t("held.discard")} #5 Mesa 4`);
    expect(retrieves[1]!.getAttribute("aria-label")).toBe(`${t("held.retrieve")} #6`);
    expect(discards[1]!.getAttribute("aria-label")).toBe(`${t("held.discard")} #6`);
  });
});

describe("till-held-orders: a narrow card", () => {
  it("keeps each order's count, total and what it still owes on one line at a phone's width, with the controls below", async () => {
    const partlyPaid = { ...mesa, outstanding: "1.00", hasPayments: true };
    const { el, host } = await mountWidget<TillHeldOrders>("till-held-orders", {
      orders: [partlyPaid, barra],
    });
    host.style.width = "333px";
    await el.updateComplete;

    for (const meta of el.shadowRoot!.querySelectorAll<HTMLElement>(".meta")) {
      const range = document.createRange();
      range.selectNodeContents(meta);
      const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
      expect(lines.size, meta.textContent!).toBe(1);
    }
  });

  it.each([320, 110])(
    "keeps each order's controls clear of its summary at %ipx wide",
    async (width) => {
      const partlyPaid = { ...mesa, outstanding: "1.00", hasPayments: true };
      const { el, host } = await mountWidget<TillHeldOrders>("till-held-orders", {
        orders: [partlyPaid, barra],
      });
      host.style.width = `${width}px`;
      await el.updateComplete;

      for (const order of el.shadowRoot!.querySelectorAll<HTMLElement>(".order")) {
        const summary = order.querySelector(".summary")!.getBoundingClientRect();
        for (const control of order.querySelectorAll("wt-button")) {
          const box = control.getBoundingClientRect();
          const apart =
            box.left >= summary.right ||
            box.right <= summary.left ||
            box.top >= summary.bottom ||
            box.bottom <= summary.top;
          expect(apart, `${control.className} overlaps the summary`).toBe(true);
        }
      }
    },
  );
});

describe("till-held-orders: moving a counter order to a table", () => {
  beforeEach(() => setLocale("en"));

  const tableRow = (id: string, label: string, over: Partial<TableState> = {}): TableState => ({
    id,
    label,
    zoneId: "z1",
    capacity: 4,
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    status: null,
    nextReservation: null,
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
    party: null,
    ...over,
  });
  const luis: TableParty = {
    id: "v7",
    revision: 9,
    guestCount: 2,
    state: "open",
    name: "Luis",
    displayName: "Luis",
    mainBillId: "wo-7",
    outstanding: "12.00",
    billCount: 1,
    tableIds: ["t7"],
    unsentDrafts: [],
    reminder: null,
  };
  const tables = [
    tableRow("t7", "Mesa 7", { state: "open-tab", condition: "held", party: luis }),
    tableRow("t6", "Mesa 6", { condition: "needs_clearing" }),
    tableRow("t9", "Mesa 9"),
  ];
  const partyBill: HeldOrderSummary = { ...mesa, id: "wo-7", orderNumber: 7, partyId: "v7" };

  const moveButtons = (el: TillHeldOrders) => [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>("wt-button.move"),
  ];
  const picker = (el: TillHeldOrders) =>
    el.shadowRoot!.querySelector<HTMLElement & { heading: string; open: boolean }>(
      "[data-table-picker]",
    );
  const target = (el: TillHeldOrders, id: string) =>
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(`[data-target="${id}"]`);
  const billChoice = (el: TillHeldOrders) =>
    el.shadowRoot!.querySelector<
      HTMLElement & { scope: string; question: string; updateComplete: Promise<unknown> }
    >("till-bill-choice-dialog");
  function heard(el: TillHeldOrders, type: string): unknown[] {
    const details: unknown[] = [];
    el.addEventListener(type, (event) => {
      expect((event as CustomEvent).bubbles && (event as CustomEvent).composed).toBe(true);
      details.push((event as CustomEvent).detail);
    });
    return details;
  }
  async function openPicker(el: TillHeldOrders, index = 0): Promise<void> {
    moveButtons(el)[index]!.click();
    await el.updateComplete;
  }

  it("offers Move to table on a counter order, and not on a party's bill listed beside it", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", {
      orders: [mesa, partyBill],
      tables,
    });

    const moves = moveButtons(el);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.textContent!.trim()).toBe(t("held.move_to_table"));
    expect(moves[0]!.getAttribute("aria-label")).toBe(`${t("held.move_to_table")} #5 Mesa 4`);
  });

  it("says what a partly paid order still owes", async () => {
    const partlyPaid = { ...mesa, outstanding: "1.00", hasPayments: true };
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [partlyPaid] });

    expect(el.shadowRoot!.querySelector(".order")!.textContent).toContain(
      t("table.bill_to_pay").replace("{amount}", formatMoney("1.00", currentLocale())),
    );
  });

  it("asks the app for the floor, and lists every table with its condition under the order it moves", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", {
      orders: [mesa],
      tables,
    });
    const opened = heard(el, "move-held-order-open");

    await openPicker(el);

    expect(opened).toEqual([{ orderId: "wo-1" }]);
    expect(picker(el)!.heading).toBe(t("table.move_bill_heading").replace("{bill}", "#5 Mesa 4"));
    expect(
      [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-target]")].map(
        (row) => row.dataset.target,
      ),
    ).toEqual(["t7", "t6", "t9"]);
    expect(target(el, "t9")!.textContent).toContain(t("floor.free"));
    expect(target(el, "t7")!.textContent).toContain(t("table.held_by").replace("{party}", "Luis"));
    expect(target(el, "t6")!.disabled).toBe(true);
    expect(el.shadowRoot!.querySelector('[data-target-reason="t6"]')!.textContent!.trim()).toBe(
      codeMessage("table.needs_clearing"),
    );
  });

  it("says so when the floor lists no table", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", {
      orders: [mesa],
      tables: [],
    });

    await openPicker(el);

    expect(picker(el)!.textContent).toContain(t("held.no_tables"));
  });

  it("moves the order to a free table at once, and a table needing clearing sends nothing", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", {
      orders: [mesa],
      tables,
    });
    const moved = heard(el, "move-held-order");
    await openPicker(el);

    target(el, "t6")!.click();
    await el.updateComplete;
    target(el, "t9")!.click();
    await el.updateComplete;

    expect(moved).toEqual([{ orderId: "wo-1", tableId: "t9", bills: "merge" }]);
    expect(picker(el)).toBeNull();
  });

  it("asks about the bills first at a seated table, naming the order and where it goes", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", {
      orders: [mesa],
      tables,
    });
    const moved = heard(el, "move-held-order");
    await openPicker(el);

    target(el, "t7")!.click();
    await el.updateComplete;
    const dialog = billChoice(el)!;
    await dialog.updateComplete;

    expect(moved).toEqual([]);
    expect(picker(el)).toBeNull();
    expect(dialog.scope).toBe(
      t("table.move_bill_scope").replace("{bill}", "#5 Mesa 4").replace("{into}", "Luis (Mesa 7)"),
    );
    expect(dialog.question).toBe(t("table.bill_move_question"));
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-bills-separate]")!.click();
    await el.updateComplete;

    expect(moved).toEqual([{ orderId: "wo-1", tableId: "t7", bills: "separate" }]);
    expect(billChoice(el)).toBeNull();
    expect(picker(el)).toBeNull();
  });

  it("closes the picker, sending nothing, when its dialog is dismissed", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", {
      orders: [mesa],
      tables,
    });
    const moved = heard(el, "move-held-order");
    await openPicker(el);

    picker(el)!.dispatchEvent(new CustomEvent("wt-close"));
    await el.updateComplete;

    expect(picker(el)).toBeNull();
    expect(moved).toEqual([]);
  });

  it("names a seated party with no name by the tables the floor lists for it", async () => {
    const unnamed = { ...luis, name: null, displayName: "Mesa 7", tableIds: ["t7", "t-gone"] };
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", {
      orders: [mesa],
      tables: [{ ...tables[0]!, party: unnamed }, tables[2]!],
    });
    await openPicker(el);
    target(el, "t7")!.click();
    await el.updateComplete;

    expect(billChoice(el)!.scope).toBe(
      t("table.move_bill_scope").replace("{bill}", "#5 Mesa 4").replace("{into}", "Mesa 7"),
    );
  });

  it("goes back to the tables when the bill choice is cancelled, and Cancel there sends nothing", async () => {
    const { el } = await mountWidget<TillHeldOrders>("till-held-orders", {
      orders: [mesa],
      tables,
    });
    const moved = heard(el, "move-held-order");
    await openPicker(el);
    target(el, "t7")!.click();
    await el.updateComplete;
    await billChoice(el)!.updateComplete;

    billChoice(el)!.shadowRoot!.querySelector<HTMLElement>("[data-bills-cancel]")!.click();
    await el.updateComplete;
    expect(billChoice(el)).toBeNull();
    expect(picker(el)).not.toBeNull();

    el.shadowRoot!.querySelector<HTMLElement>("[data-picker-cancel]")!.click();
    await el.updateComplete;

    expect(picker(el)).toBeNull();
    expect(moved).toEqual([]);
  });
});
