import { withOpeningStations } from "../testing/opening-hours-stations-request.js";
import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { OpeningHoursScreen } from "./opening-hours-screen.js";
import "./opening-hours-screen.js";
const originalUrl = location.href;
afterEach(async () => {
  cleanup();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
  await page.viewport(1280, 768);
});
function model(): OpeningHoursModel {
  return {
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    namedDays: [],
    menus: [],
    departments: [
      {
        id: "restaurant",
        name: "Restaurant",
        active: true,
        zones: [{ id: "terrace", name: "Terrace", week: [], dates: [] }],
        periods: [
          {
            id: "lunch",
            name: "Lunch",
            colour: "blue",
            menuId: "menu",
            staffMenuIds: [],
            endOffsetMinutes: 0,
            weekdays: [1],
            routingUses: [],
          },
        ],
        week: [{ weekday: 1, slots: [{ periodId: "lunch", startsAt: "12:00", endsAt: "16:00" }] }],
        dates: [],
      },
      {
        id: "bar",
        name: "Bar",
        active: true,
        zones: [],
        periods: [
          {
            id: "dinner",
            name: "Dinner",
            colour: "green",
            menuId: "menu",
            staffMenuIds: [],
            endOffsetMinutes: 0,
            weekdays: [2],
            routingUses: [],
          },
        ],
        week: [{ weekday: 2, slots: [{ periodId: "dinner", startsAt: "18:00", endsAt: "23:00" }] }],
        dates: [],
      },
    ],
  };
}
describe.each(["en", "es"] as const)("Opening hours choices (%s)", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    test.each([1280, 390])("all and zone at %s px", async (width) => {
      setLocale(locale);
      await page.viewport(width, 900);
      expect(window.innerWidth).toBe(width);
      const wrapper = await mountThemed("<div></div>", theme);
      for (const choice of ["all", "zone"]) {
        history.replaceState(
          null,
          "",
          choice === "all"
            ? "/manage/opening-hours/view/week/department/all"
            : "/manage/opening-hours/view/week/department/restaurant/zone/terrace",
        );
        const screen = document.createElement(
          "dashboard-opening-hours-screen",
        ) as OpeningHoursScreen;
        screen.api = new OpeningHoursApi(
          withOpeningStations((async () => structuredClone(model())) as DashboardRequest),
        );
        wrapper.append(screen);
        window.scrollTo(0, 0);
        await expect.poll(() => screen.shadowRoot!.querySelector("wt-tabs")).not.toBeNull();
        await screen.updateComplete;
        if (choice === "all") {
          const all = screen.shadowRoot!.querySelector("opening-hours-all")!;
          expect(all).not.toBeNull();
          await all.updateComplete;
          const grid = all.shadowRoot!.querySelector("service-grid")!;
          await grid.updateComplete;
          const scroll = grid.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
          scroll.scrollTop = 400;
          expect(grid.columns).toHaveLength(14);
          expect(screen.shadowRoot!.querySelector("opening-hours-week")).toBeNull();
        } else {
          const zone = screen.shadowRoot!.querySelector("opening-hours-zone-week")!;
          expect(zone).not.toBeNull();
          await zone.updateComplete;
          const grid = zone.shadowRoot!.querySelector("service-grid")!;
          expect(grid).not.toBeNull();
          await grid.updateComplete;
          const picker =
            screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
              "[name=departmentId]",
            )!;
          await picker.updateComplete;
          expect(picker.shadowRoot!.querySelector("button .value")!.textContent).toContain(
            "Terrace",
          );
        }
        await expectNoA11yViolations(host);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await page.screenshot({
          path: `../__screenshots__/a366-2-task16/${choice}-${locale}-${theme}-${width}.png`,
        });
        screen.remove();
      }
    });
  });
});
describe.each(["light", "dark"] as const)("Empty All departments (%s)", (theme) => {
  test("has no editing controls", async () => {
    const wrapper = await mountThemed("<opening-hours-all></opening-hours-all>", theme);
    const all = wrapper as HTMLElementTagNameMap["opening-hours-all"];
    await all.updateComplete;
    const grid = all.shadowRoot!.querySelector("service-grid")!;
    await grid.updateComplete;
    expect(grid.columns).toEqual([]);
    expect(grid.readOnly).toBe(true);
    await expectNoA11yViolations(host);
  });
});
