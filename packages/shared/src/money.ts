import { AppError } from "./errors.js";
import type { Branded } from "./ids.js";

/**
 * An exact decimal, held as its literal string. NOT a number, and deliberately not convertible
 * to one — see the closing note in this file.
 *
 * The scale is part of the value: "1.5" and "1.50" are equal in magnitude but are different
 * literals, and the literal is what is stored and later hashed. Every operation here states what
 * it does to the scale.
 */
export type Decimal = Branded<string, "Decimal">;

export const MONEY_SCALE = 2;
export const MAX_MONEY_INTEGER_DIGITS = 12;

// Anchored, no exponent, no leading plus, no leading zeros, at least one digit either side of
// the point when a point is present.
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function decimal(value: string): Decimal {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw new AppError("shared.invalid_decimal", { value: String(value) });
  }
  // A sign on a zero magnitude would survive into a stored literal and then into a hash input,
  // where "-0.00" does not compare equal to "0.00" even though the amounts do.
  if (value.startsWith("-") && !/[1-9]/.test(value)) {
    return value.slice(1) as Decimal;
  }
  return value as Decimal;
}

interface Parts {
  units: bigint;
  scale: number;
}

function partsOf(value: Decimal): Parts {
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const point = body.indexOf(".");
  const digits = point === -1 ? body : body.slice(0, point) + body.slice(point + 1);
  const scale = point === -1 ? 0 : body.length - point - 1;
  const magnitude = BigInt(digits);
  return { units: negative ? -magnitude : magnitude, scale };
}

function fromParts({ units, scale }: Parts): Decimal {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  // padStart guarantees at least one integer digit, so "5" at scale 2 renders "0.05" rather
  // than ".05" — which the pattern would reject on the way back in.
  const digits = magnitude.toString().padStart(scale + 1, "0");
  const body =
    scale === 0
      ? digits
      : `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
  return ((negative && magnitude !== 0n ? "-" : "") + body) as Decimal;
}

interface Aligned {
  left: bigint;
  right: bigint;
  scale: number;
}

function align(left: Decimal, right: Decimal): Aligned {
  const a = partsOf(left);
  const b = partsOf(right);
  const scale = Math.max(a.scale, b.scale);
  return {
    left: a.units * 10n ** BigInt(scale - a.scale),
    right: b.units * 10n ** BigInt(scale - b.scale),
    scale,
  };
}

/** Result scale is the wider of the two operands. */
export function addDecimal(left: Decimal, right: Decimal): Decimal {
  const { left: a, right: b, scale } = align(left, right);
  return fromParts({ units: a + b, scale });
}

/** Result scale is the wider of the two operands. */
export function subtractDecimal(left: Decimal, right: Decimal): Decimal {
  const { left: a, right: b, scale } = align(left, right);
  return fromParts({ units: a - b, scale });
}

/**
 * Result scale is the SUM of the operand scales — the exact product, with nothing discarded.
 * Truncating to the wider operand's scale would lose a digit on any unit price carrying three
 * decimals, which is a normal thing for a unit price to carry. Rounding to a storable scale is
 * `toScale`'s job and happens once, at the point of storage, not on every intermediate.
 */
export function multiplyDecimal(left: Decimal, right: Decimal): Decimal {
  const a = partsOf(left);
  const b = partsOf(right);
  return fromParts({ units: a.units * b.units, scale: a.scale + b.scale });
}

/** Non-negative `numerator / denominator`, rounded half away from zero — shared by `toScale` and
 * `divideDecimal` so the rounding rule is written once. */
function roundedQuotient(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

/**
 * Exact quotient `dividend / divisor`, rounded half away from zero to `scale` places — the
 * division `@waitron/shared` otherwise lacks (which is why `packages/core/src/vat.ts` used to
 * reimplement this file's private codec). Computed entirely in BigInt: never a JS number.
 */
export function divideDecimal(dividend: Decimal, divisor: Decimal, scale: number): Decimal {
  const a = partsOf(dividend);
  const b = partsOf(divisor);
  if (b.units === 0n) {
    throw new AppError("shared.invalid_decimal", { value: `${dividend} / ${divisor}` });
  }
  // value = (a.units / 10^a.scale) / (b.units / 10^b.scale), rendered at `scale` decimals:
  //   result.units = round( a.units * 10^b.scale * 10^scale / (b.units * 10^a.scale) )
  const num = a.units * 10n ** BigInt(b.scale) * 10n ** BigInt(scale);
  const den = b.units * 10n ** BigInt(a.scale);
  const negative = num < 0n !== den < 0n;
  const absNum = num < 0n ? -num : num;
  const absDen = den < 0n ? -den : den;
  const rounded = roundedQuotient(absNum, absDen);
  return fromParts({ units: negative ? -rounded : rounded, scale });
}

export function negateDecimal(value: Decimal): Decimal {
  const { units, scale } = partsOf(value);
  return fromParts({ units: -units, scale });
}

export function isZeroDecimal(value: Decimal): boolean {
  return partsOf(value).units === 0n;
}

/** -1, 0 or 1. Compares by value across differing scales, never lexically. */
export function compareDecimal(left: Decimal, right: Decimal): -1 | 0 | 1 {
  const { left: a, right: b } = align(left, right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function sumDecimals(values: readonly Decimal[]): Decimal {
  return values.reduce<Decimal>((total, value) => addDecimal(total, value), "0" as Decimal);
}

/**
 * Re-scales, rounding half away from zero — the same policy `packages/verifactu`'s field
 * formatting applies to a record literal. Choosing a different mode here would make the sale
 * total and the fiscal record disagree by one cent on exactly the values that sit on a boundary,
 * which is the defect class this module exists to prevent. Changing it is a primary-source
 * question, not an implementation choice.
 */
export function toScale(value: Decimal, scale: number): Decimal {
  const current = partsOf(value);
  if (scale === current.scale) return value;
  if (scale > current.scale) {
    return fromParts({ units: current.units * 10n ** BigInt(scale - current.scale), scale });
  }
  const divisor = 10n ** BigInt(current.scale - scale);
  const negative = current.units < 0n;
  const magnitude = negative ? -current.units : current.units;
  // `roundedQuotient` computes "at or above half" as `remainder * 2n >= divisor`, entirely in
  // integers. The familiar `remainder / divisor >= 0.5` is the same test written so that it
  // needs a float.
  const rounded = roundedQuotient(magnitude, divisor);
  return fromParts({ units: negative ? -rounded : rounded, scale });
}

/**
 * Guards the magnitude a `numeric(12, 2)` column accepts. Checks the integer digits only —
 * scaling to two places is `toScale`'s job, and fusing the two would make it impossible to hold
 * an intermediate at full precision while still bounding it.
 */
export function assertMoney(value: Decimal): Decimal {
  const { units, scale } = partsOf(value);
  const magnitude = units < 0n ? -units : units;
  const integerUnits = magnitude / 10n ** BigInt(scale);
  if (integerUnits >= 10n ** BigInt(MAX_MONEY_INTEGER_DIGITS)) {
    throw new AppError("shared.decimal_overflow", {
      value,
      maxIntegerDigits: MAX_MONEY_INTEGER_DIGITS,
    });
  }
  return value;
}

// There is deliberately no `toNumber`. The only honest reason to want one is formatting for
// display, and a display formatter takes the string. Exporting a conversion would put the float
// path one autocomplete away from every call site in the repo, and the resulting defect is
// invisible: totals that are individually plausible, disagree by a cent, and are already signed
// into an immutable record by the time anyone reconciles them.
