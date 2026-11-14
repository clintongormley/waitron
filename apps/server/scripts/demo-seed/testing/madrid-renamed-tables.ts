import type { CanonicalMadridSemantics } from "./madrid-semantics.js";

export function madridWithRenamedTables(
  original: CanonicalMadridSemantics,
  renames: Readonly<Record<string, string>>,
): CanonicalMadridSemantics {
  const result = structuredClone(original);
  const rename = (name: string) => (Object.hasOwn(renames, name) ? renames[name]! : name);
  result.tables = Object.fromEntries(
    Object.entries(result.tables).map(([name, table]) => [rename(name), table]),
  );
  for (const table of Object.values(result.tables))
    for (const key of table.foreignKeys) key.table = rename(key.table);
  return result;
}
