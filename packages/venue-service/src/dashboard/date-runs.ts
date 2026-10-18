import type { LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import { formatShortDate } from "./hours-view.js";

/** Sorted dates as runs of consecutive dates, each its first and last date. */
export function runsOf(dates: readonly LocalDate[]): [LocalDate, LocalDate][] {
  const runs: [LocalDate, LocalDate][] = [];
  for (const date of dates) {
    const last = runs.at(-1);
    if (last && addDays(last[1], 1) === date) last[1] = date;
    else runs.push([date, date]);
  }
  return runs;
}

/** The dates as runs, "14–⁠15 Dec, 25 Dec", in the dashboard's language; "" for none. A run inside
 *  one month joins its day numbers with an en dash and a word joiner so it never wraps. */
export function formatDateRuns(dates: readonly LocalDate[]): string {
  const sorted = [...new Set(dates)].sort();
  const years = new Set(sorted.map((date) => date.slice(0, 4))).size > 1;
  return runsOf(sorted)
    .map(([first, last]) => {
      if (first === last) return formatShortDate(first, years);
      if (first.slice(0, 7) === last.slice(0, 7))
        return `${Number(first.slice(8))}–⁠${formatShortDate(last, years)}`;
      return `${formatShortDate(first, years)} – ${formatShortDate(last, years)}`;
    })
    .join(", ");
}
