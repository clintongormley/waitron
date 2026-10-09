import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { CellAddress, RouteTarget, RoutingCell } from "../routing.js";
import type { RoutingView } from "../routing.js";
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
    periods: [],
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
    expect(optionLabels(box).join()).not.toContain("Old kitchen");
    const food = cell(el, "c:food", "inside");
    const old = combo(el, "c:food", "inside")!;
    // The disabled station is named, warned about and its fallback outcome given, beside the field.
    const warning = food.querySelector('[data-test="disabled-target"]')!;
    expect(warning.textContent!.replace(/\s+/g, " ").trim()).toBe(
      "Old kitchen: Disabled. Its work goes to Kitchen.",
    );
    expect(trigger(old).getAttribute("aria-label")).toBe(
      "Food, Inside: Old kitchen (Disabled), set here",
    );
  });

  it("a saved disabled station is drawn as the saved value, never muted, and cannot be chosen again", async () => {
    const { el, emitted } = await mount();
    const old = combo(el, "c:food", "inside")!;
    // Muted means no saved cell; this cell has one.
    expect(shown(old)).toEqual({ text: "Old kitchen (Disabled)", muted: false });
    expect(old.value).toBe("station:old");
    await userEvent.click(trigger(old));
    const rows = [...old.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')];
    const state = rows.map((row) => [
      row.textContent!.trim(),
      row.getAttribute("aria-selected"),
      row.getAttribute("aria-disabled"),
    ]);
    expect(state).toEqual([
      ["Clear setting", "false", null],
      ["Kitchen", "false", null],
      ["Bar", "false", null],
      ["Terrace bar", "false", null],
      ["Old kitchen (Disabled)", "true", "true"],
      ["No preparation", "false", null],
    ]);
    // A real pointer refuses an aria-disabled row outright, so press it directly, and by keyboard.
    rows[4]!.click();
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    expect(emitted.changes).toEqual([]);
    expect(old.value).toBe("station:old");
    expect(shown(old)).toEqual({ text: "Old kitchen (Disabled)", muted: false });
  });

  it("a saved disabled station is drawn with its Spanish disabled wording", async () => {
    setLocale("es");
    const { el } = await mount();
    const old = combo(el, "c:food", "inside")!;
    await old.updateComplete;
    expect(shown(old)).toEqual({ text: "Old kitchen (Deshabilitada)", muted: false });
  });

  it("a saved disabled station is repaired by Clear setting or by an active station", async () => {
    const address: CellAddress = {
      row: { kind: "category", categoryId: "food" },
      zoneId: "inside",
    };
    const { el, emitted } = await mount();
    await choose(combo(el, "c:food", "inside")!, "Clear setting");
    await choose(combo(el, "c:food", "inside")!, "Bar");
    expect(emitted.changes).toEqual([
      { address, target: null },
      { address, target: { kind: "station", stationId: "bar" } },
    ]);
  });

  it("the fallback line follows the fallback chain with no time applied, not the model's current answer", async () => {
    // Old kitchen falls back to the Terrace bar, closed at the model's time so that right now its
    // work reaches the Bar; the line describes the station chain, which ends at the Terrace bar.
    const model = routing({
      stationTimes: [
        {
          stationId: "old",
          status: { open: false, why: "switched_off" },
          nextTransition: null,
          hours: [],
          fallbackStationId: "tbar",
          today: null,
          closedSendsTo: "bar",
        },
        {
          stationId: "tbar",
          status: { open: false, why: "closed_by_hand" },
          nextTransition: null,
          hours: [],
          fallbackStationId: "bar",
          today: "closed",
          closedSendsTo: "bar",
        },
      ],
    });
    const { el } = await mount(model);
    const warning = cell(el, "c:food", "inside").querySelector('[data-test="disabled-target"]')!;
    expect(warning.textContent!.replace(/\s+/g, " ").trim()).toBe(
      "Old kitchen: Disabled. Its work goes to Terrace bar.",
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
    // As the screen does: the choice it is previewing is shown until it settles.
    el.addEventListener("routing-cell-change", (event) => {
      el.pending = (event as CustomEvent<NonNullable<RoutingGrid["pending"]>>).detail;
    });
    const drinks = combo(el, "c:drinks", "every")!;
    await choose(drinks, "Clear setting");
    expect(emitted.changes).toEqual([
      { address: { row: { kind: "category", categoryId: "drinks" }, zoneId: null }, target: null },
    ]);
    // While the clear is pending, the field shows what the row would inherit once cleared.
    await el.updateComplete;
    expect(shown(drinks)).toEqual({ text: "Kitchen", muted: true });
    expect(drinks.value).toBe("");

    const bread = combo(el, "p:bread", "inside")!;
    await choose(bread, "No preparation");
    await el.updateComplete;
    expect(shown(bread)).toEqual({ text: "No preparation", muted: false });
    // One pending choice at a time: Drinks is back to its saved value.
    expect(shown(drinks)).toEqual({ text: "Bar", muted: false });
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
    await el.updateComplete;
    expect(shown(bread)).toEqual({ text: "Bar", muted: false });
    expect(bread.value).toBe("station:bar");
  });

  it("after a choice the field shows the saved value again unless the host sets it pending", async () => {
    const { el, emitted } = await mount();
    const model = el.model!;
    const drinks = combo(el, "c:drinks", "every")!;
    await choose(drinks, "Clear setting");
    expect(emitted.changes).toHaveLength(1);
    await el.updateComplete;
    expect(shown(drinks)).toEqual({ text: "Bar", muted: false });
    expect(drinks.value).toBe("station:bar");

    // A cancelled preview: the host clears pending and hands back the very same model.
    el.pending = { address: emitted.changes[0]!.address, target: null };
    await el.updateComplete;
    expect(shown(drinks)).toEqual({ text: "Kitchen", muted: true });
    el.pending = null;
    el.model = model;
    await el.updateComplete;
    expect(shown(drinks)).toEqual({ text: "Bar", muted: false });
    expect(drinks.value).toBe("station:bar");
  });

  it("a pending choice survives a refresh that replaces the model, and only at its own address", async () => {
    const address: CellAddress = { row: { kind: "product", productId: "bread" }, zoneId: "inside" };
    const { el } = await mount(routing(), {
      pending: { address, target: { kind: "station", stationId: "bar" } },
    });
    const bread = combo(el, "p:bread", "inside")!;
    expect(shown(bread)).toEqual({ text: "Bar", muted: false });
    el.model = structuredClone(el.model!);
    await el.updateComplete;
    expect(shown(bread)).toEqual({ text: "Bar", muted: false });
    expect(trigger(bread).getAttribute("aria-label")).toBe("Bread, Inside: Bar, set here");
    expect(shown(combo(el, "p:bread", "terrace")!)).toEqual({
      text: "No preparation",
      muted: true,
    });
    el.pending = null;
    await el.updateComplete;
    expect(shown(bread)).toEqual({ text: "Kitchen", muted: true });
  });

  it("removing a zone destroys its open editor instead of handing it to the neighbouring zone", async () => {
    const { el, emitted } = await mount();
    const box = combo(el, "c:drinks", "terrace")!;
    const popup = box.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    await userEvent.click(trigger(box));
    await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
    el.model = routing({ zones: [{ id: "inside", name: "Inside" }] });
    await el.updateComplete;
    expect(box.isConnected).toBe(false);
    expect(combo(el, "c:drinks", "inside")).not.toBe(box);
    expect(root(el).querySelector('td[data-zone="terrace"]')).toBeNull();
    const headers = [...root(el).querySelectorAll("thead th")].map((th) => th.textContent!.trim());
    expect(headers).toEqual(["Category or product", "Every zone", "Inside"]);
    // A pick in the departed editor reaches nobody.
    const kitchen = [...box.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.textContent!.trim() === "Kitchen",
    )!;
    kitchen.click();
    await el.updateComplete;
    expect(emitted.changes).toEqual([]);
  });

  it("the grid's events reach an ancestor outside it, and the inner field's change event does not", async () => {
    const { el } = await mount();
    const outside = el.parentElement!;
    const heard: string[] = [];
    for (const name of ["routing-cell-change", "routing-make-default", "wt-change"]) {
      outside.addEventListener(name, () => heard.push(name));
    }
    await choose(combo(el, "c:drinks", "every")!, "Kitchen");
    await choose(combo(el, "all", "every")!, "Bar");
    expect(heard).toEqual(["routing-cell-change", "routing-make-default"]);
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
      "Kitchen Kitchen (default) — as an extra, follows its dish Only someone who can configure the venue can change the default station.",
    );

    const repair = await mount(routing({ defaultStationId: null }));
    const missing = cell(repair.el, "all", "every");
    expect(missing.querySelector('[data-test="default-repair"]')!.textContent!.trim()).toBe(
      "No default prep station is active. Choose one so items with no other setting have a station to go to.",
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
    expect(actions.error).toBe(`Drinks, Every zone: ${message}`);
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

  it("the No category heading heads its own row group and nothing above it", async () => {
    const { el } = await mount();
    const heading = [...root(el).querySelectorAll("th")].find(
      (th) => th.textContent!.trim() === "No category",
    )!;
    expect(heading.getAttribute("scope")).toBe("rowgroup");
    const group = heading.closest("tbody")!;
    expect(
      [...group.querySelectorAll("tr")].map((row) => row.querySelector("th")!.textContent!.trim()),
    ).toEqual(["No category", "Bread"]);
    expect(root(el).querySelectorAll("tbody")).toHaveLength(2);
    expect(root(el).querySelector("tbody")!.textContent).not.toContain("No category");
  });

  it("the bottom refusal names a product cell by its path and zone, in Spanish too", async () => {
    setLocale("es");
    const address: CellAddress = {
      row: { kind: "product", productId: "mojito" },
      zoneId: "terrace",
    };
    const { el } = await mount(routing(), { refusal: { address, message: "Rechazado." } });
    const actions = root(el).querySelector<HTMLElement & { error: string }>("wt-form-actions")!;
    // Mojito sits under a collapsed category, so its row is not even shown.
    expect(actions.error).toBe("Drinks › Cocktails › Mojito, Terrace: Rechazado.");
  });

  it("the No category row has an editor in every zone column, addressed to No category, never All categories", async () => {
    const model = routing({
      cells: [
        ...routing().cells,
        { row: { kind: "no_category" }, zoneId: "inside", target: station("bar") },
      ],
    });
    const { el, emitted } = await mount(model);
    const heading = bodyRows(el).find(
      (row) => row.querySelector("th")!.textContent!.trim() === "No category",
    )!;
    const tds = [...heading.querySelectorAll<HTMLElement>("td[data-row]")];
    expect(tds.map((td) => `${td.dataset.row}|${td.dataset.zone}`)).toEqual([
      "no_category|every",
      "no_category|terrace",
      "no_category|inside",
    ]);
    expect(shown(combo(el, "no_category", "inside")!)).toEqual({ text: "Bar", muted: false });
    // Inherited from All categories × Terrace.
    expect(shown(combo(el, "no_category", "terrace")!)).toEqual({
      text: "No preparation",
      muted: true,
    });
    // Inherited from the default station.
    expect(shown(combo(el, "no_category", "every")!)).toEqual({ text: "Kitchen", muted: true });
    // An uncategorised product inherits the No category cell.
    expect(shown(combo(el, "p:bread", "inside")!)).toEqual({ text: "Bar", muted: true });
    const every = combo(el, "no_category", "every")!;
    await userEvent.click(trigger(every));
    expect(optionLabels(every)).toEqual([
      "Clear setting",
      "Kitchen",
      "Bar",
      "Terrace bar",
      "No preparation",
    ]);
    const option = [...every.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent!.trim() === "No preparation",
    )!;
    await userEvent.click(option);
    await every.updateComplete;
    expect(emitted.changes).toEqual([
      {
        address: { row: { kind: "no_category" }, zoneId: null },
        target: { kind: "no_preparation" },
      },
    ]);
    expect(emitted.defaults).toEqual([]);
    expect(heading.querySelector("button")).toBeNull();
    expect(heading.querySelector("th")!.textContent!.trim()).toBe("No category");
    // Every editor in the grid addresses a real row: All, No category, a category or a product.
    for (const td of root(el).querySelectorAll<HTMLElement>("td[data-row]")) {
      expect(td.dataset.row).toMatch(/^(all|no_category|c:.+|p:.+)$/);
    }
  });

  it("a saved No category cell keeps its row with no product under it, and its editor clears it", async () => {
    const filed = routing().products.filter((product) => product.categoryId !== null);
    const without = await mount(routing({ products: filed }));
    expect(rowLabels(without.el)).not.toContain("No category");
    expect(root(without.el).querySelector('td[data-row="no_category"]')).toBeNull();

    const { el, emitted } = await mount(
      routing({
        products: filed,
        cells: [
          ...routing().cells,
          { row: { kind: "no_category" }, zoneId: "inside", target: station("bar") },
        ],
      }),
    );
    expect(rowLabels(el).slice(-1)).toEqual(["No category"]);
    expect(shown(combo(el, "no_category", "inside")!)).toEqual({ text: "Bar", muted: false });
    await choose(combo(el, "no_category", "inside")!, "Clear setting");
    expect(emitted.changes).toEqual([
      { address: { row: { kind: "no_category" }, zoneId: "inside" }, target: null },
    ]);
  });

  it.each([
    ["en", "No category, Inside: Refused."],
    ["es", "Sin categoría, Inside: Refused."],
  ] as const)("the bottom refusal names a No category cell in %s", async (locale, text) => {
    setLocale(locale);
    const address: CellAddress = { row: { kind: "no_category" }, zoneId: "inside" };
    const { el } = await mount(routing(), { refusal: { address, message: "Refused." } });
    const actions = root(el).querySelector<HTMLElement & { error: string }>("wt-form-actions")!;
    expect(actions.error).toBe(text);
    const box = combo(el, "no_category", "inside")!;
    expect(box.shadowRoot!.querySelector("[data-error]")!.textContent!.trim()).toBe("Refused.");
    expect((combo(el, "all", "inside") as unknown as { error: string }).error).toBe("");
    const carrying = [...root(el).querySelectorAll<Combo>("wt-combobox")].filter(
      (other) => (other as unknown as { error: string }).error !== "",
    );
    expect(carrying).toEqual([box]);
  });

  /** No category × Every zone goes to the Bar; All categories × Terrace is No preparation. */
  const noCategoryAtBar = () =>
    routing({
      cells: [
        ...routing().cells,
        { row: { kind: "no_category" }, zoneId: null, target: station("bar") },
      ],
    });

  it("a No category cell inherits its own row's Every zone before All categories × its zone", async () => {
    const { el } = await mount(noCategoryAtBar());
    expect(shown(combo(el, "no_category", "every")!)).toEqual({ text: "Bar", muted: false });
    expect(shown(combo(el, "no_category", "terrace")!)).toEqual({ text: "Bar", muted: true });
    expect(shown(combo(el, "p:bread", "terrace")!)).toEqual({ text: "Bar", muted: true });
    expect(shown(combo(el, "all", "terrace")!)).toEqual({ text: "No preparation", muted: false });
  });

  it.each([
    ["en", "No category, Terrace: Bar, inherited", "No category, Every zone: Bar, set here"],
    ["es", "Sin categoría, Terrace: Bar, heredado", null],
  ] as const)(
    "a No category editor's label names No category in %s",
    async (locale, zone, every) => {
      setLocale(locale);
      const { el } = await mount(noCategoryAtBar());
      expect(trigger(combo(el, "no_category", "terrace")!).getAttribute("aria-label")).toBe(zone);
      if (every !== null) {
        expect(trigger(combo(el, "no_category", "every")!).getAttribute("aria-label")).toBe(every);
      }
    },
  );

  describe("how extras are made", () => {
    const DEFAULT_NOTE = "Kitchen (default) — as an extra, follows its dish";
    const NO_PREP_NOTE = "No preparation — as an extra, follows its dish";
    const extraNote = (el: RoutingGrid, row: string, zone: string) =>
      cell(el, row, zone)
        .querySelector('[data-test="extra-note"]')
        ?.textContent!.replace(/\s+/g, " ")
        .trim() ?? null;
    const name = (el: RoutingGrid, row: string, zone: string) =>
      trigger(combo(el, row, zone)!).getAttribute("aria-label");

    it("an empty Every zone cell falls through to the default station and says its extras follow the dish", async () => {
      const { el } = await mount();
      expect(extraNote(el, "p:bread", "every")).toBe(DEFAULT_NOTE);
      expect(name(el, "p:bread", "every")).toBe(
        `Bread, Every zone: Kitchen, inherited. ${DEFAULT_NOTE}`,
      );
    });

    it("the All categories × Every zone cell, which sets the default, carries the default note", async () => {
      const { el } = await mount();
      expect(extraNote(el, "all", "every")).toBe(DEFAULT_NOTE);
      expect(name(el, "all", "every")).toBe(
        `All categories, Every zone: Kitchen, the default station. ${DEFAULT_NOTE}`,
      );

      const readOnly = await mount(routing({ canMakeDefault: false }));
      expect(extraNote(readOnly.el, "all", "every")).toBe(DEFAULT_NOTE);
      expect(cell(readOnly.el, "all", "every").textContent!.replace(/\s+/g, " ").trim()).toBe(
        `Kitchen ${DEFAULT_NOTE} Only someone who can configure the venue can change the default station.`,
      );
    });

    it("a cell whose choice, inherited or its own, is No preparation carries the No preparation note", async () => {
      const { el } = await mount();
      expect(extraNote(el, "p:bread", "terrace")).toBe(NO_PREP_NOTE);
      expect(name(el, "p:bread", "terrace")).toBe(
        `Bread, Terrace: No preparation, inherited. ${NO_PREP_NOTE}`,
      );
      expect(extraNote(el, "all", "terrace")).toBe(NO_PREP_NOTE);
      expect(name(el, "all", "terrace")).toBe(
        `All categories, Terrace: No preparation, set here. ${NO_PREP_NOTE}`,
      );
    });

    it("a cell that names a station, even the default one, carries no note", async () => {
      const { el } = await mount();
      root(el).querySelector<HTMLElement>('[data-test="expand-all"]')!.click();
      await el.updateComplete;
      expect(extraNote(el, "p:burger", "every")).toBeNull();
      expect(name(el, "p:burger", "every")).toBe("Food › Burger, Every zone: Kitchen, set here");
      // Inheriting Kitchen from a cell that names it is not falling through to the default.
      expect(extraNote(el, "p:burger", "terrace")).toBeNull();
      expect(extraNote(el, "c:drinks", "every")).toBeNull();
      expect(extraNote(el, "p:cola", "terrace")).toBeNull();
    });

    it("a pending choice decides the note until it settles", async () => {
      const address: CellAddress = { row: { kind: "product", productId: "bread" }, zoneId: null };
      const { el } = await mount(routing(), { pending: { address, target: station("kitchen") } });
      expect(extraNote(el, "p:bread", "every")).toBeNull();
      el.pending = { address, target: NO_PREP };
      await el.updateComplete;
      expect(extraNote(el, "p:bread", "every")).toBe(NO_PREP_NOTE);
      el.pending = null;
      await el.updateComplete;
      expect(extraNote(el, "p:bread", "every")).toBe(DEFAULT_NOTE);
    });

    it("with no active default station, an empty cell has no station to name and no note", async () => {
      const { el } = await mount(routing({ defaultStationId: null }));
      expect(extraNote(el, "p:bread", "every")).toBeNull();
      expect(extraNote(el, "all", "every")).toBeNull();
    });

    it("says it in Spanish", async () => {
      setLocale("es");
      const { el } = await mount();
      expect(extraNote(el, "p:bread", "every")).toBe(
        "Kitchen (predeterminada) — como extra, sigue a su plato",
      );
      expect(extraNote(el, "p:bread", "terrace")).toBe(
        "Sin preparación — como extra, sigue a su plato",
      );
      expect(name(el, "p:bread", "terrace")).toBe(
        "Bread, Terrace: Sin preparación, heredado. Sin preparación — como extra, sigue a su plato",
      );
    });
  });

  it("zone columns share the width evenly however long a cell's warning is", async () => {
    const { el } = await mount();
    const widths = ["every", "terrace", "inside"].map(
      (zone) => cell(el, "c:food", zone).getBoundingClientRect().width,
    );
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
    // The warning wraps inside its column.
    const warning = cell(el, "c:food", "inside").querySelector<HTMLElement>(
      '[data-test="disabled-target"]',
    )!;
    expect(warning.getBoundingClientRect().width).toBeLessThanOrEqual(widths[2]!);
  });

  it("the expand toggle's arrow is drawn at a comfortable size", async () => {
    const { el } = await mount();
    const arrow = root(el).querySelector<HTMLElement>('button[data-category="drinks"] .arrow')!;
    expect(arrow.getBoundingClientRect().width).toBeGreaterThanOrEqual(24);
    expect(parseFloat(getComputedStyle(arrow).fontSize)).toBeGreaterThanOrEqual(18);
  });

  it("at phone width the row label column is capped and the zones take most of the width", async () => {
    await page.viewport(390, 800);
    const { el } = await mount();
    const scroller = root(el).querySelector<HTMLElement>('[data-test="grid-scroll"]')!;
    const first = root(el).querySelector("thead th")!.getBoundingClientRect().width;
    expect(first).toBeLessThanOrEqual(140);
    expect(first).toBeLessThan(scroller.clientWidth / 2);
    // A long label wraps instead of widening the column.
    const long = await mount(
      routing({
        products: [
          ...routing().products,
          { id: "x", name: "A very long uncategorised product name", categoryId: null },
        ],
      }),
    );
    const label = [...root(long.el).querySelectorAll("tbody th")].find((th) =>
      th.textContent!.includes("A very long"),
    )!;
    expect(label.getBoundingClientRect().width).toBeLessThanOrEqual(140);
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
