import { sql } from "drizzle-orm";
import { serviceStepOrder } from "./service-steps.js";
import { getCountryPack } from "@waitron/country-packs";
import { AppError, DINING_POLICIES, DININGS } from "@waitron/shared";
import type { PackLookup } from "./holidays.js";
import { isLocalDate } from "./hours-rules.js";
import { CALENDAR_COLOURS, type CalendarColour, type LocalDate } from "./hours-types.js";
import { isReadableClock } from "./hours-clock.js";
import { menuPeriodName } from "./menu-timetable-rules.js";
import type { PaintRange } from "./day-paint.js";
import { civilDateOf } from "@waitron/reporting";
import { SERVICE_STEP_STARTS, ZONE_PAINT_KINDS, type Transaction } from "@waitron/db";
import { MAX_SERVICE_STEP_MINUTES, MAX_SERVICE_STEPS } from "./service-step-limits.js";
import { parseSeasonStart } from "./season-rules.js";
import { NO_HOLIDAY_DATES, sharedSpecialDate } from "./repeat-rules.js";
import { firstSkippedEnd } from "./special-days.js";
import {
  parseClosedRanges,
  parseServiceDay,
  type ClosedRange,
  type ServiceRange,
} from "./service-day.js";
import "./errors.js";

type Row = Record<string, unknown>;
type Tables = Readonly<Record<string, readonly Row[]>>;

const STORED_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d:00$/;
const CUTOVER = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

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
      (error.code === "menu_timetable.invalid" || error.code === "zone_closed_time.invalid")
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

export function validateHolidayConfiguration(
  area: Readonly<Record<string, unknown>> | null | undefined,
  findPack: PackLookup = getCountryPack,
): void {
  if (area === null || area === undefined) return;
  const pack = typeof area.country === "string" ? findPack(area.country) : undefined;
  if (pack === undefined || pack.countryCode !== area.country) refuse("holidayArea.country");
  const province = area.provinceCode;
  if (!pack.administrativeAreas.some(({ code }) => code === province))
    refuse("holidayArea.provinceCode");
  if (
    area.areaKey !== null &&
    !(pack.holidayCalendar?.areasForProvince(province as string) ?? []).some(
      ({ key }) => key === area.areaKey,
    )
  )
    refuse("holidayArea.areaKey");
}

export function validateMenuTimetables(tables: Tables): void {
  const departments = ids(tables.departments);
  const ordinaryMenuIds = ids(tables.menus?.filter((row) => row.kind !== "set_menu"));
  const setDepartment = new Map<unknown, unknown>();
  const setNames = new Set<string>();
  const defaults = new Map<unknown, number>();
  for (const row of tables.floor_plan_sets ?? []) {
    if (!departments.has(row.department_id)) refuse("floor_plan_sets.department_id");
    const name = JSON.stringify([row.department_id, row.name]);
    if (setNames.has(name)) refuse("floor_plan_sets.name");
    setNames.add(name);
    defaults.set(
      row.department_id,
      (defaults.get(row.department_id) ?? 0) + (row.is_default === 1 ? 1 : 0),
    );
    setDepartment.set(row.id, row.department_id);
  }
  if ([...defaults.values()].some((count) => count !== 1)) refuse("floor_plan_sets.is_default");
  const names = new Set<string>();
  for (const row of tables.menu_periods ?? []) {
    if (!departments.has(row.department_id)) refuse("menu_periods.department_id");
    const setId = row.floor_plan_set_id ?? null;
    if (setId !== null && setDepartment.get(setId) !== row.department_id)
      refuse("menu_periods.floor_plan_set_id");
    if (parsedAs("menu_periods.name", () => menuPeriodName(row.name)) !== row.name)
      refuse("menu_periods.name");
    const name = JSON.stringify([row.department_id, row.name]);
    if (names.has(name)) refuse("menu_periods.name");
    names.add(name);
    if (!CALENDAR_COLOURS.includes(row.colour as CalendarColour)) refuse("menu_periods.colour");
    if (!ordinaryMenuIds.has(row.menu_id)) refuse("menu_periods.menu_id");
    const field = "menu_periods.staff_menu_ids";
    if (typeof row.staff_menu_ids !== "string") refuse(field);
    let staff: unknown;
    try {
      staff = JSON.parse(row.staff_menu_ids);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      refuse(field);
    }
    if (
      !Array.isArray(staff) ||
      staff.some(
        (id) => typeof id !== "string" || !ordinaryMenuIds.has(id) || id === row.menu_id,
      ) ||
      new Set(staff).size !== staff.length
    )
      refuse(field);
  }
}

interface ImportedSpecialDate {
  date: LocalDate;
  repeats: boolean;
  holidayName: string | null;
  closedAllDay: boolean;
}

/** The bundle's special-day dates by id, refusing what `saveSpecialDay` could not have stored and
 *  two dates that would stand on one day. The bundle carries no holiday
 *  lists, so a date following a holiday's name is compared in its first year only. */
function validateSpecialDays(tables: Tables): Map<unknown, ImportedSpecialDate> {
  const repeats = new Map<unknown, boolean>();
  for (const row of tables.special_days ?? []) {
    if (typeof row.name !== "string" || row.name === "" || row.name.trim() !== row.name)
      refuse("special_days.name");
    const flag = row.repeats_yearly === undefined ? 0 : row.repeats_yearly;
    if (flag !== 0 && flag !== 1) refuse("special_days.repeats_yearly");
    repeats.set(row.id, flag === 1);
  }
  const dates = new Map<unknown, ImportedSpecialDate>();
  // Every special-day date lands at the importing venue.
  const placed: { date: LocalDate; repeats: boolean; holidayName: string | null }[] = [];
  for (const row of tables.special_day_dates ?? []) {
    if (!repeats.has(row.special_day_id)) refuse("special_day_dates.special_day_id");
    if (!isLocalDate(row.date)) refuse("special_day_dates.date");
    const closed = row.closed_all_day === undefined ? 0 : row.closed_all_day;
    if (closed !== 0 && closed !== 1) refuse("special_day_dates.closed_all_day");
    const holidayName = row.holiday_name ?? null;
    if (holidayName !== null && (typeof holidayName !== "string" || holidayName.trim() === ""))
      refuse("special_day_dates.holiday_name");
    const rule = { date: row.date, repeats: repeats.get(row.special_day_id)!, holidayName };
    if (placed.some((other) => sharedSpecialDate(rule, other, NO_HOLIDAY_DATES) !== null))
      refuse("special_day_dates.date");
    placed.push(rule);
    dates.set(row.id, { ...rule, closedAllDay: closed === 1 });
  }
  return dates;
}

const rangeDayKey = (row: Row, owner: string) =>
  JSON.stringify([
    row[owner],
    row.season_id ?? null,
    row.weekday ?? null,
    row.special_day_date_id ?? null,
  ]);

type DayRows = Map<unknown, { ownerId: unknown; seasonId: unknown; weekday: number }>;

/**
 * A day's rows group by (owner, season, weekday), or by (owner, special-day date) with neither
 * season nor weekday.
 */
function dayRows(
  rows: readonly Row[] | undefined,
  table: string,
  owner: string,
  owners: Set<unknown>,
  seasonIds: Set<unknown>,
  specialDates: ReadonlyMap<unknown, ImportedSpecialDate>,
  ranges = false,
): { seasonDays: DayRows; specialDays: Map<unknown, { ownerId: unknown; dateId: unknown }> } {
  const seasonDays: DayRows = new Map();
  const specialDays = new Map<unknown, { ownerId: unknown; dateId: unknown }>();
  const held = new Set<string>();
  for (const row of rows ?? []) {
    if (!owners.has(row[owner])) refuse(`${table}.${owner}`);
    const dateId = row.special_day_date_id ?? null;
    if (dateId !== null) {
      if (!specialDates.has(dateId)) refuse(`${table}.special_day_date_id`);
      if ((row.season_id ?? null) !== null) refuse(`${table}.season_id`);
      if ((row.weekday ?? null) !== null) refuse(`${table}.weekday`);
      const key = JSON.stringify([row[owner], dateId]);
      if (!ranges && held.has(key)) refuse(`${table}.special_day_date_id`);
      held.add(key);
      specialDays.set(ranges ? rangeDayKey(row, owner) : row.id, { ownerId: row[owner], dateId });
      continue;
    }
    if (!seasonIds.has(row.season_id)) refuse(`${table}.season_id`);
    const weekday = row.weekday;
    if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
      refuse(`${table}.weekday`);
    const key = JSON.stringify([row[owner], row.season_id, weekday]);
    if (!ranges && held.has(key)) refuse(`${table}.weekday`);
    held.add(key);
    seasonDays.set(ranges ? rangeDayKey(row, owner) : row.id, {
      ownerId: row[owner],
      seasonId: row.season_id,
      weekday,
    });
  }
  return { seasonDays, specialDays };
}

function storedRange(row: Row, table: string): { startsAt: string; endsAt: string } {
  for (const column of ["starts_at", "ends_at"])
    if (typeof row[column] !== "string" || !STORED_TIME.test(row[column]))
      refuse(`${table}.${column}`);
  return {
    startsAt: (row.starts_at as string).slice(0, 5),
    endsAt: (row.ends_at as string).slice(0, 5),
  };
}

type ImportClock = {
  readonly createdAt?: Date;
  readonly timeZone?: string;
  readonly dayCutover: string;
};

export function validateSeasonWeeks(tables: Tables, bundle?: ImportClock): void {
  const seasonIds = new Set<unknown>();
  const starts = new Set<unknown>();
  const names = new Set<unknown>();
  for (const row of tables.seasons ?? []) {
    if (
      typeof row.name !== "string" ||
      row.name === "" ||
      row.name.trim() !== row.name ||
      names.has(row.name)
    )
      refuse("seasons.name");
    if (parseSeasonStart(row.starts_on) === null || starts.has(row.starts_on))
      refuse("seasons.starts_on");
    if (!CALENDAR_COLOURS.includes(row.colour as CalendarColour)) refuse("seasons.colour");
    names.add(row.name);
    starts.add(row.starts_on);
    seasonIds.add(row.id);
  }
  const specialDates = validateSpecialDays(tables);
  const hours = tables.opening_hours ?? [];
  for (const row of hours)
    if (((row.department_id ?? null) === null) === ((row.zone_id ?? null) === null))
      refuse("opening_hours.department_id");
  const departmentRanges = hours.filter((row) => (row.department_id ?? null) !== null);
  const zoneRanges = hours.filter((row) => (row.zone_id ?? null) !== null);
  const departmentKeys = dayRows(
    departmentRanges,
    "opening_hours",
    "department_id",
    ids(tables.departments),
    seasonIds,
    specialDates,
    true,
  );
  const zoneKeys = dayRows(
    zoneRanges,
    "opening_hours",
    "zone_id",
    ids(tables.floor_zones),
    seasonIds,
    specialDates,
    true,
  );
  if (hours.length === 0) return;
  if (bundle === undefined || !CUTOVER.test(bundle.dayCutover)) refuse("opening_hours");

  const periodDepartment = new Map(
    (tables.menu_periods ?? []).map((row) => [row.id, row.department_id]),
  );
  const departmentWeeks = new Map<unknown, ServiceRange[]>(
    [...departmentKeys.seasonDays.keys()].map((id) => [id, []]),
  );
  const departmentPaint = new Map<unknown, PaintRange[]>(
    [...departmentKeys.specialDays.keys()].map((id) => [id, []]),
  );
  for (const row of departmentRanges) {
    const day =
      departmentKeys.seasonDays.get(rangeDayKey(row, "department_id")) ??
      departmentKeys.specialDays.get(rangeDayKey(row, "department_id"));
    const paint = departmentPaint.get(rangeDayKey(row, "department_id"));
    // Closed (a null period) belongs to a special-day date only.
    if (
      !(paint !== undefined && row.period_id === null) &&
      (typeof row.period_id !== "string" || periodDepartment.get(row.period_id) !== day!.ownerId)
    )
      refuse("opening_hours.period_id");
    if (row.kind !== (row.period_id === null ? "closed" : "period")) refuse("opening_hours.kind");
    const stored = storedRange(row, "opening_hours");
    if (paint !== undefined) paint.push({ periodId: row.period_id as string | null, ...stored });
    else
      departmentWeeks
        .get(rangeDayKey(row, "department_id"))!
        .push({ periodId: row.period_id as string, ...stored });
  }
  const zoneWeeks = new Map<unknown, ClosedRange[]>(
    [...zoneKeys.seasonDays.keys()].map((id) => [id, []]),
  );
  const zonePaint = new Map<unknown, ClosedRange[]>(
    [...zoneKeys.specialDays.keys()].map((id) => [id, []]),
  );
  for (const row of zoneRanges) {
    if ((row.period_id ?? null) !== null) refuse("opening_hours.period_id");
    const dayId = rangeDayKey(row, "zone_id");
    const paint = zonePaint.get(dayId);
    // "open" belongs to a special-day date only; an export always carries the not-null column.
    if (
      !(paint !== undefined && ZONE_PAINT_KINDS.includes(row.kind as never)) &&
      row.kind !== "closed"
    )
      refuse("opening_hours.kind");
    const stored = storedRange(row, "opening_hours");
    (paint ?? zoneWeeks.get(dayId)!).push(stored);
  }
  for (const ranges of departmentWeeks.values())
    parsedAs("opening_hours", () => parseServiceDay(ranges, "slots", bundle.dayCutover));
  for (const ranges of [...zoneWeeks.values(), ...zonePaint.values()])
    parsedAs("opening_hours", () => parseClosedRanges(ranges, "ranges", bundle.dayCutover));
  for (const ranges of departmentPaint.values())
    parsedAs("opening_hours", () =>
      parseClosedRanges(
        ranges.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
        "ranges",
        bundle.dayCutover,
      ),
    );
  refuseSkippedPaint(
    departmentKeys.specialDays,
    departmentPaint,
    specialDates,
    bundle,
    "opening_hours",
  );
  refuseSkippedPaint(zoneKeys.specialDays, zonePaint, specialDates, bundle, "opening_hours");
}

/** Refuses special-day paint at a time the clocks skip on its business day; a repeating date is
 *  checked at its next occurrence from the venue's date when the bundle was made. */
function refuseSkippedPaint(
  days: ReadonlyMap<unknown, { dateId: unknown }>,
  paint: ReadonlyMap<unknown, readonly ClosedRange[]>,
  dates: ReadonlyMap<unknown, ImportedSpecialDate>,
  bundle: ImportClock,
  table: string,
): void {
  const { createdAt, timeZone } = bundle;
  if (
    createdAt === undefined ||
    timeZone === undefined ||
    !isReadableClock({ timeZone, dayCutover: bundle.dayCutover })
  )
    return;
  const clock = { timeZone, dayCutover: bundle.dayCutover, cutoverChanges: [] };
  const from = civilDateOf(createdAt, timeZone) as LocalDate;
  for (const [dayId, ranges] of paint)
    if (
      firstSkippedEnd(
        clock,
        dates.get(days.get(dayId)!.dateId)!,
        from,
        ranges,
        NO_HOLIDAY_DATES,
      ) !== null
    )
      refuse(table);
}

function validateDepartmentTransfers(tables: Tables): void {
  const departments = ids(tables.departments);
  const profiles = ids(tables.device_profiles);
  for (const row of tables.departments ?? []) {
    if (row.transfer_desk_profile_id != null && !profiles.has(row.transfer_desk_profile_id))
      refuse("departments.transfer_desk_profile_id");
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

export function validateRoutingConfiguration(tables: Tables): void {
  const categories = ids(tables.categories);
  const products = new Set(
    (tables.products ?? []).filter((row) => (row.parent_id ?? null) === null).map((row) => row.id),
  );
  const stations = ids(tables.kitchen_stations);
  const zones = new Set(
    (tables.floor_zones ?? []).filter((row) => isActive(row, "floor_zones")).map((row) => row.id),
  );
  const named = (rows: readonly Row[] | undefined) =>
    new Map((rows ?? []).map((row) => [row.id, row]));
  const zoneRows = named(tables.floor_zones);
  const departmentRows = named(tables.departments);
  const categoryRows = named(tables.categories);
  const productRows = named(tables.products);
  const zoneDepartment = new Map(
    (tables.floor_zones ?? []).map((row) => [row.id, row.department_id]),
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

function validateServiceHierarchy(tables: Tables): void {
  for (const table of ["floor_zones", "departments"])
    for (const row of tables[table] ?? []) if (!isActive(row, table)) refuse(`${table}.active`);
  const departments = ids(tables.departments);
  for (const row of tables.floor_zones ?? [])
    if (!departments.has(row.department_id)) refuse("floor_zones.department_id");
}

function validateReceiptFields(tables: Tables): void {
  for (const row of tables.departments ?? []) {
    const description = row.operation_description;
    if (
      description !== undefined &&
      description !== null &&
      (typeof description !== "string" ||
        description.length > 500 ||
        Array.from(description).some(
          (character) => character < " " && !"\t\n\r".includes(character),
        ))
    )
      refuse("departments.operation_description");
    let receipt = row.receipt_text;
    if (receipt === null || receipt === undefined) continue;
    if (typeof receipt === "string") {
      try {
        receipt = JSON.parse(receipt) as unknown;
      } catch {
        refuse("departments.receipt_text");
      }
    }
    if (typeof receipt !== "object" || receipt === null || Array.isArray(receipt))
      refuse("departments.receipt_text");
    const value = receipt as Record<string, unknown>;
    if (
      Object.keys(value).some(
        (key) =>
          !["printAddress", "phone", "email", "headerSubtitle", "footerMessage"].includes(key),
      )
    )
      refuse("departments.receipt_text");
    if (value.printAddress !== undefined && typeof value.printAddress !== "boolean")
      refuse("departments.receipt_text");
  }
}

function validateOrderStarts(tables: Tables): void {
  for (const table of ["departments", "floor_zones"] as const) {
    for (const row of tables[table] ?? []) {
      const value = row.order_start;
      if (value === undefined || (table === "floor_zones" && value === null)) continue;
      if (typeof value !== "string" || (value !== "table" && value !== "counter"))
        refuse(`${table}.order_start`);
    }
  }
}

function validateDepartmentDining(tables: Tables): void {
  const choices = [
    ["dining", DINING_POLICIES],
    ["dining_starts_as", DININGS],
  ] as const;
  for (const row of tables.departments ?? []) {
    for (const [column, allowed] of choices) {
      const value = row[column];
      if (value !== undefined && !(allowed as readonly unknown[]).includes(value))
        refuse(`departments.${column}`);
    }
  }
}

function validateServiceSteps(tables: Tables): void {
  const departments = ids(tables.departments);
  const courses = ids(tables.kitchen_courses);
  const starts: readonly unknown[] = SERVICE_STEP_STARTS;
  const steps = tables.service_steps ?? [];
  const byId = new Map(steps.map((row) => [row.id, row]));
  const counts = new Map<unknown, number>();
  for (const row of tables.service_steps ?? []) {
    if (!departments.has(row.department_id)) refuse("service_steps.department_id");
    const count = (counts.get(row.department_id) ?? 0) + 1;
    if (count > MAX_SERVICE_STEPS) refuse("service_steps");
    counts.set(row.department_id, count);
    if (typeof row.name !== "string" || row.name === "" || row.name.trim() !== row.name)
      refuse("service_steps.name");
    const position = row.position;
    if (typeof position !== "number" || !Number.isInteger(position) || position < 0)
      refuse("service_steps.position");
    if (!starts.includes(row.start)) refuse("service_steps.start");
    const course = row.course_id ?? null;
    if (
      (row.start === "course_served") !== (course !== null) ||
      (course !== null && !courses.has(course))
    )
      refuse("service_steps.course_id");
    const minutes = row.minutes;
    if (
      typeof minutes !== "number" ||
      !Number.isInteger(minutes) ||
      minutes < 0 ||
      minutes > MAX_SERVICE_STEP_MINUTES ||
      (row.start === "since_last_order" && minutes < 1)
    )
      refuse("service_steps.minutes");
    const parent = row.after_step_id ?? null;
    if (
      (row.start === "after_step") !== (parent !== null) ||
      (parent !== null &&
        (typeof parent !== "string" || byId.get(parent)?.department_id !== row.department_id))
    )
      refuse("service_steps.after_step_id");
  }
  serviceStepOrder(
    steps.map((row) => ({
      key: String(row.id),
      afterStepKey: (row.after_step_id ?? null) as string | null,
    })),
    () => refuse("service_steps.after_step_id"),
  );
}

function validateDepartmentCourses(tables: Tables): void {
  const departments = ids(tables.departments),
    courses = ids(tables.kitchen_courses);
  const seen = new Set<string>();
  for (const row of tables.department_courses ?? []) {
    if (!departments.has(row.department_id)) refuse("department_courses.department_id");
    if (!courses.has(row.course_id)) refuse("department_courses.course_id");
    if (row.held_until_fired !== 0 && row.held_until_fired !== 1)
      refuse("department_courses.held_until_fired");
    if (!(
      row.reminder_minutes === null ||
      (typeof row.reminder_minutes === "number" &&
        Number.isInteger(row.reminder_minutes) &&
        row.reminder_minutes >= 0 &&
        row.reminder_minutes <= 120)
    ))
      refuse("department_courses.reminder_minutes");
    const key = JSON.stringify([row.department_id, row.course_id]);
    if (seen.has(key)) refuse("department_courses");
    seen.add(key);
  }
}

function validateVenueServiceConfiguration(
  tables: Tables,
  bundle?: {
    readonly createdAt: Date;
    readonly timeZone: string;
    readonly dayCutover: string;
    readonly holidayArea?: Readonly<Record<string, unknown>> | null;
  },
): void {
  validateOrderStarts(tables);
  validateDepartmentDining(tables);
  validateServiceHierarchy(tables);
  validateServiceSteps(tables);
  validateDepartmentCourses(tables);
  validateReceiptFields(tables);
  validateHolidayConfiguration(bundle?.holidayArea);
  validateMenuTimetables(tables);
  validateSeasonWeeks(tables, bundle);
  validateDepartmentTransfers(tables);
  validateRoutingConfiguration(tables);
}

export const VENUE_SERVICE_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "departments", leaveBehindWhenFalse: "active" },
    { name: "service_steps" },
    { name: "department_courses" },
    { name: "department_transfer_destinations" },
    { name: "routing_cells" },
    { name: "menu_periods", jsonReferences: [{ column: "staff_menu_ids", paths: [["*"]] }] },
    { name: "routing_cell_periods" },
    { name: "special_days" },
    { name: "special_day_dates" },
    { name: "seasons" },
    { name: "opening_hours" },
  ],
  validate: validateVenueServiceConfiguration,
  afterImport: async (tx: Transaction): Promise<void> => {
    await tx.run(sql`delete from routing_cell_periods where id in (
      select line.id from routing_cell_periods line
      join routing_cells cell on cell.id = line.cell_id
      where line.station_id is not null and line.station_id = cell.station_id
    )`);
  },
} as const;
