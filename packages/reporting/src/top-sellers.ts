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
 * The dashboard's top-N products over a closed business-day range, ranked by quantity, each with
 * its variants nested underneath. The frozen STAFF names are the buckets: a parent row is every
 * line whose `name` matches — including lines sold as the product itself, with no variant — and a
 * nested row is one non-blank `variant_name` within it. `limit` counts parent rows. The
 * customer-facing text is never read.
 *
 * Same predicates as the VAT roll-up (`issuedSalesClause`, `reversedSalesClause`); corrections
 * other than a replacement are NOT excluded — their negative lines net the total down. A correction
 * line naming no line nets its own quantity down too. One naming an original line (one that
 * corrects nothing) takes back that line's quantity only if it is the correction, in issue order
 * (time, then invoice number), at which the line's corrections first add up to its money (gross
 * where the line stored one, else net); any other counts no dishes. A correction of a correction
 * counts the opposite of what the line it corrects counted, whatever money it moves, judged at the
 * moment the first correction in its chain was issued. The sum leaves out a correction voided at or
 * before the moment the one being counted was issued, so a day's count never changes after the day.
 * It assumes a line's corrections, voided ones included, never take more than its money, as the
 * exact-split and whole-invoice paths refuse; past that, a void followed by a further correction
 * can return the dish twice. It also assumes a correction of a line that stored a gross states its
 * own, as the cancellation and the exact-split path do. It also assumes a corrected correction is
 * the only correction of that line, comes after every other correction of the original line, and,
 * if it counted the dish as sold again, is later reversed only in full.
 *
 * A divided takeaway set menu's dishes count at what they sold for: the net that goes with each
 * dish row's part of the set menu's price counts under the set menu it was divided from (a
 * corrective's, under the original sale's), shared by price when that sale has several.
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
      select sl.id, sl.sale_id, sl.name, sl.variant_name, sl.quantity, sl.line_total,
        sl.line_gross, sl.set_menu_role, sl.set_menu_part, sl.corrects_line_id, 1 as sign
      from sale_lines sl
      join sales s on s.id = sl.sale_id
      where ${issuedSalesClause(window)}
        and sl.advance_role is null
        ${nodeClause}
      union all
      select sl.id, sl.sale_id, sl.name, sl.variant_name, sl.quantity, sl.line_total,
        sl.line_gross, sl.set_menu_role, sl.set_menu_part, sl.corrects_line_id, -1
      from sale_voids sv
      join sales s on s.id = sv.sale_id
      join sale_lines sl on sl.sale_id = s.id
      where ${reversedSalesClause(window)}
        and sl.advance_role is null
        ${nodeClause}
    ),
    -- At the step whose beyond is null, target_id is an original line (one that corrects nothing)
    -- and line_id the correction naming it.
    chain(id, line_id, target_id, beyond, flip) as (
      select l.id, l.id, t.id, t.corrects_line_id, 1
      from lines l
      join sale_lines t on t.id = l.corrects_line_id
      union all
      select c.id, c.target_id, t.id, t.corrects_line_id, -c.flip
      from chain c
      join sale_lines t on t.id = c.beyond
    ),
    -- A dish row's part of a divided set menu's price, as net (rounded half away from zero), and
    -- the sale whose set menu it was divided from: the original sale, for a corrective's row.
    moved as (
      select l.id, l.sign, l.sale_id, coalesce(o.sale_id, l.sale_id) as owner_sale,
        cast(round(1.0 * l.line_total * l.set_menu_part / l.line_gross) as integer) as net
      from lines l
      left join chain c on c.id = l.id and c.beyond is null
      left join sale_lines o on o.id = c.target_id
      where l.set_menu_part is not null and l.set_menu_role is not 'set_menu'
        and l.line_gross is not null and l.line_gross != 0
        and exists (
          select 1 from sale_lines r
          where r.sale_id = coalesce(o.sale_id, l.sale_id)
            and r.set_menu_role = 'set_menu' and r.set_menu_part < 0
        )
    ),
    moved_totals as (
      select sale_id, sign, owner_sale, sum(net) as net
      from moved
      group by sale_id, sign, owner_sale
    ),
    -- Which divided set menu a dish row's part came from is not stored, so a sale's moved net is
    -- shared between its divided set menus by their prices, each taking the difference of
    -- cumulative truncated shares so the pieces add up to the whole.
    menus as (
      select r.sale_id, r.name, -r.set_menu_part as price,
        sum(-r.set_menu_part) over (partition by r.sale_id order by r.line_no) as upto,
        sum(-r.set_menu_part) over (partition by r.sale_id) as whole
      from sale_lines r
      where r.set_menu_role = 'set_menu' and r.set_menu_part < 0
        and r.sale_id in (select owner_sale from moved_totals)
    ),
    shares as (
      select mn.name, t.sign,
        t.net * mn.upto / mn.whole - t.net * (mn.upto - mn.price) / mn.whole as line_total
      from moved_totals t
      join menus mn on mn.sale_id = t.owner_sale
    ),
    -- Materialized, or the earlier sum's subquery runs again at each of its uses in scoped.
    counted as materialized (
      select l.name, l.variant_name, l.sign, l.quantity,
        l.line_total - coalesce(m.net, 0) as line_total, c.flip,
        il.quantity as line_quantity,
        coalesce(il.line_gross, il.line_total) as line_money,
        case when il.line_gross is null then dl.line_total else coalesce(dl.line_gross, 0) end
          as own,
        case when il.id is not null then (
          -- Null when no correction of this line came earlier.
          select sum(case when il.line_gross is null then cl.line_total
            else coalesce(cl.line_gross, 0) end)
          from sales cs
          join sale_lines cl on cl.sale_id = cs.id
          where cs.corrects_sale_id = il.sale_id and cl.corrects_line_id = il.id
            and (cs.issued_at, cs.invoice_number, cs.id, cl.line_no)
              < (ds.issued_at, ds.invoice_number, ds.id, dl.line_no)
            and not exists (
              select 1 from sale_voids cv where cv.sale_id = cs.id and cv.voided_at <= ds.issued_at
            )
        ) end as earlier
      from lines l
      left join moved m on m.id = l.id and m.sign = l.sign
      left join chain c on c.id = l.id and c.beyond is null
      left join sale_lines dl on dl.id = c.line_id
      left join sales ds on ds.id = dl.sale_id
      left join sale_lines il on il.id = c.target_id
    ),
    scoped as (
      select name, variant_name,
        sign * case
          when line_money is null then quantity
          when ${reaches(sql`line_money`, sql`coalesce(earlier, 0) + own`)}
            and (earlier is null or not ${reaches(sql`line_money`, sql`earlier`)})
            then -flip * line_quantity
          else 0
        end as quantity,
        sign * line_total as line_total
      from counted
      union all
      select name, null, 0, sign * line_total
      from shares
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
