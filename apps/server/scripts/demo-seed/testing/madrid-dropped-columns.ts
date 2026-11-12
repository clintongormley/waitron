import { stable, type CanonicalMadridSemantics } from "./madrid-semantics.js";

export type MadridColumnDrops = Record<string, readonly string[]>;

export function madridWithDroppedColumns(
  original: CanonicalMadridSemantics,
  drops: MadridColumnDrops,
): CanonicalMadridSemantics {
  const result = structuredClone(original);
  const aliases = new Map<string, string>();
  if (drops.routing_cells?.includes("location_id")) {
    for (const row of Object.values(result.tables.routing_cells?.rows ?? {}))
      if (typeof row.id === "string")
        aliases.set(
          row.id,
          `@routing_cells:${stable([row.category_id, row.product_id, row.zone_id])}`,
        );
  }
  if (drops.floor_zones?.includes("location_id")) {
    for (const row of Object.values(result.tables.floor_zones?.rows ?? {}))
      if (typeof row.id === "string") aliases.set(row.id, `@floor_zones:${stable([row.name])}`);
    const ids = new Set(
      Object.values(result.tables)
        .flatMap((table) => Object.values(table.rows).map((row) => row.id))
        .filter((id): id is string => typeof id === "string"),
    );
    const resolve = (id: string): string => {
      const mapped = aliases.get(id) ?? id;
      if (!ids.has(id)) return mapped;
      const colon = mapped.indexOf(":");
      if (!mapped.startsWith("@") || colon < 0) return mapped;
      const parts = JSON.parse(mapped.slice(colon + 1)) as unknown[];
      const updated =
        mapped.slice(0, colon + 1) +
        stable(parts.map((part) => (typeof part === "string" ? resolve(part) : part)));
      aliases.set(id, updated);
      return updated;
    };
    for (const id of ids) resolve(id);
  }
  for (const [name, columns] of Object.entries(drops)) {
    const table = result.tables[name];
    if (table === undefined) throw new Error(`missing Madrid table: ${name}`);
    const removed = new Set(columns);
    table.columns = table.columns.filter((column) => !removed.has(column.name));
    const ids = new Map<number, number>();
    table.foreignKeys = table.foreignKeys
      .filter((key) => !removed.has(key.from))
      .map((key) => {
        if (!ids.has(key.id)) ids.set(key.id, ids.size);
        return { ...key, id: ids.get(key.id)! };
      });
  }
  for (const [name, table] of Object.entries(result.tables)) {
    const removed = new Set(drops[name] ?? []);
    table.rows = Object.fromEntries(
      Object.entries(table.rows)
        .map(([key, row]) => {
          const withoutId = key === stable(row);
          const updated = Object.fromEntries(
            Object.entries(row)
              .filter(([column]) => !removed.has(column))
              .map(([column, value]) => [
                column,
                typeof value === "string" ? (aliases.get(value) ?? value) : value,
              ]),
          );
          return [aliases.get(key) ?? (withoutId ? stable(updated) : key), updated];
        })
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
  }
  return result;
}
