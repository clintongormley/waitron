import { combinedFixture } from "./test-helpers.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type {
  CategorySummary,
  SectionDetails,
  MenuPriceRow,
  MenuVariant,
  Product,
} from "../api/client.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { formatMoney } from "@waitron/shared";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { MenuPricesTable, type OfferSave } from "./menu-prices-table.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";

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
  { id: "c-drinks", name: "Bebidas", parentId: null },
  { id: "c-beer", name: "Cerveza", parentId: "c-drinks" },
  { id: "c-mains", name: "Principales", parentId: null },
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
  productPrice: "12.00",
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
  productPrice: "3.00",
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
  productPrice: "2.00",
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

/** A cell's text as it is seen: without the tree's toggle glyph or the text only a screen reader
 * reads. */
function visibleText(node: Element | undefined): string {
  if (node === undefined) return "";
  const clone = node.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll(
    '.tree-toggle, [part~="visually-hidden"], wt-help-tooltip',
  ))
    hidden.remove();
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

async function choose(el: MenuPricesTable, filter: string, value: string): Promise<void> {
  const select = table(el).shadowRoot.querySelector<HTMLElement>(
    `wt-combobox[data-filter="${filter}"]`,
  )!;
  await chooseOption(select, value);
  await table(el).updateComplete;
}

function options(el: MenuPricesTable, filter: string): string[] {
  const select = table(el).shadowRoot.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    `wt-combobox[data-filter="${filter}"]`,
  )!;
  return select.options.map((option) => option.label);
}

function modal(el: MenuPricesTable) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
}

function field<T extends HTMLElement = HTMLElementTagNameMap["wt-input"]>(
  el: MenuPricesTable,
  name: string,
): T {
  return modal(el).querySelector<T>(`[name="${name}"]`)!;
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

async function type(el: MenuPricesTable, name: string, value: string): Promise<void> {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function click(el: MenuPricesTable, testId: string): Promise<void> {
  modal(el).querySelector<HTMLElement>(`[data-test="${testId}"]`)!.click();
  await el.updateComplete;
}

async function bottomOf(el: MenuPricesTable): Promise<string> {
  const actions = modal(el).querySelector("wt-form-actions")!;
  return text(await formMessageOf(actions));
}

const saveOf = (el: MenuPricesTable): HTMLElement =>
  modal(el).querySelector<HTMLElement>('[data-test="offer-save"]')!;

function saves(el: MenuPricesTable) {
  const heard = vi.fn<(detail: OfferSave) => void>();
  el.addEventListener("wt-offer-save", (event) => heard((event as CustomEvent<OfferSave>).detail));
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
  { locale: "en-GB", price: "€3.00" },
  { locale: "es-ES", price: "3,00\u00a0€" },
])(
  "edits the menu price and each variant's in price fields showing the euro sign where $locale writes it, and names the product price in the hint the same way",
  async ({ locale, price }) => {
    setLocale(locale);
    try {
      const el = await mount({ editing: "mi-lemonade" });
      for (const name of ["grossPrice", "variants.0.price", "variants.1.price"]) {
        const input = field<HTMLElement & { locale: string }>(el, name);
        expect(input.tagName, name).toBe("WT-PRICE-INPUT");
        expect(input.locale, name).toBe(locale);
      }
      const hint = field(el, "grossPrice").shadowRoot!.querySelector<HTMLElement>("[data-hint]")!;
      expect(hint.textContent).toBe(t("menu_prices.override_help").replace("{price}", price));
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
  expect(column(el, "category")).toEqual(["Principales", "Bebidas", "Bebidas / Cerveza"]);
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

it("names a missing section or category, and a product with no reporting category as uncategorised", async () => {
  const el = await mount({
    rows: [
      { ...lager, categoryId: null, placements: [["s-gone"]] },
      { ...burger, categoryId: "c-gone" },
    ],
  });
  expect(column(el, "placements")).toEqual([t("members.missing"), t("menu_prices.top_level")]);
  expect(column(el, "category")).toEqual([
    t("categories.uncategorised"),
    t("editor.missing_choice"),
  ]);
  await choose(el, "category", "c-drinks");
  expect(shown(el)).toEqual([]);
});

it("finds a product by its name", async () => {
  const el = await mount();
  const search = table(el).shadowRoot.querySelector<HTMLInputElement>('input[name="search"]')!;
  search.value = "lemon";
  search.dispatchEvent(new Event("input"));
  await table(el).updateComplete;
  expect(shown(el)).toEqual(["mi-lemonade"]);
});

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
    const search = table(el).shadowRoot.querySelector<HTMLInputElement>('input[name="search"]')!;
    search.value = c.term;
    search.dispatchEvent(new Event("input"));
    await table(el).updateComplete;
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
  await choose(el, "placements", "s-drinks");
  expect(shown(el)).toEqual(["mi-lemonade", "mi-lager"]);
  await choose(el, "placements", "s-beer");
  expect(shown(el)).toEqual(["mi-lager"]);
  await choose(el, "placements", "s-fav");
  expect(shown(el)).toEqual(["mi-lemonade"]);
});

it("a category filter long enough to search shows its search box and empty list in Spanish", async () => {
  setLocale("es-ES");
  const many = Array.from({ length: 8 }, (_, index) => ({
    id: `c-${index}`,
    name: `Categoría ${index}`,
    parentId: null,
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
    "Bebidas / Cerveza",
    "Principales",
  ]);
  await choose(el, "category", "c-drinks");
  expect(shown(el)).toEqual(["mi-lemonade", "mi-lager"]);
  await choose(el, "category", "c-beer");
  expect(shown(el)).toEqual(["mi-lager"]);
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
        productPrice: "10.00",
        effectivePrice: "10.00",
        combined: combinedFixture("p-lager", "10.00"),
      },
      {
        ...burger,
        productPrice: "9.50",
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
        productPrice: "10.00",
        override: "4.00",
        effectivePrice: "4.00",
        combined: combinedFixture("p-lager", "4.00", [], "4.00", "10.00"),
      },
      {
        ...burger,
        productPrice: "5.00",
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

it("asks to open a product's settings when its name is pressed", async () => {
  const el = await mount();
  const heard = vi.fn();
  el.addEventListener("wt-offer-edit", (event) => heard((event as CustomEvent).detail));
  table(el).shadowRoot.querySelector<HTMLElement>('[data-test="edit-mi-lemonade"]')!.click();
  expect(heard).toHaveBeenCalledWith({ menuItemId: "mi-lemonade" });
});

it("offers no product's settings while a save is out", async () => {
  const el = await mount({ busy: true });
  const heard = vi.fn();
  el.addEventListener("wt-offer-edit", heard);
  const name = table(el).shadowRoot.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="edit-mi-lemonade"]',
  )!;
  expect(name.disabled).toBe(true);
  name.click();
  expect(heard).not.toHaveBeenCalled();
  el.busy = false;
  await el.updateComplete;
  await table(el).updateComplete;
  expect(name.disabled).toBe(false);
  name.click();
  expect(heard).toHaveBeenCalledOnce();
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

it("edits the menu price, with the product price as the empty field's placeholder, and each variant's", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  expect(modal(el).open).toBe(true);
  expect(modal(el).heading).toBe(
    t("menu_prices.edit_heading").replace("{name}", "Lemonade").replace("{menu}", "Lunch Menu"),
  );
  expect(field(el, "grossPrice").value).toBe("2.50");
  expect(field(el, "grossPrice").placeholder).toBe("3.00");
  // Each price falls back to another when left empty, so none is required or marked as required.
  for (const name of ["grossPrice", "variants.0.price", "variants.1.price"]) {
    expect(field(el, name).required, name).toBe(false);
    expect(field(el, name).shadowRoot!.querySelector("[data-required]"), name).toBeNull();
  }
  const legends = [...modal(el).querySelectorAll("fieldset legend")].map(text);
  expect(legends).toEqual(["Small", "Large"]);
  expect(field(el, "variants.0.price").value).toBe("");
  // A variant with no price of its own sells at this menu's price for the product.
  expect(field(el, "variants.0.price").placeholder).toBe("2.50");
  expect(field(el, "variants.1.price").value).toBe("3.75");
  expect(field(el, "variants.1.price").placeholder).toBe("3.40");

  await type(el, "grossPrice", "2.80");
  expect(field(el, "variants.0.price").placeholder).toBe("2.80");
  await type(el, "variants.0.price", " 1.90 ");
  await type(el, "variants.1.price", "");
  const heard = saves(el);
  await click(el, "offer-save");
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    menuItemId: "mi-lemonade",
    name: "Lemonade",
    item: { grossPrice: "2.80" },
    variants: [
      { variantId: "v-small", price: "1.90" },
      { variantId: "v-large", price: null },
    ] satisfies MenuVariant[],
  });
});

it("shows the product price as an empty menu price's placeholder and in its hint, and sends no variants for a product without them", async () => {
  const el = await mount({ editing: "mi-burger" });
  expect(field(el, "grossPrice").value).toBe("");
  expect(field(el, "grossPrice").placeholder).toBe("12.00");
  const help = field(el, "grossPrice").shadowRoot!.querySelector<HTMLElement>("[data-hint]")!;
  expect(text(help)).toBe(t("menu_prices.override_help").replace("{price}", eur("12.00")));
  // Read first, then the euro sign the field draws.
  const sign = field(el, "grossPrice").shadowRoot!.querySelector<HTMLElement>(
    '[part~="currency"]',
  )!;
  expect(
    field(el, "grossPrice").shadowRoot!.querySelector("input")!.getAttribute("aria-describedby"),
  ).toBe(`${help.id} ${sign.id}`);
  expect(modal(el).querySelector("fieldset")).toBeNull();
  expect(modal(el).querySelector('[data-test="use-product-price"]')).toBeNull();
  await type(el, "grossPrice", "11.00");
  const heard = saves(el);
  await click(el, "offer-save");
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    menuItemId: "mi-burger",
    name: "Burger",
    item: { grossPrice: "11.00" },
    variants: null,
  });
});

it("asks for nothing to be written when nothing was changed, reading an empty price as no price of the menu's own", async () => {
  const el = await mount({ editing: "mi-burger" });
  const heard = saves(el);
  await click(el, "offer-save");
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    menuItemId: "mi-burger",
    name: "Burger",
    item: null,
    variants: null,
  });
});

it("compares the settings by value: the same amount written differently, and variants read back in another order, are no change", async () => {
  const reversed = { ...lemonade, variants: [...lemonade.variants].reverse() };
  const el = await mount({ editing: "mi-lemonade", rows: [burger, reversed, lager] });
  await type(el, "grossPrice", "2.5");
  el.rows = [burger, lemonade, lager];
  await el.updateComplete;
  const heard = saves(el);
  await click(el, "offer-save");
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    menuItemId: "mi-lemonade",
    name: "Lemonade",
    item: null,
    variants: null,
  });
});

it("compares with the settings the window opened with, so a change read in meanwhile is not written back", async () => {
  const el = await mount({ editing: "mi-lemonade" });
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
  const heard = saves(el);
  await click(el, "offer-save");
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    menuItemId: "mi-lemonade",
    name: "Lemonade",
    item: null,
    variants: null,
  });
});

it("asks for the menu item alone when only the price changed on a product with variants", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  await type(el, "grossPrice", "2.60");
  const heard = saves(el);
  await click(el, "offer-save");
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    menuItemId: "mi-lemonade",
    name: "Lemonade",
    item: { grossPrice: "2.60" },
    variants: null,
  });
});

it("asks for the variants alone when only a variant's price changed", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  await type(el, "variants.0.price", "1.20");
  const heard = saves(el);
  await click(el, "offer-save");
  const save = heard.mock.calls[0]![0];
  expect(save.item).toBeNull();
  expect(save.variants).toEqual([
    { variantId: "v-small", price: "1.20" },
    { variantId: "v-large", price: "3.75" },
  ]);
});

it("neither shows nor sends an Inactive size in the window", async () => {
  const el = await mount({
    editing: "mi-lemonade",
    rows: [
      burger,
      {
        ...lemonade,
        variants: [
          { variantId: "v-small", price: null, active: true },
          { variantId: "v-large", price: "3.75", active: false },
        ],
      },
      lager,
    ],
  });
  expect([...modal(el).querySelectorAll("fieldset legend")].map(text)).toEqual(["Small"]);
  expect(field(el, "variants.1.price")).toBeNull();
  await type(el, "variants.0.price", "1.20");
  const heard = saves(el);
  await click(el, "offer-save");
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    menuItemId: "mi-lemonade",
    name: "Lemonade",
    item: null,
    variants: [{ variantId: "v-small", price: "1.20" }],
  });
});

it("'Use product price' empties the menu price, so saving clears it", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  await click(el, "use-product-price");
  expect(field(el, "grossPrice").value).toBe("");
  expect(field(el, "variants.0.price").placeholder).toBe("3.00");
  expect(modal(el).querySelector('[data-test="use-product-price"]')).toBeNull();
  const heard = saves(el);
  await click(el, "offer-save");
  expect(heard.mock.calls[0]![0].item).toEqual({ grossPrice: null });
});

it.each(["-1", "2.555", "abc", "007"])(
  "refuses the menu price %s beside the field and in the bottom message, sending nothing",
  async (price) => {
    const el = await mount({ editing: "mi-lemonade" });
    await type(el, "grossPrice", price);
    // An unreadable menu price is no placeholder for a variant.
    expect(field(el, "variants.0.price").placeholder).toBe("3.00");
    const heard = saves(el);
    await click(el, "offer-save");
    expect(heard).not.toHaveBeenCalled();
    expect(field(el, "grossPrice").error).toBe(t("editor.price_invalid"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(field(el, "grossPrice").value).toBe(price);
    await type(el, "grossPrice", "2.00");
    expect(field(el, "grossPrice").error).toBe("");
  },
);

it("refuses a variant's malformed price beside that variant's field", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  await type(el, "variants.1.price", "-3");
  const heard = saves(el);
  await click(el, "offer-save");
  expect(heard).not.toHaveBeenCalled();
  expect(field(el, "variants.1.price").error).toBe(t("editor.price_invalid"));
  expect(field(el, "variants.0.price").error).toBe("");
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
});

it("shows a refusal naming the menu price beside it, with the generic sentence in the bottom message and Save working", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  el.refusal = { field: "grossPrice", message: "Refused here" };
  await el.updateComplete;
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
  expect(field(el, "grossPrice").error).toBe("Refused here");
});

it.each(["_form", "variants", "variants.1", "price", "variantId"])(
  "shows a refusal naming %s in the bottom message alone, leaving Save working",
  async (refused) => {
    const el = await mount({ editing: "mi-lemonade" });
    el.refusal = { field: refused, message: "Refused" };
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("Refused");
    expect(saveOf(el).hasAttribute("disabled")).toBe(false);
    const errors = [
      ...modal(el).querySelectorAll<HTMLElementTagNameMap["wt-price-input"]>("wt-price-input"),
    ]
      .map((input) => input.error)
      .filter(Boolean);
    expect(errors).toEqual([]);
  },
);

it("says nothing about errors before the first submission, and Save works", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  await type(el, "grossPrice", "abc");
  expect(field(el, "grossPrice").error).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("on an invalid submission focuses the first invalid field and disables Save", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  await type(el, "variants.1.price", "-3");
  await click(el, "offer-save");
  await new Promise((resolve) => setTimeout(resolve));
  const price = field(el, "variants.1.price");
  expect(price.shadowRoot!.activeElement).toBe(price.shadowRoot!.querySelector("input"));
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);
});

it("re-checks every change after a failed submission, and Save works again once all are fixed", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  await type(el, "grossPrice", "-1");
  await click(el, "offer-save");

  await type(el, "grossPrice", "2.00");
  expect(field(el, "grossPrice").error).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);

  await type(el, "variants.0.price", "x");
  expect(field(el, "variants.0.price").error).toBe(t("editor.price_invalid"));
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);

  await type(el, "variants.0.price", "");
  expect(field(el, "variants.0.price").error).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("clears a refusal naming the menu price when that field changes, with Save working throughout", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  el.refusal = { field: "grossPrice", message: "Refused here" };
  await el.updateComplete;
  await type(el, "variants.0.price", "1.00");
  expect(field(el, "grossPrice").error).toBe("Refused here");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);

  await type(el, "grossPrice", "2.70");
  expect(field(el, "grossPrice").error).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("focuses the menu price when a refusal naming it arrives", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  el.refusal = { field: "grossPrice", message: "Refused here" };
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve));
  const price = field(el, "grossPrice");
  expect(price.shadowRoot!.activeElement).toBe(price.shadowRoot!.querySelector("input"));
});

it("drops a refusal that names no field when Save is pressed again", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  el.refusal = { field: "_form", message: "Refused" };
  await el.updateComplete;
  await type(el, "grossPrice", "2.70");
  expect(await bottomOf(el)).toBe("Refused");
  const heard = saves(el);
  await click(el, "offer-save");
  expect(heard).toHaveBeenCalledOnce();
  expect(await bottomOf(el)).toBe("");
});

it("starts again when reopened: no messages and Save working", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  await type(el, "grossPrice", "-1");
  await click(el, "offer-save");
  el.editing = null;
  await el.updateComplete;
  el.editing = "mi-lemonade";
  await el.updateComplete;
  expect(field(el, "grossPrice").error).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("keeps what was typed when the rows are read again while the settings are open", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  await type(el, "grossPrice", "2.90");
  el.rows = [burger, { ...lemonade, override: "2.60" }, lager];
  await el.updateComplete;
  expect(field(el, "grossPrice").value).toBe("2.90");
});

it("starts from the product's stored settings each time they are opened", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  await type(el, "grossPrice", "2.90");
  el.editing = null;
  await el.updateComplete;
  el.editing = "mi-lemonade";
  await el.updateComplete;
  expect(field(el, "grossPrice").value).toBe("2.50");
});

it("waits for the product's row before showing its settings", async () => {
  const el = await mount({ editing: "mi-lemonade", rows: [] });
  expect(modal(el).open).toBe(false);
  el.rows = [lemonade];
  await el.updateComplete;
  expect(modal(el).open).toBe(true);
  expect(field(el, "grossPrice").value).toBe("2.50");
});

it("names a variant the product list does not hold as missing", async () => {
  const el = await mount({ editing: "mi-lemonade", products: [] });
  const legends = [...modal(el).querySelectorAll("fieldset legend")].map(text);
  expect(legends).toEqual([t("members.missing"), t("members.missing")]);
  expect(field(el, "variants.1.price").placeholder).toBe("3.40");
});

it("asks to close on Cancel, and holds both buttons while a save is out", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  const heard = vi.fn();
  el.addEventListener("wt-offer-cancel", heard);
  await click(el, "offer-cancel");
  expect(heard).toHaveBeenCalledOnce();
  el.busy = true;
  await el.updateComplete;
  const save = modal(el).querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="offer-save"]',
  )!;
  expect(save.disabled).toBe(true);
  const saved = saves(el);
  save.click();
  expect(saved).not.toHaveBeenCalled();
  modal(el).dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  expect(heard).toHaveBeenCalledOnce();
});

it("stops the Save and Cancel clicks that ask, so nothing past the widget hears them", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  const clicks: Event[] = [];
  el.addEventListener("click", (event) => clicks.push(event));
  const heard = saves(el);
  const cancels = vi.fn();
  el.addEventListener("wt-offer-cancel", cancels);
  await click(el, "offer-save");
  await click(el, "offer-cancel");
  expect(heard).toHaveBeenCalledOnce();
  expect(cancels).toHaveBeenCalledOnce();
  expect(clicks).toEqual([]);
});

it("keeps the window open on Escape while a save is out", async () => {
  const el = await mount({ editing: "mi-lemonade", busy: true });
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  field(el, "grossPrice").dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  el.busy = false;
  await el.updateComplete;
  const again = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  field(el, "grossPrice").dispatchEvent(again);
  expect(again.defaultPrevented).toBe(false);
});

it("asks to close when the window is dismissed", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  const heard = vi.fn();
  el.addEventListener("wt-offer-cancel", heard);
  modal(el).dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  expect(heard).toHaveBeenCalledOnce();
});

it("saves on Enter in the menu price", async () => {
  const el = await mount({ editing: "mi-burger" });
  const heard = saves(el);
  const input = field(el, "grossPrice").shadowRoot!.querySelector("input")!;
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(heard).toHaveBeenCalledOnce();
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
    productPrice: "10.00",
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
    productPrice: "4.00",
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
    productPrice: "2.00",
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
    productPrice: "4.00",
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
    productPrice: "20.00",
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

  async function search(el: MenuPricesTable, term: string): Promise<void> {
    const box = table(el).shadowRoot.querySelector<HTMLInputElement>('input[name="search"]')!;
    box.value = term;
    box.dispatchEvent(new Event("input"));
    await table(el).updateComplete;
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
    // The name is plain text; only the product's name opens the settings.
    expect(cell(el, "name", "mi-wine:v-glass").querySelector("wt-button")).toBeNull();
    expect(cell(el, "name", "mi-wine").querySelector('[data-test="edit-mi-wine"]')).not.toBeNull();
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
    const product = start(cell(el, "name", "mi-wine").querySelector("wt-button")!);
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

  it("sorts the variants under their product by their own prices", async () => {
    const el = await mountVariants({ rows: [wine] });
    await expand(el, "mi-wine");
    await sortBy(el, "override");
    expect(shown(el)).toEqual([
      "mi-wine",
      "mi-wine:v-glass",
      "mi-wine:v-bottle",
      "mi-wine:v-carafe",
    ]);
    await sortBy(el, "override");
    expect(shown(el)).toEqual([
      "mi-wine",
      "mi-wine:v-carafe",
      "mi-wine:v-bottle",
      "mi-wine:v-glass",
    ]);
    await sortBy(el, "name");
    expect(shown(el)).toEqual([
      "mi-wine",
      "mi-wine:v-bottle",
      "mi-wine:v-carafe",
      "mi-wine:v-glass",
    ]);
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
    await choose(el, "placements", "s-drinks");
    await expand(el, "mi-wine");
    expect(shown(el)).toEqual([
      "mi-wine",
      "mi-wine:v-glass",
      "mi-wine:v-bottle",
      "mi-wine:v-carafe",
    ]);
    await choose(el, "placements", "");
    await choose(el, "category", "c-drinks");
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

  it("offers Appears under, Main category and Status in the column chooser, all shown, and keeps the choice under the Price overrides key alone", async () => {
    // A choice stored under the Prices tab's old key is not read.
    localStorage.setItem("waitron.menus.prices:columns", JSON.stringify({ category: false }));
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
    expect(headers(el)).toEqual(["name", "placements", "category", "status", "override", ""]);
    box(el, "category").click();
    await table(el).updateComplete;
    expect(headers(el)).not.toContain("category");
    expect(JSON.parse(localStorage.getItem("waitron.menus.price-overrides:columns")!)).toEqual({
      category: false,
    });
    const again = await mountVariants();
    expect(headers(again)).toEqual(["name", "placements", "status", "override", ""]);
    table(again).shadowRoot.querySelector<HTMLElement>("[data-restore-columns]")!.click();
    await table(again).updateComplete;
    expect(headers(again)).toEqual(["name", "placements", "category", "status", "override", ""]);
  });

  it("counts Active sizes only in a product's tooltip, and every stored price in the summary", async () => {
    setLocale("en-GB");
    try {
      const inactiveLarge = {
        ...lemonade,
        override: null,
        variants: [lemonade.variants[0]!, { ...lemonade.variants[1]!, active: false }],
      };
      const el = await mount({
        rows: [inactiveLarge, { ...lager, active: false, override: "4.00" }],
        nodes: [
          { memberId: "a", ref: { kind: "product", productId: "p-lemonade" } },
          { memberId: "b", ref: { kind: "product", productId: "p-lager" } },
        ],
      } as Partial<MenuPricesTable>);
      const tip = cell(el, "override", "mi-lemonade").querySelector("wt-help-tooltip")!;
      expect(tip.textContent).toContain("Small");
      expect(tip.textContent).not.toContain("Large");
      // Lemonade's only own price is on its Inactive Large; Lager is Inactive with its own price.
      expect(text(el.shadowRoot!.querySelector('[data-test="price-summary"] p:last-child'))).toBe(
        "Sets its own price for 2 of its own items",
      );
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

it("a price-only save sends the menu price and each variant's price, and nothing else", async () => {
  const el = await mount({ editing: lemonade.menuItemId, rows: [lemonade] });
  await type(el, "grossPrice", "2.60");
  await type(el, "variants.0.price", "1.20");
  const heard = saves(el);
  await click(el, "offer-save");
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    menuItemId: lemonade.menuItemId,
    name: lemonade.name,
    item: { grossPrice: "2.60" },
    variants: [
      { variantId: "v-small", price: "1.20" },
      { variantId: "v-large", price: "3.75" },
    ],
  });
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
  ["en-GB", "A size's sources disagree — set that size's price"],
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
    expect(text(link("mi-lemonade"))).toBe("Inactive");
    // An Active size of an Inactive product is Inactive, and says why.
    expect(text(link("mi-lemonade:v-small"))).toBe("Inactive");
    expect(link("mi-lemonade:v-small").getAttribute("href")).toBe(
      "/manage/catalogue/product/v-small",
    );
    expect(visibleText(cell(el, "status", "mi-lemonade:v-small"))).toBe(
      "Inactive its product is Inactive",
    );
  } finally {
    setLocale("es-ES");
  }
});

it("reads an Inactive size as Inactive under an Active product, and keeps it out of the product's range", async () => {
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
    t("product.inactive_badge"),
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
  "resolves a product clash without clearing variants (%s)",
  async (withVariants) => {
    setLocale("en-GB");
    try {
      const source = withVariants ? lemonade : lager;
      const el = await mount({ rows: [clashRow(source)] });
      const heard = saves(el);
      const option = [...table(el).shadowRoot.querySelectorAll<HTMLElement>("wt-button")].find(
        (node) => text(node) === "Use €3.50 (Drinks)",
      );
      expect(option).toBeDefined();
      option!.click();
      expect(heard.mock.calls).toEqual([
        [
          {
            menuItemId: source.menuItemId,
            name: source.name,
            item: { grossPrice: "3.50" },
            variants: withVariants ? null : [],
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
it("resolves one variant clash while preserving every sibling override", async () => {
  setLocale("en-GB");
  try {
    const el = await mount({ rows: [variantClashRow()] });
    table(el)
      .shadowRoot.querySelector<HTMLButtonElement>(
        'tr[data-row-key="mi-lemonade"] button.tree-toggle',
      )!
      .click();
    await table(el).updateComplete;
    const heard = saves(el);
    const option = [
      ...row(el, "mi-lemonade:v-small")!.querySelectorAll<HTMLElement>("wt-button"),
    ].find((node) => text(node) === "Use €3.50 (Drinks)");
    expect(option).toBeDefined();
    option!.click();
    expect(heard.mock.calls).toEqual([
      [
        {
          menuItemId: "mi-lemonade",
          name: "Lemonade",
          item: null,
          variants: [
            { variantId: "v-small", price: "3.50" },
            { variantId: "v-large", price: "3.75" },
          ],
        },
      ],
    ]);
  } finally {
    setLocale("es-ES");
  }
});

it("resolves an Active size's clash without sending an Inactive sibling, which the save refuses", async () => {
  setLocale("en-GB");
  try {
    const source = variantClashRow();
    const el = await mount({
      rows: [
        {
          ...source,
          variants: source.variants.map((v) =>
            v.variantId === "v-large" ? { ...v, active: false } : v,
          ),
        },
      ],
    });
    toggleOf(el, "mi-lemonade")!.click();
    await table(el).updateComplete;
    const heard = saves(el);
    [...row(el, "mi-lemonade:v-small")!.querySelectorAll<HTMLElement>("wt-button")]
      .find((node) => text(node) === "Use €3.50 (Drinks)")!
      .click();
    expect(heard).toHaveBeenCalledExactlyOnceWith({
      menuItemId: "mi-lemonade",
      name: "Lemonade",
      item: null,
      variants: [{ variantId: "v-small", price: "3.50" }],
    });
  } finally {
    setLocale("es-ES");
  }
});

it("counts inherited overrides once per included menu and own item", async () => {
  setLocale("en-GB");
  try {
    const drinks = {
      state: "decided",
      value: "3.50",
      source: drinksSource,
      otherwise: null,
    } as MenuPriceRow["combined"]["price"];
    const rows = [
      {
        ...lager,
        placements: [],
        override: "4.00",
        combined: {
          ...lager.combined,
          price: { state: "decided", value: "4.00", source: { kind: "own" }, otherwise: drinks },
        },
      },
      {
        ...burger,
        placements: [],
        override: "14.00",
        combined: {
          ...burger.combined,
          price: { state: "decided", value: "14.00", source: { kind: "own" }, otherwise: drinks },
        },
      },
      lemonade,
    ] as MenuPriceRow[];
    const el = await mount({
      rows,
      nodes: [
        {
          memberId: "included",
          ref: { kind: "section", sectionId: "root-drinks" },
          internalName: "Drinks",
          includedMenuId: "drinks",
          children: [
            { memberId: "lp", ref: { kind: "product", productId: "p-lager" } },
            { memberId: "bp", ref: { kind: "product", productId: "p-burger" } },
          ],
        },
        { memberId: "own", ref: { kind: "product", productId: "p-lemonade" } },
      ],
    } as Partial<MenuPricesTable>);
    const summary = el.shadowRoot!.querySelector('[data-test="price-summary"]');
    expect([...summary!.querySelectorAll("p")].map(text)).toEqual([
      "This menu sets its own price for 2 items from Drinks",
      "Sets its own price for 1 of its own items",
    ]);
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
  const productTip = cell(el, "override", "mi-lemonade").querySelector("wt-help-tooltip")!;
  expect(productTip.textContent!.trim()).toBe(
    "Small: 2,50\u00a0€. Sigue el precio de Lemonade en esta carta. Large: 3,75\u00a0€. Esta carta fija 3,75\u00a0€. Sin él: 3,40\u00a0€, el precio propio del producto.",
  );
});

it("counts equal-price direct sources once and excludes roots nested inside another menu", async () => {
  setLocale("en-GB");
  try {
    const ownBurger = {
      ...burger,
      override: "12.00",
      combined: combinedFixture("p-burger", "12.00", [], "12.00", "12.00"),
    };
    const product = { memberId: "burger", ref: { kind: "product", productId: "p-burger" } };
    const wines = {
      memberId: "wines",
      ref: { kind: "section", sectionId: "root-wines" },
      internalName: "Wines",
      includedMenuId: "wines",
      children: [product],
    };
    const drinks = {
      memberId: "drinks",
      ref: { kind: "section", sectionId: "root-drinks" },
      internalName: "Drinks",
      includedMenuId: "drinks",
      children: [product, wines],
    };
    const el = await mount({
      rows: [ownBurger],
      nodes: [
        product,
        drinks,
        {
          memberId: "specials",
          ref: { kind: "section", sectionId: "specials" },
          children: [{ ...drinks, memberId: "again" }],
        },
      ],
    } as unknown as Partial<MenuPricesTable>);
    expect([...el.shadowRoot!.querySelectorAll('[data-test="price-summary"] p')].map(text)).toEqual(
      [
        "This menu sets its own price for 1 item from Drinks",
        "Sets its own price for 1 of its own items",
      ],
    );
  } finally {
    setLocale("es-ES");
  }
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

  it("edits only prices: no field for the product's or a variant's switch, and a price-only save sends prices alone", async () => {
    const el = await mount({ editing: "mi-lemonade" });
    expect(modal(el).querySelector('[name="offered"]')).toBeNull();
    for (const id of ["v-small", "v-large"])
      expect(modal(el).querySelector(`[name="offered-${id}"]`), id).toBeNull();
    expect(modal(el).querySelector("wt-combobox")).toBeNull();
    await type(el, "grossPrice", "2.80");
    await type(el, "variants.1.price", "4.00");
    const heard = saves(el);
    await click(el, "offer-save");
    expect(heard).toHaveBeenCalledExactlyOnceWith({
      menuItemId: "mi-lemonade",
      name: "Lemonade",
      item: { grossPrice: "2.80" },
      variants: [
        { variantId: "v-small", price: null },
        { variantId: "v-large", price: "4.00" },
      ],
    });
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

  it.each([
    ["en-GB", "This menu sets its own price for 1 item from Drinks"],
    ["es-ES", "Esta carta fija su propio precio para 1 producto de Drinks"],
  ])("counts only the prices it sets on an included menu's products (%s)", async (locale, want) => {
    setLocale(locale);
    try {
      const own = {
        state: "decided",
        value: "4.00",
        source: { kind: "own" },
        otherwise: { state: "decided", value: "3.50", source: drinksSource, otherwise: null },
      } as MenuPriceRow["combined"]["price"];
      const el = await mount({
        rows: [
          { ...lager, override: "4.00", combined: { ...lager.combined, price: own } },
          // Stored without a price of this menu's own, so nothing here counts it.
          burger,
        ],
        nodes: [
          {
            memberId: "included",
            ref: { kind: "section", sectionId: "root-drinks" },
            internalName: "Drinks",
            includedMenuId: "drinks",
            children: [
              { memberId: "lp", ref: { kind: "product", productId: "p-lager" } },
              { memberId: "bp", ref: { kind: "product", productId: "p-burger" } },
            ],
          },
        ],
      } as Partial<MenuPricesTable>);
      const summary = el.shadowRoot!.querySelector('[data-test="price-summary"]')!;
      expect(text(summary.querySelector("p"))).toBe(want);
    } finally {
      setLocale("es-ES");
    }
  });
});
