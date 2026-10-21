import { compareDecimal, decimal } from "@waitron/shared";

/**
 * Free, or an amount that left the item at zero from its whole list value. A percentage is never
 * full here: it carries its own percentage, a whole one included.
 */
export function isFullComp(row: {
  action: string;
  beforeAmount: string;
  afterAmount: string;
  nominalValue: string;
}): boolean {
  if (row.action === "comp") return true;
  return (
    row.action === "discount_amount" &&
    compareDecimal(decimal(row.afterAmount), decimal("0")) === 0 &&
    compareDecimal(decimal(row.beforeAmount), decimal(row.nominalValue)) === 0
  );
}
