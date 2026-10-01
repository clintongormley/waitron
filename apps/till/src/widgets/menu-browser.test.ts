import { afterEach, describe, expect, it, vi } from "vitest";
import { setContentLanguages } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import type { DocumentMember, DocumentTile } from "@waitron/catalogue/src/menu-document-types.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
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
): DocumentMember {
  return { kind: "section", sectionId: id, internalName, names, image: null, color: null, members };
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

function lunch(overrides: Partial<TillZoneMenu> = {}): TillZoneMenu {
  return {
    id: "menu-lunch",
    name: "Lunch",
    isDefault: true,
    versionId: "v1",
    structure: {
      members: [favourites, drinks, food, empty, plain, member("water"), member("ghost")],
    },
    homeLayouts: [
      {
        id: "lay-home",
        name: "Home",
        tiles: [
          productTile("cafe"),
          productTile("burger"),
          sectionTile("sec-drinks"),
          productTile("ghost"),
          sectionTile("sec-empty"),
          productTile("water"),
        ],
      },
      {
        id: "lay-four",
        name: "Four",
        tiles: [
          productTile("cafe"),
          productTile("burger"),
          productTile("cola"),
          productTile("water"),
        ],
      },
      {
        id: "lay-counter",
        name: "Counter",
        tiles: [sectionTile("sec-beer"), productTile("jamon")],
      },
    ],
    defaultHomeLayoutId: "lay-home",
    homeLayoutId: "lay-home",
    layoutFallback: null,
    ...overrides,
  };
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
    homeLayouts: [
      { id: "lay-home", name: "Home", tiles: [sectionTile("sec-soldout"), productTile("water")] },
    ],
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

    it("shows the device's layout's tiles, in their order", async () => {
      const { el } = await mount({ menu: lunch({ homeLayoutId: "lay-counter" }) });
      expect(names(entries(el, "shortcuts"))).toEqual(["Beer (EN)", "Jamón"]);
    });

    it("shows the first layout, the default, when the chosen one is not among the layouts", async () => {
      const { el } = await mount({ menu: lunch({ homeLayoutId: "lay-gone" }) });
      expect(names(entries(el, "shortcuts"))).toEqual(["Café", "Burger", "Drinks (EN)", "Agua"]);
    });

    it("accepts an empty shortcut while keeping the neighboring actions usable", async () => {
      const { el } = await mount({
        menu: lunch({
          homeLayouts: [
            {
              id: "lay-home",
              name: "Home",
              tiles: [productTile("water"), { kind: "empty" }, sectionTile("sec-drinks")],
            },
          ],
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
          homeLayouts: [
            {
              id: "lay-home",
              name: "Home",
              tiles: [productTile("cafe"), tile, productTile("water")],
            },
          ],
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
          homeLayouts: [{ id: "lay-home", name: "Home", tiles: [{ kind: "empty" }] }],
        }),
      });
      host.style.setProperty("--wt-tap-min", "60px");
      const blank = root(el).querySelector<HTMLElement>('[data-region="shortcuts"] .slot')!;
      expect(getComputedStyle(blank).minHeight).toBe("90px");
    });

    it("shows no shortcuts, and still the structure, for a menu with no layouts", async () => {
      const { el } = await mount({ menu: lunch({ homeLayouts: [] }) });
      expect(entries(el, "shortcuts")).toEqual([]);
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
          homeLayouts: [{ id: "lay-home", name: "Home", tiles: [] }],
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

    it("shows a till's six columns when no column count is given", async () => {
      const { el, host } = await mount();
      await widen(host, 1280);
      const grids = [...root(el).querySelectorAll<HTMLElement>(".grid")];
      expect(grids).toHaveLength(2);
      for (const grid of grids) expect(tracks(grid)).toBe(6);
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

  describe("a product tile's price", () => {
    it("reads per unit, the weighed product's per kilo", async () => {
      const { el } = await mount({ menu: lunch({ homeLayoutId: "lay-counter" }) });
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
      const { el } = await mount({ menu: lunch({ homeLayoutId: "lay-counter" }) });
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

  describe("ordering", () => {
    it("a product tile rings up one of that product", async () => {
      const { el, store } = await mount();
      await tap(el, entry(el, "shortcuts", "Café"));
      expect(store.lines).toEqual([{ product: cafe, quantity: "1" }]);
    });

    it("a weighed product asks for its quantity without touching the basket", async () => {
      const { el, store } = await mount({ menu: lunch({ homeLayoutId: "lay-counter" }) });
      const selected: unknown[] = [];
      store.on("product-selected", (picked) => selected.push(picked));
      await tap(el, entry(el, "shortcuts", "Jamón"));
      expect(selected).toEqual([jamon]);
      expect(store.lines).toEqual([]);
    });

    it("has no weight entry of its own unless asked to weigh", async () => {
      const { el } = await mount({ menu: lunch({ homeLayoutId: "lay-counter" }) });
      await tap(el, entry(el, "shortcuts", "Jamón"));
      expect(root(el).querySelector("till-tender-pay")).toBeNull();
    });

    it("asked to weigh, takes a weighed product's quantity itself and adds it", async () => {
      const { el, store } = await mount({
        menu: lunch({ homeLayoutId: "lay-counter" }),
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

  describe("an unavailable product keeps its place, greyed (D12)", () => {
    it("in the home grid: a grid of four with the second unavailable keeps it second, and a tap does nothing", async () => {
      const { el, store } = await mount({ menu: lunch({ homeLayoutId: "lay-four" }) });
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
      const { el } = await mount({ menu: lunch({ homeLayoutId: "lay-four" }) });
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
      const { el } = await mount({ menu: lunch({ homeLayoutId: "lay-four" }) });
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
        menu: lunch({ homeLayoutId: "lay-four" }),
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
        menu: lunch({ homeLayoutId: "lay-four" }),
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
      const { el } = await mount({ menu: lunch({ homeLayoutId: "lay-counter" }) });
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
