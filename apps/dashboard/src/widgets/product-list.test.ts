import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { WtCombobox } from "@waitron/ui";
import { chooseOption, expectRowMenusOnScreen } from "@waitron/ui/src/test-helpers.js";
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
beforeEach(() => {
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

  it("uses a named kebab menu containing Edit and Disable", async () => {
    const products = [product({ id: "p7", name: "Tarta de queso" })];
    const { el } = await mountWidget<ProductList>("dashboard-product-list", { products });
    const actions = (await tableRoot(el)).querySelector<HTMLElement>('[data-test="actions-p7"]')!;
    expect(actions.tagName).toBe("WT-ROW-ACTIONS");
    expect(actions.getAttribute("label")).toContain("Tarta de queso");
    expect(actions.querySelector('[data-test="edit-p7"]')?.textContent).toContain(t("action.edit"));
    expect(actions.querySelector('[data-test="delete-p7"]')?.textContent).toContain(
      t("product.disable"),
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
      t("product.disabled_badge"),
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
              name: "Wine 175",
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
    expect(cell(t("product.name")).textContent!.trim()).toBe("Wine 175");
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

  it.each([
    [
      "en-GB",
      {
        disable: "Disable",
        enable: "Enable",
        products: ["Active", "Disabled"],
        variants: ["Active", "Disabled"],
        filter: ["Any status", "Active", "Disabled"],
      },
    ],
    [
      "es-ES",
      {
        disable: "Deshabilitar",
        enable: "Habilitar",
        products: ["Activo", "Deshabilitado"],
        variants: ["Activa", "Deshabilitada"],
        filter: ["Cualquier estado", "Activo", "Deshabilitado"],
      },
    ],
  ])(
    "in %s, offers Disable and Enable and shows Active or Disabled, agreeing with the noun",
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
      expect(label("restore-large")).toBe(words.enable);
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

  it("gives a variant row its own Edit and Disable, and Enable once it is disabled", async () => {
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
      t("product.disable"),
    );
    expect(actions.querySelector('[data-test="restore-small"]')).toBeNull();
    const large = root.querySelector<HTMLElement>('[data-test="actions-large"]')!;
    expect(large.querySelector('[data-test="delete-large"]')).toBeNull();
    expect(large.querySelector('[data-test="restore-large"]')!.textContent).toContain(
      t("product.enable"),
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
        product({
          id: "plate",
          unitPrice: "19.00",
          unitId: EACH_UNIT_ID,
          unit: { ...product().unit, id: EACH_UNIT_ID },
        }),
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

  it("names a measured unit after its price before the venue's unit list has loaded", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "ham", unitId: "kg", unit: kilo, unitPrice: "48.00" })],
      units: [],
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
        expectRowMenusOnScreen(el.shadowRoot!.querySelector("wt-data-table")!, 3);
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

  /** The open name box against its row's grip (or grip space) and folder icon. */
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
      grip: row.querySelector('.drag-grip, [part~="grip-space"]')!.getBoundingClientRect(),
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
      ["f", "d", "b"].map((categoryId) => ({ locale, categoryId })),
    ),
  )(
    "puts a renamed category's name box and its refusal on their own line under the grip at 390 px ($locale, $categoryId)",
    ({ locale, categoryId }) =>
      onPhone(locale, 390, async () => {
        // An asterisk and Drinks' two-part count leave the least room beside the grip and icon.
        const { el, root } = await mountNarrowTree({ unroutedFolderIds: ["f", "d", "b"] });
        await openWithRefusal(el, { kind: "rename", categoryId });
        const line = await nameBoxLine(root);
        expectOwnLine(line);
        const row = root.querySelector(`tr[data-row-key="folder:${categoryId}"]`)!;
        for (const after of row.querySelectorAll('[part~="count"], [part~="unrouted-folder"]')) {
          const rect = after.getBoundingClientRect();
          expect(rect.right).toBeLessThanOrEqual(line.edges.pinned);
          expect(rect.bottom).toBeLessThanOrEqual(line.box.top);
        }
      }),
  );

  it.each(
    ["en-GB", "es-ES"].flatMap((locale) =>
      [null, "d", "b"].map((parentId) => ({ locale, parentId })),
    ),
  )(
    "puts a new category's name box and its refusal on their own line under the grip space at 390 px ($locale, $parentId)",
    ({ locale, parentId }) =>
      onPhone(locale, 390, async () => {
        const { el, root } = await mountNarrowTree();
        await openWithRefusal(el, { kind: "create", parentId });
        expectOwnLine(await nameBoxLine(root));
      }),
  );

  it.each(["en-GB", "es-ES"])(
    "moves an open name box onto its own line when the screen narrows from 1280 to 390 px (%s)",
    (locale) =>
      onPhone(locale, 1280, async () => {
        const { el, table, root } = await mountTree({ unroutedFolderIds: ["f", "d", "b"] });
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
      ].map((draft) => ({ locale, draft })),
    ),
  )(
    "keeps the name box beside the grip and folder icon at 1280 px ($locale, $draft.kind)",
    ({ locale, draft }) =>
      onPhone(locale, 1280, async () => {
        const { el, root } = await mountTree();
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
      ].map((element) => {
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
    "keeps a long category's swatch, after its wrapped name, before the pinned actions at 390 px (%s)",
    (locale) =>
      onPhone(locale, 390, async () => {
        const { root } = await mountLong();
        const row = root.querySelector('tr[data-row-key="folder:long"]')!;
        const swatch = row
          .querySelector<HTMLElement>('[data-test="color-long"]')!
          .getBoundingClientRect();
        const start = root.querySelector(".scroll")!.getBoundingClientRect().left;
        const pinned = row.querySelector('td[data-pinned="end"]')!.getBoundingClientRect().left;
        expect(root.querySelector<HTMLElement>(".scroll")!.scrollLeft).toBe(0);
        expect(swatch.left).toBeGreaterThanOrEqual(start);
        expect(swatch.right).toBeLessThanOrEqual(pinned);
        const name = (await nameTexts(root)).find(
          ({ key, text }) => key === "folder:long" && text === longCategory.name,
        )!;
        expect(name.lines).toBeGreaterThan(1);
        expect(name.right).toBeLessThanOrEqual(pinned);
        expect(swatch.top).toBeGreaterThanOrEqual(name.top);
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
        expectRowMenusOnScreen(table, 5);
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

  it("draws large folder icons on root, nested and new category rows and on a category drag", async () => {
    const { el, root } = await mountTree();
    await openRow(el, "folder:d");
    el.nameDraft = { kind: "create", parentId: "d" };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    for (const key of [ROOT_KEY, "folder:d", "folder:b", "draft:new"]) {
      const icon = root.querySelector<HTMLElement>(
        `tr[data-row-key="${key}"] wt-icon[name="folder"]`,
      )!;
      expect(icon.shadowRoot!.querySelector("svg")).not.toBeNull();
      expect(icon.getBoundingClientRect().width).toBe(18);
      expect(icon.getBoundingClientRect().height).toBe(18);
    }

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
    // Drawn after the name and its count, so names at one depth still line up.
    const row = root.querySelector('tr[data-row-key="folder:d"]')!;
    expect(button("d").getBoundingClientRect().left).toBeGreaterThanOrEqual(
      row.querySelector('[data-test="count-d"]')!.getBoundingClientRect().right,
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
    "puts a colour square showing the box's colour inside the name box, for a new category and a rename (%s)",
    async (locale, label) => {
      const before = currentLocale();
      onTestFinished(() => setLocale(before));
      setLocale(locale);
      const { el, root } = await mountTree({
        categories: [{ ...drinks, color: "#b12525" }, beer, food],
      });
      const square = () => {
        const box = root.querySelector('wt-input[name="category-name"]')!;
        const button = box.querySelector<HTMLButtonElement>(
          ':scope > [slot="end"][data-test="name-box-color"]',
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
      const row = root.querySelector('tr[data-row-key="folder:d"]')!;
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
    const square = box.querySelector<HTMLElement>('[data-test="name-box-color"]')!;
    el.addEventListener("name-color", () => (el.choosingColor = true));
    await userEvent.click(square);
    // The colour chooser takes the cursor while it is open, and hands it back to the square.
    outside.focus();
    square.focus();
    expect(sent).toEqual([["name-color", {}]]);
    expect(root.querySelector('wt-input[name="category-name"]')).toBe(box);
    el.choosingColor = false;
    await el.returnToNameBox();
    expect(focusedName(el)).toBe("category-name");
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

  it("leaves the name box, and saves it, once focus has come back from its colour square", async () => {
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
    await el.returnToNameBox();
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
    ["Disable", "delete-small", "delete-product", "small"],
    ["Enable", "restore-large", "restore-product", "large"],
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
      for (const name of ["edit-product", "delete-product", "restore-product"])
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
    ["Edit", "edit-bread", "edit-product"],
    ["Disable", "delete-bread", "delete-product"],
  ])(
    "closes a top-level product's menu when %s is chosen from it, and sends only that request",
    async (_label, button, request) => {
      const { el, root } = await mountTree();
      const seen: [string, string][] = [];
      for (const name of ["edit-product", "delete-product", "restore-product"])
        el.addEventListener(name, (event) =>
          seen.push([name, (event as CustomEvent<{ productId: string }>).detail.productId]),
        );
      const menu = root.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
        '[data-test="actions-bread"]',
      )!;
      menu.show();
      const popup = menu.shadowRoot!.querySelector("[popover]")!;
      expect(popup.matches(":popover-open")).toBe(true);
      await userEvent.click(root.querySelector<HTMLElement>(`[data-test="${button}"]`)!);
      expect(seen).toEqual([[request, "bread"]]);
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

  it("draws a small, muted arrow on a product with variants, against its grip", async () => {
    const { root } = await mountDeli();
    const arrow = root.querySelector<HTMLElement>('tr[data-row-key="cecina"] .tree-toggle')!;
    const name = nameCell(root, "cecina").querySelector("strong")!;
    const style = getComputedStyle(arrow);
    expect(parseFloat(style.fontSize)).toBeLessThan(parseFloat(getComputedStyle(name).fontSize));
    expect(style.color).toBe(
      getComputedStyle(nameCell(root, "cecina").querySelector('[data-test="variant-count"]')!)
        .color,
    );
    const grip = nameCell(root, "cecina").querySelector<HTMLElement>(".drag-grip")!;
    const glyph = document.createRange();
    glyph.selectNodeContents(arrow);
    // The arrow is drawn at the end of its box, against the grip, not in the middle of it.
    expect(grip.getBoundingClientRect().left - glyph.getBoundingClientRect().right).toBeLessThan(
      grip.getBoundingClientRect().width / 2,
    );
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
          // The text itself, not the box, which starts at its padding.
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
    const { table, root } = await mountDeli();
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

  async function mountDeep(props: Partial<ProductList> = {}) {
    setLocale("en");
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      categories: [drinks, food, meat, deep],
      products: [
        product({ id: "cola", name: "Cola", primaryCategoryId: "d" }),
        product({ id: "salad", name: "Salad", primaryCategoryId: "f", image: "salad.png" }),
        product({ id: "chop", name: "Chop", primaryCategoryId: "m" }),
        solomillo(),
        product({ id: "ribs", name: "Ribs", primaryCategoryId: "g" }),
        product({ id: "bread", name: "Bread", primaryCategoryId: null }),
      ],
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
      grip: box(cell.querySelector('.drag-grip, [part="grip-space"]')),
      media: box(
        cell.querySelector(
          '[part="folder-frame"], [part="thumb-frame"], [part="thumb-placeholder"]',
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
      // The grip and the folder icon or photo sit in the same slots on every row of one level.
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

  it("lines each row's grip, icon or photo and name up on one middle", async () => {
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
    const headings = [...root.querySelectorAll("thead th")].map((th) =>
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

  it("names the station a claim on the category sends it to, set on that category, linked to the routing screen", async () => {
    const { root } = await mountMadeAt([
      ["d", { maker: bar, source: { kind: "own" }, someElsewhere: false }],
    ]);
    const link = madeAtCell(root, "folder:d").querySelector("a")!;
    expect(link.textContent!.trim()).toBe("Bar");
    expect(link.getAttribute("href")).toBe("/manage/prep-stations");
    expect(detailOf(root, "folder:d")).toBe("set on this category");
  });

  it("names the category an inherited claim comes from", async () => {
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

  it("marks a route an exception decides", async () => {
    const { root } = await mountMadeAt([
      ["f", { maker: bar, source: { kind: "exception" }, someElsewhere: false }],
    ]);
    expect(detailOf(root, "folder:f")).toBe("by an exception");
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
