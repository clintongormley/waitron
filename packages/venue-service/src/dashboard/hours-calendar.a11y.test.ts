import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { SpecialDaysApi } from "./special-days-client.js";

import type { SpecialDaysModel } from "../holiday-types.js";
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
  test("each tone, a closed public holiday in a special day and the area picker", async () => {
    await mountThemed("<div></div>", theme);
    const model: SpecialDaysModel = {
      businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
      clockRevision: 0,
      currentBusinessDay: "2026-10-07",
      pending: null,
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
      civilDate: "2026-10-07",
      clockReadable: true,
      days: ["public_holiday", "special_day", "closed", "standard"].map((tone, index) => ({
        date: `2026-10-${12 + index}`,
        specialDay: index < 2 ? { id: String(index), name: "Anniversary" } : null,
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
        tone: tone as SpecialDaysModel["days"][number]["tone"],
        closed: index === 0 || index === 2,
      })),
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
      namedApi: new SpecialDaysApi((async () => model) as DashboardRequest),
      today: "2026-10-07",
    });
    host.append(el);
    await settle(el);
    for (const tone of ["public_holiday", "special_day", "closed", "standard"])
      expect(el.shadowRoot!.querySelector(`td[data-tone="${tone}"]`)).not.toBeNull();
    expect(el.shadowRoot!.textContent).toContain("Closed");
    await expectNoA11yViolations(host);
  });
});
