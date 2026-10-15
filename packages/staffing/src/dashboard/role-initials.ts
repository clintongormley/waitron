import { formatLocale } from "./format.js";

const segmenters = new Map<string, Intl.Segmenter>();
function letters(word: string, locale: string): string[] {
  let segmenter = segmenters.get(locale);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(locale, { granularity: "grapheme" });
    segmenters.set(locale, segmenter);
  }
  return [...segmenter.segment(word)].map(({ segment }) => segment);
}

/** What a staff role's block shows for its name: the first letters of its first and last words,
 *  or a one-word name's first two letters. Two roles can share them. */
export function roleInitials(name: string, locale = formatLocale()): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) {
    const [first, second = ""] = letters(words[0]!, locale);
    return first!.toLocaleUpperCase(locale) + second;
  }
  return [words[0]!, words.at(-1)!]
    .map((word) => letters(word, locale)[0]!.toLocaleUpperCase(locale))
    .join("");
}
