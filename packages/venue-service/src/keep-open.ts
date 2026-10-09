import { and, eq, ne } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { KeepOpenSubject } from "@waitron/module";
import { readLocationClock } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import { departmentDay, keepOpenSubject, serviceRuns } from "./menu-timetable.js";
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
  clockTimeSkipped,
  minuteOfServiceDay,
  rangeSpan,
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
  const ranges = withExtension(day.ranges, day.extension, clock.dayCutover);
  const subject =
    day.ranges.length === 0 ? null : keepOpenSubject(ranges, day, moment, clock.dayCutover);
  return { departmentId, clock, moment, day, subject };
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
  const start = Math.max(c.moment.minute, endMinute(scheduledEnd(c), c.clock.dayCutover));
  const cutoverMinute =
    Number(c.clock.dayCutover.slice(0, 2)) * 60 + Number(c.clock.dayCutover.slice(3, 5));
  const choices: string[] = [];
  for (
    let minute =
      (Math.floor((start + cutoverMinute) / SERVICE_STEP_MINUTES) + 1) * SERVICE_STEP_MINUTES -
      cutoverMinute;
    minute <= 1440;
    minute += SERVICE_STEP_MINUTES
  ) {
    const time = clockTime(minute, c.clock.dayCutover);
    if (!clockTimeSkipped(c.moment.businessDay, time, c.clock.dayCutover, c.clock.timeZone, true))
      choices.push(time);
  }
  const next = serviceRuns(c.day.ranges).find(
    (range) =>
      range.periodId !== c.subject!.periodId &&
      rangeSpan(range, c.clock.dayCutover).start >=
        endMinute(scheduledEnd(c), c.clock.dayCutover) &&
      rangeSpan(range, c.clock.dayCutover).start <
        (choices.length === 0 ? 0 : endMinute(choices.at(-1)!, c.clock.dayCutover)),
  );
  return {
    zone,
    period: {
      id: c.subject.periodId,
      name: c.subject.periodName,
      endsAt: c.subject.endsAt,
      running: c.subject.running,
      extendedUntil: c.subject.extendedUntil,
      dayEndsAt: c.clock.dayCutover,
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
    const end = endMinute(input.until, c.clock.dayCutover);
    if (end <= c.moment.minute || end <= endMinute(startsAt, c.clock.dayCutover))
      invalid("not_later");
    if (
      clockTimeSkipped(
        c.moment.businessDay,
        input.until,
        c.clock.dayCutover,
        c.clock.timeZone,
        true,
      )
    )
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
  const c = await zoneClosureDay(tx, cfg, zoneId, at);
  const closure =
    c.moment === null
      ? undefined
      : c.ranges.find((range) => rangeSpan(range, c.clock.dayCutover).end > c.moment!.minute);
  const day = await departmentDay(tx, cfg, departmentId, c.moment, c.clock);
  const openRanges =
    day.ranges.length === 0 ? [] : withExtension(day.ranges, day.extension, c.clock.dayCutover);
  const extended =
    c.moment === null || closure === undefined
      ? null
      : zoneExtensionForRange(c.extension, closure, c.clock.dayCutover);
  return { ...c, closure, openRanges, extended };
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
  const start = Math.max(c.moment.minute, rangeSpan(c.closure, c.clock.dayCutover).start);
  const choices: string[] = [];
  for (let minute = start + 1; minute <= 1440; minute++) {
    const time = clockTime(minute, c.clock.dayCutover);
    if (!/:(00|15|30|45)$/.test(time)) continue;
    if (!departmentCovers(c.openRanges, start, minute, c.clock.dayCutover)) continue;
    if (!clockTimeSkipped(c.moment.businessDay, time, c.clock.dayCutover, c.clock.timeZone, true))
      choices.push(time);
  }
  const extended = c.extended;
  const effective = withoutZoneExtension(c.ranges, c.extension, c.clock.dayCutover);
  return {
    id: zoneId,
    name: zone!.name,
    endsAt: extended?.endsAt ?? c.closure.startsAt,
    running: !effective.some((range) => {
      const span = rangeSpan(range, c.clock.dayCutover);
      return span.start <= c.moment!.minute && c.moment!.minute < span.end;
    }),
    extendedUntil: extended?.endsAt ?? null,
    dayEndsAt: c.clock.dayCutover.slice(0, 5),
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
    const end = endMinute(input.until, c.clock.dayCutover);
    const start = Math.max(c.moment.minute, rangeSpan(c.closure, c.clock.dayCutover).start);
    if (end <= start) invalid("not_later");
    if (
      clockTimeSkipped(
        c.moment.businessDay,
        input.until,
        c.clock.dayCutover,
        c.clock.timeZone,
        true,
      )
    )
      invalid("clock_skips");
    if (!departmentCovers(c.openRanges, start, end, c.clock.dayCutover))
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
        rangeSpan(c.extended, c.clock.dayCutover).start <
          rangeSpan(c.closure!, c.clock.dayCutover).start
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
