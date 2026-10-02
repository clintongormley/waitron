import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { CSSResult } from "lit";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import (not `import type`): pulls in the module for its `@customElement` side effect, which
// registers `dashboard-allergen-dietary-picker` so `mountWidget` can create it.
import { AllergenDietaryPicker, type AllergenDietaryValue } from "./allergen-dietary-picker.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { allergenName } from "../i18n/domain.js";

afterEach(cleanupWidgets);

/**
 * Drives the single allergen `wt-combobox` exactly as the real primitive does: set its `.values` and
 * dispatch its `wt-change` carrying `{ values }`.
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

function trackChanges(el: AllergenDietaryPicker): AllergenDietaryValue[] {
  const changes: AllergenDietaryValue[] = [];
  el.addEventListener("wt-change", (e) => changes.push((e as CustomEvent).detail.value));
  return changes;
}

function line(el: AllergenDietaryPicker, field: "allergens" | "dietary"): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(`[data-test="${field}-line"]`)!;
}

/** The element focus is on, followed into open shadow roots. */
function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

describe("allergen-dietary-picker", () => {
  it("shows each field as one line reading its name and its values, or None specified", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: ["milk", "eggs"], dietary: [] },
    });
    expect(line(el, "allergens").textContent!.replace(/\s+/g, " ").trim()).toBe(
      `${t("modifiers.allergens")}: ${[allergenName("milk"), allergenName("eggs")].join(", ")}`,
    );
    expect(line(el, "dietary").textContent!.replace(/\s+/g, " ").trim()).toBe(
      `${t("modifiers.dietary_preferences")}: ${t("modifiers.none_specified")}`,
    );
    expect(el.shadowRoot!.querySelector('[data-test="allergens-summary"]')!.textContent).toBe(
      [allergenName("milk"), allergenName("eggs")].join(", "),
    );
    expect(el.shadowRoot!.querySelector('[data-test="dietary-summary"]')!.textContent).toBe(
      t("modifiers.none_specified"),
    );
    expect(el.shadowRoot!.querySelectorAll("wt-combobox")).toHaveLength(0);
  });

  it("draws no box around a field and no Edit button", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: ["milk"], dietary: ["vegan"] },
    });
    for (const node of el.shadowRoot!.querySelectorAll("*")) {
      const style = getComputedStyle(node);
      for (const side of ["Top", "Right", "Bottom", "Left"] as const)
        expect(style[`border${side}Width`], `${node.tagName} border-${side}`).toBe("0px");
    }
    expect(el.shadowRoot!.querySelector("wt-button")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain(t("action.edit"));
  });

  it("names each line by its field, its values and the edit it offers", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: ["milk", "eggs"], dietary: [] },
    });
    expect(line(el, "allergens").tagName).toBe("BUTTON");
    expect(line(el, "allergens").type).toBe("button");
    expect(line(el, "allergens").getAttribute("aria-label")).toBe(
      t("modifiers.line_edit_name")
        .replace("{label}", t("modifiers.allergens"))
        .replace("{value}", [allergenName("milk"), allergenName("eggs")].join(", ")),
    );
    expect(line(el, "dietary").getAttribute("aria-label")).toBe(
      t("modifiers.line_edit_name")
        .replace("{label}", t("modifiers.dietary_preferences"))
        .replace("{value}", t("modifiers.none_specified")),
    );
  });

  it("reads the line's name and empty wording from the strings in English and Spanish", async () => {
    const original = currentLocale();
    try {
      setLocale("en");
      const { el: english } = await mountWidget<AllergenDietaryPicker>(
        "dashboard-allergen-dietary-picker",
        { value: { allergens: [], dietary: [] } },
      );
      expect(line(english, "dietary").getAttribute("aria-label")).toBe(
        "Dietary preferences: None specified, edit",
      );
      setLocale("es-ES");
      const { el: spanish } = await mountWidget<AllergenDietaryPicker>(
        "dashboard-allergen-dietary-picker",
        { value: { allergens: [], dietary: [] } },
      );
      expect(line(spanish, "dietary").getAttribute("aria-label")).toBe(
        "Preferencias dietéticas: Sin especificar, editar",
      );
      expect(spanish.shadowRoot!.querySelector('[data-test="dietary-summary"]')!.textContent).toBe(
        "Sin especificar",
      );
    } finally {
      setLocale(original);
    }
  });

  it("turns a clicked line into a focused multi-value combobox", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: ["milk"], dietary: ["vegan"] },
    });
    line(el, "allergens").click();
    await el.updateComplete;
    const allergens = el.shadowRoot!.querySelector<
      HTMLElement & {
        multiple: boolean;
        name: string;
        values: string[];
        countLabel: (count: number) => string;
      }
    >('[data-test="allergens"]')!;
    expect(line(el, "allergens")).toBeNull();
    expect(allergens.multiple).toBe(true);
    expect(allergens.name).toBe("allergens");
    expect(allergens.values).toEqual(["milk"]);
    expect(allergens.countLabel(2)).toBe(
      t("modifiers.allergens_selected_count").replace("{count}", "2"),
    );
    expect(el.shadowRoot!.activeElement).toBe(allergens);

    line(el, "dietary").click();
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

  it("opens the combobox when Enter is pressed on the focused line", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: [], dietary: ["vegan"] },
    });
    line(el, "dietary").focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector('[data-test="dietary"]')).not.toBeNull(),
    );
    expect(el.shadowRoot!.activeElement).toBe(
      el.shadowRoot!.querySelector('[data-test="dietary"]'),
    );
  });

  it.each(["allergens", "dietary"] as const)(
    "closes the %s combobox on Escape and puts focus back on its line",
    async (field) => {
      const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
        value: { allergens: ["milk"], dietary: [] },
      });
      line(el, field).focus();
      await userEvent.keyboard("{Enter}");
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector(`[data-test="${field}"]`)).not.toBeNull(),
      );
      await userEvent.keyboard("{Escape}");
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector(`[data-test="${field}"]`)).toBeNull(),
      );
      expect(deepActiveElement()).toBe(line(el, field));
    },
  );

  it("keeps the combobox open when Escape only closes its open list", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: ["milk"], dietary: [] },
    });
    line(el, "allergens").focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector('[data-test="allergens"]')).not.toBeNull(),
    );
    // Enter on the combobox's own button opens its list; the first Escape closes only the list.
    await userEvent.keyboard("{Enter}");
    const combobox = el.shadowRoot!.querySelector<HTMLElement>('[data-test="allergens"]')!;
    const panel = combobox.shadowRoot!.querySelector<HTMLElement>("#panel")!;
    await vi.waitFor(() => expect(panel.matches(":popover-open")).toBe(true));
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(panel.matches(":popover-open")).toBe(false));
    expect(el.shadowRoot!.querySelector('[data-test="allergens"]')).toBe(combobox);
  });

  it("emits the chosen allergens and re-dispatches only its own wt-change", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: [], dietary: [] },
    });
    const changes = trackChanges(el);
    line(el, "allergens").click();
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
    line(el, "dietary").click();
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

  it("returns to the line when an edited field loses focus", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      value: { allergens: [], dietary: ["vegan", "halal"] },
    });
    line(el, "dietary").click();
    await el.updateComplete;
    line(el, "allergens").focus();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector('[data-test="dietary"]')).toBeNull(),
    );
    expect(el.shadowRoot!.querySelector('[data-test="dietary-summary"]')!.textContent).toBe(
      [t("editor.diet.vegan"), t("editor.diet.halal")].join(", "),
    );
  });

  // Mirrors the scan in packages/ui/src/no-hardcoded-chrome.test.ts: up to 1px is allowed as a hairline.
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
  it("disables both lines and keeps them closed when clicked", async () => {
    const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
      busy: true,
      value: { allergens: ["milk"], dietary: [] },
    });
    expect(line(el, "allergens").disabled).toBe(true);
    expect(line(el, "dietary").disabled).toBe(true);
    line(el, "allergens").click();
    line(el, "dietary").click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[data-test="allergens"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-test="dietary"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-test="allergens-summary"]')!.textContent).toBe(
      allergenName("milk"),
    );
  });
});
