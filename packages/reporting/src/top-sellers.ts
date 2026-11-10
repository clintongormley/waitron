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

/** Whether corrections summing to `returned` (negative for a positive line) cover `money`. */
function reaches(money: SQL, returned: SQL): SQL {
  return sql`(case when ${money} >= 0 then ${money} + ${returned} <= 0
    else ${money} + ${returned} >= 0 end)`;
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
 * (gross where the line stored one, else net); any other counts no dishes. The sum leaves out a
 * correction voided at or before the moment the one being counted was issued, so a day's count
 * never changes after the day; a void reverses exactly what its sale was counted as. It assumes a
 * line's corrections, voided ones included, never take more than its money, as the exact-split and
 * whole-invoice paths refuse; past that, a void followed by a further correction can return the
 * dish twice.
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
    with lines as (
      select sl.name, sl.variant_name, sl.quantity, sl.line_total, sl.line_gross, sl.line_no,
        sl.corrects_line_id, s.id as sale_id, s.issued_at, 1 as sign
      from sale_lines sl
      join sales s on s.id = sl.sale_id
      where ${issuedSalesClause(window)}
        ${nodeClause}
      union all
      select sl.name, sl.variant_name, sl.quantity, sl.line_total, sl.line_gross, sl.line_no,
        sl.corrects_line_id, s.id, s.issued_at, -1
      from sale_voids sv
      join sales s on s.id = sv.sale_id
      join sale_lines sl on sl.sale_id = s.id
      where ${reversedSalesClause(window)}
        ${nodeClause}
    ),
    -- Materialized so each correction line's earlier sum is taken once, not at every use.
    counted as materialized (
      select l.name, l.variant_name, l.sign, l.quantity, l.line_total,
        il.quantity as line_quantity,
        coalesce(il.line_gross, il.line_total) as line_money,
        case when il.line_gross is null then l.line_total else coalesce(l.line_gross, 0) end
          as own,
        case when il.id is not null then (
          -- Null when no correction of this line came earlier.
          select sum(case when il.line_gross is null then cl.line_total
            else coalesce(cl.line_gross, 0) end)
          from sales cs indexed by sales_corrects_idx
          join sale_lines cl indexed by sale_lines_sale_idx on cl.sale_id = cs.id
          where cs.corrects_sale_id = il.sale_id and cl.corrects_line_id = il.id
            and (cs.issued_at, cs.id, cl.line_no) < (l.issued_at, l.sale_id, l.line_no)
            and not exists (
              select 1 from sale_voids cv where cv.sale_id = cs.id and cv.voided_at <= l.issued_at
            )
        ) end as earlier
      from lines l
      left join sale_lines il on il.id = l.corrects_line_id
    ),
    scoped as (
      select name, variant_name,
        sign * case
          when line_money is null then quantity
          when ${reaches(sql`line_money`, sql`coalesce(earlier, 0) + own`)}
            and (earlier is null or not ${reaches(sql`line_money`, sql`earlier`)})
            then -line_quantity
          else 0
        end as quantity,
        sign * line_total as line_total
      from counted
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
