import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOptions } from "@waitron/ui/src/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { HomeShortcutPicker } from "./home-shortcut-picker.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const products = [
  { value: "p-lemonade", label: "Lemonade" },
  { value: "p-lager", label: "Lager" },
  { value: "p-burger", label: "Burger" },
];
const sections = [
  { value: "s-drinks", label: "Drinks" },
  { value: "s-mains", label: "Mains" },
];

async function mount(props: Partial<HomeShortcutPicker> = {}) {
  return mountWidget<HomeShortcutPicker>("dashboard-home-shortcut-picker", {
    options: [...products, ...sections],
    ...props,
  });
}
const combobox = (el: HomeShortcutPicker) => el.shadowRoot!.querySelector("wt-combobox")!;
const trigger = (el: HomeShortcutPicker) =>
  combobox(el).shadowRoot!.querySelector<HTMLButtonElement>("button.trigger")!;
async function choose(el: HomeShortcutPicker, values: string[]) {
  await chooseOptions(combobox(el), values);
  await el.updateComplete;
}
/** Opens the list and clicks the row named `label`, as a person does. */
async function pick(el: HomeShortcutPicker, label: string) {
  const box = combobox(el);
  if (!box.shadowRoot!.querySelector("#panel")!.matches(":popover-open"))
    await userEvent.click(page.elementLocator(trigger(el)));
  const row = [...box.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) => option.textContent!.trim() === label,
  )!;
  await userEvent.click(page.elementLocator(row));
  await el.updateComplete;
}
function addButton(el: HomeShortcutPicker) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="add"]')!;
}
async function press(el: HomeShortcutPicker) {
  await userEvent.click(page.elementLocator(addButton(el).shadowRoot!.querySelector("button")!));
  await el.updateComplete;
}
function adds(el: HomeShortcutPicker) {
  const add = vi.fn<(event: CustomEvent<{ values: string[] }>) => void>();
  el.addEventListener("wt-shortcuts-add", add as unknown as EventListener);
  return add;
}

it("offers the products and sections together in one searchable multiple-choice list", async () => {
  const { el } = await mount();
  const box = combobox(el);
  expect(box.multiple).toBe(true);
  expect(box.name).toBe("shortcuts");
  expect(box.label).toBe(t("home.picker_shortcuts"));
  expect(box.placeholder).toBe(t("home.choose_shortcuts"));
  expect(box.required).toBe(true);
  expect(box.options).toEqual([...products, ...sections]);
  expect(box.search).toBe("auto");
});

it("rows clicked one after another are sent in the order chosen, bubbling out of the page", async () => {
  const { el, host } = await mount();
  const add = vi.fn<(event: CustomEvent<{ values: string[] }>) => void>();
  host.addEventListener("wt-shortcuts-add", add as unknown as EventListener);
  await pick(el, "Lager");
  await pick(el, "Drinks");
  await userEvent.keyboard("{Escape}");
  await press(el);
  expect(add).toHaveBeenCalledOnce();
  const event = add.mock.calls[0]![0];
  expect(event.detail).toEqual({ values: ["p-lager", "s-drinks"] });
  expect(event.bubbles && event.composed).toBe(true);
});

it("does not send a chosen id that is no longer offered", async () => {
  const { el } = await mount();
  const add = adds(el);
  await choose(el, ["p-burger", "p-lager", "p-lemonade"]);
  el.options = products.filter(({ value }) => value !== "p-lager");
  await el.updateComplete;
  await press(el);
  expect(add.mock.calls[0]![0].detail.values).toEqual(["p-burger", "p-lemonade"]);
});

it("counts only the chosen ids still offered", async () => {
  const { el } = await mount();
  await choose(el, ["p-burger", "p-lager", "p-lemonade"]);
  el.options = products.filter(({ value }) => value !== "p-lager");
  await el.updateComplete;
  await combobox(el).updateComplete;
  expect(combobox(el).values).toEqual(["p-burger", "p-lemonade"]);
});

it("says nothing is left to add, under the field, when every chosen id has since gone", async () => {
  const { el } = await mount();
  const add = adds(el);
  await choose(el, ["p-lager"]);
  el.options = products.filter(({ value }) => value !== "p-lager");
  await el.updateComplete;
  await press(el);
  expect(add).not.toHaveBeenCalled();
  expect(combobox(el).error).toBe(t("home.none_chosen"));
});

it("shows a field error under the list, tied to it, with the form's sentence at the bottom", async () => {
  const { el } = await mount();
  await choose(el, ["p-lager"]);
  el.options = products.filter(({ value }) => value !== "p-lager");
  await el.updateComplete;
  await press(el);
  const box = combobox(el);
  await box.updateComplete;
  const message = box.shadowRoot!.querySelector("[data-error]")!;
  expect(message.textContent!.trim()).toBe(t("home.none_chosen"));
  expect(trigger(el).getAttribute("aria-describedby")).toContain(message.id);
  expect(trigger(el).getAttribute("aria-invalid")).toBe("true");
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  const bottom = actions.shadowRoot!.querySelector('[role="alert"]')!;
  expect(bottom.textContent!.trim()).toBe(t("form.fix_fields"));
});

it("puts a host's own Cancel beside Add", async () => {
  const { el } = await mount();
  const cancel = document.createElement("button");
  cancel.slot = "cancel";
  cancel.textContent = "Cancel";
  el.appendChild(cancel);
  await el.updateComplete;
  const slot = el.shadowRoot!.querySelector<HTMLSlotElement>('slot[name="cancel"]')!;
  expect(slot.assignedElements()).toEqual([cancel]);
  expect(slot.closest("wt-form-actions")).not.toBeNull();
});

it("counts what is chosen in English", async () => {
  setLocale("en-GB");
  const { el } = await mount();
  await choose(el, ["p-lager", "p-burger"]);
  await combobox(el).updateComplete;
  expect(trigger(el).querySelector(".value")!.textContent!.trim()).toBe("2 selected");
});

it("counts what is chosen in Spanish", async () => {
  setLocale("es-ES");
  const { el } = await mount();
  await choose(el, ["p-lager", "p-burger", "p-lemonade"]);
  await combobox(el).updateComplete;
  expect(trigger(el).querySelector(".value")!.textContent!.trim()).toBe("Selección: 3");
});
