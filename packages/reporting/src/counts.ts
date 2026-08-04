import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { businessDayClause } from "./business-day.js";
import type { CloseCounts, DailyCloseInput } from "./types.js";

/**
 * Operational record counts for one (tenant, node) over one business day. `sales` and `corrections`
 * are issued-in-day (excluding voided; `sales` also excludes F3-canje substitutes — same exclusions
 * as the VAT half). `voids` counts void EVENTS whose voided_at falls in the day, for this node's
 * sales. Belt-and-suspenders tenant/node predicates over RLS.
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
      and s.node_id = ${input.nodeId}
      and ${businessDayClause(sql`s.issued_at`, input)}
      and not exists (select 1 from sale_voids sv where sv.sale_id = s.id and sv.tenant_id = ${input.tenantId})
      and not exists (select 1 from sale_substitutions sub where sub.substitution_sale_id = s.id and sub.tenant_id = ${input.tenantId})
  `);

  const voided = await tx.execute<{ voids: number }>(sql`
    select count(*)::int as voids
    from sale_voids sv
    join sales s on s.id = sv.sale_id and s.tenant_id = ${input.tenantId}
    where sv.tenant_id = ${input.tenantId}
      and s.node_id = ${input.nodeId}
      and ${businessDayClause(sql`sv.voided_at`, input)}
  `);

  return {
    sales: issued.rows[0]!.sales,
    corrections: issued.rows[0]!.corrections,
    voids: voided.rows[0]!.voids,
  };
}
