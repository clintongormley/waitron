import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { cellKey } from "../routing.js";
import type { CellAddress, RouteTarget, RoutingCell, RoutingPeriod } from "../routing.js";
import type { RetiredFallbackRoutingView as RoutingView } from "../../test/retired-routing-fixture-types.js";
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

        fallbackStationId: "kitchen",
        today: null,
        closedSendsTo: "kitchen",
      },
    ],
    periods: [],
    todayEnds: null,
    clockReadable: true,
    zones: [
      { id: "terrace", name: "Terrace", departmentId: null },
      { id: "inside", name: "Inside", departmentId: null },
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
type Combo = HTMLElementTagNameMap["wt-combobox"];
type Editor = HTMLElementTagNameMap["routing-cell-editor"];
/** The cell's button; `null` where the cell draws none. */
const combo = (el: RoutingGrid, row: string, zone: string) =>
  cell(el, row, zone).querySelector<HTMLButtonElement>('button[data-test="routing-cell"]');
const trigger = (box: HTMLButtonElement) => box;
/** The station the cell's button draws, and whether it is drawn as inherited. */
const shown = (box: HTMLButtonElement) => {
  const value = box.querySelector(".station")!;
  return { text: value.textContent!.trim(), muted: value.classList.contains("inherited") };
};
const editorOf = (el: RoutingGrid) => root(el).querySelector<Editor>("routing-cell-editor");
/** The open cell editor's `wt-close`; take it before the key or click that closes the editor. */
function editorClosed(el: RoutingGrid) {
  const modal = editorOf(el)!.shadowRoot!.querySelector("wt-modal")!;
  return new Promise((resolve) => modal.addEventListener("wt-close", resolve, { once: true }));
}
const field = (editor: Editor, name: string) =>
  editor.shadowRoot!.querySelector<Combo>(`wt-combobox[name="${name}"]`)!;
const editorButton = (editor: Editor, test: string) =>
  editor.shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`);
/** The labels "Any other time" offers in the editor the cell opens. */
const optionLabels = (box: Combo) => box.options.map((option) => option.label);

async function openEditor(el: RoutingGrid, box: HTMLButtonElement): Promise<Editor> {
  box.click();
  await el.updateComplete;
  const editor = editorOf(el)!;
  await editor.updateComplete;
  return editor;
}

async function pick(editor: Editor, name: string, label: string): Promise<void> {
  const box = field(editor, name);
  const option = box.options.find((o) => o.label === label)!;
  box.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: option.value },
      bubbles: true,
      composed: true,
    }),
  );
  await editor.updateComplete;
}

/** The refusal drawn under a cell's button. */
const errorOf = (el: RoutingGrid, row: string, zone: string) =>
  cell(el, row, zone).querySelector('[data-test="cell-error"]')?.textContent!.trim() ?? "";
const carryingErrors = (el: RoutingGrid) =>
  [...root(el).querySelectorAll<HTMLElement>('td:has([data-test="cell-error"])')].map(
    (td) => `${td.dataset.row}|${td.dataset.zone}`,
  );

/** Opens the cell's editor and saves `label` as its station, or presses Clear setting. */
async function choose(el: RoutingGrid, box: HTMLButtonElement, label: string): Promise<void> {
  const editor = await openEditor(el, box);
  if (label === "Clear setting") {
    editorButton(editor, "clear-cell")!.click();
  } else {
    await pick(editor, "target", label);
    editorButton(editor, "save-cell")!.click();
  }
  await el.updateComplete;
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

  it("the editor offers active stations, then No preparation, and no Clear for an inherited cell; an inactive saved station is described, not offered", async () => {
    const { el } = await mount();
    root(el).querySelector<HTMLElement>('[data-test="expand-all"]')!.click();
    await el.updateComplete;
    const editor = await openEditor(el, combo(el, "p:cola", "every")!);
    const box = field(editor, "target");
    expect(editorButton(editor, "clear-cell")).toBeNull();
    expect(optionLabels(box)).toEqual(["Kitchen", "Bar", "Terrace bar", "No preparation"]);
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
    expect(old.dataset.target).toBe("station:old");
    const editor = await openEditor(el, old);
    const box = field(editor, "target");
    expect(box.value).toBe("station:old");
    expect(
      box.options.map((option) => [option.label, option.value === box.value, !!option.disabled]),
    ).toEqual([
      ["Kitchen", false, false],
      ["Bar", false, false],
      ["Terrace bar", false, false],
      ["No preparation", false, false],
      ["Old kitchen (Disabled)", true, true],
    ]);
    // Saving the disabled station again is not a change, so nothing is sent.
    editorButton(editor, "save-cell")!.click();
    await el.updateComplete;
    expect(emitted.changes).toEqual([]);
    expect(old.dataset.target).toBe("station:old");
    expect(shown(old)).toEqual({ text: "Old kitchen (Disabled)", muted: false });
  });

  it("a saved disabled station is drawn with its Spanish disabled wording", async () => {
    setLocale("es");
    const { el } = await mount();
    const old = combo(el, "c:food", "inside")!;
    await el.updateComplete;
    expect(shown(old)).toEqual({ text: "Old kitchen (Deshabilitada)", muted: false });
  });

  it("a saved disabled station is repaired by Clear setting or by an active station", async () => {
    const address: CellAddress = {
      row: { kind: "category", categoryId: "food" },
      zoneId: "inside",
    };
    const { el, emitted } = await mount();
    await choose(el, combo(el, "c:food", "inside")!, "Clear setting");
    await choose(el, combo(el, "c:food", "inside")!, "Bar");
    expect(emitted.changes).toEqual([
      { address, target: null },
      { address, target: { kind: "station", stationId: "bar" } },
    ]);
  });

  it("the disabled station warning names the default, ignoring the former fallback", async () => {
    const model = routing({
      stationTimes: [
        {
          stationId: "old",
          status: { open: false, why: "switched_off" },

          fallbackStationId: "tbar",
          today: null,
          closedSendsTo: "bar",
        },
        {
          stationId: "tbar",
          status: { open: false, why: "closed_by_hand" },

          fallbackStationId: "bar",
          today: "closed",
          closedSendsTo: "bar",
        },
      ],
    });
    const { el } = await mount(model);
    const warning = cell(el, "c:food", "inside").querySelector('[data-test="disabled-target"]')!;
    expect(warning.textContent!.replace(/\s+/g, " ").trim()).toBe(
      "Old kitchen: Disabled. Its work goes to Kitchen.",
    );
  });

  it("an inactive saved station with no replacement says the till asks", async () => {
    const model = routing({
      defaultStationId: null,
      stationTimes: [
        {
          stationId: "old",
          status: { open: false, why: "switched_off" },

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
    await choose(el, drinks, "Clear setting");
    expect(emitted.changes).toEqual([
      { address: { row: { kind: "category", categoryId: "drinks" }, zoneId: null }, target: null },
    ]);
    // While the clear is pending, the field shows what the row would inherit once cleared.
    await el.updateComplete;
    expect(shown(drinks)).toEqual({ text: "Kitchen", muted: true });
    expect(drinks.dataset.target).toBe("");

    const bread = combo(el, "p:bread", "inside")!;
    await choose(el, bread, "No preparation");
    await el.updateComplete;
    expect(shown(bread)).toEqual({ text: "No preparation", muted: false });
    // One pending choice at a time: Drinks is back to its saved value.
    expect(shown(drinks)).toEqual({ text: "Bar", muted: false });
    // The editor waits while its choice is pending; the host settles it first.
    el.pending = null;
    await choose(el, bread, "Bar");
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
    expect(bread.dataset.target).toBe("station:bar");
  });

  it("after a choice the field shows the saved value again unless the host sets it pending", async () => {
    const { el, emitted } = await mount();
    const model = el.model!;
    const drinks = combo(el, "c:drinks", "every")!;
    await choose(el, drinks, "Clear setting");
    expect(emitted.changes).toHaveLength(1);
    await el.updateComplete;
    expect(shown(drinks)).toEqual({ text: "Bar", muted: false });
    expect(drinks.dataset.target).toBe("station:bar");

    // A cancelled preview: the host clears pending and hands back the very same model.
    el.pending = { address: emitted.changes[0]!.address, target: null };
    await el.updateComplete;
    expect(shown(drinks)).toEqual({ text: "Kitchen", muted: true });
    el.pending = null;
    el.model = model;
    await el.updateComplete;
    expect(shown(drinks)).toEqual({ text: "Bar", muted: false });
    expect(drinks.dataset.target).toBe("station:bar");
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
    const editor = await openEditor(el, box);
    await pick(editor, "target", "Kitchen");
    el.model = routing({ zones: [{ id: "inside", name: "Inside", departmentId: null }] });
    await el.updateComplete;
    expect(box.isConnected).toBe(false);
    expect(editor.isConnected).toBe(false);
    expect(editorOf(el)).toBeNull();
    expect(combo(el, "c:drinks", "inside")).not.toBe(box);
    expect(root(el).querySelector('td[data-zone="terrace"]')).toBeNull();
    const headers = [...root(el).querySelectorAll("thead th")].map((th) => th.textContent!.trim());
    expect(headers).toEqual(["Category or product", "Every zone", "Inside"]);
    // A save in the departed editor reaches nobody.
    editorButton(editor, "save-cell")!.click();
    await el.updateComplete;
    expect(emitted.changes).toEqual([]);
  });

  it("the grid's events reach an ancestor outside it, and the inner field's change event does not", async () => {
    const { el } = await mount();
    const outside = el.parentElement!;
    const heard: string[] = [];
    for (const name of [
      "routing-cell-change",
      "routing-make-default",
      "wt-change",
      "routing-cell-save",
      "routing-cell-clear",
      "routing-cell-close",
    ]) {
      outside.addEventListener(name, () => heard.push(name));
    }
    await choose(el, combo(el, "c:drinks", "every")!, "Kitchen");
    await choose(el, combo(el, "all", "every")!, "Bar");
    expect(heard).toEqual(["routing-cell-change", "routing-make-default"]);
  });

  it("choosing the value already saved emits nothing", async () => {
    const { el, emitted } = await mount();
    await choose(el, combo(el, "c:drinks", "every")!, "Bar");
    expect(emitted.changes).toEqual([]);
  });

  it("Enter/Space opens the editor, Escape cancels it and restores focus", async () => {
    const { el, emitted } = await mount();
    const button = combo(el, "c:drinks", "every")!;
    button.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(editorOf(el)?.open).toBe(true));
    await editorOf(el)!.updateComplete;
    let closed = editorClosed(el);
    await userEvent.keyboard("{Escape}");
    await closed;
    await vi.waitFor(() => expect(editorOf(el)).toBeNull());
    await vi.waitFor(() => expect(root(el).activeElement).toBe(button));
    await userEvent.keyboard(" ");
    await vi.waitFor(() => expect(editorOf(el)?.open).toBe(true));
    await editorOf(el)!.updateComplete;
    closed = editorClosed(el);
    await userEvent.keyboard("{Escape}");
    await closed;
    await vi.waitFor(() => expect(editorOf(el)).toBeNull());
    await vi.waitFor(() => expect(root(el).activeElement).toBe(button));
    expect(emitted.changes).toEqual([]);
    expect(shown(button)).toEqual({ text: "Bar", muted: false });
  });

  it("All × Every zone: Make default choices with canMakeDefault; read-only explanation without; repair message when no active default", async () => {
    const { el, emitted } = await mount();
    const box = combo(el, "all", "every")!;
    expect(shown(box)).toEqual({ text: "Kitchen", muted: false });
    expect(optionLabels(field(await openEditor(el, box), "target"))).toEqual([
      "Kitchen",
      "Bar",
      "Terrace bar",
    ]);
    await choose(el, box, "Bar");
    expect(emitted.defaults).toEqual([{ stationId: "bar" }]);
    expect(emitted.changes).toEqual([]);

    const readOnly = await mount(routing({ canMakeDefault: false }));
    const fixed = cell(readOnly.el, "all", "every");
    expect(fixed.querySelector("button")).toBeNull();

    const repair = await mount(routing({ defaultStationId: null }));
    const missing = cell(repair.el, "all", "every");
    expect(missing.querySelector('[data-test="default-repair"]')!.textContent!.trim()).toBe(
      "No default prep station is active. Choose one so items with no other setting have a station to go to.",
    );
    const choices = combo(repair.el, "all", "every")!;
    expect(optionLabels(field(await openEditor(repair.el, choices), "target"))).toEqual([
      "Kitchen",
      "Bar",
      "Terrace bar",
    ]);
    await choose(repair.el, choices, "Terrace bar");
    expect(repair.emitted.defaults).toEqual([{ stationId: "tbar" }]);

    const stuck = await mount(routing({ defaultStationId: null, canMakeDefault: false }));
    const none = cell(stuck.el, "all", "every");
    expect(none.querySelector("button")).toBeNull();
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
    expect(errorOf(el, "c:drinks", "every")).toBe(message);
    const actions = root(el).querySelector<HTMLElement & { error: string }>("wt-form-actions")!;
    expect(actions.error).toBe(`Drinks, Every zone: ${message}`);
    // Nowhere else: only one cell and the bottom message carry it.
    expect(carryingErrors(el)).toEqual(["c:drinks|every"]);
    expect(trigger(box).disabled).toBe(false);
    await choose(el, box, "Kitchen");
    expect(emitted.changes).toEqual([
      { address, target: { kind: "station", stationId: "kitchen" } },
    ]);

    el.refusal = null;
    await el.updateComplete;
    expect(actions.error).toBe("");
    expect(errorOf(el, "c:drinks", "every")).toBe("");
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
    const editor = await openEditor(el, every);
    expect(editorButton(editor, "clear-cell")).toBeNull();
    expect(optionLabels(field(editor, "target"))).toEqual([
      "Kitchen",
      "Bar",
      "Terrace bar",
      "No preparation",
    ]);
    await choose(el, every, "No preparation");
    expect(emitted.changes).toEqual([
      {
        address: { row: { kind: "no_category" }, zoneId: null },
        target: { kind: "no_preparation" },
      },
    ]);
    expect(emitted.defaults).toEqual([]);
    expect(heading.querySelector("th button")).toBeNull();
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
    await choose(el, combo(el, "no_category", "inside")!, "Clear setting");
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
    expect(errorOf(el, "no_category", "inside")).toBe("Refused.");
    expect(errorOf(el, "all", "inside")).toBe("");
    expect(carryingErrors(el)).toEqual(["no_category|inside"]);
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

  describe("no note on how an extra is made", () => {
    const text = (el: RoutingGrid, row: string, zone: string) =>
      cell(el, row, zone).textContent!.replace(/\s+/g, " ").trim();
    const name = (el: RoutingGrid, row: string, zone: string) =>
      trigger(combo(el, row, zone)!).getAttribute("aria-label");

    it("an empty Every zone cell shows and names only the default station it falls through to", async () => {
      const { el } = await mount();
      expect(text(el, "p:bread", "every")).toBe("Kitchen");
      expect(name(el, "p:bread", "every")).toBe("Bread, Every zone: Kitchen, inherited");
    });

    it("a No preparation cell, its own or inherited, shows and names only No preparation", async () => {
      const { el } = await mount();
      expect(text(el, "all", "terrace")).toBe("No preparation");
      expect(name(el, "all", "terrace")).toBe("All categories, Terrace: No preparation, set here");
      expect(text(el, "p:bread", "terrace")).toBe("No preparation");
      expect(name(el, "p:bread", "terrace")).toBe("Bread, Terrace: No preparation, inherited");
    });

    it("a product row storing its own station shows and names only that station", async () => {
      const { el } = await mount();
      root(el).querySelector<HTMLElement>('[data-test="expand-all"]')!.click();
      await el.updateComplete;
      expect(text(el, "p:burger", "every")).toBe("Kitchen");
      expect(name(el, "p:burger", "every")).toBe("Food › Burger, Every zone: Kitchen, set here");
    });

    it("the All categories × Every zone cell shows only the default station, editable or not", async () => {
      const { el } = await mount();
      expect(text(el, "all", "every")).toBe("Kitchen");
      expect(name(el, "all", "every")).toBe(
        "All categories, Every zone: Kitchen, the default station",
      );

      const readOnly = await mount(routing({ canMakeDefault: false }));
      expect(text(readOnly.el, "all", "every")).toBe(
        "Kitchen Only someone who can configure the venue can change the default station.",
      );
    });

    it("says none of it in Spanish either", async () => {
      setLocale("es");
      const { el } = await mount();
      expect(text(el, "p:bread", "terrace")).toBe("Sin preparación");
      expect(name(el, "p:bread", "terrace")).toBe("Bread, Terrace: Sin preparación, heredado");
      expect(name(el, "p:bread", "every")).toBe("Bread, Todas las zonas: Kitchen, heredado");
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
    expect(first).toBeLessThanOrEqual(96);
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
    expect(label.getBoundingClientRect().width).toBeLessThanOrEqual(96);
  });

  it("at phone width the Every zone column and the first zone column fit without scrolling", async () => {
    await page.viewport(390, 800);
    const { el } = await mount();
    const scroller = root(el).querySelector<HTMLElement>('[data-test="grid-scroll"]')!;
    expect(scroller.scrollLeft).toBe(0);
    const visibleEnd =
      scroller.getBoundingClientRect().left + scroller.clientLeft + scroller.clientWidth;
    const [label, every, first] = [...root(el).querySelectorAll("thead th")];
    expect(every!.textContent).toContain("Every zone");
    expect(first!.textContent).toContain("Terrace");
    expect(every!.getBoundingClientRect().right).toBeLessThanOrEqual(visibleEnd);
    expect(first!.getBoundingClientRect().right).toBeLessThanOrEqual(visibleEnd);
    expect(cell(el, "c:drinks", "terrace").getBoundingClientRect().right).toBeLessThanOrEqual(
      visibleEnd,
    );
    const padding = () => getComputedStyle(cell(el, "c:drinks", "terrace")).paddingInlineStart;
    expect(padding()).toBe("4px");
    expect(getComputedStyle(label!).paddingInlineStart).toBe("4px");
    await page.viewport(1280, 800);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(padding()).toBe("8px");
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

  describe("the cell's button and its editor", () => {
    const dining = { departmentId: "dining", departmentName: "Dining", colour: "blue" as const };
    const lunch: RoutingPeriod = { id: "lunch", ...dining, name: "Lunch", productIds: ["mojito"] };
    const staff: RoutingPeriod = {
      id: "staff",
      ...dining,
      name: "Staff lunch",
      productIds: ["cola", "bread"],
    };
    const drinks: CellAddress = { row: { kind: "category", categoryId: "drinks" }, zoneId: null };
    /** Drinks go to the Kitchen during Lunch; the Terrace serves Dining, the Inside no one. */
    const timed = () =>
      routing({
        periods: [lunch, staff],
        zones: [
          { id: "terrace", name: "Terrace", departmentId: "dining" },
          { id: "inside", name: "Inside", departmentId: null },
        ],
        cells: routing().cells.map((stored) =>
          cellKey(stored) === cellKey(drinks)
            ? { ...stored, periods: [{ periodId: "lunch", target: station("kitchen") }] }
            : stored,
        ),
      });
    const lines = (el: RoutingGrid, row: string, zone: string) =>
      [...combo(el, row, zone)!.querySelectorAll(".line")].map((line) => line.textContent!.trim());

    it("draws the station and its period lines beneath, and names both", async () => {
      const model = {
        ...timed(),
        cells: [
          ...timed().cells,
          {
            row: { kind: "product", productId: "bread" },
            zoneId: "terrace",
            target: NO_PREP,
            periods: [{ periodId: "staff", target: station("bar") }],
          } as RoutingCell,
        ],
      };
      const { el } = await mount(model);
      const own = combo(el, "c:drinks", "every")!;
      expect(own.tagName).toBe("BUTTON");
      expect(shown(own)).toEqual({ text: "Bar", muted: false });
      expect(lines(el, "c:drinks", "every")).toEqual(["Lunch: Kitchen"]);
      expect(own.getAttribute("aria-label")).toBe(
        "Drinks, Every zone: Bar, set here. Lunch: Kitchen",
      );
      const bread = combo(el, "p:bread", "terrace")!;
      expect(lines(el, "p:bread", "terrace")).toEqual(["Staff lunch: Bar"]);
      expect(bread.textContent!.replace(/\s+/g, " ").trim()).toBe(
        "No preparation Staff lunch: Bar",
      );
      expect(bread.getAttribute("aria-label")).toBe(
        "Bread, Terrace: No preparation, set here. Staff lunch: Bar",
      );
      // Inherited: italic, with the lines of the cell that decides it.
      root(el).querySelector<HTMLElement>('[data-test="expand-all"]')!.click();
      await el.updateComplete;
      const cola = combo(el, "p:cola", "every")!;
      expect(shown(cola)).toEqual({ text: "Bar", muted: true });
      expect(getComputedStyle(cola.querySelector(".station")!).fontStyle).toBe("italic");
      expect(getComputedStyle(own.querySelector(".station")!).fontStyle).toBe("normal");
      expect(lines(el, "p:cola", "every")).toEqual(["Lunch: Kitchen"]);
      expect(cola.getAttribute("aria-label")).toBe(
        "Drinks › Cola, Every zone: Bar, inherited. Lunch: Kitchen",
      );
    });

    describe("a stored line whose period's menus no longer offer the row", () => {
      /** Drinks × Every zone stores Lunch and Staff lunch, each to its own station unless `shared`. */
      const flagged = (notOffered: string[], shared = false) => ({
        ...timed(),
        cells: timed().cells.map((stored) =>
          cellKey(stored) === cellKey(drinks)
            ? {
                ...stored,
                periods: [
                  { periodId: "lunch", target: station("kitchen") },
                  { periodId: "staff", target: station(shared ? "kitchen" : "bar") },
                ].map((line) =>
                  notOffered.includes(line.periodId)
                    ? { ...line, notOffered: true as const }
                    : line,
                ),
              }
            : stored,
        ),
      });
      /** The button's lines and marks, in the order drawn. */
      const drawn = (el: RoutingGrid, row: string, zone: string) =>
        [...combo(el, row, zone)!.querySelectorAll(".line, [data-test='period-flag']")].map(
          (node) => `${node.matches(".line") ? "line" : "flag"}: ${node.textContent!.trim()}`,
        );

      it("draws the mark under its own line in the warning colour, and names it after that line", async () => {
        const { el } = await mount(flagged(["lunch"]));
        expect(drawn(el, "c:drinks", "every")).toEqual([
          "line: Lunch: Kitchen",
          "flag: Not on Lunch menus",
          "line: Staff lunch: Bar",
        ]);
        const own = combo(el, "c:drinks", "every")!;
        expect(own.getAttribute("aria-label")).toBe(
          "Drinks, Every zone: Bar, set here. Lunch: Kitchen. Not on Lunch menus. Staff lunch: Bar",
        );
        const probe = document.createElement("span");
        probe.style.color = "var(--wt-color-warning)";
        el.parentElement!.append(probe);
        const mark = own.querySelector("[data-test='period-flag']")!;
        expect(getComputedStyle(mark).color).toBe(getComputedStyle(probe).color);
        expect(getComputedStyle(mark).color).not.toBe(getComputedStyle(own).color);
        probe.remove();
      });

      it("names both flagged periods of one line in one mark", async () => {
        const { el } = await mount(flagged(["lunch", "staff"], true));
        expect(drawn(el, "c:drinks", "every")).toEqual([
          "line: Lunch, Staff lunch: Kitchen",
          "flag: Not on Lunch, Staff lunch menus",
        ]);
      });

      it("draws no mark where the menus still offer the line, nor under a line a child inherits", async () => {
        const { el } = await mount(flagged([]));
        expect(drawn(el, "c:drinks", "every")).toEqual([
          "line: Lunch: Kitchen",
          "line: Staff lunch: Bar",
        ]);
        el.model = flagged(["lunch"]);
        root(el).querySelector<HTMLElement>('[data-test="expand-all"]')!.click();
        await el.updateComplete;
        expect(drawn(el, "p:cola", "every")).toEqual([
          "line: Lunch: Kitchen",
          "line: Staff lunch: Bar",
        ]);
        expect(combo(el, "p:cola", "every")!.getAttribute("aria-label")).toBe(
          "Drinks › Cola, Every zone: Bar, inherited. Lunch: Kitchen. Staff lunch: Bar",
        );
      });

      it("hands the mark to the editor opened on that cell, which notes it under the line", async () => {
        const { el } = await mount(flagged(["lunch"]));
        const editor = await openEditor(el, combo(el, "c:drinks", "every")!);
        const notes = [...editor.shadowRoot!.querySelectorAll("[data-test=period-line]")].map(
          (line) => line.querySelector("[data-test=period-flag]")?.textContent?.trim() ?? null,
        );
        expect(notes).toEqual(["Not on Lunch menus", null]);
      });

      it("says the mark in Spanish", async () => {
        setLocale("es");
        const { el } = await mount(flagged(["lunch"]));
        expect(drawn(el, "c:drinks", "every")[1]).toBe("flag: No está en los menús de Lunch");
        expect(combo(el, "c:drinks", "every")!.getAttribute("aria-label")).toContain(
          "Lunch: Kitchen. No está en los menús de Lunch. Staff lunch: Bar",
        );
      });
    });

    it("opens the editor with the cell's place, choice, lines, products and zone department", async () => {
      const { el } = await mount(timed());
      root(el).querySelector<HTMLElement>('[data-test="expand-all"]')!.click();
      await el.updateComplete;
      const own = await openEditor(el, combo(el, "c:drinks", "every")!);
      expect(own.open).toBe(true);
      expect(own.cell).toEqual({
        address: drinks,
        label: "Drinks, Every zone",
        target: station("bar"),
        periods: [{ periodId: "lunch", target: station("kitchen") }],
      });
      expect([...own.rowProductIds].sort()).toEqual(["cola", "mojito"]);
      expect(own.zoneDepartmentId).toBeNull();
      expect(own.zoneWithoutDepartment).toBe(false);
      expect(own.isDefaultCell).toBe(false);
      expect(own.periods).toEqual([lunch, staff]);
      expect(own.stations).toEqual(el.model!.stations);

      const cola = await openEditor(el, combo(el, "p:cola", "terrace")!);
      expect(cola.cell).toEqual({
        address: { row: { kind: "product", productId: "cola" }, zoneId: "terrace" },
        label: "Drinks › Cola, Terrace",
        target: station("bar"),
        periods: [{ periodId: "lunch", target: station("kitchen") }],
        inheritedFrom: "Drinks, Every zone",
      });
      expect(cola.rowProductIds).toEqual(["cola"]);
      expect(cola.zoneDepartmentId).toBe("dining");
      expect(cola.zoneWithoutDepartment).toBe(false);

      const burger = await openEditor(el, combo(el, "p:burger", "terrace")!);
      expect(burger.cell!.inheritedFrom).toBe("Every zone");
      const bread = await openEditor(el, combo(el, "p:bread", "every")!);
      expect(bread.cell!.inheritedFrom).toBe("the default station");
      expect(bread.cell!.periods).toEqual([]);
      const none = await openEditor(el, combo(el, "no_category", "inside")!);
      expect(none.rowProductIds).toEqual(["bread"]);
      const all = await openEditor(el, combo(el, "all", "inside")!);
      expect([...all.rowProductIds].sort()).toEqual(["bread", "burger", "cola", "mojito"]);
      expect(all.zoneDepartmentId).toBeNull();
      expect(all.zoneWithoutDepartment).toBe(true);

      const fallback = await openEditor(el, combo(el, "all", "every")!);
      expect(fallback.isDefaultCell).toBe(true);
      expect(fallback.cell).toEqual({
        address: { row: { kind: "all" }, zoneId: null },
        label: "All categories, Every zone",
        target: station("kitchen"),
      });
    });

    it("saves a period line with the cell's change, and sends no lines where it had and has none", async () => {
      const { el, emitted } = await mount(timed());
      const editor = await openEditor(el, combo(el, "c:drinks", "every")!);
      const periodsField = editor.shadowRoot!.querySelector<Combo>('[name="line-periods"]')!;
      periodsField.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { values: ["lunch"] },
          bubbles: true,
          composed: true,
        }),
      );
      await editor.updateComplete;
      await pick(editor, "line-target", "Terrace bar");
      editorButton(editor, "save-cell")!.click();
      await el.updateComplete;
      expect(emitted.changes).toEqual([
        {
          address: drinks,
          target: station("bar"),
          periods: [{ periodId: "lunch", target: station("tbar") }],
        },
      ]);
      // Removing the last line still sends the now empty list.
      el.pending = null;
      editorButton(editor, "remove-line")!.click();
      await editor.updateComplete;
      editorButton(editor, "save-cell")!.click();
      await el.updateComplete;
      expect(emitted.changes[1]).toEqual({ address: drinks, target: station("bar"), periods: [] });
    });

    it("hands a refusal at its cell to the open editor, which puts a period's under its line", async () => {
      const { el } = await mount(timed());
      const editor = await openEditor(el, combo(el, "c:drinks", "every")!);
      await pick(editor, "target", "Kitchen");
      el.refusal = {
        address: drinks,
        message: "The change could not be saved.",
        code: "route.period_invalid",
        params: { periodId: "lunch", reason: "not_offered" },
      };
      await el.updateComplete;
      await editor.updateComplete;
      const periodsField = editor.shadowRoot!.querySelector<Combo>('[name="line-periods"]')!;
      expect(periodsField.error).toBe("Lunch offers none of these products.");
      // Another cell's refusal is not this editor's.
      el.refusal = {
        address: { row: { kind: "all" }, zoneId: "terrace" },
        message: "This station is disabled. Choose an active station.",
        code: "route.station_inactive",
      };
      await el.updateComplete;
      await editor.updateComplete;
      expect(editor.refusal).toBeUndefined();
    });

    it("waits while its choice is pending, and closes when the host says the choice was saved", async () => {
      const { el } = await mount(timed());
      const editor = await openEditor(el, combo(el, "c:drinks", "every")!);
      el.pending = { address: drinks, target: station("kitchen") };
      await el.updateComplete;
      expect(editor.busy).toBe(true);
      el.pending = null;
      await el.updateComplete;
      expect(editor.busy).toBe(false);
      el.closeEditor();
      await el.updateComplete;
      expect(editorOf(el)).toBeNull();
    });

    /** Timed, plus Cola × Every zone set to the Terrace bar, with Staff lunch at the Bar. */
    const colaEvery: CellAddress = { row: { kind: "product", productId: "cola" }, zoneId: null };
    const withCola = () => ({
      ...timed(),
      cells: [
        ...timed().cells,
        {
          ...colaEvery,
          target: station("tbar"),
          periods: [{ periodId: "staff", target: station("bar") }],
        } as RoutingCell,
      ],
    });
    const expanded = async (model: RoutingView) => {
      const mounted = await mount(model);
      root(mounted.el).querySelector<HTMLElement>('[data-test="expand-all"]')!.click();
      await mounted.el.updateComplete;
      return mounted;
    };
    const lineStyles = (el: RoutingGrid, row: string, zone: string) =>
      [...combo(el, row, zone)!.querySelectorAll(".line")].map((line) => {
        const style = getComputedStyle(line);
        return { italic: style.fontStyle === "italic", color: style.color };
      });

    it("draws inherited lines muted and italic, as the inherited station above them", async () => {
      const { el } = await expanded(withCola());
      const station = combo(el, "p:mojito", "every")!.querySelector(".station")!;
      const muted = getComputedStyle(station).color;
      expect(lines(el, "p:mojito", "every")).toEqual(["Lunch: Kitchen"]);
      expect(lineStyles(el, "p:mojito", "every")).toEqual([{ italic: true, color: muted }]);
      const own = lineStyles(el, "p:cola", "every");
      expect(own).toHaveLength(1);
      expect(own[0]!.italic).toBe(false);
      expect(own[0]!.color).not.toBe(muted);
    });

    it("draws a waiting choice's own lines with its station, not the saved lines", async () => {
      const { el } = await mount(timed());
      el.pending = {
        address: drinks,
        target: station("kitchen"),
        periods: [{ periodId: "staff", target: station("tbar") }],
      };
      await el.updateComplete;
      const own = combo(el, "c:drinks", "every")!;
      expect(shown(own)).toEqual({ text: "Kitchen", muted: false });
      expect(lines(el, "c:drinks", "every")).toEqual(["Staff lunch: Terrace bar"]);
      expect(own.getAttribute("aria-label")).toBe(
        "Drinks, Every zone: Kitchen, set here. Staff lunch: Terrace bar",
      );
      // A waiting choice with no lines draws none.
      el.pending = { address: drinks, target: station("kitchen") };
      await el.updateComplete;
      expect(lines(el, "c:drinks", "every")).toEqual([]);
    });

    it("draws a waiting Clear with the station and lines it would inherit, as inherited", async () => {
      const { el } = await expanded(withCola());
      expect(lines(el, "p:cola", "every")).toEqual(["Staff lunch: Bar"]);
      el.pending = { address: colaEvery, target: null };
      await el.updateComplete;
      const cola = combo(el, "p:cola", "every")!;
      expect(shown(cola)).toEqual({ text: "Bar", muted: true });
      expect(lines(el, "p:cola", "every")).toEqual(["Lunch: Kitchen"]);
      expect(lineStyles(el, "p:cola", "every")[0]!.italic).toBe(true);
      expect(cola.getAttribute("aria-label")).toBe(
        "Drinks › Cola, Every zone: Bar, inherited. Lunch: Kitchen",
      );
    });

    it("says when a live update removes the open editor's zone or row with its changes unsaved", async () => {
      const lost: CellAddress[] = [];
      const { el } = await mount(timed());
      el.addEventListener("routing-draft-lost", (event) =>
        lost.push((event as CustomEvent<{ address: CellAddress }>).detail.address),
      );
      const terrace: CellAddress = { ...drinks, zoneId: "terrace" };
      const noTerrace = () =>
        routing({ zones: [{ id: "inside", name: "Inside", departmentId: null }] });
      // Unchanged: nothing is lost.
      await openEditor(el, combo(el, "c:drinks", "terrace")!);
      el.model = noTerrace();
      await el.updateComplete;
      expect(editorOf(el)).toBeNull();
      expect(lost).toEqual([]);
      // Changed: the change is lost, and said so.
      el.model = timed();
      await el.updateComplete;
      await pick(await openEditor(el, combo(el, "c:drinks", "terrace")!), "target", "Kitchen");
      el.model = noTerrace();
      await el.updateComplete;
      expect(editorOf(el)).toBeNull();
      expect(lost).toEqual([terrace]);
      // A row removed with the editor's changes in it.
      const { el: other } = await mount(timed());
      other.addEventListener("routing-draft-lost", (event) =>
        lost.push((event as CustomEvent<{ address: CellAddress }>).detail.address),
      );
      await pick(await openEditor(other, combo(other, "c:food", "every")!), "target", "Bar");
      other.model = {
        ...timed(),
        categories: timed().categories.filter(({ id }) => id !== "food"),
        products: timed().products.filter(({ id }) => id !== "burger"),
        cells: timed().cells.filter(
          ({ row }) => row.kind !== "category" || row.categoryId !== "food",
        ),
      };
      await other.updateComplete;
      expect(lost).toEqual([
        terrace,
        { row: { kind: "category", categoryId: "food" }, zoneId: null },
      ]);
    });

    it("leaves a waiting choice's lost row to its host, which says so itself", async () => {
      const lost: unknown[] = [];
      const { el } = await mount(timed());
      el.addEventListener("routing-draft-lost", (event) => lost.push(event));
      const terrace: CellAddress = { ...drinks, zoneId: "terrace" };
      await pick(await openEditor(el, combo(el, "c:drinks", "terrace")!), "target", "Kitchen");
      el.pending = { address: terrace, target: station("kitchen") };
      el.model = routing({ zones: [{ id: "inside", name: "Inside", departmentId: null }] });
      await el.updateComplete;
      expect(editorOf(el)).toBeNull();
      expect(lost).toEqual([]);
    });

    it("redraws a cell's lines when a live update brings them", async () => {
      const { el } = await mount(routing({ periods: [lunch, staff] }));
      expect(lines(el, "c:drinks", "every")).toEqual([]);
      el.model = timed();
      await el.updateComplete;
      expect(lines(el, "c:drinks", "every")).toEqual(["Lunch: Kitchen"]);
    });
  });
});
