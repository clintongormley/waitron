import type { LocalDate } from "../hours-types.js";
import { addDays, weekdayOf } from "../hours-rules.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { StationServiceTimes } from "../station-service-times.js";
import type { MonthDepartment } from "./opening-hours-month.js";
import type { TimesPeriod } from "./station-times-tab.js";

export interface ShowStation {
  id: string;
  name: string;
}
export type StationShow =
  | { id: string; state: "loading" }
  | { id: string; state: "always" }
  | {
      id: string;
      state: "ready";
      model: OpeningHoursMonth;
      departments: readonly MonthDepartment[];
    };

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** The whole Monday-to-Sunday weeks covering `month`, worked out as `readOpeningHoursMonth` does, so
 *  the station read starts beside the month read; `stationShowModel` still checks the dates agree. */
export function monthWeeks(month: string): [LocalDate, LocalDate] {
  const first = `${month}-01`;
  const last = addDays(addDays(first, 32).slice(0, 7) + "-01", -1);
  return [addDays(first, -((weekdayOf(first) + 6) % 7)), addDays(last, (7 - weekdayOf(last)) % 7)];
}

/** The month read's dates, each carrying one row per department that sends `station` orders on any
 *  shown date (empty on a date it sends nothing), in the month read's department order. A single
 *  sender is one row named after the station when `lone` is `"station"`, after its department when
 *  `"department"`; no sender is one row named after the station. Undefined unless both reads cover
 *  the same dates. */
export function stationShowModel(
  meta: OpeningHoursMonth,
  times: StationServiceTimes,
  station: ShowStation,
  periods: readonly TimesPeriod[],
  lone: "station" | "department",
): { model: OpeningHoursMonth; departments: MonthDepartment[] } | undefined {
  if (
    times.days.length !== meta.days.length ||
    times.days.some((day, index) => day.date !== meta.days[index]!.date)
  )
    return undefined;
  const order = meta.days[0]!.departments.map((row) => row.departmentId);
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  const fed = [
    ...new Set(times.days.flatMap((day) => day.departments.map((row) => row.departmentId))),
  ].sort((a, b) => rank(a) - rank(b));
  const several = fed.length > 1 || (lone === "department" && fed.length === 1);
  const rows = several ? fed : [station.id];
  const model: OpeningHoursMonth = {
    ...meta,
    days: meta.days.map((day, index) => {
      const cutover = minutes(day.dayCutover);
      const offset = (time: string) => (minutes(time) - cutover + 1440) % 1440;
      const sent = times.days[index]!.departments;
      return {
        ...day,
        departments: rows.map((id) => ({
          departmentId: id,
          zones: [],
          ranges: sent
            .filter((row) => !several || row.departmentId === id)
            .flatMap((row) => row.ranges)
            .sort((a, b) => offset(a.startsAt) - offset(b.startsAt)),
        })),
      };
    }),
  };
  const plain = ({ id, name, colour }: TimesPeriod) => ({ id, name, colour });
  const departments: MonthDepartment[] = several
    ? fed.map((id) => ({
        id,
        name: periods.find((period) => period.departmentId === id)?.departmentName ?? "",
        zones: [],
        periods: periods.filter((period) => period.departmentId === id).map(plain),
      }))
    : [{ id: station.id, name: station.name, zones: [], periods: periods.map(plain) }];
  return { model, departments };
}
