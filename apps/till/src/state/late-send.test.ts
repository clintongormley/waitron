import { describe, expect, it } from "vitest";
import type { TillMenuOffer, TillProduct } from "../api/client.js";
import { endedPeriodOf } from "./late-send.js";
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
