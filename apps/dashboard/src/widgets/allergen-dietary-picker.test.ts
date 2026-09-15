import { afterEach, describe, expect, it } from "vitest";
import type { CSSResult } from "lit";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import (not `import type`): pulls in the module for its `@customElement` side effect, which
// registers `dashboard-allergen-dietary-picker` so `mountWidget` can create it.
import { AllergenDietaryPicker, type AllergenDietaryValue } from "./allergen-dietary-picker.js";

afterEach(cleanupWidgets);

/**
 * Drives the single allergen `wt-combobox` exactly as the real primitive does: set its `.values` and
 * dispatch its `wt-change` carrying `{ values }`. This mirrors wt-combobox's own
 * `dispatchWtChange(this, sourceEvent, { values: this.values })`, so the test exercises the same seam
 * the widget sees in the app rather than a private helper.
 */
async function pickAllergens(el: AllergenDietaryPicker, values: string[]): Promise<void> {
  const combobox = el.shadowRoot!.querySelector<HTMLElement & { values: string[] }>(
    '[data-test="allergens"]',
  )!;
  combobox.values = values;
  combobox.dispatchEvent(
    new CustomEvent("wt-change", { detail: { values }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

/** Toggles one dietary checkbox by its label value, firing the native `change` the widget listens for. */
async function toggleDiet(
  el: AllergenDietaryPicker,
  label: string,
  checked: boolean,
): Promise<void> {
  const box = el.shadowRoot!.querySelector<HTMLInputElement>(
    `[data-test="dietary"] input[value="${label}"]`,
  )!;
  box.checked = checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
}

/** Collects every `value` payload the widget emits over the test's lifetime. */
function trackChanges(el: AllergenDietaryPicker): AllergenDietaryValue[] {
  const changes: AllergenDietaryValue[] = [];
  el.addEventListener("wt-change", (e) => changes.push((e as CustomEvent).detail.value));
  return changes;
}

describe("allergen-dietary-picker", () => {
  it("renders one allergen list and four dietary checkboxes, no remove-allergens control", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {});
    expect(el.shadowRoot!.querySelector('[data-test="remove-allergens"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-test="add-allergens"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-test="allergens"]')).not.toBeNull();
    expect(
      el.shadowRoot!.querySelectorAll('[data-test="dietary"] input[type="checkbox"]').length,
    ).toBe(4);
  });

  it("gives each dietary checkbox a semantic name and a visible label", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {});
    const boxes = [
      ...el.shadowRoot!.querySelectorAll<HTMLInputElement>(
        '[data-test="dietary"] input[type="checkbox"]',
      ),
    ];
    expect(boxes.map((b) => b.name)).toEqual([
      "diet-vegan",
      "diet-vegetarian",
      "diet-halal",
      "diet-kosher",
    ]);
    // Each checkbox is wrapped by a label whose text is its accessible name.
    for (const box of boxes) expect(box.closest("label")?.textContent?.trim()).toBeTruthy();
  });

  it("emits the chosen allergens and re-dispatches only its own wt-change", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: [], dietary: [] },
    });
    const changes = trackChanges(el);
    await pickAllergens(el, ["gluten", "milk"]);
    // Exactly one event: the inner combobox's own wt-change is stopped, so the consumer never sees two.
    expect(changes).toHaveLength(1);
    expect(changes.at(-1)).toEqual({ allergens: ["gluten", "milk"], dietary: [] });
  });

  it("adds a dietary label in canonical order without disturbing the allergens", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: ["milk"], dietary: ["vegetarian"] },
    });
    const changes = trackChanges(el);
    await toggleDiet(el, "vegan", true);
    // vegan precedes vegetarian in DIETARY_SUITABILITY, so the emitted list keeps that fixed order.
    expect(changes.at(-1)).toEqual({ allergens: ["milk"], dietary: ["vegan", "vegetarian"] });
  });

  it("removes a dietary label when its checkbox is unchecked", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: [], dietary: ["vegan", "halal"] },
    });
    const changes = trackChanges(el);
    await toggleDiet(el, "vegan", false);
    expect(changes.at(-1)).toEqual({ allergens: [], dietary: ["halal"] });
  });

  it("checks the boxes that match the current dietary value", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: [], dietary: ["halal", "kosher"] },
    });
    const checked = [
      ...el.shadowRoot!.querySelectorAll<HTMLInputElement>('[data-test="dietary"] input:checked'),
    ].map((i) => i.value);
    expect(checked).toEqual(["halal", "kosher"]);
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
