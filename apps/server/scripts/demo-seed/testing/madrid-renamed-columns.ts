import { stable, type CanonicalMadridSemantics } from "./madrid-semantics.js";

/** table → old column name → new column name */
export type MadridColumnRenames = Record<string, Record<string, string>>;

/** Apply reviewed column renames to the frozen capture, so an entry that no longer matches the
 * capture fails rather than quietly widening the comparison. */
export function madridWithRenamedColumns(
  original: CanonicalMadridSemantics,
  renames: MadridColumnRenames,
): CanonicalMadridSemantics {
  const result = structuredClone(original);
  for (const [name, columns] of Object.entries(renames)) {
    const table = result.tables[name];
    for (const [old, next] of Object.entries(columns)) {
      const column = table?.columns.find((entry) => entry.name === old);
      if (!table || !column || table.columns.some((entry) => entry.name === next))
        throw new Error(`unused or invalid Madrid column rename: ${name}.${old}`);
      column.name = next;
      for (const foreignKey of table.foreignKeys)
        if (foreignKey.from === old) foreignKey.from = next;
      const rows: typeof table.rows = {};
      for (const [key, row] of Object.entries(table.rows)) {
        const renamed = Object.fromEntries(
          Object.entries(row).map(([cell, value]) => [cell === old ? next : cell, value]),
        );
        rows[key === stable(row) ? stable(renamed) : key] = renamed;
      }
      table.rows = Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)));
    }
  }
  return result;
}
