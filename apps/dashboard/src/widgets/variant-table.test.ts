import { reorder } from "@waitron/ui";
import { afterEach, expect, it, vi } from "vitest";
import { middleWithin, textLines } from "@waitron/ui/src/test-helpers.js";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { VariantTable } from "./variant-table.js";
import "./variant-table.js";
import type { ProductEditorVariant } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";

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

/** A Spanish price, which the suite's default language writes with a no-break space before the
 * sign. The stacked-price assertions fold every space to a plain one, so they spell it plainly. */
const euros = (amount: string) => `${amount}\u00a0€`;

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
  return rows(el).map((row) => {
    // The copy of the price a narrow table shows under the name is not part of the name.
    const cell = row.children[column]!.cloneNode(true) as Element;
    cell.querySelector(".stacked-price")?.remove();
    return cell.textContent!.trim();
  });
}
/** Runs `body` with the test frame at a desktop width, where the table keeps its price column. */
async function atDesktopWidth(body: () => Promise<void>): Promise<void> {
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(1280, 800);
  try {
    expect(window.innerWidth).toBe(1280);
    await body();
  } finally {
    await page.viewport(width, height);
  }
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

/** The price heading's button, which opens the product editor's unit chooser. */
const unitButton = (el: VariantTable) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="pricing-unit"]')!;

it("draws no status dropdown: whether Inactive variants show is the host's to say", async () => {
  const el = await mountTable({ variants: withRemoved() });
  expect(el.shadowRoot!.querySelector("wt-combobox[name=variant-status]")).toBeNull();
  expect(el.showInactive).toBe(false);
  expect(cells(el, 1)).toEqual(["Media", "Doble"]);
});

it("asks for the pricing unit chooser from a button in the price heading that names the unit", async () => {
  const el = await mountTable({ unitLabel: "kg" });
  const unit = unitButton(el);
  expect(unit).not.toBeNull();
  expect(unit.textContent!.trim()).toBe("kg");
  expect(unit.getAttribute("aria-label")).toBe(
    t("editor.change_pricing_unit").replace("{unit}", "kg"),
  );
  expect(unit.getAttribute("aria-haspopup")).toBe("dialog");
  const asked = listen(el, "wt-unit-click");
  unit.click();
  expect(asked).toHaveBeenCalledOnce();
  expect(asked.mock.calls[0]![0].detail).toEqual({});
  el.busy = true;
  await el.updateComplete;
  expect(unit.disabled).toBe(true);
});

it("lists one row per variant with its staff name and price, and names the unit in the header", async () => {
  const el = await mountTable();
  expect(rows(el)).toHaveLength(3);
  expect(cells(el, 1)).toEqual(["Media", "Entera", "Doble"]);
  expect(cells(el, 2)).toEqual([euros("6,50"), euros("12,00"), euros("20,00")]);
  el.unitLabel = "kg";
  await el.updateComplete;
  const unit = unitButton(el);
  // The heading names the price once, and the button shows only the unit, so a narrow column
  // still has room to read it.
  expect(unit.textContent!.trim()).toBe("kg");
  expect(unit.closest("th")!.textContent).toContain(t("product.price"));
  const asked = listen(el, "wt-unit-click");
  unit.click();
  expect(asked).toHaveBeenCalledOnce();
  // The table is a staff screen: the customer-facing name belongs to the receipt, not here.
  expect(el.shadowRoot!.textContent).not.toContain("Media ración");
});

it("puts focus back on the price heading's unit button when asked", async () => {
  await atDesktopWidth(async () => {
    const el = await mountTable({ unitLabel: "kg" });
    await el.focusUnit();
    expect(el.shadowRoot!.activeElement).toBe(unitButton(el));
  });
});

it("keeps the unit button in the price heading a tap target on both axes", async () => {
  await atDesktopWidth(async () => {
    const el = await mountTable({ unitLabel: "kg" });
    const tapMin = parseFloat(getComputedStyle(el).getPropertyValue("--wt-tap-min"));
    expect(tapMin).toBeGreaterThan(0);
    const rect = unitButton(el).getBoundingClientRect();
    expect(rect.height).toBeGreaterThanOrEqual(tapMin);
    expect(rect.width).toBeGreaterThanOrEqual(tapMin);
  });
});

it("leaves a --wt-space-2 gap between the price heading's word and its unit button", async () => {
  await atDesktopWidth(async () => {
    const el = await mountTable({ unitLabel: "kg" });
    const button = unitButton(el);
    const word = [...button.parentElement!.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== "",
    )!;
    expect(word.textContent!.trim()).toBe(t("product.price"));
    const range = document.createRange();
    range.selectNodeContents(word);
    const wordEnd = range.getBoundingClientRect().right;
    const buttonStart = button.getBoundingClientRect().left;
    expect(buttonStart).toBeGreaterThan(wordEnd);
    const space2 = parseFloat(getComputedStyle(el).getPropertyValue("--wt-space-2"));
    expect(space2).toBeGreaterThan(0);
    expect(buttonStart - wordEnd).toBeCloseTo(space2, 0);
  });
});

// Each width shows the price exactly once, so neither a sighted person nor a screen reader meets it
// twice: in its own column on a wide table, under the name on a narrow one.
it("moves each price under its name on a narrow table, and back to its own column on a wide one", async () => {
  const shown = (element: Element | null) => (element?.getClientRects().length ?? 0) > 0;
  const el = await mountTable({ basePrice: "9.00" });
  el.variants = [{ ...threeVariants()[0]!, unitPrice: null }, ...threeVariants().slice(1)];
  await el.updateComplete;
  el.style.width = "20rem";
  await new Promise((resolve) => requestAnimationFrame(resolve));
  for (const row of rows(el)) {
    expect(shown(row.children[2]!)).toBe(false);
    expect(shown(row.querySelector(".stacked-price"))).toBe(true);
  }
  expect(shown(el.shadowRoot!.querySelector("thead th:nth-child(3)"))).toBe(false);
  const stacked = (index: number) =>
    el.shadowRoot!.querySelector(`[data-test="stacked-price-${index}"]`)!.textContent!;
  expect(stacked(0).replace(/\s+/g, " ").trim()).toBe(`${t("product.price")} 9,00 €`);
  expect(stacked(2).replace(/\s+/g, " ").trim()).toBe(`${t("product.price")} 20,00 €`);
  el.style.width = "40rem";
  await new Promise((resolve) => requestAnimationFrame(resolve));
  for (const row of rows(el)) {
    expect(shown(row.children[2]!)).toBe(true);
    expect(shown(row.querySelector(".stacked-price"))).toBe(false);
  }
  expect(cells(el, 2)).toEqual([euros("9,00"), euros("12,00"), euros("20,00")]);
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
  expect(activator(el, 0)!.disabled).toBe(true);
  await click(el, "edit-row-0");
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

async function showInactive(el: VariantTable, show = true) {
  el.showInactive = show;
  await el.updateComplete;
}

it("shows a variant with no price of its own as the base price it sells at", async () => {
  const el = await mountTable({
    basePrice: "9.00",
    variants: threeVariants().map((variant, index) =>
      index === 0 ? { ...variant, unitPrice: null } : variant,
    ),
  });
  expect(cells(el, 2)).toEqual([euros("9,00"), euros("12,00"), euros("20,00")]);
});

it.each([
  {
    locale: "en-GB",
    disable: "Disable",
    enable: "Enable",
    remove: "Remove",
    badge: "Disabled",
    none: "Every variant is disabled.",
  },
  {
    locale: "es-ES",
    disable: "Deshabilitar",
    enable: "Habilitar",
    remove: "Eliminar",
    badge: "Deshabilitada",
    none: "Todas las variantes están deshabilitadas.",
  },
])(
  "in $locale, disables and enables a saved variant, and removes one never saved",
  async ({ locale, disable, enable, remove, badge, none }) => {
    setLocale(locale);
    try {
      const el = await mountTable({ variants: withRemoved() });
      await showInactive(el);
      const label = (test: string) =>
        el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`)!.textContent!.trim();
      expect([label("remove-0"), label("restore-1"), label("remove-2")]).toEqual([
        disable,
        enable,
        remove,
      ]);
      expect(label("inactive-1")).toBe(badge);
      el.variants = el.variants.map((variant) => ({ ...variant, id: variant.name, active: false }));
      el.showInactive = false;
      await el.updateComplete;
      expect(label("no-variants")).toBe(none);
    } finally {
      setLocale("es-ES");
    }
  },
);

it("hides disabled variants until the host asks for them, in their place in the list", async () => {
  const el = await mountTable({ variants: withRemoved() });
  expect(cells(el, 1)).toEqual(["Media", "Doble"]);
  const names = () => cells(el, 1).map((text) => text.replace(/\s+/g, " "));
  await showInactive(el);
  expect(names()).toEqual(["Media", `Entera ${t("product.variant_disabled_badge")}`, "Doble"]);
  await showInactive(el, false);
  expect(names()).toEqual(["Media", "Doble"]);
});

it("says so when every variant is disabled and hidden", async () => {
  const el = await mountTable();
  expect(el.shadowRoot!.querySelector('[data-test="no-variants"]')).toBeNull();
  el.variants = el.variants.map((variant) => ({ ...variant, id: variant.name, active: false }));
  await el.updateComplete;
  expect(rows(el)).toHaveLength(0);
  expect(el.shadowRoot!.querySelector('[data-test="no-variants"]')!.textContent!.trim()).toBe(
    t("editor.variants_all_disabled"),
  );
  await showInactive(el);
  expect(rows(el)).toHaveLength(3);
  expect(el.shadowRoot!.querySelector('[data-test="no-variants"]')).toBeNull();
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
  await showInactive(el);
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

it("shows every row when a problem is reported against a hidden Inactive one", async () => {
  const el = await mountTable({ variants: withRemoved(), errors: { 1: "Introduce un nombre" } });
  expect(cells(el, 1)[1]).toContain("Entera");
  expect(el.shadowRoot!.querySelector('[data-test="error-1"]')).not.toBeNull();
});

it("changes nothing from Open or Restore while the product is being saved", async () => {
  const el = await mountTable({ variants: withRemoved(), busy: true });
  await showInactive(el);
  const seen = ["wt-open", "wt-restore"].map((name) => listen(el, name));
  await click(el, "open-0");
  await click(el, "restore-1");
  for (const listener of seen) expect(listener).not.toHaveBeenCalled();
});

it("shows every row when a variant is added that the hidden rows would hide", async () => {
  const el = await mountTable({ variants: withRemoved().slice(0, 2) });
  expect(cells(el, 1)).toHaveLength(1);
  el.variants = [...el.variants, { ...threeVariants()[2]!, active: false }];
  await el.updateComplete;
  expect(cells(el, 1).map((text) => text.split(/\s/)[0])).toEqual(["Media", "Entera", "Doble"]);
  // Hiding them again is honoured: the new row showed them once, not for good.
  await showInactive(el, false);
  expect(cells(el, 1)).toHaveLength(1);
});

it("tells the host when it shows the Inactive rows itself, and only then", async () => {
  const el = await mountTable({ variants: withRemoved() });
  const shown = listen(el, "wt-show-inactive");
  el.variants = [...el.variants];
  await el.updateComplete;
  expect(shown).not.toHaveBeenCalled();
  el.errors = { 1: "Introduce un nombre" };
  await el.updateComplete;
  expect(el.showInactive).toBe(true);
  expect(shown).toHaveBeenCalledOnce();
  expect(shown.mock.calls[0]![0].detail).toEqual({ show: true });
  expect(shown.mock.calls[0]![0].composed).toBe(true);
});

it("shows no price hint at all while the product has no base price yet", async () => {
  const el = await mountTable({
    basePrice: "",
    variants: threeVariants().map((variant, index) =>
      index === 0 ? { ...variant, unitPrice: null } : variant,
    ),
  });
  expect(cells(el, 2)).toEqual(["", euros("12,00"), euros("20,00")]);
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
  await showInactive(el);
  await chooseFromMenu(el, "restore", 1);
  await expect.poll(() => focused(el)).toBe("actions-1");
  await chooseFromMenu(el, "remove", 1);
  await expect.poll(() => focused(el)).toBe("actions-1");
  expect(el.variants[1]!.active).toBe(false);
});

it("moves focus to the next row on screen when Remove hides the row, and leaves it to the host when none is left", async () => {
  const el = await mountTable();
  applyRemoveAndRestore(el);
  await chooseFromMenu(el, "remove", 0);
  await expect.poll(() => focused(el)).toBe("actions-1");
  // Doble was never saved, so it leaves the list and there is no row after it: focus goes back up.
  await chooseFromMenu(el, "remove", 2);
  await expect.poll(() => focused(el)).toBe("actions-1");
  await chooseFromMenu(el, "remove", 1);
  await el.updateComplete;
  // No row is left on screen, so the next control is outside the table: the host's to choose.
  expect(rows(el)).toHaveLength(0);
  expect(focused(el)).toBeNull();
});

// Spanish writes a no-break space (U+00A0) before the sign, spelled out here rather than taken from
// the formatter the table calls.
it.each([
  { locale: "en-GB", base: "€9.00", own: "€12.00" },
  { locale: "es-ES", base: "9,00\u00a0€", own: "12,00\u00a0€" },
])(
  "writes each price, and the base price a variant sells at, with the euro sign where $locale writes it",
  async ({ locale, base, own }) => {
    setLocale(locale);
    try {
      const el = await mountTable({
        basePrice: "9.00",
        variants: threeVariants().map((variant, index) =>
          index === 0 ? { ...variant, unitPrice: null } : variant,
        ),
      });
      const amounts = (at: Element) =>
        [...at.querySelectorAll(".amount")].map((a) => a.textContent);
      expect(cells(el, 2).slice(0, 2)).toEqual([base, own]);
      expect(amounts(rows(el)[1]!.children[2]!)).toEqual([own]);
      // The copy under the name, which a narrow table shows, is written the same way.
      expect(amounts(el.shadowRoot!.querySelector('[data-test="stacked-price-0"]')!)).toEqual([
        base,
      ]);
      expect(amounts(el.shadowRoot!.querySelector('[data-test="stacked-price-1"]')!)).toEqual([
        own,
      ]);
    } finally {
      setLocale("es-ES");
    }
  },
);

it("draws the base price a variant sells at in grey italic, like a field's hint", async () => {
  const el = await mountTable({
    basePrice: "9.00",
    variants: threeVariants().map((variant, index) =>
      index === 0 ? { ...variant, unitPrice: null } : variant,
    ),
  });
  el.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  for (const at of [
    rows(el)[0]!.children[2]!,
    el.shadowRoot!.querySelector('[data-test="stacked-price-0"]')!,
  ]) {
    const amount = at.querySelector(".amount")!;
    expect(getComputedStyle(amount).fontStyle).toBe("italic");
    expect(getComputedStyle(amount).color).toBe("rgb(7, 8, 9)");
  }
  expect(getComputedStyle(rows(el)[1]!.children[2]!.querySelector(".amount")!).fontStyle).toBe(
    "normal",
  );
  expect(getComputedStyle(rows(el)[1]!.children[2]!.querySelector(".amount")!).color).not.toBe(
    "rgb(7, 8, 9)",
  );
});

it("shows a base price still being typed as it stands, not as a sign beside NaN", async () => {
  const el = await mountTable({
    basePrice: "9,5x",
    variants: threeVariants().map((variant, index) =>
      index === 0 ? { ...variant, unitPrice: null } : variant,
    ),
  });
  expect(cells(el, 2)[0]).toBe("9,5x");
});

/** The control a click anywhere on a row's free space lands on: the row is an Edit button. */
function activator(el: VariantTable, index: number) {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(`[data-test="edit-row-${index}"]`);
}
/** What a pointer at the middle of `target` would land on, as the table's shadow root sees it. */
function hit(el: VariantTable, target: Element): Element | null {
  const box = target.getBoundingClientRect();
  return el.shadowRoot!.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
}

it("opens a variant's edit window from a click anywhere on its row", async () => {
  await atDesktopWidth(async () => {
    const el = await mountTable({ variants: withRemoved() });
    const edit = listen(el, "wt-edit");
    await showInactive(el);
    // What is under the pointer on the name and on the price is what gets the click.
    const onName = hit(el, rows(el)[2]!.children[1]!);
    const onPrice = hit(el, rows(el)[0]!.children[2]!);
    expect(onName).toBe(activator(el, 2));
    expect(onPrice).toBe(activator(el, 0));
    (onName as HTMLElement).click();
    (onPrice as HTMLElement).click();
    expect(edit.mock.calls.map(([event]) => event.detail)).toEqual([{ index: 2 }, { index: 0 }]);
    expect(edit.mock.calls[0]![0].bubbles).toBe(true);
    expect(edit.mock.calls[0]![0].composed).toBe(true);
  });
});

it("opens a variant's edit window from Enter on its row, named for a screen reader", async () => {
  const el = await mountTable();
  const edit = listen(el, "wt-edit");
  const row = activator(el, 1)!;
  expect(row).not.toBeNull();
  expect(row.getAttribute("aria-label")).toBe(`${t("action.edit")}: Entera`);
  row.focus();
  await userEvent.keyboard("{Enter}");
  expect(edit.mock.calls.map(([event]) => event.detail)).toEqual([{ index: 1 }]);
});

it("leaves the drag handle, the Available switch and the row menu under the pointer", async () => {
  await atDesktopWidth(async () => {
    const el = await mountTable();
    const row = rows(el)[0]!;
    expect(activator(el, 0)).not.toBeNull();
    for (const control of [
      row.querySelector("button.handle")!,
      row.querySelector('[data-test="available-0"]')!,
      row.querySelector('[data-test="actions-0"]')!,
    ]) {
      const under = hit(el, control);
      expect(under === control || control.contains(under)).toBe(true);
    }
  });
});

/** A point inside `cell` that is not on `control`: the strip of padding above it. */
function besideControl(cell: Element, control: Element): { x: number; y: number } {
  const room = cell.getBoundingClientRect();
  const y = room.top + 2;
  expect(y).toBeLessThan(control.getBoundingClientRect().top);
  return { x: room.left + room.width / 2, y };
}

it("opens a variant's edit window from the empty space beside the handle, the switch and the menu", async () => {
  await atDesktopWidth(async () => {
    const el = await mountTable();
    const edit = listen(el, "wt-edit");
    const row = rows(el)[1]!;
    const button = activator(el, 1)!;
    for (const control of [
      row.querySelector("button.handle")!,
      row.querySelector('[data-test="available-1"]')!,
      row.querySelector('[data-test="actions-1"]')!,
    ]) {
      const { x, y } = besideControl(control.closest("td")!, control);
      expect(el.shadowRoot!.elementFromPoint(x, y)).toBe(button);
      // A real click: Playwright refuses one whose point some other element would take.
      const box = button.getBoundingClientRect();
      await userEvent.click(button, { position: { x: x - box.left, y: y - box.top } });
    }
    expect(edit.mock.calls.map(([event]) => event.detail)).toEqual([
      { index: 1 },
      { index: 1 },
      { index: 1 },
    ]);
  });
});

it("keeps every part of the Available switch above the row's button", async () => {
  await atDesktopWidth(async () => {
    const el = await mountTable();
    const edit = listen(el, "wt-edit");
    const toggle = el.shadowRoot!.querySelector<HTMLElement>('[data-test="available-0"]')!;
    const box = toggle.getBoundingClientRect();
    const thumb = toggle.shadowRoot!.querySelector(".thumb")!.getBoundingClientRect();
    const points = [
      { x: box.left + 1, y: box.top + 1 },
      { x: box.right - 1, y: box.top + 1 },
      { x: box.left + 1, y: box.bottom - 1 },
      { x: box.right - 1, y: box.bottom - 1 },
      { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      { x: thumb.left + thumb.width / 2, y: thumb.top + thumb.height / 2 },
    ];
    for (const { x, y } of points) expect(el.shadowRoot!.elementFromPoint(x, y)).toBe(toggle);
    for (const { x, y } of points) {
      await userEvent.click(toggle, { position: { x: x - box.left, y: y - box.top } });
    }
    expect(edit).not.toHaveBeenCalled();
  });
});

it("draws a dragged row over the controls of the rows it passes", async () => {
  await atDesktopWidth(async () => {
    const el = await mountTable();
    const [dragged, passed] = rows(el) as HTMLElement[];
    const start = dragged!.getBoundingClientRect();
    const centre = start.top + start.height / 2;
    const pointer = (target: EventTarget, type: string, clientY: number) =>
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientY }));
    pointer(handles(el)[0]!, "pointerdown", centre);
    try {
      // Not far enough to swap the rows: the dragged one now overlaps the top of the next.
      pointer(document, "pointermove", centre + 0.4 * start.height);
      await el.updateComplete;
      expect(cells(el, 1)).toEqual(["Media", "Entera", "Doble"]);
      const toggle = passed!.querySelector('[data-test="available-1"]')!.getBoundingClientRect();
      const y = toggle.top + 2;
      expect(y).toBeLessThan(dragged!.getBoundingClientRect().bottom);
      const under = el.shadowRoot!.elementFromPoint(toggle.left + toggle.width / 2, y);
      expect(dragged!.contains(under)).toBe(true);
    } finally {
      pointer(document, "pointerup", centre);
    }
  });
});

/** The colour `token` resolves to where the table is mounted, read off a probe painted with it. */
function resolved(el: VariantTable, token: string): string {
  const probe = document.createElement("div");
  probe.style.background = `var(${token})`;
  el.parentElement!.appendChild(probe);
  const colour = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return colour;
}

it.each(["light", "dark"] as const)(
  "tints a hovered or focused row in a colour the dialog's panel is not, and leaves a dragged row lifted (%s)",
  async (theme) => {
    const { el } = await mountWidget<VariantTable>(
      "dashboard-variant-table",
      { variants: threeVariants() },
      theme,
    );
    const tint = resolved(el, "--wt-color-bg");
    // In the app the table sits inside a dialog painted with the raised surface.
    expect(tint).not.toBe(resolved(el, "--wt-color-surface-raised"));
    const name = (index: number) => rows(el)[index]!.children[1]!;
    expect(getComputedStyle(name(0)).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    // Aimed at the name, which nothing but the row's button covers.
    const button = activator(el, 0)!.getBoundingClientRect();
    const onName = name(0).getBoundingClientRect();
    const y = onName.top + onName.height / 2;
    await userEvent.hover(activator(el, 0)!, {
      position: { x: onName.left + onName.width / 2 - button.left, y: y - button.top },
    });
    expect(getComputedStyle(name(0)).backgroundColor).toBe(tint);
    activator(el, 1)!.focus();
    expect(getComputedStyle(name(1)).backgroundColor).toBe(tint);

    const row = rows(el)[0] as HTMLElement;
    handles(el)[0]!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientY: y }),
    );
    try {
      expect(row.hasAttribute("data-dragging")).toBe(true);
      expect(row.matches(":hover")).toBe(true);
      expect(getComputedStyle(name(0)).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(row).backgroundColor).toBe(resolved(el, "--wt-color-surface-lifted"));
    } finally {
      document.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientY: y }),
      );
    }
  },
);

it.each([
  [1280, "light"],
  [1280, "dark"],
  [390, "light"],
  [390, "dark"],
] as const)(
  "puts a row's grip, price, Available switch and row menu on the first line of a wrapping name at %ipx (%s)",
  async (frame, theme) => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(frame, 844);
    try {
      const [first, ...rest] = threeVariants();
      const { el } = await mountWidget<VariantTable>(
        "dashboard-variant-table",
        {
          variants: [
            {
              ...first!,
              name: "Half a portion for sharing between two at the bar, served on the small board with bread and a little olive oil from the village, cut thin at the counter while you wait and finished with salt flakes and a twist of black pepper",
            },
            ...rest,
          ],
        },
        theme,
      );
      expect(el.parentElement!.getAttribute("data-theme")).toBe(theme);
      const row = rows(el)[0]!;
      const name = row.children[1]!;
      const handle = handles(el)[0]!;

      expect(window.innerWidth).toBe(frame);
      expect(row.getBoundingClientRect().height).toBeGreaterThan(
        handle.getBoundingClientRect().height * 1.5,
      );
      expect(textLines(name).length, "the name wraps").toBeGreaterThan(1);
      const line = textLines(name)[0]!;
      const within = middleWithin(line);
      const icon = (handle.querySelector("wt-icon") ?? handle).getBoundingClientRect();
      const toggle = row
        .querySelector('[data-test="available-0"]')!
        .shadowRoot!.querySelector(".track")!
        .getBoundingClientRect();
      const menu = row.querySelector('[data-test="actions-0"]')!.getBoundingClientRect();
      // A narrow table moves the price under the name and hides its column.
      const price = textLines(row.children[2]!)[0];
      expect(
        {
          icon: within(icon),
          toggle: within(toggle),
          menu: within(menu),
          price: price ? within(price) : "hidden",
        },
        JSON.stringify({ line, icon, toggle, menu, price }),
      ).toEqual({
        icon: true,
        toggle: true,
        menu: true,
        price: frame === 1280 ? true : "hidden",
      });
    } finally {
      await page.viewport(width, height);
    }
  },
);
