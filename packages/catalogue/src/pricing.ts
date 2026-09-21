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
import type { RecordSaleLine } from "@waitron/core";
import type { VatBreakdownLine } from "@waitron/fiscal";
import { assertQuantityPrecision } from "./unit-validation.js";

export type PricingUnit = "each" | "weight";
export const VAT_CLASSES = ["general", "reduced", "super_reduced", "zero"] as const;
export type VatClass = (typeof VAT_CLASSES)[number];

export interface UnitSnapshot {
  name: Record<string, string>;
  precision: number;
  abbreviation: Record<string, string>;
}

export interface PriceableProduct {
  /** The product's staff-facing name, frozen onto the sale line's `name`. A row read from the
   * catalogue is resolved into this shape first — see `product-presentation.ts`, which owns the
   * blank-falls-back-to-the-staff-name rule and the " · " product/variant join. */
  name: string;
  /** locale -> customer-facing text, already resolved by `customerPresentationText`. */
  descriptions: Record<string, string>;
  unit: UnitSnapshot;
  /** GROSS (VAT-inclusive): per selected unit. */
  unitPrice: string;
  vatClass: VatClass;
  /** Snapshotted analytics label, copied onto the sale line. */
  category: string | null;
  variantId?: string | null;
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
 * A working-order line filed from its stored LOCK, not the live catalogue. Task 1 froze the gross
 * unit price and the rate onto `working_order_lines` at add-time; `priceLockedLines` reprices from
 * exactly those columns, so a retrieved/parked order files the same figures whether it went
 * through re-price or file-from-lock. Deliberately the STORED gross unit and rate, never
 * `line_total ÷ quantity` — recovering a fractional line by division drifts off the add-time VAT breakdown.
 */
export interface LockedLine {
  /** The stored `working_order_lines.unit_price_gross` — GROSS, per selected unit. */
  grossUnitPrice: string;
  /** The stored quantity, validated against the snapshotted unit precision. */
  quantity: string;
  /** The rate locked onto `working_order_lines.vat_rate` at add-time, as a percentage literal
   * e.g. "21.00" meaning 21%. The column counts basis points; the caller reading the row converts,
   * so nothing in this file sees the count. */
  vatRate: string;
  /** The staff-facing name snapshotted at add-time; copied onto the sale line's `name` verbatim. */
  name: string;
  /** locale -> customer-facing text, snapshotted at add-time; copied onto the sale line verbatim. */
  descriptions: Record<string, string>;
  /** Snapshotted analytics label, copied onto the sale line; `null` when absent. */
  category: string | null;
  /** Unit snapshot from line-add time; null only for a modifier child. */
  unitName?: Record<string, string> | null;
  unitPrecision?: number | null;
  /** The `lineNo` of this row's PARENT dish line when this is a child MODIFIER line (ordering
   * modifiers), else `null`/absent for a top-level line. Reconstructed by the caller from the stored
   * `working_order_lines.parent_line_id` (an id) against the same batch's `line_no`s, so a
   * locked-line file preserves parent→child linkage exactly as a live walk-up does. Copied onto the
   * emitted `RecordSaleLine.parentLineNo` verbatim — presentation metadata, never part of the hash. */
  parentLineNo?: number | null;
  optionSnapshots?: OptionSnapshot[];
  variantId?: string | null;
  variantName?: string | null;
  variantDescriptions?: Record<string, string> | null;
  variantKitchenName?: string | null;
  kitchenName?: string | null;
}

// The standing Spanish VAT set. RECEIPT (Step 6): the four rates below were confirmed on 2026-08-05
// against the primary Spanish tax-agency source (AEAT), page path
// `/Sede/iva/calculo-iva-repercutido-clientes/tipos-impositivos-iva.html` on sede.agenciatributaria.gob.es
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
  /**
   * The GROSS (VAT-inclusive) UNIT price per line, at MONEY_SCALE, in `lines` order — the gross for
   * one selected unit, NOT multiplied by quantity. This is the exact figure
   * `working_order_lines.unit_price_gross` stores at add-time so a retrieved order files from the lock:
   * `priceLockedLines` reads it straight back as its `grossUnitPrice`, so the stored value and the
   * file-time recompute round-trip byte-for-byte (never `grossLineTotals ÷ quantity`, which drifts for
   * a fractional line). Parallel to `lines`/`grossLineTotals`.
   */
  grossUnitPrices: Decimal[];
  total: Decimal;
  vatBreakdown: VatBreakdownLine[];
}

/** The per-line inputs the arithmetic core needs, sourced identically whether they come from a live
 * catalogue product or a stored lock. */
interface PricingRow {
  /** GROSS (VAT-inclusive) price per selected unit. */
  grossUnit: Decimal;
  quantity: string;
  /** The VAT rate as a percentage literal Decimal, e.g. "21.00". */
  rate: Decimal;
  /** The staff-facing name; `sale_lines.name` is NOT NULL, so every row carries one. */
  name: string;
  descriptions: Record<string, string>;
  category: string | null;
  unitName: Record<string, string> | null;
  unitPrecision: number | null;
  /** The `lineNo` of this row's parent dish; `null`/absent for a top-level line. Copied onto the
   * emitted `RecordSaleLine.parentLineNo` verbatim — presentation metadata, never part of the hash. */
  parentLineNo?: number | null;
  optionSnapshots?: OptionSnapshot[];
  variantId?: string | null;
  variantName?: string | null;
  variantDescriptions?: Record<string, string> | null;
  variantKitchenName?: string | null;
  kitchenName?: string | null;
}

// THE ONE arithmetic core. `priceBasket` (live catalogue) and `priceLockedLines` (stored lock) both
// funnel through here, so a locked-line filing can never diverge from a walk-up's to the céntimo —
// the two entry points differ ONLY in how they source the gross unit and the rate (a product's
// `unitPrice`/`vatClass` vs a stored `unit_price_gross`/`vat_rate`). Keep them sharing this; do not
// reimplement the per-line gross/base/netUnit/tax = gross − base arithmetic in either caller.
function priceRows(rows: readonly PricingRow[]): PricedLines {
  const lines: RecordSaleLine[] = [];
  const grossLineTotals: Decimal[] = [];
  const grossUnitPrices: Decimal[] = [];
  const groups = new Map<Decimal, { base: Decimal; gross: Decimal }>();

  rows.forEach((row, i) => {
    // `quantity` is a plain `string`, so it is wrapped with `decimal()` (which validates the
    // literal) before reaching the branded-`Decimal` helpers; `grossUnit` and `rate` arrive already
    // branded from the callers, which is where each is validated.
    const grossUnit = toScale(row.grossUnit, MONEY_SCALE);
    const gross = toScale(multiplyDecimal(row.grossUnit, decimal(row.quantity)), MONEY_SCALE);
    const base = baseFromGross(gross, row.rate);
    const netUnit = baseFromGross(grossUnit, row.rate);
    lines.push({
      lineNo: i + 1,
      name: row.name,
      descriptions: row.descriptions,
      optionSnapshots: row.optionSnapshots ?? [],
      quantity: row.quantity,
      unitPrice: netUnit, // net, informational (record-sale.ts stores it verbatim)
      vatRate: row.rate,
      lineTotal: base,
      category: row.category,
      unitName: row.unitName,
      unitPrecision: row.unitPrecision,
      // Presentation metadata carried through the core untouched: `null` for a top-level line, the
      // parent dish's `lineNo` for a child option line. `?? null` keeps the no-options callers
      // (`priceBasket`/`priceLockedLines`, which never set it) emitting exactly `null` here, so a
      // basket priced with empty options stays line-for-line identical to `priceBasket`.
      parentLineNo: row.parentLineNo ?? null,
      variantId: row.variantId ?? null,
      variantName: row.variantName ?? null,
      variantDescriptions: row.variantDescriptions ?? null,
      variantKitchenName: row.variantKitchenName ?? null,
      kitchenName: row.kitchenName ?? null,
    });
    grossLineTotals.push(gross); // parallel to `lines`; the customer-facing gross of this same line
    grossUnitPrices.push(grossUnit); // parallel to `lines`; the per-UNIT gross stored as unit_price_gross
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
  return { lines, grossLineTotals, grossUnitPrices, total, vatBreakdown };
}

/** Prices a live basket: gross unit from the product's `unitPrice`, rate resolved from its `vatClass`. */
export function priceBasket(items: readonly BasketItem[]): PricedLines {
  return priceRows(
    items.map((item) => {
      assertQuantityPrecision(item.quantity, item.product.unit.precision, { positive: true });
      return {
        // `unitPrice` is a plain `string` on `PriceableProduct`, so `decimal()` validates it here.
        grossUnit: decimal(item.product.unitPrice),
        quantity: item.quantity,
        rate: resolveVatRate(item.product.vatClass),
        name: item.product.name,
        descriptions: item.product.descriptions,
        category: item.product.category,
        // The printed label is the unit's abbreviation, frozen here onto working_order_lines.unit_name.
        unitName: item.product.unit.abbreviation,
        unitPrecision: item.product.unit.precision,
        variantId: item.product.variantId ?? null,
        variantName: item.product.variantName ?? null,
        variantDescriptions: item.product.variantDescriptions ?? null,
        variantKitchenName: item.product.variantKitchenName ?? null,
        kitchenName: item.product.kitchenName ?? null,
      };
    }),
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
      name: line.name,
      descriptions: line.descriptions,
      optionSnapshots: line.optionSnapshots,
      category: line.category,
      unitName: line.unitName ?? null,
      unitPrecision: line.unitPrecision ?? null,
      // Carry the child→parent link through the lock round-trip so a persisted-order file (a retrieved
      // counter order, a settled tab) emits child sale_lines with the same `parent_line_id` a live
      // walk-up does. `?? null` keeps a no-modifier locked line (which never sets it) emitting `null`,
      // so a plain basket stays line-for-line identical.
      parentLineNo: line.parentLineNo ?? null,
      variantId: line.variantId ?? null,
      variantName: line.variantName ?? null,
      variantDescriptions: line.variantDescriptions ?? null,
      variantKitchenName: line.variantKitchenName ?? null,
      kitchenName: line.kitchenName ?? null,
    })),
  );
}

/** A modifier chosen on a dish — one selected option from an option group. */
export interface SelectedOption {
  /** The option's staff-facing label, snapshotted at selection time; becomes the child line's
   * `name`. The catalogue stores an option's label per language, and pricing holds no default
   * language to choose one by, so the CALLER resolves it and passes the chosen text in. */
  name: string;
  /** locale -> text, snapshotted at selection time; becomes the child line's `descriptions`. */
  descriptions: Record<string, string>;
  /** GROSS (VAT-inclusive) price change this option adds to the dish, as a two-place decimal string.
   * `"0.00"` for a free option (which then contributes a zero-base child line). */
  priceDelta: string;
  /** The option's own VAT class when it OVERRIDES the dish's, or `null` to INHERIT the dish's rate. */
  vatClass: VatClass | null;
  /** The option's own kitchen-facing name, snapshotted at selection time; becomes the child line's
   * `kitchenName`. Absent or null leaves the child without one — a child never borrows the dish's,
   * which names a different thing. */
  kitchenName?: string | null;
  /** How many of THIS option, per dish (the per-option count, author-capped by
   * `extra_list_items.max_quantity`). ABSENT means 1 — a no-per-option-count option, whose child
   * line is byte-identical to before this field existed. The child is priced at
   * `dishQuantity × quantity`, so a dish ×3 carrying an option ×2 prices the option 6 times. */
  quantity?: number;
}

/** A basket line that carries the dish plus the modifiers selected on it. */
export interface BasketItemWithOptions {
  product: PriceableProduct;
  /** The dish quantity, validated against its unit; every child option line follows it. */
  quantity: string;
  options: SelectedOption[];
  optionSnapshots?: OptionSnapshot[];
}

/**
 * Prices a live basket where each dish may carry selected modifier options: each item expands to a
 * PARENT dish row followed by its CHILD option rows, IN ORDER, so `priceRows` numbers the parent
 * before its children and each child's `parentLineNo` names the dish above it. A child is just
 * another priced row through the ONE arithmetic core — its gross unit is the option's `priceDelta`,
 * its quantity the DISH's quantity times the option's own per-option count (`opt.quantity ?? 1`, so
 * a dish ×3 with an option ×2 prices the option 6 times), its rate the option's `vatClass` override
 * or (when `null`) the dish's own rate, its name, descriptions and kitchen name the option's own,
 * and its category the parent's snapshot — so
 * the difference-method VAT breakdown and `total` include the option amounts with no separate arithmetic.
 * With every item's `options` empty this is line-for-line identical to `priceBasket`.
 */
export function priceBasketWithOptions(items: readonly BasketItemWithOptions[]): PricedLines {
  const rows: PricingRow[] = [];
  for (const item of items) {
    assertQuantityPrecision(item.quantity, item.product.unit.precision, { positive: true });
    // The parent's eventual `lineNo` is its 1-based position, which is `rows.length + 1` BEFORE the
    // parent row is pushed (`priceRows` assigns `lineNo = i + 1` in this same order).
    const parentLineNo = rows.length + 1;
    rows.push({
      // `unitPrice` is a plain `string` on `PriceableProduct`; `decimal()` validates it here.
      grossUnit: decimal(item.product.unitPrice),
      quantity: item.quantity,
      rate: resolveVatRate(item.product.vatClass),
      name: item.product.name,
      descriptions: item.product.descriptions,
      category: item.product.category,
      // The printed label is the unit's abbreviation, frozen here onto working_order_lines.unit_name.
      unitName: item.product.unit.abbreviation,
      unitPrecision: item.product.unit.precision,
      parentLineNo: null,
      optionSnapshots: item.optionSnapshots,
      variantId: item.product.variantId ?? null,
      variantName: item.product.variantName ?? null,
      variantDescriptions: item.product.variantDescriptions ?? null,
      variantKitchenName: item.product.variantKitchenName ?? null,
      kitchenName: item.product.kitchenName ?? null,
    });
    for (const opt of item.options) {
      rows.push({
        // `priceDelta` is a plain `string` on `SelectedOption`; `decimal()` validates it here.
        grossUnit: decimal(opt.priceDelta),
        // The child is priced PER DISH: the dish quantity times the option's own per-option count.
        // `opt.quantity ?? 1` keeps a no-count option (the common case) multiplying by exactly 1 —
        // and `multiplyDecimal` by "1" returns the dish literal unchanged, so that path stays
        // byte-identical. Exact BigInt arithmetic via the shared Decimal helper, never JS floats.
        quantity: multiplyDecimal(decimal(item.quantity), decimal(String(opt.quantity ?? 1))),
        rate:
          opt.vatClass === null
            ? resolveVatRate(item.product.vatClass)
            : resolveVatRate(opt.vatClass),
        // A child line's staff name is the modifier's OWN label, never the dish's: `sale_lines.name`
        // is NOT NULL, so each emitted child carries one.
        name: opt.name,
        descriptions: opt.descriptions,
        category: item.product.category, // snapshot the parent's category
        unitName: null,
        unitPrecision: null,
        parentLineNo,
        kitchenName: opt.kitchenName ?? null,
      });
    }
  }
  return priceRows(rows);
}
