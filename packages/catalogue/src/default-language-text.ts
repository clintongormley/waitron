import { newCustomerText } from "./new-customer-text.js";

/** Every receipt key in `keys` holds the default content language's text. */
export function defaultLanguageDescriptions(
  text: Readonly<Record<string, string>>,
  keys: readonly string[],
  defaultLanguage: string,
  staffName: string,
): Record<string, string> {
  const frozen = newCustomerText(text, staffName.trim(), defaultLanguage, {
    defaultLanguage,
    languages: [defaultLanguage],
  });
  return Object.fromEntries(keys.map((key) => [key, frozen]));
}

/** One entry, under the default content language. */
export function defaultLanguageText(
  text: Readonly<Record<string, string>> | null,
  defaultLanguage: string,
  staffName: string,
): Record<string, string> {
  return {
    [defaultLanguage]: newCustomerText(text, staffName.trim(), defaultLanguage, {
      defaultLanguage,
      languages: [defaultLanguage],
    }),
  };
}
