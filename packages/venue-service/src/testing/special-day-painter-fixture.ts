import { type DashboardRequest, type LiveData } from "@waitron/dashboard-kit";
import { OpeningHoursApi } from "../dashboard/opening-hours-client.js";
import type { SpecialDayPainter } from "../dashboard/special-day-painter.js";
import type { SeasonDays } from "../opening-hours-calendar.js";
import type { ClosedRange, ServiceRange } from "../service-day.js";
import type { SpecialDayDetail, SpecialDayInput, SpecialDaySummary } from "../special-days.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { painterModel, type Write } from "./season-painter-fixture.js";

export { painterModel, type Write };

/** Two ordinary December dates and Christmas Day, stored on the public holiday "Navidad". */
export function storedDay(over: Partial<SpecialDayDetail> = {}): SpecialDayDetail {
  return {
    id: "sd1",
    name: "Christmas dinners",
    repeatsYearly: false,
    dates: [
      { date: "2026-12-14", closedAllDay: false },
      { date: "2026-12-15", closedAllDay: false },
      { date: "2026-12-25", closedAllDay: true, holidayName: "Navidad" },
    ],
    paint: [],
    zonePaint: [],
    ...over,
  };
}

export interface SpecialDayAnswers {
  /** The stored special days a read can find, by id. */
  days?: Record<string, SpecialDayDetail>;
  /** Awaited before a special day read answers with the day as it was when asked. */
  dayAfter?: () => Promise<unknown> | undefined;
  /** What the list of special days answers; defaults to the stored days above. */
  list?: readonly SpecialDaySummary[];
  /** Awaited before the list answers. */
  listAfter?: Promise<unknown>;
  /** The list read fails. */
  failingList?: boolean;
  /** Dates other special days hold, which the month read reports. */
  taken?: readonly { date: string; id: string; name: string }[];
  /** Months whose read fails. */
  failingMonths?: readonly string[];
  /** Each date's season, which the season days read reports; by default no hours and no closures. */
  season?: (date: string) => {
    ranges?: ServiceRange[];
    zones?: Record<string, ClosedRange[]>;
    dayCutover?: string;
    /** Departments other than `d1`, with no zones. */
    others?: { departmentId: string; ranges: ServiceRange[] }[];
  };
  /** Awaited before a season days read answers. */
  seasonAfter?: () => Promise<unknown>;
  /** The season days read fails. */
  failingSeason?: () => boolean;
  /** A write's answer; thrown when it returns an object with a `code`. Defaults to the saved day. */
  answer?: (write: Write) => unknown;
  /** What the opening hours model read answers, as it is when asked; defaults to `painterModel`. */
  model?: () => OpeningHoursModel;
  /** Awaited before the opening hours model read answers. */
  modelAfter?: () => Promise<unknown> | undefined;
  liveData?: LiveData;
}

/** The answer a save gets by default, as the server builds it: the request's facts as a stored day
 *  `sd1`, or `sd-new`, keeping the stored paint of every kept date the request names no paint for. */
export function savedFrom(write: Write, stored: SpecialDayDetail | undefined): SpecialDayDetail {
  const body = write.body as SpecialDayInput;
  const id = write.method === "POST" ? "sd-new" : decodeURIComponent(write.url.split("/").pop()!);
  const dates = new Set(body.dates.map(({ date }) => date));
  const named = new Set([
    ...(body.paint ?? []).map(({ departmentId, date }) => `d:${departmentId}/${date}`),
    ...(body.zonePaint ?? []).map(({ zoneId, date }) => `z:${zoneId}/${date}`),
  ]);
  const kept = <T extends { date: string }>(entries: readonly T[], key: (entry: T) => string) =>
    entries.filter((entry) => dates.has(entry.date) && !named.has(key(entry)));
  return {
    id,
    name: body.name.trim(),
    repeatsYearly: body.repeatsYearly,
    dates: body.dates.map(({ date, closedAllDay }) => ({ date, closedAllDay })),
    paint: [
      ...kept(stored?.paint ?? [], ({ departmentId, date }) => `d:${departmentId}/${date}`),
      ...(body.paint ?? []).filter(({ ranges }) => ranges.length),
    ].map((entry) => ({ ...entry, ranges: [...entry.ranges] })),
    zonePaint: [
      ...kept(stored?.zonePaint ?? [], ({ zoneId, date }) => `z:${zoneId}/${date}`),
      ...(body.zonePaint ?? []).filter(({ ranges }) => ranges.length),
    ].map((entry) => ({ ...entry, ranges: [...entry.ranges] })),
  };
}

export function specialDayApi(writes: Write[] = [], answers: SpecialDayAnswers = {}) {
  return new OpeningHoursApi(
    (async (url, method, body) => {
      if (method === "GET") {
        if (url.includes("/menu-periods/painted-in")) return [];
        if (/\/special-days$/.test(url)) {
          await answers.listAfter;
          if (answers.failingList) throw { code: "server.internal" };
          return structuredClone(answers.list ?? Object.values(answers.days ?? {}));
        }
        const day = /\/special-days\/([^/?]+)$/.exec(url);
        if (day) {
          const found = answers.days?.[decodeURIComponent(day[1]!)];
          if (!found) throw { code: "special_day.not_found" };
          const detail = structuredClone(found);
          await answers.dayAfter?.();
          return detail;
        }
        if (url.includes("/opening-hours/season-days?")) {
          await answers.seasonAfter?.();
          if (answers.failingSeason?.()) throw { code: "server.internal" };
          const dates = new URL(url, "http://x").searchParams.get("dates")!.split(",");
          return {
            days: dates.map((date) => {
              const season = answers.season?.(date) ?? {};
              return {
                date,
                seasonId: "winter",
                dayCutover: season.dayCutover ?? "06:00",
                departments: [
                  {
                    departmentId: "d1",
                    ranges: season.ranges ?? [],
                    zones: ["z1", "z2"].map((zoneId) => ({
                      zoneId,
                      closed: season.zones?.[zoneId] ?? [],
                    })),
                  },
                  ...(season.others ?? []).map((other) => ({ ...other, zones: [] })),
                ],
              };
            }),
          } satisfies SeasonDays;
        }
        const month = /\/opening-hours\/month\?month=(\d{4}-\d{2})/.exec(url)?.[1];
        if (month && answers.failingMonths?.includes(month)) throw { code: "server.internal" };
        if (month)
          return {
            days: (answers.taken ?? [])
              .filter(({ date }) => date.startsWith(month))
              .map(({ date, id, name }) => ({ date, inMonth: true, specialDay: { id, name } })),
          };
        const model = answers.model?.() ?? painterModel();
        await answers.modelAfter?.();
        return model;
      }
      const write = { url, method, body };
      writes.push(write);
      const answer = answers.answer ? await answers.answer(write) : undefined;
      if (answer && typeof answer === "object" && "code" in answer) throw answer;
      if (answer !== undefined) return answer;
      if (method === "DELETE") return undefined;
      const stored = answers.days?.[decodeURIComponent(url.split("/").pop()!)];
      return savedFrom(write, method === "PUT" ? stored : undefined);
    }) as DashboardRequest,
    answers.liveData,
  );
}

export const frame = (el: SpecialDayPainter) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["painter-frame"]>("painter-frame")!;
export const grid = (el: SpecialDayPainter) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["paint-grid"]>("paint-grid")!;
export const part = <T extends HTMLElement = HTMLElement>(el: SpecialDayPainter, test: string) =>
  el.shadowRoot!.querySelector<T>(`[data-test="${test}"]`);
export async function pick(el: SpecialDayPainter, value: string) {
  el.shadowRoot!.querySelector("[name=department]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settle(el);
}
function point(el: HTMLElementTagNameMap["paint-grid"], key: string, minute: number, type: string) {
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
/** Minutes are counted from the changeover the grid draws from. */
export async function drag(el: SpecialDayPainter, key: string, from: number, to: number) {
  const target = grid(el);
  point(target, key, from, "pointerdown");
  point(target, key, to, "pointermove");
  await target.updateComplete;
  point(target, key, to, "pointerup");
  await settle(el);
}
export async function settle(el: SpecialDayPainter) {
  await el.updateComplete;
  await frame(el)?.updateComplete;
  await grid(el)?.updateComplete;
}
