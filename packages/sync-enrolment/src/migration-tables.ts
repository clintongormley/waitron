/**
 * The set of tables a migration SET leaves in existence, read as TEXT (never executed).
 *
 * ORDER IS THE CONTRACT: the caller passes one set's SQL in the order the migrations apply, because
 * create → drop → create must resolve to "present" and the reverse to "absent".
 */

/**
 * SQLite's `[bracket]` quoting is NOT handled: a set emitting it would read as creating no tables.
 */
const CREATE_TABLE =
  /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?(?:public["`]?\.)?["`]?([a-z0-9_]+)["`]?/gi;

const DROP_TABLE =
  /\bdrop\s+table\s+(?:if\s+exists\s+)?["`]?(?:public["`]?\.)?["`]?([a-z0-9_]+)["`]?/gi;

/** The last step of drizzle-kit's table rebuild. `RENAME COLUMN … TO` does not match. */
const RENAME_TABLE =
  /\balter\s+table\s+["`]?(?:public["`]?\.)?["`]?([a-z0-9_]+)["`]?\s+rename\s+to\s+["`]?([a-z0-9_]+)["`]?/gi;

/** Blanks comments and string literals, so a CREATE/DROP TABLE mentioned in prose or a literal is
 * ignored. Naive by design. */
function stripSql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .replace(/'(?:[^']|'')*'/g, (literal) => literal.replace(/[^\n]/g, " "));
}

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
