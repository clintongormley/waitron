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
