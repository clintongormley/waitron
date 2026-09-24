import { AppError } from "./errors.js";
import { assertMoney, decimal, MONEY_SCALE, toScale } from "./money.js";
import type { Decimal } from "./money.js";
import { RAW_COUNT_PATTERN, scaledLiteral } from "./scales.js";

// The crossing between a money column's stored count of whole cents and a `Decimal`. A file of its
// own because `conventions.test.ts` fails `./money.ts` on any `Number(`. Exact: `assertMoney` bounds
// the integer part at twelve digits, so a count stays inside `Number.MAX_SAFE_INTEGER`, and the only
// rounding is `toScale`'s, in BigInt.

/** The count of whole cents in an amount: "12.34" is 1234. */
export function decimalToCents(value: Decimal): number {
  return Number(BigInt(toScale(assertMoney(value), MONEY_SCALE).replace(".", "")));
}

/**
 * The count of whole cents in a decimal string: "12.34" is 1234. Refuses a malformed
 * string with `shared.invalid_decimal`, and one whose integer part is wider than the money
 * scale admits with `shared.decimal_overflow`.
 */
export function stringToCents(value: string): number {
  return decimalToCents(decimal(value));
}

/**
 * The decimal literal for a stored count of cents: 1234 is "12.34", and 0 is "0.00".
 *
 * Always two places, because the literal is what a receipt prints and what a fiscal record
 * hashes — "0" and "0.00" are one amount and two different byte strings.
 */
export function centsToDecimal(cents: number): Decimal {
  if (!Number.isInteger(cents)) {
    throw new AppError("shared.invalid_cents", { value: String(cents) });
  }
  return scaledLiteral(cents, MONEY_SCALE);
}

/**
 * The amount for a count of cents read by RAW SQL, where the count arrives as TEXT.
 *
 * This engine hands an uncast integer to a raw read as a JavaScript number, which is refused here
 * with `shared.invalid_cents`; the query casts it with `cast(x as text)` (the engine has no `::`).
 * Not `cast(x as integer)`, which still arrives as a number, and not a fixed-scale rendering: 7734
 * cents written "7734.00" reads as a hundred times the amount, so a point is refused. A typed
 * drizzle `.select()` over a schema column needs `centsToDecimal` instead.
 */
export function rawCentsToDecimal(value: string): Decimal {
  if (typeof value !== "string" || !RAW_COUNT_PATTERN.test(value)) {
    throw new AppError("shared.invalid_cents", { value: String(value) });
  }
  const cents = Number(value);
  // Not the money bound: a total can be wider than any one amount. A count past what a number
  // holds exactly would drop digits without saying so.
  if (!Number.isSafeInteger(cents)) {
    throw new AppError("shared.invalid_cents", { value });
  }
  return centsToDecimal(cents);
}
