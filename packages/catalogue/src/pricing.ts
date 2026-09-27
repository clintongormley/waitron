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
import type { Decimal, OptionSnapshot } from "@waitron/shared";
import type { RecordSaleLine } from "@waitron/core/src/sale-line.js";
import type { VatBreakdownLine } from "@waitron/fiscal/src/vat-breakdown.js";
import { assertQuantityPrecision } from "./unit-validation.js";
import { localToday, vatRateOn, type VatClass } from "./vat-rates.js";

export { VAT_CLASSES, type VatClass } from "./vat-rates.js";
export type PricingUnit = "each" | "weight";

export interface UnitSnapshot {
  name: Record<string, string>;
  precision: number;
  abbreviation: Record<string, string>;
}

export interface PriceableProduct {
  /** The product's staff-facing name, frozen onto the sale line's `name`. */
  name: string;
  /** locale -> customer-facing text, already resolved by `customerPresentationText`. */
  descriptions: Record<string, string>;
  unit: UnitSnapshot;
  /** GROSS (VAT-inclusive): per selected unit. */
  unitPrice: string;
  vatClass: VatClass;
  /** Snapshotted analytics label, copied onto the sale line. */
  category: string | null;
  /** The variant's staff-facing name; `null` when no variant is selected. */
  variantName?: string | null;
  /** The variant's customer-facing text, locale -> text; `null` when no variant is selected. */
  variantDescriptions?: Record<string, string> | null;
  /** The variant's kitchen-facing name; `null` when no variant is selected. */
  variantKitchenName?: string | null;
  kitchenName?: string | null;
}

export interface BasketItem {
  product: PriceableProduct;
  /** A positive decimal literal accepted by the selected unit's precision. */
  quantity: string;
}

/**
 * A stored working-order line to price. Deliberately the STORED gross unit, never
 * `line_total ÷ quantity`, which drifts for a fractional line.
 */
export interface LockedLine {
  /** The stored `working_order_lines.unit_price_gross` — GROSS, per selected unit. */
  grossUnitPrice: string;
  /** The stored quantity, validated against the snapshotted unit precision. */
  quantity: string;
  vatClass: VatClass;
  name: string;
  /** locale -> customer-facing text. */
  descriptions: Record<string, string>;
  category: string | null;
  /** Unit snapshot from line-add time; null only for a modifier child. */
  unitName?: Record<string, string> | null;
  unitPrecision?: number | null;
  /** The `lineNo` of this row's PARENT dish line when this is a child modifier line, else
   * `null`/absent. Presentation metadata, never part of the hash. */
  parentLineNo?: number | null;
  optionSnapshots?: OptionSnapshot[];
  variantName?: string | null;
  variantDescriptions?: Record<string, string> | null;
  variantKitchenName?: string | null;
  kitchenName?: string | null;
}

// base = gross ÷ (1 + rate/100) = gross × 100 ÷ (100 + rate). One rounded division.
function baseFromGross(gross: Decimal, rate: Decimal): Decimal {
  const hundred = decimal("100");
  return divideDecimal(multiplyDecimal(gross, hundred), addDecimal(hundred, rate), MONEY_SCALE);
}

export interface PricedLines {
  lines: RecordSaleLine[];
  /**
   * The GROSS `unitPrice × quantity` per line, in `lines` order; their sum equals `total` EXACTLY.
   * Exposed because `RecordSaleLine.lineTotal` is the NET base, whereas the working-order draft
   * stores the gross the operator saw.
   */
  grossLineTotals: Decimal[];
  /**
   * The GROSS price for one selected unit per line, in `lines` order: the figure stored as
   * `working_order_lines.unit_price_gross` and read back by `priceLockedLines`, so the lock
   * round-trips exactly.
   */
  grossUnitPrices: Decimal[];
  /** The VAT class each line was priced at, in `lines` order, so {@link repriceOn} can take the
   * rate again on another date. */
  vatClasses: VatClass[];
  total: Decimal;
  vatBreakdown: VatBreakdownLine[];
}

interface PricingRow {
  /** GROSS (VAT-inclusive) price per selected unit. */
  grossUnit: Decimal;
  quantity: string;
  vatClass: VatClass;
  name: string;
  descriptions: Record<string, string>;
  category: string | null;
  unitName: Record<string, string> | null;
  unitPrecision: number | null;
  parentLineNo?: number | null;
  optionSnapshots?: OptionSnapshot[];
  variantName?: string | null;
  variantDescriptions?: Record<string, string> | null;
  variantKitchenName?: string | null;
  kitchenName?: string | null;
}

// THE ONE arithmetic core: every entry point funnels through here, so a locked-line filing cannot
// diverge from a walk-up's to the céntimo. Do not reimplement this arithmetic in a caller.
function priceRows(rows: readonly PricingRow[], on: string): PricedLines {
  const lines: RecordSaleLine[] = [];
  const grossLineTotals: Decimal[] = [];
  const grossUnitPrices: Decimal[] = [];
  const groups = new Map<Decimal, { base: Decimal; gross: Decimal }>();

  const rates = new Map<VatClass, Decimal>();
  const rateOf = (vatClass: VatClass): Decimal => {
    const known = rates.get(vatClass);
    if (known !== undefined) return known;
    const rate = vatRateOn(vatClass, on);
    rates.set(vatClass, rate);
    return rate;
  };

  rows.forEach((row, i) => {
    const rate = rateOf(row.vatClass);
    const grossUnit = toScale(row.grossUnit, MONEY_SCALE);
    const gross = toScale(multiplyDecimal(row.grossUnit, decimal(row.quantity)), MONEY_SCALE);
    const base = baseFromGross(gross, rate);
    const netUnit = baseFromGross(grossUnit, rate);
    lines.push({
      lineNo: i + 1,
      name: row.name,
      descriptions: row.descriptions,
      optionSnapshots: row.optionSnapshots ?? [],
      quantity: row.quantity,
      unitPrice: netUnit, // net, informational
      vatRate: rate,
      lineTotal: base,
      category: row.category,
      unitName: row.unitName,
      unitPrecision: row.unitPrecision,
      parentLineNo: row.parentLineNo ?? null,
      variantName: row.variantName ?? null,
      variantDescriptions: row.variantDescriptions ?? null,
      variantKitchenName: row.variantKitchenName ?? null,
      kitchenName: row.kitchenName ?? null,
      lineGross: gross,
    });
    grossLineTotals.push(gross);
    grossUnitPrices.push(grossUnit);
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
  return {
    lines,
    grossLineTotals,
    grossUnitPrices,
    vatClasses: rows.map((row) => row.vatClass),
    total,
    vatBreakdown,
  };
}

/** Prices a live basket: gross unit from the product's `unitPrice`, rate its `vatClass`'s on `on`, a
 * local calendar date `YYYY-MM-DD`. */
// The default serves previews and callers that keep only gross amounts; a filing path names its date.
export function priceBasket(items: readonly BasketItem[], on: string = localToday()): PricedLines {
  return priceRows(
    items.map((item) => {
      assertQuantityPrecision(item.quantity, item.product.unit.precision, { positive: true });
      return {
        grossUnit: decimal(item.product.unitPrice),
        quantity: item.quantity,
        vatClass: item.product.vatClass,
        name: item.product.name,
        descriptions: item.product.descriptions,
        category: item.product.category,
        // The printed label is the unit's abbreviation, frozen here onto working_order_lines.unit_name.
        unitName: item.product.unit.abbreviation,
        unitPrecision: item.product.unit.precision,
        variantName: item.product.variantName ?? null,
        variantDescriptions: item.product.variantDescriptions ?? null,
        variantKitchenName: item.product.variantKitchenName ?? null,
        kitchenName: item.product.kitchenName ?? null,
      };
    }),
    on,
  );
}

/** Prices stored working-order lines from their stored gross unit prices, each class at its rate on
 * `on`. */
export function priceLockedLines(lines: readonly LockedLine[], on: string): PricedLines {
  return priceRows(
    lines.map((line) => ({
      grossUnit: decimal(line.grossUnitPrice),
      quantity: line.quantity,
      vatClass: line.vatClass,
      name: line.name,
      descriptions: line.descriptions,
      optionSnapshots: line.optionSnapshots,
      category: line.category,
      unitName: line.unitName ?? null,
      unitPrecision: line.unitPrecision ?? null,
      parentLineNo: line.parentLineNo ?? null,
      variantName: line.variantName ?? null,
      variantDescriptions: line.variantDescriptions ?? null,
      variantKitchenName: line.variantKitchenName ?? null,
      kitchenName: line.kitchenName ?? null,
    })),
    on,
  );
}

/**
 * The same lines, each class at its rate on `on`: every gross is kept, and so is any field a caller
 * added to a line.
 */
export function repriceOn(priced: PricedLines, on: string): PricedLines {
  const again = priceRows(
    priced.lines.map((line, i) => ({
      grossUnit: priced.grossUnitPrices[i]!,
      quantity: line.quantity,
      vatClass: priced.vatClasses[i]!,
      name: line.name,
      descriptions: line.descriptions,
      optionSnapshots: line.optionSnapshots,
      category: line.category ?? null,
      unitName: line.unitName ?? null,
      unitPrecision: line.unitPrecision ?? null,
      parentLineNo: line.parentLineNo,
      variantName: line.variantName,
      variantDescriptions: line.variantDescriptions,
      variantKitchenName: line.variantKitchenName,
      kitchenName: line.kitchenName,
    })),
    on,
  );
  return {
    ...priced,
    ...again,
    lines: priced.lines.map((line, i) => ({ ...line, ...again.lines[i]! })),
  };
}

/** A modifier chosen on a dish. */
export interface SelectedOption {
  /** The child line's `name`, already resolved to one language by the CALLER: pricing holds no
   * default language to choose one by. */
  name: string;
  descriptions: Record<string, string>;
  /** GROSS price this option adds to the dish. `"0.00"` for a free option, which still contributes
   * a zero-base child line. */
  priceDelta: string;
  /** The option's own VAT class when it OVERRIDES the dish's, or `null` to INHERIT the dish's. */
  vatClass: VatClass | null;
  /** Absent or null leaves the child without a kitchen name — a child never borrows the dish's,
   * which names a different thing. */
  kitchenName?: string | null;
  /** How many of THIS option, per dish; ABSENT means 1. The child is priced at
   * `dishQuantity × quantity`, so a dish ×3 carrying an option ×2 prices the option 6 times. */
  quantity?: number;
}

/** A basket line that carries the dish plus the modifiers selected on it. */
export interface BasketItemWithOptions {
  product: PriceableProduct;
  /** The dish quantity; every child option line follows it. */
  quantity: string;
  options: SelectedOption[];
  optionSnapshots?: OptionSnapshot[];
}

/**
 * Prices a live basket where each dish may carry selected modifier options: each item expands to a
 * PARENT dish row followed by its CHILD option rows, IN ORDER, so each child's `parentLineNo` names
 * the dish above it. With every item's `options` empty this is line-for-line identical to
 * `priceBasket`.
 */
export function priceBasketWithOptions(
  items: readonly BasketItemWithOptions[],
  on: string,
): PricedLines {
  const rows: PricingRow[] = [];
  for (const item of items) {
    assertQuantityPrecision(item.quantity, item.product.unit.precision, { positive: true });
    // `priceRows` assigns `lineNo = i + 1` in push order.
    const parentLineNo = rows.length + 1;
    rows.push({
      grossUnit: decimal(item.product.unitPrice),
      quantity: item.quantity,
      vatClass: item.product.vatClass,
      name: item.product.name,
      descriptions: item.product.descriptions,
      category: item.product.category,
      // The printed label is the unit's abbreviation, frozen here onto working_order_lines.unit_name.
      unitName: item.product.unit.abbreviation,
      unitPrecision: item.product.unit.precision,
      parentLineNo: null,
      optionSnapshots: item.optionSnapshots,
      variantName: item.product.variantName ?? null,
      variantDescriptions: item.product.variantDescriptions ?? null,
      variantKitchenName: item.product.variantKitchenName ?? null,
      kitchenName: item.product.kitchenName ?? null,
    });
    for (const opt of item.options) {
      rows.push({
        grossUnit: decimal(opt.priceDelta),
        quantity: multiplyDecimal(decimal(item.quantity), decimal(String(opt.quantity ?? 1))),
        vatClass: opt.vatClass ?? item.product.vatClass,
        name: opt.name,
        descriptions: opt.descriptions,
        category: item.product.category,
        unitName: null,
        unitPrecision: null,
        parentLineNo,
        kitchenName: opt.kitchenName ?? null,
      });
    }
  }
  return priceRows(rows, on);
}
