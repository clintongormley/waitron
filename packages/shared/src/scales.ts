import { AppError } from "./errors.js";
import { decimal, toScale } from "./money.js";
import type { Decimal } from "./money.js";

// The sanctioned crossings between a SCALED-INTEGER column and the exact decimal type, for the
// two scales that are not money. It also supplies money's literal renderer and raw pattern to
// `./cents.ts`.
//
// A quantity column stores a count of whole thousandths and a rate column a count of whole basis
// points, while every arithmetic and every printed literal above the storage boundary is an exact
// `Decimal`, exactly as it is for an amount. The reason this is a second file rather than more
// exports in `./cents.ts` is the reason the scales are separate at all: one conversion covering
// all three would take a quantity and a rate and give the same answer for the same literal, and
// that answer would be wrong for the QUANTITY. A rate and an amount happen to share a scale —
// `RATE_SCALE` and `MONEY_SCALE` are both 2 — so one conversion would in fact serve both; a
// quantity carries a third place, and there the answers part. 0.005 kg is 5 thousandths and reads
// as 1 at the money scale, because `decimalToCents` rounds that third place half away from zero
// rather than dropping it. So the shared conversion would not refuse anything and would not empty
// the line: it would return a number five times too small (measured, and pinned by the 0.005
// cases in `scales.test.ts`). The names are separate anyway, because a rate and an amount sharing
// a scale today is a coincidence of this tax regime, not a property to build on.
//
// `./money.ts` is where the rounding happens — `toScale`, in BigInt, half away from zero. Nothing
// here rounds a float; `conventions.test.ts` reads this file's text and fails on any float-shaped
// operation but the number constructor these conversions exist for.

/** Three decimal places, so five grams is a quantity and not a rounding error. */
export const QUANTITY_SCALE = 3;

/**
 * Nine integer digits. The column is an eight-byte integer and takes a wider count silently, so
 * this bound is the only width limit (see the header of `packages/db/src/schema/columns.ts`). The
 * widest quantity it admits, 999999999.999, is 999999999999 thousandths — well inside the
 * 9007199254740991 a JavaScript number counts exactly.
 */
export const MAX_QUANTITY_INTEGER_DIGITS = 9;

/** Two decimal places: a 21.00 VAT rate, and a 10.50 one. */
export const RATE_SCALE = 2;

/**
 * Three integer digits: 999.99 is 99999 basis points. The column is an eight-byte integer, so this
 * bound is the only digit limit; the VAT-rate and deductible-proportion columns also carry a CHECK
 * capping the count at 10000.
 */
export const MAX_RATE_INTEGER_DIGITS = 3;

function scaledCount(value: Decimal, scale: number, maxIntegerDigits: number): number {
  return boundedCount(
    BigInt(toScale(value, scale).replace(".", "")),
    value,
    scale,
    maxIntegerDigits,
  );
}

function boundedCount(
  count: bigint,
  value: string,
  scale: number,
  maxIntegerDigits: number,
): number {
  if ((count < 0n ? -count : count) >= 10n ** BigInt(maxIntegerDigits + scale)) {
    throw new AppError("shared.decimal_overflow", { value, maxIntegerDigits });
  }
  return Number(count);
}

/**
 * The literal for a count at `scale`, always with every place: 1234 at scale 2 is "12.34".
 *
 * Package-internal — not re-exported from `index.ts`. Callers check `Number.isInteger` first, as
 * `centsToDecimal`, `thousandthsToDecimal` and `basisPointsToDecimal` do.
 */
export function scaledLiteral(count: number, scale: number): Decimal {
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
 * value.
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

// Anchored, no sign but a leading minus, no leading zeros, no point, no exponent — the shape this
// engine renders for an integer cast to text, column or aggregate alike. It also admits "-0", read
// as zero (pinned in `scales.test.ts`). A value carrying a decimal point is refused rather than
// converted, which is the case that would otherwise be wrong by a power of ten. Shared by every raw
// reader, money's included; the reasoning and the measurements are on `rawCentsToDecimal` in
// `./cents.ts`.
export const RAW_COUNT_PATTERN = /^-?(?:0|[1-9]\d*)$/;

/**
 * `malformed` is the caller's own scale code, as `rawCentsToDecimal` refuses in money's own words:
 * a caller reading a quantity and a rate in one row can then tell which of the two was malformed.
 * The OVERFLOW refusal below is deliberately not per-scale — `shared.decimal_overflow` names the
 * concept for every scale, and is what the typed `decimalToThousandths` throws for the same
 * condition.
 */
function rawCount(
  value: string,
  scale: number,
  maxIntegerDigits: number,
  malformed: "shared.invalid_thousandths" | "shared.invalid_basis_points",
): number {
  if (typeof value !== "string" || !RAW_COUNT_PATTERN.test(value)) {
    throw new AppError(malformed, { value: String(value) });
  }
  return boundedCount(BigInt(value), value, scale, maxIntegerDigits);
}

/**
 * The quantity for a count of thousandths read by RAW SQL, where the count arrives as TEXT.
 * A sum past nine integer digits is refused here, since no column type below refuses it.
 */
export function rawThousandthsToDecimal(value: string): Decimal {
  return thousandthsToDecimal(
    rawCount(value, QUANTITY_SCALE, MAX_QUANTITY_INTEGER_DIGITS, "shared.invalid_thousandths"),
  );
}

/** The rate for a count of basis points read by RAW SQL, where the count arrives as TEXT. */
export function rawBasisPointsToDecimal(value: string): Decimal {
  return basisPointsToDecimal(
    rawCount(value, RATE_SCALE, MAX_RATE_INTEGER_DIGITS, "shared.invalid_basis_points"),
  );
}
