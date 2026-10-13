import { withOpeningStations } from "../testing/opening-hours-stations-request.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";
import type { SpecialDaysModel } from "../holiday-types.js";
import type { SpecialDayDetail } from "../special-days.js";
import { namedWeekModel } from "../testing/real-week-model.js";

let screen: HTMLElementTagNameMap["dashboard-opening-hours-screen"];
const originalUrl = location.href;
beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/manage/opening-hours");
});
afterEach(() => {
  screen?.remove();
  vi.useRealTimers();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});
function emit(target: Element, name: string, detail: unknown) {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
async function mount(
  date: string,
  timeZone = "Europe/Madrid",
  clockReadable = true,
  write: (path: string, method: string, body: unknown) => Promise<unknown> = async () => {},
) {
  vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  history.replaceState(null, "", `/manage/opening-hours/view/day/date/${date}`);
  const model = {
    businessDayClock: { timeZone, dayCutover: "06:00", cutoverChanges: [] },
    dayCutover: "06:00",
    timeZone,
    clockReadable,
    seasons: [{ id: "autumn", name: "Autumn", startsOn: "09-01" }],
    currentSeasonId: "autumn",
    menus: [{ id: "m1", name: "Night menu", active: true, includes: [] }],
    departments: [
      {
        id: "d1",
        name: "Restaurant",
        active: true,
        periods: [
          {
            id: "p1",
            name: "Night",
            colour: "green" as const,
            menuId: "m1",
            staffMenuIds: [],
            endOffsetMinutes: 0,
            weekdays: [],
            routingUses: [],
          },
        ],
        seasonWeeks: [{ seasonId: "autumn", week: [] }],
      },
    ],
  };
  const detail: SpecialDayDetail = {
    id: "s1",
    name: "Clock change",
    repeatsYearly: false,
    dates: [{ date, closedAllDay: false }],
    paint: [],
    zonePaint: [],
  };
  const calendar: SpecialDaysModel = {
    ...namedWeekModel(),
    days: [
      {
        date,
        specialDay: { id: "s1", name: "Clock change" },
        holidays: [],
        tone: "special_day",
        closed: false,
      },
    ],
  };
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.api = new OpeningHoursApi(
    withOpeningStations((async (path, method, body) =>
      method !== "GET"
        ? write(path, method, body)
        : path.includes("/named-days?")
          ? calendar
          : path.endsWith("/special-days/s1")
            ? structuredClone(detail)
            : model) as DashboardRequest),
  );
  applyTokens(screen);
  document.body.append(screen);
  await expect.poll(() => screen.shadowRoot?.querySelector("opening-hours-day")).not.toBeNull();
  await screen.updateComplete;
  const week =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-day"]>(
      "opening-hours-day",
    )!;
  await expect.poll(() => week.shadowRoot!.querySelector("[data-test=save-day]")).not.toBeNull();
  const grid =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["service-grid"]>("service-grid")!;
  emit(grid, "grid-range-select", {
    columnKey: "d1",
    startsAt: "01:00",
    endsAt: "02:30",
  });
  await week.updateComplete;
  const range =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["range-dialog"]>("range-dialog")!;
  await range.updateComplete;
  emit(range.shadowRoot!.querySelector("[name=periodId]")!, "wt-change", { value: "p1" });
  await range.updateComplete;
  return {
    week,
    range,
    grid,
    column: () => grid.columns.find((c) => c.key === "d1")!,
  };
}
for (const locale of ["en", "es"] as const) {
  it(`explains the repeated endpoint on the next calendar morning (${locale})`, async () => {
    const writes: unknown[] = [];
    const { range, week } = await mount("2026-10-24", undefined, undefined, async (...args) => {
      writes.push(args);
    });
    setLocale(locale);
    range.requestUpdate();
    await range.updateComplete;
    expect(range.shadowRoot!.querySelector("[data-test=repeat-note]")?.textContent?.trim()).toBe(
      locale === "en"
        ? "The clock shows 02:30 twice on this date; both follow this timetable."
        : "El reloj marca las 02:30 dos veces en esta fecha; las dos siguen este horario.",
    );
    range.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
    await week.updateComplete;
    expect(writes).toEqual([]);
    week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-day]")!.click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes).toEqual([
      [
        "/management-api/venue-service/special-days/s1",
        "PUT",
        {
          name: "Clock change",
          repeatsYearly: false,
          dates: [{ date: "2026-10-24", closedAllDay: false }],
          paint: [
            {
              departmentId: "d1",
              date: "2026-10-24",
              ranges: [{ periodId: "p1", startsAt: "01:00", endsAt: "02:30" }],
            },
          ],
        },
      ],
    ]);
  });
}
for (const [date, zone, readable] of [
  ["2026-10-25", "Europe/Madrid", true],
  ["2026-10-24", "UTC", true],
  ["2026-10-24", "unreadable", false],
] as const) {
  it(`does not invent a repeated time for ${date}, ${zone}, readable=${readable}`, async () => {
    const { range } = await mount(date, zone, readable);
    expect(range.shadowRoot!.querySelector("[data-test=repeat-note]")).toBeNull();
  });
}
it("explains a skipped-clock refusal beside the date and keeps the submitted range retryable", async () => {
  const { range, week, column } = await mount("2027-03-27", undefined, undefined, async () => {
    throw {
      code: "special_day.invalid",
      params: { field: "paint.0.ranges.0.endsAt", reason: "clock_skips", date: "2027-03-27" },
    };
  });
  range.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
  await week.updateComplete;
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-day]")!.click();
  await expect
    .poll(() => week.shadowRoot!.querySelector("[data-department-error=d1]"))
    .not.toBeNull();
  expect(week.shadowRoot!.querySelector("[data-department-error=d1]")!.textContent).toContain(
    "The clock skips this time on this date.",
  );
  expect(column().slots).toEqual([{ periodId: "p1", startsAt: "01:00", endsAt: "02:30" }]);
  expect(
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-day]")!
      .disabled,
  ).toBe(false);
});

it("checks an end at the changeover on the next calendar morning and a start on this one", async () => {
  const { range } = await mount("2026-10-24");
  range.dayCutover = "02:30";
  emit(range.shadowRoot!.querySelector("[name=startsAt]")!, "wt-change", { value: "02:30" });
  emit(range.shadowRoot!.querySelector("[name=endsAt]")!, "wt-change", { value: "02:30" });
  await range.updateComplete;
  expect(
    [...range.shadowRoot!.querySelectorAll("[data-test=repeat-note]")].map((note) =>
      note.textContent?.trim(),
    ),
  ).toEqual(["The clock shows 02:30 twice on this date; both follow this timetable."]);
});
it("removes the repeated-time note after fixing an endpoint and never checks incomplete times", async () => {
  const { range } = await mount("2026-10-24");
  for (const value of ["03:30", "", "invalid", "02:31"]) {
    emit(range.shadowRoot!.querySelector("[name=endsAt]")!, "wt-change", { value });
    await range.updateComplete;
    expect(range.shadowRoot!.querySelector("[data-test=repeat-note]")).toBeNull();
  }
});
