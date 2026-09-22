import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
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
 * - It scans a HAND-WRITTEN list of directories ({@link ROOTS}), not the workspace. It started as
 *   this package alone; `packages/reporting` joined it when that package was converted, because
 *   nothing had refused the twenty-odd PostgreSQL-only statements it carried and the ten report
 *   routes answered 500 to the first person who opened them. Every directory not on that list is
 *   out of scope, which today is most of the tree.
 * - One file is excluded BY NAME ({@link UNSWEPT}) and still carries residue. It is not a false
 *   positive; it is debt this guard is recording rather than hiding.
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
const REPO = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * The directories scanned, each one a source tree that has been swept.
 *
 * They are `src`/`test` directories rather than package roots on purpose: {@link sourceFiles}
 * recurses into every subdirectory, and a package ROOT contains `node_modules`, where drizzle's own
 * `.d.ts` examples carry `::date` casts. Measured — pointing this scan at `packages/reporting`
 * instead of `packages/reporting/src` reports hundreds of offenders, none of them this repository's.
 */
const ROOTS: readonly string[] = [
  HERE,
  join(REPO, "packages/reporting/src"),
  join(REPO, "packages/reporting/test"),
];

/**
 * Files that still carry PostgreSQL-only SQL, and the reason each is left alone.
 *
 * `packages/reporting/src/record-daily-close.pg.test.ts` is one of the two suites in that package
 * that ask for the real-PostgreSQL harness this branch removed; it does not COLLECT, and its own
 * header records that its raw SQL is deliberately not converted, as a later step's work. Converting
 * its `count(*)::int` here would contradict that decision, and leaving it unnamed would fail this
 * guard. Naming it keeps the debt visible: the entry goes when that suite is converted or deleted.
 */
const UNSWEPT: readonly string[] = ["packages/reporting/src/record-daily-close.pg.test.ts"];

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
 * Every `.ts` file under `dir`, tests included — this file and {@link UNSWEPT} excepted.
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
    else if (entry.endsWith(".ts") && path !== SELF && !UNSWEPT.includes(relative(REPO, path))) {
      out.push(path);
    }
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

/** Every offending `<repo-relative path>:<line> — <what>` under `root`. */
function offendersUnder(root: string): string[] {
  const offenders: string[] = [];
  for (const path of sourceFiles(root)) {
    const source = readFileSync(path, "utf8");
    for (const { line, body } of sqlTemplates(source)) {
      for (const { name, pattern } of FORBIDDEN) {
        if (pattern.test(body)) offenders.push(`${relative(REPO, path)}:${line} — ${name}`);
      }
    }
  }
  return offenders;
}

describe("no PostgreSQL-only SQL survives in the swept source trees", () => {
  it.each(ROOTS.map((root) => [relative(REPO, root), root] as const))(
    "finds none in %s",
    (_, root) => {
      expect(offendersUnder(root)).toEqual([]);
    },
  );

  it("would see a residual statement reintroduced", () => {
    // A negative control: the scan really does reach inside a template, and the list really does
    // match. Without it, a scan that silently found NO templates at all would pass the cases above.
    const planted = "const q = sql`update devices set last_seen_at = now()`;";
    expect(sqlTemplates(planted)).toHaveLength(1);
    expect(FORBIDDEN.some(({ pattern }) => pattern.test(sqlTemplates(planted)[0]!.body))).toBe(
      true,
    );
  });

  it("actually reads files under every root, not an empty directory list", () => {
    // The second negative control, and the one the WIDENING needs: a root spelled wrongly, or a
    // package moved, would leave `sourceFiles` returning nothing and the case above passing while
    // checking no code at all. Each root must yield files AND `sql` templates — the templates are
    // the part that says the scan reached SQL rather than merely counting `.ts` files.
    for (const root of ROOTS) {
      const files = sourceFiles(root);
      expect(files.length, `${relative(REPO, root)} has no .ts files`).toBeGreaterThan(0);
      const templates = files.reduce(
        (total, path) => total + sqlTemplates(readFileSync(path, "utf8")).length,
        0,
      );
      expect(templates, `${relative(REPO, root)} has no sql templates`).toBeGreaterThan(0);
    }
  });
});
