import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { userEvent } from "vitest/browser";
import type { ProductEditorValue } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./product-details.js";

registerIcons(DASHBOARD_ICONS);
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

const value: ProductEditorValue = {
  id: "coffee",
  parentId: null,
  inherited: null,
  name: "Staff coffee",
  customerName: { en: "House coffee", es: "Café de la casa" },
  kitchenName: "BAR COFFEE",
  description: null,
  image: null,
  unitId: "cup",
  unitPrice: "3.00",
  vatClass: "reduced",
  active: false,
  available: true,
  ordering: "public",
  primaryCategoryId: "drinks",
  color: null,
  allergens: { milk: { presence: "may_contain" } },
  dietaryDeclarations: [],
  courseId: null,
  modifiers: [
    { kind: "extras", id: "same" },
    { kind: "options", id: "same" },
  ],
  variants: [
    {
      id: "large",
      name: "Large staff",
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: "4.00",
      active: false,
      available: true,
    },
  ],
};

async function mount(overrides: Partial<ProductEditorValue> = {}) {
  setLocale("en");
  return mountWidget<
    HTMLElement & { open: boolean; value: ProductEditorValue; updateComplete: Promise<unknown> }
  >("dashboard-product-details", {
    open: true,
    value: { ...value, ...overrides },
    ...{
      categories: [{ id: "drinks", name: "Drinks staff", parentId: null, color: null }],
      units: [{ id: "cup", name: { en: "Cup", es: "Taza" }, abbreviation: { en: "c" } }],
      extraLists: [{ id: "same", name: "Sauces staff" }],
      optionLists: [{ id: "same", name: "Cooked staff" }],
    },
  });
}

describe("archived product details", () => {
  it("shows distinct names and the archived record as labelled plain text, including custom units and each variant's status", async () => {
    const { el } = await mount();
    const modal = el.shadowRoot?.querySelector("wt-modal");
    expect(modal?.heading).toBe("Staff coffee");
    const root = el.shadowRoot!;
    expect(root.querySelector("dl")).not.toBeNull();
    const text = root.textContent!;
    for (const expected of [
      "This product is archived",
      "House coffee",
      "Café de la casa",
      "BAR COFFEE",
      "€3.00",
      "Cup",
      "Reduced",
      "Drinks staff",
      "Large staff",
      "€4.00",
      "Archived",
      "Milk",
      "May contain",
      "Sauces staff",
      "Cooked staff",
    ])
      expect(text).toContain(expected);
    expect(
      root.querySelectorAll(
        "input, select, textarea, wt-input, wt-switch, wt-combobox, wt-price-input",
      ),
    ).toHaveLength(0);
    expect(
      [...root.querySelectorAll("wt-button")].some((button) =>
        button.textContent?.includes("Save"),
      ),
    ).toBe(false);
    const pairs = Object.fromEntries(
      [...root.querySelectorAll("dl > div")].map((field) => [
        field.querySelector("dt")!.textContent,
        field.querySelector("dd")!.textContent!.trim(),
      ]),
    );
    expect(pairs["Customer-facing name (en)"]).toBe("House coffee");
    expect(pairs["Customer-facing name (es)"]).toBe("Café de la casa");
    expect(pairs["Kitchen name"]).toBe("BAR COFFEE");
    expect(pairs["Options"]).toBe("Cooked staff");
    expect(pairs["Extras"]).toBe("Sauces staff");
    expect(root.querySelector(".variant wt-lozenge")?.textContent).toBe("Archived");
  });

  it("omits missing optional values and describes Each without a stored unit", async () => {
    const { el } = await mount({
      customerName: null,
      kitchenName: null,
      unitId: null,
      primaryCategoryId: null,
      variants: [],
      modifiers: [],
      allergens: null,
    });
    const root = el.shadowRoot;
    expect(root?.querySelector("dl")).toBeTruthy();
    const labels = [...root!.querySelectorAll("dt")].map((node) => node.textContent);
    expect(labels).toEqual(["Price", "VAT"]);
    expect(root!.textContent).toContain("€3.00 each");
    expect([...root!.querySelectorAll("dd")].every((node) => node.textContent!.trim())).toBe(true);
  });

  it("shows a variant's inherited price, unit, VAT and category without substituting its parent's name", async () => {
    const { el } = await mount({
      name: "Small staff",
      parentId: "parent",
      unitId: null,
      unitPrice: null,
      vatClass: null,
      primaryCategoryId: null,
      inherited: {
        name: "Parent staff",
        unitPrice: "2.00",
        unitId: "cup",
        vatClass: "general",
        primaryCategoryId: "drinks",
        description: null,
        image: null,
        courseId: null,
        allergens: null,
        dietaryDeclarations: [],
      },
      variants: [],
    });
    expect(el.shadowRoot?.querySelector("wt-modal")?.heading).toBe("Small staff");
    expect(el.shadowRoot?.textContent).toContain("€2.00");
    expect(el.shadowRoot?.textContent).toContain("Cup");
    expect(el.shadowRoot?.textContent).toContain("General");
    expect(el.shadowRoot?.textContent).toContain("Drinks staff");
  });

  it.each(["close", "modal-close", "escape"])(
    "%s closes once with a bubbling, composed wt-close",
    async (action) => {
      const opener = document.createElement("button");
      opener.textContent = "View";
      document.body.appendChild(opener);
      onTestFinished(() => opener.remove());
      opener.focus();
      const { el, host } = await mount();
      const closed = vi.fn();
      host.addEventListener("wt-close", closed);
      const modal = el.shadowRoot?.querySelector("wt-modal");
      expect(modal).toBeTruthy();
      await modal!.updateComplete;
      if (action === "escape") await userEvent.keyboard("{Escape}");
      else el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`)!.click();
      await expect.poll(() => closed.mock.calls.length).toBe(1);
      expect((closed.mock.calls[0]![0] as Event).composed).toBe(true);
      expect(el.open).toBe(false);
      await expect.poll(() => document.activeElement).toBe(opener);
    },
  );
});
