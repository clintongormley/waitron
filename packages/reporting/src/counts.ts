import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { activeSalesClause, businessDayClause, nodeScopeClause } from "./business-day.js";
import type { CloseCounts, DailyCloseInput } from "./types.js";

/**
 * Operational record counts for one (tenant, node) — or the whole tenant when `input.nodeId` is
 * omitted — over one business day. `sales` and `corrections` are issued-in-day (excluding voided;
 * `sales` also excludes F3-canje substitutes — same exclusions as the VAT half). `voids` counts void
 * EVENTS whose voided_at falls in the day, for this node's sales. The node predicate is applied via
 * `nodeScopeClause` only when a node is fixed (a venue-wide overview omits it). Belt-and-suspenders
 * tenant/node predicates over RLS.
 */
export async function computeCloseCounts(
  tx: Transaction,
  input: DailyCloseInput,
): Promise<CloseCounts> {
  const issued = await tx.execute<{ sales: number; corrections: number }>(sql`
    select
      count(*) filter (where s.corrects_sale_id is null)::int as sales,
      count(*) filter (where s.corrects_sale_id is not null)::int as corrections
    from sales s
    where s.tenant_id = ${input.tenantId}
      ${nodeScopeClause(input.nodeId)}
      and ${businessDayClause(sql`s.issued_at`, input)}
      and ${activeSalesClause(input)}
  `);

  const voided = await tx.execute<{ voids: number }>(sql`
    select count(*)::int as voids
    from sale_voids sv
    join sales s on s.id = sv.sale_id and s.tenant_id = ${input.tenantId}
    where sv.tenant_id = ${input.tenantId}
      ${nodeScopeClause(input.nodeId)}
      and ${businessDayClause(sql`sv.voided_at`, input)}
  `);

  return {
    sales: issued.rows[0]!.sales,
    corrections: issued.rows[0]!.corrections,
    voids: voided.rows[0]!.voids,
  };
}
