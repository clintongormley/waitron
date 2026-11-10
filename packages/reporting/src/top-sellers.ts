import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { rawCentsToDecimal, rawThousandthsToDecimal } from "@waitron/shared";
import {
  issuedSalesClause,
  nodeScopeClause,
  reversedSalesClause,
  validatedRangeWindow,
} from "./business-day.js";
import type { TopSeller, TopSellersInput } from "./types.js";

/** Whether corrections summing to `returned` (negative for a positive line) cover `line_money`. */
function reaches(returned: SQL): SQL {
  return sql`(case when line_money >= 0 then line_money + ${returned} <= 0
    else line_money + ${returned} >= 0 end)`;
}

/**
 * The dashboard's top-N products over a closed business-day range, ranked by summed line quantity,
 * each with its variants nested underneath. The frozen STAFF names are the buckets: a parent row is
 * every line whose `name` matches — including lines sold as the product itself, with no variant —
 * and a nested row is one non-blank `variant_name` within it. `limit` counts parent rows. The customer-facing text is never read.
 *
 * Same predicates as the VAT roll-up (`issuedSalesClause`, `reversedSalesClause`); corrections are
 * NOT excluded — their negative lines net the total down. A correction line naming no invoice line
 * nets its own quantity down too. One naming an invoice line takes back that line's quantity only if
 * it is the correction, in issue order, at which the line's corrections first add up to its money
 * (gross where the line stored one, else net); any other counts no dishes.
 *
 * Invalid inputs are a caller precondition and throw a plain `Error` before any query runs.
 */
export async function computeTopSellers(
  tx: Transaction,
  input: TopSellersInput,
): Promise<TopSeller[]> {
  const window = validatedRangeWindow(input);
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new Error(
      `reporting: top-sellers limit must be a positive integer: ${JSON.stringify(input.limit)}`,
    );
  }
  const nodeClause = nodeScopeClause(input.nodeIds);
  // Every sum is taken by the engine over integer counts (cents, thousandths) and handed over as
  // TEXT, so a parent's figures are exact and never re-added here. One row per (parent, variant
  // group); the group with no variant name carries the parent's own sales and is not a nested row.
  const { rows } = await tx.execute<{
    name: string;
    parent_quantity: string;
    parent_total: string;
    variant_name: string | null;
    quantity: string;
    total: string;
  }>(sql`
    -- Materialized so each correction line's earlier sum is taken once, not at every use.
    with issued as materialized (
      select sl.name, sl.variant_name, sl.quantity, sl.line_total,
        il.quantity as line_quantity,
        coalesce(il.line_gross, il.line_total) as line_money,
        case when il.line_gross is null then sl.line_total else coalesce(sl.line_gross, 0) end
          as own,
        case when il.id is not null then (
          -- Null when no correction of this line came earlier.
          select sum(case when il.line_gross is null then cl.line_total
            else coalesce(cl.line_gross, 0) end)
          from sales cs indexed by sales_corrects_idx
          join sale_lines cl indexed by sale_lines_sale_idx on cl.sale_id = cs.id
          where cs.corrects_sale_id = il.sale_id and cl.corrects_line_id = il.id
            and (cs.issued_at, cs.id, cl.line_no) < (s.issued_at, s.id, sl.line_no)
        ) end as earlier
      from sale_lines sl
      join sales s on s.id = sl.sale_id
      left join sale_lines il on il.id = sl.corrects_line_id
      where ${issuedSalesClause(window)}
        ${nodeClause}
    ),
    scoped as (
      select name, variant_name,
        case
          when line_money is null then quantity
          when ${reaches(sql`coalesce(earlier, 0) + own`)}
            and (earlier is null or not ${reaches(sql`earlier`)}) then -line_quantity
          else 0
        end as quantity,
        line_total
      from issued
      union all
      select sl.name, sl.variant_name, -sl.quantity, -sl.line_total
      from sale_voids sv
      join sales s on s.id = sv.sale_id
      join sale_lines sl on sl.sale_id = s.id
      where ${reversedSalesClause(window)}
        ${nodeClause}
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
