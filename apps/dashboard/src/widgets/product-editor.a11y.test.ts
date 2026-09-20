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
    },
    {
      name: "Large",
      customerName: { en: "Large cup" },
      kitchenName: "LG",
      image: null,
      unitPrice: "3.50",
      available: false,
    },
  ],
};

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
    if (state === "open-sections") {
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
    await expectNoA11yViolations(host);
  });
});
