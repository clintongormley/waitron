import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { CATEGORY_PALETTE, setContentLanguages } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import type {
  DocumentMember,
  DocumentTile,
  HomeDevice,
  HomeDisplay,
} from "@waitron/catalogue/src/menu-document-types.js";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, mountWidget, type Theme } from "./test-helpers.js";
import { TillMenuBrowser } from "./menu-browser.js";
import type { ModifierConfirmDetail } from "./modifier-picker.js";
import { sellingValuesOf, type TillProduct, type TillZoneMenu } from "../api/client.js";

const EACH = {
  id: "unit-each",
  name: { es: "unidad", en: "each" },
  abbreviation: { es: "ud", en: "ea" },
  precision: 0,
  hardwareUnit: null,
};

function product(key: string, name: string, extra: Partial<TillProduct> = {}): TillProduct {
  return {
    id: `p-${key}`,
    productId: `p-${key}`,
    menuItemId: `mi-${key}`,
    menuVersionId: "v1",
    available: true,
    name,
    customerName: { es: `${name} carta` },
    kitchenName: `${name} KDS`,
    unit: EACH,
    unitPrice: "1.50",
    vatClass: "general",
    category: null,
    allergens: null,
    ...extra,
  };
}

const cafe = product("cafe", "Café");
const lemonade = product("lemonade", "Lemonade");
const cola = product("cola", "Cola");
const cana = product("cana", "Caña");
const water = product("water", "Agua");
const tostada = product("tostada", "Tostada");
const burger = product("burger", "Burger", { available: false });
const jamon = product("jamon", "Jamón", {
  unitPrice: "10.00",
  unit: {
    id: "unit-kg",
    name: { es: "kg" },
    abbreviation: { es: "kg" },
    precision: 3,
    hardwareUnit: "kg",
  },
});
const wine = product("wine", "Vino", {
  variants: [
    {
      ...sellingValuesOf(cafe),
      id: "v-glass",
      name: "Copa",
      unitPrice: "3.00",
      unitPriceDifference: null,
      available: true,
    },
  ],
});

function member(key: string): DocumentMember {
  return { kind: "product", menuItemId: `mi-${key}`, productId: `p-${key}` };
}

function section(
  id: string,
  internalName: string,
  names: Record<string, string>,
  members: DocumentMember[],
  color: string | null = null,
  image: string | null = null,
): DocumentMember {
  return { kind: "section", sectionId: id, internalName, names, image, color, members };
}

// Every section's internal name and each of its customer names are different texts, so a reader of
// the wrong one fails (D3).
const beer = section("sec-beer", "beer-internal", { en: "Beer (EN)", es: "Cerveza (ES)" }, [
  member("cana"),
  member("ghost"),
]);
const drinks = section("sec-drinks", "drinks-internal", { en: "Drinks (EN)", es: "Bebidas (ES)" }, [
  member("cola"),
  member("lemonade"),
  beer,
]);
const food = section("sec-food", "food-internal", { es: "Comida (ES)" }, [
  member("jamon"),
  member("burger"),
  member("wine"),
  member("ghost"),
]);
const favourites = section(
  "sec-fav",
  "fav-internal",
  { en: "Favourites (EN)", es: "Favoritos (ES)" },
  [member("lemonade"), member("cafe")],
);
// Its one member has no offer, so it holds nothing to order.
const empty = section("sec-empty", "empty-internal", { en: "Empty (EN)" }, [member("ghost")]);
const plain = section("sec-plain", "plain-internal", {}, [member("tostada")]);

const productTile = (key: string): DocumentTile => ({ kind: "product", productId: `p-${key}` });
const sectionTile = (id: string): DocumentTile => ({ kind: "section", sectionId: id });

const HOME_TILES: DocumentTile[] = [
  productTile("cafe"),
  productTile("burger"),
  sectionTile("sec-drinks"),
  productTile("ghost"),
  sectionTile("sec-empty"),
  productTile("water"),
];
const FOUR_TILES: DocumentTile[] = [
  productTile("cafe"),
  productTile("burger"),
  productTile("cola"),
  productTile("water"),
];
const COUNTER_TILES: DocumentTile[] = [sectionTile("sec-beer"), productTile("jamon")];

/** A Device Home Page at the default display settings holding `tiles`. */
function withShortcuts(tiles: DocumentTile[]): Pick<TillZoneMenu, "home"> {
  return {
    home: {
      shortcuts: tiles,
      handheld: HOME_DISPLAY_DEFAULTS.handheld,
      till: HOME_DISPLAY_DEFAULTS.till,
    },
  };
}

function lunch(overrides: Partial<TillZoneMenu> = {}): TillZoneMenu {
  return {
    id: "menu-lunch",
    name: "Lunch",
    isDefault: true,
    versionId: "v1",
    structure: {
      members: [favourites, drinks, food, empty, plain, member("water"), member("ghost")],
    },
    ...withShortcuts(HOME_TILES),
    ...overrides,
  };
}

/** `menu` with `device`'s display settings changed to `values`. */
function display(
  device: HomeDevice,
  values: Partial<HomeDisplay>,
  menu: TillZoneMenu = lunch(),
): TillZoneMenu {
  return { ...menu, home: { ...menu.home, [device]: { ...menu.home[device], ...values } } };
}

const tarta = product("tarta", "Tarta", { available: false });

const PRODUCTS = [cafe, lemonade, cola, cana, water, tostada, burger, jamon, wine, tarta];

/** Burger is placed under Food and under a section whose every product is sold out. */
function soldOutMenu(): TillZoneMenu {
  const soldOut = section("sec-soldout", "soldout-internal", { en: "Sold out (EN)" }, [
    member("burger"),
    member("tarta"),
  ]);
  return lunch({
    structure: { members: [food, soldOut, member("water")] },
    ...withShortcuts([sectionTile("sec-soldout"), productTile("water")]),
  });
}

type Button = HTMLElement & { disabled: boolean };

async function mount(
  props: Partial<TillMenuBrowser> = {},
): Promise<{ el: TillMenuBrowser; host: HTMLElement; store: WorkingOrderStore }> {
  const store = new WorkingOrderStore();
  const { el, host } = await mountWidget<TillMenuBrowser>("till-menu-browser", {
    menu: lunch(),
    products: PRODUCTS,
    store,
    ...props,
  });
  return { el, host, store };
}

function root(el: TillMenuBrowser): ShadowRoot {
  return el.shadowRoot!;
}

function regions(el: TillMenuBrowser): string[] {
  return [...root(el).querySelectorAll<HTMLElement>("[data-region]")].map(
    (region) => region.dataset.region!,
  );
}

function entries(el: TillMenuBrowser, region: string): Button[] {
  return [...root(el).querySelectorAll<Button>(`[data-region="${region}"] wt-button[data-kind]`)];
}

function names(buttons: Button[]): string[] {
  return buttons.map((button) => button.querySelector(".name")!.textContent!.trim());
}

function entry(el: TillMenuBrowser, region: string, name: string): Button {
  const found = entries(el, region).find(
    (button) => button.querySelector(".name")!.textContent!.trim() === name,
  );
  if (!found) throw new Error(`no ${region} entry named ${name}`);
  return found;
}

async function tap(el: TillMenuBrowser, button: HTMLElement): Promise<void> {
  button.click();
  await el.updateComplete;
}

function breadcrumb(el: TillMenuBrowser): string {
  return [...root(el).querySelectorAll("nav.breadcrumb li")]
    .map((item) => item.querySelector("wt-button, [aria-current]")!.textContent!.trim())
    .join(" › ");
}

/** Sets the host's width and waits for the layout to follow. */
async function widen(host: HTMLElement, width: number): Promise<void> {
  host.style.width = `${width}px`;
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

/** How many column tracks a grid lays out. */
function tracks(grid: HTMLElement): number {
  return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
}

/** A region's entries in the order a person reads them: row by row, left to right. */
function readingOrder(el: TillMenuBrowser, region: string): string[] {
  const placed = entries(el, region).map((button) => ({
    name: button.querySelector(".name")!.textContent!.trim(),
    box: button.getBoundingClientRect(),
  }));
  placed.sort((a, b) => Math.round(a.box.top - b.box.top) || a.box.left - b.box.left);
  return placed.map(({ name }) => name);
}

async function search(el: TillMenuBrowser, text: string): Promise<void> {
  const input = root(el).querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

function notice(el: TillMenuBrowser): string | null {
  return root(el).querySelector("[role='alert']")?.textContent?.trim() ?? null;
}

afterEach(() => {
  setLocale("en-GB");
  cleanupWidgets();
});

describe("till-menu-browser", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-menu-browser")).toBe(TillMenuBrowser);
  });

  it("renders nothing until it is given a menu", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillMenuBrowser>("till-menu-browser", {
      products: PRODUCTS,
      store,
    });
    expect(root(el).children).toHaveLength(0);
    el.menu = lunch();
    await el.updateComplete;
    expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
  });

  describe("layout", () => {
    it("puts the search first, then the shortcut grid, then the full structure", async () => {
      const { el } = await mount();
      expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
      expect(root(el).querySelector('[data-region="search"] wt-input')).not.toBeNull();
    });

    it("shows the menu's shortcuts, in their order", async () => {
      const { el } = await mount({ menu: lunch(withShortcuts(COUNTER_TILES)) });
      expect(names(entries(el, "shortcuts"))).toEqual(["Beer (EN)", "Jamón"]);
    });

    it("accepts an empty shortcut while keeping the neighboring actions usable", async () => {
      const { el } = await mount({
        menu: lunch({
          ...withShortcuts([productTile("water"), { kind: "empty" }, sectionTile("sec-drinks")]),
        }),
      });
      expect(names(entries(el, "shortcuts"))).toEqual(["Agua", "Drinks (EN)"]);
      expect(names(entries(el, "structure"))).toContain("Agua");
    });

    it.each([
      ["explicit empty", { kind: "empty" }],
      ["missing offer", productTile("ghost")],
      ["not sold separately", productTile("cola")],
      ["section with nothing orderable", sectionTile("sec-empty")],
      ["missing section", sectionTile("sec-gone")],
    ] as const)("keeps a blank, untappable home cell for %s", async (_reason, tile) => {
      const { el, store } = await mount({
        menu: lunch({
          ...withShortcuts([productTile("cafe"), tile, productTile("water")]),
        }),
        products: PRODUCTS.map((each) =>
          each === cola ? { ...each, ordering: "not_sold_separately" } : each,
        ),
      });
      const cells = [
        ...root(el).querySelectorAll<HTMLElement>('[data-region="shortcuts"] .grid > *'),
      ];
      expect(cells.map((cell) => cell.localName)).toEqual(["wt-button", "span", "wt-button"]);
      const blank = cells[1]!;
      expect(blank.getAttribute("aria-hidden")).toBe("true");
      expect(blank.tabIndex).toBe(-1);
      expect(blank.querySelector("button, wt-button")).toBeNull();
      blank.click();
      await el.updateComplete;
      expect(store.lines).toEqual([]);
      expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
      expect(names(entries(el, "structure"))).toEqual([
        "Favourites (EN)",
        "Drinks (EN)",
        "Comida (ES)",
        "plain-internal",
        "Agua",
      ]);
      await tap(el, cells[2]!);
      expect(store.lines).toEqual([{ product: water, quantity: "1" }]);
    });

    it.each([3, 6])("sizes a blank cell like a tile at %i columns", async (columns) => {
      const { el, host } = await mount({ columns });
      await widen(host, columns === 3 ? 390 : 1280);
      const cells = [
        ...root(el).querySelectorAll<HTMLElement>('[data-region="shortcuts"] .grid > *'),
      ];
      expect(cells).toHaveLength(6);
      expect(cells[3]!.localName).toBe("span");
      expect(cells[4]!.localName).toBe("span");
      const tile = cells[0]!.getBoundingClientRect();
      const blank = cells[3]!.getBoundingClientRect();
      expect(blank.width).toBeCloseTo(tile.width, 0);
      expect(blank.height).toBeGreaterThanOrEqual(66);
      expect(cells[5]!.getBoundingClientRect().left).toBeGreaterThan(blank.left);
    });

    it("sizes blank cells from the tile's tap target token", async () => {
      const { el, host } = await mount({
        menu: lunch({
          ...withShortcuts([productTile("cafe"), { kind: "empty" }]),
        }),
      });
      host.style.setProperty("--wt-tap-min", "60px");
      const blank = root(el).querySelector<HTMLElement>('[data-region="shortcuts"] .slot')!;
      expect(getComputedStyle(blank).minHeight).toBe("90px");
    });

    it("shows no shortcut block, no divider, and still the structure, for a menu with no shortcuts", async () => {
      const { el } = await mount({ menu: lunch(withShortcuts([])) });
      expect(regions(el)).toEqual(["search", "structure"]);
      expect(root(el).querySelector(".divider")).toBeNull();
      expect(names(entries(el, "structure"))).toContain("Agua");
    });

    it("lists the menu's top level in the structure, sections and products in order", async () => {
      const { el } = await mount();
      expect(names(entries(el, "structure"))).toEqual([
        "Favourites (EN)",
        "Drinks (EN)",
        "Comida (ES)",
        "plain-internal",
        "Agua",
      ]);
      expect(entries(el, "structure").map((button) => button.dataset.kind)).toEqual([
        "section",
        "section",
        "section",
        "section",
        "product",
      ]);
    });

    it("tells a section from a product by text and an icon, not colour alone", async () => {
      const { el } = await mount();
      const sectionEntry = entry(el, "shortcuts", "Drinks (EN)");
      const productEntry = entry(el, "shortcuts", "Café");
      const icon = sectionEntry.querySelector("wt-icon")!;
      expect(icon.getAttribute("name")).toBe("menu-section");
      await (icon as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
      expect(icon.shadowRoot!.querySelector("svg path")).not.toBeNull();
      expect(sectionEntry.querySelector(".kind")!.textContent!.trim()).toBe("Section");
      expect(productEntry.querySelector("wt-icon")).toBeNull();
      expect(productEntry.querySelector(".kind")).toBeNull();
      expect(productEntry.querySelector(".price")!.textContent).toBe(
        `${formatMoney("1.50", currentLocale())}/ea`,
      );
    });

    it("keeps the tile order at handheld and till column counts", async () => {
      const handheld = await mount({ columns: 3 });
      const till = await mount({ columns: 6 });
      expect(names(entries(till.el, "shortcuts"))).toEqual(
        names(entries(handheld.el, "shortcuts")),
      );
      expect(names(entries(till.el, "structure"))).toEqual(
        names(entries(handheld.el, "structure")),
      );
      for (const [{ el, host }, columns] of [
        [handheld, 3],
        [till, 6],
      ] as const) {
        await widen(host, 1280);
        const grids = [...root(el).querySelectorAll<HTMLElement>(".grid")];
        expect(grids).toHaveLength(2);
        for (const grid of grids) expect(tracks(grid)).toBe(columns);
      }
    });

    it("breaks a word longer than the tile inside the tile, rather than letting it spill out", async () => {
      const long = product("long", "Supercalifragilisticexpialidocious");
      const { el, host } = await mount({
        columns: 3,
        menu: lunch({ structure: { members: [member("long")] } }),
        products: [long],
      });
      await widen(host, 390);
      const tile = entry(
        el,
        "structure",
        "Supercalifragilisticexpialidocious",
      ).getBoundingClientRect();
      const text = document.createRange();
      text.selectNodeContents(entries(el, "structure")[0]!.querySelector(".name")!);
      const name = text.getBoundingClientRect();
      expect(name.left).toBeGreaterThanOrEqual(tile.left);
      expect(name.right).toBeLessThanOrEqual(tile.right);
    });

    it("shows fewer columns where a tile would be too narrow, in the same order", async () => {
      const { el, host } = await mount({ columns: 6 });
      await widen(host, 1280);
      const wide = readingOrder(el, "structure");
      const shortcuts = readingOrder(el, "shortcuts");
      await widen(host, 300);
      const grid = root(el).querySelector<HTMLElement>('[data-region="structure"] .grid')!;
      // 300 px holds two 104 px minimums and the 12 px gap between them, not three.
      expect(tracks(grid)).toBe(2);
      expect(readingOrder(el, "structure")).toEqual(wide);
      expect(readingOrder(el, "shortcuts")).toEqual(shortcuts);
      expect(wide).toEqual(names(entries(el, "structure")));
    });

    it("wraps a tile's label only between words, the section icon keeping its size", async () => {
      const long = section("sec-long", "long", { en: "Platos principales" }, [member("cafe")]);
      const short = section("sec-short", "short", { en: "Bar" }, [member("cola")]);
      const desserts = section("sec-desserts", "desserts", { en: "Desserts" }, [member("water")]);
      // A till's six columns at a phone's width.
      const { el, host } = await mount({
        columns: 6,
        menu: lunch({
          structure: { members: [long, short, desserts, member("lemonade")] },
          ...withShortcuts([]),
        }),
      });
      await widen(host, 390);
      for (const tile of entries(el, "structure")) {
        const text = [...tile.querySelector(".name")!.childNodes].find(
          (node): node is Text => node instanceof Text && node.data.trim() !== "",
        )!;
        for (const match of text.data.matchAll(/\S+/g)) {
          const word = document.createRange();
          word.setStart(text, match.index);
          word.setEnd(text, match.index + match[0].length);
          expect(word.getClientRects(), `"${match[0]}" split`).toHaveLength(1);
        }
      }
      const icon = (name: string) =>
        entry(el, "structure", name).querySelector("wt-icon")!.getBoundingClientRect();
      expect(icon("Platos principales").width).toBe(icon("Bar").width);
      expect(icon("Platos principales").height).toBe(icon("Bar").height);
    });

    it("shows the till's column setting when no column count is given", async () => {
      const { el, host } = await mount({ menu: display("till", { columns: 8 }) });
      await widen(host, 1280);
      const grids = [...root(el).querySelectorAll<HTMLElement>(".grid")];
      expect(grids).toHaveLength(2);
      for (const grid of grids) expect(tracks(grid)).toBe(8);
    });

    it("shows a product's staff name, never its customer or kitchen name, on a tile and a search result", async () => {
      const { el } = await mount();
      const cafeName = (button: Button) => button.querySelector(".name")!.textContent!.trim();
      expect(cafeName(entries(el, "shortcuts")[0]!)).toBe("Café");
      await search(el, "caf");
      expect(entries(el, "results").map(cafeName)).toEqual(["Café"]);
      expect(root(el).querySelector('[data-region="results"]')!.textContent).not.toMatch(
        /carta|KDS/,
      );
    });
  });

  describe("the Device Home Page's display", () => {
    /** The region's accessible name: its own label, or the text of the element labelling it. */
    function regionName(el: TillMenuBrowser, region: string): string | null {
      const node = root(el).querySelector<HTMLElement>(`[data-region="${region}"]`)!;
      const labelledBy = node.getAttribute("aria-labelledby");
      if (labelledBy === null) return node.getAttribute("aria-label");
      return root(el).getElementById(labelledBy)?.textContent?.trim() ?? null;
    }

    const divider = (el: TillMenuBrowser) =>
      root(el).querySelector<HTMLElement>("h2.divider")?.textContent?.trim() ?? null;

    function grids(el: TillMenuBrowser): HTMLElement[] {
      return [...root(el).querySelectorAll<HTMLElement>(".grid")];
    }

    it("draws the blocks in the till's order: Device Home Page first, with the divider naming the full menu", async () => {
      const { el } = await mount();
      expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
      const shortcuts = root(el).querySelector('[data-region="shortcuts"]')!;
      expect(shortcuts.querySelector("h2")).toBeNull();
      expect(shortcuts.getAttribute("aria-label")).toBe("Shortcuts");
      const structure = root(el).querySelector('[data-region="structure"]')!;
      expect(structure.querySelector("h2.divider")!.textContent!.trim()).toBe("Full menu");
      expect(regionName(el, "structure")).toBe("Full menu");
    });

    it("swaps the whole blocks for Menu first, keeping each block's own order", async () => {
      const homeFirst = await mount();
      const shortcutNames = names(entries(homeFirst.el, "shortcuts"));
      const structureNames = names(entries(homeFirst.el, "structure"));
      const { el } = await mount({ menu: display("till", { order: "menu_first" }) });
      expect(regions(el)).toEqual(["search", "structure", "shortcuts"]);
      expect(divider(el)).toBe("Shortcuts");
      expect(regionName(el, "shortcuts")).toBe("Shortcuts");
      expect(regionName(el, "structure")).toBe("Full menu");
      expect(root(el).querySelector('[data-region="structure"] h2')).toBeNull();
      expect(names(entries(el, "shortcuts"))).toEqual(shortcutNames);
      expect(names(entries(el, "structure"))).toEqual(structureNames);
    });

    it("uses the handheld's display on a handheld and the till's on a till, from one shortcut list", async () => {
      const menu = display(
        "till",
        { columns: 8 },
        display("handheld", { columns: 4, order: "menu_first" }),
      );
      const handheld = await mount({ menu, handheld: true });
      const till = await mount({ menu, handheld: false });
      expect(regions(handheld.el)).toEqual(["search", "structure", "shortcuts"]);
      expect(regions(till.el)).toEqual(["search", "shortcuts", "structure"]);
      for (const [{ el, host }, columns] of [
        [handheld, 4],
        [till, 8],
      ] as const) {
        await widen(host, 1280);
        expect(grids(el)).toHaveLength(2);
        for (const grid of grids(el)) expect(tracks(grid)).toBe(columns);
      }
      expect(names(entries(handheld.el, "shortcuts"))).toEqual(
        names(entries(till.el, "shortcuts")),
      );
    });

    it("returns from a section opened under Menu first to the arranged home", async () => {
      const { el } = await mount({
        menu: display("handheld", { order: "menu_first" }),
        handheld: true,
      });
      await tap(el, entry(el, "structure", "Drinks (EN)"));
      expect(regions(el)).toEqual(["search", "section"]);
      await tap(el, root(el).querySelector<HTMLElement>("nav.breadcrumb wt-button")!);
      expect(regions(el)).toEqual(["search", "structure", "shortcuts"]);
      expect(divider(el)).toBe("Shortcuts");
    });

    it("draws no shortcut block and no divider when every shortcut is missing", async () => {
      const { el } = await mount({
        menu: lunch(
          withShortcuts([{ kind: "empty" }, productTile("ghost"), sectionTile("sec-gone")]),
        ),
      });
      expect(regions(el)).toEqual(["search", "structure"]);
      expect(root(el).querySelector(".divider")).toBeNull();
      expect(regionName(el, "structure")).toBe("Full menu");
      expect(names(entries(el, "structure"))).toContain("Agua");
    });

    it("clamps the columns on a narrow screen, keeping the reading order", async () => {
      const handheld = await mount({
        menu: display("handheld", { columns: 3 }),
        handheld: true,
      });
      await widen(handheld.host, 1280);
      const structureGrid = (el: TillMenuBrowser) =>
        root(el).querySelector<HTMLElement>('[data-region="structure"] .grid')!;
      expect(tracks(structureGrid(handheld.el))).toBe(3);
      const wide = readingOrder(handheld.el, "structure");
      const wideShortcuts = readingOrder(handheld.el, "shortcuts");
      await widen(handheld.host, 150);
      expect(tracks(structureGrid(handheld.el))).toBe(2);
      expect(readingOrder(handheld.el, "structure")).toEqual(wide);
      expect(readingOrder(handheld.el, "shortcuts")).toEqual(wideShortcuts);
      expect(wide).toEqual(names(entries(handheld.el, "structure")));

      const till = await mount({ menu: display("till", { columns: 10 }) });
      await widen(till.host, 1280);
      expect(tracks(structureGrid(till.el))).toBe(10);
      const tillWide = readingOrder(till.el, "structure");
      await widen(till.host, 900);
      expect(tracks(structureGrid(till.el))).toBeLessThan(10);
      for (const tile of entries(till.el, "structure"))
        expect(tile.getBoundingClientRect().width).toBeGreaterThanOrEqual(104);
      expect(readingOrder(till.el, "structure")).toEqual(tillWide);
    });

    it("lets a canvas card's own column count win over the display's", async () => {
      const { el, host } = await mount({ menu: display("till", { columns: 8 }), columns: 4 });
      await widen(host, 1280);
      for (const grid of grids(el)) expect(tracks(grid)).toBe(4);
    });

    describe("tile modes", () => {
      const photo = product("photo", "Photo", { image: "cafe.webp", color: "#b12525" });
      const blue = product("blue", "Blue", { image: null, color: "#256bb1" });
      const bare = product("bare", "Bare");
      const pictured = section(
        "sec-pictured",
        "pictured-internal",
        { en: "Pictured (EN)" },
        [member("photo")],
        null,
        "drinks.webp",
      );
      const tiled = (values: Partial<HomeDisplay>, device: HomeDevice = "till") =>
        display(
          device,
          values,
          lunch({
            structure: { members: [member("photo"), member("blue"), member("bare"), pictured] },
            ...withShortcuts([]),
          }),
        );
      const image = (tile: Button) => tile.querySelector<HTMLImageElement>("img");

      it("paints Colours mode from the product's and the section's colour, and Thumbnails mode from the image, else the colour, else neutral", async () => {
        const thumbnails = await mount({
          menu: tiled({ tiles: "thumbnails" }),
          products: [photo, blue, bare],
        });
        const photoTile = entry(thumbnails.el, "structure", "Photo");
        const img = image(photoTile)!;
        expect(img.getAttribute("src")).toBe("/media/cafe.webp");
        expect(img.getAttribute("alt")).toBe("");
        expect(img.parentElement!.firstElementChild).toBe(img);
        expect(img.compareDocumentPosition(photoTile.querySelector(".name")!)).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
        expect(photoTile.hasAttribute("data-painted")).toBe(false);
        expect(photoTile.hasAttribute("style")).toBe(false);

        const blueTile = entry(thumbnails.el, "structure", "Blue");
        expect(image(blueTile)).toBeNull();
        expect(blueTile.hasAttribute("data-painted")).toBe(true);
        expect(
          getComputedStyle(blueTile.shadowRoot!.querySelector("button")!).backgroundColor,
        ).toBe("rgb(37, 107, 177)");

        const sectionTile = entry(thumbnails.el, "structure", "Pictured (EN)");
        expect(image(sectionTile)!.getAttribute("src")).toBe("/media/drinks.webp");
        expect(sectionTile.querySelector("wt-icon")).toBeNull();
        expect(sectionTile.querySelector(".kind")!.textContent!.trim()).toBe("Section");

        const colours = await mount({
          menu: tiled({ tiles: "colours" }),
          products: [photo, blue, bare],
        });
        const colourPhoto = entry(colours.el, "structure", "Photo");
        expect(image(colourPhoto)).toBeNull();
        expect(colourPhoto.hasAttribute("data-painted")).toBe(true);
        const colourSection = entry(colours.el, "structure", "Pictured (EN)");
        expect(image(colourSection)).toBeNull();
        expect(colourSection.querySelector("wt-icon")).not.toBeNull();
      });

      it("draws a product with neither image nor colour neutral in Thumbnails mode, name and price shown", async () => {
        const { el } = await mount({
          menu: tiled({ tiles: "thumbnails" }),
          products: [photo, blue, bare],
        });
        const tile = entry(el, "structure", "Bare");
        expect(image(tile)).toBeNull();
        expect(tile.hasAttribute("data-painted")).toBe(false);
        expect(tile.hasAttribute("style")).toBe(false);
        expect(tile.querySelector(".name")!.textContent!.trim()).toBe("Bare");
        expect(tile.querySelector(".price")!.textContent).toBe(
          `${formatMoney("1.50", currentLocale())}/ea`,
        );
      });

      it("draws search results and an open section in the device's tile mode", async () => {
        const menu = tiled({ tiles: "thumbnails" }, "handheld");
        const handheld = await mount({ menu, products: [photo, blue, bare], handheld: true });
        const till = await mount({ menu, products: [photo, blue, bare], handheld: false });
        for (const [{ el }, drawn] of [
          [handheld, true],
          [till, false],
        ] as const) {
          await search(el, "photo");
          expect(image(entry(el, "results", "Photo")) !== null).toBe(drawn);
          await search(el, "");
          await tap(el, entry(el, "structure", "Pictured (EN)"));
          expect(image(entry(el, "section", "Photo")) !== null).toBe(drawn);
        }
      });
    });

    it("opens a shortcut to an included menu's section behind the breadcrumb", async () => {
      const included: DocumentMember = {
        kind: "section",
        sectionId: "sec-bar-root",
        includedMenu: { id: "menu-bar", name: "Bar" },
        internalName: "bar-internal",
        names: { en: "Bar (EN)" },
        image: null,
        color: null,
        members: [member("cana"), member("cola")],
      };
      const { el } = await mount({
        menu: lunch({
          structure: { members: [favourites, included] },
          ...withShortcuts([sectionTile("sec-bar-root")]),
        }),
      });
      await tap(el, entry(el, "shortcuts", "Bar (EN)"));
      expect(breadcrumb(el)).toBe("Home › Bar (EN)");
      expect(names(entries(el, "section"))).toEqual(["Caña", "Cola"]);
      await tap(el, root(el).querySelector<HTMLElement>("nav.breadcrumb wt-button")!);
      expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
    });
  });

  describe("a product tile's price", () => {
    it("reads per unit, the weighed product's per kilo", async () => {
      const { el } = await mount({ menu: lunch(withShortcuts(COUNTER_TILES)) });
      expect(entry(el, "shortcuts", "Jamón").querySelector(".price")!.textContent).toBe(
        `${formatMoney("10.00", currentLocale())}/kg`,
      );
    });

    it("follows a change of the venue's content languages in its unit, and never in the staff name", async () => {
      // The pain carries a customer name in both configured languages; the tile still shows the
      // staff name, while its unit abbreviation is per-language content and re-resolves.
      setLocale("es-ES");
      setContentLanguages({ defaultLanguage: "fr", languages: ["fr", "en"] });
      try {
        const pain = product("pain", "Pain", {
          customerName: { fr: "Baguette", en: "Bread" },
          unit: {
            id: "unit-each",
            name: { fr: "pièce", en: "each" },
            abbreviation: { fr: "pc", en: "ea" },
            precision: 0,
            hardwareUnit: null,
          },
        });
        const { el } = await mount({
          menu: lunch({ structure: { members: [member("pain")] } }),
          products: [pain],
        });
        const tile = () => entry(el, "structure", "Pain");
        expect(tile().querySelector(".price")!.textContent).toContain("/pc");
        setContentLanguages({ defaultLanguage: "en", languages: ["en", "fr"] });
        await el.updateComplete;
        expect(tile().querySelector(".price")!.textContent).toContain("/ea");
        expect(tile().querySelector(".name")!.textContent).toBe("Pain");
      } finally {
        setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
      }
    });
  });

  describe("sections", () => {
    it("opens a section tile's section, with a breadcrumb back home", async () => {
      const { el } = await mount();
      await tap(el, entry(el, "shortcuts", "Drinks (EN)"));
      expect(regions(el)).toEqual(["search", "section"]);
      expect(breadcrumb(el)).toBe("Home › Drinks (EN)");
      expect(names(entries(el, "section"))).toEqual(["Cola", "Lemonade", "Beer (EN)"]);

      await tap(el, entry(el, "section", "Beer (EN)"));
      expect(breadcrumb(el)).toBe("Home › Drinks (EN) › Beer (EN)");
      expect(names(entries(el, "section"))).toEqual(["Caña"]);

      const crumbs = [...root(el).querySelectorAll<HTMLElement>("nav.breadcrumb wt-button")];
      await tap(el, crumbs[1]!);
      expect(breadcrumb(el)).toBe("Home › Drinks (EN)");

      await tap(el, root(el).querySelector<HTMLElement>("nav.breadcrumb wt-button")!);
      expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
    });

    it("marks the section being shown as the current place in the breadcrumb", async () => {
      const { el } = await mount();
      await tap(el, entry(el, "structure", "Drinks (EN)"));
      const current = root(el).querySelector("nav.breadcrumb [aria-current]")!;
      expect(current.textContent!.trim()).toBe("Drinks (EN)");
      expect(current.tagName).not.toBe("WT-BUTTON");
    });

    it("opens a nested section a tile names directly", async () => {
      const { el } = await mount({ menu: lunch(withShortcuts(COUNTER_TILES)) });
      await tap(el, entry(el, "shortcuts", "Beer (EN)"));
      expect(breadcrumb(el)).toBe("Home › Beer (EN)");
      expect(names(entries(el, "section"))).toEqual(["Caña"]);
    });

    it("opens a section from the full structure", async () => {
      const { el } = await mount();
      await tap(el, entry(el, "structure", "Comida (ES)"));
      expect(breadcrumb(el)).toBe("Home › Comida (ES)");
      expect(names(entries(el, "section"))).toEqual(["Jamón", "Burger", "Vino"]);
    });
  });

  describe("section names (D3)", () => {
    it("shows the name in the till's language, then the venue's default language, then the internal name", async () => {
      const { el } = await mount();
      // Content languages are es (default) and en; the till speaks English.
      expect(names(entries(el, "structure")).slice(0, 4)).toEqual([
        "Favourites (EN)",
        "Drinks (EN)",
        "Comida (ES)",
        "plain-internal",
      ]);
    });

    it("follows a switch of the till's language", async () => {
      const { el } = await mount();
      setLocale("es-ES");
      await el.updateComplete;
      expect(names(entries(el, "structure")).slice(0, 4)).toEqual([
        "Favoritos (ES)",
        "Bebidas (ES)",
        "Comida (ES)",
        "plain-internal",
      ]);
      expect(
        entry(el, "structure", "Bebidas (ES)").querySelector(".kind")!.textContent!.trim(),
      ).toBe("Sección");
      await tap(el, entry(el, "structure", "Bebidas (ES)"));
      expect(breadcrumb(el)).toBe("Inicio › Bebidas (ES)");
    });
  });

  describe("search", () => {
    it("covers the whole menu whatever section is open, listing a product under two sections once", async () => {
      const { el } = await mount();
      await tap(el, entry(el, "structure", "Comida (ES)"));
      await search(el, "lemon");
      expect(regions(el)).toEqual(["search", "results"]);
      expect(names(entries(el, "results"))).toEqual(["Lemonade"]);

      await search(el, "a");
      expect(names(entries(el, "results"))).toEqual([
        "Lemonade",
        "Café",
        "Cola",
        "Caña",
        "Jamón",
        "Tostada",
        "Agua",
      ]);

      await search(el, "");
      expect(regions(el)).toEqual(["search", "section"]);
      expect(breadcrumb(el)).toBe("Home › Comida (ES)");
    });

    it("matches whatever the case and accents", async () => {
      const { el } = await mount();
      await search(el, "JAMON");
      expect(names(entries(el, "results"))).toEqual(["Jamón"]);
    });

    it("folds the product names once for a menu's offers, and only the query at each keystroke", async () => {
      const { el } = await mount();
      await search(el, "c");
      const normalize = vi.spyOn(String.prototype, "normalize");
      try {
        await search(el, "co");
        await search(el, "col");
        expect(normalize).toHaveBeenCalledTimes(2);
        expect(names(entries(el, "results"))).toEqual(["Cola"]);
        normalize.mockClear();
        el.products = PRODUCTS.filter((each) => each !== cola);
        await el.updateComplete;
        // The query, then the eight products the menu's structure reaches among the new offers.
        expect(normalize).toHaveBeenCalledTimes(9);
        expect(entries(el, "results")).toEqual([]);
      } finally {
        normalize.mockRestore();
      }
    });

    it("says so when nothing matches", async () => {
      const { el } = await mount();
      await search(el, "zzz");
      expect(entries(el, "results")).toEqual([]);
      expect(root(el).querySelector('[data-region="results"]')!.textContent).toContain(
        "No products match",
      );
    });
  });

  describe("search across the served menus", () => {
    /** `key`'s offer on another menu: its own offer, published version and menu. */
    const offerOn = (
      menu: "drinks" | "brunch",
      key: string,
      name: string,
      extra: Partial<TillProduct> = {},
    ): TillProduct =>
      product(key, name, {
        menuItemId: `mi-${menu}-${key}`,
        menuVersionId: `v-${menu}`,
        catalogueId: `menu-${menu}`,
        ...extra,
      });
    const memberOn = (menu: "drinks" | "brunch", key: string): DocumentMember => ({
      kind: "product",
      menuItemId: `mi-${menu}-${key}`,
      productId: `p-${key}`,
    });

    // The same product as Lunch's Cola, offered by Drinks at its own price.
    const colaOnDrinks = offerOn("drinks", "cola", "Cola", { unitPrice: "2.20" });
    const cortado = offerOn("drinks", "cortado", "Cortado", {
      variants: [
        {
          ...sellingValuesOf(cafe),
          id: "v-cortado-large",
          name: "Grande",
          unitPrice: "2.80",
          unitPriceDifference: null,
          available: true,
        },
      ],
    });
    const coconut = offerOn("drinks", "coconut", "Coconut water", { available: false });
    const cordial = offerOn("drinks", "cordial", "Cordial", { ordering: "not_sold_separately" });
    const DRINKS_PRODUCTS = [colaOnDrinks, cortado, coconut, cordial];

    const pancakes = offerOn("brunch", "pancakes", "Pancakes");
    const porridge = offerOn("brunch", "porridge", "Porridge");
    const BRUNCH_PRODUCTS = [pancakes, porridge];

    const SERVED = [...PRODUCTS, ...DRINKS_PRODUCTS, ...BRUNCH_PRODUCTS];

    function drinksMenu(): TillZoneMenu {
      return {
        id: "menu-drinks",
        name: "Drinks",
        isDefault: false,
        versionId: "v-drinks",
        structure: {
          members: [
            section("sec-soft", "soft-internal", { en: "Soft (EN)" }, [
              memberOn("drinks", "cola"),
              memberOn("drinks", "coconut"),
              memberOn("drinks", "cordial"),
            ]),
            memberOn("drinks", "cortado"),
          ],
        },
        ...withShortcuts([]),
      };
    }

    function brunchMenu(): TillZoneMenu {
      return {
        id: "menu-brunch",
        name: "Brunch",
        isDefault: false,
        versionId: "v-brunch",
        structure: { members: [memberOn("brunch", "pancakes"), memberOn("brunch", "porridge")] },
        ...withShortcuts([]),
      };
    }

    function served(props: Partial<TillMenuBrowser> = {}) {
      return mount({
        menus: [lunch(), drinksMenu(), brunchMenu()],
        servedProducts: SERVED,
        ...props,
      });
    }

    interface Group {
      menu: string;
      heading: string;
      names: string[];
      empty: string | null;
    }

    function groupSections(el: TillMenuBrowser): HTMLElement[] {
      return [
        ...root(el).querySelectorAll<HTMLElement>('[data-region="results"] section[data-menu]'),
      ];
    }

    function groups(el: TillMenuBrowser): Group[] {
      return groupSections(el).map((group) => ({
        menu: group.dataset.menu!,
        heading: group.querySelector("h3")!.textContent!.trim(),
        names: names([...group.querySelectorAll<Button>("wt-button[data-kind]")]),
        empty: group.querySelector(".empty")?.textContent?.trim() ?? null,
      }));
    }

    function groupEntry(el: TillMenuBrowser, menu: string, name: string): Button {
      const group = groupSections(el).find((each) => each.dataset.menu === menu);
      const found = [...(group?.querySelectorAll<Button>("wt-button[data-kind]") ?? [])].find(
        (button) => button.querySelector(".name")!.textContent!.trim() === name,
      );
      if (!found) throw new Error(`no ${menu} result named ${name}`);
      return found;
    }

    const resultsText = (el: TillMenuBrowser) =>
      root(el).querySelector('[data-region="results"]')!.textContent!;

    it("lists the shown menu's matches first, then each other served menu's, labelled by menu", async () => {
      const { el } = await served();
      await search(el, "co");
      expect(groups(el)).toEqual([
        { menu: "menu-lunch", heading: "Lunch (this menu)", names: ["Cola"], empty: null },
        {
          menu: "menu-drinks",
          heading: "Drinks",
          names: ["Cola", "Coconut water", "Cortado"],
          empty: null,
        },
      ]);
      expect(root(el).querySelector('[data-region="results"] h2')!.textContent!.trim()).toBe(
        "Search results",
      );
    });

    it("keeps the zone's order and draws no group for a menu without a match", async () => {
      const { el } = await served();
      await search(el, "pancake");
      expect(groups(el)).toEqual([
        {
          menu: "menu-lunch",
          heading: "Lunch (this menu)",
          names: [],
          empty: "No products match in this menu",
        },
        { menu: "menu-brunch", heading: "Brunch", names: ["Pancakes"], empty: null },
      ]);
    });

    it("says no menu has a match when none does", async () => {
      const { el } = await served();
      await search(el, "zzz");
      expect(groups(el)).toEqual([]);
      expect(entries(el, "results")).toEqual([]);
      expect(resultsText(el)).toContain("No products match in any menu");
    });

    it("draws one menu's results as before", async () => {
      const { el } = await served({ menus: [lunch()] });
      await search(el, "co");
      expect(groupSections(el)).toEqual([]);
      expect(names(entries(el, "results"))).toEqual(["Cola"]);
      expect(root(el).querySelector('[data-region="results"] h2')!.textContent!.trim()).toBe(
        "Search results",
      );
      await search(el, "zzz");
      expect(resultsText(el)).toContain("No products match");
      expect(resultsText(el)).not.toContain("menu");
    });

    it("searches only the menus it is served", async () => {
      const { el } = await served({ menus: [lunch(), drinksMenu()] });
      await search(el, "pancake");
      expect(names(entries(el, "results"))).toEqual([]);
      el.menus = [lunch(), drinksMenu(), brunchMenu()];
      await el.updateComplete;
      expect(names(entries(el, "results"))).toEqual(["Pancakes"]);
    });

    it("shows a product on two menus once in each, at each menu's price, and rings up the tapped menu's offer", async () => {
      const { el, store } = await served();
      await search(el, "cola");
      expect(groups(el).map((group) => [group.menu, group.names])).toEqual([
        ["menu-lunch", ["Cola"]],
        ["menu-drinks", ["Cola"]],
      ]);
      const price = (tile: Button) => tile.querySelector(".price")!.textContent;
      expect(price(groupEntry(el, "menu-lunch", "Cola"))).toBe(
        `${formatMoney("1.50", currentLocale())}/ea`,
      );
      expect(price(groupEntry(el, "menu-drinks", "Cola"))).toBe(
        `${formatMoney("2.20", currentLocale())}/ea`,
      );
      await tap(el, groupEntry(el, "menu-drinks", "Cola"));
      expect(store.lines).toHaveLength(1);
      expect(store.lines[0]!.product.menuItemId).toBe("mi-drinks-cola");
      expect(store.lines[0]!.product.menuVersionId).toBe("v-drinks");
      expect(store.lines[0]!.product.unitPrice).toBe("2.20");
    });

    it("opens another menu's product with that menu's choices", async () => {
      const { el, store } = await served();
      await search(el, "cortado");
      await tap(el, groupEntry(el, "menu-drinks", "Cortado"));
      const picker = root(el).querySelector("till-modifier-picker")!;
      expect(picker.product).toBe(cortado);
      const detail: ModifierConfirmDetail = { product: cortado, note: "corto" };
      picker.dispatchEvent(new CustomEvent("wt-modifier-confirm", { detail }));
      await el.updateComplete;
      expect(store.lines).toEqual([{ product: cortado, quantity: "1", note: "corto" }]);
    });

    it("keeps a sold-out product greyed in its group and leaves out one not sold separately", async () => {
      const { el, store } = await served();
      await search(el, "co");
      const drinksGroup = groups(el).find((group) => group.menu === "menu-drinks")!;
      expect(drinksGroup.names).not.toContain("Cordial");
      const soldOut = groupEntry(el, "menu-drinks", "Coconut water");
      expect(soldOut.disabled).toBe(true);
      expect(soldOut.querySelector(".sold-out")!.textContent!.trim()).toBe("Sold out");
      await tap(el, soldOut);
      expect(store.lines).toEqual([]);
    });

    it("follows a change of served menus or products", async () => {
      const { el } = await served();
      await search(el, "o");
      expect(groups(el).map((group) => group.menu)).toEqual([
        "menu-lunch",
        "menu-drinks",
        "menu-brunch",
      ]);
      expect(groupEntry(el, "menu-brunch", "Porridge").disabled).toBe(false);

      el.menus = [lunch(), brunchMenu()];
      await el.updateComplete;
      expect(groups(el).map((group) => group.menu)).toEqual(["menu-lunch", "menu-brunch"]);

      el.servedProducts = SERVED.map((each) =>
        each === porridge ? { ...each, available: false } : each,
      );
      await el.updateComplete;
      expect(groupEntry(el, "menu-brunch", "Porridge").disabled).toBe(true);
    });

    it("puts the newly selected menu first", async () => {
      const { el } = await served();
      await search(el, "co");
      el.menu = drinksMenu();
      el.products = DRINKS_PRODUCTS;
      await el.updateComplete;
      expect(groups(el).map(({ menu, heading }) => ({ menu, heading }))).toEqual([
        { menu: "menu-drinks", heading: "Drinks (this menu)" },
        { menu: "menu-lunch", heading: "Lunch" },
      ]);
    });

    it("groups the results while a section is open, and goes back to it when cleared", async () => {
      const { el } = await served();
      await tap(el, entry(el, "structure", "Comida (ES)"));
      await search(el, "co");
      expect(regions(el)).toEqual(["search", "results"]);
      expect(groups(el).map((group) => group.menu)).toEqual(["menu-lunch", "menu-drinks"]);
      await search(el, "");
      expect(regions(el)).toEqual(["search", "section"]);
      expect(breadcrumb(el)).toBe("Home › Comida (ES)");
    });

    describe.each(["light", "dark"] as const)("between the groups (%s theme)", (theme) => {
      async function servedIn(menus: TillZoneMenu[]) {
        const { el, host } = await mountWidget<TillMenuBrowser>(
          "till-menu-browser",
          {
            menu: lunch(),
            products: PRODUCTS,
            store: new WorkingOrderStore(),
            menus,
            servedProducts: SERVED,
          },
          theme,
        );
        await widen(host, 600);
        return { el, host };
      }

      /** The colour `--wt-color-border` resolves to where the results are drawn. */
      function borderToken(el: TillMenuBrowser): string {
        const probe = document.createElement("span");
        probe.style.color = "var(--wt-color-border)";
        root(el).querySelector('[data-region="results"]')!.appendChild(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      }

      const lineAbove = (group: HTMLElement) => {
        const style = getComputedStyle(group);
        return { width: style.borderTopWidth, colour: style.borderTopColor };
      };

      it("draws a thin line in the border colour between consecutive menu groups, and none outside them", async () => {
        const { el } = await servedIn([lunch(), drinksMenu(), brunchMenu()]);
        await search(el, "o");
        const sections = groupSections(el);
        expect(sections.map((group) => group.dataset.menu)).toEqual([
          "menu-lunch",
          "menu-drinks",
          "menu-brunch",
        ]);
        const line = { width: "1px", colour: borderToken(el) };
        expect(lineAbove(sections[0]!).width).toBe("0px");
        expect(lineAbove(sections[1]!)).toEqual(line);
        expect(lineAbove(sections[2]!)).toEqual(line);
        for (const group of sections) expect(getComputedStyle(group).borderBottomWidth).toBe("0px");
        expect(root(el).querySelectorAll('[data-region="results"] hr')).toHaveLength(0);

        // The line lies below the group above's last tile and above the next group's heading.
        for (const [above, below] of [
          [sections[0]!, sections[1]!],
          [sections[1]!, sections[2]!],
        ] as const) {
          const lastTile = [...above.querySelectorAll<HTMLElement>("wt-button[data-kind]")].at(-1)!;
          const lineTop = below.getBoundingClientRect().top;
          expect(lastTile.getBoundingClientRect().bottom).toBeLessThan(lineTop);
          expect(lineTop).toBeLessThan(below.querySelector("h3")!.getBoundingClientRect().top);
        }
      });

      it("draws no line for a device served one menu", async () => {
        const { el } = await servedIn([lunch()]);
        await search(el, "co");
        expect(groupSections(el)).toEqual([]);
        const results = root(el).querySelector<HTMLElement>('[data-region="results"]')!;
        const lines = [results, ...results.querySelectorAll<HTMLElement>("section, hr")].filter(
          (node) => node.localName === "hr" || getComputedStyle(node).borderTopWidth !== "0px",
        );
        expect(lines).toEqual([]);
      });

      it.each([
        ["en-GB", "Search results"],
        ["es-ES", "Resultados de la búsqueda"],
      ] as const)(
        "in %s, names the results region for screen readers without drawing its heading, so the first group's heading is at the top",
        async (locale, name) => {
          setLocale(locale);
          const { el } = await servedIn([lunch(), drinksMenu()]);
          await search(el, "co");
          const results = root(el).querySelector<HTMLElement>('[data-region="results"]')!;
          const heading = root(el).getElementById(results.getAttribute("aria-labelledby")!)!;
          expect(heading.localName).toBe("h2");
          expect(heading.textContent!.trim()).toBe(name);
          expect(
            await page.getByRole("heading", { name, level: 2, exact: true }).elements(),
          ).toEqual([heading]);
          const box = heading.getBoundingClientRect();
          expect(box.width).toBeLessThanOrEqual(1);
          expect(box.height).toBeLessThanOrEqual(1);
          expect(getComputedStyle(heading).overflow).toBe("hidden");
          const firstHeading = groupSections(el)[0]!.querySelector("h3")!;
          expect(
            Math.abs(
              firstHeading.getBoundingClientRect().top - results.getBoundingClientRect().top,
            ),
          ).toBeLessThan(1);
        },
      );
    });
  });

  describe("ordering", () => {
    it("a product tile rings up one of that product", async () => {
      const { el, store } = await mount();
      await tap(el, entry(el, "shortcuts", "Café"));
      expect(store.lines).toEqual([{ product: cafe, quantity: "1" }]);
    });

    it("a weighed product asks for its quantity without touching the basket", async () => {
      const { el, store } = await mount({ menu: lunch(withShortcuts(COUNTER_TILES)) });
      const selected: unknown[] = [];
      store.on("product-selected", (picked) => selected.push(picked));
      await tap(el, entry(el, "shortcuts", "Jamón"));
      expect(selected).toEqual([jamon]);
      expect(store.lines).toEqual([]);
    });

    it("has no weight entry of its own unless asked to weigh", async () => {
      const { el } = await mount({ menu: lunch(withShortcuts(COUNTER_TILES)) });
      await tap(el, entry(el, "shortcuts", "Jamón"));
      expect(root(el).querySelector("till-tender-pay")).toBeNull();
    });

    it("asked to weigh, takes a weighed product's quantity itself and adds it", async () => {
      const { el, store } = await mount({
        menu: lunch(withShortcuts(COUNTER_TILES)),
        weighs: true,
      });
      await tap(el, entry(el, "shortcuts", "Jamón"));
      const weigh = root(el).querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
        "till-tender-pay",
      )!;
      await weigh.updateComplete;
      weigh
        .shadowRoot!.querySelector("till-numeric-pad")!
        .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "0.5" } }));
      await weigh.updateComplete;
      weigh.shadowRoot!.querySelector<HTMLElement>("wt-button.add")!.click();
      expect(store.lines).toEqual([{ product: jamon, quantity: "0.5" }]);
    });

    it("uses the full width for a weighed dish's action", async () => {
      const { el } = await mount({
        menu: lunch(withShortcuts(COUNTER_TILES)),
        weighs: true,
      });
      await tap(el, entry(el, "shortcuts", "Jamón"));
      const weigh = root(el).querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
        "till-tender-pay",
      )!;
      await weigh.updateComplete;
      const add = weigh.shadowRoot!.querySelector<HTMLElement>("wt-button.add")!;
      expect(weigh.getBoundingClientRect().right - add.getBoundingClientRect().right).toBeLessThan(
        2,
      );
    });

    it("a fractional custom unit asks for its quantity without touching the basket", async () => {
      const portion = product("portion", "Ración", {
        unit: {
          id: "custom-portion",
          name: { en: "portion" },
          abbreviation: { en: "pt" },
          precision: 2,
          hardwareUnit: null,
        },
      });
      const { el, store } = await mount({
        menu: lunch({ structure: { members: [member("portion")] } }),
        products: [portion],
      });
      const selected: unknown[] = [];
      store.on("product-selected", (picked) => selected.push(picked));
      await tap(el, entry(el, "structure", "Ración"));
      expect(selected).toEqual([portion]);
      expect(store.lines).toEqual([]);
    });

    it("does not take a unit merely named kg for a weighed one", async () => {
      const namedKg = product("named-kg", "Queso", {
        unit: {
          id: "custom-kg",
          name: { en: "kg" },
          abbreviation: { en: "kg" },
          precision: 0,
          hardwareUnit: null,
        },
      });
      const { el, store } = await mount({
        menu: lunch({ structure: { members: [member("named-kg")] } }),
        products: [namedKg],
      });
      const selected: unknown[] = [];
      store.on("product-selected", (picked) => selected.push(picked));
      await tap(el, entry(el, "structure", "Queso"));
      expect(selected).toEqual([]);
      expect(store.lines).toEqual([{ product: namedKg, quantity: "1" }]);
    });

    it("a product with variants opens the modifier picker, which adds the choice and closes", async () => {
      const { el, store } = await mount();
      await tap(el, entry(el, "structure", "Comida (ES)"));
      await tap(el, entry(el, "section", "Vino"));
      const picker = root(el).querySelector("till-modifier-picker")!;
      expect(picker.product).toBe(wine);
      const detail: ModifierConfirmDetail = { product: wine, note: "sin hielo" };
      picker.dispatchEvent(new CustomEvent("wt-modifier-confirm", { detail }));
      await el.updateComplete;
      expect(store.lines).toEqual([{ product: wine, quantity: "1", note: "sin hielo" }]);
      expect(root(el).querySelector("till-modifier-picker")).toBeNull();
    });

    it("cancelling the modifier picker adds nothing", async () => {
      const { el, store } = await mount();
      await search(el, "vino");
      await tap(el, entry(el, "results", "Vino"));
      root(el)
        .querySelector("till-modifier-picker")!
        .dispatchEvent(new CustomEvent("wt-modifier-cancel"));
      await el.updateComplete;
      expect(root(el).querySelector("till-modifier-picker")).toBeNull();
      expect(store.lines).toEqual([]);
    });

    it("a search result and a product in the structure ring up as a tile does", async () => {
      const { el, store } = await mount();
      await search(el, "cola");
      await tap(el, entry(el, "results", "Cola"));
      await search(el, "");
      await tap(el, entry(el, "structure", "Agua"));
      expect(store.lines).toEqual([
        { product: cola, quantity: "1" },
        { product: water, quantity: "1" },
      ]);
    });
  });

  describe("tile colours", () => {
    const blue = product("blue", "Blue", { color: "#256bb1" });
    const pink = product("pink", "Pink", { color: "#edabab" });
    const blueGone = product("bluegone", "Blue gone", { color: "#256bb1", available: false });
    const pinkGone = product("pinkgone", "Pink gone", { color: "#edabab", available: false });
    const unset = product("unset", "Unset", { color: null });
    const bare = product("bare", "Bare");
    const junk = product("junk", "Junk", { color: "not-a-colour" });
    const plainGone = product("plaingone", "Plain gone", { available: false });
    const inside = product("inside", "Inside");
    const red = section(
      "sec-red",
      "red-internal",
      { en: "Red (EN)" },
      [member("inside")],
      "#b12525",
    );
    const painted = [blue, pink, blueGone, pinkGone, unset, bare, junk, plainGone, inside];

    const WHITE = "rgb(255, 255, 255)";
    const BLACK = "rgb(0, 0, 0)";

    async function mountPainted(
      theme: Theme,
      store = new WorkingOrderStore(),
    ): Promise<TillMenuBrowser> {
      const { el } = await mountWidget<TillMenuBrowser>(
        "till-menu-browser",
        {
          menu: lunch({
            structure: {
              members: [
                ...[
                  "blue",
                  "pink",
                  "bluegone",
                  "pinkgone",
                  "unset",
                  "bare",
                  "junk",
                  "plaingone",
                ].map(member),
                red,
              ],
            },
            ...withShortcuts([]),
          }),
          products: painted,
          store,
        },
        theme,
      );
      return el;
    }

    const inner = (tile: Button): HTMLButtonElement => tile.shadowRoot!.querySelector("button")!;
    const background = (tile: Button): string => getComputedStyle(inner(tile)).backgroundColor;
    const ink = (tile: Button, label: string): string =>
      getComputedStyle(tile.querySelector(label)!).color;
    const opacity = (tile: Button): number => Number(getComputedStyle(inner(tile)).opacity);

    /** The computed value of `property: value` on an element beside the widget, so a neutral tile is
     * compared with the theme's own tokens rather than with another tile. */
    function token(
      el: TillMenuBrowser,
      property: "color" | "background-color" | "width",
      value: string,
    ) {
      const probe = document.createElement("span");
      probe.style.setProperty(property, value);
      el.parentElement!.appendChild(probe);
      const computed = getComputedStyle(probe).getPropertyValue(property);
      probe.remove();
      return computed;
    }

    type Rgba = [number, number, number, number];

    function rgba(computed: string): Rgba {
      expect(computed).toMatch(/^rgba?\(/);
      const [r, g, b, a = 1] = computed.match(/[\d.]+/g)!.map(Number);
      return [r!, g!, b!, a];
    }

    /** `top` laid over the opaque `under`, at `top`'s own alpha unless `alpha` is given. */
    function over(top: Rgba, under: Rgba, alpha = top[3]): Rgba {
      const mix = (i: number) => top[i]! * alpha + under[i]! * (1 - alpha);
      return [mix(0), mix(1), mix(2), 1];
    }

    function contrast(a: Rgba, b: Rgba): number {
      const luminance = ([r, g, b]: Rgba) => {
        const [lr, lg, lb] = [r, g, b].map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
      };
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    }

    /** The contrast a label is SEEN at: its colour on the tile's fill, the whole button then faded
     * by its opacity onto the page behind the widget. axe does not check a disabled control. */
    function seenContrast(el: TillMenuBrowser, tile: Button, label: string): number {
      const page = rgba(getComputedStyle(el.parentElement!).backgroundColor);
      const fade = opacity(tile) * Number(getComputedStyle(tile).opacity);
      const fill = over(rgba(background(tile)), page);
      const text = over(rgba(ink(tile, label)), fill);
      return contrast(over(text, page, fade), over(fill, page, fade));
    }

    type Shadow = {
      color: string;
      x: number;
      y: number;
      blur: number;
      spread: number;
      inset: boolean;
    };

    /** The inner button's box shadows, top first: on a sold-out painted tile, the stripe and then
     * the edge line drawn beneath it. */
    function shadows(tile: Button): Shadow[] {
      const value = getComputedStyle(inner(tile)).boxShadow;
      if (value === "none") return [];
      return value.split(/,(?![^(]*\))/).map((shadow) => {
        const color = shadow.match(/rgba?\([^)]*\)/)![0];
        const lengths = shadow
          .replace(color, "")
          .match(/-?[\d.]+px/g)!
          .map(parseFloat);
        expect(lengths).toHaveLength(4);
        const [x, y, blur, spread] = lengths;
        return {
          color,
          x: x!,
          y: y!,
          blur: blur!,
          spread: spread!,
          inset: shadow.includes("inset"),
        };
      });
    }

    /** Drawn inside the tile as a solid band from its left edge, `x` wide. */
    const flat = (shadow?: Shadow): shadow is Shadow =>
      !!shadow &&
      shadow.inset &&
      shadow.x > 0 &&
      shadow.y === 0 &&
      shadow.blur === 0 &&
      shadow.spread === 0;

    const stripe = (tile: Button) => {
      const [band, edge] = shadows(tile);
      return { color: band?.color, band, edge };
    };

    const SOLD_OUT = ["Blue gone", "Pink gone", "Plain gone"];

    describe.each(["light", "dark"] as const)("%s theme", (theme) => {
      it("paints a dark product's tile with white labels, and a sold-out one's stripe", async () => {
        const el = await mountPainted(theme);
        const tile = entry(el, "structure", "Blue");
        expect(background(tile)).toBe("rgb(37, 107, 177)");
        expect(ink(tile, ".name")).toBe(WHITE);
        expect(ink(tile, ".price")).toBe(WHITE);
        expect(stripe(entry(el, "structure", "Blue gone")).color).toBe("rgb(37, 107, 177)");
      });

      it("paints a pale product's tile with black labels, and a sold-out one's stripe", async () => {
        const el = await mountPainted(theme);
        const tile = entry(el, "structure", "Pink");
        expect(background(tile)).toBe("rgb(237, 171, 171)");
        expect(ink(tile, ".name")).toBe(BLACK);
        expect(ink(tile, ".price")).toBe(BLACK);
        expect(stripe(entry(el, "structure", "Pink gone")).color).toBe("rgb(237, 171, 171)");
      });

      it("draws every sold-out tile on the sunken surface, never its colour or an available tile's surface", async () => {
        const el = await mountPainted(theme);
        const sunken = token(el, "background-color", "var(--wt-color-surface-sunken)");
        const surface = token(el, "background-color", "var(--wt-color-surface)");
        expect(sunken).not.toBe(surface);
        if (theme === "light")
          expect(sunken).toBe(token(el, "background-color", "var(--wt-color-border)"));
        for (const name of SOLD_OUT) expect(background(entry(el, "structure", name))).toBe(sunken);
      });

      it("keeps a sold-out painted tile's colour as a stripe one --wt-space-1 wide, and gives a plain one none", async () => {
        const el = await mountPainted(theme);
        const space1 = parseFloat(token(el, "width", "var(--wt-space-1)"));
        expect(space1).toBe(4);
        for (const name of ["Blue gone", "Pink gone"]) {
          const { band } = stripe(entry(el, "structure", name));
          expect(band, name).toMatchObject({ x: space1, y: 0, blur: 0, spread: 0, inset: true });
        }
        expect(shadows(entry(el, "structure", "Plain gone"))).toEqual([]);
      });

      it("centres a striped sold-out tile's labels on the tile, as on a plain one", async () => {
        const el = await mountPainted(theme);
        const centre = (box: DOMRect) => box.left + box.width / 2;
        const offsets = SOLD_OUT.flatMap((name) => {
          const tile = entry(el, "structure", name);
          const middle = centre(inner(tile).getBoundingClientRect());
          return [".label", ".name"].map((part) => ({
            part: `${name} ${part}`,
            off: Math.abs(centre(tile.querySelector(part)!.getBoundingClientRect()) - middle),
          }));
        });
        expect(offsets.filter(({ off }) => off > 1)).toEqual([]);
      });

      it("keeps every palette colour's stripe at 3:1 on a sold-out tile, or edged by a line that is", async () => {
        const gone = CATEGORY_PALETTE.map((color, i) =>
          product(`gone${i}`, `Gone ${color}`, { color, available: false }),
        );
        const { el } = await mountWidget<TillMenuBrowser>(
          "till-menu-browser",
          {
            menu: lunch({
              structure: { members: gone.map((_, i) => member(`gone${i}`)) },
              ...withShortcuts([]),
            }),
            products: gone,
            store: new WorkingOrderStore(),
          },
          theme,
        );
        const page = rgba(getComputedStyle(el.parentElement!).backgroundColor);
        const unseen = CATEGORY_PALETTE.flatMap((color) => {
          const tile = entry(el, "structure", `Gone ${color}`);
          const fill = over(rgba(background(tile)), page);
          const { band: drawn, edge } = stripe(tile);
          if (!flat(drawn)) return [color];
          const band = over(rgba(drawn.color), fill);
          if (contrast(band, fill) >= 3) return [];
          if (!flat(edge)) return [color];
          const line = over(rgba(edge.color), fill);
          const shown = edge.x - drawn.x;
          return shown >= 1 && contrast(line, fill) >= 3 && contrast(line, band) >= 3
            ? []
            : [color];
        });
        expect(unseen).toEqual([]);
      });

      if (theme === "dark")
        it("sinks a sold-out tile to the page's own level in the dark theme, edged apart from it", async () => {
          const el = await mountPainted(theme);
          const black: Rgba = [0, 0, 0, 1];
          const page = rgba(token(el, "background-color", "var(--wt-color-bg)"));
          for (const name of SOLD_OUT) {
            const tile = entry(el, "structure", name);
            // Contrast against black rises with lightness, so this reads "no lighter than".
            expect(contrast(rgba(background(tile)), black)).toBeLessThanOrEqual(
              contrast(page, black),
            );
            expect(getComputedStyle(inner(tile)).borderTopColor).not.toBe(background(tile));
          }
        });

      it("reads a sold-out tile's name, price and Sold out at 4.5:1 or more where it is seen", async () => {
        const el = await mountPainted(theme);
        const readings = SOLD_OUT.flatMap((name) =>
          [".name", ".price", ".sold-out"].map((label) => ({
            label: `${name} ${label}`,
            seen: seenContrast(el, entry(el, "structure", name), label),
          })),
        );
        expect(readings.filter(({ seen }) => seen < 4.5)).toEqual([]);
      });

      it("paints a coloured section's tile and its Section label", async () => {
        const el = await mountPainted(theme);
        const tile = entry(el, "structure", "Red (EN)");
        expect(background(tile)).toBe("rgb(177, 37, 37)");
        expect(ink(tile, ".name")).toBe(WHITE);
        expect(ink(tile, ".kind")).toBe(WHITE);
        const icon = tile.querySelector("wt-icon")!.shadowRoot!.querySelector("svg")!;
        expect(getComputedStyle(icon).fill).toBe(WHITE);
      });

      it("draws a null, a missing and a malformed colour neutral", async () => {
        const el = await mountPainted(theme);
        const surface = token(el, "background-color", "var(--wt-color-surface)");
        const muted = token(el, "color", "var(--wt-color-text-muted)");
        const body = token(el, "color", "var(--wt-color-text)");
        const tiles = ["Unset", "Bare", "Junk"].map((name) => entry(el, "structure", name));
        for (const tile of tiles) {
          expect(background(tile)).toBe(surface);
          expect(background(tile)).toBe(background(tiles[1]!));
          expect(ink(tile, ".name")).toBe(body);
          expect(ink(tile, ".price")).toBe(muted);
          expect(tile.hasAttribute("style")).toBe(false);
        }
        expect(muted).not.toBe(body);
      });

      it("does not paint an uncoloured product inside a coloured section", async () => {
        const el = await mountPainted(theme);
        const surface = token(el, "background-color", "var(--wt-color-surface)");
        await tap(el, entry(el, "structure", "Red (EN)"));
        const tile = entry(el, "section", "Inside");
        expect(background(tile)).toBe(surface);
        expect(tile.hasAttribute("style")).toBe(false);
      });

      // wt-button has no pressed style of its own, so there is none here to keep.
      it("keeps hovered plain and painted tiles opaque", async () => {
        const el = await mountPainted(theme);
        await userEvent.hover(entry(el, "structure", "Bare"));
        const neutral = opacity(entry(el, "structure", "Bare"));
        const blue = entry(el, "structure", "Blue");
        const border = getComputedStyle(inner(blue)).borderTopColor;
        await userEvent.hover(blue);
        const blueHovered = opacity(blue);
        expect(getComputedStyle(inner(blue)).borderTopColor).toBe(ink(blue, ".name"));
        expect(getComputedStyle(inner(blue)).borderTopColor).not.toBe(border);
        expect(neutral).toBe(1);
        expect(blueHovered).toBe(neutral);
        expect(opacity(entry(el, "structure", "Bare"))).toBe(1);
        await userEvent.unhover(inner(blue));
        expect(getComputedStyle(inner(blue)).borderTopColor).toBe(border);
      });

      it("draws a sold-out tile, painted or not, unfaded and still disabled, saying Sold out in the body colour", async () => {
        const store = new WorkingOrderStore();
        const el = await mountPainted(theme, store);
        const body = token(el, "color", "var(--wt-color-text)");
        for (const name of SOLD_OUT) {
          const tile = entry(el, "structure", name);
          expect(opacity(tile)).toBe(1);
          expect(inner(tile).disabled).toBe(true);
          expect(tile.querySelector(".sold-out")!.textContent!.trim()).toBe("Sold out");
          expect(ink(tile, ".sold-out")).toBe(body);
          await tap(el, tile);
        }
        expect(store.lines).toEqual([]);
      });

      it("says Agotado on a sold-out painted tile in Spanish", async () => {
        setLocale("es-ES");
        const el = await mountPainted(theme);
        for (const name of ["Blue gone", "Pink gone"])
          expect(entry(el, "structure", name).querySelector(".sold-out")!.textContent!.trim()).toBe(
            "Agotado",
          );
      });
    });
  });

  describe("an unavailable product keeps its place, greyed (D12)", () => {
    it("in the home grid: a grid of four with the second unavailable keeps it second, and a tap does nothing", async () => {
      const { el, store } = await mount({ menu: lunch(withShortcuts(FOUR_TILES)) });
      const tiles = entries(el, "shortcuts");
      expect(names(tiles)).toEqual(["Café", "Burger", "Cola", "Agua"]);
      expect(tiles.map((tile) => tile.disabled)).toEqual([false, true, false, false]);
      await tap(el, tiles[1]!);
      expect(store.lines).toEqual([]);
      expect(root(el).querySelector("till-modifier-picker")).toBeNull();
    });

    it("in search: a sold-out product placed under two sections is listed once, greyed", async () => {
      const { el } = await mount({ menu: soldOutMenu() });
      await search(el, "burger");
      const results = entries(el, "results");
      expect(names(results)).toEqual(["Burger"]);
      expect(results[0]!.disabled).toBe(true);
    });

    it("in its section: greyed, in order", async () => {
      const { el } = await mount();
      await tap(el, entry(el, "structure", "Comida (ES)"));
      const shown = entries(el, "section");
      expect(names(shown)).toEqual(["Jamón", "Burger", "Vino"]);
      expect(shown.map((button) => button.disabled)).toEqual([false, true, false]);
    });

    it("keeps a section whose products are all sold out, in place, with its products greyed", async () => {
      const { el } = await mount({ menu: soldOutMenu() });
      expect(names(entries(el, "shortcuts"))).toEqual(["Sold out (EN)", "Agua"]);
      expect(names(entries(el, "structure"))).toEqual(["Comida (ES)", "Sold out (EN)", "Agua"]);
      await tap(el, entry(el, "structure", "Sold out (EN)"));
      const shown = entries(el, "section");
      expect(names(shown)).toEqual(["Burger", "Tarta"]);
      expect(shown.map((button) => button.disabled)).toEqual([true, true]);
    });

    it("keeps a product with only some variants sold out orderable, beside one with all sold out, greyed", async () => {
      const size = (id: string, available: boolean) => ({
        ...sellingValuesOf(cafe),
        id,
        name: id,
        unitPrice: "4.50",
        unitPriceDifference: null,
        available,
      });
      const mixed = product("tinto", "Tinto", {
        variants: [size("125", false), size("175", true)],
      });
      const allGone = product("cava", "Cava", { variants: [size("copa", false)] });
      const { el, store } = await mount({
        menu: lunch({ structure: { members: [member("cafe"), member("tinto"), member("cava")] } }),
        products: [cafe, mixed, allGone],
      });
      const shown = entries(el, "structure");
      expect(names(shown)).toEqual(["Café", "Tinto", "Cava"]);
      expect(shown.map((button) => button.disabled)).toEqual([false, false, true]);
      await tap(el, entry(el, "structure", "Tinto"));
      expect(root(el).querySelector("till-modifier-picker")!.product).toBe(mixed);
      expect(store.lines).toEqual([]);
    });

    it("says Sold out on a sold-out product in the home grid, a section and search", async () => {
      const { el } = await mount({ menu: lunch(withShortcuts(FOUR_TILES)) });
      const soldOut = (button: Button) => button.querySelector(".sold-out")?.textContent?.trim();
      expect(entries(el, "shortcuts").map(soldOut)).toEqual([
        undefined,
        "Sold out",
        undefined,
        undefined,
      ]);
      await tap(el, entry(el, "structure", "Comida (ES)"));
      expect(entries(el, "section").map(soldOut)).toEqual([undefined, "Sold out", undefined]);
      await search(el, "burger");
      expect(entries(el, "results").map(soldOut)).toEqual(["Sold out"]);
    });

    it("says it in the till's language", async () => {
      setLocale("es-ES");
      const { el } = await mount({ menu: lunch(withShortcuts(FOUR_TILES)) });
      expect(entry(el, "shortcuts", "Burger").querySelector(".sold-out")!.textContent!.trim()).toBe(
        "Agotado",
      );
    });

    it("greys a product whose variants are all unavailable", async () => {
      const soldOutWine = {
        ...wine,
        variants: wine.variants!.map((variant) => ({ ...variant, available: false })),
      };
      const { el } = await mount({
        products: PRODUCTS.map((each) => (each === wine ? soldOutWine : each)),
      });
      await tap(el, entry(el, "structure", "Comida (ES)"));
      expect(entry(el, "section", "Vino").disabled).toBe(true);
    });
  });

  describe("a product the menu does not offer (D5)", () => {
    it("is left out of the structure, its section and search, while home cells stay in place", async () => {
      const { el } = await mount({ products: PRODUCTS.filter((each) => each !== cola) });
      expect(names(entries(el, "shortcuts"))).toEqual(["Café", "Burger", "Drinks (EN)", "Agua"]);
      expect(root(el).querySelectorAll('[data-region="shortcuts"] .grid > *')).toHaveLength(6);
      expect(names(entries(el, "structure"))).not.toContain("Empty (EN)");
      await tap(el, entry(el, "structure", "Drinks (EN)"));
      expect(names(entries(el, "section"))).toEqual(["Lemonade", "Beer (EN)"]);
      await tap(el, entry(el, "section", "Beer (EN)"));
      expect(names(entries(el, "section"))).toEqual(["Caña"]);
      await search(el, "col");
      expect(entries(el, "results")).toEqual([]);
    });

    it("keeps a blank tile for a product in the structure that has no offer", async () => {
      const { el } = await mount({
        menu: lunch(withShortcuts(FOUR_TILES)),
        products: PRODUCTS.filter((each) => each !== cola),
      });
      expect(names(entries(el, "shortcuts"))).toEqual(["Café", "Burger", "Agua"]);
      expect(root(el).querySelectorAll('[data-region="shortcuts"] .grid > *')).toHaveLength(4);
    });
  });

  describe("who may order a product on its own", () => {
    const withOrdering = (
      ordering: NonNullable<TillProduct["ordering"]>,
      ...keys: string[]
    ): TillProduct[] =>
      PRODUCTS.map((each) =>
        keys.includes(each.id.slice(2)) ? { ...each, ordering } : { ...each, ordering: "public" },
      );

    it("leaves a product not sold separately out of the structure, its section and search while keeping home cells", async () => {
      const { el } = await mount({
        products: withOrdering("not_sold_separately", "cola", "cana", "cafe"),
      });
      expect(names(entries(el, "shortcuts"))).toEqual(["Burger", "Drinks (EN)", "Agua"]);
      expect(root(el).querySelectorAll('[data-region="shortcuts"] .grid > *')).toHaveLength(6);
      await tap(el, entry(el, "structure", "Drinks (EN)"));
      expect(names(entries(el, "section"))).toEqual(["Lemonade"]);
      await search(el, "a");
      expect(names(entries(el, "results"))).toEqual(["Lemonade", "Jamón", "Tostada", "Agua"]);
    });

    it("shows a staff-only product as it shows a public one, and rings it up", async () => {
      // Staff only is for guest ordering, which does not exist yet, so every screen today is staff's.
      const { el, store } = await mount({
        menu: lunch(withShortcuts(FOUR_TILES)),
        products: withOrdering("staff_only", "cola"),
      });
      expect(names(entries(el, "shortcuts"))).toEqual(["Café", "Burger", "Cola", "Agua"]);
      await search(el, "col");
      expect(names(entries(el, "results"))).toEqual(["Cola"]);
      await tap(el, entry(el, "results", "Cola"));
      expect(store.lines.map((line) => line.product.name)).toEqual(["Cola"]);
    });

    it("still offers a product not sold separately as an extra on a dish that lists it", async () => {
      const extra = {
        portion: "1",
        unit: {
          name: { en: "Each", es: "Unidad", ca: "Unitat", eu: "Unitatea", gl: "Unidade" },
          hardwareUnit: null,
          id: "00000000-0000-0000-0000-000000000001",
          abbreviation: { en: "ea", es: "ud", ca: "u", eu: "u", gl: "u" },
          precision: 0,
        },
        productId: "p-cola",
        name: "Cola",
        customerName: null,
        kitchenName: null,
        price: "1.00",
        vatClass: "general" as const,
        maxQuantity: 1,
        preselected: false,
        addAllergens: null,
        suitableFor: [],
      };
      const tostadaWithExtras = {
        ...tostada,
        offeredModifiers: [
          {
            kind: "extras" as const,
            id: "list-drinks",
            name: "Drinks",
            customerName: null,
            kitchenName: null,
            minPicks: 0,
            maxPicks: 1,
            items: [extra],
          },
        ],
      };
      const { el } = await mount({
        products: [
          ...withOrdering("not_sold_separately", "cola").filter((each) => each.id !== tostada.id),
          tostadaWithExtras,
        ],
      });
      await search(el, "col");
      expect(entries(el, "results")).toEqual([]);
      await search(el, "tostada");
      await tap(el, entry(el, "results", "Tostada"));
      const picker = root(el).querySelector("till-modifier-picker")!;
      await picker.updateComplete;
      expect(picker.shadowRoot!.textContent).toContain("Cola");
    });
  });

  describe("a section a diet filter empties keeps its place, greyed (A297)", () => {
    // Favourites holds Lemonade and Café; the filter hides both. Drinks follows it.
    const filtered = PRODUCTS.filter((each) => each !== lemonade && each !== cafe);

    function box(button: Button): { x: number; y: number } {
      const { x, y } = button.getBoundingClientRect();
      return { x, y };
    }

    it("stays at its structure position, disabled and saying nothing matches, the next tile not moving", async () => {
      const { el, host } = await mount({ products: PRODUCTS });
      await widen(host, 800);
      const unfilteredDrinks = box(entry(el, "structure", "Drinks (EN)"));

      el.products = filtered;
      el.unfilteredProducts = PRODUCTS;
      await el.updateComplete;
      await widen(host, 800);

      expect(names(entries(el, "structure"))).toEqual([
        "Favourites (EN)",
        "Drinks (EN)",
        "Comida (ES)",
        "plain-internal",
        "Agua",
      ]);
      const favouritesTile = entry(el, "structure", "Favourites (EN)");
      expect(favouritesTile.dataset.kind).toBe("section");
      expect(favouritesTile.disabled).toBe(true);
      expect(favouritesTile.hasAttribute("data-filtered")).toBe(true);
      expect(favouritesTile.hasAttribute("data-sold-out")).toBe(false);
      expect(favouritesTile.querySelector(".kind")!.textContent!.trim()).toBe(
        "Nothing matches the filter",
      );
      expect(box(entry(el, "structure", "Drinks (EN)"))).toEqual(unfilteredDrinks);
      expect(entry(el, "structure", "Drinks (EN)").hasAttribute("data-filtered")).toBe(false);
      expect(entry(el, "structure", "Drinks (EN)").disabled).toBe(false);
    });

    it("does not open when tapped", async () => {
      const { el } = await mount({ products: filtered, unfilteredProducts: PRODUCTS });
      await tap(el, entry(el, "structure", "Favourites (EN)"));
      expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
      expect(breadcrumb(el)).toBe("");
      expect(notice(el)).toBeNull();
    });

    it("says it in the till's language", async () => {
      setLocale("es-ES");
      const { el } = await mount({ products: filtered, unfilteredProducts: PRODUCTS });
      expect(
        entry(el, "structure", "Favoritos (ES)").querySelector(".kind")!.textContent!.trim(),
      ).toBe("Nada coincide con el filtro");
    });

    it("is greyed where the filter hid what the inactive products left", async () => {
      const { el } = await mount({
        products: filtered,
        unfilteredProducts: PRODUCTS.filter((each) => each !== cafe),
      });
      expect(entry(el, "structure", "Favourites (EN)").hasAttribute("data-filtered")).toBe(true);
    });

    it("leaves out a section whose products are all inactive, the next tile moving up, as before", async () => {
      const { el, host } = await mount({ products: PRODUCTS });
      await widen(host, 800);
      const firstPlace = box(entry(el, "structure", "Favourites (EN)"));

      el.products = filtered;
      el.unfilteredProducts = filtered;
      await el.updateComplete;
      await widen(host, 800);

      expect(names(entries(el, "structure"))).toEqual([
        "Drinks (EN)",
        "Comida (ES)",
        "plain-internal",
        "Agua",
      ]);
      expect(box(entry(el, "structure", "Drinks (EN)"))).toEqual(firstPlace);
      expect(root(el).querySelector("[data-filtered]")).toBeNull();
    });

    it("leaves out a section whose products are all not sold separately, as before", async () => {
      const extrasOnly = PRODUCTS.map((each) =>
        each === lemonade || each === cafe
          ? { ...each, ordering: "not_sold_separately" as const }
          : each,
      );
      const { el } = await mount({ products: extrasOnly, unfilteredProducts: extrasOnly });
      expect(names(entries(el, "structure"))).not.toContain("Favourites (EN)");
      expect(root(el).querySelector("[data-filtered]")).toBeNull();
    });

    it("keeps a section whose products are all sold out as before: not greyed, and it opens", async () => {
      // The section itself is pinned without a filter in "keeps a section whose products are all
      // sold out, in place, with its products greyed".
      const { el } = await mount({
        menu: soldOutMenu(),
        products: PRODUCTS,
        unfilteredProducts: PRODUCTS,
      });
      const soldOut = entry(el, "structure", "Sold out (EN)");
      expect(soldOut.disabled).toBe(false);
      expect(soldOut.hasAttribute("data-filtered")).toBe(false);
      await tap(el, soldOut);
      expect(breadcrumb(el)).toBe("Home › Sold out (EN)");
    });

    it("draws a shortcut to such a section as the greyed tile, not a blank", async () => {
      const { el } = await mount({
        menu: lunch(withShortcuts([sectionTile("sec-fav"), productTile("water")])),
        products: filtered,
        unfilteredProducts: PRODUCTS,
      });
      expect(names(entries(el, "shortcuts"))).toEqual(["Favourites (EN)", "Agua"]);
      expect(root(el).querySelectorAll('[data-region="shortcuts"] .slot')).toHaveLength(0);
      const shortcut = entry(el, "shortcuts", "Favourites (EN)");
      expect(shortcut.disabled).toBe(true);
      expect(shortcut.hasAttribute("data-filtered")).toBe(true);
    });

    it("greys a nested section the filter empties, in its place inside the open section", async () => {
      const { el } = await mount({
        products: PRODUCTS.filter((each) => each !== cana),
        unfilteredProducts: PRODUCTS,
      });
      await tap(el, entry(el, "structure", "Drinks (EN)"));
      const shown = entries(el, "section");
      expect(names(shown)).toEqual(["Cola", "Lemonade", "Beer (EN)"]);
      expect(shown.map((button) => button.hasAttribute("data-filtered"))).toEqual([
        false,
        false,
        true,
      ]);
      await tap(el, entry(el, "section", "Beer (EN)"));
      expect(breadcrumb(el)).toBe("Home › Drinks (EN)");
    });

    it("still says Not found when the filter empties the section that is open", async () => {
      const { el } = await mount({ menu: lunch(withShortcuts(COUNTER_TILES)) });
      await tap(el, entry(el, "shortcuts", "Beer (EN)"));
      el.products = PRODUCTS.filter((each) => each !== cana);
      el.unfilteredProducts = PRODUCTS;
      await el.updateComplete;
      expect(notice(el)).toBe("Not found");
      expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
    });

    it("still hides a product the filter rejects", async () => {
      const { el } = await mount({
        products: PRODUCTS.filter((each) => each !== water),
        unfilteredProducts: PRODUCTS,
      });
      expect(names(entries(el, "structure"))).not.toContain("Agua");
    });
  });

  describe("an included menu shown directly", () => {
    type SectionNode = Extract<DocumentMember, { kind: "section" }>;
    const directly = (node: DocumentMember): DocumentMember => ({
      ...(node as SectionNode),
      direct: true,
    });
    /** Drinks included twice: at the top level as a folder named "Bar (EN)", and inside Food under
     * the included menu's own name. */
    const bar: DocumentMember = {
      ...(drinks as SectionNode),
      includedMenu: { id: "menu-drinks", name: "Drinks staff" },
      names: { en: "Bar (EN)", es: "Barra (ES)" },
      fixed: { names: { en: "Bar (EN)", es: "Barra (ES)" } },
    };
    const foodWithDrinks = section("sec-food", "food-internal", { es: "Comida (ES)" }, [
      member("jamon"),
      drinks,
    ]);
    const twice = (top: DocumentMember, tiles: DocumentTile[] = []) =>
      lunch({ structure: { members: [top, foodWithDrinks] }, ...withShortcuts(tiles) });

    it("shows its sections and products on the home page, with no extra level", async () => {
      const { el } = await mount({
        menu: lunch({
          structure: {
            members: [
              favourites,
              directly(drinks),
              food,
              empty,
              plain,
              member("water"),
              member("ghost"),
            ],
          },
        }),
      });
      expect(names(entries(el, "structure"))).toEqual([
        "Favourites (EN)",
        "Cola",
        "Lemonade",
        "Beer (EN)",
        "Comida (ES)",
        "plain-internal",
        "Agua",
      ]);
    });

    it("opens one of its sections with a breadcrumb that skips the included menu", async () => {
      const { el } = await mount({
        menu: lunch({ structure: { members: [favourites, directly(drinks), food] } }),
      });
      await tap(el, entry(el, "structure", "Beer (EN)"));
      expect(breadcrumb(el)).toBe("Home › Beer (EN)");
      expect(names(entries(el, "section"))).toEqual(["Caña"]);
      expect(notice(el)).toBeNull();
    });

    it("inside a section, a direct include's members stand in its place", async () => {
      const { el } = await mount({
        menu: lunch({
          structure: {
            members: [
              section("sec-food", "food-internal", { es: "Comida (ES)" }, [
                member("jamon"),
                directly(drinks),
                member("wine"),
              ]),
            ],
          },
        }),
      });
      await tap(el, entry(el, "structure", "Comida (ES)"));
      expect(names(entries(el, "section"))).toEqual([
        "Jamón",
        "Cola",
        "Lemonade",
        "Beer (EN)",
        "Vino",
      ]);
      await tap(el, entry(el, "section", "Beer (EN)"));
      expect(breadcrumb(el)).toBe("Home › Comida (ES) › Beer (EN)");
      expect(names(entries(el, "section"))).toEqual(["Caña"]);
      await tap(el, [...root(el).querySelectorAll<HTMLElement>("nav.breadcrumb wt-button")][1]!);
      expect(breadcrumb(el)).toBe("Home › Comida (ES)");
    });

    it("a shortcut to the included menu still opens it as a folder", async () => {
      const { el } = await mount({
        menu: lunch({
          structure: { members: [favourites, directly(drinks), food] },
          ...withShortcuts([sectionTile("sec-drinks")]),
        }),
      });
      await tap(el, entry(el, "shortcuts", "Drinks (EN)"));
      expect(breadcrumb(el)).toBe("Home › Drinks (EN)");
      expect(names(entries(el, "section"))).toEqual(["Cola", "Lemonade", "Beer (EN)"]);
      await tap(el, entry(el, "section", "Beer (EN)"));
      expect(breadcrumb(el)).toBe("Home › Drinks (EN) › Beer (EN)");
    });

    it("paints a folder's override colour and photo", async () => {
      // The published document already carries the folder's own colour and photo in `color` and
      // `image`; this pins that the tile draws them.
      const folder: DocumentMember = {
        ...(bar as SectionNode),
        color: "#256bb1",
        image: "bar-folder.webp",
        fixed: { color: "#256bb1", image: "bar-folder.webp" },
      };
      const menu = (tiles: HomeDisplay["tiles"]) =>
        display("till", { tiles }, lunch({ structure: { members: [folder] } }));
      const colours = await mount({ menu: menu("colours") });
      const painted = entry(colours.el, "structure", "Bar (EN)");
      expect(painted.hasAttribute("data-painted")).toBe(true);
      expect(getComputedStyle(painted.shadowRoot!.querySelector("button")!).backgroundColor).toBe(
        "rgb(37, 107, 177)",
      );
      expect(getComputedStyle(painted.querySelector(".name")!).color).toBe("rgb(255, 255, 255)");
      const thumbnails = await mount({ menu: menu("thumbnails") });
      const pictured = entry(thumbnails.el, "structure", "Bar (EN)");
      expect(pictured.querySelector("img")!.getAttribute("src")).toBe("/media/bar-folder.webp");
    });

    it("the same included menu in two lists draws each copy with its own name", async () => {
      const { el } = await mount({ menu: twice(bar) });
      expect(names(entries(el, "structure"))).toEqual(["Bar (EN)", "Comida (ES)"]);
      await tap(el, entry(el, "structure", "Bar (EN)"));
      expect(breadcrumb(el)).toBe("Home › Bar (EN)");
      expect(names(entries(el, "section"))).toEqual(["Cola", "Lemonade", "Beer (EN)"]);
      await tap(el, root(el).querySelector<HTMLElement>("nav.breadcrumb wt-button")!);
      await tap(el, entry(el, "structure", "Comida (ES)"));
      expect(names(entries(el, "section"))).toEqual(["Jamón", "Drinks (EN)"]);
      await tap(el, entry(el, "section", "Drinks (EN)"));
      expect(breadcrumb(el)).toBe("Home › Comida (ES) › Drinks (EN)");

      const shownDirectly = await mount({ menu: twice(directly(bar)) });
      expect(names(entries(shownDirectly.el, "structure"))).toEqual([
        "Cola",
        "Lemonade",
        "Beer (EN)",
        "Comida (ES)",
      ]);
      await tap(shownDirectly.el, entry(shownDirectly.el, "structure", "Comida (ES)"));
      expect(names(entries(shownDirectly.el, "section"))).toEqual(["Jamón", "Drinks (EN)"]);
    });

    it("keeps an open folder open when a new menu shows it directly", async () => {
      const { el } = await mount({ menu: twice(bar) });
      await tap(el, entry(el, "structure", "Comida (ES)"));
      await tap(el, entry(el, "section", "Drinks (EN)"));
      el.menu = lunch({
        structure: {
          members: [
            bar,
            section("sec-food", "food-internal", { es: "Comida (ES)" }, [
              member("jamon"),
              directly(drinks),
            ]),
          ],
        },
      });
      await el.updateComplete;
      expect(notice(el)).toBeNull();
      expect(breadcrumb(el)).toBe("Home › Comida (ES) › Drinks (EN)");
    });

    describe("two direct includes each holding one menu as a folder of its own name", () => {
      const named = (en: string): DocumentMember => ({ ...(drinks as SectionNode), names: { en } });
      const sides = (second = "Second bar") =>
        lunch({
          structure: {
            members: [
              directly(section("sec-left", "left-internal", { en: "Left" }, [named("First bar")])),
              directly(section("sec-right", "right-internal", { en: "Right" }, [named(second)])),
            ],
          },
        });

      it("opens the folder tapped, not the first copy drawn", async () => {
        const { el } = await mount({ menu: sides() });
        expect(names(entries(el, "structure"))).toEqual(["First bar", "Second bar"]);
        await tap(el, entry(el, "structure", "Second bar"));
        expect(breadcrumb(el)).toBe("Home › Second bar");
        await tap(el, entry(el, "section", "Beer (EN)"));
        expect(breadcrumb(el)).toBe("Home › Second bar › Beer (EN)");
        await tap(el, [...root(el).querySelectorAll<HTMLElement>("nav.breadcrumb wt-button")][1]!);
        expect(breadcrumb(el)).toBe("Home › Second bar");
        await tap(el, root(el).querySelector<HTMLElement>("nav.breadcrumb wt-button")!);
        await tap(el, entry(el, "structure", "First bar"));
        expect(breadcrumb(el)).toBe("Home › First bar");
      });

      it("keeps the copy open when a new menu still draws it", async () => {
        const { el } = await mount({ menu: sides() });
        await tap(el, entry(el, "structure", "Second bar"));
        el.menu = sides("Second bar, renamed");
        await el.updateComplete;
        expect(notice(el)).toBeNull();
        expect(breadcrumb(el)).toBe("Home › Second bar, renamed");
      });

      it("says Not found when a new menu no longer draws the copy that was open", async () => {
        const { el } = await mount({ menu: sides() });
        await tap(el, entry(el, "structure", "Second bar"));
        el.menu = lunch({
          structure: {
            members: [
              directly(section("sec-left", "left-internal", { en: "Left" }, [named("First bar")])),
            ],
          },
        });
        await el.updateComplete;
        expect(notice(el)).toBe("Not found");
        expect(names(entries(el, "structure"))).toEqual(["First bar"]);
      });
    });

    it("a shortcut to a menu included twice opens the top-level copy, and is drawn from it", async () => {
      const paintedBar: DocumentMember = {
        ...(bar as SectionNode),
        color: "#256bb1",
        image: "bar-folder.webp",
        fixed: { names: { en: "Bar (EN)" }, color: "#256bb1", image: "bar-folder.webp" },
      };
      const shortcut = [sectionTile("sec-drinks")];
      const { el } = await mount({ menu: twice(paintedBar, shortcut) });
      expect(names(entries(el, "shortcuts"))).toEqual(["Bar (EN)"]);
      const tile = entry(el, "shortcuts", "Bar (EN)");
      expect(getComputedStyle(tile.shadowRoot!.querySelector("button")!).backgroundColor).toBe(
        "rgb(37, 107, 177)",
      );
      const thumbnails = await mount({
        menu: display("till", { tiles: "thumbnails" }, twice(paintedBar, shortcut)),
      });
      expect(
        entry(thumbnails.el, "shortcuts", "Bar (EN)").querySelector("img")!.getAttribute("src"),
      ).toBe("/media/bar-folder.webp");
      await tap(el, tile);
      expect(breadcrumb(el)).toBe("Home › Bar (EN)");

      // Greyed by a diet filter, it is still drawn from the copy it would open.
      const filtered = await mount({
        menu: twice(paintedBar, shortcut),
        products: PRODUCTS.filter((each) => each !== cola && each !== lemonade && each !== cana),
        unfilteredProducts: PRODUCTS,
      });
      const greyed = entry(filtered.el, "shortcuts", "Bar (EN)");
      expect(greyed.hasAttribute("data-filtered")).toBe(true);

      // Shown directly, the top level holds no copy, so the shortcut opens the copy indexed last.
      const shownDirectly = await mount({
        menu: twice(directly(bar), [sectionTile("sec-drinks")]),
      });
      expect(names(entries(shownDirectly.el, "shortcuts"))).toEqual(["Drinks (EN)"]);
      await tap(shownDirectly.el, entry(shownDirectly.el, "shortcuts", "Drinks (EN)"));
      expect(breadcrumb(shownDirectly.el)).toBe("Home › Drinks (EN)");
    });
  });

  describe("an open section the menu no longer holds (§9)", () => {
    it("says Not found and returns home when a new menu drops the open section", async () => {
      const { el } = await mount();
      await tap(el, entry(el, "structure", "Drinks (EN)"));
      el.menu = lunch({ structure: { members: [favourites, food] } });
      await el.updateComplete;
      expect(notice(el)).toBe("Not found");
      expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
      expect(names(entries(el, "structure"))).toEqual(["Favourites (EN)", "Comida (ES)"]);
    });

    it("says Not found when the open section's parent no longer holds it", async () => {
      const { el } = await mount();
      await tap(el, entry(el, "structure", "Drinks (EN)"));
      await tap(el, entry(el, "section", "Beer (EN)"));
      el.menu = lunch({
        structure: {
          members: [
            section("sec-drinks", "drinks-internal", { en: "Drinks (EN)" }, [member("cola")]),
            beer,
          ],
        },
      });
      await el.updateComplete;
      expect(notice(el)).toBe("Not found");
      expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
    });

    it("says Not found when an ancestor in the breadcrumb is gone, though the section is still elsewhere", async () => {
      const { el } = await mount();
      await tap(el, entry(el, "structure", "Drinks (EN)"));
      await tap(el, entry(el, "section", "Beer (EN)"));
      el.menu = lunch({ structure: { members: [food, beer] } });
      await el.updateComplete;
      expect(notice(el)).toBe("Not found");
      expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
    });

    it("says Not found when new products leave the open section with nothing to order", async () => {
      const { el } = await mount({ menu: lunch(withShortcuts(COUNTER_TILES)) });
      await tap(el, entry(el, "shortcuts", "Beer (EN)"));
      el.products = PRODUCTS.filter((each) => each !== cana);
      await el.updateComplete;
      expect(notice(el)).toBe("Not found");
      expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
    });

    it("stays where it is, with no notice, when a new menu still holds the open section", async () => {
      const { el } = await mount();
      await tap(el, entry(el, "structure", "Drinks (EN)"));
      await tap(el, entry(el, "section", "Beer (EN)"));
      el.menu = lunch({ versionId: "v2", structure: { members: [drinks] } });
      await el.updateComplete;
      expect(notice(el)).toBeNull();
      expect(breadcrumb(el)).toBe("Home › Drinks (EN) › Beer (EN)");
    });

    it("blanks a shortcut whose target a new menu lacks, with no notice", async () => {
      const { el } = await mount();
      el.menu = lunch({ structure: { members: [favourites, food, member("water")] } });
      await el.updateComplete;
      expect(names(entries(el, "shortcuts"))).toEqual(["Café", "Burger", "Agua"]);
      expect(
        [...root(el).querySelectorAll('[data-region="shortcuts"] .grid > *')].map(
          (cell) => cell.localName,
        ),
      ).toEqual(["wt-button", "wt-button", "span", "span", "span", "wt-button"]);
      expect(notice(el)).toBeNull();
    });

    it("says it in the till's language, and clears it on the next step", async () => {
      setLocale("es-ES");
      const { el } = await mount();
      await tap(el, entry(el, "structure", "Bebidas (ES)"));
      el.menu = lunch({ structure: { members: [favourites, member("water")] } });
      await el.updateComplete;
      expect(notice(el)).toBe("No encontrado");
      await tap(el, entry(el, "structure", "Favoritos (ES)"));
      expect(notice(el)).toBeNull();
    });

    it("clears it when a product is picked or a search is typed", async () => {
      const { el, store } = await mount();
      const dropDrinks = async () => {
        await tap(el, entry(el, "structure", "Drinks (EN)"));
        el.menu = lunch({ structure: { members: [favourites, member("water")] } });
        await el.updateComplete;
        expect(notice(el)).toBe("Not found");
      };
      await dropDrinks();
      await tap(el, entry(el, "structure", "Agua"));
      expect(notice(el)).toBeNull();
      expect(store.lines).toEqual([{ product: water, quantity: "1" }]);
      el.menu = lunch();
      await el.updateComplete;
      await dropDrinks();
      await search(el, "c");
      expect(notice(el)).toBeNull();
    });
  });
});

describe("Spanish pricing-unit labels", () => {
  it.each([
    { unit: EACH, label: "ud" },
    { unit: { ...EACH, name: { en: "Each" }, abbreviation: { en: "ea" } }, label: "ea" },
    { unit: undefined, label: "ud" },
  ])("shows /$label on the dish tile without exposing a unit id", async ({ unit, label }) => {
    setLocale("es-ES");
    setContentLanguages({ defaultLanguage: "en", languages: ["es", "en"] });
    const dish = product("cafe", "Café", { unit, pricingUnit: "each" });
    const { el } = await mount({
      menu: lunch({ structure: { members: [member("cafe")] } }),
      products: [dish],
    });
    const price = entry(el, "structure", "Café").querySelector(".price")!.textContent;
    expect(price).toBe(`1,50\u00a0€/${label}`);
    expect(price).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
  });
});
