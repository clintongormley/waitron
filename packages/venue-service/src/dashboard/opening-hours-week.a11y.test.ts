import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-week.js";
afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Opening week (%s)", (theme) => {
  test.each(["week", "viewer", "copy", "range", "new-period", "refused"])("%s", async (state) => {
    setLocale("en");
    const wrapper = await mountThemed("<div></div>", theme);
    const week = document.createElement("opening-hours-week");
    week.api = new OpeningHoursApi(async () => {
      throw { code: "menu_timetable.invalid", params: { field: "days.1.slots" } };
    });
    week.department = {
      id: "d1",
      name: "Restaurant",
      active: true,
      periods: [
        { id: "p1", name: "Lunch", colour: "green", menuId: "m1", staffMenuIds: [], weekdays: [1] },
      ],
      week: [{ weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] }],
      dates: [],
    };
    week.menus = [{ id: "m1", name: "Lunch menu", active: true, includes: [] }];
    week.readOnly = state === "viewer";
    wrapper.appendChild(week);
    await week.updateComplete;
    if (state === "copy") {
      week.shadowRoot!.querySelector<HTMLElement>("[data-test=copy-day][data-day='1']")!.click();
      await week.updateComplete;
    }
    if (state === "range" || state === "new-period") {
      week.shadowRoot!.querySelector("service-grid")!.dispatchEvent(
        new CustomEvent("grid-range-select", {
          detail: { columnKey: "2", startsAt: "11:00", endsAt: "15:00" },
        }),
      );
      await week.updateComplete;
      const range =
        week.shadowRoot!.querySelector<HTMLElementTagNameMap["range-dialog"]>("range-dialog")!;
      await range.updateComplete;
      if (state === "new-period") {
        range
          .shadowRoot!.querySelector("[name=periodId]")!
          .dispatchEvent(new CustomEvent("wt-combobox-action", { detail: { value: "new" } }));
        await week.updateComplete;
      }
    }
    if (state === "refused") {
      week.shadowRoot!.querySelector("service-grid")!.dispatchEvent(
        new CustomEvent("grid-block-change", {
          detail: { columnKey: "1", index: 0, startsAt: "10:00", endsAt: "15:00" },
        }),
      );
      await week.updateComplete;
      week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-week]")!.click();
      await expect
        .poll(() => week.shadowRoot!.querySelector("[data-day-error='1']"))
        .not.toBeNull();
    }
    await expectNoA11yViolations(host);
  });
});
