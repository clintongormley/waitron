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
    productPrice: "12.00",
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
    productPrice: "3.00",
    override: "2.50",
    effectivePrice: "2.50",
    active: true,
    variants: [
      { variantId: "v-small", price: null, active: true },
      { variantId: "v-large", price: "3.75", active: true },
    ],
  },
];

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

  it("accessible table with a product's variants open and the combined price shown", async () => {
    const { el, host } = await mount(theme, {});
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = table.shadowRoot!;
    root
      .querySelector<HTMLButtonElement>('tr[data-row-key="mi-lemonade"] button.tree-toggle')!
      .click();
    root.querySelector<HTMLInputElement>('input[data-column="price-on-menu"]')!.click();
    await table.updateComplete;
    expect(root.querySelector('tr[data-row-key="mi-lemonade:v-large"]')).not.toBeNull();
    // A struck price, a muted one with its hidden words, and a muted "no own price", all drawn.
    expect(root.querySelector("s")).not.toBeNull();
    expect(root.querySelector('[part~="visually-hidden"]')).not.toBeNull();
    expect(
      root.querySelector('tr[data-row-key="mi-lemonade:v-small"] [part~="muted"]'),
    ).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it.each(["mi-burger", "mi-lemonade"])("accessible settings window for %s", async (editing) => {
    const { host } = await mount(theme, { editing });
    await expectNoA11yViolations(host);
  });

  it("accessible settings window refusing a malformed price", async () => {
    const { el, host } = await mount(theme, { editing: "mi-lemonade" });
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    modal
      .querySelector('[name="grossPrice"]')!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "-1" }, bubbles: true, composed: true }),
      );
    await el.updateComplete;
    modal.querySelector<HTMLElement>('[data-test="offer-save"]')!.click();
    await el.updateComplete;
    expect(
      modal.querySelector<HTMLElementTagNameMap["wt-price-input"]>('[name="grossPrice"]')!.error,
    ).toBe(t("editor.price_invalid"));
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)("price source and clash states (%s)", (theme) => {
  it.each(["en-GB", "es-ES"])(
    "accessible clash resolution and open source tooltip (%s)",
    async (locale) => {
      setLocale(locale);
      const product = rows[0]!;
      const source = {
        kind: "menu",
        menuId: "drinks",
        menuName: "Drinks",
        from: { kind: "own" },
      } as const;
      const clash = {
        state: "clash",
        candidates: [
          { place: { kind: "own_sections" }, value: "12.00", source: { kind: "product" } },
          { place: { kind: "menu", menuId: "drinks", menuName: "Drinks" }, value: "14.00", source },
        ],
      } as unknown as MenuPriceRow["combined"]["price"];
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
