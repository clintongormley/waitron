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
// that answer would be wrong for the QUANTITY. A rate and an amount happen to share a scale —
// `RATE_SCALE` and `MONEY_SCALE` are both 2 — so one conversion would in fact serve both; a
// quantity carries a third place, and there the answers part. 0.005 kg is 5 thousandths and reads
// as 1 at the money scale, because `decimalToCents` rounds that third place half away from zero
// rather than dropping it. So the shared conversion would not refuse anything and would not empty
// the line: it would return a number five times too small (measured, and pinned by the 0.005
// cases in `scales.test.ts`). The names are separate anyway, because a rate and an amount sharing
// a scale today is a coincidence of this tax regime, not a property to build on.
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

// Anchored, no sign but a leading minus, no leading zeros, no point, no exponent — the shape both
// engines render for an integer, or a scale-0 `numeric`, cast to text. Not ONLY that shape: it
// also admits "-0". Measured 2026-09-21 on the development container: PostgreSQL 18.6 renders
// `'-0'::bigint::text` and `'-0'::numeric::text` as "0", so nothing on that side produces the
// string — and a caller that hands it over anyway is read here as zero, which is what the engine
// reads it as too, so admitting it costs nothing (pinned in `scales.test.ts`).
// The `numeric` half is not a corner case, because one of the two raw reads in the tree is an
// AGGREGATE. Measured 2026-09-21 against the development container `waitron-db-1`, where
// `show server_version` reports 18.6, with `pg_typeof`: `sum(...)` over a `bigint` is a `numeric`,
// and over an `integer` or a `smallint` it is a `bigint`. So the summed quantity in
// `packages/reporting/src/top-sellers.ts` arrives as a `numeric`; the one rate read,
// `packages/reporting/src/input-vat.ts`, is the bare `integer` column, and a summed rate would
// arrive as a `bigint`. The `::text` cast is what makes all three the same string. The reasoning, the driver measurements and the reason the cast is `::text` and not
// `::int` are written out once, on `rawCentsToDecimal` in `./cents.ts`; everything there applies
// here unchanged.
const RAW_COUNT_PATTERN = /^-?(?:0|[1-9]\d*)$/;

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
  const negative = value.startsWith("-");
  const magnitude = BigInt(negative ? value.slice(1) : value);
  if (magnitude >= 10n ** BigInt(maxIntegerDigits + scale)) {
    throw new AppError("shared.decimal_overflow", { value, maxIntegerDigits });
  }
  return Number(negative ? -magnitude : magnitude);
}

/**
 * The quantity for a count of thousandths read by RAW SQL, where the count arrives as TEXT.
 *
 * The bound is the one the `::numeric(12, 3)` cast this replaced enforced: a sum past nine integer
 * digits was refused by PostgreSQL with a 22003, and it is refused here instead. The refusal moved
 * from the engine to the reader; it did not disappear.
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
