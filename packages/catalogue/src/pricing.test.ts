import { describe, expect, it } from "vitest";
import { addDecimal, compareDecimal, decimal, sumDecimals } from "@waitron/shared";
import {
  priceBasket,
  priceBasketWithOptions,
  priceLockedLines,
  resolveVatRate,
} from "./pricing.js";
import type {
  BasketItemWithOptions,
  LockedLine,
  PriceableProduct,
  SelectedOption,
} from "./pricing.js";

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
    // The per-UNIT gross (stored as `working_order_lines.unit_price_gross`) is the gross unit itself,
    // NOT multiplied by quantity — distinct from `grossLineTotals` for any quantity ≠ 1: café 1.50 (not
    // 3.00) and jamón 24.90/kg (not 7.97). `priceLockedLines` reads exactly these back to file the lock.
    expect(r.grossUnitPrices).toEqual([decimal("1.50"), decimal("24.90")]);
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

// A dish + its selected options price as a PARENT line followed by its CHILD lines, all flowing
// through the SAME `priceRows` arithmetic core — a child is just another priced row (grossUnit = the
// option's price delta, rate = its vatClass override or the dish's rate, quantity = the DISH's
// quantity, descriptions = the option's name, category = the parent's).
describe("priceBasketWithOptions — parent + child priced lines", () => {
  const opt = (
    priceDelta: string,
    vatClass: SelectedOption["vatClass"],
    name: Record<string, string> = { es: "opción" },
  ): SelectedOption => ({ name, priceDelta, vatClass });

  it("prices a dish with options as parent + child lines (brief verbatim example)", () => {
    const priced = priceBasketWithOptions([
      {
        product: {
          descriptions: { es: "Café" },
          pricingUnit: "each",
          unitPrice: "2.50",
          vatClass: "reduced",
          category: "Drinks",
        },
        quantity: "1",
        options: [
          { name: { es: "Grande" }, priceDelta: "0.50", vatClass: null },
          { name: { es: "Leche avena" }, priceDelta: "0.40", vatClass: null },
        ],
      },
    ]);
    expect(priced.lines).toHaveLength(3);
    expect(priced.lines[1]!.parentLineNo).toBe(1);
    expect(priced.total.toString()).toBe("3.40");
  });

  it("emits THREE lines; both children carry the dish's lineNo as parentLineNo, and a free option bases to 0", () => {
    const priced = priceBasketWithOptions([
      {
        product: each("2.50", "reduced", "Drinks"),
        quantity: "1",
        options: [opt("0.00", null, { es: "Sin azúcar" }), opt("0.50", null, { es: "Grande" })],
      },
    ]);
    expect(priced.lines).toHaveLength(3);
    // The parent dish is line 1; both children point back to it.
    expect(priced.lines[0]!.lineNo).toBe(1);
    expect(priced.lines[0]!.parentLineNo).toBe(null);
    expect(priced.lines[1]!.parentLineNo).toBe(priced.lines[0]!.lineNo);
    expect(priced.lines[2]!.parentLineNo).toBe(priced.lines[0]!.lineNo);
    // The free option contributes nothing: its net base (and its gross line total) are 0.
    expect(priced.lines[1]!.lineTotal).toBe(decimal("0.00"));
    expect(priced.grossLineTotals[1]).toBe(decimal("0.00"));
    // A child inherits the parent's snapshotted analytics category.
    expect(priced.lines[1]!.category).toBe("Drinks");
    expect(priced.total).toBe(decimal("3.00"));
  });

  it("propagates the dish quantity onto every child (2× dish, one +1.00 option → child qty 2, gross 2.00)", () => {
    const priced = priceBasketWithOptions([
      {
        product: each("5.00", "general"),
        quantity: "2",
        options: [opt("1.00", null)],
      },
    ]);
    expect(priced.lines[1]!.quantity).toBe("2");
    expect(priced.grossLineTotals[1]).toBe(decimal("2.00")); // 1.00 × 2
    expect(priced.total).toBe(decimal("12.00")); // 5.00×2 + 1.00×2
  });

  it("mixes VAT rates: a general-rated option on a reduced-rated dish yields a two-rate breakdown", () => {
    const priced = priceBasketWithOptions([
      {
        product: each("10.00", "reduced"),
        quantity: "1",
        options: [opt("2.00", "general")],
      },
    ]);
    // Parent (10%) is inserted before child (21%), so the breakdown lists 10.00 then 21.00.
    expect(priced.vatBreakdown).toEqual([
      { rate: decimal("10.00"), base: decimal("9.09"), tax: decimal("0.91") },
      { rate: decimal("21.00"), base: decimal("1.65"), tax: decimal("0.35") },
    ]);
    expect(priced.total).toBe(decimal("12.00"));
  });

  it("inherits the dish's rate when the option's vatClass is null", () => {
    const priced = priceBasketWithOptions([
      {
        product: each("5.00", "general"),
        quantity: "1",
        options: [opt("1.00", null)],
      },
    ]);
    expect(priced.lines[1]!.vatRate).toBe(decimal("21.00"));
    expect(priced.vatBreakdown).toHaveLength(1); // dish + option share the 21% group
  });

  it("prices an option taken ×N per dish (dish ×3, option ×2 → child qty 6, gross = priceDelta × 6)", () => {
    // Per-option quantity: the child line is priced at dishQuantity × the option's own count. A
    // non-trivial priceDelta (1.50) makes the total unambiguous — 1.50 × 6 = 9.00, which no other
    // multiplication of the operands reaches.
    const priced = priceBasketWithOptions([
      {
        product: each("4.00", "general"),
        quantity: "3",
        options: [{ name: { es: "Extra shot" }, priceDelta: "1.50", vatClass: null, quantity: 2 }],
      },
    ]);
    // The child carries dish×option = 3 × 2 = 6, priced at 1.50 each → 9.00 gross.
    expect(priced.lines[1]!.quantity).toBe("6");
    expect(priced.grossLineTotals[1]).toBe(decimal("9.00"));
    // The PARENT dish is untouched by the option count: still qty 3 at 4.00 → 12.00 gross.
    expect(priced.lines[0]!.quantity).toBe("3");
    expect(priced.grossLineTotals[0]).toBe(decimal("12.00"));
    expect(priced.total).toBe(decimal("21.00")); // 4.00×3 + 1.50×6
  });

  it("treats an OMITTED option quantity exactly as quantity 1 (byte-identical path)", () => {
    const build = (quantity?: number): BasketItemWithOptions[] => [
      {
        product: each("5.00", "general"),
        quantity: "2",
        options: [
          {
            name: { es: "Grande" },
            priceDelta: "1.30",
            vatClass: null,
            ...(quantity !== undefined ? { quantity } : {}),
          },
        ],
      },
    ];
    // An option with no `quantity` field must produce the identical priced result to one with
    // `quantity: 1` — the no-per-option-count path is unchanged from before this feature.
    expect(priceBasketWithOptions(build())).toEqual(priceBasketWithOptions(build(1)));
  });

  it("with EMPTY options is line-for-line identical to priceBasket", () => {
    const items: BasketItemWithOptions[] = [
      { product: each("8.50", "general"), quantity: "2", options: [] },
      { product: weight("24.90", "reduced"), quantity: "0.320", options: [] },
      { product: each("1.30", "super_reduced"), quantity: "5", options: [] },
    ];
    expect(priceBasketWithOptions(items)).toEqual(
      priceBasket(items.map(({ product, quantity }) => ({ product, quantity }))),
    );
  });
});

// Pure arithmetic — no DB, RLS or concurrency involved, so these are plain unit tests (no
// PGlite/Testcontainers): `priceLockedLines` reprices from the STORED gross unit exactly as
// `priceBasket` prices from the live catalogue, and both funnel through the same `priceRows` core.
describe("priceLockedLines — files a locked line to the walk-up VAT breakdown", () => {
  it("prices locked lines to the difference-method VAT breakdown (base 4.55 / tax 0.95), like a walk-up", () => {
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
