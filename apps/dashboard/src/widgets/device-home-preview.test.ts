import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { formatMoney } from "@waitron/shared";
import type {
  DocumentMember,
  HomeDevice,
  HomeDisplay,
  HomeTile,
  MenuDocument,
} from "../api/client.js";
import type { DocumentTile } from "@waitron/catalogue/src/menu-document-types.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  menuDocument,
  mountWidget,
} from "./test-helpers.js";
import { DeviceHomePreview } from "./device-home-preview.js";

const KILO = {
  id: "unit-kg",
  name: { en: "kilogram" },
  precision: 3,
  abbreviation: { en: "kg" },
  hardwareUnit: "kg" as const,
};

it.each(
  [360, 390].flatMap((width) =>
    [2, 3].flatMap((columns) =>
      (["colours", "thumbnails"] as const).map((mode) => ({ width, columns, mode })),
    ),
  ),
)("fits $columns preview columns at $width px in $mode", async ({ width, columns, mode }) => {
  const document = lunch(
    [],
    [drinks(), documentProduct("mi-lemonade", "p-lemonade"), documentProduct("mi-ham", "p-ham")],
  );
  document.offers["mi-lemonade"]!.name = "Extraordinariamenteextralargapalabra";
  document.offers["mi-ham"]!.name = "Pollo asado con patatas y verduras";
  const { el, host } = await mount({
    document: display("handheld", { columns, tiles: mode }, document),
  });
  await widen(host, width);
  const grid = root(el).querySelector<HTMLElement>('[data-region="structure"] .grid')!;
  expect(tracks(grid)).toBe(columns);
  expect(tiles(el, "structure")).toHaveLength(3);
  for (const cell of tiles(el, "structure")) {
    const box = cell.getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    for (const content of cell.querySelectorAll<HTMLElement>(
      ".name, .price, .kind, wt-icon, img",
    )) {
      const bounds = content.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(box.left);
      expect(bounds.right).toBeLessThanOrEqual(box.right);
      expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth + 1);
    }
  }
});

it.each([360, 390])("shows three preview columns inside a %s px dashboard", async (width) => {
  const { el, host } = await mount({ document: display("handheld", { columns: 3 }) });
  await widen(host, width - 80);
  for (const grid of grids(el)) expect(tracks(grid)).toBe(3);
});

function drinks(extra: Partial<Extract<DocumentMember, { kind: "section" }>> = {}): DocumentMember {
  return {
    ...(documentSection("s-drinks", "Drinks", [documentProduct("mi-beer", "p-beer")]) as Extract<
      DocumentMember,
      { kind: "section" }
    >),
    color: "#b12525",
    image: "drinks.webp",
    ...extra,
  };
}

const productTile = (productId: string): DocumentTile => ({ kind: "product", productId });
const sectionTile = (sectionId: string): DocumentTile => ({ kind: "section", sectionId });

const SHORTCUTS: DocumentTile[] = [
  productTile("p-lemonade"),
  { kind: "empty" },
  sectionTile("s-drinks"),
];

/**
 * Drinks › Beer, then Lemonade, Ham (by weight), Water and Chips at the top level. Chips is not
 * sold separately. Lemonade has a photo and a colour, Ham a colour alone, Beer and Water neither.
 */
function lunch(
  shortcuts: DocumentTile[] = SHORTCUTS,
  members: DocumentMember[] = [
    drinks(),
    documentProduct("mi-lemonade", "p-lemonade"),
    documentProduct("mi-ham", "p-ham"),
    documentProduct("mi-water", "p-water"),
    documentProduct("mi-chips", "p-chips"),
  ],
): MenuDocument {
  const document = menuDocument(members, {
    "p-beer": "Beer",
    "p-lemonade": "Lemonade",
    "p-ham": "Ham",
    "p-water": "Water",
    "p-chips": "Chips",
  });
  const offer = (id: string) => document.offers[id];
  if (offer("mi-lemonade"))
    Object.assign(offer("mi-lemonade")!, {
      unitPrice: "2.50",
      image: "lemonade.webp",
      color: "#256bb1",
    });
  if (offer("mi-ham")) Object.assign(offer("mi-ham")!, { unit: KILO, color: "#b12525" });
  if (offer("mi-chips")) offer("mi-chips")!.ordering = "not_sold_separately";
  return { ...document, home: { ...document.home, shortcuts } };
}

/** `document` with `device`'s display settings changed to `values`. */
function display(
  device: HomeDevice,
  values: Partial<HomeDisplay>,
  document: MenuDocument = lunch(),
): MenuDocument {
  return {
    ...document,
    home: { ...document.home, [device]: { ...document.home[device], ...values } },
  };
}

async function mount(
  props: Partial<DeviceHomePreview> = {},
): Promise<{ el: DeviceHomePreview; host: HTMLElement }> {
  return mountWidget<DeviceHomePreview>("dashboard-device-home-preview", {
    document: lunch(),
    ...props,
  });
}

const root = (el: DeviceHomePreview) => el.shadowRoot!;

function regions(el: DeviceHomePreview): string[] {
  return [...root(el).querySelectorAll<HTMLElement>("[data-region]")].map(
    (region) => region.dataset.region!,
  );
}

function tiles(el: DeviceHomePreview, region: string): HTMLElement[] {
  return [...root(el).querySelectorAll<HTMLElement>(`[data-region="${region}"] .tile`)];
}

function names(cells: HTMLElement[]): string[] {
  return cells.map((cell) => cell.querySelector(".name")!.textContent!.trim());
}

function tile(el: DeviceHomePreview, region: string, name: string): HTMLElement {
  const found = tiles(el, region).find(
    (cell) => cell.querySelector(".name")!.textContent!.trim() === name,
  );
  if (!found) throw new Error(`no ${region} tile named ${name}`);
  return found;
}

/** The region's accessible name: its own label, or the text of the element labelling it. */
function regionName(el: DeviceHomePreview, region: string): string | null {
  const node = root(el).querySelector<HTMLElement>(`[data-region="${region}"]`)!;
  const labelledBy = node.getAttribute("aria-labelledby");
  if (labelledBy === null) return node.getAttribute("aria-label");
  return root(el).getElementById(labelledBy)?.textContent?.trim() ?? null;
}

const divider = (el: DeviceHomePreview) =>
  root(el).querySelector<HTMLElement>(".divider")?.textContent?.trim() ?? null;

function grids(el: DeviceHomePreview): HTMLElement[] {
  return [...root(el).querySelectorAll<HTMLElement>(".grid")];
}

const frame = (el: DeviceHomePreview) => root(el).querySelector<HTMLElement>(".frame")!;

/** Sets the host's width and waits for the layout to follow. */
async function widen(host: HTMLElement, width: number): Promise<void> {
  host.style.width = `${width}px`;
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

/** How many column tracks a grid lays out. */
function tracks(grid: HTMLElement): number {
  return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
}

/** A region's tiles in the order a person reads them: row by row, left to right. */
function readingOrder(el: DeviceHomePreview, region: string): string[] {
  const placed = tiles(el, region).map((cell) => ({
    name: cell.querySelector(".name")!.textContent!.trim(),
    box: cell.getBoundingClientRect(),
  }));
  placed.sort((a, b) => Math.round(a.box.top - b.box.top) || a.box.left - b.box.left);
  return placed.map(({ name }) => name);
}

async function click(el: DeviceHomePreview, target: HTMLElement): Promise<void> {
  target.click();
  await el.updateComplete;
}

function breadcrumb(el: DeviceHomePreview): string {
  return [...root(el).querySelectorAll("nav.breadcrumb li")]
    .map((item) => item.querySelector("wt-button, [aria-current]")!.textContent!.trim())
    .join(" › ");
}

const home = (el: DeviceHomePreview) =>
  root(el).querySelector<HTMLElement>("nav.breadcrumb wt-button")!;

async function search(el: DeviceHomePreview, text: string): Promise<void> {
  const field = root(el).querySelector('[data-region="search"] wt-input')!;
  const input = field.shadowRoot!.querySelector("input")!;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

const image = (cell: HTMLElement) => cell.querySelector<HTMLImageElement>("img");

/** The colour a tile paints: a product tile's own background, a section button's inner button's. */
function fillOf(cell: HTMLElement): string {
  const painted = cell.localName === "wt-button" ? cell.shadowRoot!.querySelector("button")! : cell;
  return getComputedStyle(painted).backgroundColor;
}

beforeEach(() => setLocale("en"));

afterEach(() => {
  setLocale("es-ES");
  cleanupWidgets();
});

describe("dashboard-device-home-preview", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("dashboard-device-home-preview")).toBe(DeviceHomePreview);
  });

  it("draws nothing without a document", async () => {
    const { el } = await mount({ document: null });
    expect(regions(el)).toEqual([]);
  });

  it("draws search, then the Device Home Page and the full menu, divided, for Handheld", async () => {
    const document = display(
      "till",
      { columns: 7, order: "menu_first" },
      display("handheld", {
        columns: 5,
      }),
    );
    const { el } = await mount({ document });
    expect(el.device).toBe("handheld");
    expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
    const shortcuts = root(el).querySelector('[data-region="shortcuts"]')!;
    expect(shortcuts.querySelector("h2")).toBeNull();
    expect(regionName(el, "shortcuts")).toBe("Shortcuts");
    expect(divider(el)).toBe("Full menu");
    expect(regionName(el, "structure")).toBe("Full menu");
    expect(grids(el)).toHaveLength(2);
    for (const grid of grids(el)) expect(grid.style.getPropertyValue("--columns").trim()).toBe("5");

    el.device = "till";
    await el.updateComplete;
    expect(regions(el)).toEqual(["search", "structure", "shortcuts"]);
    for (const grid of grids(el)) expect(grid.style.getPropertyValue("--columns").trim()).toBe("7");
  });

  it("swaps the whole blocks for Menu first, keeping each block's own order", async () => {
    const homeFirst = await mount();
    const shortcutNames = names(tiles(homeFirst.el, "shortcuts"));
    const structureNames = names(tiles(homeFirst.el, "structure"));
    expect(shortcutNames).toEqual(["Lemonade", "Drinks para clientes"]);
    expect(structureNames).toEqual(["Drinks para clientes", "Lemonade", "Ham", "Water"]);
    const { el } = await mount({ document: display("handheld", { order: "menu_first" }) });
    expect(regions(el)).toEqual(["search", "structure", "shortcuts"]);
    expect(divider(el)).toBe("Shortcuts");
    expect(regionName(el, "shortcuts")).toBe("Shortcuts");
    expect(regionName(el, "structure")).toBe("Full menu");
    expect(root(el).querySelector('[data-region="structure"] h2')).toBeNull();
    expect(names(tiles(el, "shortcuts"))).toEqual(shortcutNames);
    expect(names(tiles(el, "structure"))).toEqual(structureNames);
  });

  describe("draws no divider when either block is empty", () => {
    it("draws no shortcut block and no divider when every shortcut is missing", async () => {
      const { el } = await mount({
        document: lunch([{ kind: "empty" }, productTile("p-ghost"), sectionTile("s-gone")]),
      });
      expect(regions(el)).toEqual(["search", "structure"]);
      expect(root(el).querySelector(".divider")).toBeNull();
      expect(root(el).querySelector(".slot")).toBeNull();
      expect(regionName(el, "structure")).toBe("Full menu");
      expect(names(tiles(el, "structure"))).toContain("Water");
    });

    it("draws neither block nor a divider for a menu with nothing to show", async () => {
      const { el } = await mount({ document: lunch([], []) });
      expect(regions(el)).toEqual(["search"]);
      expect(root(el).querySelector(".divider")).toBeNull();
    });
  });

  it("shows fewer columns on a narrow screen, in the same reading order", async () => {
    const handheld = await mount({ document: display("handheld", { columns: 3 }) });
    await widen(handheld.host, 150);
    const structureGrid = (el: DeviceHomePreview) =>
      root(el).querySelector<HTMLElement>('[data-region="structure"] .grid')!;
    expect(tracks(structureGrid(handheld.el))).toBeLessThan(3);
    expect(readingOrder(handheld.el, "structure")).toEqual(names(tiles(handheld.el, "structure")));

    const till = await mount({ document: display("till", { columns: 10 }), device: "till" });
    await widen(till.host, 1280);
    expect(tracks(structureGrid(till.el))).toBe(10);
    const wide = readingOrder(till.el, "structure");
    await widen(till.host, 390);
    expect(tracks(structureGrid(till.el))).toBeLessThan(10);
    for (const cell of tiles(till.el, "structure"))
      expect(cell.getBoundingClientRect().width).toBeGreaterThanOrEqual(104);
    expect(readingOrder(till.el, "structure")).toEqual(wide);
  });

  it("draws as many columns as a 390 px phone's till does, three, at the Handheld slider's most", async () => {
    const handheld = await mount({ document: display("handheld", { columns: 3 }) });
    await widen(handheld.host, 1600);
    for (const grid of grids(handheld.el)) expect(tracks(grid)).toBe(3);
  });

  it("sizes the frame to a phone for Handheld and to a till for Till, never wider than the screen", async () => {
    const handheld = await mount();
    const till = await mount({ device: "till" });
    const tap = parseFloat(getComputedStyle(frame(handheld.el)).getPropertyValue("--wt-tap-min"));
    expect(tap).toBeGreaterThan(0);
    expect(frame(handheld.el).dataset.device).toBe("handheld");
    expect(frame(till.el).dataset.device).toBe("till");
    await widen(handheld.host, 1600);
    await widen(till.host, 1600);
    expect(frame(handheld.el).getBoundingClientRect().width).toBe(tap * 9);
    expect(frame(till.el).getBoundingClientRect().width).toBe(tap * 29);
    await widen(handheld.host, 390);
    await widen(till.host, 390);
    expect(frame(handheld.el).getBoundingClientRect().width).toBe(390);
    expect(frame(till.el).getBoundingClientRect().width).toBe(390);
  });

  it("shows a product's staff name and its price with its unit, as the till does", async () => {
    const { el } = await mount();
    const lemonade = tile(el, "structure", "Lemonade");
    expect(lemonade.querySelector(".price")!.textContent!.trim()).toBe(
      `${formatMoney("2.50", currentLocale())}/ea`,
    );
    expect(tile(el, "structure", "Ham").querySelector(".price")!.textContent!.trim()).toBe(
      `${formatMoney("3.00", currentLocale())}/kg`,
    );
  });

  it("names the unit by its id when its abbreviation reads empty", async () => {
    const document = lunch();
    document.offers["mi-water"]!.unit = {
      ...document.offers["mi-water"]!.unit,
      abbreviation: {},
    };
    const { el } = await mount({ document });
    expect(tile(el, "structure", "Water").querySelector(".price")!.textContent!.trim()).toBe(
      `${formatMoney("3.00", currentLocale())}/unit-each`,
    );
  });

  describe("fills tiles as the device does", () => {
    it("paints Colours mode from the product's frozen colour and the section's colour", async () => {
      const { el } = await mount();
      const lemonade = tile(el, "structure", "Lemonade");
      expect(image(lemonade)).toBeNull();
      expect(lemonade.hasAttribute("data-painted")).toBe(true);
      expect(fillOf(lemonade)).toBe("rgb(37, 107, 177)");
      const section = tile(el, "structure", "Drinks para clientes");
      expect(image(section)).toBeNull();
      expect(section.hasAttribute("data-painted")).toBe(true);
      expect(fillOf(section)).toBe("rgb(177, 37, 37)");
      expect(section.querySelector(".kind")!.textContent!.trim()).toBe("Section");
      const water = tile(el, "structure", "Water");
      expect(water.hasAttribute("data-painted")).toBe(false);
    });

    it("shows Thumbnails mode's image, else the colour, else the neutral tile", async () => {
      const { el } = await mount({ document: display("handheld", { tiles: "thumbnails" }) });
      const lemonade = tile(el, "structure", "Lemonade");
      const img = image(lemonade)!;
      expect(img.getAttribute("src")).toBe("/media/lemonade.webp");
      expect(img.getAttribute("alt")).toBe("");
      expect(img.compareDocumentPosition(lemonade.querySelector(".name")!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(lemonade.hasAttribute("data-painted")).toBe(false);

      const ham = tile(el, "structure", "Ham");
      expect(image(ham)).toBeNull();
      expect(ham.hasAttribute("data-painted")).toBe(true);
      expect(fillOf(ham)).toBe("rgb(177, 37, 37)");

      const section = tile(el, "structure", "Drinks para clientes");
      expect(image(section)!.getAttribute("src")).toBe("/media/drinks.webp");
      expect(section.hasAttribute("data-painted")).toBe(false);
      expect(section.querySelector(".kind")!.textContent!.trim()).toBe("Section");
      // The thumbnail takes the folder icon's place.
      expect(section.querySelector("wt-icon")).toBeNull();
    });

    it("draws a product with neither image nor colour neutral in Thumbnails mode, name and price shown", async () => {
      const { el } = await mount({ document: display("handheld", { tiles: "thumbnails" }) });
      const water = tile(el, "structure", "Water");
      expect(image(water)).toBeNull();
      expect(water.hasAttribute("data-painted")).toBe(false);
      expect(water.hasAttribute("style")).toBe(false);
      expect(water.querySelector(".name")!.textContent!.trim()).toBe("Water");
      expect(water.querySelector(".price")!.textContent!.trim()).toBe(
        `${formatMoney("3.00", currentLocale())}/ea`,
      );
    });

    it("uses the shown device's tile mode", async () => {
      const document = display("till", { tiles: "thumbnails" });
      const { el } = await mount({ document });
      expect(image(tile(el, "structure", "Lemonade"))).toBeNull();
      el.device = "till";
      await el.updateComplete;
      expect(image(tile(el, "structure", "Lemonade"))).not.toBeNull();
    });
  });

  it("opens a section behind a breadcrumb and goes back home; a product does nothing", async () => {
    const { el } = await mount();
    const lemonade = tile(el, "structure", "Lemonade");
    expect(lemonade.localName).not.toBe("wt-button");
    expect(lemonade.querySelector("button, wt-button")).toBeNull();
    await click(el, lemonade);
    expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);

    const section = tile(el, "structure", "Drinks para clientes");
    expect(section.localName).toBe("wt-button");
    await click(el, section);
    expect(regions(el)).toEqual(["search", "section"]);
    expect(breadcrumb(el)).toBe("Home › Drinks para clientes");
    expect(names(tiles(el, "section"))).toEqual(["Beer"]);
    await click(el, home(el));
    expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
  });

  it("returns from a section opened under Menu first to the arranged home", async () => {
    const { el } = await mount({ document: display("handheld", { order: "menu_first" }) });
    await click(el, tile(el, "structure", "Drinks para clientes"));
    await click(el, home(el));
    expect(regions(el)).toEqual(["search", "structure", "shortcuts"]);
    expect(divider(el)).toBe("Shortcuts");
  });

  it("names a section by its internal name when its customer name reads empty", async () => {
    const { el } = await mount({ document: lunch(SHORTCUTS, [drinks({ names: {} })]) });
    expect(names(tiles(el, "structure"))).toEqual(["Drinks"]);
  });

  it.each([
    ["en", "Search results"],
    ["es-ES", "Resultados de la búsqueda"],
  ] as const)(
    "in %s, names the results region for screen readers without drawing its heading, so the results start at the top",
    async (locale, name) => {
      setLocale(locale);
      const { el } = await mount();
      await search(el, "a");
      const results = root(el).querySelector<HTMLElement>('[data-region="results"]')!;
      const heading = root(el).getElementById(results.getAttribute("aria-labelledby")!)!;
      expect(heading.localName).toBe("h2");
      expect(heading.textContent!.trim()).toBe(name);
      expect(await page.getByRole("heading", { name, level: 2, exact: true }).elements()).toEqual([
        heading,
      ]);
      const box = heading.getBoundingClientRect();
      expect(box.width).toBeLessThanOrEqual(1);
      expect(box.height).toBeLessThanOrEqual(1);
      expect(getComputedStyle(heading).overflow).toBe("hidden");
      const grid = results.querySelector<HTMLElement>(".grid")!;
      expect(
        Math.abs(grid.getBoundingClientRect().top - results.getBoundingClientRect().top),
      ).toBeLessThan(1);
    },
  );

  it("searches this menu's products only, and says a device may show more", async () => {
    const { el } = await mount();
    const note = () => root(el).querySelector('[data-test="search-note"]');
    expect(note()!.textContent!.trim()).toBe(
      "This preview searches this menu only. A device may also show results from other menus available to it.",
    );
    await search(el, "LÉMO");
    expect(regions(el)).toEqual(["search", "results"]);
    expect(regionName(el, "results")).toBe("Search results");
    expect(names(tiles(el, "results"))).toEqual(["Lemonade"]);
    expect(note()).not.toBeNull();

    await search(el, "chips");
    expect(tiles(el, "results")).toEqual([]);
    expect(root(el).querySelector('[data-region="results"] .empty')!.textContent!.trim()).toBe(
      "No products match",
    );
    await search(el, "");
    expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
    expect(root(el).querySelector('[data-region="search"] wt-input')!.getAttribute("name")).toBe(
      "home-preview-search",
    );
    for (const region of ["shortcuts", "structure"])
      expect(names(tiles(el, region))).not.toContain("Chips");
  });

  it("keeps an empty slot's place", async () => {
    const { el } = await mount();
    const cells = [
      ...root(el).querySelector('[data-region="shortcuts"] .grid')!.children,
    ] as HTMLElement[];
    expect(cells).toHaveLength(3);
    expect(cells[1]!.classList.contains("slot")).toBe(true);
    expect(cells[1]!.getAttribute("aria-hidden")).toBe("true");
    expect(cells[1]!.querySelector(".name")).toBeNull();
  });

  it("opens an included menu's section from its shortcut", async () => {
    const { el } = await mount({
      document: lunch(SHORTCUTS, [
        drinks({ includedMenu: { id: "menu-bar", name: "Bar" } }),
        documentProduct("mi-lemonade", "p-lemonade"),
      ]),
    });
    await click(el, tile(el, "shortcuts", "Drinks para clientes"));
    expect(breadcrumb(el)).toBe("Home › Drinks para clientes");
    expect(names(tiles(el, "section"))).toEqual(["Beer"]);
    await click(el, home(el));
    expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
  });

  it("speaks the dashboard's language, calling the menu a carta in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mount();
    expect(divider(el)).toBe("Carta completa");
    expect(regionName(el, "shortcuts")).toBe("Accesos directos");
    await click(el, tile(el, "structure", "Drinks para clientes"));
    expect(breadcrumb(el)).toBe("Inicio › Drinks para clientes");
  });

  it("goes home when a new document no longer holds the open section", async () => {
    const { el } = await mount();
    await click(el, tile(el, "structure", "Drinks para clientes"));
    el.document = lunch(SHORTCUTS, [documentProduct("mi-lemonade", "p-lemonade")]);
    await el.updateComplete;
    expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
  });

  it("stays home when the document that dropped the open section is replaced by one holding it again", async () => {
    const original = lunch();
    const { el } = await mount({ document: original });
    await click(el, tile(el, "structure", "Drinks para clientes"));
    el.document = lunch(SHORTCUTS, [documentProduct("mi-lemonade", "p-lemonade")]);
    await el.updateComplete;
    el.document = original;
    await el.updateComplete;
    expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
  });

  describe("a section inside a section", () => {
    const beer = () => documentSection("s-beer", "Beer", [documentProduct("mi-beer", "p-beer")]);
    const water = () =>
      documentSection("s-water", "Water", [documentProduct("mi-water", "p-water")]);
    const lemonade = () => documentProduct("mi-lemonade", "p-lemonade");

    /** Drinks holds the Beer and Water sections; Lemonade sits beside it. */
    const nested = () =>
      lunch(SHORTCUTS, [documentSection("s-drinks", "Drinks", [beer(), water()]), lemonade()]);

    /** Opens Drinks, then Beer inside it. */
    async function openBeer(el: DeviceHomePreview): Promise<void> {
      await click(el, tile(el, "structure", "Drinks para clientes"));
      await click(el, tile(el, "section", "Beer para clientes"));
      expect(breadcrumb(el)).toBe("Home › Drinks para clientes › Beer para clientes");
      expect(names(tiles(el, "section"))).toEqual(["Beer"]);
    }

    it("opens it behind a breadcrumb naming each level, and goes back to the outer section from it", async () => {
      const { el } = await mount({ document: nested() });
      await openBeer(el);
      const crumbs = [...root(el).querySelectorAll<HTMLElement>("nav.breadcrumb li wt-button")];
      expect(crumbs.map((crumb) => crumb.textContent!.trim())).toEqual([
        "Home",
        "Drinks para clientes",
      ]);
      await click(el, crumbs[1]!);
      expect(regions(el)).toEqual(["search", "section"]);
      expect(breadcrumb(el)).toBe("Home › Drinks para clientes");
      expect(names(tiles(el, "section"))).toEqual(["Beer para clientes", "Water para clientes"]);
    });

    it("goes home when a new document moves the open section out from under the one it was opened in", async () => {
      const { el } = await mount({ document: nested() });
      await openBeer(el);
      el.document = lunch(SHORTCUTS, [
        documentSection("s-drinks", "Drinks", [water()]),
        beer(),
        lemonade(),
      ]);
      await el.updateComplete;
      expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
    });

    it("goes home when a new document leaves the open section with nothing the device shows", async () => {
      const { el } = await mount({ document: nested() });
      await openBeer(el);
      // Chips is not sold separately, so Beer holds nothing a device would show.
      el.document = lunch(SHORTCUTS, [
        documentSection("s-drinks", "Drinks", [
          documentSection("s-beer", "Beer", [documentProduct("mi-chips", "p-chips")]),
          water(),
        ]),
        lemonade(),
      ]);
      await el.updateComplete;
      expect(regions(el)).toEqual(["search", "shortcuts", "structure"]);
    });
  });

  describe("an included menu shown directly", () => {
    type SectionNode = Extract<DocumentMember, { kind: "section" }>;
    const beer = () => documentSection("s-beer", "Beer", [documentProduct("mi-beer", "p-beer")]);
    const lemonade = () => documentProduct("mi-lemonade", "p-lemonade");
    const ham = () => documentProduct("mi-ham", "p-ham");
    /** The included Drinks menu: Beer's section, then Water. */
    const included = (extra: Partial<SectionNode> = {}): DocumentMember => ({
      ...(documentSection("s-drinks", "Drinks", [
        beer(),
        documentProduct("mi-water", "p-water"),
      ]) as SectionNode),
      includedMenu: { id: "menu-drinks", name: "Drinks staff" },
      ...extra,
    });
    const direct = () => included({ direct: true });
    /** Drinks at the top level as a folder named "Bar", and inside Food under its own name. */
    const bar = (extra: Partial<SectionNode> = {}) =>
      included({
        names: { es: "Barra para clientes" },
        fixed: { names: { es: "Barra para clientes" } },
        ...extra,
      });
    const twice = (top: DocumentMember, shortcuts: DocumentTile[] = []) =>
      lunch(shortcuts, [top, documentSection("s-food", "Food", [ham(), included()])]);

    it("shows its sections and products on the home page in its place", async () => {
      const { el } = await mount({ document: lunch([], [lemonade(), direct(), ham()]) });
      expect(names(tiles(el, "structure"))).toEqual([
        "Lemonade",
        "Beer para clientes",
        "Water",
        "Ham",
      ]);
    });

    it("opens one of its sections with a breadcrumb that skips the included menu", async () => {
      const { el } = await mount({ document: lunch([], [lemonade(), direct()]) });
      await click(el, tile(el, "structure", "Beer para clientes"));
      expect(breadcrumb(el)).toBe("Home › Beer para clientes");
      expect(names(tiles(el, "section"))).toEqual(["Beer"]);
    });

    it("inside a section, shows its members in its place", async () => {
      const { el } = await mount({
        document: lunch([], [documentSection("s-food", "Food", [ham(), direct()])]),
      });
      await click(el, tile(el, "structure", "Food para clientes"));
      expect(names(tiles(el, "section"))).toEqual(["Ham", "Beer para clientes", "Water"]);
      await click(el, tile(el, "section", "Beer para clientes"));
      expect(breadcrumb(el)).toBe("Home › Food para clientes › Beer para clientes");
    });

    it("a shortcut to the included menu still opens it as a folder", async () => {
      const { el } = await mount({
        document: lunch([sectionTile("s-drinks")], [lemonade(), direct()]),
      });
      await click(el, tile(el, "shortcuts", "Drinks para clientes"));
      expect(breadcrumb(el)).toBe("Home › Drinks para clientes");
      expect(names(tiles(el, "section"))).toEqual(["Beer para clientes", "Water"]);
    });

    it("draws each copy of a menu included in two lists with its own name", async () => {
      const { el } = await mount({ document: twice(bar()) });
      expect(names(tiles(el, "structure"))).toEqual(["Barra para clientes", "Food para clientes"]);
      await click(el, tile(el, "structure", "Barra para clientes"));
      expect(breadcrumb(el)).toBe("Home › Barra para clientes");
      await click(el, home(el));
      await click(el, tile(el, "structure", "Food para clientes"));
      expect(names(tiles(el, "section"))).toEqual(["Ham", "Drinks para clientes"]);

      const shownDirectly = await mount({ document: twice(bar({ direct: true })) });
      expect(names(tiles(shownDirectly.el, "structure"))).toEqual([
        "Beer para clientes",
        "Water",
        "Food para clientes",
      ]);
      await click(shownDirectly.el, tile(shownDirectly.el, "structure", "Food para clientes"));
      expect(names(tiles(shownDirectly.el, "section"))).toEqual(["Ham", "Drinks para clientes"]);
    });

    it("keeps an open folder open when a new document shows it directly", async () => {
      const { el } = await mount({ document: twice(bar()) });
      await click(el, tile(el, "structure", "Food para clientes"));
      await click(el, tile(el, "section", "Drinks para clientes"));
      el.document = lunch(
        [],
        [bar(), documentSection("s-food", "Food", [ham(), included({ direct: true })])],
      );
      await el.updateComplete;
      expect(breadcrumb(el)).toBe("Home › Food para clientes › Drinks para clientes");
    });

    describe("two direct includes each holding one menu as a folder of its own name", () => {
      const named = (es: string) => included({ names: { es }, fixed: { names: { es } } });
      const shownDirectly = (id: string, name: string, folder: DocumentMember): DocumentMember => ({
        ...(documentSection(id, name, [folder]) as SectionNode),
        direct: true,
      });
      const sides = (second = "Second bar") =>
        lunch(
          [],
          [
            shownDirectly("s-left", "Left", named("First bar")),
            shownDirectly("s-right", "Right", named(second)),
          ],
        );

      it("opens the folder clicked, not the first copy drawn", async () => {
        const { el } = await mount({ document: sides() });
        expect(names(tiles(el, "structure"))).toEqual(["First bar", "Second bar"]);
        await click(el, tile(el, "structure", "Second bar"));
        expect(breadcrumb(el)).toBe("Home › Second bar");
        await click(el, tile(el, "section", "Beer para clientes"));
        expect(breadcrumb(el)).toBe("Home › Second bar › Beer para clientes");
        await click(
          el,
          [...root(el).querySelectorAll<HTMLElement>("nav.breadcrumb li wt-button")][1]!,
        );
        expect(breadcrumb(el)).toBe("Home › Second bar");
        await click(el, home(el));
        await click(el, tile(el, "structure", "First bar"));
        expect(breadcrumb(el)).toBe("Home › First bar");
      });

      it("keeps the copy open when a new document still draws it", async () => {
        const { el } = await mount({ document: sides() });
        await click(el, tile(el, "structure", "Second bar"));
        el.document = sides("Second bar, renamed");
        await el.updateComplete;
        expect(breadcrumb(el)).toBe("Home › Second bar, renamed");
      });
    });

    it("opens the top-level copy from a shortcut to a menu included twice, drawn from that copy", async () => {
      const painted = bar({
        color: "#256bb1",
        image: "bar-folder.webp",
        fixed: { names: { es: "Barra para clientes" }, color: "#256bb1", image: "bar-folder.webp" },
      });
      const shortcut = [sectionTile("s-drinks")];
      const { el } = await mount({ document: twice(painted, shortcut) });
      expect(names(tiles(el, "shortcuts"))).toEqual(["Barra para clientes"]);
      expect(fillOf(tile(el, "shortcuts", "Barra para clientes"))).toBe("rgb(37, 107, 177)");
      const thumbnails = await mount({
        document: display("handheld", { tiles: "thumbnails" }, twice(painted, shortcut)),
      });
      expect(
        image(tile(thumbnails.el, "shortcuts", "Barra para clientes"))!.getAttribute("src"),
      ).toBe("/media/bar-folder.webp");
      await click(el, tile(el, "shortcuts", "Barra para clientes"));
      expect(breadcrumb(el)).toBe("Home › Barra para clientes");

      // Shown directly, the top level holds no copy: the shortcut opens, and names, Food's.
      const shownDirectly = await mount({
        document: twice(bar({ direct: true }), shortcut),
      });
      expect(names(tiles(shownDirectly.el, "shortcuts"))).toEqual(["Drinks para clientes"]);
      await click(shownDirectly.el, tile(shownDirectly.el, "shortcuts", "Drinks para clientes"));
      expect(breadcrumb(shownDirectly.el)).toBe("Home › Drinks para clientes");
    });
  });

  it("lets no event from its search reach the page around it", async () => {
    const { el, host } = await mount();
    const heard: string[] = [];
    for (const type of ["wt-change", "wt-input", "input", "change"])
      host.addEventListener(type, () => heard.push(type));
    await search(el, "lemo");
    expect(names(tiles(el, "results"))).toEqual(["Lemonade"]);
    expect(heard).toEqual([]);
  });
});

describe("dashboard-device-home-preview editing the shortcuts", () => {
  const shortcut = (
    memberId: string,
    ref: HomeTile["ref"],
    name: string,
    extra: Partial<HomeTile> = {},
  ): HomeTile => ({
    memberId,
    position: 0,
    ref,
    missingName: null,
    name,
    reachable: true,
    ...extra,
  });

  const LEMONADE = shortcut(
    "sc-lemonade",
    { kind: "product", productId: "p-lemonade" },
    "Lemonade",
  );
  const DRINKS = shortcut("sc-drinks", { kind: "section", sectionId: "s-drinks" }, "Drinks");
  /** Not among the published document's shortcuts. */
  const HAM = shortcut("sc-ham", { kind: "product", productId: "p-ham" }, "Ham");
  const LIST = [LEMONADE, DRINKS, HAM];

  const cells = (el: DeviceHomePreview) => [
    ...root(el).querySelectorAll<HTMLElement>('[data-region="shortcuts"] .grid > *'),
  ];
  const grip = (el: DeviceHomePreview, memberId: string) =>
    root(el).querySelector<HTMLButtonElement>(`[data-test="grip-${memberId}"]`)!;
  const menu = (el: DeviceHomePreview, memberId: string) =>
    root(el).querySelector<HTMLElement>(`[data-test="actions-${memberId}"]`)!;
  const remove = (el: DeviceHomePreview, memberId: string) =>
    root(el).querySelector<HTMLElement & { disabled: boolean }>(
      `[data-test="remove-${memberId}"]`,
    )!;
  const add = (el: DeviceHomePreview, kind: "product" | "section") =>
    root(el).querySelector<HTMLElement & { disabled: boolean }>(`[data-test="add-${kind}"]`)!;
  const status = (el: DeviceHomePreview) =>
    root(el).querySelector('[role="status"]')!.textContent!.trim();

  function heard(host: HTMLElement): { type: string; detail: unknown }[] {
    const events: { type: string; detail: unknown }[] = [];
    for (const type of ["wt-shortcut-move", "wt-shortcut-remove", "wt-shortcut-add"])
      host.addEventListener(type, (event) =>
        events.push({ type, detail: (event as CustomEvent).detail }),
      );
    return events;
  }

  /** Presses `key` on the grip, as a person would with it focused; answers whether the key's
   * default action was prevented. */
  async function press(el: DeviceHomePreview, memberId: string, key: string): Promise<boolean> {
    const target = grip(el, memberId);
    target.focus();
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    await el.updateComplete;
    return event.defaultPrevented;
  }

  it("draws no grips, menus or add tiles while it is not given shortcuts", async () => {
    const { el } = await mount();
    expect(el.shortcuts).toBeNull();
    expect(root(el).querySelector('[data-test^="grip-"]')).toBeNull();
    expect(root(el).querySelector("wt-row-actions")).toBeNull();
    expect(root(el).querySelector('[data-test^="add-"]')).toBeNull();
    expect(root(el).querySelector('[role="status"]')).toBeNull();
  });

  it("draws the given shortcuts in the given order, one the published document lacks included", async () => {
    const { el } = await mount({ shortcuts: [HAM, DRINKS, LEMONADE] });
    expect(names(tiles(el, "shortcuts"))).toEqual(["Ham", "Drinks para clientes", "Lemonade"]);
    expect(root(el).querySelector('[data-region="shortcuts"] .slot')).toBeNull();
    expect(grip(el, "sc-ham").getAttribute("aria-label")).toBe("Reorder: Ham");
    expect(menu(el, "sc-drinks").getAttribute("label")).toBe("Actions: Drinks para clientes");
    expect(names(tiles(el, "structure"))).toEqual([
      "Drinks para clientes",
      "Lemonade",
      "Ham",
      "Water",
    ]);
  });

  it("draws a missing shortcut dashed, by its missing name, else its name, with a grip and Remove", async () => {
    const gone = shortcut("sc-gone", { kind: "missing", name: "Soup" }, "Soup", {
      reachable: false,
      missingName: "Old soup",
    });
    const unnamed = shortcut("sc-unnamed", { kind: "section", sectionId: "s-old" }, "Desserts", {
      reachable: false,
    });
    const { el } = await mount({ shortcuts: [gone, unnamed] });
    const [first, second] = tiles(el, "shortcuts");
    expect(first!.dataset.state).toBe("missing");
    expect(first!.querySelector(".name")!.textContent!.trim()).toBe("Missing: Old soup");
    expect(second!.querySelector(".name")!.textContent!.trim()).toBe("Missing: Desserts");
    expect(getComputedStyle(first!).borderTopStyle).toBe("dashed");
    expect(grip(el, "sc-gone")).not.toBeNull();
    expect(remove(el, "sc-gone").textContent!.trim()).toBe("Remove shortcut");
  });

  it("draws a reachable shortcut the device cannot show muted, saying it is not shown on devices", async () => {
    const chips = shortcut("sc-chips", { kind: "product", productId: "p-chips" }, "Chips");
    const { el } = await mount({ shortcuts: [chips] });
    const [cell] = tiles(el, "shortcuts");
    expect(cell!.dataset.state).toBe("hidden");
    expect(cell!.querySelector(".name")!.textContent!.trim()).toBe("Chips");
    expect(cell!.querySelector(".kind")!.textContent!.trim()).toBe("Not shown on devices");
    expect(remove(el, "sc-chips")).not.toBeNull();
    setLocale("es-ES");
    await el.updateComplete;
    expect(cell!.querySelector(".kind")!.textContent!.trim()).toBe(
      "No se muestra en los dispositivos",
    );
  });

  it("sends a remove for the tile's member, a missing one included", async () => {
    const gone = shortcut("sc-gone", { kind: "missing", name: "Soup" }, "Soup", {
      reachable: false,
    });
    const { el, host } = await mount({ shortcuts: [LEMONADE, gone] });
    const events = heard(host);
    await click(el, remove(el, "sc-lemonade"));
    await click(el, remove(el, "sc-gone"));
    expect(events).toEqual([
      { type: "wt-shortcut-remove", detail: { memberId: "sc-lemonade" } },
      { type: "wt-shortcut-remove", detail: { memberId: "sc-gone" } },
    ]);
  });

  it("ends the shortcuts with two add tiles that send their kind, drawn with no shortcuts too", async () => {
    const { el } = await mount({ shortcuts: LIST });
    const drawn = cells(el);
    expect(drawn.slice(-2)).toEqual([add(el, "product"), add(el, "section")]);
    expect(add(el, "product").textContent!.trim()).toBe("Add product shortcuts");
    expect(add(el, "section").textContent!.trim()).toBe("Add section shortcuts");

    const empty = await mount({ shortcuts: [], document: lunch([], []) });
    expect(regions(empty.el)).toEqual(["search", "shortcuts"]);
    const events = heard(empty.host);
    await click(empty.el, add(empty.el, "product"));
    await click(empty.el, add(empty.el, "section"));
    expect(events).toEqual([
      { type: "wt-shortcut-add", detail: { kind: "product" } },
      { type: "wt-shortcut-add", detail: { kind: "section" } },
    ]);

    const dividing = await mount({ shortcuts: [] });
    expect(regions(dividing.el)).toEqual(["search", "shortcuts", "structure"]);
    expect(divider(dividing.el)).toBe("Full menu");
  });

  it.each([
    ["ArrowRight", "sc-lemonade", 1, ["Drinks para clientes", "Lemonade", "Ham"]],
    ["ArrowDown", "sc-lemonade", 1, ["Drinks para clientes", "Lemonade", "Ham"]],
    ["ArrowLeft", "sc-ham", 1, ["Lemonade", "Ham", "Drinks para clientes"]],
    ["ArrowUp", "sc-ham", 1, ["Lemonade", "Ham", "Drinks para clientes"]],
  ] as const)(
    "moves a shortcut one place with %s on its grip, at once, keeping focus and announcing it",
    async (key, memberId, to, order) => {
      const { el, host } = await mount({ shortcuts: LIST });
      const events = heard(host);
      const moved = grip(el, memberId);
      expect(await press(el, memberId, key)).toBe(true);
      expect(events).toEqual([{ type: "wt-shortcut-move", detail: { memberId, to } }]);
      expect(names(tiles(el, "shortcuts"))).toEqual(order);
      expect(grip(el, memberId)).toBe(moved);
      expect(root(el).activeElement).toBe(moved);
      const name = memberId === "sc-ham" ? "Ham" : "Lemonade";
      expect(status(el)).toBe(`${name} moved to position 2 of 3`);
    },
  );

  it("moves nothing past either end", async () => {
    const { el, host } = await mount({ shortcuts: LIST });
    const events = heard(host);
    await press(el, "sc-lemonade", "ArrowLeft");
    await press(el, "sc-lemonade", "ArrowUp");
    await press(el, "sc-ham", "ArrowRight");
    await press(el, "sc-ham", "ArrowDown");
    expect(events).toEqual([]);
    expect(names(tiles(el, "shortcuts"))).toEqual(["Lemonade", "Drinks para clientes", "Ham"]);
    expect(status(el)).toBe("");
  });

  it("ignores other keys on a grip", async () => {
    const { el, host } = await mount({ shortcuts: LIST });
    const events = heard(host);
    expect(await press(el, "sc-drinks", "Enter")).toBe(false);
    expect(events).toEqual([]);
  });

  it("keeps its own order across moves until a new list of shortcuts replaces it", async () => {
    const { el } = await mount({ shortcuts: LIST });
    await press(el, "sc-lemonade", "ArrowRight");
    await press(el, "sc-lemonade", "ArrowRight");
    expect(names(tiles(el, "shortcuts"))).toEqual(["Drinks para clientes", "Ham", "Lemonade"]);
    el.document = lunch();
    await el.updateComplete;
    expect(names(tiles(el, "shortcuts"))).toEqual(["Drinks para clientes", "Ham", "Lemonade"]);
    el.shortcuts = [...LIST];
    await el.updateComplete;
    expect(names(tiles(el, "shortcuts"))).toEqual(["Lemonade", "Drinks para clientes", "Ham"]);
  });

  it("while busy, disables grips, menus' Remove and the add tiles, and sends nothing", async () => {
    const { el, host } = await mount({ shortcuts: LIST, busy: true });
    const events = heard(host);
    for (const { memberId } of LIST) {
      expect(grip(el, memberId).disabled).toBe(true);
      expect(remove(el, memberId).disabled).toBe(true);
    }
    expect(add(el, "product").disabled).toBe(true);
    expect(add(el, "section").disabled).toBe(true);
    await press(el, "sc-lemonade", "ArrowRight");
    await click(el, remove(el, "sc-lemonade"));
    await click(el, add(el, "product"));
    expect(events).toEqual([]);
    expect(names(tiles(el, "shortcuts"))).toEqual(["Lemonade", "Drinks para clientes", "Ham"]);

    el.busy = false;
    await el.updateComplete;
    expect(grip(el, "sc-lemonade").disabled).toBe(false);
    expect(remove(el, "sc-lemonade").disabled).toBe(false);
    expect(add(el, "product").disabled).toBe(false);
  });

  it("opens a section from its shortcut tile, which holds no other control", async () => {
    const { el } = await mount({ shortcuts: LIST });
    const section = tile(el, "shortcuts", "Drinks para clientes");
    expect(section.localName).toBe("wt-button");
    expect(section.querySelector("button, wt-button, wt-row-actions")).toBeNull();
    for (const control of root(el).querySelectorAll("button, wt-button, wt-row-actions"))
      expect(control.parentElement!.closest("button, wt-button")).toBeNull();
    await click(el, section);
    expect(regions(el)).toEqual(["search", "section"]);
    expect(breadcrumb(el)).toBe("Home › Drinks para clientes");
  });

  it.each(["handheld", "till"] as const)("edits on the %s's home page", async (device) => {
    const { el, host } = await mount({ shortcuts: LIST, device });
    const events = heard(host);
    expect(names(tiles(el, "shortcuts"))).toEqual(["Lemonade", "Drinks para clientes", "Ham"]);
    expect(add(el, "section")).not.toBeNull();
    await press(el, "sc-drinks", "ArrowRight");
    expect(events).toEqual([
      { type: "wt-shortcut-move", detail: { memberId: "sc-drinks", to: 2 } },
    ]);
    for (const cell of cells(el)) {
      const box = cell.getBoundingClientRect();
      for (const control of cell.querySelectorAll<HTMLElement>("button.grip, wt-row-actions")) {
        const inner = control.getBoundingClientRect();
        expect(inner.left).toBeGreaterThanOrEqual(box.left);
        expect(inner.right).toBeLessThanOrEqual(box.right + 0.5);
      }
    }
  });

  it("focuses a shortcut's menu, or an add tile, when asked", async () => {
    const { el } = await mount({ shortcuts: LIST });
    expect(await el.focusShortcut("sc-drinks")).toBe(true);
    expect(root(el).activeElement).toBe(menu(el, "sc-drinks"));
    expect(await el.focusShortcut("sc-nowhere")).toBe(false);
    expect(await el.focusAdd("section")).toBe(true);
    expect(root(el).activeElement).toBe(add(el, "section"));
    expect(await el.focusAdd("product")).toBe(true);
    expect(root(el).activeElement).toBe(add(el, "product"));
  });

  describe("dragging a grip", () => {
    const cellOf = (el: DeviceHomePreview, memberId: string) =>
      root(el).querySelector<HTMLElement>(`.shortcut[data-member-id="${memberId}"]`)!;
    const marked = (el: DeviceHomePreview) => [
      ...root(el).querySelectorAll<HTMLElement>("[data-drop]"),
    ];

    function centre(node: Element): { x: number; y: number } {
      const box = node.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }

    /** Dispatched on the grip, where pointer capture sends a real drag's events. */
    function pointer(
      el: DeviceHomePreview,
      memberId: string,
      type: string,
      at: { x: number; y: number },
    ): void {
      grip(el, memberId).dispatchEvent(
        new PointerEvent(type, {
          pointerId: 7,
          button: 0,
          isPrimary: true,
          clientX: at.x,
          clientY: at.y,
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );
    }

    /** Presses `memberId`'s grip and moves the pointer to the middle of `over`, leaving it held. */
    async function hold(el: DeviceHomePreview, memberId: string, over: Element): Promise<void> {
      pointer(el, memberId, "pointerdown", centre(grip(el, memberId)));
      await el.updateComplete;
      pointer(el, memberId, "pointermove", centre(over));
      await el.updateComplete;
    }

    async function release(el: DeviceHomePreview, memberId: string, over: Element): Promise<void> {
      pointer(el, memberId, "pointerup", centre(over));
      await el.updateComplete;
    }

    afterEach(() => {
      document.body.style.cursor = "";
    });

    it("keeps a touch on the grip from scrolling the page", async () => {
      const { el } = await mount({ shortcuts: LIST });
      expect(getComputedStyle(grip(el, "sc-lemonade")).touchAction).toBe("none");
    });

    it("moves the first tile past the third, marking where it will land, sending one move", async () => {
      const { el, host } = await mount({ shortcuts: LIST });
      const events = heard(host);
      document.body.style.cursor = "help";
      await hold(el, "sc-lemonade", cellOf(el, "sc-drinks"));
      await hold(el, "sc-lemonade", cellOf(el, "sc-ham"));
      expect(marked(el)).toEqual([cellOf(el, "sc-ham")]);
      expect(cellOf(el, "sc-ham").dataset.drop).toBe("after");
      expect(getComputedStyle(cellOf(el, "sc-ham")).boxShadow).not.toBe("none");
      expect(cellOf(el, "sc-lemonade").hasAttribute("data-dragging")).toBe(true);
      expect(document.body.style.cursor).toBe("grabbing");
      expect(events).toEqual([]);

      await release(el, "sc-lemonade", cellOf(el, "sc-ham"));
      expect(events).toEqual([
        { type: "wt-shortcut-move", detail: { memberId: "sc-lemonade", to: 2 } },
      ]);
      expect(names(tiles(el, "shortcuts"))).toEqual(["Drinks para clientes", "Ham", "Lemonade"]);
      expect(marked(el)).toEqual([]);
      expect(cellOf(el, "sc-lemonade").hasAttribute("data-dragging")).toBe(false);
      expect(document.body.style.cursor).toBe("help");
      expect(status(el)).toBe("Lemonade moved to position 3 of 3");
    });

    it("moves the last tile to the front, marking the first tile before it", async () => {
      const { el, host } = await mount({ shortcuts: LIST });
      const events = heard(host);
      await hold(el, "sc-ham", cellOf(el, "sc-lemonade"));
      expect(cellOf(el, "sc-lemonade").dataset.drop).toBe("before");
      await release(el, "sc-ham", cellOf(el, "sc-lemonade"));
      expect(events).toEqual([{ type: "wt-shortcut-move", detail: { memberId: "sc-ham", to: 0 } }]);
      expect(names(tiles(el, "shortcuts"))).toEqual(["Ham", "Lemonade", "Drinks para clientes"]);
    });

    it("sends nothing when released where it started, or pressed without moving", async () => {
      const { el, host } = await mount({ shortcuts: LIST });
      const events = heard(host);
      await hold(el, "sc-drinks", cellOf(el, "sc-ham"));
      await hold(el, "sc-drinks", cellOf(el, "sc-drinks"));
      expect(marked(el)).toEqual([]);
      await release(el, "sc-drinks", cellOf(el, "sc-drinks"));

      pointer(el, "sc-drinks", "pointerdown", centre(grip(el, "sc-drinks")));
      await el.updateComplete;
      expect(document.body.style.cursor).toBe("");
      await release(el, "sc-drinks", grip(el, "sc-drinks"));
      expect(events).toEqual([]);
      expect(names(tiles(el, "shortcuts"))).toEqual(["Lemonade", "Drinks para clientes", "Ham"]);
      expect(document.body.style.cursor).toBe("");
    });

    it("cancels on Escape, sending nothing then or on release", async () => {
      const { el, host } = await mount({ shortcuts: LIST });
      const events = heard(host);
      await hold(el, "sc-lemonade", cellOf(el, "sc-ham"));
      const escape = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      grip(el, "sc-lemonade").dispatchEvent(escape);
      await el.updateComplete;
      expect(escape.defaultPrevented).toBe(true);
      expect(marked(el)).toEqual([]);
      expect(document.body.style.cursor).toBe("");
      await release(el, "sc-lemonade", cellOf(el, "sc-ham"));
      expect(events).toEqual([]);
      expect(names(tiles(el, "shortcuts"))).toEqual(["Lemonade", "Drinks para clientes", "Ham"]);
    });

    it("ends without a move when the pointer is cancelled", async () => {
      const { el, host } = await mount({ shortcuts: LIST });
      const events = heard(host);
      await hold(el, "sc-lemonade", cellOf(el, "sc-ham"));
      pointer(el, "sc-lemonade", "pointercancel", centre(cellOf(el, "sc-ham")));
      await el.updateComplete;
      expect(marked(el)).toEqual([]);
      expect(document.body.style.cursor).toBe("");
      await release(el, "sc-lemonade", cellOf(el, "sc-ham"));
      expect(events).toEqual([]);
    });

    it("never targets an add tile or the menu block", async () => {
      const { el, host } = await mount({ shortcuts: LIST });
      const events = heard(host);
      await hold(el, "sc-lemonade", cellOf(el, "sc-ham"));
      await hold(el, "sc-lemonade", add(el, "section"));
      expect(marked(el)).toEqual([]);
      await release(el, "sc-lemonade", add(el, "section"));

      const water = tile(el, "structure", "Water");
      water.scrollIntoView({ block: "center" });
      await hold(el, "sc-lemonade", water);
      expect(marked(el)).toEqual([]);
      await release(el, "sc-lemonade", water);
      expect(events).toEqual([]);
      expect(names(tiles(el, "shortcuts"))).toEqual(["Lemonade", "Drinks para clientes", "Ham"]);
    });

    it("sends nothing when it turns busy, or the dragged shortcut leaves the list, before release", async () => {
      const { el, host } = await mount({ shortcuts: LIST });
      const events = heard(host);
      await hold(el, "sc-lemonade", cellOf(el, "sc-ham"));
      el.busy = true;
      await el.updateComplete;
      await release(el, "sc-lemonade", cellOf(el, "sc-ham"));
      expect(document.body.style.cursor).toBe("");
      el.busy = false;
      await el.updateComplete;

      await hold(el, "sc-lemonade", cellOf(el, "sc-ham"));
      el.shortcuts = [DRINKS, HAM];
      await el.updateComplete;
      await release(el, "sc-ham", cellOf(el, "sc-ham"));
      expect(events).toEqual([]);
      expect(names(tiles(el, "shortcuts"))).toEqual(["Drinks para clientes", "Ham"]);
      expect(document.body.style.cursor).toBe("");
    });

    it("hands the page's cursor back when removed mid-drag", async () => {
      const { el } = await mount({ shortcuts: LIST });
      await hold(el, "sc-lemonade", cellOf(el, "sc-ham"));
      expect(document.body.style.cursor).toBe("grabbing");
      el.remove();
      expect(document.body.style.cursor).toBe("");
    });

    it("does not drag while busy", async () => {
      const { el, host } = await mount({ shortcuts: LIST, busy: true });
      const events = heard(host);
      await hold(el, "sc-lemonade", cellOf(el, "sc-ham"));
      expect(marked(el)).toEqual([]);
      expect(cellOf(el, "sc-lemonade").hasAttribute("data-dragging")).toBe(false);
      expect(document.body.style.cursor).toBe("");
      await release(el, "sc-lemonade", cellOf(el, "sc-ham"));
      expect(events).toEqual([]);
    });
  });
});
