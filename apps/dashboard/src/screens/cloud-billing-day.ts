/** `until` is a civil date (`YYYY-MM-DD`) and the first day a period excludes; this names the
 * last day it includes. The day is built on UTC and, by default, formatted on UTC, so the browser's
 * zone cannot move it. */
export function lastIncludedDay(until: string, locale: string, timeZone = "UTC"): string {
  const [y, m, d] = until.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone }).format(
    new Date(Date.UTC(y, m - 1, d - 1)),
  );
}
