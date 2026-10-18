import { and, eq, inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { DueFloorLayout } from "@waitron/module";
import type { BusinessDayClock, LocationId } from "@waitron/shared";
import { readLocationClock } from "@waitron/reporting";
import { readDayPlan, resolveDepartmentsDays } from "./day-resolver.js";
import { serviceRuns } from "./menu-timetable.js";
import { wireTime } from "./operations.js";
import { periodExtensions } from "./schema/period-extensions.js";
import { departmentFloorPlanSets } from "./schema/floor-plan-sets.js";
import { menuPeriods } from "./schema/menus.js";
import { departments, zoneServicePolicies } from "./schema/service.js";
import {
  rangeSpanInDay,
  serviceMomentAt,
  withExtension,
  type ServiceMoment,
  type ServiceRange,
} from "./service-day.js";
import { serviceDayContext, type ServiceDayContext } from "./service-day-context.js";

export interface RecordedRun {
  periodId: string;
  startsAt: string;
}

/** `runs` is `serviceRuns(withExtension(painted, extension, cutover))`: a keep open joins the
 *  range it extends into one run. */
export interface DueDay {
  painted: readonly ServiceRange[];
  extension: ServiceRange | null;
  runs: readonly ServiceRange[];
}

export function occurrenceKey(
  departmentId: string,
  businessDay: string,
  run: ServiceRange,
): string {
  return JSON.stringify([departmentId, businessDay, run.periodId, run.startsAt]);
}

export function recordedRun(
  key: string | null,
  departmentId: string,
  businessDay: string,
): RecordedRun | null {
  if (key === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    return null;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 4 ||
    !parsed.every((part) => typeof part === "string")
  )
    return null;
  const [department, day, periodId, startsAt] = parsed as string[];
  return department === departmentId && day === businessDay
    ? { periodId: periodId!, startsAt: startsAt! }
    : null;
}

/** A missing start still matches only the run `withExtension` made by cutting the recorded
 *  painted range at today's keep open's end (plan decision 22); anything else is gone. */
export function matchRecorded(
  day: DueDay,
  recorded: RecordedRun,
  context: ServiceDayContext,
): ServiceRange | null {
  const same = day.runs.find(
    (run) => run.periodId === recorded.periodId && run.startsAt === recorded.startsAt,
  );
  if (same !== undefined) return same;
  const { extension } = day;
  if (extension === null) return null;
  const kept = rangeSpanInDay(extension, context);
  const cut = day.painted.find(
    (range) => range.periodId === recorded.periodId && range.startsAt === recorded.startsAt,
  );
  if (cut === undefined) return null;
  const span = rangeSpanInDay(cut, context);
  if (span.start < kept.start || span.start >= kept.end || span.end <= kept.end) return null;
  return (
    day.runs.find(
      (run) => run.periodId === recorded.periodId && run.startsAt === extension.endsAt,
    ) ?? null
  );
}

/** Running → next later today → last that ran today; never a run starting earlier than the
 *  recorded one (spec decision 4), which applies only while the record still matches a run. */
export function dueRun(input: {
  day: DueDay;
  minute: number;
  context: ServiceDayContext;
  recorded: RecordedRun | null;
}): ServiceRange | null {
  const { day, minute, context, recorded } = input;
  const matched = recorded === null ? null : matchRecorded(day, recorded, context);
  const floor = matched === null ? -Infinity : rangeSpanInDay(matched, context).start;
  const runs = day.runs
    .map((run) => ({ run, span: rangeSpanInDay(run, context) }))
    .filter(({ span }) => span.start >= floor);
  const running = runs.find(({ span }) => span.start <= minute && minute < span.end);
  const next = runs.find(({ span }) => span.start > minute);
  const last = runs.filter(({ span }) => span.end <= minute).at(-1);
  return (running ?? next ?? last)?.run ?? null;
}

const NO_LAYOUT: DueFloorLayout = {
  setId: null,
  setName: null,
  occurrence: null,
  periodName: null,
};

/** The due run's period's set, else the department's default; a zone's own closed times and
 *  keep open play no part (plan decision 7). */
export async function dueFloorLayouts(
  tx: Transaction,
  cfg: { locationId: LocationId },
  zones: readonly { zoneId: string; recordedOccurrence: string | null }[],
  at: Date,
): Promise<ReadonlyMap<string, DueFloorLayout>> {
  const result = new Map<string, DueFloorLayout>(zones.map(({ zoneId }) => [zoneId, NO_LAYOUT]));
  const placed = await tx
    .select({ zoneId: zoneServicePolicies.zoneId, departmentId: zoneServicePolicies.departmentId })
    .from(zoneServicePolicies)
    .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .where(
      and(
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(departments.locationId, cfg.locationId),
        eq(departments.active, true),
        inArray(
          zoneServicePolicies.zoneId,
          zones.map(({ zoneId }) => zoneId),
        ),
      ),
    );
  const departmentOf = new Map(placed.map((row) => [row.zoneId, row.departmentId]));
  const departmentIds = [...new Set(placed.map((row) => row.departmentId))];
  const sets = await tx
    .select({
      setId: departmentFloorPlanSets.setId,
      departmentId: departmentFloorPlanSets.departmentId,
      name: departmentFloorPlanSets.name,
      isDefault: departmentFloorPlanSets.isDefault,
    })
    .from(departmentFloorPlanSets)
    .where(inArray(departmentFloorPlanSets.departmentId, departmentIds));
  const withSets = departmentIds.filter((id) => sets.some((set) => set.departmentId === id));
  if (withSets.length === 0) return result;
  const periods = await tx
    .select({ id: menuPeriods.id, name: menuPeriods.name, setId: menuPeriods.floorPlanSetId })
    .from(menuPeriods)
    .where(inArray(menuPeriods.departmentId, withSets));
  const periodOf = new Map(periods.map((row) => [row.id, row]));
  const clock = await readLocationClock(tx, cfg.locationId);
  const moment = serviceMomentAt(at, clock);
  const today = moment === null ? null : await dueDays(tx, cfg, withSets, moment, clock);
  for (const departmentId of withSets) {
    const own = sets.filter((set) => set.departmentId === departmentId);
    const fallback = own.find((set) => set.isDefault);
    for (const { zoneId, recordedOccurrence } of zones) {
      if (departmentOf.get(zoneId) !== departmentId) continue;
      const run =
        today === null
          ? null
          : dueRun({
              day: today.days.get(departmentId)!,
              minute: today.moment.minute,
              context: today.context,
              recorded: recordedRun(recordedOccurrence, departmentId, today.moment.businessDay),
            });
      const period = run === null ? undefined : periodOf.get(run.periodId);
      const set = own.find((entry) => entry.setId === period?.setId) ?? fallback;
      result.set(zoneId, {
        setId: set?.setId ?? null,
        setName: set?.name ?? null,
        occurrence:
          run === null ? null : occurrenceKey(departmentId, today!.moment.businessDay, run),
        periodName: period?.name ?? null,
      });
    }
  }
  return result;
}

/** Each department's painted day, keep open and runs on `moment`'s business day, read with a
 *  number of statements independent of how many departments there are. */
async function dueDays(
  tx: Transaction,
  cfg: { locationId: LocationId },
  departmentIds: readonly string[],
  moment: ServiceMoment,
  clock: BusinessDayClock,
): Promise<{ moment: ServiceMoment; context: ServiceDayContext; days: Map<string, DueDay> }> {
  const { businessDay } = moment;
  const context = serviceDayContext(clock, businessDay);
  const resolved = await resolveDepartmentsDays(
    tx,
    cfg,
    departmentIds,
    [businessDay],
    clock,
    await readDayPlan(tx, cfg, [businessDay]),
  );
  const extensions = await tx
    .select({
      departmentId: periodExtensions.departmentId,
      periodId: periodExtensions.periodId,
      startsAt: periodExtensions.startsAt,
      endsAt: periodExtensions.endsAt,
    })
    .from(periodExtensions)
    .where(
      and(
        inArray(periodExtensions.departmentId, [...departmentIds]),
        eq(periodExtensions.businessDay, businessDay),
      ),
    );
  const days = new Map<string, DueDay>();
  for (const departmentId of departmentIds) {
    const painted = resolved.get(departmentId)!.get(businessDay)!.ranges;
    const row = extensions.find((entry) => entry.departmentId === departmentId);
    const extension =
      row === undefined
        ? null
        : {
            periodId: row.periodId,
            startsAt: wireTime(row.startsAt),
            endsAt: wireTime(row.endsAt),
          };
    days.set(departmentId, {
      painted,
      extension,
      runs: serviceRuns(withExtension(painted, extension, context.dayCutover)),
    });
  }
  return { moment, context, days };
}
