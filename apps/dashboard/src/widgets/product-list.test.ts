import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { allergenStateName, vatClassName } from "../i18n/domain.js";
import type { Product } from "../api/client.js";
import type { ListedVariant } from "@waitron/catalogue/src/product-types.js";
import { ProductList } from "./product-list.js";
import { t } from "../i18n/t.js";

afterEach(cleanupWidgets);
// The table remembers its sort and filter choices in sessionStorage under waitron.products.table, so
// a choice one test makes would otherwise be restored into the next one.
beforeEach(() => sessionStorage.clear());

async function tableRoot(el: ProductList): Promise<ShadowRoot> {
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  return table.shadowRoot!;
}

/** Every rendered row's key, in render order: a product's key is its id, a variant's `<product>:<variant>`. */
function rowKeys(root: ShadowRoot): string[] {
  return [...root.querySelectorAll("tr[data-row-key]")].map((row) =>
    row.getAttribute("data-row-key")!,
  );
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

/** Chooses `value` in the column's filter and waits for the narrowed render. */
async function choose(el: ProductList, column: string, value: string): Promise<void> {
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  const select = table.shadowRoot!.querySelector<HTMLSelectElement>(
    `select[data-filter="${column}"]`,
  )!;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await table.updateComplete;
}

/** A bun variant used by the filter tests. Of its own fields only `active` is read by a filter (the
 * Status one); the sold-on-its-own filter reads its product's answer. */
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

/**
 * A representative product carrying every field the list reads; individual tests override the one
 * field they exercise (allergens, image, active, name) via a spread so the fixture stays the
 * single source for the rest. The staff name and the customer-facing name deliberately DIFFER, so a
 * test cannot pass by reading whichever one it happened to find.
 *
 * A variant given without `effective` reads its product's values there, which is what the server
 * sends for a variant that sets none of its own.
 */
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
    categoryIds: ["category-1"],
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
    soldAlone: true,
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
        categoryIds: base.categoryIds,
      },
    })),
  };
}

describe("product-list", () => {
  it("renders one shared-table row per product", async () => {
    const products = [product({ id: "a" }), product({ id: "b" }), product({ id: "c" })];
    const { el } = await mountWidget<ProductList>("dashboard-product-list", { products });
    const rows = (await tableRoot(el)).querySelectorAll("tbody tr");
    expect(rows.length).toBe(3);
  });

  // The list is a dashboard surface, so it shows the STAFF name — never the guest-facing
  // translation, and never the id. The two fixture names differ, so this fails if either is swapped.
  it("shows the staff name, not the customer-facing one and not the id", async () => {
    const products = [
      product({
        name: "Croquetas",
        customerName: { es: "Croquetas caseras", en: "Ham croquettes" },
      }),
    ];
    const { el } = await mountWidget<ProductList>("dashboard-product-list", { products });
    const row = (await tableRoot(el)).querySelector("tbody tr")!;
    expect(row.textContent).toContain("Croquetas");
    expect(row.textContent).not.toContain("Croquetas caseras");
    expect(row.textContent).not.toContain("Ham croquettes");
    expect(row.textContent).not.toContain(products[0]!.id);
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
    const rows = [...(await tableRoot(el)).querySelectorAll("tbody tr")];
    expect(rows[0]!.textContent).toContain("12.50");
    expect(rows[1]!.textContent).toContain("4.00–7.50");
  });

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
    expect(cellUnder(root, "wine", t("product.price")).textContent!.trim()).toBe("4.00–5.50");
    root.querySelector<HTMLElement>(".tree-toggle")!.click();
    await table.updateComplete;
    expect(cellUnder(root, "wine:w125", t("product.price")).textContent!.trim()).toBe("4.00");
    expect(cellUnder(root, "wine:w175", t("product.price")).textContent!.trim()).toBe("5.50");
  });

  // The Modifiers column names the lists a manager attached through `Product.modifiers`. Two things
  // are set up to fail on the TEXT rather than pass on an empty cell: `opt-2` ("Punto") is a loaded
  // options list this product does NOT hold, so a column printing the loaded set instead of the
  // attachments names it; and the cell is asserted whole with `toBe`, so resolving the `extras` ref
  // against the options lists — which also reaches "Punto" — loses "Salsas".
  it("shows reporting and other categories, attached modifier list names, and no VAT column", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({
          primaryCategoryId: "reporting",
          categoryIds: ["reporting", "seasonal", "terrace"],
          modifiers: [
            { kind: "extras", id: "ex-1" },
            { kind: "options", id: "opt-1" },
          ],
        }),
      ],
      categories: [
        { id: "reporting", name: { es: "Comida" }, image: null, color: null, parentId: null },
        { id: "seasonal", name: { es: "Temporada" }, image: null, color: null, parentId: null },
        { id: "terrace", name: { es: "Terraza" }, image: null, color: null, parentId: null },
      ],
      extraLists: [{ id: "ex-1", name: "Salsas" }],
      optionLists: [
        { id: "opt-1", name: "Punto de la carne" },
        { id: "opt-2", name: "Punto" },
      ],
    });
    const root = await tableRoot(el);
    const headers = [...root.querySelectorAll("thead th")].map((cell) => cell.textContent!.trim());
    expect(headers.some((header) => header.startsWith(t("product.name")))).toBe(true);
    expect(headers).toContain(t("product.reporting_category"));
    expect(headers).toContain(t("product.other_categories"));
    expect(headers).toContain(t("editor.modifiers"));
    expect(headers).not.toContain(t("product.vat"));
    const text = root.querySelector("tbody tr")!.textContent!;
    expect(text).toContain("Comida");
    expect(text).toContain("Temporada, Terraza");
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
          categoryIds: ["missing-category", "missing-secondary"],
          modifiers: [{ kind: "options", id: "missing-list" }],
        }),
      ],
      categories: [],
      extraLists: [],
      optionLists: [],
    });
    const text = (await tableRoot(el)).querySelector("tbody tr")!.textContent!;
    expect(text.match(new RegExp(t("editor.missing_choice"), "g"))).toHaveLength(3);
  });

  // Spec §1.1/§9.2: `sold_alone` answers whether a product is offered in its own right, and the list
  // carries the column so an ingredient or an extra-only product lives in this list rather than on a
  // screen of its own — which only works if a manager can tell the two apart and narrow to either.
  it("shows a sold-on-its-own badge carrying text, not colour alone", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "dish", soldAlone: true }),
        product({ id: "topping", soldAlone: false }),
      ],
    });
    const root = await tableRoot(el);
    const headers = [...root.querySelectorAll("thead th")].map((cell) => cell.textContent!.trim());
    expect(headers.some((header) => header.startsWith(t("product.sold_alone")))).toBe(true);
    const badges = root.querySelectorAll<HTMLElement>("[data-test=sold-alone-badge]");
    expect(badges.length).toBe(2);
    expect(badges[0]!.getAttribute("data-sold-alone")).toBe("true");
    expect(badges[1]!.getAttribute("data-sold-alone")).toBe("false");
    expect(badges[0]!.textContent!.trim().length).toBeGreaterThan(0);
    expect(badges[1]!.textContent!.trim().length).toBeGreaterThan(0);
    expect(badges[0]!.textContent).not.toBe(badges[1]!.textContent);
  });

  it("narrows the list to the products that are, or are not, sold on their own", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "dish", soldAlone: true }),
        product({ id: "topping", soldAlone: false }),
      ],
    });
    const root = await tableRoot(el);
    const select = root.querySelector<HTMLSelectElement>('select[data-filter="sold-alone"]')!;
    expect([...select.options].map((option) => option.value)).toEqual(["", "true", "false"]);
    await choose(el, "sold-alone", "false");
    expect(rowKeys(root)).toEqual(["topping"]);
    await choose(el, "sold-alone", "true");
    expect(rowKeys(root)).toEqual(["dish"]);
    await choose(el, "sold-alone", "");
    expect(rowKeys(root)).toEqual(["dish", "topping"]);
  });

  // Sold-on-its-own is the PRODUCT's answer — a listed variant carries none of its own — so every
  // variant row answers this filter with its product's, and the two are shown and hidden together.
  it("keeps a product and its variants together on both sides of the filter", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "dish", soldAlone: true }),
        product({ id: "bun", soldAlone: false, variants: [bunVariant] }),
      ],
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    await choose(el, "sold-alone", "false");
    expect(rowKeys(root)).toEqual(["bun"]);
    root.querySelector<HTMLElement>(".tree-toggle")!.click();
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["bun", "bun:small"]);
    await choose(el, "sold-alone", "true");
    expect(rowKeys(root)).toEqual(["dish"]);
  });

  // The answer belongs to the product, so a variant row shows the muted dash the other product-level
  // columns show and contributes nothing to the search box — otherwise searching the badge's words
  // would drag variant rows in beside their product.
  it("leaves a variant row's sold-on-its-own cell muted and out of the search", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "dish", soldAlone: true }),
        product({ id: "bun", soldAlone: false, variants: [bunVariant] }),
      ],
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    root.querySelector<HTMLElement>(".tree-toggle")!.click();
    await table.updateComplete;
    const cell = cellUnder(root, "bun:small", t("product.sold_alone"));
    expect(cell.querySelector("[data-test=sold-alone-badge]")).toBeNull();
    expect(cell.textContent!.trim()).toBe("—");
    const search = root.querySelector<HTMLInputElement>('input[name="search"]')!;
    search.value = t("product.not_sold_alone_badge");
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["bun"]);
  });

  it("is searchable and expands a parent product to its variant rows", async () => {
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
    expect(table.searchable).toBe(true);
    expect(table.rowParent).toBeDefined();
    const root = await tableRoot(el);
    expect(root.querySelectorAll("tbody tr")).toHaveLength(1);
    root.querySelector<HTMLElement>(".tree-toggle")!.click();
    await table.updateComplete;
    const rows = [...root.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(3);
    expect(rows.slice(1).map((row) => row.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Small"), expect.stringContaining("Large")]),
    );
    expect(rows.map((row) => row.textContent).join(" ")).not.toContain("Taza pequeña");
    expect(rows.map((row) => row.textContent).join(" ")).not.toContain("SM");
  });

  it("shows a matching variant and its product while branches are initially collapsed", async () => {
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
    const root = await tableRoot(el);
    const search = root.querySelector<HTMLInputElement>('input[name="search"]')!;
    search.value = "Small";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await table.updateComplete;
    const rows = [...root.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Coffee");
    expect(rows[1]!.textContent).toContain("Small");
    expect(rows[1]!.textContent).not.toContain("Taza pequeña");
    expect(rows[1]!.textContent).not.toContain("SM");
  });

  it("shows an active/inactive badge carrying text, not colour alone", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "on", active: true }), product({ id: "off", active: false })],
    });
    // An Inactive product is behind the status filter (spec §15.6), so both are shown with "any".
    await choose(el, "active", "");
    const badges = (await tableRoot(el)).querySelectorAll<HTMLElement>("[data-test=active-badge]");
    expect(badges.length).toBe(2);
    // Each badge names its state in text (an a11y requirement — not conveyed by colour alone).
    expect(badges[0]!.getAttribute("data-active")).toBe("true");
    expect(badges[0]!.textContent!.trim().length).toBeGreaterThan(0);
    expect(badges[1]!.getAttribute("data-active")).toBe("false");
    expect(badges[1]!.textContent!.trim().length).toBeGreaterThan(0);
    expect(badges[0]!.textContent).not.toBe(badges[1]!.textContent);
  });

  // Spec §15.6: Inactive (deleted) products are hidden behind a status filter that starts on
  // Active; no product is hidden for being Unavailable (sold out for now). The fixtures give Active
  // and Available DIFFERENT values, so a column or filter reading the wrong flag fails.
  it("starts the status filter on Active, so an Inactive product is hidden until it is changed", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "gone", name: "Anchoas", active: false, available: true }),
        product({ id: "sold-out", name: "Boquerones", active: true, available: false }),
      ],
    });
    const root = await tableRoot(el);
    const select = root.querySelector<HTMLSelectElement>('select[data-filter="active"]')!;
    expect([...select.options].map((option) => option.value)).toEqual(["", "active", "inactive"]);
    expect([...select.options].map((option) => option.textContent!.trim())).toEqual([
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

  // Spec §15.6: a removed variant is Inactive and hidden behind the same status filter as a deleted
  // product. A variant row answers the filter with its OWN state, and with Inactive while its
  // product is Inactive, because the till sells neither. Under Inactive, an Active product with a
  // removed variant stays on screen as the variant's context (the table keeps a match's ancestors).
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
    // The Active product is there only as context, and is drawn muted so the match stands out.
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

  // Spec §15.1: a product with an Active variant is sold only as one of them, and one with none sells
  // as itself — so the product's price is the range over its Active variants, or its own price.
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
    expect(cellUnder(root, "wine", t("product.price")).textContent!.trim()).toBe("4.50–5.50");
    expect(cellUnder(root, "beer", t("product.price")).textContent!.trim()).toBe("3.00");
  });

  // A variant may set its own price, VAT and categories, so its row shows the values it is sold and
  // reported under — the server's `effective` — rather than its product's. Every field differs
  // between Wine 175 and its product, and its three names differ from one another, so a row reading
  // the product's values or the wrong name fails.
  it("shows a variant's own name and its effective price and categories", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({
          id: "wine",
          name: "Wine by the glass",
          unitPrice: "4.00",
          vatClass: "reduced",
          primaryCategoryId: "food",
          categoryIds: ["food", "terrace"],
          variants: [
            {
              ...bunVariant,
              id: "w175",
              name: "Wine 175",
              customerName: { es: "Copa grande de vino" },
              kitchenName: "VINO 175",
              unitPrice: "4.75",
              effective: {
                unitPrice: "4.75",
                vatClass: "general",
                primaryCategoryId: "drinks",
                categoryIds: ["drinks", "bar"],
              },
            },
          ],
        }),
      ],
      categories: [
        { id: "food", name: { es: "Comida" }, image: null, color: null, parentId: null },
        { id: "terrace", name: { es: "Terraza" }, image: null, color: null, parentId: null },
        { id: "drinks", name: { es: "Bebidas" }, image: null, color: null, parentId: null },
        { id: "bar", name: { es: "Barra" }, image: null, color: null, parentId: null },
      ],
    });
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = await tableRoot(el);
    root.querySelector<HTMLElement>(".tree-toggle")!.click();
    await table.updateComplete;
    const cell = (header: string) => cellUnder(root, "wine:w175", header);
    expect(cell(t("product.name")).textContent!.trim()).toBe("Wine 175");
    expect(cell(t("product.price")).querySelector('[data-test="price"]')!.textContent!.trim()).toBe(
      "4.75",
    );
    expect(cell(t("product.reporting_category")).textContent!.trim()).toBe("Bebidas");
    expect(cell(t("product.other_categories")).textContent!.trim()).toBe("Barra");
    expect(cellUnder(root, "wine", t("product.other_categories")).textContent!.trim()).toBe(
      "Terraza",
    );
  });

  // A variant's VAT is noted under its price only where it differs from its product's, so the list
  // keeps no VAT column and still shows the one value that would otherwise be invisible.
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
              customerName: { es: "Copa grande de vino" },
              kitchenName: "VINO 175",
              unitPrice: "4.75",
              effective: {
                unitPrice: "4.75",
                vatClass: "general",
                primaryCategoryId: "category-1",
                categoryIds: ["category-1"],
              },
            },
            {
              ...bunVariant,
              id: "w125",
              name: "Wine 125",
              customerName: { es: "Copa pequeña de vino" },
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
    // The staff name, not the customer-facing or kitchen one, heads each variant row.
    for (const [rowKey, name] of [
      ["wine:w175", "Wine 175"],
      ["wine:w125", "Wine 125"],
    ] as const)
      expect(cellUnder(root, rowKey, t("product.name")).textContent!.trim()).toBe(name);
    expect(cellUnder(root, "wine:w125", t("product.price")).textContent!.trim()).toBe("4.00");
    // Cell markup lives in the table's shadow root, so only ::part reaches it: a muted, smaller line.
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

  // The three-state allergen invariant (design §7): null=PENDING, {}=none, {…}=declared. PENDING and
  // none MUST be distinguishable — fourteen blank cells must never silently claim "allergen-free".
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

  // The three states render through the i18n layer as three DISTINCT localised names (Pendiente /
  // Ninguno / Declarado), preserving the a11y "three different words, not colour alone" requirement.
  // `data-state` stays the raw token (asserted elsewhere); only the pill's visible text is localised.
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
    // PENDING and none are not the same rendered text (the whole point of the invariant).
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
  // spans while every attribute assertion above still passed. Measuring the painted box is the only
  // assertion that can tell the two apart.
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
    for (const test of [
      "active-badge",
      "unavailable-badge",
      "sold-alone-badge",
      "allergen-state",
    ]) {
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

  // edit-product must escape this widget's shadow boundary to reach the catalogue screen, so it is
  // dispatched bubbles+composed — pinned so a future edit does not quietly drop either flag.
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
    expect((await tableRoot(el)).querySelectorAll("tbody tr").length).toBe(0);
  });
});
