import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { cleanupWidgets, mountWidget, pageAt, resetPage } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { PartyBill, TableParty } from "../api/client.js";
import { partyBill, switcherParty } from "./till-table-order-screen.bill-switcher.test-helpers.js";

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
  switcher(el)!.querySelector("[data-bill-switcher-label]")!.textContent!.trim();
/** The open list's items in order: each bill's row text, then "+ New bill". */
const items = (el: TillTableOrderScreen) =>
  [...switcher(el)!.querySelectorAll<HTMLElement>("[data-switch-bill], [data-new-bill]")].map(
    (item) => item.textContent!.replace(/\s+/g, " ").trim(),
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
  it("one bill: the closed label names it and what it owes; the list holds it, then + New bill", async () => {
    const el = await mountScreen(one, "wo-1");

    expect(closedLabel(el)).toBe("Bill 1 · €38.50");
    expect(items(el)).toEqual(["Bill 1 €38.50", "+ New bill"]);
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

    expect(closedLabel(el)).toBe("Bill 1 · 3 bills · €67.00");
    expect(items(el)).toEqual([
      "Bill 1 €67.00",
      "Bill 2 · Clint €54.00 Ana has an unsent order: 3 items",
      "Bill 3 Paid ✓",
      "+ New bill",
    ]);
    const current = switcher(el)!.querySelector('[data-switch-bill="wo-1"]')!;
    expect(current.getAttribute("aria-checked")).toBe("true");
    expect(
      switcher(el)!.querySelector('[data-switch-bill="wo-2"]')!.getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("names the bill on screen, its name and count in the closed label", async () => {
    const el = await mountScreen(three, "wo-2");

    expect(closedLabel(el)).toBe("Bill 2 · 3 bills · Clint · €54.00");
  });

  it("says Paid for a paid bill on screen", async () => {
    const el = await mountScreen(three, "wo-3");

    expect(closedLabel(el)).toBe("Bill 3 · 3 bills · Paid");
    const trigger = switcher(el)!.querySelector<HTMLElement>('[slot="trigger"]')!;
    expect(trigger.textContent!.replace(/\s+/g, " ").trim()).toBe("Bill 3 · 3 bills · Paid ✓ ▾");
    expect(switcher(el)!.getAttribute("label")).toBe("Bills: Bill 3 · 3 bills · Paid");
    const marks = [...switcher(el)!.querySelectorAll<HTMLElement>("[data-paid-mark]")];
    expect(
      marks.map((mark) => [mark.textContent!.trim(), mark.getAttribute("aria-hidden")]),
    ).toEqual([
      ["✓", "true"],
      ["✓", "true"],
    ]);
  });

  it("+ New bill is the last item with one bill and with three", async () => {
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

    expect(closedLabel(el)).toBe("Bill 1 · 2 bills · €67.00");
    expect(items(el)).toEqual(["Bill 1 €67.00", "Bill 3 Paid ✓", "+ New bill"]);
  });

  it("a table holding Bills 1 and 4 names Bill 4 and counts 2 bills apart from it", async () => {
    const el = await mountScreen(
      [partyBill("wo-1", 1, "67.00"), partyBill("wo-4", 4, "21.00")],
      "wo-4",
    );

    expect(closedLabel(el)).toBe("Bill 4 · 2 bills · €21.00");
    expect(closedLabel(el)).not.toContain(" of ");
  });

  it("choosing Bill 3 dispatches switch-bill with Bill 3's id", async () => {
    const el = await mountScreen(three, "wo-1");
    const seen = capture(el, "switch-bill");

    switcher(el)!.querySelector<HTMLElement>('[data-switch-bill="wo-3"]')!.click();

    expect(seen).toEqual([{ workingOrderId: "wo-3" }]);
  });

  it("choosing the bill on screen dispatches nothing", async () => {
    const el = await mountScreen(three, "wo-1");
    const seen = capture(el, "switch-bill");

    switcher(el)!.querySelector<HTMLElement>('[data-switch-bill="wo-1"]')!.click();

    expect(seen).toEqual([]);
  });

  it("+ New bill dispatches new-bill", async () => {
    const el = await mountScreen(one, "wo-1");
    const seen = capture(el, "new-bill");
    const switched = capture(el, "switch-bill");

    switcher(el)!.querySelector<HTMLElement>("[data-new-bill]")!.click();

    expect(seen).toEqual([{}]);
    expect(switched).toEqual([]);
  });

  it("+ New bill is drawn quiet and marked aria-disabled while one is out, and a tap on it then sends nothing", async () => {
    const el = await mountScreen(one, "wo-1");
    const seen = capture(el, "new-bill");
    const newBill = () => switcher(el)!.querySelector<HTMLElement>("[data-new-bill]")!;
    expect(newBill().hasAttribute("aria-disabled")).toBe(false);
    const idle = getComputedStyle(newBill()).color;

    el.newBillBusy = true;
    await el.updateComplete;
    newBill().click();

    expect(newBill().getAttribute("aria-disabled")).toBe("true");
    expect(getComputedStyle(newBill()).color).not.toBe(idle);
    expect(seen).toEqual([]);
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
    expect(items(el)).toEqual(["Bill €38.50", "+ New bill"]);
  });

  it("a party with no shown bill draws Bills with only + New bill", async () => {
    const el = await mountScreen(
      [partyBill("wo-1", null, "0.00", { status: "abandoned" })],
      undefined,
    );

    expect(closedLabel(el)).toBe("Bills");
    expect(items(el)).toEqual(["+ New bill"]);
  });

  it("no party: no switcher", async () => {
    const el = await mountScreen([], "wo-1", null);

    expect(switcher(el)).toBeNull();
  });

  it.each([
    [20, 390, 844],
    [40, 375, 667],
  ])(
    "with %i bills at %ix%i the open list fits the window and scrolls + New bill fully into view",
    async (count, width, height) => {
      const frame = [innerWidth, innerHeight] as const;
      await page.viewport(width, height);
      try {
        const bills = Array.from({ length: count }, (_, n) =>
          partyBill(`wo-${n + 1}`, n + 1, "3.00"),
        );
        const el = await mountScreen(bills, "wo-1", { ...switcherParty, billCount: count });
        const seen = capture(el, "new-bill");
        const host = switcher(el)!;
        const popup = host.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
        const trigger = host.shadowRoot!.querySelector("button")!;
        await userEvent.click(trigger);

        expect(popup.matches(":popover-open")).toBe(true);
        const popupBox = popup.getBoundingClientRect();
        const anchor = trigger.getBoundingClientRect();
        expect(popupBox.top).toBeGreaterThanOrEqual(anchor.bottom - 0.5);
        expect(popupBox.bottom).toBeLessThanOrEqual(innerHeight);
        expect(popup.scrollHeight).toBeGreaterThan(popup.clientHeight);
        const newBill = host.querySelector<HTMLElement>("[data-new-bill]")!;
        newBill.scrollIntoView({ block: "nearest" });
        const box = newBill.getBoundingClientRect();
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.bottom).toBeLessThanOrEqual(innerHeight);
        await userEvent.click(newBill);
        expect(seen).toEqual([{}]);
      } finally {
        await page.viewport(...frame);
      }
    },
  );

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
    it("the checked row's background differs from the open list's, and from an unchecked row's", async () => {
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
      const checked = background('[data-switch-bill="wo-2"]');
      expect(checked).not.toBe(getComputedStyle(popup).backgroundColor);
      expect(checked).not.toBe(background('[data-switch-bill="wo-1"]'));
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
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  expect(el.shadowRoot!.activeElement).toBe(host.querySelector('[data-switch-bill="wo-1"]'));
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await el.updateComplete;
  expect(picked).toEqual([{ workingOrderId: "wo-2" }]);
  expect(closedLabel(el)).toBe("Bill 2 · 3 bills · Clint · €54.00");
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

    expect(closedLabel(el)).toBe("Bill 1 · 3 bills · €67.00");
    expect(triggerText(el)).toBe("Bill 1 · 3 bills · €67.00 ▾ Bill 2 unsent");
    expect(switcher(el)!.getAttribute("label")).toBe(
      "Bills: Bill 1 · 3 bills · €67.00 · Bill 2 unsent",
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
    expect(items(el)[1]).toBe("Bill 2 · Clint Unsent €54.00 Ana has an unsent order: 2 items");
  });

  it("another person's draft on Bill 2 draws no mark", async () => {
    const el = await mountFor([draft("wo-2", 2, "p-clint")]);

    expect(triggerText(el)).toBe("Bill 1 · 3 bills · €67.00 ▾");
    expect(switcher(el)!.getAttribute("label")).toBe("Bills: Bill 1 · 3 bills · €67.00");
    expect(markedRows(el)).toEqual([]);
  });

  it("this person's draft on the bill on screen only draws no mark", async () => {
    const el = await mountFor([draft("wo-1", 1, "p-ana")]);

    expect(triggerText(el)).toBe("Bill 1 · 3 bills · €67.00 ▾");
    expect(switcher(el)!.getAttribute("label")).toBe("Bills: Bill 1 · 3 bills · €67.00");
    expect(markedRows(el)).toEqual([]);
  });

  it("a draft of this person's with no lines draws no mark", async () => {
    const el = await mountFor([draft("wo-2", 2, "p-ana", 0)]);

    expect(triggerText(el)).toBe("Bill 1 · 3 bills · €67.00 ▾");
    expect(markedRows(el)).toEqual([]);
  });

  it("two other bills: the closed switcher says 2 bills unsent and both rows are marked", async () => {
    const el = await mountFor([draft("wo-3", 3, "p-ana"), draft("wo-2", 2, "p-ana")], "wo-1");

    expect(triggerText(el)).toBe("Bill 1 · 3 bills · €67.00 ▾ 2 bills unsent");
    expect(switcher(el)!.getAttribute("label")).toBe(
      "Bills: Bill 1 · 3 bills · €67.00 · 2 bills unsent",
    );
    expect(markedRows(el)).toEqual(["wo-2", "wo-3"]);
  });

  it("says it in Spanish", async () => {
    setLocale("es");
    const one = await mountFor([draft("wo-2", 2, "p-ana")]);

    expect(triggerText(one)).toBe("Cuenta 1 · 3 cuentas · 67,00 € ▾ Cuenta 2 sin enviar");
    expect(
      switcher(one)!
        .querySelector('[data-switch-bill="wo-2"] [data-bill-row-unsent-mark]')!
        .textContent!.trim(),
    ).toBe("Sin enviar");
    cleanupWidgets();

    const two = await mountFor([draft("wo-2", 2, "p-ana"), draft("wo-3", 3, "p-ana")]);
    expect(triggerText(two)).toBe("Cuenta 1 · 3 cuentas · 67,00 € ▾ 2 cuentas sin enviar");
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

      expect(triggerText(el)).toBe("Cuenta 1 · 3 cuentas · 67,00 € ▾ Cuenta 2 sin enviar");
      expect(Math.abs(middle(menu) - middle(sw))).toBeLessThanOrEqual(1);
      expect(menu.right).toBeLessThanOrEqual(window.innerWidth);
    });

    // CI's Linux fonts draw this row about a fifth wider than macOS's, enough to wrap it at 360 wide.
    it("480 wide, in English, where there is room, the closed label and the mark stay on one line beside the ⋮", async () => {
      const el = await mountPhone(480);
      const closed = box(trigger(el).querySelector(".bill-switcher-closed")!);
      const mark = box(trigger(el).querySelector("[data-unsent-mark]")!);
      const sw = box(switcher(el)!);
      const menu = box(el.shadowRoot!.querySelector("[data-table-menu]")!);

      expect(mark.left).toBeGreaterThanOrEqual(closed.right);
      expect(Math.abs(middle(mark) - middle(closed))).toBeLessThanOrEqual(1);
      expect(Math.abs(middle(menu) - middle(sw))).toBeLessThanOrEqual(1);
      expect(menu.right).toBeLessThanOrEqual(window.innerWidth);
    });
  });
});
