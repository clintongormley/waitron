import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { MenuStructureTree } from "./menu-structure-tree.js";
import type { MenuStructureNode } from "../api/client.js";

afterEach(cleanupWidgets);

const products = [
  { id: "p-lager", name: "Lager" },
  { id: "p-burger", name: "Burger" },
];
const nodes: MenuStructureNode[] = [
  { memberId: "m-burger", ref: { kind: "product", productId: "p-burger" } },
  {
    memberId: "m-drinks",
    ref: { kind: "section", sectionId: "s-drinks" },
    internalName: "Drinks",
    names: {},
    image: null,
    color: null,
    ownerMenuId: "menu-lunch",
    children: [
      { memberId: "m-lager", ref: { kind: "product", productId: "p-lager" } },
      {
        memberId: "m-beer",
        ref: { kind: "section", sectionId: "s-beer" },
        internalName: "Beer",
        names: {},
        image: null,
        color: null,
        ownerMenuId: "menu-lunch",
        children: [],
      },
    ],
  },
];

const states = [
  "empty",
  "collapsed",
  "expanded",
  "current",
  "read-only expanded",
  "included expanded",
] as const;

describe.each(["light", "dark"] as const)("menu structure tree (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    const { el, host } = await mountWidget<MenuStructureTree>(
      "dashboard-menu-structure-tree",
      {
        nodes:
          state === "empty"
            ? []
            : state === "included expanded"
              ? nodes.map((node) =>
                  node.memberId === "m-drinks" ? { ...node, includedMenuId: "drinks" } : node,
                )
              : nodes,
        products,
        label: "Lunch Menu",
        current: state === "current" ? ["m-drinks", "m-beer"] : [],
        readonly: state === "read-only expanded",
      },
      theme,
    );
    if (state === "expanded" || state === "read-only expanded" || state === "included expanded") {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="toggle-m-drinks"]')!.click();
      await el.updateComplete;
    }
    await expectNoA11yViolations(host);
  });
});
