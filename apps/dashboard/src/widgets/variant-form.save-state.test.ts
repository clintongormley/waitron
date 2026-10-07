import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { VariantForm } from "./variant-form.js";
import "./variant-form.js";
import type { ImageUploader } from "./image-upload.js";
import type { ProductEditorVariant } from "../api/client.js";
import { t } from "../i18n/t.js";

afterEach(cleanupWidgets);

// Every field holds something, with a price in the spelling a stored variant comes back in, so a
// field that rewrites its value on first draw would show as a change.
const halfPortion: ProductEditorVariant = {
  id: "8f1f2f3f-4f5f-4f6f-8f7f-9f8f7f6f5f4f",
  name: "Media",
  customerName: { es: "Media ración", en: "Half portion" },
  kitchenName: "1/2 RAC",
  image: "half.png",
  unitPrice: "6.50",
  available: false,
  active: true,
};

function stubApi(): ImageUploader {
  return { imageLibraryRequest: vi.fn().mockResolvedValue({}) };
}

async function mount(value: ProductEditorVariant | null) {
  const { el } = await mountWidget<VariantForm>("dashboard-variant-form", {
    open: true,
    locales: ["es", "en"],
    value,
    unitLabel: "kg",
    basePrice: "9.00",
    api: stubApi(),
  });
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return el;
}
function saveButton(el: VariantForm) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "wt-button[data-test=variant-save]",
  )!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: VariantForm) {
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
/** A real pointer press on the inner button, as a person makes it. `force` skips Playwright's
 * wait for the button to become enabled, so a disabled one is pressed too. */
async function press(el: VariantForm) {
  const inner = saveButton(el).shadowRoot!.querySelector("button")!;
  await userEvent.click(page.elementLocator(inner), { force: true });
  await el.updateComplete;
}
function submissions(el: VariantForm) {
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  return submit;
}
async function type(el: VariantForm, name: string, value: string) {
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name="${name}"]`,
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
function nameError(el: VariantForm) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('wt-input[name="name"]')!
    .error;
}

it("an existing variant with every field filled opens with Save quiet and disabled", async () => {
  const el = await mount(halfPortion);
  const submit = submissions(el);
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
});

it("Add variant with nothing typed opens with Save quiet and disabled", async () => {
  const el = await mount(null);
  const submit = submissions(el);
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
  expect(nameError(el)).toBe("");
});

it("one edit makes Save primary and enabled, and typing the original back makes it quiet again", async () => {
  const el = await mount(halfPortion);
  await type(el, "name", "Entera");
  expect(await saveState(el)).toEqual(ready);
  await type(el, "name", "Media");
  expect(await saveState(el)).toEqual(quiet);
});

it("a new variant's first typed name enables Save, and clearing it makes Save quiet again", async () => {
  const el = await mount(null);
  await type(el, "name", "Copa");
  expect(await saveState(el)).toEqual(ready);
  await type(el, "name", "");
  expect(await saveState(el)).toEqual(quiet);
});

it("a picked image is a change that enables Save", async () => {
  const el = await mount(halfPortion);
  el.shadowRoot!.querySelector("dashboard-image-upload")!.dispatchEvent(
    new CustomEvent("image-changed", {
      detail: { image: "whole.png" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(await saveState(el)).toEqual(ready);
});

it("a changed form that fails its own checks shows its errors after a press and holds Save until fixed", async () => {
  const el = await mount(halfPortion);
  const submit = submissions(el);
  await type(el, "name", "");
  expect(await saveState(el)).toEqual(ready);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
  expect(nameError(el)).toBe(t("editor.variant_name_required"));
  expect(await saveState(el)).toEqual(blocked);
  await type(el, "name", "Entera");
  expect(await saveState(el)).toEqual(ready);
  await press(el);
  expect(submit).toHaveBeenCalledOnce();
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so these
// press the host: what they prove is that the handler itself sends nothing for an unchanged form.
it("a press that reaches Save's handler on an untouched variant sends nothing", async () => {
  const el = await mount(halfPortion);
  const submit = submissions(el);
  saveButton(el).click();
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
});

it("a press that reaches Save's handler on an untouched new variant marks no field", async () => {
  const el = await mount(null);
  const submit = submissions(el);
  saveButton(el).click();
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  expect(nameError(el)).toBe("");
});
