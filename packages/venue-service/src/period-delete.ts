import { and, asc, eq, inArray, isNotNull, ne, notExists } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError, cutoverForBusinessDay, type BusinessDayClock } from "@waitron/shared";
import { assertBusinessDayScheduleWrite } from "./business-day-schedule.js";
import type { LocalDate } from "./hours-types.js";
import { departmentEndOffsetClash, readRoutingUses, requirePeriod } from "./menu-timetable.js";
import { invalidTimetable } from "./menu-timetable-rules.js";
import type { PeriodRoutingUse } from "./menu-timetable-types.js";
import type { VenueScope } from "./operations.js";
import { menuPeriods } from "./schema/menus.js";
import { periodExtensions } from "./schema/period-extensions.js";
import { routingCellPeriods } from "./schema/routing.js";
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
      date: specialDayDates.date,
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
  for (const row of specialDayPaint) {
    if (today !== null && !row.repeatsYearly && row.date < today) continue;
    const list = painted.get(row.periodId!)!.specialDays;
    // A special day's rows are adjacent, by the order above.
    if (list.at(-1)?.id !== row.id) list.push({ id: row.id, name: row.name });
  }
  return painted;
}

/** Where each of the venue's periods is painted, keyed by period id. */
export async function readPaintedIn(
  tx: Transaction,
  cfg: VenueScope,
  at: Date,
): Promise<Map<string, PaintedIn>> {
  return paintedIn(tx, cfg, await businessDayAt(tx, cfg, at));
}

/** What deleting `periodId` would change, counted as Painted in lists it. */
export async function periodDeleteImpact(
  tx: Transaction,
  cfg: VenueScope,
  periodId: string,
  at: Date,
): Promise<PeriodDeleteImpact> {
  const period = await requirePeriod(tx, cfg, periodId);
  const today = await businessDayAt(tx, cfg, at);
  const painted = (await paintedIn(tx, cfg, today, periodId)).get(periodId)!;
  const routingUses = (await readRoutingUses(tx, cfg)).get(periodId) ?? [];
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
  await assertBusinessDayScheduleWrite(tx, cfg, "time", at, expectedClockRevision, clock);
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
    // A cell holds one line per period (routing_cell_periods_cell_period_key), so the period's
    // line goes where the replacement already has one before the rest are renamed.
    const replacementCells = tx
      .select({ cellId: routingCellPeriods.cellId })
      .from(routingCellPeriods)
      .where(eq(routingCellPeriods.periodId, replacementId));
    await tx
      .delete(routingCellPeriods)
      .where(
        and(
          eq(routingCellPeriods.periodId, periodId),
          inArray(routingCellPeriods.cellId, replacementCells),
        ),
      );
    await tx
      .update(routingCellPeriods)
      .set({ periodId: replacementId })
      .where(eq(routingCellPeriods.periodId, periodId));
    await tx
      .update(departmentDayRanges)
      .set({ periodId: replacementId })
      .where(eq(departmentDayRanges.periodId, periodId));
    await joinTouchingRanges(tx, dayIds, clock);
    await tx
      .update(periodExtensions)
      .set({ periodId: replacementId })
      .where(eq(periodExtensions.periodId, periodId));
  }
  await tx.delete(menuPeriods).where(eq(menuPeriods.id, periodId));
  const clash = await departmentEndOffsetClash(tx, cfg, period.departmentId, clock);
  if (clash !== null)
    invalidTimetable(replacementId === null ? "periodId" : "replacementPeriodId", {
      reason: "end_offset",
      ...clash,
    });
}

/** Joins touching ranges of one period within each of `dayIds`' days, ordered from the day's
 *  changeover. */
async function joinTouchingRanges(
  tx: Transaction,
  dayIds: readonly string[],
  clock: BusinessDayClock,
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
  const byDay = new Map<string, typeof rows>();
  for (const row of rows) {
    const day = byDay.get(row.dayId);
    if (day === undefined) byDay.set(row.dayId, [row]);
    else day.push(row);
  }
  for (const ranges of byDay.values()) {
    const date = ranges[0]!.date;
    const cutover = date === null ? clock.dayCutover : cutoverForBusinessDay(clock, date);
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
