import { and, asc, eq, gte, inArray, isNotNull, ne, notExists } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError, cutoverForBusinessDay, type BusinessDayClock } from "@waitron/shared";
import {
  assertBusinessDayScheduleWrite,
  assertWaitingChangeFits,
  readBusinessDayScheduleRevision,
} from "./business-day-schedule.js";
import { resolveDepartmentDays } from "./day-resolver.js";
import type { LocalDate } from "./hours-types.js";
import { departmentEndOffsetClash, readRoutingUses, requirePeriod } from "./menu-timetable.js";
import { invalidTimetable } from "./menu-timetable-rules.js";
import type { PeriodRoutingUse } from "./menu-timetable-types.js";
import { storedTime, wireTime, type VenueScope } from "./operations.js";
import { menuPeriods } from "./schema/menus.js";
import { periodExtensions } from "./schema/period-extensions.js";
import {
  departmentDayRanges,
  departmentDays,
  seasons,
  specialDayDates,
  specialDays,
} from "./schema/seasons.js";
import { departments } from "./schema/service.js";
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
  keptOpenToday: boolean;
  /** The department's other periods. */
  replacements: { id: string; name: string }[];
  /** The revision this impact was read under, for the delete to send back. */
  clockRevision: number;
}

/** The business day holding `at`, or null when the venue's clock cannot be read. */
async function businessDayAt(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
): Promise<LocalDate | null> {
  return serviceMomentAt(at, await readLocationClock(tx, cfg.locationId))?.businessDay ?? null;
}

/** Every period of the venue, each with where it is painted. With no `today` (an unreadable
 *  clock) every special day painting a period is listed, past ones included. */
async function paintedIn(
  tx: Transaction,
  cfg: VenueScope,
  today: LocalDate | null,
  periodId?: string,
): Promise<Map<string, PaintedIn>> {
  const onePeriod = (column: typeof menuPeriods.id | typeof departmentDayRanges.periodId) =>
    periodId === undefined ? undefined : eq(column, periodId);
  const periods = await tx
    .select({ id: menuPeriods.id })
    .from(menuPeriods)
    .innerJoin(departments, eq(departments.id, menuPeriods.departmentId))
    .where(and(eq(departments.locationId, cfg.locationId), onePeriod(menuPeriods.id)))
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
    .innerJoin(departments, eq(departments.id, departmentDayRanges.departmentId))
    .where(
      and(
        eq(departments.locationId, cfg.locationId),
        isNotNull(departmentDayRanges.periodId),
        onePeriod(departmentDayRanges.periodId),
      ),
    )
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
    .innerJoin(departments, eq(departments.id, departmentDayRanges.departmentId))
    .where(
      and(
        eq(departments.locationId, cfg.locationId),
        isNotNull(departmentDayRanges.periodId),
        onePeriod(departmentDayRanges.periodId),
      ),
    )
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
  cfg: VenueScope,
  at: Date,
  periodId?: string,
): Promise<Map<string, PaintedIn>> {
  return paintedIn(tx, cfg, await businessDayAt(tx, cfg, at), periodId);
}

/**
 * What the delete dialog shows for `periodId`: seasons and special days counted as Painted in
 * lists them, and today's extension only.
 */
export async function periodDeleteImpact(
  tx: Transaction,
  cfg: VenueScope,
  periodId: string,
  at: Date,
): Promise<PeriodDeleteImpact> {
  const period = await requirePeriod(tx, cfg, periodId);
  const today = await businessDayAt(tx, cfg, at);
  const painted = (await paintedIn(tx, cfg, today, periodId)).get(periodId)!;
  const routingUses = (await readRoutingUses(tx, cfg, periodId)).get(periodId) ?? [];
  const kept =
    today === null
      ? []
      : await tx
          .select({ id: periodExtensions.id })
          .from(periodExtensions)
          .where(
            and(eq(periodExtensions.periodId, periodId), eq(periodExtensions.businessDay, today)),
          );
  const replacements = await tx
    .select({ id: menuPeriods.id, name: menuPeriods.name })
    .from(menuPeriods)
    .where(and(eq(menuPeriods.departmentId, period.departmentId), ne(menuPeriods.id, periodId)))
    .orderBy(asc(menuPeriods.name), asc(menuPeriods.id));
  return {
    seasons: painted.seasons.length,
    specialDays: painted.specialDays.length,
    routingUses,
    keptOpenToday: kept.length > 0,
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
  const clock = await readLocationClock(tx, cfg.locationId);
  await assertBusinessDayScheduleWrite(tx, cfg, "time", at, expectedClockRevision);
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
    await fitExtensionsToReplacement(tx, cfg, period.departmentId, periodId, replacementId, clock);
    await tx
      .update(periodExtensions)
      .set({ periodId: replacementId })
      .where(eq(periodExtensions.periodId, periodId));
  }
  await tx.delete(menuPeriods).where(eq(menuPeriods.id, periodId));
  const clash = await departmentEndOffsetClash(
    tx,
    cfg,
    period.departmentId,
    inForceClock(clock, at),
  );
  if (clash !== null)
    invalidTimetable(replacementId === null ? "periodId" : "replacementPeriodId", {
      reason: "end_offset",
      ...clash,
    });
  await assertWaitingChangeFits(tx, cfg, at, clock);
}

async function fitExtensionsToReplacement(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  periodId: string,
  replacementId: string,
  clock: BusinessDayClock,
): Promise<void> {
  const extensions = await tx
    .select({
      id: periodExtensions.id,
      businessDay: periodExtensions.businessDay,
      startsAt: periodExtensions.startsAt,
      endsAt: periodExtensions.endsAt,
    })
    .from(periodExtensions)
    .where(eq(periodExtensions.periodId, periodId));
  if (extensions.length === 0) return;
  const days = await resolveDepartmentDays(
    tx,
    cfg,
    departmentId,
    [...new Set(extensions.map((row) => row.businessDay))],
    clock,
  );
  for (const row of extensions) {
    const cutover = cutoverForBusinessDay(clock, row.businessDay);
    const extension = rangeSpan(
      { startsAt: wireTime(row.startsAt), endsAt: wireTime(row.endsAt) },
      cutover,
    );
    const covering = days
      .get(row.businessDay)!
      .ranges.map((range) => ({ range, span: rangeSpan(range, cutover) }))
      .find(
        ({ range, span }) =>
          range.periodId === replacementId &&
          span.start <= extension.start &&
          extension.start < span.end,
      );
    if (covering === undefined) continue;
    if (covering.span.end >= extension.end)
      await tx.delete(periodExtensions).where(eq(periodExtensions.id, row.id));
    else
      await tx
        .update(periodExtensions)
        .set({ startsAt: storedTime(covering.range.endsAt) })
        .where(eq(periodExtensions.id, row.id));
  }
}

/** Joins touching ranges of one period within each of `dayIds`' days, ordered from the day's
 *  changeover. */
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
