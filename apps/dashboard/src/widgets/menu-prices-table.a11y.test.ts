import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CategorySummary, LibrarySection, MenuPriceRow, Product } from "../api/client.js";
import { t } from "../i18n/t.js";
import type { MenuPricesTable } from "./menu-prices-table.js";
import "./menu-prices-table.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";

afterEach(cleanupWidgets);
beforeEach(() => sessionStorage.clear());

const sections: LibrarySection[] = [
  { id: "s-drinks", internalName: "Drinks", names: {}, image: null, color: null, members: [] },
  { id: "s-beer", internalName: "Beer", names: {}, image: null, color: null, members: [] },
];
const categories: CategorySummary[] = [
  { id: "c-drinks", name: { es: "Bebidas" }, image: null, color: null, parentId: null },
];
const lemonade = {
  id: "p-lemonade",
  name: "Lemonade",
  variants: [
    { id: "v-small", name: "Small", unitPrice: null, active: true },
    { id: "v-large", name: "Large", unitPrice: "3.40", active: true },
  ],
} as unknown as Product;

const rows: MenuPriceRow[] = [
  {
    menuItemId: "mi-burger",
    productId: "p-burger",
    name: "Burger",
    categoryId: null,
    placements: [[]],
    productPrice: "12.00",
    override: null,
    effectivePrice: "12.00",
    active: false,
    variants: [],
  },
  {
    menuItemId: "mi-lemonade",
    productId: "p-lemonade",
    name: "Lemonade",
    categoryId: "c-drinks",
    placements: [["s-drinks"], ["s-drinks", "s-beer"]],
    productPrice: "3.00",
    override: "2.50",
    effectivePrice: "2.50",
    active: true,
    variants: [
      { variantId: "v-small", price: null, offered: true },
      { variantId: "v-large", price: "3.75", offered: false },
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
      modal.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="grossPrice"]')!.error,
    ).toBe(t("editor.price_invalid"));
    await expectNoA11yViolations(host);
  });
});
