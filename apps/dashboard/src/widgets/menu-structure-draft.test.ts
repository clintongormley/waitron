import { expect, it } from "vitest";
import type { MenuStructure, MenuStructureNode } from "../api/menu-api.js";
import type { MenuPriceRow } from "@waitron/shared";
import { MenuStructureDraft } from "./menu-structure-draft.js";
import { combinedFixture } from "./test-helpers.js";
import type { Product } from "../api/client.js";

const product = (memberId: string): MenuStructureNode => ({
  memberId,
  ref: { kind: "product", productId: "coffee" },
});

const included: MenuStructureNode = {
  memberId: "include",
  ref: { kind: "section", sectionId: "drinks-root" },
  includedMenuId: "drinks",
  folder: { showAsFolder: true, overrides: {} },
  children: [product("inside")],
};

function tree(...nodes: MenuStructureNode[]): MenuStructure {
  return {
    rootSectionId: "root",
    root: { id: "root", internalName: "Lunch", names: {}, color: null, image: null, members: [] },
    nodes,
    includable: [],
    placeableSetMenus: [],
    includedBy: [],
  };
}

function coffee(price: string): MenuPriceRow {
  return {
    menuItemId: "coffee-item",
    productId: "coffee",
    name: "Coffee",
    categoryId: null,
    placements: [["drinks-root"]],
    override: price,
    effectivePrice: price,
    available: false,
    variants: [],
    combined: combinedFixture("coffee", price, [], price, "3.00", {}),
  };
}

it("keeps one placement when append names a product the list already holds", () => {
  const draft = new MenuStructureDraft();
  draft.accept(tree(product("first")), []);
  draft.append("root", [product("second")]);
  expect(draft.input().rootMembers).toEqual([{ id: "first", ref: product("first").ref }]);
  expect(draft.dirty).toBe(false);
});

it.each(["inner", "missing"])("keeps the section when a move cannot reach %s", (destination) => {
  const draft = new MenuStructureDraft();
  draft.accept(
    tree({
      memberId: "outer-row",
      ref: { kind: "section", sectionId: "outer" },
      children: [
        {
          memberId: "inner-row",
          ref: { kind: "section", sectionId: "inner" },
          children: [product("one")],
        },
      ],
    }),
    [],
  );
  const before = draft.input();
  expect(draft.move([{ listId: "root", memberId: "outer-row" }], destination)).toBe(false);
  expect(draft.input()).toEqual(before);
  expect(draft.dirty).toBe(false);
});

it("preserves an explicit price with only an included placement, even while sold out", () => {
  const draft = new MenuStructureDraft();
  draft.accept(tree(included), [coffee("4.00")]);
  draft.append("root", [{ memberId: "chips", ref: { kind: "product", productId: "chips" } }]);
  expect(draft.input().prices).toEqual([{ productId: "coffee", price: "4.00" }]);
  expect(draft.input().sections).toEqual([]);
});

it("omits the price only when its last placement is removed and restores it if re-added", () => {
  const draft = new MenuStructureDraft();
  draft.accept(tree(included, product("outside")), [coffee("4.00")]);
  draft.remove([{ listId: "root", memberId: "outside" }]);
  expect(draft.input().prices).toEqual([{ productId: "coffee", price: "4.00" }]);
  draft.remove([{ listId: "root", memberId: "include" }]);
  expect(draft.input().prices).toEqual([]);
  draft.append("root", [product("new")]);
  expect(draft.input().prices).toEqual([{ productId: "coffee", price: "4.00" }]);
});

it("refreshes saved prices when clean and holds the manager's values while dirty", () => {
  const draft = new MenuStructureDraft();
  draft.accept(tree(included), [coffee("4.00")]);
  draft.accept(tree(included), [coffee("5.00")]);
  expect(draft.input().prices).toEqual([{ productId: "coffee", price: "5.00" }]);
  draft.append("root", [product("new")]);
  draft.accept(tree(included), [coffee("6.00")]);
  expect(draft.input().prices).toEqual([{ productId: "coffee", price: "5.00" }]);
  draft.restore();
  expect(draft.input().prices).toEqual([{ productId: "coffee", price: "6.00" }]);
  expect(draft.input().rootMembers.map(({ id }) => id)).toEqual(["include"]);
});

it("uses a shared price for both placements and reveals the clash when that price is cleared", () => {
  const draft = new MenuStructureDraft();
  draft.accept(tree(included, product("outside")), []);
  const catalog = [{ id: "coffee", unitPrice: "3.00", variants: [] }] as unknown as Product[];
  draft.include("drinks", tree(product("inside")), [coffee("4.00")]);
  expect(draft.offers(catalog, new Map([["drinks", "Drinks"]])).get("coffee")?.price.state).toBe(
    "clash",
  );
  draft.setPrice("coffee", undefined, "3.50");
  expect(draft.input().prices).toEqual([{ productId: "coffee", price: "3.50" }]);
  expect(draft.offers(catalog, new Map()).get("coffee")?.price).toMatchObject({
    state: "decided",
    source: { kind: "own" },
    value: "3.50",
  });
  draft.setPrice("coffee", undefined, "");
  expect(draft.offers(catalog, new Map()).get("coffee")?.price.state).toBe("clash");
});

it("refreshes an included menu's children while holding a dirty draft's existing prices", () => {
  const draft = new MenuStructureDraft();
  draft.accept(tree(included), [coffee("4.00")]);
  draft.append("root", [{ memberId: "chips", ref: { kind: "product", productId: "chips" } }]);
  draft.include("drinks", tree(), []);
  expect(draft.structure?.nodes[0]?.children).toEqual([]);
  expect(draft.input().prices).toEqual([{ productId: "coffee", price: "4.00" }]);
});
