import { withOpeningStations } from "../testing/opening-hours-stations-request.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { namedWeekModel } from "../testing/real-week-model.js";
import type { SpecialDayDetail } from "../special-days.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, "", "/manage/opening-hours");
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Opening special date (%s)", (theme) => {
  test.each(["viewer", "empty", "special", "closed"])("%s", async (state) => {
    setLocale("en");
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    history.replaceState(null, "", "/manage/opening-hours?week=2026-10-12");
    const wrapper = await mountThemed("<div></div>", theme);
    const screen = document.createElement("dashboard-opening-hours-screen");
    screen.readOnly = state === "viewer";
    const model = {
      businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
      clockRevision: 0,
      currentBusinessDay: "2026-10-12",
      pending: null,
      timeZone: "Europe/Madrid",
      clockReadable: true,
      seasons: [{ id: "autumn", name: "Autumn", startsOn: "09-01" }],
      currentSeasonId: "autumn",
      dayCutover: "06:00",
      menus: [],
      departments: [
        {
          id: "d1",
          name: "Restaurant",
          active: true,
          periods: [
            {
              id: "p1",
              name: "Lunch",
              colour: "green",
              menuId: "m1",
              staffMenuIds: [],
              endOffsetMinutes: 0,
              weekdays: [1],
              routingUses: [],
            },
          ],
          seasonWeeks: [
            {
              seasonId: "autumn",
              week: [
                { weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] },
              ],
            },
          ],
        },
      ],
    };
    const party: SpecialDayDetail = {
      id: "party",
      name: "Party",
      repeatsYearly: false,
      dates: [{ date: "2026-10-13", closedAllDay: state === "closed" }],
      paint: [
        {
          departmentId: "d1",
          date: "2026-10-13",
          ranges: [{ periodId: "p1", startsAt: "12:00", endsAt: "13:00" }],
        },
      ],
      zonePaint: [],
    };
    const dated = state === "special" || state === "closed";
    screen.api = new OpeningHoursApi(
      withOpeningStations((async (path: string) =>
        !dated
          ? model
          : path.includes("/named-days?")
            ? {
                ...namedWeekModel(),
                days: [
                  {
                    date: "2026-10-13",
                    specialDay: { id: "party", name: "Party" },
                    holidays: [],
                    tone: "special_day",
                    closed: state === "closed",
                  },
                ],
              }
            : path.endsWith("/special-days/party")
              ? structuredClone(party)
              : model) as DashboardRequest),
    );
    wrapper.appendChild(screen);
    await expect.poll(() => screen.shadowRoot?.querySelector("opening-hours-week")).not.toBeNull();
    await screen.updateComplete;
    const week =
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-week"]>(
        "opening-hours-week",
      );
    await week?.updateComplete;
    if (dated) {
      const grid = week!.shadowRoot!.querySelector("service-grid")!;
      await expect
        .poll(() => grid.columns[1]!.slots)
        .toEqual(
          state === "closed" ? [] : [{ periodId: "p1", startsAt: "12:00", endsAt: "13:00" }],
        );
      expect(grid.columns[1]!.label).toContain("Party");
      expect(grid.columns[1]!.label.endsWith(" · Closed")).toBe(state === "closed");
      expect(week!.shadowRoot!.querySelectorAll("a[data-test=day-link]")).toHaveLength(7);
    }
    await expectNoA11yViolations(host);
  });
});
