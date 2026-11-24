import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import {
  adjustmentLines,
  adjustments,
  billPaymentLines,
  lineServiceCancellations,
  type Transaction,
} from "@waitron/db";

/**
 * Which of `lineIds` a comp, discount, kept-charge cancel, service cancellation or bill payment
 * names (D15). By the line, not the bill: a comp stays on its bill while its line moves. A stamped
 * list price, the other source, is read from the line itself by `frozenLinesOf`.
 */
export async function namedFrozenLineIds(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<Set<string>> {
  if (lineIds.length === 0) return new Set();
  const ids = sql`(select value from json_each(${JSON.stringify(lineIds)}))`;
  const named = new Set<string>();
  const adjusted = await tx
    .select({ lineId: adjustments.lineId })
    .from(adjustments)
    .where(
      and(
        inArray(adjustments.lineId, ids),
        or(ne(adjustments.action, "cancel"), eq(adjustments.chargeKept, true)),
      ),
    );
  for (const { lineId } of adjusted) if (lineId !== null) named.add(lineId);
  const reduced = await tx
    .select({ lineId: adjustmentLines.lineId })
    .from(adjustmentLines)
    .where(inArray(adjustmentLines.lineId, ids));
  for (const { lineId } of reduced) named.add(lineId);
  const cancelled = await tx
    .select({ lineId: lineServiceCancellations.lineId })
    .from(lineServiceCancellations)
    .where(inArray(lineServiceCancellations.lineId, ids));
  for (const { lineId } of cancelled) named.add(lineId);
  const paid = await tx
    .select({ lineId: billPaymentLines.lineId })
    .from(billPaymentLines)
    .where(inArray(billPaymentLines.lineId, ids));
  for (const { lineId } of paid) named.add(lineId);
  return named;
}
