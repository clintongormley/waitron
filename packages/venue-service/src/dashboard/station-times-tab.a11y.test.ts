import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { addDays } from "../hours-rules.js";
import { monthModel } from "../testing/opening-hours-month-fixture.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { PrepStationTimes } from "./station-times-tab.js";
import "./station-times-tab.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setLocale("en");
});

const STATIONS = [
  { id: "grill", name: "Grill", active: true, isDefault: false, displayOrder: 1 },
  { id: "kitchen", name: "Kitchen", active: true, isDefault: true, displayOrder: 2 },
];
const PERIODS = [
  {
    id: "dinner",
    departmentId: "rest",
    departmentName: "Restaurant",
    name: "Dinner",
    colour: "red",
  },
  { id: "allday", departmentId: "bar", departmentName: "Bar", name: "All day", colour: "purple" },
] as const;

type State = "month" | "default" | "error" | "no stations";
function api(state: State) {
  return new OpeningHoursApi((async (path: string) => {
    if (state === "error") throw new Error("read refused");
    const url = new URL(path, location.origin);
    if (url.pathname.endsWith("/opening-hours/month")) return monthModel();
    if (url.pathname.includes("/kitchen/")) return { always: "default", days: [] };
    const days = [];
    const to = url.searchParams.get("to")!;
    for (let date = url.searchParams.get("from")!; date <= to; date = addDays(date, 1))
      days.push({
        date,
        departments:
          date === "2026-12-25" || date.endsWith("6")
            ? []
            : [
                {
                  departmentId: "rest",
                  ranges: [{ periodId: "dinner", startsAt: "19:00", endsAt: "01:00" }],
                },
                {
                  departmentId: "bar",
                  ranges: [{ periodId: "allday", startsAt: "10:00", endsAt: "02:00" }],
                },
              ],
      });
    return { always: null, days };
  }) as DashboardRequest);
}

describe.each(["en", "es"] as const)("Prep station times accessibility (%s)", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each(["month", "default", "error", "no stations"] as const)("%s", async (state) => {
      setLocale(locale);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-12-10T10:00:00Z"));
      await mountThemed("<div></div>", theme);
      const el = document.createElement("prep-station-times") as PrepStationTimes;
      Object.assign(el, {
        api: api(state),
        stations: state === "no stations" ? [] : STATIONS,
        periods: PERIODS,
        stationId: state === "default" ? "kitchen" : "grill",
      });
      host.append(el);
      const root = el.shadowRoot!;
      const ready = {
        month: () =>
          root
            .querySelector("opening-hours-month")
            ?.shadowRoot?.querySelector('.track[data-row="grill"]') ?? null,
        default: () => root.querySelector('[data-test="always-open"]'),
        error: () => root.querySelector('[role="alert"]'),
        "no stations": () => root.querySelector("p"),
      }[state];
      await expect.poll(ready).not.toBeNull();
      await expectNoA11yViolations(host);
    });
  });
});
