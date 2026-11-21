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
import { periodDateFilter, periodDays, stampDate, validatePeriod } from "./period.js";
import type { LiquidationPeriod } from "./period.js";
import type { VatCorrectionInvoice } from "./types.js";

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

/** A movement with the invoice that made it and the invoice that invoice corrects. */
export interface InvoicedVatMovement extends VatMovement {
  invoice: VatCorrectionInvoice;
  corrects: VatCorrectionInvoice | null;
}

/** The filed issue date of `sales` row `alias`. */
function issueDay(alias: string): SQL {
  return stampDate(sql.raw(`${alias}.issued_at`), sql.raw(`${alias}.issued_offset_minutes`));
}

/** An ordinary invoice's own day: its `supply_day`, else its issue date. */
function ownDay(alias: string): SQL {
  return sql`coalesce(${sql.raw(alias)}.supply_day, ${issueDay(alias)})`;
}

/**
 * Bounds on a stored stamp whose civil date lies in the period, as `"YYYY-MM-DD"` strings that
 * compare with a stamp: `from` is the day before the first day and `before` the day after the last
 * day plus one. `sales_issued_offset_ck` keeps an offset within ±840 minutes, so a stamp is never
 * more than a day from its civil date; a void's date is read in its sale's offset.
 */
function stampBounds(year: number, period: LiquidationPeriod): { from: string; before: string } {
  const { first, next } = periodDays(year, period);
  const shift = (day: string, days: number) =>
    new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  return { from: shift(first, -1), before: shift(next, 1) };
}

type MovementRow = {
  rate: string;
  base: string;
  tax: string;
  sign: number;
  made_day: string;
  belongs_day: string;
  kind: VatMovementKind;
  sale_id: string;
  corrected_sale_id: string | null;
};

type InvoicedMovementRow = MovementRow & {
  series_code: string;
  number: number;
  issue_date: string;
  corrected_series_code: string | null;
  corrected_number: number | null;
  corrected_issue_date: string | null;
};

function movementQuery(input: { year: number; period: LiquidationPeriod }, invoices: boolean): SQL {
  validatePeriod(input.year, input.period);
  const inPeriod = (day: SQL): SQL => periodDateFilter(day, input.year, input.period);
  const { first, next } = periodDays(input.year, input.period);
  const bound = stampBounds(input.year, input.period);

  // `seeds`: every sale stamped where its date can lie in the period, every sale whose void is
  // stamped so, every replacement (its `supply_day` can name any day) and the invoice it replaces,
  // and each ordinary invoice issued after the period for a supply day in it (`record-sale.ts`
  // keeps a supply day only when it is earlier than the issue day, so no ordinary invoice stamped
  // before the period belongs to it). `starts` adds the non-replacement correctives below each
  // seed, at any depth: a clock put back can stamp a corrective or void of the period's invoice
  // long before it, so those are reached from the invoice rather than by their stamps. A corrective
  // of a replacement is reached from the replacement.
  //
  // `chain` walks each start up through the correctives it corrects to the invoice whose day they
  // take: an ordinary invoice (its own day) or a replacement (its `supply_day`, else its original's
  // own day). `placed`: each ordinary invoice and non-replacement corrective, with the day its VAT
  // first belongs to and the day it belongs to now (an ordinary invoice's replacement's
  // `supply_day`, voided or not, moves it). `sales_one_replacement_uq` admits at most one
  // replacement per sale, so the joins add no rows. Each `indexed by` is there because a box gathers
  // no planner statistics.
  const invoiceColumns = invoices
    ? sql`, ser.code as series_code, inv.invoice_number as number, ${issueDay("inv")} as issue_date,
        cser.code as corrected_series_code, cor.invoice_number as corrected_number,
        ${issueDay("cor")} as corrected_issue_date`
    : sql``;
  const invoiceJoins = invoices
    ? sql`join sales inv on inv.id = m.sale_id
        join invoice_series ser on ser.id = inv.series_id
        left join sales cor on cor.id = m.corrects_sale_id
        left join invoice_series cser on cser.id = cor.series_id`
    : sql``;
  return sql`
    with recursive
    seeds(id) as (
      select s.id from sales s indexed by sales_issued_idx
      where s.issued_at >= ${bound.from} and s.issued_at < ${bound.before}
      union
      select s.id from sales s indexed by sales_supply_day_idx
      where s.issued_at >= ${bound.before} and s.corrects_sale_id is null
        and s.supply_day >= ${first} and s.supply_day < ${next}
      union
      select r.id from sales r indexed by sales_one_replacement_uq where r.replaces_original = 1
      union
      select r.corrects_sale_id from sales r indexed by sales_one_replacement_uq
      where r.replaces_original = 1
      union
      select sv.sale_id from sale_voids sv indexed by sale_voids_voided_at_idx
      where sv.voided_at >= ${bound.from} and sv.voided_at < ${bound.before}
    ),
    starts(id) as (
      select id from seeds
      union
      select c.id from starts x join sales c indexed by sales_corrects_idx on c.corrects_sale_id = x.id
      where c.replaces_original = 0
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
        ${stampDate(sql`sv.voided_at`, sql`st.issued_offset_minutes`)}, p.now_day, st.vat_breakdown
      from placed p cross join sales st on st.id = p.id
      cross join sale_voids sv indexed by sale_voids_sale_id_key on sv.sale_id = st.id
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
      ${invoiceColumns}
    from m join json_each(m.vat_breakdown) b
    ${invoiceJoins}
    where (${inPeriod(sql`m.made_day`)}) or (${inPeriod(sql`m.belongs_day`)})
    order by m.made_day, m.issued_at, m.sale_id, m.branch, cast(b.value ->> 'rate' as real)
  `;
}

function toMovement(r: MovementRow): VatMovement {
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
}

/**
 * Every VAT movement that belongs to the period or was made in it, one row per rate line of the
 * movement's `vat_breakdown`. The rule: `docs/backlog/fiscal.md` → "A VAT period counts what
 * belongs to it and was recorded by its last day".
 */
export async function vatMovements(
  tx: Transaction,
  input: { year: number; period: LiquidationPeriod },
): Promise<VatMovement[]> {
  const { rows } = await tx.execute<MovementRow>(movementQuery(input, false));
  return rows.map(toMovement);
}

/** `vatMovements`, each with its invoice and the invoice that one corrects. */
export async function invoicedVatMovements(
  tx: Transaction,
  input: { year: number; period: LiquidationPeriod },
): Promise<InvoicedVatMovement[]> {
  const { rows } = await tx.execute<InvoicedMovementRow>(movementQuery(input, true));
  return rows.map((r) => ({
    ...toMovement(r),
    invoice: { seriesCode: r.series_code, number: r.number, issueDate: r.issue_date },
    corrects:
      r.corrected_series_code === null ||
      r.corrected_number === null ||
      r.corrected_issue_date === null
        ? null
        : {
            seriesCode: r.corrected_series_code,
            number: r.corrected_number,
            issueDate: r.corrected_issue_date,
          },
  }));
}
