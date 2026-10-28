import { stable, type CanonicalMadridSemantics } from "./madrid-semantics.js";

/** table → old column name → new column name */
export type MadridColumnRenames = Record<string, Record<string, string>>;

/** Apply reviewed column renames to the frozen capture, so an entry that no longer matches the
 * capture fails rather than quietly widening the comparison. Every entry is checked against the
 * capture's own columns, and a table's renames apply together, never one onto another. */
export function madridWithRenamedColumns(
  original: CanonicalMadridSemantics,
  renames: MadridColumnRenames,
): CanonicalMadridSemantics {
  const refuse = (entry: string) => new Error(`unused or invalid Madrid column rename: ${entry}`);
  const result = structuredClone(original);
  for (const [name, columns] of Object.entries(renames)) {
    const entries = Object.entries(columns);
    if (entries.length === 0) throw refuse(name);
    const table = result.tables[name];
    if (!table) throw refuse(`${name}.${entries[0]![0]}`);
    const existing = new Set(table.columns.map((entry) => entry.name));
    const targets = new Set<string>();
    for (const [old, next] of entries) {
      if (!existing.has(old) || existing.has(next) || targets.has(next))
        throw refuse(`${name}.${old}`);
      targets.add(next);
    }
    const rename = (cell: string) => (Object.hasOwn(columns, cell) ? columns[cell]! : cell);
    for (const column of table.columns) column.name = rename(column.name);
    for (const foreignKey of table.foreignKeys) foreignKey.from = rename(foreignKey.from);
    const rows: typeof table.rows = {};
    for (const [key, row] of Object.entries(table.rows)) {
      const renamed = Object.fromEntries(
        Object.entries(row).map(([cell, value]) => [rename(cell), value]),
      );
      rows[key === stable(row) ? stable(renamed) : key] = renamed;
    }
    table.rows = Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)));
  }
  return result;
}
