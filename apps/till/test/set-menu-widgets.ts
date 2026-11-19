import {
  setMenuCopyOf,
  type BillSetMenuState,
  type ServedSetMenuCopy,
  type ServedSetMenuOffer,
} from "@waitron/shared";
import type { OrderLine } from "../src/state/working-order.js";

export const courses = { starter: "Starter", main: "Main", drink: "Drink" };

function dish(id: string, name: string, course: string, price: string): ServedSetMenuOffer {
  return {
    id,
    productId: `product-${id}`,
    grossPrice: null,
    menuName: "Lunch",
    placements: [[]],
    menuId: "lunch",
    name,
    kitchenName: `${name} for kitchen`,
    customerName: { en: `${name} for customers` },
    ordering: "not_sold_separately",
    available: true,
    image: null,
    description: null,
    vatClass: "reduced",
    takeawayVatClass: "reduced",
    category: null,
    allergens: null,
    diet: null,
    dietOverride: null,
    dietaryDeclarations: [],
    courseId: course,
    unit: {
      id: "each",
      staffName: "Each",
      staffAbbreviation: "ea",
      name: { en: "each" },
      abbreviation: { en: "ea" },
      precision: 0,
      hardwareUnit: null,
    },
    offeredModifiers: [],
    variants: [],
    unitPrice: price,
    countsAsCourseId: course,
    variantCountsAs: {},
  };
}

const soup = dish("soup", "Soup", "starter", "0.00");
const sirloin = dish("sirloin", "Sirloin", "main", "5.00");

export const daily: ServedSetMenuCopy = {
  key: "daily-copy",
  menuId: "daily",
  name: "Daily menu",
  changedAt: "2026-11-19T10:00:00Z",
  terms: {
    price: "14.00",
    vatClass: "reduced",
    takeawayVatClass: "reduced",
    names: {},
    lines: [
      { id: "starters", count: 2, courseIds: ["starter"] },
      { id: "mains", count: 1, courseIds: ["main", "starter"] },
      { id: "drinks", count: 1, courseIds: ["drink"] },
    ],
  },
  structure: { members: [] },
  offers: [
    soup,
    sirloin,
    { ...dish("ham", "Ham", "starter", "3.00"), unit: { ...soup.unit, measure: true } },
    { ...dish("water", "Water", "drink", "0.00"), available: false },
  ],
};

export const special: ServedSetMenuCopy = {
  ...daily,
  key: "special-copy",
  menuId: "special",
  name: "Special menu",
  terms: {
    ...daily.terms,
    price: "19.00",
    lines: [{ id: "special-main", count: 1, courseIds: ["main"] }],
  },
  offers: [{ ...sirloin, unitPrice: "0.00" }, dish("sea-bass", "Sea bass", "main", "0.00")],
};

export const bill: BillSetMenuState = {
  recorded: { daily: "lunch", special: "lunch" },
  copies: [setMenuCopyOf(daily, "lunch"), setMenuCopyOf(special, "lunch")],
  setMenus: [
    { lineId: "daily-1", lineNo: 1, copyId: daily.key },
    { lineId: "daily-2", lineNo: 2, copyId: daily.key },
    { lineId: "special-1", lineNo: 3, copyId: special.key },
  ],
  dishes: [
    {
      lineId: "sent-sirloin",
      setMenuLineId: "daily-1",
      place: 1,
      productId: sirloin.productId,
      variantId: null,
      priceCents: 500,
      countsAsCourseId: "main",
      movable: true,
    },
  ],
};

export const seaBass: OrderLine = {
  draftLineId: "fresh-sea-bass",
  setMenuId: special.menuId,
  product: {
    id: "product-sea-bass",
    name: "Sea bass",
    unitPrice: "0.00",
    vatClass: "reduced",
    pricingUnit: "each",
    category: null,
    allergens: null,
  },
  quantity: "1",
};
