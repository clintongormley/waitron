import { AppError } from "./errors.js";
import { assertMoney, decimal, MONEY_SCALE, toScale } from "./money.js";
import type { Decimal } from "./money.js";

/**
 * The one sanctioned crossing between a money amount and the number type.
 *
 * A money column stores a count of whole cents, while every arithmetic and every printed or
 * hashed literal above the storage boundary is an exact `Decimal`. These two functions are the
 * only place the two forms meet, which is why they are a file of their own rather than two more
 * exports in `./money.ts`: that file is checked, as text, for the absence of `Number(` and every
 * other float-shaped token (`conventions.test.ts`), and keeping the check that strict is worth
 * more than the convenience of one module.
 *
 * Both directions are exact. A count of cents is an integer, and the widest amount this system
 * admits — 12 integer digits, guarded by `assertMoney` — is 99999999999999 cents against a safe
 * integer of 9007199254740991, so no amount in range can lose a cent to the number type. Nothing
 * here rounds a float: the rounding that does happen is `toScale`'s, in BigInt, and it is the same
 * half-away-from-zero rule the decimal column applied on the way in.
 */

/** The count of whole cents in an amount: "12.34" is 1234. */
export function decimalToCents(value: Decimal): number {
  const scaled = toScale(assertMoney(value), MONEY_SCALE);
  const negative = scaled.startsWith("-");
  const digits = (negative ? scaled.slice(1) : scaled).replace(".", "");
  const magnitude = BigInt(digits);
  return Number(negative ? -magnitude : magnitude);
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
  const negative = cents < 0;
  const digits = String(negative ? -cents : cents).padStart(MONEY_SCALE + 1, "0");
  const point = digits.length - MONEY_SCALE;
  return decimal(`${negative ? "-" : ""}${digits.slice(0, point)}.${digits.slice(point)}`);
}
