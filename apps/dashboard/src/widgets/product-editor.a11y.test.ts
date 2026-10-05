import { afterEach, describe, expect, it, vi } from "vitest";
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
  ordering: "public",
  variants: [],
  allergens: { milk: { presence: "may_contain" } },
  dietaryDeclarations: ["vegan"],
  primaryCategoryId: "drinks",
  color: null,
  modifiers: [],
  courseId: null,
};
// One list of each kind attached, so the scan covers the Modifiers table's attached rows.
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
    primaryCategoryId: "drinks",
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
  primaryCategoryId: null,
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
    "category-tree",
    "variant-window",
    "inactive",
    "variant-page",
    "ordering",
    "ordering-refused",
    "photo",
    "photo-none",
    "photo-inherited",
    "photo-refused",
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
                    : state === "categories" || state === "category-tree"
                      ? { ...coffee, primaryCategoryId: "wine" }
                      : state === "ordering"
                        ? { ...coffee, ordering: "staff_only" }
                        : state === "photo"
                          ? { ...coffee, image: "coffee.png" }
                          : state === "photo-inherited"
                            ? variantPage
                            : coffee,
        extraLists,
        optionLists,
        categories: [
          { id: "drinks", name: "Drinks", parentId: null },
          { id: "food", name: "Food", parentId: null },
          { id: "wine", name: "Wine", parentId: "drinks" },
        ],
        courses: [{ id: "starters", name: "Starters" }],
        fieldErrors:
          state === "ordering-refused"
            ? { ordering: "The server rejected this value." }
            : state === "photo-refused"
              ? { image: "The photo is gone." }
              : {},
        ...(state.startsWith("photo")
          ? { api: { imageLibraryRequest: vi.fn().mockResolvedValue({}) } as never }
          : {}),
      },
      theme,
    );
    if (state === "ordering" || state === "ordering-refused") {
      // Without these the scan could pass on an editor that drew no choices, no help and no refusal.
      const field = el.shadowRoot!.querySelector<
        HTMLElement & { value: string; error: string; updateComplete: Promise<unknown> }
      >("wt-combobox[name=ordering]")!;
      expect(field.value).toBe(state === "ordering" ? "staff_only" : "public");
      if (state === "ordering-refused") expect(field.error).not.toBe("");
      await field.updateComplete;
      if (state === "ordering") {
        // Open, so the scan reads each choice with its explanation as the operator sees them.
        field.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
        await field.updateComplete;
        const lines = [...field.shadowRoot!.querySelectorAll<HTMLElement>(".option-description")];
        expect(lines.map((line) => line.checkVisibility())).toEqual([true, true, true]);
      }
    }
    if (state.startsWith("photo")) {
      // Without these the scan could pass on an editor that drew no photo beside Name.
      const upload = el.shadowRoot!.querySelector("[data-section=name] dashboard-image-upload")!;
      await (upload as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
      expect(upload.shadowRoot!.querySelector("button[data-test=choose-image]")).not.toBeNull();
      if (state === "photo-inherited")
        expect(upload.shadowRoot!.querySelector("[data-test=inherited-caption]")).not.toBeNull();
      if (state === "photo-refused")
        expect(el.shadowRoot!.querySelector("[data-test=image-error]")).not.toBeNull();
    }
    if (state === "errors") el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    if (state === "categories" || state === "category-tree") {
      // Without this the scan could pass on an editor that drew no chosen category.
      const field = el.shadowRoot!.querySelector<
        HTMLElement & { value: string; updateComplete: Promise<unknown> }
      >('wt-combobox[name="primary"]')!;
      expect(field.value).toBe("wine");
      await field.updateComplete;
      if (state === "category-tree") {
        // Open, so the scan reads the tree's rows, an indented one among them.
        field.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
        await field.updateComplete;
        const rows = [...field.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')];
        expect(rows.map((row) => row.checkVisibility())).toEqual([true, true, true, true]);
      }
    }
    if (state === "variant-page") {
      // Without these the scan could pass on a variant's page that drew no category path, or a
      // unit button where its product's unit is fixed text.
      expect(el.shadowRoot!.querySelector("[data-test=category-path]")!.textContent).toContain(
        "Drinks",
      );
      const price = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-price-input"]>(
        "wt-price-input[name=unit-price]",
      )!;
      await price.updateComplete;
      expect(price.shadowRoot!.querySelector("span.unit")).not.toBeNull();
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
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=show-inactive]")!.click();
      await el.updateComplete;
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
      for (const name of ["allergens-hint", "dietary-hint"])
        expect(el.shadowRoot!.querySelector(`[data-test=${name}]`), name).not.toBeNull();
      const area = el.shadowRoot!.querySelector<HTMLElement & { placeholder: string }>(
        "wt-textarea[name=description-en]",
      )!;
      expect(area.placeholder).toBe("Roasted in house");
      // The text box itself is see-through; the filled field box behind it is what it is read on.
      expect(
        contrastRatio(
          getComputedStyle(area.shadowRoot!.querySelector("textarea")!, "::placeholder").color,
          getComputedStyle(area.shadowRoot!.querySelector(".field")!).backgroundColor,
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)(
  "product editor's unit chooser accessibility (%s)",
  (theme) => {
    it.each(["open", "refused"])("renders the chooser %s", async (state) => {
      const { el, host } = await mountWidget<ProductEditor>(
        "dashboard-product-editor",
        {
          open: true,
          locales: ["en", "es"],
          units: [{ id: "each", name: { en: "Each" }, abbreviation: { en: "ea" } }],
          taxChoices: [{ id: "reduced", rate: "10.00", label: "Reduced" }],
          value: coffee,
          fieldErrors: state === "refused" ? { unit: "The server rejected this value." } : {},
        },
        theme,
      );
      if (state === "open")
        el.shadowRoot!.querySelector("[name=unit-price]")!.dispatchEvent(
          new CustomEvent("wt-unit-click", { detail: {}, bubbles: true, composed: true }),
        );
      await el.updateComplete;
      // Without these the scan could pass on an editor that never opened the chooser or drew its error.
      const dialog = el.shadowRoot!.querySelector<
        HTMLElement & { open: boolean; updateComplete: Promise<unknown> }
      >("wt-dialog[data-test=unit-chooser]")!;
      await dialog.updateComplete;
      expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
      const field = el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
        "wt-combobox[name=unit]",
      )!;
      expect(field.error).toBe(state === "refused" ? "The server rejected this value." : "");
      await expectNoA11yViolations(host);
    });
  },
);
