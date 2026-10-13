import { type DashboardRequest } from "@waitron/dashboard-kit";
import { OpeningHoursApi } from "../dashboard/opening-hours-client.js";
import type { SpecialDayPainter } from "../dashboard/special-day-painter.js";
import type { SpecialDayDetail } from "../special-days.js";
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
  /** Dates other special days hold, which the month read reports. */
  taken?: readonly { date: string; id: string; name: string }[];
  /** Months whose read fails. */
  failingMonths?: readonly string[];
  /** A write's answer; thrown when it returns an object with a `code`. Defaults to the saved day. */
  answer?: (write: Write) => unknown;
}

/** The answer a save gets by default: the request's facts as a stored day `sd1`, or `sd-new`. */
function savedFrom(write: Write): SpecialDayDetail {
  const body = write.body as Pick<SpecialDayDetail, "name" | "repeatsYearly" | "dates">;
  const id = write.method === "POST" ? "sd-new" : decodeURIComponent(write.url.split("/").pop()!);
  return {
    id,
    name: body.name.trim(),
    repeatsYearly: body.repeatsYearly,
    dates: body.dates.map(({ date, closedAllDay }) => ({ date, closedAllDay })),
    paint: [],
    zonePaint: [],
  };
}

export function specialDayApi(writes: Write[] = [], answers: SpecialDayAnswers = {}) {
  return new OpeningHoursApi((async (url, method, body) => {
    if (method === "GET") {
      const day = /\/special-days\/([^/?]+)$/.exec(url);
      if (day) {
        const found = answers.days?.[decodeURIComponent(day[1]!)];
        if (!found) throw { code: "special_day.not_found" };
        return structuredClone(found);
      }
      const month = /\/opening-hours\/month\?month=(\d{4}-\d{2})/.exec(url)?.[1];
      if (month && answers.failingMonths?.includes(month)) throw { code: "server.internal" };
      if (month)
        return {
          days: (answers.taken ?? [])
            .filter(({ date }) => date.startsWith(month))
            .map(({ date, id, name }) => ({ date, inMonth: true, specialDay: { id, name } })),
        };
      return painterModel();
    }
    const write = { url, method, body };
    writes.push(write);
    const answer = answers.answer ? await answers.answer(write) : undefined;
    if (answer && typeof answer === "object" && "code" in answer) throw answer;
    if (answer !== undefined) return answer;
    return method === "DELETE" ? undefined : savedFrom(write);
  }) as DashboardRequest);
}

export const frame = (el: SpecialDayPainter) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["painter-frame"]>("painter-frame")!;
export const grid = (el: SpecialDayPainter) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["paint-grid"]>("paint-grid")!;
export const part = <T extends HTMLElement = HTMLElement>(el: SpecialDayPainter, test: string) =>
  el.shadowRoot!.querySelector<T>(`[data-test="${test}"]`);
export async function settle(el: SpecialDayPainter) {
  await el.updateComplete;
  await frame(el)?.updateComplete;
  await grid(el)?.updateComplete;
}
