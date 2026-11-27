import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { cleanupWidgets, mountWidget, pageAt, resetPage } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { PartyBill, TableParty } from "../api/floor-api.js";
import {
  billChoiceText,
  partyBill,
  switcherParty,
} from "./till-table-order-screen.bill-switcher.test-helpers.js";

const one = [partyBill("wo-1", 1, "38.50")];
const three = [
  partyBill("wo-3", 3, "0.00", { status: "settled", total: "12.00" }),
  partyBill("wo-1", 1, "67.00"),
  partyBill("wo-2", 2, "54.00", { billName: "Clint" }),
];

async function mountScreen(
  bills: PartyBill[],
  orderId: string | undefined,
  party: TableParty | null = switcherParty,
) {
  const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products: [],
    lines: [],
    orderId,
    party,
    bills,
  });
  return el;
}

const switcher = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-bill-switcher]");
const closedLabel = (el: TillTableOrderScreen) =>
  [
    ...switcher(el)!.querySelectorAll(
      ".bill-switcher-name, .bill-switcher-amount, .bill-switcher-position",
    ),
  ]
    .map((piece) => piece.textContent!.trim())
    .join(" · ");
/** The open list's items in order: each bill's row text, then "New bill". */
const items = (el: TillTableOrderScreen) =>
  [...switcher(el)!.querySelectorAll("[data-switch-bill], [data-new-bill]")].map((item) =>
    [
      billChoiceText(item, "label"),
      billChoiceText(item, "value"),
      ...[...item.querySelectorAll(".bill-row-unsent, [data-bill-row-unsent-mark]")].map(
        (note) => note.textContent,
      ),
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  );

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

describe("A803 switcher: the table screen's bill switcher", () => {
  it("one bill: the closed label names it and what it owes; the list holds it, then New bill", async () => {
    const el = await mountScreen(one, "wo-1");

    expect(closedLabel(el)).toBe("Bill 1 · €38.50");
    expect(items(el)).toEqual(["Bill 1 €38.50", "New bill"]);
  });

  it("lines up the selected tick, the empty check column and the New bill icon", async () => {
    const el = await mountScreen(three, "wo-2");
    const menu = switcher(el)!;
    await userEvent.click(menu.shadowRoot!.querySelector("button")!);
    const state = (selector: string) =>
      menu.querySelector(selector)!.querySelector<HTMLElementTagNameMap["wt-icon"]>("wt-icon");
    const unselected = state('[data-switch-bill="wo-1"]')!;
    const selected = state('[data-switch-bill="wo-2"]')!;
    const add = state("[data-new-bill]")!;
    expect(selected?.getAttribute("name")).toBe("check");
    expect(add?.getAttribute("name")).toBe("plus");
    expect(getComputedStyle(unselected).visibility).toBe("hidden");
    expect(unselected.getBoundingClientRect().width).toBe(selected.getBoundingClientRect().width);
    expect(selected.getBoundingClientRect().left).toBe(add.getBoundingClientRect().left);
  });

  it("three bills: a count in the closed label, rows in number order with what each owes, Paid, a name, and who has unsent dishes", async () => {
    const party: TableParty = {
      ...switcherParty,
      unsentDrafts: [
        {
          billId: "wo-2",
          billNumber: 2,
          ownerId: "p-ana",
          ownerName: "Ana",
          lineCount: 3,
          savedAt: "2026-10-31T10:00:00.000Z",
        },
      ],
    };
    const el = await mountScreen(three, "wo-1", party);

    expect(closedLabel(el)).toBe("Bill 1 · €67.00 · 1 of 3");
    expect(items(el)).toEqual([
      "Bill 1 €67.00",
      "Bill 2 · Clint €54.00 Ana has an unsent order: 3 items",
      "Bill 3 Paid",
      "New bill",
    ]);
    const current = switcher(el)!.querySelector('[data-switch-bill="wo-1"]')!;
    expect(current.getAttribute("aria-checked")).toBe("true");
    expect(
      switcher(el)!.querySelector('[data-switch-bill="wo-2"]')!.getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("names the bill on screen, its name and count in the closed label", async () => {
    const el = await mountScreen(three, "wo-2");

    expect(closedLabel(el)).toBe("Bill 2 · Clint · €54.00 · 2 of 3");
  });

  it("says Deferred payment, with no ✓, for a bill closed as a deferred payment", async () => {
    const bills = [
      partyBill("wo-3", 3, "0.00", { status: "settled", total: "12.00", deferred: true }),
      partyBill("wo-1", 1, "67.00"),
    ];
    const el = await mountScreen(bills, "wo-3");

    const trigger = switcher(el)!.querySelector<HTMLElement>('[slot="trigger"]')!;
    expect(trigger.textContent!.replace(/\s+/g, " ").trim()).toBe("Bill 3 Deferred payment 2 of 2");
    expect(items(el)).toEqual(["Bill 1 €67.00", "Bill 3 Deferred payment", "New bill"]);
    const deferred = switcher(el)!.querySelector('[data-switch-bill="wo-3"] wt-menu-row')!;
    expect(deferred.shadowRoot!.querySelector('wt-icon[name="check"]')).toBeNull();
  });

  it("the switcher shows an overpaid bill's excess, not an amount owed", async () => {
    const bills = [
      partyBill("wo-1", 1, "0.00", { total: "10.00", overpaid: "5.00", hasPayments: true }),
      partyBill("wo-2", 2, "30.00"),
    ];
    const el = await mountScreen(bills, "wo-1");

    expect(closedLabel(el)).toBe("Bill 1 · €5.00 over · 1 of 2");
    expect(items(el)).toEqual(["Bill 1 €5.00 over", "Bill 2 €30.00", "New bill"]);
  });

  it("says Paid for a paid bill on screen", async () => {
    const el = await mountScreen(three, "wo-3");

    expect(closedLabel(el)).toBe("Bill 3 · Paid ✓ · 3 of 3");
    const trigger = switcher(el)!.querySelector<HTMLElement>('[slot="trigger"]')!;
    expect(trigger.textContent!.replace(/\s+/g, " ").trim()).toBe("Bill 3 Paid ✓ 3 of 3");
    expect(switcher(el)!.getAttribute("label")).toBe("Bills: Bill 3 · Paid · 3 of 3");
    expect(trigger.querySelector("[data-paid-mark]")!.getAttribute("aria-hidden")).toBe("true");
    const row = switcher(el)!.querySelector('[data-switch-bill="wo-3"] wt-menu-row')!.shadowRoot!;
    const tick = row.querySelector('wt-icon[name="check"]');
    expect(tick?.shadowRoot?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(getComputedStyle(tick!).color).toBe(
      getComputedStyle(row.querySelector(".value")!).color,
    );
  });

  it("New bill is the last item with one bill and with three", async () => {
    for (const bills of [one, three]) {
      const el = await mountScreen(bills, "wo-1");
      const all = [...switcher(el)!.querySelectorAll<HTMLElement>("button")];
      expect(all.at(-1)!.hasAttribute("data-new-bill")).toBe(true);
      expect(all.filter((item) => item.hasAttribute("data-new-bill"))).toHaveLength(1);
      cleanupWidgets();
    }
  });

  it("after Bill 2 is merged away the list shows Bill 1 and Bill 3, and the closed label counts 2", async () => {
    const merged = three.map((bill) =>
      bill.workingOrderId === "wo-2"
        ? { ...bill, status: "abandoned" as const, billNumber: null, outstanding: "0.00" }
        : bill,
    );
    const el = await mountScreen(merged, "wo-1");

    expect(closedLabel(el)).toBe("Bill 1 · €67.00 · 1 of 2");
    expect(items(el)).toEqual(["Bill 1 €67.00", "Bill 3 Paid", "New bill"]);
  });

  it("a table holding Bills 1 and 4 shows Bill 4 in position 2 of 2", async () => {
    const el = await mountScreen(
      [partyBill("wo-1", 1, "67.00"), partyBill("wo-4", 4, "21.00")],
      "wo-4",
    );

    expect(closedLabel(el)).toBe("Bill 4 · €21.00 · 2 of 2");
  });

  it("choosing the bill on screen dispatches nothing", async () => {
    const el = await mountScreen(three, "wo-1");
    const seen = capture(el, "switch-bill");

    switcher(el)!.querySelector<HTMLElement>('[data-switch-bill="wo-1"]')!.click();

    expect(seen).toEqual([]);
  });

  it("New bill is drawn quiet and marked aria-disabled while one is out, and a tap on it then sends nothing", async () => {
    const el = await mountScreen(one, "wo-1");
    const seen = capture(el, "new-bill");
    const newBill = () => switcher(el)!.querySelector<HTMLElement>("[data-new-bill]")!;
    expect(newBill().hasAttribute("aria-disabled")).toBe(false);
    const paintedLabel = () =>
      getComputedStyle(newBill().querySelector("wt-menu-row")!.shadowRoot!.querySelector(".label")!)
        .color;
    const idle = getComputedStyle(newBill()).color;
    expect(paintedLabel()).toBe(idle);

    el.newBillBusy = true;
    await el.updateComplete;
    newBill().click();

    expect(newBill().getAttribute("aria-disabled")).toBe("true");
    expect(paintedLabel()).toBe(getComputedStyle(newBill()).color);
    expect(paintedLabel()).not.toBe(idle);
    expect(seen).toEqual([]);
  });

  it("keeps at least 12 px between a long bill name and its amount in the wide drop-down", async () => {
    await pageAt(820, 1180);
    try {
      const billName = "Birthday celebration by the far window";
      const el = await mountScreen([...one, partyBill("wo-2", 2, "54.00", { billName })], "wo-1");
      const picker = switcher(el)!;
      await expect.poll(() => picker.hasAttribute("bottom-sheet")).toBe(false);
      await userEvent.click(picker.shadowRoot!.querySelector("button")!);
      const popup = picker.shadowRoot!.querySelector("[popover]")!;
      expect(popup.matches(":popover-open")).toBe(true);
      const row = picker.querySelector('[data-switch-bill="wo-2"] wt-menu-row')!.shadowRoot!;
      const label = row.querySelector(".label")!.getBoundingClientRect();
      const owes = row.querySelector(".value")!.getBoundingClientRect();
      expect(owes.left - label.right).toBeGreaterThanOrEqual(12);
      expect(label.top).toBeLessThan(owes.bottom);
      expect(owes.right).toBeLessThan(popup.getBoundingClientRect().right);
    } finally {
      await resetPage();
    }
  });

  it("keeps the amount and position readable beside a long name on a phone", async () => {
    await pageAt(390, 844);
    try {
      const el = await mountScreen(
        [...one, partyBill("wo-2", 2, "54.00", { billName: "Birthday party by the window" })],
        "wo-2",
      );
      const picker = switcher(el)!;
      const trigger = picker.shadowRoot!.querySelector("button")!;
      const label = picker.querySelector<HTMLElement>(".bill-switcher-name")!;
      const amount = picker.querySelector<HTMLElement>(".bill-switcher-amount")!;
      const position = picker.querySelector<HTMLElement>(".bill-switcher-position")!;
      const arrow = picker.querySelector('[slot="trigger"] wt-icon[name="chevron-down"]')!;
      expect(label?.textContent).toBe("Bill 2 · Birthday party by the window");
      expect(amount.textContent!.trim()).toBe("€54.00");
      expect(position.textContent).toBe("2 of 2");
      expect(getComputedStyle(label).fontWeight).toBe("600");
      expect(getComputedStyle(amount).fontWeight).toBe("400");
      expect(getComputedStyle(amount).color).toBe(getComputedStyle(position).color);
      expect(getComputedStyle(amount).color).not.toBe(getComputedStyle(label).color);
      expect(parseFloat(getComputedStyle(position).fontSize)).toBeLessThan(
        parseFloat(getComputedStyle(label).fontSize),
      );
      expect(amount.getBoundingClientRect().right).toBeLessThan(
        position.getBoundingClientRect().left,
      );
      expect(position.getBoundingClientRect().right).toBeLessThan(
        arrow.getBoundingClientRect().left,
      );
      expect(arrow.getBoundingClientRect().right).toBeLessThan(
        trigger.getBoundingClientRect().right,
      );
      expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    } finally {
      await resetPage();
    }
  });

  it("keeps the amount on one line beside a long name in the phone sheet", async () => {
    await pageAt(390, 844);
    try {
      const billName = "W".repeat(40);
      const el = await mountScreen([...one, partyBill("wo-2", 2, "1234.56", { billName })], "wo-1");
      const picker = switcher(el)!;
      await userEvent.click(picker.shadowRoot!.querySelector("button")!);
      const row = picker.querySelector('[data-switch-bill="wo-2"] wt-menu-row')!.shadowRoot!;
      const amount = row.querySelector(".value")!;
      expect(amount.textContent).toBe("€1,234.56");
      const text = document.createRange();
      text.selectNodeContents(amount);
      expect(text.getClientRects()).toHaveLength(1);
    } finally {
      await resetPage();
    }
  });

  it("paints a named, divided sheet with roomy rows on a phone", async () => {
    await pageAt(390, 844);
    try {
      const el = await mountScreen(three, "wo-2");
      const picker = switcher(el)!;
      await userEvent.click(picker.shadowRoot!.querySelector("button")!);
      const sheet = picker.shadowRoot!.querySelector<HTMLElement>('[part="sheet"]')!;
      const heading = picker.shadowRoot!.getElementById(sheet.getAttribute("aria-labelledby")!);
      const rows = [...picker.querySelectorAll<HTMLElement>("[data-switch-bill]")];
      expect(heading?.textContent).toBe("Bills on Table 4");
      expect(getComputedStyle(heading!).textTransform).toBe("uppercase");
      expect(getComputedStyle(sheet, "::before").width).toBe("40px");
      expect(rows.map((row) => row.getBoundingClientRect().height)).toEqual([56, 56, 56]);
      expect(getComputedStyle(rows[0]!).borderBlockEndWidth).toBe("1px");
      const current = rows[1]!;
      const icon = current.querySelector("wt-icon")!;
      const row = current.querySelector("wt-menu-row")!.shadowRoot!.querySelector(".row")!;
      expect(getComputedStyle(row).fontSize).toBe("16px");
      expect(icon.getAttribute("name")).toBe("check");
      expect(icon.getBoundingClientRect().right).toBeLessThan(
        row.querySelector(".label")!.getBoundingClientRect().left,
      );
      expect(row.querySelector(".value")!.textContent).toBe("€54.00");
      const newBill = picker.querySelector("[data-new-bill]")!;
      expect(sheet.getBoundingClientRect().bottom - newBill.getBoundingClientRect().bottom).toBe(
        20,
      );
    } finally {
      await resetPage();
    }
  });

  it("the closed switcher is drawn with a border, as a secondary button is", async () => {
    const el = await mountScreen(one, "wo-1");
    const trigger = switcher(el)!.shadowRoot!.querySelector<HTMLElement>('[part="trigger"]')!;
    const style = getComputedStyle(trigger);

    expect([style.borderTopStyle, style.borderTopWidth]).toEqual(["solid", "1px"]);
    expect(style.borderTopColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  it("an unnumbered bill reads Bill", async () => {
    const el = await mountScreen([partyBill("wo-1", null, "38.50")], "wo-1");

    expect(closedLabel(el)).toBe("Bill · €38.50");
    expect(items(el)).toEqual(["Bill €38.50", "New bill"]);
  });

  it("a party with no shown bill draws Bills with only New bill", async () => {
    const el = await mountScreen(
      [partyBill("wo-1", null, "0.00", { status: "abandoned" })],
      undefined,
    );

    expect(closedLabel(el)).toBe("Bills");
    expect(items(el)).toEqual(["New bill"]);
  });

  it("no party: no switcher", async () => {
    const el = await mountScreen([], "wo-1", null);

    expect(switcher(el)).toBeNull();
  });

  it.each([
    [390, true],
    [760, false],
  ])("uses bottom-list mode at %ipx: %s", async (width, bottomSheet) => {
    await pageAt(width + 48, 740);
    try {
      const el = await mountScreen(three, "wo-1");
      el.style.width = `${width}px`;
      await expect.poll(() => switcher(el)!.hasAttribute("bottom-sheet")).toBe(bottomSheet);
      const host = switcher(el)!;
      const trigger = host.shadowRoot!.querySelector("button")!;
      const switched = capture(el, "switch-bill");
      const created = capture(el, "new-bill");
      await userEvent.click(trigger);
      await userEvent.click(host.querySelector<HTMLElement>('[data-switch-bill="wo-3"]')!);
      expect(switched).toEqual([{ workingOrderId: "wo-3" }]);
      await userEvent.click(trigger);
      await userEvent.click(host.querySelector<HTMLElement>("[data-new-bill]")!);
      expect(created).toEqual([{}]);
      expect(switched).toEqual([{ workingOrderId: "wo-3" }]);
    } finally {
      await resetPage();
    }
  });

  it.each([
    ["en", "4", "Bills on Table 4"],
    ["en", "12A", "Bills on Table 12A"],
    ["en", "4, 5", "Bills on Tables 4, 5"],
    ["es", "4, 5", () => t("table.bills_on_numbered_tables").replace("{party}", "4, 5")],
    ["en", "Table 4", "Bills on Table 4"],
    ["en", "Ventana", "Bills on Ventana"],
    ["es", "Table 4", () => t("table.bills_on_table").replace("{party}", "Table 4")],
  ] as const)("names the sheet in %s for %s", async (locale, displayName, heading) => {
    setLocale(locale);
    const el = await mountScreen(one, "wo-1", { ...switcherParty, displayName });
    const picker = switcher(el)!;
    await userEvent.click(picker.shadowRoot!.querySelector("button")!);
    const menu = picker.querySelector('[role="menu"]')!;
    const sheet = picker.shadowRoot!.querySelector('[role="dialog"]')!;
    const title = picker.shadowRoot!.getElementById(sheet.getAttribute("aria-labelledby")!);
    const expected = typeof heading === "function" ? heading() : heading;
    expect(title?.textContent?.trim()).toBe(expected);
    expect(menu.getAttribute("aria-label")).toBe(expected);
  });

  it("shows on a handheld too", async () => {
    const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
      products: [],
      lines: [],
      orderId: "wo-1",
      party: switcherParty,
      bills: one,
      handheld: true,
    });

    expect(switcher(el)!.checkVisibility()).toBe(true);
    expect(closedLabel(el)).toBe("Bill 1 · €38.50");
  });
});

describe.each(["light", "dark"] as const)(
  "A803 switcher: the bill on screen in the %s theme",
  (theme) => {
    it("marks the current bill with a check and gives its row the same fill as other bills", async () => {
      const { el } = await mountWidget<TillTableOrderScreen>(
        "till-table-order-screen",
        { products: [], lines: [], orderId: "wo-2", party: switcherParty, bills: three },
        theme,
      );
      const host = switcher(el) as HTMLElement & { show(): void; updateComplete: Promise<boolean> };
      host.show();
      await host.updateComplete;
      const popup = host.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
      const background = (selector: string) =>
        getComputedStyle(host.querySelector<HTMLElement>(selector)!).backgroundColor;

      expect(popup.matches(":popover-open")).toBe(true);
      const checked = host.querySelector<HTMLElement>('[data-switch-bill="wo-2"]')!;
      const other = '[data-switch-bill="wo-1"]';
      expect(getComputedStyle(checked).backgroundColor).toBe(background(other));
      await userEvent.hover(host.querySelector<HTMLElement>(other)!);
      const hover = background(other);
      // In a short window a row can open under the press that opened the sheet.
      await userEvent.hover(checked);
      expect(checked.matches(":hover")).toBe(true);
      expect(getComputedStyle(checked).backgroundColor).toBe(hover);
    });
  },
);

it("switches the mounted bill by keyboard, updates its label and returns focus to the trigger", async () => {
  const el = await mountScreen(three, "wo-1");
  const host = switcher(el)!;
  const trigger = host.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
  const popup = host.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  const picked = capture(el, "switch-bill");
  el.addEventListener("switch-bill", (event) => {
    el.orderId = (event as CustomEvent<{ workingOrderId: string }>).detail.workingOrderId;
  });
  await userEvent.click(trigger);
  expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
  expect(el.shadowRoot!.activeElement).toBe(host.querySelector('[data-switch-bill="wo-1"]'));
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await el.updateComplete;
  expect(picked).toEqual([{ workingOrderId: "wo-2" }]);
  expect(closedLabel(el)).toBe("Bill 2 · Clint · €54.00 · 2 of 3");
  expect(host.querySelector('[data-switch-bill="wo-2"]')!.getAttribute("aria-checked")).toBe(
    "true",
  );
  expect(popup.matches(":popover-open")).toBe(false);
  expect(host.shadowRoot!.activeElement).toBe(trigger);
  await userEvent.keyboard("{Enter}{End}{ArrowDown}");
  expect(el.shadowRoot!.activeElement).toBe(host.querySelector('[data-switch-bill="wo-1"]'));
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
});

describe("A797 slice 11: the switcher marks another bill holding this person's unsent dishes", () => {
  const draft = (billId: string, billNumber: number, ownerId: string, lineCount = 2) => ({
    billId,
    billNumber,
    ownerId,
    ownerName: ownerId === "p-ana" ? "Ana" : "Clint",
    lineCount,
    savedAt: "2026-10-31T10:00:00.000Z",
  });

  async function mountFor(unsentDrafts: TableParty["unsentDrafts"], orderId = "wo-1") {
    const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
      products: [],
      lines: [],
      orderId,
      party: { ...switcherParty, unsentDrafts },
      bills: three,
      personId: "p-ana",
    });
    return el;
  }

  const trigger = (el: TillTableOrderScreen) =>
    switcher(el)!.querySelector<HTMLElement>('[slot="trigger"]')!;
  const triggerText = (el: TillTableOrderScreen) =>
    trigger(el).textContent!.replace(/\s+/g, " ").trim();
  /** The ids of the rows carrying the Unsent mark. */
  const markedRows = (el: TillTableOrderScreen) =>
    [...switcher(el)!.querySelectorAll<HTMLElement>("[data-switch-bill]")]
      .filter((row) => row.querySelector("[data-bill-row-unsent-mark]") !== null)
      .map((row) => row.dataset.switchBill);

  it("another bill: the closed switcher and its label say Bill 2 unsent, the icon is hidden, and only Bill 2's row says Unsent", async () => {
    const el = await mountFor([draft("wo-2", 2, "p-ana")]);

    expect(closedLabel(el)).toBe("Bill 1 · €67.00 · 1 of 3");
    expect(triggerText(el)).toBe("Bill 1 €67.00 1 of 3 Bill 2 unsent");
    expect(switcher(el)!.getAttribute("label")).toBe(
      "Bills: Bill 1 · €67.00 · 1 of 3 · Bill 2 unsent",
    );
    const icon = trigger(el).querySelector("[data-unsent-mark] wt-icon")!;
    expect([icon.getAttribute("name"), icon.getAttribute("aria-hidden")]).toEqual([
      "floor-unsent",
      "true",
    ]);
    expect(markedRows(el)).toEqual(["wo-2"]);
    const rowMark = switcher(el)!.querySelector(
      '[data-switch-bill="wo-2"] [data-bill-row-unsent-mark]',
    )!;
    expect(rowMark.textContent!.trim()).toBe("Unsent");
    expect(rowMark.querySelector("wt-icon")!.getAttribute("aria-hidden")).toBe("true");
    expect(items(el)[1]).toBe("Bill 2 · Clint €54.00 Unsent Ana has an unsent order: 2 items");
  });

  it("another person's draft on Bill 2 draws no mark", async () => {
    const el = await mountFor([draft("wo-2", 2, "p-clint")]);

    expect(triggerText(el)).toBe("Bill 1 €67.00 1 of 3");
    expect(switcher(el)!.getAttribute("label")).toBe("Bills: Bill 1 · €67.00 · 1 of 3");
    expect(markedRows(el)).toEqual([]);
  });

  it("this person's draft on the bill on screen only draws no mark", async () => {
    const el = await mountFor([draft("wo-1", 1, "p-ana")]);

    expect(triggerText(el)).toBe("Bill 1 €67.00 1 of 3");
    expect(switcher(el)!.getAttribute("label")).toBe("Bills: Bill 1 · €67.00 · 1 of 3");
    expect(markedRows(el)).toEqual([]);
  });

  it("a draft of this person's with no lines draws no mark", async () => {
    const el = await mountFor([draft("wo-2", 2, "p-ana", 0)]);

    expect(triggerText(el)).toBe("Bill 1 €67.00 1 of 3");
    expect(markedRows(el)).toEqual([]);
  });

  it("two other bills: the closed switcher says 2 bills unsent and both rows are marked", async () => {
    const el = await mountFor([draft("wo-3", 3, "p-ana"), draft("wo-2", 2, "p-ana")], "wo-1");

    expect(triggerText(el)).toBe("Bill 1 €67.00 1 of 3 2 bills unsent");
    expect(switcher(el)!.getAttribute("label")).toBe(
      "Bills: Bill 1 · €67.00 · 1 of 3 · 2 bills unsent",
    );
    expect(markedRows(el)).toEqual(["wo-2", "wo-3"]);
  });

  it("says it in Spanish", async () => {
    setLocale("es");
    const one = await mountFor([draft("wo-2", 2, "p-ana")]);

    expect(triggerText(one)).toBe("Cuenta 1 67,00 € 1 de 3 Cuenta 2 sin enviar");
    expect(
      switcher(one)!
        .querySelector('[data-switch-bill="wo-2"] [data-bill-row-unsent-mark]')!
        .textContent!.trim(),
    ).toBe("Sin enviar");
    cleanupWidgets();

    const two = await mountFor([draft("wo-2", 2, "p-ana"), draft("wo-3", 3, "p-ana")]);
    expect(triggerText(two)).toBe("Cuenta 1 67,00 € 1 de 3 2 cuentas sin enviar");
  });

  describe("on a phone, embedded in the till", () => {
    // The ⋮ icon is registered by till-app.ts; without it the ⋮ is drawn empty.
    registerIcons({
      kebab:
        "M6.7 3a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 8a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 13a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0",
    });

    afterEach(() => resetPage());

    async function mountPhone(width: number) {
      await pageAt(width, 740);
      const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
        products: [],
        lines: [],
        orderId: "wo-1",
        party: { ...switcherParty, unsentDrafts: [draft("wo-2", 2, "p-ana")] },
        bills: three,
        personId: "p-ana",
        embedded: true,
        handheld: true,
      });
      await document.fonts.ready;
      return el;
    }
    const box = (node: Element) => node.getBoundingClientRect();
    const middle = (rect: DOMRect) => rect.top + rect.height / 2;

    it("360 wide, in Spanish the mark wraps inside the switcher and the ⋮ stays on its row, inside the screen", async () => {
      setLocale("es");
      const el = await mountPhone(360);
      const sw = box(switcher(el)!);
      const menu = box(el.shadowRoot!.querySelector("[data-table-menu]")!);

      expect(triggerText(el)).toBe("Cuenta 1 67,00 € 1 de 3 Cuenta 2 sin enviar");
      expect(Math.abs(middle(menu) - middle(sw))).toBeLessThanOrEqual(1);
      expect(menu.right).toBeLessThanOrEqual(window.innerWidth);
    });

    it("480 wide, the unsent hint has its own line and the ⋮ stays beside the picker", async () => {
      const el = await mountPhone(480);
      const closed = box(trigger(el).querySelector(".bill-switcher-closed")!);
      const mark = box(trigger(el).querySelector("[data-unsent-mark]")!);
      const sw = box(switcher(el)!);
      const menu = box(el.shadowRoot!.querySelector("[data-table-menu]")!);

      expect(mark.top).toBeGreaterThan(closed.bottom);
      expect(mark.left).toBeGreaterThanOrEqual(closed.left);
      expect(mark.right).toBeLessThanOrEqual(sw.right);
      expect(Math.abs(middle(menu) - middle(sw))).toBeLessThanOrEqual(1);
      expect(menu.right).toBeLessThanOrEqual(window.innerWidth);
    });
  });
});
