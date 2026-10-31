const DURATION_UNITS = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1_000],
] as const;

/** A number of milliseconds, either sign, as its two largest non-zero whole units from days to
 * seconds, or tenths of a second under one; anything that is not a finite number is a dash. The
 * units' words come from the runtime's own locale data, so no language's words live here. */
export function formatDuration(value: unknown, l: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  let rest = Math.abs(value);
  const unit = (name: string, n: number, digits = 0) =>
    new Intl.NumberFormat(l, {
      style: "unit",
      unit: name,
      unitDisplay: "long",
      maximumFractionDigits: digits,
    }).format(n);
  if (rest < 1_000) return unit("second", Math.floor(rest / 100) / 10, 1);
  const parts: string[] = [];
  for (const [name, ms] of DURATION_UNITS) {
    const n = Math.floor(rest / ms);
    rest -= n * ms;
    if (n > 0 && parts.length < 2) parts.push(unit(name, n));
  }
  return new Intl.ListFormat(l, { type: "conjunction" }).format(parts);
}
