import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { SpecialDaysModel } from "../holiday-types.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { SpecialDayDetail } from "../special-days.js";
import { namedWeekModel } from "./real-week-model.js";

export const PARTY_DATE = "2026-10-13";
const AUTUMN = { id: "autumn", name: "Autumn", startsOn: "09-01" };
const dinnerWeek = [2, 3].map((weekday) => ({
  weekday,
  slots: [{ periodId: "dinner", startsAt: "20:00", endsAt: "23:30" }],
}));
const barWeek = [2, 3].map((weekday) => ({
  weekday,
  slots: [{ periodId: "drinks", startsAt: "18:00", endsAt: "02:00" }],
}));
const terraceWeek = [2, 3].map((weekday) => ({
  weekday,
  ranges: [{ startsAt: "22:00", endsAt: "23:30" }],
}));
const period = (id: string, name: string, colour: "blue" | "green") => ({
  id,
  name,
  colour,
  menuId: "m1",
  staffMenuIds: [],
  endOffsetMinutes: 0,
  weekdays: [2, 3],
  routingUses: [],
});

/** Restaurant runs Dinner 20:00–23:30 with the Terrace closed 22:00–23:30, and Bar runs Drinks
 *  18:00–02:00, on Tuesdays and Wednesdays of Autumn. */
export function paintDayModel(): OpeningHoursModel {
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 4,
    currentBusinessDay: PARTY_DATE,
    pending: null,
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    menus: [{ id: "m1", name: "Menu", active: true, includes: [] }],
    seasons: [AUTUMN],
    currentSeasonId: AUTUMN.id,
    namedDays: [],
    departments: [
      {
        id: "restaurant",
        name: "Restaurant",
        active: true,
        periods: [period("dinner", "Dinner", "blue")],
        seasonWeeks: [{ seasonId: AUTUMN.id, week: structuredClone(dinnerWeek) }],
        dates: [],
        zones: [
          {
            id: "terrace",
            name: "Terrace",
            seasonWeeks: [{ seasonId: AUTUMN.id, week: structuredClone(terraceWeek) }],
            dates: [],
          },
        ],
      },
      {
        id: "bar",
        name: "Bar",
        active: true,
        periods: [period("drinks", "Drinks", "green")],
        seasonWeeks: [{ seasonId: AUTUMN.id, week: structuredClone(barWeek) }],
        dates: [],
        zones: [],
      },
    ],
  };
}

/** "Party", a one-off special day on 13 October 2026 with no paint. */
export function partyDetail(): SpecialDayDetail {
  return {
    id: "party",
    name: "Party",
    repeatsYearly: false,
    dates: [{ date: PARTY_DATE, closedAllDay: false }],
    paint: [],
    zonePaint: [],
  };
}

export function partyCalendar(from: string, to: string, detail = partyDetail()): SpecialDaysModel {
  const model = namedWeekModel();
  return {
    ...model,
    days:
      from <= PARTY_DATE && PARTY_DATE <= to
        ? [
            {
              date: PARTY_DATE,
              specialDay: { id: detail.id, name: detail.name },
              holidays: [],
              tone: "special_day",
              closed: detail.dates.some((entry) => entry.closedAllDay),
            },
          ]
        : [],
  };
}

export interface Recorded {
  path: string;
  method: string;
  body: unknown;
}

/** A request answering the opening-hours model, the calendar and the special day's detail, recording
 *  every write and answering it with `write`. */
export function paintDayRequest(
  writes: Recorded[],
  write: (entry: Recorded) => Promise<unknown> = async () => partyDetail(),
  model = paintDayModel(),
  detail = partyDetail(),
): DashboardRequest {
  return (async (path: string, method: string, body: unknown) => {
    if (method !== "GET") {
      const entry = { path, method, body };
      writes.push(entry);
      return write(entry);
    }
    if (path === "/management-api/stations") return [];
    if (path.includes("/named-days?")) {
      const query = new URLSearchParams(path.slice(path.indexOf("?") + 1));
      return partyCalendar(query.get("from")!, query.get("to")!, detail);
    }
    if (path.endsWith(`/special-days/${detail.id}`)) return structuredClone(detail);
    if (path.endsWith("/special-days")) return [];
    return structuredClone(model);
  }) as DashboardRequest;
}

/** Answers the calendar and special-day reads as though each date asked about were the one date of
 *  its own unpainted special day, "Special <date>", closed all day when `closed`; null for any other
 *  path. */
export function everyDateSpecial(path: string, closed = false): unknown {
  if (path.includes("/named-days?")) {
    const query = new URLSearchParams(path.slice(path.indexOf("?") + 1));
    const days = [];
    for (let date = query.get("from")!; date <= query.get("to")!; date = nextDate(date))
      days.push({
        date,
        specialDay: { id: `day-${date}`, name: `Special ${date}` },
        holidays: [],
        tone: "special_day" as const,
        closed,
      });
    return { ...namedWeekModel(), days };
  }
  const id = /\/special-days\/day-(\d{4}-\d{2}-\d{2})$/.exec(path)?.[1];
  return id === undefined
    ? null
    : {
        id: `day-${id}`,
        name: `Special ${id}`,
        repeatsYearly: false,
        dates: [{ date: id, closedAllDay: closed }],
        paint: [],
        zonePaint: [],
      };
}
const nextDate = (date: string) => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};
