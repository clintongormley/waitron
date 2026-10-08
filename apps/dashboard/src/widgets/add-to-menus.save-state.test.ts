import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { CatalogueSummary, MenuStructure } from "../api/client.js";
import { t } from "../i18n/t.js";
import { AddToMenus, placementMenus } from "./add-to-menus.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

afterEach(cleanupWidgets);

const menus: CatalogueSummary[] = [
  { id: "m-lunch", name: "Lunch Menu", active: true, version: 1 },
  { id: "m-dinner", name: "Dinner Menu", active: true, version: 1 },
];
const structures: MenuStructure[] = [
  {
    rootSectionId: "root-lunch",
    root: {
      id: "root-lunch",
      internalName: "Lunch Menu",
      names: {},
      image: null,
      color: null,
      members: [],
    },
    includable: [],
    includedBy: [],
    nodes: [
      {
        memberId: "a",
        ref: { kind: "section", sectionId: "s-starters" },
        internalName: "Starters",
        names: {},
        children: [],
      },
      {
        memberId: "b",
        ref: { kind: "section", sectionId: "s-drinks" },
        internalName: "Drinks",
        names: {},
        children: [],
      },
    ],
  },
  {
    rootSectionId: "root-dinner",
    root: {
      id: "root-dinner",
      internalName: "Dinner Menu",
      names: {},
      image: null,
      color: null,
      members: [],
    },
    includable: [],
    includedBy: [],
    nodes: [],
  },
];

async function mount() {
  const { el, host } = await mountWidget<AddToMenus>("dashboard-add-to-menus", {
    open: true,
    productName: "Croquetas",
    menus: placementMenus(menus, structures),
  });
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { el, host };
}
function addButton(el: AddToMenus) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="add-to-menus"]',
  )!;
}
/** What Add looks like and whether a person can press it: the host's state and its inner button's. */
async function addState(el: AddToMenus) {
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
async function press(el: AddToMenus) {
  const inner = addButton(el).shadowRoot!.querySelector("button")!;
  await userEvent.click(page.elementLocator(inner), { force: true });
  await el.updateComplete;
}
async function tick(el: AddToMenus, sectionId: string) {
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector(`input[value="${sectionId}"]`)!),
  );
  await el.updateComplete;
}
function submissions(el: AddToMenus) {
  const submit = vi.fn<(event: CustomEvent<{ sectionIds: string[] }>) => void>();
  el.addEventListener("wt-submit", submit as unknown as EventListener);
  return submit;
}
const noneChosen = (el: AddToMenus) => el.shadowRoot!.querySelector('[data-test="none-chosen"]');

it("opens with nothing ticked and Add quiet and disabled, and an untouched press sends nothing", async () => {
  const { el } = await mount();
  const submit = submissions(el);
  expect(await addState(el)).toEqual(quiet);
  await press(el);
  expect(submit).not.toHaveBeenCalled();
  expect(noneChosen(el)).toBeNull();
});

// A host `.click()` reaches Add's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself does nothing for an untouched choice.
// With nothing ticked no event could be sent either way, so the message is what tells them apart.
it("a press that reaches Add's handler with nothing ticked shows no message and marks no place", async () => {
  const { el } = await mount();
  const submit = submissions(el);
  addButton(el).click();
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  expect(noneChosen(el)).toBeNull();
  expect(el.shadowRoot!.querySelector('input[aria-invalid="true"]')).toBeNull();
});

it("ticking a place makes Add primary and enabled, and unticking it makes it quiet again", async () => {
  const { el } = await mount();
  await tick(el, "s-drinks");
  expect(await addState(el)).toEqual(ready);
  await tick(el, "s-drinks");
  expect(await addState(el)).toEqual(quiet);
});

it("a press after ticking asks for the ticked places", async () => {
  const { el } = await mount();
  const submit = submissions(el);
  await tick(el, "root-dinner");
  await tick(el, "s-drinks");
  await press(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.sectionIds).toEqual(["s-drinks", "root-dinner"]);
});

it("unticking every place after a press quiets Add and says nothing is chosen", async () => {
  const { el } = await mount();
  await tick(el, "s-drinks");
  await press(el);
  await tick(el, "s-drinks");
  expect(await addState(el)).toEqual(quiet);
  expect(noneChosen(el)!.textContent!.trim()).toBe(t("add_to_menus.none_chosen"));
});

it("a refused place leaves Add enabled, with the refused place still ticked", async () => {
  const { el } = await mount();
  await tick(el, "s-starters");
  await tick(el, "s-drinks");
  await press(el);
  el.commitAdded(["s-starters"]);
  el.failures = [{ sectionId: "s-drinks", reason: "Try again." }];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector<HTMLInputElement>('input[value="s-drinks"]')!.checked).toBe(
    true,
  );
  expect(await addState(el)).toEqual(ready);
});

it("is quiet again once every ticked place took the product", async () => {
  const { el } = await mount();
  await tick(el, "s-drinks");
  await press(el);
  el.commitAdded(["s-drinks"]);
  expect(await addState(el)).toEqual(quiet);
});

it("is quiet again when reopened after a change", async () => {
  const { el } = await mount();
  await tick(el, "s-drinks");
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  expect(await addState(el)).toEqual(quiet);
});

it("Skip after ticking a place with no leave coordinator reports the cancel", async () => {
  const { el } = await mount();
  await tick(el, "s-drinks");
  const cancel = vi.fn();
  el.addEventListener("wt-cancel", cancel);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="skip"]')!.click();
  await el.updateComplete;
  expect(cancel).toHaveBeenCalledOnce();
});

it("Escape after ticking a place with no leave coordinator closes the window and reports the cancel", async () => {
  const { el } = await mount();
  await tick(el, "s-drinks");
  const cancel = vi.fn();
  el.addEventListener("wt-cancel", cancel);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => cancel.mock.calls.length).toBe(1);
  expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
});
