import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { shifts } from "./schema/shifts.js";

/**
 * A shift's LOCAL wall date as `YYYY-MM-DD` — its stored UTC instant moved by its own wall offset.
 *
 * The single home of the expression, so the three windows built on it — `listShiftsForPerson`,
 * `plannedShiftsInPeriod` and `publishRoster`'s shift-attach — cannot drift apart.
 *
 * It was `(starts_at at time zone 'UTC' + starts_offset_minutes * interval '1 minute')::date`.
 * This engine has neither `at time zone` nor an interval type; `date()` with an `NNN minutes`
 * modifier is the replacement. Measured on the engine `node:sqlite` bundles (SQLite 3.53.4,
 * Node v26.7.0), inserting one row and asking the engine for the expression:
 * `date('2026-09-16T23:00:00.000Z', 120 || ' minutes')` is `2026-09-17`,
 * `date('2026-09-16T01:00:00.000Z', -120 || ' minutes')` is `2026-09-15`, and the zero offset
 * leaves the UTC day — so a positive, a negative and a zero offset each move the day the way the
 * PostgreSQL expression did. A concatenated modifier with no sign is accepted: `'120 minutes'` and
 * `'+120 minutes'` gave the same answer.
 *
 * What it no longer does, stated rather than discovered: `::date` on an unparseable instant was a
 * PostgreSQL 22007 error, and `date()` returns NULL for one instead — measured with
 * `date('not-a-day', '120 minutes')`, which gave NULL, not an error. A NULL here makes every
 * comparison UNKNOWN, so a row carrying a junk `starts_at` drops silently out of a window rather
 * than failing the query. The route screens the value first (`requireTimestamp`,
 * `apps/server/src/workforce-api.ts`).
 *
 * The columns are rendered by drizzle as `"shifts"."starts_at"` / `"shifts"."starts_offset_minutes"`,
 * so a query using this fragment names the table `shifts` without an alias.
 */
export const shiftLocalDate: SQL = sql`date(${shifts.startsAt}, ${shifts.startsOffsetMinutes} || ' minutes')`;
