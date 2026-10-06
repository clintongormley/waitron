import { currentLocale } from "./t.js";

const formats = new Map<string, Intl.ListFormat>();

export function conjunctionList(items: readonly string[]): string {
  const locale = currentLocale();
  let format = formats.get(locale);
  if (format === undefined) {
    format = new Intl.ListFormat(locale, { type: "conjunction" });
    formats.set(locale, format);
  }
  return format.format(items);
}
