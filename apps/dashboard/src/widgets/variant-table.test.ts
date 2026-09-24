import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { VariantTable } from "./variant-table.js";
import "./variant-table.js";
import { reorder } from "./reorder.js";
import type { ProductEditorVariant } from "../api/client.js";
import { t } from "../i18n/t.js";

afterEach(cleanupWidgets);

/**
 * Three variants. Each one's staff name and customer name are DIFFERENT text, so an assertion can
 * tell which of the two a cell is showing — the table is a staff screen and must show the staff
 * name. The last has never been saved, so it has no id: the table cannot depend on one.
 */
const threeVariants = (): ProductEditorVariant[] => [
  {
    id: "1f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f",
    name: "Media",
    customerName: { es: "Media ración" },
    kitchenName: "1/2",
    image: null,
    unitPrice: "6.50",
    available: true,
    active: true,
  },
  {
    id: "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f2f",
    name: "Entera",
    customerName: { es: "Ración entera" },
    kitchenName: "ENT",
    image: null,
    unitPrice: "12.00",
    available: false,
    active: true,
  },
  {
    name: "Doble",
    customerName: { es: "Ración doble" },
    kitchenName: "DOB",
    image: null,
    unitPrice: "20.00",
    available: true,
    active: true,
  },
];

async function mountTable(props: Partial<VariantTable> = {}) {
  return (
    await mountWidget<VariantTable>("dashboard-variant-table", {
      variants: threeVariants(),
      ...props,
    })
  ).el;
}

function rows(el: VariantTable) {
  return [...el.shadowRoot!.querySelectorAll("tbody tr")];
}
function cells(el: VariantTable, column: number) {
  return rows(el).map((row) => row.children[column]!.textContent!.trim());
}
function handles(el: VariantTable) {
  return rows(el).map((row) => row.querySelector<HTMLButtonElement>("button.handle")!);
}
function announcement(el: VariantTable) {
  return el.shadowRoot!.querySelector('[role="status"]')!.textContent;
}
function listen(el: VariantTable, name: string) {
  const seen = vi.fn();
  el.addEventListener(name, seen);
  return seen;
}
async function click(el: VariantTable, id: string) {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${id}"]`)!.click();
  await el.updateComplete;
}

it("lists one row per variant with its staff name and price, and changes the unit from the header", async () => {
  const el = await mountTable();
  expect(rows(el)).toHaveLength(3);
  expect(cells(el, 1)).toEqual(["Media", "Entera", "Doble"]);
  expect(cells(el, 2)).toEqual(["6.50", "12.00", "20.00"]);
  el.unitId = "kg";
  el.unitOptions = [
    { value: null, label: "Each" },
    { value: "kg", label: "kg" },
    { value: "l", label: "l" },
  ];
  await el.updateComplete;
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[name="pricing-unit"]')!;
  expect(select.value).toBe("kg");
  // The heading names the price once, and the select shows only the unit, so a narrow column
  // still has room to read it.
  expect(select.selectedOptions[0]!.textContent!.trim()).toBe("kg");
  expect(select.closest("th")!.textContent).toContain(t("product.price"));
  const changed = listen(el, "wt-unit-change");
  select.value = "l";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  expect(changed.mock.calls[0]![0].detail).toEqual({ unitId: "l" });
  // The table is a staff screen: the customer-facing name belongs to the receipt, not here.
  expect(el.shadowRoot!.textContent).not.toContain("Media ración");
});

it("returns the unit chooser to its saved value after Add unit is chosen", async () => {
  const el = await mountTable({
    unitId: "kg",
    unitOptions: [
      { value: null, label: "Each" },
      { value: "kg", label: "kg" },
    ],
    addUnitLabel: "Add unit",
  });
  const added = listen(el, "wt-add-unit");
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[name="pricing-unit"]')!;
  select.value = "__add__";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  expect(added).toHaveBeenCalledOnce();
  expect(select.value).toBe("kg");
});

it("keeps the unit chooser in the price heading a tap target on both axes", async () => {
  const el = await mountTable({
    unitId: "kg",
    unitOptions: [
      { value: null, label: "Each" },
      { value: "kg", label: "kg" },
    ],
  });
  const tapMin = parseFloat(getComputedStyle(el).getPropertyValue("--wt-tap-min"));
  expect(tapMin).toBeGreaterThan(0);
  const box = el
    .shadowRoot!.querySelector<HTMLSelectElement>('select[name="pricing-unit"]')!
    .getBoundingClientRect();
  expect(box.height).toBeGreaterThanOrEqual(tapMin);
  expect(box.width).toBeGreaterThanOrEqual(tapMin);
});

it("caps the name cell with the shared sizing token, not a literal width", async () => {
  const el = await mountTable();
  // Read the token off the element rather than restating its number here: if the token layer did not
  // define it the first assertion fails, so the comparison below can never pass on two blanks.
  const capped = getComputedStyle(el).getPropertyValue("--wt-cell-name-max-width").trim();
  expect(capped).not.toBe("");
  expect(getComputedStyle(rows(el)[0]!.children[1]!).maxWidth).toBe(capped);
});

it("reports which variant's availability changed, and does not let the switch's own event escape", async () => {
  const el = await mountTable();
  const toggled = listen(el, "wt-toggle-available");
  const changed = listen(el, "wt-change");
  el.shadowRoot!.querySelector('[data-test="available-1"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
  );
  expect(toggled).toHaveBeenCalledTimes(1);
  expect(toggled.mock.calls[0]![0].detail).toEqual({ index: 1, available: true });
  expect(toggled.mock.calls[0]![0].bubbles).toBe(true);
  expect(toggled.mock.calls[0]![0].composed).toBe(true);
  // Re-emitting without stopping the original would have the host count one change twice.
  expect(changed).not.toHaveBeenCalled();
});

it("edits and removes the variant whose row the menu belongs to", async () => {
  const el = await mountTable();
  const edit = listen(el, "wt-edit");
  const remove = listen(el, "wt-remove");
  await click(el, "edit-2");
  await click(el, "remove-0");
  expect(edit.mock.calls[0]![0].detail).toEqual({ index: 2 });
  expect(remove.mock.calls[0]![0].detail).toEqual({ index: 0 });
  expect(edit.mock.calls[0]![0].composed).toBe(true);
  expect(remove.mock.calls[0]![0].composed).toBe(true);
});

it("moves a row on ArrowDown, tells the host where it went, and announces the new position", async () => {
  const el = await mountTable();
  const reordered = listen(el, "wt-reorder");
  const first = handles(el)[0]!;
  const key = first.dataset.test;
  first.focus();
  first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await el.updateComplete;
  expect(reordered.mock.calls[0]![0].detail).toEqual({ from: 0, to: 1 });
  expect(cells(el, 1)).toEqual(["Entera", "Media", "Doble"]);
  expect(announcement(el)).toBe(
    t("action.reordered")
      .replace("{item}", "Media")
      .replace("{index}", "2")
      .replace("{total}", "3"),
  );
  // The host applies the move and hands the array back. The row keeps its identity, so the handle a
  // keyboard user is holding stays under their focus and a second press moves the same row again.
  el.variants = reorder(el.variants, 0, 1);
  await el.updateComplete;
  expect(cells(el, 1)).toEqual(["Entera", "Media", "Doble"]);
  // Named first: a handle that no longer exists would make `activeElement` and the query BOTH null,
  // and the comparison would pass while proving nothing.
  const moved = el.shadowRoot!.querySelector(`[data-test="${key}"]`);
  expect(moved).not.toBeNull();
  expect(el.shadowRoot!.activeElement).toBe(moved);
});

it("moves nothing when the top row is asked to go up", async () => {
  const el = await mountTable();
  const reordered = listen(el, "wt-reorder");
  handles(el)[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  await el.updateComplete;
  expect(reordered).not.toHaveBeenCalled();
  expect(cells(el, 1)).toEqual(["Media", "Entera", "Doble"]);
});

it("changes nothing while the product is being saved", async () => {
  const el = await mountTable({ busy: true });
  const seen = ["wt-reorder", "wt-edit", "wt-remove", "wt-toggle-available"].map((name) =>
    listen(el, name),
  );
  const first = handles(el)[0]!;
  expect(first.disabled).toBe(true);
  first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await click(el, "edit-0");
  await click(el, "remove-0");
  el.shadowRoot!.querySelector('[data-test="available-0"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked: false }, bubbles: true, composed: true }),
  );
  for (const listener of seen) expect(listener).not.toHaveBeenCalled();
});

it("gives a variant with no name yet a spoken name, so its handle and menu are not nameless", async () => {
  const el = await mountTable({
    variants: [
      {
        name: "",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "1.00",
        available: true,
        active: true,
      },
      {
        name: "Entera",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "2.00",
        available: true,
        active: true,
      },
    ],
  });
  expect(handles(el)[0]!.getAttribute("aria-label")).toBe(
    `${t("editor.reorder_variant")}: ${t("editor.variant")}`,
  );
});

it("takes a variant the host adds without renaming the rows already there", async () => {
  const el = await mountTable();
  const keys = handles(el).map((handle) => handle.dataset.test);
  el.variants = [
    ...el.variants,
    {
      name: "Triple",
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: "30.00",
      available: true,
      active: true,
    },
  ];
  await el.updateComplete;
  expect(cells(el, 1)).toEqual(["Media", "Entera", "Doble", "Triple"]);
  expect(
    handles(el)
      .map((handle) => handle.dataset.test)
      .slice(0, 3),
  ).toEqual(keys);
});

it("marks the row a reported problem belongs to, and leaves the others alone", async () => {
  const el = await mountTable({ errors: { 1: "Introduce un precio válido" } });
  const marked = rows(el).map((row) => row.classList.contains("invalid"));
  expect(marked).toEqual([false, true, false]);
  expect(el.shadowRoot!.querySelector('[data-test="error-1"]')!.textContent!.trim()).toBe(
    "Introduce un precio válido",
  );
  expect(el.shadowRoot!.querySelector('[data-test="error-0"]')).toBeNull();
  // The mark has to PAINT, not merely be in the DOM: a class whose rule never reaches these nodes
  // leaves a row that looks exactly like a valid one while every attribute assertion still passes.
  const border = (index: number) =>
    getComputedStyle(rows(el)[index]!.children[0]!).borderInlineStartWidth;
  expect(border(1)).not.toBe(border(0));
  expect(border(1)).toBe("2px");
});

/** The three variants with the middle one removed: Inactive, and saved, as only a saved variant can
 * be (a new one that is removed leaves the draft instead). */
const withRemoved = (): ProductEditorVariant[] =>
  threeVariants().map((variant, index) => (index === 1 ? { ...variant, active: false } : variant));

async function showStatus(el: VariantTable, status: string) {
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[name="variant-status"]')!;
  select.value = status;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
}

it("shows a variant with no price of its own as the base price it sells at", async () => {
  const el = await mountTable({
    basePrice: "9.00",
    variants: threeVariants().map((variant, index) =>
      index === 0 ? { ...variant, unitPrice: null } : variant,
    ),
  });
  expect(cells(el, 2)).toEqual([t("editor.same_as").replace("{value}", "9.00"), "12.00", "20.00"]);
});

it("hides Inactive variants until the status filter asks for them", async () => {
  const el = await mountTable({ variants: withRemoved() });
  expect(cells(el, 1)).toEqual(["Media", "Doble"]);
  const names = () => cells(el, 1).map((text) => text.replace(/\s+/g, " "));
  await showStatus(el, "inactive");
  expect(names()).toEqual([`Entera ${t("product.inactive_badge")}`]);
  await showStatus(el, "all");
  expect(names()).toEqual(["Media", `Entera ${t("product.inactive_badge")}`, "Doble"]);
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[name="variant-status"]')!;
  expect(select.selectedOptions[0]!.textContent!.trim()).toBe(t("product.filter_status_all"));
});

it("says so when no variant has the chosen status", async () => {
  const el = await mountTable();
  expect(el.shadowRoot!.querySelector('[data-test="no-variants"]')).toBeNull();
  await showStatus(el, "inactive");
  expect(rows(el)).toHaveLength(0);
  expect(el.shadowRoot!.querySelector('[data-test="no-variants"]')!.textContent!.trim()).toBe(
    t("editor.no_variants_status"),
  );
});

it("names each row by its place in the whole list, hidden rows included", async () => {
  const el = await mountTable({ variants: withRemoved() });
  const edit = listen(el, "wt-edit");
  const remove = listen(el, "wt-remove");
  // Doble is the second row on screen and the THIRD variant the host holds.
  await click(el, "edit-2");
  await click(el, "remove-2");
  expect(edit.mock.calls[0]![0].detail).toEqual({ index: 2 });
  expect(remove.mock.calls[0]![0].detail).toEqual({ index: 2 });
});

it("offers Restore instead of Remove on an Inactive variant", async () => {
  const el = await mountTable({ variants: withRemoved() });
  await showStatus(el, "inactive");
  expect(el.shadowRoot!.querySelector('[data-test="remove-1"]')).toBeNull();
  const restore = listen(el, "wt-restore");
  await click(el, "restore-1");
  expect(restore.mock.calls[0]![0].detail).toEqual({ index: 1 });
  expect(restore.mock.calls[0]![0].composed).toBe(true);
});

it("opens a saved variant's own page, and offers nothing to open for one never saved", async () => {
  const el = await mountTable();
  const open = listen(el, "wt-open");
  await click(el, "open-1");
  expect(open.mock.calls[0]![0].detail).toEqual({ index: 1 });
  expect(open.mock.calls[0]![0].composed).toBe(true);
  // Doble has no id yet, so there is no page to open until the product is saved.
  expect(el.shadowRoot!.querySelector('[data-test="open-2"]')).toBeNull();
});

it("moves a row among the rows on screen and reports the move in the whole list", async () => {
  const el = await mountTable({ variants: withRemoved() });
  const reordered = listen(el, "wt-reorder");
  handles(el)[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await el.updateComplete;
  expect(cells(el, 1)).toEqual(["Doble", "Media"]);
  // Media lands where Doble was, past the hidden Entera, so the host's list reads Entera, Doble,
  // Media — the same order among the visible rows as the screen shows.
  expect(reordered.mock.calls[0]![0].detail).toEqual({ from: 0, to: 2 });
  expect(reorder(withRemoved(), 0, 2).map((variant) => variant.name)).toEqual([
    "Entera",
    "Doble",
    "Media",
  ]);
  expect(announcement(el)).toBe(
    t("action.reordered")
      .replace("{item}", "Media")
      .replace("{index}", "2")
      .replace("{total}", "2"),
  );
});

it("shows every row when a problem is reported against one the filter hides", async () => {
  const el = await mountTable({ variants: withRemoved(), errors: { 1: "Introduce un nombre" } });
  expect(cells(el, 1)[1]).toContain("Entera");
  expect(el.shadowRoot!.querySelector('[data-test="error-1"]')).not.toBeNull();
});

it("changes nothing from Open or Restore while the product is being saved", async () => {
  const el = await mountTable({ variants: withRemoved(), busy: true });
  await showStatus(el, "all");
  const seen = ["wt-open", "wt-restore"].map((name) => listen(el, name));
  await click(el, "open-0");
  await click(el, "restore-1");
  for (const listener of seen) expect(listener).not.toHaveBeenCalled();
});

it("shows every row when a variant is added while the filter shows only Inactive ones", async () => {
  const el = await mountTable({ variants: withRemoved().slice(0, 2) });
  await showStatus(el, "inactive");
  expect(cells(el, 1)).toHaveLength(1);
  el.variants = [...el.variants, threeVariants()[2]!];
  await el.updateComplete;
  expect(cells(el, 1).map((text) => text.split(/\s/)[0])).toEqual(["Media", "Entera", "Doble"]);
  // Choosing the filter again is honoured: the new row forced it open once, not for good.
  await showStatus(el, "inactive");
  expect(cells(el, 1)).toHaveLength(1);
});

it("shows no price hint at all while the product has no base price yet", async () => {
  const el = await mountTable({
    basePrice: "",
    variants: threeVariants().map((variant, index) =>
      index === 0 ? { ...variant, unitPrice: null } : variant,
    ),
  });
  expect(cells(el, 2)).toEqual(["", "12.00", "20.00"]);
});

it("disables Open and says why while the product has changes not yet saved", async () => {
  const el = await mountTable({ openBlocked: true });
  const open = listen(el, "wt-open");
  const button = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    '[data-test="open-0"]',
  )!;
  expect(button.disabled).toBe(true);
  button.click();
  expect(open).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector('[data-test="open-blocked"]')!.textContent!.trim()).toBe(
    t("editor.open_variant_blocked"),
  );
  // Edit and Remove act on the draft itself, so they stay available.
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>('[data-test="edit-0"]')!
      .disabled,
  ).toBe(false);
  el.openBlocked = false;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[data-test="open-blocked"]')).toBeNull();
  await click(el, "open-0");
  expect(open).toHaveBeenCalledOnce();
});

it("names each row's availability switch without repeating the column heading beside it", async () => {
  const el = await mountTable();
  const toggle = el.shadowRoot!.querySelector('[data-test="available-0"]')!;
  expect(toggle.hasAttribute("hide-label")).toBe(true);
  expect(toggle.getAttribute("label")).toBe(t("editor.available"));
});

/** Applies Remove and Restore the way the product editor does: the variant is handed back as a NEW
 * object, or — one never saved — dropped. */
function applyRemoveAndRestore(el: VariantTable) {
  const set = (index: number, active: boolean) =>
    el.variants.map((variant, i) => (i === index ? { ...variant, active } : variant));
  el.addEventListener("wt-remove", (event) => {
    const { index } = (event as CustomEvent<{ index: number }>).detail;
    el.variants =
      el.variants[index]!.id === undefined
        ? el.variants.filter((_, i) => i !== index)
        : set(index, false);
  });
  el.addEventListener("wt-restore", (event) => {
    el.variants = set((event as CustomEvent<{ index: number }>).detail.index, true);
  });
}
/** Chooses a row's action from its menu, the way a keyboard user does. */
async function chooseFromMenu(el: VariantTable, action: string, index: number) {
  el.shadowRoot!.querySelector<HTMLElement & { show(): void }>(
    `[data-test="actions-${index}"]`,
  )!.show();
  const button = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${action}-${index}"]`)!;
  button.focus();
  button.click();
  await el.updateComplete;
}
const focused = (el: VariantTable) => {
  const active = el.shadowRoot!.activeElement;
  return active?.getAttribute("data-test") ?? active?.getAttribute("name") ?? null;
};

it("keeps focus on a row's actions when Remove or Restore leaves the row on screen", async () => {
  const el = await mountTable({ variants: withRemoved() });
  applyRemoveAndRestore(el);
  await showStatus(el, "all");
  await chooseFromMenu(el, "restore", 1);
  await expect.poll(() => focused(el)).toBe("actions-1");
  await chooseFromMenu(el, "remove", 1);
  await expect.poll(() => focused(el)).toBe("actions-1");
  expect(el.variants[1]!.active).toBe(false);
});

it("moves focus to the next row on screen when Remove hides the row, and to the filter when none is left", async () => {
  const el = await mountTable();
  applyRemoveAndRestore(el);
  await chooseFromMenu(el, "remove", 0);
  await expect.poll(() => focused(el)).toBe("actions-1");
  // Doble was never saved, so it leaves the list and there is no row after it: focus goes back up.
  await chooseFromMenu(el, "remove", 2);
  await expect.poll(() => focused(el)).toBe("actions-1");
  await chooseFromMenu(el, "remove", 1);
  await expect.poll(() => focused(el)).toBe("variant-status");
});
