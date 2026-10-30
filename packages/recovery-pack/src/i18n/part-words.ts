import { PART_WORDS, type PackLocale, type PartFailure } from "./pack-words.js";

/** What failed and what to do, keyed by the refusal's real code; no parameter value is printed. */
export function partFailure(
  locale: PackLocale,
  code: string,
  params: Readonly<Record<string, unknown>>,
): PartFailure {
  const words = PART_WORDS[locale];
  if (code === "sif.allocation_invalid" && params.reason === "history_invalid") {
    return words.historyInvalid;
  }
  if (code === "recovery.pack_invalid" && params.reason === "module_unsupported") {
    return words.moduleFault;
  }
  return Object.hasOwn(words.failures, code) ? words.failures[code]! : words.general;
}
