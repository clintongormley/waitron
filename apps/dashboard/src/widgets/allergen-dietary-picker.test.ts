import { afterEach, describe, expect, it, vi } from "vitest";
import type { CSSResult } from "lit";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import (not `import type`): pulls in the module for its `@customElement` side effect, which
// registers `dashboard-allergen-dietary-picker` so `mountWidget` can create it.
import { AllergenDietaryPicker, type AllergenDietaryValue } from "./allergen-dietary-picker.js";
import { t } from "../i18n/t.js";
import { allergenName } from "../i18n/domain.js";

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

/** Collects every `value` payload the widget emits over the test's lifetime. */
function trackChanges(el: AllergenDietaryPicker): AllergenDietaryValue[] {
  const changes: AllergenDietaryValue[] = [];
  el.addEventListener("wt-change", (e) => changes.push((e as CustomEvent).detail.value));
  return changes;
}

describe("allergen-dietary-picker", () => {
  it("shows comma-separated summaries and a None selected fallback", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: ["milk", "eggs"], dietary: [] },
    });
    expect(el.shadowRoot!.querySelector('[data-test="allergens-summary"]')!.textContent).toBe(
      [allergenName("milk"), allergenName("eggs")].join(", "),
    );
    expect(el.shadowRoot!.querySelector('[data-test="dietary-summary"]')!.textContent).toBe(
      t("modifiers.none_selected"),
    );
    const allergenGroup = el
      .shadowRoot!.querySelector('[data-test="allergens-summary"]')!
      .closest('[role="group"]');
    const dietaryGroup = el
      .shadowRoot!.querySelector('[data-test="dietary-summary"]')!
      .closest('[role="group"]');
    expect(allergenGroup?.getAttribute("aria-labelledby")).toBe("allergens-label");
    expect(allergenGroup?.querySelector("#allergens-label")?.textContent).toBe(
      t("modifiers.allergens"),
    );
    expect(dietaryGroup?.getAttribute("aria-labelledby")).toBe("dietary-label");
    expect(dietaryGroup?.querySelector("#dietary-label")?.textContent).toBe(
      t("modifiers.dietary_preferences"),
    );
    expect(el.shadowRoot!.querySelectorAll("wt-combobox")).toHaveLength(0);
  });

  it("turns each summary into a semantic multi-value combobox when Edit is clicked", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: ["milk"], dietary: ["vegan"] },
    });
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-allergens"]')!.click();
    await el.updateComplete;
    const allergens = el.shadowRoot!.querySelector<
      HTMLElement & {
        multiple: boolean;
        name: string;
        values: string[];
        countLabel: (count: number) => string;
      }
    >('[data-test="allergens"]')!;
    expect(allergens.multiple).toBe(true);
    expect(allergens.name).toBe("allergens");
    expect(allergens.values).toEqual(["milk"]);
    expect(allergens.countLabel(2)).toBe(
      t("modifiers.allergens_selected_count").replace("{count}", "2"),
    );

    el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-dietary"]')!.click();
    await el.updateComplete;
    const dietary = el.shadowRoot!.querySelector<
      HTMLElement & {
        multiple: boolean;
        name: string;
        values: string[];
        countLabel: (count: number) => string;
      }
    >('[data-test="dietary"]')!;
    expect(dietary.multiple).toBe(true);
    expect(dietary.name).toBe("dietary-preferences");
    expect(dietary.values).toEqual(["vegan"]);
    expect(dietary.countLabel(2)).toBe(
      t("modifiers.dietary_selected_count").replace("{count}", "2"),
    );
  });

  it("emits the chosen allergens and re-dispatches only its own wt-change", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: [], dietary: [] },
    });
    const changes = trackChanges(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-allergens"]')!.click();
    await el.updateComplete;
    await pickAllergens(el, ["gluten", "milk"]);
    // Exactly one event: the inner combobox's own wt-change is stopped, so the consumer never sees two.
    expect(changes).toHaveLength(1);
    expect(changes.at(-1)).toEqual({ allergens: ["gluten", "milk"], dietary: [] });
  });

  it("edits dietary preferences through a multi-value combobox in canonical order", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: ["milk"], dietary: ["vegetarian"] },
    });
    const changes = trackChanges(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-dietary"]')!.click();
    await el.updateComplete;
    const dietary = el.shadowRoot!.querySelector<HTMLElement & { values: string[] }>(
      '[data-test="dietary"]',
    )!;
    dietary.values = ["vegetarian", "vegan"];
    dietary.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { values: dietary.values },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    // vegan precedes vegetarian in DIETARY_SUITABILITY, so the emitted list keeps that fixed order.
    expect(changes.at(-1)).toEqual({ allergens: ["milk"], dietary: ["vegan", "vegetarian"] });
  });

  it("returns to the comma-separated summary when an edited field loses focus", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: [], dietary: ["vegan", "halal"] },
    });
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-dietary"]')!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-allergens"]')!.focus();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector('[data-test="dietary"]')).toBeNull(),
    );
    expect(el.shadowRoot!.querySelector('[data-test="dietary-summary"]')!.textContent).toBe(
      [t("editor.diet.vegan"), t("editor.diet.halal")].join(", "),
    );
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

describe("allergen-dietary-picker while busy", () => {
  it("keeps both summaries closed when Edit is clicked", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      busy: true,
      value: { allergens: ["milk"], dietary: [] },
    });
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-allergens"]')!.click();
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-dietary"]')!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[data-test="allergens"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-test="dietary"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-test="allergens-summary"]')!.textContent).toBe(
      allergenName("milk"),
    );
  });
});
