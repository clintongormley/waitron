import { describe, expect, it } from "vitest";
import type { TillMenuOffer, TillProduct } from "../api/client.js";
import {
  endedPeriodOf,
  isLateSendManagerRefusal,
  lateSendAsked,
  lateSendRefusalOf,
  refusedLines,
  storedLateSendAsked,
} from "./late-send.js";
import type { OrderLine } from "./working-order.js";

function offer(
  id: string,
  menuId: string,
  productId: string,
  extra: Partial<TillMenuOffer> = {},
): TillMenuOffer {
  return { id, menuId, productId, variants: [], ...extra } as unknown as TillMenuOffer;
}

function line(menuItemId: string, extra: Partial<OrderLine> = {}, variantId?: string): OrderLine {
  const product = {
    id: "p",
    menuItemId,
    ...(variantId === undefined ? {} : { variantId }),
  } as unknown as TillProduct;
  return { product, quantity: "1", ...extra };
}

const toast = offer("toast-breakfast", "breakfast", "toast");
const beerBreakfast = offer("beer-breakfast", "breakfast", "beer");
const beerLunch = offer("beer-lunch", "lunch", "beer");
const dinnerSoup = offer("soup-dinner", "dinner", "soup");

function index(live: TillMenuOffer[]) {
  return {
    byId: new Map(live.map((entry) => [entry.id, entry])),
    live,
    selectable: new Set(["lunch"]),
    ended: new Map([["breakfast", "Breakfast"]]),
  };
}

describe("endedPeriodOf", () => {
  it("marks a line on a menu whose period ended earlier today", () => {
    expect(endedPeriodOf(line("toast-breakfast"), index([toast, beerLunch]))).toEqual({
      menuId: "breakfast",
      periodName: "Breakfast",
    });
  });

  it("does not mark a dish an orderable menu also sells", () => {
    expect(
      endedPeriodOf(line("beer-breakfast"), index([beerBreakfast, beerLunch])),
    ).toBeUndefined();
  });

  it("marks a dish the orderable menu offers only as not sold separately", () => {
    const notAlone = offer("beer-lunch", "lunch", "beer", { ordering: "not_sold_separately" });
    expect(endedPeriodOf(line("beer-breakfast"), index([beerBreakfast, notAlone]))).toEqual({
      menuId: "breakfast",
      periodName: "Breakfast",
    });
  });

  it("marks a variant the orderable menu's offer does not list, and not one it lists", () => {
    const pint = { id: "pint" } as TillMenuOffer["variants"][number];
    const lunchPints = offer("beer-lunch", "lunch", "beer", { variants: [pint] });
    const offers = index([beerBreakfast, lunchPints]);
    expect(endedPeriodOf(line("beer-breakfast", {}, "pint"), offers)).toBeUndefined();
    expect(endedPeriodOf(line("beer-breakfast", {}, "half"), offers)).toEqual({
      menuId: "breakfast",
      periodName: "Breakfast",
    });
  });

  it("does not mark a line on a menu neither orderable nor ended today", () => {
    expect(endedPeriodOf(line("soup-dinner"), index([dinnerSoup]))).toBeUndefined();
  });

  it("does not mark an orderable menu's line or an unknown offer", () => {
    expect(endedPeriodOf(line("beer-lunch"), index([beerLunch]))).toBeUndefined();
    expect(endedPeriodOf(line("missing"), index([toast]))).toBeUndefined();
  });

  it("does not mark a stored line", () => {
    const offers = index([toast]);
    expect(
      endedPeriodOf(line("toast-breakfast", { workingOrderLineId: "wol-1" }), offers),
    ).toBeUndefined();
  });
});

describe("lateSendRefusalOf", () => {
  const menus = [{ menuId: "breakfast", periodName: "Breakfast" }];

  it("reads the ended menus and the late dishes from the server's refusal", () => {
    const error = {
      code: "menu_period.ended",
      status: 409,
      departmentId: "kitchen",
      menus,
      menuItemIds: ["toast-breakfast"],
      needsManager: false,
    };
    expect(lateSendRefusalOf(error)).toEqual({ menus, menuItemIds: ["toast-breakfast"] });
  });

  it("is undefined for the refusal without its params", () => {
    expect(lateSendRefusalOf({ code: "menu_period.ended", status: 409 })).toBeUndefined();
  });

  it("reads the stored lines a Place's refusal names", () => {
    const error = {
      code: "menu_period.ended",
      menus,
      menuItemIds: ["toast-breakfast"],
      workingOrderLineIds: ["wol-1"],
    };
    expect(lateSendRefusalOf(error)).toEqual({
      menus,
      menuItemIds: ["toast-breakfast"],
      workingOrderLineIds: ["wol-1"],
    });
  });

  it.each([
    ["menus not a list", { menus: "Breakfast", menuItemIds: ["x"] }],
    ["a menu with no name", { menus: [{ menuId: "breakfast" }], menuItemIds: ["x"] }],
    ["a menu with no id", { menus: [{ periodName: "Breakfast" }], menuItemIds: ["x"] }],
    ["no menus", { menus: [], menuItemIds: ["x"] }],
    ["a menu that is not an object", { menus: [null], menuItemIds: ["x"] }],
    ["a dish id that is not text", { menus, menuItemIds: [7] }],
    ["no dish ids", { menus }],
    ["a stored line id that is not text", { menus, menuItemIds: ["x"], workingOrderLineIds: [7] }],
    ["stored line ids not a list", { menus, menuItemIds: ["x"], workingOrderLineIds: "wol-1" }],
  ])("is undefined for %s", (_label, params) => {
    expect(
      lateSendRefusalOf({ code: "menu_period.ended", status: 409, ...params }),
    ).toBeUndefined();
  });

  it("is undefined for another code carrying the same params", () => {
    expect(
      lateSendRefusalOf({ code: "product.unavailable", menus, menuItemIds: ["x"] }),
    ).toBeUndefined();
  });

  it.each([undefined, null, "menu_period.ended", new Error("menu_period.ended")])(
    "is undefined for %s",
    (error) => {
      expect(lateSendRefusalOf(error)).toBeUndefined();
    },
  );
});

describe("refusedLines", () => {
  const refusal = {
    menus: [{ menuId: "breakfast", periodName: "Breakfast" }],
    menuItemIds: ["egg-breakfast", "toast-breakfast", "absent"],
  };

  it("keeps the request's order and ignores ids it does not hold", () => {
    const toastLine = line("toast-breakfast");
    const beerLine = line("beer-lunch");
    const eggLine = line("egg-breakfast");
    expect(refusedLines([toastLine, beerLine, eggLine], refusal)).toEqual([toastLine, eggLine]);
  });

  it("leaves out a stored line sharing a fresh late dish's offer id", () => {
    const stored = line("toast-breakfast", { workingOrderLineId: "wol-1" });
    const fresh = line("toast-breakfast");
    const result = refusedLines([stored, fresh], refusal);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(fresh);
  });

  it("lists a stored line the request adds extras to, and still leaves out one it does not", () => {
    const changed = line("toast-breakfast", { workingOrderLineId: "wol-1" });
    const untouched = line("toast-breakfast", { workingOrderLineId: "wol-2" });
    expect(refusedLines([changed, untouched], refusal, new Set(["wol-1"]))).toEqual([changed]);
  });

  it("leaves out a stored line the request adds extras to when the refusal does not name it", () => {
    const changed = line("beer-lunch", { workingOrderLineId: "wol-1" });
    expect(refusedLines([changed], refusal, new Set(["wol-1"]))).toEqual([]);
  });
});

describe("lateSendAsked", () => {
  const menus = [
    { menuId: "breakfast", periodName: "Breakfast" },
    { menuId: "brunch", periodName: "Brunch" },
  ];
  const ended = (menuItemIds: unknown) => ({
    code: "menu_period.ended",
    status: 409,
    menus,
    menuItemIds,
    needsManager: false,
  });

  it("lists the request's new lines the refusal names, under every menu it names", () => {
    const toastLine = line("toast-breakfast");
    const beerLine = line("beer-lunch");
    const asked = lateSendAsked(ended(["toast-breakfast"]), [beerLine, toastLine]);
    expect(asked?.periods).toEqual(menus);
    expect(asked?.listed).toHaveLength(1);
    expect(asked?.listed[0]).toBe(toastLine);
  });

  it("lists a stored line the request adds extras to, and not a stored line it leaves alone", () => {
    const changed = line("toast-breakfast", { workingOrderLineId: "wol-1" });
    const untouched = line("toast-breakfast", { workingOrderLineId: "wol-2" });
    const asked = lateSendAsked(
      ended(["toast-breakfast"]),
      [untouched, changed],
      new Set(["wol-1"]),
    );
    expect(asked?.listed).toEqual([changed]);
    expect(lateSendAsked(ended(["toast-breakfast"]), [untouched, changed])).toBeUndefined();
  });

  it("is undefined when the refusal names none of the lines", () => {
    expect(lateSendAsked(ended(["absent"]), [line("toast-breakfast")])).toBeUndefined();
  });

  it.each([
    ["the refusal without its params", { code: "menu_period.ended", status: 409 }],
    ["another code", { code: "product.unavailable", menus, menuItemIds: ["toast-breakfast"] }],
    ["no error object", undefined],
  ])("is undefined for %s", (_label, error) => {
    expect(lateSendAsked(error, [line("toast-breakfast")])).toBeUndefined();
  });
});

describe("storedLateSendAsked", () => {
  const menus = [{ menuId: "breakfast", periodName: "Breakfast" }];
  const placeRefused = (workingOrderLineIds?: string[]) => ({
    code: "menu_period.ended",
    status: 409,
    menus,
    menuItemIds: ["toast-breakfast"],
    ...(workingOrderLineIds === undefined ? {} : { workingOrderLineIds }),
    needsManager: false,
  });

  it("lists the stored lines the refusal names by id, in the basket's order", () => {
    const first = line("toast-breakfast", { workingOrderLineId: "wol-1" });
    const other = line("toast-breakfast", { workingOrderLineId: "wol-2" });
    const second = line("egg-breakfast", { workingOrderLineId: "wol-3" });
    const fresh = line("toast-breakfast");
    const asked = storedLateSendAsked(placeRefused(["wol-3", "wol-1"]), [
      first,
      other,
      fresh,
      second,
    ]);
    expect(asked).toEqual({ listed: [first, second], periods: menus });
  });

  it("lists the lines carrying a refused dish when the basket holds none of the named ids", () => {
    const savedHere = line("toast-breakfast");
    const coffee = line("coffee-lunch");
    expect(storedLateSendAsked(placeRefused(["wol-9"]), [coffee, savedHere])).toEqual({
      listed: [savedHere],
      periods: menus,
    });
  });

  it("names the period alone when the basket holds none of the refused dishes", () => {
    expect(storedLateSendAsked(placeRefused(["wol-9"]), [line("coffee-lunch")])).toEqual({
      listed: [],
      periods: menus,
    });
  });

  it("is undefined for a refusal naming no stored line, which lateSendAsked lists", () => {
    expect(
      storedLateSendAsked(placeRefused(), [
        line("toast-breakfast", { workingOrderLineId: "wol-1" }),
      ]),
    ).toBeUndefined();
  });
});

describe("isLateSendManagerRefusal", () => {
  it("is true for a refusal for want of venue.configure", () => {
    expect(
      isLateSendManagerRefusal({
        code: "authorization.not_permitted",
        status: 403,
        permission: "venue.configure",
      }),
    ).toBe(true);
  });

  it.each([
    ["another permission", { code: "authorization.not_permitted", permission: "cash.drawer" }],
    ["no permission", { code: "authorization.not_permitted" }],
    ["another code", { code: "pin.invalid", permission: "venue.configure" }],
    ["no object", undefined],
    ["null", null],
  ])("is false for %s", (_label, error) => {
    expect(isLateSendManagerRefusal(error)).toBe(false);
  });
});
