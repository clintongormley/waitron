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

/** The latest calendar quarter that has fully ended, on the browser's own calendar. */
export function lastEndedQuarter(now: Date): { year: number; quarter: 1 | 2 | 3 | 4 } {
  const current = Math.floor(now.getMonth() / 3) + 1;
  return current === 1
    ? { year: now.getFullYear() - 1, quarter: 4 }
    : { year: now.getFullYear(), quarter: (current - 1) as 1 | 2 | 3 };
}

/** A stored instant plus the wall offset recorded beside it, read in UTC, is the local wall clock. */
export function wallClock(instant: string, offsetMinutes: number): { date: string; time: string } {
  const shifted = new Date(Date.parse(instant) + offsetMinutes * 60_000).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

/** The instant (`YYYY-MM-DDTHH:MM:SSZ`) at which the wall clock reads `day` `HH:MM` at that offset. */
export function instantAt(day: string, time: string, offsetMinutes: number): string {
  const instant = new Date(Date.parse(`${day}T${time}:00Z`) - offsetMinutes * 60_000);
  return `${instant.toISOString().slice(0, 19)}Z`;
}

export { formatIsoMinute } from "@waitron/dashboard-kit";
