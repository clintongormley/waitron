import { and, asc, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
import {
  openingHours,
  menuPeriods,
  readVenueClock,
  seasons,
  specialDayDates,
  specialDays,
  type Transaction,
} from "@waitron/db";
import { AppError, cutoverForBusinessDay, type BusinessDayClock } from "@waitron/shared";
import { writeHours, readBusinessDayScheduleRevision } from "./business-day-schedule.js";
import type { LocalDate } from "./hours-types.js";
import { readRoutingUses, requirePeriod } from "./menu-timetable.js";
import type { PeriodRoutingUse } from "./menu-timetable-types.js";
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
  const onePeriod = (column: typeof menuPeriods.id | typeof openingHours.periodId) =>
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
      periodId: openingHours.periodId,
      id: seasons.id,
      name: seasons.name,
      startsOn: seasons.startsOn,
    })
    .from(openingHours)
    .innerJoin(seasons, eq(seasons.id, openingHours.seasonId))
    .where(and(isNotNull(openingHours.periodId), onePeriod(openingHours.periodId)))
    .orderBy(asc(seasons.startsOn), asc(seasons.id));
  for (const row of seasonPaint)
    painted.get(row.periodId!)!.seasons.push({ id: row.id, name: row.name });
  const specialDayPaint = await tx
    .selectDistinct({
      periodId: openingHours.periodId,
      id: specialDays.id,
      name: specialDays.name,
      repeatsYearly: specialDays.repeatsYearly,
    })
    .from(openingHours)
    .innerJoin(specialDayDates, eq(specialDayDates.id, openingHours.specialDayDateId))
    .innerJoin(specialDays, eq(specialDays.id, specialDayDates.specialDayId))
    .where(and(isNotNull(openingHours.periodId), onePeriod(openingHours.periodId)))
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
  at: Date,
  periodId?: string,
): Promise<Map<string, PaintedIn>> {
  return paintedIn(tx, await businessDayAt(tx, at), periodId);
}

/** What the delete dialog shows for `periodId`: seasons and special days counted as Painted in
 *  lists them. */
export async function periodDeleteImpact(
  tx: Transaction,
  periodId: string,
  at: Date,
  language?: string,
): Promise<PeriodDeleteImpact> {
  const period = await requirePeriod(tx, periodId);
  const today = await businessDayAt(tx, at);
  const painted = (await paintedIn(tx, today, periodId)).get(periodId)!;
  const routingUses = (await readRoutingUses(tx, periodId, language)).get(periodId) ?? [];
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
    clockRevision: await readBusinessDayScheduleRevision(tx),
  };
}

export async function deletePeriod(
  tx: Transaction,
  periodId: string,
  replacementId: string | null,
  at: Date,
  expectedClockRevision: number,
): Promise<void> {
  const period = await requirePeriod(tx, periodId);
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
  await writeHours(tx, { at, clock, changeKind: "time", expectedClockRevision }, async () => {
    const dayKeys = await tx
      .selectDistinct({
        departmentId: openingHours.departmentId,
        seasonId: openingHours.seasonId,
        weekday: openingHours.weekday,
        specialDayDateId: openingHours.specialDayDateId,
      })
      .from(openingHours)
      .where(eq(openingHours.periodId, periodId));
    if (replacementId === null) {
      await tx.delete(openingHours).where(eq(openingHours.periodId, periodId));
    } else {
      await tx
        .update(openingHours)
        .set({ periodId: replacementId })
        .where(eq(openingHours.periodId, periodId));
      await joinTouchingRanges(tx, period.departmentId, dayKeys, clock, at);
    }
    await tx.delete(menuPeriods).where(eq(menuPeriods.id, periodId));
  });
}

type DayKey = Pick<
  typeof openingHours.$inferSelect,
  "departmentId" | "seasonId" | "weekday" | "specialDayDateId"
>;
const dayKey = (row: DayKey) =>
  `${row.departmentId}|${row.seasonId ?? ""}|${row.weekday ?? ""}|${row.specialDayDateId ?? ""}`;

async function joinTouchingRanges(
  tx: Transaction,
  departmentId: string,
  days: readonly DayKey[],
  clock: BusinessDayClock,
  at: Date,
): Promise<void> {
  if (days.length === 0) return;
  const rows = await tx
    .select({
      id: openingHours.id,
      departmentId: openingHours.departmentId,
      seasonId: openingHours.seasonId,
      weekday: openingHours.weekday,
      specialDayDateId: openingHours.specialDayDateId,
      periodId: openingHours.periodId,
      startsAt: openingHours.startsAt,
      endsAt: openingHours.endsAt,
      date: specialDayDates.date,
    })
    .from(openingHours)
    .leftJoin(specialDayDates, eq(specialDayDates.id, openingHours.specialDayDateId))
    .where(eq(openingHours.departmentId, departmentId));
  const affected = new Set(days.map(dayKey));
  const undated = inForceClock(clock, at).dayCutover;
  const byDay = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!affected.has(dayKey(row))) continue;
    const day = byDay.get(dayKey(row));
    if (day === undefined) byDay.set(dayKey(row), [row]);
    else day.push(row);
  }
  for (const ranges of byDay.values()) {
    const date = ranges[0]!.date;
    const cutover = date === null ? undated : cutoverForBusinessDay(clock, date);
    ranges.sort((a, b) => rangeSpan(a, cutover).start - rangeSpan(b, cutover).start);
    const joined = joinTouching(ranges, (a, b) => a.periodId === b.periodId);
    if (joined.length === ranges.length) continue;
    const kept = new Set(joined.map((range) => range.id));
    await tx.delete(openingHours).where(
      inArray(
        openingHours.id,
        ranges.filter((range) => !kept.has(range.id)).map((range) => range.id),
      ),
    );
    const endsAt = new Map(ranges.map((range) => [range.id, range.endsAt]));
    for (const range of joined.filter((range) => range.endsAt !== endsAt.get(range.id)))
      await tx
        .update(openingHours)
        .set({ endsAt: range.endsAt })
        .where(eq(openingHours.id, range.id));
  }
}
