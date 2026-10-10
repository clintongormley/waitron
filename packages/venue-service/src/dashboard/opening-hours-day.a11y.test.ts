import { withOpeningStations } from "../testing/opening-hours-stations-request.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";
const originalUrl = location.href;
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});
describe.each(["light", "dark"] as const)("Opening Day (%s)", (theme) => {
  test.each([
    "normal",
    "special",
    "refused",
    "viewer",
    "empty",
    "clock",
    "range",
    "new-period",
    "closed",
    "zone-range",
  ])("%s", async (state) => {
    setLocale("en");
    history.replaceState(null, "", "/manage/opening-hours/view/day");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    const wrapper = await mountThemed("<div></div>", theme);
    const screen = document.createElement("dashboard-opening-hours-screen");
    screen.readOnly = state === "viewer";
    screen.api = new OpeningHoursApi(
      withOpeningStations((async (_, method) => {
        if (method !== "GET")
          throw { code: "menu_timetable.invalid", params: { field: "days.1.slots" } };
        return {
          timeZone: "Europe/Madrid",
          clockReadable: state !== "clock",
          dayCutover: "06:00",
          menus: [{ id: "m1", name: "Lunch menu", active: true, includes: [] }],
          namedDays:
            state === "special" || state === "closed"
              ? [
                  {
                    id: "s1",
                    date: "2026-10-12",
                    name: "Holiday",
                    kind: "working_day" as const,
                    repeats: false,
                    ownHours: true,
                    closeWholeVenue: state === "closed",
                  },
                ]
              : [],
          departments:
            state === "empty"
              ? []
              : ["Restaurant", "Deli"].map((name, i) => ({
                  id: `d${i + 1}`,
                  name,
                  active: true,
                  zones: i
                    ? []
                    : [
                        {
                          id: "z1",
                          name: "Terrace",
                          week: [{ weekday: 1, ranges: [{ startsAt: "23:00", endsAt: "06:00" }] }],
                          dates: [],
                        },
                      ],
                  periods: [
                    {
                      id: `p${i + 1}`,
                      name: "Lunch",
                      colour: i ? "blue" : "green",
                      menuId: "m1",
                      staffMenuIds: [],
                      endOffsetMinutes: 0,
                      weekdays: [1],
                      routingUses: [],
                    },
                  ],
                  week: [
                    {
                      weekday: 1,
                      slots: [{ periodId: `p${i + 1}`, startsAt: "10:00", endsAt: "14:00" }],
                    },
                  ],
                  dates: [],
                })),
        };
      }) as DashboardRequest),
    );
    wrapper.appendChild(screen);
    await expect.poll(() => screen.shadowRoot?.querySelector("opening-hours-day")).not.toBeNull();
    const day =
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-day"]>(
        "opening-hours-day",
      )!;
    await day.updateComplete;
    const grid = day.shadowRoot!.querySelector("service-grid");
    if (state === "refused") {
      grid!.dispatchEvent(
        new CustomEvent("grid-block-change", {
          detail: { columnKey: "d1", index: 0, startsAt: "10:00", endsAt: "15:00" },
        }),
      );
      await day.updateComplete;
      day.shadowRoot!.querySelector<HTMLElement>("[data-test=save-day]")!.click();
      await expect
        .poll(() => day.shadowRoot!.querySelector("[data-department-error=d1]"))
        .not.toBeNull();
    }
    if (state === "zone-range") {
      grid!.dispatchEvent(
        new CustomEvent("grid-block-open", { detail: { columnKey: "zone:z1", index: 0 } }),
      );
      await day.updateComplete;
      await day.shadowRoot!.querySelector("range-dialog")!.updateComplete;
    }
    if (state === "range" || state === "new-period") {
      grid!.dispatchEvent(
        new CustomEvent("grid-range-select", {
          detail: { columnKey: "d1", startsAt: "07:00", endsAt: "09:00" },
        }),
      );
      await day.updateComplete;
      const range =
        day.shadowRoot!.querySelector<HTMLElementTagNameMap["range-dialog"]>("range-dialog")!;
      await range.updateComplete;
      if (state === "new-period") {
        range
          .shadowRoot!.querySelector("[name=periodId]")!
          .dispatchEvent(new CustomEvent("wt-combobox-action", { detail: { value: "new" } }));
        await day.updateComplete;
        await day.shadowRoot!.querySelector<HTMLElementTagNameMap["period-editor"]>(
          "period-editor",
        )!.updateComplete;
      }
    }
    await expectNoA11yViolations(host);
  });
});
