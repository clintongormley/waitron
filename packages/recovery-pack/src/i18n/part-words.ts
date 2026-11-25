import { PART_WORDS, type PackLocale, type PartFailure } from "./pack-words.js";

/** What failed and what to do, keyed by the refusal's real code. */
export function partFailure(locale: PackLocale, code: string): PartFailure {
  const words = PART_WORDS[locale];
  return Object.hasOwn(words.failures, code) ? words.failures[code]! : words.general;
}
