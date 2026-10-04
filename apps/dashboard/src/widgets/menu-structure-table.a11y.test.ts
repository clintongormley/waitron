import { afterEach, describe, it } from "vitest";
import { registerIcons } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { MenuStructureTable } from "./menu-structure-table.js";
import type { MenuStructureNode, Product } from "../api/client.js";
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

const states = ["closed", "open", "current", "menu open", "busy"] as const;

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
    if (state === "menu open") {
      const menu = inTable('[data-test="actions-m-drinks"]') as HTMLElement & {
        show(): void;
        updateComplete: Promise<unknown>;
      };
      await menu.updateComplete;
      menu.show();
    }
    await expectNoA11yViolations(host);
  });
});
