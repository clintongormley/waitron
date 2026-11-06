import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const readJson = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));

/**
 * Every frozen pre-squash set, in the old manifest's order (which the old composition's dependency
 * sort kept), each shaped as `applyMigrations` takes a set. `fiscal-none` had no migrations and is
 * left out: a venue ran it or `fiscal-verifactu`, never both.
 */
export function historicalSets() {
  const old = readJson("old-migrations.manifest.json");
  return readJson("manifest.json").sets.map((frozen) => {
    const set = old.find((candidate) => candidate.name === frozen.name);
    return {
      name: set.name,
      migrationsFolder: join(root, set.name),
      migrationsTable: set.table,
      appendOnlyTables: [...set.appendOnlyTables],
      ...(set.database === undefined ? {} : { database: set.database }),
      requires: [...frozen.requires],
    };
  });
}

/** One frozen pre-squash set, named as the old manifest named it. */
export function historicalSet(name) {
  const set = historicalSets().find((candidate) => candidate.name === name);
  if (!set) throw new Error(`no frozen migration history named "${name}"`);
  return set;
}
