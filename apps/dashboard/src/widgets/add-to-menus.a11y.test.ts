import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { CatalogueSummary, MenuStructure } from "../api/client.js";
import { AddToMenus, placementMenus } from "./add-to-menus.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";

afterEach(cleanupWidgets);

const menus: CatalogueSummary[] = [
  { id: "m-lunch", name: "Lunch Menu", active: true, version: 1 },
  { id: "m-dinner", name: "Dinner Menu", active: true, version: 1 },
];
const drinks = {
  memberId: "x",
  ref: { kind: "section" as const, sectionId: "s-drinks" },
  internalName: "Drinks",
  names: { en: "Cold drinks" },
  children: [
    {
      memberId: "y",
      ref: { kind: "section" as const, sectionId: "s-beer" },
      internalName: "Beer",
      names: { en: "Beers on tap" },
      children: [],
    },
  ],
};
const structures: MenuStructure[] = [
  {
    rootSectionId: "root-lunch",
    root: {
      id: "root-lunch",
      internalName: "Lunch",
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
        names: { en: "Small plates" },
        children: [],
      },
      drinks,
    ],
  },
  {
    rootSectionId: "root-dinner",
    root: {
      id: "root-dinner",
      internalName: "Lunch",
      names: {},
      image: null,
      color: null,
      members: [],
    },
    includable: [],
    includedBy: [],
    nodes: [drinks],
  },
];
const states = ["loading", "load-error", "choosing", "invalid", "busy", "failed"] as const;

describe.each(["light", "dark"] as const)("add to menus (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    const { el, host } = await mountWidget<AddToMenus>(
      "dashboard-add-to-menus",
      {
        open: true,
        productName: "Croquetas",
        menus:
          state === "loading" || state === "load-error" ? null : placementMenus(menus, structures),
        loadError: state === "load-error" ? "The server could not do that." : null,
        busy: state === "busy",
      },
      theme,
    );
    const root = el.shadowRoot!;
    if (state === "choosing" || state === "busy") {
      root.querySelector<HTMLInputElement>('input[value="s-drinks"]')!.click();
      await el.updateComplete;
    }
    if (state === "invalid") {
      const drinks = root.querySelector<HTMLInputElement>('input[value="s-drinks"]')!;
      drinks.click();
      await el.updateComplete;
      root.querySelector<HTMLElement>('[data-test="add-to-menus"]')!.click();
      drinks.click();
      await el.updateComplete;
      expect(root.querySelector('[data-test="none-chosen"]')).not.toBeNull();
    }
    if (state === "failed") {
      el.failures = [{ sectionId: "s-drinks", reason: "The server could not do that." }];
      await el.updateComplete;
    }
    await expectNoA11yViolations(host);
  });
});

async function mountOpen(theme: "light" | "dark") {
  const { el, host } = await mountWidget<AddToMenus>(
    "dashboard-add-to-menus",
    { open: true, productName: "Croquetas", menus: placementMenus(menus, structures) },
    theme,
  );
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { el, host };
}
/** What Add looks like and whether a person can press it: the host's state and its inner button's. */
async function addState(el: AddToMenus) {
  await el.updateComplete;
  const add = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="add-to-menus"]',
  )!;
  await add.updateComplete;
  return {
    variant: add.variant,
    disabled: add.disabled,
    innerDisabled: add.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
async function tick(el: AddToMenus, sectionId: string) {
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector(`input[value="${sectionId}"]`)!),
  );
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("add to menus Add states (%s)", (theme) => {
  it("is accessible with Add quiet", async () => {
    const { el, host } = await mountOpen(theme);
    expect(await addState(el)).toEqual(quiet);
    await expectNoA11yViolations(host);
  });

  it("is accessible with Add primary after a tick", async () => {
    const { el, host } = await mountOpen(theme);
    await tick(el, "s-drinks");
    expect(await addState(el)).toEqual(ready);
    await expectNoA11yViolations(host);
  });
});
