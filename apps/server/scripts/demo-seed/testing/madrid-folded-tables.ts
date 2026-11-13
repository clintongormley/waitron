import type { CanonicalMadridSemantics } from "./madrid-semantics.js";
export interface MadridFold {
  from: string;
  into: string;
  match: { from: string; into: string };
  columns: Readonly<Record<string, string>>;
  collect?: { from: string; into: string };
}
export function madridWithFoldedTables(
  original: CanonicalMadridSemantics,
  folds: readonly MadridFold[],
): CanonicalMadridSemantics {
  const result = structuredClone(original);
  for (const fold of folds) {
    const source = result.tables[fold.from]!;
    const target = result.tables[fold.into]!;
    if (fold.collect) {
      const { from, into } = fold.collect;
      target.columns.push({ name: into, type: "TEXT", notnull: 1, dflt_value: "'[]'", pk: 0 });
      for (const row of Object.values(target.rows))
        row[into] = Object.values(source.rows)
          .filter((child) => child[fold.match.from] === row[fold.match.into])
          .map((child) => child[from])
          .sort();
    }
    const byKey = new Map(Object.values(source.rows).map((row) => [row[fold.match.from], row]));
    for (const [from, into] of Object.entries(fold.columns)) {
      const column = source.columns.find((column) => column.name === from)!;
      target.columns.push({ ...column, name: into });
      const storedDefault = column.dflt_value;
      const fallback =
        storedDefault === "false"
          ? 0
          : storedDefault === "true"
            ? 1
            : typeof storedDefault === "string" && /^-?\d+$/.test(storedDefault)
              ? Number(storedDefault)
              : storedDefault;
      for (const row of Object.values(target.rows))
        row[into] = byKey.get(row[fold.match.into])?.[from] ?? fallback;
    }
    const copiedIds = new Map<number, number>();
    const copied = source.foreignKeys
      .filter((key) => fold.columns[key.from] !== undefined)
      .map((key) => {
        if (!copiedIds.has(key.id)) copiedIds.set(key.id, copiedIds.size);
        return { ...key, id: copiedIds.get(key.id)!, from: fold.columns[key.from]! };
      });
    target.foreignKeys = [
      ...copied,
      ...target.foreignKeys.map((key) => ({ ...key, id: key.id + copiedIds.size })),
    ];
    delete result.tables[fold.from];
    for (const table of Object.values(result.tables))
      table.foreignKeys = table.foreignKeys.map((key) =>
        key.table === fold.from
          ? {
              ...key,
              table: fold.into,
              to: key.to === fold.match.from ? fold.match.into : fold.columns[key.to]!,
            }
          : key,
      );
  }
  return result;
}
