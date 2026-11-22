import type { Transaction } from "@waitron/db";
import { readTakeawayVatSchedules } from "@waitron/menu";
import { VAT_RATE_TABLE, type DatedRate, type Dining, type VatClass } from "@waitron/shared";

/** What {@link readLineVatRates} reads of a line. */
export interface RatedLine {
  productId: string | null;
  setMenuRole: "set_menu" | "dish" | null;
  vatClass: VatClass;
  takeawayVatClass: VatClass;
}

/**
 * Each line's dated rates, at its index, for an order sold `dining`. Eaten here, a line's eat-in
 * class. Taken away, a set-menu line its set menu's takeaway class, until set menus carry rates of
 * their own; any other line its product's takeaway rates, read for all lines in one query, and an
 * empty list for a product with none, which pricing refuses.
 */
export async function readLineVatRates(
  tx: Transaction,
  dining: Dining,
  lines: readonly RatedLine[],
): Promise<(readonly DatedRate[])[]> {
  if (dining === "eat_in") return lines.map((line) => VAT_RATE_TABLE[line.vatClass]);
  const productIds = [
    ...new Set(
      lines.flatMap((line) =>
        line.setMenuRole === "set_menu" || line.productId === null ? [] : [line.productId],
      ),
    ),
  ];
  const schedules = await readTakeawayVatSchedules(tx, productIds);
  return lines.map((line) => {
    if (line.setMenuRole === "set_menu") return VAT_RATE_TABLE[line.takeawayVatClass];
    return line.productId === null ? [] : (schedules.get(line.productId) ?? []);
  });
}
