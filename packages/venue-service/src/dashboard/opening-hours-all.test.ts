import { afterEach, beforeEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { ServiceGrid } from "./service-grid.js";
import type { SpecialDaysModel } from "../holiday-types.js";
import type { SpecialDayDetail } from "../special-days.js";
import { namedWeekModel } from "../testing/real-week-model.js";
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
          routingUses: [],
        },
      ],
      seasonWeeks: [
        {
          seasonId: "s",
          week: [
            { weekday: 1, slots: [{ periodId: "lunch", startsAt: "12:00", endsAt: "16:00" }] },
          ],
        },
      ],
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
          routingUses: [],
        },
      ],
      seasonWeeks: [
        {
          seasonId: "s",
          week: [
            { weekday: 2, slots: [{ periodId: "dinner", startsAt: "18:00", endsAt: "23:00" }] },
          ],
        },
      ],
    },
    {
      id: "retired",
      name: "Retired",
      active: false,
      zones: [],
      periods: [],
      seasonWeeks: [],
    },
  ];
}
async function mount() {
  const el = document.createElement("opening-hours-all") as All;
  hosts.push(el);
  applyTokens(el);
  el.departments = allDepartments();
  el.dayCutover = "06:00";
  el.seasonId = "s";
  el.seasons = [{ id: "s", name: "Year", startsOn: "01-01" }];
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
  el.departments = [{ ...allDepartments()[0]!, name: "Dining room", seasonWeeks: [] }];
  await el.updateComplete;
  const grid = el.shadowRoot!.querySelector<ServiceGrid>("service-grid")!;
  expect(grid.columns).toHaveLength(7);
  expect(grid.columns[0]!.slots).toEqual([]);
  expect(el.shadowRoot!.textContent).toContain("Dining room");
});

it("shows dated ranges and whole-venue closure when a special day is on the date", async () => {
  const el = await mount();
  const detail: SpecialDayDetail = {
    id: "named",
    name: "Own Monday",
    repeatsYearly: false,
    dates: [{ date: "2026-10-12", closedAllDay: false }],
    paint: [
      {
        departmentId: "restaurant",
        date: "2026-10-12",
        ranges: [
          { periodId: null, startsAt: "12:00", endsAt: "14:00" },
          { periodId: "lunch", startsAt: "14:00", endsAt: "17:00" },
        ],
      },
    ],
    zonePaint: [],
  };
  const calendar = (closed: boolean): SpecialDaysModel => ({
    ...namedWeekModel(),
    days: [
      {
        date: "2026-10-12",
        specialDay: { id: "named", name: "Own Monday" },
        holidays: [],
        tone: "special_day",
        closed,
      },
    ],
  });
  el.weekStart = "2026-10-12";
  el.calendar = calendar(false);
  el.specials = new Map([[detail.id, detail]]);
  await el.updateComplete;
  const grid = el.shadowRoot!.querySelector<ServiceGrid>("service-grid")!;
  expect(grid.columns).toHaveLength(14);
  expect(grid.columns[0]!.slots).toEqual([
    { periodId: "lunch", startsAt: "14:00", endsAt: "17:00" },
  ]);
  expect(grid.columns[1]!.slots).toEqual([]);
  el.weekStart = "2026-10-12";
  el.calendar = calendar(true);
  await el.updateComplete;
  expect(grid.columns.slice(0, 2).every((column) => column.slots.length === 0)).toBe(true);
  expect(grid.columns[3]!.slots).toEqual([
    { periodId: "dinner", startsAt: "18:00", endsAt: "23:00" },
  ]);
});

it("in the real week from Monday 25 Nov 2030, shows Autumn's Monday to Saturday and Winter's Sunday 1 Dec", async () => {
  const el = await mount();
  const week = (endsAt: string) =>
    Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      slots: [{ periodId: "lunch", startsAt: "12:00", endsAt: `${endsAt}${weekday}` }],
    }));
  el.seasons = [
    { id: "autumn", name: "Autumn", startsOn: "09-01" },
    { id: "winter", name: "Winter", startsOn: "12-01" },
  ];
  el.seasonId = "autumn";
  el.departments = [
    {
      ...allDepartments()[0]!,
      seasonWeeks: [
        { seasonId: "autumn", week: week("16:0") },
        { seasonId: "winter", week: week("17:0") },
      ],
    },
  ];
  el.weekStart = "2030-11-25";
  await el.updateComplete;
  const grid = el.shadowRoot!.querySelector<ServiceGrid>("service-grid")!;
  expect(grid.columns.map((column) => column.slots[0]!.endsAt)).toEqual([
    "16:01",
    "16:02",
    "16:03",
    "16:04",
    "16:05",
    "16:06",
    "17:00",
  ]);
});
it("leaves a modified or non-primary click on a heading to the browser", async () => {
  const el = await mount();
  const events: unknown[] = [];
  el.addEventListener("department-open", (e) => events.push((e as CustomEvent).detail));
  const link = el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-department=bar]")!;
  const handled: boolean[] = [];
  link.addEventListener("click", (event) => {
    handled.push(event.defaultPrevented);
    event.preventDefault();
  });
  for (const init of [
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
  expect(events).toEqual([]);
  expect(handled).toEqual([false, false, false, false, false]);
});
