import { AppError } from "./errors.js";
import { assertMoney, decimal, MONEY_SCALE, toScale } from "./money.js";
import type { Decimal } from "./money.js";

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

// Anchored, no sign but a leading minus, no leading zeros, no point, no exponent — the exact
// shape both engines render for an integer, or a scale-0 `numeric`, cast to text, and nothing
// else. The `numeric` half is not a corner case: plenty of call sites cast an AGGREGATE rather
// than the column, and `sum(...)` over a `bigint` is a `numeric`, as is `sum(round(..., 0))`.
const RAW_CENTS_PATTERN = /^-?(?:0|[1-9]\d*)$/;

/**
 * The amount for a count of cents read by RAW SQL, where the count arrives as TEXT.
 *
 * A raw read hands back whatever the driver makes of the wire value, and the two engines this
 * repository runs against disagree about an uncast eight-byte integer COLUMN. Casting the
 * expression `::text` in the query makes both give the same plain integer string, which is what
 * this function takes.
 *
 * Measured 2026-09-20 over `probe(amount bigint not null, dec numeric(12, 2) not null)` holding
 * (1234, 6.75) and (2147483648, 6.75). The instrument is a node script that prints `typeof` for
 * every value it reads, through two clients: this repository's own `pg` (8.23.0) against the
 * development container `waitron-db-1`, where `show server_version` reports 18.6, and the
 * `@electric-sql/pglite` 0.5.8 JavaScript API. It has to be a JavaScript instrument. `psql`
 * renders every value as text, so no psql output can tell a driver returning a string from one
 * returning a number — a psql run is evidence about RENDERING and RANGE and about nothing else
 * on this page.
 *
 *   expression                             pg 8.23 / PostgreSQL 18.6   PGlite 0.5.8
 *   amount::text                           "1234" string               "1234" string
 *   sum(amount)::text                      "2147484882" string         "2147484882" string
 *   coalesce(sum(amount), 0)::text         "0" string, over no rows    "0" string
 *   sum(round(dec, 0))::text               "14" string                 "14" string
 *   amount — CONTROL, no cast              "1234" STRING               1234 NUMBER
 *   sum(amount) — CONTROL, no cast         "2147484882" string         "2147484882" string
 *   sum(dec)::text — CONTROL, unrounded    "13.50" string              "13.50" string
 *
 * Three controls, because a probe whose passing and failing cases print the same thing measures
 * nothing. The uncast COLUMN is why the cast exists at all: the engines really do differ there,
 * so a read a PGlite suite passes on a number arrives as a string against the real server, and
 * a converter written for one of those refuses the other. The uncast AGGREGATE narrows that: a
 * `sum()` over a `bigint` is a `numeric`, which both drivers render as a string, so the
 * disagreement is about the int8 column and not about raw reads in general. The unrounded
 * `numeric` sum shows a scale surviving into the text, which is what the rounded one would look
 * like if the `round(…, 0)` were ever dropped — and this function refuses it rather than
 * converting it a hundredfold wrong.
 *
 * NOT `::int`, which is what this repository cast first. Four bytes tops out at 2147483647 cents
 * — €21,474,836.47 — while a money column here stores twelve integer digits (`assertMoney`,
 * 99999999999999 cents). A value the column accepts on the way in is then refused on the way out
 * with a bare `22003`, which is exactly the band the columns were widened to eight bytes to
 * carry. NOT `::numeric(12, 2)::text` either: that renders a count of 7734 cents as "7734.00", a
 * plausible string a hundred times the amount, and nothing fails.
 *
 * None of this applies to a typed drizzle `.select()` over a schema column — the column's own
 * mapping converts the value, so those call sites use `centsToDecimal` directly and need no cast.
 * This function is for `tx.execute` and for a `sql` fragment inside a select list, which are
 * untyped on both ends.
 */
export function rawCentsToDecimal(value: string): Decimal {
  if (typeof value !== "string" || !RAW_CENTS_PATTERN.test(value)) {
    throw new AppError("shared.invalid_cents", { value: String(value) });
  }
  const cents = Number(value);
  // Twelve integer digits is 99999999999999 cents against a safe integer of 9007199254740991, so
  // no amount in range reaches this. A longer string would drop digits without saying so.
  if (!Number.isSafeInteger(cents)) {
    throw new AppError("shared.invalid_cents", { value });
  }
  return centsToDecimal(cents);
}
