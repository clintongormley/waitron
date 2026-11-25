import { centsToDecimal, type Decimal } from "@waitron/shared";

/** A stored price column read at the row, where null is a blank price rather than zero. */
export const priceOrNull = (cents: number | null): Decimal | null =>
  cents === null ? null : centsToDecimal(cents);
