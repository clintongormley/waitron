const SHAPES = {
  wordsAndTime: { dateStyle: "medium", timeStyle: "short" },
  numericDay: { day: "2-digit", month: "2-digit", year: "numeric" },
  time24: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  wordsDay: { dateStyle: "medium" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

const utcFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(shape: keyof typeof SHAPES, locale: string, utc: boolean): Intl.DateTimeFormat {
  // A formatter built without a zone keeps the host zone of the moment it was built, and tests change
  // TZ between cases (`vi.stubEnv("TZ", …)`), so only the UTC ones are kept.
  if (!utc) return new Intl.DateTimeFormat(locale, SHAPES[shape]);
  const key = `${shape} ${locale}`;
  let cached = utcFormatters.get(key);
  if (cached === undefined) {
    cached = new Intl.DateTimeFormat(locale, { ...SHAPES[shape], timeZone: "UTC" });
    utcFormatters.set(key, cached);
  }
  return cached;
}

/**
 * With an offset, the instant is shifted by it and formatted in UTC, so the saved offset decides the
 * wall clock and not the host's zone; without one, the host's zone decides.
 */
function shifted(iso: string, offsetMinutes: number | undefined) {
  const instant = new Date(iso);
  return offsetMinutes === undefined
    ? { date: instant, utc: false }
    : { date: new Date(instant.getTime() + offsetMinutes * 60_000), utc: true };
}

/** The date in words and the time, with the hour always two digits ("00:34", never "0:34"). */
export function receiptDateTime(iso: string, locale: string, offsetMinutes?: number): string {
  const { date, utc } = shifted(iso, offsetMinutes);
  return formatter("wordsAndTime", locale, utc)
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
  const { date, utc } = shifted(iso, offsetMinutes);
  const day = formatter("numericDay", locale, utc).format(date);
  const time = formatter("time24", locale, utc).format(date);
  return `${day} ${time}`;
}

/** A calendar day (`YYYY-MM-DD`) in words, read as written whatever the host's zone. */
export function receiptDay(isoDate: string, locale: string): string {
  return formatter("wordsDay", locale, true).format(new Date(`${isoDate}T00:00:00Z`));
}
