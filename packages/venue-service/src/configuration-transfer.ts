import { getCountryPack } from "@waitron/country-packs";
import { civilDateOf } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import { holidayCityKey } from "./holiday-rules.js";
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
import { isReadableClock, isReadableZone, skippedEndpoint } from "./hours-clock.js";
import { occursOn, repeatKey } from "./named-day-rules.js";
import { menuPeriodName } from "./menu-timetable-rules.js";
import { findScheduleEndOffsetClash, parseEndOffsetMinutes } from "./period-end-offset.js";
import { calendarDateOfTime, parseClosedRanges, parseServiceDay } from "./service-day.js";
import { localTimeOccurrences } from "./hours-occurrences.js";
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
      (error.code === "hours.invalid" ||
        error.code === "menu_timetable.invalid" ||
        error.code === "menu_period.invalid" ||
        error.code === "zone_closed_time.invalid")
    )
      refuse(table);
    throw error;
  }
}

function ids(rows: readonly Row[] | undefined): Set<unknown> {
  return new Set((rows ?? []).map((row) => row.id));
}

/** A row's name as `{ [key]: name }`, or nothing when the bundle's row holds no non-empty text. */
function nameOf<K extends string>(key: K, row: Row | undefined): { [P in K]?: string } {
  const name = row?.name;
  return (typeof name === "string" && name !== "" ? { [key]: name } : {}) as { [P in K]?: string };
}

/**
 * Whether a row will be stored switched on. A row without the flag takes the column's default, on;
 * any value but 0 or 1 is refused.
 */
function isActive(row: Row, table: string): boolean {
  if (row.active === undefined) return true;
  if (row.active !== 0 && row.active !== 1) refuse(`${table}.active`);
  return row.active === 1;
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

function ownerKey(row: Row, table: string, stations: Set<unknown>): string {
  if (row.department_id !== undefined && row.department_id !== null)
    refuse(`${table}.department_id`);
  const station = row.station_id;
  if (station === undefined || station === null || !stations.has(station))
    refuse(`${table}.station_id`);
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

/** Retained default-station cells travel but do not constrain its opening times. */
export function validateHoursConfiguration(
  tables: Tables,
  bundle?: { readonly createdAt: Date; readonly timeZone: string },
): void {
  const stations = ids(tables.kitchen_stations);

  const weekCells = tables.hours_week_cells ?? [];
  const weekPeriods = periodsByCell(
    tables.hours_week_periods,
    "hours_week_periods",
    ids(weekCells),
  );
  const weeks = new Map<string, { weekday: number; cell: unknown }[]>();
  for (const row of weekCells) {
    const key = ownerKey(row, "hours_week_cells", stations);
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
  const taken: { locationId: unknown; date: LocalDate; repeats: boolean }[] = [];
  for (const row of tables.special_dates ?? []) {
    if (!isLocalDate(row.date)) refuse("special_dates.date");
    if (
      row.repeat_on !== undefined &&
      row.repeat_on !== null &&
      row.repeat_on !== repeatKey(row.date)
    )
      refuse("special_dates.repeat_on");
    if (row.own_hours !== undefined && row.own_hours !== 0 && row.own_hours !== 1)
      refuse("special_dates.own_hours");
    const repeats = row.repeat_on !== undefined && row.repeat_on !== null;
    const rule = { date: row.date, repeats };
    for (const other of taken)
      if (
        other.locationId === row.location_id &&
        ((repeats && other.repeats && repeatKey(rule.date) === repeatKey(other.date)) ||
          occursOn(other, rule.date) ||
          occursOn(rule, other.date))
      )
        refuse("special_dates.date");
    taken.push({ locationId: row.location_id, ...rule });
    if (typeof row.name !== "string" || row.name.trim() === "") refuse("special_dates.name");
    if (row.close_whole_venue !== 0 && row.close_whole_venue !== 1)
      refuse("special_dates.close_whole_venue");
    parsedAs("special_dates", () =>
      parseSpecialDateInput({
        date: row.date,
        name: row.name,
        kind: row.kind,
        repeats,
        ownHours: row.own_hours === 1,
        closeWholeVenue: row.close_whole_venue === 1,
        cells: [],
      }),
    );
    if (row.own_hours === 1 && row.close_whole_venue === 1) refuse("special_dates");
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
    const key = ownerKey(row, "special_date_hours", stations);
    const cells = cellsByDate.get(row.special_date_id) ?? [];
    if (cells.some((cell) => cell.key === key)) refuse("special_date_hours.station_id");
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
    if (row.repeat_on !== undefined && row.repeat_on !== null && cells.length > 0)
      refuse("special_date_hours");
    const input = parsedAs("special_date_hours", () =>
      parseSpecialDateInput({
        date,
        name: row.name,
        kind: row.kind,
        repeats: row.repeat_on !== undefined && row.repeat_on !== null,
        ownHours: row.own_hours === 1,
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

  const subjects = [...stations]
    .filter((id) => !defaults.has(id))
    .map((id) => `station:${id as string}`);
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
  const geographyIds = new Set<unknown>();
  const places = new Set<string>();
  for (const row of tables.holiday_geographies ?? []) {
    if (typeof row.id !== "string" || geographyIds.has(row.id)) refuse("holiday_geographies.id");
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
    geographyIds.add(row.id);
  }
}

export function validateMenuTimetables(
  tables: Tables,
  bundle?: { readonly createdAt: Date; readonly timeZone: string; readonly dayCutover: string },
): void {
  const departments = ids(tables.departments);
  const menus = ids(tables.catalogues);
  const periodDepartment = new Map<unknown, unknown>();
  const customerMenus = new Map<unknown, unknown>();
  const names = new Set<string>();
  for (const row of tables.menu_periods ?? []) {
    if (!departments.has(row.department_id)) refuse("menu_periods.department_id");
    if (parsedAs("menu_periods.name", () => menuPeriodName(row.name)) !== row.name)
      refuse("menu_periods.name");
    const name = JSON.stringify([row.department_id, row.name]);
    if (names.has(name)) refuse("menu_periods.name");
    names.add(name);
    if (!CALENDAR_COLOURS.includes(row.colour as CalendarColour)) refuse("menu_periods.colour");
    if (!menus.has(row.menu_id)) refuse("menu_periods.menu_id");
    parsedAs("menu_periods.end_offset_minutes", () =>
      parseEndOffsetMinutes(row.end_offset_minutes === undefined ? 0 : row.end_offset_minutes),
    );
    periodDepartment.set(row.id, row.department_id);
    customerMenus.set(row.id, row.menu_id);
  }
  const staffMenus = new Set<string>();
  for (const row of tables.menu_period_staff_menus ?? []) {
    if (!periodDepartment.has(row.period_id)) refuse("menu_period_staff_menus.period_id");
    if (periodDepartment.get(row.period_id) !== row.department_id)
      refuse("menu_period_staff_menus.department_id");
    const key = JSON.stringify([row.period_id, row.menu_id]);
    if (
      !menus.has(row.menu_id) ||
      customerMenus.get(row.period_id) === row.menu_id ||
      staffMenus.has(key)
    )
      refuse("menu_period_staff_menus.menu_id");
    staffMenus.add(key);
    if (
      typeof row.display_order !== "number" ||
      !Number.isInteger(row.display_order) ||
      row.display_order < 0
    )
      refuse("menu_period_staff_menus.display_order");
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
  if ((tables.menu_slots ?? []).length === 0) return;
  if (bundle === undefined || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(bundle.dayCutover))
    refuse("menu_slots");
  for (const [id, slots] of slotsByDay) {
    const parsed = parsedAs("menu_slots", () => parseServiceDay(slots, "slots", bundle.dayCutover));
    const date = days.get(id)!.date;
    if (date === null || !isReadableClock(bundle)) continue;
    for (const slot of parsed)
      for (const end of ["startsAt", "endsAt"] as const) {
        // The exclusive end at changeover belongs to the next calendar morning.
        const calendarDate =
          end === "endsAt" && slot[end] === bundle.dayCutover
            ? addDays(date, 1)
            : (calendarDateOfTime(date, slot[end], bundle.dayCutover) as LocalDate);
        if (localTimeOccurrences(calendarDate, slot[end], bundle.timeZone).length === 0)
          refuse(`menu_slots.${end === "startsAt" ? "starts_at" : "ends_at"}`);
      }
  }
  const offsets = new Map(
    (tables.menu_periods ?? []).map((row) => [
      row.id as string,
      (row.end_offset_minutes ?? 0) as number,
    ]),
  );
  const calendar = (tables.special_dates ?? []).map((row) => ({
    date: row.date as string,
    closeWholeVenue: row.close_whole_venue === 1,
  }));
  for (const departmentId of departments) {
    const schedule = [...days]
      .filter(([, day]) => day.departmentId === departmentId)
      .map(([id, day]) => ({ weekday: day.weekday, date: day.date, slots: slotsByDay.get(id)! }));
    if (findScheduleEndOffsetClash(schedule, calendar, offsets, bundle.dayCutover) !== null)
      refuse("menu_slots");
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
 * Refuses (`setup.request_invalid`) a zone whose `active` flag is not 0 or 1 (`field`
 * `floor_zones.active`), and routing cells a save could not have written (`field` naming
 * `routing_cells.<column>`, or `departments.active` when the department of a cell's zone holds a
 * flag that is not 0 or 1): a bad coordinate or target shape, the All categories × Every zone cell, a
 * second cell at one coordinate, a variant or a product, category, zone or station the bundle does
 * not hold, and a zone that is switched off or has no service configuration. A zone whose
 * department is switched off is refused with the grid's own `service_zone.not_found`, its params
 * carrying the zone and department ids, the row, and each name the export holds as non-empty text.
 * A cell's period choice is refused (`routing_cell_periods.<column>`) for a cell, period or station
 * the bundle does not hold, a department that is not the period's, a zone cell's period of any
 * department but its zone's, a second choice for one cell and period, and a bad target.
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
      .filter((row) => isActive(row, "floor_zones") && configured.has(row.id))
      .map((row) => row.id),
  );
  const named = (rows: readonly Row[] | undefined) =>
    new Map((rows ?? []).map((row) => [row.id, row]));
  const zoneRows = named(tables.floor_zones);
  const departmentRows = named(tables.departments);
  const categoryRows = named(tables.categories);
  const productRows = named(tables.products);
  const zoneDepartment = new Map(
    (tables.zone_service_policies ?? []).map((row) => [row.zone_id, row.department_id]),
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
    const departmentId = zoneDepartment.get(zone);
    const department = departmentRows.get(departmentId);
    if (department === undefined || isActive(department, "departments")) continue;
    throw new AppError("service_zone.not_found", {
      zoneId: String(zone),
      ...nameOf("zoneName", zoneRows.get(zone)),
      departmentId: String(departmentId),
      ...nameOf("departmentName", department),
      ...(category !== null
        ? { row: "category" as const, ...nameOf("name", categoryRows.get(category)) }
        : product !== null
          ? { row: "product" as const, ...nameOf("name", productRows.get(product)) }
          : { row: noCategory ? ("no_category" as const) : ("all" as const) }),
    });
  }
  validateRoutingCellPeriods(tables, stations, zoneDepartment);
}

/**
 * Does not ask whether the period's menus hold any of the cell's products: a line saved before its
 * period's menus changed stays valid, so refusing it would make a good export unimportable.
 */
function validateRoutingCellPeriods(
  tables: Tables,
  stations: Set<unknown>,
  zoneDepartment: Map<unknown, unknown>,
): void {
  const cellZone = new Map(
    (tables.routing_cells ?? []).map((row) => [row.id, row.zone_id ?? null]),
  );
  const periodDepartment = new Map(
    (tables.menu_periods ?? []).map((row) => [row.id, row.department_id]),
  );
  const taken = new Set<string>();
  for (const row of tables.routing_cell_periods ?? []) {
    if (!cellZone.has(row.cell_id)) refuse("routing_cell_periods.cell_id");
    if (!periodDepartment.has(row.period_id)) refuse("routing_cell_periods.period_id");
    const department = periodDepartment.get(row.period_id);
    if (row.department_id !== department) refuse("routing_cell_periods.department_id");
    const zone = cellZone.get(row.cell_id);
    if (zone !== null && zoneDepartment.get(zone) !== department)
      refuse("routing_cell_periods.period_id");
    const key = JSON.stringify([row.cell_id, row.period_id]);
    if (taken.has(key)) refuse("routing_cell_periods.period_id");
    taken.add(key);
    if (row.no_preparation !== 0 && row.no_preparation !== 1)
      refuse("routing_cell_periods.no_preparation");
    const station = row.station_id ?? null;
    if ((station === null) !== (row.no_preparation === 1))
      refuse("routing_cell_periods.station_id");
    if (station !== null && !stations.has(station)) refuse("routing_cell_periods.station_id");
  }
}

/**
 * Refuses (`zone.department_inactive`) a switched-on zone whose department the bundle holds switched
 * off, which no save produces: switching a department off switches its zones off. A department a
 * zone belongs to whose `active` flag is not 0 or 1 is refused (`setup.request_invalid`,
 * `departments.active`).
 */
function validateZoneDepartments(tables: Tables): void {
  const zones = new Map((tables.floor_zones ?? []).map((row) => [row.id, row]));
  const departments = new Map((tables.departments ?? []).map((row) => [row.id, row]));
  for (const policy of tables.zone_service_policies ?? []) {
    const zone = zones.get(policy.zone_id);
    const department = departments.get(policy.department_id);
    const zoneOn = zone !== undefined && isActive(zone, "floor_zones");
    if (department === undefined || isActive(department, "departments") || !zoneOn) continue;
    throw new AppError("zone.department_inactive", {
      zoneId: String(policy.zone_id),
      ...nameOf("zoneName", zone),
      departmentId: String(policy.department_id),
      ...nameOf("departmentName", department),
    });
  }
}

function validateZoneClosedTimes(tables: Tables, bundle?: { readonly dayCutover: string }): void {
  const rows = tables.zone_closed_times ?? [];
  if (rows.length === 0) return;
  if (bundle === undefined || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(bundle.dayCutover))
    refuse("zone_closed_times");
  const zones = ids(tables.floor_zones);
  const configured = new Set((tables.zone_service_policies ?? []).map((row) => row.zone_id));
  const days = new Map((tables.special_dates ?? []).map((row) => [row.id, row]));
  const groups = new Map<string, { startsAt: string; endsAt: string }[]>();
  for (const row of rows) {
    if (!zones.has(row.zone_id) || !configured.has(row.zone_id))
      refuse("zone_closed_times.zone_id");
    const weekday = row.weekday;
    const day = row.special_date_id;
    if ((weekday === null) === (day === null)) refuse("zone_closed_times");
    if (
      weekday !== null &&
      (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
    )
      refuse("zone_closed_times.weekday");
    if (day !== null && days.get(day)?.own_hours !== 1) refuse("zone_closed_times.special_date_id");
    for (const column of ["starts_at", "ends_at"] as const) {
      if (typeof row[column] !== "string" || !STORED_TIME.test(row[column]))
        refuse(`zone_closed_times.${column}`);
    }
    const key = JSON.stringify([row.zone_id, weekday, day]);
    const ranges = groups.get(key) ?? [];
    ranges.push({
      startsAt: (row.starts_at as string).slice(0, 5),
      endsAt: (row.ends_at as string).slice(0, 5),
    });
    groups.set(key, ranges);
  }
  for (const ranges of groups.values())
    parsedAs("zone_closed_times", () => parseClosedRanges(ranges, "ranges", bundle.dayCutover));
}

function validateReceiptModes(tables: Tables): void {
  for (const table of ["department_sale_policies", "zone_sale_policies"] as const) {
    for (const row of tables[table] ?? []) {
      const value = row.receipt_print_mode;
      if (value === undefined || (table === "zone_sale_policies" && value === null)) continue;
      if (typeof value !== "string" || (value !== "auto" && value !== "on_request"))
        refuse(`${table}.receipt_print_mode`);
    }
  }
}

function validateOrderStarts(tables: Tables): void {
  for (const table of ["department_sale_policies", "zone_sale_policies"] as const) {
    for (const row of tables[table] ?? []) {
      const value = row.order_start;
      if (value === undefined || (table === "zone_sale_policies" && value === null)) continue;
      if (typeof value !== "string" || (value !== "table" && value !== "counter"))
        refuse(`${table}.order_start`);
    }
  }
}

function validateVenueServiceConfiguration(
  tables: Tables,
  bundle?: { readonly createdAt: Date; readonly timeZone: string; readonly dayCutover: string },
): void {
  validateReceiptModes(tables);
  validateOrderStarts(tables);
  validateHoursConfiguration(tables, bundle);
  validateHolidayConfiguration(tables);
  validateMenuTimetables(tables, bundle);
  validateZoneClosedTimes(tables, bundle);
  validateDepartmentTransfers(tables);
  validateRoutingConfiguration(tables);
  // After the routing check, whose refusal of such a zone's cell also names the cell's row.
  validateZoneDepartments(tables);
}

export const VENUE_SERVICE_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "departments", locationColumns: ["location_id"] },
    { name: "department_sale_policies" },
    { name: "zone_service_policies", locationColumns: ["location_id"] },
    { name: "zone_sale_policies" },
    { name: "device_profile_service_access" },
    { name: "device_profile_zones" },
    { name: "device_profile_kitchen_screens" },
    { name: "device_profile_kitchen_screen_stations" },
    { name: "device_profile_kitchen_screen_zones" },
    { name: "department_transfer_desks" },
    { name: "department_transfer_destinations" },
    { name: "station_fallbacks" },
    { name: "routing_cells", locationColumns: ["location_id"] },
    { name: "service_settings" },
    { name: "hours_week_cells" },
    { name: "hours_week_periods" },
    { name: "special_dates", locationColumns: ["location_id"] },
    { name: "menu_periods" },
    { name: "menu_period_staff_menus" },
    { name: "menu_day_timetables" },
    { name: "menu_slots" },
    { name: "routing_cell_periods" },
    { name: "special_date_hours" },
    { name: "zone_closed_times" },
    { name: "special_date_hours_periods" },
    { name: "holiday_geographies", locationColumns: ["location_id"] },
  ],
  validate: validateVenueServiceConfiguration,
} as const;
