import { describe, expect, it } from "vitest";
import type { FrozenOffer } from "./menu-document-types.js";
import { menuPriceRange, resolveMenuText } from "./customer-menu-presentation.js";

const config = { defaultLanguage: "en", languages: ["en", "es"] };
const staff = "Counter burger";

describe("resolveMenuText", () => {
  it.each([
    [
      "requested Spanish",
      { en: "House burger", es: "Hamburguesa de la casa" },
      "es",
      {
        text: "Hamburguesa de la casa",
        origin: "requested",
        language: "es",
        missingRequested: false,
      },
    ],
    [
      "default English",
      { en: "House burger" },
      "es",
      { text: "House burger", origin: "default", language: "en", missingRequested: true },
    ],
    [
      "blank requested text",
      { en: "House burger", es: " " },
      "es",
      { text: "House burger", origin: "default", language: "en", missingRequested: true },
    ],
    [
      "empty map",
      {},
      "es",
      { text: staff, origin: "staff", language: null, missingRequested: true },
    ],
    [
      "no map",
      null,
      "es",
      { text: staff, origin: "staff", language: null, missingRequested: true },
    ],
    [
      "whitespace-only map",
      { es: " " },
      "es",
      { text: staff, origin: "staff", language: null, missingRequested: true },
    ],
    [
      "only a stored disabled language",
      { de: "Burger DE" },
      "es",
      { text: staff, origin: "staff", language: null, missingRequested: true },
    ],
    [
      "regional request",
      { es: "Hamburguesa" },
      "es-MX",
      { text: "Hamburguesa", origin: "requested", language: "es", missingRequested: false },
    ],
    [
      "actual regional translation",
      { "es-ES": "Hamburguesa de España", "es-MX": "Hamburguesa de México" },
      "es-AR",
      {
        text: "Hamburguesa de España",
        origin: "requested",
        language: "es-ES",
        missingRequested: false,
      },
    ],
    [
      "disabled request",
      { de: "Burger DE", en: "House burger" },
      "de",
      { text: "House burger", origin: "default", language: "en", missingRequested: true },
    ],
    [
      "malformed request",
      { en: "House burger" },
      "invalid_tag",
      { text: "House burger", origin: "default", language: "en", missingRequested: true },
    ],
    [
      "equal values in different languages",
      { en: "Burger", es: "Burger" },
      "es",
      { text: "Burger", origin: "requested", language: "es", missingRequested: false },
    ],
    [
      "requested exact regional key before base",
      { es: "Hamburguesa", "es-MX": "Hamburguesa mexicana" },
      "es-MX",
      {
        text: "Hamburguesa mexicana",
        origin: "requested",
        language: "es-MX",
        missingRequested: false,
      },
    ],
  ] as const)("reports %s with its actual language", (_name, map, language, want) => {
    expect(resolveMenuText(map, staff, { kind: "customer", language }, config)).toEqual(want);
  });
  it("uses the variant's own staff fallback without borrowing its parent's customer name", () => {
    expect(resolveMenuText(null, "175 ml", { kind: "customer", language: "es" }, config)).toEqual({
      text: "175 ml",
      origin: "staff",
      language: null,
      missingRequested: true,
    });
  });
  it("keeps a description missing when its stored text is only in another language", () => {
    expect(
      resolveMenuText({ de: "Beschreibung" }, null, { kind: "customer", language: "es" }, config),
    ).toEqual({ text: "", origin: "missing", language: null, missingRequested: true });
    expect(resolveMenuText(null, null, { kind: "customer", language: "es" }, config)).toEqual({
      text: "",
      origin: "missing",
      language: null,
      missingRequested: true,
    });
  });
  it("uses staff names in Internal mode, but resolves descriptions and unit text in the configured default language", () => {
    expect(
      resolveMenuText(
        { en: "House burger", es: "Hamburguesa" },
        staff,
        { kind: "internal" },
        config,
      ),
    ).toEqual({ text: staff, origin: "staff", language: null, missingRequested: false });
    expect(
      resolveMenuText({ en: "Warm", es: "Caliente" }, null, { kind: "internal" }, config),
    ).toEqual({ text: "Warm", origin: "requested", language: "en", missingRequested: false });
    expect(resolveMenuText({ en: "kg", es: "kilo" }, null, { kind: "internal" }, config)).toEqual({
      text: "kg",
      origin: "requested",
      language: "en",
      missingRequested: false,
    });
  });
  it("does not relabel a regional default or mutate the supplied translation map", () => {
    const translations = { "en-GB": "House burger", es: " " };
    const before = structuredClone(translations);
    expect(
      resolveMenuText(translations, staff, { kind: "customer", language: "es" }, config),
    ).toEqual({
      text: "House burger",
      origin: "default",
      language: "en-GB",
      missingRequested: true,
    });
    expect(translations).toEqual(before);
  });
});

function offer(prices: string[] = []): FrozenOffer {
  const unit = {
    id: "each",
    name: { en: "Each" },
    abbreviation: { en: "ea" },
    precision: 0,
    hardwareUnit: null,
  };
  return {
    id: "mi-burger",
    productId: "burger",
    menuId: "lunch",
    menuName: "Lunch",
    name: staff,
    customerName: { en: "House burger" },
    kitchenName: "BURGER HOT",
    grossPrice: "99.00",
    unitPrice: "3.50",
    unit,
    vatClass: "general",
    allergens: null,
    diet: null,
    dietDerivation: null,
    dietOverride: null,
    dietaryDeclarations: [],
    image: null,
    description: null,
    placements: [[]],
    offeredModifiers: [],
    variants: prices.map((unitPrice, i) => ({
      id: `size-${i}`,
      name: `Staff size ${i}`,
      customerName: { en: `Customer size ${i}` },
      kitchenName: `KITCHEN SIZE ${i}`,
      unitPrice,
      menuPrice: i === 0 ? "999.00" : null,
      unit,
      pricingUnit: "each",
      vatClass: "general",
      allergens: null,
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      dietaryDeclarations: [],
      image: null,
    })),
  };
}

describe("menuPriceRange", () => {
  it("uses the frozen effective dish price when there are no variants", () => {
    expect(menuPriceRange(offer())).toEqual({ min: "3.50", max: "3.50" });
  });
  it("compares variant effective prices numerically and keeps zero, ignoring raw overrides", () => {
    const dish = offer(["10.00", "2.00", "0.00"]),
      before = structuredClone(dish);
    expect(menuPriceRange(dish)).toEqual({ min: "0.00", max: "10.00" });
    expect(dish).toEqual(before);
  });
  it("keeps one variant's effective price and preserves exact decimal spelling", () => {
    expect(menuPriceRange(offer(["2.10"]))).toEqual({ min: "2.10", max: "2.10" });
    expect(menuPriceRange(offer(["2.10", "2.09", "12.01"]))).toEqual({ min: "2.09", max: "12.01" });
  });
});
