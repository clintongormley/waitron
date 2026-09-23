import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The set of tables a migration SET leaves in existence, read as TEXT (never executed).
 *
 * Both classification guards — `scripts/classification-complete.test.ts` (tree-wide) and
 * `packages/db/src/classification.test.ts` (core) — must agree. A scanner that only counted
 * `CREATE TABLE` would keep a dropped table forever and put them in permanent disagreement, so this
 * subtracts on `DROP TABLE`, and follows `ALTER TABLE … RENAME TO` from the old name to the new.
 *
 * ORDER IS THE CONTRACT: the caller passes one migration set's SQL in FILENAME order, because
 * create → drop → create must resolve to "present" and the reverse to "absent". `readdirSync` does
 * not sort, so both callers sort.
 */

/** `CREATE TABLE ["public".]"<name>"` — the name backtick-quoted (what every `CREATE TABLE` under
 * a package's `drizzle` directory is now), double-quoted (still the spelling of the fixture sets
 * under `packages/db/test`) or bare; schema-qualified or not; IF NOT EXISTS or not. Each spelling has its
 * own case in `migration-tables.test.ts`. SQLite accepts `[bracket]` quoting as well — sqlite3 3.51.0
 * created a table from `CREATE TABLE [brack]` — and that is NOT handled here: a set emitting it would
 * read as creating no tables at all, which is exactly what the backtick did before this tolerance.
 * The name capture is digit-tolerant (`[a-z0-9_]+`, `i` flag): real table names carry digits. */
const CREATE_TABLE =
  /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?(?:public["`]?\.)?["`]?([a-z0-9_]+)["`]?/gi;

/** `DROP TABLE [IF EXISTS] ["public".]"<name>"`, the same tolerances. A trailing CASCADE/RESTRICT is
 * outside the capture and does not need matching. */
const DROP_TABLE =
  /\bdrop\s+table\s+(?:if\s+exists\s+)?["`]?(?:public["`]?\.)?["`]?([a-z0-9_]+)["`]?/gi;

/** `ALTER TABLE <old> RENAME TO <new>`, the same tolerances on both names: the last step of
 * drizzle-kit's rebuild of a table (build `__new_<name>`, copy, drop, rename). `RENAME COLUMN … TO`
 * does not match, because `TO` must follow the table name's single `RENAME`. */
const RENAME_TABLE =
  /\balter\s+table\s+["`]?(?:public["`]?\.)?["`]?([a-z0-9_]+)["`]?\s+rename\s+to\s+["`]?([a-z0-9_]+)["`]?/gi;

/** Blank block comments, `--` line comments, and `'…'` string literals to whitespace, preserving line
 * count (so a CREATE/DROP TABLE mentioned in prose or a literal is ignored). Naive by design — the
 * same scanner `module-graph-honesty.test.ts` uses, whose header records why a real parser is not
 * worth it here. */
function stripSql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .replace(/'(?:[^']|'')*'/g, (literal) => literal.replace(/[^\n]/g, " "));
}

/** One statement's position and what it does, so a file's CREATEs, DROPs and RENAMEs apply in the
 * order they appear WITHIN the file as well as across files. A rename is a drop of the old name and
 * a create of the new one at the same position. */
interface Statement {
  index: number;
  table: string;
  drops: boolean;
}

export function tablesCreatedBy(files: readonly string[]): Set<string> {
  const tables = new Set<string>();
  for (const raw of files) {
    const sql = stripSql(raw);
    const statements: Statement[] = [];
    for (const m of sql.matchAll(CREATE_TABLE)) {
      /* v8 ignore start -- a matched group 1 is always defined; the guard is for the type, not a case */
      if (m[1] !== undefined)
        statements.push({ index: m.index, table: m[1].toLowerCase(), drops: false });
      /* v8 ignore stop */
    }
    for (const m of sql.matchAll(DROP_TABLE)) {
      /* v8 ignore start */
      if (m[1] !== undefined)
        statements.push({ index: m.index, table: m[1].toLowerCase(), drops: true });
      /* v8 ignore stop */
    }
    for (const m of sql.matchAll(RENAME_TABLE)) {
      /* v8 ignore start */
      if (m[1] !== undefined && m[2] !== undefined) {
        statements.push({ index: m.index, table: m[1].toLowerCase(), drops: true });
        statements.push({ index: m.index, table: m[2].toLowerCase(), drops: false });
      }
      /* v8 ignore stop */
    }
    statements.sort((a, b) => a.index - b.index);
    for (const s of statements) {
      if (s.drops) tables.delete(s.table);
      else tables.add(s.table);
    }
  }
  return tables;
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
 * The snapshot drizzle holds for a set's HEAD — the schema as it stands, rather than the history
 * that built it. The journal's highest `idx` names it, which is the pointer drizzle itself follows.
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
 * Every `.sql` file in a migration set, repo-relative and sorted — the order `tablesCreatedBy`
 * needs. Walks the whole set rather than its top level, so a set that starts nesting its
 * migrations is still read.
 */
export function migrationSqlFiles(repoRoot: string, set: string): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return full.endsWith(".sql") ? [relative(repoRoot, full)] : [];
    });
  return walk(join(repoRoot, set)).sort();
}
