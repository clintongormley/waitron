import { afterEach, describe, expect, onTestFinished, test } from "vitest";
import { page } from "vitest/browser";
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
    if (path === "/management-api/stations") return [];
    if (path.endsWith("/menu-periods/painted-in")) return [];
    if (path.endsWith("/special-days")) return [];
    if (path.endsWith("/floor-plan-sets")) return { departments: [] };
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
      seasons:
        state === "seasons"
          ? [
              { id: "spring", name: "Spring", startsOn: "03-01", colour: "green" },
              { id: "winter", name: "Winter", startsOn: "12-01", colour: "blue" },
            ]
          : [],
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
    ["the Periods window", false],
    ["the Periods window, read-only", true],
  ] as const)("%s", async (_state, readOnly) => {
    setLocale("en");
    history.replaceState(null, "", "/manage/opening-hours/view/year/window/periods");
    const wrapper = await mountThemed("<div></div>", theme);
    const screen = document.createElement("dashboard-opening-hours-screen") as OpeningHoursScreen;
    screen.api = new OpeningHoursApi(request("ready"));
    screen.readOnly = readOnly;
    wrapper.appendChild(screen);
    await expect
      .poll(() => screen.shadowRoot!.querySelector("[data-window=periods] periods-list"))
      .not.toBeNull();
    const list = screen.shadowRoot!.querySelector("[data-window=periods] periods-list")!;
    await expect.poll(() => list.shadowRoot?.querySelector("wt-data-table")).toBeTruthy();
    const table = list.shadowRoot!.querySelector("wt-data-table")!;
    await expect.poll(() => table.shadowRoot?.textContent ?? "").toContain("Lunch");
    await table.updateComplete;
    await expectNoA11yViolations(host);
  });
  test.each([
    ["the Seasons window", false],
    ["the Seasons window, read-only", true],
  ] as const)("%s", async (_state, readOnly) => {
    setLocale("en");
    history.replaceState(null, "", "/manage/opening-hours/view/year/window/seasons");
    const wrapper = await mountThemed("<div></div>", theme);
    const screen = document.createElement("dashboard-opening-hours-screen") as OpeningHoursScreen;
    screen.api = new OpeningHoursApi(request("seasons"));
    screen.readOnly = readOnly;
    wrapper.appendChild(screen);
    await expect
      .poll(() => screen.shadowRoot!.querySelector("seasons-window[data-window=seasons]"))
      .not.toBeNull();
    const win = screen.shadowRoot!.querySelector("seasons-window")!;
    await expect.poll(() => win.shadowRoot?.querySelectorAll("tbody tr").length ?? 0).toBe(2);
    await win.updateComplete;
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
    ["the Year's head", "/manage/opening-hours/view/year", "opening-hours-year"],
    [
      "the Month's head, its year a link",
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
      if (asked === "/management-api/stations") return [];
      if (asked.includes("/opening-hours/month?"))
        return monthModel({ month: new URL(asked, location.href).searchParams.get("month")! });
      const read = await (ready as (...args: unknown[]) => Promise<object>)(asked, ...rest);
      return asked.includes("/opening-hours/year?")
        ? read
        : { ...read, departments: structuredClone(DEPARTMENTS) };
    }) as DashboardRequest);
    wrapper.appendChild(screen);
    await expect.poll(() => screen.shadowRoot!.querySelector(view)?.model).toBeDefined();
    await screen.shadowRoot!.querySelector(view)!.updateComplete;
    if (view === "opening-hours-month")
      expect(
        screen.shadowRoot!.querySelector(view)!.shadowRoot!.querySelector("[data-test=month-year]"),
      ).not.toBeNull();
    await expectNoA11yViolations(host);
  });
  test.each([
    ["the day box over the Month, a plain day", "2026-12-10", "special-add"],
    ["the day box over the Month, a special day", "2026-12-14", "special-edit"],
  ] as const)("%s", async (_state, date, button) => {
    setLocale("en");
    history.replaceState(null, "", "/manage/opening-hours/view/month/month/2026-12");
    const wrapper = await mountThemed("<div></div>", theme);
    const screen = document.createElement("dashboard-opening-hours-screen") as OpeningHoursScreen;
    const ready = request("ready");
    screen.api = new OpeningHoursApi((async (asked: string, ...rest: unknown[]) => {
      if (asked === "/management-api/stations") return [];
      if (asked.includes("/opening-hours/month?"))
        return monthModel({ month: new URL(asked, location.href).searchParams.get("month")! });
      const read = await (ready as (...args: unknown[]) => Promise<object>)(asked, ...rest);
      return asked.includes("/opening-hours/year?")
        ? read
        : { ...read, departments: structuredClone(DEPARTMENTS) };
    }) as DashboardRequest);
    wrapper.appendChild(screen);
    await expect
      .poll(() => screen.shadowRoot!.querySelector("opening-hours-month")?.model)
      .toBeDefined();
    const month = screen.shadowRoot!.querySelector("opening-hours-month")!;
    await month.updateComplete;
    month.shadowRoot!.querySelector<HTMLElement>(`td[data-date="${date}"] button`)!.click();
    await expect
      .poll(() => screen.shadowRoot!.querySelector(`calendar-day-box [data-test=${button}]`))
      .not.toBeNull();
    const box = screen.shadowRoot!.querySelector("calendar-day-box")!;
    await box.updateComplete;
    expect(box.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    await expectNoA11yViolations(host);
  });
  test.each([
    ["the Week", false, 1280],
    ["the day box over the Week", true, 1280],
    ["the Week on a phone", false, 390],
  ] as const)("%s", async (_state, boxed, width) => {
    const before = [innerWidth, innerHeight] as const;
    await page.viewport(width, 800);
    onTestFinished(() => page.viewport(...before));
    expect(window.innerWidth).toBe(width);
    setLocale("en");
    history.replaceState(
      null,
      "",
      "/manage/opening-hours/view/week/department/rest/week/2026-12-09",
    );
    const wrapper = await mountThemed("<div></div>", theme);
    const screen = document.createElement("dashboard-opening-hours-screen") as OpeningHoursScreen;
    const ready = request("ready");
    screen.api = new OpeningHoursApi((async (asked: string, ...rest: unknown[]) => {
      if (asked === "/management-api/stations") return [];
      if (asked.includes("/opening-hours/month?"))
        return monthModel({ month: new URL(asked, location.href).searchParams.get("month")! });
      const read = await (ready as (...args: unknown[]) => Promise<object>)(asked, ...rest);
      return { ...read, departments: structuredClone(DEPARTMENTS) };
    }) as DashboardRequest);
    wrapper.appendChild(screen);
    await expect
      .poll(() => screen.shadowRoot!.querySelector("opening-hours-week")?.model)
      .toBeDefined();
    const week = screen.shadowRoot!.querySelector("opening-hours-week")!;
    await expect.poll(() => week.narrow).toBe(width < 560);
    await week.updateComplete;
    if (boxed) {
      week
        .shadowRoot!.querySelector<HTMLElement>('[data-test=day-name][data-date="2026-12-09"]')!
        .click();
      await expect
        .poll(() => screen.shadowRoot!.querySelector("calendar-day-box [data-test=special-add]"))
        .not.toBeNull();
      const box = screen.shadowRoot!.querySelector("calendar-day-box")!;
      await expect.poll(() => box.rows.length).toBeGreaterThan(0);
      await box.updateComplete;
      expect(box.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    }
    await expectNoA11yViolations(host);
  });
  test.each([
    ["the day box over the Year", true],
    ["the day box over the Year, while its month loads", false],
  ] as const)("%s", async (_state, answered) => {
    setLocale("en");
    history.replaceState(null, "", "/manage/opening-hours/view/year/year/2026");
    const wrapper = await mountThemed("<div></div>", theme);
    const screen = document.createElement("dashboard-opening-hours-screen") as OpeningHoursScreen;
    const ready = request("ready");
    screen.api = new OpeningHoursApi((async (asked: string, ...rest: unknown[]) => {
      if (asked === "/management-api/stations") return [];
      if (asked.includes("/opening-hours/month?"))
        return answered
          ? monthModel({ month: new URL(asked, location.href).searchParams.get("month")! })
          : new Promise(() => {});
      const read = await (ready as (...args: unknown[]) => Promise<object>)(asked, ...rest);
      return asked.includes("/opening-hours/year?")
        ? read
        : { ...read, departments: structuredClone(DEPARTMENTS) };
    }) as DashboardRequest);
    wrapper.appendChild(screen);
    await expect
      .poll(() => screen.shadowRoot!.querySelector("opening-hours-year")?.model)
      .toBeDefined();
    const year = screen.shadowRoot!.querySelector("opening-hours-year")!;
    await year.updateComplete;
    year.shadowRoot!.querySelector<HTMLElement>('td[data-date="2026-12-10"] button')!.click();
    await expect
      .poll(() => screen.shadowRoot!.querySelector("calendar-day-box [data-test=special-add]"))
      .not.toBeNull();
    const box = screen.shadowRoot!.querySelector("calendar-day-box")!;
    if (answered) await expect.poll(() => box.line).not.toBe("");
    else expect(box.message).not.toBe("");
    await box.updateComplete;
    expect(box.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    await expectNoA11yViolations(host);
  });
});
