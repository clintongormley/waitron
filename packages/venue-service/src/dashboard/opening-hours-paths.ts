const path = (parts: readonly (readonly [string, string | null | undefined])[]) =>
  `/manage/opening-hours/${parts
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}/${encodeURIComponent(value!)}`)
    .join("/")}`;

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
