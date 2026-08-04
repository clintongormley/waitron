import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DailyCloseInput } from "./types.js";

const CUTOVER_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Throws a plain Error (a caller precondition — see the plan's spec-refinement note) if `tz` is not a
 * resolvable IANA zone. Two rejections, both required by design §D4 ("always an explicit IANA name —
 * never a numeric offset"):
 *
 *   - an unknown value ("Mars/Olympus") — `Intl.DateTimeFormat` throws a RangeError constructing it;
 *   - a UTC-offset shorthand ("+02:00", "+0200") — measured on Node 26, `Intl.DateTimeFormat` ACCEPTS
 *     these and resolves them to a "+HH:MM" form (it does NOT throw, contrary to older engines), so
 *     they are caught by reading `resolvedOptions().timeZone` back and rejecting an offset spelling.
 *
 * A named zone resolves to a name (`Europe/Madrid`, `UTC`, `Etc/GMT+2`), never a leading `+`/`-`.
 */
export function validateTimeZone(tz: string): void {
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    throw new Error(`reporting: invalid IANA time zone: ${JSON.stringify(tz)}`);
  }
  if (/^[+-]/.test(resolved)) {
    throw new Error(`reporting: invalid IANA time zone (numeric offset, not a named zone): ${JSON.stringify(tz)}`);
  }
}

export function validateCutover(cutover: string): void {
  if (!CUTOVER_RE.test(cutover)) {
    throw new Error(`reporting: invalid cutover, expected "HH:MM": ${JSON.stringify(cutover)}`);
  }
}

export function validateBusinessDay(day: string): void {
  if (!DATE_RE.test(day)) {
    throw new Error(`reporting: invalid business day, expected "YYYY-MM-DD": ${JSON.stringify(day)}`);
  }
}

/**
 * The DST-aware business-day predicate, reused by every aggregate. `column` is a `timestamptz`
 * (`sales.issued_at` or `tenders.settled_at`); a row belongs to `businessDay` when its venue-local
 * wall-clock, shifted back by the cutover, lands on that date. Never UTC — `AT TIME ZONE` with an
 * IANA name is DST-correct; a fixed offset would not be.
 */
export function businessDayClause(column: SQL, input: DailyCloseInput): SQL {
  return sql`(${column} at time zone ${input.timeZone} - ${input.dayCutover}::interval)::date = ${input.businessDay}::date`;
}
