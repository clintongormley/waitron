import { and, eq, ne } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { KeepOpenSubject } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { departmentDay } from "./menu-timetable.js";
import { readServiceDayPlan } from "./day-resolver.js";
import { resolveZoneContext, storedTime, type VenueScope } from "./operations.js";
import { floorZones } from "@waitron/db";
import {
  zoneClosureDay,
  withoutZoneExtension,
  zoneExtensionForRange,
} from "./zone-closed-times.js";
import { zoneExtensions } from "./schema/zone-extensions.js";
import {
  clockTimeSkippedInDay,
  minuteOfServiceDay,
  rangeSpan,
  rangeSpanInDay,
  withExtension,
} from "./service-day.js";
import "./errors.js";

export type { KeepOpenSubject } from "@waitron/module";

function endMinute(time: string, cutover: string): number {
  return minuteOfServiceDay(time, cutover) || 1440;
}

function clockTime(minute: number, cutover: string): string {
  const total = (minute + Number(cutover.slice(0, 2)) * 60 + Number(cutover.slice(3, 5))) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export async function readKeepOpen(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  at: Date,
): Promise<{ zone: KeepOpenSubject | null }> {
  return { zone: await readZoneKeepOpen(tx, cfg, zoneId, at) };
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
