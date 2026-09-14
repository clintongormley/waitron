/**
 * Shared date helpers for the week-scoped dashboard screens (roster + planned-vs-actual) — the local
 * Monday of a week and today's seed date. Both screens seed and snap their week picker with these, so
 * they live here rather than being copy-pasted per screen.
 */

/** Milliseconds in a day — the step for week-day arithmetic. */
export const MS_PER_DAY = 86_400_000;

/** The local Monday (YYYY-MM-DD) of the week `dateStr` falls in — mirrors roster-validation's weekStartOf. */
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const mondayIndex = (d.getUTCDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0
  return new Date(d.getTime() - mondayIndex * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Today's date in UTC (YYYY-MM-DD) — the seed for the default week. `toISOString()` is UTC, so near
 * midnight this can name a different calendar day than the operator's local one; seeding from the
 * venue's local timezone is deferred (per-venue timezone is a later slice). */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** An ISO-8601 instant rendered to the minute as `YYYY-MM-DD HH:MM` in the BROWSER's local timezone.
 * The last-seen / job-timestamp formatter the devices and printers screens share; each caller supplies
 * its OWN "never" placeholder for a null timestamp, so this formats only a present value.
 *
 * Local, not UTC: an operator reads a last-seen time against the clock on the wall, so a slice of the
 * ISO string (which is UTC) would show the wrong hour anywhere but Greenwich. Rendered from the
 * `Date`'s local getters — proven against a pinned non-UTC zone in `date-utils.test.ts`. */
export function formatIsoMinute(iso: string): string {
  const at = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
