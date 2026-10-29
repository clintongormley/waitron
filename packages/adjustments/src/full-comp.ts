import { compareDecimal, decimal } from "@waitron/shared";

/**
 * Free, or an amount that left its subject at zero — an item, or the whole bill for a bill-wide
 * amount — whatever an earlier step took. A percentage is never full here: it carries its own
 * percentage, a whole one included.
 */
export function isFullComp(row: { action: string; afterAmount: string }): boolean {
  if (row.action === "comp") return true;
  return (
    row.action === "discount_amount" && compareDecimal(decimal(row.afterAmount), decimal("0")) === 0
  );
}
