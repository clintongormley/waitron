/**
 * A string as an SQL literal, for statement text the engine takes no bound value in. `''` doubles
 * a single quote, so a value can never close the literal early. The `E'…'` form emitted for a
 * backslash is PostgreSQL's, and SQLite does not accept it (open in `docs/backlog.md`).
 */
export function quoteLiteral(value: string): string {
  const escaped = value.replaceAll("'", "''").replaceAll("\\", "\\\\");
  return value.includes("\\") ? `E'${escaped}'` : `'${escaped}'`;
}
