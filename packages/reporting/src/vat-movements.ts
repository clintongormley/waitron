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

/** The filed issue date: the stamp shifted by `offsetMinutes`, as `vatReturnDay` reads it. */
function civilDate(stamp: SQL, offsetMinutes: SQL): SQL {
  return sql`date(${stamp}, printf('%+d minutes', ${offsetMinutes}))`;
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

  // `d`: every sale with its issue date and own day. `placed`: each ordinary invoice and
  // non-replacement corrective, with the day its VAT first belongs to and the day it belongs to
  // now (an ordinary invoice's replacement's `supply_day`, voided or not, moves it).
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
    with d as (
      select
        s.id,
        s.corrects_sale_id,
        s.replaces_original,
        s.supply_day,
        s.vat_breakdown,
        s.issued_at,
        s.issued_offset_minutes,
        ${civilDate(sql`s.issued_at`, sql`s.issued_offset_minutes`)} as issue_day,
        coalesce(s.supply_day, ${civilDate(sql`s.issued_at`, sql`s.issued_offset_minutes`)}) as own_day,
        exists (select 1 from sale_substitutions sub where sub.substitution_sale_id = s.id) as is_exchange
      from sales s
    ),
    placed as (
      select
        d.id,
        case
          when d.corrects_sale_id is null then d.own_day
          when t.replaces_original = 1 then coalesce(t.supply_day, o.own_day)
          else t.own_day
        end as first_day,
        case
          when d.corrects_sale_id is null then coalesce(r.supply_day, d.own_day)
          when t.replaces_original = 1 then coalesce(t.supply_day, o.own_day)
          else t.own_day
        end as now_day
      from d
      left join d t on t.id = d.corrects_sale_id
      left join d o on o.id = t.corrects_sale_id
      left join sales r on r.corrects_sale_id = d.id and r.replaces_original = 1
      where d.replaces_original = 0 and d.is_exchange = 0
    ),
    m as (
      select d.id as sale_id, d.corrects_sale_id, d.issued_at,
        case when d.corrects_sale_id is null then 'invoice' else 'correction' end as kind,
        1 as branch, 1 as sign, d.issue_day as made_day, p.first_day as belongs_day, d.vat_breakdown
      from d join placed p on p.id = d.id
      union all
      select d.id, d.corrects_sale_id, d.issued_at, 'date_moved_out', 2, -1, d.issue_day,
        o.own_day, d.vat_breakdown
      from d join d o on o.id = d.corrects_sale_id
      where d.replaces_original = 1 and d.supply_day is not null
      union all
      select d.id, d.corrects_sale_id, d.issued_at, 'date_moved_in', 3, 1, d.issue_day,
        d.supply_day, d.vat_breakdown
      from d
      where d.replaces_original = 1 and d.supply_day is not null
      union all
      select d.id, d.corrects_sale_id, d.issued_at, 'void', 4, -1,
        ${civilDate(sql`sv.voided_at`, sql`d.issued_offset_minutes`)}, p.now_day, d.vat_breakdown
      from sale_voids sv join d on d.id = sv.sale_id join placed p on p.id = d.id
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
