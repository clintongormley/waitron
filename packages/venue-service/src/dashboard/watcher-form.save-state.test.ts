import { afterEach, describe, expect, it, test } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { WatcherInput } from "./routing-client.js";
import type { WatcherForm } from "./watcher-form.js";
import type { WatcherView } from "./watchers-seen.js";
import "./watcher-form.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const CHOSEN: WatcherView = {
  id: "pass",
  name: "Pass",
  active: true,
  displayOrder: 4,
  everyStation: false,
  stationIds: ["grill", "bar"],
  everyZone: false,
  zoneIds: ["terrace"],
  runsPass: true,
  printerIds: [],
  inUse: false,
};
const EVERY: WatcherView = {
  ...CHOSEN,
  id: "runner",
  name: "Runner",
  everyStation: true,
  stationIds: [],
  everyZone: true,
  zoneIds: [],
  runsPass: false,
};

async function mount(watcher?: WatcherView, theme?: "light" | "dark") {
  setLocale("en");
  const form = (await mountThemed("<watcher-form></watcher-form>", theme)) as WatcherForm;
  form.stations = [
    { id: "bar", name: "Bar" },
    { id: "grill", name: "Grill", active: true },
  ];
  form.zones = [
    { id: "terrace", name: "Terrace" },
    { id: "room", name: "Dining room" },
  ];
  form.watcher = watcher;
  await form.updateComplete;
  return form;
}

const part = <T extends HTMLElement = HTMLElement>(form: WatcherForm, selector: string) =>
  form.shadowRoot!.querySelector<T>(selector)!;
const saveButton = (form: WatcherForm) =>
  part<HTMLElementTagNameMap["wt-button"]>(form, '[data-test="save-watcher"]');
const box = (form: WatcherForm, name: string, value?: string) =>
  part<HTMLInputElement>(form, value ? `[name="${name}"][value="${value}"]` : `[name="${name}"]`);

/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(form: WatcherForm) {
  await form.updateComplete;
  const save = saveButton(form);
  await save.updateComplete;
  return {
    variant: save.variant,
    disabled: save.disabled,
    innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };

async function typeName(form: WatcherForm, value: string) {
  const field = part<HTMLElementTagNameMap["wt-input"]>(form, '[name="name"]');
  await field.updateComplete;
  await userEvent.fill(field.shadowRoot!.querySelector("input")!, value);
  await form.updateComplete;
}
async function tick(form: WatcherForm, name: string, value?: string) {
  box(form, name, value).click();
  await form.updateComplete;
}
function saves(form: WatcherForm) {
  const sent: WatcherInput[] = [];
  form.addEventListener("watcher-save", (event) =>
    sent.push((event as CustomEvent<{ input: WatcherInput }>).detail.input),
  );
  return sent;
}
const marked = (form: WatcherForm) =>
  form.shadowRoot!.querySelectorAll("[data-field-error], [data-test=watcher-error]").length;

it.each([
  ["chosen stations and zones, running the pass", CHOSEN],
  ["every station and every zone", EVERY],
])("an existing watcher with %s opens with Save quiet and disabled", async (_, watcher) => {
  const form = await mount(watcher);
  expect(box(form, "everyStation").checked).toBe(watcher.everyStation);
  expect(await saveState(form)).toEqual(quiet);
});

it("New opens with Save quiet and disabled", async () => {
  expect(await saveState(await mount())).toEqual(quiet);
});

it("one edit makes Save primary and enabled; undoing it makes it quiet again", async () => {
  const form = await mount(CHOSEN);
  await tick(form, "stationIds", "bar");
  expect(await saveState(form)).toEqual(ready);
  await tick(form, "stationIds", "bar");
  expect(await saveState(form)).toEqual(quiet);
  await typeName(form, "Main pass");
  expect(await saveState(form)).toEqual(ready);
  await typeName(form, "  Pass  ");
  expect(await saveState(form)).toEqual(quiet);
  await tick(form, "everyZone");
  expect(await saveState(form)).toEqual(ready);
  await tick(form, "everyZone");
  expect(await saveState(form)).toEqual(quiet);
});

it("on New, typing a name makes Save primary and clearing it makes it quiet", async () => {
  const form = await mount();
  await typeName(form, "Runner");
  expect(await saveState(form)).toEqual(ready);
  await typeName(form, "");
  expect(await saveState(form)).toEqual(quiet);
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself emits nothing for an untouched form.
it.each([
  ["an existing watcher", CHOSEN],
  ["New", undefined],
])(
  "a press that reaches Save's handler on untouched %s emits nothing and marks nothing",
  async (_, watcher) => {
    const form = await mount(watcher);
    const sent = saves(form);
    saveButton(form).click();
    await form.updateComplete;
    expect(sent).toEqual([]);
    expect(marked(form)).toBe(0);
  },
);

it("a refused save leaves Save enabled and primary", async () => {
  const form = await mount(CHOSEN);
  const sent = saves(form);
  await typeName(form, "Runner");
  saveButton(form).click();
  expect(sent).toHaveLength(1);
  form.refusal = { code: "watcher.name_taken" };
  await form.updateComplete;
  expect(part(form, '[data-field-error="name"]')).not.toBeNull();
  expect(await saveState(form)).toEqual(ready);
});

it("after its submission is committed with the form still open, Save goes quiet", async () => {
  const form = await mount(CHOSEN);
  const sent = saves(form);
  await typeName(form, "Main pass");
  saveButton(form).click();
  expect(sent).toHaveLength(1);
  expect(form.commitSubmitted(sent[0]!)).toBe(true);
  expect(await saveState(form)).toEqual(quiet);
});

describe("accessibility", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`an untouched edit, Save quiet (${theme})`, async () => {
      const form = await mount(CHOSEN, theme);
      expect(await saveState(form)).toEqual(quiet);
      await expectNoA11yViolations(form);
    });
    test(`an edited watcher, Save ready (${theme})`, async () => {
      const form = await mount(CHOSEN, theme);
      await typeName(form, "Main pass");
      expect(await saveState(form)).toEqual(ready);
      await expectNoA11yViolations(form);
    });
  }
});
