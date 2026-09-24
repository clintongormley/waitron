import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { businessDayWindow, issuedSalesClause, nodeScopeClause } from "./business-day.js";
import type { CloseCounts, DailyCloseInput } from "./types.js";

/**
 * Operational record counts for one node — or the whole venue when `input.nodeId` is omitted — over
 * one business day. `sales` and `corrections` are selected by `issuedSalesClause`; `voids` counts
 * void EVENTS whose voided_at falls in the day.
 */
export async function computeCloseCounts(
  tx: Transaction,
  input: DailyCloseInput,
): Promise<CloseCounts> {
  const window = businessDayWindow(input);
  const issued = await tx.execute<{ sales: number; corrections: number }>(sql`
    select
      count(*) filter (where s.corrects_sale_id is null) as sales,
      count(*) filter (where s.corrects_sale_id is not null) as corrections
    from sales s
    where ${issuedSalesClause(window)}
      ${nodeScopeClause(input.nodeId)}
  `);

  const voided = await tx.execute<{ voids: number }>(sql`
    select count(*) as voids
    from sale_voids sv
    join sales s on s.id = sv.sale_id
    where ${window(sql`sv.voided_at`)}
      ${nodeScopeClause(input.nodeId)}
  `);

  return {
    sales: issued.rows[0]!.sales,
    corrections: issued.rows[0]!.corrections,
    voids: voided.rows[0]!.voids,
  };
}
