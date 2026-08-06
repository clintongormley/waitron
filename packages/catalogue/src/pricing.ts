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

/**
 * A working-order line filed from its stored LOCK, not the live catalogue. Task 1 froze the gross
 * unit price and the rate onto `working_order_lines` at add-time; `priceLockedLines` reprices from
 * exactly those columns, so a retrieved/parked order files the same figures whether it went
 * through re-price or file-from-lock. Deliberately the STORED gross unit and rate, never
 * `line_total ÷ quantity` — recovering a weighed line by division drifts off the add-time desglose.
 */
export interface LockedLine {
  /** The stored `working_order_lines.unit_price_gross` — GROSS (VAT-inclusive), per item or per kg. */
  grossUnitPrice: string;
  /** A count for `each`, a measured kg weight for `weight` — the stored `working_order_lines.quantity`. */
  quantity: string;
  /** The stored `working_order_lines.vat_rate`, a percentage literal e.g. "21.00" meaning 21%. */
  vatRate: string;
  /** locale -> text, snapshotted at add-time; copied onto the sale line verbatim. */
  descriptions: Record<string, string>;
  /** Snapshotted analytics label, copied onto the sale line; `null` when absent. */
  category: string | null;
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

export interface PricedLines {
  lines: RecordSaleLine[];
  /**
   * The GROSS (VAT-inclusive) `unitPrice × quantity` per line, at MONEY_SCALE, in `lines` order —
   * the customer-facing line total. Their sum equals `total` EXACTLY (both are the sum of the same
   * per-line gross values). Exposed alongside `lines` because `RecordSaleLine.lineTotal` is the NET
   * base the fiscal record needs, whereas the mutable working-order DRAFT
   * (`working_order_lines.line_total`) stores the gross the operator saw — a deliberate divergence.
   */
  grossLineTotals: Decimal[];
  total: Decimal;
  vatBreakdown: VatBreakdownLine[];
}

/** The per-item inputs the arithmetic core needs, sourced identically whether they come from a live
 * catalogue product or a stored lock. */
interface PricingRow {
  /** GROSS (VAT-inclusive) unit price — per item for `each`, per kg for `weight`. */
  grossUnit: Decimal;
  quantity: string;
  /** The VAT rate as a percentage literal Decimal, e.g. "21.00". */
  rate: Decimal;
  descriptions: Record<string, string>;
  category: string | null;
}

// THE ONE arithmetic core. `priceBasket` (live catalogue) and `priceLockedLines` (stored lock) both
// funnel through here, so a locked-line filing can never diverge from a walk-up's to the céntimo —
// the two entry points differ ONLY in how they source the gross unit and the rate (a product's
// `unitPrice`/`vatClass` vs a stored `unit_price_gross`/`vat_rate`). Keep them sharing this; do not
// reimplement the per-item gross/base/netUnit/tax = gross − base arithmetic in either caller.
function priceRows(rows: readonly PricingRow[]): PricedLines {
  const lines: RecordSaleLine[] = [];
  const grossLineTotals: Decimal[] = [];
  const groups = new Map<Decimal, { base: Decimal; gross: Decimal }>();

  rows.forEach((row, i) => {
    // `quantity` is a plain `string`, so it is wrapped with `decimal()` (which validates the
    // literal) before reaching the branded-`Decimal` helpers; `grossUnit` and `rate` arrive already
    // branded from the callers, which is where each is validated.
    const gross = toScale(multiplyDecimal(row.grossUnit, decimal(row.quantity)), MONEY_SCALE);
    const base = baseFromGross(gross, row.rate);
    const netUnit = baseFromGross(toScale(row.grossUnit, MONEY_SCALE), row.rate);
    lines.push({
      lineNo: i + 1,
      descriptions: row.descriptions,
      quantity: row.quantity,
      unitPrice: netUnit, // net, informational (record-sale.ts stores it verbatim)
      vatRate: row.rate,
      lineTotal: base,
      category: row.category,
    });
    grossLineTotals.push(gross); // parallel to `lines`; the customer-facing gross of this same line
    const g = groups.get(row.rate);
    groups.set(
      row.rate,
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
  // Sum of every per-line gross — identical value to `sum(grossLineTotals)` (the group sums just
  // partition the same addends by rate), so the held-orders list's `sum(line_total)` matches this total.
  const total = sumDecimals([...groups.values()].map((g) => g.gross));
  return { lines, grossLineTotals, total, vatBreakdown };
}

/** Prices a live basket: gross unit from the product's `unitPrice`, rate resolved from its `vatClass`. */
export function priceBasket(items: readonly BasketItem[]): PricedLines {
  return priceRows(
    items.map((item) => ({
      // `unitPrice` is a plain `string` on `PriceableProduct`, so `decimal()` validates it here.
      grossUnit: decimal(item.product.unitPrice),
      quantity: item.quantity,
      rate: resolveVatRate(item.product.vatClass),
      descriptions: item.product.descriptions,
      category: item.product.category,
    })),
  );
}

/**
 * Reprices a retrieved/parked working order from its STORED lock rather than the live catalogue:
 * gross unit from `unit_price_gross`, rate from the stored `vat_rate`. Shares `priceRows` with
 * `priceBasket`, so the filed `lines`/`grossLineTotals`/`total`/`vatBreakdown` are byte-identical to
 * re-pricing the same product at the same gross — a parked order files the same figures either way.
 */
export function priceLockedLines(lines: readonly LockedLine[]): PricedLines {
  return priceRows(
    lines.map((line) => ({
      // `grossUnitPrice` and `vatRate` are plain `string` on `LockedLine`; `decimal()` validates each.
      grossUnit: decimal(line.grossUnitPrice),
      quantity: line.quantity,
      rate: decimal(line.vatRate),
      descriptions: line.descriptions,
      category: line.category,
    })),
  );
}
