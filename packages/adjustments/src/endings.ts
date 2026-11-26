import { and, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import {
  adjustmentEndingLines,
  adjustmentEndings,
  adjustmentLines,
  insertInChunks,
  workingOrderLines,
  type AdjustmentEndingWhy,
  type Transaction,
} from "@waitron/db";
import {
  AppError,
  addDecimal,
  centsToDecimal,
  compareDecimal,
  decimalToCents,
  divideDecimal,
  MONEY_SCALE,
  multiplyDecimal,
  sumDecimals,
  thousandthsToDecimal,
  type Decimal,
} from "@waitron/shared";
import { nearestWeighedUnitPrice } from "./spread.js";

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

/** An `adjustment_lines` row not yet given back, on a row now on the bill asked about. */
interface Taken {
  adjustmentLineId: string;
  lineId: string;
  reduction: number;
  quantityThen: number;
  quantity: number;
  priceQuantity: number;
  unit: number;
  lineTotal: number;
  list: number | null;
}

async function standingOn(
  tx: Transaction,
  query: { workingOrderId: string; adjustmentIds: readonly string[] },
): Promise<Taken[]> {
  if (query.adjustmentIds.length === 0) return [];
  return tx
    .select({
      adjustmentLineId: adjustmentLines.id,
      lineId: workingOrderLines.id,
      reduction: adjustmentLines.reduction,
      quantityThen: adjustmentLines.quantity,
      quantity: workingOrderLines.quantity,
      priceQuantity: workingOrderLines.priceQuantity,
      unit: workingOrderLines.unitPriceGross,
      lineTotal: workingOrderLines.lineTotal,
      list: workingOrderLines.listUnitPriceGross,
    })
    .from(adjustmentLines)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, adjustmentLines.lineId))
    .leftJoin(adjustmentEndingLines, eq(adjustmentEndingLines.adjustmentLineId, adjustmentLines.id))
    .where(
      and(
        inArray(
          adjustmentLines.adjustmentId,
          sql`(select value from json_each(${JSON.stringify(query.adjustmentIds)}))`,
        ),
        eq(workingOrderLines.workingOrderId, query.workingOrderId),
        gt(adjustmentLines.reduction, 0),
        isNull(adjustmentEndingLines.id),
      ),
    )
    .orderBy(workingOrderLines.lineNo, workingOrderLines.id);
}

/** Which of `lineIds` a comp or discount other than `ending` still takes something off. */
async function reducedBesides(
  tx: Transaction,
  lineIds: readonly string[],
  ending: readonly string[],
): Promise<Set<string>> {
  const rows = await tx
    .select({ lineId: adjustmentLines.lineId })
    .from(adjustmentLines)
    .leftJoin(adjustmentEndingLines, eq(adjustmentEndingLines.adjustmentLineId, adjustmentLines.id))
    .where(
      and(
        inArray(
          adjustmentLines.lineId,
          sql`(select value from json_each(${JSON.stringify(lineIds)}))`,
        ),
        notInArray(
          adjustmentLines.adjustmentId,
          sql`(select value from json_each(${JSON.stringify(ending)}))`,
        ),
        gt(adjustmentLines.reduction, 0),
        isNull(adjustmentEndingLines.id),
      ),
    );
  return new Set(rows.map(({ lineId }) => lineId));
}

function totalAt(unit: Decimal, row: Taken): Decimal {
  return divideDecimal(
    multiplyDecimal(unit, thousandthsToDecimal(row.quantity)),
    thousandthsToDecimal(row.priceQuantity),
    MONEY_SCALE,
  );
}

/**
 * A row's price once `taken` comes off it. Given back the last thing taken off it, it is at its
 * stamped list price again. Otherwise its total rises by what was taken off the quantity it holds
 * now, never past the list price's, and the unit price is chosen for that total as the comp window
 * chose it (`nearestWeighedUnitPrice`), so a row sold by weight is put back exactly.
 */
function restoreOf(taken: readonly Taken[], stillReduced: boolean): EndingRestore {
  const row = taken[0]!;
  const unchanged = {
    lineId: row.lineId,
    unitPriceGross: row.unit,
    lineTotal: row.lineTotal,
    listUnitPriceGross: row.list,
  };
  if (row.list === null) return unchanged;
  const list = centsToDecimal(row.list);
  const listTotal = totalAt(list, row);
  if (!stillReduced) {
    return {
      ...unchanged,
      unitPriceGross: row.list,
      lineTotal: decimalToCents(listTotal),
      listUnitPriceGross: null,
    };
  }
  // A row records what was taken off the quantity its line held then.
  const back = sumDecimals(
    taken.map((one) =>
      divideDecimal(
        multiplyDecimal(centsToDecimal(one.reduction), thousandthsToDecimal(row.quantity)),
        thousandthsToDecimal(one.quantityThen),
        MONEY_SCALE,
      ),
    ),
  );
  const raised = addDecimal(centsToDecimal(row.lineTotal), back);
  const target = compareDecimal(raised, listTotal) > 0 ? listTotal : raised;
  const unit = nearestWeighedUnitPrice(
    list,
    thousandthsToDecimal(row.quantity),
    target,
    thousandthsToDecimal(row.priceQuantity),
  );
  return {
    lineId: row.lineId,
    unitPriceGross: decimalToCents(unit),
    lineTotal: decimalToCents(totalAt(unit, row)),
    listUnitPriceGross: compareDecimal(unit, list) === 0 ? null : row.list,
  };
}

async function restoresOf(
  tx: Transaction,
  taken: readonly Taken[],
  adjustmentIds: readonly string[],
): Promise<EndingRestore[]> {
  if (taken.length === 0) return [];
  const byLine = new Map<string, Taken[]>();
  for (const one of taken) byLine.set(one.lineId, [...(byLine.get(one.lineId) ?? []), one]);
  const besides = await reducedBesides(tx, [...byLine.keys()], adjustmentIds);
  return [...byLine.values()].map((rows) => restoreOf(rows, besides.has(rows[0]!.lineId)));
}

/**
 * What each row now on `workingOrderId` that `adjustmentIds` took something off, and has not given
 * back, would cost once they give it back. Writes nothing.
 */
export async function endingRestores(
  tx: Transaction,
  query: { workingOrderId: string; adjustmentIds: readonly string[] },
): Promise<EndingRestore[]> {
  return restoresOf(tx, await standingOn(tx, query), query.adjustmentIds);
}

/**
 * Ends `adjustmentId` on `workingOrderId`: records the ending and each row it gives back, then
 * writes exactly what {@link endingRestores} answers. A row is given back once, wherever it moves
 * after; an ending that would give nothing back is refused `adjustment.not_standing`. `lineId` is
 * the line a notice offers it again on.
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
  const { adjustmentId, workingOrderId } = ending;
  const taken = await standingOn(tx, { workingOrderId, adjustmentIds: [adjustmentId] });
  if (taken.length === 0) {
    throw new AppError("adjustment.not_standing", { adjustmentId, workingOrderId });
  }
  const restores = await restoresOf(tx, taken, [adjustmentId]);
  const [written] = await tx
    .insert(adjustmentEndings)
    .values({
      adjustmentId,
      workingOrderId,
      why: ending.why,
      dishName: ending.dishName,
      lineId: ending.lineId ?? null,
    })
    .returning({ id: adjustmentEndings.id });
  await insertInChunks(
    tx,
    adjustmentEndingLines,
    taken.map((one) => ({ endingId: written!.id, adjustmentLineId: one.adjustmentLineId })),
  );
  for (const { lineId, ...price } of restores) {
    await tx.update(workingOrderLines).set(price).where(eq(workingOrderLines.id, lineId));
  }
}
