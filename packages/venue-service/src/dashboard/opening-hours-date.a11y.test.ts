import { withOpeningStations } from "../testing/opening-hours-stations-request.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, "", "/manage/opening-hours");
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Opening special date (%s)", (theme) => {
  test.each(["viewer", "empty"])("%s", async (state) => {
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
      namedDays: [],
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
          dates: [],
        },
      ],
    };
    screen.api = new OpeningHoursApi(withOpeningStations((async () => model) as DashboardRequest));
    wrapper.appendChild(screen);
    await expect.poll(() => screen.shadowRoot?.querySelector("opening-hours-week")).not.toBeNull();
    await screen.updateComplete;
    const week =
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-week"]>(
        "opening-hours-week",
      );
    await week?.updateComplete;
    await expectNoA11yViolations(host);
  });
});
