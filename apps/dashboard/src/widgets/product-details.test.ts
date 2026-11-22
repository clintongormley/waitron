import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { registerIcons, setContentLanguages } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { userEvent } from "vitest/browser";
import type { ProductEditorValue } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import "./product-details.js";
import type { ProductDetails } from "./product-details.js";

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
  takeawayVatRate: "10.00",
  active: false,
  available: true,
  ordering: "public",
  primaryCategoryId: "drinks",
  color: null,
  allergens: { milk: {} },
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

async function mount(overrides: Partial<ProductEditorValue> = {}, takeawayVat = false) {
  setLocale("en");
  return mountWidget<
    HTMLElement & {
      open: boolean;
      value: ProductEditorValue;
      takeawayVat: boolean;
      updateComplete: Promise<unknown>;
    }
  >("dashboard-product-details", {
    open: true,
    value: { ...value, ...overrides },
    takeawayVat,
    ...{
      categories: [{ id: "drinks", name: "Drinks staff", parentId: null, color: null }],
      units: [
        {
          id: "cup",
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "Cup", es: "Taza" },
          abbreviation: { en: "c" },
        },
      ],
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
      "Contains",
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
    expect(pairs["Prep station name"]).toBe("BAR COFFEE");
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

  it("shows a unit name holding a placeholder or a replacement pattern as it is", async () => {
    const { el } = await mount();
    Object.assign(el, {
      units: [
        {
          id: "cup",
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "{from} $& $1", es: "Taza" },
          abbreviation: { en: "c" },
        },
      ],
    });
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain("€3.00 / {from} $& $1");
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
        takeawayVatRate: "21.00",
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

  const vatPairs = (el: HTMLElement) =>
    [...el.shadowRoot!.querySelectorAll("dl > div")]
      .map((field) => [
        field.querySelector("dt")!.textContent,
        field.querySelector("dd")!.textContent!.trim(),
      ])
      .filter(([label]) => label!.startsWith("VAT"));

  it("shows the rate charged taken away, as a percentage, beside the served class where the region charges it", async () => {
    const { el } = await mount({ takeawayVatRate: "21.00" }, true);
    expect(vatPairs(el)).toEqual([
      ["VAT", "Reduced"],
      ["VAT when taken away", "21%"],
    ]);
  });

  it.each([
    ["its own rate", "7.50", "7.5%"],
    ["its product's rate when it has none", null, "4%"],
  ] as const)("shows a variant's takeaway rate as %s", async (_case, takeawayVatRate, shown) => {
    const { el } = await mount(
      {
        parentId: "parent",
        unitId: null,
        unitPrice: null,
        vatClass: "super_reduced",
        takeawayVatRate,
        primaryCategoryId: null,
        inherited: {
          name: "Parent staff",
          unitPrice: "2.00",
          unitId: "cup",
          vatClass: "general",
          takeawayVatRate: "4.00",
          primaryCategoryId: "drinks",
          description: null,
          image: null,
          courseId: null,
          allergens: null,
          dietaryDeclarations: [],
        },
        variants: [],
      },
      true,
    );
    expect(vatPairs(el)).toEqual([
      ["VAT", "Super-reduced"],
      ["VAT when taken away", shown],
    ]);
  });

  it("shows no takeaway rate where the region does not charge one", async () => {
    const { el } = await mount({ takeawayVatRate: "21.00" });
    expect(vatPairs(el)).toEqual([["VAT", "Reduced"]]);
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
      await closeReportsDelivered();
      expect(closed).toHaveBeenCalledOnce();
    },
  );
});

it("names every cereal and nut kind on archived product details", async () => {
  const { el } = await mount({
    allergens: { gluten: { kinds: ["wheat", "barley"] }, nuts: { kinds: ["walnuts"] } },
  });
  expect(el.shadowRoot!.textContent).toContain("Cereals containing gluten (Wheat, Barley)");
  expect(el.shadowRoot!.textContent).toContain("Nuts (Walnuts)");
});

it("shows the independent staff unit name on archived product details when translations are empty", async () => {
  const { el } = await mountWidget<ProductDetails>("dashboard-product-details", {
    open: true,
    value,
    units: [
      { id: "cup", staffName: "Staff cup", staffAbbreviation: "sc", name: {}, abbreviation: {} },
    ],
  });
  expect(el.shadowRoot!.textContent).toContain("Staff cup");
});

it("refreshes unit names on an open product detail after the content default changes", async () => {
  const before = currentLocale();
  setLocale("fr-FR");
  try {
    setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
    const { el } = await mountWidget<ProductDetails>("dashboard-product-details", {
      open: true,
      value,
      units: [
        {
          id: "cup",
          staffName: "Staff cup",
          staffAbbreviation: "sc",
          name: { en: "English cup", es: "Spanish cup" },
          abbreviation: { en: "ec", es: "se" },
        },
      ],
    });
    expect(el.shadowRoot!.textContent).toContain("English cup");
    setContentLanguages({ defaultLanguage: "es", languages: ["en", "es"] });
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Spanish cup"));
  } finally {
    setLocale(before);
  }
});
