import {
  addDecimal,
  decimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
  sumDecimals,
  toScale,
  MONEY_SCALE,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { RecordSaleLine } from "@waitron/core";
import type { VatBreakdownLine } from "@waitron/fiscal";

export type PricingUnit = "each" | "weight";
export type VatClass = "general" | "reduced" | "super_reduced" | "zero";

export interface PriceableProduct {
  descriptions: Record<string, string>;
  pricingUnit: PricingUnit;
  /** GROSS (VAT-inclusive): per item for `each`, per kg for `weight`. */
  unitPrice: string;
  vatClass: VatClass;
  /** Snapshotted analytics label, copied onto the sale line. */
  category: string | null;
}

export interface BasketItem {
  product: PriceableProduct;
  /** A count for `each`, a measured kg weight (e.g. "0.320") for `weight`. */
  quantity: string;
}

// The standing Spanish VAT set. RECEIPT (Step 6): the four rates below were confirmed on 2026-08-05
// against the primary Spanish tax-agency source (AEAT), page path
// /Sede/iva/calculo-iva-repercutido-clientes/tipos-impositivos-iva.html on sede.agenciatributaria.gob.es
// (host omitted from the URL literal to keep this generic package English-only; page last updated
// 2026-06-02). The page gives a general rate of 21, reduced rates of 10 and 4, and a 0 rate for
// certain operations — so general 21, reduced 10, super_reduced 4, zero 0. The resolver's shape is
// fixed regardless of the values; only the numbers are the primary-source question.
const RATES: Record<VatClass, string> = {
  general: "21.00",
  reduced: "10.00",
  super_reduced: "4.00",
  zero: "0.00",
};

export function resolveVatRate(vatClass: VatClass): Decimal {
  return decimal(RATES[vatClass]);
}

// base = gross ÷ (1 + rate/100) = gross × 100 ÷ (100 + rate). One rounded division; no gross→base
// helper exists in @waitron/shared.
function baseFromGross(gross: Decimal, rate: Decimal): Decimal {
  const hundred = decimal("100");
  return divideDecimal(multiplyDecimal(gross, hundred), addDecimal(hundred, rate), MONEY_SCALE);
}

export function priceBasket(items: readonly BasketItem[]): {
  lines: RecordSaleLine[];
  total: Decimal;
  vatBreakdown: VatBreakdownLine[];
} {
  const lines: RecordSaleLine[] = [];
  const groups = new Map<Decimal, { base: Decimal; gross: Decimal }>();

  items.forEach((item, i) => {
    const rate = resolveVatRate(item.product.vatClass);
    // `unitPrice` and `quantity` are plain `string` on the input types, so they are wrapped with
    // `decimal()` (which validates the literal) before reaching the branded-`Decimal` helpers — the
    // brief's snippet passed them raw, which does not typecheck against the `Decimal` brand.
    const gross = toScale(
      multiplyDecimal(decimal(item.product.unitPrice), decimal(item.quantity)),
      MONEY_SCALE,
    );
    const base = baseFromGross(gross, rate);
    const netUnit = baseFromGross(toScale(decimal(item.product.unitPrice), MONEY_SCALE), rate);
    lines.push({
      lineNo: i + 1,
      descriptions: item.product.descriptions,
      quantity: item.quantity,
      unitPrice: netUnit, // net, informational (record-sale.ts stores it verbatim)
      vatRate: rate,
      lineTotal: base,
      category: item.product.category,
    });
    const g = groups.get(rate);
    groups.set(
      rate,
      g === undefined
        ? { base, gross }
        : { base: addDecimal(g.base, base), gross: addDecimal(g.gross, gross) },
    );
  });

  const vatBreakdown: VatBreakdownLine[] = [...groups.entries()].map(([rate, g]) => ({
    rate,
    base: g.base,
    tax: subtractDecimal(g.gross, g.base), // DIFFERENCE method: tax = gross − base
  }));
  const total = sumDecimals([...groups.values()].map((g) => g.gross));
  return { lines, total, vatBreakdown };
}
