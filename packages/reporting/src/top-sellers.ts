import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { rawCentsToDecimal, rawThousandthsToDecimal } from "@waitron/shared";
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
 * The dashboard's top-N products over a closed business-day range, ranked by summed line quantity,
 * each with its variants nested underneath (spec §6). A filed line carries no catalogue reference,
 * so the frozen STAFF names are the buckets: a parent row is every line whose `name` matches —
 * including lines sold as the product itself, with no variant — and a nested row is one non-null
 * `variant_name` within it. `limit` counts parent rows. The customer-facing text is never read.
 *
 * Same predicates as the VAT roll-up (`aggregateVatByRate`): the node predicate applies only when
 * `nodeId` is given, `activeSalesClause` drops voided sales and F3-canje substitutes, and
 * corrections are NOT excluded — their negative lines net quantity and total down.
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
  // Every sum is taken by the engine over whole-number counts and handed over as TEXT, so a parent's
  // figures are exact and never re-added here: the total counts whole cents (`rawCentsToDecimal`),
  // the quantity whole thousandths (`rawThousandthsToDecimal`, which refuses a sum past nine integer
  // digits with `shared.decimal_overflow`). One row per (parent, variant group); the group with no
  // variant name carries the parent's own sales and is not a nested row.
  const { rows } = await tx.execute<{
    name: string;
    parent_quantity: string;
    parent_total: string;
    variant_name: string | null;
    quantity: string;
    total: string;
  }>(sql`
    with scoped as (
      select sl.name, sl.variant_name, sl.quantity, sl.line_total
      from sale_lines sl
      join sales s on s.id = sl.sale_id
      where ${businessDayRangeClause(sql`s.issued_at`, input)}
        ${nodeClause}
        and ${activeSalesClause()}
    ),
    ranked as (
      select name, sum(quantity) as quantity, sum(line_total) as total
      from scoped
      group by name
      order by sum(quantity) desc, name asc
      limit ${input.limit}
    )
    select
      r.name as name,
      cast(r.quantity as text) as parent_quantity,
      cast(r.total as text) as parent_total,
      sc.variant_name as variant_name,
      cast(sum(sc.quantity) as text) as quantity,
      cast(sum(sc.line_total) as text) as total
    from ranked r
    join scoped sc on sc.name = r.name
    group by r.name, r.quantity, r.total, sc.variant_name
    order by r.quantity desc, r.name asc, sum(sc.quantity) desc, sc.variant_name asc
  `);
  const sellers = new Map<string, TopSeller>();
  for (const row of rows) {
    let seller = sellers.get(row.name);
    if (seller === undefined) {
      seller = {
        name: row.name,
        quantity: rawThousandthsToDecimal(row.parent_quantity),
        total: rawCentsToDecimal(row.parent_total),
        variants: [],
      };
      sellers.set(row.name, seller);
    }
    // A blank variant name reads as none, as `staffPresentationName` treats it.
    if (row.variant_name) {
      seller.variants.push({
        name: row.variant_name,
        quantity: rawThousandthsToDecimal(row.quantity),
        total: rawCentsToDecimal(row.total),
      });
    }
  }
  return [...sellers.values()];
}
