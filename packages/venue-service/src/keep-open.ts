import { serviceDayContext } from "./service-day-context.js";
import { and, eq, ne } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { KeepOpenSubject } from "@waitron/module";
import { readLocationClock } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import { departmentDay, keepOpenSubject, serviceRuns } from "./menu-timetable.js";
import { readServiceDayPlan } from "./day-resolver.js";
import { resolveZoneContext, storedTime, type VenueScope } from "./operations.js";
import { floorZones } from "@waitron/db";
import {
  zoneClosureDay,
  withoutZoneExtension,
  zoneExtensionForRange,
} from "./zone-closed-times.js";
import { zoneExtensions } from "./schema/zone-extensions.js";
import { periodExtensions } from "./schema/period-extensions.js";
import {
  clockTimeSkippedInDay,
  minuteOfServiceDay,
  rangeSpan,
  rangeSpanInDay,
  serviceMomentAt,
  withExtension,
  SERVICE_STEP_MINUTES,
} from "./service-day.js";
import "./errors.js";

export type { KeepOpenSubject } from "@waitron/module";

async function context(tx: Transaction, cfg: VenueScope, zoneId: string, at: Date) {
  const { departmentId } = await resolveZoneContext(tx, cfg, zoneId);
  const clock = await readLocationClock(tx, cfg.locationId);
  const moment = serviceMomentAt(at, clock);
  const day = await departmentDay(tx, cfg, departmentId, moment, clock);
  const dayContext = moment === null ? null : serviceDayContext(clock, moment.businessDay);
  const cutover = dayContext?.dayCutover ?? clock.dayCutover;
  const limit = Math.min(dayContext?.endMinute ?? 1440, 1440);
  const ranges = withExtension(day.ranges, day.extension, cutover);
  const subject =
    day.ranges.length === 0
      ? null
      : keepOpenSubject(ranges, day, moment, cutover, dayContext ?? undefined);
  return { departmentId, clock, moment, day, subject, dayContext, cutover, limit };
}

function endMinute(time: string, cutover: string): number {
  return minuteOfServiceDay(time, cutover) || 1440;
}

function clockTime(minute: number, cutover: string): string {
  const total = (minute + Number(cutover.slice(0, 2)) * 60 + Number(cutover.slice(3, 5))) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function scheduledEnd(c: Awaited<ReturnType<typeof context>>): string {
  return c.day.extension?.periodId === c.subject!.periodId
    ? c.day.extension.startsAt
    : c.subject!.endsAt;
}

export async function readKeepOpen(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  at: Date,
): Promise<{ period: KeepOpenSubject | null; zone: KeepOpenSubject | null }> {
  const c = await context(tx, cfg, zoneId, at);
  const zone = await readZoneKeepOpen(tx, cfg, zoneId, at);
  if (c.subject === null || c.moment === null) return { period: null, zone };
  const start = Math.max(c.moment.minute, endMinute(scheduledEnd(c), c.cutover));
  const cutoverMinute = Number(c.cutover.slice(0, 2)) * 60 + Number(c.cutover.slice(3, 5));
  const choices: string[] = [];
  for (
    let minute =
      (Math.floor((start + cutoverMinute) / SERVICE_STEP_MINUTES) + 1) * SERVICE_STEP_MINUTES -
      cutoverMinute;
    minute <= c.limit;
    minute += SERVICE_STEP_MINUTES
  ) {
    const time = clockTime(minute, c.cutover);
    if (!clockTimeSkippedInDay(c.clock, c.moment.businessDay, time, true)) choices.push(time);
  }
  const next = serviceRuns(c.day.ranges).find(
    (range) =>
      range.periodId !== c.subject!.periodId &&
      rangeSpan(range, c.cutover).start >= endMinute(scheduledEnd(c), c.cutover) &&
      rangeSpan(range, c.cutover).start <
        (choices.length === 0 ? 0 : endMinute(choices.at(-1)!, c.cutover)),
  );
  return {
    zone,
    period: {
      id: c.subject.periodId,
      name: c.subject.periodName,
      endsAt: c.subject.endsAt,
      running: c.subject.running,
      extendedUntil: c.subject.extendedUntil,
      dayEndsAt: clockTime(c.dayContext?.endMinute ?? 1440, c.cutover),
      choices,
      next:
        next === undefined
          ? null
          : {
              name: c.day.periods.find((period) => period.id === next.periodId)!.name,
              startsAt: next.startsAt,
              endsAt: next.endsAt,
            },
    },
  };
}

export async function keepPeriodOpen(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  input: { periodId: string; until: string | null },
  at: Date,
): Promise<void> {
  const c = await context(tx, cfg, zoneId, at);
  if (c.moment === null) throw new AppError("time_zone.unreadable", {});
  if (c.subject?.periodId !== input.periodId)
    throw new AppError("period_extension.not_allowed", { periodId: input.periodId });
  const startsAt = scheduledEnd(c);
  if (input.until !== null) {
    const invalid = (reason: "step" | "not_later" | "clock_skips"): never => {
      throw new AppError("period_extension.invalid", { field: "until", reason });
    };
    if (!/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/.test(input.until)) invalid("step");
    const end = endMinute(input.until, c.cutover);
    if (end > c.limit || end <= c.moment.minute || end <= endMinute(startsAt, c.cutover))
      invalid("not_later");
    if (clockTimeSkippedInDay(c.clock, c.moment.businessDay, input.until, true))
      invalid("clock_skips");
  }
  await tx
    .delete(periodExtensions)
    .where(
      and(
        eq(periodExtensions.departmentId, c.departmentId),
        ne(periodExtensions.businessDay, c.moment.businessDay),
      ),
    );
  if (input.until === null) {
    await tx
      .delete(periodExtensions)
      .where(
        and(
          eq(periodExtensions.departmentId, c.departmentId),
          eq(periodExtensions.businessDay, c.moment.businessDay),
        ),
      );
    return;
  }
  const values = {
    departmentId: c.departmentId,
    businessDay: c.moment.businessDay,
    periodId: input.periodId,
    startsAt: storedTime(startsAt),
    endsAt: storedTime(input.until),
  };
  await tx
    .insert(periodExtensions)
    .values(values)
    .onConflictDoUpdate({
      target: [periodExtensions.departmentId, periodExtensions.businessDay],
      set: { periodId: values.periodId, startsAt: values.startsAt, endsAt: values.endsAt },
    });
}

async function zoneContext(tx: Transaction, cfg: VenueScope, zoneId: string, at: Date) {
  const { departmentId } = await resolveZoneContext(tx, cfg, zoneId);
  const prepared = await readServiceDayPlan(tx, cfg, at);
  const c = await zoneClosureDay(tx, cfg, zoneId, at, prepared);
  const closure =
    c.moment === null
      ? undefined
      : c.ranges.find((range) => rangeSpanInDay(range, c.dayContext).end > c.moment!.minute);
  const day = await departmentDay(tx, cfg, departmentId, c.moment, c.clock, prepared.plan);
  const openRanges =
    day.ranges.length === 0 ? [] : withExtension(day.ranges, day.extension, c.cutover);
  const extended =
    c.moment === null || closure === undefined
      ? null
      : zoneExtensionForRange(c.extension, closure, c.cutover);
  return {
    ...c,
    closure,
    openRanges,
    extended,
    limit: Math.min(c.dayContext?.endMinute ?? 1440, 1440),
  };
}

function departmentCovers(
  ranges: readonly { startsAt: string; endsAt: string }[],
  start: number,
  end: number,
  cutover: string,
): boolean {
  let cursor = start;
  for (const range of ranges) {
    const span = rangeSpan(range, cutover);
    if (span.end <= cursor) continue;
    if (span.start > cursor) return false;
    cursor = span.end;
    if (cursor >= end) return true;
  }
  return false;
}

export async function readZoneKeepOpen(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  at: Date,
): Promise<KeepOpenSubject | null> {
  const c = await zoneContext(tx, cfg, zoneId, at);
  if (c.moment === null || c.closure === undefined) return null;
  const [zone] = await tx
    .select({ name: floorZones.name })
    .from(floorZones)
    .where(eq(floorZones.id, zoneId));
  const start = Math.max(c.moment.minute, rangeSpan(c.closure, c.cutover).start);
  const choices: string[] = [];
  for (let minute = start + 1; minute <= c.limit; minute++) {
    const time = clockTime(minute, c.cutover);
    if (!/:(00|15|30|45)$/.test(time)) continue;
    if (!departmentCovers(c.openRanges, start, minute, c.cutover)) continue;
    if (!clockTimeSkippedInDay(c.clock, c.moment.businessDay, time, true)) choices.push(time);
  }
  const extended = c.extended;
  const effective = withoutZoneExtension(c.ranges, c.extension, c.cutover);
  return {
    id: zoneId,
    name: zone!.name,
    endsAt: extended?.endsAt ?? c.closure.startsAt,
    running: !effective.some((range) => {
      const span = rangeSpanInDay(range, c.dayContext);
      return span.start <= c.moment!.minute && c.moment!.minute < span.end;
    }),
    extendedUntil: extended?.endsAt ?? null,
    dayEndsAt: clockTime(c.dayContext?.endMinute ?? 1440, c.cutover),
    choices,
    next: null,
  };
}

export async function keepZoneOpen(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  input: { until: string | null },
  at: Date,
): Promise<void> {
  const c = await zoneContext(tx, cfg, zoneId, at);
  if (c.moment === null) throw new AppError("time_zone.unreadable", {});
  if (input.until !== null) {
    if (c.closure === undefined)
      throw new AppError("zone_extension.not_allowed", { zoneId, reason: "not_closing" });
    const invalid = (reason: "step" | "not_later" | "clock_skips"): never => {
      throw new AppError("zone_extension.invalid", { field: "until", reason });
    };
    if (!/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/.test(input.until)) invalid("step");
    const end = endMinute(input.until, c.cutover);
    const start = Math.max(c.moment.minute, rangeSpan(c.closure, c.cutover).start);
    if (end > c.limit || end <= start) invalid("not_later");
    if (clockTimeSkippedInDay(c.clock, c.moment.businessDay, input.until, true))
      invalid("clock_skips");
    if (!departmentCovers(c.openRanges, start, end, c.cutover))
      throw new AppError("zone_extension.not_allowed", { zoneId, reason: "department_closed" });
  }
  await tx
    .delete(zoneExtensions)
    .where(
      and(eq(zoneExtensions.zoneId, zoneId), ne(zoneExtensions.businessDay, c.moment.businessDay)),
    );
  if (input.until === null) {
    await tx
      .delete(zoneExtensions)
      .where(
        and(
          eq(zoneExtensions.zoneId, zoneId),
          eq(zoneExtensions.businessDay, c.moment.businessDay),
        ),
      );
    return;
  }
  const values = {
    zoneId,
    businessDay: c.moment.businessDay,
    startsAt: storedTime(
      c.extended !== null &&
        rangeSpan(c.extended, c.cutover).start < rangeSpan(c.closure!, c.cutover).start
        ? c.extended.startsAt
        : c.closure!.startsAt,
    ),
    endsAt: storedTime(input.until),
  };
  await tx
    .insert(zoneExtensions)
    .values(values)
    .onConflictDoUpdate({
      target: [zoneExtensions.zoneId, zoneExtensions.businessDay],
      set: { startsAt: values.startsAt, endsAt: values.endsAt },
    });
}
