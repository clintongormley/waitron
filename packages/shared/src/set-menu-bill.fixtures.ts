import type { SetMenuOfferDish } from "./set-menu-fit.js";
import type { BillSetMenuState, DishToPlace, SetMenuCopy } from "./set-menu-bill.js";

function listing(
  productId: string,
  countsAsCourseId: string,
  surchargeCents = 0,
  variantId: string | null = null,
): SetMenuOfferDish {
  return { productId, countsAsCourseId, surchargeCents, variantId };
}

export const daily: SetMenuCopy = {
  id: "daily-copy",
  setMenuId: "daily",
  versionId: "version",
  name: "Daily menu",
  priceCents: 1400,
  terms: { vatClass: "reduced", takeawayVatClass: "reduced" },
  lines: [
    { count: 1, courseIds: ["starters"] },
    { count: 1, courseIds: ["mains"] },
    { count: 1, courseIds: ["sharing"] },
    { count: 1, courseIds: ["drinks"] },
  ],
  dishes: [
    listing("soup", "starters"),
    listing("hake", "mains"),
    listing("sirloin", "mains", 500),
    listing("bravas", "sharing"),
    listing("wine", "drinks", 200, "glass"),
  ],
};

export const special: SetMenuCopy = {
  id: "special-copy",
  setMenuId: "special",
  versionId: "version",
  name: "Special menu",
  priceCents: 2000,
  terms: { vatClass: "reduced", takeawayVatClass: "reduced" },
  lines: [
    { count: 1, courseIds: ["starters"] },
    { count: 1, courseIds: ["mains", "starters"] },
  ],
  dishes: [
    listing("soup", "starters"),
    listing("sirloin", "mains"),
    listing("sea bass", "mains"),
    listing("bravas", "starters"),
  ],
};

export function bill(...menus: (readonly [lineId: string, copy: SetMenuCopy])[]): BillSetMenuState {
  const copies = [...new Set(menus.map(([, copy]) => copy))];
  return {
    copies,
    recorded: Object.fromEntries(copies.map((copy) => [copy.setMenuId, copy.id])),
    setMenus: menus.map(([lineId, copy], lineNo) => ({ lineId, copyId: copy.id, lineNo })),
    dishes: [],
  };
}

export function dish(productId: string, id = productId): DishToPlace {
  return { id, productId, variantId: null, reserved: null };
}
