import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { WtCombobox } from "@waitron/ui";
import { chooseOption, expectRowMenusOnScreen } from "@waitron/ui/src/test-helpers.js";
import { allergenStateName, vatClassName } from "../i18n/domain.js";
import type { Product, Unit } from "../api/client.js";
import type { ListedVariant } from "@waitron/catalogue/src/product-types.js";
import { ProductList, ROOT_KEY } from "./product-list.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";

afterEach(cleanupWidgets);
afterEach(() => setLocale("es"));
beforeEach(() => {
  sessionStorage.clear();
  localStorage.removeItem("waitron.products.table:columns");
  localStorage.removeItem("waitron.products.table:expanded");
});

async function tableRoot(el: ProductList): Promise<ShadowRoot> {
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  return table.shadowRoot!;
}

function productRows(root: ShadowRoot): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      `tbody tr[data-row-key]:not([data-row-key="${ROOT_KEY}"])`,
    ),
  ];
}

function rowKeys(root: ShadowRoot): string[] {
  return productRows(root).map((row) => row.getAttribute("data-row-key")!);
}

/** The one cell of `rowKey` under the column whose header starts with `header` — found by header text
 * rather than a position, so inserting a column does not silently re-aim an assertion. */
function cellUnder(root: ShadowRoot, rowKey: string, header: string): HTMLElement {
  const index = [...root.querySelectorAll("thead th")].findIndex((cell) =>
    cell.textContent!.trim().startsWith(header),
  );
  expect(index).toBeGreaterThanOrEqual(0);
  const row = root.querySelector(`tr[data-row-key="${rowKey}"]`)!;
  return [...row.querySelectorAll("td")][index]!;
}

const drinks = { id: "d", name: "Drinks", parentId: null };
const beer = { id: "b", name: "Beer", parentId: "d" };
const food = { id: "f", name: "Food", parentId: null };

function treeProducts(): Product[] {
  return [
    product({ id: "cola", name: "Cola", primaryCategoryId: "d" }),
    product({ id: "ale", name: "Ale", primaryCategoryId: "d", active: false }),
    product({ id: "lager", name: "Lager", primaryCategoryId: "b" }),
    product({ id: "bread", name: "Bread", primaryCategoryId: null }),
  ];
}

async function mountTree(props: Partial<ProductList> = {}) {
  const { el } = await mountWidget<ProductList>("dashboard-product-list", {
    categories: [drinks, beer, food],
    products: treeProducts(),
    ...props,
  });
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  return { el, table, root: await tableRoot(el) };
}

/** Clicks a category row's own activator, as a click anywhere on the row does. */
async function openRow(el: ProductList, key: string): Promise<void> {
  const root = await tableRoot(el);
  root.querySelector<HTMLButtonElement>(`tr[data-row-key="${key}"] .row-activate`)!.click();
  await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
}

const focusedName = (el: ProductList) =>
  el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!.activeElement?.getAttribute("name");

const counted = (categories: number, products: number) =>
  [
    ...(categories
      ? [
          t(categories === 1 ? "folders.count_one" : "folders.count").replace(
            "{count}",
            String(categories),
          ),
        ]
      : []),
    ...(products || !categories
      ? [
          t(products === 1 ? "folders.product_count_one" : "folders.product_count").replace(
            "{count}",
            String(products),
          ),
        ]
      : []),
  ].join(", ");

async function choose(el: ProductList, column: string, value: string): Promise<void> {
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  const select = table.shadowRoot!.querySelector<HTMLElement>(
    `wt-combobox[data-filter="${column}"]`,
  )!;
  await chooseOption(select, value);
  await table.updateComplete;
}

/** A Spanish price, which the suite's default language writes with a no-break space before the
 * sign. */
const euros = (amount: string) => `${amount}\u00a0€`;

const bunVariant = {
  id: "small",
  name: "Small",
  customerName: null,
  kitchenName: null,
  image: null,
  unitPrice: "1.00",
  available: true,
  active: true,
};

/** The staff name and the customer-facing name deliberately DIFFER, so a test cannot pass by reading
 * whichever one it happened to find. */
function product(
  overrides: Omit<Partial<Product>, "variants"> & {
    variants?: (Omit<ListedVariant, "effective"> & Partial<Pick<ListedVariant, "effective">>)[];
  } = {},
): Product {
  const { variants = [], ...rest } = overrides;
  const base: Omit<Product, "variants"> = {
    id: "prod-1",
    modifiers: [],
    catalogueId: "cat-1",
    categoryId: "category-1",
    primaryCategoryId: "category-1",
    name: "Croquetas de jamón",
    customerName: { es: "Croquetas caseras de jamón ibérico" },
    unitId: "unit-each",
    unit: { id: "unit-each", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
    description: null,
    kitchenName: null,
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "8.50",
    vatClass: "reduced",
    active: true,
    available: true,
    ordering: "public",
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: null,
    ...rest,
  };
  return {
    ...base,
    variants: variants.map((variant) => ({
      ...variant,
      effective: variant.effective ?? {
        unitPrice: variant.unitPrice ?? base.unitPrice,
        vatClass: base.vatClass,
        primaryCategoryId: base.primaryCategoryId,
      },
    })),
  };
}

describe("product-list", () => {
  it("names a switched-off station with no replacement instead of nowhere", async () => {
    setLocale("en");
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "mojito" })],
      madeAt: {
        mojito: {
          stationId: null,
          stationName: "Cocktail bar",
          noPreparation: false,
          noReplacement: true,
          variesByZone: false,
        },
      },
    });
    const root = await tableRoot(el);
    expect(cellUnder(root, "mojito", "Made at").textContent).toContain(
      "No replacement (Cocktail bar is switched off)",
    );
  });
  it("shows the made-at station, zone variation, and tester link", async () => {
    setLocale("en");
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "lager" }), product({ id: "mojito" })],
      madeAt: {
        lager: {
          stationId: "bar",
          stationName: "Bar",
          noPreparation: false,
          noReplacement: false,
          variesByZone: false,
        },
        mojito: {
          stationId: "cocktail",
          stationName: "Cocktail bar",
          noPreparation: false,
          noReplacement: false,
          variesByZone: true,
        },
      },
    });
    const root = await tableRoot(el);
    expect(cellUnder(root, "lager", "Made at").textContent).toContain("Bar");
    const cell = cellUnder(root, "mojito", "Made at");
    expect(cell.textContent).toContain("Cocktail bar · varies by service zone");
    expect(cell.querySelector("a")?.getAttribute("href")).toBe("/manage/prep-stations/test/mojito");
  });
  it("renders one shared-table row per product", async () => {
    const products = [product({ id: "a" }), product({ id: "b" }), product({ id: "c" })];
    const { el } = await mountWidget<ProductList>("dashboard-product-list", { products });
    const rows = productRows(await tableRoot(el));
    expect(rows.length).toBe(3);
  });

  // The two fixture names differ, so this fails if either is swapped.
  it("shows the staff name, not the customer-facing one and not the id", async () => {
    const products = [
      product({
        name: "Croquetas",
        customerName: { es: "Croquetas caseras", en: "Ham croquettes" },
      }),
    ];
    const { el } = await mountWidget<ProductList>("dashboard-product-list", { products });
    const row = productRows(await tableRoot(el))[0]!;
    expect(row.textContent).toContain("Croquetas");
    expect(row.textContent).not.toContain("Croquetas caseras");
    expect(row.textContent).not.toContain("Ham croquettes");
    expect(row.textContent).not.toContain(products[0]!.id);
  });

  it("offers every column but the name and the actions in a translated column chooser, and remembers a hidden one", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product()],
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    expect(root.querySelector(".columns-trigger")?.textContent?.trim()).toBe(t("table.columns"));
    expect(
      [...root.querySelectorAll<HTMLInputElement>("input[data-column]")].map((box) => [
        box.dataset.column,
        box.checked,
      ]),
    ).toEqual([
      ["reporting-category", true],
      ["made-at", true],
      ["price", true],
      ["modifiers", true],
      ["ordering", true],
      ["active", true],
      ["allergens", true],
    ]);
    const headerLabels = () =>
      [...root.querySelectorAll("thead th")].map((th) =>
        th.textContent!.replace(/[▲▼]/g, "").trim(),
      );
    const before = headerLabels();
    expect(before).toContain(t("editor.modifiers"));
    const box = root.querySelector<HTMLInputElement>('input[data-column="modifiers"]')!;
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    await table.updateComplete;
    expect(headerLabels()).toEqual(before.filter((text) => text !== t("editor.modifiers")));
    expect(JSON.parse(localStorage.getItem("waitron.products.table:columns")!)).toEqual({
      modifiers: false,
    });
  });

  it("uses a named kebab menu containing Edit and Delete", async () => {
    const products = [product({ id: "p7", name: "Tarta de queso" })];
    const { el } = await mountWidget<ProductList>("dashboard-product-list", { products });
    const actions = (await tableRoot(el)).querySelector<HTMLElement>('[data-test="actions-p7"]')!;
    expect(actions.tagName).toBe("WT-ROW-ACTIONS");
    expect(actions.getAttribute("label")).toContain("Tarta de queso");
    expect(actions.querySelector('[data-test="edit-p7"]')?.textContent).toContain(t("action.edit"));
    expect(actions.querySelector('[data-test="delete-p7"]')?.textContent).toContain(
      t("action.delete"),
    );
  });

  it("shows a product price, or the range across its variants", async () => {
    const products = [
      product({ id: "plain", unitPrice: "12.5", pricingUnit: "weight" }),
      product({
        id: "sized",
        variants: [
          {
            id: "small",
            name: "Small",
            customerName: { es: "Taza pequeña" },
            kitchenName: "SM",
            image: null,
            unitPrice: "4.00",
            available: true,
            active: true,
          },
          {
            id: "large",
            name: "Large",
            customerName: { es: "Taza grande" },
            kitchenName: "LG",
            image: null,
            unitPrice: "7.50",
            available: true,
            active: true,
          },
        ],
      }),
    ];
    const { el } = await mountWidget<ProductList>("dashboard-product-list", { products });
    const rows = productRows(await tableRoot(el));
    expect(rows[0]!.textContent).toContain(euros("12,50"));
    expect(rows[1]!.textContent).toContain(`${euros("4,00")}–${euros("7,50")}`);
  });

  // Spanish writes a no-break space (U+00A0) before the sign, spelled out here rather than taken
  // from the formatter the widget calls.
  it.each([
    { locale: "en-GB", plain: "€12.50", range: "€4.00–€7.50", variant: "€7.50" },
    {
      locale: "es-ES",
      plain: "12,50\u00a0€",
      range: "4,00\u00a0€–7,50\u00a0€",
      variant: "7,50\u00a0€",
    },
  ])(
    "writes each price with the euro sign where $locale writes it",
    async ({ locale, ...want }) => {
      setLocale(locale);
      try {
        const { el } = await mountWidget<ProductList>("dashboard-product-list", {
          products: [
            product({ id: "plain", unitPrice: "12.5" }),
            product({
              id: "sized",
              variants: [
                { ...bunVariant, id: "small", unitPrice: "4.00" },
                { ...bunVariant, id: "large", name: "Large", unitPrice: "7.50" },
              ],
            }),
          ],
        });
        const table = el.shadowRoot!.querySelector("wt-data-table")!;
        const root = await tableRoot(el);
        const price = (key: string) =>
          cellUnder(root, key, t("product.price")).querySelector('[data-test="price"]')!
            .textContent;
        expect(price("plain")).toBe(want.plain);
        expect(price("sized")).toBe(want.range);
        root.querySelector<HTMLElement>(".tree-toggle")!.click();
        await table.updateComplete;
        expect(price("sized:large")).toBe(want.variant);
      } finally {
        setLocale("es-ES");
      }
    },
  );

  it("sorts by price as an amount, a range by its low end, whatever the language writes", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "ten", name: "A", unitPrice: "10.00" }),
        product({ id: "nine", name: "B", unitPrice: "9.00" }),
        product({
          id: "range",
          name: "C",
          variants: [
            { ...bunVariant, id: "s", unitPrice: "9.50" },
            { ...bunVariant, id: "l", name: "Large", unitPrice: "30.00" },
          ],
        }),
      ],
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    root.querySelector<HTMLElement>('button[data-sort="price"]')!.click();
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["nine", "range", "ten"]);
  });

  // Sorted as text, English puts €1,000.00 before €999.00 and Spanish puts 10.000,00 € before
  // 9500,00 €, so only a numeric sort passes in either language.
  it.each(["en-GB", "es-ES"])(
    "sorts amounts of a thousand and more as amounts in %s",
    async (locale) => {
      setLocale(locale);
      try {
        const { el } = await mountWidget<ProductList>("dashboard-product-list", {
          products: [
            product({ id: "10000", name: "A", unitPrice: "10000.00" }),
            product({ id: "1000", name: "B", unitPrice: "1000.00" }),
            product({ id: "9500", name: "C", unitPrice: "9500.00" }),
            product({ id: "999", name: "D", unitPrice: "999.00" }),
          ],
        });
        const table = el.shadowRoot!.querySelector("wt-data-table")!;
        const root = await tableRoot(el);
        root.querySelector<HTMLElement>('button[data-sort="price"]')!.click();
        await table.updateComplete;
        expect(rowKeys(root)).toEqual(["999", "1000", "9500", "10000"]);
      } finally {
        setLocale("es-ES");
      }
    },
  );

  it("prices a variant with no price of its own at its product's price", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({
          id: "wine",
          unitPrice: "4.00",
          variants: [
            { ...bunVariant, id: "w125", name: "Wine 125", unitPrice: null },
            { ...bunVariant, id: "w175", name: "Wine 175", unitPrice: "5.50" },
          ],
        }),
      ],
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    expect(
      cellUnder(root, "wine", t("product.price"))
        .querySelector('[data-test="price"]')!
        .textContent!.trim(),
    ).toBe(`${euros("4,00")}–${euros("5,50")}`);
    root.querySelector<HTMLElement>(".tree-toggle")!.click();
    await table.updateComplete;
    expect(
      cellUnder(root, "wine:w125", t("product.price"))
        .querySelector('[data-test="price"]')!
        .textContent!.trim(),
    ).toBe(euros("4,00"));
    expect(
      cellUnder(root, "wine:w175", t("product.price"))
        .querySelector('[data-test="price"]')!
        .textContent!.trim(),
    ).toBe(euros("5,50"));
  });

  // The Modifiers column names the lists a manager attached through `Product.modifiers`. Two things
  // are set up to fail on the TEXT rather than pass on an empty cell: `opt-2` ("Punto") is a loaded
  // options list this product does NOT hold, so a column printing the loaded set instead of the
  // attachments names it; and the cell is asserted whole with `toBe`, so resolving the `extras` ref
  // against the options lists — which also reaches "Punto" — loses "Salsas".
  it("shows the main category, attached modifier list names, and no VAT or labels column", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({
          primaryCategoryId: "reporting",
          modifiers: [
            { kind: "extras", id: "ex-1" },
            { kind: "options", id: "opt-1" },
          ],
        }),
      ],
      categories: [
        { id: "reporting", name: "Comida", parentId: null },
        { id: "seasonal", name: "Temporada", parentId: null },
      ],
      extraLists: [{ id: "ex-1", name: "Salsas" }],
      optionLists: [
        { id: "opt-1", name: "Punto de la carne" },
        { id: "opt-2", name: "Punto" },
      ],
    });
    const root = await tableRoot(el);
    await openRow(el, "folder:reporting");
    const headers = [...root.querySelectorAll("thead th")].map((cell) => cell.textContent!.trim());
    expect(headers.some((header) => header.startsWith(t("product.name")))).toBe(true);
    expect(headers).toContain(t("editor.main_category"));
    expect(headers).toContain(t("editor.modifiers"));
    expect(headers).not.toContain(t("product.vat"));
    expect(headers).not.toContain("Etiquetas");
    expect(root.querySelector('input[data-column="labels"]')).toBeNull();
    expect(cellUnder(root, "prod-1", t("editor.main_category")).textContent!.trim()).toBe("Comida");
    expect(cellUnder(root, "prod-1", t("editor.modifiers")).textContent!.trim()).toBe(
      "Salsas, Punto de la carne",
    );
  });

  // A ref's `kind` is what chooses the set it is looked up in: an `extras` ref whose id exists only
  // among the options lists names nothing, exactly like an id nobody holds.
  it("falls back to the missing-choice placeholder for a list the loaded set does not hold", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({
          modifiers: [
            { kind: "extras", id: "gone" },
            { kind: "extras", id: "opt-1" },
          ],
        }),
      ],
      extraLists: [],
      optionLists: [{ id: "opt-1", name: "Punto" }],
    });
    const cell = cellUnder(await tableRoot(el), "prod-1", t("editor.modifiers"));
    expect(cell.textContent!.trim()).toBe(
      `${t("editor.missing_choice")}, ${t("editor.missing_choice")}`,
    );
    expect(cell.textContent).not.toContain("Punto");
  });

  it("shows a visible placeholder instead of blank cells for unresolved category and modifier ids", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({
          primaryCategoryId: "missing-category",
          modifiers: [{ kind: "options", id: "missing-list" }],
        }),
      ],
      categories: [],
      extraLists: [],
      optionLists: [],
    });
    const text = productRows(await tableRoot(el))[0]!.textContent!;
    expect(text.match(new RegExp(t("editor.missing_choice"), "g"))).toHaveLength(2);
  });

  // Names differ from their ids and sort in the ids' order, so the rows read the same either way.
  const orderings = () => [
    product({ id: "a-dish", name: "A dish", ordering: "public" }),
    product({ id: "b-staff", name: "B staff", ordering: "staff_only" }),
    product({ id: "c-topping", name: "C topping", ordering: "not_sold_separately" }),
  ];

  it("shows who may order each product on its own as a badge carrying text, not colour alone", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: orderings(),
    });
    const root = await tableRoot(el);
    const headers = [...root.querySelectorAll("thead th")].map((cell) => cell.textContent!.trim());
    expect(headers.some((header) => header.startsWith(t("product.ordering")))).toBe(true);
    const badges = [...root.querySelectorAll<HTMLElement>("[data-test=ordering-badge]")];
    expect(badges.map((badge) => [badge.dataset.ordering, badge.textContent!.trim()])).toEqual([
      ["public", t("product.ordering_public")],
      ["staff_only", t("product.ordering_staff_only")],
      ["not_sold_separately", t("product.ordering_not_sold_separately")],
    ]);
  });

  it("names the three orderings in English and in Spanish", async () => {
    setLocale("en-GB");
    try {
      const { el } = await mountWidget<ProductList>("dashboard-product-list", {
        products: orderings(),
      });
      const root = await tableRoot(el);
      expect(
        [...root.querySelectorAll("[data-test=ordering-badge]")].map((b) => b.textContent!.trim()),
      ).toEqual(["Public", "Staff only", "Not sold separately"]);
      cleanupWidgets();
      setLocale("es-ES");
      const { el: spanish } = await mountWidget<ProductList>("dashboard-product-list", {
        products: orderings(),
      });
      const spanishRoot = await tableRoot(spanish);
      expect(
        [...spanishRoot.querySelectorAll("[data-test=ordering-badge]")].map((b) =>
          b.textContent!.trim(),
        ),
      ).toEqual(["Público", "Solo personal", "No se vende por separado"]);
      expect(
        [...spanishRoot.querySelectorAll("thead th")].some((cell) =>
          cell.textContent!.trim().startsWith("Pedido por separado"),
        ),
      ).toBe(true);
    } finally {
      setLocale("es-ES");
    }
  });

  // Sorted by the words, either language would put Not sold separately (No se vende) first.
  it("sorts by ordering from the widest to the narrowest, not by the words", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "not-sold", name: "A", ordering: "not_sold_separately" }),
        product({ id: "staff", name: "B", ordering: "staff_only" }),
        product({ id: "public", name: "C", ordering: "public" }),
      ],
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    root.querySelector<HTMLElement>('button[data-sort="ordering"]')!.click();
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["public", "staff", "not-sold"]);
  });

  it("narrows the list to the products of one ordering", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: orderings(),
    });
    const root = await tableRoot(el);
    const select = root.querySelector<WtCombobox>('wt-combobox[data-filter="ordering"]')!;
    expect([select.searchPlaceholder, select.noResultsLabel]).toEqual(["Buscar", "Sin resultados"]);
    expect(select.options.map((option) => [option.value, option.label])).toEqual([
      ["", t("product.filter_ordering_all")],
      ["public", t("product.ordering_public")],
      ["staff_only", t("product.ordering_staff_only")],
      ["not_sold_separately", t("product.ordering_not_sold_separately")],
    ]);
    await choose(el, "ordering", "not_sold_separately");
    expect(rowKeys(root)).toEqual(["c-topping"]);
    await choose(el, "ordering", "staff_only");
    expect(rowKeys(root)).toEqual(["b-staff"]);
    await choose(el, "ordering", "public");
    expect(rowKeys(root)).toEqual(["a-dish"]);
    await choose(el, "ordering", "");
    expect(rowKeys(root)).toEqual(["a-dish", "b-staff", "c-topping"]);
  });

  it("keeps a product and its variants together on both sides of the filter", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "dish", ordering: "public" }),
        product({ id: "bun", ordering: "not_sold_separately", variants: [bunVariant] }),
      ],
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    await choose(el, "ordering", "not_sold_separately");
    expect(rowKeys(root)).toEqual(["bun"]);
    root.querySelector<HTMLElement>(".tree-toggle")!.click();
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["bun", "bun:small"]);
    await choose(el, "ordering", "public");
    expect(rowKeys(root)).toEqual(["dish"]);
  });

  it("leaves a variant row's ordering cell muted", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "dish", ordering: "public" }),
        product({ id: "bun", ordering: "not_sold_separately", variants: [bunVariant] }),
      ],
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    root.querySelector<HTMLElement>(".tree-toggle")!.click();
    await table.updateComplete;
    const cell = cellUnder(root, "bun:small", t("product.ordering"));
    expect(cell.querySelector("[data-test=ordering-badge]")).toBeNull();
    expect(cell.textContent!.trim()).toBe("—");
  });

  it("expands a parent product to its variant rows", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({
          id: "coffee",
          name: "Coffee",
          variants: [
            {
              id: "small",
              name: "Small",
              customerName: { es: "Taza pequeña" },
              kitchenName: "SM",
              image: null,
              unitPrice: "2.00",
              available: true,
              active: true,
            },
            {
              id: "large",
              name: "Large",
              customerName: { es: "Taza grande" },
              kitchenName: "LG",
              image: null,
              unitPrice: "3.00",
              available: true,
              active: true,
            },
          ],
        }),
      ],
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    expect(table.searchable).toBe(false);
    expect(table.rowParent).toBeDefined();
    const root = await tableRoot(el);
    expect(productRows(root)).toHaveLength(1);
    root.querySelector<HTMLElement>(".tree-toggle")!.click();
    await table.updateComplete;
    const rows = productRows(root);
    expect(rows).toHaveLength(3);
    expect(rows.slice(1).map((row) => row.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Small"), expect.stringContaining("Large")]),
    );
    expect(rows.map((row) => row.textContent).join(" ")).not.toContain("Taza pequeña");
    expect(rows.map((row) => row.textContent).join(" ")).not.toContain("SM");
  });

  it("shows an active/inactive badge carrying text, not colour alone", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "on", active: true }), product({ id: "off", active: false })],
    });
    // An Inactive product is behind the status filter, so both are shown with "any".
    await choose(el, "active", "");
    const badges = (await tableRoot(el)).querySelectorAll<HTMLElement>("[data-test=active-badge]");
    expect(badges.length).toBe(2);
    expect(badges[0]!.getAttribute("data-active")).toBe("true");
    expect(badges[0]!.textContent!.trim().length).toBeGreaterThan(0);
    expect(badges[1]!.getAttribute("data-active")).toBe("false");
    expect(badges[1]!.textContent!.trim().length).toBeGreaterThan(0);
    expect(badges[0]!.textContent).not.toBe(badges[1]!.textContent);
  });

  // The fixtures give Active and Available DIFFERENT values, so a column or filter reading the wrong
  // flag fails.
  it("starts the status filter on Active, so an Inactive product is hidden until it is changed", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "gone", name: "Anchoas", active: false, available: true }),
        product({ id: "sold-out", name: "Boquerones", active: true, available: false }),
      ],
    });
    const root = await tableRoot(el);
    const select = root.querySelector<WtCombobox>('wt-combobox[data-filter="active"]')!;
    expect(select.options.map((option) => option.value)).toEqual(["", "active", "inactive"]);
    expect(select.options.map((option) => option.label)).toEqual([
      t("product.filter_status_all"),
      t("product.active_badge"),
      t("product.inactive_badge"),
    ]);
    expect(select.value).toBe("active");
    expect(rowKeys(root)).toEqual(["sold-out"]);
    await choose(el, "active", "inactive");
    expect(rowKeys(root)).toEqual(["gone"]);
    await choose(el, "active", "");
    expect(rowKeys(root)).toEqual(["gone", "sold-out"]);
  });

  it("reads the Active column from active, and badges an Unavailable product that stays listed", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "gone", name: "Anchoas", active: false, available: true }),
        product({ id: "sold-out", name: "Boquerones", active: true, available: false }),
      ],
    });
    await choose(el, "active", "");
    const root = await tableRoot(el);
    const gone = cellUnder(root, "gone", t("product.status"));
    const soldOut = cellUnder(root, "sold-out", t("product.status"));
    expect(gone.querySelector("[data-test=active-badge]")!.getAttribute("data-active")).toBe(
      "false",
    );
    expect(gone.querySelector("[data-test=unavailable-badge]")).toBeNull();
    expect(soldOut.querySelector("[data-test=active-badge]")!.getAttribute("data-active")).toBe(
      "true",
    );
    expect(soldOut.querySelector("[data-test=unavailable-badge]")!.textContent!.trim()).toBe(
      t("product.unavailable_badge"),
    );
  });

  it("applies the status filter to variant rows, keeping an Active product as a removed variant's context", async () => {
    const removed = { ...bunVariant, id: "large", name: "Large", active: false };
    const soldOut = { ...bunVariant, id: "medium", name: "Medium", available: false };
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "bun", name: "Bun", active: true, variants: [bunVariant, soldOut, removed] }),
        product({
          id: "roll",
          name: "Roll",
          active: false,
          variants: [{ ...bunVariant, id: "r1" }],
        }),
      ],
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    root.querySelector<HTMLElement>(".tree-toggle")!.click();
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["bun", "bun:medium", "bun:small"]);
    const small = cellUnder(root, "bun:small", t("product.status"));
    expect(small.querySelector("[data-test=active-badge]")!.getAttribute("data-active")).toBe(
      "true",
    );
    expect(small.querySelector("[data-test=unavailable-badge]")).toBeNull();
    const medium = cellUnder(root, "bun:medium", t("product.status"));
    expect(medium.querySelector("[data-test=unavailable-badge]")).not.toBeNull();

    await choose(el, "active", "inactive");
    expect(rowKeys(root)).toEqual(["bun", "bun:large", "roll"]);
    expect(
      cellUnder(root, "bun:large", t("product.status"))
        .querySelector("[data-test=active-badge]")!
        .getAttribute("data-active"),
    ).toBe("false");
    expect(
      cellUnder(root, "bun", t("product.name")).querySelector('[part~="context"]'),
    ).not.toBeNull();
    expect(
      cellUnder(root, "roll", t("product.name")).querySelector('[part~="context"]'),
    ).toBeNull();
    root.querySelector<HTMLElement>(`tr[data-row-key="roll"] .tree-toggle`)!.click();
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["bun", "bun:large", "roll", "roll:r1"]);

    await choose(el, "active", "");
    expect(rowKeys(root)).toEqual([
      "bun",
      "bun:large",
      "bun:medium",
      "bun:small",
      "roll",
      "roll:r1",
    ]);
  });

  it("prices a product across its Active variants only, or at its own price when it has none", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({
          id: "wine",
          unitPrice: "4.00",
          variants: [
            { ...bunVariant, id: "w125", name: "Wine 125", unitPrice: "4.50" },
            { ...bunVariant, id: "w175", name: "Wine 175", unitPrice: "5.50" },
            { ...bunVariant, id: "w250", name: "Wine 250", unitPrice: "9.00", active: false },
          ],
        }),
        product({
          id: "beer",
          unitPrice: "3.00",
          variants: [{ ...bunVariant, id: "pint", name: "Pint", unitPrice: "6.00", active: false }],
        }),
      ],
    });
    const root = await tableRoot(el);
    expect(
      cellUnder(root, "wine", t("product.price"))
        .querySelector('[data-test="price"]')!
        .textContent!.trim(),
    ).toBe(`${euros("4,50")}–${euros("5,50")}`);
    expect(
      cellUnder(root, "beer", t("product.price"))
        .querySelector('[data-test="price"]')!
        .textContent!.trim(),
    ).toBe(euros("3,00"));
  });

  // Every field differs between Wine 175 and its product, and its three names differ from one
  // another, so a row reading the product's values or the wrong name fails.
  it("shows a variant's own name, its effective price and main category", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({
          id: "wine",
          name: "Wine by the glass",
          unitPrice: "4.00",
          vatClass: "reduced",
          primaryCategoryId: "food",
          variants: [
            {
              ...bunVariant,
              id: "w175",
              name: "Wine 175",
              customerName: { en: "Large glass of wine", es: "Copa grande de vino" },
              kitchenName: "VINO 175",
              unitPrice: "4.75",
              effective: {
                unitPrice: "4.75",
                vatClass: "general",
                primaryCategoryId: "drinks",
              },
            },
          ],
        }),
      ],
      categories: [
        { id: "food", name: "Comida", parentId: null },
        { id: "drinks", name: "Bebidas", parentId: null },
      ],
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    await openRow(el, "folder:food");
    root.querySelector<HTMLElement>('tr[data-row-key="wine"] .tree-toggle')!.click();
    await table.updateComplete;
    const cell = (header: string) => cellUnder(root, "wine:w175", header);
    expect(cell(t("product.name")).textContent!.trim()).toBe("Wine 175");
    expect(cell(t("product.price")).querySelector('[data-test="price"]')!.textContent!.trim()).toBe(
      euros("4,75"),
    );
    expect(cell(t("editor.main_category")).textContent!.trim()).toBe("Bebidas");
    expect(cellUnder(root, "wine", t("editor.main_category")).textContent!.trim()).toBe("Comida");
  });

  it("notes a variant's VAT under its price only where it differs from its product's", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({
          id: "wine",
          unitPrice: "4.00",
          vatClass: "reduced",
          variants: [
            {
              ...bunVariant,
              id: "w175",
              name: "Wine 175",
              customerName: { en: "Large glass of wine", es: "Copa grande de vino" },
              kitchenName: "VINO 175",
              unitPrice: "4.75",
              effective: {
                unitPrice: "4.75",
                vatClass: "general",
                primaryCategoryId: "category-1",
              },
            },
            {
              ...bunVariant,
              id: "w125",
              name: "Wine 125",
              customerName: { en: "Small glass of wine", es: "Copa pequeña de vino" },
              kitchenName: "VINO 125",
              unitPrice: null,
            },
          ],
        }),
      ],
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    root.querySelector<HTMLElement>(".tree-toggle")!.click();
    await table.updateComplete;
    const note = (rowKey: string) =>
      cellUnder(root, rowKey, t("product.price")).querySelector<HTMLElement>(
        '[data-test="vat-note"]',
      );
    expect(note("wine:w175")!.textContent!.trim()).toBe(
      `${t("product.vat")}: ${vatClassName("general")}`,
    );
    expect(note("wine:w125")).toBeNull();
    expect(note("wine")).toBeNull();
    for (const [rowKey, name] of [
      ["wine:w175", "Wine 175"],
      ["wine:w125", "Wine 125"],
    ] as const)
      expect(cellUnder(root, rowKey, t("product.name")).textContent!.trim()).toBe(name);
    expect(
      cellUnder(root, "wine:w125", t("product.price"))
        .querySelector('[data-test="price"]')!
        .textContent!.trim(),
    ).toBe(euros("4,00"));
    // Cell markup lives in the table's shadow root, so only ::part reaches it.
    const style = getComputedStyle(note("wine:w175")!);
    expect(style.display).toBe("block");
    expect(style.color).not.toBe(
      getComputedStyle(cellUnder(root, "wine:w175", t("product.price"))).color,
    );
  });

  it("gives a variant row its own Edit and Remove, and Restore once it is removed", async () => {
    const removed = { ...bunVariant, id: "large", name: "Large", active: false };
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "bun", variants: [bunVariant, removed] })],
    });
    await choose(el, "active", "");
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    root.querySelector<HTMLElement>(".tree-toggle")!.click();
    await table.updateComplete;
    const actions = root.querySelector<HTMLElement>('[data-test="actions-small"]')!;
    expect(actions.tagName).toBe("WT-ROW-ACTIONS");
    expect(actions.getAttribute("label")).toBe(`${t("staff.actions")}: Small`);
    expect(actions.querySelector('[data-test="edit-small"]')!.textContent).toContain(
      t("action.edit"),
    );
    expect(actions.querySelector('[data-test="delete-small"]')!.textContent).toContain(
      t("action.remove"),
    );
    expect(actions.querySelector('[data-test="restore-small"]')).toBeNull();
    const large = root.querySelector<HTMLElement>('[data-test="actions-large"]')!;
    expect(large.querySelector('[data-test="delete-large"]')).toBeNull();
    expect(large.querySelector('[data-test="restore-large"]')!.textContent).toContain(
      t("product.restore"),
    );

    const seen: [string, string][] = [];
    for (const name of ["edit-product", "delete-product", "restore-product"])
      el.addEventListener(name, (event) =>
        seen.push([name, (event as CustomEvent<{ productId: string }>).detail.productId]),
      );
    actions.querySelector<HTMLElement>('[data-test="edit-small"]')!.click();
    actions.querySelector<HTMLElement>('[data-test="delete-small"]')!.click();
    large.querySelector<HTMLElement>('[data-test="restore-large"]')!.click();
    expect(seen).toEqual([
      ["edit-product", "small"],
      ["delete-product", "small"],
      ["restore-product", "large"],
    ]);
  });

  // The three-state allergen invariant: null=PENDING, {}=none, {…}=declared. PENDING and none MUST
  // be distinguishable — fourteen blank cells must never silently claim "allergen-free".
  it("renders a PENDING allergen pill when allergens is null", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ allergens: null })],
    });
    const pill = (await tableRoot(el)).querySelector<HTMLElement>("[data-test=allergen-state]")!;
    expect(pill.getAttribute("data-state")).toBe("pending");
    expect(pill.textContent!.trim().length).toBeGreaterThan(0);
  });

  it("renders a 'none' allergen pill when allergens is an empty map", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ allergens: {} })],
    });
    const pill = (await tableRoot(el)).querySelector<HTMLElement>("[data-test=allergen-state]")!;
    expect(pill.getAttribute("data-state")).toBe("none");
  });

  it("renders a 'declared' allergen pill when allergens has entries", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ allergens: { gluten: { presence: "contains", source: "trigo" } } })],
    });
    const pill = (await tableRoot(el)).querySelector<HTMLElement>("[data-test=allergen-state]")!;
    expect(pill.getAttribute("data-state")).toBe("declared");
  });

  it("renders each allergen-state pill with its localised name", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "p", allergens: null }),
        product({ id: "n", allergens: {} }),
        product({ id: "d", allergens: { milk: { presence: "contains" } } }),
      ],
    });
    const pills = (await tableRoot(el)).querySelectorAll<HTMLElement>("[data-test=allergen-state]");
    expect(pills[0]!.textContent!.trim()).toBe(allergenStateName("pending", "es-ES"));
    expect(pills[1]!.textContent!.trim()).toBe(allergenStateName("none", "es-ES"));
    expect(pills[2]!.textContent!.trim()).toBe(allergenStateName("declared", "es-ES"));
  });

  it("distinguishes all three allergen states from one another", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "p", allergens: null }),
        product({ id: "n", allergens: {} }),
        product({ id: "d", allergens: { milk: { presence: "contains" } } }),
      ],
    });
    const states = Array.from(
      (await tableRoot(el)).querySelectorAll<HTMLElement>("[data-test=allergen-state]"),
      (pill) => pill.getAttribute("data-state"),
    );
    expect(states).toEqual(["pending", "none", "declared"]);
    const pills = (await tableRoot(el)).querySelectorAll<HTMLElement>("[data-test=allergen-state]");
    expect(pills[0]!.textContent).not.toBe(pills[1]!.textContent);
  });

  it("renders a decorative thumbnail served from /media when image is set", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ image: "abc123.webp", name: "Croquetas" })],
    });
    const img = (await tableRoot(el)).querySelector<HTMLImageElement>("[data-test=thumb] img")!;
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe("/media/abc123.webp");
    // The adjacent strong element already names the product, so repeating it as alt text is noisy.
    expect(img.getAttribute("alt")).toBe("");
    expect((await tableRoot(el)).querySelector("[data-test=thumb-placeholder]")).toBeNull();
  });

  // The cell markup is parented in wt-data-table's shadow root, so a CSS class in this widget's
  // stylesheet reaches none of it: the thumbnail frame and the badges would render as bare inline
  // spans while every attribute assertion above still passed.
  it("paints the thumbnail frame and the badges through ::part, not a class", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ image: null, available: false })],
    });
    const root = await tableRoot(el);
    const frame = getComputedStyle(
      root.querySelector<HTMLElement>("[data-test=thumb-placeholder]")!,
    );
    expect(frame.width).not.toBe("auto");
    expect(parseFloat(frame.width)).toBeGreaterThan(0);
    expect(frame.width).toBe(frame.height);
    expect(parseFloat(frame.borderTopWidth)).toBeGreaterThan(0);
    for (const test of ["active-badge", "unavailable-badge", "ordering-badge", "allergen-state"]) {
      const badge = getComputedStyle(root.querySelector<HTMLElement>(`[data-test=${test}]`)!);
      expect(badge.display, test).toBe("inline-flex");
      expect(parseFloat(badge.borderTopWidth), test).toBeGreaterThan(0);
      expect(parseFloat(badge.paddingLeft), test).toBeGreaterThan(0);
    }
  });

  it("renders a placeholder (no <img>) when image is null", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ image: null })],
    });
    expect((await tableRoot(el)).querySelector("[data-test=thumb] img")).toBeNull();
    expect((await tableRoot(el)).querySelector("[data-test=thumb-placeholder]")).not.toBeNull();
  });

  it("emits edit-product with the product id when a row's Edit control is clicked", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "prod-42" })],
    });
    const detail = new Promise<{ productId: string }>((resolve) =>
      el.addEventListener("edit-product", (e) => resolve((e as CustomEvent).detail)),
    );
    (await tableRoot(el)).querySelector<HTMLElement>("[data-test=edit-prod-42]")!.click();
    expect((await detail).productId).toBe("prod-42");
  });

  it("emits delete-product with the product id when Delete is clicked", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "prod-42" })],
    });
    const detail = new Promise<{ productId: string }>((resolve) =>
      el.addEventListener("delete-product", (e) => resolve((e as CustomEvent).detail)),
    );
    (await tableRoot(el)).querySelector<HTMLElement>("[data-test=delete-prod-42]")!.click();
    expect((await detail).productId).toBe("prod-42");
  });

  it("emits edit-product as a bubbling, composed event", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "prod-9" })],
    });
    const seen = new Promise<Event>((resolve) => el.addEventListener("edit-product", resolve));
    (await tableRoot(el)).querySelector<HTMLElement>("[data-test=edit-prod-9]")!.click();
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  it("renders no rows for an empty products list", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", { products: [] });
    expect(productRows(await tableRoot(el)).length).toBe(0);
  });

  it.each([
    ["en-GB", "Any ordering"],
    ["es-ES", "Cualquier pedido por separado"],
  ])(
    "names the ordering filter's empty choice like the status filter's (%s)",
    async (locale, label) => {
      setLocale(locale);
      const { el } = await mountWidget<ProductList>("dashboard-product-list", {
        products: [product()],
      });
      const select = (await tableRoot(el)).querySelector<WtCombobox>(
        'wt-combobox[data-filter="ordering"]',
      )!;
      expect(select.options[0]).toEqual({ value: "", label });
    },
  );

  const kilo: Unit = {
    id: "kg",
    name: { en: "Kilogram", es: "Kilogramo" },
    abbreviation: { en: "kg", es: "kg" },
    precision: 3,
  };

  // \s+ also folds the no-break space Spanish writes before the sign.
  it.each([
    { locale: "en-GB", language: "en", each: "€19.00 each", weighed: "€48.00 / kg" },
    { locale: "es-ES", language: "es", each: "19,00 € la unidad", weighed: "48,00 € / kg" },
  ])("names the unit after each price in $locale", async ({ locale, language, each, weighed }) => {
    setLocale(locale);
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "plate", unitPrice: "19.00" }),
        product({ id: "ham", name: "Jamón", unitId: "kg", unit: kilo, unitPrice: "48.00" }),
      ],
      units: [kilo],
      unitLanguage: language,
    });
    const root = await tableRoot(el);
    const price = (key: string) =>
      cellUnder(root, key, t("product.price")).textContent!.replace(/\s+/g, " ").trim();
    expect(price("plate")).toBe(each);
    expect(price("ham")).toBe(weighed);
  });

  it("names a stored unit with no abbreviation by its name, and a variant by its product's unit", async () => {
    const tray: Unit = { id: "tray", name: { es: "bandeja" }, abbreviation: {}, precision: 0 };
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "bun", unitId: "tray", unit: tray, variants: [bunVariant] })],
      units: [tray],
      unitLanguage: "es",
    });
    const root = await tableRoot(el);
    root.querySelector<HTMLElement>('tr[data-row-key="bun"] .tree-toggle')!.click();
    await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
    const unit = (key: string) =>
      cellUnder(root, key, t("product.price"))
        .querySelector('[data-test="price-unit"]')!
        .textContent!.trim();
    expect(unit("bun")).toBe("/ bandeja");
    expect(unit("bun:small")).toBe("/ bandeja");
  });

  it("draws the unit quietly, in the muted colour and the small size", async () => {
    const { el, host } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product()],
    });
    host.style.setProperty("--wt-color-text-muted", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-font-size-sm", "11px");
    const unit = (await tableRoot(el)).querySelector<HTMLElement>('[data-test="price-unit"]')!;
    expect(unit.getAttribute("part")).toBe("price-unit");
    expect(getComputedStyle(unit).color).toBe("rgb(1, 2, 3)");
    expect(getComputedStyle(unit).fontSize).toBe("11px");
  });
});

it("drags a product outside the selection alone and never offers a variant as a drag source", async () => {
  const { el } = await mountWidget<ProductList>("dashboard-product-list", {
    products: [product({ id: "bun", variants: [bunVariant] })],
    selecting: true,
    selected: ["folder:other"],
  });
  const root = await tableRoot(el);
  const cell = root.querySelector<HTMLElement>('[part~="product-cell"]')!;
  const offered: string[][] = [];
  el.addEventListener("drag-items", (event) =>
    offered.push((event as CustomEvent<{ keys: string[] }>).detail.keys),
  );
  const start = cell.getBoundingClientRect();
  cell.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      pointerId: 1,
      clientX: start.x + 8,
      clientY: start.y + 8,
    }),
  );
  cell.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      composed: true,
      pointerId: 1,
      clientX: start.x + 8,
      clientY: start.y + 20,
    }),
  );
  expect(offered).toEqual([["bun"]]);
  cell.dispatchEvent(
    new PointerEvent("pointercancel", { bubbles: true, composed: true, pointerId: 1 }),
  );
  root.querySelector<HTMLElement>(".tree-toggle")!.click();
  const variant = (await tableRoot(el)).querySelector('tr[data-row-key="bun:small"]')!;
  expect(variant).not.toBeNull();
  const variantName = variant.querySelector("strong")!;
  variantName.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerId: 2 }),
  );
  variantName.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, composed: true, pointerId: 2, clientY: 20 }),
  );
  expect(offered.filter((keys) => keys.length)).toEqual([["bun"]]);
});

it("ignores a right-button press on a product name", async () => {
  const { el } = await mountWidget<ProductList>("dashboard-product-list", {
    products: [product({ id: "bun" })],
  });
  const cell = (await tableRoot(el)).querySelector<HTMLElement>('[part~="product-cell"]')!;
  const offered: string[][] = [];
  el.addEventListener("drag-items", (event) =>
    offered.push((event as CustomEvent<{ keys: string[] }>).detail.keys),
  );
  cell.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerId: 8, button: 2 }),
  );
  cell.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, composed: true, pointerId: 8, clientY: 40 }),
  );
  expect(offered.filter((keys) => keys.length)).toEqual([]);
  expect(cell.closest("tr")!.part.contains("dragging")).toBe(false);
});

it("does not start the browser's native image drag from a product thumbnail", async () => {
  const { el } = await mountWidget<ProductList>("dashboard-product-list", {
    products: [product({ id: "pictured", image: "abc123.webp" })],
  });
  const image = (await tableRoot(el)).querySelector<HTMLImageElement>('img[part="thumbnail"]')!;
  expect(image.draggable).toBe(false);
});

it("keeps touch scrolling on the name cell and starts a drag from its grip", async () => {
  const { el } = await mountWidget<ProductList>("dashboard-product-list", {
    products: [product({ id: "bun" })],
  });
  const cell = (await tableRoot(el)).querySelector<HTMLElement>('[part~="product-cell"]')!;
  const offered: string[][] = [];
  el.addEventListener("drag-items", (event) =>
    offered.push((event as CustomEvent<{ keys: string[] }>).detail.keys),
  );
  expect(getComputedStyle(cell).touchAction).toBe("auto");
  const grip = cell.querySelector<HTMLElement>(".drag-grip")!;
  expect(getComputedStyle(grip).touchAction).toBe("none");
  cell.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      pointerType: "touch",
      pointerId: 3,
      isPrimary: true,
    }),
  );
  cell.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      composed: true,
      pointerType: "touch",
      pointerId: 3,
      isPrimary: true,
      clientY: 30,
    }),
  );
  cell.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      composed: true,
      pointerType: "touch",
      pointerId: 3,
      isPrimary: true,
    }),
  );
  expect(offered.filter((keys) => keys.length)).toEqual([]);
  grip.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      pointerType: "touch",
      pointerId: 4,
      isPrimary: true,
    }),
  );
  grip.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      composed: true,
      pointerType: "touch",
      pointerId: 4,
      isPrimary: true,
      clientY: 30,
    }),
  );
  expect(offered.filter((keys) => keys.length)).toEqual([["bun"]]);
  grip.dispatchEvent(
    new PointerEvent("pointercancel", {
      bubbles: true,
      composed: true,
      pointerType: "touch",
      pointerId: 4,
      isPrimary: true,
    }),
  );
});

describe("the product list at phone width", () => {
  it.each(["en-GB", "es-ES"])(
    "keeps the full made-at link clear of pinned actions after scrolling at 390 px (%s)",
    async (locale) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      const before = currentLocale();
      try {
        setLocale(locale);
        await page.viewport(390, 844);
        const { el } = await mountWidget<ProductList>("dashboard-product-list", {
          products: [product({ id: "mojito" })],
          madeAt: {
            mojito: {
              stationId: "bar",
              stationName: "Downstairs bar",
              noPreparation: false,
              noReplacement: false,
              variesByZone: true,
            },
          },
        });
        const root = await tableRoot(el);
        const scroll = root.querySelector<HTMLElement>(".scroll")!;
        const cell = cellUnder(root, "mojito", t("product.made_at"));
        scroll.scrollLeft = cell.offsetLeft;
        const link = cell.querySelector("a")!;
        const actions = root.querySelector<HTMLElement>(
          'tr[data-row-key="mojito"] td[data-pinned="end"]',
        )!;
        expect(link.getBoundingClientRect().left).toBeGreaterThanOrEqual(
          scroll.getBoundingClientRect().left,
        );
        expect(link.getBoundingClientRect().right).toBeLessThanOrEqual(
          actions.getBoundingClientRect().left,
        );
        expect(link.getBoundingClientRect().height).toBeGreaterThan(30);
      } finally {
        setLocale(before);
        await page.viewport(width, height);
      }
    },
  );
  // A long unbroken product name widens the name column past a phone's screen.
  const phoneProducts = () => [
    product({ id: "a" }),
    product({ id: "b", name: "Croquetas-caseras-de-jamon-iberico-de-bellota-y-queso-azul" }),
  ];
  it.each(["en-GB", "es-ES"])(
    "keeps every product row's menu on screen and uncovered at 390 px while the other columns scroll sideways (%s)",
    async (locale) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      const before = currentLocale();
      try {
        setLocale(locale);
        await page.viewport(390, 844);
        expect(window.innerWidth).toBe(390);
        const { el } = await mountWidget<ProductList>("dashboard-product-list", {
          products: phoneProducts(),
        });
        await tableRoot(el);
        expectRowMenusOnScreen(el.shadowRoot!.querySelector("wt-data-table")!, 3);
      } finally {
        setLocale(before);
        await page.viewport(width, height);
      }
    },
  );

  it("lines each name up with the price beside it, with a thumbnail, a placeholder or neither", async () => {
    const products = [
      product({ id: "pictured", image: "abc123.webp" }),
      product({ id: "plain", variants: [{ ...bunVariant, unitPrice: "2.00" }] }),
    ];
    const { el } = await mountWidget<ProductList>("dashboard-product-list", { products });
    const root = await tableRoot(el);
    root.querySelector<HTMLButtonElement>(".tree-toggle")!.click();
    await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
    const bottom = (node: Element) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().bottom;
    };
    const keys = rowKeys(root);
    expect(keys).toHaveLength(3);
    for (const key of keys) {
      const name = cellUnder(root, key, t("product.name")).querySelector("strong")!;
      const price = cellUnder(root, key, t("product.price")).querySelector('[data-test="price"]')!;
      expect(Math.abs(bottom(name) - bottom(price)), key).toBeLessThanOrEqual(1);
    }
  });
});

describe("the product list as a tree", () => {
  it("puts every category and product under an All products row that has no arrow, cannot be selected, and counts the catalogue", async () => {
    const { root } = await mountTree({ selecting: true });
    const top = root.querySelector<HTMLElement>(`tr[data-row-key="${ROOT_KEY}"]`)!;
    expect(root.querySelector("tbody tr")).toBe(top);
    expect(top.getAttribute("aria-level")).toBe("1");
    expect(top.getAttribute("aria-expanded")).toBe("true");
    expect(top.querySelector(".tree-toggle, .tree-arrow, .row-activate")).toBeNull();
    expect(top.querySelector('input[type="checkbox"]')).toBeNull();
    expect(top.textContent).toContain(t("folders.all_products"));
    expect(top.querySelector('[data-test="count-root"]')!.textContent!.trim()).toBe(counted(3, 3));
    expect(rowKeys(root)).toEqual(["folder:d", "folder:f", "bread"]);
    expect(root.querySelector('tr[data-row-key="bread"]')!.getAttribute("aria-level")).toBe("2");
  });

  it("nests a category's subcategories, then its products, under it, whichever column sorts the table", async () => {
    const { el, root, table } = await mountTree();
    await openRow(el, "folder:d");
    expect(rowKeys(root)).toEqual(["folder:d", "folder:b", "cola", "folder:f", "bread"]);
    expect(root.querySelector('tr[data-row-key="folder:b"]')!.getAttribute("aria-level")).toBe("3");
    root.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["folder:f", "folder:d", "folder:b", "cola", "bread"]);
    root.querySelector<HTMLButtonElement>('button[data-sort="price"]')!.click();
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["folder:d", "folder:b", "cola", "folder:f", "bread"]);
  });

  it("names what a category holds: its subcategories and its Active products", async () => {
    const { root } = await mountTree();
    const count = (id: string) =>
      root.querySelector(`[data-test="count-${id}"]`)!.textContent!.trim();
    expect(count("d")).toBe(counted(1, 1));
    expect(count("f")).toBe(counted(0, 0));
  });

  it("opens and closes a category from a click or Enter on its row, saying which it will do", async () => {
    const { el, root, table } = await mountTree();
    const activator = () =>
      root.querySelector<HTMLButtonElement>('tr[data-row-key="folder:d"] .row-activate')!;
    expect(activator().getAttribute("aria-label")).toBe(
      t("folders.open_named").replace("{name}", "Drinks"),
    );
    await openRow(el, "folder:d");
    expect(rowKeys(root)).toContain("cola");
    expect(activator().getAttribute("aria-label")).toBe(
      t("folders.close_named").replace("{name}", "Drinks"),
    );
    activator().focus();
    await userEvent.keyboard("{Enter}");
    await table.updateComplete;
    expect(rowKeys(root)).not.toContain("cola");
    expect(root.querySelector('tr[data-row-key="folder:d"] .tree-arrow')!.textContent!.trim()).toBe(
      "▸",
    );
  });

  it("reports a person opening or closing a category, and nothing for a product's variants", async () => {
    const { el, root, table } = await mountTree({
      products: [
        ...treeProducts(),
        product({ id: "bun", name: "Bun", primaryCategoryId: null, variants: [bunVariant] }),
      ],
    });
    const toggles: unknown[] = [];
    el.addEventListener("category-toggle", (event) => toggles.push((event as CustomEvent).detail));
    const raw = vi.fn();
    el.addEventListener("wt-expand-change", raw);
    await openRow(el, "folder:d");
    await openRow(el, "folder:d");
    root.querySelector<HTMLButtonElement>('tr[data-row-key="bun"] .tree-toggle')!.click();
    await table.updateComplete;
    expect(toggles).toEqual([
      { categoryId: "d", open: true },
      { categoryId: "d", open: false },
    ]);
    expect(raw).not.toHaveBeenCalled();
  });

  it("remembers which categories are open when the list is drawn again", async () => {
    const first = await mountTree();
    await openRow(first.el, "folder:d");
    cleanupWidgets();
    const second = await mountTree();
    expect(rowKeys(second.root)).toEqual(["folder:d", "folder:b", "cola", "folder:f", "bread"]);
  });

  it("lifts nothing for a press on a row's own control, on the All products row, or outside every row", async () => {
    const { el, root } = await mountTree();
    const offered: string[][] = [];
    el.addEventListener("drag-items", (event) =>
      offered.push((event as CustomEvent<{ keys: string[] }>).detail.keys),
    );
    const press = (target: Element, pointerId: number) => {
      for (const [type, clientY] of [
        ["pointerdown", 0],
        ["pointermove", 40],
        ["pointercancel", 40],
      ] as const)
        target.dispatchEvent(
          new PointerEvent(type, { bubbles: true, composed: true, pointerId, clientY }),
        );
    };
    press(root.querySelector('[data-test="actions-bread"]')!, 1);
    press(root.querySelector(`tr[data-row-key="${ROOT_KEY}"] [part~="folder-cell"]`)!, 2);
    press(root.querySelector("thead th")!, 3);
    expect(offered).toEqual([]);
    press(root.querySelector('tr[data-row-key="bread"] [part~="product-cell"]')!, 4);
    expect(offered).toEqual([["bread"], []]);
  });

  it("opens the category it is asked to reveal, and every category above it", async () => {
    const { el, root } = await mountTree();
    await el.revealCategory("b");
    expect(rowKeys(root)).toEqual(["folder:d", "folder:b", "lager", "cola", "folder:f", "bread"]);
  });

  it("a search keeps the categories above a match open, finds a product by a variant's name, and clearing it restores what was open", async () => {
    const { el, root, table } = await mountTree({
      products: [
        ...treeProducts(),
        product({
          id: "bun",
          name: "Bun",
          primaryCategoryId: "b",
          variants: [{ ...bunVariant, name: "Large cup" }],
        }),
      ],
    });
    await openRow(el, "folder:d");
    el.search = "cup";
    await el.updateComplete;
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["folder:d", "folder:b", "bun"]);
    root.querySelector<HTMLButtonElement>('tr[data-row-key="bun"] .tree-toggle')!.click();
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["folder:d", "folder:b", "bun", "bun:small"]);
    el.search = "";
    await el.updateComplete;
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["folder:d", "folder:b", "cola", "folder:f", "bread"]);
  });

  const menuItems = (menu: Element) =>
    [...menu.children].map((child) => (child.localName === "hr" ? "—" : child.textContent!.trim()));

  it("opens a product from a click or Enter on its row, and a variant from its own row", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "bun", variants: [bunVariant] })],
    });
    const opened: string[] = [];
    el.addEventListener("edit-product", (event) =>
      opened.push((event as CustomEvent<{ productId: string }>).detail.productId),
    );
    const root = await tableRoot(el);
    const activator = (key: string) =>
      root.querySelector<HTMLButtonElement>(`tr[data-row-key="${key}"] .row-activate`)!;
    expect(activator("bun").getAttribute("aria-label")).toBe(
      `${t("action.edit")}: Croquetas de jamón`,
    );
    activator("bun").click();
    activator("bun").focus();
    await userEvent.keyboard("{Enter}");
    root.querySelector<HTMLElement>('tr[data-row-key="bun"] .tree-toggle')!.click();
    await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
    activator("bun:small").click();
    expect(opened).toEqual(["bun", "bun", "small"]);
  });

  it("opens nothing from a click on a product's grip, its menu button or its selection box", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "bun" })],
      selecting: true,
    });
    const opened = vi.fn();
    el.addEventListener("edit-product", opened);
    const row = (await tableRoot(el)).querySelector('tr[data-row-key="bun"]')!;
    await userEvent.click(row.querySelector<HTMLElement>(".drag-grip")!);
    await userEvent.click(row.querySelector<HTMLElement>("wt-row-actions")!);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(row.querySelector<HTMLElement>('input[type="checkbox"]')!);
    expect(opened).not.toHaveBeenCalled();
  });

  it("opens nothing when a drag of a product is released on its own row", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "bun" }), product({ id: "roll", name: "Roll" })],
    });
    const opened = vi.fn();
    el.addEventListener("edit-product", opened);
    const root = await tableRoot(el);
    const own = root.querySelector<HTMLElement>('tr[data-row-key="bun"] .row-activate')!;
    const other = root.querySelector<HTMLElement>('tr[data-row-key="roll"] .row-activate')!;
    const at = (target: HTMLElement, from: HTMLElement, type: string) => {
      const box = from.getBoundingClientRect();
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          composed: true,
          pointerId: 1,
          clientX: box.x + 4,
          clientY: box.y + 4,
        }),
      );
    };
    at(own, own, "pointerdown");
    at(own, other, "pointermove");
    at(own, own, "pointermove");
    at(own, own, "pointerup");
    own.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));
    expect(opened).not.toHaveBeenCalled();
  });

  it("offers Add product and Add category on All products, and those, a divider, Rename, Move to… and Delete on a category", async () => {
    const { root } = await mountTree();
    const all = root.querySelector('[data-test="actions-root"]')!;
    expect(all.getAttribute("label")).toBe(`${t("staff.actions")}: ${t("folders.all_products")}`);
    expect(menuItems(all)).toEqual([t("catalogue.add_product"), t("folders.add_category")]);
    expect(menuItems(root.querySelector('[data-test="actions-folder-d"]')!)).toEqual([
      t("catalogue.add_product"),
      t("folders.add_category"),
      "—",
      t("folders.rename"),
      t("folders.move"),
      t("action.delete"),
    ]);
  });

  it("asks for a product or a category inside the row whose menu was used", async () => {
    const { el, root } = await mountTree({ canAddProduct: true });
    const asked: unknown[] = [];
    for (const name of ["add-product", "add-category", "move-folder"])
      el.addEventListener(name, (event) => asked.push([name, (event as CustomEvent).detail]));
    for (const test of [
      "add-product-root",
      "add-category-root",
      "add-product-d",
      "add-category-d",
      "move-d",
    ])
      root.querySelector<HTMLElement>(`[data-test="${test}"]`)!.click();
    expect(asked).toEqual([
      ["add-product", { categoryId: null }],
      ["add-category", { parentId: null }],
      ["add-product", { categoryId: "d" }],
      ["add-category", { parentId: "d" }],
      ["move-folder", { folderId: "d" }],
    ]);
  });

  it("keeps every Add product disabled, and sends nothing, while products cannot be added yet", async () => {
    const { el, root, table } = await mountTree();
    const asked = vi.fn();
    el.addEventListener("add-product", asked);
    const items = () => [...root.querySelectorAll<HTMLElement>('[data-test^="add-product-"]')];
    expect(items().map((item) => item.hasAttribute("disabled"))).toEqual([true, true, true]);
    items()[0]!.click();
    expect(asked).not.toHaveBeenCalled();
    el.canAddProduct = true;
    await el.updateComplete;
    await table.updateComplete;
    expect(items().map((item) => item.hasAttribute("disabled"))).toEqual([false, false, false]);
  });

  it("puts focus on a row's menu button when asked", async () => {
    const { el, root } = await mountTree();
    el.focusRowMenu("d");
    expect(root.activeElement).toBe(root.querySelector('[data-test="actions-folder-d"]'));
    el.focusRowMenu(null);
    expect(root.activeElement).toBe(root.querySelector('[data-test="actions-root"]'));
  });

  it("reveals a product by opening every category above it", async () => {
    const { el, root } = await mountTree();
    await el.revealProduct("lager");
    expect(rowKeys(root)).toEqual(["folder:d", "folder:b", "lager", "cola", "folder:f", "bread"]);
  });

  it.each(["en-GB", "es-ES"])(
    "keeps every row's menu on screen and uncovered at 390 px, three categories deep (%s)",
    async (locale) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      const before = currentLocale();
      try {
        setLocale(locale);
        await page.viewport(390, 844);
        const { el } = await mountWidget<ProductList>("dashboard-product-list", {
          categories: [drinks, beer, { id: "k", name: "Kegs", parentId: "b" }],
          products: [
            product({
              id: "keg",
              name: "Cerveza-de-barril-artesana-de-temporada-con-nombre-largo",
              primaryCategoryId: "k",
            }),
          ],
        });
        await el.revealCategory("k");
        const table = el.shadowRoot!.querySelector("wt-data-table")!;
        expectRowMenusOnScreen(table, 5);
        // The table learns its width from a ResizeObserver, which reports after the next layout.
        await vi.waitFor(() => expect(table.hasAttribute("narrow")).toBe(true));
        // The phone indent: half a step a level, measured where a 390 px screen puts the list.
        const indent = (key: string) =>
          getComputedStyle(
            table.shadowRoot!.querySelector<HTMLElement>(`tr[data-row-key="${key}"] .tree-cell`)!,
          ).paddingInlineStart;
        expect(["folder:d", "folder:k", "keg"].map(indent)).toEqual(["8px", "24px", "32px"]);
      } finally {
        setLocale(before);
        await page.viewport(width, height);
      }
    },
  );

  it("puts a new category's name box inside the category it is added to, opened, holding the cursor", async () => {
    const { el, root } = await mountTree();
    el.nameDraft = { kind: "create", parentId: "d" };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    expect(rowKeys(root)).toEqual([
      "folder:d",
      "folder:b",
      "draft:new",
      "cola",
      "folder:f",
      "bread",
    ]);
    expect(root.querySelector('tr[data-row-key="draft:new"]')!.getAttribute("aria-level")).toBe(
      "3",
    );
    const box = root.querySelector('tr[data-row-key="draft:new"] wt-input')!;
    expect(box.getAttribute("part")).toBe("name-box");
    expect(box.getAttribute("label")).toBe(t("folders.name"));
  });

  it("lines a new category's folder icon up with its sibling categories' icons", async () => {
    const { el, root } = await mountTree();
    el.nameDraft = { kind: "create", parentId: null };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    const iconLeft = (key: string) =>
      root
        .querySelector(`tr[data-row-key="${key}"] wt-icon[name="folder"]`)!
        .getBoundingClientRect().left;
    expect(iconLeft("draft:new")).toBe(iconLeft("folder:d"));
    expect(iconLeft("draft:new")).toBe(iconLeft("folder:f"));
  });

  it("sends the typed name, trimmed, on Enter or on leaving the box, and a cancel on Esc or on leaving it blank", async () => {
    const { el } = await mountTree();
    const sent: unknown[] = [];
    el.addEventListener("name-commit", (event) => sent.push((event as CustomEvent).detail));
    el.addEventListener("name-cancel", () => sent.push("cancel"));
    const start = async (parentId: string | null) => {
      el.nameDraft = null;
      await el.updateComplete;
      el.nameDraft = { kind: "create", parentId };
      await el.updateComplete;
      await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    };
    await start(null);
    await userEvent.keyboard("  Juice  {Enter}");
    await start(null);
    await userEvent.keyboard("Tea{Tab}");
    await start("d");
    await userEvent.keyboard("Tea{Escape}");
    await start("d");
    await userEvent.keyboard("{Tab}");
    expect(sent).toEqual([{ name: "Juice" }, { name: "Tea" }, "cancel", "cancel"]);
  });

  it("sends a name once, shows a refusal under the box, and then lets Enter send again", async () => {
    const { el, root } = await mountTree();
    const sent: unknown[] = [];
    el.addEventListener("name-commit", (event) => sent.push((event as CustomEvent).detail));
    el.nameDraft = { kind: "create", parentId: null };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    await userEvent.keyboard("Juice{Enter}{Enter}");
    expect(sent).toEqual([{ name: "Juice" }]);
    el.nameError = "That name is taken.";
    await el.updateComplete;
    const box = root.querySelector<HTMLElementTagNameMap["wt-input"]>(
      'wt-input[name="category-name"]',
    )!;
    await box.updateComplete;
    expect(box.shadowRoot!.querySelector("[data-error]")!.textContent).toBe("That name is taken.");
    await userEvent.keyboard("{Enter}");
    expect(sent).toEqual([{ name: "Juice" }, { name: "Juice" }]);
  });

  it("turns a category's name into the box, holding its name, for a rename", async () => {
    const { el, root } = await mountTree();
    el.nameDraft = { kind: "rename", categoryId: "d" };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    const row = root.querySelector('tr[data-row-key="folder:d"]')!;
    expect(row.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!.value).toBe("Drinks");
    expect(row.querySelector("strong")).toBeNull();
    expect(row.querySelector(".row-activate")).toBeNull();
  });

  it("sends a cancel on Enter in a blank box, and nothing more once a name is sent", async () => {
    const { el } = await mountTree();
    const sent: unknown[] = [];
    el.addEventListener("name-commit", (event) => sent.push((event as CustomEvent).detail));
    el.addEventListener("name-cancel", () => sent.push("cancel"));
    el.nameDraft = { kind: "create", parentId: null };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    await userEvent.keyboard("   {Enter}");
    el.nameDraft = null;
    await el.updateComplete;
    el.nameDraft = { kind: "create", parentId: "d" };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    await userEvent.keyboard("Juice{Enter}{Escape}{Tab}");
    expect(sent).toEqual(["cancel", { name: "Juice" }]);
  });

  it("sends nothing for a box that loses the cursor because another box replaced it", async () => {
    const { el } = await mountTree();
    const sent: unknown[] = [];
    el.addEventListener("name-commit", (event) => sent.push((event as CustomEvent).detail));
    el.addEventListener("name-cancel", () => sent.push("cancel"));
    el.nameDraft = { kind: "create", parentId: null };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    el.nameDraft = { kind: "rename", categoryId: "d" };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    expect(sent).toEqual([]);
  });

  it("closes a category's menu when Rename is chosen from it", async () => {
    const { el, root } = await mountTree();
    const renames: unknown[] = [];
    el.addEventListener("rename-folder", (event) => renames.push((event as CustomEvent).detail));
    const menu = root.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
      '[data-test="actions-folder-d"]',
    )!;
    menu.show();
    const popup = menu.shadowRoot!.querySelector("[popover]")!;
    expect(popup.matches(":popover-open")).toBe(true);
    root.querySelector<HTMLElement>('[data-test="rename-d"]')!.click();
    expect(renames).toEqual([{ folderId: "d" }]);
    expect(popup.matches(":popover-open")).toBe(false);
  });

  it("a rename's box sends a cancel on Esc, and on leaving it blank", async () => {
    const { el } = await mountTree();
    const sent: unknown[] = [];
    el.addEventListener("name-commit", (event) => sent.push((event as CustomEvent).detail));
    el.addEventListener("name-cancel", () => sent.push("cancel"));
    const rename = async () => {
      el.nameDraft = null;
      await el.updateComplete;
      el.nameDraft = { kind: "rename", categoryId: "d" };
      await el.updateComplete;
      await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    };
    await rename();
    await userEvent.keyboard("Beverages{Escape}");
    await rename();
    await userEvent.keyboard("{Backspace}{Tab}");
    expect(sent).toEqual(["cancel", "cancel"]);
  });

  it("opens the All products menu, without moving focus, when the catalogue loads empty, and only that once", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    onTestFinished(() => outside.remove());
    outside.focus();
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [],
      categories: [],
      loaded: true,
    });
    const menu = (await tableRoot(el)).querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
      '[data-test="actions-root"]',
    )!;
    const popup = () => menu.shadowRoot!.querySelector("[popover]")!;
    await vi.waitFor(() => expect(popup().matches(":popover-open")).toBe(true));
    expect(document.activeElement).toBe(outside);
    menu.hide();
    el.products = [];
    await el.updateComplete;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(popup().matches(":popover-open")).toBe(false);
  });

  it("leaves the menu closed before the catalogue has loaded, and for one with something in it", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [],
      categories: [],
    });
    const popup = async () =>
      (await tableRoot(el))
        .querySelector('[data-test="actions-root"]')!
        .shadowRoot!.querySelector("[popover]")!;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect((await popup()).matches(":popover-open")).toBe(false);
    el.products = [product()];
    el.loaded = true;
    await el.updateComplete;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect((await popup()).matches(":popover-open")).toBe(false);
  });
});
