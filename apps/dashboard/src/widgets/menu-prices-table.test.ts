import { combinedFixture } from "./test-helpers.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import type { CategorySummary, SectionDetails, MenuPriceRow, Product } from "../api/client.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { formatMoney } from "@waitron/shared";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { WtToast } from "@waitron/ui/src/components/wt-toast.js";
import { MenuPricesTable, type PriceSave } from "./menu-prices-table.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { chooseOption, chooseOptions, expectFiltersFirst } from "@waitron/ui/src/test-helpers.js";

afterEach(cleanupWidgets);
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

/** Each section's customer names differ from its internal name, so a placement drawn from the
 * wrong one fails. */
const sections: SectionDetails[] = [
  ["s-drinks", "Drinks", "Something to drink"],
  ["s-beer", "Beer", "Cold beers on tap"],
  ["s-fav", "Favourites", "Our picks"],
].map(([id, internalName, customer]) => ({
  id: id!,
  internalName: internalName!,
  names: { en: customer!, es: `${customer!} (es)` },
  image: null,
  color: null,
  members: [],
}));

const categories: CategorySummary[] = [
  { id: "c-drinks", name: "Bebidas", parentId: null, color: null },
  { id: "c-beer", name: "Cerveza", parentId: "c-drinks", color: null },
  { id: "c-mains", name: "Principales", parentId: null, color: null },
];

/** The staff, customer and kitchen names differ, so a surface reading the wrong one fails. */
function variant(id: string, name: string, unitPrice: string | null) {
  return {
    id,
    name,
    customerName: { es: `${name} para clientes` },
    kitchenName: `${name.toUpperCase()} COCINA`,
    image: null,
    unitPrice,
    available: true,
    effective: {
      unitPrice: unitPrice ?? "3.00",
      vatClass: "general" as const,
      primaryCategoryId: null,
    },
  };
}

const lemonadeProduct = {
  id: "p-lemonade",
  name: "Lemonade",
  customerName: { es: "Limonada casera" },
  kitchenName: "LEMON",
  variants: [variant("v-small", "Small", null), variant("v-large", "Large", "3.40")],
} as unknown as Product;

const burger: MenuPriceRow = {
  menuItemId: "mi-burger",
  combined: combinedFixture("p-burger", "12.00", [], null, "12.00", {}),
  productId: "p-burger",
  name: "Burger",
  categoryId: "c-mains",
  placements: [[]],
  override: null,
  effectivePrice: "12.00",
  active: true,
  available: true,
  variants: [],
};
const lemonade: MenuPriceRow = {
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
  placements: [["s-fav"], ["s-drinks"]],
  override: "2.50",
  effectivePrice: "2.50",
  active: true,
  available: true,
  variants: [
    { variantId: "v-small", price: null, active: true, available: true },
    { variantId: "v-large", price: "3.75", active: true, available: true },
  ],
};
const lager: MenuPriceRow = {
  menuItemId: "mi-lager",
  combined: combinedFixture("p-lager", "2.00", [], null, "2.00", {}),
  productId: "p-lager",
  name: "Lager",
  categoryId: "c-beer",
  placements: [["s-drinks", "s-beer"]],
  override: null,
  effectivePrice: "2.00",
  active: true,
  available: true,
  variants: [],
};

async function mount(props: Partial<MenuPricesTable> = {}): Promise<MenuPricesTable> {
  const { el } = await mountWidget<MenuPricesTable>("dashboard-menu-prices-table", {
    rows: [burger, lemonade, lager],
    sections,
    categories,
    products: [lemonadeProduct],
    menuName: "Lunch Menu",
    ...props,
  });
  await table(el).updateComplete;
  return el;
}

type Table = HTMLElement & { updateComplete: Promise<unknown>; shadowRoot: ShadowRoot };

function table(el: MenuPricesTable): Table {
  return el.shadowRoot!.querySelector<Table>("wt-data-table")!;
}

function text(node: Element | null | undefined): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function row(el: MenuPricesTable, menuItemId: string): HTMLElement | null {
  return table(el).shadowRoot.querySelector<HTMLElement>(`tr[data-row-key="${menuItemId}"]`);
}

/** A price as the table writes it in the current language, with its spaces folded the way
 * `text` and `visibleText` read them. */
function eur(amount: string): string {
  return formatMoney(amount, currentLocale()).replace(/\s+/g, " ");
}

/** Each shown column's key, in order. */
function headers(el: MenuPricesTable): string[] {
  return [...table(el).shadowRoot.querySelectorAll("thead th")].map(
    (th) => th.querySelector("[data-sort]")?.getAttribute("data-sort") ?? "",
  );
}

/** A cell's text as it is seen: without the tree's toggle glyph. */
function visibleText(node: Element | undefined): string {
  if (node === undefined) return "";
  const clone = node.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll(".tree-toggle")) hidden.remove();
  return text(clone);
}

/** One column's cell in one shown row. */
function cell(el: MenuPricesTable, key: string, rowKey: string): HTMLElement {
  const index = headers(el).indexOf(key);
  expect(index, key).toBeGreaterThanOrEqual(0);
  return row(el, rowKey)!.children[index] as HTMLElement;
}

/** A shown row's pinned row-menu cell, which has no sort key for `cell` to find it by. */
function pinnedCell(el: MenuPricesTable, rowKey: string): HTMLElement {
  return row(el, rowKey)!.querySelector<HTMLElement>('td[data-pinned="end"]')!;
}

/** A shown row's "Edit product" link, in its row menu. */
function editLink(el: MenuPricesTable, rowKey: string): HTMLAnchorElement {
  return pinnedCell(el, rowKey).querySelector<HTMLAnchorElement>(
    `a[data-test="edit-product-${rowKey}"]`,
  )!;
}

/** The text of one column's cell in each shown row, in order. */
function column(el: MenuPricesTable, key: string): string[] {
  const index = headers(el).indexOf(key);
  expect(index, key).toBeGreaterThanOrEqual(0);
  return [...table(el).shadowRoot.querySelectorAll("tbody tr")].map((tr) =>
    visibleText(tr.children[index]),
  );
}

function shown(el: MenuPricesTable): string[] {
  return [...table(el).shadowRoot.querySelectorAll("tbody tr")].map((tr) =>
    tr.getAttribute("data-row-key")!,
  );
}

/** A list is every value ticked in a multi-select filter; a string is a single-choice filter's. */
async function choose(
  el: MenuPricesTable,
  filter: string,
  value: string | string[],
): Promise<void> {
  const select = table(el).shadowRoot.querySelector<HTMLElement>(
    `wt-combobox[data-filter="${filter}"]`,
  )!;
  if (typeof value === "string") await chooseOption(select, value);
  else await chooseOptions(select, value);
  await table(el).updateComplete;
}

/** A load holding a clash starts on the Clashes filter; this shows every row instead. */
async function allPrices(el: MenuPricesTable): Promise<MenuPricesTable> {
  await choose(el, "override", "");
  return el;
}

function options(el: MenuPricesTable, filter: string): string[] {
  const select = table(el).shadowRoot.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    `wt-combobox[data-filter="${filter}"]`,
  )!;
  return select.options.map((option) => option.label);
}

function override(el: MenuPricesTable, rowKey: string) {
  return table(el).shadowRoot.querySelector<HTMLElementTagNameMap["wt-price-input"]>(
    `wt-price-input[data-row="${rowKey}"]`,
  )!;
}

const hintOf = (input: HTMLElement) => text(input.shadowRoot!.querySelector("[data-hint]"));

/** A product row's tree toggle; null on a row with nothing under it. */
function toggleOf(el: MenuPricesTable, key: string): HTMLButtonElement | null {
  return row(el, key)?.querySelector<HTMLButtonElement>("button.tree-toggle") ?? null;
}

async function sortBy(el: MenuPricesTable, key: string): Promise<void> {
  table(el).shadowRoot.querySelector<HTMLElement>(`button[data-sort="${key}"]`)!.click();
  await table(el).updateComplete;
}

async function typeIn(el: MenuPricesTable, key: string, value: string) {
  override(el, key).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function press(el: MenuPricesTable, key: string, name: "Enter" | "Escape") {
  override(el, key)
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, composed: true, cancelable: true }),
    );
  await el.updateComplete;
}

async function leave(el: MenuPricesTable, key: string) {
  override(el, key).dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
  await el.updateComplete;
}

async function search(el: MenuPricesTable, term: string): Promise<void> {
  const box = table(el).shadowRoot.querySelector<HTMLInputElement>('input[name="search"]')!;
  box.value = term;
  box.dispatchEvent(new Event("input"));
  await table(el).updateComplete;
}

function priceSaves(el: MenuPricesTable) {
  const heard = vi.fn<(detail: PriceSave) => void>();
  el.addEventListener("wt-price-save", (event) => heard((event as CustomEvent<PriceSave>).detail));
  return heard;
}

// Spanish writes a no-break space (U+00A0) before the sign, spelled out here rather than taken from
// the formatter the table calls. Read with textContent, which keeps it.
it.each([
  { locale: "en-GB", burger: "€12.00", lemonade: "€3.00 – €3.75" },
  { locale: "es-ES", burger: "12,00\u00a0€", lemonade: "3,00\u00a0€ – 3,75\u00a0€" },
])(
  "draws every row's price override field in $locale, and names the inherited price in its hint the way $locale writes it",
  async (want) => {
    setLocale(want.locale);
    try {
      const el = await mount();
      for (const key of ["mi-burger", "mi-lemonade", "mi-lager"])
        expect(override(el, key).locale, key).toBe(want.locale);
      const hint = (key: string) =>
        override(el, key).shadowRoot!.querySelector("[data-hint]")!.textContent;
      expect(hint("mi-burger")).toBe(
        t("menu_prices.override_help").replace("{price}", want.burger),
      );
      expect(hint("mi-lemonade")).toBe(
        t("menu_prices.override_help_range").replace("{range}", want.lemonade),
      );
    } finally {
      setLocale("es-ES");
    }
  },
);

it.each([
  { locale: "en-GB", sign: "€", range: "€3.00 – €3.75" },
  { locale: "es-ES", sign: "€", range: "3,00\u00a0€ – 3,75\u00a0€" },
])(
  "gives every row's field, a size's too, the locale $locale, drawing the euro sign in it, and names the range in the hint the way $locale writes it",
  async ({ locale, sign, range }) => {
    setLocale(locale);
    try {
      const el = await mount();
      toggleOf(el, "mi-lemonade")!.click();
      await table(el).updateComplete;
      for (const key of [
        "mi-burger",
        "mi-lemonade",
        "mi-lemonade:v-small",
        "mi-lemonade:v-large",
        "mi-lager",
      ]) {
        const input = override(el, key);
        expect(input.locale, key).toBe(locale);
        expect(input.shadowRoot!.querySelector('[part~="currency"]')!.textContent, key).toBe(sign);
      }
      const hint = override(el, "mi-lemonade").shadowRoot!.querySelector("[data-hint]")!;
      expect(hint.textContent).toBe(t("menu_prices.override_help_range").replace("{range}", range));
    } finally {
      setLocale("es-ES");
    }
  },
);

it("lists each product once with its price override, and where it appears by the sections' internal names", async () => {
  const el = await mount();
  expect(shown(el)).toEqual(["mi-burger", "mi-lemonade", "mi-lager"]);
  expect(column(el, "name")).toEqual([
    "Burger",
    `Lemonade ${t("menu_prices.has_variants")}`,
    "Lager",
  ]);
  expect(column(el, "placements")).toEqual([
    t("menu_prices.top_level"),
    "Favourites Drinks",
    "Drinks › Beer",
  ]);
  const placements = [...row(el, "mi-lemonade")!.querySelectorAll("[part~=placement]")].map(text);
  expect(placements).toEqual(["Favourites", "Drinks"]);
  expect(column(el, "category")).toEqual(["Principales", "Bebidas", "Bebidas › Cerveza"]);
  const keys = ["mi-burger", "mi-lemonade", "mi-lager"];
  expect(keys.map((key) => override(el, key).value)).toEqual(["", "2.50", ""]);
  // Lemonade left blank would charge its sizes' prices: 3.00 for the small, following the
  // product's own price, and the large's 3.75 on this menu.
  expect(keys.map((key) => override(el, key).placeholder)).toEqual([
    "12.00",
    "3.00 – 3.75",
    "2.00",
  ]);
});

it("puts each placement on its own line and paints the notes muted, through the table's parts", async () => {
  const el = await mount({ rows: [burger, { ...lemonade, override: null }, lager] });
  const probe = document.createElement("span");
  probe.style.color = "var(--wt-color-text-muted)";
  el.parentElement!.appendChild(probe);
  const muted = getComputedStyle(probe).color;
  const lemonadeRow = row(el, "mi-lemonade")!;
  const placements = [...lemonadeRow.querySelectorAll<HTMLElement>("[part~=placement]")];
  expect(placements.map((part) => getComputedStyle(part).display)).toEqual(["block", "block"]);
  expect(placements[1]!.getBoundingClientRect().top).toBeGreaterThan(
    placements[0]!.getBoundingClientRect().top,
  );
  expect(getComputedStyle(lemonadeRow.querySelector("[part~=note]")!).color).toBe(muted);
  const sizesNote = cell(el, "override", "mi-lemonade").querySelector("[part~=muted]")!;
  expect(text(sizesNote)).toBe(t("menu_prices.variant_overrides"));
  expect(getComputedStyle(sizesNote).color).toBe(muted);
  expect(muted).not.toBe(getComputedStyle(row(el, "mi-burger")!).color);
});

it("names a missing section or category, and a product with no reporting category as No category", async () => {
  const el = await mount({
    rows: [
      { ...lager, categoryId: null, placements: [["s-gone"]] },
      { ...burger, categoryId: "c-gone" },
    ],
  });
  expect(column(el, "placements")).toEqual([t("members.missing"), t("menu_prices.top_level")]);
  expect(column(el, "category")).toEqual([t("categories.none"), t("editor.missing_choice")]);
  await choose(el, "category", ["c-drinks"]);
  expect(shown(el)).toEqual([]);
});

it("finds a product by its name", async () => {
  const el = await mount();
  await search(el, "lemon");
  expect(shown(el)).toEqual(["mi-lemonade"]);
});

it.each(["Bebidas / Cerveza", "Bebidas › Cerveza", "Bebidas > Cerveza"])(
  "finds a product by its main category's path typed as %s",
  async (term) => {
    const el = await mount();
    await search(el, term);
    expect(shown(el)).toEqual(["mi-lager"]);
  },
);

it("does not find a product by text that runs from one spelling of its category's path into the next", async () => {
  const el = await mount();
  await search(el, "Cerveza Bebidas");
  expect(shown(el)).toEqual([]);
});

it("finds a product whose main category is missing, or that has none, by what the column says", async () => {
  const el = await mount({
    rows: [
      { ...lager, categoryId: null },
      { ...burger, categoryId: "c-gone" },
    ],
  });
  await search(el, t("editor.missing_choice"));
  expect(shown(el)).toEqual(["mi-burger"]);
  await search(el, t("categories.none"));
  expect(shown(el)).toEqual(["mi-lager"]);
});

it.each([
  { locale: "en-GB", label: "No category" },
  { locale: "es-ES", label: "Sin categoría" },
])(
  "reads $label in $locale for a product with no main category, and finds it by those words",
  async (c) => {
    setLocale(c.locale);
    try {
      const el = await mount({ rows: [{ ...lager, categoryId: null }, burger] });
      expect(column(el, "category")[0]).toBe(c.label);
      await search(el, c.label);
      expect(shown(el)).toEqual(["mi-lager"]);
    } finally {
      setLocale("es-ES");
    }
  },
);

// A term typed from the keyboard carries an ordinary space where Spanish shows a no-break one.
it.each([
  { locale: "es-ES", term: "12,00", want: ["mi-burger"] },
  { locale: "es-ES", term: "12,00 €", want: ["mi-burger"] },
  { locale: "en-GB", term: "€12.00", want: ["mi-burger"] },
  { locale: "es-ES", term: "12.00", want: ["mi-burger"] },
  { locale: "es-ES", term: "3,75", want: ["mi-lemonade", "mi-lemonade:v-large"] },
])("finds a product in $locale by the price as shown, or as its raw amount: $term", async (c) => {
  setLocale(c.locale);
  try {
    const el = await mount();
    await search(el, c.term);
    expect(shown(el)).toEqual(c.want);
  } finally {
    setLocale("es-ES");
  }
});

it("filters by a section, keeping every product reached through it, and offers the sections by internal name", async () => {
  const el = await mount();
  expect(options(el, "placements")).toEqual([
    t("menu_prices.all_sections"),
    "Beer",
    "Drinks",
    "Favourites",
  ]);
  await choose(el, "placements", ["s-drinks"]);
  expect(shown(el)).toEqual(["mi-lemonade", "mi-lager"]);
  await choose(el, "placements", ["s-beer"]);
  expect(shown(el)).toEqual(["mi-lager"]);
  await choose(el, "placements", ["s-fav"]);
  expect(shown(el)).toEqual(["mi-lemonade"]);
});

it("a category filter long enough to search shows its search box and empty list in Spanish", async () => {
  setLocale("es-ES");
  const many = Array.from({ length: 8 }, (_, index) => ({
    id: `c-${index}`,
    name: `Categoría ${index}`,
    parentId: null,
    color: null,
  }));
  const el = await mount({ categories: many });
  const filter = table(el).shadowRoot.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    'wt-combobox[data-filter="category"]',
  )!;
  table(el).shadowRoot.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
  await userEvent.click(filter.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
  await filter.updateComplete;
  const search = filter.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  expect(search.placeholder).toBe("Buscar");
  await userEvent.type(search, "zzz");
  await filter.updateComplete;
  expect(text(filter.shadowRoot!.querySelector(".empty"))).toBe("Sin resultados");
});

it("filters by a reporting category, including the categories inside it", async () => {
  const el = await mount();
  expect(options(el, "category")).toEqual([
    t("menu_prices.all_categories"),
    "Bebidas",
    "Bebidas › Cerveza",
    "Principales",
  ]);
  await choose(el, "category", ["c-drinks"]);
  expect(shown(el)).toEqual(["mi-lemonade", "mi-lager"]);
  await choose(el, "category", ["c-beer"]);
  expect(shown(el)).toEqual(["mi-lager"]);
  await choose(el, "category", ["c-beer", "c-mains"]);
  expect(shown(el)).toEqual(["mi-burger", "mi-lager"]);
});

it("filters by several sections at once, keeping the products reached through any of them", async () => {
  const el = await mount();
  await choose(el, "placements", ["s-beer", "s-fav"]);
  expect(shown(el)).toEqual(["mi-lemonade", "mi-lager"]);
});

it("filters by a parent category and an unrelated one, keeping the parent's sub-category rows and the other's", async () => {
  const water: MenuPriceRow = {
    ...burger,
    menuItemId: "mi-water",
    name: "Water",
    categoryId: null,
  };
  const el = await mount({ rows: [burger, lemonade, lager, water] });
  expect(shown(el)).toContain("mi-water");
  await choose(el, "category", ["c-drinks", "c-mains"]);
  expect(shown(el)).toEqual(["mi-burger", "mi-lemonade", "mi-lager"]);
});

it("narrows by the section filter and the category filter together", async () => {
  const el = await mount();
  await choose(el, "placements", ["s-fav", "s-beer"]);
  await choose(el, "category", ["c-mains", "c-beer"]);
  expect(shown(el)).toEqual(["mi-lager"]);
});

it.each([
  ["en-GB", "2 sections", "2 categories"],
  ["es-ES", "2 secciones", "2 categorías"],
])(
  "names two chosen sections or categories by their count in the closed dropdown (%s)",
  async (locale, sections, categories) => {
    setLocale(locale);
    try {
      const el = await mount();
      const closed = (filter: string) =>
        text(
          table(el)
            .shadowRoot.querySelector(`wt-combobox[data-filter="${filter}"]`)!
            .shadowRoot!.querySelector(".value"),
        );
      await choose(el, "placements", ["s-beer", "s-fav"]);
      await choose(el, "category", ["c-beer", "c-mains"]);
      expect([closed("placements"), closed("category")]).toEqual([sections, categories]);
    } finally {
      setLocale("es-ES");
    }
  },
);

it("keeps the price filter a single choice", async () => {
  const el = await mount();
  const multiple = (filter: string) =>
    table(el).shadowRoot.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      `wt-combobox[data-filter="${filter}"]`,
    )!.multiple;
  expect([multiple("override"), multiple("placements"), multiple("category")]).toEqual([
    false,
    true,
    true,
  ]);
});

it("shows only the products this menu sets its own price for", async () => {
  const el = await mount();
  await choose(el, "override", "overridden");
  expect(shown(el)).toEqual(["mi-lemonade"]);
});

it("counts a product whose only price on this menu is a variant's as overridden, and not one whose variants set no price", async () => {
  const el = await mount({
    rows: [
      {
        ...lemonade,
        override: null,
        variants: [
          { variantId: "v-small", price: null, active: true, available: true },
          { variantId: "v-large", price: "4.25", active: true, available: true },
        ],
      },
      {
        ...lager,
        combined: combinedFixture("p-lager", "2.00", [{ variantId: "v-small", price: null }]),
        variants: [{ variantId: "v-small", price: null, active: true, available: true }],
      },
      burger,
    ],
  });
  await choose(el, "override", "overridden");
  expect(shown(el)).toEqual(["mi-lemonade"]);
});

it("sorts the prices as amounts, not as text", async () => {
  const el = await mount({
    rows: [
      {
        ...lager,
        effectivePrice: "10.00",
        combined: combinedFixture("p-lager", "10.00"),
      },
      {
        ...burger,
        effectivePrice: "9.50",
        combined: combinedFixture("p-burger", "9.50"),
      },
    ],
  });
  await sortBy(el, "override");
  // As text, "10.00" sorts before "9.50".
  expect(shown(el)).toEqual(["mi-burger", "mi-lager"]);
  expect(shown(el).map((key) => override(el, key).placeholder)).toEqual(["9.50", "10.00"]);
});

it("sorts by the price override, not by the product's own price", async () => {
  // The product prices order the two rows one way and the menu's prices the other, so a column
  // sorting by the product price fails.
  const el = await mount({
    rows: [
      {
        ...lager,
        override: "4.00",
        effectivePrice: "4.00",
        combined: combinedFixture("p-lager", "4.00", [], "4.00", "10.00"),
      },
      {
        ...burger,
        override: "9.00",
        effectivePrice: "9.00",
        combined: combinedFixture("p-burger", "9.00", [], "9.00", "5.00"),
      },
    ],
  });
  await sortBy(el, "override");
  expect(shown(el)).toEqual(["mi-lager", "mi-burger"]);
  await sortBy(el, "override");
  expect(shown(el)).toEqual(["mi-burger", "mi-lager"]);
});

it("sorts by name and by where a product first appears", async () => {
  const el = await mount();
  await sortBy(el, "name");
  expect(shown(el)).toEqual(["mi-burger", "mi-lager", "mi-lemonade"]);
  await sortBy(el, "placements");
  expect(shown(el)).toEqual(["mi-lager", "mi-lemonade", "mi-burger"]);
});

it.each(["en-GB", "es-ES"])("draws no count of its prices above the table (%s)", async (locale) => {
  setLocale(locale);
  try {
    // Lemonade sets a price of this menu's own, which the count would have counted.
    const el = await mount();
    expect(el.shadowRoot!.querySelector('[data-test="price-summary"]')).toBeNull();
    const shownText = (el.shadowRoot!.textContent ?? "").toLowerCase();
    expect(shownText).not.toContain("sets its own price for");
    expect(shownText).not.toContain("fija su propio precio para");
    expect(el.shadowRoot!.firstElementChild!.localName).toBe("wt-data-table");
  } finally {
    setLocale("es-ES");
  }
});

it("lines the price override column's heading and cells up at the start", async () => {
  const el = await mount();
  const index = headers(el).indexOf("override");
  const heading = table(el).shadowRoot.querySelectorAll("thead th")[index]!;
  const cells = [...table(el).shadowRoot.querySelectorAll("tbody tr")].map(
    (tr) => tr.children[index]!,
  );
  expect(cells).toHaveLength(3);
  for (const node of [heading, ...cells]) {
    expect(node.getAttribute("data-align")).toBe("start");
    expect(getComputedStyle(node).textAlign).toBe("start");
  }
});

it("passes the loading, failed and empty states to the table", async () => {
  const el = await mount({ loading: true });
  expect(text(table(el).shadowRoot.querySelector("[role=status]"))).toBe(t("menu_prices.loading"));
  el.loading = false;
  el.failed = true;
  await el.updateComplete;
  await table(el).updateComplete;
  expect(text(table(el).shadowRoot.querySelector("[role=alert]"))).toBe(t("menu_prices.error"));
  el.failed = false;
  el.rows = [];
  await el.updateComplete;
  await table(el).updateComplete;
  expect(text(table(el).shadowRoot.querySelector("[role=status]"))).toBe(t("menu_prices.empty"));
});

it.each(["es-ES", "en"])(
  "says the dashboard's one no-matches sentence when a search hides every product (%s)",
  async (locale) => {
    setLocale(locale);
    try {
      const el = await mount();
      const box = table(el).shadowRoot.querySelector<HTMLInputElement>(".table-search")!;
      box.value = "zzz-nothing";
      box.dispatchEvent(new Event("input"));
      await table(el).updateComplete;
      expect(shown(el)).toEqual([]);
      expect(text(table(el).shadowRoot.querySelector(".empty .message"))).toBe(
        tableNoMatches(locale),
      );
    } finally {
      setLocale("es-ES");
    }
  },
);

it("edits each row's price in its own field, a size following the price typed for its product, and each Enter sends that field alone", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  const keys = ["mi-lemonade", "mi-lemonade:v-small", "mi-lemonade:v-large"];
  expect(keys.map((key) => override(el, key).value)).toEqual(["2.50", "", "3.75"]);
  expect(keys.map((key) => override(el, key).placeholder)).toEqual(["3.00 – 3.75", "2.50", "3.40"]);
  // Each price falls back to another when left empty, so none is required or marked as required.
  for (const key of keys) {
    expect(override(el, key).required, key).toBe(false);
    expect(override(el, key).shadowRoot!.querySelector("[data-required]"), key).toBeNull();
  }
  const heard = priceSaves(el);
  await typeIn(el, "mi-lemonade", "2.80");
  expect(override(el, "mi-lemonade:v-small").placeholder).toBe("2.80");
  await press(el, "mi-lemonade", "Enter");
  await typeIn(el, "mi-lemonade:v-small", " 1.90 ");
  await press(el, "mi-lemonade:v-small", "Enter");
  await typeIn(el, "mi-lemonade:v-large", "");
  await press(el, "mi-lemonade:v-large", "Enter");
  expect(heard.mock.calls).toEqual([
    [
      {
        key: "mi-lemonade",
        menuItemId: "mi-lemonade",
        variantId: null,
        name: "Lemonade",
        price: "2.80",
        previous: "2.50",
      },
    ],
    [
      {
        key: "mi-lemonade:v-small",
        menuItemId: "mi-lemonade",
        variantId: "v-small",
        name: "Lemonade — Small",
        price: "1.90",
        previous: null,
      },
    ],
    [
      {
        key: "mi-lemonade:v-large",
        menuItemId: "mi-lemonade",
        variantId: "v-large",
        name: "Lemonade — Large",
        price: null,
        previous: "3.75",
      },
    ],
  ] satisfies [PriceSave][]);
});

it("shows the inherited price as a blank field's placeholder and in its hint, read before the euro sign, and Enter sends that field", async () => {
  const el = await mount();
  const input = override(el, "mi-burger");
  expect(input.value).toBe("");
  expect(input.placeholder).toBe("12.00");
  const help = input.shadowRoot!.querySelector<HTMLElement>("[data-hint]")!;
  expect(text(help)).toBe(t("menu_prices.override_help").replace("{price}", eur("12.00")));
  // Read first, then the euro sign the field draws.
  const sign = input.shadowRoot!.querySelector<HTMLElement>('[part~="currency"]')!;
  expect(input.shadowRoot!.querySelector("input")!.getAttribute("aria-describedby")).toBe(
    `${help.id} ${sign.id}`,
  );
  const heard = priceSaves(el);
  await typeIn(el, "mi-burger", "11.00");
  await press(el, "mi-burger", "Enter");
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    key: "mi-burger",
    menuItemId: "mi-burger",
    variantId: null,
    name: "Burger",
    price: "11.00",
    previous: null,
  });
});

it("sends nothing for Enter on a field nobody changed, reading an emptied field as no price of the menu's own", async () => {
  const el = await mount();
  const heard = priceSaves(el);
  await press(el, "mi-burger", "Enter");
  await leave(el, "mi-burger");
  await typeIn(el, "mi-burger", "  ");
  await press(el, "mi-burger", "Enter");
  await leave(el, "mi-burger");
  expect(heard).not.toHaveBeenCalled();
});

it("compares by amount, so 2.5 typed over 2.50 sends nothing, and keeps each size's typed text on that size when the sizes are read back in another order", async () => {
  const reversed = { ...lemonade, variants: [...lemonade.variants].reverse() };
  const el = await mount({ rows: [burger, reversed, lager] });
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  const heard = priceSaves(el);
  await typeIn(el, "mi-lemonade", "2.5");
  await press(el, "mi-lemonade", "Enter");
  expect(heard).not.toHaveBeenCalled();
  await typeIn(el, "mi-lemonade:v-large", "4.00");
  el.rows = [burger, lemonade, lager];
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-lemonade:v-small").value).toBe("");
  expect(override(el, "mi-lemonade:v-large").value).toBe("4.00");
});

it("sends only the field committed, with the price stored when it was sent, whatever else was read in meanwhile", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  await typeIn(el, "mi-lemonade", "2.70");
  el.rows = [
    burger,
    {
      ...lemonade,
      override: "2.60",
      variants: [
        { variantId: "v-small", price: "1.00", active: true, available: true },
        { variantId: "v-large", price: "3.75", active: true, available: true },
      ],
    },
    lager,
  ];
  await el.updateComplete;
  await table(el).updateComplete;
  const heard = priceSaves(el);
  await press(el, "mi-lemonade", "Enter");
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    key: "mi-lemonade",
    menuItemId: "mi-lemonade",
    variantId: null,
    name: "Lemonade",
    price: "2.70",
    previous: "2.60",
  });
  expect(override(el, "mi-lemonade:v-small").value).toBe("1.00");
});

it("sends the product's field alone when only its price changed on a product with sizes", async () => {
  const el = await mount();
  const heard = priceSaves(el);
  await typeIn(el, "mi-lemonade", "2.60");
  await press(el, "mi-lemonade", "Enter");
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    key: "mi-lemonade",
    menuItemId: "mi-lemonade",
    variantId: null,
    name: "Lemonade",
    price: "2.60",
    previous: "2.50",
  });
});

it("sends a size's field alone when only that size's price changed", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  const heard = priceSaves(el);
  await typeIn(el, "mi-lemonade:v-small", "1.20");
  await press(el, "mi-lemonade:v-small", "Enter");
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    key: "mi-lemonade:v-small",
    menuItemId: "mi-lemonade",
    variantId: "v-small",
    name: "Lemonade — Small",
    price: "1.20",
    previous: null,
  });
});

it("emptying a field and pressing Enter clears the menu's price, with no button for it", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  await typeIn(el, "mi-lemonade", "");
  expect(override(el, "mi-lemonade").value).toBe("");
  // Emptied, the product's field inherits again, and the small follows that.
  expect(override(el, "mi-lemonade:v-small").placeholder).toBe("3.00");
  expect(table(el).shadowRoot.querySelector('[data-test="use-product-price"]')).toBeNull();
  const heard = priceSaves(el);
  await press(el, "mi-lemonade", "Enter");
  expect(heard).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ key: "mi-lemonade", price: null, previous: "2.50" }),
  );
});

it.each(["-1", "2.555", "abc", "007"])(
  "refuses the price %s beside the field, sending nothing and keeping the text, until it is fixed",
  async (price) => {
    const el = await mount();
    toggleOf(el, "mi-lemonade")!.click();
    await table(el).updateComplete;
    await typeIn(el, "mi-lemonade", price);
    // An unreadable product price is no draft, so the small keeps the saved price as its hint.
    expect(override(el, "mi-lemonade:v-small").placeholder).toBe("2.50");
    const heard = priceSaves(el);
    await press(el, "mi-lemonade", "Enter");
    await leave(el, "mi-lemonade");
    expect(heard).not.toHaveBeenCalled();
    expect(override(el, "mi-lemonade").error).toBe(t("editor.price_invalid"));
    expect(override(el, "mi-lemonade").value).toBe(price);
    // A field of its own, so there is no form with a message at its bottom.
    expect(el.shadowRoot!.querySelector("wt-form-actions")).toBeNull();
    await typeIn(el, "mi-lemonade", "2.00");
    expect(override(el, "mi-lemonade").error).toBe("");
  },
);

it("refuses a size's malformed price beside that size's field alone", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  await typeIn(el, "mi-lemonade:v-large", "-3");
  const heard = priceSaves(el);
  await press(el, "mi-lemonade:v-large", "Enter");
  expect(heard).not.toHaveBeenCalled();
  expect(override(el, "mi-lemonade:v-large").error).toBe(t("editor.price_invalid"));
  expect(override(el, "mi-lemonade:v-small").error).toBe("");
  expect(override(el, "mi-lemonade").error).toBe("");
});

it("shows a refusal the host passes for a field under that field, which stays editable", async () => {
  const el = await mount();
  el.refusals = { "mi-lemonade": "Refused here" };
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-lemonade").error).toBe("Refused here");
  expect(override(el, "mi-lemonade").disabled).toBe(false);
  expect(override(el, "mi-lemonade").value).toBe("2.50");
});

it.each(["mi-burger", "mi-lemonade", "mi-lemonade:v-small", "mi-lemonade:v-large", "mi-lager"])(
  "shows a refusal passed for %s under that field and no other",
  async (refused) => {
    const el = await mount();
    toggleOf(el, "mi-lemonade")!.click();
    await table(el).updateComplete;
    el.refusals = { [refused]: "Refused" };
    await el.updateComplete;
    await table(el).updateComplete;
    const keys = [
      "mi-burger",
      "mi-lemonade",
      "mi-lemonade:v-small",
      "mi-lemonade:v-large",
      "mi-lager",
    ];
    expect(keys.map((key) => override(el, key).error)).toEqual(
      keys.map((key) => (key === refused ? "Refused" : "")),
    );
  },
);

it("says nothing about errors while a price is typed, before Enter or leaving the field", async () => {
  const el = await mount();
  const heard = priceSaves(el);
  await typeIn(el, "mi-lemonade", "abc");
  expect(override(el, "mi-lemonade").error).toBe("");
  expect(heard).not.toHaveBeenCalled();
});

it("keeps focus in a field whose Enter fails its check, with no Save button to disable", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  const input = override(el, "mi-lemonade:v-large");
  input.focus();
  await typeIn(el, "mi-lemonade:v-large", "-3");
  await press(el, "mi-lemonade:v-large", "Enter");
  await new Promise((resolve) => setTimeout(resolve));
  expect(input.error).toBe(t("editor.price_invalid"));
  expect(input.shadowRoot!.activeElement).toBe(input.shadowRoot!.querySelector("input"));
  expect(el.shadowRoot!.querySelector('[data-test="offer-save"]')).toBeNull();
  expect(table(el).shadowRoot.querySelector('[data-test="offer-save"]')).toBeNull();
});

it("re-checks every change after a failed Enter: the error goes when the price is fixed and comes back when it is broken again", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  await typeIn(el, "mi-lemonade", "-1");
  await press(el, "mi-lemonade", "Enter");
  expect(override(el, "mi-lemonade").error).toBe(t("editor.price_invalid"));
  await typeIn(el, "mi-lemonade", "2.00");
  expect(override(el, "mi-lemonade").error).toBe("");
  await typeIn(el, "mi-lemonade", "x");
  expect(override(el, "mi-lemonade").error).toBe(t("editor.price_invalid"));
  await typeIn(el, "mi-lemonade", "");
  expect(override(el, "mi-lemonade").error).toBe("");
  // Another field is not checked before its own Enter.
  await typeIn(el, "mi-lemonade:v-small", "x");
  expect(override(el, "mi-lemonade:v-small").error).toBe("");
});

it("hides a refusal once its field changes, and keeps it while another field changes", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  el.refusals = { "mi-lemonade": "Refused here" };
  await el.updateComplete;
  await typeIn(el, "mi-lemonade:v-small", "1.00");
  expect(override(el, "mi-lemonade").error).toBe("Refused here");
  await typeIn(el, "mi-lemonade", "2.70");
  expect(override(el, "mi-lemonade").error).toBe("");
});

it("shows a hidden field's refusal again only when the host refuses that field anew", async () => {
  const el = await mount();
  el.refusals = { "mi-lemonade": "Refused here" };
  await el.updateComplete;
  await typeIn(el, "mi-lemonade", "2.70");
  expect(override(el, "mi-lemonade").error).toBe("");
  // Another field's refusal arriving leaves this one hidden.
  el.refusals = { "mi-lemonade": "Refused here", "mi-burger": "Refused there" };
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-lemonade").error).toBe("");
  expect(override(el, "mi-burger").error).toBe("Refused there");
  el.refusals = { "mi-lemonade": "Refused again", "mi-burger": "Refused there" };
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-lemonade").error).toBe("Refused again");
});

it("moves focus to a size's field when a refusal naming it arrives, from another row's field", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  override(el, "mi-burger").focus();
  el.refusals = { "mi-lemonade:v-small": "Refused here" };
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve));
  const refused = override(el, "mi-lemonade:v-small");
  expect(refused.shadowRoot!.activeElement).toBe(refused.shadowRoot!.querySelector("input"));
});

it("opens a collapsed product to show and focus its size's field when a refusal naming that size arrives, which the outcome message also says", async () => {
  setLocale("en-GB");
  try {
    const el = await mount();
    toggleOf(el, "mi-lemonade")!.click();
    await table(el).updateComplete;
    await typeIn(el, "mi-lemonade:v-small", "1.90");
    await press(el, "mi-lemonade:v-small", "Enter");
    el.saving = new Set(["mi-lemonade:v-small"]);
    await el.updateComplete;
    toggleOf(el, "mi-lemonade")!.click();
    await table(el).updateComplete;
    expect(row(el, "mi-lemonade:v-small")).toBeNull();
    override(el, "mi-lager").focus();
    const save = {
      key: "mi-lemonade:v-small",
      menuItemId: "mi-lemonade",
      variantId: "v-small",
      name: "Lemonade — Small",
      price: "1.90",
      previous: null,
    };
    el.saving = new Set();
    el.refusals = { "mi-lemonade:v-small": "Refused here" };
    el.outcome = { kind: "refused", save, reason: "Refused here" };
    await el.updateComplete;
    await vi.waitFor(() => expect(row(el, "mi-lemonade:v-small")).not.toBeNull());
    const refused = override(el, "mi-lemonade:v-small");
    await vi.waitFor(() =>
      expect(refused.shadowRoot!.activeElement).toBe(refused.shadowRoot!.querySelector("input")),
    );
    expect([refused.value, refused.error]).toEqual(["1.90", "Refused here"]);
    expect([outcomeToast(el).open, outcomeToast(el).message]).toEqual([
      true,
      "Your change to Lemonade — Small was not saved. Refused here",
    ]);
  } finally {
    setLocale("es-ES");
  }
});

it("starts again on Escape: no check message, and the stored price back in the field", async () => {
  const el = await mount();
  await typeIn(el, "mi-lemonade", "-1");
  await press(el, "mi-lemonade", "Enter");
  expect(override(el, "mi-lemonade").error).toBe(t("editor.price_invalid"));
  await press(el, "mi-lemonade", "Escape");
  expect(override(el, "mi-lemonade").error).toBe("");
  expect(override(el, "mi-lemonade").value).toBe("2.50");
  // Checked again only after the next Enter.
  await typeIn(el, "mi-lemonade", "x");
  expect(override(el, "mi-lemonade").error).toBe("");
});

it("keeps what was typed when the rows are read again", async () => {
  const el = await mount();
  await typeIn(el, "mi-lemonade", "2.90");
  el.rows = [burger, { ...lemonade, override: "2.60" }, lager];
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-lemonade").value).toBe("2.90");
});

it("shows a stored price read again while the field holds nothing typed", async () => {
  const el = await mount();
  await typeIn(el, "mi-lemonade", "2.90");
  await press(el, "mi-lemonade", "Escape");
  el.rows = [burger, { ...lemonade, override: "2.60" }, lager];
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-lemonade").value).toBe("2.60");
});

it("names a size the product list does not hold as missing, in its row and its field's label", async () => {
  const el = await mount({ products: [] });
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  expect(visibleText(cell(el, "name", "mi-lemonade:v-large"))).toBe(t("members.missing"));
  expect(override(el, "mi-lemonade:v-large").label).toBe(
    t("menu_prices.override_label_set").replace("{name}", `Lemonade — ${t("members.missing")}`),
  );
  expect(override(el, "mi-lemonade:v-large").placeholder).toBe("3.40");
});

it("keeps the sent text on Escape while that field's save is out, and sends nothing more on leaving", async () => {
  const el = await mount();
  const heard = priceSaves(el);
  await typeIn(el, "mi-burger", "11.00");
  await press(el, "mi-burger", "Enter");
  el.saving = new Set(["mi-burger"]);
  await el.updateComplete;
  await typeIn(el, "mi-burger", "11.50");
  await press(el, "mi-burger", "Escape");
  expect(override(el, "mi-burger").value).toBe("11.00");
  await leave(el, "mi-burger");
  expect(heard).toHaveBeenCalledOnce();
});

it("saves a field on Enter typed from the keyboard", async () => {
  const el = await mount();
  const heard = priceSaves(el);
  const input = override(el, "mi-burger").shadowRoot!.querySelector("input")!;
  await userEvent.fill(input, "11.00");
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(heard).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ key: "mi-burger", price: "11.00" }),
  );
});

it("sends one save for Enter followed by leaving the field", async () => {
  const el = await mount();
  const heard = priceSaves(el);
  await typeIn(el, "mi-burger", "11.00");
  await press(el, "mi-burger", "Enter");
  el.saving = new Set(["mi-burger"]);
  await el.updateComplete;
  await leave(el, "mi-burger");
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    key: "mi-burger",
    menuItemId: "mi-burger",
    variantId: null,
    name: "Burger",
    price: "11.00",
    previous: null,
  });
});

it("refuses a decimal comma beside the field and sends nothing", async () => {
  const el = await mount();
  const heard = priceSaves(el);
  await typeIn(el, "mi-burger", "2,50");
  await press(el, "mi-burger", "Enter");
  expect(heard).not.toHaveBeenCalled();
  expect(override(el, "mi-burger").error).toBe(t("editor.price_invalid"));
  expect(override(el, "mi-burger").value).toBe("2,50");
});

it("keeps the sent price in the field while its save is out, whatever a re-read says, and lets it go once saved", async () => {
  const el = await mount();
  await typeIn(el, "mi-burger", "11.00");
  await press(el, "mi-burger", "Enter");
  el.saving = new Set(["mi-burger"]);
  el.rows = [burger, lemonade, lager]; // a live re-read from before the write landed
  await el.updateComplete;
  expect(override(el, "mi-burger").value).toBe("11.00");
  el.rows = [{ ...burger, override: "11.00" }, lemonade, lager];
  el.saving = new Set();
  await el.updateComplete;
  expect(override(el, "mi-burger").value).toBe("11.00");
  el.rows = [{ ...burger, override: "10.00" }, lemonade, lager]; // a later change from elsewhere
  await el.updateComplete;
  expect(override(el, "mi-burger").value).toBe("10.00");
});

it("redraws the table for a keystroke only when it changes what the table shows", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  const burger = override(el, "mi-burger").shadowRoot!.querySelector("input")!;
  const lemonade = override(el, "mi-lemonade").shadowRoot!.querySelector("input")!;
  await userEvent.fill(burger, "11");
  await userEvent.fill(lemonade, "3.10");
  await el.updateComplete;
  await table(el).updateComplete;
  const draws = vi.spyOn(table(el) as unknown as { render(): unknown }, "render");
  await userEvent.type(burger, "5");
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-burger").value).toBe("115");
  expect(draws).not.toHaveBeenCalled();
  // A size following its product shows the product's typed price.
  await userEvent.fill(lemonade, "3.20");
  await el.updateComplete;
  await table(el).updateComplete;
  expect(draws).toHaveBeenCalled();
  expect(override(el, "mi-lemonade:v-small").placeholder).toBe("3.20");
});

it("puts the stored price back on Escape after typing that redrew nothing", async () => {
  const el = await mount({ rows: [{ ...burger, override: "10.00" }, lemonade, lager] });
  const input = override(el, "mi-burger").shadowRoot!.querySelector("input")!;
  for (const round of ["first", "second"]) {
    await userEvent.type(input, "{Backspace}");
    await el.updateComplete;
    expect(override(el, "mi-burger").value, round).toBe("10.0");
    await press(el, "mi-burger", "Escape");
    await table(el).updateComplete;
    expect(override(el, "mi-burger").value, round).toBe("10.00");
  }
});

it("saves a size's field alone, and a size following its product hints the product's typed price", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  await typeIn(el, "mi-lemonade", "2.80");
  expect(override(el, "mi-lemonade:v-small").placeholder).toBe("2.80");
  await typeIn(el, "mi-lemonade", "");
  expect(override(el, "mi-lemonade:v-small").placeholder).toBe("3.00");
  const heard = priceSaves(el);
  await typeIn(el, "mi-lemonade:v-small", "1.90");
  await press(el, "mi-lemonade:v-small", "Enter");
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    key: "mi-lemonade:v-small",
    menuItemId: "mi-lemonade",
    variantId: "v-small",
    name: "Lemonade — Small",
    price: "1.90",
    previous: null,
  });
});

it("shows the price typed for a product as a following size's placeholder, and the inherited one once emptied", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  await typeIn(el, "mi-lemonade", "2.80");
  expect(override(el, "mi-lemonade:v-small").placeholder).toBe("2.80");
  await typeIn(el, "mi-lemonade", "");
  expect(override(el, "mi-lemonade:v-small").placeholder).toBe("3.00");
});

it("puts a refusal under the field whose save it answers, and nowhere else, and moves focus to it", async () => {
  const el = await mount();
  const other = override(el, "mi-lager");
  other.focus();
  el.refusals = { "mi-burger": "Refused here" };
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve));
  const refused = override(el, "mi-burger");
  expect(refused.error).toBe("Refused here");
  expect(other.error).toBe("");
  expect(refused.shadowRoot!.activeElement).toBe(refused.shadowRoot!.querySelector("input"));
});

it("says a refusal in the outcome message, and moves no focus for one that names no field", async () => {
  setLocale("en-GB");
  try {
    const el = await mount();
    const other = override(el, "mi-lager");
    other.focus();
    const save = {
      key: "mi-burger",
      menuItemId: "mi-burger",
      variantId: null,
      name: "Burger",
      price: "11.00",
      previous: null,
    };
    el.outcome = { kind: "refused", save, reason: "The server could not be reached." };
    await el.updateComplete;
    const toast = outcomeToast(el);
    expect(toast.open).toBe(true);
    expect(text(toast.shadowRoot!.querySelector('[role="status"] .message'))).toBe(
      "Your change to Burger was not saved. The server could not be reached.",
    );
    expect(el.shadowRoot!.querySelector('[data-test="price-undo"]')).toBeNull();
    expect(override(el, "mi-burger").error).toBe("");
    expect(other.matches(":focus-within")).toBe(true);
  } finally {
    setLocale("es-ES");
  }
});

const burgerSaved: PriceSave = {
  key: "mi-burger",
  menuItemId: "mi-burger",
  variantId: null,
  name: "Burger",
  price: "11.00",
  previous: null,
};

function outcomeToast(el: MenuPricesTable): WtToast {
  return el.shadowRoot!.querySelector<WtToast>('[data-test="price-outcome"]')!;
}

function undoButton(el: MenuPricesTable): HTMLElement | null {
  return el.shadowRoot!.querySelector<HTMLElement>('[data-test="price-undo"]');
}

// Spanish writes a no-break space (U+00A0) before the sign; `text` folds it to a space.
it.each([
  {
    locale: "en-GB",
    saved: "Saved Burger's price override: €11.00.",
    cleared: "Burger now uses the inherited price.",
    undo: "Undo",
  },
  {
    locale: "es-ES",
    saved: "Guardado el precio propio de Burger: 11,00 €.",
    cleared: "Burger usa ahora el precio heredado.",
    undo: "Deshacer",
  },
])(
  "says in $locale what a successful save did, with an Undo inside the outcome message",
  async (want) => {
    setLocale(want.locale);
    try {
      const el = await mount();
      el.outcome = { kind: "saved", save: burgerSaved };
      await el.updateComplete;
      const toast = outcomeToast(el);
      expect(text(toast.shadowRoot!.querySelector('[role="status"] .message'))).toBe(want.saved);
      const undo = undoButton(el)!;
      expect(text(undo)).toBe(want.undo);
      expect(undo.parentElement).toBe(toast);
      expect(undo.slot).toBe("action");
      el.outcome = { kind: "saved", save: { ...burgerSaved, price: null, previous: "11.00" } };
      await el.updateComplete;
      expect(text(toast.shadowRoot!.querySelector('[role="status"] .message'))).toBe(want.cleared);
      expect(undoButton(el)).not.toBeNull();
    } finally {
      setLocale("es-ES");
    }
  },
);

it("sends Undo as the save with its price and previous swapped, its click stopped at the widget", async () => {
  const el = await mount({ rows: [{ ...burger, override: "11.00" }, lemonade, lager] });
  const heard = priceSaves(el);
  const clicks: Event[] = [];
  el.parentElement!.addEventListener("click", (event) => clicks.push(event));
  el.outcome = { kind: "saved", save: burgerSaved };
  await el.updateComplete;
  undoButton(el)!.click();
  await el.updateComplete;
  await table(el).updateComplete;
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    ...burgerSaved,
    price: null,
    previous: "11.00",
    undo: true,
  });
  expect(clicks).toEqual([]);
  // The field shows what the Undo sends while it is out, not the price it replaces.
  expect(override(el, "mi-burger").value).toBe("");
});

it("asks the host to clear the outcome once its message is closed, the toast's own close stopped at the widget", async () => {
  const el = await mount();
  const asked = vi.fn();
  el.addEventListener("wt-price-outcome-close", asked);
  const closes: Event[] = [];
  el.parentElement!.addEventListener("wt-close", (event) => closes.push(event));
  el.outcome = { kind: "refused", save: burgerSaved, reason: "No connection" };
  await el.updateComplete;
  outcomeToast(el).shadowRoot!.querySelector<HTMLButtonElement>("button.close")!.click();
  expect(asked).toHaveBeenCalledOnce();
  expect(closes).toEqual([]);
});

it("undoes on a click while another field holds a price typed and not yet saved, leaving that price typed and unsent", async () => {
  const el = await mount({ rows: [{ ...burger, override: "11.00" }, lemonade, lager] });
  const heard = priceSaves(el);
  el.outcome = { kind: "saved", save: burgerSaved };
  await el.updateComplete;
  const typed = override(el, "mi-lager").shadowRoot!.querySelector("input")!;
  await userEvent.fill(typed, "5.00");
  await userEvent.click(undoButton(el)!);
  await el.updateComplete;
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    ...burgerSaved,
    price: null,
    previous: "11.00",
    undo: true,
  });
  expect(override(el, "mi-lager").value).toBe("5.00");
});

it("draws no Undo for the saved outcome of an Undo", async () => {
  setLocale("en-GB");
  try {
    const el = await mount();
    el.outcome = { kind: "saved", save: { ...burgerSaved, undo: true } };
    await el.updateComplete;
    expect([outcomeToast(el).open, outcomeToast(el).message]).toEqual([
      true,
      "Saved Burger's price override: €11.00.",
    ]);
    expect(undoButton(el)).toBeNull();
  } finally {
    setLocale("es-ES");
  }
});

describe("the floating outcome message", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Only these two, so the frames Lit awaits still run. */
  const fakeTimeouts = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  it("says a save in an open info toast holding its Undo, and closes it after 5 s", async () => {
    setLocale("en-GB");
    try {
      const el = await mount();
      fakeTimeouts();
      el.outcome = { kind: "saved", save: burgerSaved };
      await el.updateComplete;
      const toast = outcomeToast(el);
      expect(toast.localName).toBe("wt-toast");
      expect([toast.open, toast.tone, toast.message]).toEqual([
        true,
        "info",
        "Saved Burger's price override: €11.00.",
      ]);
      const undo = undoButton(el)!;
      expect(undo.parentElement).toBe(toast);
      expect(undo.slot).toBe("action");
      expect(undo.getBoundingClientRect().height).toBeGreaterThan(0);
      vi.advanceTimersByTime(4999);
      expect(toast.open).toBe(true);
      vi.advanceTimersByTime(1);
      expect(toast.open).toBe(false);
    } finally {
      setLocale("es-ES");
    }
  });

  it("stays while the pointer is over it, and closes 5 s after the pointer leaves", async () => {
    await commands.parkPointer();
    const el = await mount();
    fakeTimeouts();
    el.outcome = { kind: "saved", save: burgerSaved };
    await el.updateComplete;
    const toast = outcomeToast(el);
    await userEvent.hover(undoButton(el)!);
    vi.advanceTimersByTime(60_000);
    expect(toast.open).toBe(true);
    // userEvent.unhover() hovers the middle of <body>, which can land on the toast itself.
    await commands.parkPointer();
    vi.advanceTimersByTime(4999);
    expect(toast.open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(toast.open).toBe(false);
  });

  it("stays while focus is on its Undo, and closes 5 s after focus leaves", async () => {
    const el = await mount();
    fakeTimeouts();
    el.outcome = { kind: "saved", save: burgerSaved };
    await el.updateComplete;
    const toast = outcomeToast(el);
    undoButton(el)!.focus();
    expect(toast.matches(":focus-within")).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(toast.open).toBe(true);
    override(el, "mi-lager").focus();
    vi.advanceTimersByTime(4999);
    expect(toast.open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(toast.open).toBe(false);
  });

  it("says a refusal in an open info toast with no Undo that never closes itself", async () => {
    setLocale("en-GB");
    try {
      const el = await mount();
      fakeTimeouts();
      el.outcome = { kind: "refused", save: burgerSaved, reason: "Refused here" };
      await el.updateComplete;
      const toast = outcomeToast(el);
      expect([toast.open, toast.tone, toast.message]).toEqual([
        true,
        "info",
        "Your change to Burger was not saved. Refused here",
      ]);
      expect(undoButton(el)).toBeNull();
      vi.advanceTimersByTime(60_000);
      expect(toast.open).toBe(true);
    } finally {
      setLocale("es-ES");
    }
  });

  it("replaces one outcome with the next and gives the new one its full 5 s, even when it reads the same", async () => {
    setLocale("en-GB");
    try {
      const el = await mount();
      fakeTimeouts();
      el.outcome = { kind: "saved", save: burgerSaved };
      await el.updateComplete;
      const toast = outcomeToast(el);
      vi.advanceTimersByTime(4000);
      el.outcome = { kind: "saved", save: { ...burgerSaved } };
      await el.updateComplete;
      vi.advanceTimersByTime(4000);
      expect(toast.open).toBe(true);
      el.outcome = { kind: "saved", save: { ...burgerSaved, price: "12.00" } };
      await el.updateComplete;
      expect(toast.message).toBe("Saved Burger's price override: €12.00.");
      vi.advanceTimersByTime(4999);
      expect(toast.open).toBe(true);
      vi.advanceTimersByTime(1);
      expect(toast.open).toBe(false);
      el.outcome = { kind: "saved", save: { ...burgerSaved } };
      await el.updateComplete;
      expect(toast.open).toBe(true);
    } finally {
      setLocale("es-ES");
    }
  });

  it("closes the toast once there is no outcome", async () => {
    const el = await mount();
    el.outcome = { kind: "saved", save: burgerSaved };
    await el.updateComplete;
    expect(outcomeToast(el).open).toBe(true);
    el.outcome = null;
    await el.updateComplete;
    expect(outcomeToast(el).open).toBe(false);
    expect(undoButton(el)).toBeNull();
  });

  it("floats at the viewport's bottom end, and spans the width at phone width", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    try {
      await page.viewport(1280, 800);
      const el = await mount();
      el.outcome = { kind: "saved", save: burgerSaved };
      await el.updateComplete;
      const toast = outcomeToast(el);
      const probe = document.createElement("div");
      probe.style.inlineSize = "var(--wt-space-3)";
      probe.style.blockSize = "var(--wt-space-2)";
      el.parentElement!.append(probe);
      const { width: space3, height: space2 } = probe.getBoundingClientRect();
      const style = getComputedStyle(toast);
      expect(style.position).toBe("fixed");
      expect(Number(style.zIndex)).toBeGreaterThanOrEqual(4);
      const wide = toast.getBoundingClientRect();
      expect(wide.bottom).toBeCloseTo(window.innerHeight - space3, 0);
      expect(wide.right).toBeCloseTo(window.innerWidth - space3, 0);
      expect(wide.left).toBeGreaterThan(window.innerWidth / 2);
      await page.viewport(390, 800);
      await vi.waitFor(() => expect(window.innerWidth).toBe(390));
      const narrow = toast.getBoundingClientRect();
      expect([narrow.left, narrow.right]).toEqual([space2, 390 - space2]);
    } finally {
      await page.viewport(width, height);
    }
  });
});

it("carries as a save's previous price the one sent before it while that save is still out", async () => {
  const el = await mount();
  const heard = priceSaves(el);
  await typeIn(el, "mi-burger", "11.00");
  await press(el, "mi-burger", "Enter");
  el.saving = new Set(["mi-burger"]);
  await el.updateComplete;
  await typeIn(el, "mi-burger", "11.50");
  await press(el, "mi-burger", "Enter");
  expect(heard.mock.calls.map(([save]) => [save.price, save.previous])).toEqual([
    ["11.00", null],
    ["11.50", "11.00"],
  ]);
});

it("leaves a field the outcome message says was saved to the prices read after it", async () => {
  const el = await mount();
  const heard = priceSaves(el);
  await typeIn(el, "mi-burger", "11.00");
  await press(el, "mi-burger", "Enter");
  el.saving = new Set(["mi-burger"]);
  await el.updateComplete;
  el.saving = new Set();
  el.outcome = { kind: "saved", save: heard.mock.calls[0]![0] };
  el.rows = [{ ...burger, override: "10.00" }, lemonade, lager];
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-burger").value).toBe("10.00");
});

it("puts a refused price back to the stored one once the outcome message says another save was saved", async () => {
  const el = await mount();
  const heard = priceSaves(el);
  await typeIn(el, "mi-burger", "11.00");
  await press(el, "mi-burger", "Enter");
  const save = heard.mock.calls[0]![0];
  el.saving = new Set(["mi-burger"]);
  await el.updateComplete;
  el.saving = new Set();
  el.outcome = { kind: "refused", save, reason: "The server could not be reached." };
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-burger").value).toBe("11.00");
  el.outcome = {
    kind: "saved",
    save: { ...burgerSaved, key: "mi-lager", menuItemId: "mi-lager", name: "Lager" },
  };
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-burger").value).toBe("");
});

it("keeps a closed outcome message after the table, drawing nothing, floating over the page", async () => {
  const el = await mount();
  const toast = outcomeToast(el);
  expect([
    toast.open,
    toast.message,
    text(toast.shadowRoot!.querySelector('[role="status"]')),
  ]).toEqual([false, "", ""]);
  expect(toast.getBoundingClientRect().height).toBe(0);
  expect(table(el).compareDocumentPosition(toast) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(getComputedStyle(toast).position).toBe("fixed");
});

it("does not resend a refused price on leaving the field unchanged, and resends it on Enter", async () => {
  const el = await mount();
  const heard = priceSaves(el);
  await typeIn(el, "mi-burger", "11.00");
  await press(el, "mi-burger", "Enter");
  el.saving = new Set(["mi-burger"]);
  await el.updateComplete;
  el.saving = new Set();
  el.refusals = { "mi-burger": "Refused here" };
  await el.updateComplete;
  await leave(el, "mi-burger");
  expect(heard).toHaveBeenCalledOnce();
  await press(el, "mi-burger", "Enter");
  expect(heard).toHaveBeenCalledTimes(2);
  await typeIn(el, "mi-burger", "11.50");
  await leave(el, "mi-burger");
  expect(heard).toHaveBeenCalledTimes(3);
});

it("keeps the sent price after a refusal that names no field, and does not resend it on leaving the field unchanged", async () => {
  const el = await mount();
  const heard = priceSaves(el);
  await typeIn(el, "mi-burger", "11.00");
  await press(el, "mi-burger", "Enter");
  const save = heard.mock.calls[0]![0];
  el.saving = new Set(["mi-burger"]);
  await el.updateComplete;
  el.saving = new Set();
  el.outcome = { kind: "refused", save, reason: "The server could not be reached." };
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-burger").value).toBe("11.00");
  expect(override(el, "mi-burger").error).toBe("");
  await leave(el, "mi-burger");
  expect(heard).toHaveBeenCalledOnce();
  await press(el, "mi-burger", "Enter");
  expect(heard).toHaveBeenCalledTimes(2);
});

it("puts the stored price back once nothing says its sent price was refused under the field, and leaving it then sends nothing", async () => {
  const el = await mount();
  const heard = priceSaves(el);
  await typeIn(el, "mi-burger", "11.00");
  await press(el, "mi-burger", "Enter");
  el.saving = new Set(["mi-burger"]);
  await el.updateComplete;
  el.saving = new Set();
  el.refusals = { "mi-burger": "Refused here" };
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-burger").value).toBe("11.00");
  el.refusals = {};
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-burger").value).toBe("");
  expect(override(el, "mi-burger").error).toBe("");
  await leave(el, "mi-burger");
  expect(heard).toHaveBeenCalledOnce();
});

it("puts the stored price back once the outcome message stops saying its sent price was refused", async () => {
  const el = await mount();
  const heard = priceSaves(el);
  await typeIn(el, "mi-lemonade", "2.90");
  await press(el, "mi-lemonade", "Enter");
  const save = heard.mock.calls[0]![0];
  el.saving = new Set(["mi-lemonade"]);
  await el.updateComplete;
  el.saving = new Set();
  el.outcome = { kind: "refused", save, reason: "The server could not be reached." };
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-lemonade").value).toBe("2.90");
  el.outcome = null;
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-lemonade").value).toBe("2.50");
  await leave(el, "mi-lemonade");
  expect(heard).toHaveBeenCalledOnce();
});

it("keeps a price changed since its refusal once nothing says it was refused", async () => {
  const el = await mount();
  await typeIn(el, "mi-burger", "11.00");
  await press(el, "mi-burger", "Enter");
  el.saving = new Set(["mi-burger"]);
  await el.updateComplete;
  el.saving = new Set();
  el.refusals = { "mi-burger": "Refused here" };
  await el.updateComplete;
  await typeIn(el, "mi-burger", "11.50");
  el.refusals = {};
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-burger").value).toBe("11.50");
});

it("treats an unfinished product price as no change for its sizes' hints", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  await typeIn(el, "mi-lemonade", "2.");
  expect(override(el, "mi-lemonade:v-small").placeholder).toBe("2.50");
});

it("restores the stored price on Escape, and sends nothing", async () => {
  const el = await mount();
  const heard = priceSaves(el);
  await typeIn(el, "mi-lemonade", "9.99");
  expect(override(el, "mi-lemonade").value).toBe("9.99");
  await press(el, "mi-lemonade", "Escape");
  expect(override(el, "mi-lemonade").value).toBe("2.50");
  await leave(el, "mi-lemonade");
  expect(heard).not.toHaveBeenCalled();
});

it("draws a product's name as plain text, with no window behind it", async () => {
  const el = await mount();
  expect(cell(el, "name", "mi-lemonade").querySelector("wt-button")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(visibleText(cell(el, "name", "mi-lemonade"))).toBe(
    `Lemonade ${t("menu_prices.has_variants")}`,
  );
});

it("keeps every field editable while a save is out, with nothing drawn beside the saving one", async () => {
  const el = await mount({ saving: new Set(["mi-burger"]) });
  expect(override(el, "mi-burger").disabled).toBe(false);
  expect(override(el, "mi-lager").disabled).toBe(false);
  expect(cell(el, "override", "mi-burger").querySelector("[part~=saving]")).toBeNull();
  expect(cell(el, "override", "mi-burger").querySelector("[part~=price-notes]")).toBeNull();
  expect(cell(el, "override", "mi-lager").querySelector("[part~=saving]")).toBeNull();
});

it("keeps a row's height while its save is out, drawing no saving note", async () => {
  const el = await mount();
  const height = () => row(el, "mi-burger")!.getBoundingClientRect().height;
  const drawn = () => {
    const shown = text(table(el).shadowRoot.querySelector("tbody"));
    expect(table(el).shadowRoot.querySelector("[part~=saving]")).toBeNull();
    expect(shown).not.toContain("Saving…");
    expect(shown).not.toContain("Guardando…");
  };
  const before = height();
  drawn();
  el.saving = new Set(["mi-burger"]);
  await el.updateComplete;
  await table(el).updateComplete;
  expect(height()).toBe(before);
  drawn();
  el.saving = new Set();
  await el.updateComplete;
  await table(el).updateComplete;
  expect(height()).toBe(before);
  drawn();
});

describe("variants", () => {
  // Within each product, its price, its variants' own prices, its menu price and its variants' menu
  // prices differ (except where a case says otherwise), so a cell reading the wrong one fails.
  const products = [
    {
      id: "p-wine",
      name: "Wine",
      variants: [
        variant("v-glass", "Glass", "6.00"),
        // No price of its own: on this menu it takes the product's menu price.
        variant("v-bottle", "Bottle", null),
        variant("v-carafe", "Carafe", "14.00"),
      ],
    },
    {
      id: "p-juice",
      name: "Juice",
      variants: [
        variant("v-juice-small", "Small juice", "3.00"),
        variant("v-juice-large", "Large juice", "5.00"),
      ],
    },
    { id: "p-tea", name: "Tea", variants: [variant("v-pot", "Pot", "2.20")] },
    {
      id: "p-cider",
      name: "Cider",
      variants: [variant("v-pint", "Pint", "4.50"), variant("v-half", "Half", null)],
    },
  ] as unknown as Product[];

  /** Sets its own menu price and a menu price on two of its variants. */
  const wine: MenuPriceRow = {
    menuItemId: "mi-wine",
    combined: combinedFixture(
      "p-wine",
      "13.00",
      [
        { variantId: "v-glass", price: "7.00" },
        { variantId: "v-bottle", price: null },
        { variantId: "v-carafe", price: "15.00" },
      ],
      "13.00",
      "10.00",
      { "v-glass": "6.00", "v-bottle": null, "v-carafe": "14.00" },
    ),
    productId: "p-wine",
    name: "Wine",
    categoryId: "c-drinks",
    placements: [["s-drinks"]],
    override: "13.00",
    effectivePrice: "13.00",
    active: true,
    available: true,
    variants: [
      { variantId: "v-glass", price: "7.00", active: true, available: true },
      { variantId: "v-bottle", price: null, active: true, available: true },
      { variantId: "v-carafe", price: "15.00", active: true, available: true },
    ],
  };
  /** Its only menu price is a variant's. */
  const juice: MenuPriceRow = {
    menuItemId: "mi-juice",
    combined: combinedFixture(
      "p-juice",
      "4.00",
      [
        { variantId: "v-juice-small", price: "3.50" },
        { variantId: "v-juice-large", price: null },
      ],
      null,
      "4.00",
      { "v-juice-small": "3.00", "v-juice-large": "5.00" },
    ),
    productId: "p-juice",
    name: "Juice",
    categoryId: "c-drinks",
    placements: [["s-fav"]],
    override: null,
    effectivePrice: "4.00",
    active: true,
    available: true,
    variants: [
      { variantId: "v-juice-small", price: "3.50", active: true, available: true },
      { variantId: "v-juice-large", price: null, active: true, available: true },
    ],
  };
  const tea: MenuPriceRow = {
    menuItemId: "mi-tea",
    combined: combinedFixture(
      "p-tea",
      "2.00",
      [{ variantId: "v-pot", price: "2.40" }],
      null,
      "2.00",
      { "v-pot": "2.20" },
    ),
    productId: "p-tea",
    name: "Tea",
    categoryId: "c-mains",
    placements: [[]],
    override: null,
    effectivePrice: "2.00",
    active: true,
    available: true,
    variants: [{ variantId: "v-pot", price: "2.40", active: true, available: true }],
  };
  /** No menu price anywhere. */
  const cider: MenuPriceRow = {
    menuItemId: "mi-cider",
    combined: combinedFixture(
      "p-cider",
      "4.00",
      [
        { variantId: "v-pint", price: null },
        { variantId: "v-half", price: null },
      ],
      null,
      "4.00",
      { "v-pint": "4.50", "v-half": null },
    ),
    productId: "p-cider",
    name: "Cider",
    categoryId: "c-beer",
    placements: [["s-drinks", "s-beer"]],
    override: null,
    effectivePrice: "4.00",
    active: true,
    available: true,
    variants: [
      { variantId: "v-pint", price: null, active: true, available: true },
      { variantId: "v-half", price: null, active: true, available: true },
    ],
  };
  const steak: MenuPriceRow = {
    ...burger,
    menuItemId: "mi-steak",
    combined: combinedFixture("p-steak", "18.00", [], "18.00", "20.00", {}),
    productId: "p-steak",
    name: "Steak",
    override: "18.00",
    effectivePrice: "18.00",
  };

  function mountVariants(props: Partial<MenuPricesTable> = {}) {
    return mount({ rows: [wine, juice, tea, burger], products, ...props });
  }

  async function expand(el: MenuPricesTable, ...keys: string[]): Promise<void> {
    for (const key of keys) {
      toggleOf(el, key)!.click();
      await table(el).updateComplete;
    }
  }

  it("puts each variant under its product, collapsed until the product is opened", async () => {
    const el = await mountVariants();
    expect(shown(el)).toEqual(["mi-wine", "mi-juice", "mi-tea", "mi-burger"]);
    expect(toggleOf(el, "mi-burger")).toBeNull();
    expect(toggleOf(el, "mi-wine")!.getAttribute("aria-label")).toBe(
      t("menu_prices.expand").replace("{name}", "Wine"),
    );
    await expand(el, "mi-wine");
    expect(shown(el)).toEqual([
      "mi-wine",
      "mi-wine:v-glass",
      "mi-wine:v-bottle",
      "mi-wine:v-carafe",
      "mi-juice",
      "mi-tea",
      "mi-burger",
    ]);
    expect(toggleOf(el, "mi-wine")!.getAttribute("aria-label")).toBe(
      t("menu_prices.collapse").replace("{name}", "Wine"),
    );
    expect(row(el, "mi-wine:v-glass")!.getAttribute("aria-level")).toBe("2");
    await expand(el, "mi-wine");
    expect(shown(el)).toEqual(["mi-wine", "mi-juice", "mi-tea", "mi-burger"]);
  });

  it("shows each variant's name and its price override field, the inherited price as a blank one's placeholder", async () => {
    const el = await mountVariants();
    await expand(el, "mi-wine");
    const variants = ["mi-wine:v-glass", "mi-wine:v-bottle", "mi-wine:v-carafe"];
    const cells = (key: string) => variants.map((rowKey) => visibleText(cell(el, key, rowKey)));
    expect(cells("name")).toEqual(["Glass", "Bottle", "Carafe"]);
    const fields = variants.map((rowKey) => override(el, rowKey));
    expect(fields.map((field) => field.value)).toEqual(["7.00", "", "15.00"]);
    // The bottle has no price of its own, so blank it follows the wine's 13.00 on this menu.
    expect(fields.map((field) => field.placeholder)).toEqual(["6.00", "13.00", "14.00"]);
    expect(cells("placements")).toEqual(["", "", ""]);
    expect(cells("category")).toEqual(["", "", ""]);
    // Both names are plain text: no window opens behind either.
    expect(cell(el, "name", "mi-wine:v-glass").querySelector("wt-button")).toBeNull();
    expect(cell(el, "name", "mi-wine").querySelector("wt-button")).toBeNull();
    expect(text(cell(el, "name", "mi-wine").querySelector("[part~=name]"))).toBe("Wine");
    expect(visibleText(cell(el, "name", "mi-wine"))).toBe(`Wine ${t("menu_prices.has_variants")}`);
  });

  it("indents a variant's name past its product's, so it reads as nested", async () => {
    const el = await mountVariants();
    await expand(el, "mi-wine");
    // Where each name's words start, not its box.
    const start = (node: Node) => {
      const words = document.createRange();
      words.selectNodeContents(node);
      return words.getBoundingClientRect().left;
    };
    const product = start(cell(el, "name", "mi-wine").querySelector("[part~=name]")!);
    const variant = start(
      cell(el, "name", "mi-wine:v-glass").querySelector("[part~=variant-name]")!,
    );
    expect(variant - product).toBeGreaterThanOrEqual(8);
  });

  it("names a variant the product list does not hold as missing, and, knowing no price of its own, shows the price and fallback the server resolved", async () => {
    // The glass's own price, 6.00, is in the product list this table is not given.
    const glassWithoutMenuPrice: MenuPriceRow = {
      ...wine,
      combined: combinedFixture(
        "p-wine",
        "13.00",
        wine.variants.map((v) => (v.variantId === "v-glass" ? { ...v, price: null } : v)),
        "13.00",
        "10.00",
        { "v-glass": "6.00", "v-carafe": "14.00" },
      ),
      variants: wine.variants.map((v) => (v.variantId === "v-glass" ? { ...v, price: null } : v)),
    };
    const el = await mountVariants({ rows: [glassWithoutMenuPrice], products: [] });
    await expand(el, "mi-wine");
    expect(visibleText(cell(el, "name", "mi-wine:v-glass"))).toBe(t("members.missing"));
    expect(override(el, "mi-wine:v-glass").placeholder).toBe("6.00");
    expect(override(el, "mi-wine:v-carafe").value).toBe("15.00");
  });

  it("offers a product sold as its variants the range of its variants' inherited prices", async () => {
    const el = await mountVariants();
    expect(override(el, "mi-wine").value).toBe("13.00");
    expect(["mi-juice", "mi-tea", "mi-burger"].map((key) => override(el, key).placeholder)).toEqual(
      ["3.50 – 5.00", "2.40", "12.00"],
    );
  });

  it("shows one price, not a range, when the variants' prices are the same amount", async () => {
    const el = await mountVariants({
      rows: [
        {
          ...juice,
          combined: combinedFixture(
            "p-juice",
            "4.00",
            [
              { variantId: "v-juice-small", price: "5.0" },
              { variantId: "v-juice-large", price: null },
            ],
            null,
            "4.00",
            { "v-juice-small": "3.00", "v-juice-large": "5.00" },
          ),
          variants: [
            { variantId: "v-juice-small", price: "5.0", active: true, available: true },
            { variantId: "v-juice-large", price: null, active: true, available: true },
          ],
        },
      ],
    });
    expect(override(el, "mi-juice").placeholder).toBe("5.0");
  });

  it("sorts a range by its low end, as an amount", async () => {
    const el = await mountVariants({ rows: [wine, juice, tea, cider, burger] });
    await sortBy(el, "override");
    // By the high end the cider (4.00 – 4.50) would come before the juice (3.50 – 5.00).
    expect(shown(el)).toEqual(["mi-tea", "mi-juice", "mi-cider", "mi-burger", "mi-wine"]);
    await sortBy(el, "override");
    // Descending.
    expect(shown(el)).toEqual(["mi-wine", "mi-burger", "mi-cider", "mi-juice", "mi-tea"]);
  });

  it("keeps the variants under their product in the product's order under every sort", async () => {
    const el = await mountVariants({ rows: [wine] });
    await expand(el, "mi-wine");
    const inOrder = ["mi-wine", "mi-wine:v-glass", "mi-wine:v-bottle", "mi-wine:v-carafe"];
    await sortBy(el, "override");
    expect(shown(el)).toEqual(inOrder);
    await sortBy(el, "override");
    expect(shown(el)).toEqual(inOrder);
    await sortBy(el, "name");
    expect(shown(el)).toEqual(inOrder);
  });

  it("keeps a product's variants in its order while the products sort by the column", async () => {
    // Alphabetically, and by price, Alpha comes before Zeta; the product lists Zeta first.
    const pizzaProduct = {
      id: "p-pizza",
      name: "Pizza",
      variants: [variant("v-zeta", "Zeta", "9.00"), variant("v-alpha", "Alpha", "5.00")],
    } as unknown as Product;
    const pizza: MenuPriceRow = {
      menuItemId: "mi-pizza",
      combined: combinedFixture(
        "p-pizza",
        "6.00",
        [
          { variantId: "v-zeta", price: null },
          { variantId: "v-alpha", price: null },
        ],
        null,
        "6.00",
        { "v-zeta": "9.00", "v-alpha": "5.00" },
      ),
      productId: "p-pizza",
      name: "Pizza",
      categoryId: "c-mains",
      placements: [[]],
      override: null,
      effectivePrice: "6.00",
      active: true,
      available: true,
      variants: [
        { variantId: "v-zeta", price: null, active: true, available: true },
        { variantId: "v-alpha", price: null, active: true, available: true },
      ],
    };
    const el = await mount({ rows: [pizza, burger], products: [pizzaProduct] });
    await expand(el, "mi-pizza");
    const pizzaLines = ["mi-pizza", "mi-pizza:v-zeta", "mi-pizza:v-alpha"];
    expect(column(el, "name").slice(1, 3)).toEqual(["Zeta", "Alpha"]);
    expect(shown(el)).toEqual([...pizzaLines, "mi-burger"]);
    await sortBy(el, "name");
    expect(shown(el)).toEqual(["mi-burger", ...pizzaLines]);
    await sortBy(el, "name");
    expect(shown(el)).toEqual([...pizzaLines, "mi-burger"]);
    await sortBy(el, "override");
    expect(shown(el)).toEqual([...pizzaLines, "mi-burger"]);
    await sortBy(el, "override");
    expect(shown(el)).toEqual(["mi-burger", ...pizzaLines]);
  });

  it("says a product's menu prices are on its variants when only they have one", async () => {
    const el = await mountVariants();
    expect(column(el, "override")).toEqual([
      "",
      t("menu_prices.variant_overrides"),
      t("menu_prices.variant_overrides"),
      "",
    ]);
    expect(override(el, "mi-wine").value).toBe("13.00");
  });

  it("keeps exactly the products it marks with a menu price under the Overridden only filter", async () => {
    const el = await mountVariants({ rows: [wine, juice, tea, cider, burger, steak] });
    const unmarked = shown(el).filter(
      (key) => override(el, key).value === "" && visibleText(cell(el, "override", key)) === "",
    );
    expect(unmarked).toEqual(["mi-cider", "mi-burger"]);
    await choose(el, "override", "overridden");
    expect(shown(el)).toEqual(["mi-wine", "mi-juice", "mi-tea", "mi-steak"]);
  });

  it("judges each variant by its own menu price under the Overridden only filter", async () => {
    const el = await mountVariants();
    await choose(el, "override", "overridden");
    await expand(el, "mi-wine", "mi-juice");
    expect(shown(el)).toEqual([
      "mi-wine",
      "mi-wine:v-glass",
      "mi-wine:v-carafe",
      "mi-juice",
      "mi-juice:v-juice-small",
      "mi-tea",
    ]);
  });

  it("keeps a product's variants under the section and category filters that keep the product", async () => {
    const el = await mountVariants();
    await choose(el, "placements", ["s-drinks"]);
    await expand(el, "mi-wine");
    expect(shown(el)).toEqual([
      "mi-wine",
      "mi-wine:v-glass",
      "mi-wine:v-bottle",
      "mi-wine:v-carafe",
    ]);
    await choose(el, "placements", []);
    await choose(el, "category", ["c-drinks"]);
    await expand(el, "mi-juice");
    expect(shown(el)).toEqual([
      "mi-wine",
      "mi-wine:v-glass",
      "mi-wine:v-bottle",
      "mi-wine:v-carafe",
      "mi-juice",
      "mi-juice:v-juice-small",
      "mi-juice:v-juice-large",
    ]);
  });

  it("finds a variant by its name, under its product", async () => {
    const el = await mountVariants();
    await search(el, "carafe");
    expect(shown(el)).toEqual(["mi-wine", "mi-wine:v-carafe"]);
  });

  it("finds a price as it is written, not as the amount it sorts by", async () => {
    const el = await mountVariants();
    // The glass's own 7.00 is not the wine's 13.00, so only the glass's row shows it.
    await search(el, "7.00");
    expect(shown(el)).toEqual(["mi-wine", "mi-wine:v-glass"]);
    await search(el, "700");
    expect(shown(el)).toEqual([]);
    // The wine's own 13.00, which the bottle follows too, finds the wine itself.
    await search(el, "13.00");
    expect(shown(el)).toEqual(["mi-wine"]);
  });

  it("keeps a product's variants when the product is found by its name", async () => {
    const el = await mountVariants();
    await search(el, "wine");
    expect(shown(el)).toEqual(["mi-wine"]);
    await expand(el, "mi-wine");
    expect(shown(el)).toEqual([
      "mi-wine",
      "mi-wine:v-glass",
      "mi-wine:v-bottle",
      "mi-wine:v-carafe",
    ]);
  });

  it("offers Appears under, Main category and Available in the column chooser, all shown, and keeps the choice under the menu prices key alone", async () => {
    // A choice under either of this table's old keys, or an order under the last one, is not read.
    localStorage.setItem("waitron.menus.prices:columns", JSON.stringify({ category: false }));
    localStorage.setItem(
      "waitron.menus.price-overrides.table:column-order",
      JSON.stringify(["placements", "category", "status", "override"]),
    );
    localStorage.setItem(
      "waitron.menus.price-overrides.table:columns",
      JSON.stringify({ category: false }),
    );
    const el = await mountVariants();
    const trigger = table(el).shadowRoot.querySelector(".columns-trigger")!;
    expect(trigger.getAttribute("aria-label")).toBe(t("table.customise_columns"));
    const box = (root: MenuPricesTable, key: string) =>
      table(root).shadowRoot.querySelector<HTMLInputElement>(`input[data-column="${key}"]`)!;
    const choices = [
      ...table(el).shadowRoot.querySelectorAll<HTMLInputElement>("input[data-column]"),
    ].map((choice) => [choice.dataset.column, choice.checked]);
    expect(choices).toEqual([
      ["placements", true],
      ["category", true],
      ["available", true],
    ]);
    expect(headers(el)).toEqual(["name", "override", "placements", "category", "available", ""]);
    box(el, "category").click();
    await table(el).updateComplete;
    expect(headers(el)).not.toContain("category");
    expect(JSON.parse(localStorage.getItem("waitron.menus.menu-prices.table:columns")!)).toEqual({
      category: false,
    });
    const again = await mountVariants();
    expect(headers(again)).toEqual(["name", "override", "placements", "available", ""]);
    table(again).shadowRoot.querySelector<HTMLElement>("[data-restore-columns]")!.click();
    await table(again).updateComplete;
    expect(headers(again)).toEqual(["name", "override", "placements", "category", "available", ""]);
  });

  it.each(["en-GB", "es-ES"])(
    "fits the longest range placeholder whole inside the field (%s)",
    async (locale) => {
      setLocale(locale);
      try {
        const wide = {
          ...juice,
          combined: combinedFixture(
            "p-juice",
            "4.00",
            [
              { variantId: "v-juice-small", price: "1000.00" },
              { variantId: "v-juice-large", price: "9999.99" },
            ],
            null,
            "4.00",
            { "v-juice-small": "3.00", "v-juice-large": "5.00" },
          ),
          variants: [
            { variantId: "v-juice-small", price: "1000.00", active: true, available: true },
            { variantId: "v-juice-large", price: "9999.99", active: true, available: true },
          ],
        };
        const el = await mount({ rows: [wide], products });
        const input = override(el, "mi-juice").shadowRoot!.querySelector("input")!;
        expect(input.placeholder).toBe("1000.00 – 9999.99");
        const style = getComputedStyle(input);
        const context = document.createElement("canvas").getContext("2d")!;
        // The placeholder's own font, which is italic and wider than the amount's.
        context.font = getComputedStyle(input, "::placeholder").font;
        const room =
          input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        expect(context.measureText(input.placeholder).width).toBeLessThanOrEqual(room);
      } finally {
        setLocale("es-ES");
      }
    },
  );
});

it("sends the product's field and a size's field as two saves, one field each, on leaving each", async () => {
  const el = await mount({ rows: [lemonade] });
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  const heard = priceSaves(el);
  await typeIn(el, "mi-lemonade", "2.60");
  await leave(el, "mi-lemonade");
  await typeIn(el, "mi-lemonade:v-small", "1.20");
  await leave(el, "mi-lemonade:v-small");
  expect(heard.mock.calls).toEqual([
    [
      {
        key: "mi-lemonade",
        menuItemId: "mi-lemonade",
        variantId: null,
        name: "Lemonade",
        price: "2.60",
        previous: "2.50",
      },
    ],
    [
      {
        key: "mi-lemonade:v-small",
        menuItemId: "mi-lemonade",
        variantId: "v-small",
        name: "Lemonade — Small",
        price: "1.20",
        previous: null,
      },
    ],
  ]);
});

const drinksSource = {
  kind: "menu",
  menuId: "drinks",
  menuName: "Drinks",
  from: { kind: "own" },
} as const;
const clashPrice = {
  state: "clash",
  candidates: [
    { place: { kind: "own_sections" }, value: "3.00", source: { kind: "product" } },
    {
      place: { kind: "menu", menuId: "drinks", menuName: "Drinks" },
      value: "3.50",
      source: drinksSource,
    },
  ],
} as unknown as MenuPriceRow["combined"]["price"];
function clashRow(source = lager, price = clashPrice): MenuPriceRow {
  return { ...source, combined: { ...source.combined, price } };
}
/** Lemonade at its own 2.50, its small size's sources disagreeing at size level. */
function variantClashRow(price = clashPrice): MenuPriceRow {
  return {
    ...lemonade,
    combined: {
      ...lemonade.combined,
      variants: lemonade.combined.variants.map((v, at) =>
        at === 0 ? { ...v, price: { ...price, level: "size" } } : v,
      ),
    },
  } as MenuPriceRow;
}
/** `clashPrice` with its other menu renamed. */
function clashPriceIn(menuName: string): MenuPriceRow["combined"]["price"] {
  return {
    state: "clash",
    candidates: [
      { place: { kind: "own_sections" }, value: "3.00", source: { kind: "product" } },
      {
        place: { kind: "menu", menuId: "drinks", menuName },
        value: "3.50",
        source: { ...drinksSource, menuName },
      },
    ],
  } as unknown as MenuPriceRow["combined"]["price"];
}
const clashSentences = {
  "en-GB": {
    prices: "Price set to €3.00 in this menu's sections, €3.50 in Drinks.",
    sizes: "Variant prices disagree. Small: €3.00 in this menu's sections, €3.50 in Drinks.",
    undecided: "Price set to €3.00 in this menu's sections, no single price in Drinks.",
  },
  "es-ES": {
    prices: "Precio fijado: 3,00 € en las secciones de esta carta, 3,50 € en Drinks.",
    sizes:
      "Los precios de las variantes discrepan. Small: 3,00 € en las secciones de esta carta, 3,50 € en Drinks.",
    undecided:
      "Precio fijado: 3,00 € en las secciones de esta carta, sin un precio único en Drinks.",
  },
} as const;
const undecidedPrice = {
  state: "clash",
  candidates: [
    { place: { kind: "own_sections" }, value: "3.00", source: { kind: "product" } },
    { place: { kind: "menu", menuId: "drinks", menuName: "Drinks" }, undecided: true },
  ],
} as unknown as MenuPriceRow["combined"]["price"];

it.each(["en-GB", "es-ES"])(
  "shows a product's and a size's price field whole inside the table's visible box at phone width, and the page does not scroll sideways (%s)",
  async (locale) => {
    const width = window.innerWidth,
      height = window.innerHeight;
    setLocale(locale);
    try {
      await page.viewport(390, 800);
      await vi.waitFor(() => expect(window.innerWidth).toBe(390));
      const long = "Cerveza artesana de trigo sin filtrar";
      const longSize = "Media pinta de limonada natural";
      const menuName = "Carta de bebidas de la terraza de verano";
      const price = clashPriceIn(menuName);
      const el = await mount({
        rows: [clashRow({ ...lager, name: long }, price), variantClashRow(price)],
        products: [
          {
            ...lemonadeProduct,
            variants: [variant("v-small", longSize, null), variant("v-large", "Large", "3.40")],
          } as unknown as Product,
        ],
      });
      toggleOf(el, "mi-lemonade")!.click();
      await table(el).updateComplete;
      expect(text(row(el, "mi-lager")!.querySelector('[part="name"]'))).toBe(long);
      expect(text(row(el, "mi-lemonade:v-small")!.querySelector('[part="variant-name"]'))).toBe(
        longSize,
      );
      const scroller = table(el)
        .shadowRoot.querySelector<HTMLElement>(".scroll")!
        .getBoundingClientRect();
      for (const key of ["mi-lager", "mi-lemonade:v-small"]) {
        const field = override(el, key).getBoundingClientRect();
        expect(field.left, key).toBeGreaterThanOrEqual(scroller.left - 0.5);
        expect(field.right, key).toBeLessThanOrEqual(scroller.right + 0.5);
        const pinned = pinnedCell(el, key);
        expect(field.right, `${key} against the row menu`).toBeLessThanOrEqual(
          pinned.getBoundingClientRect().left + 0.5,
        );
        const trigger = pinned
          .querySelector("wt-row-actions")!
          .shadowRoot!.querySelector("button")!
          .getBoundingClientRect();
        expect(trigger.left, key).toBeGreaterThanOrEqual(0);
        expect(trigger.right, key).toBeLessThanOrEqual(window.innerWidth);
        const hit = table(el).shadowRoot.elementFromPoint(
          trigger.left + trigger.width / 2,
          trigger.top + trigger.height / 2,
        );
        expect(hit !== null && pinned.contains(hit), `${key} ⋮ covered`).toBe(true);
      }
      for (const key of ["mi-lager", "mi-lemonade", "mi-lemonade:v-small"]) {
        const sentence = cell(el, "override", key).querySelector("[part~=clash]")!;
        expect(text(sentence), key).toContain(menuName);
        const box = sentence.getBoundingClientRect();
        const priceCell = cell(el, "override", key).getBoundingClientRect();
        expect(box.left, key).toBeGreaterThanOrEqual(priceCell.left - 0.5);
        expect(box.right, key).toBeLessThanOrEqual(priceCell.right + 0.5);
        expect(box.width, key).toBeLessThanOrEqual(
          override(el, key).getBoundingClientRect().width + 0.5,
        );
      }
      const root = document.documentElement;
      expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    } finally {
      setLocale("es-ES");
      await page.viewport(width, height);
    }
  },
);
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

it("measures the row menu's column when the table resizes, and not on each keystroke in a price field", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  const measured = vi.spyOn(Element.prototype, "getBoundingClientRect");
  try {
    const el = await mount();
    const heading = table(el).shadowRoot.querySelector('thead th[data-pinned="end"]')!;
    const measures = () => measured.mock.contexts.filter((node) => node === heading).length;
    // The measurement the first draw's resize asks for, a frame later, is let through first.
    let settled = measures();
    for (let quiet = 0; quiet < 3;) {
      await frame();
      quiet = measures() === settled ? quiet + 1 : 0;
      settled = measures();
    }
    for (const value of ["2", "2.", "2.8", "2.80"]) {
      await typeIn(el, "mi-burger", value);
      await table(el).updateComplete;
    }
    await frame();
    await frame();
    expect(override(el, "mi-burger").value).toBe("2.80");
    expect(measures()).toBe(settled);
    await page.viewport(390, 800);
    await vi.waitFor(() => expect(measures()).toBeGreaterThan(settled));
  } finally {
    measured.mockRestore();
    await page.viewport(width, height);
  }
});

it.each(["product", "size"])(
  "drops the clash sentence while a valid unsaved price fills a clashing %s row, and shows it again for text that is no price and on Escape",
  async (kind) => {
    const el = await mount({ rows: [kind === "product" ? clashRow(lager) : variantClashRow()] });
    const key = kind === "product" ? "mi-lager" : "mi-lemonade:v-small";
    if (kind === "size") {
      toggleOf(el, "mi-lemonade")!.click();
      await table(el).updateComplete;
    }
    const heard = priceSaves(el);
    await typeIn(el, key, "2.80");
    await table(el).updateComplete;
    expect(clashMarker(el, key)).toBe("");
    expect(override(el, key).value).toBe("2.80");
    expect(heard).not.toHaveBeenCalled();

    for (const value of ["", "-1", "abc"]) {
      await typeIn(el, key, value);
      await table(el).updateComplete;
      expect(clashMarker(el, key)).toBe(clashSentences["es-ES"].prices);
      await typeIn(el, key, "2.80");
      await table(el).updateComplete;
    }
    await press(el, key, "Escape");
    await table(el).updateComplete;
    expect(clashMarker(el, key)).toBe(clashSentences["es-ES"].prices);
    expect(override(el, key).value).toBe("");
    expect(heard).not.toHaveBeenCalled();
  },
);

it("shows a clashing product's stored price, takes native typing, and restores the stored price on Escape", async () => {
  const el = await mount({ rows: [clashRow(lemonade)] });
  const key = "mi-lemonade";
  expect(override(el, key).value).toBe("2.50");
  const field = override(el, key);
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  input.value = "2.80";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  await table(el).updateComplete;
  expect(field.value).toBe("2.80");
  await press(el, key, "Escape");
  await table(el).updateComplete;
  expect(field.value).toBe("2.50");
});

it.each(["", "-1", "abc"])(
  "keeps a clashing row's clash sentence when its draft is %j",
  async (value) => {
    const el = await mount({ rows: [clashRow(lager)] });
    const heard = priceSaves(el);
    await typeIn(el, "mi-lager", value);
    await table(el).updateComplete;
    expect(clashMarker(el, "mi-lager")).toBe(clashSentences["es-ES"].prices);
    expect(heard).not.toHaveBeenCalled();
  },
);

it("offers one labelled price override field per product and per size, the inherited price as a blank one's placeholder", async () => {
  setLocale("en-GB");
  try {
    const el = await mount();
    toggleOf(el, "mi-lemonade")!.click();
    await table(el).updateComplete;
    const want = [
      ["mi-burger", "Price override for Burger", "", "12.00"],
      ["mi-lemonade", "Price override for Lemonade, set on this menu", "2.50", "3.00 – 3.75"],
      ["mi-lemonade:v-small", "Price override for Lemonade — Small", "", "2.50"],
      [
        "mi-lemonade:v-large",
        "Price override for Lemonade — Large, set on this menu",
        "3.75",
        "3.40",
      ],
      ["mi-lager", "Price override for Lager", "", "2.00"],
    ];
    for (const [key, label, value, placeholder] of want) {
      const input = override(el, key!);
      expect(
        [input.label, input.hideLabel, input.name, input.value, input.placeholder],
        key,
      ).toEqual([label, true, "price-override", value, placeholder]);
      expect(input.required, key).toBe(false);
    }
    expect(hintOf(override(el, "mi-burger"))).toBe(
      "Leave it empty to use the inherited price, €12.00.",
    );
    expect(hintOf(override(el, "mi-lemonade"))).toBe(
      "Leave it empty to use the inherited prices, €3.00 – €3.75.",
    );
  } finally {
    setLocale("es-ES");
  }
});

const plainLabel = (name: string) => t("menu_prices.override_label").replace("{name}", name);
const setLabel = (name: string) => t("menu_prices.override_label_set").replace("{name}", name);
const innerLabel = (field: HTMLElement) =>
  field.shadowRoot!.querySelector("input")!.getAttribute("aria-label");

it("marks a price this menu sets as overriding and names it set on this menu; an inherited one is neither", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  const want: [string, string, boolean][] = [
    ["mi-lemonade", "Lemonade", true],
    ["mi-lemonade:v-large", "Lemonade — Large", true],
    ["mi-burger", "Burger", false],
    ["mi-lemonade:v-small", "Lemonade — Small", false],
  ];
  for (const [key, name, set] of want) {
    const field = override(el, key);
    await field.updateComplete;
    const label = set ? setLabel(name) : plainLabel(name);
    expect([field.overriding, field.label, innerLabel(field)], key).toEqual([set, label, label]);
  }
});

it("a price typed into an inherited field is drawn as set but named plainly until it is stored; Escape, malformed text and a cleared field put the look back", async () => {
  const el = await mount();
  await typeIn(el, "mi-burger", "4.00");
  expect([override(el, "mi-burger").overriding, override(el, "mi-burger").label]).toEqual([
    true,
    plainLabel("Burger"),
  ]);
  await press(el, "mi-burger", "Escape");
  expect([override(el, "mi-burger").overriding, override(el, "mi-burger").label]).toEqual([
    false,
    plainLabel("Burger"),
  ]);
  await typeIn(el, "mi-burger", "abc");
  expect(override(el, "mi-burger").overriding).toBe(false);
  await typeIn(el, "mi-lemonade", "");
  expect([override(el, "mi-lemonade").overriding, override(el, "mi-lemonade").label]).toEqual([
    false,
    setLabel("Lemonade"),
  ]);
  el.rows = [{ ...burger, override: "4.00" }, lemonade, lager];
  await el.updateComplete;
  await table(el).updateComplete;
  expect(override(el, "mi-burger").label).toBe(setLabel("Burger"));
});

/** A keystroke as the browser delivers it: the field's own value changes before the table hears. */
async function keyIn(el: MenuPricesTable, key: string, value: string) {
  const input = override(el, key).shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  await table(el).updateComplete;
  await override(el, key).updateComplete;
}

it("typing into the field itself turns the set look on and off as the text starts and stops holding a price", async () => {
  const el = await mount();
  await keyIn(el, "mi-burger", "4.00");
  expect(override(el, "mi-burger").overriding).toBe(true);
  await keyIn(el, "mi-burger", "");
  expect(override(el, "mi-burger").overriding).toBe(false);
  await keyIn(el, "mi-burger", "5.00");
  expect(override(el, "mi-burger").overriding).toBe(true);
});

it("a refused well-formed price stays marked set while its error shows", async () => {
  const el = await mount();
  await typeIn(el, "mi-burger", "4.00");
  await press(el, "mi-burger", "Enter");
  el.refusals = { "mi-burger": "Refused here" };
  await el.updateComplete;
  await table(el).updateComplete;
  const field = override(el, "mi-burger");
  expect([field.error, field.overriding, field.label]).toEqual([
    "Refused here",
    true,
    plainLabel("Burger"),
  ]);
});

it("names a set price in English and in Spanish", async () => {
  expect(setLabel("Lemonade")).toBe("Precio propio de Lemonade, fijado en esta carta");
  setLocale("en-GB");
  try {
    expect(setLabel("Lemonade")).toBe("Price override for Lemonade, set on this menu");
  } finally {
    setLocale("es-ES");
  }
});

it("shows a clash honestly: no price in the field, a red sentence under it naming each place's price, the same sentence as its hint", async () => {
  setLocale("en-GB");
  try {
    const el = await mount({ rows: [clashRow(lager)] });
    const input = override(el, "mi-lager");
    expect([input.value, input.placeholder]).toEqual(["", "Set a price"]);
    expect(hintOf(input)).toBe(clashSentences["en-GB"].prices);
    const marker = cell(el, "override", "mi-lager").querySelector("[part~=clash]")!;
    expect(text(marker)).toBe(clashSentences["en-GB"].prices);
    // Painted in the danger colour, through the table's part.
    const probe = document.createElement("span");
    probe.style.color = "var(--wt-color-danger)";
    el.parentElement!.appendChild(probe);
    expect(getComputedStyle(marker).color).toBe(getComputedStyle(probe).color);
  } finally {
    setLocale("es-ES");
  }
});

it.each([
  ["en-GB", clashSentences["en-GB"].sizes],
  ["es-ES", clashSentences["es-ES"].sizes],
])(
  "sends a product row whose only clash is a size's to that size, offering no price of its own (%s)",
  async (locale, words) => {
    setLocale(locale);
    try {
      const el = await mount({ rows: [variantClashRow()] });
      const input = override(el, "mi-lemonade");
      expect(input.placeholder).toBe("—");
      expect(input.placeholder).not.toBe(t("menu_prices.clash_placeholder"));
      expect(hintOf(input)).toBe(words);
      expect(text(cell(el, "override", "mi-lemonade").querySelector("[part~=clash]"))).toBe(words);
      toggleOf(el, "mi-lemonade")!.click();
      await table(el).updateComplete;
      // The size itself is the one offered a price.
      expect(override(el, "mi-lemonade:v-small").placeholder).toBe(
        t("menu_prices.clash_placeholder"),
      );
    } finally {
      setLocale("es-ES");
    }
  },
);

/** The sentence shown in red under the row's field, which a screen reader hears once, as the
 * field's description. */
async function expectClashSentence(el: MenuPricesTable, key: string, words: string) {
  const input = override(el, key);
  await input.updateComplete;
  const shownWords = cell(el, "override", key).querySelector("[part~=clash]");
  expect(text(shownWords), key).toBe(words);
  expect(shownWords!.getAttribute("aria-hidden"), key).toBe("true");
  const help = input.shadowRoot!.querySelector<HTMLElement>("[data-hint]")!;
  expect(text(help), key).toBe(words);
  const describedBy = input.shadowRoot!.querySelector("input")!.getAttribute("aria-describedby");
  expect(describedBy!.split(" "), key).toContain(help.id);
}

describe.each(["en-GB", "es-ES"] as const)("the clash spelled out (%s)", (locale) => {
  beforeEach(() => setLocale(locale));
  afterEach(() => setLocale("es-ES"));
  const words = clashSentences[locale];

  it("names each place's price for a clashing product, and drops it while a price is typed", async () => {
    const el = await mount({ rows: [clashRow(lager)] });
    await expectClashSentence(el, "mi-lager", words.prices);
    await typeIn(el, "mi-lager", "2.80");
    await table(el).updateComplete;
    expect(cell(el, "override", "mi-lager").querySelector("[part~=clash]")).toBeNull();
    expect(hintOf(override(el, "mi-lager"))).not.toBe(words.prices);
  });

  it("names each place's price for a clashing size, and drops it while a price is typed", async () => {
    const el = await mount({ rows: [variantClashRow()] });
    toggleOf(el, "mi-lemonade")!.click();
    await table(el).updateComplete;
    await expectClashSentence(el, "mi-lemonade:v-small", words.prices);
    await typeIn(el, "mi-lemonade:v-small", "2.80");
    await table(el).updateComplete;
    expect(cell(el, "override", "mi-lemonade:v-small").querySelector("[part~=clash]")).toBeNull();
    expect(hintOf(override(el, "mi-lemonade:v-small"))).not.toBe(words.prices);
  });

  it("names each clashing size and its places' prices on its product's row", async () => {
    const el = await mount({ rows: [variantClashRow()] });
    await expectClashSentence(el, "mi-lemonade", words.sizes);
  });

  it("says where no single price was decided", async () => {
    const el = await mount({ rows: [clashRow(lager, undecidedPrice)] });
    await expectClashSentence(el, "mi-lager", words.undecided);
  });
});

const clashMarker = (el: MenuPricesTable, key: string) =>
  text(cell(el, "override", key).querySelector("[part~=clash]"));

it("drops a product's clash sentence once this menu's saved price decides it, and shows it again when the field is emptied", async () => {
  const resolved: MenuPriceRow = {
    ...lager,
    override: "2.20",
    combined: {
      ...lager.combined,
      price: { state: "decided", value: "2.20", source: { kind: "own" }, otherwise: clashPrice },
    } as MenuPriceRow["combined"],
  };
  const el = await mount({ rows: [resolved] });
  expect(override(el, "mi-lager").value).toBe("2.20");
  expect(clashMarker(el, "mi-lager")).toBe("");
  await typeIn(el, "mi-lager", "");
  await table(el).updateComplete;
  expect(clashMarker(el, "mi-lager")).toBe(clashSentences["es-ES"].prices);
  expect(override(el, "mi-lager").placeholder).toBe(t("menu_prices.clash_placeholder"));
});

it("marks a product whose saved price settled the clash a following size charges once its field is emptied, so the clash shows with the product closed", async () => {
  const settled = {
    state: "decided",
    value: "2.20",
    source: { kind: "own" },
    otherwise: clashPrice,
  };
  const row = {
    ...lemonade,
    override: "2.20",
    combined: {
      ...lemonade.combined,
      price: settled,
      variants: lemonade.combined.variants.map((v, at) =>
        at === 0
          ? { ...v, price: { ...settled, source: { kind: "parent" }, level: "product" } }
          : v,
      ),
    },
  } as MenuPriceRow;
  const el = await mount({ rows: [row] });
  expect(clashMarker(el, "mi-lemonade")).toBe("");
  await typeIn(el, "mi-lemonade", "");
  await table(el).updateComplete;
  expect(clashMarker(el, "mi-lemonade")).toBe(clashSentences["es-ES"].prices);
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  expect(clashMarker(el, "mi-lemonade:v-small")).toBe(clashSentences["es-ES"].prices);
  await typeIn(el, "mi-lemonade", "2.80");
  await table(el).updateComplete;
  expect(clashMarker(el, "mi-lemonade")).toBe("");
  expect(clashMarker(el, "mi-lemonade:v-small")).toBe("");
});

it("drops a product's clash sentence while a price is typed for it, and not for text that is no price", async () => {
  const el = await mount({ rows: [clashRow(lager)] });
  expect(clashMarker(el, "mi-lager")).toBe(clashSentences["es-ES"].prices);
  await typeIn(el, "mi-lager", "2.20");
  await table(el).updateComplete;
  expect(clashMarker(el, "mi-lager")).toBe("");
  await typeIn(el, "mi-lager", "2,20");
  await table(el).updateComplete;
  expect(clashMarker(el, "mi-lager")).toBe(clashSentences["es-ES"].prices);
});

it("drops a size's clash sentence once this menu's saved price decides it, and shows it again when the field is emptied", async () => {
  const source = variantClashRow();
  const resolved = {
    ...source,
    combined: {
      ...source.combined,
      variants: source.combined.variants.map((v, at) =>
        at === 0
          ? {
              ...v,
              price: {
                state: "decided",
                value: "3.20",
                source: { kind: "own" },
                otherwise: clashPrice,
                level: "size",
              },
            }
          : v,
      ),
    },
    variants: source.variants.map((v) => (v.variantId === "v-small" ? { ...v, price: "3.20" } : v)),
  } as MenuPriceRow;
  const el = await mount({ rows: [resolved] });
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  expect(clashMarker(el, "mi-lemonade:v-small")).toBe("");
  expect(clashMarker(el, "mi-lemonade")).toBe("");
  await typeIn(el, "mi-lemonade:v-small", "");
  await table(el).updateComplete;
  expect(clashMarker(el, "mi-lemonade:v-small")).toBe(clashSentences["es-ES"].prices);
});

it("names its variants' clash on a product whose own clashing price is never sold, before and after a price is typed for it", async () => {
  const el = await mount({
    rows: [
      {
        ...variantClashRow(),
        override: null,
        combined: { ...variantClashRow().combined, price: clashPrice },
      },
    ],
  });
  // Its own price is never sold: each Active size's price comes from its size's own sources.
  expect(clashMarker(el, "mi-lemonade")).toBe(clashSentences["es-ES"].sizes);
  expect(override(el, "mi-lemonade").placeholder).toBe("—");
  await allPrices(el);
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  expect(clashMarker(el, "mi-lemonade:v-small")).toBe(clashSentences["es-ES"].prices);
  await typeIn(el, "mi-lemonade", "2.80");
  await table(el).updateComplete;
  expect(clashMarker(el, "mi-lemonade")).toBe(clashSentences["es-ES"].sizes);
  expect(override(el, "mi-lemonade").placeholder).toBe("—");
});

it("shows a size following its clashing product the price typed for the product, and the clash again once that field is emptied", async () => {
  setLocale("en-GB");
  try {
    const source = {
      ...lemonade,
      override: null,
      combined: {
        ...lemonade.combined,
        price: clashPrice,
        variants: lemonade.combined.variants.map((v, at) =>
          at === 0 ? { ...v, price: { ...clashPrice, level: "product" } } : v,
        ),
      },
    } as MenuPriceRow;
    const el = await mount({ rows: [source] });
    toggleOf(el, "mi-lemonade")!.click();
    await table(el).updateComplete;
    const size = "mi-lemonade:v-small";
    expect(override(el, size).placeholder).toBe("Set a price");
    expect(clashMarker(el, size)).toBe(clashSentences["en-GB"].prices);
    await typeIn(el, "mi-lemonade", "2.80");
    await table(el).updateComplete;
    expect(override(el, size).placeholder).toBe("2.80");
    expect(hintOf(override(el, size))).toBe("Leave it empty to use the inherited price, €2.80.");
    expect(clashMarker(el, size)).toBe("");
    await typeIn(el, "mi-lemonade", "");
    await table(el).updateComplete;
    expect(override(el, size).placeholder).toBe("Set a price");
    expect(clashMarker(el, size)).toBe(clashSentences["en-GB"].prices);
  } finally {
    setLocale("es-ES");
  }
});

/** Runs `body` with the test frame at a desktop width, where the whole table fits the window. */
async function atDesktopWidth(body: () => Promise<void>): Promise<void> {
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(1280, 800);
  try {
    expect(window.innerWidth).toBe(1280);
    await body();
  } finally {
    await page.viewport(width, height);
  }
}

it.each(["en-GB", "es-ES"])(
  "puts a row's notes under its field, so no note widens the column and every field lines up (%s)",
  async (locale) => {
    setLocale(locale);
    try {
      await atDesktopWidth(async () => {
        const el = await allPrices(
          await mount({ rows: [burger, variantClashRow(), clashRow(lager)] }),
        );
        const box = table(el).shadowRoot.querySelector<HTMLElement>(".scroll")!;
        expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
        const right = (key: string) => override(el, key).getBoundingClientRect().right;
        expect(right("mi-lemonade")).toBeCloseTo(right("mi-burger"), 0);
        expect(right("mi-lager")).toBeCloseTo(right("mi-burger"), 0);
        for (const [key, part] of [
          ["mi-lemonade", "clash"],
          ["mi-lager", "clash"],
        ] as const) {
          const note = cell(el, "override", key).querySelector<HTMLElement>(`[part~=${part}]`)!;
          const field = override(el, key).getBoundingClientRect();
          const under = note.getBoundingClientRect();
          expect(under.top, key).toBeGreaterThanOrEqual(field.bottom);
          expect(under.left, key).toBeGreaterThanOrEqual(field.left - 0.5);
          expect(under.right, key).toBeLessThanOrEqual(field.right + 0.5);
          // The note's box spans the cell whichever way it is aligned, so read where its words sit.
          const words = document.createRange();
          words.selectNodeContents(note);
          const lines = [...words.getClientRects()];
          expect(lines.length, key).toBeGreaterThan(0);
          for (const line of lines) expect(line.left, key).toBeCloseTo(field.left, 0);
        }
      });
    } finally {
      setLocale("es-ES");
    }
  },
);

/** Whether `target`, or something inside it, is what the page paints topmost at (x, y). */
function paintsTopmost(target: Element, x: number, y: number): boolean {
  let hit: Element | null = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  let node: Node | null = hit;
  while (node && node !== target) node = node.parentNode ?? (node as ShadowRoot).host ?? null;
  return node === target;
}

/** The widget inside a scroller that fills the viewport, as the dashboard's page does. */
async function mountInViewportScroller(props: Partial<MenuPricesTable>) {
  const el = await allPrices(await mount(props));
  const host = el.parentElement!;
  Object.assign(host.style, { position: "fixed", inset: "0", overflow: "auto" });
  return { el, host };
}

const manyRows = () => {
  const rows = Array.from({ length: 30 }, (_, at) => ({
    ...burger,
    menuItemId: `mi-burger-${at}`,
    name: `Burger ${at}`,
  }));
  // Lager is in the middle, so scrolling to it leaves rows under the outcome message.
  return [...rows.slice(0, 15), clashRow(lager), ...rows.slice(15)];
};

it("keeps a field scrolled into view clear of the outcome message, which paints above the rows and the sticky header", async () => {
  const { el, host } = await mountInViewportScroller({ rows: manyRows() });
  el.outcome = { kind: "saved", save: burgerSaved };
  await el.updateComplete;
  const toast = outcomeToast(el);
  const field = override(el, "mi-lager");
  field.scrollIntoView({ block: "end" });
  expect(host.scrollTop).toBeGreaterThan(0);
  expect(host.scrollTop).toBeLessThan(host.scrollHeight - host.clientHeight);
  expect(field.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    toast.getBoundingClientRect().top + 0.5,
  );
  expect(parseFloat(getComputedStyle(field).scrollMarginBlockEnd)).toBeGreaterThanOrEqual(
    toast.getBoundingClientRect().height,
  );
  // Where the message crosses a row's cell, the message is on top.
  const spot = toast.getBoundingClientRect();
  const y = spot.top + spot.height / 2;
  const crossed = [...table(el).shadowRoot.querySelectorAll<HTMLElement>("tbody td")].find(
    (cell) => {
      const box = cell.getBoundingClientRect();
      return box.top <= y && box.bottom >= y && box.left + 4 > spot.left;
    },
  )!;
  expect(crossed).toBeDefined();
  expect(paintsTopmost(toast, crossed.getBoundingClientRect().left + 4, y)).toBe(true);
  // And where it crosses a sticky header's heading.
  table(el).setAttribute("sticky-header", "");
  host.scrollTop = 0;
  const heading = [...table(el).shadowRoot.querySelectorAll<HTMLElement>("thead th")].find((th) => {
    const x = th.getBoundingClientRect().left + 4;
    return x > spot.left && x < Math.min(spot.right, window.innerWidth);
  })!;
  expect(heading).toBeDefined();
  const head = heading.getBoundingClientRect();
  el.style.marginBlockStart = `${y - (head.top + head.height / 2)}px`;
  const moved = heading.getBoundingClientRect();
  expect(moved.top).toBeLessThan(y);
  expect(moved.bottom).toBeGreaterThan(y);
  expect(paintsTopmost(toast, moved.left + 4, y)).toBe(true);
  expect(Number(getComputedStyle(toast).zIndex)).toBeGreaterThan(3);
});

it("keeps a field scrolled into view clear of an outcome message that wraps onto a second row", async () => {
  const { el, host } = await mountInViewportScroller({ rows: manyRows() });
  el.outcome = { kind: "saved", save: burgerSaved };
  await el.updateComplete;
  const toast = outcomeToast(el);
  const oneRow = toast.getBoundingClientRect().height;
  el.outcome = { kind: "saved", save: { ...burgerSaved, name: "Burger ".repeat(12).trim() } };
  await el.updateComplete;
  expect(toast.getBoundingClientRect().height).toBeGreaterThan(oneRow);
  const field = override(el, "mi-lager");
  field.scrollIntoView({ block: "end" });
  expect(host.scrollTop).toBeGreaterThan(0);
  expect(host.scrollTop).toBeLessThan(host.scrollHeight - host.clientHeight);
  expect(
    field.getBoundingClientRect().bottom,
    `message ${toast.getBoundingClientRect().height}px, margin ${getComputedStyle(field).scrollMarginBlockEnd}`,
  ).toBeLessThanOrEqual(toast.getBoundingClientRect().top + 0.5);
});

it("lets the page scroll the last row's refused field and its message clear of an open refusal, and adds no room once it closes", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  try {
    await page.viewport(390, 800);
    await vi.waitFor(() => expect(window.innerWidth).toBe(390));
    const { el, host } = await mountInViewportScroller({ rows: manyRows() });
    const last = "mi-burger-29";
    el.refusals = { [last]: "Refused here" };
    el.outcome = {
      kind: "refused",
      save: { ...burgerSaved, key: last, menuItemId: last, name: "Burger 29" },
      reason: "Refused here",
    };
    await el.updateComplete;
    const field = override(el, last);
    await vi.waitFor(() => expect(field.matches(":focus-within")).toBe(true));
    const toast = outcomeToast(el);
    expect(toast.open).toBe(true);
    host.scrollTop = host.scrollHeight;
    const top = toast.getBoundingClientRect().top;
    const message = field.shadowRoot!.querySelector("[data-error]")!;
    expect(text(message)).toBe("Refused here");
    expect(field.getBoundingClientRect().bottom).toBeLessThanOrEqual(top + 0.5);
    expect(message.getBoundingClientRect().bottom).toBeLessThanOrEqual(top + 0.5);
    const open = host.scrollHeight;
    toast.shadowRoot!.querySelector<HTMLButtonElement>("button.close")!.click();
    await toast.updateComplete;
    expect(toast.getBoundingClientRect().height).toBe(0);
    const closed = host.scrollHeight;
    el.outcome = null;
    await el.updateComplete;
    expect(override(el, last).error).toBe("Refused here");
    expect(closed).toBe(host.scrollHeight);
    expect(open).toBeGreaterThan(closed);
  } finally {
    await page.viewport(width, height);
  }
});

it("widens a field's end margin when a narrower window wraps the outcome message, after being moved", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  try {
    await page.viewport(1280, 800);
    const el = await mount();
    const host = el.parentElement!;
    el.outcome = { kind: "saved", save: { ...burgerSaved, name: "Burger ".repeat(12).trim() } };
    await el.updateComplete;
    const toast = outcomeToast(el);
    const oneRow = toast.getBoundingClientRect().height;
    host.remove();
    document.body.append(host);
    await page.viewport(414, 800);
    await vi.waitFor(() => expect(toast.getBoundingClientRect().height).toBeGreaterThan(oneRow));
    const margin = () =>
      parseFloat(getComputedStyle(override(el, "mi-lager")).scrollMarginBlockEnd);
    await vi.waitFor(() =>
      expect(margin()).toBeGreaterThanOrEqual(toast.getBoundingClientRect().height),
    );
  } finally {
    await page.viewport(width, height);
  }
});

it("marks an Inactive size's clash on neither its own row nor its product's, as publishing leaves the size out", async () => {
  const row = variantClashRow();
  const el = await allPrices(
    await mount({
      rows: [
        {
          ...row,
          variants: row.variants.map((v) =>
            v.variantId === "v-small" ? { ...v, active: false } : v,
          ),
        },
      ],
    }),
  );
  expect(cell(el, "override", "mi-lemonade").querySelector("[part~=clash]")).toBeNull();
  expect(override(el, "mi-lemonade").placeholder).toBe("3.75");
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  expect(cell(el, "override", "mi-lemonade:v-small").querySelector("[part~=clash]")).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-test="clash-message"]')).toBeNull();
});

it("keeps a disabled size under an Active product out of the product's range", async () => {
  const el = await mount({
    rows: [
      {
        ...lemonade,
        variants: [lemonade.variants[0]!, { ...lemonade.variants[1]!, active: false }],
      },
    ],
  });
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  expect(override(el, "mi-lemonade").placeholder).toBe("3.00");
});

it("opens the product page in the dashboard on a plain click, and leaves a modified click to the browser", async () => {
  const el = await mount();
  const heard = vi.fn();
  document.addEventListener("wt-edit-product", (event) => heard((event as CustomEvent).detail));
  const link = editLink(el, "mi-burger");
  const plain = new MouseEvent("click", {
    bubbles: true,
    composed: true,
    cancelable: true,
    button: 0,
  });
  link.dispatchEvent(plain);
  expect(plain.defaultPrevented).toBe(true);
  expect(heard).toHaveBeenCalledExactlyOnceWith({ productId: "p-burger" });
  const modified = new MouseEvent("click", {
    bubbles: true,
    composed: true,
    cancelable: true,
    button: 0,
    metaKey: true,
  });
  // Stop the browser following it inside the test page.
  link.addEventListener("click", (event) => event.preventDefault(), { once: true });
  link.dispatchEvent(modified);
  expect(heard).toHaveBeenCalledOnce();
});

it("opens a size's own page from its row menu's Edit product", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  const heard = vi.fn();
  el.addEventListener("wt-edit-product", (event) => heard((event as CustomEvent).detail));
  editLink(el, "mi-lemonade:v-small").dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, button: 0 }),
  );
  expect(heard).toHaveBeenCalledExactlyOnceWith({ productId: "v-small" });
});

it("puts Edit product in each row's ⋮, in a pinned actions column, and opens the product, or a size's own page, by click and by keyboard", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  const columns = (table(el) as Table & { columns: { key: string; pinned?: string }[] }).columns;
  expect(columns.at(-1)).toMatchObject({ key: "actions", pinned: "end" });
  expect(headers(el).at(-1)).toBe("");
  const labels: Record<string, string> = {
    "mi-burger": "Acciones: Burger",
    "mi-lemonade": "Acciones: Lemonade",
    "mi-lemonade:v-small": "Acciones: Lemonade — Small",
    "mi-lemonade:v-large": "Acciones: Lemonade — Large",
    "mi-lager": "Acciones: Lager",
  };
  const pages: Record<string, string> = {
    "mi-burger": "p-burger",
    "mi-lemonade": "p-lemonade",
    "mi-lemonade:v-small": "v-small",
    "mi-lemonade:v-large": "v-large",
    "mi-lager": "p-lager",
  };
  expect([...shown(el)].sort()).toEqual(Object.keys(labels).sort());
  for (const key of shown(el)) {
    const menus = pinnedCell(el, key).querySelectorAll("wt-row-actions");
    expect(menus.length, key).toBe(1);
    expect(menus[0]!.getAttribute("label"), key).toBe(labels[key]);
    expect(menus[0]!.getAttribute("data-test"), key).toBe(`actions-${key}`);
    const link = editLink(el, key);
    expect(text(link), key).toBe(t("product.edit"));
    expect(link.getAttribute("href"), key).toBe(`/manage/catalogue/product/${pages[key]}`);
  }

  const heard = vi.fn();
  el.addEventListener("wt-edit-product", (event) => heard((event as CustomEvent).detail));
  const plain = new MouseEvent("click", {
    bubbles: true,
    composed: true,
    cancelable: true,
    button: 0,
  });
  editLink(el, "mi-burger").dispatchEvent(plain);
  expect(plain.defaultPrevented).toBe(true);
  expect(heard).toHaveBeenCalledExactlyOnceWith({ productId: "p-burger" });
  const link = editLink(el, "mi-burger");
  // Stop the browser following it inside the test page.
  link.addEventListener("click", (event) => event.preventDefault(), { once: true });
  link.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      composed: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    }),
  );
  expect(heard).toHaveBeenCalledOnce();

  heard.mockClear();
  const menu = pinnedCell(el, "mi-lemonade:v-large").querySelector("wt-row-actions")!;
  menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!.focus();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true),
  );
  await userEvent.keyboard("{Tab}");
  const large = editLink(el, "mi-lemonade:v-large");
  expect(large.matches(":focus")).toBe(true);
  await userEvent.keyboard("{Enter}");
  expect(heard).toHaveBeenCalledExactlyOnceWith({ productId: "v-large" });
});

it("keeps the row menu last and pinned when a remembered column order and choice name only the other columns", async () => {
  localStorage.setItem(
    "waitron.menus.menu-prices.table:column-order",
    JSON.stringify(["status", "category", "placements", "override"]),
  );
  localStorage.setItem(
    "waitron.menus.menu-prices.table:columns",
    JSON.stringify({ category: false, status: false }),
  );
  const el = await mount();
  expect(headers(el)).not.toContain("category");
  expect(headers(el).at(-1)).toBe("");
  for (const key of shown(el)) {
    const pinned = pinnedCell(el, key);
    expect(pinned, key).toBe(row(el, key)!.lastElementChild);
    expect(editLink(el, key), key).not.toBeNull();
  }
});

it.each([
  ["en-GB", "Yes", "No"],
  ["es-ES", "Sí", "No"],
])(
  "shows Available as Yes or No for a product and for a size, each by its own flag (%s)",
  async (locale, yes, no) => {
    setLocale(locale);
    try {
      const el = await mount({
        rows: [
          { ...burger, available: false },
          {
            ...lemonade,
            available: true,
            variants: [
              { ...lemonade.variants[0]!, available: false },
              { ...lemonade.variants[1]!, available: true },
            ],
          },
        ],
      });
      toggleOf(el, "mi-lemonade")!.click();
      await table(el).updateComplete;
      expect([t("menus.available_yes"), t("menus.available_no")]).toEqual([yes, no]);
      const keys = ["mi-burger", "mi-lemonade", "mi-lemonade:v-small", "mi-lemonade:v-large"];
      expect(keys.map((key) => text(cell(el, "available", key)))).toEqual([no, yes, no, yes]);
    } finally {
      setLocale("es-ES");
    }
  },
);

it("shows a sold-out size as No under an available product, and an available size as Yes under a sold-out one", async () => {
  const el = await mount({
    rows: [
      {
        ...lemonade,
        available: false,
        variants: [
          { ...lemonade.variants[0]!, available: true },
          { ...lemonade.variants[1]!, available: false },
        ],
      },
    ],
  });
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  expect(column(el, "available")).toEqual([
    t("menus.available_no"),
    t("menus.available_yes"),
    t("menus.available_no"),
  ]);
});

it("has no Status column: Available takes its place, before the row menu", async () => {
  const el = await mount();
  expect(headers(el)).not.toContain("status");
  expect(headers(el).slice(-2)).toEqual(["available", ""]);
  const heading = table(el).shadowRoot.querySelector('[data-sort="available"]')!.closest("th")!;
  expect(text(heading)).toContain(t("editor.available"));
  const filters = table(el).shadowRoot;
  expect(filters.querySelector('wt-combobox[data-filter="category"]')).not.toBeNull();
  expect(filters.querySelector('[data-filter="available"]')).toBeNull();
  expect(filters.querySelector('[data-section="available"]')).toBeNull();
});

it("does not match a row by its Available value in a search", async () => {
  const el = await mount({ rows: [{ ...lager, available: false }] });
  await search(el, "lager");
  expect(shown(el)).toEqual(["mi-lager"]);
  // Available sorts an unavailable row as 1; nothing else the row shows holds a 1.
  await search(el, "1");
  expect(shown(el)).toEqual([]);
  expect(text(table(el).shadowRoot.querySelector(".empty .message"))).toBe(
    tableNoMatches(currentLocale()),
  );
});

it.each(["es-ES", "en-GB"])(
  "does not match a row by its Available word, Yes or No, in a search (%s)",
  async (locale) => {
    setLocale(locale);
    try {
      // No name, category, section or price here holds either word.
      const el = await mount({ rows: [{ ...lager, available: false }, burger] });
      await search(el, "lager");
      expect(shown(el)).toEqual(["mi-lager"]);
      await search(el, "burger");
      expect(shown(el)).toEqual(["mi-burger"]);
      for (const word of [t("menus.available_no"), t("menus.available_yes")]) {
        await search(el, word);
        expect(shown(el), word).toEqual([]);
      }
    } finally {
      setLocale("es-ES");
    }
  },
);

it("sorts by Available, available first and then sold out, and keeps each product's sizes in the catalogue's order", async () => {
  const el = await mount({
    rows: [
      { ...burger, available: false },
      {
        ...lemonade,
        available: true,
        variants: [
          { ...lemonade.variants[0]!, available: false },
          { ...lemonade.variants[1]!, available: true },
        ],
      },
      lager,
    ],
  });
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  await sortBy(el, "available");
  expect(shown(el)).toEqual([
    "mi-lemonade",
    "mi-lemonade:v-small",
    "mi-lemonade:v-large",
    "mi-lager",
    "mi-burger",
  ]);
  expect(column(el, "available")).toEqual(
    [true, false, true, true, false].map((yes) =>
      t(yes ? "menus.available_yes" : "menus.available_no"),
    ),
  );
  await sortBy(el, "available");
  expect(shown(el)).toEqual([
    "mi-burger",
    "mi-lemonade",
    "mi-lemonade:v-small",
    "mi-lemonade:v-large",
    "mi-lager",
  ]);
});

it("draws Available when a remembered column choice and order still name the old Status column", async () => {
  localStorage.setItem(
    "waitron.menus.menu-prices.table:columns",
    JSON.stringify({ status: false }),
  );
  localStorage.setItem(
    "waitron.menus.menu-prices.table:column-order",
    JSON.stringify(["status", "category", "placements", "override"]),
  );
  const el = await mount();
  expect(headers(el)).toContain("available");
  expect(headers(el)).not.toContain("status");
  expect(column(el, "available")).toEqual(shown(el).map(() => t("menus.available_yes")));
});

it("a sold-out product reads No in Available", async () => {
  const el = await mount({ rows: [{ ...burger, active: true, available: false }] });
  expect(text(cell(el, "available", "mi-burger"))).toBe(t("menus.available_no"));
  expect(text(cell(el, "available", "mi-burger"))).not.toContain(t("product.active_badge"));
});

it("uses the server's variant price and fallback even when the catalogue differs", async () => {
  const source = {
    ...lemonade,
    combined: {
      ...lemonade.combined,
      variants: lemonade.combined.variants.map((v) => ({
        ...v,
        price: {
          state: "decided",
          value: "8.00",
          source: drinksSource,
          otherwise: null,
          level: "size",
        },
      })),
    },
  } as MenuPriceRow;
  const el = await mount({ rows: [source] });
  table(el)
    .shadowRoot.querySelector<HTMLButtonElement>(
      'tr[data-row-key="mi-lemonade"] button.tree-toggle',
    )!
    .click();
  await table(el).updateComplete;
  expect(override(el, "mi-lemonade:v-small").placeholder).toBe("8.00");
});
it("gives a size following its product this menu's price as its placeholder, and the product the range its sizes would take", async () => {
  const el = await mount({ rows: [lemonade] });
  table(el)
    .shadowRoot.querySelector<HTMLButtonElement>(
      'tr[data-row-key="mi-lemonade"] button.tree-toggle',
    )!
    .click();
  await table(el).updateComplete;
  // The small follows the product's price on this menu, which is this menu's own 2.50.
  expect(override(el, "mi-lemonade:v-small").placeholder).toBe("2.50");
  // With the product's field blank the small would follow the product's own 3.00, which is what
  // the product's placeholder, 3.00 – 3.75, counts.
  expect(override(el, "mi-lemonade").placeholder).toBe("3.00 – 3.75");
});

it("names the included menu's price, not the product's own, as what a blank field inherits", async () => {
  setLocale("en-GB");
  try {
    const source = {
      ...lager,
      override: "4.00",
      combined: {
        ...lager.combined,
        price: {
          state: "decided",
          value: "4.00",
          source: { kind: "own" },
          otherwise: { state: "decided", value: "3.50", source: drinksSource, otherwise: null },
        },
      },
    } as MenuPriceRow;
    const el = await mount({ rows: [source] });
    expect(override(el, source.menuItemId).value).toBe("4.00");
    // The product's own 2.00 is not what this menu falls back to.
    expect(hintOf(override(el, source.menuItemId))).toBe(
      "Leave it empty to use the inherited price, €3.50.",
    );
  } finally {
    setLocale("es-ES");
  }
});

it.each(["en-GB", "es-ES"])(
  "shows a product's own price in its field, and, without one, says its menu prices are on its sizes (%s)",
  async (locale) => {
    setLocale(locale);
    try {
      const priced = {
        ...lemonade,
        override: "4.00",
        variants: [
          { variantId: "v-small", price: null, active: true, available: true },
          { variantId: "v-large", price: "14.00", active: true, available: true },
        ],
        combined: {
          ...lemonade.combined,
          price: {
            state: "decided",
            value: "4.00",
            source: { kind: "own" },
            otherwise: {
              state: "decided",
              value: "3.00",
              source: { kind: "product" },
              otherwise: null,
            },
          },
          variants: [
            {
              variantId: "v-small",
              price: {
                state: "decided",
                value: "6.00",
                source: { kind: "product" },
                otherwise: null,
              },
            },
            {
              variantId: "v-large",
              price: {
                state: "decided",
                value: "14.00",
                source: { kind: "own" },
                otherwise: {
                  state: "decided",
                  value: "12.00",
                  source: { kind: "product" },
                  otherwise: null,
                },
              },
            },
          ],
        },
      } as MenuPriceRow;
      const el = await mount({ rows: [priced] });
      expect(override(el, "mi-lemonade").value).toBe("4.00");
      const aggregate = await mount({ rows: [{ ...priced, override: null }] });
      const aggregateCell = cell(aggregate, "override", "mi-lemonade");
      expect(visibleText(aggregateCell)).toBe(t("menu_prices.variant_overrides"));
    } finally {
      setLocale("es-ES");
    }
  },
);

describe("without a switch of the menu's own", () => {
  it("has no On this menu column, to show or to choose", async () => {
    const el = await mount();
    expect(headers(el)).not.toContain("active");
    const choosable = [
      ...table(el).shadowRoot.querySelectorAll<HTMLInputElement>("input[data-column]"),
    ].map((box) => box.dataset.column);
    expect(choosable).toContain("available");
    expect(choosable).not.toContain("active");
  });

  it("edits only prices: no row holds a switch or a chooser, and a commit sends a price alone", async () => {
    const el = await mount();
    toggleOf(el, "mi-lemonade")!.click();
    await table(el).updateComplete;
    const body = table(el).shadowRoot.querySelector("tbody")!;
    expect(body.querySelector('[name="offered"]')).toBeNull();
    for (const id of ["v-small", "v-large"])
      expect(body.querySelector(`[name="offered-${id}"]`), id).toBeNull();
    expect(body.querySelector("wt-combobox")).toBeNull();
    const heard = priceSaves(el);
    await typeIn(el, "mi-lemonade", "2.80");
    await press(el, "mi-lemonade", "Enter");
    await typeIn(el, "mi-lemonade:v-large", "4.00");
    await press(el, "mi-lemonade:v-large", "Enter");
    expect(heard.mock.calls).toEqual([
      [
        {
          key: "mi-lemonade",
          menuItemId: "mi-lemonade",
          variantId: null,
          name: "Lemonade",
          price: "2.80",
          previous: "2.50",
        },
      ],
      [
        {
          key: "mi-lemonade:v-large",
          menuItemId: "mi-lemonade",
          variantId: "v-large",
          name: "Lemonade — Large",
          price: "4.00",
          previous: "3.75",
        },
      ],
    ]);
  });

  it("counts a size's own price toward the product's inherited range", async () => {
    const el = await mount({ rows: [lemonade] });
    // The large's 3.75 on this menu is above the 3.00 the small inherits with the product blank.
    expect(hintOf(override(el, "mi-lemonade"))).toBe(
      t("menu_prices.override_help_range").replace(
        "{range}",
        t("menu_prices.range").replace("{low}", eur("3.00")).replace("{high}", eur("3.75")),
      ),
    );
  });
});

it("puts the prices table's Filters before its search, beside the rows on a wide screen", async () => {
  await expectFiltersFirst(async () => table(await mount()), cleanupWidgets);
});

it("draws no help tooltip, and one row menu per drawn row in a pinned actions column, on a load holding a product clash and a size clash", async () => {
  const el = await allPrices(await mount({ rows: [clashRow(lager), variantClashRow()] }));
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  const root = table(el).shadowRoot;
  expect(shown(el)).toEqual([
    "mi-lager",
    "mi-lemonade",
    "mi-lemonade:v-small",
    "mi-lemonade:v-large",
  ]);
  expect(clashMarker(el, "mi-lager")).toBe(clashSentences["es-ES"].prices);
  expect(clashMarker(el, "mi-lemonade:v-small")).toBe(clashSentences["es-ES"].prices);
  expect(root.querySelectorAll("wt-help-tooltip").length).toBe(0);
  expect(root.querySelectorAll("wt-row-actions").length).toBe(shown(el).length);
  for (const key of shown(el)) {
    expect(pinnedCell(el, key).querySelectorAll("wt-row-actions").length, key).toBe(1);
  }
  const columns = (table(el) as Table & { columns: { key: string; pinned?: string }[] }).columns;
  expect(columns.at(-1)).toMatchObject({ key: "actions", pinned: "end" });
});

describe("the clash message and the Clashes filter", () => {
  /** Lager with this menu's own price deciding what was its clash. */
  const settledLager: MenuPriceRow = {
    ...lager,
    override: "2.20",
    combined: {
      ...lager.combined,
      price: { state: "decided", value: "2.20", source: { kind: "own" }, otherwise: clashPrice },
    } as MenuPriceRow["combined"],
  };
  /** Lemonade with no price of this menu's own, its clash followed by both its sizes, as
   * `combineOffer` builds it. */
  function followedClashRow(): MenuPriceRow {
    const followed = { ...clashPrice, level: "product" };
    return {
      ...lemonade,
      override: null,
      combined: {
        productId: "p-lemonade",
        price: clashPrice,
        variants: [
          { variantId: "v-small", price: followed },
          { variantId: "v-large", price: followed },
        ],
      },
      variants: [
        { variantId: "v-small", price: null, active: true, available: true },
        { variantId: "v-large", price: null, active: true, available: true },
      ],
    } as MenuPriceRow;
  }
  const message = (el: MenuPricesTable) =>
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="clash-message"]');

  async function expand(el: MenuPricesTable, key: string): Promise<void> {
    toggleOf(el, key)!.click();
    await table(el).updateComplete;
  }

  async function reread(el: MenuPricesTable, rows: MenuPriceRow[]): Promise<void> {
    el.rows = rows;
    await el.updateComplete;
    await table(el).updateComplete;
  }

  it.each([
    {
      kind: "a clashing product without variants",
      rows: () => [burger, clashRow(lager)],
      count: 1,
      start: ["mi-lager"],
    },
    {
      kind: "a product whose two variants follow its clash",
      rows: () => [burger, followedClashRow()],
      count: 2,
      start: ["mi-lemonade"],
    },
    {
      kind: "a size clash on one variant",
      rows: () => [burger, variantClashRow()],
      count: 1,
      start: ["mi-lemonade"],
    },
  ])(
    "counts $count clashing price(s) for $kind, says so in red above the table, and starts on Clashes",
    async ({ rows, count, start }) => {
      setLocale("en-GB");
      try {
        const el = await mount({ rows: rows() });
        const said = message(el)!;
        expect(text(said)).toBe(
          count === 1
            ? "1 price clashes. Settle it before this menu can be published."
            : `${count} prices clash. Settle them before this menu can be published.`,
        );
        expect(said.getAttribute("role")).toBe("status");
        expect(said.compareDocumentPosition(table(el)) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
        const probe = document.createElement("span");
        probe.style.color = "var(--wt-color-danger)";
        el.parentElement!.appendChild(probe);
        expect(getComputedStyle(said).color).toBe(getComputedStyle(probe).color);
        expect(
          table(el).shadowRoot.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
            'wt-combobox[data-filter="override"]',
          )!.value,
        ).toBe("clash");
        expect(shown(el)).toEqual(start);
      } finally {
        setLocale("es-ES");
      }
    },
  );

  it("under Clashes keeps a size clash's product and, opened, only its clashing size", async () => {
    const el = await mount({ rows: [burger, variantClashRow()] });
    await expand(el, "mi-lemonade");
    expect(shown(el)).toEqual(["mi-lemonade", "mi-lemonade:v-small"]);
  });

  it("under Clashes keeps both sizes that follow their product's clash, once it is opened", async () => {
    const el = await mount({ rows: [burger, followedClashRow()] });
    await expand(el, "mi-lemonade");
    expect(shown(el)).toEqual(["mi-lemonade", "mi-lemonade:v-small", "mi-lemonade:v-large"]);
  });

  it("says nothing and starts on all prices, offering no Clashes, on a load without a clash", async () => {
    setLocale("en-GB");
    try {
      const el = await mount();
      expect(message(el)).toBeNull();
      expect(shown(el)).toEqual(["mi-burger", "mi-lemonade", "mi-lager"]);
      expect(options(el, "override")).toEqual(["All prices", "Overridden only", "Not overridden"]);
    } finally {
      setLocale("es-ES");
    }
  });

  it("offers Overridden only, Not overridden and Clashes on a load with a clash", async () => {
    setLocale("en-GB");
    try {
      const el = await mount({ rows: [burger, clashRow(lager)] });
      expect(options(el, "override")).toEqual([
        "All prices",
        "Overridden only",
        "Not overridden",
        "Clashes",
      ]);
    } finally {
      setLocale("es-ES");
    }
  });

  it("shows every row once the person clears the filter", async () => {
    const el = await mount({ rows: [burger, clashRow(lager)] });
    await choose(el, "override", "");
    expect(shown(el)).toEqual(["mi-burger", "mi-lager"]);
    expect(message(el)).not.toBeNull();
  });

  it("starts on Clashes when the rows arrive after loading, and decides again after the next load", async () => {
    const el = await mount({ rows: [], loading: true });
    await reread(el, [burger, clashRow(lager)]);
    el.loading = false;
    await el.updateComplete;
    await table(el).updateComplete;
    expect(shown(el)).toEqual(["mi-lager"]);

    el.loading = true;
    el.rows = [];
    await el.updateComplete;
    el.rows = [burger, lager];
    el.loading = false;
    await el.updateComplete;
    await table(el).updateComplete;
    expect(shown(el)).toEqual(["mi-burger", "mi-lager"]);
    expect(message(el)).toBeNull();
  });

  async function load(el: MenuPricesTable, rows: MenuPriceRow[]): Promise<void> {
    el.loading = true;
    el.rows = [];
    await el.updateComplete;
    await table(el).updateComplete;
    el.rows = rows;
    el.loading = false;
    await el.updateComplete;
    await table(el).updateComplete;
  }

  const priceFilter = (el: MenuPricesTable) =>
    table(el).shadowRoot.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      'wt-combobox[data-filter="override"]',
    )!.value;

  it("starts on Clashes once a failed load is followed by one with a clash", async () => {
    const el = await mount({ rows: [], failed: true });
    el.failed = false;
    await reread(el, [burger, clashRow(lager)]);
    expect(priceFilter(el)).toBe("clash");
    expect(shown(el)).toEqual(["mi-lager"]);
  });

  it("keeps the person's All prices when the next menu loaded has a clash", async () => {
    const el = await mount({ rows: [burger, clashRow(lager)] });
    await choose(el, "override", "");
    await load(el, [burger, variantClashRow()]);
    expect(priceFilter(el)).toBe("");
    expect(shown(el)).toEqual(["mi-burger", "mi-lemonade"]);
    expect(message(el)).not.toBeNull();
  });

  it("keeps the person's All prices through a menu without a clash and into one with a clash", async () => {
    const el = await mount({ rows: [burger, clashRow(lager)] });
    await choose(el, "override", "");
    await load(el, [burger, lager]);
    await load(el, [burger, clashRow(lager)]);
    expect(priceFilter(el)).toBe("");
    expect(shown(el)).toEqual(["mi-burger", "mi-lager"]);
  });

  it("keeps the person's Not overridden when the next menu loaded has a clash", async () => {
    const el = await mount({ rows: [burger, clashRow(lager)] });
    await choose(el, "override", "not_overridden");
    await load(el, [burger, lemonade, clashRow(lager)]);
    expect(priceFilter(el)).toBe("not_overridden");
    expect(shown(el)).toEqual(["mi-burger", "mi-lemonade", "mi-lemonade:v-small", "mi-lager"]);
  });

  const showClashes = (el: MenuPricesTable) =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="show-clashes"]');

  it("offers no Show clashes while the filter is on Clashes, or when nothing clashes", async () => {
    const el = await mount({ rows: [burger, clashRow(lager)] });
    expect(priceFilter(el)).toBe("clash");
    expect(showClashes(el)).toBeNull();
    const calm = await mount();
    expect(showClashes(calm)).toBeNull();
    await choose(calm, "override", "overridden");
    expect(showClashes(calm)).toBeNull();
  });

  it.each([
    ["en-GB", "Show clashes"],
    ["es-ES", "Ver discrepancias"],
  ])(
    "offers %s Show clashes beside the red line once another filter is chosen, and a click puts the filter back on Clashes",
    async (locale, label) => {
      setLocale(locale);
      try {
        const el = await mount({ rows: [burger, clashRow(lager)] });
        await choose(el, "override", "");
        await el.updateComplete;
        const button = showClashes(el)!;
        expect(text(button)).toBe(label);
        expect(button.variant).toBe("ghost");
        expect(message(el)!.contains(button)).toBe(false);
        await userEvent.click(button);
        await el.updateComplete;
        await table(el).updateComplete;
        expect(priceFilter(el)).toBe("clash");
        expect(shown(el)).toEqual(["mi-lager"]);
        expect(showClashes(el)).toBeNull();
      } finally {
        setLocale("es-ES");
      }
    },
  );

  it("puts the filter back on Clashes from the keyboard", async () => {
    const el = await mount({ rows: [burger, clashRow(lager)] });
    await choose(el, "override", "not_overridden");
    await el.updateComplete;
    showClashes(el)!.focus();
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    await table(el).updateComplete;
    expect(priceFilter(el)).toBe("clash");
    expect(showClashes(el)).toBeNull();
  });

  it("moves focus from Show clashes, which goes, to the first clashing row's field", async () => {
    const el = await mount({ rows: [burger, variantClashRow(), clashRow(lager)] });
    await choose(el, "override", "");
    await el.updateComplete;
    showClashes(el)!.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(table(el).shadowRoot.activeElement).not.toBeNull());
    expect(shown(el)[0]).toBe("mi-lemonade");
    expect(table(el).shadowRoot.activeElement).toBe(override(el, "mi-lemonade"));
  });

  it("moves focus from Show clashes to the search box when the search leaves no clashing row", async () => {
    const el = await mount({ rows: [burger, clashRow(lager)] });
    await choose(el, "override", "");
    await search(el, "Burger");
    await el.updateComplete;
    showClashes(el)!.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(table(el).shadowRoot.activeElement).not.toBeNull());
    expect(shown(el)).toEqual([]);
    expect(table(el).shadowRoot.activeElement).toBe(
      table(el).shadowRoot.querySelector('input[name="search"]'),
    );
  });

  it("offers Show clashes on a return to the tab whose remembered filter is All prices", async () => {
    const first = await mount({ rows: [burger, clashRow(lager)] });
    await choose(first, "override", "");
    cleanupWidgets();
    const el = await mount({ rows: [burger, clashRow(lager)] });
    await vi.waitFor(() => expect(showClashes(el)).not.toBeNull());
    expect(priceFilter(el)).toBe("");
  });

  it("keeps exactly the right products and variants under each price filter", async () => {
    const el = await mount({ rows: [burger, variantClashRow(), clashRow(lager)] });
    await choose(el, "override", "");
    await expand(el, "mi-lemonade");
    expect(shown(el)).toEqual([
      "mi-burger",
      "mi-lemonade",
      "mi-lemonade:v-small",
      "mi-lemonade:v-large",
      "mi-lager",
    ]);
    await choose(el, "override", "overridden");
    expect(shown(el)).toEqual(["mi-lemonade", "mi-lemonade:v-large"]);
    await choose(el, "override", "not_overridden");
    expect(shown(el)).toEqual(["mi-burger", "mi-lemonade", "mi-lemonade:v-small", "mi-lager"]);
    await choose(el, "override", "clash");
    expect(shown(el)).toEqual(["mi-lemonade", "mi-lemonade:v-small", "mi-lager"]);
  });

  it("keeps a clashing row under Clashes while a price is typed into it", async () => {
    const el = await mount({ rows: [burger, clashRow(lager)] });
    await typeIn(el, "mi-lager", "2.80");
    await table(el).updateComplete;
    expect(shown(el)).toEqual(["mi-lager"]);
    expect(override(el, "mi-lager").value).toBe("2.80");
  });

  it("drops the message and the Clashes option, and shows every row, once a re-read has no clash", async () => {
    setLocale("en-GB");
    try {
      const el = await mount({ rows: [burger, clashRow(lager)] });
      await reread(el, [burger, settledLager]);
      expect(message(el)).toBeNull();
      expect(options(el, "override")).toEqual(["All prices", "Overridden only", "Not overridden"]);
      expect(shown(el)).toEqual(["mi-burger", "mi-lager"]);
    } finally {
      setLocale("es-ES");
    }
  });

  it("stays on all prices when Undo brings the last clash back, and says it again", async () => {
    const el = await mount({ rows: [burger, clashRow(lager)] });
    await reread(el, [burger, settledLager]);
    const heard = priceSaves(el);
    el.outcome = {
      kind: "saved",
      save: {
        ...burgerSaved,
        key: "mi-lager",
        menuItemId: "mi-lager",
        name: "Lager",
        price: "2.20",
      },
    };
    await el.updateComplete;
    undoButton(el)!.click();
    await el.updateComplete;
    expect(heard).toHaveBeenCalledOnce();
    await reread(el, [burger, clashRow(lager)]);
    expect(shown(el)).toEqual(["mi-burger", "mi-lager"]);
    expect(message(el)).not.toBeNull();
  });

  it("says the clash message in Spanish", async () => {
    const one = await mount({ rows: [burger, clashRow(lager)] });
    expect(text(message(one))).toBe(
      "1 precio tiene una discrepancia. Resuélvela antes de poder publicar esta carta.",
    );
    const two = await mount({ rows: [burger, followedClashRow()] });
    expect(text(message(two))).toBe(
      "2 precios tienen discrepancias. Resuélvelas antes de poder publicar esta carta.",
    );
  });
});

describe("the clash count, marks and Clashes filter read what publishing refuses", () => {
  const decidedSize = (value: string) => ({
    state: "decided",
    value,
    source: { kind: "product" },
    otherwise: null,
    level: "size",
  });
  const decidedPrice = {
    state: "decided",
    value: "3.00",
    source: { kind: "product" },
    otherwise: null,
  };
  /** A product this menu sets no price for, each size's combined price as given. */
  function shapeRow(
    id: string,
    price: unknown,
    sizes: { variantId: string; active: boolean; price: unknown }[],
    active = true,
  ): MenuPriceRow {
    return {
      menuItemId: `mi-${id}`,
      productId: `p-${id}`,
      name: id,
      categoryId: null,
      placements: [[]],
      override: null,
      effectivePrice: "3.00",
      active,
      available: true,
      combined: {
        productId: `p-${id}`,
        price,
        variants: sizes.map(({ variantId, price }) => ({ variantId, price })),
      },
      variants: sizes.map(({ variantId, active }) => ({
        variantId,
        price: null,
        active,
        available: true,
      })),
    } as MenuPriceRow;
  }
  const shapes = {
    i: () => clashRow(lager),
    ii: () => variantClashRow(),
    iii: () =>
      shapeRow("cola", clashPrice, [
        { variantId: "v-c1", active: true, price: decidedSize("2.00") },
        { variantId: "v-c2", active: true, price: decidedSize("2.40") },
      ]),
    iv: () => clashRow({ ...lager, menuItemId: "mi-cider", productId: "p-cider" }, clashPrice),
    v: () =>
      shapeRow("tonic", decidedPrice, [
        { variantId: "v-t1", active: false, price: { ...clashPrice, level: "size" } },
        { variantId: "v-t2", active: true, price: decidedSize("2.00") },
      ]),
    vi: () =>
      shapeRow("juice", clashPrice, [
        { variantId: "v-j1", active: false, price: decidedSize("2.00") },
      ]),
  };
  const inactiveCider = () => ({ ...shapes.iv(), active: false });

  const message = (el: MenuPricesTable) =>
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="clash-message"]');

  /** Opens every product row shown, then reads the rows shown. */
  async function openedRows(el: MenuPricesTable): Promise<string[]> {
    for (const key of shown(el)) {
      const toggle = toggleOf(el, key);
      if (toggle !== null && text(toggle) === "▸") {
        toggle.click();
        await table(el).updateComplete;
      }
    }
    return shown(el);
  }

  /** Every row carrying the red clash sentence, every product opened, under All prices. */
  async function marked(el: MenuPricesTable): Promise<string[]> {
    await choose(el, "override", "");
    const rows = await openedRows(el);
    return rows.filter((key) => cell(el, "override", key).querySelector("[part~=clash]") !== null);
  }

  async function check(
    rows: MenuPriceRow[],
    expected: { count: number; marked: string[]; underClashes: string[] },
  ): Promise<void> {
    setLocale("en-GB");
    try {
      const el = await mount({ rows });
      const said = message(el);
      if (expected.count === 0) expect(said).toBeNull();
      else expect(text(said).split(" ")[0]).toBe(String(expected.count));
      const offersClashes = options(el, "override").includes("Clashes");
      expect(offersClashes).toBe(expected.underClashes.length > 0);
      if (offersClashes) {
        await choose(el, "override", "clash");
        expect(await openedRows(el)).toEqual(expected.underClashes);
      }
      expect(await marked(el)).toEqual(expected.marked);
    } finally {
      setLocale("es-ES");
    }
  }

  it("(i) a product without variants whose price clashes: counted, marked and under Clashes", async () => {
    await check([burger, shapes.i()], {
      count: 1,
      marked: ["mi-lager"],
      underClashes: ["mi-lager"],
    });
  });

  it("(ii) an Active size's clash: counted, its product and size marked and under Clashes", async () => {
    await check([burger, shapes.ii()], {
      count: 1,
      marked: ["mi-lemonade", "mi-lemonade:v-small"],
      underClashes: ["mi-lemonade", "mi-lemonade:v-small"],
    });
  });

  it("(iii) a product whose own price clashes but every Active size is priced at size level: nothing", async () => {
    await check([burger, shapes.iii()], { count: 0, marked: [], underClashes: [] });
  });

  it("(iv) an Inactive product whose price clashes: nothing", async () => {
    await check([burger, inactiveCider()], { count: 0, marked: [], underClashes: [] });
  });

  it("(v) an Inactive size's clash under an Active product: nothing", async () => {
    await check([burger, shapes.v()], { count: 0, marked: [], underClashes: [] });
  });

  it("(vi) a product whose every size is Inactive and whose own price clashes: counted and marked on its own price", async () => {
    await check([burger, shapes.vi()], {
      count: 1,
      marked: ["mi-juice"],
      underClashes: ["mi-juice"],
    });
  });

  it("counts 3 with all six on one table, the number publishing would refuse", async () => {
    await check(
      [burger, shapes.i(), shapes.ii(), shapes.iii(), inactiveCider(), shapes.v(), shapes.vi()],
      {
        count: 3,
        marked: ["mi-lager", "mi-lemonade", "mi-lemonade:v-small", "mi-juice"],
        underClashes: ["mi-lager", "mi-lemonade", "mi-lemonade:v-small", "mi-juice"],
      },
    );
  });
});
