/** For a word shown on its own, such as a list item: `Intl` names some languages in lower case. */
export function capitaliseFirst(text: string, locale: string): string {
  const first = text.codePointAt(0);
  if (first === undefined) return text;
  const letter = String.fromCodePoint(first);
  return letter.toLocaleUpperCase(locale) + text.slice(letter.length);
}
