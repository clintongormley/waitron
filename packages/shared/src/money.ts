import { AppError } from "./errors.js";
import type { Branded } from "./ids.js";

/**
 * An exact decimal, held as its literal string, and deliberately not convertible to a number (see
 * the closing note). The scale is part of the value: "1.5" and "1.50" are equal in magnitude but
 * different literals, and a literal is what gets printed and hashed.
 */
export type Decimal = Branded<string, "Decimal">;

export const MONEY_SCALE = 2;
export const MAX_MONEY_INTEGER_DIGITS = 12;

const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function decimal(value: string): Decimal {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw new AppError("shared.invalid_decimal", { value: String(value) });
  }
  // "-0.00" and "0.00" are one amount and two different literals, so the sign is dropped.
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
  // At least one integer digit: "5" at scale 2 is "0.05", never ".05", which `decimal` refuses.
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
 * Rounding to a storable scale is `toScale`'s job, done once rather than on every intermediate.
 */
export function multiplyDecimal(left: Decimal, right: Decimal): Decimal {
  const a = partsOf(left);
  const b = partsOf(right);
  return fromParts({ units: a.units * b.units, scale: a.scale + b.scale });
}

/** Non-negative `numerator / denominator`, rounded half away from zero. */
function roundedQuotient(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

/** `dividend / divisor`, rounded half away from zero to `scale` places, in BigInt throughout. */
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

/**
 * `ratePercent`% of `amount`, rounded half away from zero to `scale` places (money scale by
 * default). `ratePercent` is a PERCENTAGE literal ("21.00" meaning 21%): amount * rate / 100.
 */
export function percentOf(amount: Decimal, ratePercent: Decimal, scale = MONEY_SCALE): Decimal {
  return divideDecimal(multiplyDecimal(amount, ratePercent), "100" as Decimal, scale);
}

/**
 * Gross line amount: `unitPrice × quantity`, rounded once, half away from zero, to money scale.
 */
export function grossOf(unitPrice: string, quantity: string): Decimal {
  return toScale(multiplyDecimal(decimal(unitPrice), decimal(quantity)), MONEY_SCALE);
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
 * Re-scales, rounding half away from zero — the mode `@waitron/verifactu`'s `formatAmountExact`
 * uses for a record literal. A different mode here would make the sale total and the fiscal record
 * disagree by a cent on values that sit on a boundary.
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
  const rounded = roundedQuotient(magnitude, divisor);
  return fromParts({ units: negative ? -rounded : rounded, scale });
}

// There is deliberately no `toNumber`, and `conventions.test.ts` fails this file's text on the
// float-shaped operations it lists. The crossings into the number type are counts, in `./cents.ts`
// and `./scales.ts`.
