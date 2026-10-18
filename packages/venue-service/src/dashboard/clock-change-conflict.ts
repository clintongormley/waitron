import { formatChangeoverMoment } from "@waitron/dashboard-kit";
import type { BusinessDayClockConflict } from "@waitron/module";
import { format } from "./hours-view.js";
import type { Refusal } from "./refusal.js";
import { t } from "./strings.js";

type HoursReason = Exclude<BusinessDayClockConflict["reason"], "kept_open">;

/** The one line naming the first range that clashes with the waiting business-day start. */
export function clockChangeConflictText(refusal: Refusal, timeZone: string): string | undefined {
  if (refusal.code !== "hours.clock_change_conflict") return undefined;
  const params = refusal.params as {
    dayCutover: string;
    startsAt: string;
    conflicts: readonly BusinessDayClockConflict[];
  };
  const first = params.conflicts[0]!;
  const name = first.periodName ?? first.zoneName ?? first.departmentName;
  return format("hours.clock_change_conflict", {
    range: `${name} ${first.startsAt}–${first.endsAt}`,
    time: params.dayCutover,
    when: formatChangeoverMoment(params.startsAt, timeZone),
    reason: t(`hours.conflict.${first.reason as HoursReason}`),
  });
}
