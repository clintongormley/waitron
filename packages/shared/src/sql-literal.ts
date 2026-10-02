/**
 * A string as an SQL literal, for statement text the engine takes no bound value in. `''` doubles
 * a single quote, so a value can never close the literal early; SQLite gives a backslash no
 * escaping meaning, so it stays as itself (`packages/db/src/quote-literal.test.ts`).
 */
export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
