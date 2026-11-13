import { workingOrderLines, type Transaction } from "@waitron/db";
import { and, isNull, or, sql, type SQL } from "drizzle-orm";
import { VENUE_SERVICE } from "./modules.js";

type Line = { id: string; parentLineId: string | null };

export async function serviceDishPredicate(tx: Transaction, lines: readonly Line[]) {
  const lunches = await VENUE_SERVICE.readLunchLineIds(tx, [
    ...new Set(
      lines.flatMap((line) => [
        line.id,
        ...(line.parentLineId === null ? [] : [line.parentLineId]),
      ]),
    ),
  ]);
  return (line: Line): boolean =>
    line.parentLineId === null ? !lunches.has(line.id) : lunches.has(line.parentLineId);
}

export function serviceDishCondition(): SQL {
  return or(
    and(
      isNull(workingOrderLines.parentLineId),
      sql`not ${VENUE_SERVICE.lunchLineSql(sql`working_order_lines.id`)}`,
    ),
    and(
      sql`${workingOrderLines.parentLineId} is not null`,
      VENUE_SERVICE.lunchLineSql(sql`working_order_lines.parent_line_id`),
    ),
  )!;
}
