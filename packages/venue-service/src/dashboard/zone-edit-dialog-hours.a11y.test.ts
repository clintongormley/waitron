import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { departmentHoursModel } from "../testing/department-hours-fixture.js";
import { placedZonePlan, zonesModel } from "../testing/department-zones-fixture.js";
import { VenueServiceApi } from "./client.js";
import "./zone-edit-dialog.js";
const shown = {
  grouped: {
    en: "Autumn: closed from 23:30 Monday to Thursday and Sunday; from 01:00 Friday and Saturday",
    es: "Autumn: cerrada desde 23:30 lunes a jueves y domingo; desde 01:00 viernes y sábado",
  },
  open: {
    en: "Autumn: open whenever the department is",
    es: "Autumn: abierta cuando lo está el departamento",
  },
  count: {
    en: "Autumn: closed at some times on 3 days",
    es: "Autumn: cerrada en algunas franjas de 3 días",
  },
} as const;
afterEach(() => {
  cleanup();
  setLocale("en");
});
it("renders the summary and hours link accessibly in EN/ES, both themes, desktop and phone", async () => {
  const old = [window.innerWidth, window.innerHeight];
  try {
    for (const locale of ["en", "es"] as const)
      for (const theme of ["light", "dark"] as const)
        for (const width of [1280, 390])
          for (const state of ["grouped", "open", "count", "failure", "deleted"] as const) {
            setLocale(locale);
            await page.viewport(width, 844);
            expect(window.innerWidth).toBe(width);
            const hours = departmentHoursModel();
            if (state === "open") hours.departments[0]!.zones[0]!.seasonWeeks[0]!.week = [];
            if (state === "count")
              hours.departments[0]!.zones[0]!.seasonWeeks[0]!.week = [1, 2, 3].map((weekday) => ({
                weekday,
                ranges: [{ startsAt: `2${weekday}:00`, endsAt: "06:00" }],
              }));
            const el = (await mountThemed(
              "<zone-edit-dialog></zone-edit-dialog>",
              theme,
            )) as HTMLElementTagNameMap["zone-edit-dialog"];
            el.model = structuredClone(zonesModel);
            if (state === "deleted") {
              el.model.zones[0]!.active = false;
              hours.departments[0]!.zones = hours.departments[0]!.zones.filter(
                (z) => z.id !== "z1",
              );
            }
            el.zoneId = "z1";
            el.api = new VenueServiceApi((async (path: string) => {
              if (path.endsWith("/floor-plan")) return structuredClone(placedZonePlan);
              if (state === "failure") throw new Error("offline");
              return hours;
            }) as DashboardRequest);
            await el.updateComplete;
            if (state === "failure")
              await expect.poll(() => el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
            else if (state === "deleted") {
              expect(el.shadowRoot!.querySelector('[data-zone="z1"]')).toBeNull();
              expect(el.shadowRoot!.querySelector("[data-test=zone-opening-hours]")).toBeNull();
              expect(el.shadowRoot!.querySelector("[data-test=closed-week-summary]")).toBeNull();
              el.zoneId = "z2";
              await el.updateComplete;
              await expect
                .poll(
                  () =>
                    el.shadowRoot!.querySelector<HTMLAnchorElement>(
                      "[data-test=zone-opening-hours]",
                    )?.href,
                )
                .toContain("/zone/z2");
            } else
              await expect
                .poll(() =>
                  el
                    .shadowRoot!.querySelector("[data-test=closed-week-summary]")
                    ?.textContent?.trim(),
                )
                .toBe(shown[state][locale]);
            await expectNoA11yViolations(host);
            {
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
              path: `../__screenshots__/a493-zone-hours/${state}-${locale}-${theme}-${width}.png`,
            });
            cleanup();
          }
  } finally {
    await page.viewport(old[0]!, old[1]!);
  }
}, 60000);
