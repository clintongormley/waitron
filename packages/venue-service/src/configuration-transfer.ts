import { civilDateOf } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import {
  addDays,
  cellIntervals,
  effective,
  isLocalDate,
  pairMatters,
  parseSpecialDateInput,
  parseWeek,
  tailOverlaps,
  type DateState,
  type Interval,
} from "./hours-rules.js";
import { CALENDAR_COLOURS, type CalendarColour, type LocalDate } from "./hours-types.js";
import { HOURS_CELL_MODES } from "./schema/hours.js";
import "./errors.js";

type Row = Record<string, unknown>;
type Tables = Readonly<Record<string, readonly Row[]>>;

const STORED_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d:00$/;

function refuse(field: string): never {
  throw new AppError("setup.request_invalid", { field });
}

/** Runs a wire-shape parser over rows rebuilt from the bundle, naming `table` when it refuses. */
function parsedAs<T>(table: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof AppError && error.code === "hours.invalid") refuse(table);
    throw error;
  }
}

function ids(rows: readonly Row[] | undefined): Set<unknown> {
  return new Set((rows ?? []).map((row) => row.id));
}

/** The venue's date when the bundle was made, as a save reads it; `null` when it cannot be read. */
function exportDate(bundle: { readonly createdAt: Date; readonly timeZone: string } | undefined) {
  if (bundle === undefined) return null;
  try {
    return civilDateOf(bundle.createdAt, bundle.timeZone) as LocalDate;
  } catch {
    return null;
  }
}

/** The `kind:id` key of a cell's one owner, which must be a department or station the bundle holds. */
function ownerKey(
  row: Row,
  table: string,
  departments: Set<unknown>,
  stations: Set<unknown>,
): string {
  const department = row.department_id ?? null;
  const station = row.station_id ?? null;
  if ((department === null) === (station === null)) refuse(`${table}.department_id`);
  if (department !== null) {
    if (!departments.has(department)) refuse(`${table}.department_id`);
    return `department:${department as string}`;
  }
  if (!stations.has(station)) refuse(`${table}.station_id`);
  return `station:${station as string}`;
}

/** Each cell's periods in position order, as wire periods; every period must name a known cell. */
function periodsByCell(
  rows: readonly Row[] | undefined,
  table: string,
  cells: Set<unknown>,
): Map<unknown, { id: unknown; opensAt: string; closesAt: string }[]> {
  const byCell = new Map<unknown, Row[]>();
  for (const row of rows ?? []) {
    if (!cells.has(row.cell_id)) refuse(`${table}.cell_id`);
    if (typeof row.position !== "number" || !Number.isInteger(row.position) || row.position < 0)
      refuse(`${table}.position`);
    for (const column of ["opens_at", "closes_at"])
      if (typeof row[column] !== "string" || !STORED_TIME.test(row[column]))
        refuse(`${table}.${column}`);
    const siblings = byCell.get(row.cell_id) ?? [];
    if (siblings.some((other) => other.position === row.position)) refuse(`${table}.position`);
    byCell.set(row.cell_id, [...siblings, row]);
  }
  return new Map(
    [...byCell].map(([cell, periods]) => [
      cell,
      periods
        .sort((a, b) => (a.position as number) - (b.position as number))
        .map((row) => ({
          id: row.id,
          opensAt: (row.opens_at as string).slice(0, 5),
          closesAt: (row.closes_at as string).slice(0, 5),
        })),
    ]),
  );
}

function storedMode(row: Row, table: string): string {
  if (!(HOURS_CELL_MODES as readonly unknown[]).includes(row.mode)) refuse(`${table}.mode`);
  return row.mode as string;
}

/**
 * Refuses (`setup.request_invalid`, `field` naming the table or `<table>.<column>`) hours rows a
 * save could not have written. An import inserts rows as they come, so this holds what the writers
 * hold: canonical times, one cell per subject and day, periods only in a periods cell, a whole week
 * or none, no overlap within a day or across a midnight, and owners the bundle carries. Like a save,
 * it leaves out a clash between two days already past in the venue's zone when the bundle was
 * made, and checks every pair when that date cannot be read. A default station's cells may travel, as the default
 * keeps them, and take no part in the clash check.
 */
export function validateHoursConfiguration(
  tables: Tables,
  bundle?: { readonly createdAt: Date; readonly timeZone: string },
): void {
  const departments = ids(tables.departments);
  const stations = ids(tables.kitchen_stations);

  const weekCells = tables.hours_week_cells ?? [];
  const weekPeriods = periodsByCell(
    tables.hours_week_periods,
    "hours_week_periods",
    ids(weekCells),
  );
  const weeks = new Map<string, { weekday: number; cell: unknown }[]>();
  for (const row of weekCells) {
    const key = ownerKey(row, "hours_week_cells", departments, stations);
    const weekday = row.weekday;
    if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
      refuse("hours_week_cells.weekday");
    const days = weeks.get(key) ?? [];
    if (days.some((day) => day.weekday === weekday)) refuse("hours_week_cells.weekday");
    const mode = storedMode(row, "hours_week_cells");
    days.push({ weekday, cell: { mode, periods: weekPeriods.get(row.id) ?? [] } });
    weeks.set(key, days);
  }
  const weekIntervals = new Map<string, (Interval[] | null)[]>();
  for (const [key, days] of weeks) {
    const full = [0, 1, 2, 3, 4, 5, 6].map(
      (weekday) =>
        days.find((day) => day.weekday === weekday) ?? {
          weekday,
          cell: { mode: "not_set", periods: [] },
        },
    );
    const week = parsedAs("hours_week_cells", () => parseWeek(full));
    weekIntervals.set(
      key,
      week.cells.map((cell) => cellIntervals(cell)),
    );
  }

  const dates = new Map<unknown, { date: LocalDate; closeWholeVenue: boolean; row: Row }>();
  const taken = new Set<LocalDate>();
  for (const row of tables.special_dates ?? []) {
    if (!isLocalDate(row.date) || taken.has(row.date)) refuse("special_dates.date");
    taken.add(row.date);
    if (typeof row.name !== "string" || row.name.trim() === "") refuse("special_dates.name");
    if (!CALENDAR_COLOURS.includes(row.colour as CalendarColour)) refuse("special_dates.colour");
    if (row.close_whole_venue !== 0 && row.close_whole_venue !== 1)
      refuse("special_dates.close_whole_venue");
    dates.set(row.id, { date: row.date, closeWholeVenue: row.close_whole_venue === 1, row });
  }
  const dateCells = tables.special_date_hours ?? [];
  const datePeriods = periodsByCell(
    tables.special_date_hours_periods,
    "special_date_hours_periods",
    ids(dateCells),
  );
  const cellsByDate = new Map<unknown, { key: string; cell: unknown }[]>();
  for (const row of dateCells) {
    if (!dates.has(row.special_date_id)) refuse("special_date_hours.special_date_id");
    const key = ownerKey(row, "special_date_hours", departments, stations);
    const cells = cellsByDate.get(row.special_date_id) ?? [];
    if (cells.some((cell) => cell.key === key))
      refuse(`special_date_hours.${key.startsWith("department:") ? "department" : "station"}_id`);
    const mode = storedMode(row, "special_date_hours");
    cells.push({ key, cell: { mode, periods: datePeriods.get(row.id) ?? [] } });
    cellsByDate.set(row.special_date_id, cells);
  }
  const states = new Map<LocalDate, DateState>();
  for (const [id, { date, closeWholeVenue, row }] of dates) {
    const cells = cellsByDate.get(id) ?? [];
    const input = parsedAs("special_date_hours", () =>
      parseSpecialDateInput({
        date,
        name: row.name,
        colour: row.colour,
        closeWholeVenue,
        cells: cells.map(({ key, cell }) => {
          const [kind, ...rest] = key.split(":");
          return { subject: { kind, id: rest.join(":") }, cell };
        }),
      }),
    );
    states.set(date, {
      closeWholeVenue,
      cells: new Map(
        input.cells.map((entry, index) => [cells[index]!.key, cellIntervals(entry.cell)]),
      ),
    });
  }

  const defaults = new Set(
    (tables.kitchen_stations ?? []).filter((row) => row.is_default === 1).map((row) => row.id),
  );
  const subjects = [
    ...[...departments].map((id) => `department:${id as string}`),
    ...[...stations].filter((id) => !defaults.has(id)).map((id) => `station:${id as string}`),
  ];
  const today = exportDate(bundle);
  for (const key of subjects) {
    const week = (weekday: number) => weekIntervals.get(key)?.[weekday] ?? null;
    for (const date of states.keys())
      for (const earlier of [addDays(date, -1), date]) {
        if (!pairMatters(earlier, today)) continue;
        const later = addDays(earlier, 1);
        if (
          tailOverlaps(
            effective(earlier, key, states, week).intervals,
            effective(later, key, states, week).intervals,
          )
        )
          refuse("special_date_hours");
      }
  }
}

export const VENUE_SERVICE_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "departments", locationColumns: ["location_id"] },
    { name: "department_sale_policies" },
    { name: "zone_service_policies", locationColumns: ["location_id"] },
    { name: "zone_sale_policies" },
    { name: "zone_menus" },
    { name: "station_claims", locationColumns: ["location_id"] },
    { name: "station_fallbacks" },
    { name: "route_exceptions", locationColumns: ["location_id"] },
    { name: "service_settings" },
    { name: "hours_week_cells" },
    { name: "hours_week_periods" },
    { name: "special_dates", locationColumns: ["location_id"] },
    { name: "special_date_hours" },
    { name: "special_date_hours_periods" },
  ],
  validate: validateHoursConfiguration,
} as const;
