import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Nothing else in the tree refuses PostgreSQL-only SQL written inside a `sql` template.
 *
 * The storage swap replaced PostgreSQL with SQLite, and a `sql` template's contents are a STRING:
 * `tsc` never looks inside one, and a statement the engine cannot parse is refused at PREPARE, at
 * run time, in whichever request first reaches it. `apps/server` was swept last, and the residue
 * this guard names was found by running the code rather than by any check — thirteen `now()` calls
 * and twenty-four casts in `working-order.ts` alone.
 *
 * WEAKER THAN ITS NAME, in ways worth stating because each is a statement it cannot see:
 *
 * - It reads TEXT. It finds the templates by scanning for the characters `sql` followed by a
 *   backtick, so a fragment built as a plain string and handed to `sql.raw`, or assembled from
 *   pieces, is invisible to it.
 * - It scans THIS package only. Every other package is out of scope.
 * - Its list of PostgreSQL-only constructs is hand-written, and it grew as the sweep met more of
 *   them. It catches the shapes this package actually carried; one nobody has met yet passes.
 * - It over-reports in one direction, which costs a reader time rather than hiding anything: the
 *   scan leaves `${…}` in place, so a JavaScript `Date.now()` interpolated into a template matches
 *   the `now()` pattern. Hoist the expression to a `const` above the template rather than
 *   weakening the pattern — the bound value is the same and the statement stays readable.
 * - It sees the WRITTEN statement, not the one that runs. Two faults it is blind to were the
 *   larger half of the sweep it was written for: a raw `insert` leaning on a column default that
 *   is a JavaScript `$defaultFn` generator on this engine (a raw insert never reaches one, so the
 *   row is refused NOT NULL at run time), and a raw `select` of a `json` or boolean column, which
 *   skips drizzle's read mapping and hands back the stored TEXT or a 0/1. Both are invisible here
 *   and only a suite that RUNS finds them.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SELF = fileURLToPath(import.meta.url);

/** PostgreSQL-only spellings, each with what SQLite answers when one reaches the engine. */
const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  // `no such function: now`. The clock is read in JavaScript and bound instead — `nowIso()` for a
  // raw statement, `now()` from `@waitron/db` for a drizzle `.set()` on a `ts` column.
  { name: "now() — SQLite has no such function", pattern: /\bnow\s*\(\s*\)/ },
  // `unrecognized token: ":"`. The colon is the start of a bind parameter to SQLite's parser.
  { name: ":: cast — SQLite has no cast operator", pattern: /::/ },
  // SQLite has no interval type: the arithmetic moves onto a `Date` before the value binds.
  { name: "interval literal", pattern: /\binterval\s+'/ },
  // `no such function: extract`; and a timestamp column is TEXT here, not a point in time.
  { name: "extract() / array[] — PostgreSQL-only syntax", pattern: /\bextract\s*\(|\barray\s*\[/ },
  // Every one of these was met in this package's own source during the sweep, and none of them is a
  // cast or a clock: the function names are PostgreSQL's (`json_group_array` / `json_object` are
  // SQLite's), `information_schema` does not exist here (the PRAGMA functions replace it), and
  // LATERAL is refused at prepare with `near "select": syntax error`.
  {
    name: "PostgreSQL-only function or clause",
    pattern:
      /\b(?:to_jsonb|jsonb_populate_record|json_agg|jsonb_agg|json_build_object|bool_or|bool_and|string_agg|lateral|information_schema)\b/,
  },
];

/**
 * Every `.ts` file under this package's `src`, tests included — this file excepted.
 *
 * A suite's own fixture reaches the engine exactly the way a request handler does, and a statement
 * SQLite cannot parse is refused at PREPARE either way. The exception is this file, which plants a
 * residual statement on purpose in the negative control below.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    // `isFile()`, not a name test: a failed browser run leaves a DIRECTORY named `*.test.ts`
    // (CLAUDE.md §4), and `readFileSync` on one throws `EISDIR`.
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith(".ts") && path !== SELF) out.push(path);
  }
  return out;
}

/**
 * The body of every `sql`…`` template in `source`, with its line number.
 *
 * The scan walks forward from each `sql` backtick to the closing backtick, skipping an escaped one.
 * A `${…}` interpolation is left in place: the guard looks for SQL keywords, and a TypeScript
 * expression that happens to contain `::` is not one — which is why `primary-url.ts`'s IPv6
 * literals, in ordinary strings and comments, are outside this scan entirely.
 */
function sqlTemplates(source: string): { line: number; body: string }[] {
  const found: { line: number; body: string }[] = [];
  // `sql`, an optional `.raw`, and an optional type argument — `sql<number>` and
  // `sql<Record<string, unknown>>` are both in this package, and a scan that missed the typed form
  // would miss every `::int` in a select list.
  const opener = /\bsql(?:\.raw)?(?:<[^`]*?>)?\s*`/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    const start = opener.lastIndex;
    let end = start;
    while (end < source.length && !(source[end] === "`" && source[end - 1] !== "\\")) end += 1;
    found.push({
      line: source.slice(0, match.index).split("\n").length,
      body: source.slice(start, end),
    });
    opener.lastIndex = end;
  }
  return found;
}

describe("no PostgreSQL-only SQL survives in this package's source", () => {
  it("finds none", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(HERE)) {
      const source = readFileSync(path, "utf8");
      for (const { line, body } of sqlTemplates(source)) {
        for (const { name, pattern } of FORBIDDEN) {
          if (pattern.test(body)) offenders.push(`${path.slice(HERE.length)}:${line} — ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("would see a residual statement reintroduced", () => {
    // A negative control: the scan really does reach inside a template, and the list really does
    // match. Without it, a scan that silently found NO templates at all would pass the case above.
    const planted = "const q = sql`update devices set last_seen_at = now()`;";
    expect(sqlTemplates(planted)).toHaveLength(1);
    expect(FORBIDDEN.some(({ pattern }) => pattern.test(sqlTemplates(planted)[0]!.body))).toBe(
      true,
    );
  });
});
