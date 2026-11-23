import { AppError } from "./errors.js";
import { decimal, MAX_MONEY_INTEGER_DIGITS, MONEY_SCALE } from "./money.js";
import type { Decimal } from "./money.js";
import { RAW_COUNT_PATTERN, scaledCount, scaledLiteral } from "./scales.js";

// The crossing between a money column's stored count of whole cents and a `Decimal`. A file of its
// own because `conventions.test.ts` fails `./money.ts` on any `Number(`. Exact: `decimalToCents`
// bounds the ROUNDED amount at twelve integer digits, so its count stays inside
// `Number.MAX_SAFE_INTEGER`, and the only rounding is `toScale`'s, in BigInt.

const MONEY_COUNT_LIMIT = 10 ** (MAX_MONEY_INTEGER_DIGITS + MONEY_SCALE);

/** The count of whole cents in an amount: "12.34" is 1234. */
export function decimalToCents(value: Decimal): number {
  return scaledCount(value, MONEY_SCALE, MAX_MONEY_INTEGER_DIGITS);
}

/**
 * The count of whole cents in a decimal string: "12.34" is 1234. Refuses a malformed
 * string with `shared.invalid_decimal`, and one whose integer part, once rounded to cents, is
 * wider than the money scale admits with `shared.decimal_overflow`.
 */
export function stringToCents(value: string): number {
  return decimalToCents(decimal(value));
}

/**
 * The decimal literal for one stored money amount: 1234 is "12.34", and 0 is "0.00".
 *
 * Always two places, because the literal is what a receipt prints and what a fiscal record
 * hashes — "0" and "0.00" are one amount and two different byte strings.
 */
export function centsToDecimal(cents: number): Decimal {
  if (!Number.isSafeInteger(cents)) {
    throw new AppError("shared.invalid_cents", { value: String(cents) });
  }
  const value = scaledLiteral(cents, MONEY_SCALE);
  if (cents <= -MONEY_COUNT_LIMIT || cents >= MONEY_COUNT_LIMIT) {
    throw new AppError("shared.decimal_overflow", {
      value,
      maxIntegerDigits: MAX_MONEY_INTEGER_DIGITS,
    });
  }
  return value;
}

/**
 * The amount for a count of cents supplied as an integer string. Totals can exceed the limit
 * for individual amounts. The count must fit in a JavaScript safe integer.
 *
 * This engine hands an uncast integer to a raw read as a JavaScript number, which is refused here
 * with `shared.invalid_cents`; the query casts it with `cast(x as text)` (the engine has no `::`).
 * Not `cast(x as integer)`, which still arrives as a number, and not a fixed-scale rendering: 7734
 * cents written "7734.00" reads as a hundred times the amount, so a point is refused.
 * Use `centsToDecimal` for one amount read from a typed schema column.
 */
export function rawCentsToDecimal(value: string): Decimal {
  if (typeof value !== "string" || !RAW_COUNT_PATTERN.test(value)) {
    throw new AppError("shared.invalid_cents", { value: String(value) });
  }
  const cents = Number(value);
  // Not the money bound: a total can be wider than any one amount. Checked here so the refusal
  // names the text as read: `Number()` has already rounded a count past a safe integer.
  if (!Number.isSafeInteger(cents)) {
    throw new AppError("shared.invalid_cents", { value });
  }
  return scaledLiteral(cents, MONEY_SCALE);
}
