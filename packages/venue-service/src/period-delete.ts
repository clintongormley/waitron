import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import type { LocalDate } from "./hours-types.js";
import { readRoutingUses, requirePeriod } from "./menu-timetable.js";
import type { PeriodRoutingUse } from "./menu-timetable-types.js";
import type { VenueScope } from "./operations.js";
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
import { serviceMomentAt } from "./service-day.js";
import "./errors.js";

export interface PaintedIn {
  seasons: { id: string; name: string }[];
  /** Each has a date on or after today's business day, or repeats yearly. */
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
    .where(and(eq(departments.locationId, cfg.locationId), onePeriod(menuPeriods.id)));
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
