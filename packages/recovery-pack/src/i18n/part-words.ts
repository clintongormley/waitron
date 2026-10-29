import { PART_WORDS, type PackLocale, type PartFailure } from "./pack-words.js";

/** What failed and what to do, keyed by the refusal's real code; no parameter value is printed. */
export function partFailure(
  locale: PackLocale,
  code: string,
  params: Readonly<Record<string, unknown>>,
): PartFailure {
  const words = PART_WORDS[locale];
  if (code === "sif.allocation_invalid") {
    if (params.reason !== "history_invalid") return words.general;
    return { what: words.historyInvalid, todo: words.failures[code]!.todo };
  }
  return Object.hasOwn(words.failures, code) ? words.failures[code]! : words.general;
}
