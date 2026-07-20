/**
 * Escapes the five XML metacharacters.
 *
 * The ampersand must be replaced FIRST — doing it last would re-escape the
 * ampersands introduced by the other four, turning `<` into `&amp;lt;`.
 */
export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
