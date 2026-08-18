import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/**
 * The modelo 303 liquidation PERIOD — a civil fiscal period, shared by the output side
 * (`computeVatReturn`) and the input side (`computeInputVat`), so the two cannot drift. A month, a
 * quarter (trimestre, "1T".."4T"), or the whole civil year. NOTE this is the FISCAL period; the
 * operational business-day range of `computeVatSummaryForPeriod` is a different concept.
 */
export type LiquidationPeriod =
  | { readonly kind: "month"; readonly month: number } // 1..12
  | { readonly kind: "quarter"; readonly quarter: number } // 1..4 (1T..4T)
  | { readonly kind: "year" };

/**
 * A bad year/period is a caller precondition — a plain Error (matching business-day.ts's validators,
 * no registered code), thrown BEFORE any query. The year is bounded to four digits for the reason
 * the monthly note recorded: a typo year make_date still accepts (226 AD) matches no rows and returns
 * a plausible-but-EMPTY period (the quiet, worse direction for a fiscal filing).
 */
export function validatePeriod(year: number, period: LiquidationPeriod): void {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new Error(`reporting: year must be an integer in 1000..9999: ${JSON.stringify(year)}`);
  }
  switch (period.kind) {
    case "month":
      if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12) {
        throw new Error(
          `reporting: month must be an integer in 1..12: ${JSON.stringify(period.month)}`,
        );
      }
      return;
    case "quarter":
      if (!Number.isInteger(period.quarter) || period.quarter < 1 || period.quarter > 4) {
        throw new Error(
          `reporting: quarter must be an integer in 1..4: ${JSON.stringify(period.quarter)}`,
        );
      }
      return;
    case "year":
      return;
  }
}

/**
 * The half-open civil-date bound `[firstDay, upper)` on a date-valued SQL expression for a
 * `LiquidationPeriod` — pure calendar dates, no DST subtlety. The output side passes the filed
 * *fecha de expedición* expression; the input side passes `received_on`. A quarter is the three
 * calendar months of the trimestre; the whole year is Jan 1 → next Jan 1. Because it is a wider
 * range over the SAME rows, a quarter/year total is exactly the sum of its constituent months
 * (decimal addition is associative) — exactness inherited, never re-derived.
 */
export function periodDateFilter(dateExpr: SQL, year: number, period: LiquidationPeriod): SQL {
  switch (period.kind) {
    case "month": {
      const firstDay = sql`make_date(${year}, ${period.month}, 1)`;
      return sql`${dateExpr} >= ${firstDay} and ${dateExpr} < (${firstDay} + interval '1 month')`;
    }
    case "quarter": {
      const firstMonth = 3 * (period.quarter - 1) + 1; // Q1→1, Q2→4, Q3→7, Q4→10
      const firstDay = sql`make_date(${year}, ${firstMonth}, 1)`;
      return sql`${dateExpr} >= ${firstDay} and ${dateExpr} < (${firstDay} + interval '3 months')`;
    }
    case "year": {
      const firstDay = sql`make_date(${year}, 1, 1)`;
      return sql`${dateExpr} >= ${firstDay} and ${dateExpr} < (${firstDay} + interval '1 year')`;
    }
  }
}
