import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { PartyBill, TableParty, TableState } from "../api/floor-api.js";
import type { TabLine } from "../api/kitchen-api.js";
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
    label: id.slice(1),
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
    billPrintPending?: boolean;
    groupCommandBusy?: boolean;
    lines?: TabLine[];
    takesPayment?: boolean;
    activeTableId?: string;
  } = {},
) {
  const party = over.party === undefined ? twoTables : over.party;
  const { el } = await mountWidget<TillTableOrderScreen>(
    "till-table-order-screen",
    {
      products: [],
      lines: over.lines ?? [line],
      orderId: "orderId" in over ? over.orderId : "wo-2",
      activeTableId: over.activeTableId,
      party,
      bills: over.bills ?? bills,
      fullInvoices: over.fullInvoices ?? true,
      tables:
        party === null ? [] : party.tableIds.map((id) => table(id, party, over.requested ?? false)),
      busy: over.busy ?? false,
      billPrintPending: over.billPrintPending ?? false,
      groupCommandBusy: over.groupCommandBusy ?? false,
      ...(over.takesPayment === undefined ? {} : { takesPayment: over.takesPayment }),
    },
    "light",
  );
  return el;
}

const menu = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-table-menu]")!;
const partyMenu = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-party-menu]")!;
async function clickEditorBack(editor: Element): Promise<void> {
  const bar = editor.shadowRoot!.querySelector("wt-top-bar")!;
  await bar.updateComplete;
  const button = bar.shadowRoot!.querySelector("wt-button")!;
  await button.updateComplete;
  await userEvent.click(button.shadowRoot!.querySelector("button")!);
}
const textOf = (node: Element) => node.textContent!.replace(/\s+/g, " ").trim();
/** The bill action group: its accessible name and the choices in order. */
function groups(el: TillTableOrderScreen): { name: string; items: string[] }[] {
  return [...menu(el).querySelectorAll<HTMLElement>('[role="group"]')].map((group) => ({
    name: textOf(el.shadowRoot!.getElementById(group.getAttribute("aria-labelledby")!)!),
    items: [...group.querySelectorAll<HTMLElement>("wt-button")].map(textOf),
  }));
}
const item = (el: TillTableOrderScreen, selector: string) =>
  menu(el)?.querySelector<HTMLElement>(selector) ??
  partyMenu(el).querySelector<HTMLElement>(selector);

function capture(el: TillTableOrderScreen, type: string): unknown[] {
  const seen: unknown[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent).detail));
  return seen;
}

/** Focus is on the menu’s own trigger button. */
function focusOnMenu(el: TillTableOrderScreen, host = menu(el)): boolean {
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

describe("Table and bill actions", () => {
  it("opens table choices from the table name in a sheet at the bottom of a phone", async () => {
    await page.viewport(390, 844);
    try {
      const el = await mountScreen();
      const sheet = el.shadowRoot!.querySelector("[data-party-menu]");
      expect(sheet).not.toBeNull();
      const trigger = sheet!.shadowRoot!.querySelector("button")!;
      expect(trigger.getAttribute("aria-label")).toBe("Table 4");
      await userEvent.click(trigger);

      const popup = sheet!.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
      expect(popup.matches(":popover-open")).toBe(true);
      await expect
        .poll(() => Math.round(popup.querySelector(".actions")!.getBoundingClientRect().bottom))
        .toBe(innerHeight);
      const panel = popup.querySelector('[role="dialog"]')!;
      const handle = getComputedStyle(panel, "::before");
      const firstRow = sheet!.querySelector('[data-action="allergy"]')!;
      const handleToFirstRow = Math.round(
        firstRow.getBoundingClientRect().bottom -
          panel.getBoundingClientRect().top -
          parseFloat(handle.marginTop) -
          parseFloat(handle.height),
      );
      expect(Math.abs(handleToFirstRow - 84)).toBeLessThanOrEqual(1);
      expect(el.shadowRoot!.activeElement).toBe(sheet!.querySelector('[data-action="allergy"]'));
      const finish = sheet!.querySelector<HTMLElement>("[data-finish-table]")!;
      expect(sheet!.lastElementChild).toBe(finish);
      expect(finish.previousElementSibling?.tagName).not.toBe("HR");
      const finished = capture(el, "finish-table");
      await userEvent.click(finish);
      expect(finished).toEqual([{}]);
    } finally {
      await page.viewport(1280, 900);
    }
  });

  it("measures the order edge only for a panel that needs it", async () => {
    await page.viewport(1280, 900);
    const el = await mountScreen();
    const pane = el.shadowRoot!.querySelector("[data-draft-pane]")!;
    await expect.poll(() => pane.getBoundingClientRect().left).toBeGreaterThan(0);
    const measure = vi.spyOn(pane, "getBoundingClientRect");
    try {
      el.requestUpdate();
      await el.updateComplete;
      expect(measure).not.toHaveBeenCalled();

      await userEvent.click(partyMenu(el).shadowRoot!.querySelector("button")!);
      expect(measure).toHaveBeenCalled();
    } finally {
      measure.mockRestore();
    }
  });

  it.each([
    ["name", "till-party-name-dialog", "Name the party"],
    ["guests", "till-party-guests-dialog", "Guests"],
  ])(
    "opens the %s editor over the order, keeping the active bill",
    async (action, editor, title) => {
      await page.viewport(390, 844);
      try {
        const el = await mountScreen({ activeTableId: "t5" });
        const sheet = partyMenu(el);
        await userEvent.click(sheet.shadowRoot!.querySelector("button")!);
        await userEvent.click(item(el, `[data-action="${action}"]`)!);
        await expect.element(page.getByRole("dialog", { name: new RegExp(title) })).toBeVisible();
        const panel = el.shadowRoot!.querySelector(editor)!.shadowRoot!.querySelector("wt-dialog")!;
        const dialog = panel.shadowRoot!.querySelector("dialog")!;
        const edges = () => {
          const { left, right, top, bottom } = dialog.getBoundingClientRect();
          return [Math.round(left), Math.round(right), Math.round(top), Math.round(bottom)];
        };
        expect(edges()).toEqual([0, 390, 0, 844]);

        await page.viewport(844, 390);
        const paneLeft = () =>
          Math.round(
            el.shadowRoot!.querySelector("[data-draft-pane]")!.getBoundingClientRect().left,
          );
        await expect.poll(paneLeft).toBeGreaterThan(0);
        await expect.poll(edges).toEqual([paneLeft(), 844, 0, 390]);
        const bar = el
          .shadowRoot!.querySelector(editor)!
          .shadowRoot!.querySelector("wt-top-bar")!.shadowRoot!;
        expect(bar.querySelector(".back-label")?.textContent).toBe("Table 5");
        expect(bar.querySelector(".subtitle")).toBeNull();
        await clickEditorBack(el.shadowRoot!.querySelector(editor)!);
        await expect.poll(() => el.shadowRoot!.querySelector(editor)).toBeNull();
        expect(el.orderId).toBe("wo-2");
        expect(focusOnMenu(el, sheet)).toBe(true);
      } finally {
        await page.viewport(1280, 900);
      }
    },
  );

  it("keeps the table name above the guest count and party name", async () => {
    await page.viewport(390, 844);
    try {
      const el = await mountScreen({
        party: { ...twoTables, displayName: "Garcia", name: "Garcia" },
        activeTableId: "t5",
      });
      const sheet = partyMenu(el);
      const trigger = sheet.shadowRoot!.querySelector("button")!;
      expect(trigger.getAttribute("aria-label")).toBe("Table 5");
      expect(textOf(sheet.querySelector('[slot="trigger"]')!)).toBe("Table 5");
      expect(textOf(sheet.nextElementSibling!)).toBe("3 guests · Garcia");
      expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);

      await userEvent.click(trigger);
      await commands.parkPointer();
      await expect.element(page.getByRole("dialog", { name: "Table 5" })).toBeVisible();
      const title = sheet.querySelector('[slot="trigger"]')!;
      expect(getComputedStyle(title).backgroundColor).toBe("rgb(210, 239, 251)");
      const icon = title.querySelector("wt-icon")!;
      expect(getComputedStyle(icon).color).toBe(getComputedStyle(title).color);
      expect(icon.getBoundingClientRect()).toMatchObject({ width: 16, height: 12 });
      expect(title.getBoundingClientRect().left).toBeGreaterThan(0);
      await userEvent.keyboard("{Escape}");
      expect(focusOnMenu(el, sheet)).toBe(true);
      await expect.poll(() => getComputedStyle(title).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    } finally {
      await page.viewport(1280, 900);
    }
  });

  it("keeps a wide sheet on the order side while dimming the whole display", async () => {
    await page.viewport(390, 844);
    try {
      const el = await mountScreen();
      const sheet = partyMenu(el);
      await userEvent.click(sheet.shadowRoot!.querySelector("button")!);
      const backdrop = sheet.shadowRoot!.querySelector("[popover]")!;
      const popup = backdrop.querySelector('[role="dialog"]')!;
      const order = () => el.shadowRoot!.querySelector("[data-draft-pane]")!;
      const edges = (element: Element) => {
        const { left, right } = element.getBoundingClientRect();
        return [Math.round(left), Math.round(right)];
      };
      expect(edges(popup)).toEqual([0, 390]);
      expect(edges(backdrop)).toEqual([0, 390]);
      for (const [width, height] of [
        [844, 390],
        [1280, 900],
      ] as const) {
        await page.viewport(width, height);
        await expect.poll(() => edges(order())[0]).toBeGreaterThan(0);
        await expect.poll(() => edges(popup)).toEqual([edges(order())[0], width]);
        expect(edges(backdrop)).toEqual([0, width]);
      }
      await page.viewport(390, 844);
      await expect.poll(() => edges(popup)).toEqual([0, 390]);
    } finally {
      await page.viewport(1280, 900);
    }
  });

  it("opens table actions under the saved name of a joined table group", async () => {
    const el = await mountScreen({
      party: { ...twoTables, name: "Terrace long", displayName: "Terrace long" },
    });
    el.tables = el.tables.map((row, index) => ({
      ...row,
      today: {
        placement: { x: 2 * index, y: 0, width: 2, height: 2, shape: "rect", rotation: 0 },
        seats: null,
        fixed: false,
        takenOff: false,
        joinId: "joined",
        joinName: "Terrace long",
        joinSeats: null,
        zoneRevision: 1,
      },
    }));
    await el.updateComplete;
    const sheet = partyMenu(el);
    const trigger = sheet.shadowRoot!.querySelector("button")!;
    expect(trigger.getAttribute("aria-label")).toBe("Terrace long");
    expect(textOf(sheet.nextElementSibling!)).toBe("3 guests");
    await userEvent.click(trigger);
    await expect.element(page.getByRole("dialog", { name: "Terrace long" })).toBeVisible();
  });

  it.each([
    ["en", "Join tables", "Split the table"],
    ["es", "Unir mesas", "Separar la mesa"],
  ] as const)("shows the joined-table action labels in %s", async (locale, join, split) => {
    setLocale(locale);
    const el = await mountScreen();
    const sheet = partyMenu(el);
    await userEvent.click(sheet.shadowRoot!.querySelector("button")!);
    const joinButton = sheet.querySelector('[data-action="join"]')!;
    const splitButton = sheet.querySelector('[data-action="split-table"]')!;
    expect(joinButton.querySelector("wt-menu-row")!.getAttribute("label")).toBe(join);
    expect(splitButton.querySelector("wt-menu-row")!.getAttribute("label")).toBe(split);
    expect(splitButton.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
  });

  it("reopens at the saved bill-request state when a toggle was refused", async () => {
    const el = await mountScreen({ requested: true });
    const events = capture(el, "request-bill");
    const sheet = el.shadowRoot!.querySelector<HTMLElement>("[data-party-menu]")!;
    expect(sheet).not.toBeNull();
    const trigger = sheet.shadowRoot!.querySelector("button")!;
    const popup = sheet.shadowRoot!.querySelector("[popover]")!;
    const control = sheet.querySelector("wt-switch")!.shadowRoot!.querySelector("input")!;

    await userEvent.click(trigger);
    expect(control.checked).toBe(true);
    await userEvent.click(control);
    expect(focusOnMenu(el, sheet)).toBe(true);
    expect(events).toEqual([{ requested: false }]);
    expect(popup.matches(":popover-open")).toBe(false);

    await userEvent.click(trigger);
    expect(control.checked).toBe(true);
  });

  it.each([false, true])(
    "toggles saved state %s when the Bill requested label is tapped",
    async (requested) => {
      const el = await mountScreen({ requested });
      const events = capture(el, "request-bill");
      const sheet = partyMenu(el);
      await userEvent.click(sheet.shadowRoot!.querySelector("button")!);
      const label = sheet
        .querySelector("wt-menu-row:has(wt-switch)")!
        .shadowRoot!.querySelector(".label")!;
      expect(getComputedStyle(label).cursor).toBe("pointer");
      await userEvent.click(label);
      expect(events).toEqual([{ requested: !requested }]);
      expect(sheet.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
      expect(focusOnMenu(el, sheet)).toBe(true);
    },
  );

  it("offers the table sheet and bill picker without an empty bill actions button", async () => {
    const el = await mountScreen({ orderId: undefined });
    expect(el.shadowRoot!.querySelector("[data-party-menu]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-bill-switcher] [data-new-bill]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-table-menu]")).toBeNull();
  });

  it("records only the shown bill as left unpaid from its Bill menu", async () => {
    const el = await mountScreen();
    const seen = capture(el, "record-unpaid-departure");
    const button = item(el, "[data-record-departure]");
    expect(button).not.toBeNull();
    button!.click();
    expect(seen).toEqual([{ workingOrderId: "wo-2" }]);
    el.bills = [bills[0]!, { ...bills[1]!, leftUnpaid: true }];
    await el.updateComplete;
    expect(item(el, "[data-record-departure]")).toBeNull();
  });

  it.each([
    partyBill("wo-2", 2, "0.00"),
    partyBill("wo-2", 2, "18.00", { status: "placed", amountDue: "0.00" }),
    partyBill("wo-2", 2, "10.00", {
      status: "placed",
      total: "30.00",
      hasPayments: true,
      holdsMoney: true,
      invoiceNumber: "A/1",
      correctives: ["R/1"],
      amountDue: "17.90",
    }),
  ])("keeps a zero-due bill out of unpaid departure and leaves Pay available", async (zero) => {
    const el = await mountScreen({ bills: [zero] });
    expect(item(el, "[data-record-departure]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-pay-sheet], till-tender-pay")).not.toBeNull();
  });

  it("names the bill ellipsis and keeps table actions off it", async () => {
    const el = await mountScreen();

    expect(el.shadowRoot!.querySelectorAll("[data-table-menu]")).toHaveLength(1);
    expect(menu(el).tagName).toBe("WT-ROW-ACTIONS");
    expect(menu(el).getAttribute("label")).toBe("Bill actions");
    expect(menu(el).querySelector("[data-table-menu-table]")).toBeNull();
    const buttons = [...el.shadowRoot!.querySelectorAll<HTMLElement>("wt-button")];
    expect(buttons.filter((button) => textOf(button) === "Table actions")).toEqual([]);
  });

  it("keeps an owing bill's actions under its label", async () => {
    const el = await mountScreen();

    expect(groups(el)).toEqual([
      {
        name: "Bill 2 · Clint",
        items: [
          "Name this bill…",
          "Move dishes…",
          "Merge bills…",
          "Move this bill…",
          "Comp the bill…",
          "Record unpaid departure",
          "Full invoice",
          "Print the bill",
        ],
      },
    ]);
  });

  it("offers Split a table only at two or more tables", async () => {
    const el = await mountScreen({ party: switcherParty });

    expect(partyMenu(el).querySelector('[data-action="split-table"]')).toBeNull();
    expect(partyMenu(el).querySelector('[data-action="join"]')).not.toBeNull();
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
    expect(bill!.items).toContain("Name this bill…");
    expect(bill!.items).toContain("Receipt copy");
    expect(bill!.items).not.toContain("Full invoice");
    expect(item(el, "[data-choose-bill-invoice]")).toBeNull();
    expect(item(el, "[data-bill-receipt]")).not.toBeNull();
  });

  it("a presented bill with a receipt and no payments offers Nothing was served", async () => {
    const presented = partyBill("wo-2", 2, "54.00", { status: "placed", receiptAvailable: true });
    const el = await mountScreen({ bills: [presented] });

    expect(groups(el)[0]!.items).toContain("Nothing was served");
    expect(item(el, "[data-cancel-credit]")).not.toBeNull();
    expect(groups(el)[0]!.items).toContain("Full invoice");
  });

  it("calls Nothing was served No se sirvió nada in Spanish", async () => {
    setLocale("es");
    const presented = partyBill("wo-2", 2, "54.00", { status: "placed", receiptAvailable: true });
    const el = await mountScreen({ bills: [presented] });

    expect(groups(el)[0]!.items).toContain("No se sirvió nada");
  });

  it("a presented full invoice naming a customer offers no Nothing was served, which the server would refuse", async () => {
    const named = partyBill("wo-2", 2, "54.00", {
      status: "placed",
      receiptAvailable: true,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345678",
        legalName: "Acme SL",
        address: "Calle 1",
        countryCode: "ES",
      },
    });
    const el = await mountScreen({ bills: [named] });

    expect(item(el, "[data-bill-receipt]")).not.toBeNull();
    expect(item(el, "[data-cancel-credit]")).toBeNull();
  });

  it("a presented full invoice naming no customer still offers Nothing was served", async () => {
    const unnamed = partyBill("wo-2", 2, "54.00", {
      status: "placed",
      receiptAvailable: true,
      invoiceType: "F1",
      recipient: null,
    });
    const el = await mountScreen({ bills: [unnamed] });

    expect(item(el, "[data-cancel-credit]")).not.toBeNull();
  });

  it("a presented bill with a receipt and no payments offers Reopen bill, which asks to reopen that bill", async () => {
    const presented = partyBill("wo-2", 2, "54.00", { status: "placed", receiptAvailable: true });
    const el = await mountScreen({ bills: [presented] });

    expect(groups(el)[0]!.items).toContain("Reopen bill");
    const split = capture(el, "split-after-print-bill");
    item(el, "[data-split-after-print]")!.click();
    expect(split).toEqual([{ workingOrderId: "wo-2" }]);
  });

  it("a presented bill its guests left unpaid offers Nothing was served but no Reopen bill", async () => {
    const left = partyBill("wo-2", 2, "54.00", {
      status: "placed",
      receiptAvailable: true,
      leftUnpaid: true,
    });
    const el = await mountScreen({ bills: [left] });

    expect(item(el, "[data-cancel-credit]")).not.toBeNull();
    expect(item(el, "[data-split-after-print]")).toBeNull();
  });

  it("offers Reopen bill on a printed bill with payments, and Nothing was served only without", async () => {
    const part = partyBill("wo-3", 3, "20.00", {
      status: "placed",
      total: "54.00",
      receiptAvailable: true,
      hasPayments: true,
    });
    const el = await mountScreen({ bills: [part], orderId: "wo-3" });

    expect(item(el, "[data-cancel-credit]")).toBeNull();
    const split = capture(el, "split-after-print-bill");
    item(el, "[data-split-after-print]")!.click();
    expect(split).toEqual([{ workingOrderId: "wo-3" }]);
  });

  it("offers no Reopen bill wherever it offers no Nothing was served", async () => {
    const named = partyBill("wo-2", 2, "54.00", {
      status: "placed",
      receiptAvailable: true,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345678",
        legalName: "Acme SL",
        address: "Calle 1",
        countryCode: "ES",
      },
    });
    const unprinted = partyBill("wo-4", 4, "54.00", { status: "placed", receiptAvailable: false });
    for (const bill of [named, unprinted]) {
      const el = await mountScreen({ bills: [bill], orderId: bill.workingOrderId });
      expect(item(el, "[data-cancel-credit]")).toBeNull();
      expect(item(el, "[data-split-after-print]")).toBeNull();
    }
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

  it("keeps Join and Move available before a party is seated", async () => {
    const el = await mountScreen({ party: null, bills: [], orderId: "wo-9" });
    expect(menu(el)).toBeNull();
    expect(
      [...partyMenu(el).querySelectorAll("[data-action]")].map((row) =>
        row.getAttribute("data-action"),
      ),
    ).toEqual(["move", "join"]);
  });

  it("names the bill menu in Spanish", async () => {
    setLocale("es");
    const el = await mountScreen();
    expect(groups(el).map((group) => group.name)).toEqual(["Cuenta 2 · Clint"]);
    expect(menu(el).getAttribute("label")).toBe("Acciones de cuenta");
  });

  it("each copy sends its own event", async () => {
    const el = await mountScreen();
    const adjust = capture(el, "adjust");
    const invoice = capture(el, "choose-bill-invoice");

    item(el, "[data-discount-bill]")!.click();
    item(el, "[data-choose-bill-invoice]")!.click();

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
  });

  it("Receipt copy and Nothing was served send their events for the bill on screen", async () => {
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

  it("Print the bill sends end-meal for the bill on screen", async () => {
    const el = await mountScreen();
    const printed = capture(el, "end-meal");

    item(el, '[data-action="print-bill"]')!.click();

    expect(printed).toEqual([{ workingOrderId: "wo-2" }]);
  });

  it("Print the bill sends nothing while the screen is busy", async () => {
    const el = await mountScreen({ busy: true });
    const printed = capture(el, "end-meal");

    item(el, '[data-action="print-bill"]')!.click();

    expect(printed).toEqual([]);
  });

  it("shows Print the bill unavailable while another bill's print has no answer yet", async () => {
    const el = await mountScreen({ billPrintPending: true });

    const print = item(el, '[data-action="print-bill"]') as HTMLElement & { disabled: boolean };

    expect(print.disabled).toBe(true);
    expect((item(el, '[data-action="name-bill"]') as typeof print).disabled).toBe(false);
  });

  it("offers no Print the bill while a payment's answer is unknown", async () => {
    const el = await mountScreen();
    el.paymentConfirmation = {
      tender: { method: "cash", amount: "12.00" },
      outstanding: "10.00",
      guestCount: 3,
    };
    await el.updateComplete;

    expect(item(el, '[data-action="print-bill"]')).toBeNull();
  });

  it("offers no Print the bill while a part payment on the bill is held", async () => {
    const el = await mountScreen();
    el.billPaymentHeld = true;
    await el.updateComplete;

    expect(item(el, '[data-action="print-bill"]')).toBeNull();
  });

  it("offers no Print the bill on a new bill with no dishes, which the server says owes nothing", async () => {
    const empty = partyBill("wo-2", 2, "0.00");
    const el = await mountScreen({ bills: [empty], lines: [] });

    expect(item(el, '[data-action="print-bill"]')).toBeNull();
  });

  it("offers Print the bill on a bill whose dishes were all given away, which prints at 0.00", async () => {
    const given = partyBill("wo-2", 2, "0.00");
    const el = await mountScreen({ bills: [given] });

    expect(item(el, '[data-action="print-bill"]')).not.toBeNull();
  });

  it("offers no Print the bill to a person who may not take payment", async () => {
    const el = await mountScreen({ takesPayment: false });

    expect(item(el, '[data-action="print-bill"]')).toBeNull();
  });

  it("offers no Print the bill for a bill that needs paper where receipts may not print", async () => {
    const el = await mountScreen();
    el.canPrintReceipt = false;
    await el.updateComplete;

    expect(item(el, '[data-action="print-bill"]')).toBeNull();
  });

  it.each([
    ["A4", { medium: "a4", pagePrinterId: "printer-1" }],
    ["email", { medium: "email", recipient: "guest@example.test" }],
  ] as const)(
    "offers Print the bill for a full invoice going to %s where receipts may not print",
    async (_medium, invoiceDelivery) => {
      const el = await mountScreen({
        bills: [partyBill("wo-2", 2, "54.00", { invoiceType: "F1", invoiceDelivery })],
      });
      el.canPrintReceipt = false;
      await el.updateComplete;

      expect(item(el, '[data-action="print-bill"]')).not.toBeNull();
    },
  );

  it("offers Print the bill on a presented bill with no invoice number", async () => {
    const presented = partyBill("wo-2", 2, "54.00", { status: "placed" });
    const el = await mountScreen({ bills: [presented] });

    expect(groups(el)[0]!.items).toContain("Print the bill");
  });

  it("names Print the bill in Spanish", async () => {
    setLocale("es");
    const el = await mountScreen();

    expect(groups(el)[0]!.items).toContain("Imprimir la cuenta");
  });

  it.each([
    [
      "a printed bill",
      partyBill("wo-2", 2, "54.00", {
        status: "placed",
        invoiceNumber: "F-0007",
        receiptAvailable: true,
      }),
    ],
    ["a bill left unpaid", partyBill("wo-2", 2, "54.00", { status: "placed", leftUnpaid: true })],
    [
      "a paid bill",
      partyBill("wo-2", 2, "0.00", { status: "settled", total: "54.00", receiptAvailable: true }),
    ],
    ["an abandoned bill", partyBill("wo-2", 2, "0.00", { status: "abandoned" })],
  ])("offers no Print the bill on %s", async (_name, bill) => {
    const el = await mountScreen({ bills: [bill] });

    expect(item(el, '[data-action="print-bill"]')).toBeNull();
  });

  it("a printed bill not yet paid offers Receipt copy, sent for the bill on screen", async () => {
    const printed = partyBill("wo-2", 2, "54.00", {
      status: "placed",
      invoiceNumber: "F-0007",
      receiptAvailable: true,
    });
    const el = await mountScreen({ bills: [printed] });
    const reprint = capture(el, "reprint-bill");

    expect(groups(el)[0]!.items).toContain("Receipt copy");
    item(el, "[data-bill-receipt]")!.click();

    expect(reprint).toEqual([{ workingOrderId: "wo-2" }]);
  });

  it.each([
    [
      "printed and not yet paid",
      partyBill("wo-2", 2, "54.00", {
        status: "placed",
        invoiceNumber: "F-0007",
        receiptAvailable: true,
      }),
    ],
    [
      "paid",
      partyBill("wo-2", 2, "0.00", { status: "settled", total: "54.00", receiptAvailable: true }),
    ],
  ])("offers no Receipt copy of a bill %s where receipts may not print", async (_name, bill) => {
    const el = await mountScreen({ bills: [bill] });
    expect(item(el, "[data-bill-receipt]")).not.toBeNull();

    el.canPrintReceipt = false;
    await el.updateComplete;

    expect(item(el, "[data-bill-receipt]")).toBeNull();
  });

  it("an open bill with no receipt offers no Receipt copy", async () => {
    const el = await mountScreen();

    expect(item(el, "[data-bill-receipt]")).toBeNull();
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

  describe("A803 LOOK F5: the bill's items are those the server takes in the bill's state", () => {
    const paid = partyBill("wo-2", 2, "0.00", {
      status: "settled",
      total: "54.00",
      receiptAvailable: true,
      hasPayments: true,
    });
    const presented = partyBill("wo-2", 2, "54.00", {
      status: "placed",
      receiptAvailable: true,
      invoiceNumber: "F-0007",
    });
    const billItem = (el: TillTableOrderScreen, selector: string) =>
      menu(el).querySelector<HTMLElement>(`[data-table-menu-bill] ${selector}`);

    // moveDishes and mergeBills refuse a `bill.paid` or `bill.presented` bill on screen
    // (apps/server/src/bill-actions.ts, refuseClosedBill).
    it.each([
      ["a paid bill", paid],
      ["a presented bill", presented],
    ])("%s offers no Move dishes… or Merge bills", async (_, bill) => {
      const el = await mountScreen({ bills: [bill] });

      expect(billItem(el, '[data-action="move-dishes"]')).toBeNull();
      expect(billItem(el, '[data-action="merge"]')).toBeNull();
      expect(groups(el)[0]!.items).not.toContain("Move dishes…");
      expect(groups(el)[0]!.items).not.toContain("Merge bills…");
    });

    it("a paid bill keeps Name this bill and Receipt copy", async () => {
      const el = await mountScreen({ bills: [paid] });

      expect(groups(el)[0]!.items).toEqual(["Name this bill…", "Receipt copy"]);
    });

    it("a presented bill keeps Name this bill, Move this bill, Record unpaid departure, Receipt copy, Nothing was served and Reopen bill", async () => {
      const el = await mountScreen({ bills: [presented] });

      expect(groups(el)[0]!.items).toEqual([
        "Name this bill…",
        "Move this bill…",
        "Record unpaid departure",
        "Receipt copy",
        "Nothing was served",
        "Reopen bill",
      ]);
    });

    it("a presented bill with no invoice number still offers Full invoice", async () => {
      const unnumbered = partyBill("wo-2", 2, "54.00", {
        status: "placed",
        receiptAvailable: true,
      });
      const el = await mountScreen({ bills: [unnumbered] });

      expect(groups(el)[0]!.items).toEqual([
        "Name this bill…",
        "Move this bill…",
        "Record unpaid departure",
        "Full invoice",
        "Print the bill",
        "Receipt copy",
        "Nothing was served",
        "Reopen bill",
      ]);
    });

    it("an open bill holding a payment keeps Move dishes…", async () => {
      const el = await mountScreen({
        bills: [partyBill("wo-2", 2, "40.00", { total: "54.00", hasPayments: true })],
      });

      expect(billItem(el, '[data-action="move-dishes"]')).not.toBeNull();
    });

    it("an open bill holding a payment offers Merge bills and Move dishes…", async () => {
      const el = await mountScreen({
        bills: [
          partyBill("wo-2", 2, "40.00", { total: "54.00", hasPayments: true }),
          partyBill("wo-3", 3, "20.00", { total: "20.00" }),
        ],
      });

      expect(billItem(el, '[data-action="merge"]')).not.toBeNull();
      expect(billItem(el, '[data-action="move-dishes"]')).not.toBeNull();
    });

    it("an open bill holding no payment, beside one that does, still offers Move dishes… and Merge bills", async () => {
      const el = await mountScreen({
        bills: [
          partyBill("wo-2", 2, "54.00", { total: "54.00" }),
          partyBill("wo-3", 3, "10.00", { total: "20.00", hasPayments: true }),
        ],
      });

      expect(billItem(el, '[data-action="move-dishes"]')).not.toBeNull();
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

      expect(groups(el)[0]!.items).toContain("Name this bill…");
      expect(item(el, "[data-bill-receipt]")).toBeNull();
    });

    it("a presented bill with a receipt and payments offers no Nothing was served", async () => {
      const presented = partyBill("wo-2", 2, "20.00", {
        status: "placed",
        total: "54.00",
        receiptAvailable: true,
        hasPayments: true,
      });
      const el = await mountScreen({ bills: [presented] });

      expect(groups(el)[0]!.items).toContain("Name this bill…");
      expect(item(el, "[data-cancel-credit]")).toBeNull();
    });

    it("holds the bill-request switch during a party command and Full invoice while busy", async () => {
      const commanding = await mountScreen({ groupCommandBusy: true });
      const busy = await mountScreen({ busy: true });

      expect(
        commanding.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
          "[data-bill-request]",
        )!.disabled,
      ).toBe(true);
      expect(
        commanding.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
          "[data-choose-bill-invoice]",
        )!.disabled,
      ).toBe(false);
      expect(
        busy.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>("[data-bill-request]")!
          .disabled,
      ).toBe(false);
      expect(
        busy.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
          "[data-choose-bill-invoice]",
        )!.disabled,
      ).toBe(true);
    });

    it("a step or window item does nothing while the screen is busy", async () => {
      const el = await mountScreen({ busy: true });
      await userEvent.click(menu(el));
      await userEvent.click(item(el, '[data-action="merge"]')!);
      await userEvent.click(partyMenu(el));
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
      el.shadowRoot!.activeElement ===
      el.shadowRoot!.querySelector("[data-action-panel] :is(h2, [data-action-heading])");

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
        el.shadowRoot!.querySelector<HTMLElement>(
          "[data-action-panel] :is(h2, [data-action-heading])",
        )!.focus();
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
      el.personId = "me";
      el.splitRead = { partyRevision: 3, bills: [] };
      await userEvent.click(partyMenu(el));
      await userEvent.click(item(el, '[data-action="split-table"]')!);
      await el.updateComplete;
      expect(focusOnStep(el)).toBe(true);
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-target="t5"]')!);
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("till-split-picker")).not.toBeNull();
      expect(focusOnStep(el)).toBe(true);
      await userEvent.keyboard("{Escape}");
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-target="t5"]')).not.toBeNull();
      expect(focusOnStep(el)).toBe(true);
      await userEvent.keyboard("{Escape}");
      expect(focusOnMenu(el, partyMenu(el))).toBe(true);
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

  describe("A1234: focus returns to the menu that opened a window", () => {
    it("focuses the bill picker when the open naming window loses its bill", async () => {
      const el = await mountScreen();
      await userEvent.click(menu(el).shadowRoot!.querySelector("button")!);
      await userEvent.click(item(el, '[data-action="name-bill"]')!);
      expect(el.shadowRoot!.querySelector("till-bill-name-dialog")).not.toBeNull();

      el.orderId = undefined;
      el.bills = [];
      await el.updateComplete;

      expect(el.shadowRoot!.querySelector("till-bill-name-dialog")).toBeNull();
      expect(menu(el)).toBeNull();
      expect(focusOnMenu(el, el.shadowRoot!.querySelector("[data-bill-switcher]")!)).toBe(true);
    });

    it("Name the party: Back, Escape and Save", async () => {
      const el = await mountScreen();
      const dialog = () => el.shadowRoot!.querySelector("till-party-name-dialog")!;

      item(el, '[data-action="name"]')!.click();
      await el.updateComplete;
      await dialog().updateComplete;
      const closed = new Promise<void>((resolve) =>
        dialog().addEventListener("party-name-cancel", () => resolve(), { once: true }),
      );
      await clickEditorBack(dialog());
      await closed;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("till-party-name-dialog")).toBeNull();
      expect(focusOnMenu(el, partyMenu(el))).toBe(true);

      item(el, '[data-action="name"]')!.click();
      await el.updateComplete;
      await dialog().updateComplete;
      await userEvent.keyboard("{Escape}");
      await expect.poll(() => el.shadowRoot!.querySelector("till-party-name-dialog")).toBeNull();
      await el.updateComplete;
      expect(focusOnMenu(el, partyMenu(el))).toBe(true);

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
      expect(focusOnMenu(el, partyMenu(el))).toBe(true);
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
      const closed = new Promise<void>((resolve) =>
        counting.addEventListener("party-guests-cancel", () => resolve(), { once: true }),
      );
      await clickEditorBack(counting);
      await closed;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("till-party-guests-dialog")).toBeNull();
      expect(focusOnMenu(el, partyMenu(el))).toBe(true);
    });
  });
});
