import { eq, inArray } from "drizzle-orm";
import { lineServiceCancellations, nowIso, workingOrderLines, type Transaction } from "@waitron/db";
import { decimal, divideDecimal, multiplyDecimal } from "@waitron/shared";

function componentCancellation(
  quantity: number,
  parentQuantity: number,
  cancelled: number,
): number {
  // Divide last so a recurring parent fraction cannot round the extra count early.
  return Number(
    divideDecimal(
      multiplyDecimal(decimal(String(quantity)), decimal(String(cancelled))),
      decimal(String(parentQuantity)),
      0,
    ),
  );
}

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

export function serviceCompletedAt(line: {
  quantity: number;
  servedQuantity: number;
  servedAt: string | null;
  cancelledQuantity: number;
  cancelledAt: string | null;
}): string | null {
  const quantities = serviceQuantities(line.quantity, line.servedQuantity, line.cancelledQuantity);
  if (quantities.remaining > 0) return null;
  if (quantities.active === 0) return line.cancelledAt;
  const servedAt = line.servedAt;
  const cancelledAt = line.cancelledAt;
  if (servedAt === null) return cancelledAt;
  if (cancelledAt === null) return servedAt;
  return Date.parse(servedAt) > Date.parse(cancelledAt) ? servedAt : cancelledAt;
}

export async function readLineCancellations(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<Map<string, number>> {
  if (lineIds.length === 0) return new Map();
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      quantity: workingOrderLines.quantity,
      parentId: workingOrderLines.parentLineId,
    })
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.id, [...lineIds]));
  const parentIds = [
    ...new Set(lines.flatMap((line) => (line.parentId === null ? [] : [line.parentId]))),
  ];
  const parents =
    parentIds.length === 0
      ? []
      : await tx
          .select({ id: workingOrderLines.id, quantity: workingOrderLines.quantity })
          .from(workingOrderLines)
          .where(inArray(workingOrderLines.id, parentIds));
  const parentQuantities = new Map(parents.map((parent) => [parent.id, parent.quantity]));
  const rows = await tx
    .select()
    .from(lineServiceCancellations)
    .where(
      inArray(lineServiceCancellations.lineId, [
        ...new Set(lines.map((line) => line.parentId ?? line.id)),
      ]),
    );
  const byParent = new Map(rows.map((row) => [row.lineId, row.quantity]));
  const result = new Map<string, number>();
  for (const line of lines) {
    const count = byParent.get(line.parentId ?? line.id);
    if (count !== undefined)
      result.set(
        line.id,
        line.parentId === null
          ? count
          : componentCancellation(line.quantity, parentQuantities.get(line.parentId)!, count),
      );
  }
  return result;
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
      parentId: workingOrderLines.parentLineId,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.id, sourceLineId));
  const [cancellation] = await tx
    .select()
    .from(lineServiceCancellations)
    .where(eq(lineServiceCancellations.lineId, sourceLineId));
  let cancelled = cancellation?.quantity ?? 0;
  if (source!.parentId !== null) {
    const [target] = await tx
      .select({ parentId: workingOrderLines.parentLineId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, targetLineId));
    // The parent has already split, while this extra still has its original quantity.
    const parents = await tx
      .select({
        id: workingOrderLines.id,
        quantity: workingOrderLines.quantity,
        cancelled: lineServiceCancellations.quantity,
      })
      .from(workingOrderLines)
      .leftJoin(lineServiceCancellations, eq(lineServiceCancellations.lineId, workingOrderLines.id))
      .where(inArray(workingOrderLines.id, [source!.parentId, target!.parentId!]));
    const left = parents.find((parent) => parent.id === source!.parentId)!;
    const right = parents.find((parent) => parent.id === target!.parentId)!;
    cancelled =
      componentCancellation(source!.quantity - moved, left.quantity, left.cancelled ?? 0) +
      componentCancellation(moved, right.quantity, right.cancelled ?? 0);
  }
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
