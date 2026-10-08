import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { IngredientForm } from "./ingredient-form.js";
import "./ingredient-form.js";
import type { AllergenDeclaration, DietaryOrigin, Ingredient } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";

afterEach(cleanupWidgets);

// Every field holds something other than its default (switched off, declared allergens with a
// source, a dietary origin), so a field that rewrites its value on first draw would show as a change.
const MILK: Ingredient = {
  id: "ing-1",
  name: "Leche entera",
  allergens: { milk: { presence: "contains", source: "vaca" } },
  dietaryOrigin: "dairy",
  active: false,
};

async function mount(ingredient: Ingredient | null) {
  const { el } = await mountWidget<IngredientForm>("dashboard-ingredient-form", {
    open: true,
    ingredient,
  });
  await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return el;
}
function saveButton(el: IngredientForm) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm]")!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: IngredientForm) {
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
async function press(el: IngredientForm) {
  const inner = saveButton(el).shadowRoot!.querySelector("button")!;
  await userEvent.click(page.elementLocator(inner), { force: true });
  await el.updateComplete;
}
function sent(el: IngredientForm) {
  const send = vi.fn();
  el.addEventListener("create-ingredient", send);
  el.addEventListener("update-ingredient", send);
  return send;
}
async function typeName(el: IngredientForm, value: string) {
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "wt-input[data-test=name]",
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
/** A real pointer press on the Active switch's label. */
async function flipActive(el: IngredientForm) {
  const toggle = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "[data-test=active]",
  )!;
  await toggle.updateComplete;
  await userEvent.click(page.elementLocator(toggle.shadowRoot!.querySelector("label")!));
  await el.updateComplete;
}
async function emitAllergens(el: IngredientForm, value: AllergenDeclaration) {
  el.shadowRoot!.querySelector("dashboard-allergen-picker")!.dispatchEvent(
    new CustomEvent("wt-allergens-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
async function emitOrigin(el: IngredientForm, origin: DietaryOrigin | null) {
  el.shadowRoot!.querySelector("dashboard-dietary-origin-picker")!.dispatchEvent(
    new CustomEvent("origin-changed", { detail: { origin }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
const nameError = (el: IngredientForm): string | null =>
  el.shadowRoot!.querySelector("[data-test=name]")!.getAttribute("error");

it("a stored ingredient with every field filled opens with Save quiet and disabled, and an untouched press saves nothing", async () => {
  const el = await mount(MILK);
  const send = sent(el);
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(send).not.toHaveBeenCalled();
});

it("a new ingredient with nothing typed opens with Create quiet and disabled, and a press shows no errors", async () => {
  const el = await mount(null);
  const send = sent(el);
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(send).not.toHaveBeenCalled();
  expect(nameError(el)).toBe("");
});

it("one edit makes Save primary and enabled, and typing the original back makes it quiet again", async () => {
  const el = await mount(MILK);
  await typeName(el, "Leche desnatada");
  expect(await saveState(el)).toEqual(ready);
  await typeName(el, "Leche entera");
  expect(await saveState(el)).toEqual(quiet);
});

it("the Active switch is a change, and flipping it back makes Save quiet", async () => {
  const el = await mount(MILK);
  await flipActive(el);
  expect(await saveState(el)).toEqual(ready);
  await flipActive(el);
  expect(await saveState(el)).toEqual(quiet);
});

it("an allergen or dietary-origin edit is a change, and putting it back makes Save quiet", async () => {
  const el = await mount(MILK);
  await emitAllergens(el, {});
  expect(await saveState(el)).toEqual(ready);
  await emitAllergens(el, { milk: { presence: "contains", source: "vaca" } });
  expect(await saveState(el)).toEqual(quiet);
  await emitOrigin(el, null);
  expect(await saveState(el)).toEqual(ready);
  await emitOrigin(el, "dairy");
  expect(await saveState(el)).toEqual(quiet);
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself sends nothing for an unchanged form.
it("a press that reaches Save's handler on an untouched form sends nothing and shows no errors", async () => {
  const el = await mount(null);
  const send = sent(el);
  saveButton(el).click();
  await el.updateComplete;
  expect(send).not.toHaveBeenCalled();
  expect(nameError(el)).toBe("");
});

it("a changed ingredient's press sends the whole patch", async () => {
  const el = await mount(MILK);
  const send = sent(el);
  await emitOrigin(el, "plant");
  await press(el);
  expect(send).toHaveBeenCalledOnce();
  expect((send.mock.calls[0]![0] as CustomEvent).detail).toEqual({
    id: "ing-1",
    patch: {
      name: "Leche entera",
      active: false,
      allergens: { milk: { presence: "contains", source: "vaca" } },
      dietaryOrigin: "plant",
    },
  });
});

it("a name of only spaces is a change that the form's own check refuses after a press, holding Create until fixed", async () => {
  const el = await mount(null);
  const send = sent(el);
  await typeName(el, "   ");
  expect(await saveState(el)).toEqual(ready);
  await press(el);
  expect(send).not.toHaveBeenCalled();
  expect(nameError(el)).toBe(codeMessage("ingredient.name_required"));
  expect(await saveState(el)).toEqual(blocked);
  await typeName(el, "Sal");
  expect(await saveState(el)).toEqual(ready);
});

it("a refusal leaves a changed ingredient's Save enabled", async () => {
  const el = await mount(MILK);
  await typeName(el, "Leche");
  el.fieldErrors = { _form: "refused" };
  expect(await saveState(el)).toEqual(ready);
});

it("Escape with no leave coordinator closes the form", async () => {
  const el = await mount(MILK);
  await typeName(el, "Leche");
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => el.open).toBe(false);
});
