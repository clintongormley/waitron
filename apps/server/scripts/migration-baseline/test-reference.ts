// Builds a small reference folder shaped like `protection-list list`'s output, for the tests.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LIST_FILE } from "../protection-list/cli.js";
import type { SchemaListEntry, SchemaListFile } from "../protection-list/compare.js";
import { readSchema } from "../protection-list/read-schema.js";

export interface FixtureSet {
  readonly name: string;
  readonly sql: string;
}

function keys(db: DatabaseSync): string[] {
  return (
    db
      .prepare(
        "select type, name from sqlite_schema where type in ('table','view','index','trigger')",
      )
      .all() as { type: string; name: string }[]
  ).map((row) => `${row.type} ${row.name}`);
}

/** Applies each set in turn to `<dir>/databases/<composition>/<phase>/venue.db` and reads it. */
export function fixtureEntry(
  dir: string,
  sets: readonly FixtureSet[],
  where: { composition?: string; phase?: string; folder?: string } = {},
): SchemaListEntry {
  const composition = where.composition ?? "fiscal-verifactu";
  const phase = where.phase ?? "sql-only";
  const folder = join(dir, "databases", composition, where.folder ?? phase);
  mkdirSync(folder, { recursive: true });
  const db = new DatabaseSync(join(folder, "venue.db"));
  try {
    const owningSet: Record<string, string> = {};
    for (const set of sets) {
      const before = new Set(keys(db));
      db.exec(set.sql);
      for (const key of keys(db)) if (!before.has(key)) owningSet[key] = set.name;
    }
    return {
      composition,
      phase,
      database: "venue",
      setOrder: sets.map((set) => set.name),
      journals: {},
      bookkeepingRows: {},
      owningSet,
      schema: readSchema(db),
    };
  } finally {
    db.close();
  }
}

export function writeReference(dir: string, entries: readonly SchemaListEntry[]): string {
  mkdirSync(dir, { recursive: true });
  const file: SchemaListFile = { entries };
  writeFileSync(join(dir, LIST_FILE), JSON.stringify(file));
  return dir;
}
