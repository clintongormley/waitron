import { describe, expect, it } from "vitest";

import type { MenuOfferVariant, ServedSetMenuCopy, ServedSetMenuOffer } from "./index.js";
import * as shared from "./index.js";

const portion: ServedSetMenuOffer["unit"] = {
  id: "each",
  staffName: "Each",
  staffAbbreviation: "ea",
  name: { en: "Each" },
  abbreviation: { en: "ea" },
  precision: 0,
  hardwareUnit: null,
};

function offer(
  productId: string,
  countsAsCourseId: string | null,
  unitPrice = "0.00",
): ServedSetMenuOffer {
  return {
    id: `item-${productId}`,
    menuId: "daily",
    grossPrice: unitPrice,
    productId,
    countsAsCourseId,
    unitPrice,
    courseId: "sending-course",
    menuName: "Daily menu",
    placements: [[]],
    name: productId,
    customerName: null,
    kitchenName: null,
    unit: portion,
    vatClass: "reduced",
    takeawayVatClass: "reduced",
    category: null,
    allergens: null,
    diet: null,
    dietOverride: null,
    dietaryDeclarations: [],
    offeredModifiers: [],
    variants: [],
    variantCountsAs: {},
    available: true,
    image: null,
    description: null,
  };
}

const glass: MenuOfferVariant = {
  id: "glass",
  name: "Glass",
  customerName: null,
  kitchenName: null,
  image: null,
  unitPrice: "1.50",
  menuPrice: "1.50",
  available: true,
  unit: portion,
  pricingUnit: "each",
  vatClass: "general",
  takeawayVatClass: "general",
  category: null,
  allergens: null,
  diet: null,
  dietOverride: null,
  dietaryDeclarations: [],
  courseId: "sending-course",
};

function daily(offers: ServedSetMenuOffer[]): ServedSetMenuCopy {
  return {
    key: "daily:published",
    menuId: "daily",
    name: "Daily menu",
    terms: {
      price: "14.00",
      vatClass: "reduced",
      takeawayVatClass: "general",
      names: { en: "Daily menu" },
      lines: [
        { id: "first", count: 1, courseIds: ["starters"] },
        { id: "second", count: 1, courseIds: ["mains"] },
        { id: "third", count: 1, courseIds: ["drinks"] },
      ],
    },
    changedAt: "2026-11-19T00:00:00Z",
    structure: { members: [] },
    offers,
  };
}

describe("set-menu copies", () => {
  it("uses the published surcharge and counting course for each dish and kept variant", () => {
    const wine = {
      ...offer("wine", "starters"),
      variants: [glass],
      variantCountsAs: { glass: "drinks" },
    };
    const copy = daily([offer("soup", "starters"), offer("sirloin", "mains", "5.00"), wine]);
    expect(shared.setMenuOfferOf(copy)).toEqual({
      id: "daily:published",
      priceCents: 1400,
      lines: copy.terms.lines,
      dishes: [
        { productId: "soup", variantId: null, countsAsCourseId: "starters", surchargeCents: 0 },
        { productId: "sirloin", variantId: null, countsAsCourseId: "mains", surchargeCents: 500 },
        { productId: "wine", variantId: "glass", countsAsCourseId: "drinks", surchargeCents: 150 },
      ],
    });
  });

  it("omits dishes sold in a unit that measures an amount", () => {
    const fish = offer("fish", "mains");
    fish.unit = { ...portion, id: "kg", measure: true, hardwareUnit: "kg", precision: 3 };
    expect(shared.setMenuOfferOf(daily([fish, offer("soup", "starters")])).dishes).toEqual([
      { productId: "soup", variantId: null, countsAsCourseId: "starters", surchargeCents: 0 },
    ]);
  });

  it("carries the published identity, version and tax classes used by the bill", () => {
    const copy = shared.setMenuCopyOf(daily([]), "version-2");
    expect(copy).toMatchObject({
      id: "daily:published",
      setMenuId: "daily",
      versionId: "version-2",
      name: "Daily menu",
      terms: { vatClass: "reduced", takeawayVatClass: "general" },
    });
  });

  it("lists copies by both product and variant", () => {
    const wine = {
      ...offer("wine", null),
      variants: [glass],
      variantCountsAs: { glass: "drinks" },
    };
    const copies = [
      shared.setMenuCopyOf(daily([wine]), "version-1"),
      shared.setMenuCopyOf(
        { ...daily([offer("wine", "drinks")]), key: "daily:other" },
        "version-2",
      ),
    ];
    expect(shared.copiesListing(copies, "wine", "glass").map(({ id }) => id)).toEqual([
      "daily:published",
    ]);
    expect(shared.copiesListing(copies, "wine", null).map(({ id }) => id)).toEqual(["daily:other"]);
    expect(shared.copiesListing(copies, "juice", "glass")).toEqual([]);
  });
});
