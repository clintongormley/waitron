import { isNotNull } from "drizzle-orm";
import { getCountryPack } from "@waitron/country-packs";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { holidayCityKey } from "./holiday-rules.js";
import type { PackLookup } from "./holidays.js";
import { addDays, isLocalDate, parseSpecialDateInput } from "./hours-rules.js";
import { CALENDAR_COLOURS, type CalendarColour, type LocalDate } from "./hours-types.js";
import { isReadableClock } from "./hours-clock.js";
import { occursOn, repeatKey } from "./named-day-rules.js";
import { menuPeriodName } from "./menu-timetable-rules.js";
import {
  findSeasonEndOffsetClash,
  parseEndOffsetMinutes,
  type DatedSchedule,
} from "./period-end-offset.js";
import type { PaintRange } from "./day-paint.js";
import { civilDateOf } from "@waitron/reporting";
import { ZONE_PAINT_KINDS } from "./schema/seasons.js";
import { firstSkippedEnd, sharedSpecialDate, specialDateIn } from "./special-days.js";
import {
  calendarDateOfTime,
  parseClosedRanges,
  parseServiceDay,
  type ClosedRange,
  type ServiceRange,
} from "./service-day.js";
import { localTimeOccurrences } from "./hours-occurrences.js";
import type { MenuSlot } from "./menu-timetable-types.js";
import { menuDayTimetables } from "./schema/menus.js";
import { zoneClosedTimes } from "./schema/zone-closed-times.js";
import "./errors.js";

type Row = Record<string, unknown>;
type Tables = Readonly<Record<string, readonly Row[]>>;

const STORED_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d:00$/;
const CUTOVER = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** The minutes `menu_slots_step_ck` and `zone_closed_times_step_ck` allow. Those checks refuse an
 *  insert at once, unlike the import's foreign keys, which wait for commit. */
function onQuarterHour(time: string): boolean {
  return ["00", "15", "30", "45"].includes(time.slice(3, 5));
}

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

/** Each period's end offset; a row without one takes the column's default, 0. */
function periodOffsets(tables: Tables): Map<string, number> {
  return new Map(
    (tables.menu_periods ?? []).map((row) => [
      row.id as string,
      (row.end_offset_minutes ?? 0) as number,
    ]),
  );
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

export function validateNamedDaysConfiguration(tables: Tables): void {
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

  // A weekday day's slots are checked only as far as inserting them needs: the import drops them.
  const slotsByNamedDay = new Map<unknown, MenuSlot[]>(
    [...days].filter(([, day]) => day.date !== null).map(([id]) => [id, []]),
  );
  let namedSlots = 0;
  for (const row of tables.menu_slots ?? []) {
    const day = days.get(row.timetable_id);
    if (day === undefined) refuse("menu_slots.timetable_id");
    if (row.department_id !== day.departmentId) refuse("menu_slots.department_id");
    if (periodDepartment.get(row.period_id) !== day.departmentId) refuse("menu_slots.period_id");
    for (const column of ["starts_at", "ends_at"])
      if (typeof row[column] !== "string" || !STORED_TIME.test(row[column]))
        refuse(`menu_slots.${column}`);
    if (!onQuarterHour(row.starts_at as string) || !onQuarterHour(row.ends_at as string))
      refuse("menu_slots");
    const slots = slotsByNamedDay.get(row.timetable_id);
    if (slots === undefined) continue;
    slots.push({
      periodId: row.period_id as string,
      startsAt: (row.starts_at as string).slice(0, 5),
      endsAt: (row.ends_at as string).slice(0, 5),
    });
    namedSlots += 1;
  }
  if (namedSlots === 0) return;
  if (bundle === undefined || !CUTOVER.test(bundle.dayCutover)) refuse("menu_slots");
  for (const [id, slots] of slotsByNamedDay) {
    const parsed = parsedAs("menu_slots", () => parseServiceDay(slots, "slots", bundle.dayCutover));
    const date = days.get(id)!.date!;
    if (!isReadableClock(bundle)) continue;
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
}

const SEASON_START = /^(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/** A season starts on a common year's MM-DD, never 02-29 (`seasons_starts_on_ck`). */
function isSeasonStart(value: unknown): value is string {
  if (typeof value !== "string" || !SEASON_START.test(value) || value === "02-29") return false;
  const date = new Date(`2001-${value}T00:00:00Z`);
  return date.getUTCDate() === Number(value.slice(3));
}

interface ImportedSpecialDate {
  date: LocalDate;
  repeats: boolean;
}

/** The bundle's special-day dates by id, refusing what `saveSpecialDay` could not have stored and
 *  two dates, or a date and a named day, that would stand on one day. */
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
  // Every special-day date and named day lands at the importing venue, whatever location the
  // bundle names.
  const placed: { date: LocalDate; repeats: boolean }[] = (tables.special_dates ?? []).map(
    (row) => ({ date: row.date as LocalDate, repeats: (row.repeat_on ?? null) !== null }),
  );
  for (const row of tables.special_day_dates ?? []) {
    if (!repeats.has(row.special_day_id)) refuse("special_day_dates.special_day_id");
    if (!isLocalDate(row.date)) refuse("special_day_dates.date");
    const closed = row.closed_all_day === undefined ? 0 : row.closed_all_day;
    if (closed !== 0 && closed !== 1) refuse("special_day_dates.closed_all_day");
    const rule = { date: row.date, repeats: repeats.get(row.special_day_id)! };
    if (placed.some((other) => sharedSpecialDate(rule, other) !== null))
      refuse("special_day_dates.date");
    placed.push(rule);
    dates.set(row.id, rule);
  }
  return dates;
}

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
      if (held.has(key)) refuse(`${table}.special_day_date_id`);
      held.add(key);
      specialDays.set(row.id, { ownerId: row[owner], dateId });
      continue;
    }
    if (!seasonIds.has(row.season_id)) refuse(`${table}.season_id`);
    const weekday = row.weekday;
    if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
      refuse(`${table}.weekday`);
    const key = JSON.stringify([row[owner], row.season_id, weekday]);
    if (held.has(key)) refuse(`${table}.weekday`);
    held.add(key);
    seasonDays.set(row.id, { ownerId: row[owner], seasonId: row.season_id, weekday });
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
    if (typeof row.name !== "string" || row.name.trim() === "" || names.has(row.name))
      refuse("seasons.name");
    if (!isSeasonStart(row.starts_on) || starts.has(row.starts_on)) refuse("seasons.starts_on");
    names.add(row.name);
    starts.add(row.starts_on);
    seasonIds.add(row.id);
  }
  const specialDates = validateSpecialDays(tables);
  const departmentDays = dayRows(
    tables.department_days,
    "department_days",
    "department_id",
    ids(tables.departments),
    seasonIds,
    specialDates,
  );
  const zones = new Set((tables.zone_service_policies ?? []).map((row) => row.zone_id));
  const zoneDays = dayRows(
    tables.zone_days,
    "zone_days",
    "zone_id",
    zones,
    seasonIds,
    specialDates,
  );
  const departmentRanges = tables.department_day_ranges ?? [];
  const zoneRanges = tables.zone_day_ranges ?? [];
  if (departmentRanges.length + zoneRanges.length === 0) return;
  if (bundle === undefined || !CUTOVER.test(bundle.dayCutover))
    refuse(departmentRanges.length > 0 ? "department_day_ranges" : "zone_day_ranges");

  const periodDepartment = new Map(
    (tables.menu_periods ?? []).map((row) => [row.id, row.department_id]),
  );
  const departmentWeeks = new Map<unknown, ServiceRange[]>(
    [...departmentDays.seasonDays.keys()].map((id) => [id, []]),
  );
  const departmentPaint = new Map<unknown, ClosedRange[]>(
    [...departmentDays.specialDays.keys()].map((id) => [id, []]),
  );
  for (const row of departmentRanges) {
    const day =
      departmentDays.seasonDays.get(row.day_id) ?? departmentDays.specialDays.get(row.day_id);
    if (day === undefined) refuse("department_day_ranges.day_id");
    if (row.department_id !== day.ownerId) refuse("department_day_ranges.department_id");
    const paint = departmentPaint.get(row.day_id);
    // Closed (a null period) belongs to a special-day date only.
    if (
      !(paint !== undefined && row.period_id === null) &&
      (typeof row.period_id !== "string" || periodDepartment.get(row.period_id) !== day.ownerId)
    )
      refuse("department_day_ranges.period_id");
    const stored = storedRange(row, "department_day_ranges");
    if (paint !== undefined) paint.push(stored);
    else departmentWeeks.get(row.day_id)!.push({ periodId: row.period_id as string, ...stored });
  }
  const zoneWeeks = new Map<unknown, ClosedRange[]>(
    [...zoneDays.seasonDays.keys()].map((id) => [id, []]),
  );
  const zonePaint = new Map<unknown, ClosedRange[]>(
    [...zoneDays.specialDays.keys()].map((id) => [id, []]),
  );
  for (const row of zoneRanges) {
    const paint = zonePaint.get(row.day_id);
    if (paint === undefined && !zoneDays.seasonDays.has(row.day_id))
      refuse("zone_day_ranges.day_id");
    // "open" belongs to a special-day date only; an export always carries the not-null column.
    if (
      !(paint !== undefined && ZONE_PAINT_KINDS.includes(row.kind as never)) &&
      row.kind !== "closed"
    )
      refuse("zone_day_ranges.kind");
    (paint ?? zoneWeeks.get(row.day_id)!).push(storedRange(row, "zone_day_ranges"));
  }
  for (const ranges of departmentWeeks.values())
    parsedAs("department_day_ranges", () => parseServiceDay(ranges, "slots", bundle.dayCutover));
  for (const ranges of [...zoneWeeks.values(), ...zonePaint.values()])
    parsedAs("zone_day_ranges", () => parseClosedRanges(ranges, "ranges", bundle.dayCutover));
  for (const ranges of departmentPaint.values())
    parsedAs("department_day_ranges", () => parseClosedRanges(ranges, "ranges", bundle.dayCutover));
  refuseSkippedPaint(
    departmentDays.specialDays,
    departmentPaint,
    specialDates,
    bundle,
    "department_day_ranges",
  );
  refuseSkippedPaint(zoneDays.specialDays, zonePaint, specialDates, bundle, "zone_day_ranges");
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
    if (firstSkippedEnd(clock, dates.get(days.get(dayId)!.dateId)!, from, ranges) !== null)
      refuse(table);
}

/** Each department's end offsets over the bundle's seasons and special days, under the bundle's
 *  one changeover; run after the shape checks, which refuse ranges without a
 *  changeover. A weekday row of `menu_day_timetables` is not imported, so it is not checked. */
function validateEndOffsets(tables: Tables, bundle?: { readonly dayCutover: string }): void {
  const seasonRows = tables.department_day_ranges ?? [];
  const namedDays = new Map(
    (tables.menu_day_timetables ?? [])
      .filter((row) => (row.special_date_id ?? null) !== null)
      .map((row) => [row.id, row]),
  );
  const namedRows = (tables.menu_slots ?? []).filter((row) => namedDays.has(row.timetable_id));
  if (bundle === undefined || seasonRows.length + namedRows.length === 0) return;
  const days = new Map((tables.department_days ?? []).map((row) => [row.id, row]));
  const repeats = new Map((tables.special_days ?? []).map((row) => [row.id, row.repeats_yearly]));
  const range = (row: Row): ServiceRange => ({
    periodId: row.period_id as string,
    startsAt: (row.starts_at as string).slice(0, 5),
    endsAt: (row.ends_at as string).slice(0, 5),
  });
  const offsets = periodOffsets(tables);
  const weeks = new Map<unknown, ServiceRange[][]>();
  const paint = new Map<string, PaintRange[]>();
  for (const row of seasonRows) {
    const day = days.get(row.day_id)!;
    if ((day.special_day_date_id ?? null) !== null) {
      const key = JSON.stringify([day.department_id, day.special_day_date_id]);
      paint.set(key, [
        ...(paint.get(key) ?? []),
        { ...range(row), periodId: (row.period_id ?? null) as string | null },
      ]);
      continue;
    }
    const key = JSON.stringify([day.department_id, day.season_id]);
    const week = weeks.get(key) ?? Array.from({ length: 7 }, (): ServiceRange[] => []);
    week[day.weekday as number]!.push(range(row));
    weeks.set(key, week);
  }
  const namedSlots = new Map<unknown, ServiceRange[]>();
  for (const row of namedRows) {
    const day = namedDays.get(row.timetable_id)!;
    const key = JSON.stringify([day.department_id, day.special_date_id]);
    namedSlots.set(key, [...(namedSlots.get(key) ?? []), range(row)]);
  }
  for (const day of namedDays.values()) {
    const key = JSON.stringify([day.department_id, day.special_date_id]);
    if (!namedSlots.has(key)) namedSlots.set(key, []);
  }
  for (const departmentId of ids(tables.departments)) {
    const seasons = (tables.seasons ?? []).map((season) => ({
      seasonId: season.id as string,
      startsOn: season.starts_on as string,
      week: weeks.get(JSON.stringify([departmentId, season.id])) ?? [],
    }));
    const specialDays: DatedSchedule[] = (tables.special_day_dates ?? []).map((date) => {
      const rule = {
        date: date.date as LocalDate,
        repeats: repeats.get(date.special_day_id) === 1,
      };
      return {
        date: rule.date,
        closeWholeVenue: date.closed_all_day === 1,
        ...(rule.repeats ? { occursIn: (year: number) => specialDateIn(rule, year) } : {}),
        paint: paint.get(JSON.stringify([departmentId, date.id])) ?? [],
        specialDayId: date.special_day_id as string,
      };
    });
    const clash = findSeasonEndOffsetClash(seasons, specialDays, offsets, bundle.dayCutover);
    if (clash !== null)
      refuse(
        clash.date === undefined || clash.specialDayId !== undefined
          ? "department_day_ranges"
          : "menu_slots",
      );
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

function validateServiceHierarchy(tables: Tables): void {
  for (const table of ["floor_zones", "departments"])
    for (const row of tables[table] ?? []) if (!isActive(row, table)) refuse(`${table}.active`);
  const zones = ids(tables.floor_zones);
  const departments = ids(tables.departments);
  for (const row of tables.zone_service_policies ?? []) {
    if (!zones.has(row.zone_id)) refuse("zone_service_policies.zone_id");
    if (!departments.has(row.department_id)) refuse("zone_service_policies.department_id");
  }
  for (const table of ["department_receipts", "department_sale_policies"])
    for (const row of tables[table] ?? [])
      if (!departments.has(row.department_id)) refuse(`${table}.department_id`);
  for (const row of tables.zone_sale_policies ?? [])
    if (!zones.has(row.zone_id)) refuse("zone_sale_policies.zone_id");
}

function validateZoneClosedTimes(tables: Tables, bundle?: { readonly dayCutover: string }): void {
  const rows = tables.zone_closed_times ?? [];
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
    if (!onQuarterHour(row.starts_at as string) || !onQuarterHour(row.ends_at as string))
      refuse("zone_closed_times");
    // A weekday row is checked only as far as inserting it needs: the import drops it.
    if (weekday !== null) continue;
    const key = JSON.stringify([row.zone_id, day]);
    const ranges = groups.get(key) ?? [];
    ranges.push({
      startsAt: (row.starts_at as string).slice(0, 5),
      endsAt: (row.ends_at as string).slice(0, 5),
    });
    groups.set(key, ranges);
  }
  if (groups.size === 0) return;
  if (bundle === undefined || !CUTOVER.test(bundle.dayCutover)) refuse("zone_closed_times");
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

function validateReceiptFields(tables: Tables): void {
  for (const row of tables.department_receipts ?? []) {
    let receipt = row.receipt;
    if (typeof receipt === "string") {
      try {
        receipt = JSON.parse(receipt) as unknown;
      } catch {
        refuse("department_receipts.receipt");
      }
    }
    if (typeof receipt !== "object" || receipt === null || Array.isArray(receipt))
      refuse("department_receipts.receipt");
    const value = receipt as Record<string, unknown>;
    if (value.printAddress !== undefined && typeof value.printAddress !== "boolean")
      refuse("department_receipts.receipt");
    if (
      value.operationDescription !== undefined &&
      (typeof value.operationDescription !== "string" ||
        value.operationDescription.length > 500 ||
        Array.from(value.operationDescription).some(
          (character) => character < " " && !"\t\n\r".includes(character),
        ))
    )
      refuse("department_receipts.receipt");
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
  validateServiceHierarchy(tables);
  validateReceiptFields(tables);
  validateNamedDaysConfiguration(tables);
  validateHolidayConfiguration(tables);
  validateMenuTimetables(tables, bundle);
  validateZoneClosedTimes(tables, bundle);
  validateSeasonWeeks(tables, bundle);
  validateEndOffsets(tables, bundle);
  validateDepartmentTransfers(tables);
  validateRoutingConfiguration(tables);
}

/** A week lives in the season tables; a bundle's old weekday rows, which no hours reader uses,
 *  are not kept. Named-day rows stay. */
async function dropWeekdayRows(tx: Transaction): Promise<void> {
  await tx.delete(menuDayTimetables).where(isNotNull(menuDayTimetables.weekday));
  await tx.delete(zoneClosedTimes).where(isNotNull(zoneClosedTimes.weekday));
}

export const VENUE_SERVICE_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "departments", locationColumns: ["location_id"], leaveBehindWhenFalse: "active" },
    { name: "department_receipts" },
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
    { name: "routing_cells", locationColumns: ["location_id"] },
    { name: "service_settings" },
    { name: "special_dates", locationColumns: ["location_id"] },
    { name: "menu_periods" },
    { name: "menu_period_staff_menus" },
    { name: "menu_day_timetables" },
    { name: "menu_slots" },
    { name: "routing_cell_periods" },
    { name: "special_days", locationColumns: ["location_id"] },
    { name: "special_day_dates", locationColumns: ["location_id"] },
    { name: "seasons", locationColumns: ["location_id"] },
    { name: "department_days" },
    { name: "department_day_ranges" },
    { name: "zone_days" },
    { name: "zone_day_ranges" },
    { name: "zone_closed_times" },
    { name: "holiday_geographies", locationColumns: ["location_id"] },
  ],
  validate: validateVenueServiceConfiguration,
  afterImport: dropWeekdayRows,
} as const;
