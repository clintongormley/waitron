import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VenueMigrationOptions } from "@waitron/migrations";
import { tablesCreatedBy } from "@waitron/sync-enrolment";

function created(folder: string, tags: readonly string[]): Set<string> {
  return tablesCreatedBy(tags.map((tag) => readFileSync(join(folder, `${tag}.sql`), "utf8")));
}

/**
 * Today's append-only list for a database built from `kept` alone: it drops only the tables the
 * left-out migrations, applied alone, leave in place, so a table this parse misses stays listed and its trigger fails loudly.
 */
export function predecessorAppendOnly(
  tables: readonly string[] | undefined,
  folder: string,
  kept: readonly string[],
  leftOut: readonly string[],
): string[] {
  const before = created(folder, kept);
  const added = created(folder, leftOut);
  return (tables ?? []).filter((table) => before.has(table) || !added.has(table));
}

/**
 * `options` with every set but `core` stopped before its first step whose SQL text names a table
 * that only core's `leftOut` steps create. A real box runs core first, so no such step could have
 * run on a database whose core stopped at `kept`. A cut set's folder is copied under `root`.
 */
export function beforeMissingCoreTables(
  options: readonly VenueMigrationOptions[],
  core: {
    migrationsTable: string;
    folder: string;
    kept: readonly string[];
    leftOut: readonly string[];
  },
  root: string,
): VenueMigrationOptions[] {
  const before = created(core.folder, core.kept);
  const missing = [...created(core.folder, core.leftOut)].filter((table) => !before.has(table));
  return options.map((option) => {
    if (option.migrationsTable === core.migrationsTable) return option;
    const journal = JSON.parse(
      readFileSync(join(option.migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    const tags = journal.entries.map((entry) => entry.tag);
    const cut = tags.findIndex((tag) => {
      const text = readFileSync(join(option.migrationsFolder, `${tag}.sql`), "utf8");
      return missing.some((table) => new RegExp(`\\b${table}\\b`).test(text));
    });
    if (cut === -1) return option;
    const folder = join(root, option.migrationsTable);
    cpSync(option.migrationsFolder, folder, { recursive: true });
    writeFileSync(
      join(folder, "meta", "_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }),
    );
    return {
      ...option,
      migrationsFolder: folder,
      appendOnlyTables: predecessorAppendOnly(
        option.appendOnlyTables,
        folder,
        tags.slice(0, cut),
        tags.slice(cut),
      ),
    };
  });
}
