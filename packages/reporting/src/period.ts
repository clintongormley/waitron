import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/**
 * The liquidation-period validation and civil-month bound shared by the output side
 * (`computeVatReturn`) and the input side (`computeInputVat`), extracted so the two cannot drift.
 * A leaf module (drizzle `sql` only, nothing in reporting's own graph).
 */

/**
 * A bad year/month is a caller precondition — a plain Error (matching business-day.ts's validators,
 * no registered code), thrown BEFORE any query. The year is bounded to four digits for the reason
 * computeVatReturn's own note records: without the bound, a typo year make_date still accepts (226 AD)
 * matches no rows and returns a plausible-but-EMPTY period (the quiet, worse direction for a fiscal
 * filing), while a year make_date rejects (0) surfaces as a raw Postgres error mid-query.
 */
export function validateLiquidationPeriod(year: number, month: number): void {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new Error(`reporting: year must be an integer in 1000..9999: ${JSON.stringify(year)}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`reporting: month must be an integer in 1..12: ${JSON.stringify(month)}`);
  }
}

/**
 * The half-open civil-month bound `make_date(year,month,1) ≤ d < +1 month` on a date-valued SQL
 * expression `dateExpr` — pure calendar dates, no DST subtlety (spec §4). The output side passes the
 * filed *fecha de expedición* expression; the input side passes `received_on`.
 */
export function calendarMonthFilter(dateExpr: SQL, year: number, month: number): SQL {
  const firstDay = sql`make_date(${year}, ${month}, 1)`;
  return sql`${dateExpr} >= ${firstDay} and ${dateExpr} < (${firstDay} + interval '1 month')`;
}
