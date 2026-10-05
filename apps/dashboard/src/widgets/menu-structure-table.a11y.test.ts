import { afterEach, describe, expect, it } from "vitest";
import { registerIcons } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { MenuStructureTable } from "./menu-structure-table.js";
import type { CategorySummary, MenuStructureNode, Product } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

const product = (id: string, name: string, image: string | null = null) =>
  ({ id, name, image }) as Product;

const products = [
  product("p-lager", "Lager"),
  product("p-burger", "Burger", "burger.webp"),
  product("p-rioja", "Rioja"),
];

const section = (
  memberId: string,
  sectionId: string,
  internalName: string,
  children: MenuStructureNode[],
  includedMenuId?: string,
): MenuStructureNode => ({
  memberId,
  ref: { kind: "section", sectionId },
  internalName,
  ownerMenuId: includedMenuId ?? "menu-lunch",
  ...(includedMenuId ? { includedMenuId } : {}),
  children,
});

const productNode = (memberId: string, productId: string): MenuStructureNode => ({
  memberId,
  ref: { kind: "product", productId },
});

const nodes: MenuStructureNode[] = [
  productNode("m-burger", "p-burger"),
  section("m-drinks", "s-drinks", "Drinks", [
    productNode("m-lager", "p-lager"),
    section("m-beer", "s-beer", "Beer", [productNode("m-lager-2", "p-lager")]),
  ]),
  section(
    "included-wine",
    "wine-root",
    "Wines",
    [
      section("wine-red", "red-wines", "Red wines", [productNode("wine-rioja", "p-rioja")]),
      productNode("wine-lager", "p-lager"),
    ],
    "wine",
  ),
];

const states = [
  "closed",
  "open",
  "current",
  "menu open",
  "root menu open",
  "included menu open",
  "busy",
] as const;

const MENU_OF: Partial<Record<(typeof states)[number], string>> = {
  "menu open": "actions-m-drinks",
  "root menu open": "actions-root",
  "included menu open": "actions-included-wine",
};

describe.each(["light", "dark"] as const)("menu structure table (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    const { el, host } = await mountWidget<MenuStructureTable>(
      "dashboard-menu-structure-table",
      {
        nodes,
        products,
        menuName: "Lunch Menu",
        current: state === "current" ? ["m-drinks", "m-beer"] : [],
        busy: state === "busy",
      },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    for (let round = 0; round < 3; round++) await table.updateComplete;
    const inTable = (selector: string) => table.shadowRoot!.querySelector<HTMLElement>(selector)!;
    if (state === "open" || state === "busy") {
      for (const key of ["m-drinks", "included-wine", "included-wine/wine-red"]) {
        inTable(`tr[data-row-key="${key}"] .row-activate`).click();
        await table.updateComplete;
      }
    }
    const menuTest = MENU_OF[state];
    if (menuTest) {
      const menu = inTable(`[data-test="${menuTest}"]`) as HTMLElementTagNameMap["wt-row-actions"];
      await menu.updateComplete;
      menu.show();
      expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
      if (state === "included menu open")
        expect(menu.querySelector('a[part="menu-link"]')).not.toBeNull();
    }
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with colour swatches, a product's own, its category's and none, and a section's", async () => {
    const categories: CategorySummary[] = [
      { id: "c-drinks", name: "Bebidas", parentId: null, color: "#256bb1" },
    ];
    const painted = [
      { ...product("p-lager", "Lager"), color: null, categoryId: "c-drinks" },
      { ...product("p-burger", "Burger", "burger.webp"), color: "#b12525", categoryId: null },
      { ...product("p-rioja", "Rioja"), color: null, categoryId: null },
    ] as Product[];
    const paintedNodes = nodes.map((node) =>
      node.memberId === "m-drinks" ? { ...node, color: "#aa3300" } : node,
    );
    const { el, host } = await mountWidget<MenuStructureTable>(
      "dashboard-menu-structure-table",
      { nodes: paintedNodes, products: painted, categories, menuName: "Lunch Menu" },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    for (let round = 0; round < 3; round++) await table.updateComplete;
    for (const key of ["m-drinks", "included-wine", "included-wine/wine-red"]) {
      table
        .shadowRoot!.querySelector<HTMLElement>(`tr[data-row-key="${key}"] .row-activate`)!
        .click();
      await table.updateComplete;
    }
    expect(table.shadowRoot!.querySelectorAll('[part~="color-swatch"]').length).toBeGreaterThan(5);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly mid-drag, with the dragged row faded, the ghost and the gap", async () => {
    const { el, host } = await mountWidget<MenuStructureTable>(
      "dashboard-menu-structure-table",
      { nodes, products, menuName: "Lunch Menu", current: ["m-drinks"] },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    for (let round = 0; round < 3; round++) await table.updateComplete;
    const at = (target: Element, type: string, over: Element = target) => {
      const box = over.getBoundingClientRect();
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          composed: true,
          pointerId: 1,
          clientX: box.x + 8,
          clientY: box.y + box.height / 2,
        }),
      );
    };
    const grip = table.shadowRoot!.querySelector('[data-test="drag-m-burger"]')!;
    const over = table.shadowRoot!.querySelector('tr[data-row-key="m-drinks"] [data-test="name"]')!;
    at(grip, "pointerdown");
    at(grip, "pointermove", over);
    await el.updateComplete;
    await table.updateComplete;
    await expectNoA11yViolations(host);
    at(grip, "pointercancel", over);
  });

  it("renders accessibly after a move by key, with its announcement", async () => {
    const { el, host } = await mountWidget<MenuStructureTable>(
      "dashboard-menu-structure-table",
      { nodes, products, menuName: "Lunch Menu" },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    for (let round = 0; round < 3; round++) await table.updateComplete;
    table
      .shadowRoot!.querySelector('[data-test="drag-m-burger"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    await el.updateComplete;
    await table.updateComplete;
    await expectNoA11yViolations(host);
  });
});
