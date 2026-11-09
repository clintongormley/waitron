import { sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Transaction } from "./client.js";

export function withoutId<T>(value: T, id: string): T {
  if (value === id) return null as T;
  if (value === null || typeof value !== "object") return value;
  let changed = false;
  if (Array.isArray(value)) {
    const next = value.filter((item) => item !== id).map((item) => withoutId(item, id));
    changed = next.length !== value.length || next.some((item, index) => item !== value[index]);
    return changed ? (next as T) : value;
  }
  const next = Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const replacement = withoutId(item, id);
      if (replacement !== item) changed = true;
      return [key, replacement];
    }),
  );
  return changed ? (next as T) : value;
}

export async function removeIdFromJson(
  tx: Transaction,
  column: AnySQLiteColumn,
  id: string,
): Promise<number> {
  const rows = await tx.execute<{ source_rowid: number; source_json: string }>(sql`
    select rowid as source_rowid, ${column} as source_json from ${column.table}
    where exists (select 1 from json_tree(${column}) where type = 'text' and atom = ${id})
  `);
  for (const row of rows.rows) {
    const value = JSON.stringify(withoutId(JSON.parse(row.source_json), id));
    await tx.execute(
      sql`update ${column.table} set ${sql.identifier(column.name)} = ${value} where rowid = ${row.source_rowid}`,
    );
  }
  return rows.rows.length;
}
