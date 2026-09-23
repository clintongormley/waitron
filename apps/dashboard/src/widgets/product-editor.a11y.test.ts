import { afterEach, describe, expect, it } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { ProductEditor } from "./product-editor.js";
import type { ProductEditorDraft } from "./product-editor-model.js";

// Scan the editor with the icons the app actually registers. Unregistered, wt-icon draws nothing,
// and a scan of blank chrome is not a scan of what an operator sees.
registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

// A staff name and a customer name that differ, so a scan of the populated editor shows both fields
// carrying real text rather than one string standing in for two.
const coffee: ProductEditorDraft = {
  name: "Coffee",
  customerName: { en: "House coffee", es: "Café de la casa" },
  description: null,
  kitchenName: "BAR",
  image: null,
  unitId: "each",
  unitPrice: "3.00",
  vatClass: "reduced",
  active: true,
  available: true,
  soldAlone: true,
  variants: [],
  allergens: { milk: { presence: "may_contain" } },
  dietaryDeclarations: ["vegan"],
  categoryIds: ["drinks"],
  primaryCategoryId: "drinks",
  modifiers: [],
  stationId: "bar",
  courseId: null,
};
// One list of each kind attached, so the scan covers the Modifiers table: its reorder handles, its
// row menus and the combobox that adds to it.
const withModifiers: ProductEditorDraft = {
  ...coffee,
  modifiers: [
    { kind: "extras", id: "sauces" },
    { kind: "options", id: "cooked" },
  ],
};
const extraLists = [{ id: "sauces", name: "Sauces" }];
const optionLists = [{ id: "cooked", name: "Cooked" }];
const variants: ProductEditorDraft = {
  ...coffee,
  variants: [
    {
      name: "Small",
      customerName: { en: "Small cup" },
      kitchenName: "SM",
      image: null,
      unitPrice: "2.00",
      available: true,
      active: true,
    },
    {
      name: "Large",
      customerName: { en: "Large cup" },
      kitchenName: "LG",
      image: null,
      unitPrice: "3.50",
      available: false,
      active: true,
    },
    {
      id: "medium",
      name: "Medium",
      customerName: { en: "Medium cup" },
      kitchenName: "MD",
      image: null,
      unitPrice: null,
      available: true,
      active: false,
    },
  ],
};
// A variant's own page with every inherited field left blank, so each one draws its hint.
const variantPage: ProductEditorDraft = {
  ...coffee,
  id: "glass",
  parentId: "coffee",
  inherited: {
    description: { en: "Roasted in house" },
    image: "coffee.png",
    unitPrice: "3.00",
    vatClass: "reduced",
    unitId: "each",
    categoryIds: ["drinks"],
    primaryCategoryId: "drinks",
    stationId: "bar",
    courseId: "starters",
    allergens: { milk: { presence: "contains" } },
    dietaryDeclarations: ["vegan"],
  },
  name: "Glass",
  customerName: { en: "A glass" },
  kitchenName: "GLS",
  unitId: null,
  unitPrice: null,
  vatClass: null,
  allergens: null,
  dietaryDeclarations: null,
  categoryIds: [],
  primaryCategoryId: null,
  stationId: null,
  courseId: null,
};

// axe does not score a placeholder's contrast, so a test of a hinted field measures its own ratio.
// The parser reads rgb()/rgba() only, which is why each colour is checked for that form first.
function contrastRatio(a: string, b: string): number {
  const luminance = (rgb: string) => {
    expect(rgb).toMatch(/^rgba?\(/);
    const [r, g, bl] = rgb
      .match(/\d+(\.\d+)?/g)!
      .slice(0, 3)
      .map((part) => Number(part) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

describe.each(["light", "dark"] as const)("product editor accessibility (%s)", (theme) => {
  it.each([
    "empty",
    "errors",
    "selected",
    "variants",
    "modifiers",
    "open-sections",
    "categories",
    "variant-window",
    "inactive",
    "variant-page",
  ])("renders %s", async (state) => {
    const { el, host } = await mountWidget<ProductEditor>(
      "dashboard-product-editor",
      {
        open: true,
        locales: ["en", "es"],
        units: [{ id: "each", name: { en: "Each" }, abbreviation: { en: "ea" } }],
        taxChoices: [{ id: "reduced", rate: "10.00", label: "Reduced" }],
        value:
          state === "empty" || state === "errors"
            ? null
            : state === "variants"
              ? variants
              : state === "modifiers"
                ? withModifiers
                : state === "inactive"
                  ? { ...coffee, active: false, available: false }
                  : state === "variant-page"
                    ? variantPage
                    : coffee,
        extraLists,
        optionLists,
        categories: [
          { id: "drinks", name: { en: "Drinks" }, image: null, color: "#3355aa", parentId: null },
          { id: "food", name: { en: "Food" }, image: null, color: null, parentId: null },
        ],
        stations: [{ id: "bar", name: "Bar" }],
        courses: [{ id: "starters", name: "Starters" }],
      },
      theme,
    );
    if (state === "errors") el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    if (state === "categories") {
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=pick-categories]")!.click();
      await el.updateComplete;
      // Without this the scan could pass on an editor whose modal never opened.
      expect(el.shadowRoot!.querySelector("dashboard-category-membership-picker")).not.toBeNull();
    }
    if (state === "inactive") {
      // Without this the scan could pass on an editor that never drew the notice and Restore.
      expect(el.shadowRoot!.querySelector("[data-test=restore]")).not.toBeNull();
      expect(el.shadowRoot!.querySelector("[data-test=inactive-notice]")).not.toBeNull();
    }
    if (state === "modifiers") {
      // Without this the scan could pass on an editor whose Modifiers table never rendered a row.
      expect(el.shadowRoot!.querySelectorAll("[data-test=attached-modifier]")).toHaveLength(2);
    }
    if (state === "variant-window") {
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")!.click();
      await el.updateComplete;
      const form = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
        "dashboard-variant-form",
      )!;
      expect(form.open).toBe(true);
    }
    if (state === "variants") {
      // Every status at once, so the scan covers an Inactive row and a row priced by its hint.
      const table = el.shadowRoot!.querySelector("dashboard-variant-table")!;
      await table.updateComplete;
      const filter = table.shadowRoot!.querySelector<HTMLSelectElement>("[name=variant-status]")!;
      filter.value = "all";
      filter.dispatchEvent(new Event("change"));
      await table.updateComplete;
      expect(table.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(3);
    }
    if (state === "open-sections" || state === "variant-page") {
      for (const name of ["kitchen", "descriptors", "nutrition"]) {
        const disclosure = el.shadowRoot!.querySelector<
          HTMLElement & { open: boolean; updateComplete: Promise<unknown> }
        >(`[data-section="${name}"]`)!;
        await disclosure.updateComplete;
        disclosure.shadowRoot!.querySelector<HTMLElement>("button.header")!.click();
        await disclosure.updateComplete;
        expect(disclosure.open, name).toBe(true);
      }
    }
    await el.updateComplete;
    if (state === "variant-page") {
      // Without these the scan could pass on a page that drew none of its hints.
      for (const name of ["categories-hint", "allergens-hint", "dietary-hint"])
        expect(el.shadowRoot!.querySelector(`[data-test=${name}]`), name).not.toBeNull();
      const description =
        el.shadowRoot!.querySelector<HTMLTextAreaElement>("[name=description-en]")!;
      expect(description.placeholder).toBe("Roasted in house");
      expect(
        contrastRatio(
          getComputedStyle(description, "::placeholder").color,
          getComputedStyle(description).backgroundColor,
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
    await expectNoA11yViolations(host);
  });
});
