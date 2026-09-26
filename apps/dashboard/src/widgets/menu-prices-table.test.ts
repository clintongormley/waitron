import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CategorySummary,
  LibrarySection,
  MenuPriceRow,
  MenuVariant,
  Product,
} from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { MenuPricesTable, type OfferSave } from "./menu-prices-table.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

afterEach(cleanupWidgets);
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

/** Each section's customer names differ from its internal name, so a placement drawn from the
 * wrong one fails. */
const sections: LibrarySection[] = [
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
  { id: "c-drinks", name: { es: "Bebidas" }, image: null, color: null, parentId: null },
  { id: "c-beer", name: { es: "Cerveza" }, image: null, color: null, parentId: "c-drinks" },
  { id: "c-mains", name: { es: "Principales" }, image: null, color: null, parentId: null },
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
    active: true,
    effective: {
      unitPrice: unitPrice ?? "3.00",
      vatClass: "general" as const,
      primaryCategoryId: null,
      labelIds: [],
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
  productId: "p-lemonade",
  name: "Lemonade",
  categoryId: "c-drinks",
  placements: [["s-fav"], ["s-drinks"]],
  productPrice: "3.00",
  override: "2.50",
  effectivePrice: "2.50",
  active: true,
  variants: [
    { variantId: "v-small", price: null, offered: true },
    { variantId: "v-large", price: "3.75", offered: false },
  ],
};
const lager: MenuPriceRow = {
  menuItemId: "mi-lager",
  productId: "p-lager",
  name: "Lager",
  categoryId: "c-beer",
  placements: [["s-drinks", "s-beer"]],
  productPrice: "2.00",
  override: null,
  effectivePrice: "2.00",
  active: false,
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
  for (const hidden of clone.querySelectorAll('.tree-toggle, [part~="visually-hidden"]'))
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
  const select = table(el).shadowRoot.querySelector<HTMLSelectElement>(
    `select[data-filter="${filter}"]`,
  )!;
  select.value = value;
  select.dispatchEvent(new Event("change"));
  await table(el).updateComplete;
}

function options(el: MenuPricesTable, filter: string): string[] {
  const select = table(el).shadowRoot.querySelector<HTMLSelectElement>(
    `select[data-filter="${filter}"]`,
  )!;
  return [...select.options].map((option) => text(option));
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

async function type(el: MenuPricesTable, name: string, value: string): Promise<void> {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function flip(el: MenuPricesTable, name: string, checked: boolean): Promise<void> {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function click(el: MenuPricesTable, testId: string): Promise<void> {
  modal(el).querySelector<HTMLElement>(`[data-test="${testId}"]`)!.click();
  await el.updateComplete;
}

async function summary(el: MenuPricesTable): Promise<string[]> {
  const found =
    modal(el).querySelector<HTMLElementTagNameMap["wt-form-error-summary"]>(
      "wt-form-error-summary",
    )!;
  await found.updateComplete;
  return [...found.shadowRoot!.querySelectorAll("li")].map((item) => text(item));
}

function saves(el: MenuPricesTable) {
  const heard = vi.fn<(detail: OfferSave) => void>();
  el.addEventListener("wt-offer-save", (event) => heard((event as CustomEvent<OfferSave>).detail));
  return heard;
}

it("lists each product once with its prices, and where it appears by the sections' internal names", async () => {
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
  // Lemonade is sold only as its variants, so its product price is theirs: 3.00 for the small,
  // which has none of its own, and the large's 3.40.
  expect(column(el, "product-price")).toEqual([
    "12.00",
    t("menu_prices.range").replace("{low}", "3.00").replace("{high}", "3.40"),
    "2.00",
  ]);
  expect(column(el, "menu-price")).toEqual([
    t("menu_prices.no_override"),
    "2.50",
    t("menu_prices.no_override"),
  ]);
  expect(column(el, "effective-price")).toEqual(["12.00", "2.50", "2.00"]);
  expect(column(el, "active")).toEqual([
    t("menu_prices.sold_here"),
    t("menu_prices.sold_here"),
    t("menu_prices.switched_off"),
  ]);
});

it("puts each placement on its own line and paints the notes muted, through the table's parts", async () => {
  const el = await mount();
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
  expect(getComputedStyle(row(el, "mi-burger")!.querySelector("[part~=muted]")!).color).toBe(muted);
  expect(muted).not.toBe(getComputedStyle(row(el, "mi-burger")!).color);
});

it("names a section or category the library no longer holds as missing, and a product with no reporting category as uncategorised", async () => {
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
  await choose(el, "menu-price", "overridden");
  expect(shown(el)).toEqual(["mi-lemonade"]);
});

it("counts a product whose only price on this menu is a variant's as overridden, and not one whose variant is only switched off", async () => {
  const el = await mount({
    rows: [
      {
        ...lemonade,
        override: null,
        variants: [
          { variantId: "v-small", price: null, offered: true },
          { variantId: "v-large", price: "4.25", offered: true },
        ],
      },
      {
        ...lager,
        variants: [{ variantId: "v-small", price: null, offered: false }],
      },
      burger,
    ],
  });
  await choose(el, "menu-price", "overridden");
  expect(shown(el)).toEqual(["mi-lemonade"]);
});

it("sorts the prices as amounts, not as text", async () => {
  const el = await mount({
    rows: [
      { ...lager, productPrice: "10.00", effectivePrice: "10.00" },
      { ...burger, productPrice: "9.50", effectivePrice: "9.50" },
    ],
  });
  table(el).shadowRoot.querySelector<HTMLElement>('button[data-sort="product-price"]')!.click();
  await table(el).updateComplete;
  expect(column(el, "product-price")).toEqual(["9.50", "10.00"]);
});

it("sorts by this menu's price and by the price charged here, not by the product's own price", async () => {
  // The product prices order the two rows one way and the menu's prices the other, so a column
  // sorting by the product price fails.
  const el = await mount({
    rows: [
      { ...lager, productPrice: "10.00", override: "4.00", effectivePrice: "4.00" },
      { ...burger, productPrice: "5.00", override: "9.00", effectivePrice: "9.00" },
    ],
  });
  const sortBy = async (key: string) => {
    table(el).shadowRoot.querySelector<HTMLElement>(`button[data-sort="${key}"]`)!.click();
    await table(el).updateComplete;
  };
  await sortBy("product-price");
  expect(shown(el)).toEqual(["mi-burger", "mi-lager"]);
  await sortBy("effective-price");
  expect(shown(el)).toEqual(["mi-lager", "mi-burger"]);
  await sortBy("product-price");
  expect(shown(el)).toEqual(["mi-burger", "mi-lager"]);
  await sortBy("menu-price");
  expect(shown(el)).toEqual(["mi-lager", "mi-burger"]);
});

it("sorts by name and by where a product first appears", async () => {
  const el = await mount();
  const sortBy = async (key: string) => {
    table(el).shadowRoot.querySelector<HTMLElement>(`button[data-sort="${key}"]`)!.click();
    await table(el).updateComplete;
  };
  await sortBy("name");
  expect(shown(el)).toEqual(["mi-burger", "mi-lager", "mi-lemonade"]);
  await sortBy("placements");
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

it("edits the menu price, with the product price as the empty field's placeholder, the menu's switch and each variant", async () => {
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
  expect(field<HTMLElementTagNameMap["wt-switch"]>(el, "active").checked).toBe(true);
  const legends = [...modal(el).querySelectorAll("fieldset legend")].map(text);
  expect(legends).toEqual(["Small", "Large"]);
  expect(field(el, "variants.0.price").value).toBe("");
  // A variant with no price of its own sells at this menu's price for the product.
  expect(field(el, "variants.0.price").placeholder).toBe("2.50");
  expect(field(el, "variants.1.price").value).toBe("3.75");
  expect(field(el, "variants.1.price").placeholder).toBe("3.40");
  expect(field<HTMLElementTagNameMap["wt-switch"]>(el, "variants.0.offered").checked).toBe(true);
  expect(field<HTMLElementTagNameMap["wt-switch"]>(el, "variants.1.offered").checked).toBe(false);

  await type(el, "grossPrice", "2.80");
  expect(field(el, "variants.0.price").placeholder).toBe("2.80");
  await flip(el, "active", false);
  await type(el, "variants.0.price", " 1.90 ");
  await type(el, "variants.1.price", "");
  await flip(el, "variants.1.offered", true);
  const heard = saves(el);
  await click(el, "offer-save");
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    menuItemId: "mi-lemonade",
    name: "Lemonade",
    item: { grossPrice: "2.80", active: false },
    variants: [
      { variantId: "v-small", price: "1.90", offered: true },
      { variantId: "v-large", price: null, offered: true },
    ] satisfies MenuVariant[],
  });
});

it("shows the product price as an empty menu price's placeholder and in its hint, and sends no variants for a product without them", async () => {
  const el = await mount({ editing: "mi-burger" });
  expect(field(el, "grossPrice").value).toBe("");
  expect(field(el, "grossPrice").placeholder).toBe("12.00");
  // The help line is the price field's own hint, which is what its input is described by.
  const help = field(el, "grossPrice").shadowRoot!.querySelector<HTMLElement>("[data-hint]")!;
  expect(text(help)).toBe(t("menu_prices.override_help").replace("{price}", "12.00"));
  expect(
    field(el, "grossPrice").shadowRoot!.querySelector("input")!.getAttribute("aria-describedby"),
  ).toBe(help.id);
  expect(modal(el).querySelector("fieldset")).toBeNull();
  expect(modal(el).querySelector('[data-test="use-product-price"]')).toBeNull();
  await flip(el, "active", false);
  const heard = saves(el);
  await click(el, "offer-save");
  expect(heard).toHaveBeenCalledExactlyOnceWith({
    menuItemId: "mi-burger",
    name: "Burger",
    item: { grossPrice: null, active: false },
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
      active: false,
      variants: [
        { variantId: "v-small", price: "1.00", offered: false },
        { variantId: "v-large", price: "3.75", offered: false },
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
    item: { grossPrice: "2.60", active: true },
    variants: null,
  });
});

it.each([
  ["a variant's price", "variants.0.price", "1.20"],
  ["a variant's offer", "variants.1.offered", true],
] as const)("asks for the variants alone when only %s changed", async (_, name, value) => {
  const el = await mount({ editing: "mi-lemonade" });
  if (typeof value === "string") await type(el, name, value);
  else await flip(el, name, value);
  const heard = saves(el);
  await click(el, "offer-save");
  const save = heard.mock.calls[0]![0];
  expect(save.item).toBeNull();
  expect(save.variants).toEqual([
    { variantId: "v-small", price: typeof value === "string" ? value : null, offered: true },
    { variantId: "v-large", price: "3.75", offered: value === true },
  ]);
});

it("'Use product price' empties the menu price, so saving clears it", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  await click(el, "use-product-price");
  expect(field(el, "grossPrice").value).toBe("");
  expect(field(el, "variants.0.price").placeholder).toBe("3.00");
  expect(modal(el).querySelector('[data-test="use-product-price"]')).toBeNull();
  const heard = saves(el);
  await click(el, "offer-save");
  expect(heard.mock.calls[0]![0].item).toEqual({ grossPrice: null, active: true });
});

it.each(["-1", "2.555", "abc", "007"])(
  "refuses the menu price %s beside the field and in the summary, sending nothing",
  async (price) => {
    const el = await mount({ editing: "mi-lemonade" });
    await type(el, "grossPrice", price);
    // An unreadable menu price is no placeholder for a variant.
    expect(field(el, "variants.0.price").placeholder).toBe("3.00");
    const heard = saves(el);
    await click(el, "offer-save");
    expect(heard).not.toHaveBeenCalled();
    expect(field(el, "grossPrice").error).toBe(t("editor.price_invalid"));
    expect(await summary(el)).toEqual([t("editor.price_invalid")]);
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
  expect(await summary(el)).toEqual([t("editor.price_invalid")]);
});

it("shows a refusal naming the menu price beside it and in the summary", async () => {
  const el = await mount({ editing: "mi-lemonade" });
  el.refusal = { field: "grossPrice", message: "Refused here" };
  await el.updateComplete;
  expect(await summary(el)).toEqual(["Refused here"]);
  expect(field(el, "grossPrice").error).toBe("Refused here");
});

it.each(["_form", "active", "variants", "variants.1", "price", "variantId"])(
  "shows a refusal naming %s in the summary alone",
  async (refused) => {
    const el = await mount({ editing: "mi-lemonade" });
    el.refusal = { field: refused, message: "Refused" };
    await el.updateComplete;
    expect(await summary(el)).toEqual(["Refused"]);
    const errors = [...modal(el).querySelectorAll<HTMLElementTagNameMap["wt-input"]>("wt-input")]
      .map((input) => input.error)
      .filter(Boolean);
    expect(errors).toEqual([]);
  },
);

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
  expect(field(el, "variants.1.price").placeholder).toBe("2.50");
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

  /** Sets its own menu price and a menu price on two of its variants; the carafe is not offered. */
  const wine: MenuPriceRow = {
    menuItemId: "mi-wine",
    productId: "p-wine",
    name: "Wine",
    categoryId: "c-drinks",
    placements: [["s-drinks"]],
    productPrice: "10.00",
    override: "13.00",
    effectivePrice: "13.00",
    active: true,
    variants: [
      { variantId: "v-glass", price: "7.00", offered: true },
      { variantId: "v-bottle", price: null, offered: true },
      { variantId: "v-carafe", price: "15.00", offered: false },
    ],
  };
  /** Its only menu price is a variant's. */
  const juice: MenuPriceRow = {
    menuItemId: "mi-juice",
    productId: "p-juice",
    name: "Juice",
    categoryId: "c-drinks",
    placements: [["s-fav"]],
    productPrice: "4.00",
    override: null,
    effectivePrice: "4.00",
    active: true,
    variants: [
      { variantId: "v-juice-small", price: "3.50", offered: true },
      { variantId: "v-juice-large", price: null, offered: true },
    ],
  };
  /** No variant is offered. */
  const tea: MenuPriceRow = {
    menuItemId: "mi-tea",
    productId: "p-tea",
    name: "Tea",
    categoryId: "c-mains",
    placements: [[]],
    productPrice: "2.00",
    override: null,
    effectivePrice: "2.00",
    active: true,
    variants: [{ variantId: "v-pot", price: "2.40", offered: false }],
  };
  /** No menu price anywhere. */
  const cider: MenuPriceRow = {
    menuItemId: "mi-cider",
    productId: "p-cider",
    name: "Cider",
    categoryId: "c-beer",
    placements: [["s-drinks", "s-beer"]],
    productPrice: "4.00",
    override: null,
    effectivePrice: "4.00",
    active: true,
    variants: [
      { variantId: "v-pint", price: null, offered: true },
      { variantId: "v-half", price: null, offered: true },
    ],
  };
  const steak: MenuPriceRow = {
    ...burger,
    menuItemId: "mi-steak",
    productId: "p-steak",
    name: "Steak",
    productPrice: "20.00",
    override: "18.00",
    effectivePrice: "18.00",
  };
  const soup: MenuPriceRow = {
    ...burger,
    menuItemId: "mi-soup",
    productId: "p-soup",
    name: "Soup",
    productPrice: "5.00",
    override: "5.00",
    effectivePrice: "5.00",
  };

  function mountVariants(props: Partial<MenuPricesTable> = {}) {
    return mount({ rows: [wine, juice, tea, burger], products, ...props });
  }

  function toggle(el: MenuPricesTable, key: string): HTMLButtonElement | null {
    return row(el, key)?.querySelector<HTMLButtonElement>("button.tree-toggle") ?? null;
  }

  async function expand(el: MenuPricesTable, ...keys: string[]): Promise<void> {
    for (const key of keys) {
      toggle(el, key)!.click();
      await table(el).updateComplete;
    }
  }

  async function sortBy(el: MenuPricesTable, key: string): Promise<void> {
    table(el).shadowRoot.querySelector<HTMLElement>(`button[data-sort="${key}"]`)!.click();
    await table(el).updateComplete;
  }

  async function search(el: MenuPricesTable, term: string): Promise<void> {
    const box = table(el).shadowRoot.querySelector<HTMLInputElement>('input[name="search"]')!;
    box.value = term;
    box.dispatchEvent(new Event("input"));
    await table(el).updateComplete;
  }

  const range = (low: string, high: string) =>
    t("menu_prices.range").replace("{low}", low).replace("{high}", high);

  function mutedColour(el: MenuPricesTable): string {
    const probe = document.createElement("span");
    probe.style.color = "var(--wt-color-text-muted)";
    el.parentElement!.appendChild(probe);
    return getComputedStyle(probe).color;
  }

  // Hidden text a screen reader reads must still be clipped out of sight, not merely marked.
  function expectClipped(hidden: Element) {
    const style = getComputedStyle(hidden);
    expect([style.position, style.width, style.height, style.overflow, style.clip]).toEqual([
      "absolute",
      "1px",
      "1px",
      "hidden",
      "rect(0px, 0px, 0px, 0px)",
    ]);
  }

  async function showCombined(el: MenuPricesTable): Promise<void> {
    const box = table(el).shadowRoot.querySelector<HTMLInputElement>(
      'input[data-column="price-on-menu"]',
    )!;
    box.click();
    await table(el).updateComplete;
  }

  it("puts each variant under its product, collapsed until the product is opened", async () => {
    const el = await mountVariants();
    expect(shown(el)).toEqual(["mi-wine", "mi-juice", "mi-tea", "mi-burger"]);
    expect(toggle(el, "mi-burger")).toBeNull();
    expect(toggle(el, "mi-wine")!.getAttribute("aria-label")).toBe(
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
    expect(toggle(el, "mi-wine")!.getAttribute("aria-label")).toBe(
      t("menu_prices.collapse").replace("{name}", "Wine"),
    );
    expect(row(el, "mi-wine:v-glass")!.getAttribute("aria-level")).toBe("2");
    await expand(el, "mi-wine");
    expect(shown(el)).toEqual(["mi-wine", "mi-juice", "mi-tea", "mi-burger"]);
  });

  it("shows each variant's name, its own price, this menu's price for it, what it is charged and whether it is offered", async () => {
    const el = await mountVariants();
    await expand(el, "mi-wine");
    const variants = ["mi-wine:v-glass", "mi-wine:v-bottle", "mi-wine:v-carafe"];
    const cells = (key: string) => variants.map((rowKey) => visibleText(cell(el, key, rowKey)));
    expect(cells("name")).toEqual(["Glass", "Bottle", "Carafe"]);
    // A variant with no price of its own shows the product's.
    expect(cells("product-price")).toEqual(["6.00", "10.00", "14.00"]);
    expect(cells("menu-price")).toEqual(["7.00", t("menu_prices.no_override"), "15.00"]);
    // The bottle has neither a menu price nor its own, so it is charged the product's menu price.
    expect(cells("effective-price")).toEqual(["7.00", "13.00", "15.00"]);
    expect(cells("active")).toEqual([
      t("menu_prices.offered"),
      t("menu_prices.offered"),
      t("menu_prices.not_offered"),
    ]);
    expect(cells("placements")).toEqual(["", "", ""]);
    expect(cells("category")).toEqual(["", "", ""]);
    const muted = mutedColour(el);
    for (const [key, rowKey] of [
      ["menu-price", "mi-wine:v-bottle"],
      ["active", "mi-wine:v-carafe"],
    ] as const)
      expect(getComputedStyle(cell(el, key, rowKey).querySelector("[part~=muted]")!).color).toBe(
        muted,
      );
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

  it("names a variant the product list does not hold as missing, and, knowing no price of its own, shows it charged this menu's price for it, else the product's price on this menu", async () => {
    // The glass's own price, 6.00, is in the product list this table is not given.
    const glassWithoutMenuPrice: MenuPriceRow = {
      ...wine,
      variants: wine.variants.map((v) => (v.variantId === "v-glass" ? { ...v, price: null } : v)),
    };
    const el = await mountVariants({ rows: [glassWithoutMenuPrice], products: [] });
    await expand(el, "mi-wine");
    expect(visibleText(cell(el, "name", "mi-wine:v-glass"))).toBe(t("members.missing"));
    expect(visibleText(cell(el, "product-price", "mi-wine:v-glass"))).toBe("10.00");
    expect(visibleText(cell(el, "effective-price", "mi-wine:v-glass"))).toBe("13.00");
    expect(visibleText(cell(el, "effective-price", "mi-wine:v-carafe"))).toBe("15.00");
  });

  it("shows a product sold as its variants at the range of its variants' prices", async () => {
    const el = await mountVariants();
    // All the variants for the product price, the offered ones for what is charged.
    expect(column(el, "product-price")).toEqual([
      range("6.00", "14.00"),
      range("3.00", "5.00"),
      "2.20",
      "12.00",
    ]);
    expect(column(el, "effective-price")).toEqual([
      range("7.00", "13.00"),
      range("3.50", "5.00"),
      t("menu_prices.no_variant_offered"),
      "12.00",
    ]);
    expect(
      getComputedStyle(cell(el, "effective-price", "mi-tea").querySelector("[part~=muted]")!).color,
    ).toBe(mutedColour(el));
  });

  it("shows one price, not a range, when the variants' prices are the same amount", async () => {
    const el = await mountVariants({
      rows: [
        {
          ...juice,
          variants: [
            { variantId: "v-juice-small", price: "5.0", offered: true },
            { variantId: "v-juice-large", price: null, offered: true },
          ],
        },
      ],
    });
    expect(column(el, "effective-price")).toEqual(["5.0"]);
  });

  it("sorts a range column by the low end of each range, as an amount", async () => {
    const el = await mountVariants();
    await sortBy(el, "product-price");
    // By the high end it would be tea, juice, burger (12.00), wine (14.00).
    expect(shown(el)).toEqual(["mi-tea", "mi-juice", "mi-wine", "mi-burger"]);
    await sortBy(el, "effective-price");
    await sortBy(el, "effective-price");
    // Descending; a product with no variant offered has no price and sorts last either way.
    expect(shown(el)).toEqual(["mi-burger", "mi-wine", "mi-juice", "mi-tea"]);
  });

  it("sorts the variants under their product by their own prices", async () => {
    const el = await mountVariants({ rows: [wine] });
    await expand(el, "mi-wine");
    await sortBy(el, "effective-price");
    expect(shown(el)).toEqual([
      "mi-wine",
      "mi-wine:v-glass",
      "mi-wine:v-bottle",
      "mi-wine:v-carafe",
    ]);
    await sortBy(el, "effective-price");
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
    expect(column(el, "menu-price")).toEqual([
      "13.00",
      t("menu_prices.variant_overrides"),
      t("menu_prices.variant_overrides"),
      t("menu_prices.no_override"),
    ]);
  });

  it("keeps exactly the products it marks with a menu price under the Overridden only filter", async () => {
    const el = await mountVariants({ rows: [wine, juice, tea, cider, burger, steak] });
    const unmarked = column(el, "menu-price")
      .map((price, at) => [shown(el)[at], price] as const)
      .filter(([, price]) => price === t("menu_prices.no_override"))
      .map(([key]) => key);
    expect(unmarked).toEqual(["mi-cider", "mi-burger"]);
    await choose(el, "menu-price", "overridden");
    expect(shown(el)).toEqual(["mi-wine", "mi-juice", "mi-tea", "mi-steak"]);
  });

  it("judges each variant by its own menu price under the Overridden only filter", async () => {
    const el = await mountVariants();
    await choose(el, "menu-price", "overridden");
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
    await search(el, "15.00");
    expect(shown(el)).toEqual(["mi-wine", "mi-wine:v-carafe"]);
    await search(el, "1500");
    expect(shown(el)).toEqual([]);
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

  it("offers every column but the product's in the column chooser, with the combined price hidden until chosen, and remembers the choice", async () => {
    const el = await mountVariants();
    const trigger = table(el).shadowRoot.querySelector(".columns-trigger")!;
    expect(text(trigger)).toBe(t("menu_prices.columns"));
    const choices = [
      ...table(el).shadowRoot.querySelectorAll<HTMLInputElement>("input[data-column]"),
    ].map((box) => [box.dataset.column, box.checked]);
    expect(choices).toEqual([
      ["placements", true],
      ["category", true],
      ["product-price", true],
      ["menu-price", true],
      ["effective-price", true],
      ["price-on-menu", false],
      ["active", true],
    ]);
    expect(headers(el)).toEqual([
      "name",
      "placements",
      "category",
      "product-price",
      "menu-price",
      "effective-price",
      "active",
    ]);
    await showCombined(el);
    expect(headers(el)).toContain("price-on-menu");
    const th = [...table(el).shadowRoot.querySelectorAll("thead th")][
      headers(el).indexOf("price-on-menu")
    ]!;
    expect(text(th)).toContain(t("menu_prices.price_on_menu"));
    expect(JSON.parse(localStorage.getItem("waitron.menus.prices:columns")!)).toMatchObject({
      "price-on-menu": true,
    });
  });

  describe("the combined price on this menu", () => {
    async function mountCombined() {
      const el = await mountVariants({ rows: [burger, steak, soup, wine, juice, tea, cider] });
      await showCombined(el);
      return el;
    }
    const combined = (el: MenuPricesTable, key: string) => cell(el, "price-on-menu", key);

    it("greys out the charged price when no menu price applies, and says so to a screen reader", async () => {
      const el = await mountCombined();
      await expand(el, "mi-cider");
      for (const [key, price] of [
        ["mi-burger", "12.00"],
        ["mi-cider", range("4.00", "4.50")],
        ["mi-cider:v-pint", "4.50"],
        ["mi-cider:v-half", "4.00"],
      ] as const) {
        const muted = combined(el, key).querySelector("[part~=muted]")!;
        expect(visibleText(muted), key).toBe(price);
        expect(getComputedStyle(muted).color).toBe(mutedColour(el));
        const hidden = muted.querySelector('[part~="visually-hidden"]')!;
        expect(hidden.textContent!.trim(), key).toBe("(no se aplica ningún precio del menú)");
        expectClipped(hidden);
        expect(combined(el, key).querySelector("s")).toBeNull();
      }
    });

    it("greys out a product with a menu price whose offered variants each charge a price of their own", async () => {
      const el = await mountVariants({
        rows: [
          {
            ...juice,
            override: "4.50",
            effectivePrice: "4.50",
            variants: juice.variants.map((v) => ({ ...v, price: null })),
          },
        ],
      });
      await showCombined(el);
      await expand(el, "mi-juice");
      expect(visibleText(cell(el, "menu-price", "mi-juice"))).toBe("4.50");
      for (const [key, price] of [
        ["mi-juice", range("3.00", "5.00")],
        ["mi-juice:v-juice-small", "3.00"],
      ] as const) {
        const muted = combined(el, key).querySelector("[part~=muted]")!;
        expect(visibleText(muted), key).toBe(price);
        expect(muted.querySelector('[part~="visually-hidden"]')!.textContent!.trim(), key).toBe(
          "(no se aplica ningún precio del menú)",
        );
      }
    });

    it("says in English that no menu price applies", async () => {
      setLocale("en-GB");
      try {
        const el = await mountCombined();
        await expand(el, "mi-cider");
        for (const key of ["mi-cider", "mi-cider:v-pint"])
          expect(
            combined(el, key).querySelector('[part~="visually-hidden"]')!.textContent!.trim(),
            key,
          ).toBe("(no menu price applies)");
      } finally {
        setLocale("es-ES");
      }
    });

    it("strikes out the product's price beside a different menu price, telling a screen reader it was the price", async () => {
      const el = await mountCombined();
      for (const [key, was, now] of [
        ["mi-steak", "20.00", "18.00"],
        // The juice's only menu price is its small size's.
        ["mi-juice", range("3.00", "5.00"), range("3.50", "5.00")],
        ["mi-wine", range("6.00", "14.00"), range("7.00", "13.00")],
      ] as const) {
        const struck = combined(el, key).querySelector("s")!;
        expect(struck.textContent!.trim(), key).toBe(was);
        expect(getComputedStyle(struck).textDecorationLine).toBe("line-through");
        expect(visibleText(combined(el, key))).toBe(`${was} ${now}`);
        const hidden = combined(el, key).querySelector('[part~="visually-hidden"]')!;
        expect(hidden.textContent!.trim()).toBe(t("menu_prices.price_was"));
        expectClipped(hidden);
        expect(combined(el, key).querySelector("[part~=muted]")).toBeNull();
      }
    });

    it("shows a menu price equal to the product's price plainly", async () => {
      const el = await mountCombined();
      expect(visibleText(combined(el, "mi-soup"))).toBe("5.00");
      expect(
        combined(el, "mi-soup").querySelector("s, [part~=muted], [part~=visually-hidden]"),
      ).toBeNull();
    });

    it("shows a range plainly when the menu prices that apply leave it the same", async () => {
      const el = await mountVariants({
        rows: [
          {
            ...cider,
            variants: [
              { variantId: "v-pint", price: "4.50", offered: true },
              { variantId: "v-half", price: null, offered: true },
            ],
          },
        ],
      });
      await showCombined(el);
      expect(visibleText(combined(el, "mi-cider"))).toBe(range("4.00", "4.50"));
      expect(combined(el, "mi-cider").querySelector("s, [part~=muted]")).toBeNull();
    });

    it("counts the product's menu price as applying to an offered variant with no price of its own", async () => {
      const el = await mountVariants({
        rows: [{ ...wine, variants: [{ variantId: "v-bottle", price: null, offered: true }] }],
      });
      await showCombined(el);
      expect(combined(el, "mi-wine").querySelector("s")!.textContent!.trim()).toBe("10.00");
      expect(visibleText(combined(el, "mi-wine"))).toBe("10.00 13.00");
    });

    it("ignores a menu price on a variant that is not offered", async () => {
      const el = await mountVariants({
        rows: [
          {
            ...juice,
            variants: [
              { variantId: "v-juice-small", price: "3.50", offered: false },
              { variantId: "v-juice-large", price: null, offered: true },
            ],
          },
        ],
      });
      await showCombined(el);
      const muted = combined(el, "mi-juice").querySelector("[part~=muted]")!;
      expect(visibleText(muted)).toBe("5.00");
      expect(combined(el, "mi-juice").querySelector("s")).toBeNull();
    });

    it("says no variant is offered for a product sold as variants none of which is offered", async () => {
      const el = await mountCombined();
      const muted = combined(el, "mi-tea").querySelector("[part~=muted]")!;
      expect(visibleText(muted)).toBe(t("menu_prices.no_variant_offered"));
      expect(combined(el, "mi-tea").querySelector("s, [part~=visually-hidden]")).toBeNull();
    });

    it("shows each variant's own price against what this menu charges for it", async () => {
      const el = await mountCombined();
      await expand(el, "mi-wine", "mi-juice");
      // The bottle has no price of its own, so the product's menu price applies to it.
      for (const [key, was, now] of [
        ["mi-wine:v-glass", "6.00", "7.00"],
        ["mi-wine:v-bottle", "10.00", "13.00"],
        ["mi-wine:v-carafe", "14.00", "15.00"],
        ["mi-juice:v-juice-small", "3.00", "3.50"],
      ] as const) {
        expect(combined(el, key).querySelector("s")!.textContent!.trim(), key).toBe(was);
        expect(visibleText(combined(el, key)), key).toBe(`${was} ${now}`);
      }
      const large = combined(el, "mi-juice:v-juice-large");
      expect(visibleText(large.querySelector("[part~=muted]")!)).toBe("5.00");
      expect(large.querySelector("s")).toBeNull();
    });

    it("sorts by the price charged", async () => {
      const el = await mountCombined();
      await sortBy(el, "price-on-menu");
      expect(shown(el)).toEqual([
        "mi-juice",
        "mi-cider",
        "mi-soup",
        "mi-wine",
        "mi-burger",
        "mi-steak",
        "mi-tea",
      ]);
    });
  });
});
