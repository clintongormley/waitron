const decimalMarks = new Map<string, string>();

export function decimalMark(locale: string): string {
  let mark = decimalMarks.get(locale);
  if (mark === undefined) {
    mark = new Intl.NumberFormat(locale)
      .formatToParts(1.5)
      .find((part) => part.type === "decimal")!.value;
    decimalMarks.set(locale, mark);
  }
  return mark;
}

/** No grouping or numeric coercion: every digit must survive the browser-to-request boundary. */
export function parseDecimalInput(value: string): string | null {
  const text = value.trim();
  return /^-?\d+(?:[.,]\d+)?$/.test(text) ? text.replace(",", ".") : null;
}

/** Partial entries keep their trailing separator; malformed entries stay visible for correction. */
export function formatDecimalInput(value: string, locale: string): string {
  return /^-?\d+(?:[.,]\d*)?$/.test(value) ? value.replace(/[.,]/, decimalMark(locale)) : value;
}
