import { compareStationNames } from "@waitron/shared";
import type { CalendarColour, LocalDate } from "../hours-types.js";
import { addDays, weekdayOf } from "../hours-rules.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { ServiceRange } from "../service-day.js";
import { joinPlacedRanges, placeOnDay } from "../zone-own-hours.js";
import type { StationServiceTimes } from "../station-service-times.js";
import type { MonthDepartment } from "./opening-hours-month.js";

export interface ShowStation {
  id: string;
  name: string;
  colour: CalendarColour;
}
export type StationShow =
  | { id: string; state: "loading" }
  | {
      id: string;
      state: "ready";
      mixed?: boolean;
      model: OpeningHoursMonth;
      departments: readonly MonthDepartment[];
    };

export function activeStationsInOrder<Station extends { active: boolean; name: string }>(
  stations: readonly Station[],
): Station[] {
  return stations
    .filter((station) => station.active)
    .sort((a, b) => compareStationNames(a.name, b.name));
}

/** The whole Monday-to-Sunday weeks covering `month`, worked out as `readOpeningHoursMonth` does, so
 *  the station read starts beside the month read; `stationShowModel` still checks the dates agree. */
export function monthWeeks(month: string): [LocalDate, LocalDate] {
  const first = `${month}-01`;
  const last = addDays(addDays(first, 32).slice(0, 7) + "-01", -1);
  return [addDays(first, -((weekdayOf(first) + 6) % 7)), addDays(last, (7 - weekdayOf(last)) % 7)];
}

/** The dates must match before the sending ranges are paired with their business-day bounds. */
export function stationShowModel(
  meta: OpeningHoursMonth,
  times: StationServiceTimes,
  { id, name, colour }: ShowStation,
): { model: OpeningHoursMonth; departments: MonthDepartment[] } | undefined {
  if (
    times.days.length !== meta.days.length ||
    times.days.some((day, index) => day.date !== meta.days[index]!.date)
  )
    return undefined;
  return {
    model: {
      ...meta,
      days: meta.days.map((day, index) => ({
        ...day,
        departments: [
          {
            departmentId: id,
            zones: [],
            ranges: times.days[index]!.departments.flatMap((sender) => sender.ranges),
          },
        ],
      })),
    },
    departments: [{ id, name, station: true, zones: [], periods: [{ id, name: "", colour }] }],
  };
}

export function placedStationRanges(
  day: OpeningHoursMonth["days"][number],
  ranges: readonly ServiceRange[],
  stationId: string,
) {
  return joinPlacedRanges(ranges.map(placeOnDay(day))).map((range) => ({
    ...range,
    periodId: stationId,
  }));
}
