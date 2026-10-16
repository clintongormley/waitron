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
  /** A new day's last date; left out when it is `date`. */
  to?: string | null;
}): string {
  return path([
    ["view", "special-day"],
    ["special-day", address.specialDayId],
    ["date", address.date],
    ["to", address.to === address.date ? null : address.to],
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

/** Changes only the window pair, retaining the view and its subject underneath. */
export function calendarWindowPath(basePath: string, windowId: string | null): string {
  const parts = basePath.split("/");
  const retained = parts.slice(0, 3);
  for (let i = 3; i < parts.length; i += 2) {
    if (parts[i] !== "window") retained.push(...parts.slice(i, i + 2));
  }
  if (windowId !== null) retained.push("window", encodePathSegment(windowId));
  return retained.join("/");
}
