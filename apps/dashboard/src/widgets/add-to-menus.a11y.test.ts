import { afterEach, describe, it } from "vitest";
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
      root.querySelector<HTMLElement>('[data-test="add-to-menus"]')!.click();
      await el.updateComplete;
    }
    if (state === "failed") {
      el.failures = [{ sectionId: "s-drinks", reason: "The server could not do that." }];
      await el.updateComplete;
    }
    await expectNoA11yViolations(host);
  });
});
