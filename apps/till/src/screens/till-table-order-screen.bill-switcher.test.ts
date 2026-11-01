import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
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
