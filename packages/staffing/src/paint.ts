import { and, asc, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { kitchenStations, type Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError, locationId, compareStationNames } from "@waitron/shared";
import {
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
import { staffingBlocks, staffingDays, staffRoles } from "./schema/staffing.js";
import { areaKey, blockSpan, type AreaRef, type StaffingBlock } from "./slots.js";
import type {
  SeasonStaffing,
  SeasonStaffingEdit,
  SpecialDayStaffing,
  SpecialDayStaffingEdit,
  StaffingArea,
  StaffingGuideRange,
} from "./staffing-types.js";
import "./errors.js";

export type { SeasonStaffingEdit, SpecialDayStaffingEdit };

type Cfg = { locationId: string };

const venueScope = (cfg: Cfg) => ({ locationId: locationId(cfg.locationId) });
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const storedTime = (value: string) => `${value}:00`;
const wireTime = (value: string) => value.slice(0, 5);
const seasonDayKey = (seasonId: string, weekday: number) => `season:${seasonId}:${weekday}`;
const dateDayKey = (dateId: string) => `date:${dateId}`;

/** The location's active departments, then its active stations, in the order each list shows them. */
export async function listStaffingAreas(tx: Transaction, cfg: Cfg): Promise<StaffingArea[]> {
  const departmentRows = await tx
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(and(eq(departments.locationId, cfg.locationId), eq(departments.active, true)))
    .orderBy(desc(departments.isDefault), asc(departments.name), asc(departments.id));
  const stationRows = await tx
    .select({ id: kitchenStations.id, name: kitchenStations.name })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.locationId, cfg.locationId), eq(kitchenStations.active, true)))
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

async function currentCutover(tx: Transaction, cfg: Cfg): Promise<string> {
  return (await readLocationClock(tx, cfg.locationId)).dayCutover;
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

async function assertSeasonHere(tx: Transaction, cfg: Cfg, seasonId: string): Promise<void> {
  const [row] = await tx
    .select({ id: seasons.id })
    .from(seasons)
    .where(and(eq(seasons.id, seasonId), eq(seasons.locationId, cfg.locationId)));
  if (row === undefined) throw new AppError("season.not_found", { seasonId });
}

/** The special day's dates in date order; refused unless the special day is at the location. */
async function specialDayDatesHere(
  tx: Transaction,
  cfg: Cfg,
  specialDayId: string,
): Promise<{ dateId: string; date: string }[]> {
  const [row] = await tx
    .select({ id: specialDays.id })
    .from(specialDays)
    .where(and(eq(specialDays.id, specialDayId), eq(specialDays.locationId, cfg.locationId)));
  if (row === undefined) throw new AppError("special_day.not_found", { specialDayId });
  return tx
    .select({ dateId: specialDayDates.id, date: specialDayDates.date })
    .from(specialDayDates)
    .where(eq(specialDayDates.specialDayId, specialDayId))
    .orderBy(asc(specialDayDates.date), asc(specialDayDates.id));
}

/** Refuses an area that is not an active department or station at the location, and a staff
 *  role that is not at the location. */
async function assertEditTargets(
  tx: Transaction,
  cfg: Cfg,
  edits: readonly { area: AreaRef; blocks: readonly StaffingBlock[] | null }[],
): Promise<void> {
  const active = new Set((await listStaffingAreas(tx, cfg)).map((a) => areaKey(a.area)));
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
    .where(and(eq(staffRoles.locationId, cfg.locationId), inArray(staffRoles.id, wanted)));
  const here = new Set(found.map((row) => row.id));
  const missingRole = wanted.find((id) => !here.has(id));
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

export async function readSeasonStaffing(
  tx: Transaction,
  cfg: Cfg,
  seasonId: string,
): Promise<SeasonStaffing> {
  const all = await readSeasons(tx, venueScope(cfg));
  if (!all.some((season) => season.id === seasonId))
    throw new AppError("season.not_found", { seasonId });
  const areas = await listStaffingAreas(tx, cfg);
  const cutover = await currentCutover(tx, cfg);
  const paint = await readPaint(tx, areas, eq(staffingDays.seasonId, seasonId), cutover);
  const forecast = await readPlannedServiceGuides(tx, venueScope(cfg), idsOf(areas, "station"), {
    kind: "season",
    seasonId,
    cutover,
  });
  return {
    cutover,
    seasons: all.map(({ id, name, startsOn }) => ({ id, name, startsOn })),
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
  cfg: Cfg,
  seasonId: string,
  edits: readonly SeasonStaffingEdit[],
): Promise<void> {
  await assertSeasonHere(tx, cfg, seasonId);
  await assertEditTargets(tx, cfg, edits);
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
  cfg: Cfg,
  specialDayId: string,
): Promise<SpecialDayStaffing> {
  const found = await readSpecialDayPlan(tx, venueScope(cfg), specialDayId);
  if (found === null) throw new AppError("special_day.not_found", { specialDayId });
  const { name: specialDayName, plan } = found;
  const dates = found.dates.map(({ dateId, storedDate }) => ({ dateId, date: storedDate }));
  const areas = await listStaffingAreas(tx, cfg);
  const clock = await readLocationClock(tx, cfg.locationId);
  const cutover = clock.dayCutover;
  const paint = await readPaint(
    tx,
    areas,
    inArray(
      staffingDays.specialDayDateId,
      dates.map((d) => d.dateId),
    ),
    cutover,
  );
  const forecast = await readPlannedServiceGuides(tx, venueScope(cfg), idsOf(areas, "station"), {
    kind: "dates",
    dates: dates.map(({ date }) => date),
    clock,
    plan,
  });
  return {
    cutover,
    name: specialDayName,
    guides: namedGuides(
      areas,
      forecast,
      dates.map(({ dateId, date }) => [dateId, date]),
    ),
    areas: areas.map(({ area, name }) => ({
      area,
      name,
      dates: dates.map(({ dateId, date }) => ({
        dateId,
        date,
        blocks: paint.get(areaKey(area))?.get(dateDayKey(dateId)) ?? null,
      })),
    })),
  };
}

/** Per edit, replaces the area's row for the date: null leaves none (the season applies), [] an
 *  empty row (nobody that day). */
export async function saveSpecialDayStaffing(
  tx: Transaction,
  cfg: Cfg,
  specialDayId: string,
  edits: readonly SpecialDayStaffingEdit[],
): Promise<void> {
  const dateIds = new Set((await specialDayDatesHere(tx, cfg, specialDayId)).map((d) => d.dateId));
  const foreign = edits.findIndex((edit) => !dateIds.has(edit.dateId));
  if (foreign !== -1) throw new AppError("staffing.invalid", { field: `edits.${foreign}.dateId` });
  await assertEditTargets(tx, cfg, edits);
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
 *  day, the `listStaffingAreas` answer, and the location's current `cutover`. */
export interface ResolveStaffingGiven {
  plan?: DayPlan;
  areas?: readonly StaffingArea[];
  cutover?: string;
}

/** Each business day's blocks per active area (day → areaKey → blocks): the special day's row for
 *  the area wins, else the season's weekday row, else no entry. */
export async function resolveStaffing(
  tx: Transaction,
  cfg: Cfg,
  businessDays: readonly string[],
  given: ResolveStaffingGiven = {},
): Promise<Map<string, Map<string, StaffingBlock[]>>> {
  const resolved = new Map<string, Map<string, StaffingBlock[]>>();
  if (businessDays.length === 0) return resolved;
  const plan = given.plan ?? (await readDayPlan(tx, venueScope(cfg), businessDays));
  for (const day of businessDays)
    if (!plan.seasonIdOn.has(day) || !plan.special.has(day))
      throw new Error(`the day plan does not cover ${day}`);
  const areas = given.areas ?? (await listStaffingAreas(tx, cfg));
  const cutover = given.cutover ?? (await currentCutover(tx, cfg));
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
