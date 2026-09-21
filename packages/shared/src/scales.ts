import { AppError } from "./errors.js";
import { decimal, toScale } from "./money.js";
import type { Decimal } from "./money.js";

// The sanctioned crossings between a SCALED-INTEGER column and the exact decimal type, for the
// two scales that are not money.
//
// A quantity column stores a count of whole thousandths and a rate column a count of whole basis
// points, while every arithmetic and every printed literal above the storage boundary is an exact
// `Decimal`, exactly as it is for an amount. The reason this is a second file rather than more
// exports in `./cents.ts` is the reason the scales are separate at all: one conversion covering
// all three would take a quantity and a rate and give the same answer for the same literal, and
// reading 0.005 kg at the money scale leaves nothing. The last case in `scales.test.ts` is that
// pair of readings side by side.
//
// `./money.ts` is where the rounding happens — `toScale`, in BigInt, half away from zero, which
// is the rule the decimal columns applied on the way in. Nothing here rounds a float;
// `conventions.test.ts` reads this file's text and fails on any float-shaped operation but the
// number constructor these conversions exist for.

/** Three decimal places, so five grams is a quantity and not a rounding error. */
export const QUANTITY_SCALE = 3;

/**
 * Nine, which is what `numeric(12, 3)` admitted before the column became an integer.
 *
 * The bound moves here rather than disappearing: the decimal column refused a wider quantity
 * with a `22003`, and an eight-byte integer would take it silently. Eight bytes and not four,
 * because the widest quantity the old column accepted is 999999999.999, which is 999999999999
 * thousandths — past `integer`'s 2147483647 (the measurement is in `columns.ts`'s `money`
 * docstring) and well inside the 9007199254740991 a JavaScript number counts exactly.
 */
export const MAX_QUANTITY_INTEGER_DIGITS = 9;

/** Two decimal places: a 21.00 VAT rate, and a 10.50 one. */
export const RATE_SCALE = 2;

/**
 * Three, which is what `numeric(5, 2)` admitted. 999.99 is 99999 basis points, so unlike a
 * quantity a rate fits a four-byte `integer` with room to spare.
 */
export const MAX_RATE_INTEGER_DIGITS = 3;

function scaledCount(value: Decimal, scale: number, maxIntegerDigits: number): number {
  const scaled = toScale(value, scale);
  const negative = scaled.startsWith("-");
  const digits = (negative ? scaled.slice(1) : scaled).replace(".", "");
  const magnitude = BigInt(digits);
  if (magnitude >= 10n ** BigInt(maxIntegerDigits + scale)) {
    throw new AppError("shared.decimal_overflow", { value, maxIntegerDigits });
  }
  return Number(negative ? -magnitude : magnitude);
}

function scaledLiteral(count: number, scale: number): Decimal {
  const negative = count < 0;
  const digits = String(negative ? -count : count).padStart(scale + 1, "0");
  const point = digits.length - scale;
  return decimal(`${negative ? "-" : ""}${digits.slice(0, point)}.${digits.slice(point)}`);
}

/** The count of whole thousandths in a quantity: "1.500" is 1500, and "0.005" is 5. */
export function decimalToThousandths(value: Decimal): number {
  return scaledCount(value, QUANTITY_SCALE, MAX_QUANTITY_INTEGER_DIGITS);
}

/**
 * The decimal literal for a stored count of thousandths: 1500 is "1.500".
 *
 * Always three places, because the literal is what a receipt prints and the scale is part of the
 * value — it is also what the `numeric(12, 3)` column rendered, so a line's printed quantity does
 * not change with the storage.
 */
export function thousandthsToDecimal(count: number): Decimal {
  if (!Number.isInteger(count)) {
    throw new AppError("shared.invalid_thousandths", { value: String(count) });
  }
  return scaledLiteral(count, QUANTITY_SCALE);
}

/** The count of whole basis points in a rate: "21.00" is 2100, and "10.50" is 1050. */
export function decimalToBasisPoints(value: Decimal): number {
  return scaledCount(value, RATE_SCALE, MAX_RATE_INTEGER_DIGITS);
}

/**
 * The decimal literal for a stored count of basis points: 2100 is "21.00".
 *
 * Always two places, for the same reason `centsToDecimal` gives: one of these rates reaches a
 * fiscal record, where "21" and "21.00" are one rate and two different byte strings.
 */
export function basisPointsToDecimal(count: number): Decimal {
  if (!Number.isInteger(count)) {
    throw new AppError("shared.invalid_basis_points", { value: String(count) });
  }
  return scaledLiteral(count, RATE_SCALE);
}
