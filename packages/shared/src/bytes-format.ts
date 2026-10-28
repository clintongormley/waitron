function sizeLocale(l: string): string {
  const dash = l.indexOf("-");
  const language = dash === -1 ? l : l.slice(0, dash);
  return language === "es" ? "es-ES" : "en-GB";
}

/** A number of bytes as `l` writes gigabytes or megabytes, for display only; anything that is not
 * a byte count is written as a dash. */
export function formatBytes(value: unknown, l: string): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  const v = Math.max(0, value);
  const locale = sizeLocale(l);
  return Math.round(v / 1e6) >= 1000
    ? new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "gigabyte",
        maximumFractionDigits: 1,
      }).format(v / 1e9)
    : new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "megabyte",
        maximumFractionDigits: 0,
      }).format(v / 1e6);
}
