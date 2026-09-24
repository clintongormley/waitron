import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// These touch the file system, so they stay out of the package's `index.ts`, which a browser
// bundle could reach.

export function filesUnder(dir: string): string[] {
  const walk = (at: string): string[] =>
    readdirSync(at).flatMap((entry) => {
      const full = join(at, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) return walk(full);
      return stat.isFile() ? [relative(dir, full)] : [];
    });
  return walk(dir).sort();
}

const WORKSPACE_ROOTS = ["packages", "apps"];

export function migrationSets(repoRoot: string): string[] {
  const sets: string[] = [];
  for (const root of WORKSPACE_ROOTS) {
    for (const entry of readdirSync(join(repoRoot, root))) {
      const dir = join(repoRoot, root, entry, "drizzle");
      if (existsSync(dir) && statSync(dir).isDirectory()) sets.push(relative(repoRoot, dir));
    }
  }
  return sets.sort();
}

/**
 * `"empty"` is a set that declares no migrations: a real state, not a hole. `"missing"` (no
 * journal, or its head snapshot is not on disk) must be refused by callers, not skipped, or the set
 * silently drops out of any check reading snapshots.
 */
export type HeadSnapshot = { kind: "file"; path: string } | { kind: "empty" } | { kind: "missing" };

export function headSnapshot(repoRoot: string, set: string): HeadSnapshot {
  const journal = join(repoRoot, set, "meta", "_journal.json");
  if (!existsSync(journal)) return { kind: "missing" };
  const entries = JSON.parse(readFileSync(journal, "utf8")).entries as { idx: number }[];
  if (entries.length === 0) return { kind: "empty" };
  const head = Math.max(...entries.map((entry) => entry.idx));
  const snapshot = join(repoRoot, set, "meta", `${String(head).padStart(4, "0")}_snapshot.json`);
  return existsSync(snapshot)
    ? { kind: "file", path: relative(repoRoot, snapshot) }
    : { kind: "missing" };
}

/**
 * Every `.sql` file in a migration set, subfolders included, as repo-relative paths sorted by the
 * whole path. For a set's top-level files that is the order of drizzle's zero-padded migration
 * numbers; a file in a subfolder sorts by the subfolder's name.
 */
export function migrationSqlFiles(repoRoot: string, set: string): string[] {
  return filesUnder(join(repoRoot, set))
    .filter((file) => file.endsWith(".sql"))
    .map((file) => join(set, file));
}
