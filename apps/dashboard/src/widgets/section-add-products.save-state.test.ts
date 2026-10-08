import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { CategorySummary } from "../api/client.js";
import { t } from "../i18n/t.js";
import { SectionAddProducts } from "./section-add-products.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";

afterEach(cleanupWidgets);

const categories: CategorySummary[] = [
  { id: "c-drinks", name: "Drinks", parentId: null, color: null },
  { id: "c-mains", name: "Mains", parentId: null, color: null },
];
const products = [
  { id: "p-lemonade", name: "Lemonade", categoryId: "c-drinks" },
  { id: "p-lager", name: "Lager", categoryId: "c-drinks" },
  { id: "p-burger", name: "Burger", categoryId: "c-mains" },
];

async function mount(theme?: "light" | "dark") {
  return mountWidget<SectionAddProducts>(
    "dashboard-section-add-products",
    { products, categories, inSection: [], onMenu: ["p-burger"] },
    theme,
  );
}
function addButton(el: SectionAddProducts) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="add"]')!;
}
/** What Add looks like and whether a person can press it: the host's state and its inner button's. */
async function addState(el: SectionAddProducts) {
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
async function press(el: SectionAddProducts) {
  const inner = addButton(el).shadowRoot!.querySelector("button")!;
  await userEvent.click(page.elementLocator(inner), { force: true });
  await el.updateComplete;
}
async function tick(el: SectionAddProducts, productId: string) {
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector(`input[value="${productId}"]`)!),
  );
  await el.updateComplete;
}
async function tickListed(el: SectionAddProducts) {
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector('[data-test="select-listed"]')!),
  );
  await el.updateComplete;
}
function adds(el: SectionAddProducts) {
  const add = vi.fn<(event: CustomEvent<{ productIds: string[] }>) => void>();
  el.addEventListener("wt-add-products", add as unknown as EventListener);
  return add;
}
const noneChosen = (el: SectionAddProducts) => el.shadowRoot!.querySelector('[data-test="error"]');

it("opens with nothing ticked and Add quiet and disabled, and an untouched press sends nothing", async () => {
  const { el } = await mount();
  const add = adds(el);
  expect(await addState(el)).toEqual(quiet);
  await press(el);
  expect(add).not.toHaveBeenCalled();
  expect(noneChosen(el)).toBeNull();
});

// A host `.click()` reaches Add's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself does nothing for an untouched choice.
// With nothing ticked no event could be sent either way, so the message is what tells them apart.
it("a press that reaches Add's handler with nothing ticked shows no message", async () => {
  const { el } = await mount();
  const add = adds(el);
  addButton(el).click();
  await el.updateComplete;
  expect(add).not.toHaveBeenCalled();
  expect(noneChosen(el)).toBeNull();
});

it("ticking a product makes Add primary and enabled, and unticking it makes it quiet again", async () => {
  const { el } = await mount();
  await tick(el, "p-lager");
  expect(await addState(el)).toEqual(ready);
  await tick(el, "p-lager");
  expect(await addState(el)).toEqual(quiet);
});

it("ticking every listed product, and unticking them again, does the same", async () => {
  const { el } = await mount();
  await tickListed(el);
  expect(await addState(el)).toEqual(ready);
  await tickListed(el);
  expect(await addState(el)).toEqual(quiet);
});

it("choosing a category or searching is no change", async () => {
  const { el } = await mount();
  await chooseOption(el.shadowRoot!.querySelector('wt-combobox[name="category"]')!, "c-drinks");
  const search = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=search]")!;
  await search.updateComplete;
  await userEvent.fill(page.elementLocator(search.shadowRoot!.querySelector("input")!), "La");
  await el.updateComplete;
  expect(await addState(el)).toEqual(quiet);
});

it("a press after ticking adds the ticked products", async () => {
  const { el } = await mount();
  const add = adds(el);
  await tick(el, "p-lager");
  await tick(el, "p-burger");
  await press(el);
  expect(add).toHaveBeenCalledOnce();
  expect(add.mock.calls[0]![0].detail.productIds).toEqual(["p-burger", "p-lager"]);
});

it("a refused add leaves Add enabled", async () => {
  const { el } = await mount();
  await tick(el, "p-lager");
  await press(el);
  el.busy = true;
  await el.updateComplete;
  el.busy = false;
  expect(await addState(el)).toEqual(ready);
});

it("says nothing is chosen when every ticked product has since entered the section", async () => {
  const { el } = await mount();
  const add = adds(el);
  await tick(el, "p-lager");
  el.inSection = ["p-lager"];
  expect(await addState(el)).toEqual(ready);
  await press(el);
  expect(add).not.toHaveBeenCalled();
  expect(noneChosen(el)!.textContent!.trim()).toBe(t("add_products.none_chosen"));
});

it("is quiet again once the ticked products are added", async () => {
  const { el } = await mount();
  await tick(el, "p-lager");
  await press(el);
  el.commitSaved(["p-lager"]);
  expect(await addState(el)).toEqual(quiet);
});

describe.each(["light", "dark"] as const)("section add products Add states (%s)", (theme) => {
  it("is accessible with Add quiet", async () => {
    const { el, host } = await mount(theme);
    expect(await addState(el)).toEqual(quiet);
    await expectNoA11yViolations(host);
  });

  it("is accessible with Add primary after a tick", async () => {
    const { el, host } = await mount(theme);
    await tick(el, "p-lager");
    expect(await addState(el)).toEqual(ready);
    await expectNoA11yViolations(host);
  });
});
