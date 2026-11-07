import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

/** A migration this test invents, appended after a set's shipped steps. */
export interface SyntheticStep {
  readonly tag: string;
  readonly sql: string;
}

interface Journal {
  entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
}

/**
 * Copies every shipped migration set to `<root>/<set name>` and appends `steps` to the named sets,
 * so a database migrated from today's sets is exactly those steps behind code run with `root` as
 * its migrations root, whatever today's history holds. Returns `root`.
 */
export function migrationsRootWith(
  root: string,
  steps: Readonly<Record<string, readonly SyntheticStep[]>>,
): string {
  const sets = manifestSets();
  const unknown = Object.keys(steps).filter((name) => !sets.some((set) => set.name === name));
  if (unknown.length > 0) throw new Error(`No shipped migration set named ${unknown.join(", ")}`);
  const folders = migrationOptionsFor(sets, null);
  for (const [index, set] of sets.entries()) {
    const folder = join(root, set.name);
    cpSync(folders[index]!.migrationsFolder, folder, { recursive: true });
    const extra = steps[set.name] ?? [];
    if (extra.length === 0) continue;
    const path = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(path, "utf8")) as Journal;
    for (const step of extra) {
      const last = journal.entries.at(-1)!;
      writeFileSync(join(folder, `${step.tag}.sql`), step.sql);
      // Drizzle applies an entry only when its `when` is later than the newest applied row's
      // created_at, so each step follows the one before it by a millisecond; the clock is not
      // read, because some callers freeze it before today's newest step.
      journal.entries.push({
        idx: journal.entries.length,
        version: last.version,
        when: last.when + 1,
        tag: step.tag,
        breakpoints: true,
      });
    }
    writeFileSync(path, JSON.stringify(journal));
  }
  return root;
}
