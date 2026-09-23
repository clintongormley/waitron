import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Readers for the repository's migration sets, used by the root guards under `scripts/`. They touch
 * the file system, so they live here rather than beside `tablesCreatedBy`, which the package's
 * `index.ts` exports and a browser bundle could reach.
 */

/** Every regular file under `dir`, relative to it and sorted. Directories are walked; anything that
 * is neither a directory nor a file (a socket, a fifo) is skipped. */
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

/** The two workspace roots a migration set can sit under, one package deep. */
const WORKSPACE_ROOTS = ["packages", "apps"];

/** Every `drizzle/` migration set directly under a package or app, repo-relative and sorted. */
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
 * The snapshot a set's journal names as its head — the schema as it stands, rather than the history
 * that built it: `meta/<highest idx>_snapshot.json`. Another snapshot file in `meta/` that the
 * journal does not name is not considered.
 *
 * `"empty"` is a set that declares no migrations at all: a real state, not a hole
 * (`packages/fiscal-none` owns no tables). `"missing"` is a set with no journal, or whose journal
 * names a head whose snapshot is not on disk — which would drop that set out of any check reading
 * snapshots without saying so, so callers refuse it rather than skip it.
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
