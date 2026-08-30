import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { TenantId } from "@waitron/shared";
import type { DailyCloseInput, PeriodVatInput } from "./types.js";

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
    throw new Error(
      `reporting: invalid IANA time zone (numeric offset, not a named zone): ${JSON.stringify(tz)}`,
    );
  }
}

export function validateCutover(cutover: string): void {
  if (!CUTOVER_RE.test(cutover)) {
    throw new Error(`reporting: invalid cutover, expected "HH:MM": ${JSON.stringify(cutover)}`);
  }
}

export function validateBusinessDay(day: string): void {
  if (!DATE_RE.test(day)) {
    throw new Error(
      `reporting: invalid business day, expected "YYYY-MM-DD": ${JSON.stringify(day)}`,
    );
  }
  // Reject a well-formed but impossible date ("2026-13-45", "2026-02-30") up front, rather than
  // letting it reach `${businessDay}::date` in SQL and surface as a raw Postgres range error.
  // `Date.UTC` normalises overflow (2026-13-45 → 2027-02-14), so a round-trip mismatch = not a real day.
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error(
      `reporting: invalid business day (not a real calendar date): ${JSON.stringify(day)}`,
    );
  }
}

/**
 * Validates a closed `[from, to]` business-day range: each end is a real calendar date and `from` is
 * on or before `to`. String compare is correct for the fixed "YYYY-MM-DD" shape `validateBusinessDay`
 * enforces. The symmetric home for the ordering rule beside the atomic validators, so the next range
 * aggregate (quarterly/annual) reuses it rather than re-deriving `from <= to` and its message.
 */
export function validateBusinessDayRange(input: {
  fromBusinessDay: string;
  toBusinessDay: string;
}): void {
  validateBusinessDay(input.fromBusinessDay);
  validateBusinessDay(input.toBusinessDay);
  if (input.fromBusinessDay > input.toBusinessDay) {
    throw new Error(
      `reporting: fromBusinessDay must be on or before toBusinessDay: ${JSON.stringify(input.fromBusinessDay)} > ${JSON.stringify(input.toBusinessDay)}`,
    );
  }
}

/**
 * The DST-aware venue-local business DATE of a `timestamptz` column: its wall-clock in `timeZone`,
 * shifted back by the cutover, truncated to a date. Never UTC — `AT TIME ZONE` with an IANA name is
 * DST-correct; a fixed offset would not be. The single home of the cutover-shift expression, so
 * `businessDayClause` (`=`) and `businessDayRangeClause` (`between`) build on one fragment and cannot
 * drift on the load-bearing shift maths.
 */
function businessDayLocalDate(column: SQL, input: { timeZone: string; dayCutover: string }): SQL {
  return sql`(${column} at time zone ${input.timeZone} - ${input.dayCutover}::interval)::date`;
}

/**
 * Evaluates the venue-local business DATE of an arbitrary `timestamptz` SQL expression, returning it
 * as a `"YYYY-MM-DD"` string (node-postgres renders a `::date` OID as that text). The executing core
 * behind `currentBusinessDay` — split out so the cutover-shift maths can be tested against a LITERAL
 * timestamptz (a fixed, wall-clock-independent instant) rather than the live `now()` the public entry
 * passes. Package-internal, deliberately NOT in the public barrel (`index.ts`); the route consumes
 * `currentBusinessDay`. `nowSql` is not something to "validate" — it is a safely-constructed SQL
 * fragment (`sql\`now()\`` or a literal timestamptz), never raw user input. The real caller
 * precondition is that `input.timeZone`/`input.dayCutover` are validated first; `currentBusinessDay`
 * does that (via `validateTimeZone`/`validateCutover`) before calling this.
 */
export async function businessDayOf(
  tx: Transaction,
  nowSql: SQL,
  input: { timeZone: string; dayCutover: string },
): Promise<string> {
  const { rows } = await tx.execute<{ day: string }>(
    sql`select ${businessDayLocalDate(nowSql, input)} as day`,
  );
  return rows[0]!.day;
}

/**
 * Today's venue-local business day (cutover-shifted) as `"YYYY-MM-DD"`, evaluated from the database's
 * `now()` so the venue's own clock and DST rules decide it — never Node's. Anchors the `/reports`
 * overview's default period. Invalid inputs are a caller precondition and throw a plain `Error`
 * (matching this file's validators — no registered error code), before any query runs.
 */
export async function currentBusinessDay(
  tx: Transaction,
  input: { timeZone: string; dayCutover: string },
): Promise<string> {
  validateTimeZone(input.timeZone);
  validateCutover(input.dayCutover);
  return businessDayOf(tx, sql`now()`, input);
}

/**
 * The DST-aware business-day predicate, reused by every aggregate. `column` is a `timestamptz`
 * (`sales.issued_at` or `tenders.settled_at`); a row belongs to `businessDay` when its venue-local
 * business date (above) equals that date.
 */
export function businessDayClause(column: SQL, input: DailyCloseInput): SQL {
  return sql`${businessDayLocalDate(column, input)} = ${input.businessDay}::date`;
}

/**
 * The closed-range generalisation of `businessDayClause`: the SAME venue-local business date, but
 * `between from and to` instead of `= businessDay`. A single-day range (`from == to`) therefore
 * matches exactly what `businessDayClause`'s `= from` form matches (`x between D and D` ≡ `x = D`), so
 * the range clause provably EXTENDS the tested one rather than replacing it — see `business-day.test.ts`.
 * Bounds are inclusive on both ends.
 */
export function businessDayRangeClause(column: SQL, input: PeriodVatInput): SQL {
  return sql`${businessDayLocalDate(column, input)} between ${input.fromBusinessDay}::date and ${input.toBusinessDay}::date`;
}

/**
 * Excludes the sales a fiscal aggregate must not count: voided sales (annulled) and F3-canje
 * substitutes (their VAT already lives in the substituted F2 tickets — design §4, confirmed against
 * *modelo 303* in the AEAT FAQ). Assumes the outer query aliases `sales` as `s`. Shared by the VAT
 * summary and the record counts so the two cannot drift on which sales are "active". No leading
 * `and` — the caller writes `and ${activeSalesClause(input)}`. Only `tenantId` is read, so the param
 * is narrowed to that shape (the daily-close/counts callers still satisfy it structurally).
 */
export function activeSalesClause(input: { tenantId: TenantId }): SQL {
  return sql`not exists (select 1 from sale_voids sv where sv.sale_id = s.id and sv.tenant_id = ${input.tenantId})
      and not exists (select 1 from sale_substitutions sub where sub.substitution_sale_id = s.id and sub.tenant_id = ${input.tenantId})`;
}
