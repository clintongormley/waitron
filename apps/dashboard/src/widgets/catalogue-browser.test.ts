import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { registerIcons } from "@waitron/ui";
import { chooseOption, chooseOptions } from "@waitron/ui/src/test-helpers.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { en, es } from "../i18n/strings.js";
import type { CategorySummary, DashboardApi, Product } from "../api/client.js";
import type { RoutingModel } from "@waitron/venue-service/routing";
import type { CatalogueBrowser } from "./catalogue-browser.js";
import "./catalogue-browser.js";
import { HOVER_OPEN_MS, ROOT_KEY } from "./product-list.js";
registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setLocale("en-GB");
});
export const folder = (id: string, name: string, parentId: string | null): CategorySummary => ({
  id,
  name,
  parentId,
  color: null,
});
export const CATEGORIES = [
  folder("d", "Drinks", null),
  folder("b", "Beer", "d"),
  folder("f", "Food", null),
];
const product = (
  id: string,
  name: string,
  primaryCategoryId: string | null,
  active = true,
): Product => ({
  id,
  name,
  primaryCategoryId,
  categoryId: primaryCategoryId,
  active,
  catalogueId: "c",
  modifiers: [],
  customerName: null,
  unitId: "u",
  unit: { id: "u", name: { en: "Each" }, abbreviation: { en: "ea" }, precision: 0 },
  description: null,
  kitchenName: null,
  dietaryDeclarations: [],
  pricingUnit: "each",
  unitPrice: "2.00",
  vatClass: "reduced",
  available: true,
  ordering: "public",
  allergens: null,
  dietOverride: null,
  dietDerivation: null,
  manualAllergens: null,
  image: null,
  color: null,
  variants: [],
});
export const PRODUCTS = [
  product("cola", "Cola", "d"),
  product("lager", "Lager", "b", false),
  product("burger", "Burger", "f"),
  product("bread", "Bread", null),
];
export async function mountBrowser(overrides: Partial<CatalogueBrowser> = {}) {
  const api = {
    moveCatalogueItems: vi.fn().mockResolvedValue(undefined),
    deleteCatalogueItems: vi.fn().mockResolvedValue(undefined),
    countProductMenus: vi.fn().mockResolvedValue(0),
    summariseFolders: vi
      .fn()
      .mockResolvedValue([
        { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 },
      ]),
    createCategory: vi.fn().mockResolvedValue(folder("new", "Juice", "d")),
    updateCategory: vi.fn().mockResolvedValue(folder("d", "Beverages", null)),
    saveCatalogueDefaultColor: vi
      .fn()
      .mockResolvedValue({ defaultProductVatClass: "general", defaultColor: null }),
  } as unknown as DashboardApi;
  return (
    await mountWidget<CatalogueBrowser>("dashboard-catalogue-browser", {
      api,
      products: PRODUCTS,
      categories: CATEGORIES,
      ...overrides,
    })
  ).el;
}
export async function tableOf(el: CatalogueBrowser) {
  await el.updateComplete;
  const list = el.shadowRoot!.querySelector("dashboard-product-list")!;
  await list.updateComplete;
  const table = list.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  return table;
}
export async function rowKeys(el: CatalogueBrowser) {
  return [...(await tableOf(el)).shadowRoot!.querySelectorAll<HTMLElement>("tr[data-row-key]")]
    .map((row) => row.dataset.rowKey)
    .filter((key) => key !== ROOT_KEY);
}
/** Opens or closes a category the way a click on its row does. */
export async function toggleCategory(el: CatalogueBrowser, id: string) {
  const table = await tableOf(el);
  table
    .shadowRoot!.querySelector<HTMLElement>(`tr[data-row-key="folder:${id}"] .row-activate`)!
    .click();
  await table.updateComplete;
}
async function menuAction(el: CatalogueBrowser, test: string) {
  (await tableOf(el)).shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`)!.click();
  await el.updateComplete;
}
async function nameBox(el: CatalogueBrowser) {
  const table = await tableOf(el);
  await vi.waitFor(() =>
    expect(table.shadowRoot!.activeElement?.getAttribute("name")).toBe("category-name"),
  );
  return table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    'wt-input[name="category-name"]',
  )!;
}

it("marks a category with no cell while the default station is switched off, or whose cell names a switched-off station with no fallback, and clears the mark once it has a cell", async () => {
  setLocale("en-GB");
  const routing: RoutingModel = {
    stationTimes: [],
    periods: [],
    todayEnds: null,
    clockReadable: true,
    zones: [],
    categories: [],
    products: [],
    cells: [
      {
        row: { kind: "category", categoryId: "d" },
        zoneId: null,
        target: { kind: "station", stationId: "bar" },
      },
    ],
    defaultStationId: "default",
    stations: [
      { id: "bar", name: "Bar", active: true },
      { id: "default", name: "Kitchen", active: false },
    ],
  };
  const el = await mountBrowser({ routing });
  expect(await unroutedMarker(el, "folder:d")).toBeNull();
  expect(await unroutedMarker(el, "folder:f")).not.toBeNull();
  expect((await unroutedMarker(el, "folder:f"))?.getAttribute("title")).toBe(
    "No active station assigned",
  );
  await toggleCategory(el, "d");
  expect(await unroutedMarker(el, "folder:b")).toBeNull();
  el.routing = {
    ...routing,
    cells: [
      ...routing.cells,
      {
        row: { kind: "category", categoryId: "f" },
        zoneId: null,
        target: { kind: "station", stationId: "bar" },
      },
    ],
  };
  await el.updateComplete;
  expect(await unroutedMarker(el, "folder:f")).toBeNull();
  el.routing = {
    ...routing,
    stations: routing.stations.map((station) =>
      station.id === "bar" ? { ...station, active: false } : station,
    ),
  };
  await el.updateComplete;
  expect(await unroutedMarker(el, "folder:d")).not.toBeNull();
  expect(await unroutedMarker(el, "folder:b")).not.toBeNull();
  setLocale("es");
  await el.updateComplete;
  expect((await unroutedMarker(el, "folder:b"))?.getAttribute("title")).toBe(
    "Ninguna estación activa asignada",
  );
});

it("does not mark a folder covered by its own Every zone cell", async () => {
  const el = await mountBrowser({
    routing: {
      stationTimes: [],
      periods: [],
      todayEnds: null,
      clockReadable: true,
      zones: [],
      categories: [],
      products: [],
      cells: [
        {
          row: { kind: "category", categoryId: "f" },
          zoneId: null,
          target: { kind: "station", stationId: "kitchen" },
        },
      ],
      defaultStationId: null,
      stations: [{ id: "kitchen", name: "Kitchen", active: true }],
    },
  });
  expect(await unroutedMarker(el, "folder:f")).toBeNull();
  expect(await unroutedMarker(el, "folder:d")).not.toBeNull();
});
/** The Made at cell of a row, found by its column heading. */
async function madeAtText(el: CatalogueBrowser, key: string) {
  const root = (await tableOf(el)).shadowRoot!;
  const index = [...root.querySelectorAll("thead th")].findIndex((cell) =>
    cell.textContent!.trim().startsWith("Made at"),
  );
  expect(index).toBeGreaterThanOrEqual(0);
  const row = root.querySelector(`tr[data-row-key="${key}"]`)!;
  return [...row.querySelectorAll("td")][index]!.textContent!.replace(/\s+/g, " ").trim();
}
/** The red asterisk on a category's row, or null when the row has none. */
async function unroutedMarker(el: CatalogueBrowser, key: string) {
  const row = (await tableOf(el)).shadowRoot!.querySelector(`tr[data-row-key="${key}"]`);
  expect(row).not.toBeNull();
  return row!.querySelector('[data-test="unrouted-folder"]');
}
type RoutingFixture = Omit<RoutingModel, "stationTimes"> & {
  stationTimes: (RoutingModel["stationTimes"][number] & { fallbackStationId?: string | null })[];
};
const routingWith = (overrides: Partial<RoutingFixture> = {}): RoutingModel => ({
  stationTimes: [],
  periods: [],
  todayEnds: null,
  clockReadable: true,
  zones: [],
  categories: [],
  products: [],
  cells: [
    {
      row: { kind: "category", categoryId: "d" },
      zoneId: null,
      target: { kind: "station", stationId: "bar" },
    },
  ],
  defaultStationId: "kitchen",
  stations: [
    { id: "bar", name: "Bar", active: true },
    { id: "kitchen", name: "Kitchen", active: true },
  ],
  ...overrides,
});

it("shows each category's route from the routing it holds, and redraws it when routing changes", async () => {
  const el = await mountBrowser({ routing: routingWith() });
  expect(await madeAtText(el, "folder:d")).toBe("Bar set on this category");
  expect(await madeAtText(el, "folder:f")).toBe("Kitchen default station");
  await toggleCategory(el, "d");
  expect(await madeAtText(el, "folder:b")).toBe("Bar from Drinks");
  el.routing = routingWith({
    cells: [
      {
        row: { kind: "category", categoryId: "d" },
        zoneId: null,
        target: { kind: "no_preparation" },
      },
    ],
  });
  expect(await madeAtText(el, "folder:d")).toBe("No preparation set on this category");
  expect(await madeAtText(el, "folder:b")).toBe("No preparation from Drinks");
});

it("works the route out again when the products or the categories change", async () => {
  const routing = routingWith();
  const el = await mountBrowser({
    routing: routingWith({
      cells: [
        ...routing.cells,
        {
          row: { kind: "product", productId: "juice" },
          zoneId: null,
          target: { kind: "station", stationId: "kitchen" },
        },
      ],
    }),
  });
  expect(await madeAtText(el, "folder:d")).toBe("Bar set on this category");
  el.products = [
    ...PRODUCTS,
    { ...PRODUCTS[0]!, id: "juice", name: "Juice", primaryCategoryId: "d", categoryId: "d" },
  ];
  expect(await madeAtText(el, "folder:d")).toBe(
    "Bar set on this category · some items made elsewhere",
  );
  el.categories = [...CATEGORIES, folder("w", "Wine", "d")];
  await toggleCategory(el, "d");
  expect(await madeAtText(el, "folder:w")).toBe("Bar from Drinks");
});

it("decides the asterisk from default recovery for a switched-off station", async () => {
  const barOff = (defaultAvailable: boolean) =>
    routingWith({
      defaultStationId: defaultAvailable ? "kitchen" : null,
      stations: [
        { id: "bar", name: "Bar", active: false },
        { id: "terrace", name: "Terrace", active: true },
        { id: "kitchen", name: "Kitchen", active: true },
      ],
      stationTimes: [
        {
          stationId: "bar",
          status: { open: false, why: "switched_off" },
          fallbackStationId: "terrace",
          today: null,
          closedSendsTo: defaultAvailable ? "kitchen" : null,
        },
      ],
    });
  const el = await mountBrowser({ routing: barOff(true) });
  await toggleCategory(el, "d");
  expect(await madeAtText(el, "folder:d")).toBe("Kitchen set on this category");
  expect(await unroutedMarker(el, "folder:d")).toBeNull();
  expect(await madeAtText(el, "folder:b")).toBe("Kitchen from Drinks");
  expect(await unroutedMarker(el, "folder:b")).toBeNull();
  expect(await madeAtText(el, "folder:f")).toBe("Kitchen default station");
  expect(await unroutedMarker(el, "folder:f")).toBeNull();
  el.routing = barOff(false);
  expect(await unroutedMarker(el, "folder:d")).not.toBeNull();
  expect(await unroutedMarker(el, "folder:b")).not.toBeNull();
});

it("clears the asterisk on a category that falls through to a switched-on default station, and keeps it once that station is switched off", async () => {
  const kitchenOn = (active: boolean) =>
    routingWith({
      stations: [
        { id: "bar", name: "Bar", active: true },
        { id: "kitchen", name: "Kitchen", active },
      ],
    });
  const el = await mountBrowser({ routing: kitchenOn(true) });
  expect(await madeAtText(el, "folder:f")).toBe("Kitchen default station");
  expect(await unroutedMarker(el, "folder:f")).toBeNull();
  el.routing = kitchenOn(false);
  expect(await madeAtText(el, "folder:f")).toBe("Nowhere");
  expect(await unroutedMarker(el, "folder:f")).not.toBeNull();
  expect(await unroutedMarker(el, "folder:d")).toBeNull();
});

it("leaves categories blank while routing loads, and says so when its read failed", async () => {
  const el = await mountBrowser();
  expect(await madeAtText(el, "folder:d")).toBe("");
  el.routingFailed = true;
  expect(await madeAtText(el, "folder:d")).toBe("Kitchen routing unavailable");
  expect(await madeAtText(el, ROOT_KEY)).toBe("");
});

async function nameCell(el: CatalogueBrowser, key: string) {
  return (await tableOf(el)).shadowRoot!.querySelector<HTMLElement>(
    `tr[data-row-key="${key}"] [part~="${key.startsWith("folder:") ? "folder-cell" : "product-cell"}"]`,
  )!;
}
function pointerEvent(target: Element, type: string) {
  const rect = target.getBoundingClientRect();
  const event = new PointerEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    pointerId: 1,
    clientX: rect.x + 8,
    clientY: rect.y + 8,
  });
  target.dispatchEvent(event);
  return event;
}
function drag(from: Element, to: Element) {
  pointerEvent(from, "pointerdown");
  pointerEvent(to, "pointermove");
  pointerEvent(to, "pointerup");
}
function capturedTouch(from: Element, type: string, over: Element) {
  const box = over.getBoundingClientRect();
  from.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      clientX: box.x + 8,
      clientY: box.y + 8,
    }),
  );
}

/** A mouse drag of `from` onto `to`'s row activator, then the click its release makes. */
async function dragAndClick(el: CatalogueBrowser, from: string, to: string) {
  const table = await tableOf(el);
  const target = table.shadowRoot!.querySelector<HTMLElement>(
    `tr[data-row-key="${to}"] .row-activate`,
  )!;
  pointerEvent(await nameCell(el, from), "pointerdown");
  pointerEvent(target, "pointermove");
  pointerEvent(target, "pointerup");
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
  );
  await table.updateComplete;
}
const grips = async (el: CatalogueBrowser) =>
  (await tableOf(el)).shadowRoot!.querySelectorAll('.drag-grip, [part~="grip-space"]');
const checkboxes = async (el: CatalogueBrowser) =>
  (await tableOf(el)).shadowRoot!.querySelectorAll('tr[data-row-key] input[type="checkbox"]');

it("draws no grip on mount, and a drag there moves nothing while its release opens the category as a click", async () => {
  const el = await mountBrowser();
  expect((await tableOf(el)).shadowRoot!.querySelectorAll("tr[data-row-key]").length).toBe(4);
  expect((await grips(el)).length).toBe(0);
  await dragAndClick(el, "bread", "folder:f");
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "burger", "bread"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(el.api.moveCatalogueItems).not.toHaveBeenCalled();
});
it("Select shows a grip and a checkbox on every category and product row, and a drag then moves", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  const root = (await tableOf(el)).shadowRoot!;
  for (const key of ["folder:d", "folder:f", "bread"]) {
    expect(root.querySelector(`tr[data-row-key="${key}"] .drag-grip`), key).not.toBeNull();
    expect(
      root.querySelector(`tr[data-row-key="${key}"] input[type="checkbox"]`),
      key,
    ).not.toBeNull();
  }
  drag(await nameCell(el, "bread"), await nameCell(el, "folder:f"));
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["bread"], categoryIds: [] },
      "f",
    ),
  );
});
it("Done hides the grips and checkboxes, a drag moves nothing again, and focus returns to Select", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  expect((await grips(el)).length).toBeGreaterThan(0);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel-selection"]')!.focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[data-test="cancel-selection"]')).toBeNull();
  expect((await grips(el)).length).toBe(0);
  expect((await checkboxes(el)).length).toBe(0);
  const select = el.shadowRoot!.querySelector('[data-test="select"]')!;
  expect(el.shadowRoot!.activeElement).toBe(select);
  await dragAndClick(el, "bread", "folder:f");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(el.api.moveCatalogueItems).not.toHaveBeenCalled();
});
it.each([
  ["en-GB", "Done"],
  ["es", "Listo"],
])("the selection bar's leave button reads Done (%s)", async (locale, words) => {
  setLocale(locale);
  const el = await mountBrowser();
  await press(el, "select");
  expect(el.shadowRoot!.querySelector('[data-test="cancel-selection"]')!.textContent!.trim()).toBe(
    words,
  );
});
it("a dragged product stays in place, faded, under a lifted copy, and moves on the drop", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  const table = await tableOf(el);
  const list = el.shadowRoot!.querySelector("dashboard-product-list")!;
  const from = table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="bread"]')!;
  const before = from.getBoundingClientRect().top;
  const destination = await nameCell(el, "folder:f");
  pointerEvent(await nameCell(el, "bread"), "pointerdown");
  pointerEvent(destination, "pointermove");
  await list.updateComplete;
  expect(from.part.contains("dragging")).toBe(true);
  expect(getComputedStyle(from).opacity).toBe("0.5");
  expect(from.style.transform).toBe("");
  expect(from.getBoundingClientRect().top).toBe(before);
  expect(list.shadowRoot!.querySelector('[data-test="drag-ghost"]')!.textContent!.trim()).toBe(
    "Bread",
  );
  const bar = table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="folder:f"] td')!;
  expect(bar.part.contains("drop-target")).toBe(true);
  expect(getComputedStyle(bar).borderInlineStartStyle).toBe("solid");
  pointerEvent(destination, "pointerup");
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["bread"], categoryIds: [] },
      "f",
    ),
  );
  await list.updateComplete;
  expect(from.part.contains("dragging")).toBe(false);
  expect(list.shadowRoot!.querySelector('[data-test="drag-ghost"]')).toBeNull();
});
it("real pointer drag moves a product into a folder", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  // The table turns narrow a frame after its resize observer first reports, in the 414 px test
  // window, and the rows move; a drag started before then often lost its press.
  const table = await tableOf(el);
  await vi.waitFor(() => expect(table.hasAttribute("narrow")).toBe(true));
  await userEvent.dragAndDrop(
    (await tableOf(el)).shadowRoot!.querySelector('tr[data-row-key="bread"] .row-activate')!,
    (await tableOf(el)).shadowRoot!.querySelector('tr[data-row-key="folder:f"] .row-activate')!,
    { sourcePosition: { x: 4, y: 4 }, targetPosition: { x: 4, y: 4 } },
  );
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["bread"], categoryIds: [] },
      "f",
    ),
  );
});
it("finds a folder under a captured touch pointer", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  const from = await nameCell(el, "bread");
  const grip = from.closest("tr")!.querySelector(".drag-grip")!;
  const to = await nameCell(el, "folder:f");
  capturedTouch(grip, "pointerdown", grip);
  capturedTouch(grip, "pointermove", to);
  expect(to.closest("tr")!.querySelector("td")!.part.contains("drop-target")).toBe(true);
  capturedTouch(grip, "pointerup", to);
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["bread"], categoryIds: [] },
      "f",
    ),
  );
});
it("a click on a category's row opens it in place without starting a drag", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  const table = await tableOf(el);
  const activator = table.shadowRoot!.querySelector<HTMLElement>(
    'tr[data-row-key="folder:d"] .row-activate',
  )!;
  pointerEvent(activator, "pointerdown");
  pointerEvent(activator, "pointerup");
  activator.click();
  await table.updateComplete;
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:b", "cola", "folder:f", "bread"]);
  expect(el.api.moveCatalogueItems).not.toHaveBeenCalled();
});
it("a small pointer movement stays a click rather than lifting the row", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  const cell = await nameCell(el, "bread");
  const box = cell.getBoundingClientRect();
  pointerEvent(cell, "pointerdown");
  cell.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      composed: true,
      pointerId: 1,
      clientX: box.x + 9,
      clientY: box.y + 8,
    }),
  );
  expect(cell.closest("tr")!.part.contains("dragging")).toBe(false);
  pointerEvent(cell, "pointerup");
  expect(el.api.moveCatalogueItems).not.toHaveBeenCalled();
});
it("a cancelled pointer over a valid folder does not move the product", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  const from = await nameCell(el, "bread");
  const to = await nameCell(el, "folder:f");
  pointerEvent(from, "pointerdown");
  pointerEvent(to, "pointermove");
  expect(to.closest("tr")!.querySelector("td")!.part.contains("drop-target")).toBe(true);
  pointerEvent(to, "pointercancel");
  expect(el.api.moveCatalogueItems).not.toHaveBeenCalled();
});
it("a drag that ends on a category's row does not also open it", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  const table = await tableOf(el);
  const activator = table.shadowRoot!.querySelector<HTMLElement>(
    'tr[data-row-key="folder:d"] .row-activate',
  )!;
  const box = activator.getBoundingClientRect();
  pointerEvent(activator, "pointerdown");
  activator.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      composed: true,
      pointerId: 1,
      clientX: box.x + 25,
      clientY: box.y + 8,
    }),
  );
  pointerEvent(activator, "pointerup");
  activator.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
  );
  await table.updateComplete;
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "bread"]);
});
it("drags the whole selected group and clears selection after moving", async () => {
  const el = await mountBrowser();
  await selectKeys(el, ["bread", "folder:d"]);
  drag(await nameCell(el, "bread"), await nameCell(el, "folder:f"));
  await vi.waitFor(() => expect(count(el)).toBe("0 selected"));
  expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
    { productIds: ["bread"], categoryIds: ["d"] },
    "f",
  );
});
it("refuses a folder over itself or its descendants but highlights a sibling", async () => {
  const el = await mountBrowser({ categories: [...CATEGORIES, folder("s", "Soft drinks", null)] });
  await toggleCategory(el, "d");
  await press(el, "select");
  const from = await nameCell(el, "folder:d");
  pointerEvent(from, "pointerdown");
  for (const key of ["folder:d", "folder:b"]) {
    const target = await nameCell(el, key);
    pointerEvent(target, "pointermove");
    expect(target.closest("tr")!.querySelector("td")!.part.contains("drop-target")).toBe(false);
  }
  expect(el.api.moveCatalogueItems).not.toHaveBeenCalled();
  const sibling = await nameCell(el, "folder:s");
  pointerEvent(sibling, "pointermove");
  expect(sibling.closest("tr")!.querySelector("td")!.part.contains("drop-target")).toBe(true);
  pointerEvent(el.shadowRoot!.querySelector('[name="catalogue-search"]')!, "pointermove");
  expect(sibling.closest("tr")!.querySelector("td")!.part.contains("drop-target")).toBe(false);
  pointerEvent(from, "pointercancel");
  pointerEvent(sibling, "pointermove");
  expect(sibling.closest("tr")!.querySelector("td")!.part.contains("drop-target")).toBe(false);
});
it("moves a product to the top level by dropping it on All products", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  await toggleCategory(el, "d");
  const root = (await tableOf(el)).shadowRoot!;
  drag(
    await nameCell(el, "cola"),
    root.querySelector(`tr[data-row-key="${ROOT_KEY}"] [part~="folder-cell"]`)!,
  );
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["cola"], categoryIds: [] },
      null,
    ),
  );
});
it("shows a refused drop at the bottom and keeps the selection for correction", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.moveCatalogueItems).mockRejectedValue(
    Object.assign(new Error(), { code: "category.parent_cycle" }),
  );
  await selectKeys(el, ["bread"]);
  drag(await nameCell(el, "bread"), await nameCell(el, "folder:f"));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain(
      "Choose a parent outside",
    ),
  );
  expect(count(el)).toBe("1 selected");
  expect(el.shadowRoot!.lastElementChild!.getAttribute("role")).toBe("alert");
});
it("marks a dragged row inactive only while it is dragged, as its faded text is not read", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  const table = await tableOf(el);
  const cell = await nameCell(el, "bread");
  const row = cell.closest("tr")!;
  expect(row.hasAttribute("aria-disabled")).toBe(false);
  pointerEvent(cell, "pointerdown");
  pointerEvent(await nameCell(el, "folder:f"), "pointermove");
  expect(row.getAttribute("aria-disabled")).toBe("true");
  pointerEvent(cell, "pointercancel");
  await table.updateComplete;
  expect(row.hasAttribute("aria-disabled")).toBe(false);
});

it("opens a closed category after the hover delay, not before, and shows the gap where the product will land", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const el = await mountBrowser();
    await press(el, "select");
    const table = await tableOf(el);
    const cell = await nameCell(el, "bread");
    pointerEvent(cell, "pointerdown");
    pointerEvent(await nameCell(el, "folder:d"), "pointermove");
    vi.advanceTimersByTime(HOVER_OPEN_MS - 1);
    await table.updateComplete;
    expect(await rowKeys(el)).not.toContain("cola");
    vi.advanceTimersByTime(1);
    await table.updateComplete;
    expect(await rowKeys(el)).toContain("cola");
    expect(
      table
        .shadowRoot!.querySelector('tr[data-row-key="cola"] td')!
        .part.contains("drop-gap-before"),
    ).toBe(true);
    pointerEvent(cell, "pointercancel");
  } finally {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  }
});

it("leaves a closed category closed when a drag crosses it without stopping", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const el = await mountBrowser();
    await press(el, "select");
    const table = await tableOf(el);
    const cell = await nameCell(el, "bread");
    pointerEvent(cell, "pointerdown");
    pointerEvent(await nameCell(el, "folder:d"), "pointermove");
    vi.advanceTimersByTime(HOVER_OPEN_MS - 100);
    pointerEvent(await nameCell(el, "folder:f"), "pointermove");
    vi.advanceTimersByTime(200);
    await table.updateComplete;
    expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "bread"]);
    vi.advanceTimersByTime(HOVER_OPEN_MS);
    await table.updateComplete;
    expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "burger", "bread"]);
    pointerEvent(cell, "pointercancel");
  } finally {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  }
});

it("dropping on a product files the dragged row into that product's category", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  await toggleCategory(el, "d");
  drag(await nameCell(el, "bread"), await nameCell(el, "cola"));
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["bread"], categoryIds: [] },
      "d",
    ),
  );
});

it("shows the gap after the last row when the dragged row would land last", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  await toggleCategory(el, "d");
  const table = await tableOf(el);
  const cell = await nameCell(el, "cola");
  pointerEvent(cell, "pointerdown");
  pointerEvent(
    table.shadowRoot!.querySelector(`tr[data-row-key="${ROOT_KEY}"] [part~="folder-cell"]`)!,
    "pointermove",
  );
  const last = table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="bread"] td')!;
  expect(last.part.contains("drop-gap-after")).toBe(true);
  expect(getComputedStyle(last).borderBottomStyle).toBe("dashed");
  pointerEvent(cell, "pointercancel");
});

it("Esc cancels a drag with nothing moved, and the click that ends it opens nothing", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  const table = await tableOf(el);
  const target = table.shadowRoot!.querySelector<HTMLElement>(
    'tr[data-row-key="folder:f"] .row-activate',
  )!;
  pointerEvent(await nameCell(el, "bread"), "pointerdown");
  pointerEvent(target, "pointermove");
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  expect(
    table.shadowRoot!.querySelector('tr[data-row-key="bread"]')!.part.contains("dragging"),
  ).toBe(false);
  // A person lets go of the button a moment after Esc, never within the same task.
  await new Promise((resolve) => setTimeout(resolve, 0));
  pointerEvent(target, "pointerup");
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
  );
  await table.updateComplete;
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "bread"]);
  expect(el.api.moveCatalogueItems).not.toHaveBeenCalled();
});

it("a drop where the drag started moves nothing and is never marked", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  const table = await tableOf(el);
  const cell = await nameCell(el, "bread");
  pointerEvent(cell, "pointerdown");
  pointerEvent(await nameCell(el, "folder:f"), "pointermove");
  pointerEvent(cell, "pointermove");
  expect(table.shadowRoot!.querySelector('[part~="drop-target"]')).toBeNull();
  pointerEvent(cell, "pointerup");
  expect(el.api.moveCatalogueItems).not.toHaveBeenCalled();
});

it("a drop on the category the dragged row is already in moves nothing and is never marked", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  await toggleCategory(el, "d");
  const list = el.shadowRoot!.querySelector("dashboard-product-list")!;
  const drops = vi.fn();
  list.addEventListener("drop-items", drops);
  const table = await tableOf(el);
  pointerEvent(await nameCell(el, "cola"), "pointerdown");
  pointerEvent(await nameCell(el, "folder:d"), "pointermove");
  await list.updateComplete;
  expect(table.shadowRoot!.querySelector('[part~="drop-target"]')).toBeNull();
  pointerEvent(await nameCell(el, "folder:d"), "pointerup");
  await el.updateComplete;
  expect(drops).not.toHaveBeenCalled();
  expect(el.api.moveCatalogueItems).not.toHaveBeenCalled();
});

it("in Select mode, dragging a selected row moves every selected row, from two categories, in one drop", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  await toggleCategory(el, "f");
  await selectKeys(el, ["cola", "burger"]);
  const list = el.shadowRoot!.querySelector("dashboard-product-list")!;
  const table = await tableOf(el);
  pointerEvent(await nameCell(el, "cola"), "pointerdown");
  pointerEvent(await nameCell(el, "folder:b"), "pointermove");
  await list.updateComplete;
  for (const key of ["cola", "burger"])
    expect(
      table.shadowRoot!.querySelector(`tr[data-row-key="${key}"]`)!.part.contains("dragging"),
      key,
    ).toBe(true);
  expect(list.shadowRoot!.querySelector('[data-test="drag-ghost"]')!.textContent!.trim()).toBe(
    "2 items",
  );
  pointerEvent(await nameCell(el, "folder:b"), "pointerup");
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["cola", "burger"], categoryIds: [] },
      "b",
    ),
  );
  await vi.waitFor(() => expect(count(el)).toBe("0 selected"));
});

it("in Select mode, a drop where the drag started moves nothing, even with rows selected from two categories", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  await toggleCategory(el, "f");
  await selectKeys(el, ["cola", "burger"]);
  const list = el.shadowRoot!.querySelector("dashboard-product-list")!;
  const drops = vi.fn();
  list.addEventListener("drop-items", drops);
  const table = await tableOf(el);
  const cell = await nameCell(el, "cola");
  pointerEvent(cell, "pointerdown");
  pointerEvent(await nameCell(el, "folder:b"), "pointermove");
  pointerEvent(cell, "pointermove");
  await list.updateComplete;
  expect(table.shadowRoot!.querySelector('[part~="drop-target"]')).toBeNull();
  pointerEvent(cell, "pointerup");
  await el.updateComplete;
  expect(drops).not.toHaveBeenCalled();
  expect(el.api.moveCatalogueItems).not.toHaveBeenCalled();
});

it("no dragged row stays marked inactive after a drop that moves, Esc, or a drop where the drag started", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  await toggleCategory(el, "f");
  await selectKeys(el, ["cola", "burger"]);
  const list = el.shadowRoot!.querySelector("dashboard-product-list")!;
  const table = await tableOf(el);
  const inactive = () =>
    [...table.shadowRoot!.querySelectorAll<HTMLElement>("tr[aria-disabled]")].map(
      (row) => row.dataset.rowKey,
    );
  const lift = async () => {
    pointerEvent(await nameCell(el, "cola"), "pointerdown");
    pointerEvent(await nameCell(el, "folder:b"), "pointermove");
    await list.updateComplete;
    await table.updateComplete;
    await vi.waitFor(() => expect(inactive()).toEqual(["cola", "burger"]));
  };

  await lift();
  pointerEvent(await nameCell(el, "cola"), "pointermove");
  pointerEvent(await nameCell(el, "cola"), "pointerup");
  await table.updateComplete;
  expect(inactive(), "after a drop where the drag started").toEqual([]);

  await lift();
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await table.updateComplete;
  expect(inactive(), "after Esc").toEqual([]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  pointerEvent(await nameCell(el, "cola"), "pointerup");

  await lift();
  pointerEvent(await nameCell(el, "folder:b"), "pointerup");
  await vi.waitFor(() => expect(el.api.moveCatalogueItems).toHaveBeenCalledOnce());
  await table.updateComplete;
  expect(inactive(), "after a drop that moves").toEqual([]);
});

it("a selection holding a category and a product inside it moves the category alone, and the product goes with it", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  await selectKeys(el, ["folder:d", "cola"]);
  drag(await nameCell(el, "cola"), await nameCell(el, "folder:f"));
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: [], categoryIds: ["d"] },
      "f",
    ),
  );
});

it("Move to… with a category and something inside it selected sends the category alone", async () => {
  const el = await mountBrowser({ products: [...PRODUCTS, product("stout", "Stout", "b")] });
  await toggleCategory(el, "d");
  await toggleCategory(el, "b");
  await selectKeys(el, ["folder:d", "folder:b", "cola", "stout", "bread"]);
  await press(el, "move");
  expect(dialog(el)!.heading).toBe("Move 2 items");
  await destination(el, "f");
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["bread"], categoryIds: ["d"] },
      "f",
    ),
  );
});

it("dragging a row that is not selected moves only that row and keeps the selection", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  await selectKeys(el, ["cola"]);
  drag(await nameCell(el, "bread"), await nameCell(el, "folder:f"));
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["bread"], categoryIds: [] },
      "f",
    ),
  );
  await el.updateComplete;
  expect(count(el)).toBe("1 selected");
});
export async function typeSearch(el: CatalogueBrowser, value: string) {
  el.shadowRoot!.querySelector('[name="catalogue-search"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
/** A list is every value ticked in a multi-select filter; a string is a single-choice filter's. */
export async function chooseFilter(el: CatalogueBrowser, column: string, value: string | string[]) {
  const table = await tableOf(el);
  const select = table.shadowRoot!.querySelector<HTMLElement>(
    `wt-combobox[data-filter="${column}"]`,
  )!;
  if (typeof value === "string") await chooseOption(select, value);
  else await chooseOptions(select, value);
  await table.updateComplete;
}
/** Turns the Products list's Show archived switch on. */
export async function showArchived(el: CatalogueBrowser) {
  const list = el.shadowRoot!.querySelector("dashboard-product-list")!;
  const toggle = list.shadowRoot!.querySelector<HTMLElement>('wt-switch[name="show-archived"]')!;
  toggle.shadowRoot!.querySelector<HTMLInputElement>("input")!.click();
  await list.updateComplete;
  await (
    await tableOf(el)
  ).updateComplete;
  await el.updateComplete;
}
it("shows top-level folders before unfiled products", async () => {
  expect(await rowKeys(await mountBrowser())).toEqual(["folder:d", "folder:f", "bread"]);
});
it("nests each category's subcategories, then its products, under it once it is opened, and draws no breadcrumb", async () => {
  const el = await mountBrowser();
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "bread"]);
  await toggleCategory(el, "d");
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:b", "cola", "folder:f", "bread"]);
  const table = await tableOf(el);
  const level = (key: string) =>
    table.shadowRoot!.querySelector(`tr[data-row-key="${key}"]`)!.getAttribute("aria-level");
  expect([ROOT_KEY, "folder:d", "folder:b", "cola", "bread"].map(level)).toEqual([
    "1",
    "2",
    "3",
    "3",
    "2",
  ]);
  expect(el.shadowRoot!.querySelector("nav")).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-test="view-all"]')).toBeNull();
});
it("keeps every category through both product filters", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  await chooseFilter(el, "modifiers", "has");
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:b", "folder:f"]);
  await chooseFilter(el, "ordering", ["staff_only"]);
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:b", "folder:f"]);
});
it("sorts a numbered folder before products", async () => {
  expect(
    await rowKeys(await mountBrowser({ categories: [...CATEGORIES, folder("s", "5 Star", null)] })),
  ).toEqual(["folder:s", "folder:d", "folder:f", "bread"]);
});
it("opens nothing when the address names a category that does not exist", async () => {
  const el = await mountBrowser({ categoryId: "gone" });
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "bread"]);
});

it("opens the category the address names, and every category above it, and scrolls it into view", async () => {
  const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
  onTestFinished(() => scrolled.mockRestore());
  const el = await mountBrowser({
    products: [...PRODUCTS, product("stout", "Stout", "b")],
    categoryId: "b",
  });
  await vi.waitFor(async () =>
    expect(await rowKeys(el)).toEqual([
      "folder:d",
      "folder:b",
      "stout",
      "cola",
      "folder:f",
      "bread",
    ]),
  );
  expect(scrolled.mock.contexts.at(-1)).toBe(
    (await tableOf(el)).shadowRoot!.querySelector('tr[data-row-key="folder:b"]'),
  );
});

it("writes the category a person opens into the address, and its parent when they close it", async () => {
  const el = await mountBrowser({ products: [...PRODUCTS, product("stout", "Stout", "b")] });
  const sent: unknown[] = [];
  el.addEventListener("open-category", (event) => sent.push((event as CustomEvent).detail));
  await toggleCategory(el, "d");
  el.categoryId = "d";
  await toggleCategory(el, "b");
  el.categoryId = "b";
  await toggleCategory(el, "f");
  el.categoryId = "f";
  await toggleCategory(el, "b");
  await toggleCategory(el, "f");
  expect(sent).toEqual([
    { categoryId: "d" },
    { categoryId: "b" },
    { categoryId: "f" },
    { categoryId: null },
  ]);
});
it("A461 flat search shows a category path and clearing it restores what was open", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "f");
  await typeSearch(el, "COL");
  expect(await rowKeys(el)).toEqual(["cola"]);
  expect((await tableOf(el)).shadowRoot!.querySelector('[part="search-path"]')!.textContent).toBe(
    "Drinks",
  );
  await typeSearch(el, "");
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "burger", "bread"]);
});
it("searches a folder's own name and a product's variant names, never a product's folder", async () => {
  const el = await mountBrowser({
    products: [
      ...PRODUCTS,
      {
        ...PRODUCTS[0]!,
        id: "with-variants",
        name: "Coffee",
        variants: [
          {
            id: "v",
            name: "Large cup",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: null,
            active: true,
            available: true,
            effective: { unitPrice: "2.00", vatClass: "reduced", primaryCategoryId: "d" },
          },
        ],
      },
    ],
  });
  await typeSearch(el, "drinks");
  expect(await rowKeys(el)).toEqual(["folder:d"]);
  await typeSearch(el, "drinks cola");
  expect(await rowKeys(el)).toEqual([]);
  await typeSearch(el, "cup");
  expect(await rowKeys(el)).toEqual(["with-variants"]);
});
it("opens and closes a category from its row, and says which it will do", async () => {
  const el = await mountBrowser();
  const table = await tableOf(el);
  const activator = () =>
    table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="folder:d"] .row-activate')!;
  expect(activator().getAttribute("aria-label")).toBe("Open Drinks");
  await toggleCategory(el, "d");
  expect(activator().getAttribute("aria-label")).toBe("Close Drinks");
  expect(await rowKeys(el)).toContain("cola");
  await toggleCategory(el, "d");
  expect(await rowKeys(el)).not.toContain("cola");
  expect(
    table.shadowRoot!.querySelector('tr[data-row-key="folder:d"] wt-icon[name="folder"]'),
  ).toBeNull();
});
it("Add category makes the typed category inside the category whose menu asked, and the box goes", async () => {
  const el = await mountBrowser();
  await menuAction(el, "add-category-d");
  await nameBox(el);
  expect(await rowKeys(el)).toEqual([
    "folder:d",
    "folder:b",
    "draft:new",
    "cola",
    "folder:f",
    "bread",
  ]);
  await userEvent.keyboard("Juice{Enter}");
  await vi.waitFor(() =>
    expect(el.api.createCategory).toHaveBeenCalledExactlyOnceWith({ name: "Juice", parentId: "d" }),
  );
  await vi.waitFor(async () => expect(await rowKeys(el)).not.toContain("draft:new"));
});
it("renames a top-level category in place without adopting the addressed one", async () => {
  const el = await mountBrowser({ categoryId: "b" });
  await menuAction(el, "rename-d");
  const box = await nameBox(el);
  expect(box.value).toBe("Drinks");
  await userEvent.keyboard("Beverages{Enter}");
  await vi.waitFor(() =>
    expect(el.api.updateCategory).toHaveBeenCalledWith("d", { name: "Beverages" }),
  );
});
it("a rename sends the name only, so renaming a category just dragged elsewhere keeps the move", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  await toggleCategory(el, "d");
  const target = await nameCell(el, "folder:f");
  drag(await nameCell(el, "folder:b"), target);
  // The click a released drag sends; the list swallows it, and would otherwise swallow the menu's.
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
  );
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: [], categoryIds: ["b"] },
      "f",
    ),
  );
  await menuAction(el, "rename-b");
  await nameBox(el);
  await userEvent.keyboard("Beer{Enter}");
  await vi.waitFor(() => expect(el.api.updateCategory).toHaveBeenCalledOnce());
  expect(vi.mocked(el.api.updateCategory).mock.calls).toEqual([["b", { name: "Beer" }]]);
});
it("keeps a refused name in its box with the refusal under it, and Enter tries again", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.createCategory).mockRejectedValueOnce({ code: "category.invalid" });
  await menuAction(el, "add-category-d");
  const box = await nameBox(el);
  await userEvent.keyboard("Juice{Enter}");
  await vi.waitFor(() => expect(box.error).toBe(codeMessage("category.invalid")));
  expect(await rowKeys(el)).toContain("draft:new");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(el.api.createCategory).toHaveBeenCalledTimes(2));
});

it.each([
  ["en-GB", "Another category in the same place already has this name."],
  ["es", "Otra categoría en el mismo lugar ya tiene este nombre."],
] as const)(
  "keeps a duplicate name in its rename box with the refusal under it (%s)",
  async (locale, message) => {
    setLocale(locale);
    const el = await mountBrowser();
    vi.mocked(el.api.updateCategory).mockRejectedValueOnce({
      code: "category.name_taken",
      params: { field: "name", name: "Food" },
      status: 409,
    });
    await menuAction(el, "rename-d");
    const box = await nameBox(el);
    await userEvent.keyboard("Food{Enter}");
    await vi.waitFor(() => expect(box.error).toBe(message));
    expect(box.value).toBe("Food");
    expect(await rowKeys(el)).toContain("folder:d");
  },
);
/** The category colour chooser, once it shows. */
async function colorChooser(el: CatalogueBrowser) {
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector("dashboard-category-color-form")!;
  await vi.waitFor(() => expect(form.open).toBe(true));
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return form;
}
function chooserCloseReported(el: CatalogueBrowser): Promise<unknown> {
  return dialogClosed(
    el
      .shadowRoot!.querySelector("dashboard-category-color-form")!
      .shadowRoot!.querySelector("wt-modal")!,
  );
}
function chooserClosed(el: CatalogueBrowser) {
  return !el.shadowRoot!.querySelector("dashboard-category-color-form")!.open;
}
async function choose(el: CatalogueBrowser, color: string) {
  (await colorChooser(el))
    .shadowRoot!.querySelector<HTMLElement>(`[data-color="${color}"]`)!
    .click();
  await el.updateComplete;
}
async function rowChip(el: CatalogueBrowser, id: string) {
  return (await tableOf(el)).shadowRoot!.querySelector<HTMLElement>(
    `[data-test="color-${id}"] [part~="color-swatch"]`,
  )!;
}
async function boxSquare(el: CatalogueBrowser) {
  return (await tableOf(el)).shadowRoot!.querySelector<HTMLElement>(
    '[data-test="name-box-color"]',
  )!;
}
async function boxChip(el: CatalogueBrowser) {
  return (await tableOf(el)).shadowRoot!.querySelector<HTMLElement>(
    '[data-test="name-box-color"] [part~="color-swatch"]',
  )!;
}

it.each([
  ["en-GB", "Colour of Drinks"],
  ["es", "Color de Drinks"],
] as const)(
  "opens a category's colour chooser from its row's square, and a swatch sends the colour alone (%s)",
  async (locale, heading) => {
    setLocale(locale);
    const el = await mountBrowser({
      categories: [{ ...folder("d", "Drinks", null), color: "#b12525" }, ...CATEGORIES.slice(1)],
    });
    let finish!: (value: CategorySummary) => void;
    vi.mocked(el.api.updateCategory).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    await menuAction(el, "color-d");
    const form = await colorChooser(el);
    expect(form.shadowRoot!.querySelector("wt-modal")!.heading).toBe(heading);
    expect(
      form.shadowRoot!.querySelector('[data-color="#b12525"]')!.getAttribute("aria-checked"),
    ).toBe("true");
    await choose(el, "#256bb1");
    expect(vi.mocked(el.api.updateCategory).mock.calls).toStrictEqual([
      ["d", { color: "#256bb1" }],
    ]);
    await form.updateComplete;
    expect(form.busy).toBe(true);
    expect(chooserClosed(el)).toBe(false);
    finish({ ...folder("d", "Drinks", null), color: "#256bb1" });
    await vi.waitFor(() => expect(chooserClosed(el)).toBe(true));
    el.categories = [{ ...folder("d", "Drinks", null), color: "#256bb1" }, ...CATEGORIES.slice(1)];
    await el.updateComplete;
    expect(getComputedStyle(await rowChip(el, "d")).backgroundColor).toBe("rgb(37, 107, 177)");
  },
);
it("sends a null colour when No colour is chosen from a row's square", async () => {
  const el = await mountBrowser({
    categories: [{ ...folder("d", "Drinks", null), color: "#b12525" }, ...CATEGORIES.slice(1)],
  });
  await menuAction(el, "color-d");
  await choose(el, "");
  await vi.waitFor(() => expect(chooserClosed(el)).toBe(true));
  expect(vi.mocked(el.api.updateCategory).mock.calls).toStrictEqual([["d", { color: null }]]);
});
it("keeps a refused colour in the chooser, under it, with the form's message at the end", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.updateCategory).mockRejectedValueOnce({
    code: "category.invalid",
    params: { field: "color" },
  });
  await menuAction(el, "color-f");
  await choose(el, "#256bb1");
  const form = await colorChooser(el);
  await vi.waitFor(() =>
    expect(form.shadowRoot!.querySelector("#category-color-error")!.textContent!.trim()).toBe(
      en["editor.field_rejected"],
    ),
  );
  expect(form.shadowRoot!.querySelector('[data-test="form-error"]')!.textContent!.trim()).toBe(
    en["form.fix_fields"],
  );
  expect(form.busy).toBe(false);
  expect(chooserClosed(el)).toBe(false);
});
it("sends nothing when a row's colour chooser is left with Esc or Cancel", async () => {
  const el = await mountBrowser();
  await menuAction(el, "color-d");
  await colorChooser(el);
  const closed = chooserCloseReported(el);
  await userEvent.keyboard("{Escape}");
  await closed;
  await vi.waitFor(() => expect(chooserClosed(el)).toBe(true));
  await menuAction(el, "color-d");
  (await colorChooser(el)).shadowRoot!.querySelector<HTMLElement>('[data-test="cancel"]')!.click();
  await vi.waitFor(() => expect(chooserClosed(el)).toBe(true));
  expect(el.api.updateCategory).not.toHaveBeenCalled();
});
it("opens an uncoloured category's chooser on No colour, not the colour it inherits, and sends nothing until one is chosen", async () => {
  const el = await mountBrowser({
    categories: [{ ...folder("d", "Drinks", null), color: "#b12525" }, ...CATEGORIES.slice(1)],
  });
  await toggleCategory(el, "d");
  expect((await rowChip(el, "b")).getAttribute("part")).toBe("color-swatch inherited");
  await menuAction(el, "color-b");
  const form = await colorChooser(el);
  const checked = (color: string) =>
    form.shadowRoot!.querySelector(`[data-color="${color}"]`)!.getAttribute("aria-checked");
  expect(checked("")).toBe("true");
  expect(checked("#b12525")).toBe("false");
  const closed = chooserCloseReported(el);
  await userEvent.keyboard("{Escape}");
  await closed;
  await vi.waitFor(() => expect(chooserClosed(el)).toBe(true));
  expect(el.api.updateCategory).not.toHaveBeenCalled();
  await menuAction(el, "color-b");
  await choose(el, "#256bb1");
  expect(vi.mocked(el.api.updateCategory).mock.calls).toStrictEqual([["b", { color: "#256bb1" }]]);
});
it.each([
  ["en-GB", "Colour of All products"],
  ["es", "Color de Todos los productos"],
] as const)(
  "opens the venue default's colour chooser from All products' square, and a swatch saves the default (%s)",
  async (locale, heading) => {
    setLocale(locale);
    const el = await mountBrowser({ defaultColor: "#b12525" });
    let finish!: (value: { defaultProductVatClass: "general"; defaultColor: string }) => void;
    vi.mocked(el.api.saveCatalogueDefaultColor).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    await menuAction(el, "color-root");
    const form = await colorChooser(el);
    expect(form.shadowRoot!.querySelector("wt-modal")!.heading).toBe(heading);
    expect(
      form.shadowRoot!.querySelector('[data-color="#b12525"]')!.getAttribute("aria-checked"),
    ).toBe("true");
    await choose(el, "#256bb1");
    await form.updateComplete;
    expect(form.busy).toBe(true);
    // A second choice while the first is in flight is not sent.
    form.dispatchEvent(new CustomEvent("wt-choose", { detail: { color: "#25b125" } }));
    await el.updateComplete;
    expect(vi.mocked(el.api.saveCatalogueDefaultColor).mock.calls).toStrictEqual([["#256bb1"]]);
    expect(chooserClosed(el)).toBe(false);
    finish({ defaultProductVatClass: "general", defaultColor: "#256bb1" });
    await vi.waitFor(() => expect(chooserClosed(el)).toBe(true));
    expect(el.api.updateCategory).not.toHaveBeenCalled();
  },
);
it("sends a null default when No colour is chosen from All products' square", async () => {
  const el = await mountBrowser({ defaultColor: "#b12525" });
  await menuAction(el, "color-root");
  await choose(el, "");
  await vi.waitFor(() => expect(chooserClosed(el)).toBe(true));
  expect(vi.mocked(el.api.saveCatalogueDefaultColor).mock.calls).toStrictEqual([[null]]);
});
it("keeps a refused default colour in the chooser, under it, with the form's message at the end", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.saveCatalogueDefaultColor).mockRejectedValueOnce({
    code: "category.invalid",
    params: { field: "color" },
  });
  await menuAction(el, "color-root");
  await choose(el, "#256bb1");
  const form = await colorChooser(el);
  await vi.waitFor(() =>
    expect(form.shadowRoot!.querySelector("#category-color-error")!.textContent!.trim()).toBe(
      en["editor.field_rejected"],
    ),
  );
  expect(form.shadowRoot!.querySelector('[data-test="form-error"]')!.textContent!.trim()).toBe(
    en["form.fix_fields"],
  );
  expect(form.busy).toBe(false);
  expect(chooserClosed(el)).toBe(false);
});
it("passes the venue default to the list, so All products' square shows it", async () => {
  const el = await mountBrowser({ defaultColor: "#b12525" });
  expect(getComputedStyle(await rowChip(el, "root")).backgroundColor).toBe("rgb(177, 37, 37)");
});
it("keeps a move made while a category's colour chooser is open: the colour goes alone", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  await menuAction(el, "color-b");
  await colorChooser(el);
  // A drag under the open modal reaches no row, so the list's own drop event stands in for one.
  el.shadowRoot!.querySelector("dashboard-product-list")!.dispatchEvent(
    new CustomEvent("drop-items", {
      detail: { keys: ["folder:b"], folderId: "f" },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: [], categoryIds: ["b"] },
      "f",
    ),
  );
  el.categories = [
    folder("d", "Drinks", null),
    folder("b", "Beer", "f"),
    folder("f", "Food", null),
  ];
  await choose(el, "#256bb1");
  await vi.waitFor(() => expect(el.api.updateCategory).toHaveBeenCalledOnce());
  expect(vi.mocked(el.api.updateCategory).mock.calls).toStrictEqual([["b", { color: "#256bb1" }]]);
});
it.each([
  ["en-GB", "New category's colour"],
  ["es", "Color de la categoría nueva"],
] as const)(
  "chooses a new category's colour from its box without saving, and Enter saves it with the name (%s)",
  async (locale, heading) => {
    setLocale(locale);
    const el = await mountBrowser();
    await menuAction(el, "add-category-d");
    const box = await nameBox(el);
    await userEvent.keyboard("Juice");
    await userEvent.click(await boxSquare(el));
    const form = await colorChooser(el);
    expect(form.shadowRoot!.querySelector("wt-modal")!.heading).toBe(heading);
    expect(form.shadowRoot!.querySelector('[data-color=""]')!.getAttribute("aria-checked")).toBe(
      "true",
    );
    await choose(el, "#256bb1");
    await vi.waitFor(() => expect(chooserClosed(el)).toBe(true));
    expect(await nameBox(el)).toBe(box);
    expect(box.value).toBe("Juice");
    expect(getComputedStyle(await boxChip(el)).backgroundColor).toBe("rgb(37, 107, 177)");
    expect(el.api.createCategory).not.toHaveBeenCalled();
    expect(el.api.updateCategory).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(el.api.createCategory).toHaveBeenCalledOnce());
    expect(vi.mocked(el.api.createCategory).mock.calls).toStrictEqual([
      [{ name: "Juice", parentId: "d", color: "#256bb1" }],
    ]);
  },
);
it("hands the cursor back to a new category's box, its name kept, when its colour chooser is cancelled", async () => {
  const el = await mountBrowser();
  await menuAction(el, "add-category-d");
  const box = await nameBox(el);
  await userEvent.keyboard("Juice");
  await userEvent.click(await boxSquare(el));
  await colorChooser(el);
  const closed = chooserCloseReported(el);
  await userEvent.keyboard("{Escape}");
  await closed;
  await vi.waitFor(() => expect(chooserClosed(el)).toBe(true));
  expect(await nameBox(el)).toBe(box);
  expect(box.value).toBe("Juice");
  expect((await boxChip(el)).getAttribute("part")).toBe("color-swatch empty");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(el.api.createCategory).toHaveBeenCalledOnce());
  expect(vi.mocked(el.api.createCategory).mock.calls).toStrictEqual([
    [{ name: "Juice", parentId: "d" }],
  ]);
});
it("opens no colour chooser from a box whose name is already saving", async () => {
  const el = await mountBrowser();
  let finish!: (value: CategorySummary) => void;
  vi.mocked(el.api.createCategory).mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  );
  await menuAction(el, "add-category-d");
  await nameBox(el);
  await userEvent.keyboard("Juice{Enter}");
  await userEvent.click(await boxSquare(el));
  await el.updateComplete;
  expect(chooserClosed(el)).toBe(true);
  finish(folder("j", "Juice", "d"));
  await vi.waitFor(async () => expect(await rowKeys(el)).not.toContain("draft:new"));
  expect(vi.mocked(el.api.createCategory).mock.calls).toStrictEqual([
    [{ name: "Juice", parentId: "d" }],
  ]);
  expect(el.api.updateCategory).not.toHaveBeenCalled();
});
it("drops a colour chosen in a box that is then left with Esc", async () => {
  const el = await mountBrowser();
  await menuAction(el, "add-category-d");
  await nameBox(el);
  await userEvent.click(await boxSquare(el));
  await choose(el, "#256bb1");
  await vi.waitFor(() => expect(chooserClosed(el)).toBe(true));
  await nameBox(el);
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(async () => expect(await rowKeys(el)).not.toContain("draft:new"));
  await menuAction(el, "add-category-d");
  await nameBox(el);
  expect((await boxChip(el)).getAttribute("part")).toBe("color-swatch empty");
  await userEvent.keyboard("Juice{Enter}");
  await vi.waitFor(() => expect(el.api.createCategory).toHaveBeenCalledOnce());
  expect(vi.mocked(el.api.createCategory).mock.calls).toStrictEqual([
    [{ name: "Juice", parentId: "d" }],
  ]);
});
it("sends a rename's colour with its name only when the box changed it", async () => {
  const el = await mountBrowser({
    categories: [{ ...folder("d", "Drinks", null), color: "#b12525" }, ...CATEGORIES.slice(1)],
  });
  await menuAction(el, "rename-d");
  await nameBox(el);
  expect(getComputedStyle(await boxChip(el)).backgroundColor).toBe("rgb(177, 37, 37)");
  await userEvent.click(await boxSquare(el));
  const form = await colorChooser(el);
  expect(form.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Colour of Drinks");
  await choose(el, "#256bb1");
  await vi.waitFor(() => expect(chooserClosed(el)).toBe(true));
  await nameBox(el);
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(el.api.updateCategory).toHaveBeenCalledOnce());
  await vi.waitFor(async () => expect(await rowKeys(el)).toContain("folder:d"));
  await menuAction(el, "rename-d");
  await nameBox(el);
  await userEvent.click(await boxSquare(el));
  await choose(el, "#b12525");
  await vi.waitFor(() => expect(chooserClosed(el)).toBe(true));
  await nameBox(el);
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(el.api.updateCategory).toHaveBeenCalledTimes(2));
  expect(vi.mocked(el.api.updateCategory).mock.calls).toStrictEqual([
    ["d", { name: "Drinks", color: "#256bb1" }],
    ["d", { name: "Drinks" }],
  ]);
});
it("Add category on All products makes a top-level category", async () => {
  const el = await mountBrowser({ categoryId: "gone" });
  await menuAction(el, "add-category-root");
  await nameBox(el);
  await userEvent.keyboard("Juice{Enter}");
  await vi.waitFor(() =>
    expect(el.api.createCategory).toHaveBeenCalledExactlyOnceWith({
      name: "Juice",
      parentId: null,
    }),
  );
});

it("shows no main category column, and leaves a category row's other cells empty", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  const table = await tableOf(el);
  expect(table.shadowRoot!.querySelector('input[name="search"]')).toBeNull();
  expect(table.columns.some((column) => column.key === "reporting-category")).toBe(false);
  const row = table.shadowRoot!.querySelector('tr[data-row-key="folder:b"]')!;
  expect(
    [...row.querySelectorAll("td")].slice(1, -1).every((cell) => cell.textContent!.trim() === ""),
  ).toBe(true);
});
it("keeps a variant match on its parent until the manager expands it", async () => {
  const el = await mountBrowser({
    products: [
      {
        ...PRODUCTS[0]!,
        id: "coffee",
        name: "Coffee",
        variants: [
          {
            id: "large",
            name: "Large cup",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: null,
            active: true,
            available: true,
            effective: { unitPrice: "2.00", vatClass: "reduced", primaryCategoryId: "d" },
          },
        ],
      },
    ],
  });
  await typeSearch(el, "cup");
  expect(await rowKeys(el)).toEqual(["coffee"]);
  const table = await tableOf(el);
  table.shadowRoot!.querySelector<HTMLElement>(".tree-toggle")!.click();
  await table.updateComplete;
  expect(await rowKeys(el)).toEqual(["coffee", "coffee:large"]);
});

it.each(["en-GB", "es-ES"])(
  "keeps the search field usable at phone width in %s",
  async (locale) => {
    const { page } = await import("vitest/browser");
    await page.viewport(390, 640);
    setLocale(locale);
    try {
      const el = await mountBrowser();
      setLocale(locale);
      el.requestUpdate();
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector('[name="catalogue-search"]')!.getBoundingClientRect().width,
      ).toBeGreaterThanOrEqual(el.getBoundingClientRect().width * 0.9);
    } finally {
      await page.viewport(1280, 720);
      setLocale("en-GB");
    }
  },
);

export async function press(el: CatalogueBrowser, action: string) {
  const button = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${action}"]`);
  expect(button, action).not.toBeNull();
  button!.click();
  await el.updateComplete;
}
export async function selectKeys(el: CatalogueBrowser, keys: string[]) {
  await press(el, "select");
  for (const key of keys) {
    const checkbox = (await tableOf(el)).shadowRoot!.querySelector<HTMLInputElement>(
      `tr[data-row-key="${key}"] input[type="checkbox"]`,
    );
    expect(checkbox, key).not.toBeNull();
    checkbox!.click();
    await el.updateComplete;
  }
}
export const dialog = (el: CatalogueBrowser) => el.shadowRoot!.querySelector("wt-modal");
const count = (el: CatalogueBrowser) =>
  el.shadowRoot!.querySelector('[data-test="selected-count"]')?.textContent?.trim();
export async function destination(el: CatalogueBrowser, value: string) {
  el.shadowRoot!.querySelector("wt-combobox")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
  await el.updateComplete;
}
it("selects folders and products but never variants", async () => {
  const el = await mountBrowser({
    products: [
      {
        ...PRODUCTS[0]!,
        variants: [
          {
            id: "v",
            name: "Large",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: null,
            active: true,
            available: true,
            effective: { unitPrice: "2.00", vatClass: "reduced", primaryCategoryId: "d" },
          },
        ],
      },
    ],
  });
  await toggleCategory(el, "d");
  await selectKeys(el, ["folder:b", "cola"]);
  const table = await tableOf(el);
  table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="cola"] .tree-toggle')?.click();
  await table.updateComplete;
  expect(table.shadowRoot!.querySelector('tr[data-row-key="cola:v"]')).not.toBeNull();
  expect(
    table.shadowRoot!.querySelector('tr[data-row-key="cola:v"] input[type="checkbox"]'),
  ).toBeNull();
  expect(count(el)).toBe("2 selected");
});
it("leaves selection mode on Done and restores the ordinary toolbar with no selected keys", async () => {
  const el = await mountBrowser();
  await selectKeys(el, ["bread"]);
  await press(el, "cancel-selection");
  expect((await tableOf(el)).selectable).toBe(false);
  expect(count(el)).toBeUndefined();
  for (const action of ["select"])
    expect(el.shadowRoot!.querySelector(`[data-test="${action}"]`), action).not.toBeNull();
  await press(el, "select");
  expect(count(el)).toBe("0 selected");
  expect(
    (await tableOf(el)).shadowRoot!.querySelector<HTMLInputElement>(
      'tr[data-row-key="bread"] input[type="checkbox"]',
    )!.checked,
  ).toBe(false);
});
async function tableSentence(el: CatalogueBrowser) {
  return (await tableOf(el)).shadowRoot!.querySelector(".empty .message")!.textContent;
}
it.each(["en-GB", "es"])(
  "says the dashboard's one no-matches sentence when its search finds nothing (%s)",
  async (locale) => {
    setLocale(locale);
    const el = await mountBrowser({ products: [] });
    await typeSearch(el, "nothing like this");
    expect(await rowKeys(el)).toEqual([]);
    expect(await tableSentence(el)).toBe(tableNoMatches(locale));
    await typeSearch(el, "");
    expect((await tableOf(el)).shadowRoot!.querySelector(".empty")).toBeNull();
  },
);
it("keeps the All products row and every category when a column filter hides every product", async () => {
  setLocale("es");
  const el = await mountBrowser();
  await chooseFilter(el, "modifiers", "has");
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:f"]);
  expect(
    (await tableOf(el)).shadowRoot!.querySelector(`tr[data-row-key="${ROOT_KEY}"]`),
  ).not.toBeNull();
  expect((await tableOf(el)).shadowRoot!.querySelector(".empty")).toBeNull();
});
it.each(["search", "filter", "show archived"])(
  "A461 keeps ticks on %s and keeps selection mode on",
  async (trigger) => {
    const el = await mountBrowser();
    await selectKeys(el, ["bread"]);
    if (trigger === "search") await typeSearch(el, "bread");
    if (trigger === "filter") await chooseFilter(el, "modifiers", "has");
    if (trigger === "show archived") await showArchived(el);
    await el.updateComplete;
    expect(count(el)).toBe("1 selected");
    expect((await tableOf(el)).selectable).toBe(true);
    expect(el.shadowRoot!.querySelector("[data-test=move]")!.getAttribute("disabled")).toBeNull();
  },
);
it("requires a move destination, excludes selected folders and descendants, and clears after success", async () => {
  const el = await mountBrowser();
  await selectKeys(el, ["folder:d", "bread"]);
  await press(el, "move");
  const combo = el.shadowRoot!.querySelector("wt-combobox")!;
  expect(combo.required).toBe(true);
  expect(combo.value).toBe("");
  expect(combo.options).toEqual([
    { value: "top", label: "No category" },
    { value: "f", label: "Food", depth: 0, valueLabel: "Food" },
  ]);
  expect(
    el.shadowRoot!.querySelector("[data-test=confirm]")!.getAttribute("disabled"),
  ).not.toBeNull();
  await destination(el, "f");
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledWith(
      { productIds: ["bread"], categoryIds: ["d"] },
      "f",
    ),
  );
  await vi.waitFor(() => expect(dialog(el)).toBeNull());
  expect(count(el)).toBe("0 selected");
});
it.each(["light", "dark"])(
  "draws Move quiet like Cancel while it waits for a destination, then blue (%s theme)",
  async (theme) => {
    const el = await mountBrowser();
    el.parentElement!.setAttribute("data-theme", theme);
    await selectKeys(el, ["bread"]);
    await press(el, "move");
    const confirm =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm]")!;
    const fill = (host: Element) =>
      getComputedStyle(host.shadowRoot!.querySelector("button")!).backgroundColor;
    const cancelFill = fill(el.shadowRoot!.querySelector("wt-button[slot=cancel]")!);
    expect(confirm.getAttribute("disabled")).not.toBeNull();
    expect(confirm.variant).toBe("secondary");
    expect(fill(confirm)).toBe(cancelFill);
    await destination(el, "f");
    await confirm.updateComplete;
    expect(confirm.getAttribute("disabled")).toBeNull();
    expect(confirm.variant).toBe("primary");
    expect(fill(confirm)).not.toBe(cancelFill);
  },
);
it.each([
  ["Move", "move", "primary"],
  ["Delete", "delete", "danger"],
] as const)(
  "keeps %s coloured while the request it sent is in progress",
  async (_name, operation, variant) => {
    const el = await mountBrowser();
    let finish!: () => void;
    vi.mocked(
      operation === "move" ? el.api.moveCatalogueItems : el.api.deleteCatalogueItems,
    ).mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    await selectKeys(el, ["folder:d"]);
    await press(el, operation);
    if (operation === "move") await destination(el, "f");
    else
      await vi.waitFor(() =>
        expect(el.shadowRoot!.textContent).toContain("1 category and 2 products"),
      );
    await press(el, "confirm");
    const confirm =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm]")!;
    await vi.waitFor(() => expect(confirm.loading).toBe(true));
    await vi.waitFor(() =>
      expect(
        operation === "move" ? el.api.moveCatalogueItems : el.api.deleteCatalogueItems,
      ).toHaveBeenCalled(),
    );
    expect(confirm.variant).toBe(variant);
    finish();
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
  },
);
it("draws Delete quiet while its summary loads, then red", async () => {
  const el = await mountBrowser();
  let resolve!: (
    value: {
      id: string;
      folders: number;
      products: number;
      activeProducts: number;
      routes: number;
      ownRoutes: number;
    }[],
  ) => void;
  vi.mocked(el.api.summariseFolders).mockReturnValueOnce(new Promise((r) => (resolve = r)));
  await selectKeys(el, ["bread", "folder:d"]);
  await press(el, "delete");
  const confirm =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm]")!;
  expect(confirm.getAttribute("disabled")).not.toBeNull();
  expect(confirm.variant).toBe("secondary");
  resolve([{ id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 }]);
  await vi.waitFor(() => expect(confirm.getAttribute("disabled")).toBeNull());
  expect(confirm.variant).toBe("danger");
});
const toolbarButton = (el: CatalogueBrowser, test: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test="${test}"]`)!;
const buttonFill = (host: Element) =>
  getComputedStyle(host.shadowRoot!.querySelector("button")!).backgroundColor;
it.each(["light", "dark"])(
  "draws the toolbar Delete quiet like Done while nothing is selected, then red (%s theme)",
  async (theme) => {
    const el = await mountBrowser();
    el.parentElement!.setAttribute("data-theme", theme);
    await press(el, "select");
    const remove = toolbarButton(el, "delete");
    const doneFill = buttonFill(toolbarButton(el, "cancel-selection"));
    expect(remove.getAttribute("disabled")).not.toBeNull();
    expect(remove.variant).toBe("secondary");
    expect(buttonFill(remove)).toBe(doneFill);
    (await tableOf(el))
      .shadowRoot!.querySelector<HTMLInputElement>(
        'tr[data-row-key="bread"] input[type="checkbox"]',
      )!
      .click();
    await el.updateComplete;
    await remove.updateComplete;
    expect(remove.getAttribute("disabled")).toBeNull();
    expect(remove.variant).toBe("danger");
    expect(buttonFill(remove)).not.toBe(doneFill);
  },
);
it("draws the toolbar Delete quiet while the summary it asked for loads, then red", async () => {
  const el = await mountBrowser();
  let resolve!: (value: Awaited<ReturnType<DashboardApi["summariseFolders"]>>) => void;
  vi.mocked(el.api.summariseFolders).mockReturnValueOnce(new Promise((r) => (resolve = r)));
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  const remove = toolbarButton(el, "delete");
  await remove.updateComplete;
  expect(remove.getAttribute("disabled")).not.toBeNull();
  expect(remove.variant).toBe("secondary");
  resolve([{ id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 }]);
  await vi.waitFor(() => expect(remove.getAttribute("disabled")).toBeNull());
  expect(remove.variant).toBe("danger");
});
it("keeps the toolbar Delete red while the delete it started is being sent", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "f", folders: 0, products: 0, activeProducts: 0, routes: 0, ownRoutes: 0 },
  ]);
  let finish!: () => void;
  vi.mocked(el.api.deleteCatalogueItems).mockReturnValueOnce(
    new Promise<void>((resolve) => (finish = resolve)),
  );
  await selectKeys(el, ["folder:f"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(el.api.deleteCatalogueItems).toHaveBeenCalled());
  const remove = toolbarButton(el, "delete");
  await remove.updateComplete;
  expect(remove.getAttribute("disabled")).not.toBeNull();
  expect(remove.variant).toBe("danger");
  finish();
  await vi.waitFor(() => expect(toolbarButton(el, "delete").variant).toBe("secondary"));
  expect(dialog(el)).toBeNull();
});
it("shows a move refused for a duplicate name in the move dialog, keeping the choice", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.moveCatalogueItems).mockRejectedValueOnce({
    code: "category.name_taken",
    params: { field: "name", name: "Beer" },
    status: 409,
  });
  await selectKeys(el, ["folder:f"]);
  await press(el, "move");
  await destination(el, "d");
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(dialog(el)!.querySelector('[role="alert"]')!.textContent).toBe(
      "Another category in the same place already has this name.",
    ),
  );
  expect(el.shadowRoot!.querySelector("wt-combobox")!.value).toBe("d");
  expect(count(el)).toBe("1 selected");
});
it("shows a delete refused because a moved-up category's name is taken in the delete dialog", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.deleteCatalogueItems).mockRejectedValueOnce({
    code: "category.name_taken",
    params: { field: "name", name: "Food" },
    status: 409,
  });
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("1 category and 2 products"));
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(dialog(el)!.querySelector('[role="alert"]')!.textContent).toBe(
      "Another category in the same place already has this name.",
    ),
  );
});
it("lists move destinations as the category tree, each level in label order, after No category, leaving out the moved subtree", async () => {
  const el = await mountBrowser({
    categories: [
      folder("s", "Starters", null),
      folder("dm", "Mains", "dn"),
      folder("lm", "Mains", "l"),
      folder("m10", "Menu 10", null),
      folder("x", "Specials", null),
      folder("xc", "Chef", "x"),
      folder("l", "Lunch", null),
      folder("dn", "Dinner", null),
      folder("m2", "Menu 2", null),
      folder("ds", "desserts", null),
      folder("ac", "Accompaniments", null),
      folder("mo", "Menu (old)", null),
      folder("mz", "Zeta", "m"),
      folder("ma", "alpha", "m"),
      folder("m", "Menu", null),
    ],
  });
  await selectKeys(el, ["folder:x"]);
  await press(el, "move");
  expect(el.shadowRoot!.querySelector("wt-combobox")!.options).toEqual([
    { value: "top", label: "No category" },
    { value: "ac", label: "Accompaniments", depth: 0, valueLabel: "Accompaniments" },
    { value: "ds", label: "desserts", depth: 0, valueLabel: "desserts" },
    { value: "dn", label: "Dinner", depth: 0, valueLabel: "Dinner" },
    { value: "dm", label: "Mains", depth: 1, valueLabel: "Dinner › Mains" },
    { value: "l", label: "Lunch", depth: 0, valueLabel: "Lunch" },
    { value: "lm", label: "Mains", depth: 1, valueLabel: "Lunch › Mains" },
    { value: "m", label: "Menu", depth: 0, valueLabel: "Menu" },
    { value: "ma", label: "alpha", depth: 1, valueLabel: "Menu › alpha" },
    { value: "mz", label: "Zeta", depth: 1, valueLabel: "Menu › Zeta" },
    { value: "mo", label: "Menu (old)", depth: 0, valueLabel: "Menu (old)" },
    { value: "m2", label: "Menu 2", depth: 0, valueLabel: "Menu 2" },
    { value: "m10", label: "Menu 10", depth: 0, valueLabel: "Menu 10" },
    { value: "s", label: "Starters", depth: 0, valueLabel: "Starters" },
  ]);
});
it("leaves out a moved category nested below the top level, and everything under it", async () => {
  const el = await mountBrowser({
    categories: [
      folder("f", "Food", null),
      folder("m", "Mains", "f"),
      folder("g", "Grill", "m"),
      folder("s", "Starters", "f"),
    ],
  });
  await toggleCategory(el, "f");
  await selectKeys(el, ["folder:m"]);
  await press(el, "move");
  expect(el.shadowRoot!.querySelector("wt-combobox")!.options).toEqual([
    { value: "top", label: "No category" },
    { value: "f", label: "Food", depth: 0, valueLabel: "Food" },
    { value: "s", label: "Starters", depth: 1, valueLabel: "Food › Starters" },
  ]);
});
it.each([
  ["en-GB", "No category"],
  ["es", "Sin categoría"],
] as const)(
  "offers No category as the first move destination, in the session's language (%s)",
  async (locale, label) => {
    setLocale(locale);
    const el = await mountBrowser();
    await selectKeys(el, ["bread"]);
    await press(el, "move");
    const combo = el.shadowRoot!.querySelector("wt-combobox")!;
    expect(combo.options[0]).toEqual({ value: "top", label });
    await userEvent.click(combo.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    await combo.updateComplete;
    const firstRow = combo.shadowRoot!.querySelector<HTMLElement>('[role="option"]')!;
    expect(firstRow.textContent!.trim()).toBe(label);
  },
);
it.each([
  ["en-GB", "Search", "No results"],
  ["es", "Buscar", "Sin resultados"],
] as const)(
  "searches move destinations by full path, in the session's language (%s)",
  async (locale, placeholder, noResults) => {
    setLocale(locale);
    const el = await mountBrowser({
      categories: [
        folder("dn", "Dinner", null),
        folder("dm", "Mains", "dn"),
        folder("l", "Lunch", null),
        folder("lm", "Mains", "l"),
      ],
    });
    await selectKeys(el, ["bread"]);
    await press(el, "move");
    const combo = el.shadowRoot!.querySelector("wt-combobox")!;
    await userEvent.click(combo.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    const search = combo.shadowRoot!.querySelector<HTMLInputElement>("input.search")!;
    expect(search.placeholder).toBe(placeholder);
    await userEvent.fill(search, "dinner");
    await combo.updateComplete;
    const rows = () =>
      [...combo.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].map((row) =>
        row.textContent!.trim(),
      );
    expect(rows()).toEqual(["Dinner", "Dinner › Mains"]);
    await userEvent.fill(search, "nothing like this");
    await combo.updateComplete;
    expect(rows()).toEqual([]);
    expect(combo.shadowRoot!.querySelector(".empty")!.textContent!.trim()).toBe(noResults);
  },
);
it("moves products to the explicitly chosen top level", async () => {
  const el = await mountBrowser();
  await selectKeys(el, ["bread"]);
  await press(el, "move");
  await destination(el, "top");
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledWith(
      { productIds: ["bread"], categoryIds: [] },
      null,
    ),
  );
});
it("deletes only completely summarised empty folders without asking", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "f", folders: 0, products: 0, activeProducts: 0, routes: 0, ownRoutes: 0 },
  ]);
  await selectKeys(el, ["folder:f"]);
  await press(el, "delete");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith(
      { productIds: [], categoryIds: ["f"] },
      "move_up",
      [{ id: "f", folders: 0, products: 0, activeProducts: 0, routes: 0, ownRoutes: 0 }],
    ),
  );
  expect(dialog(el)).toBeNull();
  expect(count(el)).toBe("0 selected");
});
it.each([
  ["en-GB", 2, "2 kitchen routing rules name these categories and will be removed."],
  ["en-GB", 1, "1 kitchen routing rule names these categories and will be removed."],
  ["es", 2, "2 reglas de envío a cocina nombran estas categorías y se eliminarán."],
] as const)(
  "asks before deleting a category whose only contents are routing rules, saying how many go with it and asking nothing about contents (%s, %i rules)",
  async (locale, rules, sentence) => {
    setLocale(locale);
    const el = await mountBrowser();
    const summary = {
      id: "f",
      folders: 0,
      products: 0,
      activeProducts: 0,
      routes: rules,
      ownRoutes: rules,
    };
    vi.mocked(el.api.summariseFolders).mockResolvedValue([summary]);
    await selectKeys(el, ["folder:f"]);
    await press(el, "delete");
    await vi.waitFor(() => expect(dialog(el)?.textContent).toContain(sentence));
    expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("fieldset")).toBeNull();
    expect(el.shadowRoot!.querySelector("input[name=contents]")).toBeNull();
    await press(el, "confirm");
    await vi.waitFor(() =>
      expect(el.api.deleteCatalogueItems).toHaveBeenCalledExactlyOnceWith(
        { productIds: [], categoryIds: ["f"] },
        "move_up",
        [summary],
      ),
    );
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
  },
);
it("still asks what happens to the contents when a category holding only routing rules is deleted beside one holding a product", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "d", folders: 0, products: 1, activeProducts: 1, routes: 0, ownRoutes: 0 },
    { id: "f", folders: 0, products: 0, activeProducts: 0, routes: 2, ownRoutes: 2 },
  ]);
  await selectKeys(el, ["folder:d", "folder:f"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("fieldset legend")?.textContent).toContain(
      "What happens to what is inside?",
    ),
  );
  expect(el.shadowRoot!.querySelector("input[value=move_up]")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("input[value=delete]")).not.toBeNull();
  expect(el.shadowRoot!.textContent).toContain(
    "2 kitchen routing rules name these categories and will be removed.",
  );
});
it.each(["network", "missing", "partial"])(
  "keeps deletion disabled and quiet on %s summary",
  async (state) => {
    const el = await mountBrowser();
    if (state === "network")
      vi.mocked(el.api.summariseFolders).mockRejectedValue(new Error("network"));
    else
      vi.mocked(el.api.summariseFolders).mockResolvedValue(
        state === "missing"
          ? []
          : [{ id: "d", folders: 0, products: 0, activeProducts: 0, routes: 0, ownRoutes: 0 }],
      );
    await selectKeys(el, ["folder:d", "folder:f"]);
    await press(el, "delete");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull());
    const confirm =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm]")!;
    expect(confirm.getAttribute("disabled")).not.toBeNull();
    expect(confirm.variant).toBe("secondary");
    expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
  },
);
it("shows folder contents and routes, defaults to moving up, and sends delete choice", async () => {
  const el = await mountBrowser();
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("1 category and 2 products"));
  expect(el.shadowRoot!.textContent).toContain("1 kitchen routing rule names");
  const radio = el.shadowRoot!.querySelector<HTMLInputElement>("input[value=delete]")!;
  expect(el.shadowRoot!.querySelector<HTMLInputElement>("input[value=move_up]")!.checked).toBe(
    true,
  );
  radio.click();
  await el.updateComplete;
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith(
      { productIds: [], categoryIds: ["d"] },
      "delete",
      [{ id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 }],
    ),
  );
});
/** The two answers to "What happens to what is inside?", as their whole labels read. */
function contentsLabels(el: CatalogueBrowser): [string, string] {
  const label = (value: string) =>
    el.shadowRoot!.querySelector(`input[value=${value}]`)!.parentElement!.textContent!.trim();
  return [label("move_up"), label("delete")];
}
const contents = (folders: number, active: number, routes = 0, ownRoutes = 0, disabled = 0) => ({
  folders,
  products: active + disabled,
  activeProducts: active,
  routes,
  ownRoutes,
});
const WINE = [...CATEGORIES, folder("w", "Wine", "d"), folder("r", "Red", "w")];
it.each([
  [
    "en-GB",
    { b: contents(1, 3) },
    "1 category and 3 products move to Drinks",
    "Also: deletes 1 category and archives 3 products. They move to Drinks.",
  ],
  ["en-GB", { b: contents(1, 0) }, "1 category moves to Drinks", "Also: deletes 1 category."],
  ["en-GB", { b: contents(2, 0) }, "2 categories move to Drinks", "Also: deletes 2 categories."],
  [
    "en-GB",
    { d: contents(0, 1) },
    "1 product moves to No category",
    "Also: archives 1 product. It moves to No category.",
  ],
  [
    "en-GB",
    { b: contents(0, 2) },
    "2 products move to Drinks",
    "Also: archives 2 products. They move to Drinks.",
  ],
  [
    "en-GB",
    { b: contents(2, 3, 0, 0, 2) },
    "2 categories and 3 products move to Drinks",
    "Also: deletes 2 categories and archives 3 products. They move to Drinks.",
  ],
  [
    "en-GB",
    { b: contents(1, 3, 3, 1) },
    "1 category and 3 products move to Drinks",
    "Also: deletes 1 category and 2 kitchen routing rules and archives 3 products. They move to Drinks.",
  ],
  [
    "en-GB",
    { b: contents(1, 0, 2, 1) },
    "1 category moves to Drinks",
    "Also: deletes 1 category and 1 kitchen routing rule.",
  ],
  [
    "en-GB",
    { b: contents(1, 1), f: contents(0, 1) },
    "1 category and 2 products move to each category's parent",
    "Also: deletes 1 category and archives 2 products. They move to each category's parent.",
  ],
  [
    "en-GB",
    { r: contents(0, 1) },
    "1 product moves to Drinks › Wine",
    "Also: archives 1 product. It moves to Drinks › Wine.",
  ],
  [
    "es",
    { b: contents(1, 3) },
    "1 categoría y 3 productos pasan a Drinks",
    "También: elimina 1 categoría y archiva 3 productos. Pasan a Drinks.",
  ],
  ["es", { b: contents(1, 0) }, "1 categoría pasa a Drinks", "También: elimina 1 categoría."],
  ["es", { b: contents(2, 0) }, "2 categorías pasan a Drinks", "También: elimina 2 categorías."],
  [
    "es",
    { d: contents(0, 1) },
    "1 producto pasa a Sin categoría",
    "También: archiva 1 producto. Pasa a Sin categoría.",
  ],
  [
    "es",
    { b: contents(1, 3, 4, 1) },
    "1 categoría y 3 productos pasan a Drinks",
    "También: elimina 1 categoría y 3 reglas de envío a cocina y archiva 3 productos. Pasan a Drinks.",
  ],
  [
    "es",
    { b: contents(1, 0, 2, 1) },
    "1 categoría pasa a Drinks",
    "También: elimina 1 categoría y 1 regla de envío a cocina.",
  ],
  [
    "es",
    { b: contents(1, 1), f: contents(0, 1) },
    "1 categoría y 2 productos pasan a la categoría superior de cada una",
    "También: elimina 1 categoría y archiva 2 productos. Pasan a la categoría superior de cada una.",
  ],
] as const)(
  "words both answers about the contents from the active products, the subcategories and the rules inside, leaving out what is zero (%s, case %#)",
  async (locale, summaries, keep, deleteToo) => {
    setLocale(locale);
    const el = await mountBrowser({ categories: WINE });
    vi.mocked(el.api.summariseFolders).mockResolvedValue(
      Object.entries(summaries).map(([id, counts]) => ({ id, ...counts })),
    );
    await toggleCategory(el, "d");
    await toggleCategory(el, "w");
    await selectKeys(
      el,
      Object.keys(summaries).map((id) => `folder:${id}`),
    );
    await press(el, "delete");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("fieldset")).not.toBeNull());
    expect(contentsLabels(el)).toEqual([keep, deleteToo]);
  },
);
it("shows the delete dialog at the compact size", async () => {
  const el = await mountBrowser();
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("fieldset")).not.toBeNull());
  expect(dialog(el)!.getAttribute("size")).toBe("compact");
});
it.each([
  ["en-GB", contents(0, 0, 0, 0, 2), "", /disabl/i],
  [
    "en-GB",
    contents(0, 0, 1, 1, 1),
    "1 kitchen routing rule names these categories and will be removed.",
    /disabl/i,
  ],
  ["es", contents(0, 0, 0, 0, 1), "", /deshabilit/i],
] as const)(
  "asks nothing about the contents of a category holding only disabled products, says nothing about them, and moves them up (%s, case %#)",
  async (locale, counts, rules, disabledWord) => {
    setLocale(locale);
    const el = await mountBrowser();
    const summary = { id: "f", ...counts };
    vi.mocked(el.api.summariseFolders).mockResolvedValue([summary]);
    await selectKeys(el, ["folder:f"]);
    await press(el, "delete");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector('[data-test="deleting"]')).not.toBeNull(),
    );
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-spinner")).toBeNull());
    expect(el.shadowRoot!.querySelector("fieldset")).toBeNull();
    expect(el.shadowRoot!.querySelector("input[name=contents]")).toBeNull();
    const text = [...el.shadowRoot!.querySelector("form")!.querySelectorAll("p")]
      .map((paragraph) => paragraph.textContent!.trim())
      .filter((paragraph) => paragraph !== (locale === "es" ? es : en)["folders.deleting"]);
    expect(text).toEqual(rules ? [rules] : []);
    expect(dialog(el)!.textContent).not.toMatch(disabledWord);
    expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
    await press(el, "confirm");
    await vi.waitFor(() =>
      expect(el.api.deleteCatalogueItems).toHaveBeenCalledExactlyOnceWith(
        { productIds: [], categoryIds: ["f"] },
        "move_up",
        [summary],
      ),
    );
  },
);
it.each([
  [
    "en-GB",
    "1 kitchen routing rule names these categories and will be removed.",
    "Also: deletes 1 category and 2 kitchen routing rules and archives 2 products. They move to No category.",
  ],
  [
    "es",
    "1 regla de envío a cocina nombra estas categorías y se eliminará.",
    "También: elimina 1 categoría y 2 reglas de envío a cocina y archiva 2 productos. Pasan a Sin categoría.",
  ],
] as const)(
  "names the selected categories' own routing rules under either answer, and lists the rules inside among what deleting the contents removes (%s)",
  async (locale, moveUp, deleteToo) => {
    setLocale(locale);
    const el = await mountBrowser();
    vi.mocked(el.api.summariseFolders).mockResolvedValue([
      { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 3, ownRoutes: 1 },
    ]);
    await selectKeys(el, ["folder:d"]);
    await press(el, "delete");
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    expect(el.shadowRoot!.textContent).toContain(moveUp);
    expect(contentsLabels(el)[1]).toBe(deleteToo);
    el.shadowRoot!.querySelector<HTMLInputElement>("input[value=delete]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(moveUp);
    expect(el.shadowRoot!.textContent).not.toMatch(/3 (kitchen routing rules|reglas)/);
    el.shadowRoot!.querySelector<HTMLInputElement>("input[value=move_up]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(moveUp);
  },
);
it("warns of no routing rules under either answer when the selected category names none, and lists the ones inside in the delete answer", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 2, ownRoutes: 0 },
  ]);
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  expect(el.shadowRoot!.querySelector("form")!.textContent).not.toContain("name these categories");
  el.shadowRoot!.querySelector<HTMLInputElement>("input[value=delete]")!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("form")!.textContent).not.toContain("name these categories");
  expect(contentsLabels(el)[1]).toBe(
    "Also: deletes 1 category and 2 kitchen routing rules and archives 2 products. They move to No category.",
  );
});
it("counts the own rules of every selected category under either answer, a subcategory selected with its parent included", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 4, ownRoutes: 1 },
    { id: "b", folders: 0, products: 1, activeProducts: 1, routes: 2, ownRoutes: 2 },
  ]);
  await toggleCategory(el, "d");
  await selectKeys(el, ["folder:d", "folder:b"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  expect(el.shadowRoot!.textContent).toContain(
    "3 kitchen routing rules name these categories and will be removed.",
  );
  el.shadowRoot!.querySelector<HTMLInputElement>("input[value=delete]")!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain(
    "3 kitchen routing rules name these categories and will be removed.",
  );
  expect(contentsLabels(el)[1]).toBe(
    "Also: deletes 1 category and 1 kitchen routing rule and archives 2 products. They move to No category.",
  );
});
it("shows the new counts instead of deleting when only the category's own routing rules changed", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders)
    .mockResolvedValueOnce([
      { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 2, ownRoutes: 0 },
    ])
    .mockResolvedValue([
      { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 2, ownRoutes: 1 },
    ]);
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain("1 kitchen routing rule names"),
  );
  expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
});
it.each([
  ["en-GB", ["Mains (2 of 3)", "Drinks › Beer"]],
  ["es", ["Mains (2 de 3)", "Drinks › Beer"]],
] as const)(
  "names each category it would delete by its path, numbering one whose path others share (%s)",
  async (locale, names) => {
    setLocale(locale);
    const el = await mountBrowser({
      categories: [
        folder("m1", "Mains", null),
        folder("d", "Drinks", null),
        folder("m2", "Mains", null),
        folder("b", "Beer", "d"),
        folder("m3", "Mains", null),
      ],
      products: [product("steak", "Steak", "m2")],
    });
    vi.mocked(el.api.summariseFolders).mockResolvedValue([
      { id: "m2", folders: 0, products: 1, activeProducts: 1, routes: 0, ownRoutes: 0 },
      { id: "b", folders: 0, products: 0, activeProducts: 0, routes: 0, ownRoutes: 0 },
    ]);
    await toggleCategory(el, "d");
    await selectKeys(el, ["folder:m2", "folder:b"]);
    await press(el, "delete");
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    expect(
      [...el.shadowRoot!.querySelectorAll('[data-test="deleting"] li')].map((item) =>
        item.textContent!.trim(),
      ),
    ).toEqual(names);
  },
);
it("numbers categories sharing a path in the order the list draws them, each under its own parent", async () => {
  const el = await mountBrowser({
    categories: [
      folder("f1", "Food", null),
      folder("f2", "Food", null),
      folder("x", "Mains", "f2"),
      folder("y", "Mains", "f1"),
    ],
    products: [],
  });
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "x", folders: 0, products: 1, activeProducts: 1, routes: 0, ownRoutes: 0 },
  ]);
  await toggleCategory(el, "f1");
  await toggleCategory(el, "f2");
  expect(await rowKeys(el)).toEqual(["folder:f1", "folder:y", "folder:f2", "folder:x"]);
  await selectKeys(el, ["folder:x"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  expect(el.shadowRoot!.querySelector('[data-test="deleting"] li')!.textContent!.trim()).toBe(
    "Food › Mains (2 of 2)",
  );
});
it("shows a shared category name literally beside its number, even when it reads like a placeholder", async () => {
  const name = "Mains $& {position} {total}";
  const el = await mountBrowser({
    categories: [folder("m1", name, null), folder("m2", name, null), folder("m3", name, null)],
    products: [],
  });
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "m2", folders: 0, products: 1, activeProducts: 1, routes: 0, ownRoutes: 0 },
  ]);
  await selectKeys(el, ["folder:m2"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  expect(el.shadowRoot!.querySelector('[data-test="deleting"] li')!.textContent!.trim()).toBe(
    `${name} (2 of 3)`,
  );
});
it("asks before deleting a category holding only a disabled product, asking nothing about it and not calling it disabled", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "f", folders: 0, products: 1, activeProducts: 0, routes: 0, ownRoutes: 0 },
  ]);
  await selectKeys(el, ["folder:f"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-spinner")).toBeNull());
  expect(el.shadowRoot!.querySelector("fieldset")).toBeNull();
  expect(dialog(el)!.textContent).not.toMatch(/disabl/i);
  expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
});
it.each([
  [
    "en-GB",
    { folders: 1, products: 3, activeProducts: 2 },
    "Also: deletes 1 category and archives 2 products. They move to No category.",
  ],
  [
    "en-GB",
    { folders: 0, products: 4, activeProducts: 2 },
    "Also: archives 2 products. They move to No category.",
  ],
  ["en-GB", { folders: 0, products: 2, activeProducts: 0 }, null],
  [
    "es",
    { folders: 1, products: 3, activeProducts: 1 },
    "También: elimina 1 categoría y archiva 1 producto. Pasa a Sin categoría.",
  ],
  ["es", { folders: 0, products: 1, activeProducts: 0 }, null],
  ["es", { folders: 0, products: 2, activeProducts: 0 }, null],
] as const)(
  "the delete choice counts only the active products and is not offered when none is active (%s, %o)",
  async (locale, counts, sentence) => {
    setLocale(locale);
    const el = await mountBrowser();
    vi.mocked(el.api.summariseFolders).mockResolvedValue([
      { id: "f", ...counts, routes: 0, ownRoutes: 0 },
    ]);
    await selectKeys(el, ["folder:f"]);
    await press(el, "delete");
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-spinner")).toBeNull());
    if (sentence === null) expect(el.shadowRoot!.querySelector("fieldset")).toBeNull();
    else expect(contentsLabels(el)[1]).toBe(sentence);
    expect(dialog(el)!.textContent).not.toMatch(/already|ya deshabilitad/);
  },
);
it("words the whole English delete choice when every product to delete is active", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "f", folders: 1, products: 2, activeProducts: 2, routes: 0, ownRoutes: 0 },
  ]);
  await selectKeys(el, ["folder:f"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  expect(
    el.shadowRoot!.querySelector("input[value=delete]")!.parentElement!.textContent!.trim(),
  ).toBe("Also: deletes 1 category and archives 2 products. They move to No category.");
});
it("words the whole Spanish delete choice when one of the products to delete is disabled", async () => {
  setLocale("es");
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "f", folders: 0, products: 3, activeProducts: 2, routes: 0, ownRoutes: 0 },
  ]);
  await selectKeys(el, ["folder:f"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  expect(
    el.shadowRoot!.querySelector("input[value=delete]")!.parentElement!.textContent!.trim(),
  ).toBe("También: archiva 2 productos. Pasan a Sin categoría.");
});
it("sums every selected category's active products, leaving out the disabled ones, when only one of them holds disabled products", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 0, ownRoutes: 0 },
    { id: "f", folders: 0, products: 3, activeProducts: 1, routes: 0, ownRoutes: 0 },
  ]);
  await selectKeys(el, ["folder:d", "folder:f"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  expect(contentsLabels(el)).toEqual([
    "1 category and 3 products move to No category",
    "Also: deletes 1 category and archives 3 products. They move to No category.",
  ]);
});
it("reads the contents again at Delete and, when they changed, shows the new counts instead of deleting", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders)
    .mockResolvedValueOnce([
      { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 },
    ])
    .mockResolvedValue([
      { id: "d", folders: 2, products: 3, activeProducts: 3, routes: 1, ownRoutes: 1 },
    ]);
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("1 category and 2 products"));
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
      "What these categories hold has changed since this opened. Check the new counts and confirm again.",
    ),
  );
  expect(el.shadowRoot!.textContent).toContain("2 categories and 3 products");
  expect(dialog(el)).not.toBeNull();
  expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
  expect(el.api.summariseFolders).toHaveBeenNthCalledWith(2, ["d"]);
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: [], categoryIds: ["d"] },
      "move_up",
      [{ id: "d", folders: 2, products: 3, activeProducts: 3, routes: 1, ownRoutes: 1 }],
    ),
  );
  expect(el.api.summariseFolders).toHaveBeenCalledTimes(3);
});
it.each([
  ["folders", { folders: 2 }, false],
  ["activeProducts", { activeProducts: 1 }, false],
  ["routes", { routes: 3 }, false],
  ["ownRoutes", { ownRoutes: 2 }, false],
  ["products", { products: 3 }, true],
] as const)(
  "at Delete, a change in %s alone is checked against what the dialog showed",
  async (_field, change, deletes) => {
    const el = await mountBrowser();
    const shown = { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 2, ownRoutes: 1 };
    vi.mocked(el.api.summariseFolders)
      .mockResolvedValueOnce([shown])
      .mockResolvedValue([{ ...shown, ...change }]);
    await selectKeys(el, ["folder:d"]);
    await press(el, "delete");
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    await press(el, "confirm");
    await vi.waitFor(() => expect(el.api.summariseFolders).toHaveBeenCalledTimes(2));
    if (deletes) await vi.waitFor(() => expect(el.api.deleteCatalogueItems).toHaveBeenCalledOnce());
    else {
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
          en["folders.summary_changed"],
        ),
      );
      expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
    }
  },
);
it("at Delete, sends the count of every product read then when only inactive products changed", async () => {
  const el = await mountBrowser();
  const shown = { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 };
  vi.mocked(el.api.summariseFolders)
    .mockResolvedValueOnce([shown])
    .mockResolvedValue([{ ...shown, products: 3 }]);
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: [], categoryIds: ["d"] },
      "move_up",
      [{ id: "d", folders: 1, products: 3, activeProducts: 2, routes: 1, ownRoutes: 1 }],
    ),
  );
});
it("at Delete, a disabled product joining a category that held only routing rules is no change: the first confirm deletes it, saying nothing about the product", async () => {
  const el = await mountBrowser();
  const shown = { id: "f", folders: 0, products: 0, activeProducts: 0, routes: 2, ownRoutes: 2 };
  const changed = { ...shown, products: 1 };
  vi.mocked(el.api.summariseFolders).mockResolvedValueOnce([shown]).mockResolvedValue([changed]);
  await selectKeys(el, ["folder:f"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  expect(el.shadowRoot!.querySelector("fieldset")).toBeNull();
  expect(dialog(el)!.textContent).not.toMatch(/disabl/i);
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: [], categoryIds: ["f"] },
      "move_up",
      [changed],
    ),
  );
  await vi.waitFor(() => expect(dialog(el)).toBeNull());
});
it.each([
  ["a subcategory", { folders: 1 }],
  ["an active product", { products: 1, activeProducts: 1 }],
] as const)(
  "at Delete, %s joining a category whose dialog asked nothing about contents shows the new counts instead of deleting",
  async (_what, change) => {
    const el = await mountBrowser();
    const shown = { id: "f", folders: 0, products: 0, activeProducts: 0, routes: 2, ownRoutes: 2 };
    vi.mocked(el.api.summariseFolders)
      .mockResolvedValueOnce([shown])
      .mockResolvedValue([{ ...shown, ...change }]);
    await selectKeys(el, ["folder:f"]);
    await press(el, "delete");
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    expect(el.shadowRoot!.querySelector("fieldset")).toBeNull();
    await press(el, "confirm");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
        en["folders.summary_changed"],
      ),
    );
    expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("fieldset")).not.toBeNull();
  },
);
it.each(["the read at Delete", "the server's refusal"])(
  'after the "Also: …" answer was chosen, a category found by %s to hold only routing rules is deleted moving nothing up',
  async (path) => {
    const el = await mountBrowser();
    const full = { id: "f", folders: 0, products: 1, activeProducts: 1, routes: 2, ownRoutes: 2 };
    const rules = { ...full, products: 0, activeProducts: 0 };
    vi.mocked(el.api.summariseFolders).mockResolvedValueOnce([full]);
    if (path === "the server's refusal") {
      vi.mocked(el.api.summariseFolders).mockResolvedValueOnce([full]);
      vi.mocked(el.api.deleteCatalogueItems).mockRejectedValueOnce({
        code: "category.contents_changed",
        params: { categoryId: "f" },
        status: 409,
      });
    }
    vi.mocked(el.api.summariseFolders).mockResolvedValue([rules]);
    await selectKeys(el, ["folder:f"]);
    await press(el, "delete");
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    el.shadowRoot!.querySelector<HTMLInputElement>("input[value=delete]")!.click();
    await el.updateComplete;
    await press(el, "confirm");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull());
    expect(el.shadowRoot!.querySelector("fieldset")).toBeNull();
    expect(dialog(el)?.textContent).toContain(
      "2 kitchen routing rules name these categories and will be removed.",
    );
    vi.mocked(el.api.deleteCatalogueItems).mockClear();
    await press(el, "confirm");
    await vi.waitFor(() =>
      expect(el.api.deleteCatalogueItems).toHaveBeenCalledExactlyOnceWith(
        { productIds: [], categoryIds: ["f"] },
        "move_up",
        [rules],
      ),
    );
  },
);
it("deletes nothing when a category is gone by the time Delete is pressed", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders)
    .mockResolvedValueOnce([
      { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 },
    ])
    .mockRejectedValue({ code: "category.not_found", params: { categoryId: "d" } });
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("1 category and 2 products"));
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
      codeMessage("category.not_found"),
    ),
  );
  expect(dialog(el)).not.toBeNull();
  expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
});
it("deletes nothing when the second read leaves a category out", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders)
    .mockResolvedValueOnce([
      { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 },
    ])
    .mockResolvedValue([]);
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
      en["folders.summary_error"],
    ),
  );
  expect(dialog(el)).not.toBeNull();
  expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
});
it("deletes nothing when the second read fails without a code, and says the contents could not be read", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders)
    .mockResolvedValueOnce([
      { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 },
    ])
    .mockRejectedValue(new TypeError("unreadable reply"));
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
      en["folders.summary_error"],
    ),
  );
  expect(dialog(el)).not.toBeNull();
  expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
});
it("deletes nothing when the second read's reply is not a list, and says the contents could not be read", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders)
    .mockResolvedValueOnce([
      { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 },
    ])
    .mockResolvedValue({} as never);
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
      en["folders.summary_error"],
    ),
  );
  expect(dialog(el)).not.toBeNull();
  expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
});
it("after a failed second read keeps Delete enabled, and pressing it again reads again and deletes", async () => {
  const el = await mountBrowser();
  const shown = { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 };
  vi.mocked(el.api.summariseFolders)
    .mockResolvedValueOnce([shown])
    .mockRejectedValueOnce(new TypeError("unreadable reply"))
    .mockResolvedValue([shown]);
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
      en["folders.summary_error"],
    ),
  );
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector("[data-test=confirm]")!.getAttribute("disabled"),
    ).toBeNull(),
  );
  await press(el, "confirm");
  await vi.waitFor(() => expect(el.api.deleteCatalogueItems).toHaveBeenCalledOnce());
  expect(el.api.summariseFolders).toHaveBeenCalledTimes(3);
  expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith(
    { productIds: [], categoryIds: ["d"] },
    "move_up",
    [{ id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 }],
  );
});
it("sends the counts read before deleting with the delete, one entry per selected category", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "b", folders: 0, products: 1, activeProducts: 1, routes: 2, ownRoutes: 2 },
    { id: "f", folders: 3, products: 5, activeProducts: 4, routes: 0, ownRoutes: 0 },
  ]);
  await toggleCategory(el, "d");
  await selectKeys(el, ["folder:f", "folder:b"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: [], categoryIds: ["f", "b"] },
      "move_up",
      [
        { id: "f", folders: 3, products: 5, activeProducts: 4, routes: 0, ownRoutes: 0 },
        { id: "b", folders: 0, products: 1, activeProducts: 1, routes: 2, ownRoutes: 2 },
      ],
    ),
  );
});
it("when the server refuses because the contents changed, shows the new counts, and a second Delete sends them", async () => {
  const el = await mountBrowser();
  const shown = { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 };
  const changed = { id: "d", folders: 2, products: 3, activeProducts: 3, routes: 1, ownRoutes: 1 };
  vi.mocked(el.api.summariseFolders)
    .mockResolvedValueOnce([shown])
    .mockResolvedValueOnce([shown])
    .mockResolvedValue([changed]);
  vi.mocked(el.api.deleteCatalogueItems).mockRejectedValueOnce({
    code: "category.contents_changed",
    params: { categoryId: "d" },
    status: 409,
  });
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("1 category and 2 products"));
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
      codeMessage("category.contents_changed"),
    ),
  );
  expect(el.shadowRoot!.textContent).toContain("2 categories and 3 products");
  expect(dialog(el)).not.toBeNull();
  expect(el.api.summariseFolders).toHaveBeenCalledTimes(3);
  expect(el.api.deleteCatalogueItems).toHaveBeenCalledExactlyOnceWith(
    { productIds: [], categoryIds: ["d"] },
    "move_up",
    [{ id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 }],
  );
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector("[data-test=confirm]")!.getAttribute("disabled"),
    ).toBeNull(),
  );
  await press(el, "confirm");
  await vi.waitFor(() => expect(el.api.deleteCatalogueItems).toHaveBeenCalledTimes(2));
  expect(el.api.deleteCatalogueItems).toHaveBeenLastCalledWith(
    { productIds: [], categoryIds: ["d"] },
    "move_up",
    [{ id: "d", folders: 2, products: 3, activeProducts: 3, routes: 1, ownRoutes: 1 }],
  );
  await vi.waitFor(() => expect(dialog(el)).toBeNull());
});
it("when the server refuses an empty category's delete because it is no longer empty, opens the dialog with the new counts", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders)
    .mockResolvedValueOnce([
      { id: "f", folders: 0, products: 0, activeProducts: 0, routes: 0, ownRoutes: 0 },
    ])
    .mockResolvedValue([
      { id: "f", folders: 0, products: 1, activeProducts: 1, routes: 0, ownRoutes: 0 },
    ]);
  vi.mocked(el.api.deleteCatalogueItems).mockRejectedValueOnce({
    code: "category.contents_changed",
    params: { categoryId: "f" },
    status: 409,
  });
  await selectKeys(el, ["folder:f"]);
  await press(el, "delete");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
      codeMessage("category.contents_changed"),
    ),
  );
  expect(dialog(el)).not.toBeNull();
  expect(contentsLabels(el)).toEqual([
    "1 product moves to No category",
    "Also: archives 1 product. It moves to No category.",
  ]);
  expect(el.api.deleteCatalogueItems).toHaveBeenCalledExactlyOnceWith(
    { productIds: [], categoryIds: ["f"] },
    "move_up",
    [{ id: "f", folders: 0, products: 0, activeProducts: 0, routes: 0, ownRoutes: 0 }],
  );
});
it("when the server refuses an empty category's delete because a disabled product joined it, opens the dialog asking nothing about it, and a second Delete moves it up", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders)
    .mockResolvedValueOnce([
      { id: "f", folders: 0, products: 0, activeProducts: 0, routes: 0, ownRoutes: 0 },
    ])
    .mockResolvedValue([
      { id: "f", folders: 0, products: 1, activeProducts: 0, routes: 0, ownRoutes: 0 },
    ]);
  vi.mocked(el.api.deleteCatalogueItems).mockRejectedValueOnce({
    code: "category.contents_changed",
    params: { categoryId: "f" },
    status: 409,
  });
  await selectKeys(el, ["folder:f"]);
  await press(el, "delete");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
      en["folders.changed_unshown"],
    ),
  );
  expect(dialog(el)).not.toBeNull();
  expect(el.shadowRoot!.querySelector("fieldset")).toBeNull();
  expect(dialog(el)!.textContent).not.toMatch(/disabl/i);
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector("[data-test=confirm]")!.getAttribute("disabled"),
    ).toBeNull(),
  );
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenLastCalledWith(
      { productIds: [], categoryIds: ["f"] },
      "move_up",
      [{ id: "f", folders: 0, products: 1, activeProducts: 0, routes: 0, ownRoutes: 0 }],
    ),
  );
});
it.each([
  ["en-GB", "a disabled product joined", { products: 4 }],
  ["en-GB", "a disabled product left", { products: 2 }],
  ["es", "a disabled product joined", { products: 4 }],
  ["en-GB", "the contents changed and changed back", {}],
] as const)(
  "when the server refuses because the contents changed but nothing the dialog shows did, says so instead of asking to check the counts (%s, %s), and a second Delete sends the new counts",
  async (locale, _what, change) => {
    setLocale(locale);
    const el = await mountBrowser();
    const shown = { id: "d", folders: 1, products: 3, activeProducts: 2, routes: 1, ownRoutes: 1 };
    const fresh = { ...shown, ...change };
    vi.mocked(el.api.summariseFolders)
      .mockResolvedValueOnce([shown])
      .mockResolvedValueOnce([shown])
      .mockResolvedValue([fresh]);
    vi.mocked(el.api.deleteCatalogueItems).mockRejectedValueOnce({
      code: "category.contents_changed",
      params: { categoryId: "d" },
      status: 409,
    });
    const shownText = () =>
      [...dialog(el)!.querySelectorAll("form > :not([role=alert])")]
        .map((node) => node.textContent)
        .join("|");
    await selectKeys(el, ["folder:d"]);
    await press(el, "delete");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("fieldset")).not.toBeNull());
    const before = shownText();
    await press(el, "confirm");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
        (locale === "es" ? es : en)["folders.changed_unshown"],
      ),
    );
    expect(dialog(el)).not.toBeNull();
    expect(el.api.summariseFolders).toHaveBeenCalledTimes(3);
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector("[data-test=confirm]")!.getAttribute("disabled"),
      ).toBeNull(),
    );
    expect(shownText()).toBe(before);
    await press(el, "confirm");
    await vi.waitFor(() => expect(el.api.deleteCatalogueItems).toHaveBeenCalledTimes(2));
    expect(el.api.deleteCatalogueItems).toHaveBeenLastCalledWith(
      { productIds: [], categoryIds: ["d"] },
      "move_up",
      [fresh],
    );
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
  },
);
it("deletes a folder through its own row action", async () => {
  const el = await mountBrowser();
  (await tableOf(el))
    .shadowRoot!.querySelector<HTMLElement>('[data-test="delete-folder-d"]')!
    .click();
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith(
      { productIds: [], categoryIds: ["d"] },
      "move_up",
      [{ id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 }],
    ),
  );
});
it("deleting an empty category from its menu acts on that category alone, and leaves no menu open on another", async () => {
  const mains = [
    folder("m1", "Mains", null),
    folder("m2", "Mains", null),
    folder("m3", "Mains", null),
  ];
  const el = await mountBrowser({
    categories: mains,
    products: [product("steak", "Steak", "m2"), product("stew", "Stew", "m3", false)],
  });
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "m1", folders: 0, products: 0, activeProducts: 0, routes: 0, ownRoutes: 0 },
  ]);
  const table = await tableOf(el);
  const menus = () => [...table.shadowRoot!.querySelectorAll("wt-row-actions")];
  const isOpen = (menu: Element) =>
    menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open");
  const menu = table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
    '[data-test="actions-folder-m1"]',
  )!;
  menu.show();
  menu.querySelector<HTMLElement>('[data-test="delete-folder-m1"]')!.click();
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith(
      { productIds: [], categoryIds: ["m1"] },
      "move_up",
      [{ id: "m1", folders: 0, products: 0, activeProducts: 0, routes: 0, ownRoutes: 0 }],
    ),
  );
  expect(el.api.summariseFolders).toHaveBeenCalledExactlyOnceWith(["m1"]);
  expect(dialog(el)).toBeNull();
  expect(menus().filter(isOpen)).toEqual([]);
  el.categories = mains.slice(1);
  await tableOf(el);
  expect(await rowKeys(el)).toEqual(["folder:m2", "folder:m3"]);
  expect(menus().filter(isOpen)).toEqual([]);
  expect(menu.isConnected).toBe(false);
});
it.each([1, 2])(
  "confirms archiving %i products with permanent and sales wording",
  async (number) => {
    const el = await mountBrowser();
    await toggleCategory(el, "d");
    await selectKeys(el, number === 1 ? ["bread"] : ["bread", "cola"]);
    expect(el.shadowRoot!.querySelector('[data-test="delete"]')!.textContent!.trim()).toBe(
      "Archive",
    );
    await press(el, "delete");
    expect(dialog(el)!.heading).toBe(number === 1 ? "Archive 1 product?" : "Archive 2 products?");
    expect(el.shadowRoot!.textContent).toContain("past sales");
    expect(el.shadowRoot!.textContent).toContain(
      "This can't be undone. The till stops selling the products, they come off the extras lists that offer them, and they cannot be brought back. Their past sales are kept.",
    );
    expect(el.shadowRoot!.textContent).not.toContain("inactive");
    expect(el.shadowRoot!.querySelector('[data-test="confirm"]')!.textContent!.trim()).toBe(
      "Archive",
    );
    await press(el, "confirm");
    await vi.waitFor(() =>
      expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith(
        { productIds: number === 1 ? ["bread"] : ["bread", "cola"], categoryIds: [] },
        "move_up",
        [],
      ),
    );
  },
);
const ARCHIVE_PRODUCTS =
  "This can't be undone. The till stops selling the products, they come off the extras lists that offer them, and they cannot be brought back. Their past sales are kept.";
const archiveBody = (el: CatalogueBrowser) =>
  dialog(el)!.querySelector("form > p")!.textContent!.replace(/\s+/g, " ").trim();
async function openArchiveProducts(keys: string[], menus: () => Promise<number>) {
  const el = await mountBrowser();
  vi.mocked(el.api.countProductMenus).mockImplementation(menus);
  await toggleCategory(el, "d");
  await selectKeys(el, keys);
  await press(el, "delete");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  return el;
}
it.each([
  [3, `${ARCHIVE_PRODUCTS} They come off the 3 menus they are on.`],
  [1, `${ARCHIVE_PRODUCTS} They come off the one menu they are on.`],
  [0, ARCHIVE_PRODUCTS],
] as const)(
  "says how many menus the products come off when they are on %i",
  async (menus, body) => {
    const el = await openArchiveProducts(["bread", "cola"], () => Promise.resolve(menus));
    expect(el.api.countProductMenus).toHaveBeenCalledExactlyOnceWith(["bread", "cola"]);
    expect(archiveBody(el)).toBe(body);
  },
);
it("says the menus one selected product comes off with the product as the subject", async () => {
  const el = await openArchiveProducts(["bread"], () => Promise.resolve(2));
  expect(archiveBody(el)).toBe(
    "This can't be undone. The till stops selling the products, they come off the extras lists that offer them, and they cannot be brought back. Their past sales are kept. It comes off the 2 menus it is on.",
  );
});
it("says every menu while the products' count loads and when it cannot be read, and Archive still works", async () => {
  let fail!: (reason: unknown) => void;
  const el = await openArchiveProducts(
    ["bread", "cola"],
    () => new Promise<number>((_, reject) => (fail = reject)),
  );
  const unknown = `${ARCHIVE_PRODUCTS} They come off every menu they are on.`;
  expect(archiveBody(el)).toBe(unknown);
  fail({ code: "server.internal" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(archiveBody(el)).toBe(unknown);
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith(
      { productIds: ["bread", "cola"], categoryIds: [] },
      "move_up",
      [],
    ),
  );
});
it("never shows an earlier Archive dialog's late count in the next one", async () => {
  const answers: Array<(menus: number) => void> = [];
  const el = await openArchiveProducts(
    ["bread", "cola"],
    () => new Promise<number>((resolve) => answers.push(resolve)),
  );
  dialog(el)!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  await vi.waitFor(() => expect(dialog(el)).toBeNull());
  await press(el, "delete");
  answers[1]!(0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  answers[0]!(4);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(archiveBody(el)).toBe(ARCHIVE_PRODUCTS);
});
it("forgets the last Archive dialog's count while the next one's is still being read", async () => {
  const answers: Array<(menus: number) => void> = [];
  const el = await openArchiveProducts(
    ["bread", "cola"],
    () => new Promise<number>((resolve) => answers.push(resolve)),
  );
  answers[0]!(4);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(archiveBody(el)).toContain("the 4 menus");
  dialog(el)!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  await vi.waitFor(() => expect(dialog(el)).toBeNull());
  (await tableOf(el))
    .shadowRoot!.querySelector<HTMLInputElement>('tr[data-row-key="cola"] input[type="checkbox"]')!
    .click();
  await el.updateComplete;
  await press(el, "delete");
  expect(el.api.countProductMenus).toHaveBeenLastCalledWith(["bread"]);
  expect(archiveBody(el)).toBe(`${ARCHIVE_ONE_PRODUCT} It comes off every menu it is on.`);
});
it("in Spanish, says how many cartas the products come off", async () => {
  setLocale("es");
  const el = await openArchiveProducts(["bread", "cola"], () => Promise.resolve(2));
  expect(archiveBody(el)).toBe(
    "No se puede deshacer. La caja deja de vender los productos, salen de las listas de extras que los ofrecen y no se pueden recuperar. Sus ventas pasadas se conservan. Salen de las 2 cartas en las que están.",
  );
});
it("says products a category's deletion archives come off every menu, only once its contents are to be deleted", async () => {
  const el = await mountBrowser();
  const sentence = "Products archived by this deletion come off every menu they are on.";
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("input[value=delete]")).not.toBeNull(),
  );
  expect(dialog(el)!.textContent).not.toContain(sentence);
  expect(dialog(el)!.textContent).not.toContain("This can't be undone.");
  el.shadowRoot!.querySelector<HTMLInputElement>("input[value=delete]")!.click();
  await el.updateComplete;
  expect(dialog(el)!.textContent).toContain(sentence);
  expect(dialog(el)!.textContent).toContain("This can't be undone.");
  expect(dialog(el)!.textContent).toContain("they come off the extras lists that offer them");
  el.shadowRoot!.querySelector<HTMLInputElement>("input[value=move_up]")!.click();
  await el.updateComplete;
  expect(dialog(el)!.textContent).not.toContain(sentence);
  expect(dialog(el)!.textContent).not.toContain("This can't be undone.");
  expect(el.api.countProductMenus).not.toHaveBeenCalled();
});
it("says nothing about menus when a deleted category's contents disable no product", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "d", folders: 1, products: 1, activeProducts: 0, routes: 0, ownRoutes: 0 },
  ]);
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("input[value=delete]")).not.toBeNull(),
  );
  el.shadowRoot!.querySelector<HTMLInputElement>("input[value=delete]")!.click();
  await el.updateComplete;
  expect(dialog(el)!.textContent).not.toContain("come off every menu");
});
const ARCHIVE_ONE_PRODUCT =
  "This can't be undone. The till stops selling the products, they come off the extras lists that offer them, and they cannot be brought back. Their past sales are kept.";
it.each([
  [
    ["bread"],
    `${ARCHIVE_ONE_PRODUCT} It comes off every menu it is on.`,
    `${ARCHIVE_ONE_PRODUCT} It comes off the 2 menus it is on.`,
  ],
  [
    ["bread", "burger"],
    `${ARCHIVE_PRODUCTS} They come off every menu they are on.`,
    `${ARCHIVE_PRODUCTS} They come off the 2 menus they are on.`,
  ],
] as const)(
  "counts the menus products %j picked beside a category come off, whichever way its contents go",
  async (productIds, unknown, counted) => {
    const el = await mountBrowser();
    let answer!: (menus: number) => void;
    vi.mocked(el.api.countProductMenus).mockImplementation(
      () => new Promise<number>((resolve) => (answer = resolve)),
    );
    await toggleCategory(el, "f");
    await selectKeys(el, [...productIds, "folder:d"]);
    await press(el, "delete");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("input[value=delete]")).not.toBeNull(),
    );
    expect(el.api.countProductMenus).toHaveBeenCalledExactlyOnceWith([...productIds]);
    expect(archiveBody(el)).toBe(unknown);
    answer(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(archiveBody(el)).toBe(counted);
    for (const contents of ["delete", "move_up"]) {
      el.shadowRoot!.querySelector<HTMLInputElement>(`input[value=${contents}]`)!.click();
      await el.updateComplete;
      expect(archiveBody(el)).toBe(counted);
    }
  },
);
it("says products picked beside a category come off every menu when their count cannot be read", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.countProductMenus).mockRejectedValue({ code: "server.internal" });
  await selectKeys(el, ["bread", "folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("input[value=delete]")).not.toBeNull(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(archiveBody(el)).toBe(`${ARCHIVE_ONE_PRODUCT} It comes off every menu it is on.`);
});
it("says Archive for products alone in Spanish, and Delete once a category is selected", async () => {
  setLocale("es");
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  await selectKeys(el, ["bread", "cola"]);
  expect(el.shadowRoot!.querySelector('[data-test="delete"]')!.textContent!.trim()).toBe(
    "Archivar",
  );
  await press(el, "delete");
  expect(dialog(el)!.heading).toBe("¿Archivar 2 productos?");
  expect(el.shadowRoot!.textContent).toContain(
    "No se puede deshacer. La caja deja de vender los productos, salen de las listas de extras que los ofrecen y no se pueden recuperar. Sus ventas pasadas se conservan.",
  );
  expect(el.shadowRoot!.querySelector('[data-test="confirm"]')!.textContent!.trim()).toBe(
    "Archivar",
  );
  cleanupWidgets();
  const mixed = await mountBrowser();
  await toggleCategory(mixed, "d");
  await selectKeys(mixed, ["bread", "folder:d"]);
  expect(mixed.shadowRoot!.querySelector('[data-test="delete"]')!.textContent!.trim()).toBe(
    "Eliminar",
  );
});
it("offers no Archive for a selection of products that are all disabled already, keeping Move and Done", async () => {
  const withArchived = [
    product("bread", "Bread", null),
    product("old", "Old", null, false),
    product("gone", "Gone", null, false),
  ];
  const el = await mountBrowser({ products: withArchived });
  await showArchived(el);
  await selectKeys(el, ["old", "gone"]);
  expect(el.shadowRoot!.querySelector('[data-test="selected-count"]')).not.toBeNull();
  expect(el.shadowRoot!.querySelector('[data-test="delete"]')).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-test="move"]')).not.toBeNull();
  expect(el.shadowRoot!.querySelector('[data-test="cancel-selection"]')).not.toBeNull();
});
it("keeps Archive for a selection mixing active and disabled products, and sends both", async () => {
  const withArchived = [
    product("bread", "Bread", null),
    product("old", "Old", null, false),
    product("gone", "Gone", null, false),
  ];
  const el = await mountBrowser({ products: withArchived });
  await showArchived(el);
  await selectKeys(el, ["bread", "old"]);
  expect(el.shadowRoot!.querySelector('[data-test="delete"]')!.textContent!.trim()).toBe("Archive");
  await press(el, "delete");
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith(
      { productIds: ["bread", "old"], categoryIds: [] },
      "move_up",
      [],
    ),
  );
});
it("offers Archive again once a refresh of the products makes one of a held all-disabled selection active", async () => {
  const el = await mountBrowser({
    products: [product("old", "Old", null, false), product("gone", "Gone", null, false)],
  });
  await showArchived(el);
  await selectKeys(el, ["old", "gone"]);
  expect(el.shadowRoot!.querySelector('[data-test="delete"]')).toBeNull();
  el.products = [product("old", "Old", null), product("gone", "Gone", null, false)];
  await tableOf(el);
  expect(count(el)).toBe("2 selected");
  expect(el.shadowRoot!.querySelector('[data-test="delete"]')!.textContent!.trim()).toBe("Archive");
});
it.each(["move", "delete"])(
  "keeps %s refusal open at bottom of body and blocks Escape while busy",
  async (action) => {
    const el = await mountBrowser();
    let reject!: (error: unknown) => void;
    vi.mocked(
      action === "move" ? el.api.moveCatalogueItems : el.api.deleteCatalogueItems,
    ).mockImplementation(
      () =>
        new Promise((_resolve, r) => {
          reject = r;
        }),
    );
    await selectKeys(el, ["bread"]);
    await press(el, action);
    if (action === "move") await destination(el, "f");
    await press(el, "confirm");
    const confirming = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      'wt-button[data-test="confirm"]',
    )!;
    await confirming.updateComplete;
    expect(confirming.shadowRoot!.querySelector("button")!.getAttribute("aria-busy")).toBe("true");
    expect(dialog(el)!.dismissible).toBe(false);
    const cancel = new Event("cancel", { cancelable: true });
    dialog(el)!.shadowRoot!.querySelector("dialog")!.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog(el)!.open).toBe(true);
    reject({ code: "category.parent_cycle" });
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull());
    expect(dialog(el)!.open).toBe(true);
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toBe(
      "Choose a parent outside this category and its descendants.",
    );
    expect(el.shadowRoot!.querySelector("[role=alert]")!.closest("[slot=footer]")).toBeNull();
    expect(count(el)).toBe("1 selected");
  },
);

it("counts overlapping selected folders once in the delete consent", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 0 },
    { id: "b", folders: 0, products: 1, activeProducts: 1, routes: 1, ownRoutes: 1 },
  ]);
  await selectKeys(el, ["folder:d", "folder:b"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("1 category and 2 products"));
  expect(el.shadowRoot!.textContent).toContain("1 kitchen routing rule names");
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith(
      { productIds: [], categoryIds: ["d", "b"] },
      "move_up",
      [
        { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 0 },
        { id: "b", folders: 0, products: 1, activeProducts: 1, routes: 1, ownRoutes: 1 },
      ],
    ),
  );
});
it("shows a spinner and blocks confirmation while summaries are pending", async () => {
  const el = await mountBrowser();
  let resolve!: (
    value: {
      id: string;
      folders: number;
      products: number;
      activeProducts: number;
      routes: number;
      ownRoutes: number;
    }[],
  ) => void;
  vi.mocked(el.api.summariseFolders).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  expect(el.shadowRoot!.querySelector("wt-spinner")).not.toBeNull();
  expect(dialog(el)).toBeNull();
  expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
  resolve([{ id: "d", folders: 1, products: 2, activeProducts: 2, routes: 0, ownRoutes: 0 }]);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-spinner")).toBeNull());
  expect(el.shadowRoot!.querySelector("[data-test=confirm]")!.getAttribute("disabled")).toBeNull();
});

it("keeps the captured Delete request when Done exits selection during the summary read", async () => {
  const el = await mountBrowser();
  let resolve!: (
    value: {
      id: string;
      folders: number;
      products: number;
      activeProducts: number;
      routes: number;
      ownRoutes: number;
    }[],
  ) => void;
  vi.mocked(el.api.summariseFolders).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await selectKeys(el, ["folder:f"]);
  await press(el, "delete");
  await press(el, "cancel-selection");
  expect((await tableOf(el)).selectable).toBe(false);
  expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
  resolve([{ id: "f", folders: 0, products: 0, activeProducts: 0, routes: 0, ownRoutes: 0 }]);
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: [], categoryIds: ["f"] },
      "move_up",
      [{ id: "f", folders: 0, products: 0, activeProducts: 0, routes: 0, ownRoutes: 0 }],
    ),
  );
  expect(dialog(el)).toBeNull();
});

it("can move after cancelling a failed delete summary", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders).mockRejectedValue(new Error("network"));
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull());
  dialog(el)!.dispatchEvent(new CustomEvent("wt-close"));
  await el.updateComplete;
  await press(el, "move");
  await destination(el, "f");
  expect(el.shadowRoot!.querySelector("[data-test=confirm]")!.getAttribute("disabled")).toBeNull();
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledWith(
      { productIds: [], categoryIds: ["d"] },
      "f",
    ),
  );
});

it("never opens a confirmation while reading or deleting empty folders and blocks duplicate reads", async () => {
  const el = await mountBrowser();
  let resolve!: (
    value: {
      id: string;
      folders: number;
      products: number;
      activeProducts: number;
      routes: number;
      ownRoutes: number;
    }[],
  ) => void;
  vi.mocked(el.api.summariseFolders).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  let finish!: () => void;
  vi.mocked(el.api.deleteCatalogueItems).mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  await selectKeys(el, ["folder:f"]);
  await press(el, "delete");
  expect(dialog(el)).toBeNull();
  await press(el, "delete");
  expect(el.api.summariseFolders).toHaveBeenCalledOnce();
  resolve([{ id: "f", folders: 0, products: 0, activeProducts: 0, routes: 0, ownRoutes: 0 }]);
  await vi.waitFor(() => expect(el.api.deleteCatalogueItems).toHaveBeenCalledOnce());
  expect(dialog(el)).toBeNull();
  finish();
  await vi.waitFor(() => expect(count(el)).toBe("0 selected"));
});

it("places dialog Cancel on the left and its primary action on the right", async () => {
  const el = await mountBrowser();
  await selectKeys(el, ["bread"]);
  await press(el, "delete");
  const modal = dialog(el)!;
  await modal.updateComplete;
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  const buttons = actions.querySelectorAll("wt-button");
  await Promise.all([...buttons].map((button) => button.updateComplete));
  const midpoint =
    (modal.shadowRoot!.querySelector("dialog")!.getBoundingClientRect().left +
      modal.shadowRoot!.querySelector("dialog")!.getBoundingClientRect().right) /
    2;
  expect(buttons[0]!.getBoundingClientRect().right).toBeLessThan(midpoint);
  expect(buttons[1]!.getBoundingClientRect().left).toBeGreaterThan(midpoint);
});

it.each([
  ["English", en],
  ["Spanish", es],
] as const)(
  "says category, never folder, in every Products-screen string (%s)",
  (_name, strings) => {
    const screen = Object.entries(strings).filter(
      ([key]) =>
        /^(folders|catalogue|categories)\./.test(key) || key === "product.filter_ordering_all",
    );
    expect(screen.length).toBeGreaterThan(40);
    expect(screen.filter(([, text]) => /folder|carpeta/i.test(text))).toEqual([]);
  },
);

it("Move to… on a category's menu opens the move dialog for that category alone", async () => {
  const el = await mountBrowser();
  (await tableOf(el)).shadowRoot!.querySelector<HTMLElement>('[data-test="move-d"]')!.click();
  await el.updateComplete;
  expect(dialog(el)!.heading).toBe("Move 1 item");
  expect(el.shadowRoot!.querySelector("wt-combobox")!.options).toEqual([
    { value: "top", label: "No category" },
    { value: "f", label: "Food", depth: 0, valueLabel: "Food" },
  ]);
  await destination(el, "f");
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledWith(
      { productIds: [], categoryIds: ["d"] },
      "f",
    ),
  );
});

it("Esc, or leaving the box blank, adds nothing", async () => {
  const el = await mountBrowser();
  await menuAction(el, "add-category-root");
  await nameBox(el);
  await userEvent.keyboard("Tea{Escape}");
  await vi.waitFor(async () => expect(await rowKeys(el)).not.toContain("draft:new"));
  await menuAction(el, "add-category-root");
  await nameBox(el);
  await userEvent.keyboard("{Tab}");
  await vi.waitFor(async () => expect(await rowKeys(el)).not.toContain("draft:new"));
  expect(el.api.createCategory).not.toHaveBeenCalled();
});

it("makes one category from Enter pressed twice, or Enter then leaving the box", async () => {
  const el = await mountBrowser();
  let finish!: (value: CategorySummary) => void;
  vi.mocked(el.api.createCategory).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await menuAction(el, "add-category-root");
  await nameBox(el);
  await userEvent.keyboard("Juice{Enter}{Enter}{Tab}");
  finish(folder("j", "Juice", null));
  await vi.waitFor(async () => expect(await rowKeys(el)).not.toContain("draft:new"));
  expect(el.api.createCategory).toHaveBeenCalledOnce();
});

it("leaves a box opened while an earlier name was saving", async () => {
  const el = await mountBrowser();
  let finish!: (value: CategorySummary) => void;
  vi.mocked(el.api.createCategory).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await menuAction(el, "add-category-d");
  await nameBox(el);
  await userEvent.keyboard("Juice{Enter}");
  await menuAction(el, "rename-f");
  await nameBox(el);
  finish(folder("j", "Juice", "d"));
  await vi.waitFor(() => expect(el.api.createCategory).toHaveBeenCalledOnce());
  await new Promise((resolve) => setTimeout(resolve, 0));
  const table = await tableOf(el);
  expect(
    table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      'tr[data-row-key="folder:f"] wt-input[name="category-name"]',
    )!.value,
  ).toBe("Food");
});

it("saves a second name, and its box answers Enter, Esc and leaving it, while an earlier name is still saving", async () => {
  const el = await mountBrowser();
  let finish!: (value: CategorySummary) => void;
  vi.mocked(el.api.createCategory).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const table = await tableOf(el);
  const boxGone = () =>
    vi.waitFor(() =>
      expect(table.shadowRoot!.querySelector('wt-input[name="category-name"]')).toBeNull(),
    );
  await menuAction(el, "add-category-d");
  await nameBox(el);
  await userEvent.keyboard("Juice{Enter}");
  await menuAction(el, "rename-f");
  await nameBox(el);
  await userEvent.keyboard("{Escape}");
  await boxGone();
  await menuAction(el, "rename-f");
  await nameBox(el);
  await userEvent.keyboard("Fresh{Enter}");
  await boxGone();
  expect(el.api.updateCategory).toHaveBeenCalledExactlyOnceWith("f", { name: "Fresh" });
  await menuAction(el, "add-category-root");
  await nameBox(el);
  await userEvent.keyboard("Tea{Tab}");
  await boxGone();
  finish(folder("j", "Juice", "d"));
  await vi.waitFor(() =>
    expect(vi.mocked(el.api.createCategory).mock.calls).toEqual([
      [{ name: "Juice", parentId: "d" }],
      [{ name: "Tea", parentId: null }],
    ]),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(el.api.updateCategory).toHaveBeenCalledOnce();
  expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
});

it("shows a refused name at the bottom, not under a box opened since", async () => {
  const el = await mountBrowser();
  let refuse!: (reason: unknown) => void;
  vi.mocked(el.api.createCategory).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        refuse = reject;
      }),
  );
  await menuAction(el, "add-category-d");
  await nameBox(el);
  await userEvent.keyboard("Juice{Enter}");
  await menuAction(el, "rename-f");
  const box = await nameBox(el);
  refuse({ code: "category.invalid" });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe(
      codeMessage("category.invalid"),
    ),
  );
  expect(box.error).toBe("");
});

it("Add category clears a typed search, so its name box shows", async () => {
  const el = await mountBrowser();
  await typeSearch(el, "drinks");
  await menuAction(el, "add-category-d");
  await nameBox(el);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="catalogue-search"]')!
      .value,
  ).toBe("");
});

it("keeps the old name, and sends nothing more, when a refused rename is left with Esc", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.updateCategory).mockRejectedValueOnce({ code: "category.invalid" });
  await menuAction(el, "rename-d");
  const box = await nameBox(el);
  await userEvent.keyboard("Beverages{Enter}");
  await vi.waitFor(() => expect(box.error).not.toBe(""));
  await userEvent.keyboard("{Escape}");
  const table = await tableOf(el);
  await vi.waitFor(() =>
    expect(table.shadowRoot!.querySelector('wt-input[name="category-name"]')).toBeNull(),
  );
  expect(el.api.updateCategory).toHaveBeenCalledOnce();
  expect(table.shadowRoot!.querySelector('tr[data-row-key="folder:d"] strong')!.textContent).toBe(
    "Drinks",
  );
});

it("passes whether products can be added to every menu", async () => {
  const el = await mountBrowser({ canAddProduct: true });
  expect(
    (await tableOf(el))
      .shadowRoot!.querySelector('[data-test="add-product-root"]')!
      .hasAttribute("disabled"),
  ).toBe(false);
});

it("draws Filters, Select, Expand all, Customise and search on one toolbar line, in that order", async () => {
  const { page } = await import("vitest/browser");
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(1280, 720);
  try {
    const el = await mountBrowser();
    const table = await tableOf(el);
    const search = el.shadowRoot!.querySelector<HTMLElement>('[name="catalogue-search"]')!;
    const select = el.shadowRoot!.querySelector<HTMLElement>('[data-test="select"]')!;
    const toolbar = table.shadowRoot!.querySelector(".table-toolbar");
    expect(search.assignedSlot!.assignedSlot!.closest(".table-toolbar")).toBe(toolbar);
    expect(select.assignedSlot!.assignedSlot!.closest(".table-toolbar")).toBe(toolbar);
    expect(select.assignedSlot!.assignedSlot!.closest(".table-end")).toBeNull();
    const boxes = [
      table.shadowRoot!.querySelector(".filters-trigger")!,
      select,
      table.shadowRoot!.querySelector(".expand-all")!,
      table.shadowRoot!.querySelector(".columns-trigger")!,
      search,
    ].map((element) => element.getBoundingClientRect());
    for (let index = 1; index < boxes.length; index++) {
      expect(boxes[index]!.left, `item ${index}`).toBeGreaterThanOrEqual(boxes[index - 1]!.right);
      expect(boxes[index]!.top, `item ${index}`).toBeLessThan(boxes[0]!.bottom);
    }
    expect(el.shadowRoot!.querySelector(".toolbar")).toBeNull();
  } finally {
    await page.viewport(width, height);
  }
});

it("Select is an icon button named Select, with a tooltip, pressed while selecting", async () => {
  const el = await mountBrowser();
  const select = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-test="select"]')!;
  expect(select.localName).toBe("button");
  expect(select.getAttribute("type")).toBe("button");
  expect(select.getAttribute("slot")).toBe("toolbar-start");
  expect(select.getAttribute("aria-label")).toBe("Select");
  const icon = select.querySelector<HTMLElement>('wt-icon[name="select-rows"]')!;
  await (icon as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(icon.shadowRoot!.querySelector("path")).not.toBeNull();
  const tooltip = select.querySelector<HTMLElement>(".icon-tooltip")!;
  expect(tooltip.textContent!.trim()).toBe("Select");
  expect(tooltip.getAttribute("aria-hidden")).toBe("true");
  expect(getComputedStyle(tooltip).display).toBe("none");
  await userEvent.hover(select);
  expect(getComputedStyle(tooltip).display).toBe("block");
  await userEvent.keyboard("{Escape}");
  expect(getComputedStyle(tooltip).display).toBe("none");
  await userEvent.unhover(select);
  expect(select.getAttribute("aria-pressed")).toBe("false");
  await press(el, "select");
  expect(select.getAttribute("aria-pressed")).toBe("true");
  expect((await tableOf(el)).selectable).toBe(true);
});

it("names Select in Spanish", async () => {
  setLocale("es");
  const el = await mountBrowser();
  const select = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-test="select"]')!;
  expect(select.getAttribute("aria-label")).toBe(es["folders.select"]);
  expect(select.querySelector(".icon-tooltip")!.textContent!.trim()).toBe(es["folders.select"]);
});

it("pressing Select again leaves Select mode and clears the selection, as Done does", async () => {
  const el = await mountBrowser();
  await selectKeys(el, ["bread"]);
  expect(count(el)).toBe("1 selected");
  await press(el, "select");
  expect((await tableOf(el)).selectable).toBe(false);
  expect(count(el)).toBeUndefined();
  expect(el.shadowRoot!.querySelector('[data-test="select"]')!.getAttribute("aria-pressed")).toBe(
    "false",
  );
  await press(el, "select");
  expect(count(el)).toBe("0 selected");
  expect(
    (await tableOf(el)).shadowRoot!.querySelector<HTMLInputElement>(
      'tr[data-row-key="bread"] input[type="checkbox"]',
    )!.checked,
  ).toBe(false);
});

it("opens the Products table's Filters from the toolbar's start", async () => {
  const { page } = await import("vitest/browser");
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(1280, 720);
  try {
    expect(window.innerWidth).toBe(1280);
    const el = await mountBrowser();
    const table = await tableOf(el);
    const trigger = table.shadowRoot!.querySelector(".filters-trigger")!;
    expect(table.shadowRoot!.querySelector(".table-toolbar")!.firstElementChild).toBe(trigger);
    expect(trigger.getBoundingClientRect().right).toBeLessThanOrEqual(
      el.shadowRoot!.querySelector('wt-input[name="catalogue-search"]')!.getBoundingClientRect()
        .left,
    );
  } finally {
    await page.viewport(width, height);
  }
});

it("opens the Products table's Filters over the whole screen at phone width", async () => {
  const { page } = await import("vitest/browser");
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(390, 844);
  try {
    const table = await tableOf(await mountBrowser());
    await userEvent.click(table.shadowRoot!.querySelector<HTMLElement>(".filters-trigger")!);
    const panel = table.shadowRoot!.querySelector<HTMLElement>(".filters-panel")!;
    await vi.waitFor(() => expect(panel.matches(":popover-open")).toBe(true));
    expect(panel.hasAttribute("data-side")).toBe(false);
    expect(panel.hasAttribute("data-fullscreen")).toBe(true);
  } finally {
    await page.viewport(width, height);
  }
});

it("A461 keeps the selection when a filter is chosen in the panel beside the rows", async () => {
  const { page } = await import("vitest/browser");
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(1280, 720);
  try {
    const el = await mountBrowser();
    await selectKeys(el, ["bread"]);
    expect(count(el)).toBe("1 selected");
    const table = await tableOf(el);
    await userEvent.click(table.shadowRoot!.querySelector<HTMLElement>(".filters-trigger")!);
    await table.updateComplete;
    const panel = table.shadowRoot!.querySelector<HTMLElement>(".filters-panel")!;
    expect(panel.hasAttribute("data-side")).toBe(true);
    const filter = panel.querySelector<HTMLElement>('wt-combobox[data-filter="modifiers"]')!;
    await userEvent.click(filter.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    const option = [...filter.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (row) => row.textContent!.trim() === en["product.has_modifiers"],
    )!;
    await userEvent.click(option);
    await el.updateComplete;
    expect(count(el)).toBe("1 selected");
    expect(getComputedStyle(panel).display).not.toBe("none");
  } finally {
    await page.viewport(width, height);
  }
});

it("shows each filter's whole choice in the panel beside the rows, in Spanish", async () => {
  const { page } = await import("vitest/browser");
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(1280, 720);
  setLocale("es");
  try {
    const el = await mountBrowser();
    const table = await tableOf(el);
    await userEvent.click(table.shadowRoot!.querySelector<HTMLElement>(".filters-trigger")!);
    await table.updateComplete;
    const panel = table.shadowRoot!.querySelector<HTMLElement>(".filters-panel")!;
    expect(panel.hasAttribute("data-side")).toBe(true);
    const values = [...panel.querySelectorAll<HTMLElement>("wt-combobox")].map((filter) =>
      filter.shadowRoot!.querySelector<HTMLElement>(".value")!,
    );
    expect(values.map((value) => value.textContent!.trim())).toContain(
      es["product.filter_ordering_all"],
    );
    for (const value of values)
      expect(value.scrollWidth, value.textContent!.trim()).toBeLessThanOrEqual(value.clientWidth);
  } finally {
    await page.viewport(width, height);
    setLocale("en-GB");
  }
});

it("at phone width puts Filters, Select, Expand all and Customise on the first toolbar line and the search under them", async () => {
  const { page } = await import("vitest/browser");
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(390, 640);
  try {
    const el = await mountBrowser();
    const table = await tableOf(el);
    const line = [
      table.shadowRoot!.querySelector(".filters-trigger")!,
      el.shadowRoot!.querySelector('[data-test="select"]')!,
      table.shadowRoot!.querySelector(".expand-all")!,
      table.shadowRoot!.querySelector(".columns-trigger")!,
    ].map((element) => element.getBoundingClientRect());
    for (let index = 1; index < line.length; index++) {
      expect(line[index]!.left, `item ${index}`).toBeGreaterThanOrEqual(line[index - 1]!.right);
      expect(line[index]!.top, `item ${index}`).toBeLessThan(line[0]!.bottom);
    }
    const search = el
      .shadowRoot!.querySelector('[name="catalogue-search"]')!
      .getBoundingClientRect();
    expect(search.top).toBeGreaterThanOrEqual(Math.max(...line.map((box) => box.bottom)));
    const toolbar = table.shadowRoot!.querySelector(".table-toolbar")!.getBoundingClientRect();
    expect(toolbar.bottom).toBeCloseTo(search.bottom, 0);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="select"]')!.focus();
    await userEvent.tab();
    expect(table.shadowRoot!.activeElement).toBe(table.shadowRoot!.querySelector(".expand-all"));
  } finally {
    await page.viewport(width, height);
  }
});

it.each([
  [320, "en-GB"],
  [430, "en-GB"],
  [620, "en-GB"],
  [640, "en-GB"],
  [430, "es-ES"],
  [600, "es-ES"],
  [640, "es-ES"],
])(
  "in a wide window, a list %ipx wide puts the four buttons on one line and the search under them (%s)",
  async (listWidth, locale) => {
    const { page } = await import("vitest/browser");
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(1280, 720);
    setLocale(locale);
    try {
      const el = await mountBrowser();
      el.style.width = `${listWidth}px`;
      const table = await tableOf(el);
      const line = [
        table.shadowRoot!.querySelector(".filters-trigger")!,
        el.shadowRoot!.querySelector('[data-test="select"]')!,
        table.shadowRoot!.querySelector(".expand-all")!,
        table.shadowRoot!.querySelector(".columns-trigger")!,
      ].map((element) => element.getBoundingClientRect());
      for (let index = 1; index < line.length; index++) {
        expect(line[index]!.left, `item ${index}`).toBeGreaterThanOrEqual(line[index - 1]!.right);
        expect(line[index]!.top, `item ${index}`).toBeLessThan(line[0]!.bottom);
      }
      const search = el
        .shadowRoot!.querySelector('[name="catalogue-search"]')!
        .getBoundingClientRect();
      expect(search.top).toBeGreaterThanOrEqual(Math.max(...line.map((box) => box.bottom)));
      const toolbar = table.shadowRoot!.querySelector(".table-toolbar")!.getBoundingClientRect();
      expect(toolbar.bottom).toBeCloseTo(search.bottom, 0);
      expect(search.width).toBeCloseTo(toolbar.width, 0);
    } finally {
      await page.viewport(width, height);
      setLocale("en-GB");
    }
  },
);

it("keeps Filters, Select, Expand all, Customise and search on one line in a Spanish list 660px wide", async () => {
  const { page } = await import("vitest/browser");
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(1280, 720);
  setLocale("es-ES");
  try {
    const el = await mountBrowser();
    el.style.width = "660px";
    const table = await tableOf(el);
    const boxes = [
      table.shadowRoot!.querySelector(".filters-trigger")!,
      el.shadowRoot!.querySelector('[data-test="select"]')!,
      table.shadowRoot!.querySelector(".expand-all")!,
      table.shadowRoot!.querySelector(".columns-trigger")!,
      el.shadowRoot!.querySelector('[name="catalogue-search"]')!,
    ].map((element) => element.getBoundingClientRect());
    for (let index = 1; index < boxes.length; index++) {
      expect(boxes[index]!.left, `item ${index}`).toBeGreaterThanOrEqual(boxes[index - 1]!.right);
      expect(boxes[index]!.top, `item ${index}`).toBeLessThan(boxes[0]!.bottom);
    }
  } finally {
    await page.viewport(width, height);
    setLocale("en-GB");
  }
});

it("at phone width fits Select mode's controls and the table's own on two toolbar lines", async () => {
  const { page } = await import("vitest/browser");
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(390, 640);
  try {
    const el = await mountBrowser();
    await press(el, "select");
    const table = await tableOf(el);
    const boxes = [
      table.shadowRoot!.querySelector(".expand-all")!,
      ...["selected-count", "move", "delete", "cancel-selection"].map((test) =>
        el.shadowRoot!.querySelector(`[data-test="${test}"]`)!,
      ),
      table.shadowRoot!.querySelector(".columns-trigger")!,
    ]
      .map((element) => element.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);
    let lines = 0;
    let bottom = -Infinity;
    for (const box of boxes) {
      if (box.top >= bottom) lines++;
      bottom = box.top >= bottom ? box.bottom : Math.max(bottom, box.bottom);
    }
    expect(lines).toBeLessThanOrEqual(2);
  } finally {
    await page.viewport(width, height);
  }
});

it("draws the Select tooltip over the sticky headings", async () => {
  const { page } = await import("vitest/browser");
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(1280, 720);
  try {
    const el = await mountBrowser({ stickyHeader: true });
    const host = el.parentElement!;
    host.style.display = "flex";
    host.style.flexDirection = "column";
    host.style.height = "600px";
    const table = await tableOf(el);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const select = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-test="select"]')!;
    await userEvent.hover(select);
    const tooltip = select.querySelector<HTMLElement>(".icon-tooltip")!;
    const tip = tooltip.getBoundingClientRect();
    const heading = table.shadowRoot!.querySelector("thead th")!.getBoundingClientRect();
    expect(tip.bottom).toBeGreaterThan(heading.top);
    const hit = el.shadowRoot!.elementFromPoint(tip.left + 4, tip.bottom - 2);
    expect(hit !== null && tooltip.contains(hit)).toBe(true);
  } finally {
    await page.viewport(width, height);
  }
});

it("a click on the Select tooltip, where it lies over the sticky headings, leaves Select mode off; a click on its icon turns it on", async () => {
  const { page } = await import("vitest/browser");
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(1280, 720);
  try {
    const el = await mountBrowser({ stickyHeader: true });
    const host = el.parentElement!;
    host.style.display = "flex";
    host.style.flexDirection = "column";
    host.style.height = "600px";
    const table = await tableOf(el);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const select = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-test="select"]')!;
    const tooltip = select.querySelector<HTMLElement>(".icon-tooltip")!;
    await userEvent.hover(select);
    expect(table.shadowRoot!.querySelector("thead th")!.getBoundingClientRect().top).toBeLessThan(
      tooltip.getBoundingClientRect().bottom,
    );
    await userEvent.click(tooltip);
    await el.updateComplete;
    expect(select.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(select.querySelector("wt-icon")!);
    await el.updateComplete;
    expect(select.getAttribute("aria-pressed")).toBe("true");
  } finally {
    await page.viewport(width, height);
  }
});

it("Expand all opens every category, and reads Collapse all until one is closed", async () => {
  const el = await mountBrowser();
  const table = await tableOf(el);
  const button = () => table.shadowRoot!.querySelector<HTMLButtonElement>(".expand-all")!;
  expect(button().textContent!.trim()).toBe("Expand all");
  button().click();
  await table.updateComplete;
  expect(await rowKeys(el)).toEqual([
    "folder:d",
    "folder:b",
    "cola",
    "folder:f",
    "burger",
    "bread",
  ]);
  expect(button().textContent!.trim()).toBe("Collapse all");
  await toggleCategory(el, "f");
  expect(button().textContent!.trim()).toBe("Expand all");
});

it("Expand all leaves a product's variants closed, and still reads Collapse all", async () => {
  const el = await mountBrowser({
    products: [
      {
        ...PRODUCTS[0]!,
        variants: [
          {
            id: "v",
            name: "Large",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: null,
            active: true,
            available: true,
            effective: { unitPrice: "2.00", vatClass: "reduced", primaryCategoryId: "d" },
          },
        ],
      },
      ...PRODUCTS.slice(1),
    ],
  });
  const table = await tableOf(el);
  const button = () => table.shadowRoot!.querySelector<HTMLButtonElement>(".expand-all")!;
  button().click();
  await table.updateComplete;
  expect(await rowKeys(el)).toEqual([
    "folder:d",
    "folder:b",
    "cola",
    "folder:f",
    "burger",
    "bread",
  ]);
  expect(table.isExpanded("cola")).toBe(false);
  expect(button().textContent!.trim()).toBe("Collapse all");
});

it.each([390, 1280])(
  "puts selection actions in a separate bar below Search at %s px",
  async (width) => {
    const { page } = await import("vitest/browser");
    await page.viewport(width, 844);
    const el = await mountBrowser();
    await press(el, "select");
    const search = el.shadowRoot!.querySelector<HTMLElement>('wt-input[name="catalogue-search"]')!;
    const bar = el.shadowRoot!.querySelector<HTMLElement>('[data-test="selection-bar"]');
    expect(bar).not.toBeNull();
    expect(bar!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      search.getBoundingClientRect().bottom,
    );
    for (const test of ["selected-count", "move", "delete", "cancel-selection"])
      expect(
        el
          .shadowRoot!.querySelector(`[data-test="${test}"]`)!
          .closest('[data-test="selection-bar"]'),
      ).toBe(bar);
    expect(count(el)).toBe("0 selected");
    const box = (await tableOf(el)).shadowRoot!.querySelector<HTMLInputElement>(
      '[data-test="select-bread"]',
    )!;
    box.click();
    await el.updateComplete;
    expect(count(el)).toBe("1 selected");
    await press(el, "cancel-selection");
    expect(el.shadowRoot!.querySelector('[data-test="selection-bar"]')).toBeNull();
    expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector('[data-test="select"]'));
  },
);

it.each([false, true])(
  "hands stickyHeader (%s) to the Products table, which fills a bounded column only when it is set",
  async (sticky) => {
    const el = await mountBrowser({ stickyHeader: sticky });
    const host = el.parentElement!;
    host.style.display = "flex";
    host.style.flexDirection = "column";
    host.style.height = "600px";
    const table = await tableOf(el);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(el.hasAttribute("sticky-header")).toBe(sticky);
    expect(table.stickyHeader).toBe(sticky);
    const scroll = table.shadowRoot!.querySelector(".scroll")!.getBoundingClientRect();
    if (sticky) expect(scroll.bottom).toBeCloseTo(host.getBoundingClientRect().bottom, 0);
    else expect(scroll.bottom).toBeLessThan(host.getBoundingClientRect().bottom - 100);
  },
);

it.each(
  [390, 1280].flatMap((width) =>
    (["en-GB", "es-ES"] as const).flatMap((locale) =>
      (["light", "dark"] as const).map((theme) => [width, locale, theme] as const),
    ),
  ),
)("Tab follows Products toolbar's visual order at %i px (%s, %s)", async (width, locale, theme) => {
  setLocale(locale);
  onTestFinished(() => setLocale("en-GB"));
  const { page } = await import("vitest/browser");
  await page.viewport(width, 844);
  onTestFinished(() => page.viewport(1280, 844));
  const el = await mountBrowser();
  el.style.width = "100%";
  el.parentElement!.setAttribute("data-theme", theme);
  const table = await tableOf(el);
  await vi.waitFor(() => expect(table.getBoundingClientRect().width).toBeGreaterThan(0));
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  const search = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    '[name="catalogue-search"]',
  )!;
  await search.updateComplete;
  const controls = [
    table.shadowRoot!.querySelector<HTMLElement>(".filters-trigger")!,
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="select"]')!,
    table.shadowRoot!.querySelector<HTMLElement>(".expand-all")!,
    table.shadowRoot!.querySelector<HTMLElement>(".columns-trigger")!,
    search.shadowRoot!.querySelector<HTMLInputElement>("input")!,
  ];
  const drawn = [...controls].sort((a, b) => {
    const x = a.getBoundingClientRect(),
      y = b.getBoundingClientRect();
    return Math.abs(x.top - y.top) > 20 ? x.top - y.top : x.left - y.left;
  });
  const before = document.createElement("button");
  before.textContent = "Before Products";
  el.before(before);
  onTestFinished(() => before.remove());
  before.focus();
  for (const control of drawn) {
    await userEvent.keyboard("{Tab}");
    let focused = document.activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    expect(focused).toBe(control);
  }
  before.remove();
});

it.each(["products", "category"])(
  "names products and menus after a %s archive refusal",
  async (selection) => {
    const el = await mountBrowser();
    vi.mocked(el.api.deleteCatalogueItems).mockRejectedValue({
      code: "product.on_live_menu",
      params: {
        products: [
          { id: "bread", name: "Bread" },
          { id: "cola", name: "Cola" },
        ],
        menus: [
          { id: "dinner", name: "Dinner" },
          { id: "scheduled", name: "Weekend" },
        ],
      },
    });
    await toggleCategory(el, "d");
    await selectKeys(el, selection === "products" ? ["bread", "cola"] : ["folder:d"]);
    await press(el, "delete");
    if (selection === "category") {
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("input[value=delete]")).not.toBeNull(),
      );
      el.shadowRoot!.querySelector<HTMLInputElement>("input[value=delete]")!.click();
      await el.updateComplete;
    }
    await press(el, "confirm");
    await vi.waitFor(() =>
      expect(dialog(el)!.querySelector("[role=alert]")!.textContent).toBe(
        `${codeMessage("product.on_live_menu")} Products: Bread, Cola. Menus: Dinner, Weekend.`,
      ),
    );
    expect(
      el.shadowRoot!.querySelector("[data-test=confirm]")!.getAttribute("disabled"),
    ).toBeNull();
  },
);

it.each([
  ["en", "Products", "Menus"],
  ["es", "Productos", "Menús"],
])(
  "names the single product blocking a category archive (%s)",
  async (locale, productsLabel, menusLabel) => {
    setLocale(locale!);
    const el = await mountBrowser();
    vi.mocked(el.api.deleteCatalogueItems).mockRejectedValue({
      code: "product.on_live_menu",
      params: {
        products: [{ id: "cola", name: "Cola" }],
        menus: [{ id: "dinner", name: "Dinner" }],
      },
    });
    await selectKeys(el, ["folder:d"]);
    await press(el, "delete");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("input[value=delete]")).not.toBeNull(),
    );
    el.shadowRoot!.querySelector<HTMLInputElement>("input[value=delete]")!.click();
    await el.updateComplete;
    await press(el, "confirm");
    await vi.waitFor(() =>
      expect(dialog(el)!.querySelector("[role=alert]")!.textContent).toBe(
        `${codeMessage("product.on_live_menu")} ${productsLabel}: Cola. ${menusLabel}: Dinner.`,
      ),
    );
  },
);

it.each(["products", "folder"] as const)(
  "names affected extras lists for %s Archive warnings",
  async (entry) => {
    const lists = [
      ["affected", "Archive affected sauces", entry === "products" ? "bread" : "cola"],
      ["unrelated", "Archive unrelated extras", "burger"],
      ["archived", "Archive already archived extras", "lager"],
    ].map(([id, name, productId]) => ({
      id: id!,
      name: name!,
      customerName: null,
      kitchenName: null,
      active: true,
      minPicks: 0,
      maxPicks: null,
      usage: { products: 1 },
      items: [
        {
          id: `${id}-item`,
          productId: productId!,
          maxQuantity: null,
          preselected: false,
          price: null,
        },
      ],
    }));
    const el = await mountBrowser({ extraLists: lists });
    await selectKeys(el, entry === "products" ? ["bread"] : ["folder:d"]);
    await press(el, "delete");
    if (entry === "folder") {
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("input[value=delete]")).not.toBeNull(),
      );
      expect(dialog(el)!.textContent).not.toContain("Archive affected sauces");
      el.shadowRoot!.querySelector<HTMLInputElement>("input[value=delete]")!.click();
      await el.updateComplete;
    }
    expect(dialog(el)!.textContent).toContain("Archive affected sauces");
    expect(dialog(el)!.textContent).not.toContain("Archive unrelated extras");
    expect(dialog(el)!.textContent).not.toContain("Archive already archived extras");
  },
);

it("names active descendant and variant extras only when deleting folder contents, and clears them on Move up", async () => {
  const child = product("child", "Child", "b");
  child.variants = [
    {
      id: "size",
      name: "Size",
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: null,
      active: true,
      available: true,
      effective: { unitPrice: "2.00", vatClass: "reduced", primaryCategoryId: "b" },
    },
    {
      id: "old-size",
      name: "Old size",
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: null,
      active: false,
      available: true,
      effective: { unitPrice: "2.00", vatClass: "reduced", primaryCategoryId: "b" },
    },
  ];
  const lists = [
    ["child", "Descendant extras"],
    ["size", "Variant extras"],
    ["old-size", "Archived variant extras"],
    ["bread", "Selected product extras"],
  ].map(([productId, name]) => ({
    id: productId!,
    name: name!,
    customerName: null,
    kitchenName: null,
    minPicks: 0,
    maxPicks: null,
    active: false,
    items: [
      {
        id: `${productId}-item`,
        productId: productId!,
        maxQuantity: null,
        preselected: false,
        price: null,
      },
    ],
  }));
  const el = await mountBrowser({ products: [...PRODUCTS, child], extraLists: lists });
  await selectKeys(el, ["bread", "folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("input[value=delete]")).not.toBeNull(),
  );
  const warning = () => dialog(el)!.querySelector("[data-test=archive-extra-lists]")!.textContent;
  expect(warning()).toContain("Selected product extras");
  expect(warning()).not.toContain("Descendant extras");
  el.shadowRoot!.querySelector<HTMLInputElement>("input[value=delete]")!.click();
  await el.updateComplete;
  expect(warning()).toContain("Descendant extras");
  expect(warning()).toContain("Variant extras");
  expect(warning()).not.toContain("Archived variant extras");
  el.shadowRoot!.querySelector<HTMLInputElement>("input[value=move_up]")!.click();
  await el.updateComplete;
  expect(warning()).toContain("Selected product extras");
  expect(warning()).not.toContain("Descendant extras");
  expect(warning()).not.toContain("Variant extras");
  el.extraLists = [];
  await el.updateComplete;
  expect(dialog(el)!.querySelector("[data-test=archive-extra-lists]")).toBeNull();
});

it("A461 gathers Products ticks across searches and only selects shown rows", async () => {
  const el = await mountBrowser({
    products: [
      product("iced", "Iced coffee", "d"),
      product("cake", "Coffee cake", "f"),
      product("other", "Ginger tea", "d"),
    ],
  });
  const box = async (key: string) =>
    (await tableOf(el)).shadowRoot!.querySelector<HTMLInputElement>(
      `tr[data-row-key="${key}"] input[type="checkbox"]`,
    )!;
  await typeSearch(el, "iced");
  await selectKeys(el, ["iced"]);
  await typeSearch(el, "cake");
  (await box("cake")).click();
  await tableOf(el);
  expect(count(el)).toBe("2 selected");
  const all = (await tableOf(el)).shadowRoot!.querySelector<HTMLInputElement>(
    '[data-test="select-all"]',
  )!;
  all.click();
  await tableOf(el);
  expect(count(el)).toBe("1 selected");
  all.click();
  await tableOf(el);
  expect(count(el)).toBe("2 selected");
  await chooseFilter(el, "active", "inactive");
  expect(count(el)).toBe("2 selected");
  await chooseFilter(el, "active", "");
  await typeSearch(el, "");
  await toggleCategory(el, "d");
  await toggleCategory(el, "f");
  expect((await box("iced")).checked).toBe(true);
  expect((await box("cake")).checked).toBe(true);
  await press(el, "move");
  await destination(el, "top");
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["iced", "cake"], categoryIds: [] },
      null,
    ),
  );
});

it("A461 Products live narrowing keeps ticks but deletion trims the open operation", async () => {
  const el = await mountBrowser();
  await selectKeys(el, ["bread"]);
  await press(el, "move");
  el.products = PRODUCTS.map((each) =>
    each.id === "bread" ? { ...each, name: "Toast", available: false } : each,
  );
  await typeSearch(el, "bread");
  expect(count(el)).toBe("1 selected");
  expect(dialog(el)!.open).toBe(true);
  el.products = el.products.filter((each) => each.id !== "bread");
  await tableOf(el);
  expect(count(el)).toBe("0 selected");
  await vi.waitFor(() => expect(dialog(el)?.open ?? false).toBe(false));
  expect(el.api.moveCatalogueItems).not.toHaveBeenCalled();
});

it("A461 Products trims deleted categories and products from Move and resets a lost destination", async () => {
  const el = await mountBrowser();
  await selectKeys(el, ["bread", "folder:d"]);
  await press(el, "move");
  await destination(el, "f");
  el.products = PRODUCTS.filter((each) => each.id !== "bread");
  el.categories = CATEGORIES.filter((each) => each.id !== "f");
  await tableOf(el);
  expect(count(el)).toBe("1 selected");
  expect(el.shadowRoot!.querySelector("wt-combobox")!.value).toBe("");
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="confirm"]')!
      .disabled,
  ).toBe(true);
  await destination(el, "top");
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: [], categoryIds: ["d"] },
      null,
    ),
  );
});

it("A461 deleting a selected category during its summary read keeps the operation closed", async () => {
  const el = await mountBrowser();
  let answer!: (value: Awaited<ReturnType<DashboardApi["summariseFolders"]>>) => void;
  vi.mocked(el.api.summariseFolders).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  el.categories = CATEGORIES.filter((each) => each.id !== "d");
  await tableOf(el);
  expect(count(el)).toBe("0 selected");
  answer([{ id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 }]);
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="move"]')!
        .disabled,
    ).toBe(true),
  );
  await el.updateComplete;
  expect(dialog(el)?.open ?? false).toBe(false);
  expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
});

it.each([false, true])(
  "A461 pointer drag carries the hidden Products tick (clear search: %s)",
  async (clear) => {
    const el = await mountBrowser({
      products: [product("iced", "Iced coffee", "d"), product("cake", "Coffee cake", "f")],
      categories: [...CATEGORIES, folder("storage", "Cake storage", null)],
    });
    await typeSearch(el, "iced");
    await selectKeys(el, ["iced"]);
    await typeSearch(el, "cake");
    const table = await tableOf(el);
    table.shadowRoot!.querySelector<HTMLInputElement>('[data-test="select-cake"]')!.click();
    await tableOf(el);
    if (clear) {
      await typeSearch(el, "");
      await toggleCategory(el, "f");
    }
    expect(await rowKeys(el)).not.toContain("iced");
    const list = el.shadowRoot!.querySelector("dashboard-product-list")!;
    const drops: unknown[] = [];
    list.addEventListener("drop-items", (event) => drops.push((event as CustomEvent).detail));
    drag(await nameCell(el, "cake"), await nameCell(el, "folder:storage"));
    await vi.waitFor(() => expect(el.api.moveCatalogueItems).toHaveBeenCalledOnce());
    expect(drops).toEqual([{ keys: ["iced", "cake"], folderId: "storage" }]);
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["iced", "cake"], categoryIds: [] },
      "storage",
    );
  },
);
