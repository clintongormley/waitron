import { encodePathSegment } from "@waitron/ui";

/** The Calendar's address; every address below starts with it. */
export const openingHoursPath = "/manage/opening-hours";

/** Written with the URL controller's own encoder, so the screen reads back what was written. */
const pairsPath = (pairs: readonly (readonly [string, string])[]) =>
  [openingHoursPath, ...pairs.flat().map(encodePathSegment)].join("/");

const path = (parts: readonly (readonly [string, string | null | undefined])[]) =>
  pairsPath(parts.filter((part): part is readonly [string, string] => !!part[1]));

/** The Opening hours address of the season painter; an empty part is left out. */
export function seasonPainterPath(address: {
  seasonId?: string;
  departmentId?: string;
  zoneId?: string;
}): string {
  return path([
    ["view", "season"],
    ["season", address.seasonId],
    ["department", address.departmentId],
    ["zone", address.zoneId],
  ]);
}

/** The Opening hours address of the special-day painter; an empty part is left out. */
export function specialDayPainterPath(address: {
  specialDayId: string | null;
  date?: string | null;
}): string {
  return path([
    ["view", "special-day"],
    ["special-day", address.specialDayId],
    ["date", address.date],
  ]);
}

/** A module's Calendar view with its `<key>/<value>` pairs, empty values kept; a `view` pair is
 * left out, because it would name a second view. */
export function calendarViewPath(view: string, params: Readonly<Record<string, string>>): string {
  return pairsPath([["view", view], ...Object.entries(params).filter(([key]) => key !== "view")]);
}

/** Opening hours' month, or its year when no month is given. */
export function hoursPath(month?: string | null): string {
  return path([
    ["view", month ? "month" : "year"],
    ["month", month],
  ]);
}
