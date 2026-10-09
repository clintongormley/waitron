import { afterEach, beforeEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { ServiceGrid } from "./service-grid.js";
import "./opening-hours-screen.js";

type All = HTMLElementTagNameMap["opening-hours-all"];
const hosts: All[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  setLocale("en");
});
function allDepartments(): OpeningHoursModel["departments"] {
  return [
    {
      id: "restaurant",
      name: "Restaurant",
      active: true,
      zones: [],
      periods: [
        {
          id: "lunch",
          name: "Lunch",
          colour: "blue",
          menuId: "menu",
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: [1],
        },
      ],
      week: [{ weekday: 1, slots: [{ periodId: "lunch", startsAt: "12:00", endsAt: "16:00" }] }],
      dates: [],
    },
    {
      id: "bar",
      name: "Bar",
      active: true,
      zones: [],
      periods: [
        {
          id: "dinner",
          name: "Dinner",
          colour: "green",
          menuId: "menu",
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: [2],
        },
      ],
      week: [{ weekday: 2, slots: [{ periodId: "dinner", startsAt: "18:00", endsAt: "23:00" }] }],
      dates: [],
    },
    { id: "retired", name: "Retired", active: false, zones: [], periods: [], week: [], dates: [] },
  ];
}
async function mount() {
  const el = document.createElement("opening-hours-all") as All;
  hosts.push(el);
  applyTokens(el);
  el.departments = allDepartments();
  el.dayCutover = "06:00";
  document.body.append(el);
  expect(el.shadowRoot, "All departments registered and rendered").not.toBeNull();
  await el.updateComplete;
  return el;
}
it("shows Monday-first days with narrow active department columns and each day's own slots", async () => {
  const el = await mount();
  const grids = Array.from(el.shadowRoot!.querySelectorAll<ServiceGrid>("service-grid"));
  expect(grids).toHaveLength(1);
  const grid = grids[0]!;
  expect(grid.columns.map((c) => c.label)).toEqual([
    "Monday",
    "Monday",
    "Tuesday",
    "Tuesday",
    "Wednesday",
    "Wednesday",
    "Thursday",
    "Thursday",
    "Friday",
    "Friday",
    "Saturday",
    "Saturday",
    "Sunday",
    "Sunday",
  ]);
  expect(grid.readOnly).toBe(true);
  expect(grid.columns.map((c) => ({ key: c.key, editable: c.editable, narrow: c.narrow }))).toEqual(
    [1, 2, 3, 4, 5, 6, 0].flatMap((day) => [
      { key: `${day}:restaurant`, editable: false, narrow: true },
      { key: `${day}:bar`, editable: false, narrow: true },
    ]),
  );
  await grid.updateComplete;
  expect(grid.shadowRoot!.querySelector("button")).toBeNull();
  expect(grid.columns[0]!.slots).toEqual([
    { periodId: "lunch", startsAt: "12:00", endsAt: "16:00" },
  ]);
  expect(grid.columns[1]!.slots).toEqual([]);
  expect(grid.columns[3]!.slots).toEqual([
    { periodId: "dinner", startsAt: "18:00", endsAt: "23:00" },
  ]);
  expect(grid.columns[0]!.periods[0]!.name).toBe("Lunch");
  expect(el.shadowRoot!.querySelector("wt-form-actions")).toBeNull();
});
it("opens a heading's department with a composed event and a usable link", async () => {
  const el = await mount();
  const events: unknown[] = [];
  el.addEventListener("department-open", (e) => events.push((e as CustomEvent).detail));
  const link = el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-department=bar]");
  expect(link).not.toBeNull();
  expect(link!.getAttribute("href")).toBe("/manage/opening-hours/view/week/department/bar");
  link!.click();
  expect(events).toEqual([{ departmentId: "bar" }]);
});
it("updates headings and periods from the next model snapshot", async () => {
  const el = await mount();
  el.departments = [{ ...allDepartments()[0]!, name: "Dining room", week: [] }];
  await el.updateComplete;
  const grid = el.shadowRoot!.querySelector<ServiceGrid>("service-grid")!;
  expect(grid.columns).toHaveLength(7);
  expect(grid.columns[0]!.slots).toEqual([]);
  expect(el.shadowRoot!.textContent).toContain("Dining room");
});

it("shows dated ranges and whole-venue closure when a named day is selected", async () => {
  const el = await mount();
  el.departments = [
    {
      ...allDepartments()[0]!,
      dates: [
        {
          specialDateId: "named",
          slots: [{ periodId: "lunch", startsAt: "14:00", endsAt: "17:00" }],
        },
      ],
    },
    allDepartments()[1]!,
  ];
  el.weekStart = "2026-10-12";
  el.namedDays = [
    {
      id: "named",
      date: "2026-10-12",
      name: "Own Monday",
      kind: "working_day" as const,
      repeats: false,
      ownHours: true,
      hasStationHours: false,
      closeWholeVenue: false,
    },
  ];
  await el.updateComplete;
  const grid = el.shadowRoot!.querySelector<ServiceGrid>("service-grid")!;
  expect(grid.columns).toHaveLength(14);
  expect(grid.columns[0]!.slots).toEqual([
    { periodId: "lunch", startsAt: "14:00", endsAt: "17:00" },
  ]);
  expect(grid.columns[1]!.slots).toEqual([]);
  el.weekStart = "2026-10-12";
  el.namedDays = [{ ...el.namedDays[0]!, ownHours: false, closeWholeVenue: true }];
  await el.updateComplete;
  expect(grid.columns.slice(0, 2).every((column) => column.slots.length === 0)).toBe(true);
  expect(grid.columns[3]!.slots).toEqual([
    { periodId: "dinner", startsAt: "18:00", endsAt: "23:00" },
  ]);
});
