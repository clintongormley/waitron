import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { page, userEvent } from "vitest/browser";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./product-list.js";
import type { ProductList } from "./product-list.js";
import type { Product } from "../api/client.js";

registerIcons(DASHBOARD_ICONS);

async function showArchived(el: ProductList): Promise<void> {
  const toggle = el.shadowRoot!.querySelector<HTMLElement>('wt-switch[name="show-archived"]')!;
  toggle.shadowRoot!.querySelector<HTMLInputElement>("input")!.click();
  await el.updateComplete;
  await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
}

const products: Product[] = [
  {
    id: "p1",
    modifiers: [],
    catalogueId: "c1",
    categoryId: "cat-1",
    primaryCategoryId: "cat-1",
    name: "Croquetas de jamón",
    customerName: { es: "Croquetas caseras de jamón ibérico" },
    unitId: "u1",
    unit: { id: "u1", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
    description: null,
    kitchenName: null,
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "8.50",
    vatClass: "reduced",
    active: true,
    available: false,
    ordering: "public",
    allergens: null,
    dietOverride: null,
    dietDerivation: null,
    manualAllergens: null,
    image: "abc123.webp",
    color: null,
    variants: [],
  },
  {
    id: "p2",
    modifiers: [],
    catalogueId: "c1",
    categoryId: null,
    primaryCategoryId: null,
    name: "Agua mineral",
    customerName: { es: "Agua mineral con gas" },
    unitId: "u1",
    unit: { id: "u1", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
    description: null,
    kitchenName: null,
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "2.00",
    vatClass: "general",
    active: false,
    available: true,
    ordering: "public",
    allergens: {},
    dietOverride: null,
    dietDerivation: null,
    manualAllergens: {},
    image: null,
    color: null,
    variants: [],
  },
  {
    id: "p3",
    modifiers: [],
    catalogueId: "c1",
    categoryId: "cat-2",
    primaryCategoryId: "cat-2",
    name: "Tarta de queso",
    customerName: { es: "Tarta de queso de la abuela" },
    unitId: "u-kg",
    unit: { id: "u-kg", name: { es: "Kilogramo" }, precision: 3, abbreviation: { es: "kg" } },
    description: null,
    kitchenName: null,
    dietaryDeclarations: [],
    pricingUnit: "weight",
    unitPrice: "15.00",
    vatClass: "super_reduced",
    active: true,
    available: true,
    ordering: "public",
    allergens: {
      gluten: { presence: "contains", source: "trigo" },
      milk: { presence: "contains" },
    },
    dietOverride: null,
    dietDerivation: null,
    manualAllergens: {
      gluten: { presence: "contains", source: "trigo" },
      milk: { presence: "contains" },
    },
    image: null,
    color: null,
    variants: [],
  },
  {
    id: "p4",
    modifiers: [],
    catalogueId: "c1",
    categoryId: "cat-1",
    primaryCategoryId: "cat-1",
    name: "Vino por copa",
    customerName: { es: "Vino de la casa por copa" },
    unitId: "u1",
    unit: { id: "u1", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
    description: null,
    kitchenName: null,
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "3.00",
    vatClass: "reduced",
    active: true,
    available: true,
    ordering: "public",
    allergens: {},
    dietOverride: null,
    dietDerivation: null,
    manualAllergens: {},
    image: null,
    color: null,
    variants: [
      {
        id: "v1",
        name: "Vino 175",
        customerName: { es: "Copa grande" },
        kitchenName: "V175",
        image: "v1.webp",
        unitPrice: "4.50",
        available: false,
        active: true,
        effective: {
          unitPrice: "4.50",
          vatClass: "general",
          primaryCategoryId: "cat-1",
        },
      },
      {
        id: "v2",
        name: "Vino 250",
        customerName: { es: "Copa doble" },
        kitchenName: "V250",
        image: null,
        unitPrice: null,
        available: true,
        active: false,
        effective: {
          unitPrice: "3.00",
          vatClass: "reduced",
          primaryCategoryId: "cat-1",
        },
      },
    ],
  },
];

afterEach(cleanupWidgets);
// The table remembers its sort and filter choices in sessionStorage under waitron.products.table, so
// a choice one test makes would otherwise be restored into the next one.
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe.each(["light", "dark"] as const)("product-list a11y (%s theme)", (theme) => {
  it("keeps a visually hidden phone count in the row's accessible name", async () => {
    const before = {
      width: window.innerWidth,
      height: window.innerHeight,
      locale: currentLocale(),
    };
    try {
      setLocale("en-GB");
      await page.viewport(390, 844);
      const { el, host } = await mountWidget<ProductList>(
        "dashboard-product-list",
        {
          products: [products[0]!],
          categories: [{ id: "cat-1", name: "Comida", parentId: null, color: null }],
          reordering: false,
        },
        theme,
      );
      const table = el.shadowRoot!.querySelector("wt-data-table")!;
      await table.updateComplete;
      await vi.waitFor(() => expect(table.hasAttribute("narrow")).toBe(true));
      const row = table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="folder:cat-1"]')!;
      await expect.element(row, { timeout: 1000 }).toHaveAccessibleName(/Comida.*1 product/);
      await expectNoA11yViolations(host);
    } finally {
      setLocale(before.locale);
      await page.viewport(before.width, before.height);
    }
  });

  it("A461 flat matching categories and opened contents render accessibly", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      {
        products: [{ ...products[0]!, name: "Iced coffee", primaryCategoryId: "coffee" }],
        categories: [
          { id: "drinks", name: "Drinks", parentId: null, color: null },
          { id: "coffee", name: "Coffee", parentId: "drinks", color: null },
        ],
        search: "coffee",
      },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const keys = () =>
      [...table.shadowRoot!.querySelectorAll("tr[data-row-key]")].map((row) =>
        row.getAttribute("data-row-key"),
      );
    expect(keys()).toEqual(["folder:coffee", "p1"]);
    await expectNoA11yViolations(host);
    table
      .shadowRoot!.querySelector<HTMLButtonElement>(
        'tr[data-row-key="folder:coffee"] .row-activate',
      )!
      .click();
    await table.updateComplete;
    expect(keys()).toEqual(["folder:coffee", "p1"]);
    expect(
      table.shadowRoot!.querySelector('tr[data-row-key="p1"]')!.getAttribute("aria-level"),
    ).toBe("2");
    await expectNoA11yViolations(host);
  });

  it("renders accessibly", async () => {
    const { host } = await mountWidget<ProductList>("dashboard-product-list", { products }, theme);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with every status shown", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      { products },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    await showArchived(el);
    table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="p4"] .tree-toggle')!.click();
    await table.updateComplete;
    expect(
      [...table.shadowRoot!.querySelectorAll("[data-test=availability-badge]")]
        .map((badge) => badge.getAttribute("data-state"))
        .sort(),
    ).toEqual(["archived", "archived", "unavailable", "unavailable"]);
    expect(table.shadowRoot!.querySelector("[data-test=vat-note]")).not.toBeNull();
    expect(
      table.shadowRoot!.querySelector('[data-test="color-v2"] [data-test="thumb-placeholder"]'),
    ).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with the Filters panel open and Show archived on", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      { products },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
    await table.updateComplete;
    await showArchived(el);
    const toggle = el.shadowRoot!.querySelector<HTMLElement>('wt-switch[name="show-archived"]')!;
    expect(toggle.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(table.shadowRoot!.querySelectorAll(".filter-section")).toHaveLength(5);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a product's variants opened on their band", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      { products },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="p4"] .tree-toggle')!.click();
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector('tr[data-row-key="p4:v1"].joined')).not.toBeNull();
    expect(table.shadowRoot!.querySelector('[data-test="variant-count"]')).not.toBeNull();
    expect(table.shadowRoot!.querySelector('[data-test="color-v1"] img')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a removed variant shown under its Active product", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      { products },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    await showArchived(el);
    table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="p4"] .tree-toggle')!.click();
    await table.updateComplete;
    expect(
      table.shadowRoot!.querySelector(
        'tr[data-row-key="p4:v2"] [data-test=availability-badge][data-state="archived"]',
      ),
    ).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with the row action menu open", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      { products },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table
      .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
        '[data-test="actions-p1"]',
      )!
      .show();
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with the All products menu open", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      { products, canAddProduct: true },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table
      .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
        '[data-test="actions-root"]',
      )!
      .show();
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a category's menu open", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      {
        products,
        categories: [{ id: "cat-1", name: "Comida", parentId: null, color: null }],
        canAddProduct: true,
      },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table
      .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
        '[data-test="actions-folder-cat-1"]',
      )!
      .show();
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a coloured and an uncoloured category's swatch", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      {
        products,
        categories: [
          { id: "cat-1", name: "Comida", parentId: null, color: "#b12525" },
          { id: "cat-2", name: "Postres", parentId: null, color: null },
        ],
      },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    expect(table.shadowRoot!.querySelectorAll('[part~="swatch-button"]')).toHaveLength(3);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a category and products showing a colour they inherit", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      {
        products: products.map((product) =>
          product.id === "p3" ? { ...product, primaryCategoryId: "cat-2" } : product,
        ),
        categories: [
          { id: "cat-1", name: "Comida", parentId: null, color: "#b12525" },
          { id: "cat-2", name: "Postres", parentId: "cat-1", color: null },
        ],
        defaultColor: "#256bb1",
      },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table
      .shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="folder:cat-1"] .row-activate')!
      .click();
    await table.updateComplete;
    table
      .shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="folder:cat-2"] .row-activate')!
      .click();
    await table.updateComplete;
    const inherited = (id: string) =>
      table.shadowRoot!.querySelector(`[data-test="color-${id}"] [part~="inherited"]`);
    for (const id of ["cat-2", "p1", "p3"]) expect(inherited(id), id).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it.each([null, "#b12525"])(
    "renders accessibly with All products' swatch for a venue default of %s",
    async (defaultColor) => {
      const { el, host } = await mountWidget<ProductList>(
        "dashboard-product-list",
        { products, categories: [], defaultColor },
        theme,
      );
      const table = el.shadowRoot!.querySelector("wt-data-table")!;
      await table.updateComplete;
      const chip = table.shadowRoot!.querySelector(
        '[data-test="color-root"] [part~="color-swatch"]',
      )!;
      expect(chip.getAttribute("part")).toBe(
        defaultColor === null ? "color-swatch empty" : "color-swatch",
      );
      await expectNoA11yViolations(host);
    },
  );

  it("renders accessibly mid-drag", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      { products, categories: [{ id: "drinks", name: "Bebidas", parentId: null, color: null }] },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const at = (element: Element, type: string) => {
      const box = element.getBoundingClientRect();
      element.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          composed: true,
          pointerId: 1,
          clientX: box.x + 8,
          clientY: box.y + 8,
        }),
      );
    };
    const over = table.shadowRoot!.querySelector(
      'tr[data-row-key="folder:drinks"] [part~="folder-cell"]',
    )!;
    at(table.shadowRoot!.querySelector('[part~="product-cell"]')!, "pointerdown");
    at(over, "pointermove");
    await el.updateComplete;
    const cells = [...table.shadowRoot!.querySelectorAll('tr[data-row-key="folder:drinks"] > td')];
    expect(cells.every((cell) => cell.part.contains("drop-into"))).toBe(true);
    await expectNoA11yViolations(host);
    at(over, "pointercancel");
  });
});

describe.each(["light", "dark"] as const)("product made-at link a11y (%s)", (theme) => {
  async function mountMadeAt() {
    await page.viewport(1280, 844);
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      {
        products: [{ ...products[0]!, primaryCategoryId: null, variants: [] }],
        madeAt: {
          p1: {
            stationId: "s1",
            stationName: "Cocina",
            noPreparation: false,
            noReplacement: false,
            unavailableStationId: null,
            variesByZone: false,
          },
        },
      },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const row = table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="p1"]')!;
    expect(row.classList.contains("clickable")).toBe(true);
    expect(row.querySelector('[part~="maker-link"]')!.textContent).toContain("Cocina");
    return { host, table, row };
  }

  it("reads on a row highlighted by focus inside it", async () => {
    const { host, row } = await mountMadeAt();
    const trigger = row.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
      '[data-test="actions-p1"]',
    )!;
    trigger.focus();
    expect(row.matches(":focus-within")).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("reads on a row highlighted by the pointer", async () => {
    const { host, row } = await mountMadeAt();
    const cell = row.querySelector('[part~="maker-link"]')!.closest("td")!;
    await userEvent.hover(cell);
    expect(row.matches(":hover")).toBe(true);
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)("product media link a11y (%s)", (theme) => {
  it.each([null, "soup.webp"])(
    "names the swatch link to the product's Edit, at rest and focused, with image %s",
    async (image) => {
      const before = { width: window.innerWidth, height: window.innerHeight };
      try {
        await page.viewport(1280, 844);
        const { el, host } = await mountWidget<ProductList>(
          "dashboard-product-list",
          {
            products: [
              { ...products[0]!, primaryCategoryId: null, image, color: "#b12525", variants: [] },
            ],
          },
          theme,
        );
        const table = el.shadowRoot!.querySelector("wt-data-table")!;
        await table.updateComplete;
        const media = table.shadowRoot!.querySelector<HTMLAnchorElement>('[data-test="color-p1"]')!;
        expect(media.tagName).toBe("A");
        expect(media.getAttribute("aria-label")).toBe(
          t("product.edit_named").replace("{name}", products[0]!.name),
        );
        await expectNoA11yViolations(host);
        media.focus();
        expect(table.shadowRoot!.activeElement).toBe(media);
        expect(getComputedStyle(media).outlineStyle).not.toBe("none");
        await expectNoA11yViolations(host);
      } finally {
        await page.viewport(before.width, before.height);
      }
    },
  );
});

describe.each(["light", "dark"] as const)("archive row actions a11y (%s)", (theme) => {
  it.each(["en", "es"])(
    "renders Archive and View popovers in %s at desktop and phone width",
    async (locale) => {
      const before = { locale: currentLocale(), width: innerWidth, height: innerHeight };
      setLocale(locale);
      try {
        for (const width of [1280, 390]) {
          await page.viewport(width, 844);
          expect(innerWidth).toBe(width);
          const { el, host } = await mountWidget<ProductList>(
            "dashboard-product-list",
            {
              products: [
                products[0]!,
                { ...products[0]!, id: "archived", name: "Archived dish", active: false },
              ],
            },
            theme,
          );
          const table = el.shadowRoot!.querySelector("wt-data-table")!;
          await table.updateComplete;
          await showArchived(el);
          for (const id of ["p1", "archived"]) {
            const menu = table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
              `[data-test="actions-${id}"]`,
            )!;
            expect(
              [...menu.querySelectorAll("wt-button")].map((button) => button.textContent!.trim()),
            ).toEqual(id === "p1" ? [t("action.edit"), t("product.archive")] : [t("product.view")]);
            const icon = menu.shadowRoot!.querySelector("wt-icon")!;
            await icon.updateComplete;
            expect(icon.shadowRoot!.querySelector("svg")).not.toBeNull();
            menu.show();
            await menu.updateComplete;
            const popup = menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
            expect(popup.matches(":popover-open")).toBe(true);
            const bounds = popup.getBoundingClientRect();
            expect(bounds.height).toBeGreaterThan(0);
            expect(bounds.left).toBeGreaterThanOrEqual(0);
            expect(bounds.right).toBeLessThanOrEqual(innerWidth);
            expect(bounds.top).toBeGreaterThanOrEqual(0);
            expect(bounds.bottom).toBeLessThanOrEqual(innerHeight);
            for (const button of menu.querySelectorAll("wt-button")) {
              const actionBounds = button.getBoundingClientRect();
              expect(actionBounds.top).toBeGreaterThanOrEqual(bounds.top);
              expect(actionBounds.bottom).toBeLessThanOrEqual(bounds.bottom);
            }
            await expectNoA11yViolations(host);
            if (import.meta.env.VITE_A435_TASK7_CAPTURE === "1") {
              await page.screenshot({
                element: host,
                path: `__screenshots__/a435-task7/list-${locale}-${theme}-${width}-${id}.png`,
              });
              if (id === "p1") {
                popup.setAttribute("data-testid", "a435-archive-popup");
                await page.screenshot({
                  element: page.getByTestId("a435-archive-popup"),
                  path: `__screenshots__/a435-task7/menu-${locale}-${theme}-${width}.png`,
                });
              }
            }
            menu.hide();
          }
          cleanupWidgets();
        }
      } finally {
        setLocale(before.locale);
        await page.viewport(before.width, before.height);
      }
    },
  );
});
