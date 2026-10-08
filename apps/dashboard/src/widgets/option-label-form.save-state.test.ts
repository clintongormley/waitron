import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { OptionLabelForm, type DraftLabel } from "./option-label-form.js";
import { t } from "../i18n/t.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

// Every field the window shows holds something other than its default (Available off), the three
// names read differently, and a customer name in a language it does not show rides along, so a
// field that rewrites its value on first draw would show as a change.
const RARE: DraftLabel = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Rare",
  customerName: { en: "Barely cooked", es: "Poco hecho", ca: "Poc fet" },
  kitchenName: "R",
  available: false,
};

async function mount(value: DraftLabel | null, theme?: "light" | "dark") {
  const { el, host } = await mountWidget<OptionLabelForm>(
    "dashboard-option-label-form",
    { open: true, languages: { defaultLanguage: "en", languages: ["en", "es"] }, value },
    theme,
  );
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { el, host };
}
function saveButton(el: OptionLabelForm) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: OptionLabelForm) {
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
async function press(el: OptionLabelForm) {
  const inner = saveButton(el).shadowRoot!.querySelector("button")!;
  await userEvent.click(page.elementLocator(inner), { force: true });
  await el.updateComplete;
}
function submissions(el: OptionLabelForm) {
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  return submit;
}
function field(el: OptionLabelForm, name: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name="${name}"]`)!;
}
async function type(el: OptionLabelForm, name: string, value: string) {
  const input = field(el, name);
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
/** A real pointer press on the Available switch's label. */
async function flipAvailable(el: OptionLabelForm) {
  const toggle = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
    '[name="label-available"]',
  )!;
  await toggle.updateComplete;
  await userEvent.click(page.elementLocator(toggle.shadowRoot!.querySelector("label")!));
  await el.updateComplete;
}

it("an option with every field filled opens with Save quiet and disabled, and an untouched press sends nothing", async () => {
  const { el } = await mount(RARE);
  const submit = submissions(el);
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
});

it("Add option with nothing typed opens with Save quiet and disabled, and a press shows no errors", async () => {
  const { el } = await mount(null);
  const submit = submissions(el);
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
  expect(field(el, "label-name").error).toBe("");
});

it("one edit makes Save primary and enabled, and typing the original back makes it quiet again", async () => {
  const { el } = await mount(RARE);
  await type(el, "label-customer-name-es", "Muy poco hecho");
  expect(await saveState(el)).toEqual(ready);
  await type(el, "label-customer-name-es", "Poco hecho");
  expect(await saveState(el)).toEqual(quiet);
});

it("flipping Available makes Save primary, and flipping it back makes it quiet", async () => {
  const { el } = await mount(RARE);
  await flipAvailable(el);
  expect(await saveState(el)).toEqual(ready);
  await flipAvailable(el);
  expect(await saveState(el)).toEqual(quiet);
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself sends nothing for an unchanged form.
it("a press that reaches Save's handler on an untouched option sends nothing and shows no errors", async () => {
  const { el } = await mount(null);
  const submit = submissions(el);
  saveButton(el).click();
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  expect(field(el, "label-name").error).toBe("");
});

it("a changed option's press sends what the window holds, under its own id", async () => {
  const { el } = await mount(RARE);
  const submit = submissions(el);
  await type(el, "label-kitchen-name", "RR");
  await press(el);
  expect(submit).toHaveBeenCalledOnce();
  expect((submit.mock.calls[0]![0] as CustomEvent).detail).toEqual({
    value: { ...RARE, kitchenName: "RR" },
  });
});

it("a changed new option that fails its own check shows the error after a press and holds Save until fixed", async () => {
  const { el } = await mount(null);
  const submit = submissions(el);
  await type(el, "label-kitchen-name", "WD");
  expect(await saveState(el)).toEqual(ready);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
  expect(field(el, "label-name").error).toBe(t("options.label_name_required"));
  expect(await saveState(el)).toEqual(blocked);
  await type(el, "label-name", "Well done");
  expect(await saveState(el)).toEqual(ready);
});

it("a refusal leaves a changed option's Save enabled", async () => {
  const { el } = await mount(RARE);
  await type(el, "label-name", "Very rare");
  el.errors = { "label-kitchen-name": "Too long." };
  await el.updateComplete;
  expect(field(el, "label-kitchen-name").error).toBe("Too long.");
  expect(await saveState(el)).toEqual(ready);
});

it("Cancel on a changed option with no leave coordinator reports the cancel", async () => {
  const { el } = await mount(RARE);
  await type(el, "label-name", "Very rare");
  const cancel = vi.fn();
  el.addEventListener("wt-cancel", cancel);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel"]')!.click();
  await el.updateComplete;
  expect(cancel).toHaveBeenCalledOnce();
});

it("Escape on a changed option with no leave coordinator closes the window and reports the cancel", async () => {
  const { el } = await mount(RARE);
  await type(el, "label-name", "Very rare");
  const cancel = vi.fn();
  el.addEventListener("wt-cancel", cancel);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => cancel.mock.calls.length).toBe(1);
  expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
});

describe.each(["light", "dark"] as const)("option window Save states (%s)", (theme) => {
  it("is accessible with Save quiet, for an option and for Add option", async () => {
    for (const value of [RARE, null]) {
      const { el, host } = await mount(value, theme);
      expect(await saveState(el)).toEqual(quiet);
      await expectNoA11yViolations(host);
      cleanupWidgets();
    }
  });

  it("is accessible with Save primary after an edit", async () => {
    const { el, host } = await mount(RARE, theme);
    await type(el, "label-name", "Very rare");
    expect(await saveState(el)).toEqual(ready);
    await expectNoA11yViolations(host);
  });
});
