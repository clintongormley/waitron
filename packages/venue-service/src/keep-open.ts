import { and, eq, ne } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { KeepOpenSubject } from "@waitron/module";
import { readLocationClock } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import { departmentDay, keepOpenSubject, serviceRuns } from "./menu-timetable.js";
import { resolveZoneContext, storedTime, type VenueScope } from "./operations.js";
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
): Promise<{ period: KeepOpenSubject | null }> {
  const c = await context(tx, cfg, zoneId, at);
  if (c.subject === null || c.moment === null) return { period: null };
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
