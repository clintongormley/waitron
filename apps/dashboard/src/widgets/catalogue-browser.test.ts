import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { registerIcons } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
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
  manualAllergens: null,
  image: null,
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
    summariseFolders: vi
      .fn()
      .mockResolvedValue([
        { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 },
      ]),
    createCategory: vi.fn().mockResolvedValue(folder("new", "Juice", "d")),
    updateCategory: vi.fn().mockResolvedValue(folder("d", "Beverages", null)),
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

it("marks a category with no claim, or whose claim names a switched-off station with no fallback, and clears the mark once claimed", async () => {
  setLocale("en-GB");
  const routing = {
    stationTimes: [],
    todayEnds: null,
    clockReadable: true,
    claims: [
      {
        categoryId: "d",
        target: { kind: "station" as const, stationId: "bar" },
        stationOff: false,
      },
    ],
    exceptions: [],
    unassigned: { folders: [], products: [] },
    defaultStationId: "default",
    stations: [
      { id: "bar", name: "Bar", active: true },
      { id: "default", name: "Kitchen", active: true },
    ],
  };
  const el = await mountBrowser({ routing });
  expect(await unroutedMarker(el, "folder:d")).toBeNull();
  expect(await unroutedMarker(el, "folder:f")).not.toBeNull();
  expect((await unroutedMarker(el, "folder:f"))?.getAttribute("title")).toBe(
    "No kitchen routing rule covers this category",
  );
  await toggleCategory(el, "d");
  expect(await unroutedMarker(el, "folder:b")).toBeNull();
  el.routing = {
    ...routing,
    claims: [
      ...routing.claims,
      { categoryId: "f", target: { kind: "station", stationId: "bar" }, stationOff: false },
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
    "Ninguna regla de envío a cocina cubre esta categoría",
  );
});

it("does not mark a folder covered by a global folder exception", async () => {
  const el = await mountBrowser({
    routing: {
      stationTimes: [],
      todayEnds: null,
      clockReadable: true,
      claims: [],
      exceptions: [
        {
          id: "route-food",
          position: 0,
          zoneId: null,
          categoryId: "f",
          productId: null,
          target: { kind: "station", stationId: "kitchen" },
          neverMatches: false,
          stationOff: false,
        },
      ],
      unassigned: { folders: [], products: [] },
      defaultStationId: "kitchen",
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
const routingWith = (overrides: Partial<RoutingModel> = {}): RoutingModel => ({
  stationTimes: [],
  todayEnds: null,
  clockReadable: true,
  claims: [{ categoryId: "d", target: { kind: "station", stationId: "bar" }, stationOff: false }],
  exceptions: [],
  unassigned: { folders: [], products: [] },
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
    claims: [{ categoryId: "d", target: { kind: "no_preparation" }, stationOff: false }],
  });
  expect(await madeAtText(el, "folder:d")).toBe("No preparation set on this category");
  expect(await madeAtText(el, "folder:b")).toBe("No preparation from Drinks");
});

it("works the route out again when the products or the categories change", async () => {
  const exceptions = [
    {
      id: "e1",
      position: 0,
      zoneId: null,
      categoryId: null,
      productId: "juice",
      target: { kind: "station" as const, stationId: "kitchen" },
      neverMatches: false,
      stationOff: false,
    },
  ];
  const el = await mountBrowser({ routing: routingWith({ exceptions }) });
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

it("decides the asterisk as Made at does, following a switched-off station's fallback", async () => {
  const barOff = (fallbackStationId: string | null) =>
    routingWith({
      stations: [
        { id: "bar", name: "Bar", active: false },
        { id: "terrace", name: "Terrace", active: true },
        { id: "kitchen", name: "Kitchen", active: true },
      ],
      stationTimes: [
        {
          stationId: "bar",
          status: { open: false, why: "switched_off" },
          hours: [],
          fallbackStationId,
          today: null,
          closedSendsTo: fallbackStationId,
        },
      ],
    });
  const el = await mountBrowser({ routing: barOff("terrace") });
  await toggleCategory(el, "d");
  expect(await madeAtText(el, "folder:d")).toBe("Terrace set on this category");
  expect(await unroutedMarker(el, "folder:d")).toBeNull();
  expect(await madeAtText(el, "folder:b")).toBe("Terrace from Drinks");
  expect(await unroutedMarker(el, "folder:b")).toBeNull();
  expect(await unroutedMarker(el, "folder:f")).not.toBeNull();
  el.routing = barOff(null);
  expect(await unroutedMarker(el, "folder:d")).not.toBeNull();
  expect(await unroutedMarker(el, "folder:b")).not.toBeNull();
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

it("a dragged product stays in place, faded, under a lifted copy, and moves on the drop", async () => {
  const el = await mountBrowser();
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
  // The table turns narrow a frame after it is drawn in the 414 px test window and the rows move;
  // a drag started before then often lost its press.
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
  const from = await nameCell(el, "bread");
  const grip = from.querySelector(".drag-grip")!;
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
  await typeSearch(el, "drinks");
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
export async function chooseFilter(el: CatalogueBrowser, column: string, value: string) {
  const table = await tableOf(el);
  const select = table.shadowRoot!.querySelector<HTMLElement>(
    `wt-combobox[data-filter="${column}"]`,
  )!;
  await chooseOption(select, value);
  await table.updateComplete;
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
  await chooseFilter(el, "active", "inactive");
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:b", "folder:f"]);
  await chooseFilter(el, "ordering", "staff_only");
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
it("search keeps the categories above a match open, and clearing it restores what was open", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "f");
  await typeSearch(el, "COL");
  expect(await rowKeys(el)).toEqual(["folder:d", "cola"]);
  await typeSearch(el, "");
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "burger", "bread"]);
});
it("searches folder paths and product variant names", async () => {
  const el = await mountBrowser({
    products: [
      ...PRODUCTS,
      {
        ...PRODUCTS[0]!,
        id: "sized",
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
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:b", "sized", "cola"]);
  await typeSearch(el, "cup");
  expect(await rowKeys(el)).toEqual(["folder:d", "sized"]);
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
  ).not.toBeNull();
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
  expect(await rowKeys(el)).toEqual(["folder:d", "coffee"]);
  const table = await tableOf(el);
  table.shadowRoot!.querySelector<HTMLElement>(".tree-toggle")!.click();
  await table.updateComplete;
  expect(await rowKeys(el)).toEqual(["folder:d", "coffee", "coffee:large"]);
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
it("leaves selection mode on Cancel and restores the ordinary toolbar with no selected keys", async () => {
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
  await chooseFilter(el, "active", "inactive");
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:f"]);
  expect(
    (await tableOf(el)).shadowRoot!.querySelector(`tr[data-row-key="${ROOT_KEY}"]`),
  ).not.toBeNull();
  expect((await tableOf(el)).shadowRoot!.querySelector(".empty")).toBeNull();
});
it.each(["search", "filter"])(
  "clears selection on %s and keeps selection mode on",
  async (trigger) => {
    const el = await mountBrowser();
    await selectKeys(el, ["bread"]);
    if (trigger === "search") await typeSearch(el, "bread");
    if (trigger === "filter") await chooseFilter(el, "active", "inactive");
    await el.updateComplete;
    expect(count(el)).toBe("0 selected");
    expect((await tableOf(el)).selectable).toBe(true);
    expect(
      el.shadowRoot!.querySelector("[data-test=move]")!.getAttribute("disabled"),
    ).not.toBeNull();
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
    { value: "top", label: "All products (top level)" },
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
it("lists move destinations as the category tree, each level in label order, after the top level, leaving out the moved subtree", async () => {
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
    { value: "top", label: "All products (top level)" },
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
  await selectKeys(el, ["folder:f"]);
  await press(el, "move");
  expect(el.shadowRoot!.querySelector("wt-combobox")!.options).toEqual([
    { value: "top", label: "All products (top level)" },
  ]);
});
it.each([
  ["en-GB", "Search", "No results"],
  ["es", "Buscar", "Sin resultados"],
])(
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
    await userEvent.fill(search, "mains");
    await combo.updateComplete;
    const rows = () =>
      [...combo.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].map((row) =>
        row.textContent!.trim(),
      );
    expect(rows()).toEqual(["Dinner › Mains", "Lunch › Mains"]);
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
      [{ id: "f", folders: 0, activeProducts: 0, routes: 0, ownRoutes: 0 }],
    ),
  );
  expect(dialog(el)).toBeNull();
  expect(count(el)).toBe("0 selected");
});
it.each(["network", "missing", "partial"])(
  "keeps deletion disabled on %s summary",
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
    expect(
      el.shadowRoot!.querySelector("[data-test=confirm]")!.getAttribute("disabled"),
    ).not.toBeNull();
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
      [{ id: "d", folders: 1, activeProducts: 2, routes: 1, ownRoutes: 1 }],
    ),
  );
});
it.each([
  [
    "en-GB",
    "1 kitchen routing rule names these categories and will be removed.",
    "3 kitchen routing rules name these categories or ones inside them and will be removed.",
  ],
  [
    "es",
    "1 regla de envío a cocina nombra estas categorías y se eliminará.",
    "3 reglas de envío a cocina nombran estas categorías o las que hay dentro de ellas y se eliminarán.",
  ],
] as const)(
  "counts under each choice only the routing rules that choice removes, and says deleting includes the ones inside (%s)",
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
    el.shadowRoot!.querySelector<HTMLInputElement>("input[value=delete]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(deleteToo);
    expect(el.shadowRoot!.textContent).not.toContain(moveUp);
    el.shadowRoot!.querySelector<HTMLInputElement>("input[value=move_up]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(moveUp);
  },
);
it("warns of no routing rules when moving contents up keeps every one, and of the subtree's when deleting it", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 2, ownRoutes: 0 },
  ]);
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  expect(el.shadowRoot!.textContent).not.toContain("kitchen routing rule");
  el.shadowRoot!.querySelector<HTMLInputElement>("input[value=delete]")!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain(
    "2 kitchen routing rules name these categories or ones inside them",
  );
});
it("moving contents up counts the own rules of every selected category, a subcategory selected with its parent included", async () => {
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
    "4 kitchen routing rules name these categories or ones inside them",
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
  ["en-GB", ["Mains (2 of 3)", "Drinks / Beer"]],
  ["es", ["Mains (2 de 3)", "Drinks / Beer"]],
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
    "Food / Mains (2 of 2)",
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
it("asks before deleting a category holding only inactive products, and counts none of them as deleted", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "f", folders: 0, products: 1, activeProducts: 0, routes: 0, ownRoutes: 0 },
  ]);
  await selectKeys(el, ["folder:f"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  expect(el.shadowRoot!.querySelector("input[value=delete]")!.parentElement!.textContent).toContain(
    "0 categories and 0 products",
  );
  expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
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
      [{ id: "d", folders: 2, activeProducts: 3, routes: 1, ownRoutes: 1 }],
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
    [{ id: "d", folders: 1, activeProducts: 2, routes: 1, ownRoutes: 1 }],
  );
});
it("sends the counts the dialog showed with the delete, one entry per selected category", async () => {
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
        { id: "f", folders: 3, activeProducts: 4, routes: 0, ownRoutes: 0 },
        { id: "b", folders: 0, activeProducts: 1, routes: 2, ownRoutes: 2 },
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
    [{ id: "d", folders: 1, activeProducts: 2, routes: 1, ownRoutes: 1 }],
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
    [{ id: "d", folders: 2, activeProducts: 3, routes: 1, ownRoutes: 1 }],
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
  expect(el.shadowRoot!.querySelector("input[value=delete]")!.parentElement!.textContent).toContain(
    "0 categories and 1 product",
  );
  expect(el.api.deleteCatalogueItems).toHaveBeenCalledExactlyOnceWith(
    { productIds: [], categoryIds: ["f"] },
    "move_up",
    [{ id: "f", folders: 0, activeProducts: 0, routes: 0, ownRoutes: 0 }],
  );
});
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
      [{ id: "d", folders: 1, activeProducts: 2, routes: 1, ownRoutes: 1 }],
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
      [{ id: "m1", folders: 0, activeProducts: 0, routes: 0, ownRoutes: 0 }],
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
it.each([1, 2])("confirms %i product deletion with inactive and sales wording", async (number) => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  await selectKeys(el, number === 1 ? ["bread"] : ["bread", "cola"]);
  await press(el, "delete");
  expect(dialog(el)!.heading).toBe(number === 1 ? "Delete 1 product?" : "Delete 2 products?");
  expect(el.shadowRoot!.textContent).toContain("past sales");
  expect(el.shadowRoot!.textContent).toContain("inactive");
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith(
      { productIds: number === 1 ? ["bread"] : ["bread", "cola"], categoryIds: [] },
      "move_up",
      [],
    ),
  );
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
  await typeSearch(el, "Drinks");
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
        { id: "d", folders: 1, activeProducts: 2, routes: 1, ownRoutes: 0 },
        { id: "b", folders: 0, activeProducts: 1, routes: 1, ownRoutes: 1 },
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

it("keeps the captured Delete request when Cancel exits selection during the summary read", async () => {
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
      [{ id: "f", folders: 0, activeProducts: 0, routes: 0, ownRoutes: 0 }],
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
    { value: "top", label: "All products (top level)" },
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
  await typeSearch(el, "cola");
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

it("draws Filters, Select, search, Expand all and Customise on one toolbar line, in that order", async () => {
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
      search,
      table.shadowRoot!.querySelector(".expand-all")!,
      table.shadowRoot!.querySelector(".columns-trigger")!,
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

it("pressing Select again leaves Select mode and clears the selection, as Cancel does", async () => {
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
  const el = await mountBrowser();
  const table = await tableOf(el);
  expect(table.leadingFilters).toBe(true);
  expect(table.shadowRoot!.querySelector(".table-toolbar")!.firstElementChild).toBe(
    table.shadowRoot!.querySelector(".filters-trigger"),
  );
});

it("clears the selection when a filter is chosen in the panel beside the rows", async () => {
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
    const filter = panel.querySelector<HTMLElement>('wt-combobox[data-filter="active"]')!;
    await userEvent.click(filter.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    const option = [...filter.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (row) => row.textContent!.trim() === en["product.inactive_badge"],
    )!;
    await userEvent.click(option);
    await el.updateComplete;
    expect(count(el)).toBe("0 selected");
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
    expect(el.shadowRoot!.activeElement).toBe(
      el.shadowRoot!.querySelector('[name="catalogue-search"]'),
    );
  } finally {
    await page.viewport(width, height);
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

it("puts Select mode's count, Move to…, Delete and Cancel at the toolbar's end", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  const end = (await tableOf(el)).shadowRoot!.querySelector(".table-end")!;
  for (const test of ["selected-count", "move", "delete", "cancel-selection"]) {
    const control = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`)!;
    expect(
      control.closest('[slot="toolbar-end"]')!.assignedSlot!.assignedSlot!.closest(".table-end"),
      test,
    ).toBe(end);
  }
});

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
