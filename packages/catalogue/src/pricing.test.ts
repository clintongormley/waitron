import { describe, expect, it } from "vitest";
import { addDecimal, compareDecimal, decimal, sumDecimals } from "@waitron/shared";
import { priceBasket, priceLockedLines, resolveVatRate } from "./pricing.js";
import type { LockedLine, PriceableProduct } from "./pricing.js";

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

describe("priceBasket — grossLineTotals (the working-order draft's customer-facing line total)", () => {
  it("exposes each line's GROSS unitPrice×quantity, parallel to lines and distinct from the net lineTotal", () => {
    const r = priceBasket([
      { product: each("1.50", "general"), quantity: "2" }, // 3.00 gross, 2.48 net base
      { product: weight("24.90", "reduced"), quantity: "0.320" }, // 7.97 gross, 7.25 net base
    ]);
    expect(r.grossLineTotals).toEqual([decimal("3.00"), decimal("7.97")]);
    // The gross line total is what the operator/customer sees (and what the working-order draft
    // stores in `working_order_lines.line_total`); the FILED fiscal line keeps the NET base.
    expect(r.lines[0]!.lineTotal).toBe(decimal("2.48"));
    expect(r.lines[1]!.lineTotal).toBe(decimal("7.25"));
  });

  it("sums to `total` EXACTLY — the invariant the held-orders list's sum(line_total) relies on", () => {
    const r = priceBasket([
      { product: weight("24.90", "reduced"), quantity: "0.320" },
      { product: each("8.50", "general"), quantity: "2" },
      { product: each("1.30", "super_reduced"), quantity: "5" },
    ]);
    expect(r.grossLineTotals).toHaveLength(r.lines.length);
    expect(sumDecimals(r.grossLineTotals)).toBe(r.total);
  });
});

// Pure arithmetic — no DB, RLS or concurrency involved, so these are plain unit tests (no
// PGlite/Testcontainers): `priceLockedLines` reprices from the STORED gross unit exactly as
// `priceBasket` prices from the live catalogue, and both funnel through the same `priceRows` core.
describe("priceLockedLines — files a locked line to the walk-up desglose", () => {
  it("prices locked lines to the difference-method desglose (base 4.55 / tax 0.95), like a walk-up", () => {
    // café×1 (gross 1.50) + agua×2 (gross unit 2.00, qty 2). Group base 4.55, gross 5.50, tax 0.95
    // (NOT round(4.55×21%)=0.96) — the exact property working-order.rls.test.ts:363-378 pins.
    const priced = priceLockedLines([
      {
        grossUnitPrice: "1.50",
        quantity: "1",
        vatRate: "21.00",
        descriptions: { es: "Café" },
        category: null,
      },
      {
        grossUnitPrice: "2.00",
        quantity: "2",
        vatRate: "21.00",
        descriptions: { es: "Agua" },
        category: null,
      },
    ]);
    expect(priced.total).toBe("5.50");
    expect(priced.vatBreakdown).toEqual([{ rate: "21.00", base: "4.55", tax: "0.95" }]);
    expect(priced.grossLineTotals).toEqual(["1.50", "4.00"]);
    // The per-line net base + net unit match what priceBasket produces for the same gross figures.
    expect(priced.lines[0]).toMatchObject({
      lineNo: 1,
      unitPrice: "1.24",
      vatRate: "21.00",
      lineTotal: "1.24",
    });
    expect(priced.lines[1]).toMatchObject({
      lineNo: 2,
      unitPrice: "1.65",
      vatRate: "21.00",
      lineTotal: "3.31",
    });
  });

  it("prices a weighed locked line from its stored gross unit, not line_total ÷ quantity", () => {
    // A weighed line where recovery by division would drift: gross unit 9.99/kg, qty 0.333 → gross
    // 3.33. priceLockedLines takes the STORED gross unit, so base/tax match the add-time desglose.
    const priced = priceLockedLines([
      {
        grossUnitPrice: "9.99",
        quantity: "0.333",
        vatRate: "10.00",
        descriptions: { es: "Jamón" },
        category: null,
      },
    ]);
    expect(priced.total).toBe("3.33");
    expect(priced.vatBreakdown).toEqual([{ rate: "10.00", base: "3.03", tax: "0.30" }]);
  });

  it("is byte-identical to re-pricing the same products — mixed rates and a weighed line", () => {
    // The whole point: filing a retrieved order from the stored lock produces the SAME
    // PricedLines/vatBreakdown as re-pricing the same product at the same gross would. A locked
    // line carries `grossUnitPrice`/`vatRate` where a basket carries `unitPrice`/`vatClass`; feed
    // both the same gross figures and the outputs must be deep-equal to the céntimo.
    const basket = [
      { product: each("8.50", "general"), quantity: "2" }, // 21% each
      { product: weight("24.90", "reduced"), quantity: "0.320" }, // 10% weighed
      { product: each("1.30", "super_reduced"), quantity: "5" }, // 4% each
    ];
    const locked: LockedLine[] = [
      {
        grossUnitPrice: "8.50",
        quantity: "2",
        vatRate: "21.00",
        descriptions: { en: "item" },
        category: null,
      },
      {
        grossUnitPrice: "24.90",
        quantity: "0.320",
        vatRate: "10.00",
        descriptions: { en: "sliced ham" },
        category: "Food",
      },
      {
        grossUnitPrice: "1.30",
        quantity: "5",
        vatRate: "4.00",
        descriptions: { en: "item" },
        category: null,
      },
    ];
    expect(priceLockedLines(locked)).toEqual(priceBasket(basket));
  });
});
