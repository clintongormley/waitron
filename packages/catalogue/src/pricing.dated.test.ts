import { describe, expect, it, vi } from "vitest";
import { decimal } from "@waitron/shared";
import {
  priceBasket,
  priceBasketWithOptions,
  priceLockedLines,
  repriceOn,
  type PriceableProduct,
} from "./pricing.js";

// The shipped table with a general rate of 23.00 from 2027-01-01, standing for a release that ships
// a future-dated rate.
vi.mock("./vat-rates.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./vat-rates.js")>();
  const table = {
    ...original.VAT_RATE_TABLE,
    general: [
      { from: null, rate: "21.00" },
      { from: "2027-01-01", rate: "23.00" },
    ],
  };
  return {
    ...original,
    VAT_RATE_TABLE: table,
    vatRateOn: (...[vatClass, date, given]: Parameters<typeof original.vatRateOn>) =>
      original.vatRateOn(vatClass, date, given ?? table),
  };
});

const BEFORE = "2026-12-31";
const FROM = "2027-01-01";

const each = (unitPrice: string, vatClass: PriceableProduct["vatClass"]): PriceableProduct => ({
  name: "item",
  descriptions: { en: "item" },
  unit: { name: { en: "each" }, precision: 0, abbreviation: { en: "ea" } },
  unitPrice,
  vatClass,
  category: null,
});

describe("pricing takes each rate on the date it is given", () => {
  it("priceBasket: the day before the change prices the old rate, the day itself the new one", () => {
    const basket = [{ product: each("12.30", "general"), quantity: "1" }];

    expect(priceBasket(basket, BEFORE).vatBreakdown).toEqual([
      { rate: decimal("21.00"), base: decimal("10.17"), tax: decimal("2.13") },
    ]);
    expect(priceBasket(basket, FROM).vatBreakdown).toEqual([
      { rate: decimal("23.00"), base: decimal("10.00"), tax: decimal("2.30") },
    ]);
  });

  it("priceBasketWithOptions: a dish, an inheriting option and an option with its own class each take the date's rate", () => {
    const basket = [
      {
        product: each("12.30", "general"),
        quantity: "1",
        options: [
          { name: "Hielo", descriptions: { es: "Hielo" }, priceDelta: "1.23", vatClass: null },
          { name: "Tapa", descriptions: { es: "Tapa" }, priceDelta: "1.10", vatClass: "reduced" },
        ] as const,
      },
    ];
    const rates = (on: string) =>
      priceBasketWithOptions(
        basket.map((item) => ({ ...item, options: [...item.options] })),
        on,
      ).lines.map((line) => line.vatRate);

    expect(rates(BEFORE)).toEqual([decimal("21.00"), decimal("21.00"), decimal("10.00")]);
    expect(rates(FROM)).toEqual([decimal("23.00"), decimal("23.00"), decimal("10.00")]);
  });

  it("priceLockedLines: a stored line's class takes the date's rate at the same gross", () => {
    const line = {
      grossUnitPrice: "12.30",
      quantity: "1",
      vatClass: "general" as const,
      name: "item",
      descriptions: { en: "item" },
      category: null,
    };

    const before = priceLockedLines([line], BEFORE);
    const from = priceLockedLines([line], FROM);

    expect(before.lines[0]).toMatchObject({ vatRate: "21.00", lineTotal: "10.17" });
    expect(from.lines[0]).toMatchObject({ vatRate: "23.00", lineTotal: "10.00" });
    expect(from.total).toBe(before.total);
  });

  it("repriceOn: re-rates priced lines at another date, keeping every gross and the fields a caller added", () => {
    const priced = priceBasket([{ product: each("12.30", "general"), quantity: "2" }], BEFORE);
    const tagged = { ...priced, lines: priced.lines.map((l) => ({ ...l, productId: "p-1" })) };

    const again = repriceOn(tagged, FROM);

    expect(again.lines[0]).toMatchObject({
      productId: "p-1",
      vatRate: "23.00",
      lineTotal: "20.00",
      unitPrice: "10.00",
      lineGross: "24.60",
    });
    expect(again.vatBreakdown).toEqual([{ rate: "23.00", base: "20.00", tax: "4.60" }]);
    expect(again.total).toBe(priced.total);
    expect(again.grossLineTotals).toEqual(priced.grossLineTotals);
    expect(repriceOn(tagged, BEFORE)).toEqual(tagged);
  });
});
