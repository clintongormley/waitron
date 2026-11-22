import { staffRoles } from "@waitron/db";
import { and, asc, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { kitchenStations, readVenueClock, type Transaction } from "@waitron/db";
import { AppError, compareStationNames, cutoverForBusinessDay } from "@waitron/shared";
import {
  addDays,
  seasonOn,
  departments,
  readDayPlan,
  type DayPlan,
  readSeasons,
  readSpecialDayPlan,
  readPlannedServiceGuides,
  type PlannedServiceGuides,
  seasons,
  specialDayDates,
  specialDays,
  weekdayOf,
} from "@waitron/venue-service";
import { staffingBlocks, staffingDays } from "@waitron/workforce";
import { areaKey, blockSpan, type AreaRef, type StaffingBlock } from "./slots.js";
import type {
  SeasonStaffing,
  SeasonStaffingEdit,
  SpecialDayStaffing,
  SpecialDayStaffingEdit,
  StaffingArea,
  StaffingGuideRange,
} from "./staffing-types.js";
import { assertBlockFitsDay } from "./paint-rules.js";
import "./errors.js";

export type { SeasonStaffingEdit, SpecialDayStaffingEdit };

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const storedTime = (value: string) => `${value}:00`;
const wireTime = (value: string) => value.slice(0, 5);
const seasonDayKey = (seasonId: string, weekday: number) => `season:${seasonId}:${weekday}`;
const dateDayKey = (dateId: string) => `date:${dateId}`;

/** The active departments, then the active stations, in the order each list shows them. */
export async function listStaffingAreas(tx: Transaction): Promise<StaffingArea[]> {
  const departmentRows = await tx
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(eq(departments.active, true))
    .orderBy(desc(departments.isDefault), asc(departments.name), asc(departments.id));
  const stationRows = await tx
    .select({ id: kitchenStations.id, name: kitchenStations.name })
    .from(kitchenStations)
    .where(eq(kitchenStations.active, true))
    .orderBy(asc(kitchenStations.name), asc(kitchenStations.id));
  stationRows.sort((a, b) => compareStationNames(a.name, b.name) || a.id.localeCompare(b.id));
  return [
    ...departmentRows.map((row) => ({
      area: { kind: "department", id: row.id } as AreaRef,
      name: row.name,
    })),
    ...stationRows.map((row) => ({
      area: { kind: "station", id: row.id } as AreaRef,
      name: row.name,
    })),
  ];
}

const idsOf = (areas: readonly StaffingArea[], kind: AreaRef["kind"]) =>
  areas.filter((a) => a.area.kind === kind).map((a) => a.area.id);

function areaOfRow(row: { departmentId: string | null; stationId: string | null }): AreaRef {
  return row.departmentId === null
    ? { kind: "station", id: row.stationId! }
    : { kind: "department", id: row.departmentId };
}

/** Painted days of the given areas matching `days`, keyed areaKey → day key; an empty row reads []. */
async function readPaint(
  tx: Transaction,
  areas: readonly StaffingArea[],
  days: SQL | undefined,
  cutover: string,
): Promise<Map<string, Map<string, StaffingBlock[]>>> {
  const rows = await tx
    .select({
      departmentId: staffingDays.departmentId,
      stationId: staffingDays.stationId,
      seasonId: staffingDays.seasonId,
      weekday: staffingDays.weekday,
      specialDayDateId: staffingDays.specialDayDateId,
      staffRoleId: staffingBlocks.staffRoleId,
      headcount: staffingBlocks.headcount,
      startsAt: staffingBlocks.startsAt,
      endsAt: staffingBlocks.endsAt,
    })
    .from(staffingDays)
    .leftJoin(staffingBlocks, eq(staffingBlocks.dayId, staffingDays.id))
    .where(
      and(
        days,
        or(
          inArray(staffingDays.departmentId, idsOf(areas, "department")),
          inArray(staffingDays.stationId, idsOf(areas, "station")),
        ),
      ),
    );
  const paint = new Map<string, Map<string, StaffingBlock[]>>();
  for (const row of rows) {
    const key = areaKey(areaOfRow(row));
    const byDay = paint.get(key) ?? new Map<string, StaffingBlock[]>();
    paint.set(key, byDay);
    const dayKey =
      row.specialDayDateId === null
        ? seasonDayKey(row.seasonId!, row.weekday!)
        : dateDayKey(row.specialDayDateId);
    const blocks = byDay.get(dayKey) ?? [];
    byDay.set(dayKey, blocks);
    if (row.staffRoleId !== null)
      blocks.push({
        staffRoleId: row.staffRoleId,
        headcount: row.headcount!,
        startsAt: wireTime(row.startsAt!),
        endsAt: wireTime(row.endsAt!),
      });
  }
  for (const byDay of paint.values())
    for (const blocks of byDay.values())
      blocks.sort((a, b) => {
        const x = blockSpan(a, cutover);
        const y = blockSpan(b, cutover);
        return (
          x.start - y.start ||
          x.end - y.end ||
          a.staffRoleId.localeCompare(b.staffRoleId) ||
          a.headcount - b.headcount
        );
      });
  return paint;
}

async function currentCutover(tx: Transaction): Promise<string> {
  return (await readVenueClock(tx)).dayCutover;
}

function namedGuides(
  areas: readonly StaffingArea[],
  forecast: PlannedServiceGuides,
  columns: readonly (readonly [string, string])[],
): Record<string, Record<string, StaffingGuideRange[]>> {
  const periods = new Map(forecast.periods.map((period) => [period.id, period]));
  const departments = new Map(
    forecast.departments.map((department) => [department.id, department.name]),
  );
  return Object.fromEntries(
    areas.map(({ area }) => [
      areaKey(area),
      Object.fromEntries(
        columns.map(([key, column]) => {
          const sources =
            area.kind === "department"
              ? [
                  {
                    departmentId: area.id,
                    ranges: forecast.departmentRanges.get(area.id)?.get(column) ?? [],
                  },
                ]
              : (forecast.stationRanges.get(area.id)?.get(column) ?? []);
          return [
            key,
            sources.flatMap(({ departmentId, ranges }) =>
              ranges.flatMap((range) => {
                const period = periods.get(range.periodId);
                if (!period) return [];
                return [
                  {
                    ...range,
                    periodName: period.name,
                    periodColour: period.colour,
                    departmentId,
                    departmentName: departments.get(departmentId)!,
                  },
                ];
              }),
            ),
          ];
        }),
      ),
    ]),
  );
}

async function assertSeasonExists(tx: Transaction, seasonId: string): Promise<void> {
  const [row] = await tx.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, seasonId));
  if (row === undefined) throw new AppError("season.not_found", { seasonId });
}

/** The special day's dates in date order; refused for an unknown special day. */
async function readSpecialDayDates(
  tx: Transaction,
  specialDayId: string,
): Promise<{ dateId: string; date: string }[]> {
  const [row] = await tx
    .select({ id: specialDays.id })
    .from(specialDays)
    .where(eq(specialDays.id, specialDayId));
  if (row === undefined) throw new AppError("special_day.not_found", { specialDayId });
  return tx
    .select({ dateId: specialDayDates.id, date: specialDayDates.date })
    .from(specialDayDates)
    .where(eq(specialDayDates.specialDayId, specialDayId))
    .orderBy(asc(specialDayDates.date), asc(specialDayDates.id));
}

/** Refuses an area that is not an active department or station, and an unknown staff role. */
async function assertEditTargets(
  tx: Transaction,
  edits: readonly { area: AreaRef; blocks: readonly StaffingBlock[] | null }[],
): Promise<void> {
  const active = new Set((await listStaffingAreas(tx)).map((a) => areaKey(a.area)));
  const missingArea = edits.find((edit) => !active.has(areaKey(edit.area)));
  if (missingArea !== undefined)
    throw new AppError("staffing_area.not_found", { area: areaKey(missingArea.area) });
  const wanted = [
    ...new Set(edits.flatMap((edit) => (edit.blocks ?? []).map((b) => b.staffRoleId))),
  ];
  if (wanted.length === 0) return;
  const found = await tx
    .select({ id: staffRoles.id })
    .from(staffRoles)
    .where(and(inArray(staffRoles.id, wanted), isNull(staffRoles.hiddenAt)));
  const known = new Set(found.map((row) => row.id));
  const missingRole = wanted.find((id) => !known.has(id));
  if (missingRole !== undefined)
    throw new AppError("staff_role.not_found", { staffRoleId: missingRole });
}

const areaColumns = (area: AreaRef) =>
  area.kind === "department" ? { departmentId: area.id } : { stationId: area.id };
const areaMatch = (area: AreaRef) =>
  area.kind === "department"
    ? eq(staffingDays.departmentId, area.id)
    : eq(staffingDays.stationId, area.id);

async function insertDay(
  tx: Transaction,
  values: typeof staffingDays.$inferInsert,
  blocks: readonly StaffingBlock[],
): Promise<void> {
  const [day] = await tx.insert(staffingDays).values(values).returning({ id: staffingDays.id });
  if (blocks.length === 0) return;
  await tx.insert(staffingBlocks).values(
    blocks.map((b) => ({
      dayId: day!.id,
      staffRoleId: b.staffRoleId,
      headcount: b.headcount,
      startsAt: storedTime(b.startsAt),
      endsAt: storedTime(b.endsAt),
    })),
  );
}

export async function readSeasonStaffingContext(tx: Transaction, seasonId: string, month: string) {
  const all = await readSeasons(tx);
  const at = all.findIndex((season) => season.id === seasonId);
  if (at < 0) throw new AppError("season.not_found", { seasonId });
  let anchor = `${month}-01`;
  while (seasonOn(all, anchor)!.id !== seasonId) anchor = addDays(anchor, 1);
  const start = all[at]!.startsOn;
  const year = Number(anchor.slice(0, 4)) - Number(start > anchor.slice(5));
  const from = `${year}-${start}`;
  const next = all[(at + 1) % all.length]!.startsOn;
  const until = `${year + Number(next <= start)}-${next}`;
  const clock = await readVenueClock(tx);
  const weekdayCutovers = Object.fromEntries(WEEKDAYS.map((day) => [day, [] as string[]]));
  for (let day = from; day < until; day = addDays(day, 1)) {
    const starts = weekdayCutovers[weekdayOf(day)]!;
    const cutover = cutoverForBusinessDay(clock, day);
    if (!starts.includes(cutover)) starts.push(cutover);
  }
  return {
    seasons: all,
    month,
    cutover: cutoverForBusinessDay(clock, anchor),
    cutoverChanges: clock.cutoverChanges.filter(
      (c) => c.effectiveBusinessDay > from && c.effectiveBusinessDay < until,
    ),
    weekdayCutovers,
  };
}

export async function readSeasonStaffing(
  tx: Transaction,
  seasonId: string,
  month: string,
): Promise<SeasonStaffing> {
  const context = await readSeasonStaffingContext(tx, seasonId, month);
  const { cutover, seasons: all } = context;
  const areas = await listStaffingAreas(tx);
  const paint = await readPaint(tx, areas, eq(staffingDays.seasonId, seasonId), cutover);
  const forecast = await readPlannedServiceGuides(tx, idsOf(areas, "station"), {
    kind: "season",
    seasonId,
    cutover,
  });
  return {
    ...context,
    seasons: all.map(({ id, name, startsOn, colour }) => ({ id, name, startsOn, colour })),
    areas: areas.map(({ area, name }) => {
      const byDay = paint.get(areaKey(area));
      return {
        area,
        name,
        weekdays: Object.fromEntries(
          WEEKDAYS.map((w) => [w, byDay?.get(seasonDayKey(seasonId, w)) ?? []]),
        ),
      };
    }),
    guides: namedGuides(
      areas,
      forecast,
      WEEKDAYS.map((weekday) => [String(weekday), String(weekday)]),
    ),
  };
}

/** Per edit, replaces the area's row for the season's weekday; an empty block list leaves none. */
export async function saveSeasonStaffing(
  tx: Transaction,
  seasonId: string,
  edits: readonly SeasonStaffingEdit[],
): Promise<void> {
  await assertSeasonExists(tx, seasonId);
  await assertEditTargets(tx, edits);
  for (const edit of edits) {
    await tx
      .delete(staffingDays)
      .where(
        and(
          areaMatch(edit.area),
          eq(staffingDays.seasonId, seasonId),
          eq(staffingDays.weekday, edit.weekday),
        ),
      );
    if (edit.blocks.length > 0)
      await insertDay(
        tx,
        { ...areaColumns(edit.area), seasonId, weekday: edit.weekday },
        edit.blocks,
      );
  }
}

export async function readSpecialDayStaffing(
  tx: Transaction,
  specialDayId: string,
): Promise<SpecialDayStaffing> {
  const found = await readSpecialDayPlan(tx, specialDayId);
  if (found === null) throw new AppError("special_day.not_found", { specialDayId });
  const { name: specialDayName, plan } = found;
  const areas = await listStaffingAreas(tx);
  const clock = await readVenueClock(tx);
  const cutover = clock.dayCutover;
  const dates = found.dates.map(({ dateId, storedDate }) => ({
    dateId,
    date: storedDate,
    cutover: cutoverForBusinessDay(clock, storedDate),
  }));
  const seasonIds = [...new Set(dates.flatMap(({ date }) => plan.seasonIdOn.get(date) ?? []))];
  const paint = await readPaint(
    tx,
    areas,
    or(
      inArray(
        staffingDays.specialDayDateId,
        dates.map(({ dateId }) => dateId),
      ),
      inArray(staffingDays.seasonId, seasonIds),
    ),
    cutover,
  );
  const forecast = await readPlannedServiceGuides(tx, idsOf(areas, "station"), {
    kind: "dates",
    dates: dates.map(({ date }) => date),
    clock,
    plan,
  });
  return {
    cutover,
    name: specialDayName,
    dates,
    guides: namedGuides(
      areas,
      forecast,
      dates.map(({ dateId, date }) => [dateId, date]),
    ),
    areas: areas.map(({ area, name }) => {
      const byDay = paint.get(areaKey(area));
      return {
        area,
        name,
        dates: dates.map(({ dateId, date }) => {
          const seasonId = plan.seasonIdOn.get(date);
          return {
            dateId,
            date,
            blocks: byDay?.get(dateDayKey(dateId)) ?? null,
            seasonBlocks:
              (seasonId ? byDay?.get(seasonDayKey(seasonId, weekdayOf(date))) : undefined) ?? [],
          };
        }),
      };
    }),
  };
}

/** Per edit, replaces the area's row for the date: null leaves none (the season applies), [] an
 *  empty row (nobody that day). */
export async function saveSpecialDayStaffing(
  tx: Transaction,
  specialDayId: string,
  edits: readonly SpecialDayStaffingEdit[],
): Promise<void> {
  const dates = await readSpecialDayDates(tx, specialDayId);
  const clock = await readVenueClock(tx);
  const starts = new Map(
    dates.map(({ dateId, date }) => [dateId, cutoverForBusinessDay(clock, date)]),
  );
  edits.forEach(({ dateId, blocks }, index) => {
    const cutover = starts.get(dateId);
    if (cutover === undefined)
      throw new AppError("staffing.invalid", { field: `edits.${index}.dateId` });
    blocks?.forEach((block, blockIndex) =>
      assertBlockFitsDay(block, `edits.${index}.blocks.${blockIndex}`, cutover),
    );
  });
  await assertEditTargets(tx, edits);
  for (const edit of edits) {
    await tx
      .delete(staffingDays)
      .where(and(areaMatch(edit.area), eq(staffingDays.specialDayDateId, edit.dateId)));
    if (edit.blocks !== null)
      await insertDay(
        tx,
        { ...areaColumns(edit.area), specialDayDateId: edit.dateId },
        edit.blocks,
      );
  }
}

/** What a caller has already read for {@link resolveStaffing}: a `plan` covering every business
 *  day, the `listStaffingAreas` answer, and the current `cutover`. */
export interface ResolveStaffingGiven {
  plan?: DayPlan;
  areas?: readonly StaffingArea[];
  cutover?: string;
}

/** Each business day's blocks per active area (day → areaKey → blocks): the special day's row for
 *  the area wins, else the season's weekday row, else no entry. */
export async function resolveStaffing(
  tx: Transaction,
  businessDays: readonly string[],
  given: ResolveStaffingGiven = {},
): Promise<Map<string, Map<string, StaffingBlock[]>>> {
  const resolved = new Map<string, Map<string, StaffingBlock[]>>();
  if (businessDays.length === 0) return resolved;
  const plan = given.plan ?? (await readDayPlan(tx, businessDays));
  for (const day of businessDays)
    if (!plan.seasonIdOn.has(day) || !plan.special.has(day))
      throw new Error(`the day plan does not cover ${day}`);
  const areas = given.areas ?? (await listStaffingAreas(tx));
  const cutover = given.cutover ?? (await currentCutover(tx));
  const seasonIds = [...new Set([...plan.seasonIdOn.values()].filter((id) => id !== null))];
  const dateIds = [...new Set([...plan.special.values()].flatMap((s) => (s ? [s.dateId] : [])))];
  const paint = await readPaint(
    tx,
    areas,
    or(inArray(staffingDays.seasonId, seasonIds), inArray(staffingDays.specialDayDateId, dateIds)),
    cutover,
  );
  for (const day of businessDays) {
    const special = plan.special.get(day);
    const seasonId = plan.seasonIdOn.get(day);
    const byArea = new Map<string, StaffingBlock[]>();
    for (const { area } of areas) {
      const byDay = paint.get(areaKey(area));
      const blocks =
        (special ? byDay?.get(dateDayKey(special.dateId)) : undefined) ??
        (seasonId ? byDay?.get(seasonDayKey(seasonId, weekdayOf(day))) : undefined);
      if (blocks !== undefined) byArea.set(areaKey(area), [...blocks]);
    }
    resolved.set(day, byArea);
  }
  return resolved;
}
