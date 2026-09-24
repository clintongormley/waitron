export const MS_PER_DAY = 86_400_000;

/** The Monday (YYYY-MM-DD) of the week `dateStr` falls in — mirrors roster-validation's weekStartOf. */
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const mondayIndex = (d.getUTCDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0
  return new Date(d.getTime() - mondayIndex * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Today's date in UTC (YYYY-MM-DD). `toISOString()` is UTC, so near midnight this can name a
 * different calendar day than the operator's local one. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** An ISO-8601 instant as `YYYY-MM-DD HH:MM` in the BROWSER's local timezone, not UTC: an operator
 * reads it against the clock on the wall. */
export function formatIsoMinute(iso: string): string {
  const at = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
