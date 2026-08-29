import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { decimal } from "@waitron/shared";
import {
  activeSalesClause,
  businessDayRangeClause,
  validateBusinessDayRange,
  validateCutover,
  validateTimeZone,
} from "./business-day.js";
import type { TopSeller, TopSellersInput } from "./types.js";

/**
 * The dashboard's top-N products over a closed business-day range, ranked by summed line quantity.
 * Groups `sale_lines` on the frozen `descriptions` snapshot — a filed line carries no product_id, so
 * the label frozen at sale time IS the bucket (architecture §6); a later catalogue rename can never
 * reach back into a completed row. Same exclusions and predicates as the VAT roll-up
 * (`aggregateVatByRate`): the explicit tenant predicate is belt-and-suspenders over RLS, the node
 * predicate applies only when `nodeId` is given, and `activeSalesClause` drops voided sales and
 * F3-canje substitutes. Corrections (rectificativas) are NOT excluded — their negative lines net the
 * quantity and total down, so a returned coffee reduces its rank.
 *
 * Invalid inputs are a caller precondition and throw a plain `Error` (matching `business-day.ts`'s
 * validators — no registered error code), before any query runs. Consumed by the `/reports` routes.
 */
export async function computeTopSellers(
  tx: Transaction,
  input: TopSellersInput,
): Promise<TopSeller[]> {
  validateTimeZone(input.timeZone);
  validateCutover(input.dayCutover);
  validateBusinessDayRange(input);
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new Error(
      `reporting: top-sellers limit must be a positive integer: ${JSON.stringify(input.limit)}`,
    );
  }
  const nodeClause = input.nodeId ? sql`and s.node_id = ${input.nodeId}` : sql``;
  // `descriptions` comes back as a parsed object, not a string: node-postgres parses a jsonb column,
  // and PGlite (the test target) does too — confirmed empirically against `'{…}'::jsonb`, which
  // `tx.execute` returns as `typeof === "object"`. So no JSON.parse is needed on the read path.
  // Deterministic order: quantity desc, then the descriptions text as a stable tiebreak for ties.
  const { rows } = await tx.execute<{
    descriptions: Record<string, string>;
    quantity: string;
    total: string;
  }>(sql`
    select
      sl.descriptions as descriptions,
      sum(sl.quantity)::numeric(12, 3)::text as quantity,
      sum(sl.line_total)::numeric(12, 2)::text as total
    from sale_lines sl
    join sales s on s.tenant_id = sl.tenant_id and s.id = sl.sale_id
    where s.tenant_id = ${input.tenantId}
      ${nodeClause}
      and ${businessDayRangeClause(sql`s.issued_at`, input)}
      and ${activeSalesClause({ tenantId: input.tenantId })}
    group by sl.descriptions
    order by sum(sl.quantity) desc, sl.descriptions::text asc
    limit ${input.limit}
  `);
  return rows.map((r) => ({
    descriptions: r.descriptions,
    quantity: decimal(r.quantity),
    total: decimal(r.total),
  }));
}
