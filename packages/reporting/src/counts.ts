import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { activeSalesClause, businessDayClause, nodeScopeClause } from "./business-day.js";
import type { CloseCounts, DailyCloseInput } from "./types.js";

/**
 * Operational record counts for one node — or the whole venue when `input.nodeId` is omitted — over
 * one business day. `sales` and `corrections` are issued in the day, with the VAT summary's
 * exclusions (`activeSalesClause`). `voids` counts void EVENTS whose voided_at falls in the day.
 */
export async function computeCloseCounts(
  tx: Transaction,
  input: DailyCloseInput,
): Promise<CloseCounts> {
  const issued = await tx.execute<{ sales: number; corrections: number }>(sql`
    select
      count(*) filter (where s.corrects_sale_id is null) as sales,
      count(*) filter (where s.corrects_sale_id is not null) as corrections
    from sales s
    where ${businessDayClause(sql`s.issued_at`, input)}
      ${nodeScopeClause(input.nodeId)}
      and ${activeSalesClause()}
  `);

  const voided = await tx.execute<{ voids: number }>(sql`
    select count(*) as voids
    from sale_voids sv
    join sales s on s.id = sv.sale_id
    where ${businessDayClause(sql`sv.voided_at`, input)}
      ${nodeScopeClause(input.nodeId)}
  `);

  return {
    sales: issued.rows[0]!.sales,
    corrections: issued.rows[0]!.corrections,
    voids: voided.rows[0]!.voids,
  };
}
