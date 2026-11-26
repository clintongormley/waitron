import { and, eq, gt, inArray } from "drizzle-orm";
import {
  adjustmentEndings,
  adjustmentLines,
  workingOrderLines,
  type AdjustmentEndingWhy,
  type Transaction,
} from "@waitron/db";
import {
  addDecimal,
  centsToDecimal,
  compareDecimal,
  decimalToCents,
  divideDecimal,
  MONEY_SCALE,
  multiplyDecimal,
  thousandthsToDecimal,
  type Decimal,
} from "@waitron/shared";

/** A row's price once the comps or discounts ending on it give back what they took, in cents. */
export interface EndingRestore {
  lineId: string;
  unitPriceGross: number;
  lineTotal: number;
  /** Null once the price is back at the stamped list price. */
  listUnitPriceGross: number | null;
}

/** Comps or discounts a preview works out as ended on one bill, and what {@link endingRestores}
 * answers for them there. */
export interface Ending {
  adjustmentIds: readonly string[];
  restores: readonly EndingRestore[];
}

/**
 * What each row now on `workingOrderId` that `adjustmentIds` took something off would cost once they
 * give it back. Writes nothing.
 */
export async function endingRestores(
  tx: Transaction,
  query: { workingOrderId: string; adjustmentIds: readonly string[] },
): Promise<EndingRestore[]> {
  if (query.adjustmentIds.length === 0) return [];
  const taken = await tx
    .select({
      lineId: workingOrderLines.id,
      reduction: adjustmentLines.reduction,
      quantityThen: adjustmentLines.quantity,
      quantity: workingOrderLines.quantity,
      priceQuantity: workingOrderLines.priceQuantity,
      unit: workingOrderLines.unitPriceGross,
      list: workingOrderLines.listUnitPriceGross,
    })
    .from(adjustmentLines)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, adjustmentLines.lineId))
    .where(
      and(
        inArray(adjustmentLines.adjustmentId, [...query.adjustmentIds]),
        eq(workingOrderLines.workingOrderId, query.workingOrderId),
        gt(adjustmentLines.reduction, 0),
      ),
    )
    .orderBy(workingOrderLines.lineNo, workingOrderLines.id);
  const rows = new Map<string, { row: (typeof taken)[number]; unit: Decimal }>();
  for (const one of taken) {
    // A row records what was taken off the quantity its line held then, so its unit took that
    // amount's share per price quantity.
    const back = divideDecimal(
      multiplyDecimal(centsToDecimal(one.reduction), thousandthsToDecimal(one.priceQuantity)),
      thousandthsToDecimal(one.quantityThen),
      MONEY_SCALE,
    );
    const held = rows.get(one.lineId);
    rows.set(one.lineId, {
      row: one,
      unit: addDecimal(held?.unit ?? centsToDecimal(one.unit), back),
    });
  }
  return [...rows.values()].map(({ row, unit }) => {
    const list = row.list === null ? null : centsToDecimal(row.list);
    const restored = list !== null && compareDecimal(unit, list) > 0 ? list : unit;
    const atList = list !== null && compareDecimal(restored, list) === 0;
    return {
      lineId: row.lineId,
      unitPriceGross: decimalToCents(restored),
      lineTotal: decimalToCents(
        divideDecimal(
          multiplyDecimal(restored, thousandthsToDecimal(row.quantity)),
          thousandthsToDecimal(row.priceQuantity),
          MONEY_SCALE,
        ),
      ),
      listUnitPriceGross: atList ? null : row.list,
    };
  });
}

/**
 * Ends `adjustmentId` on `workingOrderId`: writes exactly what {@link endingRestores} answers for
 * it, then the ending. An adjustment ends at most once on each bill
 * (`adjustment_endings_adjustment_order_key`). `lineId` is the line a notice offers it again on.
 */
export async function endAdjustment(
  tx: Transaction,
  ending: {
    adjustmentId: string;
    workingOrderId: string;
    why: AdjustmentEndingWhy;
    dishName: string;
    lineId?: string;
  },
): Promise<void> {
  const restores = await endingRestores(tx, {
    workingOrderId: ending.workingOrderId,
    adjustmentIds: [ending.adjustmentId],
  });
  for (const { lineId, ...price } of restores) {
    await tx.update(workingOrderLines).set(price).where(eq(workingOrderLines.id, lineId));
  }
  await tx.insert(adjustmentEndings).values({
    adjustmentId: ending.adjustmentId,
    workingOrderId: ending.workingOrderId,
    why: ending.why,
    dishName: ending.dishName,
    lineId: ending.lineId ?? null,
  });
}
