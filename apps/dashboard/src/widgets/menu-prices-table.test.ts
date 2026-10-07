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
  variants: [
    { variantId: "v-small", price: null, active: true },
    { variantId: "v-large", price: "3.75", active: true },
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

/** A cell's text as it is seen: without the tree's toggle glyph or a help tooltip's text. */
function visibleText(node: Element | undefined): string {
  if (node === undefined) return "";
  const clone = node.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll(".tree-toggle, wt-help-tooltip")) hidden.remove();
  return text(clone);
}

/** One column's cell in one shown row. */
function cell(el: MenuPricesTable, key: string, rowKey: string): HTMLElement {
  const index = headers(el).indexOf(key);
  expect(index, key).toBeGreaterThanOrEqual(0);
  return row(el, rowKey)!.children[index] as HTMLElement;
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
          { variantId: "v-small", price: null, active: true },
          { variantId: "v-large", price: "4.25", active: true },
        ],
      },
      {
        ...lager,
        combined: combinedFixture("p-lager", "2.00", [{ variantId: "v-small", price: null }]),
        variants: [{ variantId: "v-small", price: null, active: true }],
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
        { variantId: "v-small", price: "1.00", active: true },
        { variantId: "v-large", price: "3.75", active: true },
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
    t("menu_prices.override_label").replace("{name}", `Lemonade — ${t("members.missing")}`),
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

it("stops the Resolve clicks that ask, so nothing past the widget hears them", async () => {
  const el = await mount({ rows: [clashRow(lager)] });
  const clicks: Event[] = [];
  el.addEventListener("click", (event) => clicks.push(event));
  const heard = priceSaves(el);
  const actions = row(el, "mi-lager")!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
    "wt-row-actions",
  )!;
  await actions.updateComplete;
  for (const button of actions.querySelectorAll<HTMLElement>("wt-button")) {
    actions.show();
    button.click();
  }
  await el.updateComplete;
  expect(heard).toHaveBeenCalledTimes(2);
  expect(clicks).toEqual([]);
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

it("names the price typed for a product in a following size's tooltip as in its placeholder, and the inherited one once emptied", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  const tip = () =>
    cell(el, "override", "mi-lemonade:v-small")
      .querySelector("wt-help-tooltip")!
      .textContent!.trim();
  await typeIn(el, "mi-lemonade", "2.80");
  expect(override(el, "mi-lemonade:v-small").placeholder).toBe("2.80");
  expect(tip()).toBe(
    "Sigue el precio de Lemonade en esta carta. Esta carta fija 2,80 €. Sin él: 3,00 €, el precio propio del producto.",
  );
  await typeIn(el, "mi-lemonade", "");
  expect(override(el, "mi-lemonade:v-small").placeholder).toBe("3.00");
  expect(tip()).toBe("Sigue el precio de Lemonade en esta carta. El precio propio del producto.");
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

  it("says a refusal in an open info toast with no Undo that stays until replaced", async () => {
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

it("'Set a price…' in Resolve focuses the row's field", async () => {
  const el = await mount({ rows: [clashRow(lager)] });
  const actions = row(el, "mi-lager")!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
    "wt-row-actions",
  )!;
  await actions.updateComplete;
  actions.show();
  [...actions.querySelectorAll<HTMLElement>("wt-button")].at(-1)!.click();
  await el.updateComplete;
  const input = override(el, "mi-lager");
  expect(input.shadowRoot!.activeElement).toBe(input.shadowRoot!.querySelector("input"));
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
    variants: [
      { variantId: "v-glass", price: "7.00", active: true },
      { variantId: "v-bottle", price: null, active: true },
      { variantId: "v-carafe", price: "15.00", active: true },
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
    variants: [
      { variantId: "v-juice-small", price: "3.50", active: true },
      { variantId: "v-juice-large", price: null, active: true },
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
    variants: [{ variantId: "v-pot", price: "2.40", active: true }],
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
    variants: [
      { variantId: "v-pint", price: null, active: true },
      { variantId: "v-half", price: null, active: true },
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
            { variantId: "v-juice-small", price: "5.0", active: true },
            { variantId: "v-juice-large", price: null, active: true },
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
      variants: [
        { variantId: "v-zeta", price: null, active: true },
        { variantId: "v-alpha", price: null, active: true },
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

  it("offers Appears under, Main category and Status in the column chooser, all shown, and keeps the choice under the menu prices key alone", async () => {
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
      ["status", true],
    ]);
    expect(headers(el)).toEqual(["name", "override", "placements", "category", "status", ""]);
    box(el, "category").click();
    await table(el).updateComplete;
    expect(headers(el)).not.toContain("category");
    expect(JSON.parse(localStorage.getItem("waitron.menus.menu-prices.table:columns")!)).toEqual({
      category: false,
    });
    const again = await mountVariants();
    expect(headers(again)).toEqual(["name", "override", "placements", "status", ""]);
    table(again).shadowRoot.querySelector<HTMLElement>("[data-restore-columns]")!.click();
    await table(again).updateComplete;
    expect(headers(again)).toEqual(["name", "override", "placements", "category", "status", ""]);
  });

  it("counts Active sizes only in a product's tooltip", async () => {
    setLocale("en-GB");
    try {
      const inactiveLarge = {
        ...lemonade,
        override: null,
        variants: [lemonade.variants[0]!, { ...lemonade.variants[1]!, active: false }],
      };
      const el = await mount({
        rows: [inactiveLarge, { ...lager, active: false, override: "4.00" }],
      });
      const tip = cell(el, "override", "mi-lemonade").querySelector("wt-help-tooltip")!;
      expect(tip.textContent).toContain("Small");
      expect(tip.textContent).not.toContain("Large");
    } finally {
      setLocale("es-ES");
    }
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
            { variantId: "v-juice-small", price: "1000.00", active: true },
            { variantId: "v-juice-large", price: "9999.99", active: true },
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
function clashRow(source = lager): MenuPriceRow {
  return { ...source, combined: { ...source.combined, price: clashPrice } };
}
/** Lemonade at its own 2.50, its small size's sources disagreeing at size level. */
function variantClashRow(): MenuPriceRow {
  return {
    ...lemonade,
    combined: {
      ...lemonade.combined,
      variants: lemonade.combined.variants.map((v, at) =>
        at === 0 ? { ...v, price: { ...clashPrice, level: "size" } } : v,
      ),
    },
  } as MenuPriceRow;
}
it.each(["product", "size"])(
  "hides Resolve while a valid unsaved price fills a clashing %s row",
  async (kind) => {
    const el = await mount({ rows: [kind === "product" ? clashRow(lager) : variantClashRow()] });
    const key = kind === "product" ? "mi-lager" : "mi-lemonade:v-small";
    if (kind === "size") {
      toggleOf(el, "mi-lemonade")!.click();
      await table(el).updateComplete;
    }
    const actions = () => row(el, key)!.querySelector("wt-row-actions");
    const heard = priceSaves(el);
    expect(actions()).not.toBeNull();
    await typeIn(el, key, "2.80");
    await table(el).updateComplete;
    expect(actions()).toBeNull();
    expect(clashMarker(el, key)).toBe("");
    expect(override(el, key).value).toBe("2.80");
    expect(heard).not.toHaveBeenCalled();

    for (const value of ["", "-1", "abc"]) {
      await typeIn(el, key, value);
      await table(el).updateComplete;
      expect(actions()).not.toBeNull();
      expect(clashMarker(el, key)).toBe(t("menu_prices.clash"));
      await typeIn(el, key, "2.80");
      await table(el).updateComplete;
      expect(actions()).toBeNull();
    }
    await press(el, key, "Escape");
    await table(el).updateComplete;
    expect(actions()).not.toBeNull();
    expect(clashMarker(el, key)).toBe(t("menu_prices.clash"));
    expect(override(el, key).value).toBe("");
    expect(heard).not.toHaveBeenCalled();
  },
);

it("keeps Resolve for an untouched stored-price clash, hides it for native typing, and restores it on Escape", async () => {
  const el = await mount({ rows: [clashRow(lemonade)] });
  const key = "mi-lemonade";
  const actions = () => row(el, key)!.querySelector("wt-row-actions");
  expect(override(el, key).value).toBe("2.50");
  expect(actions()).not.toBeNull();
  const field = override(el, key);
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  input.value = "2.80";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  await table(el).updateComplete;
  expect(field.value).toBe("2.80");
  expect(actions()).toBeNull();
  await press(el, key, "Escape");
  await table(el).updateComplete;
  expect(field.value).toBe("2.50");
  expect(actions()).not.toBeNull();
});

it.each(["", "-1", "abc"])(
  "keeps Resolve available when a clashing row's draft is %j",
  async (value) => {
    const el = await mount({ rows: [clashRow(lager)] });
    const heard = priceSaves(el);
    await typeIn(el, "mi-lager", value);
    await table(el).updateComplete;
    expect(row(el, "mi-lager")!.querySelector("wt-row-actions")).not.toBeNull();
    expect(clashMarker(el, "mi-lager")).toBe(t("menu_prices.clash"));
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
      ["mi-lemonade", "Price override for Lemonade", "2.50", "3.00 – 3.75"],
      ["mi-lemonade:v-small", "Price override for Lemonade — Small", "", "2.50"],
      ["mi-lemonade:v-large", "Price override for Lemonade — Large", "3.75", "3.40"],
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

it("shows a clash honestly: no price in the field, a red Clash beside it, the reason in its hint", async () => {
  setLocale("en-GB");
  try {
    const el = await mount({ rows: [clashRow(lager)] });
    const input = override(el, "mi-lager");
    expect([input.value, input.placeholder]).toEqual(["", "Set a price"]);
    expect(hintOf(input)).toBe("Left empty, its sources disagree. Set a price to resolve it.");
    const marker = cell(el, "override", "mi-lager").querySelector("[part~=clash]")!;
    expect(text(marker)).toBe("Clash");
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
  ["en-GB", "A variant's sources disagree — set that variant's price"],
  ["es-ES", "Los orígenes de una variante discrepan: fijar el precio de esa variante"],
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

const clashMarker = (el: MenuPricesTable, key: string) =>
  text(cell(el, "override", key).querySelector("[part~=clash]"));

it("drops a product's Clash once this menu's saved price decides it, and shows it again when the field is emptied", async () => {
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
  expect(row(el, "mi-lager")!.querySelector("wt-row-actions")).toBeNull();
  await typeIn(el, "mi-lager", "");
  await table(el).updateComplete;
  expect(clashMarker(el, "mi-lager")).toBe(t("menu_prices.clash"));
  expect(override(el, "mi-lager").placeholder).toBe(t("menu_prices.clash_placeholder"));
});

it("drops a product's Clash while a price is typed for it, and not for text that is no price", async () => {
  const el = await mount({ rows: [clashRow(lager)] });
  expect(clashMarker(el, "mi-lager")).toBe(t("menu_prices.clash"));
  await typeIn(el, "mi-lager", "2.20");
  await table(el).updateComplete;
  expect(clashMarker(el, "mi-lager")).toBe("");
  await typeIn(el, "mi-lager", "2,20");
  await table(el).updateComplete;
  expect(clashMarker(el, "mi-lager")).toBe(t("menu_prices.clash"));
});

it("drops a size's Clash once this menu's saved price decides it, and shows it again when the field is emptied", async () => {
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
  expect(clashMarker(el, "mi-lemonade:v-small")).toBe(t("menu_prices.clash"));
});

it("turns a clashing product's Clash into its size's once a price is typed for the product", async () => {
  const el = await mount({
    rows: [
      {
        ...variantClashRow(),
        override: null,
        combined: { ...variantClashRow().combined, price: clashPrice },
      },
    ],
  });
  expect(clashMarker(el, "mi-lemonade")).toBe(t("menu_prices.clash"));
  await typeIn(el, "mi-lemonade", "2.80");
  await table(el).updateComplete;
  expect(clashMarker(el, "mi-lemonade")).toBe(t("menu_prices.size_clash"));
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
    const tip = () =>
      cell(el, "override", size).querySelector("wt-help-tooltip")!.textContent!.trim();
    expect(override(el, size).placeholder).toBe("Set a price");
    expect(clashMarker(el, size)).toBe("Clash");
    await typeIn(el, "mi-lemonade", "2.80");
    await table(el).updateComplete;
    expect(override(el, size).placeholder).toBe("2.80");
    expect(hintOf(override(el, size))).toBe("Leave it empty to use the inherited price, €2.80.");
    expect(clashMarker(el, size)).toBe("");
    expect(tip()).toMatch(/^Follows Lemonade's price on this menu\. This menu sets €2\.80\./);
    await typeIn(el, "mi-lemonade", "");
    await table(el).updateComplete;
    expect(override(el, size).placeholder).toBe("Set a price");
    expect(clashMarker(el, size)).toBe("Clash");
    expect(row(el, size)!.querySelector("[part~=resolve]")).not.toBeNull();
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
        const el = await mount({
          rows: [burger, variantClashRow(), clashRow(lager)],
          saving: new Set(["mi-burger"]),
        });
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
          const tip = cell(el, "override", key).querySelector("wt-help-tooltip")!;
          const under = note.getBoundingClientRect();
          expect(under.top, key).toBeGreaterThanOrEqual(field.bottom);
          expect(under.left, key).toBeGreaterThanOrEqual(field.left - 0.5);
          expect(under.right, key).toBeLessThanOrEqual(tip.getBoundingClientRect().right + 0.5);
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
  const el = await mount(props);
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

it("keeps a field scrolled into view clear of the outcome message, which paints above the pinned Resolve column and the sticky header", async () => {
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
  // Where the message crosses the pinned Resolve column, the message is on top.
  const spot = toast.getBoundingClientRect();
  const y = spot.top + spot.height / 2;
  const pinnedCell = [
    ...table(el).shadowRoot.querySelectorAll<HTMLElement>('td[data-pinned="end"]'),
  ].find((cell) => {
    const box = cell.getBoundingClientRect();
    return box.top <= y && box.bottom >= y;
  })!;
  expect(pinnedCell).toBeDefined();
  const x = pinnedCell.getBoundingClientRect().left + 4;
  expect(x).toBeGreaterThan(spot.left);
  expect(paintsTopmost(toast, x, y)).toBe(true);
  // And where it crosses a sticky header's pinned heading, layered at 3.
  table(el).setAttribute("sticky-header", "");
  host.scrollTop = 0;
  const heading = table(el).shadowRoot.querySelector<HTMLElement>('th[data-pinned="end"]')!;
  const head = heading.getBoundingClientRect();
  el.style.marginBlockStart = `${y - (head.top + head.height / 2)}px`;
  const moved = heading.getBoundingClientRect();
  expect(moved.top).toBeLessThan(y);
  expect(moved.bottom).toBeGreaterThan(y);
  expect(getComputedStyle(heading).zIndex).toBe("3");
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

it("keeps an Inactive size's clash on its own row, off its product's", async () => {
  const row = variantClashRow();
  const el = await mount({
    rows: [
      {
        ...row,
        variants: row.variants.map((v) =>
          v.variantId === "v-small" ? { ...v, active: false } : v,
        ),
      },
    ],
  });
  expect(cell(el, "override", "mi-lemonade").querySelector("[part~=clash]")).toBeNull();
  expect(override(el, "mi-lemonade").placeholder).toBe("3.75");
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  expect(cell(el, "override", "mi-lemonade:v-small").querySelector("[part~=clash]")).not.toBeNull();
});

it("shows each row's own Active state as a link to its product page, a size by its own id", async () => {
  setLocale("en-GB");
  try {
    const el = await mount({
      rows: [burger, { ...lemonade, active: false }, { ...lager, active: true }],
    });
    toggleOf(el, "mi-lemonade")!.click();
    await table(el).updateComplete;
    const link = (key: string) =>
      cell(el, "status", key).querySelector<HTMLAnchorElement>("a[part~=status-link]")!;
    expect([text(link("mi-burger")), link("mi-burger").getAttribute("href")]).toEqual([
      "Active",
      "/manage/catalogue/product/p-burger",
    ]);
    expect(link("mi-burger").getAttribute("aria-label")).toBe("Active: open Burger's product page");
    expect(text(link("mi-lemonade"))).toBe("Disabled");
    // An Active size of a disabled product is Disabled, and says why.
    expect(text(link("mi-lemonade:v-small"))).toBe("Disabled");
    expect(link("mi-lemonade:v-small").getAttribute("href")).toBe(
      "/manage/catalogue/product/v-small",
    );
    expect(visibleText(cell(el, "status", "mi-lemonade:v-small"))).toBe(
      "Disabled its product is disabled",
    );
  } finally {
    setLocale("es-ES");
  }
});

it("in Spanish, words a product's status by the product and a size's by the variant", async () => {
  setLocale("es-ES");
  const el = await mount({
    rows: [burger, { ...lemonade, active: false }],
  });
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  const link = (key: string) =>
    cell(el, "status", key).querySelector<HTMLAnchorElement>("a[part~=status-link]")!;
  expect(text(link("mi-burger"))).toBe("Activo");
  expect(text(link("mi-lemonade"))).toBe("Deshabilitado");
  expect(visibleText(cell(el, "status", "mi-lemonade:v-small"))).toBe(
    "Deshabilitada su producto está deshabilitado",
  );
  try {
    // An Active size of an Active product.
    const own = await mount({ rows: [lemonade] });
    toggleOf(own, "mi-lemonade")!.click();
    await table(own).updateComplete;
    expect(
      text(cell(own, "status", "mi-lemonade:v-small").querySelector("a[part~=status-link]")),
    ).toBe("Activa");
  } finally {
    setLocale("es-ES");
  }
});

it("reads a disabled size as Disabled under an Active product, and keeps it out of the product's range", async () => {
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
  expect(text(cell(el, "status", "mi-lemonade:v-large").querySelector("a"))).toBe(
    t("product.variant_disabled_badge"),
  );
  expect(override(el, "mi-lemonade").placeholder).toBe("3.00");
});

it("opens the product page in the dashboard on a plain click, and leaves a modified click to the browser", async () => {
  const el = await mount();
  const heard = vi.fn();
  document.addEventListener("wt-edit-product", (event) => heard((event as CustomEvent).detail));
  const link = cell(el, "status", "mi-burger").querySelector<HTMLAnchorElement>("a")!;
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

it("opens a size's own page from its status link", async () => {
  const el = await mount();
  toggleOf(el, "mi-lemonade")!.click();
  await table(el).updateComplete;
  const heard = vi.fn();
  el.addEventListener("wt-edit-product", (event) => heard((event as CustomEvent).detail));
  cell(el, "status", "mi-lemonade:v-small")
    .querySelector<HTMLAnchorElement>("a")!
    .dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, button: 0 }),
    );
  expect(heard).toHaveBeenCalledExactlyOnceWith({ productId: "v-small" });
});

it("keeps Active apart from Available: a sold-out Active product reads Active", async () => {
  // `MenuPriceRow` carries no Available; the read lists a sold-out product as Active (Task 1).
  const el = await mount({ rows: [{ ...burger, active: true }] });
  expect(text(cell(el, "status", "mi-burger").querySelector("a"))).toBe(t("product.active_badge"));
  expect(text(cell(el, "status", "mi-burger"))).not.toContain(t("product.unavailable_badge"));
});

it("puts one where-from tooltip on a row, explaining what a blank field inherits", async () => {
  setLocale("en-GB");
  try {
    const ownBurger = {
      ...burger,
      override: "14.00",
      combined: combinedFixture("p-burger", "14.00", [], "14.00", "12.00"),
    };
    const el = await mount({ rows: [ownBurger] });
    const tips = [...row(el, "mi-burger")!.querySelectorAll("wt-help-tooltip")];
    expect(tips.map((tip) => tip.getAttribute("aria-label"))).toEqual([
      "Where Burger's inherited price comes from",
    ]);
    expect(tips[0]!.textContent!.trim()).toBe("The product's own price.");
  } finally {
    setLocale("es-ES");
  }
});
it.each([false, true])(
  "resolves a product clash by sending the product's field alone, naming no size (%s)",
  async (withVariants) => {
    setLocale("en-GB");
    try {
      const source = withVariants ? lemonade : lager;
      const el = await mount({ rows: [clashRow(source)] });
      const heard = priceSaves(el);
      const option = [...table(el).shadowRoot.querySelectorAll<HTMLElement>("wt-button")].find(
        (node) => text(node) === "Use €3.50 (Drinks)",
      );
      expect(option).toBeDefined();
      option!.click();
      // The product's own field alone: no size is named, so none is cleared.
      expect(heard.mock.calls).toEqual([
        [
          {
            key: source.menuItemId,
            menuItemId: source.menuItemId,
            variantId: null,
            name: source.name,
            price: "3.50",
            previous: source.override,
          },
        ],
      ]);
    } finally {
      setLocale("es-ES");
    }
  },
);
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
it("resolves one size's clash by sending that size's field alone, leaving every sibling's price unsent", async () => {
  setLocale("en-GB");
  try {
    const el = await mount({ rows: [variantClashRow()] });
    toggleOf(el, "mi-lemonade")!.click();
    await table(el).updateComplete;
    const heard = priceSaves(el);
    const option = [
      ...row(el, "mi-lemonade:v-small")!.querySelectorAll<HTMLElement>("wt-button"),
    ].find((node) => text(node) === "Use €3.50 (Drinks)");
    expect(option).toBeDefined();
    option!.click();
    expect(heard.mock.calls).toEqual([
      [
        {
          key: "mi-lemonade:v-small",
          menuItemId: "mi-lemonade",
          variantId: "v-small",
          name: "Lemonade — Small",
          price: "3.50",
          previous: null,
        },
      ],
    ]);
  } finally {
    setLocale("es-ES");
  }
});

it.each([
  ["an Active size beside an Inactive sibling", "v-large"],
  ["an Inactive size", "v-small"],
])("resolves the clash of %s by sending that size's field alone", async (_case, inactive) => {
  setLocale("en-GB");
  try {
    const source = variantClashRow();
    const el = await mount({
      rows: [
        {
          ...source,
          variants: source.variants.map((v) =>
            v.variantId === inactive ? { ...v, active: false } : v,
          ),
        },
      ],
    });
    toggleOf(el, "mi-lemonade")!.click();
    await table(el).updateComplete;
    const heard = priceSaves(el);
    [...row(el, "mi-lemonade:v-small")!.querySelectorAll<HTMLElement>("wt-button")]
      .find((node) => text(node) === "Use €3.50 (Drinks)")!
      .click();
    expect(heard).toHaveBeenCalledExactlyOnceWith({
      key: "mi-lemonade:v-small",
      menuItemId: "mi-lemonade",
      variantId: "v-small",
      name: "Lemonade — Small",
      price: "3.50",
      previous: null,
    });
  } finally {
    setLocale("es-ES");
  }
});

it("gives a size one localized tooltip, and its product's tooltip describes each size", async () => {
  const el = await mount({ rows: [lemonade] });
  table(el)
    .shadowRoot.querySelector<HTMLButtonElement>(
      'tr[data-row-key="mi-lemonade"] button.tree-toggle',
    )!
    .click();
  await table(el).updateComplete;
  const tips = [...row(el, "mi-lemonade:v-large")!.querySelectorAll("wt-help-tooltip")];
  expect(tips.map((tip) => tip.getAttribute("aria-label"))).toEqual([
    "De dónde viene el precio heredado de Lemonade — Large",
  ]);
  expect(tips[0]!.textContent!.trim()).toBe("El precio propio del producto.");
  // The small follows the product's price on this menu, which is this menu's own 2.50.
  const smallTip = cell(el, "override", "mi-lemonade:v-small").querySelector("wt-help-tooltip")!;
  expect(smallTip.textContent!.trim()).toBe(
    "Sigue el precio de Lemonade en esta carta. Esta carta fija 2,50\u00a0€. Sin él: 3,00\u00a0€, el precio propio del producto.",
  );
  expect(override(el, "mi-lemonade:v-small").placeholder).toBe("2.50");
  // With the product's field blank the small would follow the product's own 3.00, which is what
  // the product's placeholder, 3.00 – 3.75, counts.
  const productTip = cell(el, "override", "mi-lemonade").querySelector("wt-help-tooltip")!;
  expect(productTip.textContent!.trim()).toBe(
    "Small: 3,00\u00a0€. Sigue el precio de Lemonade en esta carta. El precio propio del producto. Large: 3,75\u00a0€. Esta carta fija 3,75\u00a0€. Sin él: 3,40\u00a0€, el precio propio del producto.",
  );
  expect(override(el, "mi-lemonade").placeholder).toBe("3.00 – 3.75");
});

it("names the included menu behind a variant that follows its product", async () => {
  setLocale("en-GB");
  try {
    const source = {
      ...lemonade,
      override: null,
      combined: {
        ...lemonade.combined,
        price: { state: "decided", value: "3.50", source: drinksSource, otherwise: null },
        variants: lemonade.combined.variants.map((v) => ({
          ...v,
          price: {
            state: "decided",
            value: "3.50",
            source: { kind: "parent" },
            otherwise: null,
            level: "product",
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
    const tip = cell(el, "override", "mi-lemonade:v-small").querySelector("wt-help-tooltip")!;
    expect(tip.textContent!.trim()).toBe(
      "Follows Lemonade's price on this menu. From Drinks, which sets its own price.",
    );
  } finally {
    setLocale("es-ES");
  }
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

it("opens Resolve without widening the table or displacing its prices", async () => {
  const el = await mount({ rows: [clashRow(lager)] });
  const root = table(el).shadowRoot;
  const before = root.querySelector("table")!.getBoundingClientRect().width;
  const resolve = row(el, "mi-lager")!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
    "wt-row-actions",
  );
  if (resolve) {
    await resolve.updateComplete;
    resolve.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  } else row(el, "mi-lager")!.querySelector<HTMLElement>("summary")!.click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(root.querySelector("table")!.getBoundingClientRect().width).toBeCloseTo(before, 0);
});

it.each([
  [
    "en-GB",
    "Where Lemonade's inherited price comes from",
    "Small: €6.00. The product's own price. Large: €14.00. This menu sets €14.00. Without it: €12.00, the product's own price.",
  ],
  [
    "es-ES",
    "De dónde viene el precio heredado de Lemonade",
    "Small: 6,00\u00a0€. El precio propio del producto. Large: 14,00\u00a0€. Esta carta fija 14,00\u00a0€. Sin él: 12,00\u00a0€, el precio propio del producto.",
  ],
])(
  "explains each size's price behind a product's field, whether or not the product sets its own (%s)",
  async (locale, label, explanation) => {
    setLocale(locale);
    try {
      const priced = {
        ...lemonade,
        override: "4.00",
        variants: [
          { variantId: "v-small", price: null, active: true },
          { variantId: "v-large", price: "14.00", active: true },
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
      const tip = cell(el, "override", "mi-lemonade").querySelector("wt-help-tooltip")!;
      expect(tip.getAttribute("aria-label")).toBe(label);
      await tip.updateComplete;
      tip.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
      await tip.updateComplete;
      expect(tip.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
      expect(tip.textContent!.trim()).toBe(explanation);
      const aggregate = await mount({ rows: [{ ...priced, override: null }] });
      const aggregateCell = cell(aggregate, "override", "mi-lemonade");
      expect(visibleText(aggregateCell)).toBe(t("menu_prices.variant_overrides"));
      expect(aggregateCell.querySelector("wt-help-tooltip")!.textContent!.trim()).toBe(explanation);
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
    expect(choosable).toContain("status");
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
