import { afterEach, describe, expect, test } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { OpeningHoursScreen } from "./opening-hours-screen.js";
import "./opening-hours-screen.js";

const originalUrl = location.href;
afterEach(() => {
  cleanup();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});
describe.each(["light", "dark"] as const)("Opening hours (%s)", (theme) => {
  test.each([
    "periods",
    "empty",
    "viewer",
    "delete",
    "delete-refused",
    "load-failed",
    "unreadable-viewer",
  ])("%s", async (state) => {
    setLocale("en");
    history.replaceState(null, "", "/manage/opening-hours/view/periods");
    // Assign the API before connecting: the screen attaches its passive model watch on connection.
    const wrapper = await mountThemed("<div></div>", theme);
    const screen = document.createElement("dashboard-opening-hours-screen") as OpeningHoursScreen;
    screen.api = new OpeningHoursApi((async (_path, method) => {
      if (state === "load-failed") throw new Error("offline");
      if (method !== "GET")
        throw { code: "menu_period.in_use", params: { uses: [{ kind: "week", weekday: 1 }] } };
      return {
        timeZone: "Europe/Madrid",
        clockReadable: state !== "unreadable-viewer",
        dayCutover: "06:00",
        specialDates: [],
        menus: [{ id: "lunch", name: "Lunch menu", active: true, includes: [] }],
        departments: [
          {
            id: "restaurant",
            name: "Restaurant",
            active: true,
            week: [],
            dates: [],
            periods:
              state === "empty"
                ? []
                : [
                    {
                      id: "p1",
                      name: "Lunch",
                      colour: "green",
                      menuId: "lunch",
                      staffMenuIds: [],
                      weekdays: [1, 3],
                    },
                  ],
          },
        ],
      };
    }) as DashboardRequest);
    screen.readOnly = state === "viewer" || state === "unreadable-viewer";
    wrapper.appendChild(screen);
    if (state === "load-failed") {
      await expect
        .poll(() => screen.shadowRoot!.querySelector("[data-test=read-error]"))
        .not.toBeNull();
      expect(screen.shadowRoot!.querySelector("[data-test=read-error]")!.textContent).toBe(
        "Opening hours could not be loaded. It will be tried again.",
      );
      await expectNoA11yViolations(host);
      return;
    }
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-data-table")).not.toBeNull();
    const table =
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>("wt-data-table")!;
    await table.updateComplete;
    if (state.startsWith("delete")) {
      table.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-period]")!.click();
      await screen.updateComplete;
      if (state === "delete-refused") {
        screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
        await expect
          .poll(() => screen.shadowRoot!.querySelector("[data-test=delete-error]"))
          .not.toBeNull();
      }
    }
    await expectNoA11yViolations(host);
  });
});
