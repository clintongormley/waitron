import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { OpeningHoursScreen } from "./opening-hours-screen.js";
import "./opening-hours-screen.js";
const originalUrl = location.href;
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
  await page.viewport(1280, 768);
});
describe.each(["en", "es"] as const)("Station week %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([1280, 390])("read-only states at %s px", async (width) => {
      setLocale(locale);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
      await page.viewport(width, 900);
      expect(window.innerWidth).toBe(width);
      const wrapper = await mountThemed("<div></div>", theme);
      for (const state of [
        "normal",
        "dated",
        "default",
        "switched_off",
        "empty",
        "error",
      ] as const) {
        history.replaceState(
          null,
          "",
          `/manage/opening-hours/view/week?station=bar${state === "dated" ? "&week=2026-10-12" : ""}`,
        );
        const screen = document.createElement(
          "dashboard-opening-hours-screen",
        ) as OpeningHoursScreen;
        screen.api = new OpeningHoursApi((async (path: string) => {
          if (path === "/management-api/stations?includeDisabled=true")
            return [
              { id: "bar", name: locale === "en" ? "Upstairs bar" : "Bar de arriba", active: true },
            ];
          if (path.includes("/named-days?")) return { days: [], stations: [], departments: [] };
          if (path.includes("/service-times?")) {
            if (state === "error") throw new Error("read refused");
            return {
              always: state === "default" || state === "switched_off" ? state : null,
              days: Array.from({ length: 7 }, (_, index) => ({
                date: `2026-10-${12 + index}`,
                departments:
                  state !== "empty" && index < 5
                    ? [
                        {
                          departmentId: "restaurant",
                          ranges: [{ periodId: "lunch", startsAt: "12:00", endsAt: "16:00" }],
                        },
                        {
                          departmentId: "bar",
                          ranges: [{ periodId: "dinner", startsAt: "18:00", endsAt: "23:00" }],
                        },
                      ]
                    : [],
              })),
            };
          }
          return {
            timeZone: "Europe/Madrid",
            clockReadable: true,
            dayCutover: "06:00",
            namedDays: [],
            menus: [],
            departments: [
              {
                id: "restaurant",
                name: locale === "en" ? "Restaurant" : "Restaurante",
                active: true,
                zones: [],
                week: [],
                dates: [],
                periods: [
                  {
                    id: "lunch",
                    name: locale === "en" ? "Lunch" : "Comida",
                    colour: "blue",
                    menuId: "menu",
                    staffMenuIds: [],
                    endOffsetMinutes: 0,
                    weekdays: [1],
                    routingUses: [],
                  },
                ],
              },
              {
                id: "bar",
                name: "Bar",
                active: true,
                zones: [],
                week: [],
                dates: [],
                periods: [
                  {
                    id: "dinner",
                    name: locale === "en" ? "Dinner" : "Cena",
                    colour: "green",
                    menuId: "menu",
                    staffMenuIds: [],
                    endOffsetMinutes: 0,
                    weekdays: [1],
                    routingUses: [],
                  },
                ],
              },
            ],
          };
        }) as DashboardRequest);
        wrapper.append(screen);
        await expect
          .poll(
            () =>
              screen.shadowRoot?.querySelector("opening-hours-station")?.shadowRoot
                ?.childElementCount,
          )
          .toBeGreaterThan(0);
        const station = screen.shadowRoot!.querySelector("opening-hours-station")!;
        if (["normal", "dated", "empty"].includes(state)) {
          await expect
            .poll(() => station.shadowRoot!.querySelector("service-grid")?.columns.length)
            .toBe(14);
          const grid = station.shadowRoot!.querySelector("service-grid")!;
          await grid.updateComplete;
          const scroll = grid.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
          expect(scroll.getBoundingClientRect().right).toBeLessThanOrEqual(width);
          scroll.scrollTop = 300;
        } else if (state === "error") {
          await expect
            .poll(() => station.shadowRoot!.querySelector('[role="alert"]'))
            .not.toBeNull();
        } else {
          await expect.poll(() => station.shadowRoot!.querySelector("p")).not.toBeNull();
          expect(station.shadowRoot!.querySelector("service-grid")).toBeNull();
        }
        await expectNoA11yViolations(host);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await page.screenshot({
          path: `../__screenshots__/a366-4b-b9/${state}-${locale}-${theme}-${width}.png`,
        });
        screen.remove();
      }
    });
  });
});
