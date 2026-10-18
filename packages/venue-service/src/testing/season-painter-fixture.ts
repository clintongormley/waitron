import { vi } from "vitest";
import { type DashboardRequest } from "@waitron/dashboard-kit";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { OpeningHoursApi } from "../dashboard/opening-hours-client.js";
import type { SeasonPainter } from "../dashboard/season-painter.js";
import type { PaintGrid } from "../dashboard/paint-grid.js";

const week = <T>(on: Record<number, T[]>) =>
  Array.from({ length: 7 }, (_, weekday) => ({ weekday, entries: on[weekday] ?? [] }));
export function painterModel(): OpeningHoursModel {
  const period = (id: string, name: string, colour: "green" | "red") => ({
    id,
    name,
    colour,
    menuId: "m1",
    staffMenuIds: [],
    endOffsetMinutes: 0,
    weekdays: [1],
    routingUses: [],
  });
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 4,
    currentBusinessDay: "2026-12-14",
    pending: null,
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    seasons: [
      { id: "spring", name: "Spring", startsOn: "03-01", colour: "green" },
      { id: "winter", name: "Winter", startsOn: "12-01", colour: "blue" },
    ],
    currentSeasonId: "winter",
    menus: [{ id: "m1", name: "Lunch menu", active: true, includes: [] }],
    departments: [
      {
        id: "d1",
        name: "Restaurant",
        active: true,
        zones: [
          {
            id: "z1",
            name: "Dining room",
            seasonWeeks: ["spring", "winter"].map((seasonId) => ({
              seasonId,
              week: week({}).map(({ weekday }) => ({ weekday, ranges: [] })),
            })),
          },
          {
            id: "z2",
            name: "Terrace",
            seasonWeeks: ["spring", "winter"].map((seasonId) => ({
              seasonId,
              week: week<{ startsAt: string; endsAt: string }>(
                seasonId === "winter" ? { 2: [{ startsAt: "15:00", endsAt: "17:00" }] } : {},
              ).map(({ weekday, entries }) => ({ weekday, ranges: entries })),
            })),
          },
        ],
        periods: [period("p1", "Lunch", "green"), period("p2", "Dinner", "red")],
        seasonWeeks: [
          {
            seasonId: "spring",
            week: week({ 1: [{ periodId: "p2", startsAt: "20:00", endsAt: "23:00" }] }).map(
              ({ weekday, entries }) => ({ weekday, slots: entries }),
            ),
          },
          {
            seasonId: "winter",
            week: week({ 1: [{ periodId: "p1", startsAt: "13:00", endsAt: "16:00" }] }).map(
              ({ weekday, entries }) => ({ weekday, slots: entries }),
            ),
          },
        ],
      },
      {
        id: "d2",
        name: "Old bar",
        active: false,
        zones: [],
        periods: [],
        seasonWeeks: [],
      },
    ],
  };
}

export type Write = { url: string; method: string; body: unknown };
export function painterApi(writes: Write[] = [], answer: (write: Write) => unknown = () => ({})) {
  return new OpeningHoursApi((async (url, method, body) => {
    if (method === "GET") return url.includes("/menu-periods/painted-in") ? [] : painterModel();
    const write = { url, method, body };
    writes.push(write);
    return answer(write);
  }) as DashboardRequest);
}

export const frame = (el: SeasonPainter) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["painter-frame"]>("painter-frame")!;
export const grid = (el: SeasonPainter) => el.shadowRoot!.querySelector<PaintGrid>("paint-grid")!;
export async function settle(el: SeasonPainter) {
  await el.updateComplete;
  await frame(el).updateComplete;
  await grid(el).updateComplete;
}
export async function pick(el: SeasonPainter, value: string) {
  el.shadowRoot!.querySelector("[name=department]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settle(el);
}
function point(el: PaintGrid, key: string, minute: number, type: string) {
  const day = el.shadowRoot!.querySelector<HTMLElement>(`.day[data-column="${key}"]`)!;
  const box = day.getBoundingClientRect();
  (type === "pointerdown" ? day : window).dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      pointerId: 7,
      button: 0,
      clientX: box.left + box.width / 2,
      clientY: box.top + (minute / 1440) * box.height,
    }),
  );
}
/** Minutes are counted from the 06:00 changeover. */
export async function drag(el: SeasonPainter, key: string, from: number, to: number) {
  const target = grid(el);
  point(target, key, from, "pointerdown");
  point(target, key, to, "pointermove");
  await target.updateComplete;
  point(target, key, to, "pointerup");
  await settle(el);
}

/** The painter model with a second active department, Bar, painting with its own period q1. */
export function withBar(model = painterModel()): OpeningHoursModel {
  const restaurant = model.departments[0]!;
  return {
    ...model,
    departments: [
      ...model.departments,
      {
        id: "d3",
        name: "Bar",
        active: true,
        zones: [],
        periods: [{ ...restaurant.periods[0]!, id: "q1", name: "Drinks" }],
        seasonWeeks: restaurant.seasonWeeks.map(({ seasonId }) => ({
          seasonId,
          week: Array.from({ length: 7 }, (_, weekday) => ({ weekday, slots: [] })),
        })),
      },
    ],
  };
}

/** Gives models set by hand a watch's read number: `after` places one after any save's reread. */
export function readNumbers(el: SeasonPainter) {
  const numbers = new WeakMap<object, number>();
  vi.spyOn(el.api, "readNumberOf").mockImplementation((model) => numbers.get(model));
  const at = <M extends object>(model: M, number: number): M => {
    numbers.set(model, number);
    return model;
  };
  return { at, after: <M extends object>(model: M) => at(model, Number.MAX_SAFE_INTEGER) };
}

export type Slot = { periodId: string; startsAt: string; endsAt: string };
/** `model` with the given days of one department's week in one season replaced. */
export function withDays(
  model: OpeningHoursModel,
  departmentId: string,
  days: Record<number, Slot[]>,
  seasonId = "winter",
): OpeningHoursModel {
  const season = model.departments
    .find(({ id }) => id === departmentId)!
    .seasonWeeks.find((week) => week.seasonId === seasonId)!;
  season.week = season.week.map(({ weekday, slots }) => ({
    weekday,
    slots: days[weekday] ?? slots,
  }));
  return model;
}
export const slot = (periodId: string, startsAt: string, endsAt: string): Slot => ({
  periodId,
  startsAt,
  endsAt,
});
