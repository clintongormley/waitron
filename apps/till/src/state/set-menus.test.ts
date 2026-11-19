import { expect, it } from "vitest";
import { setMenuCopyOf, type BillSetMenuState, type ServedSetMenu } from "@waitron/shared";
import { draftPlacements, orderingCopies } from "./set-menus.js";
import type { OrderLine } from "./working-order.js";

function copy(menuId: string, versionId: string, newestOnSale = true): ServedSetMenu {
  return {
    key: `${menuId}-${versionId}`,
    menuId,
    versionIds: [versionId],
    orderable: newestOnSale,
    newestOnSale,
    name: menuId,
    terms: {
      price: "14.00",
      vatClass: "reduced",
      takeawayVatClass: "reduced",
      names: {},
      lines: [{ id: "main-place", count: 1, courseIds: ["mains"] }],
    },
    structure: { members: [] },
    offers: [],
    changedAt: "2026-11-19T10:00:00Z",
  };
}

it("uses the recorded version and adds only the newest copies actually on sale", () => {
  const recorded = copy("Daily", "yesterday", false);
  const state = {
    setMenus: {
      recorded: { Daily: "yesterday" },
      copies: [setMenuCopyOf(recorded, "yesterday")],
      setMenus: [],
      dishes: [],
    },
    setMenuCopies: [recorded],
  };
  const brunch = { ...copy("Brunch", "dinner"), versionIds: ["dinner", "lunch"] };
  expect(
    orderingCopies(
      state,
      [copy("Daily", "today"), copy("Evening", "later", false), brunch],
      new Set(["lunch"]),
    ),
  ).toEqual([
    { copy: recorded, versionId: "yesterday" },
    { copy: brunch, versionId: "lunch" },
  ]);
});

const daily = {
  ...setMenuCopyOf(copy("Daily", "v1"), "v1"),
  dishes: [{ productId: "hake", variantId: null, countsAsCourseId: "mains", surchargeCents: 500 }],
};
const bill: BillSetMenuState = {
  recorded: { Daily: "v1" },
  copies: [daily],
  setMenus: ["first", "second", "third"].map((lineId, lineNo) => ({
    lineId,
    lineNo,
    copyId: daily.id,
  })),
  dishes: [
    {
      lineId: "sent-hake",
      setMenuLineId: "first",
      place: 0,
      productId: "hake",
      variantId: null,
      priceCents: 500,
      countsAsCourseId: "mains",
      movable: true,
    },
  ],
};
const ordinary: OrderLine = {
  product: {
    id: "hake",
    name: "Hake",
    unitPrice: "16.00",
    available: true,
    vatClass: "reduced",
    category: null,
    allergens: null,
  },
  quantity: "1",
};
const fresh = (draftLineId: string): OrderLine => ({
  ...ordinary,
  draftLineId,
  setMenuId: "Daily",
});

it("fills open places in draft order, leaving the sent dish and ordinary lines alone", () => {
  expect(draftPlacements(bill, [ordinary, fresh("a"), fresh("b"), fresh("c")])).toEqual({
    placed: [
      { id: "a", setMenuLineId: "second", place: 0, priceCents: 500, countsAsCourseId: "mains" },
      { id: "b", setMenuLineId: "third", place: 0, priceCents: 500, countsAsCourseId: "mains" },
    ],
    unplaced: ["c"],
  });
});

it("holds a saved reservation before an earlier unsent dish can take it", () => {
  const held = { ...fresh("b"), setMenuReserved: { setMenuLineId: "second", place: 0 } };
  expect(
    draftPlacements(bill, [fresh("a"), held]).placed.map((place) => place.setMenuLineId),
  ).toEqual(["third", "second"]);
});
