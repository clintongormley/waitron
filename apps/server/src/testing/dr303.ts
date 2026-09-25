import type { Decimal } from "@waitron/shared";

// An INDEPENDENT oracle for the modelo 303 export's box 27 — deliberately NOT the reporting
// serializer's own `formatNumericField` (nor any `@waitron/reporting` import), so a bug in that
// serializer cannot mask itself.

/** Box 27's fixed 0-based byte offset + length on página 1. */
export const BOX_27 = { offset: 1023, len: 17 } as const;

/**
 * Packs a Decimal into an AEAT fixed-width numeric field: magnitude in cents, right-aligned and
 * zero-filled, a negative value taking an 'N' in position 1.
 */
export function packAeatNumeric(value: Decimal, width: number): string {
  // Cents come from dropping the point, so a value not at 2 dp would pack the wrong magnitude.
  /* v8 ignore start -- unreachable: callers always pass a 2-dp addDecimal result; the throw guards a misuse */
  if (!/^-?\d+\.\d{2}$/.test(value)) {
    throw new Error(
      `packAeatNumeric: expected a 2-decimal money value, got ${JSON.stringify(value)}`,
    );
  }
  /* v8 ignore stop */
  const negative = value.startsWith("-");
  const magnitude = (negative ? value.slice(1) : value).replace(".", "");
  return negative ? "N" + magnitude.padStart(width - 1, "0") : magnitude.padStart(width, "0");
}
