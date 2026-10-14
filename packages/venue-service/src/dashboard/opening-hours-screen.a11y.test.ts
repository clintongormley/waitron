import { withOpeningStations } from "../testing/opening-hours-stations-request.js";
import { afterEach, describe, expect, test } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { OpeningHoursScreen } from "./opening-hours-screen.js";
import "./opening-hours-screen.js";

const originalUrl = location.href;
afterEach(() => {
  cleanup();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});
describe.each(["light", "dark"] as const)("Opening hours (%s)", (theme) => {
  test.each(["load-failed", "unreadable-viewer"])("%s", async (state) => {
    setLocale("en");
    history.replaceState(null, "", "/manage/opening-hours/view/year");
    // Assign the API before connecting: the screen attaches its passive model watch on connection.
    const wrapper = await mountThemed("<div></div>", theme);
    const screen = document.createElement("dashboard-opening-hours-screen") as OpeningHoursScreen;
    screen.api = new OpeningHoursApi(
      withOpeningStations((async (path: string) => {
        if (state === "load-failed") throw new Error("offline");
        if (path.includes("/opening-hours/year?"))
          return {
            businessDayClock: {
              timeZone: "Europe/Madrid",
              dayCutover: "06:00",
              cutoverChanges: [],
            },
            clockRevision: 0,
            currentBusinessDay: "2026-10-12",
            pending: null,
            year: Number(new URL(path, location.href).searchParams.get("year")),
            timeZone: "Europe/Madrid",
            today: "2026-10-12",
            seasons: [],
            days: [],
            publicHolidaysAvailable: true,
            missingHolidays: [],
            holidayCoverage: [],
            area: {
              addressKey: "fixture-address",
              readiness: "ready",
              options: [],
              required: false,
              chosen: null,
            },
          };
        return {
          businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
          clockRevision: 0,
          currentBusinessDay: "2026-10-12",
          pending: null,
          timeZone: "Europe/Madrid",
          clockReadable: state !== "unreadable-viewer",
          dayCutover: "06:00",
          menus: [{ id: "lunch", name: "Lunch menu", active: true, includes: [] }],
          departments: [
            {
              id: "restaurant",
              name: "Restaurant",
              active: true,
              periods: [
                {
                  id: "p1",
                  name: "Lunch",
                  colour: "green",
                  menuId: "lunch",
                  staffMenuIds: [],
                  endOffsetMinutes: 0,
                  weekdays: [1, 3],
                  routingUses: [],
                },
              ],
            },
          ],
        };
      }) as DashboardRequest),
    );
    screen.readOnly = state === "unreadable-viewer";
    wrapper.appendChild(screen);
    if (state === "load-failed") {
      await expect
        .poll(() => screen.shadowRoot!.querySelector("[data-test=read-error]"))
        .not.toBeNull();
      expect(screen.shadowRoot!.querySelector("[data-test=read-error]")!.textContent).toBe(
        "Opening hours could not be loaded. It will be tried again.",
      );
      await expectNoA11yViolations(host);
      return;
    }
    await expect
      .poll(() => screen.shadowRoot!.querySelector("opening-hours-year")?.model)
      .toBeDefined();
    await screen.shadowRoot!.querySelector("opening-hours-year")!.updateComplete;
    await expectNoA11yViolations(host);
  });
});
