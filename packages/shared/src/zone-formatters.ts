const nameFormatters = new Map<string, Intl.DateTimeFormat>();
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

// A zone the runtime refuses throws before `set`, so it is never stored.
function cached(
  formatters: Map<string, Intl.DateTimeFormat>,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, ...options });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function zoneNameFormatter(timeZone: string): Intl.DateTimeFormat {
  return cached(nameFormatters, timeZone, {});
}

export function zoneOffsetFormatter(timeZone: string): Intl.DateTimeFormat {
  return cached(offsetFormatters, timeZone, { timeZoneName: "longOffset" });
}

export function zoneDateFormatter(timeZone: string): Intl.DateTimeFormat {
  return cached(dateFormatters, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
}
