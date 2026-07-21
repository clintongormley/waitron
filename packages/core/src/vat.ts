import { MONEY_SCALE, decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";

/**
 * Exact decimal parts — the same representation `@waitron/shared/src/money.ts`'s own private
 * `partsOf`/`fromParts` use internally, reimplemented here rather than imported: neither is
 * exported from that package's public surface (`@waitron/shared`'s barrel re-exports only the
 * operations built on top of them), and `@waitron/shared` has no division primitive at all —
 * `addDecimal`/`subtractDecimal`/`multiplyDecimal` cover the operations a sale total needs, but
 * splitting a VAT-inclusive line price into its base and tax components needs a division that
 * package does not provide. Reimplementing the two small helpers locally, in plain `BigInt`, keeps
 * this file's own arithmetic exact — never a JS `number` — for the one operation upstream is
 * missing.
 */
function parts(value: Decimal): { units: bigint; scale: number } {
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const point = body.indexOf(".");
  const digits = point === -1 ? body : body.slice(0, point) + body.slice(point + 1);
  const scale = point === -1 ? 0 : body.length - point - 1;
  const magnitude = BigInt(digits);
  return { units: negative ? -magnitude : magnitude, scale };
}

function render(units: bigint, scale: number): Decimal {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  // padStart guarantees at least one integer digit, so "5" at scale 2 renders "0.05" rather than
  // ".05" — which decimal()'s own pattern would reject on the way back in.
  const digits = magnitude.toString().padStart(scale + 1, "0");
  const body =
    scale === 0
      ? digits
      : `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
  return decimal((negative && magnitude !== 0n ? "-" : "") + body);
}

/**
 * `ratePercent`% of `amount`, exact and rounded half away from zero to `scale` places (money
 * scale, two decimals, by default) — never via a JS `number` division, which would reintroduce
 * exactly the representation error the rest of this system's `Decimal` arithmetic exists to avoid.
 *
 * `ratePercent` is a PERCENTAGE literal as this system already stores it (`"21.00"` meaning 21%,
 * matching `sale_lines.vat_rate`'s own convention) — not a fraction — so the division by 100 is
 * folded into this function rather than left to the caller.
 *
 * Used to derive a line's tax component from its tax-EXCLUSIVE `lineTotal` (the taxable base) and
 * its `vatRate`: `record-sale.ts`'s `buildVatBreakdown` groups lines by rate, sums their bases, and
 * calls this once per group to get the matching tax. Plain multiplication is correct because
 * `lineTotal` is the base, not the customer-facing gross price — recovering a base from a
 * VAT-INCLUSIVE price would need a division this function does not attempt (`amount /
 * (1 + rate/100)`), and is a different, unneeded computation here.
 */
export function percentOf(amount: Decimal, ratePercent: Decimal, scale = MONEY_SCALE): Decimal {
  const a = parts(amount);
  const r = parts(ratePercent);
  // True value = amount * (ratePercent / 100) = (a.units * r.units) / 10^(a.scale + r.scale + 2).
  // Re-scaling straight to the target `scale` in one division (rather than computing the exact
  // product first and rounding twice) avoids a second, separate rounding step.
  const exponent = a.scale + r.scale + 2 - scale;
  const numerator = a.units * r.units;
  if (exponent < 0) {
    // Only reachable if `scale` is set wider than `a.scale + r.scale + 2` already provides —
    // never the case for this file's own two-decimal-money callers — so shifting the numerator
    // UP (multiplying) rather than dividing keeps the function total instead of throwing on a
    // caller-supplied scale this codebase never actually asks for.
    return render(numerator * 10n ** BigInt(-exponent), scale);
  }
  const divisor = 10n ** BigInt(exponent);
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return render(negative ? -rounded : rounded, scale);
}
