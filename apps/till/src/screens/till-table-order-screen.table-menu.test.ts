import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { PartyBill, TableParty, TableState, TabLine } from "../api/client.js";
import { partyBill, switcherParty } from "./till-table-order-screen.bill-switcher.test-helpers.js";

const line: TabLine = {
  changesAfterSending: null,
  id: "line-1",
  name: "Beer",
  lineNo: 1,
  productId: "beer",
  quantity: "1.000",
  unitPrecision: 0,
  unitPriceGross: "3.00",
  stationId: null,
  movable: false,
  groupId: null,
  servedAt: null,
  courseId: null,
  sentAt: null,
  firedAt: null,
  state: null,
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
};

const twoTables: TableParty = { ...switcherParty, tableIds: ["t4", "t5"] };

function table(id: string, party: TableParty | null, requested = false): TableState {
  return {
    id,
    label: id,
    shortName: id,
    party,
    signals: requested ? [{ kind: "bill_requested", requestedAt: "2026-10-31T20:00:00.000Z" }] : [],
    zoneId: null,
    state: party === null ? "free" : "open-tab",
    hasOpenTab: party !== null,
    condition: party === null ? "free" : "held",
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
  } as TableState;
}

const bills = [
  partyBill("wo-1", 1, "10.00"),
  partyBill("wo-2", 2, "54.00", { billName: "Clint", revision: 6 }),
];

async function mountScreen(
  over: {
    bills?: PartyBill[];
    orderId?: string | undefined;
    party?: TableParty | null;
    fullInvoices?: boolean;
    requested?: boolean;
    busy?: boolean;
    groupCommandBusy?: boolean;
  } = {},
) {
  const party = over.party === undefined ? twoTables : over.party;
  const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products: [],
    lines: [line],
    orderId: "orderId" in over ? over.orderId : "wo-2",
    party,
    bills: over.bills ?? bills,
    fullInvoices: over.fullInvoices ?? true,
    tables:
      party === null ? [] : party.tableIds.map((id) => table(id, party, over.requested ?? false)),
    busy: over.busy ?? false,
    groupCommandBusy: over.groupCommandBusy ?? false,
  });
  return el;
}

const menu = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-table-menu]")!;
const textOf = (node: Element) => node.textContent!.replace(/\s+/g, " ").trim();
/** Each group of the ⋮: its accessible name, then the labels of its items in order. */
function groups(el: TillTableOrderScreen): { name: string; items: string[] }[] {
  return [...menu(el).querySelectorAll<HTMLElement>('[role="group"]')].map((group) => ({
    name: textOf(el.shadowRoot!.getElementById(group.getAttribute("aria-labelledby")!)!),
    items: [...group.querySelectorAll<HTMLElement>("wt-button")].map(textOf),
  }));
}
const item = (el: TillTableOrderScreen, selector: string) =>
  menu(el).querySelector<HTMLElement>(selector);

function capture(el: TillTableOrderScreen, type: string): unknown[] {
  const seen: unknown[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent).detail));
  return seen;
}

/** Focus is on the ⋮'s own trigger button. */
function focusOnMenu(el: TillTableOrderScreen): boolean {
  const host = menu(el);
  return (
    el.shadowRoot!.activeElement === host &&
    host.shadowRoot!.activeElement === host.shadowRoot!.querySelector("button")
  );
}

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

describe("A803 single menu: one ⋮ for the bill on screen, then the whole table", () => {
  it("draws exactly one ⋮, named Table actions, and no Table actions button", async () => {
    const el = await mountScreen();

    expect(el.shadowRoot!.querySelectorAll("[data-table-menu]")).toHaveLength(1);
    expect(menu(el).tagName).toBe("WT-ROW-ACTIONS");
    expect(menu(el).getAttribute("label")).toBe("Table actions");
    expect(menu(el).hasAttribute("data-move-split")).toBe(true);
    const buttons = [...el.shadowRoot!.querySelectorAll<HTMLElement>("wt-button")];
    expect(buttons.filter((button) => textOf(button) === "Table actions")).toEqual([]);
  });

  it("an open owing bill: the bill's items under its label, then the whole table's", async () => {
    const el = await mountScreen();

    expect(groups(el)).toEqual([
      {
        name: "Bill 2 · Clint",
        items: [
          "Name this bill",
          "Move dishes…",
          "Split by item",
          "Transfer items",
          "Merge bills",
          "Move this bill",
          "Comp the bill",
          "Full invoice",
        ],
      },
      {
        name: "Whole table",
        items: [
          "Allergies",
          "Name the party",
          "Guests",
          "Mark bill requested for 4",
          "Split a table",
          "Join a table",
          "Move guests",
          "Finish table",
        ],
      },
    ]);
  });

  it("offers Split a table only at two or more tables", async () => {
    const el = await mountScreen({ party: switcherParty });

    expect(groups(el)[1]!.items).not.toContain("Split a table");
    expect(groups(el)[1]!.items).toContain("Join a table");
  });

  it("a paid bill with a receipt offers Name this bill and Receipt copy, and no Full invoice", async () => {
    const paid = partyBill("wo-2", 2, "0.00", {
      status: "settled",
      total: "54.00",
      receiptAvailable: true,
      hasPayments: true,
    });
    const el = await mountScreen({ bills: [paid] });

    const [bill] = groups(el);
    expect(bill!.name).toBe("Bill 2");
    expect(bill!.items).toContain("Name this bill");
    expect(bill!.items).toContain("Receipt copy");
    expect(bill!.items).not.toContain("Full invoice");
    expect(item(el, "[data-choose-bill-invoice]")).toBeNull();
    expect(item(el, "[data-bill-receipt]")).not.toBeNull();
  });

  it("a presented bill with a receipt and no payments offers Cancel and credit", async () => {
    const presented = partyBill("wo-2", 2, "54.00", { status: "placed", receiptAvailable: true });
    const el = await mountScreen({ bills: [presented] });

    expect(groups(el)[0]!.items).toContain("Cancel and credit");
    expect(item(el, "[data-cancel-credit]")).not.toBeNull();
    expect(groups(el)[0]!.items).toContain("Full invoice");
  });

  it("a presented bill with an invoice number offers no Full invoice", async () => {
    const issued = partyBill("wo-2", 2, "54.00", {
      status: "placed",
      receiptAvailable: true,
      invoiceNumber: "F-0007",
    });
    const el = await mountScreen({ bills: [issued] });

    expect(groups(el)[0]!.items).not.toContain("Full invoice");
    expect(item(el, "[data-choose-bill-invoice]")).toBeNull();
  });

  it("offers no Full invoice while full invoices are off", async () => {
    const el = await mountScreen({ fullInvoices: false });

    expect(groups(el)[0]!.items).not.toContain("Full invoice");
    expect(item(el, "[data-choose-bill-invoice]")).toBeNull();
  });

  it("with no bill on screen there is no bill group", async () => {
    const el = await mountScreen({ orderId: undefined });

    expect(groups(el).map((group) => group.name)).toEqual(["Whole table"]);
  });

  it("with no party: Split by item, Transfer items and Merge bills under Bill; Join a table and Move guests under Whole table", async () => {
    const el = await mountScreen({ party: null, bills: [], orderId: "wo-9" });

    expect(groups(el)).toEqual([
      { name: "Bill", items: ["Split by item", "Transfer items", "Merge bills"] },
      { name: "Whole table", items: ["Join a table", "Move guests"] },
    ]);
  });

  it("names the groups in Spanish", async () => {
    setLocale("es");
    const el = await mountScreen();

    expect(groups(el).map((group) => group.name)).toEqual(["Cuenta 2 · Clint", "Toda la mesa"]);
    expect(menu(el).getAttribute("label")).toBe("Acciones de mesa");
  });

  it("each copy sends its own event", async () => {
    const el = await mountScreen();
    const adjust = capture(el, "adjust");
    const invoice = capture(el, "choose-bill-invoice");
    const request = capture(el, "request-bill");
    const finish = capture(el, "finish-table");

    item(el, "[data-discount-bill]")!.click();
    item(el, "[data-choose-bill-invoice]")!.click();
    item(el, "[data-request-bill]")!.click();
    item(el, "[data-finish-table]")!.click();

    expect(adjust).toEqual([
      {
        kind: "discount",
        target: {
          lineId: null,
          name: t("table.bill_of_named")
            .replace("{party}", "4")
            .replace("{n}", "2")
            .replace("{name}", "Clint"),
          quantity: null,
          total: expect.anything(),
          unitTotal: null,
        },
      },
    ]);
    expect(invoice).toEqual([{ workingOrderId: "wo-2", revision: 6 }]);
    expect(request).toEqual([{ requested: true }]);
    expect(finish).toEqual([{}]);
  });

  it("Receipt copy and Cancel and credit send their events for the bill on screen", async () => {
    const paid = partyBill("wo-1", 1, "0.00", { status: "settled", receiptAvailable: true });
    const presented = partyBill("wo-2", 2, "54.00", { status: "placed", receiptAvailable: true });
    const el = await mountScreen({ bills: [paid, presented], orderId: "wo-1" });
    const reprint = capture(el, "reprint-bill");
    item(el, "[data-bill-receipt]")!.click();
    expect(reprint).toEqual([{ workingOrderId: "wo-1" }]);

    el.orderId = "wo-2";
    await el.updateComplete;
    const credit = capture(el, "cancel-credit-bill");
    item(el, "[data-cancel-credit]")!.click();
    expect(credit).toEqual([{ workingOrderId: "wo-2" }]);
  });

  it("choosing Merge bills shows its picker beside the order, and Back closes it", async () => {
    const el = await mountScreen();
    await userEvent.click(menu(el));
    await userEvent.click(item(el, '[data-action="merge"]')!);
    await el.updateComplete;

    const panel = el.shadowRoot!.querySelector<HTMLElement>("[data-action-panel]")!;
    expect(panel.querySelector("[data-target-picker]")!.checkVisibility()).toBe(true);
    expect(panel.querySelector('[data-target="wo-1"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-drawer]")).toBeNull();

    panel.querySelector<HTMLElement>("[data-action-back]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-action-panel]")).toBeNull();
  });

  it.each([
    [1024, 768],
    [375, 667],
  ])(
    "at %ix%i the list opens under its trigger, fits the window and scrolls Finish table into reach",
    async (width, height) => {
      await page.viewport(width, height);
      try {
        const el = await mountScreen();
        const finish = capture(el, "finish-table");
        const trigger = menu(el).shadowRoot!.querySelector("button")!;
        const popup = menu(el).shadowRoot!.querySelector<HTMLElement>("[popover]")!;
        await userEvent.click(trigger);

        expect(groups(el).flatMap((group) => group.items)).toHaveLength(16);
        const box = popup.getBoundingClientRect();
        const anchor = trigger.getBoundingClientRect();
        expect(box.top).toBeGreaterThanOrEqual(anchor.bottom - 0.5);
        expect(box.bottom).toBeLessThanOrEqual(innerHeight);
        expect(popup.scrollHeight).toBeGreaterThan(popup.clientHeight);
        const centre = el.shadowRoot!.elementFromPoint(
          anchor.left + anchor.width / 2,
          anchor.top + anchor.height / 2,
        );
        expect(centre).toBe(menu(el));
        await userEvent.click(item(el, "[data-finish-table]")!);
        expect(finish).toEqual([{}]);
      } finally {
        await page.viewport(1280, 900);
      }
    },
  );

  it.each([
    [1024, 768],
    [375, 667],
  ])(
    "at %ix%i the list's bottom edge cuts through the middle of an item, so half its label shows",
    async (width, height) => {
      await page.viewport(width, height);
      try {
        const el = await mountScreen();
        const popup = menu(el).shadowRoot!.querySelector<HTMLElement>("[popover]")!;
        await userEvent.click(menu(el).shadowRoot!.querySelector("button")!);

        const cut = popup.getBoundingClientRect().top + popup.clientTop + popup.clientHeight;
        const across = [...menu(el).querySelectorAll<HTMLElement>("wt-button")]
          .map((action) => action.getBoundingClientRect())
          .filter((box) => box.top < cut && box.bottom > cut);
        expect(across).toHaveLength(1);
        const { top, height } = across[0]!;
        expect(Math.abs(cut - (top + height / 2))).toBeLessThanOrEqual(height / 10);
      } finally {
        await page.viewport(1280, 900);
      }
    },
  );

  describe("A803 LOOK F5: the bill's items are those the server takes in the bill's state", () => {
    const paid = partyBill("wo-2", 2, "0.00", {
      status: "settled",
      total: "54.00",
      receiptAvailable: true,
      hasPayments: true,
    });
    const presented = partyBill("wo-2", 2, "54.00", { status: "placed", receiptAvailable: true });
    const billItem = (el: TillTableOrderScreen, selector: string) =>
      menu(el).querySelector<HTMLElement>(`[data-table-menu-bill] ${selector}`);

    // splitBill refuses `bill.paid` and `bill.presented`; mergeBills and transferItems refuse the
    // bill on screen the same way (apps/server/src/bill-actions.ts, refuseClosedBill).
    it.each([
      ["a paid bill", paid],
      ["a presented bill", presented],
    ])("%s offers no Split by item, Transfer items or Merge bills", async (_, bill) => {
      const el = await mountScreen({ bills: [bill] });

      expect(billItem(el, '[data-action="split"]')).toBeNull();
      expect(billItem(el, '[data-action="transfer"]')).toBeNull();
      expect(billItem(el, '[data-action="merge"]')).toBeNull();
      expect(groups(el)[0]!.items).not.toContain("Split by item");
      expect(groups(el)[0]!.items).not.toContain("Transfer items");
      expect(groups(el)[0]!.items).not.toContain("Merge bills");
    });

    it("a paid bill keeps Name this bill and Receipt copy", async () => {
      const el = await mountScreen({ bills: [paid] });

      expect(groups(el)[0]!.items).toEqual(["Name this bill", "Receipt copy"]);
    });

    it("a presented bill keeps Name this bill, Move this bill, Full invoice and Cancel and credit", async () => {
      const el = await mountScreen({ bills: [presented] });

      expect(groups(el)[0]!.items).toEqual([
        "Name this bill",
        "Move this bill",
        "Full invoice",
        "Cancel and credit",
      ]);
    });

    it("an open bill holding a payment keeps Split by item", async () => {
      const el = await mountScreen({
        bills: [partyBill("wo-2", 2, "40.00", { total: "54.00", hasPayments: true })],
      });

      expect(billItem(el, '[data-action="split"]')).not.toBeNull();
    });

    // mergeBills and transferItems refuse `bill.payments_received` when either bill holds a
    // payment (requireUntouchedPair); splitBill takes a partly paid bill.
    it("an open bill holding a payment offers no Transfer items or Merge bills", async () => {
      const el = await mountScreen({
        bills: [
          partyBill("wo-2", 2, "40.00", { total: "54.00", hasPayments: true }),
          partyBill("wo-3", 3, "20.00", { total: "20.00" }),
        ],
      });

      expect(billItem(el, '[data-action="transfer"]')).toBeNull();
      expect(billItem(el, '[data-action="merge"]')).toBeNull();
      expect(billItem(el, '[data-action="split"]')).not.toBeNull();
    });

    it("an open bill holding no payment, beside one that does, still offers Transfer items and Merge bills", async () => {
      const el = await mountScreen({
        bills: [
          partyBill("wo-2", 2, "54.00", { total: "54.00" }),
          partyBill("wo-3", 3, "10.00", { total: "20.00", hasPayments: true }),
        ],
      });

      expect(billItem(el, '[data-action="transfer"]')).not.toBeNull();
      expect(billItem(el, '[data-action="merge"]')).not.toBeNull();
    });
  });

  describe("the ⋮'s copies keep the guards of the controls they copy", () => {
    it("a paid bill without a receipt offers no Receipt copy", async () => {
      const paid = partyBill("wo-2", 2, "0.00", {
        status: "settled",
        total: "54.00",
        receiptAvailable: false,
        hasPayments: true,
      });
      const el = await mountScreen({ bills: [paid] });

      expect(groups(el)[0]!.items).toContain("Name this bill");
      expect(item(el, "[data-bill-receipt]")).toBeNull();
    });

    it("a presented bill with a receipt and payments offers no Cancel and credit", async () => {
      const presented = partyBill("wo-2", 2, "20.00", {
        status: "placed",
        total: "54.00",
        receiptAvailable: true,
        hasPayments: true,
      });
      const el = await mountScreen({ bills: [presented] });

      expect(groups(el)[0]!.items).toContain("Name this bill");
      expect(item(el, "[data-cancel-credit]")).toBeNull();
    });

    it("a requested bill offers to cancel the request, which sends requested false", async () => {
      const el = await mountScreen({ requested: true });
      const request = capture(el, "request-bill");

      expect(item(el, "[data-request-bill]")).toBeNull();
      const cancel = item(el, "[data-cancel-bill-request]")!;
      expect(textOf(cancel)).toBe("Cancel the bill request for 4");
      cancel.click();
      expect(request).toEqual([{ requested: false }]);
    });

    it("holds Mark bill requested while a party command runs, and Full invoice while busy", async () => {
      const commanding = await mountScreen({ groupCommandBusy: true });
      const busy = await mountScreen({ busy: true });
      const disabled = (el: TillTableOrderScreen, selector: string) =>
        (item(el, selector) as HTMLElement & { disabled: boolean }).disabled;

      expect(disabled(commanding, "[data-request-bill]")).toBe(true);
      expect(disabled(commanding, "[data-choose-bill-invoice]")).toBe(false);
      expect(disabled(busy, "[data-choose-bill-invoice]")).toBe(true);
      expect(disabled(busy, "[data-request-bill]")).toBe(false);
    });

    it("a step or window item does nothing while the screen is busy", async () => {
      const el = await mountScreen({ busy: true });
      await userEvent.click(menu(el));
      await userEvent.click(item(el, '[data-action="merge"]')!);
      await userEvent.click(menu(el));
      await userEvent.click(item(el, '[data-action="name"]')!);
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector("[data-action-panel]")).toBeNull();
      expect(el.shadowRoot!.querySelector("till-party-name-dialog")).toBeNull();
    });
  });

  describe("a step chosen from the ⋮ is shown and takes focus; leaving it returns focus to the ⋮", () => {
    const sent = (lineNo: number): TabLine => ({
      ...line,
      id: `line-${lineNo}`,
      lineNo,
      name: `Dish ${lineNo}`,
      sentAt: "2026-10-31T20:00:00.000Z",
    });
    const three = [
      partyBill("wo-1", 1, "10.00"),
      partyBill("wo-2", 2, "54.00", { billName: "Ana" }),
      partyBill("wo-3", 3, "0.00", { status: "settled", total: "8.00", hasPayments: true }),
    ];
    /** The panel's step heading has focus. */
    const focusOnStep = (el: TillTableOrderScreen) =>
      el.shadowRoot!.activeElement === el.shadowRoot!.querySelector("[data-action-panel] h2");

    it("in Spanish at 1024x768: Merge bills is scrolled into view with its heading focused; Back and Escape return to the ⋮", async () => {
      setLocale("es");
      await page.viewport(1024, 768);
      try {
        const el = await mountScreen({ bills: three });
        el.lines = [1, 2, 3, 4].map(sent);
        await el.updateComplete;
        await userEvent.click(menu(el));
        await userEvent.click(item(el, '[data-action="merge"]')!);
        await el.updateComplete;

        const panel = el.shadowRoot!.querySelector<HTMLElement>("[data-action-panel]")!;
        await expect
          .poll(() => panel.getBoundingClientRect().bottom)
          .toBeLessThanOrEqual(innerHeight + 1);
        expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
        expect(focusOnStep(el)).toBe(true);
        await userEvent.keyboard("{Tab}");
        expect(el.shadowRoot!.activeElement).toBe(panel.querySelector('[data-target="wo-1"]'));

        await userEvent.click(panel.querySelector<HTMLElement>("[data-action-back]")!);
        await el.updateComplete;
        expect(el.shadowRoot!.querySelector("[data-action-panel]")).toBeNull();
        expect(focusOnMenu(el)).toBe(true);

        await userEvent.click(menu(el));
        await userEvent.click(item(el, '[data-action="merge"]')!);
        await el.updateComplete;
        expect(focusOnStep(el)).toBe(true);
        await userEvent.keyboard("{Escape}");
        await el.updateComplete;
        expect(el.shadowRoot!.querySelector("[data-action-panel]")).toBeNull();
        expect(focusOnMenu(el)).toBe(true);
      } finally {
        await page.viewport(1280, 900);
      }
    });

    it.each([
      ["the ⋮", "[data-table-menu]"],
      ["the bill switcher", "[data-bill-switcher]"],
    ])(
      "Escape in a step while %s is open closes only that list; the next Escape closes the step",
      async (_name, selector) => {
        const el = await mountScreen();
        await userEvent.click(menu(el));
        await userEvent.click(item(el, '[data-action="merge"]')!);
        await el.updateComplete;
        const list = el.shadowRoot!.querySelector<HTMLElement & { show(): void }>(selector)!;
        const popup = list.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
        list.show();
        el.shadowRoot!.querySelector<HTMLElement>("[data-action-panel] h2")!.focus();
        expect(popup.matches(":popover-open")).toBe(true);
        expect(focusOnStep(el)).toBe(true);

        await userEvent.keyboard("{Escape}");
        await el.updateComplete;
        expect(popup.matches(":popover-open")).toBe(false);
        expect(el.shadowRoot!.querySelector("[data-action-panel]")).not.toBeNull();

        await userEvent.keyboard("{Escape}");
        await el.updateComplete;
        expect(el.shadowRoot!.querySelector("[data-action-panel]")).toBeNull();
      },
    );

    it("a second step replacing the first takes focus too, and Back from it returns to the first", async () => {
      const el = await mountScreen({ bills: three });
      await userEvent.click(menu(el));
      await userEvent.click(item(el, '[data-action="split-table"]')!);
      await el.updateComplete;
      expect(focusOnStep(el)).toBe(true);
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-target="t5"]')!);
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-target="none"]')).not.toBeNull();
      expect(focusOnStep(el)).toBe(true);
      await userEvent.keyboard("{Escape}");
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-target="t5"]')).not.toBeNull();
      expect(focusOnStep(el)).toBe(true);
    });

    it("a redraw with no step or window closing leaves focus where it is", async () => {
      const el = await mountScreen();
      const switcher = el.shadowRoot!.querySelector<HTMLElement>("[data-bill-switcher]")!;
      switcher.focus();
      expect(el.shadowRoot!.activeElement).toBe(switcher);

      el.bills = bills.map((bill) => ({ ...bill }));
      await el.updateComplete;
      el.groupCommandBusy = true;
      await el.updateComplete;
      el.lines = [{ ...line, quantity: "2.000" }];
      await el.updateComplete;
      expect(el.shadowRoot!.activeElement).toBe(switcher);
    });

    it("a step closed while focus is elsewhere leaves focus there", async () => {
      const el = await mountScreen();
      await userEvent.click(menu(el));
      await userEvent.click(item(el, '[data-action="merge"]')!);
      await el.updateComplete;
      const switcher = el.shadowRoot!.querySelector<HTMLElement>("[data-bill-switcher]")!;
      switcher.focus();
      el.orderId = "wo-1";
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-action-panel]")).toBeNull();
      expect(el.shadowRoot!.activeElement).toBe(switcher);
    });
  });

  describe("A1234: focus returns to the ⋮ when a window opened from it closes", () => {
    it("Name the party: Cancel, Escape and Save", async () => {
      const el = await mountScreen();
      const dialog = () => el.shadowRoot!.querySelector("till-party-name-dialog")!;

      item(el, '[data-action="name"]')!.click();
      await el.updateComplete;
      await dialog().updateComplete;
      dialog().shadowRoot!.querySelector<HTMLElement>("[data-name-cancel]")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("till-party-name-dialog")).toBeNull();
      expect(focusOnMenu(el)).toBe(true);

      item(el, '[data-action="name"]')!.click();
      await el.updateComplete;
      await dialog().updateComplete;
      await userEvent.keyboard("{Escape}");
      await expect.poll(() => el.shadowRoot!.querySelector("till-party-name-dialog")).toBeNull();
      await el.updateComplete;
      expect(focusOnMenu(el)).toBe(true);

      item(el, '[data-action="name"]')!.click();
      await el.updateComplete;
      await dialog().updateComplete;
      dialog().dispatchEvent(
        new CustomEvent("party-name-confirm", {
          detail: { name: "Ana" },
          bubbles: true,
          composed: true,
        }),
      );
      await el.updateComplete;
      expect(focusOnMenu(el)).toBe(true);
    });

    it("Name this bill and Guests", async () => {
      const el = await mountScreen();

      item(el, '[data-action="name-bill"]')!.click();
      await el.updateComplete;
      const naming = el.shadowRoot!.querySelector("till-bill-name-dialog")!;
      await naming.updateComplete;
      naming.shadowRoot!.querySelector<HTMLElement>("[data-name-cancel]")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("till-bill-name-dialog")).toBeNull();
      expect(focusOnMenu(el)).toBe(true);

      (document.activeElement as HTMLElement | null)?.blur();
      item(el, '[data-action="guests"]')!.click();
      await el.updateComplete;
      const counting = el.shadowRoot!.querySelector("till-party-guests-dialog")!;
      await counting.updateComplete;
      counting.shadowRoot!.querySelector<HTMLElement>("[data-guests-cancel]")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("till-party-guests-dialog")).toBeNull();
      expect(focusOnMenu(el)).toBe(true);
    });

    it("Split a table's guests window", async () => {
      const el = await mountScreen();

      item(el, '[data-action="split-table"]')!.click();
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>('[data-target="t5"]')!.click();
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>('[data-target="none"]')!.click();
      await el.updateComplete;
      const splitting = el.shadowRoot!.querySelector("till-split-guests-dialog")!;
      await splitting.updateComplete;
      splitting.shadowRoot!.querySelector<HTMLElement>("[data-split-guests-cancel]")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("till-split-guests-dialog")).toBeNull();
      expect(focusOnMenu(el)).toBe(true);
    });
  });
});
