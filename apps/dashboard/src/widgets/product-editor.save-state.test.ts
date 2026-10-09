import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { ProductEditor } from "./product-editor.js";
import type { ProductEditorDraft } from "./product-editor-model.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

// Every field the editor shows holds something, in the spellings a stored product can come back in
// (a regional language code, a price with trailing zeros, dietary marks out of order), so a field
// that rewrites its value on first draw would show as a change.
const full: ProductEditorDraft = {
  id: "coffee",
  name: "Coffee",
  customerName: { "en-GB": "House coffee", "es-ES": "Café de la casa" },
  description: { en: "Freshly roasted" },
  kitchenName: "BAR",
  image: null,
  unitId: "each",
  unitPrice: "9.00",
  active: true,
  available: true,
  ordering: "public",
  vatClass: "reduced",
  variants: [
    {
      id: "small",
      name: "Small",
      customerName: { en: "Small cup", es: "Taza pequeña" },
      kitchenName: "SM",
      image: null,
      unitPrice: "2.00",
      available: true,
      active: true,
    },
    {
      id: "large",
      name: "Large",
      customerName: { en: "Large cup" },
      kitchenName: "LG",
      image: null,
      unitPrice: null,
      available: false,
      active: false,
    },
  ],
  primaryCategoryId: "drinks",
  color: "#b12525",
  modifiers: [
    { kind: "extras", id: "sauces" },
    { kind: "options", id: "cooked" },
  ],
  allergens: { milk: { presence: "may_contain" } },
  dietaryDeclarations: ["vegan", "halal"],
  courseId: "starters",
};
const variantPage: ProductEditorDraft = {
  ...full,
  id: "glass",
  parentId: "coffee",
  inherited: {
    name: "Coffee",
    description: { en: "Freshly roasted" },
    image: null,
    unitPrice: "9.00",
    vatClass: "reduced",
    unitId: "each",
    primaryCategoryId: "drinks",
    courseId: "starters",
    allergens: { milk: { presence: "contains" } },
    dietaryDeclarations: ["vegan"],
  },
  name: "Glass",
  customerName: { en: "A glass" },
  kitchenName: "GLS",
  unitId: null,
  unitPrice: null,
  vatClass: null,
  variants: [],
  modifiers: [],
  allergens: null,
  dietaryDeclarations: null,
  primaryCategoryId: null,
  color: null,
  courseId: null,
};

async function mount(value: ProductEditorDraft | null) {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value,
    locales: ["en", "es"],
    units: [{ id: "each", name: { en: "Each" }, abbreviation: { en: "ea" } }],
    taxChoices: [{ id: "reduced", rate: "10.00", label: "Reduced" }],
    categories: [{ id: "drinks", name: "Drinks", parentId: null, color: null }],
    extraLists: [{ id: "sauces", name: "Sauces" }],
    optionLists: [{ id: "cooked", name: "Cooked" }],
    courses: [{ id: "starters", name: "Starters" }],
  });
  return el;
}
function button(el: ProductEditor, test: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `wt-button[data-test=${test}]`,
  )!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: ProductEditor) {
  await el.updateComplete;
  const save = button(el, "save");
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
/** A real pointer press on the inner button, as a person makes it. `force` skips Playwright's
 * wait for the button to become enabled, so a disabled one is pressed too. */
async function press(el: ProductEditor, test = "save") {
  const inner = button(el, test).shadowRoot!.querySelector("button")!;
  await userEvent.click(page.elementLocator(inner), { force: true });
  await el.updateComplete;
}
function submissions(el: ProductEditor) {
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  return submit;
}
async function type(el: ProductEditor, name: string, value: string) {
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name="${name}"]`,
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
async function openSections(el: ProductEditor) {
  for (const name of ["kitchen", "descriptors", "nutrition"]) {
    const disclosure = el.shadowRoot!.querySelector<
      HTMLElement & { open: boolean; updateComplete: Promise<unknown> }
    >(`[data-section="${name}"]`)!;
    await disclosure.updateComplete;
    disclosure.shadowRoot!.querySelector<HTMLElement>("button.header")!.click();
    await disclosure.updateComplete;
    expect(disclosure.open, name).toBe(true);
  }
  await el.updateComplete;
}

it("an existing product with every field filled opens with Save quiet and disabled", async () => {
  const el = await mount(full);
  const submit = submissions(el);
  expect(await saveState(el)).toEqual(quiet);
  await openSections(el);
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
});

it("an inactive product opens with Save quiet and disabled and no Enable", async () => {
  const el = await mount({ ...full, active: false });
  const submit = submissions(el);
  expect(await saveState(el)).toEqual(quiet);
  expect(el.shadowRoot!.querySelector("[data-test=restore]")).toBeNull();
  await press(el);
  expect(submit).not.toHaveBeenCalled();
});

it("a variant's own page opens with Save quiet and disabled", async () => {
  const el = await mount(variantPage);
  const submit = submissions(el);
  expect(await saveState(el)).toEqual(quiet);
  await openSections(el);
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
});

it("a new product with nothing typed opens with Save quiet and disabled", async () => {
  const el = await mount(null);
  const submit = submissions(el);
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
  await type(el, "name", "Tea");
  expect(await saveState(el)).toEqual(ready);
});

it("one edit makes Save primary and enabled, and typing the original back makes it quiet again", async () => {
  const el = await mount(full);
  await type(el, "name", "Tea");
  expect(await saveState(el)).toEqual(ready);
  await type(el, "name", "Coffee");
  expect(await saveState(el)).toEqual(quiet);
});

it("a changed form that fails its own checks shows its errors after a press and holds Save until fixed", async () => {
  const el = await mount(full);
  const submit = submissions(el);
  await type(el, "name", "");
  expect(await saveState(el)).toEqual(ready);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=name]")!.error,
  ).not.toBe("");
  expect(await saveState(el)).toEqual(blocked);
  await type(el, "name", "Tea");
  expect(await saveState(el)).toEqual(ready);
  await press(el);
  expect(submit).toHaveBeenCalledOnce();
});

it("a refused save leaves Save enabled", async () => {
  const el = await mount(full);
  const submit = submissions(el);
  await type(el, "name", "Tea");
  await press(el);
  expect(submit).toHaveBeenCalledOnce();
  el.busy = true;
  await el.updateComplete;
  el.busy = false;
  el.fieldErrors = { name: "Refused by the server" };
  expect(await saveState(el)).toEqual(ready);
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so these
// press the host: what they prove is that the handler itself sends nothing for an unchanged form.
it("a press that reaches Save's handler on an untouched product sends nothing", async () => {
  const el = await mount(full);
  const submit = submissions(el);
  button(el, "save").click();
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
});

it("a press that reaches Save's handler on an untouched new product marks no field", async () => {
  const el = await mount(null);
  const submit = submissions(el);
  button(el, "save").click();
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=name]")!.error,
  ).toBe("");
});

it("Archive then Keep on a saved variant returns Save to quiet without submitting", async () => {
  const el = await mount(full);
  const submit = submissions(el);
  const table = el.shadowRoot!.querySelector("dashboard-variant-table")!;
  table.dispatchEvent(
    new CustomEvent("wt-remove", { detail: { index: 0 }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(await saveState(el)).toEqual(ready);
  table.dispatchEvent(
    new CustomEvent("wt-restore", { detail: { index: 0 }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
});
