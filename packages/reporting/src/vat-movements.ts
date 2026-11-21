import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import {
  decimal,
  MONEY_SCALE,
  negateDecimal,
  saleId as brandSaleId,
  toScale,
} from "@waitron/shared";
import type { Decimal, SaleId } from "@waitron/shared";
import { periodDateFilter, validatePeriod } from "./period.js";
import type { LiquidationPeriod } from "./period.js";

/**
 * `invoice` is an ordinary invoice whose own day and issue date fall in one period of the asked
 * period's kind; `issued_late` is one whose two dates fall in different periods.
 */
export type VatMovementKind =
  "invoice" | "issued_late" | "correction" | "void" | "date_moved_out" | "date_moved_in";

/** One rate line of one VAT movement, signed. Days are civil dates, `"YYYY-MM-DD"`. */
export interface VatMovement {
  rate: Decimal;
  base: Decimal;
  tax: Decimal;
  madeDay: string;
  belongsDay: string;
  kind: VatMovementKind;
  saleId: SaleId;
  correctedSaleId: SaleId | null;
}

/** The filed issue date of `sales` row `alias`, as `saleVatDay` reads it. */
function issueDay(alias: string): SQL {
  const s = sql.raw(alias);
  return sql`date(${s}.issued_at, printf('%+d minutes', ${s}.issued_offset_minutes))`;
}

/** An ordinary invoice's own day: its `supply_day`, else its issue date. */
function ownDay(alias: string): SQL {
  return sql`coalesce(${sql.raw(alias)}.supply_day, ${issueDay(alias)})`;
}

/**
 * Bounds on the stored stamp of a sale whose civil date lies in the period, as `"YYYY-MM-DD"`
 * strings that compare with a stamp: `from` is the day before the first day and `before` the day
 * after the last day plus one. `sales_issued_offset_ck` keeps an offset within ±840 minutes, so a
 * stamp is never more than a day from its civil date.
 */
function stampBounds(year: number, period: LiquidationPeriod): { from: string; before: string } {
  const [first, months] =
    period.kind === "month"
      ? [period.month, 1]
      : period.kind === "quarter"
        ? [3 * period.quarter - 2, 3]
        : [1, 12];
  const day = (n: number, d: number) =>
    new Date(Date.UTC(year, n - 1, d)).toISOString().slice(0, 10);
  return { from: day(first, 0), before: day(first + months, 2) };
}

/**
 * Every VAT movement that belongs to the period or was made in it, one row per rate line of the
 * movement's `vat_breakdown`. The movement rules are the table in
 * `docs/superpowers/plans/2026-11-19-adviser-corrections-report.md` → Design.
 */
export async function vatMovements(
  tx: Transaction,
  input: { year: number; period: LiquidationPeriod },
): Promise<VatMovement[]> {
  validatePeriod(input.year, input.period);
  const inPeriod = (day: SQL): SQL => periodDateFilter(day, input.year, input.period);
  // Only an ordinary invoice is bounded by date: its supply day, when kept, is earlier than its
  // issue day from the same clock reading (`record-sale.ts`), so it belongs no later than it was
  // made, even on a wrong clock. One with no supply day belongs on its issue date. Correctives and
  // voids are read whole, since a clock put back can stamp them before the sale they change.
  const bound = stampBounds(input.year, input.period);

  // `starts`: the ordinary invoices that can reach the period, every corrective and every voided
  // sale. `chain` walks each up through the
  // correctives it corrects to the invoice whose day they take: an ordinary invoice (its own day)
  // or a replacement (its `supply_day`, else its original's own day). `placed`: each ordinary
  // invoice and non-replacement corrective, with the day its VAT first belongs to and the day it
  // belongs to now (an ordinary invoice's replacement's `supply_day`, voided or not, moves it).
  // `sales_one_replacement_uq` admits at most one replacement per sale, so the joins add no rows.
  const { rows } = await tx.execute<{
    rate: string;
    base: string;
    tax: string;
    sign: number;
    made_day: string;
    belongs_day: string;
    kind: VatMovementKind;
    sale_id: string;
    corrected_sale_id: string | null;
  }>(sql`
    with recursive
    starts(id) as (
      select s.id from sales s indexed by sales_issued_idx
      where s.issued_at >= ${bound.from} and s.issued_at < ${bound.before}
        and s.corrects_sale_id is null
      union
      select s.id from sales s indexed by sales_issued_idx
      where s.issued_at >= ${bound.before} and s.supply_day is not null
        and s.corrects_sale_id is null
      union
      select s.id from sales s indexed by sales_corrects_idx where s.corrects_sale_id is not null
      union
      select sv.sale_id from sale_voids sv
    ),
    chain(start_id, cur_id) as (
      select id, id from starts
      union all
      select c.start_id, up.corrects_sale_id from chain c join sales up on up.id = c.cur_id
      where up.corrects_sale_id is not null and up.replaces_original = 0
    ),
    rooted(id, corrects_sale_id, day) as (
      select st.id, st.corrects_sale_id, case
        when root.replaces_original = 1 then coalesce(root.supply_day, ${ownDay("o")})
        else ${ownDay("root")}
      end
      from chain c
      join sales st on st.id = c.start_id
      join sales root on root.id = c.cur_id
      left join sales o on o.id = root.corrects_sale_id
      where (root.corrects_sale_id is null or root.replaces_original = 1)
        and st.replaces_original = 0
        and not exists (select 1 from sale_substitutions sub where sub.substitution_sale_id = st.id)
    ),
    placed(id, first_day, now_day) as (
      select t.id, t.day,
        case when t.corrects_sale_id is null then coalesce(r.supply_day, t.day) else t.day end
      from rooted t
      left join sales r on r.corrects_sale_id = t.id and r.replaces_original = 1
    ),
    m as (
      select st.id as sale_id, st.corrects_sale_id, st.issued_at,
        case when st.corrects_sale_id is null then 'invoice' else 'correction' end as kind,
        1 as branch, 1 as sign, ${issueDay("st")} as made_day, p.first_day as belongs_day,
        st.vat_breakdown
      from placed p join sales st on st.id = p.id
      union all
      select st.id, st.corrects_sale_id, st.issued_at, 'date_moved_out', 2, -1, ${issueDay("st")},
        ${ownDay("o")}, st.vat_breakdown
      from starts x join sales st on st.id = x.id join sales o on o.id = st.corrects_sale_id
      where st.replaces_original = 1 and st.supply_day is not null
      union all
      select st.id, st.corrects_sale_id, st.issued_at, 'date_moved_in', 3, 1, ${issueDay("st")},
        st.supply_day, st.vat_breakdown
      from starts x join sales st on st.id = x.id
      where st.replaces_original = 1 and st.supply_day is not null
      union all
      select st.id, st.corrects_sale_id, st.issued_at, 'void', 4, -1,
        date(sv.voided_at, printf('%+d minutes', st.issued_offset_minutes)), p.now_day,
        st.vat_breakdown
      from sale_voids sv
      join sales st on st.id = sv.sale_id join placed p on p.id = st.id
    )
    select
      b.value ->> 'rate' as rate,
      b.value ->> 'base' as base,
      b.value ->> 'tax' as tax,
      m.sign,
      m.made_day,
      m.belongs_day,
      case
        when m.kind = 'invoice'
          and not (${inPeriod(sql`m.made_day`)} and ${inPeriod(sql`m.belongs_day`)})
        then 'issued_late'
        else m.kind
      end as kind,
      m.sale_id,
      m.corrects_sale_id as corrected_sale_id
    from m, json_each(m.vat_breakdown) b
    where (${inPeriod(sql`m.made_day`)}) or (${inPeriod(sql`m.belongs_day`)})
    order by m.made_day, m.issued_at, m.sale_id, m.branch, cast(b.value ->> 'rate' as real)
  `);

  return rows.map((r) => {
    const signed = (value: string): Decimal => {
      const scaled = toScale(decimal(value), MONEY_SCALE);
      return r.sign < 0 ? negateDecimal(scaled) : scaled;
    };
    return {
      rate: toScale(decimal(r.rate), MONEY_SCALE),
      base: signed(r.base),
      tax: signed(r.tax),
      madeDay: r.made_day,
      belongsDay: r.belongs_day,
      kind: r.kind,
      saleId: brandSaleId(r.sale_id),
      correctedSaleId: r.corrected_sale_id === null ? null : brandSaleId(r.corrected_sale_id),
    };
  });
}
