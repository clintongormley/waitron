import {
  addDecimal,
  decimal,
  compareDecimal,
  divideDecimal,
  isZeroDecimal,
  multiplyDecimal,
  percentOf,
  subtractDecimal,
  negateDecimal,
  sumDecimals,
  toScale,
  MONEY_SCALE,
  localToday,
  rateOn,
  AppError,
  VAT_RATE_TABLE,
  type VatClass,
} from "@waitron/shared";
import type { DatedRate, Decimal, OptionSnapshot } from "@waitron/shared";
import type { RecordSaleLine } from "@waitron/core/src/sale-line.js";
import type { VatBreakdownLine } from "@waitron/fiscal/src/vat-breakdown.js";
import { assertQuantityPrecision } from "./unit-validation.js";

export interface UnitSnapshot {
  staffName: string;
  staffAbbreviation: string;
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
  /** The product's dated rates; absent, the rates of its `vatClass` in the shipped table. */
  vatRates?: readonly DatedRate[];
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
  /** Physical amount bought by one stored gross price; ordinary lines use one. */
  priceQuantity?: string;
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
export function baseFromGross(gross: Decimal, rate: Decimal): Decimal {
  const hundred = decimal("100");
  return divideDecimal(multiplyDecimal(gross, hundred), addDecimal(hundred, rate), MONEY_SCALE);
}

/**
 * Mirrors `@waitron/verifactu`'s copy of AEAT's sign check (`S1_CUOTA_REPERCUTIDA_SIGN`) without
 * the library's exemptions for corrections by differences and R2/R3 correctives (`validate.js:950`),
 * so it is not for correctives.
 */
export function vatSignRefused(base: Decimal, tax: Decimal, rate: Decimal): boolean {
  if (isZeroDecimal(tax)) return !isZeroDecimal(percentOf(base, rate));
  if (isZeroDecimal(base)) return true;
  return compareDecimal(base, ZERO) < 0 !== compareDecimal(tax, ZERO) < 0;
}

const ZERO = decimal("0");
const CENT = decimal("0.01");

/** The cent that moves from base to VAT so AEAT accepts the pair, signed like `gross`, or zero. */
function centToMove(base: Decimal, gross: Decimal, rate: Decimal): Decimal {
  const tax = subtractDecimal(gross, base);
  if (!isZeroDecimal(tax) || !vatSignRefused(base, tax, rate)) return ZERO;
  return compareDecimal(gross, ZERO) < 0 ? negateDecimal(CENT) : CENT;
}

/**
 * A gross amount's base and VAT at `rate`, by the difference method with the one-cent rule
 * (advances plan, D11).
 */
export function splitGross(gross: Decimal, rate: Decimal): { base: Decimal; tax: Decimal } {
  const exact = baseFromGross(gross, rate);
  const base = subtractDecimal(exact, centToMove(exact, gross, rate));
  return { base, tax: subtractDecimal(gross, base) };
}

/** A line priced before any VAT rate is taken: nothing on it depends on the date. */
export interface GrossLine extends Omit<
  RecordSaleLine,
  "unitPrice" | "vatRate" | "lineTotal" | "lineGross"
> {
  /** The rates this line is rated from, oldest first; `rateLines` refuses an empty list. */
  vatRates: readonly DatedRate[];
  /**
   * The GROSS price for one selected unit: the figure stored as
   * `working_order_lines.unit_price_gross` and read back by `grossLockedLines`, so the lock
   * round-trips exactly.
   */
  grossUnitPrice: Decimal;
  /**
   * The GROSS `unitPrice × quantity`. `RecordSaleLine.lineTotal` is the NET base, whereas the
   * working-order draft stores the gross the operator saw.
   */
  lineGross: Decimal;
}

export interface GrossLines {
  lines: GrossLine[];
  /** The sum of every line's `lineGross`, exactly. */
  total: Decimal;
}

/** A line as it is filed, with its gross always set. */
export interface PricedLine extends RecordSaleLine {
  lineGross: Decimal;
}

export interface PricedLines {
  lines: PricedLine[];
  total: Decimal;
  vatBreakdown: VatBreakdownLine[];
}

interface PricingRow {
  /** GROSS (VAT-inclusive) price per selected unit. */
  grossUnit: Decimal;
  quantity: string;
  priceQuantity?: string;
  vatRates: readonly DatedRate[];
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

// Keep gross arithmetic shared between entry points; do not reimplement it in a caller.
function grossRows(rows: readonly PricingRow[]): GrossLines {
  const lines = rows.map((row, i) => ({
    lineNo: i + 1,
    name: row.name,
    descriptions: row.descriptions,
    optionSnapshots: row.optionSnapshots ?? [],
    quantity: row.quantity,
    ...(row.priceQuantity === undefined ? {} : { priceQuantity: row.priceQuantity }),
    category: row.category,
    unitName: row.unitName,
    unitPrecision: row.unitPrecision,
    parentLineNo: row.parentLineNo ?? null,
    variantName: row.variantName ?? null,
    variantDescriptions: row.variantDescriptions ?? null,
    variantKitchenName: row.variantKitchenName ?? null,
    kitchenName: row.kitchenName ?? null,
    vatRates: row.vatRates,
    grossUnitPrice: toScale(row.grossUnit, MONEY_SCALE),
    lineGross:
      row.priceQuantity === undefined
        ? toScale(multiplyDecimal(row.grossUnit, decimal(row.quantity)), MONEY_SCALE)
        : divideDecimal(
            multiplyDecimal(row.grossUnit, decimal(row.quantity)),
            decimal(assertQuantityPrecision(row.priceQuantity, 3, { positive: true })),
            MONEY_SCALE,
          ),
  }));
  return { lines, total: sumDecimals(lines.map((line) => line.lineGross)) };
}

/**
 * Each line at the rate its own list gives on `on`, a local calendar date `YYYY-MM-DD`: its net
 * base and net unit, and the VAT breakdown. Every other field a gross line carries passes through,
 * except `vatRates` and `grossUnitPrice`, which are dropped. A line with an empty list is refused
 * `vat_rate.unavailable`.
 */
export function rateLines(gross: GrossLines, on: string): PricedLines {
  const groups = new Map<Decimal, { base: Decimal; gross: Decimal; indexes: number[] }>();
  const lines = gross.lines.map(({ vatRates, grossUnitPrice, ...line }, index) => {
    if (vatRates.length === 0) throw new AppError("vat_rate.unavailable", { lineNo: line.lineNo });
    const rate = rateOn(vatRates, on);
    const base = baseFromGross(line.lineGross, rate);
    const g = groups.get(rate);
    if (g === undefined) {
      groups.set(rate, { base, gross: line.lineGross, indexes: [index] });
    } else {
      g.base = addDecimal(g.base, base);
      g.gross = addDecimal(g.gross, line.lineGross);
      g.indexes.push(index);
    }
    return {
      ...line,
      unitPrice: baseFromGross(grossUnitPrice, rate), // net, informational
      vatRate: rate,
      lineTotal: base,
    };
  });
  const vatBreakdown: VatBreakdownLine[] = [...groups.entries()].map(([rate, g]) => {
    const cent = centToMove(g.base, g.gross, rate);
    if (!isZeroDecimal(cent)) {
      // The cent comes off the line furthest from zero in the cent's direction, the last on a
      // tie, so no 0.00 line crosses zero.
      let chosen = g.indexes[0]!;
      for (const index of g.indexes) {
        const reach = multiplyDecimal(lines[index]!.lineTotal, cent);
        if (compareDecimal(reach, multiplyDecimal(lines[chosen]!.lineTotal, cent)) >= 0) {
          chosen = index;
        }
      }
      const line = lines[chosen]!;
      lines[chosen] = { ...line, lineTotal: subtractDecimal(line.lineTotal, cent) };
    }
    const base = subtractDecimal(g.base, cent);
    // DIFFERENCE method: tax = gross − base
    return { rate, base, tax: subtractDecimal(g.gross, base) };
  });
  return { lines, total: gross.total, vatBreakdown };
}

/** The product's own rates, else its `vatClass`'s in the shipped table. */
function productRates(product: PriceableProduct): readonly DatedRate[] {
  return product.vatRates ?? VAT_RATE_TABLE[product.vatClass];
}

/** Prices a live basket: gross unit from the product's `unitPrice`, rate the product's on `on`, a
 * local calendar date `YYYY-MM-DD`. */
export function priceBasket(items: readonly BasketItem[], on: string = localToday()): PricedLines {
  return rateLines(
    grossRows(
      items.map((item) => {
        assertQuantityPrecision(item.quantity, item.product.unit.precision, { positive: true });
        return {
          grossUnit: decimal(item.product.unitPrice),
          quantity: item.quantity,
          vatRates: productRates(item.product),
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
    ),
    on,
  );
}

/** Stored working-order lines at their stored gross unit prices, each with the list at its index in
 * `rates`; without `rates` every line's list is empty, so the result totals but cannot be rated. */
export function grossLockedLines(
  lines: readonly LockedLine[],
  rates?: readonly (readonly DatedRate[])[],
): GrossLines {
  return grossRows(
    lines.map((line, i) => ({
      grossUnit: decimal(line.grossUnitPrice),
      quantity: line.quantity,
      priceQuantity: line.priceQuantity,
      vatRates: rates?.[i] ?? [],
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
  );
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
  /** The option's own rates when they OVERRIDE the dish's, or `null` to INHERIT the dish's. */
  vatRates: readonly DatedRate[] | null;
  /** Absent or null leaves the child without a kitchen name — a child never borrows the dish's,
   * which names a different thing. */
  kitchenName?: string | null;
  /** How many picks of THIS option per dish; ABSENT means 1. */
  quantity?: number;
  physicalQuantity?: string;
  priceQuantity?: string;
  unitName?: Record<string, string>;
  unitPrecision?: number;
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
 * A live basket's gross lines, where each dish may carry selected modifier options: each item
 * expands to a PARENT dish row followed by its CHILD option rows, IN ORDER, so each child's
 * `parentLineNo` names the dish above it. With every item's `options` empty, rated with
 * `rateLines`, this is line-for-line identical to `priceBasket`.
 */
export function grossBasketWithOptions(items: readonly BasketItemWithOptions[]): GrossLines {
  const rows: PricingRow[] = [];
  for (const item of items) {
    assertQuantityPrecision(item.quantity, item.product.unit.precision, { positive: true });
    // `grossRows` assigns `lineNo = i + 1` in push order.
    const parentLineNo = rows.length + 1;
    rows.push({
      grossUnit: decimal(item.product.unitPrice),
      quantity: item.quantity,
      vatRates: productRates(item.product),
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
        quantity: multiplyDecimal(
          decimal(item.quantity),
          decimal(opt.physicalQuantity ?? String(opt.quantity ?? 1)),
        ),
        ...(opt.priceQuantity === undefined ? {} : { priceQuantity: opt.priceQuantity }),
        vatRates: opt.vatRates ?? productRates(item.product),
        name: opt.name,
        descriptions: opt.descriptions,
        category: item.product.category,
        unitName: opt.unitName ?? null,
        unitPrecision: opt.unitPrecision ?? null,
        parentLineNo,
        kitchenName: opt.kitchenName ?? null,
      });
    }
  }
  return grossRows(rows);
}
