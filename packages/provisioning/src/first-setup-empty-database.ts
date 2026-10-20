import "./errors.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { quoteIdent } from "./identifiers.js";

interface Snapshot {
  tables: Record<string, { name: string; columns: Record<string, { name: string; type: string }> }>;
}

// Journals and SQLite's own counters are bookkeeping; every application table must be empty.
export async function firstSetupDatabaseIsEmpty(
  connection: DatabaseSync,
  migrationsRoot: string | null,
  requiredSets: readonly string[] = ["core"],
): Promise<boolean> {
  try {
    const objects = connection
      .prepare("select name, type from sqlite_schema where name not glob 'sqlite_*'")
      .all() as { name: string; type: string }[];
    const tables = new Set(
      objects.filter((entry) => entry.type === "table").map((row) => row.name),
    );
    if (objects.some((entry) => entry.type === "view")) return false;
    const sets = manifestSets();
    const required = new Set(["core", ...requiredSets]);
    if ([...required].some((name) => !sets.some((set) => set.name === name))) return false;
    const options = migrationOptionsFor(sets, migrationsRoot);
    const accounted = new Set<string>();
    for (const [index, set] of sets.entries()) {
      const folder = options[index]!.migrationsFolder;
      const journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8")) as {
        entries: { idx: number }[];
      };
      if (journal.entries.length === 0) {
        if (required.has(set.name) && !tables.has(set.table)) return false;
        if (tables.has(set.table)) {
          if (
            connection.prepare(`select 1 from ${quoteIdent(set.table)} limit 1`).get() !== undefined
          )
            return false;
          accounted.add(set.table);
        }
        continue;
      }
      const last = journal.entries.at(-1)!;
      if (!Number.isSafeInteger(last.idx) || last.idx < 0) return false;
      const snapshot = JSON.parse(
        await readFile(
          join(folder, "meta", `${String(last.idx).padStart(4, "0")}_snapshot.json`),
          "utf8",
        ),
      ) as Snapshot;
      const expected = Object.values(snapshot.tables);
      const present = tables.has(set.table);
      if (!present) {
        if (required.has(set.name) || expected.some((table) => tables.has(table.name)))
          return false;
        continue;
      }
      const applied = connection.prepare(`select hash from ${quoteIdent(set.table)}`).all() as {
        hash: string;
      }[];
      const hashes = readMigrationFiles({ migrationsFolder: folder })
        .map((entry) => entry.hash)
        .sort();
      if (
        applied.length !== hashes.length ||
        applied
          .map((entry) => entry.hash)
          .sort()
          .some((hash, position) => hash !== hashes[position])
      )
        return false;
      accounted.add(set.table);
      for (const table of expected) {
        if (!tables.has(table.name)) return false;
        const columns = connection
          .prepare("select name, type from pragma_table_xinfo(?)")
          .all(table.name) as {
          name: string;
          type: string;
        }[];
        const wanted = Object.values(table.columns);
        if (
          columns.length !== wanted.length ||
          wanted.some(
            (column) =>
              !columns.some(
                (actual) =>
                  actual.name === column.name &&
                  actual.type.toLowerCase() === column.type.toLowerCase(),
              ),
          )
        )
          return false;
        if (
          connection.prepare(`select 1 from ${quoteIdent(table.name)} limit 1`).get() !== undefined
        )
          return false;
        accounted.add(table.name);
      }
    }
    return [...tables].every((name) => accounted.has(name));
  } catch {
    return false;
  }
}
