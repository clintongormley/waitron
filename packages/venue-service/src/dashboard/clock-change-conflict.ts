import { formatChangeoverMoment, formatDayAndMonth, pickLocale } from "@waitron/dashboard-kit";
import type { BusinessDayClockConflict } from "@waitron/module";
import { format } from "./hours-view.js";
import type { Refusal } from "./refusal.js";
import { weekdayLabel } from "./season-week-view.js";
import { t } from "./strings.js";

type HoursReason = Exclude<BusinessDayClockConflict["reason"], "kept_open">;

/** The one line naming the first range that clashes with the waiting business-day start. */
export function clockChangeConflictText(refusal: Refusal): string | undefined {
  if (refusal.code !== "hours.clock_change_conflict") return undefined;
  const params = refusal.params as {
    dayCutover: string;
    startsAt: string;
    timeZone: string;
    conflicts: readonly BusinessDayClockConflict[];
  };
  const first = params.conflicts[0]!;
  const weekday = first.weekday === undefined ? undefined : weekdayLabel(first.weekday);
  const day =
    first.date !== undefined
      ? formatDayAndMonth(first.date)
      : weekday && pickLocale({ en: weekday, es: weekday.toLowerCase() });
  return format("hours.clock_change_conflict", {
    range: [
      first.specialDayName ?? first.seasonName,
      first.departmentName,
      first.zoneName,
      day,
      first.periodName,
      `${first.startsAt}–${first.endsAt}`,
    ]
      .filter(Boolean)
      .join(" · "),
    time: params.dayCutover,
    when: formatChangeoverMoment(params.startsAt, params.timeZone),
    reason: t(`hours.conflict.${first.reason as HoursReason}`),
  });
}
