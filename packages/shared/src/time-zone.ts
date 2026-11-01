import { AppError } from "./errors.js";

export type SavedTimeZone =
  { kind: "missing" } | { kind: "invalid" } | { kind: "valid"; timeZone: string };

export function classifyTimeZone(value: unknown): SavedTimeZone {
  return classify(value, true);
}

export function classifySavedTimeZone(value: unknown): SavedTimeZone {
  return classify(value, false);
}

function classify(value: unknown, normalize: boolean): SavedTimeZone {
  if (value === null || value === undefined) return { kind: "missing" };
  if (typeof value !== "string") return { kind: "invalid" };
  const trimmed = value.trim();
  if (trimmed === "") return { kind: "missing" };
  const name = normalize ? trimmed : value;
  if (/^[+-]/.test(name)) return { kind: "invalid" };
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: name });
  } catch (error) {
    if (error instanceof RangeError) return { kind: "invalid" };
    throw error;
  }
  return { kind: "valid", timeZone: formatter.resolvedOptions().timeZone };
}

export function timeZoneOffsetMinutes(timeZone: string, instant: Date): number {
  if (!Number.isFinite(instant.getTime())) {
    throw new AppError("venue.time_zone_conversion_failed", { reason: "invalid_instant" });
  }
  const rendered = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(rendered ?? "");
  const hours = Number(match?.[2] ?? 0);
  const minutes = Number(match?.[3] ?? 0);
  if (match === null || hours > 23 || minutes > 59) {
    throw new AppError("venue.time_zone_conversion_failed", { reason: "unreadable_offset" });
  }
  const magnitude = hours * 60 + minutes;
  return match[1] === "-" ? -magnitude : magnitude;
}
