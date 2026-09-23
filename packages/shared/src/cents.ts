import { AppError } from "./errors.js";
import { assertMoney, MONEY_SCALE, toScale } from "./money.js";
import type { Decimal } from "./money.js";
import { RAW_COUNT_PATTERN, scaledLiteral } from "./scales.js";

// The one sanctioned crossing between a money COLUMN and the amount type.
//
// A money column stores a count of whole cents, while every arithmetic and every printed or
// hashed literal above the storage boundary is an exact `Decimal`. The three functions that
// convert between those two forms are declared here and nowhere else in the tree
// (`grep -rn 'function decimalToCents\|function centsToDecimal\|function rawCentsToDecimal'`
// over `packages` and `apps` returns this file alone), which is why it is a file of its own
// rather than more exports in `./money.ts`: that file is checked, as text, for the absence of
// `Number(` and every other float-shaped token (`conventions.test.ts`), and keeping the check
// that strict is worth more than the convenience of one module.
//
// The sentence above is about these three functions, not about the number type in general, and
// the difference matters because plenty of code crosses into a number without coming through
// here. A caller that already holds a `Decimal` may take it further whenever it needs a number to
// format, compare or hand to a library — display formatting and `packages/workforce-es`'s
// `convenio.ts` both do, and some of those call sites carry their own note saying why it is safe
// there. A card provider's minor units are a separate conversion with separate converters
// (`toMinorUnits` in `packages/payments-stripe/src/client.ts` and
// `packages/payments-sumup/src/client.ts`), reached from an amount and never from a column.
// What is confined to this file is the crossing between a STORED COUNT OF CENTS and a `Decimal`;
// nothing outside it reads or writes that form. Nothing enforces either property.
//
// Every direction is exact. A count of cents is an integer, and the widest amount this system
// admits — 12 integer digits, guarded by `assertMoney` — is 99999999999999 cents against a safe
// integer of 9007199254740991, so no amount in range can lose a cent to the number type. Nothing
// here rounds a float: the rounding that does happen is `toScale`'s, in BigInt, and it is the same
// half-away-from-zero rule the decimal column applied on the way in.

/** The count of whole cents in an amount: "12.34" is 1234. */
export function decimalToCents(value: Decimal): number {
  return Number(BigInt(toScale(assertMoney(value), MONEY_SCALE).replace(".", "")));
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
 * A raw read hands back whatever the driver makes of the value, and on this engine an uncast
 * integer arrives as a JavaScript NUMBER. So the caller must cast the expression to text in the
 * query — spelled `cast(x as text)`, because this engine has no `::` cast operator — and that
 * string is what this function takes.
 *
 * Measured on this engine 2026-09-22 (`node:sqlite`, Node v26.7.0) over
 * `probe(amount integer not null)` holding 1234 and 2147483648, with a node script printing
 * `typeof` for every value it read:
 *
 *   expression                              result
 *   cast(amount as text)                    "1234" string
 *   cast(sum(amount) as text)               "2147484882" string
 *   cast(coalesce(sum(amount), 0) as text)  "0" string, over no rows
 *   amount — CONTROL, no cast               1234 NUMBER
 *   sum(amount) — CONTROL, no cast          2147484882 NUMBER
 *
 * The two controls are what make the reading mean anything: they are why the cast exists, and they
 * fail LOUDLY rather than silently — an uncast read reaches the `typeof value !== "string"` line
 * below and throws `shared.invalid_cents`, so a caller that forgets the cast finds out.
 *
 * NOT a cast to an integer type, and this is the part that is easy to get wrong when adding a call
 * site: `cast(x as integer)` would hand back a number this function refuses, and a fixed-scale
 * rendering would be worse — a count of 7734 cents written as "7734.00" is a plausible string a
 * hundred times the amount, which `RAW_COUNT_PATTERN` refuses for exactly that reason.
 *
 * The four-byte overflow that first argued for text — PostgreSQL's `::int` topping out at
 * 2147483647 cents while a money column carries twelve integer digits — belonged to the previous
 * engine and is not the reason any more. The rule it produced is unchanged.
 *
 * None of this applies to a typed drizzle `.select()` over a schema column — the column's own
 * mapping converts the value, so those call sites use `centsToDecimal` directly and need no cast.
 * This function is for `tx.execute` and for a `sql` fragment inside a select list, which are
 * untyped on both ends.
 */
export function rawCentsToDecimal(value: string): Decimal {
  if (typeof value !== "string" || !RAW_COUNT_PATTERN.test(value)) {
    throw new AppError("shared.invalid_cents", { value: String(value) });
  }
  const cents = Number(value);
  // Not the money bound: a total can be wider than any one amount (pinned in `cents.test.ts`). A
  // count past what a number holds exactly would drop digits without saying so.
  if (!Number.isSafeInteger(cents)) {
    throw new AppError("shared.invalid_cents", { value });
  }
  return centsToDecimal(cents);
}
