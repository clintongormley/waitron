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

/** Blanks comments and closed single-quoted literals, preserving newlines and identifiers.
 * Unclosed blocks and strings remain readable because this is a text scanner, not SQL validation. */
export function stripSql(source: string): string {
  const pieces: string[] = [];
  let from = 0;
  let cursor = 0;
  let unclosedBlock = false;
  let unclosedString = false;
  while (cursor < source.length) {
    const char = source[cursor];
    let end = cursor;
    let blank = true;
    if (source.startsWith("--", cursor)) {
      const newline = source.indexOf("\n", cursor + 2);
      end = newline === -1 ? source.length : newline;
    } else if (!unclosedBlock && source.startsWith("/*", cursor)) {
      const close = source.indexOf("*/", cursor + 2);
      if (close === -1) unclosedBlock = true;
      else end = close + 2;
    } else if ((char === "'" && !unclosedString) || char === '"' || char === "`") {
      blank = char === "'";
      let next = cursor + 1;
      while (next < source.length) {
        if (source[next] !== char) next++;
        else if (source[next + 1] === char) next += 2;
        else {
          end = next + 1;
          break;
        }
      }
      if (end === cursor && blank) unclosedString = true;
    }
    if (end > cursor) {
      pieces.push(source.slice(from, cursor));
      const token = source.slice(cursor, end);
      pieces.push(blank ? token.replace(/[^\n]/g, " ") : token);
      cursor = end;
      from = end;
    } else cursor++;
  }
  pieces.push(source.slice(from));
  return pieces.join("");
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
