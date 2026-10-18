import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { OpeningHoursApi, type PaintedInRow } from "./opening-hours-client.js";
import type { PeriodsList } from "./periods-list.js";
import "@waitron/ui/src/components/wt-modal.js";
import "./periods-list.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

/** Each bin lies inside the table's scroll box and the screen, and is what a tap at its centre hits. */
function expectBinsOnScreen(table: Element, rows: number) {
  const scroll = table.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  expect(scroll.scrollWidth, "the table overflows its box").toBeGreaterThan(scroll.clientWidth);
  expect(scroll.scrollLeft).toBe(0);
  const box = scroll.getBoundingClientRect();
  const bins = [...table.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=delete-period]")];
  expect(bins).toHaveLength(rows);
  for (const [index, bin] of bins.entries()) {
    const at = bin.shadowRoot!.querySelector("button")!.getBoundingClientRect();
    expect(at.width, `row ${index}`).toBeGreaterThan(0);
    expect(at.right, `row ${index}`).toBeLessThanOrEqual(box.right);
    expect(at.left, `row ${index}`).toBeGreaterThanOrEqual(box.left);
    expect(at.right, `row ${index} against the screen`).toBeLessThanOrEqual(window.innerWidth);
    const hit = table.shadowRoot!.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2);
    expect(hit !== null && bin.contains(hit), `row ${index} is covered`).toBe(true);
  }
}

type Period = OpeningHoursModel["departments"][number]["periods"][number];
const period = (id: string, name: string, colour: Period["colour"], menuId: string): Period => ({
  id,
  name,
  colour,
  menuId,
  staffMenuIds: id === "p2" ? ["staff", "wine"] : [],
  endOffsetMinutes: 0,
  floorPlanSetId: null,
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
      { id: "spring", name: "Spring", startsOn: "03-01", colour: "green" },
      { id: "summer", name: "Summer", startsOn: "06-01", colour: "amber" },
      { id: "autumn", name: "Autumn", startsOn: "09-01", colour: "orange" },
      { id: "winter", name: "Winter", startsOn: "12-01", colour: "blue" },
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

async function mount(state: string, theme: "light" | "dark", inWindow = false) {
  const wrapper = await mountThemed("<div></div>", theme);
  const screen = document.createElement("periods-list") as PeriodsList;
  screen.api = new OpeningHoursApi((async (path: string, method: string) => {
    if (path.endsWith("/delete-impact"))
      return {
        seasons: 4,
        specialDays: 1,
        routingUses:
          state === "delete"
            ? []
            : [
                { rowKind: "category", rowLabel: "Cocktails", zoneName: null },
                { rowKind: "all", rowLabel: null, zoneName: "Terrace" },
              ],
        keptOpenToday: true,
        replacements: [
          { id: "p1", name: "Breakfast" },
          { id: "p5", name: "Christmas set menu" },
        ],
        clockRevision: 0,
      };
    if (method === "POST") throw { code: "hours.clock_changed" };
    if (path.endsWith("/menu-periods/painted-in")) {
      if (state === "painted-in-failed") throw new Error("offline");
      return paintedIn(state === "not-painted");
    }
    if (state === "load-failed") throw new Error("offline");
    return model(state === "empty");
  }) as DashboardRequest);
  screen.readOnly = state === "viewer";
  if (inWindow) {
    const frame = document.createElement("wt-modal");
    frame.open = true;
    wrapper.append(frame);
    frame.append(screen);
  } else wrapper.append(screen);
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
  if (state.startsWith("delete")) {
    const table = screen.shadowRoot!.querySelector("wt-data-table")!;
    table
      .shadowRoot!.querySelector<HTMLElement>(
        'tr[data-row-key="period:p2"] [data-test=delete-period]',
      )!
      .click();
    await screen.updateComplete;
    const dialog = screen.shadowRoot!.querySelector("period-delete-dialog")!;
    const confirm = () =>
      dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
        "[data-test=confirm-delete]",
      )!;
    await expect.poll(() => confirm().disabled).toBe(false);
    const body = dialog.shadowRoot!.querySelector("[data-test=body]")!.textContent!;
    if (state === "delete-routing") expect(body).toContain("Named in 2 routing cells");
    if (state === "delete") expect(body).not.toContain("routing cell");
    if (state === "delete-refused") {
      confirm().click();
      await expect
        .poll(() => dialog.shadowRoot!.querySelector("wt-form-actions")!.error)
        .toBe(
          "The business-day start changed. Check what deleting it changes, then delete it again.",
        );
      await expect.poll(() => confirm().disabled).toBe(false);
    }
    await dialog.updateComplete;
  }
  return screen;
}

describe.each(["light", "dark"] as const)("Periods (%s)", (theme) => {
  test.each([
    "list",
    "empty",
    "viewer",
    "not-painted",
    "load-failed",
    "painted-in-failed",
    "delete",
    "delete-routing",
    "delete-refused",
  ])("%s", async (state) => {
    setLocale("en");
    await mount(state, theme);
    await expectNoA11yViolations(host);
  });
});

describe.each(["en", "es"] as const)("Periods bins in the window (%s)", (locale) => {
  test.each([1280, 390])("stay on screen at %s px", async (width) => {
    setLocale(locale);
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      const screen = await mount("list", "light", true);
      const table = screen.shadowRoot!.querySelector("wt-data-table")!;
      await table.updateComplete;
      const bins = [...table.shadowRoot!.querySelectorAll("[data-test=delete-period]")];
      expect(bins).toHaveLength(4);
      if (width === 390) expectBinsOnScreen(table, 4);
      for (const bin of bins) {
        const at = bin.shadowRoot!.querySelector("button")!.getBoundingClientRect();
        expect(at.width).toBeGreaterThan(0);
        expect(at.right).toBeLessThanOrEqual(window.innerWidth);
        expect(at.left).toBeGreaterThanOrEqual(0);
      }
    } finally {
      await page.viewport(1280, 900);
    }
  });
});
