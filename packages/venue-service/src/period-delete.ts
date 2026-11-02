import { and, asc, eq, gte, inArray, isNotNull, ne, notExists } from "drizzle-orm";
import { readVenueClock, type Transaction } from "@waitron/db";
import { AppError, cutoverForBusinessDay, type BusinessDayClock } from "@waitron/shared";
import {
  assertBusinessDayScheduleWrite,
  assertWaitingChangeFits,
  readBusinessDayScheduleRevision,
} from "./business-day-schedule.js";
import type { LocalDate } from "./hours-types.js";
import { readRoutingUses, requirePeriod } from "./menu-timetable.js";
import type { PeriodRoutingUse } from "./menu-timetable-types.js";
import type { VenueScope } from "./operations.js";
import { menuPeriods } from "./schema/menus.js";
import {
  departmentDayRanges,
  departmentDays,
  seasons,
  specialDayDates,
  specialDays,
} from "./schema/seasons.js";
import { joinTouching } from "./season-weeks.js";
import { rangeSpan, serviceMomentAt } from "./service-day.js";
import { inForceClock } from "./service-day-context.js";
import "./errors.js";

export interface PaintedIn {
  seasons: { id: string; name: string }[];
  specialDays: { id: string; name: string }[];
}

export interface PeriodDeleteImpact {
  seasons: number;
  specialDays: number;
  routingUses: PeriodRoutingUse[];
  /** The department's other periods. */
  replacements: { id: string; name: string }[];
  /** The revision this impact was read under, for the delete to send back. */
  clockRevision: number;
}

/** The business day holding `at`, or null when the venue's clock cannot be read. */
async function businessDayAt(tx: Transaction, at: Date): Promise<LocalDate | null> {
  return serviceMomentAt(at, await readVenueClock(tx))?.businessDay ?? null;
}

/** Every period of the venue, each with where it is painted. With no `today` (an unreadable
 *  clock) every special day painting a period is listed, past ones included. */
async function paintedIn(
  tx: Transaction,
  today: LocalDate | null,
  periodId?: string,
): Promise<Map<string, PaintedIn>> {
  const onePeriod = (column: typeof menuPeriods.id | typeof departmentDayRanges.periodId) =>
    periodId === undefined ? undefined : eq(column, periodId);
  const periods = await tx
    .select({ id: menuPeriods.id })
    .from(menuPeriods)
    .where(onePeriod(menuPeriods.id))
    .orderBy(asc(menuPeriods.name), asc(menuPeriods.id));
  const painted = new Map<string, PaintedIn>(
    periods.map(({ id }) => [id, { seasons: [], specialDays: [] }]),
  );
  const seasonPaint = await tx
    .selectDistinct({
      periodId: departmentDayRanges.periodId,
      id: seasons.id,
      name: seasons.name,
      startsOn: seasons.startsOn,
    })
    .from(departmentDayRanges)
    .innerJoin(departmentDays, eq(departmentDays.id, departmentDayRanges.dayId))
    .innerJoin(seasons, eq(seasons.id, departmentDays.seasonId))
    .where(and(isNotNull(departmentDayRanges.periodId), onePeriod(departmentDayRanges.periodId)))
    .orderBy(asc(seasons.startsOn), asc(seasons.id));
  for (const row of seasonPaint)
    painted.get(row.periodId!)!.seasons.push({ id: row.id, name: row.name });
  const specialDayPaint = await tx
    .selectDistinct({
      periodId: departmentDayRanges.periodId,
      id: specialDays.id,
      name: specialDays.name,
      repeatsYearly: specialDays.repeatsYearly,
    })
    .from(departmentDayRanges)
    .innerJoin(departmentDays, eq(departmentDays.id, departmentDayRanges.dayId))
    .innerJoin(specialDayDates, eq(specialDayDates.id, departmentDays.specialDayDateId))
    .innerJoin(specialDays, eq(specialDays.id, specialDayDates.specialDayId))
    .where(and(isNotNull(departmentDayRanges.periodId), onePeriod(departmentDayRanges.periodId)))
    .orderBy(asc(specialDays.name), asc(specialDays.id));
  const oneOffs = [
    ...new Set(specialDayPaint.filter((row) => !row.repeatsYearly).map((row) => row.id)),
  ];
  // A one-off is listed while any of its dates is to come, whichever date paints the period.
  const toCome =
    today === null || oneOffs.length === 0
      ? null
      : new Set(
          (
            await tx
              .selectDistinct({ id: specialDayDates.specialDayId })
              .from(specialDayDates)
              .where(
                and(
                  inArray(specialDayDates.specialDayId, oneOffs),
                  gte(specialDayDates.date, today),
                ),
              )
          ).map((row) => row.id),
        );
  for (const row of specialDayPaint)
    if (row.repeatsYearly || toCome === null || toCome.has(row.id))
      painted.get(row.periodId!)!.specialDays.push({ id: row.id, name: row.name });
  return painted;
}

/** Where each of the venue's periods, or only `periodId`, is painted, keyed by period id. */
export async function readPaintedIn(
  tx: Transaction,
  _cfg: VenueScope,
  at: Date,
  periodId?: string,
): Promise<Map<string, PaintedIn>> {
  return paintedIn(tx, await businessDayAt(tx, at), periodId);
}

/** What the delete dialog shows for `periodId`: seasons and special days counted as Painted in
 *  lists them. */
export async function periodDeleteImpact(
  tx: Transaction,
  cfg: VenueScope,
  periodId: string,
  at: Date,
): Promise<PeriodDeleteImpact> {
  const period = await requirePeriod(tx, cfg, periodId);
  const today = await businessDayAt(tx, at);
  const painted = (await paintedIn(tx, today, periodId)).get(periodId)!;
  const routingUses = (await readRoutingUses(tx, cfg, periodId)).get(periodId) ?? [];
  const replacements = await tx
    .select({ id: menuPeriods.id, name: menuPeriods.name })
    .from(menuPeriods)
    .where(and(eq(menuPeriods.departmentId, period.departmentId), ne(menuPeriods.id, periodId)))
    .orderBy(asc(menuPeriods.name), asc(menuPeriods.id));
  return {
    seasons: painted.seasons.length,
    specialDays: painted.specialDays.length,
    routingUses,
    replacements,
    clockRevision: await readBusinessDayScheduleRevision(tx, cfg),
  };
}

export async function deletePeriod(
  tx: Transaction,
  cfg: VenueScope,
  periodId: string,
  replacementId: string | null,
  at: Date,
  expectedClockRevision: number,
): Promise<void> {
  const period = await requirePeriod(tx, cfg, periodId);
  if (replacementId !== null) {
    const [replacement] =
      replacementId === periodId
        ? []
        : await tx
            .select({ id: menuPeriods.id })
            .from(menuPeriods)
            .where(
              and(
                eq(menuPeriods.id, replacementId),
                eq(menuPeriods.departmentId, period.departmentId),
              ),
            );
    if (replacement === undefined)
      throw new AppError("menu_period.invalid", { field: "replacementPeriodId" });
  }
  const clock = await readVenueClock(tx);
  await assertBusinessDayScheduleWrite(tx, cfg, "time", expectedClockRevision);
  const dayIds = (
    await tx
      .selectDistinct({ dayId: departmentDayRanges.dayId })
      .from(departmentDayRanges)
      .where(eq(departmentDayRanges.periodId, periodId))
  ).map((row) => row.dayId);
  if (replacementId === null) {
    await tx.delete(departmentDayRanges).where(eq(departmentDayRanges.periodId, periodId));
    // A special-day date's row exists only while it holds paint, as saveSpecialDay writes it; a
    // season's row stands for its weekday even when empty.
    if (dayIds.length > 0)
      await tx
        .delete(departmentDays)
        .where(
          and(
            inArray(departmentDays.id, dayIds),
            isNotNull(departmentDays.specialDayDateId),
            notExists(
              tx
                .select({ id: departmentDayRanges.id })
                .from(departmentDayRanges)
                .where(eq(departmentDayRanges.dayId, departmentDays.id)),
            ),
          ),
        );
  } else {
    await tx
      .update(departmentDayRanges)
      .set({ periodId: replacementId })
      .where(eq(departmentDayRanges.periodId, periodId));
    await joinTouchingRanges(tx, dayIds, clock, at);
  }
  await tx.delete(menuPeriods).where(eq(menuPeriods.id, periodId));
  await assertWaitingChangeFits(tx, cfg, at, clock);
}

/** Joins touching ranges of one period within each of `dayIds`' days, ordered from a dated day's
 *  own start, or an undated day's start in force at `at`. */
async function joinTouchingRanges(
  tx: Transaction,
  dayIds: readonly string[],
  clock: BusinessDayClock,
  at: Date,
): Promise<void> {
  if (dayIds.length === 0) return;
  const rows = await tx
    .select({
      id: departmentDayRanges.id,
      dayId: departmentDayRanges.dayId,
      periodId: departmentDayRanges.periodId,
      startsAt: departmentDayRanges.startsAt,
      endsAt: departmentDayRanges.endsAt,
      date: specialDayDates.date,
    })
    .from(departmentDayRanges)
    .innerJoin(departmentDays, eq(departmentDays.id, departmentDayRanges.dayId))
    .leftJoin(specialDayDates, eq(specialDayDates.id, departmentDays.specialDayDateId))
    .where(inArray(departmentDayRanges.dayId, [...dayIds]));
  const undated = inForceClock(clock, at).dayCutover;
  const byDay = new Map<string, typeof rows>();
  for (const row of rows) {
    const day = byDay.get(row.dayId);
    if (day === undefined) byDay.set(row.dayId, [row]);
    else day.push(row);
  }
  for (const ranges of byDay.values()) {
    const date = ranges[0]!.date;
    const cutover = date === null ? undated : cutoverForBusinessDay(clock, date);
    ranges.sort((a, b) => rangeSpan(a, cutover).start - rangeSpan(b, cutover).start);
    const joined = joinTouching(ranges, (a, b) => a.periodId === b.periodId);
    if (joined.length === ranges.length) continue;
    const kept = new Set(joined.map((range) => range.id));
    await tx.delete(departmentDayRanges).where(
      inArray(
        departmentDayRanges.id,
        ranges.filter((range) => !kept.has(range.id)).map((range) => range.id),
      ),
    );
    const endsAt = new Map(ranges.map((range) => [range.id, range.endsAt]));
    for (const range of joined.filter((range) => range.endsAt !== endsAt.get(range.id)))
      await tx
        .update(departmentDayRanges)
        .set({ endsAt: range.endsAt })
        .where(eq(departmentDayRanges.id, range.id));
  }
}
