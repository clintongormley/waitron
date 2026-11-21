import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { addDecimal, compareDecimal, decimal, isZeroDecimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { periodDays, validatePeriod } from "./period.js";
import type { LiquidationPeriod } from "./period.js";
import type {
  VatCorrectionDirection,
  VatCorrectionInvoice,
  VatCorrectionRow,
  VatCorrections,
  VatCorrectionSummaryLine,
  VatReturnInput,
} from "./types.js";
import { vatMovements, type VatMovement } from "./vat-movements.js";

/** The period of `kind` holding `day` (`"YYYY-MM-DD"`): `"2026-1T"`, `"2026-03"` or `"2026"`. */
function periodLabel(day: string, kind: LiquidationPeriod["kind"]): string {
  const year = day.slice(0, 4);
  switch (kind) {
    case "month":
      return day.slice(0, 7);
    case "quarter":
      return `${year}-${Math.ceil(Number(day.slice(5, 7)) / 3)}T`;
    case "year":
      return year;
  }
}

/** D5: by the sign of the base, or of the VAT when the base is zero. */
function directionOf(base: Decimal, tax: Decimal): VatCorrectionDirection {
  const sign = isZeroDecimal(base)
    ? compareDecimal(tax, decimal("0"))
    : compareDecimal(base, decimal("0"));
  return sign < 0 ? "reduction" : "addition";
}

/**
 * The VAT movements (`vatMovements`) made in the period that belong before its first day, one row
 * per rate line, and their sums by (belongs-to period, rate, direction).
 */
export async function computeVatCorrections(
  tx: Transaction,
  input: VatReturnInput,
): Promise<VatCorrections> {
  validatePeriod(input.year, input.period);
  const { first, next } = periodDays(input.year, input.period);
  const movements = (await vatMovements(tx, input)).filter(
    (m): m is VatMovement & { kind: VatCorrectionRow["kind"] } =>
      m.kind !== "invoice" &&
      m.madeDay >= first &&
      m.madeDay < next &&
      m.belongsDay < first &&
      !(isZeroDecimal(m.base) && isZeroDecimal(m.tax)),
  );

  const ids = [
    ...new Set(
      movements.flatMap((m) =>
        m.correctedSaleId === null ? [m.saleId] : [m.saleId, m.correctedSaleId],
      ),
    ),
  ];
  if (ids.length === 0) return { summary: [], rows: [] };
  // One bound value however many invoices the period lists.
  const { rows: found } = await tx.execute<{
    id: string;
    series_code: string;
    number: number;
    issue_date: string;
  }>(sql`
    select s.id, ser.code as series_code, s.invoice_number as number,
      date(s.issued_at, printf('%+d minutes', s.issued_offset_minutes)) as issue_date
    from sales s join invoice_series ser on ser.id = s.series_id
    where s.id in (select value from json_each(${JSON.stringify(ids)}))
  `);
  const invoices = new Map<string, VatCorrectionInvoice>(
    found.map((r) => [
      r.id,
      { seriesCode: r.series_code, number: r.number, issueDate: r.issue_date },
    ]),
  );

  const rows: VatCorrectionRow[] = movements.map((m) => ({
    madeDay: m.madeDay,
    kind: m.kind,
    invoice: invoices.get(m.saleId)!,
    corrects: m.correctedSaleId === null ? null : invoices.get(m.correctedSaleId)!,
    belongsTo: periodLabel(m.belongsDay, input.period.kind),
    rate: m.rate,
    base: m.base,
    tax: m.tax,
    direction: directionOf(m.base, m.tax),
  }));

  const lines = new Map<string, VatCorrectionSummaryLine>();
  for (const row of rows) {
    const key = JSON.stringify([row.belongsTo, row.rate, row.direction]);
    const line = lines.get(key);
    if (line === undefined) {
      lines.set(key, {
        belongsTo: row.belongsTo,
        rate: row.rate,
        direction: row.direction,
        base: row.base,
        tax: row.tax,
      });
    } else {
      line.base = addDecimal(line.base, row.base);
      line.tax = addDecimal(line.tax, row.tax);
    }
  }
  const summary = [...lines.values()].sort(
    (a, b) =>
      (a.belongsTo < b.belongsTo ? -1 : a.belongsTo > b.belongsTo ? 1 : 0) ||
      compareDecimal(a.rate, b.rate) ||
      // Lines are keyed by all three, so two that tie so far differ in direction.
      (a.direction === "reduction" ? -1 : 1),
  );

  return { summary, rows };
}
