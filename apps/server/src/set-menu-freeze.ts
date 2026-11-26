import { and, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Ending } from "@waitron/adjustments";
import {
  adjustmentEndings,
  adjustmentLines,
  adjustments,
  lineServiceCancellations,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import type { FrozenLineSources } from "@waitron/orders-sales/set-menu-grouping-plan.js";

/**
 * What freezes `lineIds` by name (D30): `reduced`, what a comp or discount took something off;
 * `held`, what a kept-charge cancel or service cancellation names. By the line, not the bill: a comp
 * stays on its bill while its line moves. A price below the list price, the other source, is read
 * from the line itself by `frozenLinesOf`. `ending`'s adjustments are read as ended.
 */
export async function frozenLineIdSources(
  tx: Transaction,
  lineIds: readonly string[],
  ending?: Ending,
): Promise<FrozenLineSources> {
  if (lineIds.length === 0) return { reduced: new Set(), held: new Set() };
  const ids = sql`(select value from json_each(${JSON.stringify(lineIds)}))`;
  const held = await tx
    .select({ lineId: adjustments.lineId })
    .from(adjustments)
    .where(
      and(
        inArray(adjustments.lineId, ids),
        eq(adjustments.action, "cancel"),
        eq(adjustments.chargeKept, true),
      ),
    )
    .union(
      tx
        .select({ lineId: lineServiceCancellations.lineId })
        .from(lineServiceCancellations)
        .where(inArray(lineServiceCancellations.lineId, ids)),
    );
  return {
    reduced: await reducedLineIds(tx, lineIds, ending?.adjustmentIds),
    held: new Set(held.flatMap(({ lineId }) => (lineId === null ? [] : [lineId]))),
  };
}

/**
 * Which of `lineIds` a comp or discount took something off that has not ended on the bill the line
 * is on now, leaving out `ended` as well.
 */
export async function reducedLineIds(
  tx: Transaction,
  lineIds: readonly string[],
  ended: readonly string[] = [],
): Promise<Set<string>> {
  // By the line, not the bill: Split after print copies a comp's rows onto the new lines, and a
  // move leaves them pointing at the moved line, while the comp itself stays on the bill it was
  // made on.
  const reduced = await tx
    .select({ lineId: adjustmentLines.lineId })
    .from(adjustmentLines)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, adjustmentLines.lineId))
    .leftJoin(
      adjustmentEndings,
      and(
        eq(adjustmentEndings.adjustmentId, adjustmentLines.adjustmentId),
        eq(adjustmentEndings.workingOrderId, workingOrderLines.workingOrderId),
      ),
    )
    .where(
      and(
        inArray(
          adjustmentLines.lineId,
          sql`(select value from json_each(${JSON.stringify(lineIds)}))`,
        ),
        gt(adjustmentLines.reduction, 0),
        isNull(adjustmentEndings.id),
        notInArray(adjustmentLines.adjustmentId, [...ended]),
      ),
    );
  return new Set(reduced.map(({ lineId }) => lineId));
}
