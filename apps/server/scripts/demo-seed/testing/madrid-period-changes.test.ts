import { expect, it } from "vitest";
import { madridWithPeriodChanges, type MadridPeriodChange } from "./madrid-period-changes.js";
import type { CanonicalMadridSemantics } from "./madrid-semantics.js";

const bar = '@departments:["Bar"]';
const deli = '@departments:["Deli"]';
const open = '@menu_periods:["@departments:[\\"Bar\\"]","Open"]';
const deliOpen = '@menu_periods:["@departments:[\\"Deli\\"]","Open"]';
const day = (department: string, weekday: number | null, special: string | null = null) =>
  `@department_days:${JSON.stringify([department, '@seasons:["Winter"]', weekday, special])}`;
const range = (dayId: string, startsAt: string, endsAt: string) =>
  `@department_day_ranges:${JSON.stringify([dayId, startsAt, endsAt])}`;
const table = (rows: Record<string, Record<string, unknown>>) => ({
  columns: [],
  foreignKeys: [],
  rows,
});
const rangeRow = (
  department: string,
  dayId: string,
  periodId: string | null,
  startsAt: string,
  endsAt: string,
) => ({
  id: range(dayId, startsAt, endsAt),
  day_id: dayId,
  department_id: department,
  period_id: periodId,
  starts_at: startsAt,
  ends_at: endsAt,
});
const keyed = (...rows: { id: string }[]) => Object.fromEntries(rows.map((row) => [row.id, row]));

const original = (): CanonicalMadridSemantics => ({
  tables: {
    menu_periods: table({
      [open]: {
        id: open,
        department_id: bar,
        name: "Open",
        colour: "red",
        menu_id: '@catalogues:["Casa"]',
        floor_plan_set_id: null,
      },
      [deliOpen]: {
        id: deliOpen,
        department_id: deli,
        name: "Open",
        colour: "red",
        menu_id: '@catalogues:["Deli"]',
        floor_plan_set_id: null,
      },
    }),
    menu_period_staff_menus: table({
      staff: {
        period_id: open,
        department_id: bar,
        menu_id: '@catalogues:["Lunch"]',
        display_order: 0,
      },
    }),
    department_days: table({
      [day(bar, 0)]: { id: day(bar, 0), department_id: bar, weekday: 0 },
      [day(bar, 1)]: { id: day(bar, 1), department_id: bar, weekday: 1 },
      [day(bar, null, "xmas")]: { id: day(bar, null, "xmas"), department_id: bar, weekday: null },
      [day(deli, 1)]: { id: day(deli, 1), department_id: deli, weekday: 1 },
    }),
    department_day_ranges: table(
      keyed(
        rangeRow(bar, day(bar, 0), open, "09:00:00", "00:00:00"),
        rangeRow(bar, day(bar, 1), open, "09:00:00", "00:00:00"),
        rangeRow(bar, day(bar, null, "xmas"), null, "10:00:00", "12:00:00"),
        rangeRow(deli, day(deli, 1), deliOpen, "09:00:00", "18:00:00"),
      ),
    ),
    routing_cell_periods: table({}),
    floor_zones: table({
      terrace: {
        id: "terrace",
        department_id: bar,
        today_occurrence: [bar, "2026-10-08", open, "09:00"],
      },
      counter: {
        id: "counter",
        department_id: deli,
        today_occurrence: [deli, "2026-10-08", deliOpen, "09:00"],
      },
    }),
  },
});

const change: MadridPeriodChange = {
  department: bar,
  replaced: "Open",
  periods: [
    { name: "Drinks", colour: "red", menu: '@catalogues:["Drinks"]', staffMenus: [] },
    {
      name: "Lunch",
      colour: "orange",
      menu: '@catalogues:["Casa"]',
      staffMenus: ['@catalogues:["Lunch"]'],
    },
  ],
  week: [
    { period: "Drinks", startsAt: "09:00:00", endsAt: "13:00:00" },
    { period: "Lunch", startsAt: "13:00:00", endsAt: "00:00:00" },
  ],
  occurrence: { period: "Lunch", startsAt: "13:00" },
};
const drinks = '@menu_periods:["@departments:[\\"Bar\\"]","Drinks"]';
const lunch = '@menu_periods:["@departments:[\\"Bar\\"]","Lunch"]';

it("replaces the department's period with the declared ones and every weekday's ranges with the declared week", () => {
  const before = original();
  const { semantics, added } = madridWithPeriodChanges(before, change);
  expect(semantics.tables.menu_periods!.rows).toEqual({
    [deliOpen]: before.tables.menu_periods!.rows[deliOpen],
    [drinks]: {
      id: drinks,
      department_id: bar,
      name: "Drinks",
      colour: "red",
      menu_id: '@catalogues:["Drinks"]',
      floor_plan_set_id: null,
    },
    [lunch]: {
      id: lunch,
      department_id: bar,
      name: "Lunch",
      colour: "orange",
      menu_id: '@catalogues:["Casa"]',
      floor_plan_set_id: null,
    },
  });
  expect(Object.values(semantics.tables.menu_period_staff_menus!.rows)).toEqual([
    { period_id: lunch, department_id: bar, menu_id: '@catalogues:["Lunch"]', display_order: 0 },
  ]);
  expect(semantics.tables.department_day_ranges!.rows).toEqual(
    keyed(
      rangeRow(bar, day(bar, null, "xmas"), null, "10:00:00", "12:00:00"),
      rangeRow(deli, day(deli, 1), deliOpen, "09:00:00", "18:00:00"),
      ...[0, 1].flatMap((weekday) => [
        rangeRow(bar, day(bar, weekday), drinks, "09:00:00", "13:00:00"),
        rangeRow(bar, day(bar, weekday), lunch, "13:00:00", "00:00:00"),
      ]),
    ),
  );
  expect(semantics.tables.floor_zones!.rows).toEqual({
    terrace: {
      id: "terrace",
      department_id: bar,
      today_occurrence: [bar, "2026-10-08", lunch, "13:00"],
    },
    counter: before.tables.floor_zones!.rows.counter,
  });
  expect(added).toEqual({ menu_periods: 1, menu_period_staff_menus: 0, department_day_ranges: 2 });
  expect(before).toEqual(original());
});

it("refuses a replaced period the capture does not hold", () => {
  expect(() => madridWithPeriodChanges(original(), { ...change, replaced: "Closed" })).toThrow(
    "Madrid replaced period not found",
  );
});

it("refuses a declared period the capture already holds", () => {
  const holding = original();
  holding.tables.menu_periods!.rows[lunch] = { id: lunch, department_id: bar, name: "Lunch" };
  expect(() => madridWithPeriodChanges(holding, change)).toThrow(
    "Madrid declared period already present",
  );
});

it("refuses a weekday range of the department that another period serves", () => {
  const other = original();
  other.tables.department_day_ranges!.rows[range(day(bar, 1), "09:00:00", "00:00:00")]!.period_id =
    deliOpen;
  expect(() => madridWithPeriodChanges(other, change)).toThrow(
    "Madrid range not served by the replaced period",
  );
});

it("refuses an occurrence naming a period it does not declare", () => {
  expect(() =>
    madridWithPeriodChanges(original(), {
      ...change,
      occurrence: { period: "Dinner", startsAt: "20:00" },
    }),
  ).toThrow("Madrid occurrence names an undeclared period: Dinner");
});

it("refuses a week naming a period it does not declare", () => {
  expect(() =>
    madridWithPeriodChanges(original(), {
      ...change,
      week: [{ period: "Dinner", startsAt: "20:00:00", endsAt: "23:00:00" }],
    }),
  ).toThrow("Madrid week names an undeclared period: Dinner");
});

it("refuses when another row still refers to the replaced period", () => {
  const referenced = original();
  referenced.tables.routing_cell_periods!.rows.cell = { id: "cell", period_id: open };
  expect(() => madridWithPeriodChanges(referenced, change)).toThrow(
    "Madrid replaced period still referenced: routing_cell_periods cell",
  );
});
