import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-zone-week.js";
afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["en", "es"])("Zone week %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    test.each(["week", "viewer", "copy", "range", "invalid-range", "refused"])(
      "%s",
      async (state) => {
        setLocale(locale);
        const wrapper = await mountThemed("<div></div>", theme);
        const week = document.createElement("opening-hours-zone-week");
        week.api = new OpeningHoursApi(async () => {
          throw { code: "zone_closed_time.invalid", params: { field: "days.1.ranges" } };
        });
        week.department = {
          id: "d1",
          name: "Restaurant",
          active: true,
          zones: [],
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
          dates: [],
        };
        week.zone = {
          id: "z1",
          name: "Terrace",
          week: [{ weekday: 1, ranges: [{ startsAt: "11:00", endsAt: "12:00" }] }],
          dates: [],
        };
        week.readOnly = state === "viewer";
        wrapper.appendChild(week);
        await week.updateComplete;
        if (state === "copy") {
          week
            .shadowRoot!.querySelector<HTMLElement>("[data-test=copy-day][data-day='1']")!
            .click();
          await week.updateComplete;
        }
        if (state === "range" || state === "invalid-range") {
          week
            .shadowRoot!.querySelector("service-grid")!
            .dispatchEvent(
              new CustomEvent("grid-block-open", { detail: { columnKey: "1", index: 0 } }),
            );
          await week.updateComplete;
          const range =
            week.shadowRoot!.querySelector<HTMLElementTagNameMap["range-dialog"]>("range-dialog")!;
          await range.updateComplete;
          if (state === "invalid-range") {
            range
              .shadowRoot!.querySelector("[name=endsAt]")!
              .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "11:07" } }));
            await range.updateComplete;
            range.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
            await range.updateComplete;
            expect(
              range.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=endsAt]")!
                .error,
            ).not.toBe("");
          }
        }
        if (state === "refused") {
          week.shadowRoot!.querySelector("service-grid")!.dispatchEvent(
            new CustomEvent("grid-block-change", {
              detail: { columnKey: "1", index: 0, startsAt: "11:00", endsAt: "13:00" },
            }),
          );
          await week.updateComplete;
          week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-week]")!.click();
          await expect
            .poll(() => week.shadowRoot!.querySelector("[data-day-error='1']"))
            .not.toBeNull();
        }
        await expectNoA11yViolations(host);
      },
    );
  });
});
