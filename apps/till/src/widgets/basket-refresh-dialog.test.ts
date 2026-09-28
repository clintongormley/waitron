import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { TillBasketRefreshDialog, type BasketRefreshDetail } from "./basket-refresh-dialog.js";

afterEach(cleanupWidgets);

const changed = [{ lineNo: 1, name: "Lemonade", from: "3.00", to: "2.50" }];
const blocked = [
  { lineNo: 2, name: "Burger", reason: "removed" as const },
  { lineNo: 3, name: "Extra cheese", reason: "extra_unavailable" as const },
];

async function mount(props: Partial<TillBasketRefreshDialog>, locale = "en-GB") {
  setLocale(locale);
  return mountWidget<TillBasketRefreshDialog>("till-basket-refresh-dialog", props);
}

const text = (el: TillBasketRefreshDialog) =>
  (el.shadowRoot!.textContent ?? "").replace(/\s+/g, " ");

const rows = (el: TillBasketRefreshDialog) =>
  [...el.shadowRoot!.querySelectorAll("[data-changed] li")].map((row) =>
    row.textContent!.replace(/\s+/g, " ").trim(),
  );

const each = {
  id: "unit-each",
  name: { en: "each", es: "unidad" },
  abbreviation: { en: "ea", es: "ud" },
  precision: 0,
  hardwareUnit: null,
};
// Its abbreviation differs by language, so a row that ignored the operator's language would show.
const kg = {
  id: "unit-kg",
  name: { en: "kilogram", es: "kilo" },
  abbreviation: { en: "kg", es: "kilo" },
  precision: 3,
  hardwareUnit: "kg" as const,
};
const countedParts = [
  { lineNo: 1, name: "Burger", from: "9.00", to: "8.00", units: { from: each, to: each } },
  { lineNo: 1, name: "Cheese", from: "1.00", to: "2.00", units: { from: each, to: each } },
];
const weighedParts = [
  { lineNo: 1, name: "Ham", from: "20.00", to: "18.00", units: { from: kg, to: kg } },
  { lineNo: 1, name: "Cheese", from: "2.00", to: "4.00", units: { from: kg, to: kg } },
];

describe("till-basket-refresh-dialog", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-basket-refresh-dialog")).toBe(TillBasketRefreshDialog);
  });

  it("lists each re-priced line with its old and new price", async () => {
    const { el } = await mount({ changed, blocked: [] });
    expect(text(el)).toContain("Lemonade €3.00 → €2.50");
    expect(el.shadowRoot!.querySelector("[data-blocked]")).toBeNull();
  });

  it("lists each re-priced part of one line on a row of its own", async () => {
    const { el } = await mount({
      changed: [
        { lineNo: 1, name: "Burger", from: "9.00", to: "8.00", units: { from: each, to: each } },
        { lineNo: 1, name: "Cheese", from: "1.00", to: "2.00", units: { from: each, to: each } },
      ],
      blocked: [],
    });
    const rows = [...el.shadowRoot!.querySelectorAll("[data-changed] li[data-line='1']")];
    expect(rows.map((row) => row.textContent!.replace(/\s+/g, " ").trim())).toEqual([
      "Burger €9.00 each → €8.00 each",
      "Cheese €1.00 each → €2.00 each",
    ]);
  });

  it("marks a part's row as a unit price, so it cannot be read as the line's total", async () => {
    const { el } = await mount({ changed: countedParts, blocked: [] });
    expect(rows(el)).toEqual(["Burger €9.00 each → €8.00 each", "Cheese €1.00 each → €2.00 each"]);
  });

  it("marks a part's row as a unit price in Spanish too", async () => {
    const { el } = await mount({ changed: countedParts, blocked: [] }, "es-ES");
    expect(rows(el)).toEqual(["Burger 9,00 € c/u → 8,00 € c/u", "Cheese 1,00 € c/u → 2,00 € c/u"]);
  });

  it("prices a weighed dish's parts per its unit, as the menu does", async () => {
    const { el } = await mount({ changed: weighedParts, blocked: [] });
    expect(rows(el)).toEqual(["Ham €20.00/kg → €18.00/kg", "Cheese €2.00/kg → €4.00/kg"]);
  });

  it("names a weighed dish's unit in the operator's language", async () => {
    const { el } = await mount({ changed: weighedParts, blocked: [] }, "es-ES");
    expect(rows(el)).toEqual([
      "Ham 20,00 €/kilo → 18,00 €/kilo",
      "Cheese 2,00 €/kilo → 4,00 €/kilo",
    ]);
  });

  it("prices a part per the dish's unit when the dish is not counted in whole units", async () => {
    const portion = {
      id: "unit-portion",
      name: { en: "portion", es: "ración" },
      abbreviation: { en: "portion", es: "ración" },
      precision: 1,
      hardwareUnit: null,
    };
    const { el } = await mount({
      changed: [
        {
          lineNo: 1,
          name: "Tortilla",
          from: "12.00",
          to: "11.00",
          units: { from: portion, to: portion },
        },
      ],
      blocked: [],
    });
    expect(rows(el)).toEqual(["Tortilla €12.00/portion → €11.00/portion"]);
  });

  it("gives each side of a part row its own unit", async () => {
    const { el } = await mount({
      changed: [
        { lineNo: 1, name: "Burger", from: "9.00", to: "8.00", units: { from: each, to: kg } },
      ],
      blocked: [],
    });
    expect(rows(el)).toEqual(["Burger €9.00 each → €8.00/kg"]);
  });

  it("formats the prices in the operator's language", async () => {
    const { el } = await mount({ changed, blocked: [] }, "es-ES");
    expect(text(el)).toContain("Lemonade 3,00 € → 2,50 €");
  });

  it("says why each line must be removed or replaced", async () => {
    const { el } = await mount({ changed: [], blocked });
    expect(text(el)).toContain("Burger is no longer on this menu");
    expect(text(el)).toContain("Extra cheese is not available");
    expect(el.shadowRoot!.querySelector("[data-changed]")).toBeNull();
  });

  it("words every reason", async () => {
    const { el } = await mount({
      changed: [],
      blocked: [
        { lineNo: 1, name: "Wine", reason: "unavailable" },
        { lineNo: 2, name: "Bottle", reason: "variant_removed" },
        { lineNo: 3, name: "Bacon", reason: "extra_removed" },
      ],
    });
    expect(text(el)).toContain("Wine is not available");
    expect(text(el)).toContain("Bottle is no longer on this menu");
    expect(text(el)).toContain("Bacon is no longer offered with this dish");
  });

  it("confirms with a composed, bubbling event carrying what it showed", async () => {
    const { el, host } = await mount({ changed, blocked });
    const confirmed = vi.fn();
    host.addEventListener("wt-basket-refresh-confirmed", (event) =>
      confirmed((event as CustomEvent<BasketRefreshDetail>).detail),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    expect(confirmed).toHaveBeenCalledWith({ changed, blocked });
  });

  it("cancels from its Cancel button", async () => {
    const { el, host } = await mount({ changed, blocked: [] });
    const cancelled = vi.fn();
    host.addEventListener("wt-basket-refresh-cancelled", cancelled);
    el.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!.click();
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("cancels once when the dialog is dismissed, and keeps the dialog's own close event inside", async () => {
    const { el, host } = await mount({ changed, blocked: [] });
    const cancelled = vi.fn();
    const closed = vi.fn();
    host.addEventListener("wt-basket-refresh-cancelled", cancelled);
    host.addEventListener("wt-close", closed);
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!.shadowRoot!.querySelector("dialog")!;
    dialog.close();
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
    expect(closed).not.toHaveBeenCalled();
  });
});

describe("till-basket-refresh-dialog on a table's order", () => {
  it("lists a line whose earlier price the till never held with its new price alone", async () => {
    const { el } = await mount({
      changed: [{ lineNo: 1, name: "Beer", to: "6.00" }],
      blocked: [],
    });
    const line = el.shadowRoot!.querySelector("[data-changed] li")!;
    expect(line.textContent!.replace(/\s+/g, " ").trim()).toBe("Beer €6.00");
  });

  it("heads the lines it cannot re-price as left unsent, not as waiting for payment", async () => {
    const { el } = await mount({ changed: [], blocked, purpose: "send" });
    expect(text(el)).toContain(t("basket_refresh.blocked_send"));
    expect(text(el)).not.toContain(t("basket_refresh.blocked"));
  });
});
