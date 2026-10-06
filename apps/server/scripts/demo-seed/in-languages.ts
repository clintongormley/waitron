/** Customer-facing text cut to the venue's enabled languages; a language the map lacks is left out.
 *  The map's own key order is kept, because the stored JSON text follows it. */
export function inLanguages(
  text: Readonly<Record<string, string>>,
  languages: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(text).filter(([language]) => languages.includes(language)),
  );
}
