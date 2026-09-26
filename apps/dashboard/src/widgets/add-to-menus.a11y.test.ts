import { afterEach, describe, it } from "vitest";
import type { CatalogueSummary, LibrarySection, MenuStructure } from "../api/client.js";
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
  children: [
    { memberId: "y", ref: { kind: "section" as const, sectionId: "s-beer" }, children: [] },
  ],
};
const structures: MenuStructure[] = [
  {
    rootSectionId: "root-lunch",
    nodes: [
      { memberId: "a", ref: { kind: "section", sectionId: "s-starters" }, children: [] },
      drinks,
    ],
  },
  { rootSectionId: "root-dinner", nodes: [drinks] },
];
const sections: LibrarySection[] = [
  ["s-starters", "Starters", "Small plates"],
  ["s-drinks", "Drinks", "Cold drinks"],
  ["s-beer", "Beer", "Beers on tap"],
].map(([id, internalName, customer]) => ({
  id: id!,
  internalName: internalName!,
  names: { en: customer! },
  image: null,
  color: null,
  members: [],
}));

const states = ["loading", "load-error", "choosing", "invalid", "busy", "failed"] as const;

describe.each(["light", "dark"] as const)("add to menus (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    const { el, host } = await mountWidget<AddToMenus>(
      "dashboard-add-to-menus",
      {
        open: true,
        productName: "Croquetas",
        menus:
          state === "loading" || state === "load-error"
            ? null
            : placementMenus(menus, structures, sections),
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
