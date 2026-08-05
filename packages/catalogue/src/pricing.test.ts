import { describe, expect, it } from "vitest";
import { addDecimal, compareDecimal, decimal, sumDecimals } from "@waitron/shared";
import { priceBasket, resolveVatRate } from "./pricing.js";
import type { PriceableProduct } from "./pricing.js";

const each = (
  unitPrice: string,
  vatClass: PriceableProduct["vatClass"],
  category: string | null = null,
): PriceableProduct => ({
  descriptions: { en: "item" },
  pricingUnit: "each",
  unitPrice,
  vatClass,
  category,
});
const weight = (unitPrice: string, vatClass: PriceableProduct["vatClass"]): PriceableProduct => ({
  descriptions: { en: "sliced ham" },
  pricingUnit: "weight",
  unitPrice,
  vatClass,
  category: "Food",
});

describe("resolveVatRate", () => {
  it("maps each class to its rate", () => {
    expect(resolveVatRate("general")).toBe(decimal("21.00"));
    expect(resolveVatRate("reduced")).toBe(decimal("10.00"));
    expect(resolveVatRate("super_reduced")).toBe(decimal("4.00"));
    expect(resolveVatRate("zero")).toBe(decimal("0.00"));
  });
});

describe("priceBasket — difference method", () => {
  it("reverses a weighed gross line to base + tax that re-sum to the gross exactly", () => {
    const r = priceBasket([{ product: weight("24.90", "reduced"), quantity: "0.320" }]);
    expect(r.total).toBe(decimal("7.97"));
    expect(r.lines[0]!.lineTotal).toBe(decimal("7.25"));
    expect(r.lines[0]!.vatRate).toBe(decimal("10.00"));
    expect(r.lines[0]!.category).toBe("Food");
    expect(r.vatBreakdown).toHaveLength(1);
    expect(r.vatBreakdown[0]!.base).toBe(decimal("7.25"));
    expect(r.vatBreakdown[0]!.tax).toBe(decimal("0.72")); // gross - base, NOT base*rate
  });

  it("charges a round each-price exactly", () => {
    const r = priceBasket([{ product: each("8.50", "general"), quantity: "1" }]);
    expect(r.total).toBe(decimal("8.50"));
    expect(addDecimal(r.vatBreakdown[0]!.base, r.vatBreakdown[0]!.tax)).toBe(decimal("8.50"));
  });

  it("groups two lines at the same rate into one breakdown entry", () => {
    const r = priceBasket([
      { product: each("8.50", "general"), quantity: "1" },
      { product: each("2.00", "general"), quantity: "3" },
    ]);
    expect(r.vatBreakdown).toHaveLength(1);
    expect(r.total).toBe(decimal("14.50"));
  });

  it("splits distinct rates into distinct breakdown entries", () => {
    const r = priceBasket([
      { product: each("8.50", "general"), quantity: "1" },
      { product: weight("24.90", "reduced"), quantity: "0.320" },
    ]);
    expect(r.vatBreakdown).toHaveLength(2);
  });

  it("treats a zero-rate line as all base, no tax", () => {
    const r = priceBasket([{ product: each("5.00", "zero"), quantity: "1" }]);
    expect(r.vatBreakdown[0]!.base).toBe(decimal("5.00"));
    expect(r.vatBreakdown[0]!.tax).toBe(decimal("0.00"));
  });

  it("keeps total == Σ(base + tax) exactly (reconciliation invariant)", () => {
    const r = priceBasket([
      { product: weight("24.90", "reduced"), quantity: "0.320" },
      { product: each("8.50", "general"), quantity: "2" },
      { product: each("1.30", "super_reduced"), quantity: "5" },
    ]);
    const reconstructed = sumDecimals(r.vatBreakdown.flatMap((g) => [g.base, g.tax]));
    expect(compareDecimal(reconstructed, r.total)).toBe(0);
  });
});
