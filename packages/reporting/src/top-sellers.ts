import { sql } from "drizzle-orm";
import { staffPresentationName } from "@waitron/catalogue";
import type { Transaction } from "@waitron/db";
import { centsToDecimal, decimal } from "@waitron/shared";
import {
  activeSalesClause,
  businessDayRangeClause,
  nodeScopeClause,
  validateBusinessDayRange,
  validateCutover,
  validateTimeZone,
} from "./business-day.js";
import type { TopSeller, TopSellersInput } from "./types.js";

/**
 * The dashboard's top-N products over a closed business-day range, ranked by summed line quantity.
 * Groups `sale_lines` on the frozen `name` AND `variant_name` snapshots — the STAFF names, the same
 * ones a sales report shows (CLAUDE.md's three-name table) — never the customer-facing text, which is
 * for a receipt or customer display instead. A filed line carries no product_id, so the label frozen
 * at sale time IS the bucket (architecture §6); a later catalogue rename can never reach back into a
 * completed row. Both columns are in the key because a product's variants are separate sellers: a
 * large coffee and a small one are ranked apart, which is what an operator is asking when they ask
 * what sold. The returned `name` is the two joined via `staffPresentationName`, so the row carries the
 * same label a till button shows. Same exclusions and predicates as the VAT roll-up
 * (`aggregateVatByRate`): the node predicate applies only when `nodeId` is given, and
 * `activeSalesClause` drops voided sales and
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
  const nodeClause = nodeScopeClause(input.nodeId);
  // Deterministic order: quantity desc, then the staff name/variant text as a stable tiebreak for ties.
  // `sale_lines.line_total` counts whole cents, so its sum is a count of cents that `centsToDecimal`
  // turns into the amount; `::int` keeps that sum in the column's own width and hands it back as a
  // number (an overflow raises 22003 rather than reporting a wrong figure). `quantity` is a
  // `numeric(12, 3)` and keeps its text cast — it is not money and did not move to cents.
  const { rows } = await tx.execute<{
    name: string;
    variant_name: string | null;
    quantity: string;
    total: number;
  }>(sql`
    select
      sl.name as name,
      sl.variant_name as variant_name,
      sum(sl.quantity)::numeric(12, 3)::text as quantity,
      sum(sl.line_total)::int as total
    from sale_lines sl
    join sales s on s.id = sl.sale_id
    where ${businessDayRangeClause(sql`s.issued_at`, input)}
      ${nodeClause}
      and ${activeSalesClause()}
    group by sl.name, sl.variant_name
    order by sum(sl.quantity) desc, sl.name asc, sl.variant_name asc
    limit ${input.limit}
  `);
  return rows.map((r) => ({
    name: staffPresentationName({ name: r.name, variantName: r.variant_name }),
    quantity: decimal(r.quantity),
    total: centsToDecimal(r.total),
  }));
}
