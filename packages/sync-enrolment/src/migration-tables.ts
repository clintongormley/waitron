/**
 * The set of tables a migration SET leaves in existence, read as TEXT (never executed).
 *
 * Both classification guards — `scripts/classification-complete.test.ts` (tree-wide) and
 * `packages/db/src/classification.test.ts` (core) — must agree with the LIVE database, which
 * `packages/fiscal-verifactu/src/privileges.test.ts` compares against with `toEqual`. A scanner that
 * only counted `CREATE TABLE` would keep a dropped table forever and put the three in permanent
 * disagreement, so this subtracts on `DROP TABLE`.
 *
 * ORDER IS THE CONTRACT: the caller passes one migration set's SQL in FILENAME order, because
 * create → drop → create must resolve to "present" and the reverse to "absent". `readdirSync` does
 * not sort, so both callers sort.
 */

/** `CREATE TABLE ["public".]"<name>"` — quoted or bare, schema-qualified or not, IF NOT EXISTS or not.
 * The name capture is digit-tolerant (`[a-z0-9_]+`, `i` flag): real table names carry digits. */
const CREATE_TABLE =
  /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?"?(?:public"?\.)?"?([a-z0-9_]+)"?/gi;

/** `DROP TABLE [IF EXISTS] ["public".]"<name>"`, the same tolerances. A trailing CASCADE/RESTRICT is
 * outside the capture and does not need matching. */
const DROP_TABLE = /\bdrop\s+table\s+(?:if\s+exists\s+)?"?(?:public"?\.)?"?([a-z0-9_]+)"?/gi;

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

/** One statement's position and what it does, so a file's CREATEs and DROPs apply in the order they
 * appear WITHIN the file as well as across files. */
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
      /* v8 ignore next -- a matched group 1 is always defined; the guard is for the type, not a case */
      if (m[1] !== undefined)
        statements.push({ index: m.index, table: m[1].toLowerCase(), drops: false });
    }
    for (const m of sql.matchAll(DROP_TABLE)) {
      /* v8 ignore next */
      if (m[1] !== undefined)
        statements.push({ index: m.index, table: m[1].toLowerCase(), drops: true });
    }
    statements.sort((a, b) => a.index - b.index);
    for (const s of statements) {
      if (s.drops) tables.delete(s.table);
      else tables.add(s.table);
    }
  }
  return tables;
}
