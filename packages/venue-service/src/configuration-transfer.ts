import { getCountryPack } from "@waitron/country-packs";
import { civilDateOf } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import { holidayCityKey, localHolidayName } from "./holiday-rules.js";
import type { PackLookup } from "./holidays.js";
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
import {
  firstMenuClash,
  menuPeriodName,
  parseMenuWeek,
  parseSlots,
  slotCell,
  slotIntervals,
} from "./menu-timetable-rules.js";
import type { MenuSlot } from "./menu-timetable-types.js";
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
    if (
      error instanceof AppError &&
      (error.code === "hours.invalid" || error.code === "menu_timetable.invalid")
    )
      refuse(table);
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
    if (typeof row.city !== "string" || row.city.trim() === "" || row.city !== row.city.trim())
      refuse("holiday_geographies.city");
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

/** A zone's all-day menu must be filed under the zone's own department, which no key states. */
function validateDepartmentMenus(tables: Tables): void {
  const departmentOf = new Map(
    (tables.zone_service_policies ?? []).map((row) => [row.zone_id, row.department_id]),
  );
  for (const row of tables.zone_all_day_menus ?? [])
    if (!departmentOf.has(row.zone_id) || departmentOf.get(row.zone_id) !== row.department_id)
      refuse("zone_all_day_menus.department_id");
}

/**
 * Refuses (`setup.request_invalid`, `field` naming the table or `<table>.<column>`) menu timetable
 * rows a writer could not have written: a named period with a blank, untrimmed or repeated name or
 * a menu its department does not list; a day that is not exactly one weekday or one of the bundle's
 * special dates, or is held twice; a slot whose department or period is not its day's, whose times
 * are not canonical, or which overlaps another within a day or across a midnight; and a zone's
 * period menu filed under a department other than the zone's or the period's. A special-date slot
 * may not open or close at a minute the clocks skip, and past pairs are left out, as for the
 * hours rows above. A whole-venue closure plays no part.
 */
export function validateMenuTimetables(
  tables: Tables,
  bundle?: { readonly createdAt: Date; readonly timeZone: string },
): void {
  const departments = ids(tables.departments);
  const members = new Set(
    (tables.department_menus ?? []).map(
      (row) => `${String(row.department_id)}:${String(row.menu_id)}`,
    ),
  );
  const member = (row: Row) => members.has(`${String(row.department_id)}:${String(row.menu_id)}`);
  const periodDepartment = new Map<unknown, unknown>();
  const names = new Set<string>();
  for (const row of tables.menu_periods ?? []) {
    if (!departments.has(row.department_id)) refuse("menu_periods.department_id");
    if (parsedAs("menu_periods.name", () => menuPeriodName(row.name)) !== row.name)
      refuse("menu_periods.name");
    const name = JSON.stringify([row.department_id, row.name]);
    if (names.has(name)) refuse("menu_periods.name");
    names.add(name);
    if (!member(row)) refuse("menu_periods.menu_id");
    periodDepartment.set(row.id, row.department_id);
  }

  const dates = new Map((tables.special_dates ?? []).map((row) => [row.id, row.date as LocalDate]));
  const days = new Map<
    unknown,
    { departmentId: unknown; weekday: number | null; date: LocalDate | null }
  >();
  const held = new Set<string>();
  for (const row of tables.menu_day_timetables ?? []) {
    if (!departments.has(row.department_id)) refuse("menu_day_timetables.department_id");
    const weekday = row.weekday ?? null;
    const dateId = row.special_date_id ?? null;
    if ((weekday === null) === (dateId === null)) refuse("menu_day_timetables.weekday");
    if (
      weekday !== null &&
      (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
    )
      refuse("menu_day_timetables.weekday");
    if (dateId !== null && !dates.has(dateId)) refuse("menu_day_timetables.special_date_id");
    const day = JSON.stringify([row.department_id, weekday, dateId]);
    if (held.has(day))
      refuse(`menu_day_timetables.${weekday === null ? "special_date_id" : "weekday"}`);
    held.add(day);
    days.set(row.id, {
      departmentId: row.department_id,
      weekday: weekday as number | null,
      date: dateId === null ? null : dates.get(dateId)!,
    });
  }

  const slotsByDay = new Map<unknown, MenuSlot[]>([...days.keys()].map((id) => [id, []]));
  for (const row of tables.menu_slots ?? []) {
    const day = days.get(row.timetable_id);
    if (day === undefined) refuse("menu_slots.timetable_id");
    if (row.department_id !== day.departmentId) refuse("menu_slots.department_id");
    if (periodDepartment.get(row.period_id) !== day.departmentId) refuse("menu_slots.period_id");
    for (const column of ["starts_at", "ends_at"])
      if (typeof row[column] !== "string" || !STORED_TIME.test(row[column]))
        refuse(`menu_slots.${column}`);
    slotsByDay.get(row.timetable_id)!.push({
      periodId: row.period_id as string,
      startsAt: (row.starts_at as string).slice(0, 5),
      endsAt: (row.ends_at as string).slice(0, 5),
    });
  }
  for (const slots of slotsByDay.values()) {
    slots.sort((a, b) => Number(a.startsAt > b.startsAt) - Number(a.startsAt < b.startsAt));
    parsedAs("menu_slots", () => parseSlots(slots, "slots"));
  }

  const today = exportDate(bundle);
  const zone = bundle !== undefined && isReadableZone(bundle.timeZone) ? bundle.timeZone : null;
  for (const departmentId of departments) {
    const own = [...days].filter(([, day]) => day.departmentId === departmentId);
    const week = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      slots: slotsByDay.get(own.find(([, day]) => day.weekday === weekday)?.[0]) ?? [],
    }));
    parsedAs("menu_slots", () => parseMenuWeek(week));
    const special = new Map<LocalDate, ReturnType<typeof slotIntervals>>();
    for (const [id, day] of own) {
      if (day.date === null) continue;
      const slots = slotsByDay.get(id)!;
      if (zone !== null && pairMatters(day.date, today)) {
        const skipped = skippedEndpoint(day.date, [{ cell: slotCell(slots) }], zone);
        if (skipped !== null)
          refuse(`menu_slots.${skipped.end === "opensAt" ? "starts_at" : "ends_at"}`);
      }
      special.set(day.date, slotIntervals(slots));
    }
    const intervals = week.map((day) => slotIntervals(day.slots));
    if (firstMenuClash(special, intervals, [...special.keys()], today) !== null)
      refuse("menu_slots");
  }

  const zoneDepartment = new Map(
    (tables.zone_service_policies ?? []).map((row) => [row.zone_id, row.department_id]),
  );
  for (const row of tables.zone_period_menus ?? []) {
    if (!zoneDepartment.has(row.zone_id) || zoneDepartment.get(row.zone_id) !== row.department_id)
      refuse("zone_period_menus.department_id");
    if (periodDepartment.get(row.period_id) !== row.department_id)
      refuse("zone_period_menus.period_id");
    if (!member(row)) refuse("zone_period_menus.menu_id");
  }
}

function validateDepartmentTransfers(tables: Tables): void {
  const departments = ids(tables.departments);
  const profiles = ids(tables.device_profiles);
  const desks = new Set<unknown>();
  for (const row of tables.department_transfer_desks ?? []) {
    if (!departments.has(row.department_id)) refuse("department_transfer_desks.department_id");
    if (!profiles.has(row.receiving_profile_id))
      refuse("department_transfer_desks.receiving_profile_id");
    if (desks.has(row.department_id)) refuse("department_transfer_desks");
    desks.add(row.department_id);
  }
  const directions = new Map<unknown, Set<unknown>>();
  for (const row of tables.department_transfer_destinations ?? []) {
    if (!departments.has(row.source_department_id))
      refuse("department_transfer_destinations.source_department_id");
    if (
      !departments.has(row.destination_department_id) ||
      row.destination_department_id === row.source_department_id
    )
      refuse("department_transfer_destinations.destination_department_id");
    const destinations = directions.get(row.source_department_id) ?? new Set<unknown>();
    if (destinations.has(row.destination_department_id)) refuse("department_transfer_destinations");
    destinations.add(row.destination_department_id);
    directions.set(row.source_department_id, destinations);
  }
}

/**
 * Refuses (`setup.request_invalid`, `field` naming `routing_cells.<column>`) routing cells a save
 * could not have written: a bad coordinate or target shape, the All categories × Every zone cell, a
 * second cell at one coordinate, a variant or a product, category, zone or station the bundle does
 * not hold, and a zone that is switched off or has no service configuration. A zone whose
 * department is switched off is not refused.
 */
export function validateRoutingConfiguration(tables: Tables): void {
  const categories = ids(tables.categories);
  const products = new Set(
    (tables.products ?? []).filter((row) => (row.parent_id ?? null) === null).map((row) => row.id),
  );
  const stations = ids(tables.kitchen_stations);
  const configured = new Set((tables.zone_service_policies ?? []).map((row) => row.zone_id));
  const zones = new Set(
    (tables.floor_zones ?? [])
      .filter((row) => row.active === 1 && configured.has(row.id))
      .map((row) => row.id),
  );
  const taken = new Set<string>();
  for (const row of tables.routing_cells ?? []) {
    const category = row.category_id ?? null;
    const product = row.product_id ?? null;
    const zone = row.zone_id ?? null;
    const station = row.station_id ?? null;
    if (category !== null && product !== null) refuse("routing_cells.category_id");
    if (row.no_category !== 0 && row.no_category !== 1) refuse("routing_cells.no_category");
    const noCategory = row.no_category === 1;
    if (noCategory && (category !== null || product !== null)) refuse("routing_cells.no_category");
    if (category === null && product === null && !noCategory && zone === null)
      refuse("routing_cells.zone_id");
    if (row.no_preparation !== 0 && row.no_preparation !== 1)
      refuse("routing_cells.no_preparation");
    if ((station === null) !== (row.no_preparation === 1)) refuse("routing_cells.station_id");
    if (category !== null && !categories.has(category)) refuse("routing_cells.category_id");
    if (product !== null && !products.has(product)) refuse("routing_cells.product_id");
    if (zone !== null && !zones.has(zone)) refuse("routing_cells.zone_id");
    if (station !== null && !stations.has(station)) refuse("routing_cells.station_id");
    const subject =
      category !== null
        ? "category_id"
        : product !== null
          ? "product_id"
          : noCategory
            ? "no_category"
            : "zone_id";
    const key = JSON.stringify([subject, category ?? product, zone]);
    if (taken.has(key)) refuse(`routing_cells.${subject}`);
    taken.add(key);
  }
}

function validateVenueServiceConfiguration(
  tables: Tables,
  bundle?: { readonly createdAt: Date; readonly timeZone: string },
): void {
  validateHoursConfiguration(tables, bundle);
  validateHolidayConfiguration(tables);
  validateDepartmentMenus(tables);
  validateMenuTimetables(tables, bundle);
  validateDepartmentTransfers(tables);
  validateRoutingConfiguration(tables);
}

export const VENUE_SERVICE_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "departments", locationColumns: ["location_id"] },
    { name: "department_sale_policies" },
    { name: "zone_service_policies", locationColumns: ["location_id"] },
    { name: "zone_sale_policies" },
    { name: "department_menus" },
    { name: "department_all_day_menus" },
    { name: "zone_all_day_menus" },
    { name: "device_profile_service_access" },
    { name: "device_profile_zones" },
    { name: "device_profile_stations" },
    { name: "device_profile_watchers" },
    { name: "department_transfer_desks" },
    { name: "department_transfer_destinations" },
    { name: "station_fallbacks" },
    { name: "routing_cells", locationColumns: ["location_id"] },
    { name: "service_settings" },
    { name: "hours_week_cells" },
    { name: "hours_week_periods" },
    { name: "special_dates", locationColumns: ["location_id"] },
    { name: "menu_periods" },
    { name: "menu_day_timetables" },
    { name: "menu_slots" },
    { name: "zone_period_menus" },
    { name: "special_date_hours" },
    { name: "special_date_hours_periods" },
    { name: "holiday_geographies", locationColumns: ["location_id"] },
    { name: "local_holidays" },
  ],
  validate: validateVenueServiceConfiguration,
} as const;
