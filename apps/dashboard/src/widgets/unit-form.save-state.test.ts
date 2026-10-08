import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { UnitForm } from "./unit-form.js";
import "./unit-form.js";
import type { Unit } from "../api/client.js";
import { t } from "../i18n/t.js";

afterEach(cleanupWidgets);

// Every field the form shows holds something, plus a name in a language it does not show, so a
// field that rewrites its value on first draw would show as a change.
const KILOGRAM: Unit = {
  id: "u1",
  name: { es: "kilogramo", en: "kilogram", ca: "quilogram" },
  abbreviation: { es: "kg", en: "kg" },
  precision: 3,
};

async function mount(value: Unit | null) {
  const { el } = await mountWidget<UnitForm>("dashboard-unit-form", {
    open: true,
    locales: ["es", "en"],
    value,
  });
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return el;
}
function saveButton(el: UnitForm) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=submit]")!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: UnitForm) {
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
async function press(el: UnitForm) {
  const inner = saveButton(el).shadowRoot!.querySelector("button")!;
  await userEvent.click(page.elementLocator(inner), { force: true });
  await el.updateComplete;
}
function submissions(el: UnitForm) {
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  return submit;
}
async function type(el: UnitForm, testId: string, value: string) {
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[data-test="${testId}"]`,
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
async function choosePrecision(el: UnitForm, value: string) {
  await chooseOption(el.shadowRoot!.querySelector('wt-combobox[name="precision"]')!, value);
  await el.updateComplete;
}
const errorOf = (el: UnitForm, testId: string): string | null =>
  el.shadowRoot!.querySelector(`[data-test=${testId}]`)!.getAttribute("error");

it("a stored unit with every field filled opens with Save quiet and disabled, and an untouched press saves nothing", async () => {
  const el = await mount(KILOGRAM);
  const submit = submissions(el);
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
});

it("a new unit with nothing typed opens with Save quiet and disabled, and a press shows no errors", async () => {
  const el = await mount(null);
  const submit = submissions(el);
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
  expect(errorOf(el, "name-es")).toBe("");
});

it("a new unit holding only spaces is still unchanged", async () => {
  const el = await mount(null);
  await type(el, "name-es", "   ");
  expect(await saveState(el)).toEqual(quiet);
});

it("one edit makes Save primary and enabled, and typing the original back makes it quiet again", async () => {
  const el = await mount(KILOGRAM);
  await type(el, "abbreviation-en", "kgs");
  expect(await saveState(el)).toEqual(ready);
  await type(el, "abbreviation-en", "kg");
  expect(await saveState(el)).toEqual(quiet);
});

it("another precision makes Save primary, and choosing the stored one again makes it quiet", async () => {
  const el = await mount(KILOGRAM);
  await choosePrecision(el, "2");
  expect(await saveState(el)).toEqual(ready);
  await choosePrecision(el, "3");
  expect(await saveState(el)).toEqual(quiet);
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself sends nothing for an unchanged form.
it("a press that reaches Save's handler on an untouched unit saves nothing and shows no errors", async () => {
  const el = await mount(null);
  const submit = submissions(el);
  saveButton(el).click();
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  expect(errorOf(el, "name-es")).toBe("");
});

it("a changed unit's press sends what the form holds", async () => {
  const el = await mount(KILOGRAM);
  const submit = submissions(el);
  await type(el, "name-en", "kilo");
  await press(el);
  expect(submit).toHaveBeenCalledOnce();
  expect((submit.mock.calls[0]![0] as CustomEvent).detail).toEqual({
    value: {
      name: { es: "kilogramo", en: "kilo", ca: "quilogram" },
      abbreviation: { es: "kg", en: "kg" },
      precision: 3,
    },
  });
});

it("a changed new unit that fails its own checks shows its errors after a press and holds Save until fixed", async () => {
  const el = await mount(null);
  const submit = submissions(el);
  await type(el, "name-es", "litro");
  expect(await saveState(el)).toEqual(ready);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
  expect(errorOf(el, "abbreviation-es")).toBe(t("units.abbreviation_required"));
  expect(await saveState(el)).toEqual(blocked);
  await type(el, "abbreviation-es", "l");
  expect(await saveState(el)).toEqual(ready);
});

it("a refusal leaves a changed unit's Save enabled", async () => {
  const el = await mount(KILOGRAM);
  await type(el, "name-es", "kilo");
  el.fieldErrors = { _form: "refused" };
  expect(await saveState(el)).toEqual(ready);
});

it("Cancel with no leave coordinator reports the cancel", async () => {
  const el = await mount(KILOGRAM);
  const cancel = vi.fn();
  el.addEventListener("wt-cancel", cancel);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
  await el.updateComplete;
  expect(cancel).toHaveBeenCalledOnce();
});
