/**
 * With an offset, the instant is shifted by it and formatted in UTC, so the saved offset decides the
 * wall clock and not the host's zone; without one, the host's zone decides.
 */
function shifted(iso: string, offsetMinutes: number | undefined) {
  const instant = new Date(iso);
  return offsetMinutes === undefined
    ? { date: instant, zone: {} }
    : { date: new Date(instant.getTime() + offsetMinutes * 60_000), zone: { timeZone: "UTC" } };
}

/** The date in words and the time, with the hour always two digits ("00:34", never "0:34"). */
export function receiptDateTime(iso: string, locale: string, offsetMinutes?: number): string {
  const { date, zone } = shifted(iso, offsetMinutes);
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", ...zone })
    .formatToParts(date)
    .map((part) => (part.type === "hour" ? part.value.padStart(2, "0") : part.value))
    .join("");
}

/** The date in numbers, a space, then the 24-hour time ("18/08/2026 00:34"). */
export function receiptDateTimeNumeric(
  iso: string,
  locale: string,
  offsetMinutes?: number,
): string {
  const { date, zone } = shifted(iso, offsetMinutes);
  const day = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...zone,
  }).format(date);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...zone,
  }).format(date);
  return `${day} ${time}`;
}

/** A calendar day (`YYYY-MM-DD`) in words, read as written whatever the host's zone. */
export function receiptDay(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}
