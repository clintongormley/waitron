import { getCountryPack } from "@waitron/country-packs";
import { civilDateOf } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import { localHolidayName } from "./holiday-rules.js";
import { holidayCityKey, type PackLookup } from "./holidays.js";
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
import { isReadableZone, skippedEndpoint } from "./hours-clock.js";
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

/** The venue's calendar date when the bundle was made; `null` when it cannot be read. */
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
 * or none, no overlap within a day or across a midnight, and owners the bundle carries. It leaves
 * out a clash between two days already past in the venue's zone when the bundle was made, and
 * checks every pair when that date cannot be read. It reads no day cutover, so for a venue whose
 * cutover or numeric-offset zone a save finds unreadable (and then checks every pair), it can still
 * leave past pairs out. A special-date period may not open or close at a minute the clocks skip in
 * the venue's zone, unless its date and the day after were both past at export. With no readable
 * zone that goes unchecked, as a save leaves it unchecked for an unreadable clock; but reading no
 * cutover, it is checked for a venue whose zone reads and whose cutover does not, which a save
 * leaves unchecked. A default station's cells may travel, as the default keeps them, and take no
 * part in either check.
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
  const defaults = new Set(
    (tables.kitchen_stations ?? []).filter((row) => row.is_default === 1).map((row) => row.id),
  );
  const today = exportDate(bundle);
  const zone = bundle !== undefined && isReadableZone(bundle.timeZone) ? bundle.timeZone : null;
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
    if (zone !== null && pairMatters(date, today)) {
      const applied = input.cells.filter(
        (entry) => !(entry.subject.kind === "station" && defaults.has(entry.subject.id)),
      );
      const skipped = skippedEndpoint(date, applied, zone);
      if (skipped !== null)
        refuse(
          `special_date_hours_periods.${skipped.end === "opensAt" ? "opens_at" : "closes_at"}`,
        );
    }
    states.set(date, {
      closeWholeVenue,
      cells: new Map(
        input.cells.map((entry, index) => [cells[index]!.key, cellIntervals(entry.cell)]),
      ),
    });
  }

  const subjects = [
    ...[...departments].map((id) => `department:${id as string}`),
    ...[...stations].filter((id) => !defaults.has(id)).map((id) => `station:${id as string}`),
  ];
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

/**
 * Refuses (`setup.request_invalid`, `field` naming the table or `<table>.<column>`) holiday rows the
 * writers could not have stored, judged by the RECEIVING build's country packs: each geography's
 * country is a pack's code, its province one of that pack's codes, its city key the city's
 * normalized form and its area one the pack sources for that province; no two geographies share a
 * place, since the import moves every one to the one receiving venue. Each entry names a geography
 * in the bundle, a real date no other entry of that geography holds and a name the writer keeps as
 * it is; and no geography holds more entries in a civil year than its pack allows, which is none
 * for a pack without a holiday calendar. Retained geographies are held to the same rules.
 */
export function validateHolidayConfiguration(
  tables: Tables,
  findPack: PackLookup = getCountryPack,
): void {
  const allowance = new Map<unknown, number>();
  const places = new Set<string>();
  for (const row of tables.holiday_geographies ?? []) {
    if (typeof row.id !== "string" || allowance.has(row.id)) refuse("holiday_geographies.id");
    const pack = typeof row.country === "string" ? findPack(row.country) : undefined;
    if (pack === undefined || pack.countryCode !== row.country)
      refuse("holiday_geographies.country");
    const province = row.province_code;
    if (!pack.administrativeAreas.some(({ code }) => code === province))
      refuse("holiday_geographies.province_code");
    if (typeof row.city !== "string" || row.city.trim() === "") refuse("holiday_geographies.city");
    if (row.city_key !== holidayCityKey(row.city)) refuse("holiday_geographies.city_key");
    const place = JSON.stringify([row.country, province, row.city_key]);
    if (places.has(place)) refuse("holiday_geographies.city_key");
    places.add(place);
    const calendar = pack.holidayCalendar;
    const area = row.area_key ?? null;
    if (
      area !== null &&
      !(calendar?.areasForProvince(province as string) ?? []).some(({ key }) => key === area)
    )
      refuse("holiday_geographies.area_key");
    allowance.set(row.id, calendar?.localEntryLimit ?? 0);
  }

  const entryIds = new Set<unknown>();
  const taken = new Set<string>();
  const perYear = new Map<string, number>();
  for (const row of tables.local_holidays ?? []) {
    if (typeof row.id !== "string" || entryIds.has(row.id)) refuse("local_holidays.id");
    entryIds.add(row.id);
    const limit = allowance.get(row.geography_id);
    if (limit === undefined) refuse("local_holidays.geography_id");
    if (!isLocalDate(row.date)) refuse("local_holidays.date");
    const day = JSON.stringify([row.geography_id, row.date]);
    if (taken.has(day)) refuse("local_holidays.date");
    taken.add(day);
    if (localHolidayName(row.name) !== row.name) refuse("local_holidays.name");
    const year = JSON.stringify([row.geography_id, row.date.slice(0, 4)]);
    const count = (perYear.get(year) ?? 0) + 1;
    if (count > limit) refuse("local_holidays");
    perYear.set(year, count);
  }
}

/** The module's import check: Hours' rows, then the holiday rows. */
function validateVenueServiceConfiguration(
  tables: Tables,
  bundle?: { readonly createdAt: Date; readonly timeZone: string },
): void {
  validateHoursConfiguration(tables, bundle);
  validateHolidayConfiguration(tables);
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
    { name: "holiday_geographies", locationColumns: ["location_id"] },
    { name: "local_holidays" },
  ],
  validate: validateVenueServiceConfiguration,
} as const;
