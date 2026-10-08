import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { OptionListForm } from "./option-list-form.js";
import type { OptionLabelForm } from "./option-label-form.js";
import type { OptionList, OptionListInput } from "../api/client.js";
import { t } from "../i18n/t.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

const RARE = "11111111-1111-4111-8111-111111111111";
const MEDIUM = "22222222-2222-4222-8222-222222222222";
const BLUE = "55555555-5555-4555-8555-555555555555";

// Every field the list shows holds something other than its default (Active off, an option
// withdrawn, the default on the second option), the three names read differently, and customer
// names in a language the form does not show ride along, so a field that rewrites its value on
// first draw would show as a change. Option kitchen names come back as null when none is stored.
const COOKED: OptionList = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Cooked",
  customerName: { en: "How would you like it?", es: "¿En qué punto?", ca: "Com el vols?" },
  kitchenName: "COOK",
  defaultLabelId: MEDIUM,
  active: false,
  labels: [
    {
      id: RARE,
      name: "Rare",
      customerName: { en: "Barely cooked", es: "Poco hecho", ca: "Poc fet" },
      kitchenName: "R",
      available: true,
    },
    {
      id: MEDIUM,
      name: "Medium",
      customerName: { en: "Pink in the middle", es: "Al punto" },
      kitchenName: null,
      available: true,
    },
    { id: BLUE, name: "Blue", customerName: null, kitchenName: "BL", available: false },
  ],
};

async function mount(value: OptionList | null) {
  const { el, host } = await mountWidget<OptionListForm>("dashboard-option-list-form", {
    open: true,
    languages: { defaultLanguage: "en", languages: ["en", "es"] },
    value,
  });
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { el, host };
}
function saveButton(el: OptionListForm | OptionLabelForm) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    'wt-modal [data-test="save"]',
  )!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: OptionListForm) {
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
async function press(el: OptionListForm | OptionLabelForm) {
  const inner = saveButton(el).shadowRoot!.querySelector("button")!;
  await userEvent.click(page.elementLocator(inner), { force: true });
  await el.updateComplete;
}
function submissions(el: OptionListForm) {
  const submit = vi.fn<(event: CustomEvent<{ value: OptionListInput }>) => void>();
  el.addEventListener("wt-submit", submit as unknown as EventListener);
  return submit;
}
function field(el: OptionListForm | OptionLabelForm, name: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name="${name}"]`)!;
}
async function type(el: OptionListForm | OptionLabelForm, name: string, value: string) {
  const input = field(el, name);
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
/** Opens the customer names section, which starts closed. */
async function openNames(el: OptionListForm) {
  const names = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
    '[data-test="names-section"]',
  )!;
  names.open = true;
  await names.updateComplete;
}
/** A real pointer press on the label around an option's default radio. */
async function pickDefault(el: OptionListForm, index: number) {
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector(`[data-test="label-${index}-pick"]`)!),
  );
  await el.updateComplete;
}
async function flipActive(el: OptionListForm) {
  const toggle =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>('[name="active"]')!;
  await toggle.updateComplete;
  await userEvent.click(page.elementLocator(toggle.shadowRoot!.querySelector("label")!));
  await el.updateComplete;
}
/** Opens the option window from a row's Edit action. */
async function openOption(el: OptionListForm, index: number): Promise<OptionLabelForm> {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="edit-label-${index}"]`)!.click();
  await el.updateComplete;
  const window = el.shadowRoot!.querySelector<OptionLabelForm>("dashboard-option-label-form")!;
  await window.updateComplete;
  await window.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return window;
}

it("a stored list with every field filled opens with Save quiet and disabled, and an untouched press sends nothing", async () => {
  const { el } = await mount(COOKED);
  const submit = submissions(el);
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
});

it.each([
  ["empty", { ...COOKED, defaultLabelId: null }],
  ["on a withdrawn option", { ...COOKED, defaultLabelId: BLUE }],
])(
  "a stored list whose default is %s opens quiet on the default the server would store",
  async (_, value) => {
    const { el } = await mount(value);
    expect(
      el.shadowRoot!.querySelector<HTMLInputElement>('[data-test="label-0-default"]')!.checked,
    ).toBe(true);
    expect(await saveState(el)).toEqual(quiet);
  },
);

it("a new list with nothing typed opens with Save quiet and disabled, and a press shows no errors", async () => {
  const { el } = await mount(null);
  const submit = submissions(el);
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
  expect(field(el, "name").error).toBe("");
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')).toBeNull();
});

it("one edit makes Save primary and enabled, and typing the original back makes it quiet again", async () => {
  const { el } = await mount(COOKED);
  await openNames(el);
  await type(el, "customer-name-es", "¿Cómo lo quiere?");
  expect(await saveState(el)).toEqual(ready);
  await type(el, "customer-name-es", "¿En qué punto?");
  expect(await saveState(el)).toEqual(quiet);
});

it("choosing another default makes Save primary, and choosing the first back makes it quiet", async () => {
  const { el } = await mount(COOKED);
  await pickDefault(el, 0);
  expect(await saveState(el)).toEqual(ready);
  await pickDefault(el, 1);
  expect(await saveState(el)).toEqual(quiet);
});

it("flipping Active makes Save primary, and flipping it back makes it quiet", async () => {
  const { el } = await mount(COOKED);
  await flipActive(el);
  expect(await saveState(el)).toEqual(ready);
  await flipActive(el);
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
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')).toBeNull();
});

it("an option edited in its window and saved there makes the list's Save primary and enabled", async () => {
  const { el } = await mount(COOKED);
  const submit = submissions(el);
  const window = await openOption(el, 0);
  await type(window, "label-kitchen-name", "RR");
  await press(window);
  await el.updateComplete;
  expect(window.open).toBe(false);
  expect(await saveState(el)).toEqual(ready);
  await press(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value.labels[0]!.kitchenName).toBe("RR");
});

it("an option window cancelled after an edit leaves the list's Save quiet", async () => {
  const { el } = await mount(COOKED);
  const window = await openOption(el, 0);
  await type(window, "label-kitchen-name", "RR");
  window.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel"]')!.click();
  await el.updateComplete;
  expect(window.open).toBe(false);
  expect(await saveState(el)).toEqual(quiet);
});

it("a changed new list that fails its own check shows the error after a press and holds Save until fixed", async () => {
  const { el } = await mount(null);
  const submit = submissions(el);
  await type(el, "kitchen-name", "COOK");
  expect(await saveState(el)).toEqual(ready);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
  expect(field(el, "name").error).toBe(t("options.name_required"));
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')!.textContent).toBe(
    t("options.labels_required"),
  );
  expect(await saveState(el)).toEqual(blocked);
  await type(el, "name", "Cooked");
  await flipActive(el);
  expect(await saveState(el)).toEqual(ready);
});

it("a refusal leaves a changed list's Save enabled", async () => {
  const { el } = await mount(COOKED);
  await type(el, "name", "Doneness");
  el.fieldErrors = { kitchenName: "Too long." };
  await el.updateComplete;
  expect(field(el, "kitchen-name").error).toBe("Too long.");
  expect(await saveState(el)).toEqual(ready);
});

it("Cancel on a changed list with no leave coordinator reports the cancel", async () => {
  const { el } = await mount(COOKED);
  await type(el, "name", "Doneness");
  const cancel = vi.fn();
  el.addEventListener("wt-cancel", cancel);
  el.shadowRoot!.querySelector<HTMLElement>('wt-modal [data-test="cancel"]')!.click();
  await el.updateComplete;
  expect(cancel).toHaveBeenCalledOnce();
});

it("Escape on a changed list with no leave coordinator closes the window and reports the cancel", async () => {
  const { el } = await mount(COOKED);
  await type(el, "name", "Doneness");
  const cancel = vi.fn();
  el.addEventListener("wt-cancel", cancel);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => cancel.mock.calls.length).toBe(1);
  expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
});
