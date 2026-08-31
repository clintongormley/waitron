import { afterEach, describe, expect, it } from "vitest";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillDietFilter } from "./diet-filter.js";

/** The interactive lens options the filter renders (vegan / vegetarian / no-meat / no-fish). */
function options(el: TillDietFilter): HTMLElement[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLElement>('[data-test^="diet-filter-"]')];
}

afterEach(cleanupWidgets);

describe("till-diet-filter", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-diet-filter")).toBe(TillDietFilter);
  });

  it("renders the four dietary lenses, labelled and in order, marking the selected one", async () => {
    const { el } = await mountWidget<TillDietFilter>("till-diet-filter", { selected: "vegan" });
    const opts = options(el);
    expect(opts.map((o) => o.getAttribute("data-test"))).toEqual([
      "diet-filter-vegan",
      "diet-filter-vegetarian",
      "diet-filter-no-meat",
      "diet-filter-no-fish",
    ]);
    expect(opts.map((o) => o.textContent?.trim())).toEqual([
      t("diet.vegan"),
      t("diet.vegetarian"),
      t("diet.filter.no_meat"),
      t("diet.filter.no_fish"),
    ]);
    expect(
      el.shadowRoot!.querySelector('[data-test="diet-filter-vegan"]')!.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      el
        .shadowRoot!.querySelector('[data-test="diet-filter-vegetarian"]')!
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("emits a composed, bubbling diet-filter-selected with the clicked predicate — holds no state itself", async () => {
    const { el } = await mountWidget<TillDietFilter>("till-diet-filter", { selected: null });
    let captured: CustomEvent<{ predicate: string | null }> | undefined;
    el.addEventListener("diet-filter-selected", (e) => {
      captured = e as CustomEvent<{ predicate: string | null }>;
    });
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="diet-filter-no-meat"]')!.click();
    await el.updateComplete;

    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
    expect(captured!.detail).toEqual({ predicate: "no-meat" });
    // Presentational: the widget does NOT move its own selection — the parent owns `selected`.
    expect(
      el
        .shadowRoot!.querySelector('[data-test="diet-filter-no-meat"]')!
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("toggles OFF (predicate: null) when the active lens is tapped again", async () => {
    const { el } = await mountWidget<TillDietFilter>("till-diet-filter", { selected: "vegan" });
    let captured: CustomEvent<{ predicate: string | null }> | undefined;
    el.addEventListener("diet-filter-selected", (e) => {
      captured = e as CustomEvent<{ predicate: string | null }>;
    });
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="diet-filter-vegan"]')!.click();
    await el.updateComplete;
    expect(captured!.detail).toEqual({ predicate: null });
  });
});
