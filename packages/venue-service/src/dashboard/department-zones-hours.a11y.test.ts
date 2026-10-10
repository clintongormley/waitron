import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { departmentHoursModel } from "../testing/department-hours-fixture.js";
import { zonesModel } from "../testing/department-zones-fixture.js";
import { VenueServiceApi } from "./client.js";
import "./department-zones.js";
afterEach(() => {
  cleanup();
  setLocale("en");
});
it("renders the summary and hours link accessibly in EN/ES, both themes, desktop and phone", async () => {
  const old = [window.innerWidth, window.innerHeight];
  try {
    for (const locale of ["en", "es"])
      for (const theme of ["light", "dark"] as const)
        for (const width of [1280, 390])
          for (const state of ["grouped", "open", "count", "failure", "disabled"] as const) {
            setLocale(locale);
            await page.viewport(width, 844);
            expect(window.innerWidth).toBe(width);
            const hours = departmentHoursModel();
            if (state === "open") hours.departments[0]!.zones[0]!.week = [];
            if (state === "count")
              hours.departments[0]!.zones[0]!.week = [1, 2, 3].map((weekday) => ({
                weekday,
                ranges: [{ startsAt: `2${weekday}:00`, endsAt: "06:00" }],
              }));
            const el = (await mountThemed(
              "<department-zones></department-zones>",
              theme,
            )) as HTMLElementTagNameMap["department-zones"];
            el.model = structuredClone(zonesModel);
            if (state === "disabled") {
              el.model.zones[0]!.active = false;
              hours.departments[0]!.zones = hours.departments[0]!.zones.filter(
                (z) => z.id !== "z1",
              );
            }
            el.departmentId = "d1";
            el.zone = "z1";
            el.api = new VenueServiceApi((async () => {
              if (state === "failure") throw new Error("offline");
              return hours;
            }) as DashboardRequest);
            await el.updateComplete;
            if (state === "failure")
              await expect.poll(() => el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
            else if (state === "disabled") {
              expect(el.shadowRoot!.querySelector("[data-test=zone-opening-hours]")).toBeNull();
              expect(el.shadowRoot!.querySelector("[data-test=closed-week-summary]")).toBeNull();
            } else
              await expect
                .poll(() =>
                  el
                    .shadowRoot!.querySelector("[data-test=closed-week-summary]")
                    ?.textContent?.trim(),
                )
                .toBeTruthy();
            await expectNoA11yViolations(host);
            if (state !== "disabled") {
              const summary = el.shadowRoot!.querySelector<HTMLElement>(
                "[data-test=closed-week-summary]",
              )!;
              const link = el.shadowRoot!.querySelector<HTMLAnchorElement>(
                "[data-test=zone-opening-hours]",
              )!;
              expect(summary.scrollWidth).toBeLessThanOrEqual(summary.clientWidth);
              expect(link.getBoundingClientRect().right).toBeLessThanOrEqual(width);
              host.style.setProperty("--wt-color-text-muted", "rgb(100, 110, 120)");
              expect(getComputedStyle(summary).color).toBe("rgb(100, 110, 120)");
              host.style.removeProperty("--wt-color-text-muted");
            }
            await page.screenshot({
              path: `../__screenshots__/a366-6b/${state}-${locale}-${theme}-${width}.png`,
            });
            cleanup();
          }
  } finally {
    await page.viewport(old[0]!, old[1]!);
  }
}, 60000);
