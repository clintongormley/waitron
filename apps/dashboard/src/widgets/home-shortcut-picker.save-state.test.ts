import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOptions } from "@waitron/ui/src/test-helpers.js";
import { HomeShortcutPicker } from "./home-shortcut-picker.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

afterEach(cleanupWidgets);

const options = [
  { value: "p-lemonade", label: "Lemonade" },
  { value: "p-lager", label: "Lager" },
  { value: "p-burger", label: "Burger" },
];

async function mount() {
  return mountWidget<HomeShortcutPicker>("dashboard-home-shortcut-picker", {
    kind: "product",
    options,
  });
}
function addButton(el: HomeShortcutPicker) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="add"]')!;
}
/** What Add looks like and whether a person can press it: the host's state and its inner button's. */
async function addState(el: HomeShortcutPicker) {
  await el.updateComplete;
  const add = addButton(el);
  await add.updateComplete;
  return {
    variant: add.variant,
    disabled: add.disabled,
    innerDisabled: add.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
/** A real pointer press on the inner button; `force` presses a disabled one too. */
async function press(el: HomeShortcutPicker) {
  const inner = addButton(el).shadowRoot!.querySelector("button")!;
  await userEvent.click(page.elementLocator(inner), { force: true });
  await el.updateComplete;
}
async function choose(el: HomeShortcutPicker, values: string[]) {
  await chooseOptions(el.shadowRoot!.querySelector("wt-combobox")!, values);
  await el.updateComplete;
}
function adds(el: HomeShortcutPicker) {
  const add = vi.fn<(event: CustomEvent<{ kind: string; ids: string[] }>) => void>();
  el.addEventListener("wt-shortcuts-add", add as unknown as EventListener);
  return add;
}

it("opens with nothing chosen and Add quiet and disabled, and an untouched press sends nothing", async () => {
  const { el } = await mount();
  const add = adds(el);
  expect(await addState(el)).toEqual(quiet);
  await press(el);
  expect(add).not.toHaveBeenCalled();
});

// A host `.click()` reaches Add's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself does nothing for an untouched choice.
// With nothing chosen no event could be sent either way, so the field message tells them apart.
it("a press that reaches Add's handler with nothing chosen sends nothing and shows no message", async () => {
  const { el } = await mount();
  const add = adds(el);
  addButton(el).click();
  await el.updateComplete;
  expect(add).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("wt-combobox")!.error).toBe("");
});

it("choosing makes Add primary and enabled, and un-choosing back to none makes it quiet again", async () => {
  const { el } = await mount();
  await choose(el, ["p-lager"]);
  expect(await addState(el)).toEqual(ready);
  await choose(el, ["p-lager", "p-burger"]);
  expect(await addState(el)).toEqual(ready);
  await choose(el, ["p-burger"]);
  expect(await addState(el)).toEqual(ready);
  await choose(el, []);
  expect(await addState(el)).toEqual(quiet);
});

it("a press after choosing two sends both in the order chosen", async () => {
  const { el } = await mount();
  const add = adds(el);
  await choose(el, ["p-lager", "p-burger", "p-lemonade"]);
  await choose(el, ["p-lager", "p-lemonade"]);
  await press(el);
  expect(add).toHaveBeenCalledOnce();
  expect(add.mock.calls[0]![0].detail).toEqual({
    kind: "product",
    ids: ["p-lager", "p-lemonade"],
  });
});

it("is disabled while busy and enabled again after a refused add", async () => {
  const { el } = await mount();
  await choose(el, ["p-lager"]);
  await press(el);
  el.busy = true;
  expect(await addState(el)).toEqual({ variant: "primary", disabled: true, innerDisabled: true });
  el.busy = false;
  expect(await addState(el)).toEqual(ready);
});

it("a press while busy sends nothing", async () => {
  const { el } = await mount();
  const add = adds(el);
  await choose(el, ["p-lager"]);
  el.busy = true;
  await el.updateComplete;
  addButton(el).click();
  expect(add).not.toHaveBeenCalled();
});

it("is quiet again once the chosen shortcuts are added", async () => {
  const { el } = await mount();
  await choose(el, ["p-lager"]);
  await press(el);
  el.commitSaved();
  expect(await addState(el)).toEqual(quiet);
});

it("after a partial failure keepChosen leaves only those chosen, with Add still enabled", async () => {
  const { el } = await mount();
  const add = adds(el);
  await choose(el, ["p-burger", "p-lager", "p-lemonade"]);
  await press(el);
  el.options = options.filter(({ value }) => value !== "p-burger");
  el.keepChosen(["p-lager", "p-lemonade"]);
  expect(await addState(el)).toEqual(ready);
  expect(el.shadowRoot!.querySelector("wt-combobox")!.values).toEqual(["p-lager", "p-lemonade"]);
  await press(el);
  expect(add.mock.calls[1]![0].detail.ids).toEqual(["p-lager", "p-lemonade"]);
});

it("after keepChosen, clearing the kept choices makes Add quiet and disabled again", async () => {
  const { el } = await mount();
  await choose(el, ["p-burger", "p-lager"]);
  await press(el);
  el.options = options.filter(({ value }) => value !== "p-burger");
  el.keepChosen(["p-lager"]);
  expect(await addState(el)).toEqual(ready);
  await choose(el, []);
  expect(await addState(el)).toEqual(quiet);
});
