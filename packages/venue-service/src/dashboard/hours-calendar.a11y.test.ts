import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { NamedDaysApi } from "./named-days-client.js";
import { registerIcons } from "@waitron/ui";

import type { NamedDaysModel } from "../holiday-types.js";
import type { HoursCalendar } from "./hours-calendar.js";
import "./hours-calendar.js";

beforeEach(() => setLocale("en"));

afterEach(async () => {
  cleanup();
  setLocale("en");
  await page.viewport(1280, 800);
});

async function settle(el: HoursCalendar) {
  for (let turn = 0; turn < 3; turn++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe.each(["light", "dark"] as const)("Named month accessibility (%s)", (theme) => {
  test("each kind, own hours, closed public holiday and area picker", async () => {
    registerIcons({
      clock:
        "M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11A5.5 5.5 0 0 1 8 2.5ZM7.25 4H8.75V7.5L11 9 10.2 10.2 7.25 8.25Z",
    });
    await mountThemed("<div></div>", theme);
    const model: NamedDaysModel = {
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
      civilDate: "2026-10-07",
      clockReadable: true,
      days: ["public_holiday", "own_holiday", "working_day", "closed", "standard"].map(
        (tone, index) => ({
          date: `2026-10-${12 + index}`,
          namedDay:
            index < 3
              ? {
                  id: String(index),
                  date: `2026-10-${12 + index}`,
                  name: "Anniversary",
                  kind: index === 1 ? "holiday" : "working_day",
                  repeats: false,
                  ownHours: index < 2,
                  closeWholeVenue: false,
                }
              : null,
          holidays:
            index === 0
              ? [
                  {
                    id: "h",
                    date: "2026-10-12",
                    name: "Public feast",
                    scope: "national",
                    sourceId: "test",
                  },
                ]
              : [],
          tone: tone as NamedDaysModel["days"][number]["tone"],
          ownHours: index < 2,
          closed: index === 0 || index === 3,
        }),
      ),
      holidayCoverage: [],
      holidaySources: [],
      area: {
        addressKey: "fixture-address",
        readiness: "ready",
        options: [{ key: "aran", name: "Aran" }],
        required: true,
        chosen: null,
      },
      localHolidaysPerYear: 2,
    };
    const el = document.createElement("hours-calendar");
    Object.assign(el, {
      namedApi: new NamedDaysApi((async () => model) as DashboardRequest),
      today: "2026-10-07",
    });
    host.append(el);
    await settle(el);
    for (const tone of ["public_holiday", "own_holiday", "working_day", "closed", "standard"])
      expect(el.shadowRoot!.querySelector(`td[data-tone="${tone}"]`)).not.toBeNull();
    expect(el.shadowRoot!.querySelector("wt-icon[name=clock]")).not.toBeNull();
    expect(el.shadowRoot!.textContent).toContain("Closed");
    await expectNoA11yViolations(host);
  });
});
