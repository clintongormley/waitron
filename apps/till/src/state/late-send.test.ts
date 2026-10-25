import { describe, expect, it } from "vitest";
import type { TillMenuOffer, TillProduct } from "../api/client.js";
import {
  endedPeriodOf,
  isLateSendManagerRefusal,
  lateSendAsked,
  lateSendRefusalOf,
  refusedLines,
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

  it("does not mark a stored or recalled line", () => {
    const offers = index([toast]);
    expect(
      endedPeriodOf(line("toast-breakfast", { workingOrderLineId: "wol-1" }), offers),
    ).toBeUndefined();
    expect(
      endedPeriodOf(
        line("toast-breakfast", { source: {} as NonNullable<OrderLine["source"]> }),
        offers,
      ),
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

  it.each([
    ["menus not a list", { menus: "Breakfast", menuItemIds: ["x"] }],
    ["a menu with no name", { menus: [{ menuId: "breakfast" }], menuItemIds: ["x"] }],
    ["a menu with no id", { menus: [{ periodName: "Breakfast" }], menuItemIds: ["x"] }],
    ["no menus", { menus: [], menuItemIds: ["x"] }],
    ["a menu that is not an object", { menus: [null], menuItemIds: ["x"] }],
    ["a dish id that is not text", { menus, menuItemIds: [7] }],
    ["no dish ids", { menus }],
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

  it("leaves out a stored line and a recalled line sharing a fresh late dish's offer id", () => {
    const stored = line("toast-breakfast", { workingOrderLineId: "wol-1" });
    const recalled = line("toast-breakfast", {
      source: { kind: "line" } as unknown as OrderLine["source"],
    });
    const fresh = line("toast-breakfast");
    const result = refusedLines([stored, recalled, fresh], refusal);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(fresh);
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
    const recalled = line("toast-breakfast", {
      source: { kind: "line" } as unknown as OrderLine["source"],
    });
    const asked = lateSendAsked(ended(["toast-breakfast"]), [recalled, beerLine, toastLine]);
    expect(asked?.periods).toEqual(menus);
    expect(asked?.listed).toHaveLength(1);
    expect(asked?.listed[0]).toBe(toastLine);
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

describe("isLateSendManagerRefusal", () => {
  it("is true for a refusal for want of venue_service.manage", () => {
    expect(
      isLateSendManagerRefusal({
        code: "authorization.not_permitted",
        status: 403,
        permission: "venue_service.manage",
      }),
    ).toBe(true);
  });

  it.each([
    ["another permission", { code: "authorization.not_permitted", permission: "cash.drawer" }],
    ["no permission", { code: "authorization.not_permitted" }],
    ["another code", { code: "pin.invalid", permission: "venue_service.manage" }],
    ["no object", undefined],
    ["null", null],
  ])("is false for %s", (_label, error) => {
    expect(isLateSendManagerRefusal(error)).toBe(false);
  });
});
