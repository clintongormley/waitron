import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { registerIcons } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { MenuStructureTable } from "./menu-structure-table.js";
import type { CategorySummary, MenuHome, MenuStructureNode, Product } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { t } from "../i18n/t.js";

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
  ...(includedMenuId
    ? { includedMenuId, folder: { showAsFolder: true, overrides: { color: "#c0a000" } } }
    : {}),
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
  "included shown directly",
  "busy",
] as const;

const MENU_OF: Partial<Record<(typeof states)[number], string>> = {
  "menu open": "actions-m-drinks",
  "root menu open": "actions-root",
  "included menu open": "actions-included-wine",
  "included shown directly": "actions-included-wine",
};

const shownDirectly = nodes.map((node) =>
  node.includedMenuId ? { ...node, folder: { showAsFolder: false, overrides: {} } } : node,
);

describe.each(["light", "dark"] as const)("menu structure table (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    const { el, host } = await mountWidget<MenuStructureTable>(
      "dashboard-menu-structure-table",
      {
        nodes: state === "included shown directly" ? shownDirectly : nodes,
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
        expect(menu.querySelector('a[href][data-test="source-included-wine"]')).not.toBeNull();
      if (state.startsWith("included"))
        expect(menu.querySelector('[data-test="edit-included-wine"]')).not.toBeNull();
    }
    if (state === "included shown directly" || state === "closed") {
      const note = inTable('[data-test="folder-setting-included-wine"]');
      expect(note.textContent!.trim()).toBe(
        t(state === "closed" ? "menus.include_as_folder" : "menus.include_direct"),
      );
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
    const before = { width: window.innerWidth, height: window.innerHeight };
    // At 440px or less the tree hides every swatch, so the link could not take focus.
    await page.viewport(1280, 900);
    try {
      const { el, host } = await mountWidget<MenuStructureTable>(
        "dashboard-menu-structure-table",
        { nodes: paintedNodes, products: painted, categories, menuName: "Lunch Menu" },
        theme,
      );
      const table = el.shadowRoot!.querySelector("wt-data-table")!;
      for (let round = 0; round < 3; round++) await table.updateComplete;
      await expect.poll(() => table.hasAttribute("narrow")).toBe(false);
      for (const key of ["m-drinks", "included-wine", "included-wine/wine-red"]) {
        table
          .shadowRoot!.querySelector<HTMLElement>(`tr[data-row-key="${key}"] .row-activate`)!
          .click();
        await table.updateComplete;
      }
      expect(table.shadowRoot!.querySelectorAll('[part~="color-swatch"]').length).toBe(8);
      await expectNoA11yViolations(host);
      const link = table.shadowRoot!.querySelector<HTMLAnchorElement>(
        'a[data-test="color-m-burger"]',
      )!;
      expect(link.getAttribute("aria-label")).toBe(
        t("product.edit_named").replace("{name}", "Burger"),
      );
      link.focus();
      expect(table.shadowRoot!.activeElement).toBe(link);
      expect(getComputedStyle(link).outlineStyle).not.toBe("none");
      await expectNoA11yViolations(host);
    } finally {
      await page.viewport(before.width, before.height);
    }
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

  it.each([1280, 390])(
    "renders accessibly with the Device Home Page open, a missing shortcut included, at %i px",
    async (width) => {
      const before = { width: window.innerWidth, height: window.innerHeight };
      const home: MenuHome = {
        homeSectionId: "s-home",
        shortcuts: [
          {
            memberId: "t-burger",
            position: 0,
            ref: { kind: "product", productId: "p-burger" },
            missingName: null,
            name: "Burger",
            reachable: true,
          },
          {
            memberId: "t-drinks",
            position: 1,
            ref: { kind: "section", sectionId: "s-drinks" },
            missingName: null,
            name: "Drinks",
            reachable: true,
          },
          {
            memberId: "t-chips",
            position: 2,
            ref: { kind: "product", productId: "p-chips" },
            missingName: "Chips",
            name: "Chips",
            reachable: false,
          },
        ],
        handheld: { columns: 3, tiles: "colours", order: "home_first" },
        till: { columns: 6, tiles: "colours", order: "home_first" },
      };
      try {
        await page.viewport(width, 900);
        const { el, host } = await mountWidget<MenuStructureTable>(
          "dashboard-menu-structure-table",
          { nodes, products, menuName: "Lunch Menu", home },
          theme,
        );
        const table = el.shadowRoot!.querySelector("wt-data-table")!;
        for (let round = 0; round < 3; round++) await table.updateComplete;
        table
          .shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="home"] .row-activate')!
          .click();
        await table.updateComplete;
        expect(
          table.shadowRoot!.querySelector('tr[data-row-key="home/t-chips"]')!.textContent,
        ).toContain("Chips");
        await expectNoA11yViolations(host);
      } finally {
        await page.viewport(before.width, before.height);
      }
    },
  );
});
