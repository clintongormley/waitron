/** Today's date in UTC (`YYYY-MM-DD`) — the bookings screen's default day. `toISOString()` is UTC, so
 * near midnight this can name a different calendar day than the operator's local one; seeding from the
 * venue's local timezone is deferred (per-venue timezone is a later slice). A LOCAL copy of the
 * dashboard's own `today` (shared by several dashboard screens) — the sub-path keeps its own so it imports
 * nothing from the app. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
