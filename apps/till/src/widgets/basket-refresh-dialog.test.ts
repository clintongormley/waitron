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
        { lineNo: 1, name: "Burger", from: "9.00", to: "8.00" },
        { lineNo: 1, name: "Cheese", from: "1.00", to: "2.00" },
      ],
      blocked: [],
    });
    const rows = [...el.shadowRoot!.querySelectorAll("[data-changed] li[data-line='1']")];
    expect(rows.map((row) => row.textContent!.replace(/\s+/g, " ").trim())).toEqual([
      "Burger €9.00 → €8.00",
      "Cheese €1.00 → €2.00",
    ]);
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
