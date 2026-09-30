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

export { formatIsoMinute } from "@waitron/dashboard-kit";
