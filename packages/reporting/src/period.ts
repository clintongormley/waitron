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
 * The single source of the modelo 303 month/quarter token grammar: "01".."12" → a monthly period,
 * "1T".."4T" → a quarterly one, anything else → `undefined`. The token is trimmed and uppercased
 * first, so " 1t " parses as "1T". ANNUAL is deliberately NOT a token — there is no annual modelo 303
 * file (the annual resumen is modelo 390). The export route and the DR303 writer's `formatPeriod`
 * both validate through this function, so the accepted set cannot drift between them.
 */
export function parsePeriodToken(token: string): LiquidationPeriod | undefined {
  const t = token.trim().toUpperCase();
  if (/^(?:0[1-9]|1[0-2])$/.test(t)) return { kind: "month", month: Number(t) };
  const quarter = /^([1-4])T$/.exec(t);
  if (quarter) return { kind: "quarter", quarter: Number(quarter[1]) };
  return undefined;
}

/**
 * A bad year/period is a caller precondition — a plain Error, thrown before any query. The year is
 * bounded to four digits because a typo year (226, 20226) would match no rows and return a
 * plausible but EMPTY period, the quiet, worse direction for a fiscal filing.
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
    /* v8 ignore start -- unreachable: LiquidationPeriod is a closed union and its sole runtime
       constructor (parsePeriodToken) yields only month/quarter/year. A malformed object reaching here
       fails LOUD rather than validating as a plausible-but-EMPTY period — the quiet, worse direction
       for a fiscal filing that this function's year bound already guards against. */
    default: {
      const exhaustive: never = period;
      throw new Error(`reporting: unhandled liquidation period ${JSON.stringify(exhaustive)}`);
    }
    /* v8 ignore stop */
  }
}

/** The first day of `year`-`month` as `"YYYY-MM-DD"`; `Date.UTC` normalises a month past December. */
function firstOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
}

/**
 * A period's first day and the day after its last, as `"YYYY-MM-DD"` — pure calendar dates, no DST
 * subtlety. A quarter is the three calendar months of the trimestre; the whole year is Jan 1 → next
 * Jan 1.
 */
export function periodDays(
  year: number,
  period: LiquidationPeriod,
): { first: string; next: string } {
  const [firstMonth, months] = ((): [number, number] => {
    switch (period.kind) {
      case "month":
        return [period.month, 1];
      case "quarter":
        // Q1→1, Q2→4, Q3→7, Q4→10
        return [3 * (period.quarter - 1) + 1, 3];
      case "year":
        return [1, 12];
      /* v8 ignore start -- unreachable: closed union; a malformed kind fails LOUD rather than
         returning an undefined bound that would silently widen or empty the fiscal aggregate
         (mirrors validatePeriod's guard above). */
      default: {
        const exhaustive: never = period;
        throw new Error(`reporting: unhandled liquidation period ${JSON.stringify(exhaustive)}`);
      }
      /* v8 ignore stop */
    }
  })();
  return { first: firstOfMonth(year, firstMonth), next: firstOfMonth(year, firstMonth + months) };
}

/**
 * The half-open civil-date bound `[first, next)` of `periodDays` on a date-valued SQL expression.
 * The input side passes `received_on`. A quarter's filter selects exactly the rows of its three
 * months' filters. The output side's return is not such a filter: a month's return leaves out what
 * was made after it ends.
 *
 * Both sides of every comparison are a civil date in the fixed `"YYYY-MM-DD"` spelling —
 * `received_on` is stored that way, and SQLite's `date(...)` returns that shape — so a string
 * comparison is a date comparison here.
 */
export function periodDateFilter(dateExpr: SQL, year: number, period: LiquidationPeriod): SQL {
  const { first, next } = periodDays(year, period);
  return sql`${dateExpr} >= ${first} and ${dateExpr} < ${next}`;
}
