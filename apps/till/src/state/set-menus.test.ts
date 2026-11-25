import { expect, it } from "vitest";
import { setMenuCopyOf, type BillSetMenuState, type ServedSetMenu } from "@waitron/shared";
import { draftPlacements, orderingCopies, ownSetMenuOffer } from "./set-menus.js";
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
      exact: true,
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

it("draws nothing from a moved set menu's copy, even one sharing the zone copy's key", () => {
  const moved = { ...copy("Daily", "lunch"), name: "Dinner's" };
  const zone = { ...copy("Daily", "lunch"), name: "Lunch's" };
  const bill = {
    setMenus: {
      recorded: {},
      exact: true,
      copies: [setMenuCopyOf(moved, "dinner")],
      setMenus: [{ lineId: "moved", lineNo: 1, copyId: moved.key }],
      dishes: [],
    },
    setMenuCopies: [moved],
  };
  expect(orderingCopies(bill, [zone], new Set(["lunch"]))).toEqual([
    { copy: zone, versionId: "lunch" },
  ]);
  expect(orderingCopies(bill, [])).toEqual([]);
});

const daily = {
  ...setMenuCopyOf(copy("Daily", "v1"), "v1"),
  dishes: [{ productId: "hake", variantId: null, countsAsCourseId: "mains", surchargeCents: 500 }],
};
const bill: BillSetMenuState = {
  recorded: { Daily: "v1" },
  exact: true,
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

it("finds a line's own menu's dish, and never another full menu's", () => {
  const selling = (versionId: string, dish: string, setMenuId = "Daily") =>
    ({
      ...copy(setMenuId, versionId),
      offers: [{ id: "hake", name: dish }],
    }) as unknown as ServedSetMenu;
  const dinner = selling("d1", "Dinner's").offers[0]!;
  const sold = { offer: dinner, versionId: "d1" };
  const zone = {
    setMenus: [
      selling("l2", "Evening's", "Evening"),
      selling("d1", "Dinner's"),
      selling("l2", "Lunch's"),
    ],
    versions: new Map([
      ["lunch", "l2"],
      ["dinner", "d1"],
    ]),
    menuOfVersion: new Map([
      ["l1", "lunch"],
      ["l2", "lunch"],
      ["d1", "dinner"],
    ]),
  };
  const line = (menuVersionId: string | null, menuId?: string, menuItemId = "hake") => ({
    setMenuId: "Daily",
    menuItemId,
    menuVersionId,
    ...(menuId === undefined ? {} : { menuId }),
  });
  const named = (...args: Parameters<typeof line>) =>
    ownSetMenuOffer(line(...args), sold, undefined, zone)?.name;

  expect(named("d1")).toBe("Dinner's");
  expect(named("l1")).toBe("Lunch's");
  expect(ownSetMenuOffer(line("l1"), undefined, undefined, zone)?.name).toBe("Lunch's");
  expect(named("l1", undefined, "cod")).toBeUndefined();
  // A version this till never saw: only the full menu a line read back names can place it.
  expect(named("l0")).toBeUndefined();
  expect(named("l0", "Daily")).toBeUndefined();
  expect(named("l0", "lunch")).toBe("Lunch's");
  expect(named(null)).toBeUndefined();
  const dropped = { ...zone, setMenus: [selling("d1", "Dinner's")] };
  expect(ownSetMenuOffer(line("l1"), sold, undefined, dropped)).toBeUndefined();
  const left = { ...zone, versions: new Map([["dinner", "d1"]]) };
  expect(ownSetMenuOffer(line("l1"), sold, undefined, left)).toBeUndefined();

  // A bill recording two versions of Daily names each, though it orders from Dinner's alone.
  const lunchCopy = selling("l1", "Lunch's as recorded");
  const dinnerCopy = selling("d1", "Dinner's");
  const recording = (copies: ServedSetMenu[], named: [ServedSetMenu, string][]) => ({
    setMenus: {
      recorded: { Daily: "d1" },
      exact: true,
      copies: named.map(([held, versionId]) => ({
        ...setMenuCopyOf({ ...held, offers: [] }, versionId),
      })),
      setMenus: [],
      dishes: [],
    },
    setMenuCopies: copies,
  });
  const both = recording(
    [dinnerCopy, lunchCopy],
    [
      [dinnerCopy, "d1"],
      [lunchCopy, "l1"],
    ],
  );
  expect(ownSetMenuOffer(line("l1"), sold, both, left)?.name).toBe("Lunch's as recorded");
  expect(ownSetMenuOffer(line("l1"), sold, both, zone)?.name).toBe("Lunch's as recorded");
  expect(ownSetMenuOffer(line("l1", undefined, "cod"), sold, both, left)).toBeUndefined();
  // Two full menus' copies sharing a key are named once, at the version the bill names.
  const shared = recording([dinnerCopy], [[dinnerCopy, "d1"]]);
  expect(ownSetMenuOffer(line("l1"), sold, shared, left)).toBeUndefined();
  expect(ownSetMenuOffer(line("l1"), sold, shared, zone)?.name).toBe("Lunch's");
});
