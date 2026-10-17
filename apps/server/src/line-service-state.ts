import { eq, inArray } from "drizzle-orm";
import { lineServiceCancellations, nowIso, workingOrderLines, type Transaction } from "@waitron/db";

export function serviceQuantities(
  quantity: number,
  served: number,
  cancelled: number,
): {
  active: number;
  served: number;
  remaining: number;
} {
  const active = Math.max(0, quantity - cancelled);
  const actualServed = Math.min(served, active);
  return { active, served: actualServed, remaining: active - actualServed };
}

export async function readLineCancellations(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<Map<string, number>> {
  if (lineIds.length === 0) return new Map();
  const rows = await tx
    .select({
      lineId: lineServiceCancellations.lineId,
      quantity: lineServiceCancellations.quantity,
    })
    .from(lineServiceCancellations)
    .where(inArray(lineServiceCancellations.lineId, [...lineIds]));
  return new Map(rows.map((row) => [row.lineId, row.quantity]));
}

// The target row exists; the source still holds its pre-split quantity, in whole thousandths.
export async function splitLineServiceState(
  tx: Transaction,
  sourceLineId: string,
  targetLineId: string,
  moved: number,
): Promise<void> {
  const [source] = await tx
    .select({
      quantity: workingOrderLines.quantity,
      served: workingOrderLines.servedQuantity,
      servedAt: workingOrderLines.servedAt,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.id, sourceLineId));
  const [cancellation] = await tx
    .select()
    .from(lineServiceCancellations)
    .where(eq(lineServiceCancellations.lineId, sourceLineId));
  const cancelled = cancellation?.quantity ?? 0;
  const movedCancelled = Math.min(moved, cancelled);
  const leftCancelled = cancelled - movedCancelled;
  const actual = serviceQuantities(source!.quantity, source!.served, cancelled);
  const leftActive = source!.quantity - moved - leftCancelled;
  const movedActive = moved - movedCancelled;
  // Serving stays with the source while it has active food; only the overflow moves.
  const leftServed = Math.min(actual.served, leftActive);
  const movedServed = actual.served - leftServed;
  const servedAt = source!.servedAt ?? nowIso();
  await tx
    .update(workingOrderLines)
    .set({
      servedQuantity: leftServed,
      servedAt: leftServed > 0 && leftServed === leftActive ? servedAt : null,
    })
    .where(eq(workingOrderLines.id, sourceLineId));
  await tx
    .update(workingOrderLines)
    .set({
      servedQuantity: movedServed,
      servedAt: movedServed > 0 && movedServed === movedActive ? servedAt : null,
    })
    .where(eq(workingOrderLines.id, targetLineId));
  if (cancellation !== undefined) {
    if (leftCancelled > 0) {
      await tx
        .update(lineServiceCancellations)
        .set({ quantity: leftCancelled })
        .where(eq(lineServiceCancellations.lineId, sourceLineId));
    } else {
      await tx
        .delete(lineServiceCancellations)
        .where(eq(lineServiceCancellations.lineId, sourceLineId));
    }
    await tx
      .insert(lineServiceCancellations)
      .values({ ...cancellation, lineId: targetLineId, quantity: movedCancelled });
  }
}
