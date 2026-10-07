import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { CellAddress, RouteTarget, RoutingCell } from "../routing.js";
import type { RoutingView } from "./routing-client.js";
import type { RoutingGrid } from "./routing-grid.js";
import "./routing-grid.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(async () => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
  await page.viewport(1280, 800);
});

const station = (stationId: string): RouteTarget => ({ kind: "station", stationId });
const NO_PREP: RouteTarget = { kind: "no_preparation" };

/**
 * Kitchen is the default. Old kitchen is disabled and falls back to Kitchen. Drinks go to the Bar
 * everywhere, Cocktails to the Terrace bar on the Terrace, Burger is set to Kitchen (equal to what
 * it would inherit), Food on the Inside goes to the disabled Old kitchen, and nothing on the
 * Terrace is prepared unless a row says otherwise.
 */
function routing(overrides: Partial<RoutingView> = {}): RoutingView {
  const cells: RoutingCell[] = [
    { row: { kind: "category", categoryId: "drinks" }, zoneId: null, target: station("bar") },
    {
      row: { kind: "category", categoryId: "cocktails" },
      zoneId: "terrace",
      target: station("tbar"),
    },
    { row: { kind: "product", productId: "burger" }, zoneId: null, target: station("kitchen") },
    { row: { kind: "category", categoryId: "food" }, zoneId: "inside", target: station("old") },
    { row: { kind: "all" }, zoneId: "terrace", target: NO_PREP },
  ];
  return {
    stationTimes: [
      {
        stationId: "old",
        status: { open: false, why: "switched_off" },
        nextTransition: null,
        hours: [],
        fallbackStationId: "kitchen",
        today: null,
        closedSendsTo: "kitchen",
      },
    ],
    todayEnds: null,
    clockReadable: true,
    zones: [
      { id: "terrace", name: "Terrace" },
      { id: "inside", name: "Inside" },
    ],
    categories: [
      { id: "drinks", name: "Drinks", parentId: null },
      { id: "cocktails", name: "Cocktails", parentId: "drinks" },
      { id: "food", name: "Food", parentId: null },
    ],
    products: [
      { id: "mojito", name: "Mojito", categoryId: "cocktails" },
      { id: "cola", name: "Cola", categoryId: "drinks" },
      { id: "burger", name: "Burger", categoryId: "food" },
      { id: "bread", name: "Bread", categoryId: null },
    ],
    cells,
    defaultStationId: "kitchen",
    stations: [
      { id: "kitchen", name: "Kitchen", active: true },
      { id: "bar", name: "Bar", active: true },
      { id: "tbar", name: "Terrace bar", active: true },
      { id: "old", name: "Old kitchen", active: false },
    ],
    canMakeDefault: true,
    ...overrides,
  };
}

interface Emitted {
  changes: { address: CellAddress; target: RouteTarget | null }[];
  defaults: { stationId: string }[];
}

async function mount(
  model: RoutingView = routing(),
  props: Partial<RoutingGrid> = {},
): Promise<{ el: RoutingGrid; emitted: Emitted }> {
  const host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = document.createElement("venue-routing-grid");
  Object.assign(el, { model, ...props });
  const emitted: Emitted = { changes: [], defaults: [] };
  el.addEventListener("routing-cell-change", (event) =>
    emitted.changes.push((event as CustomEvent<Emitted["changes"][number]>).detail),
  );
  el.addEventListener("routing-make-default", (event) =>
    emitted.defaults.push((event as CustomEvent<{ stationId: string }>).detail),
  );
  host.append(el);
  await el.updateComplete;
  return { el, emitted };
}

const root = (el: RoutingGrid) => el.shadowRoot!;
const bodyRows = (el: RoutingGrid) => [...root(el).querySelectorAll("tbody tr")];
const rowLabels = (el: RoutingGrid) =>
  bodyRows(el).map((row) => row.querySelector("th")!.textContent!.replace(/\s+/g, " ").trim());
const cell = (el: RoutingGrid, row: string, zone: string) =>
  root(el).querySelector<HTMLElement>(`td[data-row="${row}"][data-zone="${zone}"]`)!;
type Combo = HTMLElement & { value: string; updateComplete: Promise<unknown> };
const combo = (el: RoutingGrid, row: string, zone: string) =>
  cell(el, row, zone).querySelector<Combo>('wt-combobox[name="routing-target"]');
const trigger = (box: Combo) => box.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!;
/** The text the shared field actually draws on its closed trigger, and whether it is muted. */
const shown = (box: Combo) => {
  const value = trigger(box).querySelector(".value")!;
  return { text: value.textContent!.trim(), muted: value.classList.contains("placeholder") };
};
const optionLabels = (box: Combo) =>
  [...box.shadowRoot!.querySelectorAll('[role="option"]')].map((o) => o.textContent!.trim());

async function choose(box: Combo, label: string): Promise<void> {
  await userEvent.click(trigger(box));
  const option = [...box.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (o) => o.textContent!.trim() === label,
  )!;
  await userEvent.click(option);
  await box.updateComplete;
}

describe("venue-routing-grid", () => {
  it("Expand all and Collapse all change the rendered rows and counts, and focus stays on the trigger", async () => {
    const { el } = await mount();
    expect(rowLabels(el)).toEqual([
      "All categories",
      "▸ Drinks 2 more products",
      "Drinks › ▸ Cocktails 1 more product",
      "▸ Food",
      "Food › Burger",
      "No category",
      "Bread",
    ]);
    const drinks = root(el).querySelector<HTMLButtonElement>('button[data-category="drinks"]')!;
    expect(drinks.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(drinks);
    await el.updateComplete;
    expect(drinks.getAttribute("aria-expanded")).toBe("true");
    expect(root(el).activeElement).toBe(drinks);
    expect(rowLabels(el)).toEqual([
      "All categories",
      "▾ Drinks",
      "▸ Cocktails 1 more product",
      "Cola",
      "▸ Food",
      "Food › Burger",
      "No category",
      "Bread",
    ]);

    const expandAll = root(el).querySelector<HTMLElement>('[data-test="expand-all"]')!;
    await userEvent.click(expandAll);
    await el.updateComplete;
    expect(rowLabels(el)).toEqual([
      "All categories",
      "▾ Drinks",
      "▾ Cocktails",
      "Mojito",
      "Cola",
      "▾ Food",
      "Burger",
      "No category",
      "Bread",
    ]);
    expect(root(el).activeElement).toBe(expandAll);

    const collapseAll = root(el).querySelector<HTMLElement>('[data-test="collapse-all"]')!;
    await userEvent.click(collapseAll);
    await el.updateComplete;
    expect(rowLabels(el)[1]).toBe("▸ Drinks 2 more products");
    expect(root(el).activeElement).toBe(collapseAll);
  });

  it("orders columns Every zone then zones, and rows All then the tree then No category", async () => {
    const { el } = await mount();
    const headers = [...root(el).querySelectorAll("thead th")].map((th) => th.textContent!.trim());
    expect(headers).toEqual(["Category or product", "Every zone", "Terrace", "Inside"]);
    for (const th of root(el).querySelectorAll("thead th"))
      expect(th.getAttribute("scope")).toBe("col");
    expect(root(el).querySelector("table")).not.toBeNull();
    const order = bodyRows(el).map((row) => row.querySelector("th")!.getAttribute("scope"));
    expect(order[0]).toBe("row");
    expect(rowLabels(el)[0]).toBe("All categories");
    expect(rowLabels(el).at(-2)).toBe("No category");
    expect(rowLabels(el).at(-1)).toBe("Bread");
    expect([...bodyRows(el)[0]!.querySelectorAll("td")].map((td) => td.dataset.zone)).toEqual([
      "every",
      "terrace",
      "inside",
    ]);
  });

  it("shows inherited results muted and explicit ones normal, including explicit-equal", async () => {
    const { el } = await mount(routing(), {});
    root(el).querySelector<HTMLElement>('[data-test="expand-all"]')!.click();
    await el.updateComplete;
    // Explicit.
    expect(shown(combo(el, "c:drinks", "every")!)).toEqual({ text: "Bar", muted: false });
    // Inherited from Drinks × Every zone: a category's own Every zone beats All × Terrace.
    expect(shown(combo(el, "p:cola", "terrace")!)).toEqual({ text: "Bar", muted: true });
    // Inherited from Cocktails × Terrace.
    expect(shown(combo(el, "p:mojito", "terrace")!)).toEqual({ text: "Terrace bar", muted: true });
    // Explicit Kitchen, equal to the default it would otherwise inherit.
    expect(shown(combo(el, "p:burger", "every")!)).toEqual({ text: "Kitchen", muted: false });
    // Same-row Every zone counts as inherited for a zone cell.
    expect(shown(combo(el, "p:burger", "terrace")!)).toEqual({ text: "Kitchen", muted: true });
    // Inherited No preparation from All × Terrace; never blank.
    expect(shown(combo(el, "p:bread", "terrace")!)).toEqual({
      text: "No preparation",
      muted: true,
    });
    expect(shown(combo(el, "p:bread", "every")!)).toEqual({ text: "Kitchen", muted: true });
    expect(shown(combo(el, "all", "terrace")!)).toEqual({ text: "No preparation", muted: false });
    // The accessible label names the row path, the zone, the value and whether it is set here.
    const mojito = trigger(combo(el, "p:mojito", "terrace")!);
    expect(mojito.getAttribute("aria-label")).toBe(
      "Drinks › Cocktails › Mojito, Terrace: Terrace bar, inherited",
    );
    expect(trigger(combo(el, "c:drinks", "every")!).getAttribute("aria-label")).toBe(
      "Drinks, Every zone: Bar, set here",
    );
  });

  it("the first option clears, then active stations, then No preparation; an inactive saved station is described, not offered", async () => {
    const { el } = await mount();
    root(el).querySelector<HTMLElement>('[data-test="expand-all"]')!.click();
    await el.updateComplete;
    const box = combo(el, "p:cola", "every")!;
    expect(optionLabels(box)).toEqual([
      "Clear setting",
      "Kitchen",
      "Bar",
      "Terrace bar",
      "No preparation",
    ]);
    const food = cell(el, "c:food", "inside");
    const old = combo(el, "c:food", "inside")!;
    expect(optionLabels(old)).not.toContain("Old kitchen");
    // The disabled station is named, warned about and its fallback outcome given, beside the field.
    const warning = food.querySelector('[data-test="disabled-target"]')!;
    expect(warning.textContent!.replace(/\s+/g, " ").trim()).toBe(
      "Old kitchen: Disabled. Its work goes to Kitchen.",
    );
    expect(shown(old).text).toBe("Old kitchen");
    expect(trigger(old).getAttribute("aria-label")).toBe(
      "Food, Inside: Old kitchen (Disabled), set here",
    );
  });

  it("an inactive saved station with no replacement says the till asks", async () => {
    const model = routing({
      stationTimes: [
        {
          stationId: "old",
          status: { open: false, why: "switched_off" },
          nextTransition: null,
          hours: [],
          fallbackStationId: null,
          today: null,
          closedSendsTo: null,
        },
      ],
    });
    const { el } = await mount(model);
    const warning = cell(el, "c:food", "inside").querySelector('[data-test="disabled-target"]')!;
    expect(warning.textContent!.replace(/\s+/g, " ").trim()).toBe(
      "Old kitchen: Disabled. No replacement: the till will ask where to send its dishes.",
    );
  });

  it("the disabled-station warning says Deshabilitada in Spanish", async () => {
    setLocale("es");
    const { el } = await mount();
    const warning = cell(el, "c:food", "inside").querySelector('[data-test="disabled-target"]')!;
    expect(warning.textContent).toContain("Deshabilitada");
    expect(rowLabels(el)).toContain("Sin categoría");
    expect(rowLabels(el)[0]).toBe("Todas las categorías");
  });

  it("blank emits target null; No preparation emits the no_preparation target", async () => {
    const { el, emitted } = await mount();
    const drinks = combo(el, "c:drinks", "every")!;
    await choose(drinks, "Clear setting");
    expect(emitted.changes).toEqual([
      { address: { row: { kind: "category", categoryId: "drinks" }, zoneId: null }, target: null },
    ]);
    // Until the model answers, the field shows what the row would inherit once cleared.
    expect(shown(drinks)).toEqual({ text: "Kitchen", muted: true });

    const bread = combo(el, "p:bread", "inside")!;
    await choose(bread, "No preparation");
    expect(shown(bread)).toEqual({ text: "No preparation", muted: false });
    await choose(bread, "Bar");
    expect(emitted.changes.slice(1)).toEqual([
      {
        address: { row: { kind: "product", productId: "bread" }, zoneId: "inside" },
        target: { kind: "no_preparation" },
      },
      {
        address: { row: { kind: "product", productId: "bread" }, zoneId: "inside" },
        target: { kind: "station", stationId: "bar" },
      },
    ]);
    expect(shown(bread)).toEqual({ text: "Bar", muted: false });
  });

  it("choosing the value already saved emits nothing", async () => {
    const { el, emitted } = await mount();
    await choose(combo(el, "c:drinks", "every")!, "Bar");
    expect(emitted.changes).toEqual([]);
  });

  it("Enter/Space opens, Escape cancels and restores focus", async () => {
    const { el, emitted } = await mount();
    const box = combo(el, "c:drinks", "every")!;
    const button = trigger(box);
    const popup = box.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    button.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
    expect(box.shadowRoot!.activeElement).toBe(button);
    await userEvent.keyboard(" ");
    await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
    expect(box.shadowRoot!.activeElement).toBe(button);
    expect(emitted.changes).toEqual([]);
    expect(shown(box)).toEqual({ text: "Bar", muted: false });
  });

  it("All × Every zone: Make default choices with canMakeDefault; read-only explanation without; repair message when no active default", async () => {
    const { el, emitted } = await mount();
    const box = combo(el, "all", "every")!;
    expect(shown(box)).toEqual({ text: "Kitchen", muted: false });
    expect(optionLabels(box)).toEqual(["Kitchen", "Bar", "Terrace bar"]);
    await choose(box, "Bar");
    expect(emitted.defaults).toEqual([{ stationId: "bar" }]);
    expect(emitted.changes).toEqual([]);

    const readOnly = await mount(routing({ canMakeDefault: false }));
    const fixed = cell(readOnly.el, "all", "every");
    expect(fixed.querySelector("wt-combobox")).toBeNull();
    expect(fixed.textContent!.replace(/\s+/g, " ").trim()).toBe(
      "Kitchen Only someone who can configure the venue can change the default station.",
    );

    const repair = await mount(routing({ defaultStationId: null }));
    const missing = cell(repair.el, "all", "every");
    expect(missing.querySelector('[data-test="default-repair"]')!.textContent!.trim()).toBe(
      "There is no default station. Choose one so that work no other cell sends anywhere has somewhere to go.",
    );
    const choices = combo(repair.el, "all", "every")!;
    expect(optionLabels(choices)).toEqual(["Kitchen", "Bar", "Terrace bar"]);
    await choose(choices, "Terrace bar");
    expect(repair.emitted.defaults).toEqual([{ stationId: "tbar" }]);

    const stuck = await mount(routing({ defaultStationId: null, canMakeDefault: false }));
    const none = cell(stuck.el, "all", "every");
    expect(none.querySelector("wt-combobox")).toBeNull();
    expect(none.querySelector('[data-test="default-repair"]')).not.toBeNull();
    expect(none.textContent).toContain(
      "Only someone who can configure the venue can change the default station.",
    );
  });

  it("a server refusal shows beside the field and once in the bottom action message, and retry stays enabled", async () => {
    const message = "This station was disabled. Choose another.";
    const address: CellAddress = { row: { kind: "category", categoryId: "drinks" }, zoneId: null };
    const { el, emitted } = await mount(routing(), { refusal: { address, message } });
    const box = combo(el, "c:drinks", "every")!;
    expect(box.shadowRoot!.querySelector("[data-error]")!.textContent!.trim()).toBe(message);
    const actions = root(el).querySelector<HTMLElement & { error: string }>("wt-form-actions")!;
    expect(actions.error).toBe(message);
    // Nowhere else: only one field and the bottom message carry it.
    const carrying = [...root(el).querySelectorAll<Combo>("wt-combobox")].filter(
      (other) => (other as unknown as { error: string }).error !== "",
    );
    expect(carrying).toEqual([box]);
    expect(trigger(box).disabled).toBe(false);
    await choose(box, "Kitchen");
    expect(emitted.changes).toEqual([
      { address, target: { kind: "station", stationId: "kitchen" } },
    ]);

    el.refusal = null;
    await el.updateComplete;
    expect(actions.error).toBe("");
    expect((box as unknown as { error: string }).error).toBe("");
  });

  it("renders no editor for the No category heading", async () => {
    const { el } = await mount();
    const heading = bodyRows(el).find((row) => row.textContent!.trim() === "No category")!;
    expect(heading.querySelector("wt-combobox")).toBeNull();
    expect(heading.querySelector("button")).toBeNull();
    expect(heading.querySelectorAll("td[data-row]")).toHaveLength(0);
    // Every editor in the grid addresses a real row: All categories, a category or a product.
    for (const td of root(el).querySelectorAll<HTMLElement>("td[data-row]")) {
      expect(td.dataset.row).toMatch(/^(all|c:.+|p:.+)$/);
    }
  });

  it("scrolls sideways at phone width with the row labels kept in view", async () => {
    await page.viewport(390, 800);
    const { el } = await mount();
    const scroller = root(el).querySelector<HTMLElement>('[data-test="grid-scroll"]')!;
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    const label = bodyRows(el)[0]!.querySelector("th")!;
    expect(getComputedStyle(label).position).toBe("sticky");
    scroller.scrollLeft = 200;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(label.getBoundingClientRect().left).toBeCloseTo(
      scroller.getBoundingClientRect().left + scroller.clientLeft,
      0,
    );
  });
});
