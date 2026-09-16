import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { VariantTable } from "./variant-table.js";
import "./variant-table.js";
import { reorder } from "./reorder.js";
import { priceLabel } from "./form-fields.js";
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
  },
  {
    id: "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f2f",
    name: "Entera",
    customerName: { es: "Ración entera" },
    kitchenName: "ENT",
    image: null,
    unitPrice: "12.00",
    available: false,
  },
  {
    name: "Doble",
    customerName: { es: "Ración doble" },
    kitchenName: "DOB",
    image: null,
    unitPrice: "20.00",
    available: true,
  },
];

async function mountTable(props: Partial<VariantTable> = {}) {
  return (
    await mountWidget<VariantTable>("dashboard-variant-table", {
      variants: threeVariants(),
      unitLabel: "kg",
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
  expect(select.selectedOptions[0]!.textContent!.trim()).toBe(priceLabel("kg"));
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
      },
      {
        name: "Entera",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "2.00",
        available: true,
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
