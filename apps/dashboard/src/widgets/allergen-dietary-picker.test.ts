import { afterEach, describe, expect, it } from "vitest";
import type { CSSResult } from "lit";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import (not `import type`): pulls in the module for its `@customElement` side effect, which
// registers `dashboard-allergen-dietary-picker` so `mountWidget` can create it.
import { AllergenDietaryPicker, type AllergenDietaryValue } from "./allergen-dietary-picker.js";

afterEach(cleanupWidgets);

/**
 * Drives one of the three inner `wt-combobox`es exactly as the real primitive does: set its
 * `.values` and dispatch its `wt-change` carrying `{ values }`. This mirrors wt-combobox's own
 * `dispatchWtChange(this, sourceEvent, { values: this.values })`, so the test exercises the same
 * seam the widget sees in the app rather than a private helper.
 */
async function pickInCombobox(
  el: AllergenDietaryPicker,
  which: "add-allergens" | "remove-allergens" | "dietary",
  values: string[],
): Promise<void> {
  const combobox = el.shadowRoot!.querySelector<HTMLElement & { values: string[] }>(
    `[data-test=${which}]`,
  )!;
  combobox.values = values;
  combobox.dispatchEvent(
    new CustomEvent("wt-change", { detail: { values }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

/** Collects every `value` payload the widget emits over the test's lifetime. */
function trackChanges(el: AllergenDietaryPicker): AllergenDietaryValue[] {
  const changes: AllergenDietaryValue[] = [];
  el.addEventListener("wt-change", (e) => changes.push((e as CustomEvent).detail.value));
  return changes;
}

describe("allergen-dietary-picker", () => {
  it("emits the three lists on change and keeps adds and removes disjoint", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { addAllergens: [], removeAllergens: ["gluten"], dietary: [] },
    });
    const changes = trackChanges(el);
    // Choosing gluten under "adds" must drop it from "removes" (they are mutually exclusive).
    await pickInCombobox(el, "add-allergens", ["gluten"]);
    expect(changes.at(-1)).toEqual({ addAllergens: ["gluten"], removeAllergens: [], dietary: [] });
  });

  it("drops an allergen from adds when the same code is chosen under removes", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { addAllergens: ["milk"], removeAllergens: [], dietary: [] },
    });
    const changes = trackChanges(el);
    await pickInCombobox(el, "remove-allergens", ["milk"]);
    expect(changes.at(-1)).toEqual({ addAllergens: [], removeAllergens: ["milk"], dietary: [] });
  });

  it("emits the dietary list without disturbing the allergen lists", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { addAllergens: ["milk"], removeAllergens: ["gluten"], dietary: [] },
    });
    const changes = trackChanges(el);
    await pickInCombobox(el, "dietary", ["vegan", "vegetarian"]);
    expect(changes.at(-1)).toEqual({
      addAllergens: ["milk"],
      removeAllergens: ["gluten"],
      dietary: ["vegan", "vegetarian"],
    });
  });

  it("emits empty lists when a selection is cleared", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { addAllergens: ["milk"], removeAllergens: [], dietary: ["vegan"] },
    });
    const changes = trackChanges(el);
    await pickInCombobox(el, "add-allergens", []);
    expect(changes.at(-1)).toEqual({ addAllergens: [], removeAllergens: [], dietary: ["vegan"] });
  });

  // Token-painting check. No dashboard widget scans its stylesheet yet, so this mirrors the proven
  // scan in packages/ui/src/no-hardcoded-chrome.test.ts: no hex, no functional/keyword colours, and
  // no px above the 1px hairline exception, no rem/em at all. baseStyles is already held to this same
  // guard inside packages/ui, so scanning the whole (baseStyles + local) sheet stays clean.
  it("renders every colour, spacing and font from a --wt-* token", () => {
    const list = AllergenDietaryPicker.styles as CSSResult[];
    const css = list.map((s) => s.cssText).join("\n");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i);
    expect(css).not.toMatch(
      /\b(red|blue|green|yellow|black|white|gray|grey|orange|purple|pink|brown)\b/i,
    );
    const numbersWithUnit = (unit: string): number[] =>
      [...css.matchAll(new RegExp(`(?<![\\w-])(-?\\d*\\.?\\d+)${unit}`, "g"))].map((m) =>
        Number(m[1]),
      );
    const pxOffenders = numbersWithUnit("px").filter((n) => Math.abs(n) > 1);
    const remEmOffenders = numbersWithUnit(String.raw`(?:rem|em)\b`);
    expect([...pxOffenders, ...remEmOffenders]).toEqual([]);
  });
});
