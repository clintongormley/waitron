import { FALLBACK_LOCALE, SUPPORTED_LOCALE_CODES, isSupportedLocale } from "@waitron/shared";

/** Match browser preferences to installed UI languages. Equal weights keep header order;
 * regional variants share a language. With no match, keep the venue's default. */
export function resolveLoginLocale(header: string | undefined, venueLocale: string): string {
  const fallback = isSupportedLocale(venueLocale) ? venueLocale : FALLBACK_LOCALE;
  const preferences = (header ?? "").split(",").flatMap((entry, index) => {
    const match =
      /^\s*([a-z]{1,8}(?:-[a-z0-9]{1,8})*|\*)\s*(?:;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/i.exec(
        entry,
      );
    if (!match) return [];
    return [{ range: match[1]!.toLowerCase(), weight: Number(match[2] ?? 1), index }];
  });
  const candidates = [
    fallback,
    ...SUPPORTED_LOCALE_CODES.filter((code) => code !== fallback),
  ].flatMap((code) => {
    const language = code.split("-")[0]!;
    // A specific range overrides a wildcard, including an explicit q=0 refusal.
    const specific = preferences.filter((p) => p.range.split("-")[0] === language);
    const matches = specific.length ? specific : preferences.filter((p) => p.range === "*");
    const best = matches.sort((a, b) => b.weight - a.weight || a.index - b.index)[0];
    return best && best.weight > 0 ? [{ code, ...best }] : [];
  });
  candidates.sort((a, b) => b.weight - a.weight || a.index - b.index);
  return candidates[0]?.code ?? fallback;
}
