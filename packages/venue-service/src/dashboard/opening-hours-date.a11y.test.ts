import { afterEach, describe, expect, test } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";
afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Opening special date (%s)", (theme) => {
  test.each(["date", "following", "closed", "viewer", "refused", "empty"])("%s", async (state) => {
    setLocale("en");
    const wrapper = await mountThemed("<div></div>", theme);
    const screen = document.createElement("dashboard-opening-hours-screen");
    screen.readOnly = state === "viewer";
    const model = {
      timeZone: "Europe/Madrid",
      clockReadable: true,
      dayCutover: "06:00",
      namedDays:
        state === "empty"
          ? []
          : [
              {
                id: "s1",
                date: "2026-10-12",
                name: "Holiday",
                kind: "working_day" as const,
                repeats: false,
                ownHours: true,
                hasStationHours: false,
                closeWholeVenue: false,
              },
            ],
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
            },
          ],
          week: [{ weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] }],
          dates:
            state === "following"
              ? []
              : [
                  {
                    specialDateId: "s1",
                    slots: [{ periodId: "p1", startsAt: "12:00", endsAt: "16:00" }],
                  },
                ],
        },
      ],
    };
    screen.api = new OpeningHoursApi((async (_url, method) => {
      if (method === "GET") return model;
      throw { code: "menu_timetable.invalid", params: { field: "slots.0.endsAt" } };
    }) as DashboardRequest);
    wrapper.appendChild(screen);
    await expect.poll(() => screen.shadowRoot?.querySelector("[name=weekMode]")).not.toBeNull();
    screen
      .shadowRoot!.querySelector("[name=weekMode]")!
      .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "date" } }));
    await screen.updateComplete;
    const week =
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-week"]>(
        "opening-hours-week",
      );
    if (week) {
      await week.updateComplete;
      if (state === "closed") {
        week.shadowRoot!.querySelector<HTMLElement>("[data-test=close-date]")!.click();
        await week.updateComplete;
      }
      if (state === "refused") {
        week.shadowRoot!.querySelector("service-grid")!.dispatchEvent(
          new CustomEvent("grid-block-change", {
            detail: { columnKey: "1", index: 0, startsAt: "12:00", endsAt: "17:00" },
          }),
        );
        await week.updateComplete;
        week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-week]")!.click();
        await expect
          .poll(() => week.shadowRoot!.querySelector("[data-day-error='1']"))
          .not.toBeNull();
      }
    }
    await expectNoA11yViolations(host);
  });
});
