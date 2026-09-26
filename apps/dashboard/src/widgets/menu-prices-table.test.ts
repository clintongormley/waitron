import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  CategorySummary,
  LibrarySection,
  MenuPriceRow,
  MenuVariant,
  Product,
} from "../api/client.js";
import { t } from "../i18n/t.js";
import { MenuPricesTable, type OfferSave } from "./menu-prices-table.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

afterEach(cleanupWidgets);
beforeEach(() => sessionStorage.clear());

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

const COLUMNS = [
  "name",
  "placements",
  "category",
  "product-price",
  "menu-price",
  "effective-price",
  "active",
];

/** The text of one column's cell in each shown row, in order. */
function column(el: MenuPricesTable, key: string): string[] {
  const index = COLUMNS.indexOf(key);
  expect(table(el).shadowRoot.querySelectorAll("thead th")).toHaveLength(COLUMNS.length);
  return [...table(el).shadowRoot.querySelectorAll("tbody tr")].map((tr) =>
    text(tr.children[index]),
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
  expect(column(el, "product-price")).toEqual(["12.00", "3.00", "2.00"]);
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
