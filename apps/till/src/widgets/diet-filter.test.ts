import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { ALLERGEN_CODES } from "@waitron/catalogue/src/allergens.js";
import { EMPTY_MENU_FILTERS, type MenuFilters } from "../menu-filter.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { dialogOpenUnder } from "./track-dialog.js";
import { TillDietFilter } from "./diet-filter.js";

async function open(el: TillDietFilter) {
  const trigger = el.shadowRoot!.querySelector<HTMLElement>("[data-filter-open]");
  expect(trigger).not.toBeNull();
  await userEvent.click(trigger!);
  await el.updateComplete;
}
function option(el: TillDietFilter, name: string) {
  return el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${name}"]`)!;
}
afterEach(cleanupWidgets);

describe("till-diet-filter", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-diet-filter")).toBe(TillDietFilter);
  });

  it("A738 Filter opens the two groups and four ordered diet choices, marking every selected diet", async () => {
    const { el } = await mountWidget<TillDietFilter>("till-diet-filter", {
      selected: { diets: ["vegan", "no-fish"], exclude: {} },
    });
    await open(el);
    expect(dialogOpenUnder(el)).toBe(true);
    const opts = [...el.shadowRoot!.querySelectorAll<HTMLElement>('[data-test^="diet-filter-"]')];
    expect(opts.map((o) => o.dataset.test)).toEqual([
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
    expect(opts.map((o) => o.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "false",
      "true",
    ]);
    expect(el.shadowRoot!.textContent).toContain("Only show dishes that are");
    expect(el.shadowRoot!.textContent).toContain("Hide dishes that contain");
    expect(
      [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-allergen]")].map(
        (o) => o.dataset.allergen,
      ),
    ).toEqual([...ALLERGEN_CODES]);
  });

  it("A738 emits a bubbling composed immutable selection, keeping the parent in control", async () => {
    const selected: MenuFilters = { diets: ["vegan"], exclude: { milk: "all" } };
    const { el } = await mountWidget<TillDietFilter>("till-diet-filter", { selected });
    let captured: CustomEvent<{ filters: MenuFilters }> | undefined;
    el.addEventListener("menu-filters-selected", (e) => {
      captured = e as CustomEvent<{ filters: MenuFilters }>;
    });
    await open(el);
    await userEvent.click(option(el, "diet-filter-no-meat"));
    await el.updateComplete;
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
    expect(captured!.detail).toEqual({
      filters: { diets: ["vegan", "no-meat"], exclude: { milk: "all" } },
    });
    expect(selected).toEqual({ diets: ["vegan"], exclude: { milk: "all" } });
    expect(option(el, "diet-filter-no-meat").getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(option(el, "diet-filter-vegan"));
    expect(captured!.detail).toEqual({ filters: { diets: [], exclude: { milk: "all" } } });
  });

  it("A738 selects kinds or All, counts allergen groups once, and clears every filter", async () => {
    const { el } = await mountWidget<TillDietFilter>("till-diet-filter", {
      selected: EMPTY_MENU_FILTERS,
    });
    const choices: MenuFilters[] = [];
    el.addEventListener("menu-filters-selected", (e) => {
      el.selected = (e as CustomEvent<{ filters: MenuFilters }>).detail.filters;
      choices.push(el.selected);
    });
    await open(el);
    await userEvent.click(option(el, "diet-filter-vegan"));
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-allergen="nuts"]')!);
    expect(el.shadowRoot!.querySelector("[data-kind-step]")).not.toBeNull();
    await userEvent.click(option(el, "kind-walnuts"));
    await userEvent.click(option(el, "kind-almonds"));
    expect(choices.at(-1)).toEqual({ diets: ["vegan"], exclude: { nuts: ["walnuts", "almonds"] } });
    expect(el.shadowRoot!.querySelector("[data-filter-count]")?.textContent?.trim()).toBe("2");
    await userEvent.click(option(el, "kind-all"));
    expect(choices.at(-1)).toEqual({ diets: ["vegan"], exclude: { nuts: "all" } });
    await userEvent.click(option(el, "kind-all"));
    expect(choices.at(-1)).toEqual({ diets: ["vegan"], exclude: {} });
    await userEvent.click(option(el, "kind-all"));
    await userEvent.click(option(el, "kind-walnuts"));
    expect(choices.at(-1)).toEqual({ diets: ["vegan"], exclude: { nuts: ["walnuts"] } });
    await userEvent.click(option(el, "kind-all"));
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-filter-back]")!);
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-allergen="gluten"]')!);
    await userEvent.click(option(el, "kind-wheat"));
    expect(choices.at(-1)).toEqual({
      diets: ["vegan"],
      exclude: { nuts: "all", gluten: ["wheat"] },
    });
    await userEvent.click(option(el, "kind-wheat"));
    expect(choices.at(-1)).toEqual({ diets: ["vegan"], exclude: { nuts: "all" } });
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-filter-back]")!);
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-allergen="milk"]')!);
    expect(choices.at(-1)).toEqual({ diets: ["vegan"], exclude: { nuts: "all", milk: "all" } });
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-allergen="milk"]')!);
    expect(choices.at(-1)).toEqual({ diets: ["vegan"], exclude: { nuts: "all" } });
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-filter-clear]")!);
    expect(choices.at(-1)).toEqual({ diets: [], exclude: {} });
    expect(el.shadowRoot!.querySelector("[data-filter-count]")).toBeNull();
  });
});
