/** Conservative spelling used for generated SQL identifiers. */
export function isSqlIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
