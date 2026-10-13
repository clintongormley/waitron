import { layerPaint, layerZonePaint } from "../day-paint.js";
import type { CalendarDay } from "../hours-types.js";
import { occursOn } from "../repeat-rules.js";
import type { ClosedRange, ServiceRange } from "../service-day.js";
import type { SpecialDayDetail } from "../special-days.js";

/** The special day standing on a date, `date` being the stored date its paint is keyed by. */
export type DatedSpecial = { detail: SpecialDayDetail; date: string; closed: boolean };

/** `detail` on `date` when the calendar's `day` names it: the stored date itself, or for a
 *  repeating day the date that falls on it — on the same month and day, or on the public holiday
 *  of its name. */
export function specialOn(
  day: CalendarDay | undefined,
  detail: SpecialDayDetail | undefined,
  date: string,
): DatedSpecial | undefined {
  if (!day?.specialDay || detail?.id !== day.specialDay.id) return undefined;
  const year = Number(date.slice(0, 4));
  const entry =
    detail.dates.find((row) => row.date === date) ??
    (detail.repeatsYearly
      ? detail.dates.find((row) =>
          row.holidayName !== undefined && year > Number(row.date.slice(0, 4))
            ? day.holidays.some((holiday) => holiday.name === row.holidayName)
            : occursOn({ date: row.date, repeats: true }, date),
        )
      : undefined);
  return entry && { detail, date: entry.date, closed: entry.closedAllDay };
}

export const paintedSlots = (
  season: readonly ServiceRange[],
  special: DatedSpecial | undefined,
  departmentId: string,
  cutover: string,
): ServiceRange[] =>
  special
    ? layerPaint(
        season,
        special.detail.paint.find(
          (row) => row.date === special.date && row.departmentId === departmentId,
        )?.ranges ?? [],
        cutover,
      )
    : season.map((slot) => ({ ...slot }));

export const paintedClosed = (
  season: readonly ClosedRange[],
  special: DatedSpecial | undefined,
  zoneId: string,
  cutover: string,
): ClosedRange[] =>
  special
    ? layerZonePaint(
        season,
        special.detail.zonePaint.find((row) => row.date === special.date && row.zoneId === zoneId)
          ?.ranges ?? [],
        cutover,
      )
    : season.map((range) => ({ ...range }));
