import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { registerIcons } from "@waitron/ui";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { NamedDayCopy } from "./named-day-copy.js";
import "./opening-hours-screen.js";

const originalUrl = location.href;
afterEach(() => {
  cleanup();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});
describe.each(["light", "dark"] as const)("Copy named day (%s)", (theme) => {
  test.each(["new", "multiple", "invalid", "refused", "saving"])("%s", async (state) => {
    setLocale("en");
    const form = (await mountThemed("<named-day-copy></named-day-copy>", theme)) as NamedDayCopy;
    form.day = { id: "day", name: "Anniversary" };
    form.open = true;
    await form.updateComplete;
    if (state !== "new") {
      form.shadowRoot!.querySelector("wt-input")!.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: state === "invalid" ? "bad" : "2026-10-25" },
        }),
      );
      await form.updateComplete;
    }
    if (state === "multiple") {
      form.shadowRoot!.querySelector<HTMLElement>("[data-test=add-target]")!.click();
      await form.updateComplete;
    }
    if (state === "invalid") {
      form.shadowRoot!.querySelector<HTMLElement>("[data-test=save-copy]")!.click();
      await form.updateComplete;
      expect(
        form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!.error,
      ).not.toBe("");
    }
    if (state === "refused")
      form.refusal = { code: "special_date.date_taken", params: { date: "2026-10-25" } };
    if (state === "saving") form.busy = true;
    await form.updateComplete;
    await expectNoA11yViolations(host);
  });
});
describe.each(["en", "es"] as const)("Calendar actions visual (%s)", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    test.each([390, 1280])("%s CSS px", async (width) => {
      setLocale(locale);
      await page.viewport(width, 1000);
      try {
        expect(window.innerWidth).toBe(width);
        registerIcons({
          clock:
            "M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11A5.5 5.5 0 0 1 8 2.5ZM7.25 4H8.75V7.5L11 9 10.2 10.2 7.25 8.25Z",
        });
        history.replaceState(null, "", "/manage/opening-hours/view/calendar/month/2026-10");
        const wrapper = await mountThemed("<div></div>", theme);
        host.style.margin = "0";
        host.style.padding = "var(--wt-space-3)";
        host.style.boxSizing = "border-box";
        host.style.width = "100%";
        const screen = document.createElement("dashboard-opening-hours-screen");
        screen.api = new OpeningHoursApi((async (path) => {
          if (path.includes("/named-days?"))
            return {
              timeZone: "Europe/Madrid",
              dayCutover: "06:00",
              civilDate: "2026-10-07",
              clockReadable: true,
              days: [
                {
                  date: "2026-10-13",
                  namedDay: {
                    id: "annual",
                    date: "2025-10-13",
                    name:
                      locale === "es" ? "Aniversario del restaurante" : "Restaurant anniversary",
                    kind: "holiday",
                    repeats: true,
                    ownHours: true,
                    closeWholeVenue: false,
                    hasStationHours: false,
                  },
                  holidays: [],
                  tone: "own_holiday",
                  ownHours: true,
                  closed: false,
                },
              ],
              holidayCoverage: [],
              holidaySources: [],
              area: { options: [], required: false, chosen: null },
              localHolidaysPerYear: 2,
            };
          if (path.includes("/hours?"))
            return {
              timeZone: "Europe/Madrid",
              dayCutover: "06:00",
              civilDate: "2026-10-07",
              clockReadable: true,
              departments: [],
              subjects: [],
              week: [],
              days: [],
              specialDates: [],
              specialCells: [],
              holidayCoverage: [],
              holidaySources: [],
            };
          return {
            timeZone: "Europe/Madrid",
            dayCutover: "06:00",
            clockReadable: true,
            namedDays: [],
            menus: [],
            departments: [],
          };
        }) as DashboardRequest);
        wrapper.appendChild(screen);
        await expect.poll(() => screen.shadowRoot!.querySelector("hours-calendar")).not.toBeNull();
        const cal = screen.shadowRoot!.querySelector("hours-calendar")!;
        await expect
          .poll(() => cal.shadowRoot!.querySelector("td[data-date='2026-10-13'] button"))
          .not.toBeNull();
        cal.shadowRoot!.querySelector<HTMLElement>("td[data-date='2026-10-13'] button")!.click();
        await cal.updateComplete;
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `../__screenshots__/task21-${locale}-${theme}-${width}-calendar.png`,
        });
        for (const kind of ["own", "copy", "delete"] as const) {
          cal.shadowRoot!.querySelector<HTMLElement>(`[data-test=named-${kind}]`)!.click();
          await screen.updateComplete;
          const form = screen.shadowRoot!.querySelector<import("lit").LitElement>(
            "named-day-editor, named-day-copy",
          );
          if (form) await form.updateComplete;
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `../__screenshots__/task21-${locale}-${theme}-${width}-${kind}.png`,
          });
          if (form)
            await form
              .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!
              .requestClose("cancel");
          else
            await screen
              .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>("wt-dialog")!
              .requestClose("cancel");
          await expect
            .poll(() =>
              screen.shadowRoot!.querySelector(
                "named-day-editor, named-day-copy, [data-test=delete-named-day]",
              ),
            )
            .toBeNull();
        }
      } finally {
        await page.viewport(1280, 768);
      }
    });
  });
});
