import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { WtCombobox } from "@waitron/ui";
import {
  chooseOption,
  chooseOptions,
  expectRowMenusOnScreen,
} from "@waitron/ui/src/test-helpers.js";
import { allergenStateName, vatClassName } from "../i18n/domain.js";
import type { Product, Unit } from "../api/client.js";
import type { ListedVariant } from "@waitron/catalogue/src/product-types.js";
import { EACH_UNIT_ID } from "@waitron/catalogue/src/unit-validation.js";
import { ProductList, ROOT_KEY } from "./product-list.js";
import type { FolderMadeAt } from "./folder-made-at.js";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);
afterEach(() => setLocale("es"));
// The table remembers its sort and filter choices in sessionStorage under waitron.products.table, so
// a choice one test makes would otherwise be restored into the next one.
beforeEach(async () => {
  await page.viewport(1280, 844);
  sessionStorage.clear();
  localStorage.removeItem("waitron.products.table:columns");
  localStorage.removeItem("waitron.products.table:expanded");
  localStorage.removeItem("waitron.products.table:column-order");
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

const drinks = { id: "d", name: "Drinks", parentId: null, color: null };
const beer = { id: "b", name: "Beer", parentId: "d", color: null };
const food = { id: "f", name: "Food", parentId: null, color: null };

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

/** A list is every value ticked in a multi-select filter; a string is a single-choice filter's. */
async function choose(el: ProductList, column: string, value: string | string[]): Promise<void> {
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  const select = table.shadowRoot!.querySelector<HTMLElement>(
    `wt-combobox[data-filter="${column}"]`,
  )!;
  if (typeof value === "string") await chooseOption(select, value);
  else await chooseOptions(select, value);
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
    color: null,
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
      "No replacement (Cocktail bar is disabled)",
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
  it("leaves a product's cell blank, without a link, when the made-at read has no entry for it", async () => {
    setLocale("en");
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "lager" }), product({ id: "ale", active: false })],
      madeAt: {
        lager: {
          stationId: "bar",
          stationName: "Bar",
          noPreparation: false,
          noReplacement: false,
          variesByZone: false,
        },
      },
    });
    const root = await tableRoot(el);
    await choose(el, "active", "");
    const cell = cellUnder(root, "ale", "Made at");
    expect(cell.textContent!.trim()).toBe("");
    expect(cell.querySelector("a")).toBeNull();
    expect(cellUnder(root, "lager", "Made at").textContent).toContain("Bar");
  });
  it("says nowhere, with the tester link, for a product the made-at read routes to no station", async () => {
    setLocale("en");
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "bread" })],
      madeAt: {
        bread: {
          stationId: null,
          stationName: null,
          noPreparation: false,
          noReplacement: false,
          variesByZone: false,
        },
      },
    });
    const root = await tableRoot(el);
    const cell = cellUnder(root, "bread", "Made at");
    expect(cell.textContent!.trim()).toBe("Nowhere");
    expect(cell.querySelector("a")?.getAttribute("href")).toBe("/manage/prep-stations/test/bread");
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
    expect(root.querySelector(".columns-trigger")?.getAttribute("aria-label")).toBe(
      t("table.customise_columns"),
    );
    expect(
      [...root.querySelectorAll<HTMLInputElement>("input[data-column]")].map((box) => [
        box.dataset.column,
        box.checked,
      ]),
    ).toEqual([
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

  it("uses a named kebab menu containing Edit and Archive", async () => {
    const products = [product({ id: "p7", name: "Tarta de queso" })];
    const { el } = await mountWidget<ProductList>("dashboard-product-list", { products });
    const actions = (await tableRoot(el)).querySelector<HTMLElement>('[data-test="actions-p7"]')!;
    expect(actions.tagName).toBe("WT-ROW-ACTIONS");
    expect(actions.getAttribute("label")).toContain("Tarta de queso");
    expect(actions.querySelector('[data-test="edit-p7"]')?.textContent).toContain(t("action.edit"));
    expect(actions.querySelector('[data-test="delete-p7"]')?.textContent).toContain(
      t("product.archive"),
    );
  });

  it("shows a product price, or the range across its variants", async () => {
    const products = [
      product({ id: "plain", unitPrice: "12.5", pricingUnit: "weight" }),
      product({
        id: "with-variants",
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
              id: "with-variants",
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
        expect(price("with-variants")).toBe(want.range);
        root.querySelector<HTMLElement>(".tree-toggle")!.click();
        await table.updateComplete;
        expect(price("with-variants:large")).toBe(want.variant);
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
            { ...bunVariant, id: "w125", name: "125 ml", unitPrice: null },
            { ...bunVariant, id: "w175", name: "175 ml", unitPrice: "5.50" },
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
  it("shows attached modifier list names, and no main category, VAT or labels column", async () => {
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
        { id: "reporting", name: "Comida", parentId: null, color: null },
        { id: "seasonal", name: "Temporada", parentId: null, color: null },
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
    expect(headers).not.toContain(t("editor.main_category"));
    expect(headers).toContain(t("editor.modifiers"));
    expect(headers).not.toContain(t("product.vat"));
    expect(headers).not.toContain("Etiquetas");
    expect(root.querySelector('input[data-column="labels"]')).toBeNull();
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

  it("shows a visible placeholder for an unresolved modifier list id, and none for a category the list does not hold", async () => {
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
    expect(text.match(new RegExp(t("editor.missing_choice"), "g"))).toHaveLength(1);
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

  it("narrows the list to the products of the orderings chosen", async () => {
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
    await choose(el, "ordering", ["not_sold_separately"]);
    expect(rowKeys(root)).toEqual(["c-topping"]);
    await choose(el, "ordering", ["not_sold_separately", "staff_only"]);
    expect(rowKeys(root)).toEqual(["b-staff", "c-topping"]);
    await choose(el, "ordering", ["public"]);
    expect(rowKeys(root)).toEqual(["a-dish"]);
    await choose(el, "ordering", []);
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
    await choose(el, "ordering", ["not_sold_separately"]);
    expect(rowKeys(root)).toEqual(["bun"]);
    root.querySelector<HTMLElement>(".tree-toggle")!.click();
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["bun", "bun:small"]);
    await choose(el, "ordering", ["public"]);
    expect(rowKeys(root)).toEqual(["dish"]);
  });

  it("lets Ordering hold several choices and keeps Status a single one, naming two orderings by their count", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: orderings(),
    });
    const root = await tableRoot(el);
    const select = (key: string) =>
      root.querySelector<WtCombobox>(`wt-combobox[data-filter="${key}"]`)!;
    expect([select("ordering").multiple, select("active").multiple]).toEqual([true, false]);
    await choose(el, "ordering", ["public", "staff_only"]);
    expect(select("ordering").shadowRoot!.querySelector(".value")!.textContent!.trim()).toBe(
      "2 opciones de pedido",
    );
  });

  it("leaves a variant row's ordering cell empty", async () => {
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
    expect(cell.textContent!.trim()).toBe("");
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
      t("product.archived_badge"),
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
    expect(rowKeys(root)).toEqual(["bun", "bun:small", "bun:medium"]);
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
      "bun:small",
      "bun:medium",
      "bun:large",
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
            { ...bunVariant, id: "w125", name: "125 ml", unitPrice: "4.50" },
            { ...bunVariant, id: "w175", name: "175 ml", unitPrice: "5.50" },
            { ...bunVariant, id: "w250", name: "250 ml", unitPrice: "9.00", active: false },
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

  // Its name and price differ from its product's, and its three names differ from one another, so a
  // row reading the product's values or the wrong name fails.
  it("shows a variant's own name and effective price", async () => {
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
              name: "175 ml",
              customerName: { en: "Large glass of wine", es: "Copa grande de vino" },
              kitchenName: "VINO 175",
              unitPrice: "4.75",
              effective: {
                unitPrice: "4.75",
                vatClass: "general",
                primaryCategoryId: "food",
              },
            },
          ],
        }),
      ],
      categories: [
        { id: "food", name: "Comida", parentId: null, color: null },
        { id: "drinks", name: "Bebidas", parentId: null, color: null },
      ],
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    await openRow(el, "folder:food");
    root.querySelector<HTMLElement>('tr[data-row-key="wine"] .tree-toggle')!.click();
    await table.updateComplete;
    const cell = (header: string) => cellUnder(root, "wine:w175", header);
    expect(cell(t("product.name")).textContent!.trim()).toBe("175 ml");
    expect(cell(t("product.price")).querySelector('[data-test="price"]')!.textContent!.trim()).toBe(
      euros("4,75"),
    );
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
              name: "175 ml",
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
              name: "125 ml",
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
      ["wine:w175", "175 ml"],
      ["wine:w125", "125 ml"],
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

  it.each([
    [
      "en-GB",
      {
        disable: "Archive",
        enable: "View",
        products: ["Active", "Archived"],
        variants: ["Active", "Archived"],
        filter: ["Any status", "Active", "Archived"],
      },
    ],
    [
      "es-ES",
      {
        disable: "Archivar",
        enable: "Ver",
        products: ["Activo", "Archivado"],
        variants: ["Activa", "Archivada"],
        filter: ["Cualquier estado", "Activo", "Archivado"],
      },
    ],
  ])(
    "in %s, offers Archive and View and shows Active or Archived, agreeing with the noun",
    async (locale, words) => {
      setLocale(locale);
      const removed = { ...bunVariant, id: "large", name: "Large", active: false };
      const { el } = await mountWidget<ProductList>("dashboard-product-list", {
        products: [
          product({ id: "bun", variants: [bunVariant, removed] }),
          product({ id: "off", name: "Anchoas", active: false }),
        ],
      });
      await choose(el, "active", "");
      const table = el.shadowRoot!.querySelector("wt-data-table")!;
      const root = await tableRoot(el);
      root.querySelector<HTMLElement>('tr[data-row-key="bun"] .tree-toggle')!.click();
      await table.updateComplete;
      const label = (test: string) =>
        root.querySelector<HTMLElement>(`[data-test="${test}"]`)!.textContent!.trim();
      expect(label("delete-bun")).toBe(words.disable);
      expect(label("delete-small")).toBe(words.disable);
      expect(label("view-large")).toBe(words.enable);
      expect(label("view-off")).toBe(words.enable);
      const badge = (key: string) =>
        root
          .querySelector<HTMLElement>(`tr[data-row-key="${key}"] [data-test=active-badge]`)!
          .textContent!.trim();
      expect([badge("bun"), badge("off")]).toEqual(words.products);
      expect([badge("bun:small"), badge("bun:large")]).toEqual(words.variants);
      const select = root.querySelector<WtCombobox>('wt-combobox[data-filter="active"]')!;
      expect(select.options.map((option) => option.label)).toEqual(words.filter);
    },
  );

  it("gives an active variant Edit and Archive, and an archived variant only View", async () => {
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
      t("product.archive"),
    );
    expect(actions.querySelector('[data-test="view-small"]')).toBeNull();
    const large = root.querySelector<HTMLElement>('[data-test="actions-large"]')!;
    expect(large.querySelector('[data-test="delete-large"]')).toBeNull();
    expect(large.querySelectorAll("wt-button")).toHaveLength(1);
    expect(large.querySelector('[data-test="view-large"]')!.textContent).toContain(
      t("product.view"),
    );

    const seen: [string, string][] = [];
    for (const name of ["edit-product", "delete-product", "view-product"])
      el.addEventListener(name, (event) =>
        seen.push([name, (event as CustomEvent<{ productId: string }>).detail.productId]),
      );
    actions.querySelector<HTMLElement>('[data-test="edit-small"]')!.click();
    actions.querySelector<HTMLElement>('[data-test="delete-small"]')!.click();
    large.querySelector<HTMLElement>('[data-test="view-large"]')!.click();
    expect(seen).toEqual([
      ["edit-product", "small"],
      ["delete-product", "small"],
      ["view-product", "large"],
    ]);
  });

  it("under an archived product, every variant offers View only", async () => {
    const removed = { ...bunVariant, id: "large", name: "Large", active: false };
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "off", name: "Anchoas", active: false, variants: [bunVariant, removed] }),
      ],
    });
    await choose(el, "active", "");
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    root.querySelector<HTMLElement>('tr[data-row-key="off"] .tree-toggle')!.click();
    await table.updateComplete;
    for (const id of ["off", "large", "small"]) {
      const actions = root.querySelector<HTMLElement>(`[data-test="actions-${id}"]`)!;
      expect(
        [...actions.querySelectorAll("wt-button")].map((button) => button.textContent!.trim()),
      ).toEqual([t("product.view")]);
      expect(actions.querySelector(`[data-test="view-${id}"]`)).not.toBeNull();
      expect(
        root
          .querySelector(
            `tr[data-row-key="${id === "off" ? id : `off:${id}`}"] [data-test=active-badge]`,
          )
          ?.getAttribute("data-active"),
      ).toBe("false");
    }
  });

  it("offers only View on an archived product and Edit and Archive on an active one", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "bun" }), product({ id: "off", name: "Anchoas", active: false })],
    });
    await choose(el, "active", "");
    const root = await tableRoot(el);
    const off = root.querySelector<HTMLElement>('[data-test="actions-off"]')!;
    expect(off.querySelector('[data-test="delete-off"]')).toBeNull();
    expect(off.querySelectorAll("wt-button")).toHaveLength(1);
    expect(off.querySelector('[data-test="view-off"]')!.textContent).toContain(t("product.view"));
    const bun = root.querySelector<HTMLElement>('[data-test="actions-bun"]')!;
    expect(bun.querySelector('[data-test="restore-bun"]')).toBeNull();
    expect(bun.querySelector('[data-test="delete-bun"]')!.textContent).toContain(
      t("product.archive"),
    );

    const seen: [string, string][] = [];
    for (const name of ["delete-product", "view-product"])
      el.addEventListener(name, (event) =>
        seen.push([name, (event as CustomEvent<{ productId: string }>).detail.productId]),
      );
    off.querySelector<HTMLElement>('[data-test="view-off"]')!.click();
    expect(seen).toEqual([["view-product", "off"]]);
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
        product({
          id: "plate",
          unitPrice: "19.00",
          unitId: EACH_UNIT_ID,
          unit: { ...product().unit, id: EACH_UNIT_ID },
        }),
        product({ id: "ham", name: "Jamón", unitId: "kg", unit: kilo, unitPrice: "48.00" }),
      ],
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

  it("names a measured unit after its price from the product's own unit", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "ham", unitId: "kg", unit: kilo, unitPrice: "48.00" })],
      unitLanguage: "en",
    });
    const unit = cellUnder(await tableRoot(el), "ham", t("product.price"))
      .querySelector('[data-test="price-unit"]')!
      .textContent!.trim();
    expect(unit).toBe("/ kg");
  });

  it("calls a product sold by the Each unit 'each', by the unit's identity", async () => {
    const each: Unit = {
      id: EACH_UNIT_ID,
      name: { en: "Each" },
      abbreviation: { en: "ea" },
      precision: 0,
    };
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "plate", unitId: EACH_UNIT_ID, unit: each })],
      unitLanguage: "en",
    });
    const unit = cellUnder(await tableRoot(el), "plate", t("product.price"))
      .querySelector('[data-test="price-unit"]')!
      .textContent!.trim();
    expect(unit).toBe(t("product.price_each"));
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
  const variantName = variant.querySelector('[part~="variant-name"]')!;
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
  const grip = cell.closest("tr")!.querySelector<HTMLElement>(".drag-grip")!;
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
    "keeps a category's made-at link and its detail clear of pinned actions after scrolling at 390 px (%s)",
    async (locale) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      const before = currentLocale();
      try {
        setLocale(locale);
        await page.viewport(390, 844);
        const { el } = await mountWidget<ProductList>("dashboard-product-list", {
          categories: [drinks],
          folderMadeAt: new Map<string, FolderMadeAt>([
            [
              "d",
              {
                maker: { kind: "no_replacement", stationName: "Downstairs cocktail bar" },
                source: { kind: "inherited", name: "Bebidas-y-cocteles-de-la-casa" },
                someElsewhere: true,
              },
            ],
          ]),
        });
        const root = await tableRoot(el);
        const scroll = root.querySelector<HTMLElement>(".scroll")!;
        const cell = cellUnder(root, "folder:d", t("product.made_at"));
        scroll.scrollLeft = cell.offsetLeft;
        const actions = root.querySelector<HTMLElement>(
          'tr[data-row-key="folder:d"] td[data-pinned="end"]',
        )!;
        for (const part of [
          cell.querySelector("a")!,
          cell.querySelector('[part~="maker-detail"]')!,
        ]) {
          const box = part.getBoundingClientRect();
          expect(box.left).toBeGreaterThanOrEqual(scroll.getBoundingClientRect().left);
          expect(box.right).toBeLessThanOrEqual(actions.getBoundingClientRect().left);
        }
      } finally {
        setLocale(before);
        await page.viewport(width, height);
      }
    },
  );
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
        expectRowMenusOnScreen(
          el.shadowRoot!.querySelector("wt-data-table")!,
          3,
          'wt-row-actions[data-test^="actions-"]',
        );
      } finally {
        setLocale(before);
        await page.viewport(width, height);
      }
    },
  );

  it.each(
    ["en-GB", "es-ES"].flatMap((locale) =>
      ["category.name_taken", "category.invalid"].flatMap((code) =>
        ["f", "b"].map((categoryId) => ({ locale, code, categoryId })),
      ),
    ),
  )(
    "shows a rename's whole refusal beside the pinned actions at 390 px without scrolling ($locale, $code, $categoryId)",
    async ({ locale, code, categoryId }) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      const before = currentLocale();
      try {
        setLocale(locale);
        await page.viewport(390, 844);
        const { el, root } = await mountTree();
        el.nameDraft = { kind: "rename", categoryId };
        el.nameError = codeMessage(code);
        await el.updateComplete;
        await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
        const row = root.querySelector<HTMLElement>(`tr[data-row-key="folder:${categoryId}"]`)!;
        const box = row.querySelector<HTMLElementTagNameMap["wt-input"]>(
          'wt-input[name="category-name"]',
        )!;
        await box.updateComplete;
        for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
        const scroll = root.querySelector<HTMLElement>(".scroll")!;
        expect(scroll.scrollLeft).toBe(0);
        const actions = row.querySelector<HTMLElement>('td[data-pinned="end"]')!;
        const error = box.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
        expect(error.textContent).toBe(codeMessage(code));
        for (const part of [box.shadowRoot!.querySelector<HTMLElement>("input")!, error]) {
          const rect = part.getBoundingClientRect();
          expect(rect.left).toBeGreaterThanOrEqual(scroll.getBoundingClientRect().left);
          expect(rect.right).toBeLessThanOrEqual(actions.getBoundingClientRect().left);
        }
        expect(error.scrollWidth).toBeLessThanOrEqual(error.clientWidth);
      } finally {
        setLocale(before);
        await page.viewport(width, height);
      }
    },
  );

  /** Runs `body` in `locale` on a phone `width` px wide, restoring both afterwards. */
  async function onPhone(locale: string, width: number, body: () => Promise<void>) {
    const restore = {
      width: window.innerWidth,
      height: window.innerHeight,
      locale: currentLocale(),
    };
    try {
      setLocale(locale);
      await page.viewport(width, 844);
      await body();
    } finally {
      setLocale(restore.locale);
      await page.viewport(restore.width, restore.height);
    }
  }

  /** The tree as the only thing in a 600 px column with sticky headings, as the Products screen
   * bounds it, so the table's own box keeps its size while its rows change. */
  async function mountBoundedTree() {
    const tree = await mountTree({ stickyHeader: true });
    const host = tree.el.parentElement!;
    host.style.display = "flex";
    host.style.flexDirection = "column";
    host.style.height = "600px";
    await new Promise(requestAnimationFrame);
    return tree;
  }

  async function openWithRefusal(el: ProductList, draft: NonNullable<ProductList["nameDraft"]>) {
    el.nameDraft = draft;
    el.nameError = codeMessage("category.name_taken");
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
  }

  /** The open name box's input and refusal, against the scroller's start and the row's pinned cell. */
  async function nameBoxEdges(root: ShadowRoot) {
    for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
    const box = root.querySelector<HTMLElementTagNameMap["wt-input"]>(
      'wt-input[name="category-name"]',
    )!;
    const actions = box.closest("tr")!.querySelector<HTMLElement>('td[data-pinned="end"]')!;
    const span = (part: Element) => {
      const { left, right } = part.getBoundingClientRect();
      return { left, right };
    };
    return {
      input: span(box.shadowRoot!.querySelector("input")!),
      error: span(box.shadowRoot!.querySelector("[data-error]")!),
      start: root.querySelector(".scroll")!.getBoundingClientRect().left,
      pinned: actions.getBoundingClientRect().left,
    };
  }

  function expectInView(edges: Awaited<ReturnType<typeof nameBoxEdges>>) {
    for (const part of [edges.input, edges.error]) {
      expect(part.left).toBeGreaterThanOrEqual(edges.start);
      expect(part.right).toBeLessThanOrEqual(edges.pinned);
    }
  }

  it.each(["en-GB", "es-ES"])(
    "fits the open name box again when the screen narrows from 430 to 390 px (%s)",
    (locale) =>
      onPhone(locale, 430, async () => {
        const { el, root } = await mountTree();
        await openWithRefusal(el, { kind: "rename", categoryId: "f" });
        await page.viewport(390, 844);
        expectInView(await nameBoxEdges(root));
      }),
  );

  it.each(["en-GB", "es-ES"])(
    "fits the open name box again when selection adds a column before it in a bounded list at 390 px (%s)",
    (locale) =>
      onPhone(locale, 390, async () => {
        const { el, root } = await mountBoundedTree();
        await openWithRefusal(el, { kind: "rename", categoryId: "f" });
        const before = await nameBoxEdges(root);
        el.selecting = true;
        await el.updateComplete;
        const after = await nameBoxEdges(root);
        expect(
          root.querySelector('tr[data-row-key="folder:f"] input[type="checkbox"]'),
        ).not.toBeNull();
        expectInView(after);
        expect(after.pinned).toBe(before.pinned);
      }),
  );

  it.each(
    ["en-GB", "es-ES"].flatMap((locale) =>
      (["before", "after"] as const).map((scrolled) => ({ locale, scrolled })),
    ),
  )(
    "shows the name box and its refusal from their first letter when the table is scrolled sideways $scrolled the rename opens at 390 px ($locale)",
    ({ locale, scrolled }) =>
      onPhone(locale, 390, async () => {
        const { el, root } = await mountTree();
        for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
        const scroll = root.querySelector<HTMLElement>(".scroll")!;
        const scrollSideways = () => {
          scroll.scrollLeft = 172;
          expect(scroll.scrollLeft).toBe(172);
        };
        if (scrolled === "before") scrollSideways();
        el.nameDraft = { kind: "rename", categoryId: "f" };
        await el.updateComplete;
        await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
        if (scrolled === "after") scrollSideways();
        el.nameError = codeMessage("category.name_taken");
        await el.updateComplete;
        expectInView(await nameBoxEdges(root));
      }),
  );

  it.each(["en-GB", "es-ES"])(
    "fits the open name box again when the screen narrows after the list is moved on the page (%s)",
    (locale) =>
      onPhone(locale, 430, async () => {
        const { el, root } = await mountTree();
        await openWithRefusal(el, { kind: "rename", categoryId: "f" });
        const host = el.parentElement!;
        el.remove();
        host.append(el);
        await el.updateComplete;
        await page.viewport(390, 844);
        expectInView(await nameBoxEdges(root));
      }),
  );

  it.each(
    ["en-GB", "es-ES"].flatMap((locale) => [null, "b"].map((parentId) => ({ locale, parentId }))),
  )(
    "fits a category being added, and its refusal, beside the pinned actions at 390 px ($locale, $parentId)",
    ({ locale, parentId }) =>
      onPhone(locale, 390, async () => {
        const { el, root } = await mountTree();
        await openWithRefusal(el, { kind: "create", parentId });
        expectInView(await nameBoxEdges(root));
      }),
  );

  /** The open name box against its row's grip (or grip space) and leading slot. */
  async function nameBoxLine(root: ShadowRoot) {
    const edges = await nameBoxEdges(root);
    const box = root.querySelector<HTMLElementTagNameMap["wt-input"]>(
      'wt-input[name="category-name"]',
    )!;
    const row = box.closest("tr")!;
    const error = box.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
    return {
      edges,
      box: box.getBoundingClientRect(),
      grip:
        (root.host.hasAttribute("narrow")
          ? row.querySelector('[part~="name-line"]')
          : row.querySelector('.drag-grip, [part~="grip-space"]')
        )?.getBoundingClientRect() ??
        (root.host.hasAttribute("narrow")
          ? {
              left: row.querySelector('[part~="folder-cell"]')!.getBoundingClientRect().left,
              top: row.querySelector('[part~="folder-cell"]')!.getBoundingClientRect().top,
              bottom: row.querySelector('[part~="folder-cell"]')!.getBoundingClientRect().top,
            }
          : row.querySelector('[part~="folder-frame"]')!.getBoundingClientRect()),
      icon: row.querySelector('[part~="folder-frame"]')!.getBoundingClientRect(),
      error: error.textContent,
      errorOverflows: error.scrollWidth > error.clientWidth,
      scrollLeft: root.querySelector<HTMLElement>(".scroll")!.scrollLeft,
    };
  }

  /** The tree mounted and laid out at phone width before a box opens, as when a person picks Rename
   * or Add category from a row's menu. */
  async function mountNarrowTree(props: Partial<ProductList> = {}) {
    const tree = await mountTree(props);
    await vi.waitFor(() => expect(tree.table.hasAttribute("narrow")).toBe(true));
    for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
    return tree;
  }

  function expectOwnLine(line: Awaited<ReturnType<typeof nameBoxLine>>) {
    expect(line.error).toBe(codeMessage("category.name_taken"));
    expect(line.scrollLeft).toBe(0);
    expect(line.box.width).toBeGreaterThanOrEqual(140);
    expect(line.box.top).toBeGreaterThanOrEqual(line.grip.bottom);
    expect(line.box.left).toBeLessThanOrEqual(line.grip.left + 1);
    expect(line.box.left).toBeGreaterThanOrEqual(line.grip.left - 1);
    expectInView(line.edges);
    expect(line.box.right).toBeLessThanOrEqual(line.edges.pinned);
    expect(line.errorOverflows).toBe(false);
  }

  it.each(
    ["en-GB", "es-ES"].flatMap((locale) =>
      ["f", "d", "b"].flatMap((categoryId) =>
        [true, false].map((reordering) => ({ locale, categoryId, reordering })),
      ),
    ),
  )(
    "puts a renamed category's name box and its refusal on their own line under the grip or its slot at 390 px ($locale, $categoryId, reordering: $reordering)",
    ({ locale, categoryId, reordering }) =>
      onPhone(locale, 390, async () => {
        const { el, root } = await mountNarrowTree({
          unroutedFolderIds: ["f", "d", "b"],
          reordering,
        });
        await openWithRefusal(el, { kind: "rename", categoryId });
        const line = await nameBoxLine(root);
        expectOwnLine(line);
        const row = root.querySelector(`tr[data-row-key="folder:${categoryId}"]`)!;
        for (const after of row.querySelectorAll('[part~="unrouted-folder"]')) {
          const rect = after.getBoundingClientRect();
          expect(rect.right).toBeLessThanOrEqual(line.edges.pinned);
          expect(rect.bottom).toBeLessThanOrEqual(line.box.top);
        }
      }),
  );

  it.each(
    ["en-GB", "es-ES"].flatMap((locale) =>
      [null, "d", "b"].flatMap((parentId) =>
        [true, false].map((reordering) => ({ locale, parentId, reordering })),
      ),
    ),
  )(
    "puts a new category's name box and its refusal on their own line under the grip space at 390 px ($locale, $parentId, reordering: $reordering)",
    ({ locale, parentId, reordering }) =>
      onPhone(locale, 390, async () => {
        const { el, root } = await mountNarrowTree({ reordering });
        await openWithRefusal(el, { kind: "create", parentId });
        expectOwnLine(await nameBoxLine(root));
      }),
  );

  it.each(
    ["en-GB", "es-ES"].flatMap((locale) =>
      [true, false].map((reordering) => ({ locale, reordering })),
    ),
  )(
    "moves an open name box onto its own line when the screen narrows from 1280 to 390 px ($locale, reordering: $reordering)",
    ({ locale, reordering }) =>
      onPhone(locale, 1280, async () => {
        const { el, table, root } = await mountTree({
          unroutedFolderIds: ["f", "d", "b"],
          reordering,
        });
        await openWithRefusal(el, { kind: "rename", categoryId: "d" });
        expect(table.hasAttribute("narrow")).toBe(false);
        await page.viewport(390, 844);
        await vi.waitFor(async () => expectOwnLine(await nameBoxLine(root)));
      }),
  );

  it.each(
    ["en-GB", "es-ES"].flatMap((locale) =>
      [
        { kind: "rename", categoryId: "b" } as const,
        { kind: "create", parentId: "d" } as const,
      ].flatMap((draft) => [true, false].map((reordering) => ({ locale, draft, reordering }))),
    ),
  )(
    "keeps the name box beside the grip and folder slot at 1280 px ($locale, $draft.kind, reordering: $reordering)",
    ({ locale, draft, reordering }) =>
      onPhone(locale, 1280, async () => {
        const { el, root } = await mountTree({ reordering });
        await openWithRefusal(el, draft);
        const line = await nameBoxLine(root);
        expect(line.box.top).toBeLessThan(line.grip.bottom);
        expect(line.box.bottom).toBeGreaterThan(line.grip.top);
        expect(line.box.left).toBeGreaterThanOrEqual(line.icon.right);
        expectInView(line.edges);
      }),
  );

  const longCategory = {
    id: "long",
    name: "Embutidos ibéricos y quesos curados de la casa",
    parentId: null,
    color: null,
  };
  const longProduct = () =>
    product({
      id: "croquetas",
      name: "Croquetas caseras de jamón ibérico de bellota",
      primaryCategoryId: "long",
      variants: [
        { ...bunVariant, id: "r10", name: "Ración de diez croquetas caseras de jamón" },
        { ...bunVariant, id: "r6", name: "Media ración de seis croquetas" },
        { ...bunVariant, id: "r4", name: "Tapa de cuatro" },
        { ...bunVariant, id: "r2", name: "Dos" },
      ],
    });
  const singleWords = () => ({
    categories: [
      { id: "long", name: "Embutidosibéricosyquesoscuradosdelacasa", parentId: null, color: null },
    ],
    products: [
      product({
        id: "croquetas",
        name: "Croquetascaserasdejamónibéricodebellota",
        primaryCategoryId: "long",
        variants: [
          { ...bunVariant, id: "r10", name: "Racióndediezcroquetascaserasdejamón" },
          { ...bunVariant, id: "r6", name: "Mediaración" },
        ],
      }),
    ],
  });

  async function mountLong(props: Partial<ProductList> = {}, bounded = false) {
    const { el, host } = await mountWidget<ProductList>("dashboard-product-list", {
      categories: [longCategory],
      products: [longProduct()],
      unroutedFolderIds: ["long"],
      stickyHeader: bounded,
      ...props,
    });
    if (bounded) {
      host.style.display = "flex";
      host.style.flexDirection = "column";
      host.style.height = "600px";
    }
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    await frames();
    return { el, table, root };
  }

  const frames = async () => {
    for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
  };

  async function openEverything(el: ProductList, root: ShadowRoot) {
    await openRow(el, "folder:long");
    root.querySelector<HTMLElement>('tr[data-row-key="croquetas"] .tree-toggle')!.click();
    await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
  }

  /** Each name text in the Name column of the drawn rows — its glyphs' own extent, not its box —
   * against the row's pinned cell and the scroller's start. */
  async function nameTexts(root: ShadowRoot) {
    await frames();
    const start = root.querySelector(".scroll")!.getBoundingClientRect().left;
    const nameColumn = [...root.querySelectorAll("thead th")].findIndex((cell) =>
      cell.textContent!.trim().startsWith(t("product.name")),
    );
    return [...root.querySelectorAll<HTMLElement>("tbody tr[data-row-key]")].flatMap((row) => {
      const pinned = row.querySelector('td[data-pinned="end"]')!.getBoundingClientRect().left;
      const cell = [...row.querySelectorAll("td")][nameColumn]!;
      return [
        ...cell.querySelectorAll<HTMLElement>(
          'strong, [part~="count"], [part~="unrouted-folder"], [part~="variant-count"], [part~="variant-name"]',
        ),
      ]
        .filter(
          (element) => !element.matches('[part~="count"]') || !root.host.hasAttribute("narrow"),
        )
        .map((element) => {
          const text = document.createRange();
          text.selectNodeContents(element);
          const lines = new Set([...text.getClientRects()].map(({ bottom }) => Math.round(bottom)));
          const { left, right, bottom, top } = text.getBoundingClientRect();
          return {
            key: row.getAttribute("data-row-key")!,
            text: element.textContent!.trim(),
            left,
            right,
            top,
            bottom,
            lines: lines.size,
            start,
            pinned,
          };
        });
    });
  }

  function expectNamesClear(texts: Awaited<ReturnType<typeof nameTexts>>, keys: string[]) {
    expect(new Set(texts.map(({ key }) => key))).toEqual(new Set(keys));
    for (const text of texts) {
      expect(text.left, text.text).toBeGreaterThanOrEqual(text.start);
      expect(text.right, text.text).toBeLessThanOrEqual(text.pinned);
    }
  }

  const everyRow = [
    ROOT_KEY,
    "folder:long",
    "croquetas",
    "croquetas:r10",
    "croquetas:r6",
    "croquetas:r4",
    "croquetas:r2",
  ];

  it.each(["en-GB", "es-ES"])(
    "wraps every long name, count and variant name before the pinned actions at 390 px, unscrolled (%s)",
    (locale) =>
      onPhone(locale, 390, async () => {
        const { el, root } = await mountLong();
        await openEverything(el, root);
        const texts = await nameTexts(root);
        expect(root.querySelector<HTMLElement>(".scroll")!.scrollLeft).toBe(0);
        expectNamesClear(texts, everyRow);
        expect(texts.map(({ text }) => text)).toEqual(
          expect.arrayContaining([
            t("folders.all_products"),
            longCategory.name,
            "*",
            longProduct().name,
            t("product.variant_count").replace("{count}", "4"),
            "Ración de diez croquetas caseras de jamón",
          ]),
        );
        const wrapped = texts.filter(({ lines }) => lines > 1).map(({ text }) => text);
        expect(wrapped).toEqual(
          expect.arrayContaining([
            longCategory.name,
            longProduct().name,
            "Ración de diez croquetas caseras de jamón",
          ]),
        );
      }),
  );

  it.each(["en-GB", "es-ES"])(
    "hides a long category's swatch and wraps its name before the pinned actions at 390 px (%s)",
    (locale) =>
      onPhone(locale, 390, async () => {
        const { root } = await mountLong();
        await vi.waitFor(() => expect(root.host.hasAttribute("narrow")).toBe(true));
        const row = root.querySelector('tr[data-row-key="folder:long"]')!;
        const swatch = row
          .querySelector<HTMLElement>('[data-test="color-long"]')!
          .getBoundingClientRect();
        const pinned = row.querySelector('td[data-pinned="end"]')!.getBoundingClientRect().left;
        expect(root.querySelector<HTMLElement>(".scroll")!.scrollLeft).toBe(0);
        expect(swatch.width).toBe(0);
        const name = (await nameTexts(root)).find(
          ({ key, text }) => key === "folder:long" && text === longCategory.name,
        )!;
        expect(name.lines).toBeGreaterThan(1);
        expect(name.right).toBeLessThanOrEqual(pinned);
        // Measured again: the names are fitted, and the row laid out anew, after the first frame.
        const fitted = row
          .querySelector<HTMLElement>('[data-test="color-long"]')!
          .getBoundingClientRect();
        expect(fitted.right).toBeLessThanOrEqual(name.left);
      }),
  );

  it.each(["en-GB", "es-ES"])(
    "wraps a single long word inside the room before the pinned actions at 390 px (%s)",
    (locale) =>
      onPhone(locale, 390, async () => {
        const { el, root } = await mountLong(singleWords());
        await openEverything(el, root);
        const texts = await nameTexts(root);
        expect(root.querySelector<HTMLElement>(".scroll")!.scrollLeft).toBe(0);
        expectNamesClear(texts, [
          ROOT_KEY,
          "folder:long",
          "croquetas",
          "croquetas:r10",
          "croquetas:r6",
        ]);
        const wrapped = texts.filter(({ lines }) => lines > 1).map(({ text }) => text);
        expect(wrapped).toEqual(
          expect.arrayContaining([
            "Embutidosibéricosyquesoscuradosdelacasa",
            "Croquetascaserasdejamónibéricodebellota",
            "Racióndediezcroquetascaserasdejamón",
          ]),
        );
      }),
  );

  it.each(["en-GB", "es-ES"])(
    "fits a variant's long name opened after the list first drew, in a bounded list at 390 px (%s)",
    (locale) =>
      onPhone(locale, 390, async () => {
        const { el, root } = await mountLong({}, true);
        await openRow(el, "folder:long");
        await frames();
        root.querySelector<HTMLElement>('tr[data-row-key="croquetas"] .tree-toggle')!.click();
        await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
        expectNamesClear(await nameTexts(root), everyRow);
      }),
  );

  it.each(["en-GB", "es-ES"])(
    "fits the names again when the screen narrows from 430 to 390 px (%s)",
    (locale) =>
      onPhone(locale, 430, async () => {
        const { el, root } = await mountLong();
        await openEverything(el, root);
        expectNamesClear(await nameTexts(root), everyRow);
        await page.viewport(390, 844);
        expectNamesClear(await nameTexts(root), everyRow);
      }),
  );

  it.each(["en-GB", "es-ES"])(
    "fits the names again when selection adds a column before them in a bounded list at 390 px (%s)",
    (locale) =>
      onPhone(locale, 390, async () => {
        const { el, root } = await mountLong({}, true);
        await openEverything(el, root);
        const before = await nameTexts(root);
        expectNamesClear(before, everyRow);
        el.selecting = true;
        await el.updateComplete;
        await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
        expect(
          root.querySelector('tr[data-row-key="folder:long"] input[type="checkbox"]'),
        ).not.toBeNull();
        const after = await nameTexts(root);
        expectNamesClear(after, everyRow);
        expect(after.map(({ pinned }) => pinned)).toEqual(before.map(({ pinned }) => pinned));
      }),
  );

  it.each(["en-GB", "es-ES"])(
    "measures the names' room as if unscrolled when branches open with the table scrolled sideways at 390 px (%s)",
    (locale) =>
      onPhone(locale, 390, async () => {
        const { el, root } = await mountLong();
        const scroll = root.querySelector<HTMLElement>(".scroll")!;
        scroll.scrollLeft = 120;
        expect(scroll.scrollLeft).toBe(120);
        await openEverything(el, root);
        await frames();
        expect(scroll.scrollLeft).toBe(120);
        scroll.scrollLeft = 0;
        expectNamesClear(await nameTexts(root), everyRow);
      }),
  );

  it.each(["en-GB", "es-ES"])(
    "fits a long product name a search reveals, in a bounded list at 390 px (%s)",
    (locale) =>
      onPhone(locale, 390, async () => {
        const { el, root } = await mountLong({}, true);
        expectNamesClear(await nameTexts(root), [ROOT_KEY, "folder:long"]);
        el.search = "bellota";
        await el.updateComplete;
        await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
        expect(rowKeys(root)).toContain("croquetas");
        const texts = await nameTexts(root);
        expect(texts.map(({ text }) => text)).toContain(longProduct().name);
        expectNamesClear(texts, [ROOT_KEY, "folder:long", "croquetas"]);
      }),
  );

  it.each(["en-GB", "es-ES"])(
    "keeps a normal name, its count and its variants on one line each at 1280 px (%s)",
    (locale) =>
      onPhone(locale, 1280, async () => {
        const { el, root } = await mountLong({
          categories: [{ id: "long", name: "Embutidos", parentId: null, color: null }],
          products: [
            product({
              id: "croquetas",
              primaryCategoryId: "long",
              variants: [
                { ...bunVariant, id: "r10", name: "Ración de diez" },
                { ...bunVariant, id: "r6", name: "Media ración" },
              ],
            }),
          ],
        });
        await openEverything(el, root);
        const texts = await nameTexts(root);
        expect(new Set(texts.map(({ key }) => key))).toEqual(
          new Set([ROOT_KEY, "folder:long", "croquetas", "croquetas:r10", "croquetas:r6"]),
        );
        for (const text of texts) expect(text.lines, text.text).toBe(1);
        for (const key of [ROOT_KEY, "folder:long"]) {
          const [name, ...after] = texts.filter((text) => text.key === key);
          for (const text of after) expect(text.top, text.text).toBeLessThan(name!.bottom);
        }
      }),
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
      const name = cellUnder(root, key, t("product.name")).querySelector(
        'strong, [part~="variant-name"]',
      )!;
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
          categories: [drinks, beer, { id: "k", name: "Kegs", parentId: "b", color: null }],
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
        expectRowMenusOnScreen(table, 5, 'wt-row-actions[data-test^="actions-"]');
        // The table learns its width from a ResizeObserver, which reports after the next layout,
        // and sets `narrow` a frame later.
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

  it("lines a new category's folder slot up with its sibling categories' slots", async () => {
    const { el, root } = await mountTree();
    el.nameDraft = { kind: "create", parentId: null };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    const iconLeft = (key: string) =>
      root
        .querySelector(`tr[data-row-key="${key}"] [part~="folder-frame"]`)!
        .getBoundingClientRect().left;
    expect(iconLeft("draft:new")).toBe(iconLeft("folder:d"));
    expect(iconLeft("draft:new")).toBe(iconLeft("folder:f"));
  });

  it("draws no folder icon on root, nested and new category rows, and a large one on a category drag", async () => {
    const { el, root } = await mountTree();
    await openRow(el, "folder:d");
    el.nameDraft = { kind: "create", parentId: "d" };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    for (const key of [ROOT_KEY, "folder:d", "folder:b", "draft:new"])
      expect(
        root.querySelector(`tr[data-row-key="${key}"] wt-icon[name="folder"]`),
        key,
      ).toBeNull();

    const grip = root.querySelector<HTMLElement>('tr[data-row-key="folder:d"] .drag-grip')!;
    grip.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerId: 7 }),
    );
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 7, clientY: 20 }));
    await el.updateComplete;
    const preview = el.shadowRoot!.querySelector<HTMLElement>(
      '.drag-ghost wt-icon[name="folder"]',
    )!;
    expect(preview.getBoundingClientRect().width).toBe(18);
    expect(preview.getBoundingClientRect().height).toBe(18);
    document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 7 }));
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
    const row = root.querySelector<HTMLElement>('tr[data-row-key="folder:d"]')!;
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

  it("closes a category's menu when Delete is chosen from it", async () => {
    const { el, root } = await mountTree();
    const deletes: unknown[] = [];
    el.addEventListener("delete-folder", (event) => deletes.push((event as CustomEvent).detail));
    const menu = root.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
      '[data-test="actions-folder-d"]',
    )!;
    menu.show();
    const popup = menu.shadowRoot!.querySelector("[popover]")!;
    expect(popup.matches(":popover-open")).toBe(true);
    root.querySelector<HTMLElement>('[data-test="delete-folder-d"]')!.click();
    expect(deletes).toEqual([{ folderId: "d" }]);
    expect(popup.matches(":popover-open")).toBe(false);
  });

  it("draws a category colour that is not lowercase #rrggbb as none, so it never reaches the style", async () => {
    const { root } = await mountTree({
      categories: [{ ...drinks, color: "#256bb1;position:fixed;inset:0" }, beer, food],
    });
    const chip = root.querySelector<HTMLElement>(
      'tr[data-row-key="folder:d"] [data-test="color-d"] [part~="color-swatch"]',
    )!;
    expect(getComputedStyle(chip).position).toBe("static");
    expect(getComputedStyle(chip).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(chip.hasAttribute("style")).toBe(false);
    expect(chip.getAttribute("part")).toBe("color-swatch empty");
  });

  it("draws a swatch beside a category's name in its colour, outlined when it has none, and its click sends folder-color without opening or closing the row", async () => {
    const { el, root, table } = await mountTree({
      categories: [{ ...drinks, color: "#b12525" }, beer, food],
    });
    const sent: unknown[] = [];
    for (const name of ["folder-color", "category-toggle", "drag-items"])
      el.addEventListener(name, (event) => sent.push([name, (event as CustomEvent).detail]));
    const button = (id: string) =>
      root.querySelector<HTMLButtonElement>(
        `tr[data-row-key="folder:${id}"] [data-test="color-${id}"]`,
      )!;
    const chip = (id: string) => button(id).querySelector<HTMLElement>('[part~="color-swatch"]')!;
    expect(button("d").getAttribute("part")).toBe("swatch-button");
    expect(button("d").getAttribute("aria-label")).toBe(
      t("folders.edit_color").replace("{name}", "Drinks"),
    );
    expect(chip("d").getAttribute("part")).toBe("color-swatch");
    expect(getComputedStyle(chip("d")).backgroundColor).toBe("rgb(177, 37, 37)");
    expect(chip("f").getAttribute("part")).toBe("color-swatch empty");
    expect(getComputedStyle(chip("f")).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(chip("f")).borderTopWidth).toBe("1px");
    // Drawn before the name, in the slot a product's photo takes.
    const row = root.querySelector<HTMLElement>('tr[data-row-key="folder:d"]')!;
    expect(button("d").getBoundingClientRect().right).toBeLessThanOrEqual(
      row.querySelector("strong")!.getBoundingClientRect().left,
    );

    const expanded = () => row.getAttribute("aria-expanded");
    expect(expanded()).toBe("false");
    await userEvent.click(button("d"));
    await table.updateComplete;
    expect(expanded()).toBe("false");
    expect(sent).toEqual([["folder-color", { folderId: "d" }]]);
    await openRow(el, "folder:d");
    expect(expanded()).toBe("true");
    sent.length = 0;
    await userEvent.click(button("d"));
    await table.updateComplete;
    expect(expanded()).toBe("true");
    expect(sent).toEqual([["folder-color", { folderId: "d" }]]);

    // Pressed and dragged, the swatch starts no drag.
    const box = button("d").getBoundingClientRect();
    button("d").dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        composed: true,
        pointerId: 3,
        clientX: box.x + 4,
        clientY: box.y + 4,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 3, clientX: box.x + 4, clientY: box.y + 80 }),
    );
    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 3 }));
    expect(sent).toEqual([["folder-color", { folderId: "d" }]]);
  });

  it.each([
    ["en-GB", "Choose the colour"],
    ["es-ES", "Elegir el color"],
  ])(
    "puts a colour square showing the box's colour in the named row's leading slot, for a new category and a rename (%s)",
    async (locale, label) => {
      const before = currentLocale();
      onTestFinished(() => setLocale(before));
      setLocale(locale);
      const { el, root } = await mountTree({
        categories: [{ ...drinks, color: "#b12525" }, beer, food],
      });
      const square = () => {
        const box = root.querySelector('wt-input[name="category-name"]')!;
        expect(box.querySelector(':scope > [slot="end"]')).toBeNull();
        const button = box
          .closest("tr")!
          .querySelector<HTMLButtonElement>(
            '[part~="folder-frame"] > [data-test="name-box-color"]',
          )!;
        return { button, chip: button.querySelector<HTMLElement>('[part~="color-swatch"]')! };
      };
      el.nameDraft = { kind: "create", parentId: "d" };
      await el.updateComplete;
      await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
      expect(square().button.getAttribute("aria-label")).toBe(label);
      expect(square().chip.getAttribute("part")).toBe("color-swatch empty");
      el.nameColor = "#256bb1";
      await el.updateComplete;
      await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
      expect(getComputedStyle(square().chip).backgroundColor).toBe("rgb(37, 107, 177)");

      el.nameDraft = { kind: "rename", categoryId: "d" };
      el.nameColor = "#b12525";
      await el.updateComplete;
      await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
      const row = root.querySelector<HTMLElement>('tr[data-row-key="folder:d"]')!;
      expect(row.querySelector('[data-test="name-box-color"]')).toBe(square().button);
      expect(getComputedStyle(square().chip).backgroundColor).toBe("rgb(177, 37, 37)");
      expect(row.querySelector('[data-test="color-d"]')).toBeNull();
    },
  );

  it("keeps the name box open, saving nothing, while its colour square is used, and saves on Enter once focus is back", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    onTestFinished(() => outside.remove());
    const { el, root } = await mountTree();
    const sent: unknown[] = [];
    for (const name of ["name-commit", "name-cancel", "name-color"])
      el.addEventListener(name, (event) => sent.push([name, (event as CustomEvent).detail]));
    el.nameDraft = { kind: "create", parentId: null };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    await userEvent.keyboard("Juice");
    const box = root.querySelector<HTMLElementTagNameMap["wt-input"]>(
      'wt-input[name="category-name"]',
    )!;
    const square = root.querySelector<HTMLElement>('[data-test="name-box-color"]')!;
    el.addEventListener("name-color", () => (el.choosingColor = true));
    await userEvent.click(square);
    expect(focusedName(el)).toBe("category-name");
    // Stands in for the catalogue's chooser, which takes the cursor while it is open and hands it
    // back to the input; that hand-back is pinned in catalogue-browser.test.ts.
    outside.focus();
    expect(sent).toEqual([["name-color", {}]]);
    expect(root.querySelector('wt-input[name="category-name"]')).toBe(box);
    el.choosingColor = false;
    box.shadowRoot!.querySelector("input")!.focus();
    expect(box.value).toBe("Juice");
    await userEvent.keyboard("{Enter}");
    expect(sent).toEqual([
      ["name-color", {}],
      ["name-commit", { name: "Juice" }],
    ]);
  });

  it.each(["touch press cancelled by a scroll", "mouse press dragged off"])(
    "still saves the name box on leaving it after a %s on its colour square",
    async (press) => {
      const outside = document.createElement("button");
      document.body.append(outside);
      onTestFinished(() => outside.remove());
      const { el, root } = await mountTree();
      const sent: unknown[] = [];
      for (const name of ["name-commit", "name-cancel", "name-color"])
        el.addEventListener(name, (event) => sent.push([name, (event as CustomEvent).detail]));
      el.nameDraft = { kind: "create", parentId: null };
      await el.updateComplete;
      await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
      await userEvent.keyboard("Juice");
      const square = root.querySelector<HTMLElement>('[data-test="name-box-color"]')!;
      const at = square.getBoundingClientRect();
      const point = { bubbles: true, composed: true, clientX: at.x + 4, clientY: at.y + 4 };
      if (press === "touch press cancelled by a scroll") {
        square.dispatchEvent(
          new PointerEvent("pointerdown", { ...point, pointerId: 7, pointerType: "touch" }),
        );
        square.dispatchEvent(
          new PointerEvent("pointercancel", { ...point, pointerId: 7, pointerType: "touch" }),
        );
      } else {
        square.dispatchEvent(
          new PointerEvent("pointerdown", { ...point, pointerId: 8, pointerType: "mouse" }),
        );
        square.dispatchEvent(new MouseEvent("mousedown", point));
        outside.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, pointerId: 8, pointerType: "mouse" }),
        );
        outside.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      }
      await userEvent.click(outside);
      expect(sent).toEqual([["name-commit", { name: "Juice" }]]);
    },
  );

  it("keeps the cursor in the name box while its colour square is pressed", async () => {
    const { el, root } = await mountTree();
    el.nameDraft = { kind: "create", parentId: null };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    const square = root.querySelector<HTMLElement>('[data-test="name-box-color"]')!;
    const press = new MouseEvent("mousedown", { bubbles: true, composed: true, cancelable: true });
    square.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  });

  it("opens no colour chooser from the box once its name has been sent", async () => {
    const { el, root } = await mountTree();
    const sent: unknown[] = [];
    for (const name of ["name-commit", "name-color"])
      el.addEventListener(name, (event) => sent.push([name, (event as CustomEvent).detail]));
    el.nameDraft = { kind: "create", parentId: null };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    await userEvent.keyboard("Juice{Enter}");
    await userEvent.click(root.querySelector<HTMLElement>('[data-test="name-box-color"]')!);
    expect(sent).toEqual([["name-commit", { name: "Juice" }]]);
    el.nameError = "That name is taken.";
    await el.updateComplete;
    await userEvent.click(root.querySelector<HTMLElement>('[data-test="name-box-color"]')!);
    expect(sent).toEqual([
      ["name-commit", { name: "Juice" }],
      ["name-color", {}],
    ]);
  });

  it("leaves the name box, and saves it, once focus has come back from its colour chooser", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    onTestFinished(() => outside.remove());
    const { el, root } = await mountTree();
    const sent: unknown[] = [];
    for (const name of ["name-commit", "name-cancel", "name-color"])
      el.addEventListener(name, (event) => sent.push([name, (event as CustomEvent).detail]));
    el.nameDraft = { kind: "create", parentId: null };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    await userEvent.keyboard("Juice");
    el.addEventListener("name-color", () => (el.choosingColor = true));
    await userEvent.click(root.querySelector<HTMLElement>('[data-test="name-box-color"]')!);
    outside.focus();
    expect(sent).toEqual([["name-color", {}]]);
    el.choosingColor = false;
    root
      .querySelector<HTMLElementTagNameMap["wt-input"]>('wt-input[name="category-name"]')!
      .shadowRoot!.querySelector("input")!
      .focus();
    outside.focus();
    expect(sent).toEqual([
      ["name-color", {}],
      ["name-commit", { name: "Juice" }],
    ]);
  });

  it("leaves the box's colour square out of the Tab order, so Tab still leaves the box and saves it, and the row's square is a Tab stop", async () => {
    const { el, root } = await mountTree();
    const sent: unknown[] = [];
    for (const name of ["name-commit", "name-cancel", "name-color"])
      el.addEventListener(name, (event) => sent.push([name, (event as CustomEvent).detail]));
    el.nameDraft = { kind: "create", parentId: null };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    expect(root.querySelector<HTMLElement>('[data-test="name-box-color"]')!.tabIndex).toBe(-1);
    expect(root.querySelector<HTMLElement>('[data-test="color-d"]')!.tabIndex).toBe(0);
    await userEvent.keyboard("Juice{Tab}");
    expect(sent).toEqual([["name-commit", { name: "Juice" }]]);
  });

  it.each([
    ["Edit", "edit-small", "edit-product", "small"],
    ["Archive", "delete-small", "delete-product", "small"],
    ["View", "view-large", "view-product", "large"],
  ])(
    "closes a product row's menu when %s is chosen from it, and sends only that request",
    async (_label, button, request, productId) => {
      const removed = { ...bunVariant, id: "large", name: "Large", active: false };
      const { el } = await mountWidget<ProductList>("dashboard-product-list", {
        products: [product({ id: "bun", variants: [bunVariant, removed] })],
      });
      await choose(el, "active", "");
      const table = el.shadowRoot!.querySelector("wt-data-table")!;
      const root = await tableRoot(el);
      root.querySelector<HTMLElement>(".tree-toggle")!.click();
      await table.updateComplete;
      const seen: [string, string][] = [];
      for (const name of ["edit-product", "delete-product", "view-product"])
        el.addEventListener(name, (event) =>
          seen.push([name, (event as CustomEvent<{ productId: string }>).detail.productId]),
        );
      const menu = root.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
        `[data-test="actions-${productId}"]`,
      )!;
      menu.show();
      const popup = menu.shadowRoot!.querySelector("[popover]")!;
      expect(popup.matches(":popover-open")).toBe(true);
      await userEvent.click(root.querySelector<HTMLElement>(`[data-test="${button}"]`)!);
      expect(seen).toEqual([[request, productId]]);
      expect(popup.matches(":popover-open")).toBe(false);
    },
  );

  it.each([
    ["Edit", "edit-bread", "edit-product", "bread"],
    ["Archive", "delete-bread", "delete-product", "bread"],
    ["View", "view-stale", "view-product", "stale"],
  ])(
    "closes a top-level product's menu when %s is chosen from it, and sends only that request",
    async (_label, button, request, productId) => {
      const { el, root } = await mountTree({
        products: [
          ...treeProducts(),
          product({ id: "stale", name: "Stale", primaryCategoryId: null, active: false }),
        ],
      });
      await choose(el, "active", "");
      const seen: [string, string][] = [];
      for (const name of ["edit-product", "delete-product", "view-product"])
        el.addEventListener(name, (event) =>
          seen.push([name, (event as CustomEvent<{ productId: string }>).detail.productId]),
        );
      const menu = root.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
        `[data-test="actions-${productId}"]`,
      )!;
      menu.show();
      const popup = menu.shadowRoot!.querySelector("[popover]")!;
      expect(popup.matches(":popover-open")).toBe(true);
      await userEvent.click(root.querySelector<HTMLElement>(`[data-test="${button}"]`)!);
      expect(seen).toEqual([[request, productId]]);
      expect(popup.matches(":popover-open")).toBe(false);
    },
  );

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

describe("a product's variants in the list", () => {
  const cecina = () =>
    product({
      id: "cecina",
      name: "Cured beef cecina",
      primaryCategoryId: "deli",
      image: "abc123.webp",
      variants: [
        { ...bunVariant, id: "thin", name: "Thin cut", unitPrice: "38.00" },
        { ...bunVariant, id: "thick", name: "Thick cut", unitPrice: "40.00" },
        { ...bunVariant, id: "gone", name: "Old cut", active: false },
      ],
    });
  const loin = () =>
    product({
      id: "loin",
      name: "Cured pork loin",
      primaryCategoryId: "deli",
      variants: [{ ...bunVariant, id: "more", name: "More pork" }],
    });

  async function mountDeli(props: Partial<ProductList> = {}) {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        cecina(),
        loin(),
        product({ id: "chorizo", name: "Iberian chorizo", primaryCategoryId: "deli" }),
      ],
      categories: [{ id: "deli", name: "Deli", parentId: null, color: null }],
      madeAt: {
        thin: {
          stationId: "deli",
          stationName: "Deli counter",
          noPreparation: false,
          noReplacement: false,
          variesByZone: false,
        },
      },
      ...props,
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    await openRow(el, "folder:deli");
    return { el, table, root };
  }

  async function openVariants(
    root: ShadowRoot,
    table: HTMLElement & { updateComplete: Promise<unknown> },
    key: string,
  ) {
    root.querySelector<HTMLElement>(`tr[data-row-key="${key}"] .tree-toggle`)!.click();
    await table.updateComplete;
  }

  const nameCell = (root: ShadowRoot, key: string) => cellUnder(root, key, t("product.name"));

  it("draws a small, muted arrow on a product with variants, at its arrow box's end", async () => {
    const { root } = await mountDeli();
    const arrow = root.querySelector<HTMLElement>('tr[data-row-key="cecina"] .tree-toggle')!;
    const name = nameCell(root, "cecina").querySelector("strong")!;
    const style = getComputedStyle(arrow);
    expect(parseFloat(style.fontSize)).toBeLessThan(parseFloat(getComputedStyle(name).fontSize));
    expect(style.color).toBe(
      getComputedStyle(nameCell(root, "cecina").querySelector('[data-test="variant-count"]')!)
        .color,
    );
    const grip = nameCell(root, "cecina").closest("tr")!.querySelector<HTMLElement>(".drag-grip")!;
    const glyph = document.createRange();
    glyph.selectNodeContents(arrow);
    // The arrow stays at its box's trailing edge; the grip is in the preceding column.
    expect(arrow.getBoundingClientRect().right - glyph.getBoundingClientRect().right).toBeLessThan(
      arrow.getBoundingClientRect().width / 2,
    );
    expect(grip.getBoundingClientRect().right).toBeLessThan(arrow.getBoundingClientRect().left);
  });

  it("draws a product's variant arrow small and muted, in the browser's own button font", async () => {
    const { el, root } = await mountDeli();
    const arrow = root.querySelector<HTMLElement>('tr[data-row-key="cecina"] .tree-toggle')!;
    const probe = document.createElement("span");
    probe.style.color = "var(--wt-color-text-muted)";
    probe.style.fontSize = "var(--wt-font-size-sm)";
    probe.style.paddingInlineEnd = "var(--wt-space-1)";
    // A button no author style reaches carries the browser's own button font, which a product's arrow keeps.
    const host = document.createElement("div");
    const plainButton = host
      .attachShadow({ mode: "open" })
      .appendChild(document.createElement("button"));
    el.parentElement!.append(probe, host);
    onTestFinished(() => {
      probe.remove();
      host.remove();
    });
    const style = getComputedStyle(arrow);
    const want = getComputedStyle(probe);
    expect({
      color: style.color,
      fontSize: style.fontSize,
      paddingInlineEnd: style.paddingInlineEnd,
      textAlign: style.textAlign,
      fontFamily: style.fontFamily,
    }).toEqual({
      color: want.color,
      fontSize: want.fontSize,
      paddingInlineEnd: want.paddingInlineEnd,
      textAlign: "end",
      fontFamily: getComputedStyle(plainButton).fontFamily,
    });
  });

  it.each([
    ["en", "2 variants", "1 variant"],
    ["es", "2 variantes", "1 variante"],
  ])(
    "says how many variants a product has under its name, leaving removed ones out (%s)",
    async (locale, two, one) => {
      setLocale(locale);
      const { root } = await mountDeli();
      const count = (key: string) =>
        nameCell(root, key).querySelector<HTMLElement>('[data-test="variant-count"]');
      expect(count("cecina")!.textContent!.trim()).toBe(two);
      expect(count("loin")!.textContent!.trim()).toBe(one);
      expect(count("chorizo")).toBeNull();
      const name = nameCell(root, "cecina").querySelector("strong")!.getBoundingClientRect();
      const box = count("cecina")!.getBoundingClientRect();
      expect(box.top).toBeGreaterThanOrEqual(name.bottom - 1);
      expect(Math.abs(box.left - name.left)).toBeLessThanOrEqual(0.5);
      expect(getComputedStyle(count("cecina")!).color).not.toBe(
        getComputedStyle(nameCell(root, "cecina").querySelector("strong")!).color,
      );
    },
  );

  it.each([1280, 390])(
    "lines each opened variant's name up under its product's, in normal weight, on a band (%i px)",
    async (width) => {
      const before = { width: window.innerWidth, height: window.innerHeight };
      try {
        await page.viewport(width, 844);
        const { table, root } = await mountDeli();
        await openVariants(root, table, "cecina");
        // The table turns narrow a frame after it resizes.
        for (let i = 0; i < 3; i += 1) await new Promise(requestAnimationFrame);
        expect(table.hasAttribute("narrow")).toBe(width === 390);
        expect(rowKeys(root)).toEqual([
          "folder:deli",
          "cecina",
          "cecina:thin",
          "cecina:thick",
          "loin",
          "chorizo",
        ]);
        const productName = nameCell(root, "cecina").querySelector("strong")!;
        for (const key of ["cecina:thin", "cecina:thick"]) {
          const name = nameCell(root, key).querySelector<HTMLElement>('[part~="variant-name"]')!;
          const text = document.createRange();
          text.selectNodeContents(name);
          expect(
            Math.abs(text.getBoundingClientRect().left - productName.getBoundingClientRect().left),
            key,
          ).toBeLessThanOrEqual(0.5);
          expect(Number(getComputedStyle(name).fontWeight)).toBeLessThan(
            Number(getComputedStyle(productName).fontWeight),
          );
          const row = root.querySelector(`tr[data-row-key="${key}"]`)!;
          expect(row.matches(".joined")).toBe(true);
        }
        expect(root.querySelector('tr[data-row-key="cecina"]')!.matches(".joined")).toBe(false);
        const scroll = root.querySelector<HTMLElement>(".scroll")!;
        expect(scroll.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
      } finally {
        await page.viewport(before.width, before.height);
      }
    },
  );

  it("shows only a variant's price, status and menu, leaving its other cells empty", async () => {
    setLocale("en");
    const route = {
      stationId: "deli",
      stationName: "Deli counter",
      noPreparation: false,
      noReplacement: false,
      variesByZone: false,
    };
    const { table, root } = await mountDeli({ madeAt: { thin: route, cecina: route } });
    await openVariants(root, table, "cecina");
    for (const header of [
      t("product.made_at"),
      t("editor.modifiers"),
      t("product.ordering"),
      t("product.allergens"),
    ]) {
      const cell = cellUnder(root, "cecina:thin", header);
      expect(cell.textContent!.trim(), header).toBe("");
      expect(cell.querySelector("*"), header).toBeNull();
    }
    expect(
      cellUnder(root, "cecina:thin", t("product.price")).querySelector('[data-test="price"]')!
        .textContent,
    ).toContain("38.00");
    expect(
      cellUnder(root, "cecina:thin", t("product.status")).querySelector("[data-test=active-badge]"),
    ).not.toBeNull();
    expect(root.querySelector('[data-test="actions-thin"]')).not.toBeNull();
    expect(cellUnder(root, "cecina", t("product.made_at")).textContent!.trim()).not.toBe("");
  });

  describe("lists a product's variants in the product's own order, whatever sorts the table", () => {
    // Each product's stored order differs from its name order (number-aware or not), from its id
    // order, and from every price sort, so only keeping the order the product holds passes.
    const products = () => [
      product({
        id: "solo",
        name: "Solomillo",
        variants: [
          { ...bunVariant, id: "b", name: "450g", unitPrice: "20.00" },
          { ...bunVariant, id: "c", name: "250g", unitPrice: "30.00" },
          { ...bunVariant, id: "a", name: "350g", unitPrice: "10.00" },
        ],
      }),
      product({
        id: "racion",
        name: "Pulpo",
        variants: [
          { ...bunVariant, id: "z", name: "Ración 10", unitPrice: "1.00" },
          { ...bunVariant, id: "y", name: "0,25 kg", unitPrice: "5.00" },
          { ...bunVariant, id: "m", name: "Ración 2", unitPrice: "9.00" },
          { ...bunVariant, id: "x", name: "0,5 kg", unitPrice: "3.00" },
        ],
      }),
    ];

    async function mountOpen() {
      const { el } = await mountWidget<ProductList>("dashboard-product-list", {
        products: products(),
      });
      const table = el.shadowRoot!.querySelector("wt-data-table")!;
      const root = await tableRoot(el);
      for (const id of ["solo", "racion"]) await openVariants(root, table, id);
      return { table, root };
    }

    const variantsOf = (root: ShadowRoot, id: string) =>
      rowKeys(root).filter((key) => key.startsWith(`${id}:`));
    const expectProductOrder = (root: ShadowRoot) => {
      expect(variantsOf(root, "solo")).toEqual(["solo:b", "solo:c", "solo:a"]);
      expect(variantsOf(root, "racion")).toEqual(["racion:z", "racion:y", "racion:m", "racion:x"]);
    };

    it("under the Name sort, either way", async () => {
      const { table, root } = await mountOpen();
      expectProductOrder(root);
      root.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
      await table.updateComplete;
      expect(table.sortDirection).toBe("descending");
      expect(rowKeys(root).indexOf("solo")).toBeLessThan(rowKeys(root).indexOf("racion"));
      expectProductOrder(root);
    });

    it("under another column's sort", async () => {
      const { table, root } = await mountOpen();
      root.querySelector<HTMLButtonElement>('button[data-sort="price"]')!.click();
      await table.updateComplete;
      expect(table.sortKey).toBe("price");
      expectProductOrder(root);
    });

    it("under a sort restored from an earlier visit", async () => {
      sessionStorage.setItem(
        "waitron.products.table",
        JSON.stringify({ sortKey: "price", sortDirection: "descending" }),
      );
      const { table, root } = await mountOpen();
      expect([table.sortKey, table.sortDirection]).toEqual(["price", "descending"]);
      expectProductOrder(root);
    });

    it("without changing the order the product holds them in", async () => {
      const { el } = await mountWidget<ProductList>("dashboard-product-list", {
        products: products(),
      });
      expect(el.products[0]!.variants.map(({ id }) => id)).toEqual(["b", "c", "a"]);
    });
  });
});

describe("the product list with sticky headings", () => {
  const longList = () => [
    ...Array.from({ length: 12 }, (_, index) =>
      product({ id: `d-${index}`, name: `Drink ${index}`, primaryCategoryId: "d" }),
    ),
    ...Array.from({ length: 12 }, (_, index) =>
      product({ id: `f-${index}`, name: `Food ${index}`, primaryCategoryId: "f" }),
    ),
  ];
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  /** Mounts the list as the only thing in a 600 px column, the way the Products screen bounds it. */
  async function mountBounded(props: Partial<ProductList> = {}) {
    const { el, host } = await mountWidget<ProductList>("dashboard-product-list", {
      categories: [drinks, food],
      products: longList(),
      ...props,
    });
    host.style.display = "flex";
    host.style.flexDirection = "column";
    host.style.height = "600px";
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    await el.revealProduct("f-11");
    await el.revealProduct("d-11");
    await frame();
    return { el, host, table, root, scroll: root.querySelector<HTMLElement>(".scroll")! };
  }

  it("is off unless the screen asks for it", async () => {
    const { el, table, scroll } = await mountBounded();
    expect(el.stickyHeader).toBe(false);
    expect(table.stickyHeader).toBe(false);
    expect(scroll.scrollHeight).toBe(scroll.clientHeight);
  });

  it("fills its column and keeps the table's toolbar and headings in place while the rows scroll", async () => {
    const { el, host, table, root, scroll } = await mountBounded({ stickyHeader: true });
    expect(el.hasAttribute("sticky-header")).toBe(true);
    expect(table.stickyHeader).toBe(true);
    expect(el.getBoundingClientRect().bottom).toBeCloseTo(host.getBoundingClientRect().bottom, 0);
    expect(scroll.getBoundingClientRect().bottom).toBeCloseTo(
      host.getBoundingClientRect().bottom,
      0,
    );
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
    const toolbar = root.querySelector(".table-toolbar")!;
    const name = root.querySelector<HTMLElement>("thead th")!;
    const before = [toolbar, name].map((item) => item.getBoundingClientRect().toJSON());
    scroll.scrollTop = scroll.scrollHeight;
    await frame();
    expect(scroll.scrollTop).toBeGreaterThan(0);
    expect([toolbar, name].map((item) => item.getBoundingClientRect().toJSON())).toEqual(before);
    const box = name.getBoundingClientRect();
    const hit = root.elementFromPoint(box.x + 8, box.y + box.height / 2);
    expect(hit !== null && name.contains(hit)).toBe(true);
  });

  it("reveals a product below the headings, not under them", async () => {
    const { el, root, scroll } = await mountBounded({ stickyHeader: true });
    scroll.scrollTop = scroll.scrollHeight;
    await frame();
    await el.revealProduct("d-0");
    await frame();
    const row = root.querySelector('tr[data-row-key="d-0"]')!.getBoundingClientRect();
    expect(row.top).toBeGreaterThanOrEqual(
      root.querySelector("thead th")!.getBoundingClientRect().bottom - 0.5,
    );
    expect(row.bottom).toBeLessThanOrEqual(scroll.getBoundingClientRect().bottom);
  });
});

describe("the Products tree's Name column", () => {
  const deep = { id: "g", name: "Grill", parentId: "m", color: null };
  const meat = { id: "m", name: "Meat", parentId: "f", color: null };
  const solomillo = () =>
    product({
      id: "loin",
      name: "Solomillo",
      primaryCategoryId: "m",
      image: "loin.png",
      variants: [{ ...bunVariant, id: "s250", name: "Solomillo 250g", unitPrice: "12.00" }],
    });

  const deepProducts = () => [
    product({ id: "cola", name: "Cola", primaryCategoryId: "d" }),
    product({ id: "salad", name: "Salad", primaryCategoryId: "f", image: "salad.png" }),
    product({ id: "chop", name: "Chop", primaryCategoryId: "m" }),
    solomillo(),
    product({ id: "ribs", name: "Ribs", primaryCategoryId: "g" }),
    product({ id: "bread", name: "Bread", primaryCategoryId: null }),
  ];

  async function mountDeep(props: Partial<ProductList> = {}) {
    setLocale("en");
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      categories: [drinks, food, meat, deep],
      products: deepProducts(),
      ...props,
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    for (const key of ["folder:d", "folder:f", "folder:m", "folder:g", "loin"]) {
      table.setExpanded(key, true);
      await table.updateComplete;
    }
    return { el, table, root: table.shadowRoot! };
  }

  /** Where each piece of a row's Name cell starts and where its middle is, in CSS px. */
  function pieces(root: ShadowRoot, key: string) {
    const row = root.querySelector(`tr[data-row-key="${key}"]`)!;
    const cell = row.querySelector("td:not(.select)")!;
    const box = (element: Element | null) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, middle: rect.top + rect.height / 2 };
    };
    const name = cell.querySelector("strong") ?? cell.querySelector('[part="variant-name"]')!;
    const text = document.createRange();
    text.selectNodeContents(name);
    return {
      level: Number(row.getAttribute("aria-level")),
      grip: box(row.querySelector('.drag-grip, [part="grip-space"]')),
      media: box(
        cell.querySelector(
          '[part="folder-frame"], [part~="thumb-frame"], [part~="thumb-placeholder"]',
        ),
      ),
      name: box({ getBoundingClientRect: () => text.getBoundingClientRect() } as Element)!,
    };
  }

  const ROWS = [
    "root",
    "folder:d",
    "cola",
    "folder:f",
    "salad",
    "folder:m",
    "chop",
    "loin",
    "folder:g",
    "ribs",
    "bread",
  ];

  it.each([false, true])(
    "starts every name one even step further in per level, folders, products and the root alike (selecting: %s)",
    async (selecting) => {
      const { root } = await mountDeep({ selecting });
      const all = ROWS.map((key) => ({ key, ...pieces(root, key === "root" ? ROOT_KEY : key) }));
      const step = all.find(({ level }) => level === 2)!.name.left - all[0]!.name.left;
      expect(step).toBeGreaterThan(0);
      for (const row of all) {
        const expected = all[0]!.name.left + (row.level - 1) * step;
        expect(row.name.left, row.key).toBeCloseTo(expected, 0);
      }
      // The grip and the colour square or photo sit in the same slots on every row of one level.
      for (const row of all) {
        const twin = all.find((other) => other.level === row.level && other.key !== row.key);
        if (!twin) continue;
        expect(row.grip!.left, row.key).toBeCloseTo(twin.grip!.left, 0);
        expect(row.media!.left, row.key).toBeCloseTo(twin.media!.left, 0);
      }
    },
  );

  it("starts a variant's name where its product's name starts", async () => {
    const { root } = await mountDeep();
    expect(pieces(root, "loin:s250").name.left).toBeCloseTo(pieces(root, "loin").name.left, 0);
  });

  it("lines each row's grip, colour square or photo and name up on one middle", async () => {
    const { root } = await mountDeep();
    for (const key of ROWS.slice(1)) {
      const { grip, media, name } = pieces(root, key);
      expect(Math.abs(grip!.middle - media!.middle), key).toBeLessThanOrEqual(1);
      expect(Math.abs(name.middle - media!.middle), key).toBeLessThanOrEqual(3);
    }
  });

  it.each([false, true])(
    "puts the Name heading over the first name in the column (selecting: %s)",
    async (selecting) => {
      const { root } = await mountDeep({ selecting });
      const heading = root.querySelector<HTMLElement>('thead th button[data-sort="name"]')!;
      expect(heading.getBoundingClientRect().left).toBeCloseTo(pieces(root, ROOT_KEY).name.left, 0);
    },
  );

  it("keeps a product's photo at laptop width", async () => {
    const restore = { width: window.innerWidth, height: window.innerHeight };
    try {
      await page.viewport(1280, 844);
      const { table, root } = await mountDeep();
      for (let i = 0; i < 3; i += 1) await new Promise(requestAnimationFrame);
      expect(table.hasAttribute("narrow")).toBe(false);
      const photo = root.querySelector<HTMLElement>(
        'tr[data-row-key="loin"] [part~="thumb-frame"]',
      )!;
      expect(photo.getBoundingClientRect().width).toBeGreaterThan(0);
    } finally {
      await page.viewport(restore.width, restore.height);
    }
  });

  describe("at phone width", () => {
    let restore: { width: number; height: number };
    beforeEach(async () => {
      restore = { width: window.innerWidth, height: window.innerHeight };
      await page.viewport(390, 844);
    });
    afterEach(async () => {
      await page.viewport(restore.width, restore.height);
    });

    /** The table sets `narrow` a frame after it resizes; three frames cover that and the layout. */
    async function mountPhone(props: Partial<ProductList> = {}) {
      const mounted = await mountDeep(props);
      for (let i = 0; i < 3; i += 1) await new Promise(requestAnimationFrame);
      expect(mounted.table.hasAttribute("narrow")).toBe(true);
      return mounted;
    }

    const PRODUCTS = new Set(["cola", "salad", "chop", "loin", "ribs", "bread"]);

    it("draws no photo, placeholder or category slot, so names start after their arrows", async () => {
      const { root } = await mountPhone();
      const photos = [
        ...root.querySelectorAll<HTMLElement>('[part~="thumb-frame"], [part~="thumb-placeholder"]'),
      ];
      // Each product's slot, and the one of loin's opened variant.
      expect(photos.length).toBe(PRODUCTS.size + 1);
      for (const photo of photos) expect(photo.getBoundingClientRect().width).toBe(0);
      for (const key of PRODUCTS) {
        const grip = root.querySelector(`tr[data-row-key="${key}"] .drag-grip`)!;
        expect(grip.closest("td")).toBe(grip.closest("tr")!.querySelector("td"));
        const cell = grip.closest("tr")!.querySelector(".tree-cell")!;
        const arrow = cell.querySelector(".tree-spacer, .tree-toggle, .tree-arrow")!;
        expect(pieces(root, key).name.left, key).toBeCloseTo(
          arrow.getBoundingClientRect().right,
          0,
        );
      }
      for (const key of ["root", "folder:d", "folder:f", "folder:m", "folder:g"]) {
        const row = key === "root" ? ROOT_KEY : key;
        expect(pieces(root, row).media!, key).not.toBeNull();
        const folder = root.querySelector(`tr[data-row-key="${row}"] [part~="folder-frame"]`)!;
        expect(folder.getBoundingClientRect().width, key).toBe(0);
      }
    });

    it.each(
      [false, true].flatMap((selecting) =>
        [true, false].map((reordering) => ({ selecting, reordering })),
      ),
    )(
      "steps category and product names in evenly per level without media slots (selecting: $selecting, reordering: $reordering)",
      async ({ selecting, reordering }) => {
        const { root } = await mountPhone({ selecting, reordering });
        const all = ROWS.map((key) => ({ key, ...pieces(root, key === "root" ? ROOT_KEY : key) }));
        const step = all.find(({ key }) => key === "folder:d")!.name.left - all[0]!.name.left;
        expect(step).toBeGreaterThan(0);
        expect(root.querySelector('[part~="folder-frame"]')!.getBoundingClientRect().width).toBe(0);
        for (const row of all) {
          const expected = all[0]!.name.left + (row.level - 1) * step;
          expect(row.name.left, row.key).toBeCloseTo(expected, 0);
        }
      },
    );

    it("lets a long name use the room the photo gave up, up to its row's pinned actions", async () => {
      const long = product({
        id: "croquetas",
        name: "Croquetas caseras de jamón ibérico de bellota",
        primaryCategoryId: "m",
        image: "croquetas.png",
      });
      const { root } = await mountPhone({ products: [...deepProducts(), long] });
      // The names are fitted a frame after the table turns narrow.
      for (let i = 0; i < 2; i += 1) await new Promise(requestAnimationFrame);
      const name = root.querySelector<HTMLElement>(
        'tr[data-row-key="croquetas"] [part~="name-stack"]',
      )!;
      const cell = name.closest("td")!;
      const pinned = cell
        .closest("tr")!
        .querySelector('td[data-pinned="end"]')!
        .getBoundingClientRect().left;
      expect(root.querySelector<HTMLElement>(".scroll")!.scrollLeft).toBe(0);
      const room =
        pinned -
        name.getBoundingClientRect().left -
        parseFloat(getComputedStyle(cell).paddingInlineEnd);
      expect(Math.abs(parseFloat(getComputedStyle(name).maxInlineSize) - room)).toBeLessThanOrEqual(
        1,
      );
    });

    it.each([false, true])(
      "puts the Name heading over the first name in the column (selecting: %s)",
      async (selecting) => {
        const { root } = await mountPhone({ selecting });
        const heading = root.querySelector<HTMLElement>('thead th button[data-sort="name"]')!;
        expect(heading.getBoundingClientRect().left).toBeCloseTo(
          pieces(root, ROOT_KEY).name.left,
          0,
        );
      },
    );
  });

  describe("with reordering off", () => {
    async function at(width: number, body: () => Promise<void>) {
      const restore = { width: window.innerWidth, height: window.innerHeight };
      try {
        await page.viewport(width, 844);
        await body();
      } finally {
        await page.viewport(restore.width, restore.height);
      }
    }

    async function mountOff(width: number) {
      const mounted = await mountDeep({ reordering: false });
      await vi.waitFor(() => expect(mounted.table.hasAttribute("narrow")).toBe(width < 440));
      for (let i = 0; i < 2; i += 1) await new Promise(requestAnimationFrame);
      return mounted;
    }

    it.each([1280, 390])("draws no grip and no grip space on any row at %i px", (width) =>
      at(width, async () => {
        const { root } = await mountOff(width);
        expect(root.querySelectorAll("tbody tr[data-row-key]").length).toBe(ROWS.length + 1);
        expect(root.querySelector('.drag-grip, [part~="grip-space"]')).toBeNull();
      }),
    );

    it("lifts nothing for a mouse press-and-move on a product or a category", async () => {
      const { el, root } = await mountDeep({ reordering: false });
      const offered: string[][] = [];
      el.addEventListener("drag-items", (event) =>
        offered.push((event as CustomEvent<{ keys: string[] }>).detail.keys),
      );
      const press = (target: Element, pointerId: number, pointerType: string) => {
        const box = target.getBoundingClientRect();
        for (const [type, dy] of [
          ["pointerdown", 0],
          ["pointermove", 40],
        ] as const)
          target.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              composed: true,
              pointerId,
              pointerType,
              clientX: box.x + 8,
              clientY: box.y + 8 + dy,
            }),
          );
      };
      press(root.querySelector('tr[data-row-key="bread"] [part~="product-cell"]')!, 1, "mouse");
      press(root.querySelector('tr[data-row-key="folder:f"] [part~="folder-cell"]')!, 2, "mouse");
      press(root.querySelector('tr[data-row-key="cola"] [part~="product-cell"]')!, 3, "touch");
      expect(offered).toEqual([]);
      expect(root.querySelector('[part~="dragging"]')).toBeNull();
      document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    });

    it.each([1280, 390])("puts the Name heading over All products' name at %i px", (width) =>
      at(width, async () => {
        const { root } = await mountOff(width);
        const heading = root.querySelector<HTMLElement>('thead th button[data-sort="name"]')!;
        expect(heading.getBoundingClientRect().left).toBeCloseTo(
          pieces(root, ROOT_KEY).name.left,
          0,
        );
      }),
    );

    it.each([1280, 390])("starts a variant's name under its product's at %i px", (width) =>
      at(width, async () => {
        const { root } = await mountOff(width);
        expect(pieces(root, "loin:s250").name.left).toBeCloseTo(pieces(root, "loin").name.left, 0);
      }),
    );

    it("ends a drag held when the mode turns off, sending no drop and leaving no row marked", async () => {
      const { el, root } = await mountDeep();
      const drops: unknown[] = [];
      el.addEventListener("drop-items", (event) => drops.push((event as CustomEvent).detail));
      const at = (target: Element, type: string, over: Element = target) => {
        const box = over.getBoundingClientRect();
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            composed: true,
            cancelable: true,
            pointerId: 1,
            clientX: box.x + 8,
            clientY: box.y + 8,
          }),
        );
      };
      const bread = root.querySelector('tr[data-row-key="bread"] [part~="product-cell"]')!;
      const food = root.querySelector('tr[data-row-key="folder:f"] [part~="folder-cell"]')!;
      at(bread, "pointerdown");
      at(food, "pointermove");
      await el.updateComplete;
      expect(root.querySelector('[part~="dragging"]')).not.toBeNull();
      el.reordering = false;
      await el.updateComplete;
      at(food, "pointerup");
      await el.updateComplete;
      expect(drops).toEqual([]);
      expect(root.querySelector('[part~="dragging"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-test="drag-ghost"]')).toBeNull();
    });
  });

  it("shows no Main category column and offers none in Customise", async () => {
    const { root } = await mountDeep();
    const headings = [...root.querySelectorAll("thead th")].map((th) => th.textContent!.trim());
    expect(headings).not.toContain(t("editor.main_category"));
    expect(root.querySelector('input[data-column="reporting-category"]')).toBeNull();
  });

  it("ignores the old Main category column's key in a saved column choice and order, and applies the rest", async () => {
    localStorage.setItem(
      "waitron.products.table:columns",
      JSON.stringify({ "reporting-category": true, modifiers: false }),
    );
    localStorage.setItem(
      "waitron.products.table:column-order",
      JSON.stringify(["reporting-category", "price", "made-at"]),
    );
    const { root } = await mountDeep();
    const headings = [...root.querySelectorAll("thead th:not(.select)")].map((th) =>
      th.textContent!.replace(/[▲▼]/g, "").trim(),
    );
    expect(headings[1]).toBe(t("product.price"));
    expect(headings.indexOf(t("product.price"))).toBeLessThan(
      headings.indexOf(t("product.made_at")),
    );
    expect(headings).not.toContain(t("editor.main_category"));
    expect(headings).not.toContain(t("editor.modifiers"));
  });

  it("still finds an empty category by its parent's path", async () => {
    const { el, root } = await mountDeep({ products: [] });
    el.search = "Food / Meat";
    await el.updateComplete;
    await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
    expect(rowKeys(root)).toContain("folder:g");
    expect(rowKeys(root)).not.toContain("folder:d");
  });

  it("still finds a product by its category's path", async () => {
    const { el, root } = await mountDeep();
    el.search = "Food / Meat / Grill";
    await el.updateComplete;
    await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
    expect(rowKeys(root)).toContain("ribs");
    expect(rowKeys(root)).not.toContain("chop");
  });

  it.each(["Food › Meat › Grill", "Food > Meat > Grill"])(
    "finds a product by its category's path typed as %s",
    async (typed) => {
      const { el, root } = await mountDeep();
      el.search = typed;
      await el.updateComplete;
      await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
      expect(rowKeys(root)).toContain("ribs");
      expect(rowKeys(root)).not.toContain("chop");
    },
  );

  it.each(["Food › Meat", "Food > Meat"])(
    "finds an empty category by its parent's path typed as %s",
    async (typed) => {
      const { el, root } = await mountDeep({ products: [] });
      el.search = typed;
      await el.updateComplete;
      await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
      expect(rowKeys(root)).toContain("folder:g");
      expect(rowKeys(root)).not.toContain("folder:d");
    },
  );

  it("finds a product by its category's path after a category above it is renamed", async () => {
    const { el, root } = await mountDeep();
    el.categories = el.categories.map((each) =>
      each.id === "m" ? { ...each, name: "Butcher" } : each,
    );
    el.search = "Food / Butcher / Grill";
    await el.updateComplete;
    await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
    expect(rowKeys(root)).toContain("ribs");
    el.search = "Food / Meat / Grill";
    await el.updateComplete;
    await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
    expect(rowKeys(root)).not.toContain("ribs");
  });

  it("does not find a product by text that runs from one spelling of its path into the next", async () => {
    const { el, root } = await mountDeep();
    el.search = "Grill Food / Meat";
    await el.updateComplete;
    await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
    expect(rowKeys(root)).not.toContain("ribs");
  });
});

describe("a category's Made at", () => {
  const bar = { kind: "station" as const, stationName: "Bar" };
  type Entries = [string, FolderMadeAt][];
  async function mountMadeAt(entries: Entries, props: Partial<ProductList> = {}) {
    setLocale("en");
    const mounted = await mountTree({ folderMadeAt: new Map(entries), ...props });
    await openRow(mounted.el, "folder:d");
    return mounted;
  }
  const madeAtCell = (root: ShadowRoot, key: string) => cellUnder(root, key, t("product.made_at"));
  const detailOf = (root: ShadowRoot, key: string) =>
    madeAtCell(root, key).querySelector('[part~="maker-detail"]')?.textContent?.trim();

  it("names the station the category's cell sends it to, set on that category, linked to the Routing tab", async () => {
    const { root } = await mountMadeAt([
      ["d", { maker: bar, source: { kind: "own" }, someElsewhere: false }],
    ]);
    const link = madeAtCell(root, "folder:d").querySelector("a")!;
    expect(link.textContent!.trim()).toBe("Bar");
    expect(link.getAttribute("href")).toBe("/manage/prep-stations/view/routing");
    expect(detailOf(root, "folder:d")).toBe("set on this category");
  });

  it("names the category an inherited cell comes from", async () => {
    const { root } = await mountMadeAt([
      ["b", { maker: bar, source: { kind: "inherited", name: "Drinks" }, someElsewhere: false }],
    ]);
    expect(madeAtCell(root, "folder:b").querySelector("a")!.textContent!.trim()).toBe("Bar");
    expect(detailOf(root, "folder:b")).toBe("from Drinks");
  });

  it("keeps a category name with a replacement pattern literal", async () => {
    const { root } = await mountMadeAt([
      ["b", { maker: bar, source: { kind: "inherited", name: "$& Co" }, someElsewhere: false }],
    ]);
    expect(detailOf(root, "folder:b")).toBe("from $& Co");
  });

  it("marks a route that falls to the default station", async () => {
    const { root } = await mountMadeAt([
      [
        "f",
        {
          maker: { kind: "station", stationName: "Kitchen" },
          source: { kind: "default" },
          someElsewhere: false,
        },
      ],
    ]);
    expect(madeAtCell(root, "folder:f").querySelector("a")!.textContent!.trim()).toBe("Kitchen");
    expect(detailOf(root, "folder:f")).toBe("default station");
  });

  it("marks a route a cell decides by where the cell is, never as an exception", async () => {
    const { root } = await mountMadeAt([
      ["d", { maker: bar, source: { kind: "own" }, someElsewhere: false }],
      ["f", { maker: bar, source: { kind: "inherited", name: "Drinks" }, someElsewhere: false }],
    ]);
    expect(detailOf(root, "folder:d")).toBe("set on this category");
    expect(detailOf(root, "folder:f")).toBe("from Drinks");
  });

  it("uses the product rows' words for no preparation, no replacement and nowhere", async () => {
    const { root } = await mountMadeAt([
      ["d", { maker: { kind: "no_preparation" }, source: { kind: "own" }, someElsewhere: false }],
      [
        "b",
        {
          maker: { kind: "no_replacement", stationName: "Cocktail bar" },
          source: { kind: "own" },
          someElsewhere: false,
        },
      ],
      ["f", { maker: { kind: "nowhere" }, source: null, someElsewhere: false }],
    ]);
    expect(madeAtCell(root, "folder:d").querySelector("a")!.textContent!.trim()).toBe(
      "No preparation",
    );
    expect(madeAtCell(root, "folder:b").querySelector("a")!.textContent!.trim()).toBe(
      "No replacement (Cocktail bar is disabled)",
    );
    const nowhere = madeAtCell(root, "folder:f");
    expect(nowhere.querySelector("a")!.textContent!.trim()).toBe("Nowhere");
    expect(nowhere.querySelector('[part~="maker-detail"]')).toBeNull();
  });

  it("says some items are made elsewhere when the baseline is not a promise for everything inside", async () => {
    const { root } = await mountMadeAt([
      ["d", { maker: bar, source: { kind: "own" }, someElsewhere: true }],
      ["f", { maker: { kind: "nowhere" }, source: null, someElsewhere: true }],
    ]);
    expect(detailOf(root, "folder:d")).toBe("set on this category · some items made elsewhere");
    expect(detailOf(root, "folder:f")).toBe("some items made elsewhere");
  });

  it("draws the detail smaller and muted, under the station", async () => {
    const { el, root } = await mountMadeAt([
      ["d", { maker: bar, source: { kind: "own" }, someElsewhere: false }],
    ]);
    const detail = madeAtCell(root, "folder:d").querySelector<HTMLElement>(
      '[part~="maker-detail"]',
    )!;
    const style = getComputedStyle(detail);
    expect(style.display).toBe("block");
    // Resolved against the mounted host, which carries the tokens.
    const probe = document.createElement("span");
    probe.style.color = "var(--wt-color-text-muted)";
    probe.style.fontSize = "var(--wt-font-size-sm)";
    el.parentElement!.append(probe);
    onTestFinished(() => probe.remove());
    expect(style.color).toBe(getComputedStyle(probe).color);
    expect(style.fontSize).toBe(getComputedStyle(probe).fontSize);
  });

  it("leaves a category's cell blank while routing has not loaded", async () => {
    const { root } = await mountMadeAt([]);
    const cell = madeAtCell(root, "folder:d");
    expect(cell.textContent!.trim()).toBe("");
    expect(cell.querySelector("a")).toBeNull();
  });

  it("says routing could not be read, without a link, when its read failed", async () => {
    const { root } = await mountMadeAt([], { routingFailed: true });
    const cell = madeAtCell(root, "folder:d");
    expect(cell.textContent!.trim()).toBe("Kitchen routing unavailable");
    expect(cell.querySelector("a")).toBeNull();
    expect(cell.querySelector('[part~="maker-detail"]')).not.toBeNull();
  });

  it("leaves All products without a station in every state", async () => {
    for (const props of [
      { folderMadeAt: new Map<string, FolderMadeAt>() },
      { routingFailed: true },
    ]) {
      const { root } = await mountMadeAt(
        [["d", { maker: bar, source: { kind: "own" }, someElsewhere: false }]],
        props,
      );
      expect(madeAtCell(root, ROOT_KEY).textContent!.trim()).toBe("");
      cleanupWidgets();
    }
  });

  it("keeps a product row's own value and its tester link beside the categories'", async () => {
    const { root } = await mountMadeAt(
      [["d", { maker: { kind: "no_preparation" }, source: { kind: "own" }, someElsewhere: true }]],
      {
        madeAt: {
          cola: {
            stationId: "kitchen",
            stationName: "Kitchen",
            noPreparation: false,
            noReplacement: false,
            variesByZone: true,
          },
        },
      },
    );
    const cell = madeAtCell(root, "cola");
    expect(cell.textContent!.trim()).toBe("Kitchen · varies by service zone");
    expect(cell.querySelector("a")!.getAttribute("href")).toBe("/manage/prep-stations/test/cola");
  });

  it("speaks Spanish", async () => {
    const { el, root } = await mountMadeAt([
      ["d", { maker: bar, source: { kind: "own" }, someElsewhere: true }],
    ]);
    setLocale("es");
    el.requestUpdate();
    await el.updateComplete;
    await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
    expect(detailOf(root, "folder:d")).toBe(
      "asignada a esta categoría · algunos productos se preparan en otro sitio",
    );
  });
});

it("falls back as product rows do when a switched-off station's or a category's name is not known", async () => {
  setLocale("en");
  const { el } = await mountTree({
    folderMadeAt: new Map<string, FolderMadeAt>([
      [
        "d",
        {
          maker: { kind: "no_replacement", stationName: null },
          source: { kind: "inherited", name: null },
          someElsewhere: false,
        },
      ],
    ]),
  });
  const root = await tableRoot(el);
  expect(cellUnder(root, "folder:d", "Made at").textContent!.replace(/\s+/g, " ").trim()).toBe(
    "No replacement (Nowhere is disabled) from Unavailable selection",
  );
});

describe("a refresh during a drag", () => {
  function press(target: Element, type: string, over: Element = target) {
    const box = over.getBoundingClientRect();
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: 1,
        clientX: box.x + 8,
        clientY: box.y + 8,
      }),
    );
  }

  const nameOf = (root: ShadowRoot, key: string) =>
    root.querySelector<HTMLElement>(
      `tr[data-row-key="${key}"] [part~="${key.startsWith("folder:") ? "folder-cell" : "product-cell"}"]`,
    )!;

  async function refreshed(el: ProductList, props: Partial<ProductList>): Promise<ShadowRoot> {
    Object.assign(el, props);
    await el.updateComplete;
    return tableRoot(el);
  }

  function watch(el: ProductList) {
    const offered: string[][] = [];
    const drops: { keys: string[]; folderId: string | null }[] = [];
    el.addEventListener("drag-items", (event) =>
      offered.push((event as CustomEvent<{ keys: string[] }>).detail.keys),
    );
    el.addEventListener("drop-items", (event) =>
      drops.push((event as CustomEvent<{ keys: string[]; folderId: string | null }>).detail),
    );
    return { offered, drops };
  }

  const anyDropMark = (root: ShadowRoot) =>
    root.querySelector(
      '[part~="drop-target"], [part~="drop-gap-before"], [part~="drop-gap-after"]',
    );

  it("starts no drag, and throws nothing, when a refresh removes the pressed product before it moves", async () => {
    const { el, root } = await mountTree();
    const { offered, drops } = watch(el);
    const errors: string[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.message);
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    onTestFinished(() => window.removeEventListener("error", onError));
    press(nameOf(root, "bread"), "pointerdown");
    const after = await refreshed(el, {
      products: treeProducts().filter(({ id }) => id !== "bread"),
    });
    const food = nameOf(after, "folder:f");
    press(food, "pointermove");
    await el.updateComplete;
    expect(errors).toEqual([]);
    expect(offered.filter((keys) => keys.length)).toEqual([]);
    expect(document.body.style.cursor).not.toBe("grabbing");
    expect(el.shadowRoot!.querySelector('[data-test="drag-ghost"]')).toBeNull();
    expect(after.querySelector('[part~="drop-target"]')).toBeNull();
    press(food, "pointerup");
    expect(drops).toEqual([]);
  });

  it("sends nothing when released after a refresh removed the category it would drop into, and the next drag still drops", async () => {
    const { el, root } = await mountTree();
    const { drops } = watch(el);
    press(nameOf(root, "bread"), "pointerdown");
    press(nameOf(root, "folder:f"), "pointermove");
    await el.updateComplete;
    expect(root.querySelector('tr[data-row-key="folder:f"] [part~="drop-target"]')).not.toBeNull();
    const after = await refreshed(el, { categories: [drinks, beer] });
    expect(after.querySelector('tr[data-row-key="folder:f"]')).toBeNull();
    press(document.body, "pointerup", nameOf(after, "bread"));
    await el.updateComplete;
    expect(drops).toEqual([]);
    expect(document.body.style.cursor).not.toBe("grabbing");

    press(nameOf(after, "bread"), "pointerdown");
    press(nameOf(after, "folder:d"), "pointermove");
    press(nameOf(after, "folder:d"), "pointerup");
    expect(drops).toEqual([{ keys: ["bread"], folderId: "d" }]);
  });

  it("sends nothing when released after a refresh removed the dragged product", async () => {
    const { el, root } = await mountTree();
    const { drops } = watch(el);
    press(nameOf(root, "bread"), "pointerdown");
    press(nameOf(root, "folder:f"), "pointermove");
    await el.updateComplete;
    const after = await refreshed(el, {
      products: treeProducts().filter(({ id }) => id !== "bread"),
    });
    press(nameOf(after, "folder:f"), "pointerup");
    await el.updateComplete;
    expect(drops).toEqual([]);
    expect(document.body.style.cursor).not.toBe("grabbing");
  });

  it("offers no category, and sends nothing when released, after a refresh removed the dragged product and the pointer moved on", async () => {
    const { el, root } = await mountTree();
    const { drops } = watch(el);
    press(nameOf(root, "bread"), "pointerdown");
    press(nameOf(root, "folder:f"), "pointermove");
    await el.updateComplete;
    expect(root.querySelector('tr[data-row-key="folder:f"] [part~="drop-target"]')).not.toBeNull();
    const after = await refreshed(el, {
      products: treeProducts().filter(({ id }) => id !== "bread"),
    });
    expect(anyDropMark(after)).toBeNull();
    press(nameOf(after, "folder:d"), "pointermove");
    await el.updateComplete;
    expect(anyDropMark(after)).toBeNull();
    press(nameOf(after, "folder:d"), "pointerup");
    await el.updateComplete;
    expect(drops).toEqual([]);
    expect(document.body.style.cursor).not.toBe("grabbing");
  });

  it("offers no category, and sends nothing when released, after a refresh removed another selected product being dragged", async () => {
    const { el, root } = await mountTree({ selected: ["bread", "cola"] });
    const { offered, drops } = watch(el);
    press(nameOf(root, "bread"), "pointerdown");
    press(nameOf(root, "folder:d"), "pointermove");
    await el.updateComplete;
    expect(offered).toContainEqual(["bread", "cola"]);
    expect(root.querySelector('tr[data-row-key="folder:d"] [part~="drop-target"]')).not.toBeNull();
    const after = await refreshed(el, {
      products: treeProducts().filter(({ id }) => id !== "cola"),
    });
    expect(anyDropMark(after)).toBeNull();
    press(nameOf(after, "folder:f"), "pointermove");
    await el.updateComplete;
    expect(anyDropMark(after)).toBeNull();
    press(nameOf(after, "folder:f"), "pointerup");
    await el.updateComplete;
    expect(drops).toEqual([]);
  });

  it("moves the gap to the row the dragged product would now land before when a refresh adds one to the target category", async () => {
    const { el } = await mountTree();
    await openRow(el, "folder:d");
    const root = await tableRoot(el);
    const gapBefore = (at: ShadowRoot) =>
      [
        ...at.querySelectorAll<HTMLElement>('tr[data-row-key]:has(> td[part~="drop-gap-before"])'),
      ].map((row) => row.dataset.rowKey);
    press(nameOf(root, "bread"), "pointerdown");
    press(nameOf(root, "folder:f"), "pointermove");
    press(nameOf(root, "folder:d"), "pointermove");
    expect(gapBefore(root)).toEqual(["cola"]);
    const after = await refreshed(el, {
      products: [
        ...treeProducts(),
        product({ id: "butter", name: "Butter", primaryCategoryId: "d" }),
      ],
    });
    expect(gapBefore(after)).toEqual(["butter"]);
    expect(after.querySelector('tr[data-row-key="folder:d"] [part~="drop-target"]')).not.toBeNull();
    press(nameOf(after, "folder:d"), "pointercancel");
  });

  it("keeps All products as the target through a refresh that leaves the dragged product", async () => {
    const { el } = await mountTree();
    await openRow(el, "folder:d");
    const root = await tableRoot(el);
    const { drops } = watch(el);
    const allProducts = `tr[data-row-key="${ROOT_KEY}"]`;
    press(nameOf(root, "cola"), "pointerdown");
    press(root.querySelector(`${allProducts} [part~="folder-cell"]`)!, "pointermove");
    const after = await refreshed(el, {
      products: [
        ...treeProducts(),
        product({ id: "butter", name: "Butter", primaryCategoryId: "f" }),
      ],
    });
    expect(after.querySelector(`${allProducts} [part~="drop-target"]`)).not.toBeNull();
    press(after.querySelector(`${allProducts} [part~="folder-cell"]`)!, "pointerup");
    expect(drops).toEqual([{ keys: ["cola"], folderId: null }]);
  });
});

describe("a category row's leading slot", () => {
  async function atWidth(width: number, body: () => Promise<void>) {
    const restore = { width: window.innerWidth, height: window.innerHeight };
    try {
      await page.viewport(width, 844);
      await body();
    } finally {
      await page.viewport(restore.width, restore.height);
    }
  }

  const rectOf = (root: ShadowRoot, selector: string) =>
    root.querySelector<HTMLElement>(selector)!.getBoundingClientRect();

  it.each(
    [1280, 390].flatMap((width) => [true, false].map((reordering) => ({ width, reordering }))),
  )(
    "draws no folder icon and puts each category's swatch in its leading slot, before its name ($width px, reordering: $reordering)",
    ({ width, reordering }) =>
      atWidth(width, async () => {
        const { el, root } = await mountTree({
          reordering,
          categories: [{ ...drinks, color: "#b12525" }, beer, food],
        });
        await openRow(el, "folder:d");
        el.nameDraft = { kind: "create", parentId: "d" };
        await el.updateComplete;
        await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
        expect(root.querySelectorAll('tbody tr wt-icon[name="folder"]')).toHaveLength(0);
        for (const id of ["d", "b", "f"]) {
          const row = `tr[data-row-key="folder:${id}"]`;
          const swatch = root.querySelector(`${row} [data-test="color-${id}"]`)!;
          expect(swatch.closest('[part~="folder-frame"]'), id).not.toBeNull();
          expect(swatch.getBoundingClientRect().right, id).toBeLessThanOrEqual(
            rectOf(root, `${row} strong`).left,
          );
        }
        if (width === 1280) {
          // Bread and Food both sit in All products; Cola and Beer both in Drinks.
          expect(rectOf(root, 'tr[data-row-key="folder:f"] strong').left).toBeCloseTo(
            rectOf(root, 'tr[data-row-key="bread"] strong').left,
            0,
          );
          expect(rectOf(root, 'tr[data-row-key="folder:b"] strong').left).toBeCloseTo(
            rectOf(root, 'tr[data-row-key="cola"] strong').left,
            0,
          );
        }
      }),
  );

  it.each([true, false])(
    "draws one colour square on a category being renamed, the name box's own, in the row's leading slot (reordering: %s)",
    async (reordering) => {
      const { el, root } = await mountTree({
        reordering,
        categories: [{ ...drinks, color: "#b12525" }, beer, food],
      });
      el.nameDraft = { kind: "rename", categoryId: "d" };
      await el.updateComplete;
      await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
      const row = root.querySelector<HTMLElement>('tr[data-row-key="folder:d"]')!;
      const squares = row.querySelectorAll('[part~="color-swatch"]');
      expect(squares).toHaveLength(1);
      expect(squares[0]!.closest('[data-test="name-box-color"]')).not.toBeNull();
      const frames = row.querySelectorAll('[part~="folder-frame"]');
      expect(frames).toHaveLength(1);
      expect(frames[0]!.childElementCount).toBe(1);
      expect(frames[0]!.firstElementChild!.getAttribute("data-test")).toBe("name-box-color");
    },
  );

  const rectValues = (rect: DOMRect) => ({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  });

  it.each([true, false])(
    "keeps a renamed category's square where it was and starts the name box where the name started at 1280 px (reordering: %s)",
    (reordering) =>
      atWidth(1280, async () => {
        const { el, root } = await mountTree({
          reordering,
          categories: [{ ...drinks, color: "#b12525" }, beer, food],
        });
        const row = 'tr[data-row-key="folder:d"]';
        const squareAtRest = rectValues(rectOf(root, `${row} [data-test="color-d"]`));
        const nameLeft = rectOf(root, `${row} strong`).left;
        el.nameColor = "#b12525";
        el.nameDraft = { kind: "rename", categoryId: "d" };
        await el.updateComplete;
        await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
        const square = root.querySelector<HTMLElement>(
          `${row} [part~="folder-frame"] > [data-test="name-box-color"]`,
        )!;
        expect(square).not.toBeNull();
        expect(rectValues(square.getBoundingClientRect())).toEqual(squareAtRest);
        expect(rectOf(root, `${row} wt-input[name="category-name"]`).left).toBe(nameLeft);
        expect(root.querySelector('wt-input[name="category-name"] > [slot="end"]')).toBeNull();
      }),
  );

  it("draws a renamed category's arrow in the size, colour and font of its arrow at rest", async () => {
    const { el, root } = await mountTree({
      categories: [{ ...drinks, color: "#b12525" }, beer, food],
    });
    const row = 'tr[data-row-key="folder:d"]';
    const look = (selector: string) => {
      const style = getComputedStyle(root.querySelector<HTMLElement>(selector)!);
      return { fontSize: style.fontSize, color: style.color, fontFamily: style.fontFamily };
    };
    const atRest = look(`${row} .tree-arrow`);
    el.nameDraft = { kind: "rename", categoryId: "d" };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    expect(look(`${row} .tree-toggle`)).toEqual(atRest);
  });

  it("puts a new category's square in its leading slot, lined up with its siblings' squares, at 1280 px", () =>
    atWidth(1280, async () => {
      const { el, root } = await mountTree({
        categories: [{ ...drinks, color: "#b12525" }, beer, food],
      });
      el.nameDraft = { kind: "create", parentId: null };
      await el.updateComplete;
      await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
      const square = root.querySelector<HTMLElement>(
        'tr[data-row-key="draft:new"] [part~="folder-frame"] > [data-test="name-box-color"]',
      )!;
      expect(square).not.toBeNull();
      const sibling = rectOf(root, '[data-test="color-d"]');
      expect(square.getBoundingClientRect().left).toBe(sibling.left);
      expect(square.getBoundingClientRect().width).toBe(sibling.width);
      expect(root.querySelector('wt-input[name="category-name"] > [slot="end"]')).toBeNull();
    }));

  it.each(
    [
      { kind: "rename", categoryId: "d" } as const,
      { kind: "create", parentId: "d" } as const,
    ].flatMap((draft) => [true, false].map((reordering) => ({ draft, reordering }))),
  )(
    "shows the square in the row's leading slot above the name box at 390 px ($draft.kind, reordering: $reordering)",
    ({ draft, reordering }) =>
      atWidth(390, async () => {
        const { el, root, table } = await mountTree({
          reordering,
          categories: [{ ...drinks, color: "#b12525" }, beer, food],
        });
        await vi.waitFor(() => expect(table.hasAttribute("narrow")).toBe(true));
        expect(window.innerWidth).toBe(390);
        el.nameDraft = draft;
        await el.updateComplete;
        await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
        const box = root.querySelector<HTMLElement>('wt-input[name="category-name"]')!;
        const row = box.closest("tr")!;
        const square = row.querySelector<HTMLElement>(
          '[part~="folder-frame"] > [data-test="name-box-color"]',
        )!;
        expect(square).not.toBeNull();
        const rect = square.getBoundingClientRect();
        expect(rect.width).toBeGreaterThan(0);
        expect(rect.height).toBeGreaterThan(0);
        expect(rect.bottom).toBeLessThanOrEqual(box.getBoundingClientRect().top);
        const cell = row.querySelector('[part~="folder-cell"]')!.getBoundingClientRect();
        expect(box.getBoundingClientRect().left).toBeCloseTo(cell.left, 0);
        expect(box.querySelector(':scope > [slot="end"]')).toBeNull();
      }),
  );

  it("draws the venue default's swatch in All products' leading slot, outlined while there is none, and its click sends root-color without opening anything", async () => {
    const { el, root, table } = await mountTree();
    const sent: unknown[] = [];
    for (const name of ["root-color", "category-toggle", "drag-items"])
      el.addEventListener(name, (event) => sent.push([name, (event as CustomEvent).detail]));
    const row = `tr[data-row-key="${ROOT_KEY}"]`;
    const button = () => root.querySelector<HTMLButtonElement>(`${row} [data-test="color-root"]`)!;
    const chip = () => button().querySelector<HTMLElement>('[part~="color-swatch"]')!;
    expect(button().matches('button[part~="swatch-button"]')).toBe(true);
    expect(button().parentElement!.getAttribute("part")).toBe("folder-frame");
    expect(button().getAttribute("aria-label")).toBe(
      t("folders.edit_color").replace("{name}", t("folders.all_products")),
    );
    expect(chip().getAttribute("part")).toBe("color-swatch empty");
    expect(getComputedStyle(chip()).backgroundColor).toBe("rgba(0, 0, 0, 0)");

    el.defaultColor = "#b12525";
    await el.updateComplete;
    await table.updateComplete;
    expect(chip().getAttribute("part")).toBe("color-swatch");
    expect(getComputedStyle(chip()).backgroundColor).toBe("rgb(177, 37, 37)");

    await userEvent.click(button());
    await table.updateComplete;
    expect(sent).toEqual([["root-color", {}]]);
    expect(rowKeys(root)).toEqual(["folder:d", "folder:f", "bread"]);
  });

  it.each([1280, 560])(
    "draws one colour square at every level of a nested tree, each at its own row's indent (%i px)",
    (width) =>
      atWidth(width, async () => {
        const { el, table, root } = await mountTree({
          defaultColor: "#777777",
          categories: [
            { ...drinks, color: "#b12525" },
            beer,
            { id: "c", name: "Craft", parentId: "b", color: "#2a9d8f" },
          ],
          products: [
            product({
              id: "ipa",
              name: "IPA",
              primaryCategoryId: "c",
              image: null,
              variants: [
                { ...bunVariant, id: "pint", name: "Pint" },
                { ...bunVariant, id: "half", name: "Half" },
              ],
            }),
            product({
              id: "stout",
              name: "Stout",
              primaryCategoryId: "b",
              image: null,
              color: "#e07a5f",
            }),
          ],
        });
        for (const key of ["folder:d", "folder:b", "folder:c"]) await openRow(el, key);
        root.querySelector<HTMLElement>('tr[data-row-key="ipa"] .tree-toggle')!.click();
        await table.updateComplete;

        const rows = {
          root: ROOT_KEY,
          d: "folder:d",
          b: "folder:b",
          c: "folder:c",
          ipa: "ipa",
          pint: "ipa:pint",
          half: "ipa:half",
          stout: "stout",
        };
        const levels = Object.keys(rows) as (keyof typeof rows)[];
        const square = (level: keyof typeof rows) => {
          const row = root.querySelector(`tr[data-row-key="${rows[level]}"]`);
          expect(row, level).not.toBeNull();
          const squares = row!.querySelectorAll<HTMLElement>('[part~="color-swatch"]');
          expect(squares, level).toHaveLength(1);
          expect(
            row!.querySelector(`[data-test="color-${level}"] [part~="color-swatch"]`),
            level,
          ).toBe(squares[0]);
          const box = squares[0]!.getBoundingClientRect();
          expect(box.width, level).toBeGreaterThan(0);
          const style = getComputedStyle(squares[0]!);
          return {
            x: box.left,
            paint: style.backgroundColor,
            outline: {
              width: parseFloat(style.borderTopWidth),
              style: style.borderTopStyle,
              color: style.borderTopColor,
            },
          };
        };
        const at = Object.fromEntries(levels.map((level) => [level, square(level)]));

        expect(at.b!.outline.width).toBeGreaterThan(0);
        expect(at.b!.outline.style).not.toBe("none");
        expect(at.b!.outline.color).not.toBe("rgba(0, 0, 0, 0)");
        expect(at.b!.outline.style).toBe("dashed");
        expect(
          root.querySelector('[data-test="color-b"] [part~="color-swatch"]')!.getAttribute("part"),
        ).toBe("color-swatch inherited");
        expect(Object.fromEntries(levels.map((id) => [id, at[id]!.paint]))).toEqual({
          root: "rgb(119, 119, 119)",
          d: "rgb(177, 37, 37)",
          b: "rgb(177, 37, 37)",
          c: "rgb(42, 157, 143)",
          ipa: "rgb(42, 157, 143)",
          pint: "rgb(42, 157, 143)",
          half: "rgb(42, 157, 143)",
          stout: "rgb(224, 122, 95)",
        });

        // A415: squares step in a level at a time, not one column for the whole tree (owner, 2026-10-08).
        const step = at.d!.x - at.root!.x;
        expect(step).toBeGreaterThan(0);
        for (const [upper, lower] of [
          ["d", "b"],
          ["b", "c"],
          ["c", "ipa"],
        ])
          expect(at[lower]!.x - at[upper]!.x, `${upper} → ${lower}`).toBeCloseTo(step, 1);
        expect(at.pint!.x).toBeCloseTo(at.ipa!.x, 1);
        expect(at.half!.x).toBeCloseTo(at.ipa!.x, 1);
        expect(at.stout!.x).toBeCloseTo(at.c!.x, 1);
      }),
  );

  it("gives All products a swatch the width of a top-level category's, as far from its name, at 1280 px", () =>
    atWidth(1280, async () => {
      const { root } = await mountTree();
      const rootRow = `tr[data-row-key="${ROOT_KEY}"]`;
      const category = 'tr[data-row-key="folder:d"]';
      const rootSwatch = rectOf(root, `${rootRow} [data-test="color-root"]`);
      const categorySwatch = rectOf(root, `${category} [data-test="color-d"]`);
      expect(rootSwatch.width).toBeGreaterThan(0);
      expect(rootSwatch.width).toBeCloseTo(categorySwatch.width, 1);
      const rootGap = rectOf(root, `${rootRow} strong`).left - rootSwatch.left;
      const categoryGap = rectOf(root, `${category} strong`).left - categorySwatch.left;
      expect(Math.abs(rootGap - categoryGap)).toBeLessThanOrEqual(0.5);
    }));
});

describe("a category whose name wraps", () => {
  it.each(
    ["en-GB", "es-ES"].flatMap((locale) =>
      [true, false].map((reordering) => ({ locale, reordering })),
    ),
  )(
    "keeps its grip beside the name's first line and hides its swatch at 390 px ($locale, reordering: $reordering)",
    async ({ locale, reordering }) => {
      const restore = {
        width: window.innerWidth,
        height: window.innerHeight,
        locale: currentLocale(),
      };
      try {
        setLocale(locale);
        await page.viewport(390, 844);
        const { root } = await mountTree({
          categories: [
            {
              id: "long",
              name: "Charcuterie y quesos ibéricos de bellota",
              parentId: null,
              color: "#b12525",
            },
          ],
          products: [],
          reordering,
        });
        for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
        const row = root.querySelector('tr[data-row-key="folder:long"]')!;
        const text = document.createRange();
        text.selectNodeContents(row.querySelector("strong")!);
        const lines = [...text.getClientRects()];
        const first = lines[0]!;
        const firstMiddle = first.top + first.height / 2;
        const whole = text.getBoundingClientRect();
        const wholeMiddle = whole.top + whole.height / 2;
        expect(new Set(lines.map(({ bottom }) => Math.round(bottom))).size).toBeGreaterThan(1);
        expect(row.querySelector('[data-test="color-long"]')!.getBoundingClientRect().width).toBe(
          0,
        );
        for (const part of reordering ? [".drag-grip"] : []) {
          const box = row.querySelector(part)!.getBoundingClientRect();
          const middle = box.top + box.height / 2;
          expect(Math.abs(middle - firstMiddle), part).toBeLessThanOrEqual(3);
          expect(wholeMiddle - middle, part).toBeGreaterThan(first.height / 3);
        }
      } finally {
        setLocale(restore.locale);
        await page.viewport(restore.width, restore.height);
      }
    },
  );
});

describe("a category's count", () => {
  it.each(["en-GB", "es-ES"].flatMap((locale) => [390, 1280].map((width) => ({ locale, width }))))(
    "is visually hidden on a phone, still names its row, and is shown on a wide screen ($locale, $width px)",
    async ({ locale, width }) => {
      const restore = {
        width: window.innerWidth,
        height: window.innerHeight,
        locale: currentLocale(),
      };
      try {
        setLocale(locale);
        await page.viewport(width, 844);
        const { el, root } = await mountTree();
        await openRow(el, "folder:d");
        await vi.waitFor(() => expect(root.host.hasAttribute("narrow")).toBe(width === 390));
        const counts = [...root.querySelectorAll<HTMLElement>('[part~="count"]')];
        expect(counts.map((count) => count.dataset.test)).toEqual(
          expect.arrayContaining(["count-root", "count-d", "count-b", "count-f"]),
        );
        await expect
          .element(root.querySelector<HTMLElement>('tr[data-row-key="folder:d"]')!, {
            timeout: 1000,
          })
          .toHaveAccessibleName(
            locale === "en-GB"
              ? /Drinks.*1 category, 1 product/
              : /Drinks.*1 categoría, 1 producto/,
          );
        for (const count of counts) {
          const test = count.dataset.test;
          expect(count.textContent!.trim(), test).not.toBe("");
          if (width === 390) {
            expect(getComputedStyle(count).display, test).not.toBe("none");
            expect(getComputedStyle(count).clipPath, test).toBe("inset(50%)");
            expect(count.getBoundingClientRect().width, test).toBe(1);
          } else {
            expect(getComputedStyle(count).clipPath, test).toBe("none");
            expect(count.getBoundingClientRect().width, test).toBeGreaterThan(1);
          }
        }
      } finally {
        setLocale(restore.locale);
        await page.viewport(restore.width, restore.height);
      }
    },
  );
});

describe("A303 tree media slots", () => {
  it.each([1280, 440, 390])(
    "uses equal category and product boxes, hiding both at %i px only when narrow",
    async (width) => {
      const before = { width: window.innerWidth, height: window.innerHeight };
      try {
        await page.viewport(width, 844);
        const { el, table } = await mountTree({
          reordering: false,
          products: [product({ id: "cola", primaryCategoryId: "d", image: "cola.webp" })],
        });
        el.style.width = `${width}px`;
        await openRow(el, "folder:d");
        await vi.waitFor(() => expect(table.hasAttribute("narrow")).toBe(width <= 440));
        const root = await tableRoot(el);
        const chip = root.querySelector<HTMLElement>(
          '[data-test="color-d"] [part~="color-swatch"]',
        )!;
        const photo = root.querySelector<HTMLElement>('[part~="thumb-frame"]')!;
        const slot = chip.closest<HTMLElement>('[part~="folder-frame"]')!;
        if (width <= 440) {
          expect(slot.getBoundingClientRect().width).toBe(0);
          expect(photo.getBoundingClientRect().width).toBe(0);
        } else {
          const a = chip.getBoundingClientRect(),
            b = photo.getBoundingClientRect();
          expect(a.width).toBeGreaterThan(0);
          expect(a.width).toBe(b.width);
          expect(a.height).toBe(b.height);
        }
      } finally {
        await page.viewport(before.width, before.height);
      }
    },
  );
});

it.each([390, 1280])(
  "aligns tree grips and selection boxes at every depth at %s px",
  async (width) => {
    await page.viewport(width, 844);
    const { table, root } = await mountTree({ selecting: true });
    table.setExpanded("folder:d", true);
    table.setExpanded("folder:b", true);
    await table.updateComplete;
    const controls = ["folder:d", "folder:b", "cola", "lager"].map((key) => {
      const row = root.querySelector(`tr[data-row-key="${key}"]`)!;
      return {
        grip: row.querySelector<HTMLElement>(".drag-grip")!,
        box: row.querySelector<HTMLElement>('input[type="checkbox"]')!,
      };
    });
    expect(controls[0]!.grip).not.toBeNull();
    for (const { grip, box } of controls) {
      expect(grip.getBoundingClientRect().left).toBeCloseTo(
        controls[0]!.grip.getBoundingClientRect().left,
        0,
      );
      expect(box.getBoundingClientRect().left).toBeCloseTo(
        controls[0]!.box.getBoundingClientRect().left,
        0,
      );
      expect(grip.closest("td")).toBe(box.closest("td"));
      expect(grip.closest("td")).toBe(grip.closest("tr")!.querySelector("td"));
    }
  },
);

describe("product media link", () => {
  it("paints the leading photo ring with inherited colour, and its swatch opens the product's Edit at the photo", async () => {
    const { el, root } = await mountTree({
      products: [product({ id: "cola", name: "Cola", primaryCategoryId: "d", image: "cola.webp" })],
      categories: [{ ...drinks, color: "#256bb1" }],
    });
    await openRow(el, "folder:d");
    const media = root.querySelector<HTMLAnchorElement>('[data-test="color-cola"]');
    expect(media).not.toBeNull();
    expect(media!.tagName).toBe("A");
    expect(media!.getAttribute("href")).toBe("/manage/catalogue/product/cola?field=image");
    expect(media!.getAttribute("aria-label")).toBe(
      t("product.edit_named_inherited").replace("{name}", "Cola").replace("{from}", "Drinks"),
    );
    expect(media!.querySelector("wt-row-actions, button")).toBeNull();
    expect(root.querySelector("wt-row-actions[data-test='color-cola']")).toBeNull();
    const frame = media!.querySelector<HTMLElement>('[data-test="thumb"]')!;
    expect(getComputedStyle(frame).borderTopColor).toBe("rgb(37, 107, 177)");
    expect(parseFloat(getComputedStyle(frame).borderTopWidth)).toBeGreaterThan(1);
    const name = media!.parentElement!.querySelector("strong")!;
    expect(media!.getBoundingClientRect().right).toBeLessThanOrEqual(
      name.getBoundingClientRect().left,
    );
    const expandedBefore = root
      .querySelector('tr[data-row-key="folder:d"]')!
      .getAttribute("aria-expanded");
    const sent: unknown[] = [];
    for (const type of ["edit-product", "product-colour"])
      el.addEventListener(type, (e) => sent.push([type, (e as CustomEvent).detail]));
    const prevented: boolean[] = [];
    media!.addEventListener("click", (e) => {
      prevented.push(e.defaultPrevented);
      e.preventDefault();
    });
    const reachedRow: Event[] = [];
    media!.closest("tr")!.addEventListener("click", (e) => reachedRow.push(e));
    await userEvent.click(media!);
    expect(prevented).toEqual([true]);
    expect(reachedRow).toEqual([]);
    expect(sent).toEqual([["edit-product", { productId: "cola", field: "image" }]]);
    media!.focus();
    expect(root.activeElement).toBe(media);
    await userEvent.keyboard("{Enter}");
    expect(sent).toEqual([
      ["edit-product", { productId: "cola", field: "image" }],
      ["edit-product", { productId: "cola", field: "image" }],
    ]);
    expect(root.querySelector('tr[data-row-key="folder:d"]')!.getAttribute("aria-expanded")).toBe(
      expandedBefore,
    );
    expect(root.querySelector("[popover]:popover-open")).toBeNull();
  });
  it("fills an uncategorised product with no colour of its own with the venue default, and a coloured category's product with the category's", async () => {
    const { el, root } = await mountTree({
      products: [
        product({ id: "plain", name: "Plain", primaryCategoryId: null }),
        product({ id: "cola", name: "Cola", primaryCategoryId: "d" }),
      ],
      categories: [{ ...drinks, color: "#256bb1" }],
      defaultColor: "#777777",
    });
    await openRow(el, "folder:d");
    const fill = (id: string) =>
      getComputedStyle(
        root.querySelector<HTMLElement>(
          `[data-test="color-${id}"] [data-test="thumb-placeholder"]`,
        )!,
      ).backgroundColor;
    expect(fill("plain")).toBe("rgb(119, 119, 119)");
    expect(fill("cola")).toBe("rgb(37, 107, 177)");
  });
  it("fills a product without a photo with its own colour and hides the swatch at phone width", async () => {
    const { el, root } = await mountTree({
      products: [product({ id: "plain", name: "Plain", color: "#b12525" })],
    });
    const media = root.querySelector<HTMLElement>('[data-test="color-plain"]');
    expect(media).not.toBeNull();
    const frame = media!.querySelector<HTMLElement>('[data-test="thumb-placeholder"]')!;
    expect(getComputedStyle(frame).backgroundColor).toBe("rgb(177, 37, 37)");
    await page.viewport(390, 844);
    await expect.poll(() => media!.getBoundingClientRect().width).toBe(0);
    expect((await tableRoot(el)).querySelector('[data-test="edit-plain"]')).not.toBeNull();
  });
});

describe("a colour a row inherits", () => {
  const partsOf = (element: Element) => element.getAttribute("part")!.split(" ");
  const chipOf = (root: ShadowRoot, id: string) =>
    root.querySelector<HTMLElement>(`[data-test="color-${id}"] [part~="color-swatch"]`)!;
  const swatchButton = (root: ShadowRoot, id: string) =>
    root.querySelector<HTMLButtonElement>(`[data-test="color-${id}"]`)!;
  const categoryInheritedName = (name: string, from: string) =>
    t("folders.edit_color_inherited")
      .replace("{name}", () => name)
      .replace("{from}", () => from);
  const productInheritedName = (name: string, from: string) =>
    t("product.edit_named_inherited")
      .replace("{name}", () => name)
      .replace("{from}", () => from);
  /** The muted text colour as the swatch's own tree resolves it, to compare an outline against. */
  function mutedText(beside: HTMLElement): string {
    const probe = document.createElement("span");
    probe.style.color = "var(--wt-color-text-muted)";
    beside.after(probe);
    onTestFinished(() => probe.remove());
    return getComputedStyle(probe).color;
  }
  function expectMarkedInherited(element: HTMLElement, fill: string) {
    expect(partsOf(element)).toContain("inherited");
    expect(partsOf(element)).not.toContain("empty");
    const style = getComputedStyle(element);
    expect(style.backgroundColor).toBe(fill);
    expect(style.borderTopStyle).toBe("dashed");
    expect(style.borderTopWidth).toBe("1px");
    expect(style.borderTopColor).toBe(mutedText(element));
    expect(style.backgroundClip).toBe("content-box");
    expect(parseFloat(style.paddingTop)).toBeGreaterThan(0);
  }
  function expectOwn(element: HTMLElement, fill: string) {
    expect(partsOf(element)).not.toContain("inherited");
    const style = getComputedStyle(element);
    expect(style.backgroundColor).toBe(fill);
    expect(style.borderTopStyle).toBe("solid");
    expect(style.backgroundClip).toBe("border-box");
  }

  it("shows an uncoloured category its parent's colour, marked inherited and named after the parent", async () => {
    const { el, root } = await mountTree({
      categories: [{ ...drinks, color: "#b12525" }, beer, food],
    });
    await openRow(el, "folder:d");
    expectMarkedInherited(chipOf(root, "b"), "rgb(177, 37, 37)");
    // Rounded as an inheriting product's square is, so its inset fill keeps rounded corners too.
    const chipStyle = getComputedStyle(chipOf(root, "b"));
    expect(chipStyle.borderTopLeftRadius).toBe(chipStyle.getPropertyValue("--wt-radius-md").trim());
    expect(swatchButton(root, "b").getAttribute("aria-label")).toBe(
      categoryInheritedName("Beer", "Drinks"),
    );
    expectOwn(chipOf(root, "d"), "rgb(177, 37, 37)");
    expect(chipOf(root, "d").getAttribute("part")).toBe("color-swatch");
    expect(swatchButton(root, "d").getAttribute("aria-label")).toBe(
      t("folders.edit_color").replace("{name}", "Drinks"),
    );
  });

  it("keeps an uncoloured top-level category empty and plainly named when there is no venue default", async () => {
    const { root } = await mountTree();
    expect(chipOf(root, "f").getAttribute("part")).toBe("color-swatch empty");
    expect(getComputedStyle(chipOf(root, "f")).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(swatchButton(root, "f").getAttribute("aria-label")).toBe(
      t("folders.edit_color").replace("{name}", "Food"),
    );
  });

  it("shows an uncoloured top-level category the venue default, marked inherited from All products", async () => {
    const { root } = await mountTree({ defaultColor: "#777777" });
    expectMarkedInherited(chipOf(root, "f"), "rgb(119, 119, 119)");
    expect(swatchButton(root, "f").getAttribute("aria-label")).toBe(
      categoryInheritedName("Food", t("folders.all_products")),
    );
    expect(chipOf(root, "root").getAttribute("part")).toBe("color-swatch");
  });

  it("keeps a category name with a replacement pattern literal in the inherited name", async () => {
    const { el, root } = await mountTree({
      categories: [{ ...drinks, name: "$& Co", color: "#b12525" }, beer, food],
    });
    await openRow(el, "folder:d");
    expect(swatchButton(root, "b").getAttribute("aria-label")).toBe(
      t("folders.edit_color_inherited").replace("{name}", "Beer").split("{from}").join("$& Co"),
    );
  });

  it("keeps an inheriting category's name literal when it holds the source's placeholder", async () => {
    setLocale("en");
    const { el, root } = await mountTree({
      categories: [{ ...drinks, color: "#b12525" }, { ...beer, name: "Beer {from}" }, food],
    });
    await openRow(el, "folder:d");
    expect(swatchButton(root, "b").getAttribute("aria-label")).toBe(
      "Change the colour of Beer {from}, inherited from Drinks",
    );
  });

  it("keeps an inheriting product's and variant's names literal when they hold the source's placeholder", async () => {
    setLocale("en");
    const { el, root } = await mountTree({
      categories: [{ ...drinks, color: "#256bb1" }, beer, food],
      products: [
        product({
          id: "cola",
          name: "Cola {from}",
          primaryCategoryId: "d",
          variants: [{ ...bunVariant, name: "Small {from}" }],
        }),
      ],
    });
    await openRow(el, "folder:d");
    root.querySelector<HTMLElement>('tr[data-row-key="cola"] .tree-toggle')!.click();
    await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
    const link = (id: string) => root.querySelector<HTMLElement>(`[data-test="color-${id}"]`)!;
    expect(link("cola").getAttribute("aria-label")).toBe(
      "Edit Cola {from}, colour inherited from Drinks",
    );
    expect(link("small").getAttribute("aria-label")).toBe(
      "Edit Small {from}, colour inherited from Drinks",
    );
  });

  it("keeps a category name with a replacement pattern literal when the colour is its own", async () => {
    setLocale("en");
    const { root } = await mountTree({
      categories: [{ ...drinks, name: "$& Co", color: "#b12525" }, beer, food],
    });
    expect(swatchButton(root, "d").getAttribute("aria-label")).toBe("Change the colour of $& Co");
  });

  it("keeps a product name with a replacement pattern literal when the colour is its own", async () => {
    setLocale("en");
    const { root } = await mountTree({
      categories: [],
      products: [product({ id: "own", name: "$& Co", primaryCategoryId: null, color: "#b12525" })],
    });
    expect(
      root.querySelector<HTMLElement>('[data-test="color-own"]')!.getAttribute("aria-label"),
    ).toBe("Edit $& Co");
  });

  it("marks a product without a colour of its own as inheriting, and names where its colour comes from", async () => {
    const { el, root } = await mountTree({
      defaultColor: "#777777",
      categories: [{ ...drinks, color: "#256bb1" }, beer, food],
      products: [
        product({ id: "cola", name: "Cola", primaryCategoryId: "b", image: null }),
        product({ id: "plain", name: "Plain", primaryCategoryId: null, image: null }),
        product({ id: "own", name: "Own", primaryCategoryId: "b", image: null, color: "#b12525" }),
      ],
    });
    await openRow(el, "folder:d");
    await openRow(el, "folder:b");
    const frame = (id: string) =>
      root.querySelector<HTMLElement>(`[data-test="color-${id}"] [data-test="thumb-placeholder"]`)!;
    const link = (id: string) => root.querySelector<HTMLElement>(`[data-test="color-${id}"]`)!;
    expectMarkedInherited(frame("cola"), "rgb(37, 107, 177)");
    expect(link("cola").getAttribute("aria-label")).toBe(productInheritedName("Cola", "Drinks"));
    expectMarkedInherited(frame("plain"), "rgb(119, 119, 119)");
    expect(link("plain").getAttribute("aria-label")).toBe(
      productInheritedName("Plain", t("folders.all_products")),
    );
    expectOwn(frame("own"), "rgb(177, 37, 37)");
    expect(link("own").getAttribute("aria-label")).toBe(
      t("product.edit_named").replace("{name}", "Own"),
    );
  });

  it("dashes the coloured ring around an inheriting product's photo, keeping its colour and width", async () => {
    const { el, root } = await mountTree({
      categories: [{ ...drinks, color: "#256bb1" }, beer, food],
      products: [
        product({ id: "cola", name: "Cola", primaryCategoryId: "d", image: "cola.webp" }),
        product({
          id: "own",
          name: "Own",
          primaryCategoryId: "d",
          image: "own.webp",
          color: "#b12525",
        }),
      ],
    });
    await openRow(el, "folder:d");
    const ring = (id: string) =>
      root.querySelector<HTMLElement>(`[data-test="color-${id}"] [data-test="thumb"]`)!;
    expect(partsOf(ring("cola"))).toContain("inherited");
    const inherited = getComputedStyle(ring("cola"));
    expect(inherited.borderTopStyle).toBe("dashed");
    expect(inherited.borderTopColor).toBe("rgb(37, 107, 177)");
    expect(inherited.borderTopWidth).toBe(getComputedStyle(ring("own")).borderTopWidth);
    expect(parseFloat(inherited.paddingTop)).toBe(0);
    expect(partsOf(ring("own"))).not.toContain("inherited");
    expect(getComputedStyle(ring("own")).borderTopStyle).toBe("solid");
  });

  it("leaves a product with nothing to inherit unmarked and plainly named", async () => {
    const { root } = await mountTree({
      categories: [],
      products: [product({ id: "plain", name: "Plain", primaryCategoryId: null, image: null })],
    });
    const link = root.querySelector<HTMLElement>('[data-test="color-plain"]')!;
    expect(partsOf(link.querySelector('[data-test="thumb-placeholder"]')!)).toContain("empty");
    expect(partsOf(link.querySelector('[data-test="thumb-placeholder"]')!)).not.toContain(
      "inherited",
    );
    expect(link.getAttribute("aria-label")).toBe(
      t("product.edit_named").replace("{name}", "Plain"),
    );
  });

  it("marks a variant as its product is marked", async () => {
    const { el, table, root } = await mountTree({
      categories: [{ ...drinks, color: "#256bb1" }, beer, food],
      products: [
        product({
          id: "wine",
          name: "Wine",
          primaryCategoryId: "d",
          image: null,
          variants: [{ ...bunVariant, id: "glass", name: "Glass" }],
        }),
        product({
          id: "cava",
          name: "Cava",
          primaryCategoryId: "d",
          image: null,
          color: "#b12525",
          variants: [{ ...bunVariant, id: "flute", name: "Flute" }],
        }),
      ],
    });
    await openRow(el, "folder:d");
    for (const key of ["wine", "cava"]) {
      root.querySelector<HTMLElement>(`tr[data-row-key="${key}"] .tree-toggle`)!.click();
      await table.updateComplete;
    }
    const frame = (id: string) =>
      root.querySelector<HTMLElement>(`[data-test="color-${id}"] [data-test="thumb-placeholder"]`)!;
    expectMarkedInherited(frame("glass"), "rgb(37, 107, 177)");
    expect(root.querySelector('[data-test="color-glass"]')!.getAttribute("aria-label")).toBe(
      productInheritedName("Glass", "Drinks"),
    );
    expectOwn(frame("flute"), "rgb(177, 37, 37)");
    expect(root.querySelector('[data-test="color-flute"]')!.getAttribute("aria-label")).toBe(
      t("product.edit_named").replace("{name}", "Flute"),
    );
  });
});

describe("variant media slot", () => {
  const pollo = () =>
    product({
      id: "pollo",
      name: "Pollo asado",
      primaryCategoryId: "f",
      image: "pollo.webp",
      color: "#256bb1",
      variants: [
        { ...bunVariant, id: "half", name: "1/2", image: "half.webp" },
        {
          ...bunVariant,
          id: "quarter",
          name: "1/4 Pollo",
          customerName: { es: "Cuarto de pollo" },
          kitchenName: "1/4 POLLO",
          image: null,
        },
      ],
    });
  const tortilla = () =>
    product({
      id: "tortilla",
      name: "Tortilla",
      primaryCategoryId: "f",
      color: "#b12525",
      variants: [{ ...bunVariant, id: "pincho", name: "Pincho", image: null }],
    });

  async function mountOpen() {
    const { el, table, root } = await mountTree({
      categories: [food],
      products: [pollo(), tortilla()],
    });
    await openRow(el, "folder:f");
    for (const key of ["pollo", "tortilla"]) {
      root.querySelector<HTMLElement>(`tr[data-row-key="${key}"] .tree-toggle`)!.click();
      await table.updateComplete;
    }
    return { el, table, root };
  }

  it("shows a variant's own photo, else its product's, else its product's colour", async () => {
    const { root } = await mountOpen();
    const photo = (id: string) =>
      root.querySelector(`[data-test="color-${id}"] img[part="thumbnail"]`)?.getAttribute("src");
    expect(photo("half")).toBe("/media/half.webp");
    expect(photo("quarter")).toBe("/media/pollo.webp");
    const placeholder = root.querySelector<HTMLElement>(
      '[data-test="color-pincho"] [data-test="thumb-placeholder"]',
    );
    expect(placeholder).not.toBeNull();
    expect(root.querySelector('[data-test="color-pincho"] img')).toBeNull();
    expect(getComputedStyle(placeholder!).backgroundColor).toBe("rgb(177, 37, 37)");
    const ring = root.querySelector<HTMLElement>(
      '[data-test="color-quarter"] [data-test="thumb"]',
    )!;
    expect(getComputedStyle(ring).borderTopColor).toBe("rgb(37, 107, 177)");
  });

  it("opens the variant's own Edit at its photo from its swatch, without reaching the row", async () => {
    const { el, root } = await mountOpen();
    const media = root.querySelector<HTMLAnchorElement>('[data-test="color-quarter"]')!;
    expect(media).not.toBeNull();
    expect(media.tagName).toBe("A");
    expect(media.getAttribute("href")).toBe("/manage/catalogue/product/quarter?field=image");
    expect(media.getAttribute("aria-label")).toBe(
      t("product.edit_named").replace("{name}", "1/4 Pollo"),
    );
    const sent: unknown[] = [];
    for (const type of ["edit-product", "product-colour"])
      el.addEventListener(type, (e) => sent.push([type, (e as CustomEvent).detail]));
    const reachedRow: Event[] = [];
    media.closest("tr")!.addEventListener("click", (e) => reachedRow.push(e));
    await userEvent.click(media);
    expect(reachedRow).toEqual([]);
    expect(sent).toEqual([["edit-product", { productId: "quarter", field: "image" }]]);
    media.focus();
    expect(root.activeElement).toBe(media);
    await userEvent.keyboard("{Enter}");
    expect(sent).toEqual([
      ["edit-product", { productId: "quarter", field: "image" }],
      ["edit-product", { productId: "quarter", field: "image" }],
    ]);
    expect(root.querySelector("[popover]:popover-open")).toBeNull();
  });

  it("puts a variant's swatch in its product's column, and hides it at phone width", async () => {
    const { root } = await mountOpen();
    const box = (id: string) =>
      root.querySelector<HTMLElement>(`[data-test="color-${id}"]`)!.getBoundingClientRect();
    for (const id of ["half", "quarter"]) {
      expect(Math.abs(box(id).left - box("pollo").left), id).toBeLessThanOrEqual(0.5);
      expect(box(id).width, id).toBe(box("pollo").width);
    }
    expect(box("pollo").width).toBeGreaterThan(0);
    await page.viewport(390, 844);
    await expect.poll(() => box("pollo").width).toBe(0);
    expect(box("half").width).toBe(0);
  });
});

describe("stable column inputs", () => {
  it("keeps columns and filter width texts on an unrelated redraw, then translates them", async () => {
    setLocale("en");
    const { el, table, root } = await mountTree();
    const columns = table.columns;
    root.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
    await table.updateComplete;
    const filters = [...root.querySelectorAll<WtCombobox>("wt-combobox")];
    expect(filters.length).toBe(2);
    await Promise.all(filters.map((filter) => filter.updateComplete));
    const widths = filters.map((filter) =>
      vi.spyOn(filter as unknown as { widthTexts(): string[] }, "widthTexts"),
    );
    el.reordering = !el.reordering;
    await el.updateComplete;
    await table.updateComplete;
    await Promise.all(filters.map((filter) => filter.updateComplete));
    expect(widths.map((spy) => spy.mock.calls.length)).toEqual([0, 0]);
    expect(table.columns).toBe(columns);
    setLocale("es");
    el.requestUpdate();
    await el.updateComplete;
    await table.updateComplete;
    expect(table.columns[0]!.label).toBe("Nombre");
    expect(table.columns.find((column) => column.key === "active")!.filter!.options[0]!.label).toBe(
      "Activo",
    );
  });

  it("keeps a no-match search through desktop and phone resizing without an uncaught error", async () => {
    const errors: string[] = [];
    const capture = (event: ErrorEvent) => {
      errors.push(event.message);
      event.preventDefault();
    };
    window.addEventListener("error", capture);
    try {
      const { el, table, root } = await mountTree();
      el.search = "Ca";
      await el.updateComplete;
      await table.updateComplete;
      for (const width of [390, 1280, 390]) {
        await page.viewport(width, 844);
        el.style.width = `${width}px`;
        expect(innerWidth).toBe(width);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        expect(root.querySelector(".empty .message")!.textContent).toBe(table.noMatchesMessage);
        expect(el.search).toBe("Ca");
        expect(root.querySelector("tbody")).toBeNull();
      }
      expect(errors).toEqual([]);
    } finally {
      window.removeEventListener("error", capture);
      await page.viewport(1280, 844);
    }
  });
});

it("keeps columns while live folder warnings and add permission update", async () => {
  const { el, table, root } = await mountTree({ canAddProduct: true });
  const columns = table.columns;
  expect(root.querySelector('[data-test="unrouted-folder"]')).toBeNull();
  const add = root.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `[data-test="add-product-${ROOT_KEY}"]`,
  )!;
  expect(add.disabled).toBe(false);
  el.unroutedFolderIds = ["d"];
  el.canAddProduct = false;
  await el.updateComplete;
  await table.updateComplete;
  expect(
    root.querySelector('tr[data-row-key="folder:d"] [data-test="unrouted-folder"]'),
  ).not.toBeNull();
  expect(add.disabled).toBe(true);
  expect(table.columns).toBe(columns);
});

async function edgeProduct(up = false, fits = false) {
  const categories = Array.from({ length: fits ? 1 : 35 }, (_, i) => ({
    id: `edge-${i}`,
    name: `Category ${String(i).padStart(2, "0")}`,
    parentId: null,
    color: null,
  }));
  const sourceFolder = up ? "edge-30" : "edge-0";
  const { el, root } = await mountTree({
    categories,
    products: [product({ id: "edge-source", name: "Source", primaryCategoryId: sourceFolder })],
    reordering: true,
  });
  await openRow(el, `folder:${sourceFolder}`);
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;top:100px;left:40px;width:800px;height:350px;overflow:auto";
  el.parentElement!.append(box);
  box.append(el);
  const from = root.querySelector<HTMLElement>('tr[data-row-key="edge-source"] .drag-grip')!;
  if (up) box.scrollTop = from.getBoundingClientRect().top - box.getBoundingClientRect().top - 100;
  const start = from.getBoundingClientRect();
  const bounds = box.getBoundingClientRect();
  const y = up ? bounds.top + 8 : bounds.bottom - 8;
  const send = (type: string, at = y) =>
    from.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerType: "touch",
        pointerId: 89,
        clientX: start.left + 8,
        clientY: at,
      }),
    );
  const drops: { keys: string[]; folderId: string }[] = [];
  el.addEventListener("drop-items", (event) => drops.push((event as CustomEvent).detail));
  const initial = box.scrollTop;
  send("pointerdown", start.top + 8);
  send("pointermove");
  return { el, root, box, bounds, send, drops, initial };
}

it.each([false, true])(
  "edge scroll re-reads the category below a stationary product drag (up: %s)",
  async (up) => {
    const { root, box, send, drops, initial } = await edgeProduct(up);
    try {
      for (let frame = 0; frame < 40; frame++) await new Promise(requestAnimationFrame);
      expect(up ? initial - box.scrollTop : box.scrollTop).toBeGreaterThan(350);
      await expect
        .poll(
          () =>
            Number(
              root.querySelector('[part~="drop-target"]')?.closest("tr")?.dataset.rowKey?.slice(12),
            ),
          { timeout: 2000 },
        )
        [up ? "toBeLessThan" : "toBeGreaterThan"](up ? 27 : 3);
      const target = root.querySelector('[part~="drop-target"]')?.closest("tr")?.dataset.rowKey;
      send("pointerup");
      expect(drops).toEqual([{ keys: ["edge-source"], folderId: target!.slice(7) }]);
    } finally {
      send("pointercancel");
      document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 89 }));
      await new Promise(requestAnimationFrame);
    }
  },
  10_000,
);

it.each(["leave", "cancel", "Escape", "disconnect", "fits"])(
  "edge scroll product drag stops on %s",
  async (end) => {
    const { el, box, bounds, send, drops } = await edgeProduct(false, end === "fits");
    try {
      if (end === "fits") expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight);
      else await expect.poll(() => box.scrollTop, { timeout: 1500 }).toBeGreaterThan(100);
      if (end === "leave") send("pointermove", bounds.top + bounds.height / 2);
      else if (end === "cancel") send("pointercancel");
      else if (end === "Escape")
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else if (end === "disconnect") el.remove();
      await el.updateComplete;
      for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
      const ended = box.scrollTop;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      expect(box.scrollTop).toBe(ended);
      expect(drops).toEqual([]);
    } finally {
      send("pointercancel");
      document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 89 }));
      await new Promise(requestAnimationFrame);
    }
  },
);
