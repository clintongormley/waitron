import { eq, exists, or } from "drizzle-orm";
import { orderDraftRecalledLines, workingOrderLines, type Transaction } from "@waitron/db";

/** A recalled parent and its extras remain charged, but are no longer sent work. */
export function isRecalledDish(tx: Transaction) {
  return exists(
    tx
      .select({ id: orderDraftRecalledLines.id })
      .from(orderDraftRecalledLines)
      .where(
        or(
          eq(orderDraftRecalledLines.sourceLineId, workingOrderLines.id),
          eq(orderDraftRecalledLines.sourceLineId, workingOrderLines.parentLineId),
        ),
      ),
  );
}
