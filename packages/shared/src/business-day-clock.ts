import { AppError, type ErrorParams } from "./errors.js";

export type CutoverChange = Readonly<{ effectiveBusinessDay: string; dayCutover: string }>;
export type BusinessDayClock = Readonly<{
  timeZone: string;
  dayCutover: string;
  cutoverChanges: readonly CutoverChange[];
}>;
export type BusinessDayBounds = Readonly<{ startAt: string; endAt: string }>;

function invalid(reason: ErrorParams["business_day.clock_invalid"]["reason"]): never {
  throw new AppError("business_day.clock_invalid", { reason });
}

function validateDay(day: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) invalid("invalid_date");
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const value = new Date(Date.UTC(year, month - 1, date));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== date
  )
    invalid("invalid_date");
}

function validateCutover(value: string): void {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) invalid("invalid_cutover");
}

function validateClock(clock: BusinessDayClock): void {
  let zone: string;
  try {
    zone = new Intl.DateTimeFormat("en-US", { timeZone: clock.timeZone }).resolvedOptions()
      .timeZone;
  } catch {
    invalid("invalid_time_zone");
  }
  if (/^[+-]/.test(zone)) invalid("invalid_named_time_zone");
  validateCutover(clock.dayCutover);
  let previous = "";
  for (const change of clock.cutoverChanges) {
    validateDay(change.effectiveBusinessDay);
    validateCutover(change.dayCutover);
    if (change.effectiveBusinessDay <= previous) invalid("changes_out_of_order");
    previous = change.effectiveBusinessDay;
  }
}

function cutoverAt(clock: BusinessDayClock, day: string): string {
  let cutover = clock.dayCutover;
  for (const change of clock.cutoverChanges) {
    if (change.effectiveBusinessDay > day) break;
    cutover = change.dayCutover;
  }
  return cutover;
}

function offsetMinutes(at: number, timeZone: string): number {
  const rendered = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(new Date(at))
    .find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(rendered ?? "");
  if (match === null) invalid("unreadable_offset");
  const magnitude = Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -magnitude : magnitude;
}

function boundaryAt(clock: BusinessDayClock, day: string): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const [hours, minutes] = cutoverAt(clock, day).split(":").map(Number) as [number, number];
  const wall = Date.UTC(year, month - 1, date, hours, minutes);
  const guess = wall - offsetMinutes(wall, clock.timeZone) * 60_000;
  return new Date(wall - offsetMinutes(guess, clock.timeZone) * 60_000).toISOString();
}

function addDay(day: string, delta: number): string {
  const value = new Date(`${day}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + delta);
  const result = value.toISOString().slice(0, 10);
  validateDay(result);
  return result;
}

function boundsAt(clock: BusinessDayClock, day: string): BusinessDayBounds {
  const startAt = boundaryAt(clock, day);
  const endAt = boundaryAt(clock, addDay(day, 1));
  if (endAt <= startAt) invalid("non_increasing_boundary");
  return { startAt, endAt };
}

export function cutoverForBusinessDay(clock: BusinessDayClock, day: string): string {
  validateClock(clock);
  validateDay(day);
  return cutoverAt(clock, day);
}

export function businessDayBoundaryAt(clock: BusinessDayClock, day: string): string {
  validateClock(clock);
  validateDay(day);
  return boundaryAt(clock, day);
}

export function businessDayBounds(clock: BusinessDayClock, day: string): BusinessDayBounds {
  validateClock(clock);
  validateDay(day);
  return boundsAt(clock, day);
}

export function businessDayAt(clock: BusinessDayClock, at: Date): string {
  validateClock(clock);
  if (!Number.isFinite(at.getTime())) invalid("invalid_instant");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: clock.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const civilDay = ["year", "month", "day"]
    .map((key) => parts.find((part) => part.type === key)!.value)
    .join("-");
  const instant = at.toISOString();
  for (let delta = -2; delta <= 2; delta++) {
    const day = addDay(civilDay, delta);
    const { startAt, endAt } = boundsAt(clock, day);
    if (startAt <= instant && instant < endAt) return day;
  }
  return invalid("outside_boundaries");
}
