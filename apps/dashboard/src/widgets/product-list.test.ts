import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { allergenStateName } from "../i18n/domain.js";
import type { Product } from "../api/client.js";
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

/** A bun variant used by the filter tests; its own fields carry nothing the filter reads. */
const bunVariant = {
  id: "small",
  name: "Small",
  customerName: null,
  kitchenName: null,
  image: null,
  unitPrice: "1.00",
  available: true,
};

/**
 * A representative product carrying every field the list reads; individual tests override the one
 * field they exercise (allergens, image, active, name) via a spread so the fixture stays the
 * single source for the rest. The staff name and the customer-facing name deliberately DIFFER, so a
 * test cannot pass by reading whichever one it happened to find.
 */
function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-1",
    modifiers: [],
    modifierIds: [],
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
    soldAlone: true,
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: null,
    variants: [],
    ...overrides,
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
          },
          {
            id: "large",
            name: "Large",
            customerName: { es: "Taza grande" },
            kitchenName: "LG",
            image: null,
            unitPrice: "7.50",
            available: true,
          },
        ],
      }),
    ];
    const { el } = await mountWidget<ProductList>("dashboard-product-list", { products });
    const rows = [...(await tableRoot(el)).querySelectorAll("tbody tr")];
    expect(rows[0]!.textContent).toContain("12.50");
    expect(rows[1]!.textContent).toContain("4.00–7.50");
  });

  // The Modifiers column names the lists a manager attached through `Product.modifiers`. The product
  // also still carries the OLD flat `modifierIds`, holding a DIFFERENT list id here: reading that
  // field instead would print "Punto", and resolving an `extras` ref against the options lists would
  // print it too, so either mistake fails on the text rather than passing on an empty cell.
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
          modifierIds: ["opt-2"],
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

  // A variant row answers the filter with its PRODUCT's `sold_alone`, so the two move together.
  // Read in packages/ui/src/components/wt-data-table.ts: `#visibleRows` judges EVERY row against the
  // chosen value, and `#treeVisible` adds back a match's ANCESTORS only, never a match's children.
  // Any other answer breaks one side — an empty value strands the product as a childless row that
  // still prices a range across variants nobody can see, and a value that matched while the product
  // did not would render the product as an ancestor-only ghost.
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
            },
            {
              id: "large",
              name: "Large",
              customerName: { es: "Taza grande" },
              kitchenName: "LG",
              image: null,
              unitPrice: "3.00",
              available: true,
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
            },
            {
              id: "large",
              name: "Large",
              customerName: { es: "Taza grande" },
              kitchenName: "LG",
              image: null,
              unitPrice: "3.00",
              available: true,
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
    const badges = (await tableRoot(el)).querySelectorAll<HTMLElement>("[data-test=active-badge]");
    expect(badges.length).toBe(2);
    // Each badge names its state in text (an a11y requirement — not conveyed by colour alone).
    expect(badges[0]!.getAttribute("data-active")).toBe("true");
    expect(badges[0]!.textContent!.trim().length).toBeGreaterThan(0);
    expect(badges[1]!.getAttribute("data-active")).toBe("false");
    expect(badges[1]!.textContent!.trim().length).toBeGreaterThan(0);
    expect(badges[0]!.textContent).not.toBe(badges[1]!.textContent);
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
      products: [product({ image: null })],
    });
    const root = await tableRoot(el);
    const frame = getComputedStyle(
      root.querySelector<HTMLElement>("[data-test=thumb-placeholder]")!,
    );
    expect(frame.width).not.toBe("auto");
    expect(parseFloat(frame.width)).toBeGreaterThan(0);
    expect(frame.width).toBe(frame.height);
    expect(parseFloat(frame.borderTopWidth)).toBeGreaterThan(0);
    for (const test of ["active-badge", "sold-alone-badge", "allergen-state"]) {
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
