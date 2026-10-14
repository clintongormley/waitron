import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, expectRowMenusOnScreen, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { OpeningHoursApi, type PaintedInRow } from "./opening-hours-client.js";
import type { PeriodsScreen } from "./periods-screen.js";
import "./periods-screen.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

type Period = OpeningHoursModel["departments"][number]["periods"][number];
const period = (id: string, name: string, colour: Period["colour"], menuId: string): Period => ({
  id,
  name,
  colour,
  menuId,
  staffMenuIds: id === "p2" ? ["staff", "wine"] : [],
  endOffsetMinutes: 0,
  weekdays: [],
  routingUses: [],
});
function model(empty: boolean): OpeningHoursModel {
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 0,
    currentBusinessDay: "2026-10-12",
    pending: null,
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    menus: [
      { id: "breakfast", name: "Breakfast menu", active: true, includes: [] },
      { id: "lunch", name: "Menú del día", active: true, includes: [] },
      { id: "christmas", name: "Christmas menu", active: true, includes: [] },
      { id: "bar", name: "Bar menu", active: true, includes: [] },
      { id: "staff", name: "Staff meal", active: true, includes: [] },
      { id: "wine", name: "Wine list", active: true, includes: [] },
    ],
    seasons: [
      { id: "spring", name: "Spring", startsOn: "03-01" },
      { id: "summer", name: "Summer", startsOn: "06-01" },
      { id: "autumn", name: "Autumn", startsOn: "09-01" },
      { id: "winter", name: "Winter", startsOn: "12-01" },
    ],
    currentSeasonId: "autumn",
    departments: empty
      ? []
      : [
          {
            id: "restaurant",
            name: "Restaurant",
            active: true,
            zones: [],
            periods: [
              period("p1", "Breakfast", "amber", "breakfast"),
              period("p2", "Lunch", "green", "lunch"),
              period("p5", "Christmas set menu", "grey", "christmas"),
            ],
            seasonWeeks: [],
          },
          {
            id: "bar",
            name: "Bar",
            active: true,
            zones: [],
            periods: [period("p3", "All day", "purple", "bar")],
            seasonWeeks: [],
          },
        ],
  };
}
const seasons = [
  { id: "spring", name: "Spring" },
  { id: "summer", name: "Summer" },
  { id: "autumn", name: "Autumn" },
  { id: "winter", name: "Winter" },
];
function paintedIn(nowhere: boolean): PaintedInRow[] {
  return [
    { periodId: "p1", seasons, specialDays: [] },
    {
      periodId: "p2",
      seasons,
      specialDays: [
        { id: "sd1", name: "Company dinners" },
        { id: "sd2", name: "New Year's Eve" },
      ],
    },
    { periodId: "p5", seasons: nowhere ? [] : seasons.slice(3), specialDays: [] },
    { periodId: "p3", seasons, specialDays: [] },
  ];
}

async function mount(state: string, theme: "light" | "dark") {
  const wrapper = await mountThemed("<div></div>", theme);
  const screen = document.createElement("dashboard-periods-screen") as PeriodsScreen;
  screen.api = new OpeningHoursApi((async (path: string) => {
    if (path.endsWith("/menu-periods/painted-in")) {
      if (state === "painted-in-failed") throw new Error("offline");
      return paintedIn(state === "not-painted");
    }
    if (state === "load-failed") throw new Error("offline");
    return model(state === "empty");
  }) as DashboardRequest);
  screen.readOnly = state === "viewer";
  wrapper.append(screen);
  const done = {
    "load-failed": "[data-test=read-error]",
    "painted-in-failed": "[data-test=painted-in-error]",
    empty: "[data-test=no-departments]",
  }[state];
  if (done) await expect.poll(() => screen.shadowRoot!.querySelector(done)).not.toBeNull();
  else {
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-data-table")).not.toBeNull();
    const table = screen.shadowRoot!.querySelector("wt-data-table")!;
    await expect.poll(() => table.shadowRoot!.querySelector("[part~=chip]")).not.toBeNull();
  }
  await screen.updateComplete;
  return screen;
}

describe.each(["light", "dark"] as const)("Periods (%s)", (theme) => {
  test.each(["list", "empty", "viewer", "not-painted", "load-failed", "painted-in-failed"])(
    "%s",
    async (state) => {
      setLocale("en");
      await mount(state, theme);
      await expectNoA11yViolations(host);
    },
  );
});

describe.each(["en", "es"] as const)("Periods row menus (%s)", (locale) => {
  test.each([1280, 390])("stay on screen at %s px", async (width) => {
    setLocale(locale);
    await page.viewport(width, 900);
    try {
      const screen = await mount("list", "light");
      const table = screen.shadowRoot!.querySelector("wt-data-table")!;
      await table.updateComplete;
      const menus = [...table.shadowRoot!.querySelectorAll("wt-row-actions")];
      expect(menus).toHaveLength(4);
      if (width === 390) expectRowMenusOnScreen(table, 4);
      for (const menu of menus) {
        const at = menu.shadowRoot!.querySelector("button")!.getBoundingClientRect();
        expect(at.width).toBeGreaterThan(0);
        expect(at.right).toBeLessThanOrEqual(window.innerWidth);
        expect(at.left).toBeGreaterThanOrEqual(0);
      }
    } finally {
      await page.viewport(1280, 900);
    }
  });
});
