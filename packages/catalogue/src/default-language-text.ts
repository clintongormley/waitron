import { resolveSnapshotText } from "@waitron/shared";

/**
 * Customer text frozen onto an order line in the venue's default content language. Where the
 * default has no text, another stored language's is taken (`resolveSnapshotText`).
 */

/** Every receipt key in `keys` holds the default content language's text. */
export function defaultLanguageDescriptions(
  text: Readonly<Record<string, string>>,
  keys: readonly string[],
  defaultLanguage: string,
): Record<string, string> {
  const frozen = resolveSnapshotText(text, defaultLanguage, defaultLanguage);
  return Object.fromEntries(keys.map((key) => [key, frozen]));
}

/** One entry, under the default content language. */
export function defaultLanguageText(
  text: Readonly<Record<string, string>> | null,
  defaultLanguage: string,
): Record<string, string> | null {
  if (text === null) return null;
  return { [defaultLanguage]: resolveSnapshotText(text, defaultLanguage, defaultLanguage) };
}
