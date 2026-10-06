import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMoney } from "@waitron/shared";
import type { DocumentMember, HomeDevice, HomeDisplay, MenuDocument } from "../api/client.js";
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
    const handheld = await mount({ document: display("handheld", { columns: 6 }) });
    await widen(handheld.host, 390);
    const structureGrid = (el: DeviceHomePreview) =>
      root(el).querySelector<HTMLElement>('[data-region="structure"] .grid')!;
    expect(tracks(structureGrid(handheld.el))).toBeLessThan(6);
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
