import { vi } from "vitest";
import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type { AreaRef } from "../slots.js";
import type { StaffingMonth } from "../staffing-types.js";
import { StaffingApi } from "./client.js";

export const kitchen: AreaRef = { kind: "station", id: "st-kitchen" };
export const restaurant: AreaRef = { kind: "department", id: "dep-restaurant" };
export const bar: AreaRef = { kind: "department", id: "dep-bar" };
export const AREAS = [
  { area: restaurant, name: "Restaurant" },
  { area: bar, name: "Bar" },
  { area: kitchen, name: "Kitchen" },
];

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The first Monday on or before the 1st of `month`. */
function firstMonday(month: string): string {
  const first = `${month}-01`;
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  return addDays(first, -((weekday + 6) % 7));
}

/** December 2026 as the month read answers it: Mondays closed, Kitchen 4 / Restaurant 6 / Bar 2 on
 *  the other days, 5 and 8 on Fridays and Saturdays, and Christmas Eve a special day. */
export function staffingMonth(month = "2026-12"): StaffingMonth {
  const start = firstMonday(month);
  const following = `${addDays(`${month}-28`, 7).slice(0, 7)}-01`;
  const next = firstMonday(following.slice(0, 7));
  const end = next === following ? next : addDays(next, 7);
  const count = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  const days = Array.from({ length: count }, (_, index) => {
    const date = addDays(start, index);
    const weekday = index % 7;
    const closedAllDay = weekday === 0;
    const busy = weekday === 4 || weekday === 5;
    return {
      date,
      inMonth: date.startsWith(month),
      seasonId: date < "2026-12-01" ? "autumn" : "winter",
      specialDay: date === "2026-12-24" ? { id: "sd-eve", name: "Christmas Eve" } : null,
      closedAllDay,
      areas: closedAllDay
        ? []
        : [
            { area: restaurant, needed: busy ? 8 : 6, unfilled: null },
            { area: bar, needed: 2, unfilled: null },
            { area: kitchen, needed: busy ? 5 : 4, unfilled: null },
          ],
    };
  });
  return {
    month,
    today: "2026-12-02",
    areas: AREAS,
    seasons: [
      { id: "autumn", name: "Autumn", startsOn: "09-01", lastDay: "11-30" },
      { id: "winter", name: "Winter", startsOn: "12-01", lastDay: "02-28" },
    ],
    days,
  };
}

/** A StaffingApi whose month read answers `month(<YYYY-MM>)`; any other path throws. */
export function fakeApi(
  month: (requested: string) => Promise<StaffingMonth> = async (requested) =>
    staffingMonth(requested),
  liveData?: LiveData,
) {
  const request = vi.fn((path: string) =>
    month(decodeURIComponent(/\/month\?month=(.+)$/.exec(path)![1]!)),
  );
  return { api: new StaffingApi(request as unknown as DashboardRequest, liveData), request };
}
