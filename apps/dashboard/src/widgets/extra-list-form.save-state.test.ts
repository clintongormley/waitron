import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { ExtraListForm } from "./extra-list-form.js";
import type { ExtraList, ExtraListInput, Product } from "../api/client.js";
import { t } from "../i18n/t.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

const BACON = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const EGG = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const CHEESE = "cccccccc-3333-4333-8333-cccccccccccc";
const TOAST = "dddddddd-4444-4444-8444-dddddddddddd";
const BACON_ITEM = "11111111-1111-4111-8111-111111111111";
const EGG_ITEM = "22222222-2222-4222-8222-222222222222";
const CHEESE_ITEM = "33333333-3333-4333-8333-333333333333";

const EACH = {
  id: "00000000-0000-0000-0000-000000000001",
  name: { es: "Unidad" },
  precision: 0,
  abbreviation: { es: "ud" },
};
const KG = {
  id: "unit-kg",
  name: { en: "Kilogram", es: "Kilogramo" },
  precision: 3,
  abbreviation: { en: "kg", es: "kilo" },
};

function product(id: string, name: string, unitPrice: string, unit = EACH): Product {
  return {
    id,
    modifiers: [],
    catalogueId: "cat-1",
    categoryId: "category-1",
    primaryCategoryId: "category-1",
    name,
    customerName: { es: `${name} para el cliente` },
    unitId: unit.id,
    unit,
    description: null,
    kitchenName: name.toUpperCase(),
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice,
    vatClass: "reduced",
    active: true,
    available: true,
    ordering: "not_sold_separately",
    allergens: null,
    dietOverride: null,
    dietDerivation: null,
    manualAllergens: null,
    image: null,
    color: null,
    variants: [],
  };
}

const products: Product[] = [
  product(BACON, "Bacon", "1.50"),
  product(EGG, "Fried egg", "0.80"),
  product(CHEESE, "Manchego", "30.00", KG),
  product(TOAST, "Toast", "1.00"),
];

// Every field the list shows holds something other than its default (a minimum and a cap, Active
// off, a preselected item, a set price, a weighed portion, an item with no cap), the three names
// read differently, and a customer name in a language the form does not show rides along, so a
// field that rewrites its value on first draw would show as a change.
const ADDONS: ExtraList = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Add-ons",
  customerName: { en: "Make it yours", es: "Añádele algo", ca: "Fes-lo teu" },
  kitchenName: "ADD",
  minPicks: 1,
  maxPicks: 2,
  active: false,
  items: [
    { id: BACON_ITEM, productId: BACON, maxQuantity: 2, preselected: true, price: "2.00" },
    { id: EGG_ITEM, productId: EGG, maxQuantity: null, preselected: false, price: null },
    {
      id: CHEESE_ITEM,
      productId: CHEESE,
      maxQuantity: 1,
      preselected: false,
      price: "3.50",
      portion: "0.050",
    },
  ],
};

async function mount(value: ExtraList | null, props: Partial<ExtraListForm> = {}) {
  const { el, host } = await mountWidget<ExtraListForm>("dashboard-extra-list-form", {
    open: true,
    languages: { defaultLanguage: "en", languages: ["en", "es"] },
    products,
    value,
    ...props,
  });
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { el, host };
}
function saveButton(el: ExtraListForm) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    'wt-modal [data-test="save"]',
  )!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: ExtraListForm) {
  await el.updateComplete;
  const save = saveButton(el);
  await save.updateComplete;
  return {
    variant: save.variant,
    disabled: save.disabled,
    innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const blocked = { variant: "primary", disabled: true, innerDisabled: true };
/** A real pointer press on the inner button; `force` presses a disabled one too. */
async function press(el: ExtraListForm) {
  const inner = saveButton(el).shadowRoot!.querySelector("button")!;
  await userEvent.click(page.elementLocator(inner), { force: true });
  await el.updateComplete;
}
function submissions(el: ExtraListForm) {
  const submit = vi.fn<(event: CustomEvent<{ value: ExtraListInput }>) => void>();
  el.addEventListener("wt-submit", submit as unknown as EventListener);
  return submit;
}
function field<T extends HTMLElement = HTMLElementTagNameMap["wt-input"]>(
  el: ExtraListForm,
  name: string,
): T {
  return el.shadowRoot!.querySelector<T>(`[name="${name}"]`)!;
}
/** Types into a `wt-input` or `wt-price-input`'s own input, the way a person does. */
async function type(el: ExtraListForm, name: string, value: string) {
  const input = field(el, name);
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
/** A real pointer press on a number stepper's − or + button. */
async function step(el: ExtraListForm, name: string, by: 1 | -1) {
  const stepper = field<HTMLElementTagNameMap["wt-number-stepper"]>(el, name);
  await stepper.updateComplete;
  await userEvent.click(
    page.elementLocator(stepper.shadowRoot!.querySelector(`button[data-step="${by}"]`)!),
  );
  await el.updateComplete;
}
async function flip(el: ExtraListForm, name: string) {
  const toggle = field<HTMLElementTagNameMap["wt-switch"]>(el, name);
  await toggle.updateComplete;
  await userEvent.click(page.elementLocator(toggle.shadowRoot!.querySelector(".hit-area")!));
  await el.updateComplete;
}
/** Opens the customer names section, which starts closed. */
async function openNames(el: ExtraListForm) {
  const names = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
    '[data-test="names-section"]',
  )!;
  names.open = true;
  await names.updateComplete;
}
async function addItem(el: ExtraListForm, name: string) {
  const combobox = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    '[data-test="add-product"]',
  )!;
  await combobox.updateComplete;
  combobox.shadowRoot!.querySelector<HTMLElement>("button.trigger")!.click();
  await combobox.updateComplete;
  const option = [...combobox.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (row) => row.textContent!.trim() === name,
  )!;
  await userEvent.click(page.elementLocator(option));
  await el.updateComplete;
}
async function removeItem(el: ExtraListForm, index: number) {
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector(`[data-test="remove-item-${index}"]`)!),
  );
  await el.updateComplete;
}
async function moveItem(el: ExtraListForm, id: string, key: "ArrowUp" | "ArrowDown") {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${id}"]`)!.focus();
  await userEvent.keyboard(`{${key}}`);
  await el.updateComplete;
}

it("a stored list with every field filled opens with Save quiet and disabled, and an untouched press sends nothing", async () => {
  const { el } = await mount(ADDONS);
  const submit = submissions(el);
  expect(field(el, "item-2-portion").value).toBe("0.050");
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
});

it("a stored minimum of 0, shown as the empty box, opens quiet", async () => {
  const { el } = await mount({ ...ADDONS, minPicks: 0 });
  expect(field<HTMLElementTagNameMap["wt-number-stepper"]>(el, "min-picks").value).toBe("");
  expect(await saveState(el)).toEqual(quiet);
});

it("a new list with nothing typed opens with Save quiet and disabled, and a press shows no errors", async () => {
  const { el } = await mount(null);
  const submit = submissions(el);
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
  expect(field(el, "name").error).toBe("");
  expect(el.shadowRoot!.querySelector('[data-test="items-error"]')).toBeNull();
});

it.each<[string, (el: ExtraListForm) => Promise<void>, (el: ExtraListForm) => Promise<void>]>([
  ["the name", (el) => type(el, "name", "Extras"), (el) => type(el, "name", "Add-ons")],
  [
    "a customer name",
    async (el) => {
      await openNames(el);
      await type(el, "customer-name-es", "Ponle algo");
    },
    (el) => type(el, "customer-name-es", "Añádele algo"),
  ],
  [
    "the kitchen name",
    (el) => type(el, "kitchen-name", "XTR"),
    (el) => type(el, "kitchen-name", "ADD"),
  ],
  ["the minimum", (el) => step(el, "min-picks", 1), (el) => step(el, "min-picks", -1)],
  ["the maximum", (el) => step(el, "max-picks", 1), (el) => step(el, "max-picks", -1)],
  ["Active", (el) => flip(el, "active"), (el) => flip(el, "active")],
  [
    "an item's maximum",
    (el) => step(el, "item-0-max-quantity", 1),
    (el) => step(el, "item-0-max-quantity", -1),
  ],
  [
    "an item's preselection",
    (el) => flip(el, "item-0-preselected"),
    (el) => flip(el, "item-0-preselected"),
  ],
  [
    "an item's price",
    (el) => type(el, "item-0-price", "2.50"),
    (el) => type(el, "item-0-price", "2.00"),
  ],
  [
    "an item's portion",
    (el) => type(el, "item-2-portion", "0.075"),
    (el) => type(el, "item-2-portion", "0.050"),
  ],
  ["an added product", (el) => addItem(el, "Toast"), (el) => removeItem(el, 3)],
  [
    "the items' order",
    (el) => moveItem(el, BACON_ITEM, "ArrowDown"),
    (el) => moveItem(el, BACON_ITEM, "ArrowUp"),
  ],
])(
  "changing %s makes Save primary and enabled, and putting it back makes it quiet again",
  async (_, change, undo) => {
    const { el } = await mount(ADDONS);
    await change(el);
    expect(await saveState(el)).toEqual(ready);
    await undo(el);
    expect(await saveState(el)).toEqual(quiet);
  },
);

it("removing an item makes Save primary and enabled, and the press sends the list without it", async () => {
  const { el } = await mount(ADDONS);
  const submit = submissions(el);
  await removeItem(el, 1);
  expect(await saveState(el)).toEqual(ready);
  await press(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value.items.map((item) => item.id)).toEqual([
    BACON_ITEM,
    CHEESE_ITEM,
  ]);
});

it("the same price written another way is no change", async () => {
  const { el } = await mount(ADDONS);
  await type(el, "item-0-price", "2");
  expect(await saveState(el)).toEqual(quiet);
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself sends nothing for an unchanged form.
it("a press that reaches Save's handler on an untouched list sends nothing and shows no errors", async () => {
  const { el } = await mount(null);
  const submit = submissions(el);
  saveButton(el).click();
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  expect(field(el, "name").error).toBe("");
  expect(el.shadowRoot!.querySelector('[data-test="items-error"]')).toBeNull();
});

it("a changed new list that fails its own checks shows the errors after a press and holds Save until fixed", async () => {
  const { el } = await mount(null);
  const submit = submissions(el);
  await type(el, "kitchen-name", "XTR");
  expect(await saveState(el)).toEqual(ready);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
  expect(field(el, "name").error).toBe(t("extras.name_required"));
  expect(el.shadowRoot!.querySelector('[data-test="items-error"]')!.textContent).toBe(
    t("extras.items_required"),
  );
  expect(await saveState(el)).toEqual(blocked);
  await type(el, "name", "Extras");
  await addItem(el, "Bacon");
  expect(await saveState(el)).toEqual(ready);
});

it("a refusal leaves a changed list's Save enabled", async () => {
  const { el } = await mount(ADDONS);
  await type(el, "name", "Extras");
  el.fieldErrors = { kitchenName: "Too long for the kitchen." };
  await el.updateComplete;
  expect(field(el, "kitchen-name").error).toBe("Too long for the kitchen.");
  expect(await saveState(el)).toEqual(ready);
});

it("Cancel on a changed list with no leave coordinator reports the cancel", async () => {
  const { el } = await mount(ADDONS);
  await type(el, "name", "Extras");
  const cancel = vi.fn();
  el.addEventListener("wt-cancel", cancel);
  el.shadowRoot!.querySelector<HTMLElement>('wt-modal [data-test="cancel"]')!.click();
  await el.updateComplete;
  expect(cancel).toHaveBeenCalledOnce();
});

it("Escape on a changed list with no leave coordinator closes the window and reports the cancel", async () => {
  const { el } = await mount(ADDONS);
  await type(el, "name", "Extras");
  const cancel = vi.fn();
  el.addEventListener("wt-cancel", cancel);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => cancel.mock.calls.length).toBe(1);
  expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
});
