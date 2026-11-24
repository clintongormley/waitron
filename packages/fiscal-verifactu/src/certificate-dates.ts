import { type BusinessDayClock, businessDayAt, businessDayBoundaryAt } from "@waitron/shared";
import type { CertKind } from "./aeat-transport.js";

export type CertificateStage = "warning" | "urgent" | "expired";

/** Days left at which each stage begins (owner decision, A795). */
export const CERTIFICATE_THRESHOLDS: Readonly<
  Record<CertKind, Readonly<{ warning: number; urgent: number }>>
> = {
  sello: { warning: 90, urgent: 30 },
  representante: { warning: 60, urgent: 14 },
};

const DAY_MS = 86_400_000;

function calendar(timeZone: string): BusinessDayClock {
  return { timeZone, dayCutover: "00:00", cutoverChanges: [] };
}

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`) / DAY_MS;
}

function shiftDay(day: string, delta: number): string {
  return new Date((dayNumber(day) + delta) * DAY_MS).toISOString().slice(0, 10);
}

export function localDate(at: Date, timeZone: string): string {
  return businessDayAt(calendar(timeZone), at);
}

export function localMidnight(day: string, timeZone: string): string {
  return businessDayBoundaryAt(calendar(timeZone), day);
}

export function nextLocalMidnight(now: Date, timeZone: string): string {
  return localMidnight(shiftDay(localDate(now, timeZone), 1), timeZone);
}

export function calendarDaysLeft(now: Date, validUntil: Date, timeZone: string): number {
  return dayNumber(localDate(validUntil, timeZone)) - dayNumber(localDate(now, timeZone));
}

export function certificateStage(
  kind: CertKind,
  now: Date,
  validUntil: Date,
  timeZone: string,
): CertificateStage | null {
  if (now.getTime() >= validUntil.getTime()) return "expired";
  const days = calendarDaysLeft(now, validUntil, timeZone);
  const { warning, urgent } = CERTIFICATE_THRESHOLDS[kind];
  if (days <= urgent) return "urgent";
  if (days <= warning) return "warning";
  return null;
}

export function stageSince(
  kind: CertKind,
  stage: CertificateStage,
  validUntil: Date,
  timeZone: string,
): string {
  if (stage === "expired") return validUntil.toISOString();
  const day = shiftDay(localDate(validUntil, timeZone), -CERTIFICATE_THRESHOLDS[kind][stage]);
  return localMidnight(day, timeZone);
}

export function reminderPeriod(
  kind: CertKind,
  now: Date,
  validUntil: Date,
  timeZone: string,
): { stage: CertificateStage; period: string; endsAt: string } | null {
  const stage = certificateStage(kind, now, validUntil, timeZone);
  if (stage === null) return null;

  if (stage === "warning") {
    const warningDays = CERTIFICATE_THRESHOLDS[kind].warning;
    const week = Math.floor((warningDays - calendarDaysLeft(now, validUntil, timeZone)) / 7);
    const weekEnd = shiftDay(localDate(validUntil, timeZone), -warningDays + 7 * (week + 1));
    const weekEndsAt = localMidnight(weekEnd, timeZone);
    const urgentStartsAt = stageSince(kind, "urgent", validUntil, timeZone);
    return {
      stage,
      period: `warning:w${week}`,
      endsAt: weekEndsAt < urgentStartsAt ? weekEndsAt : urgentStartsAt,
    };
  }

  const day = localDate(now, timeZone);
  const dayEndsAt = localMidnight(shiftDay(day, 1), timeZone);
  const expiry = validUntil.toISOString();
  return {
    stage,
    period: `${stage}:${day}`,
    endsAt: stage === "urgent" && expiry < dayEndsAt ? expiry : dayEndsAt,
  };
}
