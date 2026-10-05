import { combinedFixture } from "./test-helpers.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CategorySummary, SectionDetails, MenuPriceRow, Product } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import type { MenuPricesTable } from "./menu-prices-table.js";
import "./menu-prices-table.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";

afterEach(cleanupWidgets);
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

const sections: SectionDetails[] = [
  { id: "s-drinks", internalName: "Drinks", names: {}, image: null, color: null, members: [] },
  { id: "s-beer", internalName: "Beer", names: {}, image: null, color: null, members: [] },
];
const categories: CategorySummary[] = [{ id: "c-drinks", name: "Bebidas", parentId: null }];
const lemonade = {
  id: "p-lemonade",
  name: "Lemonade",
  variants: [
    { id: "v-small", name: "Small", unitPrice: null },
    { id: "v-large", name: "Large", unitPrice: "3.40" },
  ],
} as unknown as Product;

const rows: MenuPriceRow[] = [
  {
    menuItemId: "mi-burger",
    combined: combinedFixture("p-burger", "12.00", [], null, "12.00", {}),
    productId: "p-burger",
    name: "Burger",
    categoryId: null,
    placements: [[]],
    override: null,
    effectivePrice: "12.00",
    active: true,
    variants: [],
  },
  {
    menuItemId: "mi-lemonade",
    combined: combinedFixture(
      "p-lemonade",
      "2.50",
      [
        { variantId: "v-small", price: null },
        { variantId: "v-large", price: "3.75" },
      ],
      "2.50",
      "3.00",
      { "v-large": "3.40" },
    ),
    productId: "p-lemonade",
    name: "Lemonade",
    categoryId: "c-drinks",
    placements: [["s-drinks"], ["s-drinks", "s-beer"]],
    override: "2.50",
    effectivePrice: "2.50",
    active: true,
    variants: [
      { variantId: "v-small", price: null, active: true },
      { variantId: "v-large", price: "3.75", active: true },
    ],
  },
];

const clash = {
  state: "clash",
  candidates: [
    { place: { kind: "own_sections" }, value: "12.00", source: { kind: "product" } },
    {
      place: { kind: "menu", menuId: "drinks", menuName: "Drinks" },
      value: "14.00",
      source: { kind: "menu", menuId: "drinks", menuName: "Drinks", from: { kind: "own" } },
    },
  ],
} as unknown as MenuPriceRow["combined"]["price"];

async function mount(theme: "light" | "dark", props: Partial<MenuPricesTable>) {
  return mountWidget<MenuPricesTable>(
    "dashboard-menu-prices-table",
    { rows, sections, categories, products: [lemonade], menuName: "Lunch Menu", ...props },
    theme,
  );
}

describe.each(["light", "dark"] as const)("menu prices (%s)", (theme) => {
  it.each<[string, Partial<MenuPricesTable>]>([
    ["populated", {}],
    ["empty", { rows: [] }],
    ["loading", { rows: [], loading: true }],
    ["failed", { rows: [], failed: true }],
  ])("accessible table, %s", async (_state, props) => {
    const { host } = await mount(theme, props);
    await expectNoA11yViolations(host);
  });

  it("accessible table with a product's sizes open, an Inactive row and a clash", async () => {
    const { el, host } = await mount(theme, {
      rows: [
        { ...rows[0]!, combined: { ...rows[0]!.combined, price: clash } },
        { ...rows[1]!, active: false },
      ],
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = table.shadowRoot!;
    root
      .querySelector<HTMLButtonElement>('tr[data-row-key="mi-lemonade"] button.tree-toggle')!
      .click();
    await table.updateComplete;
    const keys = ["mi-burger", "mi-lemonade", "mi-lemonade:v-small", "mi-lemonade:v-large"];
    for (const key of keys) {
      const tr = root.querySelector(`tr[data-row-key="${key}"]`)!;
      expect(tr.querySelector("a[part~=status-link]"), key).not.toBeNull();
      expect(tr.querySelector('wt-price-input[name="price-override"]'), key).not.toBeNull();
    }
    expect(root.querySelector('tr[data-row-key="mi-burger"] [part~="clash"]')).not.toBeNull();
    // An Active size of an Inactive product says why it reads Inactive, muted.
    expect(
      root.querySelector('tr[data-row-key="mi-lemonade:v-small"] [part~="status-note"]'),
    ).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("accessible fields, one refused and one saving", async () => {
    const { el, host } = await mount(theme, {
      refusals: { "mi-lemonade": "Refused" },
      saving: new Set(["mi-burger"]),
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = table.shadowRoot!;
    root
      .querySelector<HTMLButtonElement>('tr[data-row-key="mi-lemonade"] button.tree-toggle')!
      .click();
    await table.updateComplete;
    const field = (key: string) =>
      root.querySelector<HTMLElementTagNameMap["wt-price-input"]>(
        `wt-price-input[data-row="${key}"]`,
      )!;
    expect(field("mi-lemonade").error).toBe("Refused");
    expect(root.querySelector('tr[data-row-key="mi-burger"] [part~="saving"]')).not.toBeNull();
    expect(field("mi-lemonade:v-small")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("accessible saved outcome with its Undo", async () => {
    const { el, host } = await mount(theme, {
      outcome: {
        kind: "saved",
        save: {
          key: "mi-burger",
          menuItemId: "mi-burger",
          variantId: null,
          name: "Burger",
          price: "11.00",
          previous: null,
        },
      },
    });
    expect(el.shadowRoot!.querySelector('[data-test="price-outcome"]')!.textContent).toBe(
      t("menu_prices.saved").replace("{name}", "Burger").replace("{price}", "11,00\u00a0€"),
    );
    expect(el.shadowRoot!.querySelector('[data-test="price-undo"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("accessible field refusing a malformed price", async () => {
    const { el, host } = await mount(theme, {});
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const field = table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-price-input"]>(
      'wt-price-input[data-row="mi-lemonade"]',
    )!;
    field.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "-1" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    field
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    await el.updateComplete;
    await table.updateComplete;
    expect(field.error).toBe(t("editor.price_invalid"));
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)("price source and clash states (%s)", (theme) => {
  it.each(["en-GB", "es-ES"])(
    "accessible clash resolution and open source tooltip (%s)",
    async (locale) => {
      setLocale(locale);
      const product = rows[0]!;
      const { el, host } = await mount(theme, {
        rows: [{ ...product, combined: { ...product.combined, price: clash } }],
      });
      const table = el.shadowRoot!.querySelector("wt-data-table")!;
      await table.updateComplete;
      const actions = table.shadowRoot!.querySelector("wt-row-actions")!;
      await actions.updateComplete;
      actions.show();
      expect(actions.querySelectorAll("wt-button").length).toBe(3);
      await expectNoA11yViolations(host);
      const tip = table.shadowRoot!.querySelector("wt-help-tooltip")!;
      await tip.updateComplete;
      tip.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
      await tip.updateComplete;
      expect(tip.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
      await expectNoA11yViolations(host);
      setLocale("es-ES");
    },
  );
});
