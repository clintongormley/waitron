import { afterEach, describe, expect, test } from "vitest";
import { html } from "lit";
import { registerCatalogue, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import { DEPARTMENTS, monthModel } from "../testing/opening-hours-month-fixture.js";
import type { OpeningHoursScreen } from "./opening-hours-screen.js";
import "./opening-hours-screen.js";

const originalUrl = location.href;
afterEach(() => {
  cleanup();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});
/** The screen's reads; every one fails when `state` is "load-failed". */
function request(state: string): DashboardRequest {
  return (async (path: string) => {
    if (state === "load-failed") throw new Error("offline");
    if (path.includes("/opening-hours/year?"))
      return {
        businessDayClock: {
          timeZone: "Europe/Madrid",
          dayCutover: "06:00",
          cutoverChanges: [],
        },
        clockRevision: 0,
        currentBusinessDay: "2026-10-12",
        pending: null,
        year: Number(new URL(path, location.href).searchParams.get("year")),
        timeZone: "Europe/Madrid",
        today: "2026-10-12",
        seasons: [],
        days: [],
        publicHolidaysAvailable: true,
        missingHolidays: [],
        holidayCoverage: [],
        area: {
          addressKey: "fixture-address",
          readiness: "ready",
          options: [],
          required: false,
          chosen: null,
        },
      };
    return {
      businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
      clockRevision: 0,
      currentBusinessDay: "2026-10-12",
      pending: null,
      timeZone: "Europe/Madrid",
      clockReadable: state !== "unreadable-viewer",
      dayCutover: "06:00",
      menus: [{ id: "lunch", name: "Lunch menu", active: true, includes: [] }],
      departments: [
        {
          id: "restaurant",
          name: "Restaurant",
          active: true,
          periods: [
            {
              id: "p1",
              name: "Lunch",
              colour: "green",
              menuId: "lunch",
              staffMenuIds: [],
              endOffsetMinutes: 0,
              weekdays: [1, 3],
              routingUses: [],
            },
          ],
        },
      ],
    };
  }) as DashboardRequest;
}
describe.each(["light", "dark"] as const)("Opening hours (%s)", (theme) => {
  test.each(["load-failed", "unreadable-viewer"])("%s", async (state) => {
    setLocale("en");
    history.replaceState(null, "", "/manage/opening-hours/view/year");
    // Assign the API before connecting: the screen attaches its passive model watch on connection.
    const wrapper = await mountThemed("<div></div>", theme);
    const screen = document.createElement("dashboard-opening-hours-screen") as OpeningHoursScreen;
    screen.api = new OpeningHoursApi(request(state));
    screen.readOnly = state === "unreadable-viewer";
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
    await expect
      .poll(() => screen.shadowRoot!.querySelector("opening-hours-year")?.model)
      .toBeDefined();
    await screen.shadowRoot!.querySelector("opening-hours-year")!.updateComplete;
    await expectNoA11yViolations(host);
  });
  test.each([
    ["the switch on Opening hours", "/manage/opening-hours/view/year"],
    ["the switch on a module view", "/manage/opening-hours/view/staffing"],
  ])("%s", async (_state, path) => {
    setLocale("en");
    registerCatalogue({ en: { "a11y.view.staffing": "Staffing" }, es: {} });
    history.replaceState(null, "", path);
    const wrapper = await mountThemed("<div></div>", theme);
    const screen = document.createElement("dashboard-opening-hours-screen") as OpeningHoursScreen;
    screen.api = new OpeningHoursApi(request("ready"));
    screen.calendar = {
      ctx: { request: request("ready") },
      views: [
        {
          view: {
            id: "staffing",
            labelKey: "a11y.view.staffing",
            order: 10,
            requiresPermission: "staffing.write",
            create: () => ({ render: () => html`<p data-test="stub-staffing">Staffing</p>` }),
          },
          canWrite: true,
        },
      ],
    };
    wrapper.appendChild(screen);
    await expect
      .poll(() =>
        screen.shadowRoot!.querySelector(
          path.endsWith("staffing") ? "[data-test=stub-staffing]" : "opening-hours-year",
        ),
      )
      .not.toBeNull();
    await screen.updateComplete;
    expect(screen.shadowRoot!.querySelector("[data-test=calendar-switch]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
  test.each([
    [
      "the Year / Month switch on the Year",
      "/manage/opening-hours/view/year",
      "opening-hours-year",
    ],
    [
      "the Year / Month switch on the Month",
      "/manage/opening-hours/view/month/month/2026-12",
      "opening-hours-month",
    ],
  ] as const)("%s", async (_state, path, view) => {
    setLocale("en");
    history.replaceState(null, "", path);
    const wrapper = await mountThemed("<div></div>", theme);
    const screen = document.createElement("dashboard-opening-hours-screen") as OpeningHoursScreen;
    const ready = request("ready");
    screen.api = new OpeningHoursApi((async (asked: string, ...rest: unknown[]) => {
      if (asked.includes("/opening-hours/month?"))
        return monthModel({ month: new URL(asked, location.href).searchParams.get("month")! });
      const read = await (ready as (...args: unknown[]) => Promise<object>)(asked, ...rest);
      return asked.includes("/opening-hours/year?")
        ? read
        : { ...read, departments: structuredClone(DEPARTMENTS) };
    }) as DashboardRequest);
    wrapper.appendChild(screen);
    await expect
      .poll(() => screen.shadowRoot!.querySelector("[data-test=view-switch]"))
      .not.toBeNull();
    await expect.poll(() => screen.shadowRoot!.querySelector(view)?.model).toBeDefined();
    await screen.shadowRoot!.querySelector(view)!.updateComplete;
    await expectNoA11yViolations(host);
  });
});
