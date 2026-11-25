import { eq } from "drizzle-orm";
import {
  lineServiceCancellations,
  unpaidDepartures,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { staffPresentationName } from "@waitron/menu";
import { thousandthsToDecimal } from "@waitron/shared";

/** A row of a bill served, or taken off service with its charge kept. */
export interface ServedBillDish {
  lineId: string;
  dishName: string;
  quantity: string;
}

/**
 * Every row of the bill served, and every dish (not its extras) taken off service with its charge
 * kept. Record unpaid departure writes kept-charge rows for the dishes it stops, at or after its
 * `recorded_at`; those were never served nor charged here, so they do not count. A set menu's price
 * row is written served, so it never counts: its dishes do.
 */
export async function servedOrCharged(tx: Transaction, billId: string): Promise<ServedBillDish[]> {
  const rows = await tx
    .select({
      line: workingOrderLines,
      kept: lineServiceCancellations.quantity,
      keptAt: lineServiceCancellations.cancelledAt,
      departedAt: unpaidDepartures.recordedAt,
    })
    .from(workingOrderLines)
    .leftJoin(lineServiceCancellations, eq(lineServiceCancellations.lineId, workingOrderLines.id))
    .leftJoin(
      unpaidDepartures,
      eq(unpaidDepartures.workingOrderId, workingOrderLines.workingOrderId),
    )
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
  return rows.flatMap(({ line, kept, keptAt, departedAt }) => {
    if (line.setMenuRole === "set_menu") return [];
    const departure = departedAt !== null && keptAt !== null && keptAt >= departedAt;
    const quantity = line.servedQuantity + (kept === null || departure ? 0 : kept);
    return quantity === 0
      ? []
      : [
          {
            lineId: line.id,
            dishName: staffPresentationName(line),
            quantity: thousandthsToDecimal(quantity),
          },
        ];
  });
}
