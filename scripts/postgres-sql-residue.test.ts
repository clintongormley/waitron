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
 * WHY IT LIVES IN THE ROOT PROJECT. It reads three packages' trees, and CI is SCOPED: a pull request
 * touching only `packages/reporting` never runs `apps/server`'s suite, so while this file sat in
 * that package the guard would not have run for the very change it was widened for (CLAUDE.md §2 on
 * the `changes` job, §4 on where a tree-reading guard belongs). Here the ungated `lint` job and the
 * pre-push hook run it on every non-docs push. It plants a residual statement on purpose in its
 * negative control below, and `scripts/` is not one of {@link ROOTS}, so it is out of its own scope
 * structurally rather than by an exclusion.
 *
 * WEAKER THAN ITS NAME, in ways worth stating because each is a statement it cannot see:
 *
 * - It reads TEXT. It finds the templates by scanning for the characters `sql` followed by a
 *   backtick, so a fragment built as a plain string and handed to `sql.raw`, or assembled from
 *   pieces, is invisible to it.
 * - It scans a HAND-WRITTEN list of directories ({@link ROOTS}), not the workspace. It started as
 *   this package alone; `packages/reporting` joined it when that package was converted, because
 *   nothing had refused the twenty-odd PostgreSQL-only statements it carried and the ten report
 *   routes answered 500 to the first person who opened them. `packages/workforce/src` joined it for
 *   the same reason — seventeen workforce routes and twelve schedule routes were answering 500.
 *   Every directory not on that list is out of scope, which today is most of the tree.
 * - `packages/workforce/test` is deliberately NOT a root, and that is a hole rather than a
 *   judgement: it holds no `sql` template today, so adding it would fail this file's own
 *   "every root yields templates" control. A residual statement written into that directory
 *   tomorrow is seen by nothing.
 * - A file can be excluded BY NAME ({@link UNSWEPT}), and nothing re-checks that an exclusion is
 *   still earning its place. The list is empty today, so every root is scanned whole.
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

const REPO = fileURLToPath(new URL("../", import.meta.url));

/**
 * The directories scanned, each one a source tree that has been swept.
 *
 * They are `src`/`test` directories rather than package roots on purpose: {@link sourceFiles}
 * recurses into every subdirectory, and a package ROOT contains `node_modules`, where drizzle's own
 * `.d.ts` examples carry `::date` casts. Measured — pointing this scan at `packages/reporting`
 * instead of `packages/reporting/src` reports hundreds of offenders, none of them this repository's.
 */
const ROOTS: readonly string[] = [
  join(REPO, "apps/server/src"),
  join(REPO, "packages/reporting/src"),
  join(REPO, "packages/reporting/test"),
  join(REPO, "packages/workforce/src"),
  // `packages/scheduler/src` joined for the same reason as the two above, and it is why `to_json`
  // and `#>>` are on the list below: `store.ts` built every timestamp read as
  // `to_json(<column>) #>> '{}'`, which refuses at prepare, and most of `run.test.ts` was red on
  // it. This guard reported nothing, and BOTH halves were needed to make it report — measured
  // 2026-09-22 by putting the expression back with this root removed, which still passed.
  join(REPO, "packages/scheduler/src"),
];

/**
 * Files that still carry PostgreSQL-only SQL, and the reason each is left alone.
 *
 * **Empty, and that is the point of the mechanism rather than the end of it.** The list held seven
 * entries until 2026-09-22, on the grounds that each asked for the real-PostgreSQL test harness and
 * so never reached an engine at all. That harness was deleted and all seven converted to
 * `useVenueDb`, which retired the grounds and left exactly one offender —
 * `packages/scheduler/src/migrations.test.ts`, a `count(*)::int` in a suite that was also red for
 * two reasons this scan cannot see (SQLSTATE assertions against an engine that answers
 * `ERR_SQLITE_ERROR`, and raw inserts omitting a `$defaultFn` id). That suite is converted too: the
 * cast is gone, the refusals are asserted through `packages/db/src/sql-state.ts`'s classes, and the
 * package runs green — so every root below is now scanned whole, with nothing held back.
 *
 * An entry here is debt this guard RECORDS rather than hides, and it is worth adding one for a file
 * that cannot be converted in the same change. The hedge to keep in mind is that nothing checks an
 * entry is still earning its place: one that stops offending sits here silently, covering whatever
 * offends next in the same file, until somebody empties the list and re-runs the scan.
 */
const UNSWEPT: readonly string[] = [];

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
  // `near "at": syntax error`. A timestamp column is TEXT here and carries no zone to convert, so
  // there is nothing for this clause to do; a read hands back the stored string.
  { name: "at time zone — SQLite has no zone conversion", pattern: /\bat\s+time\s+zone\b/ },
  // `no such function: to_char`. Its one use in this repository was normalising a `timestamptz` to a
  // UTC ISO string for a driver that returned a Date, which this engine never does.
  //
  // These two are on the list because of what they COST: `packages/workforce/src/chain.ts` carried
  // two `to_char(<column> at time zone 'UTC', …)` templates and NOTHING ELSE from this list — no
  // cast, no clock, no interval — so running the five patterns above it reported zero offenders
  // while the statement was refused at prepare. Measured 2026-09-22 against that file at
  // `git show 77e0aa190:packages/workforce/src/chain.ts`.
  { name: "to_char() — SQLite has no such function", pattern: /\bto_char\s*\(/ },
  // Row locks are gone tree-wide: one write transaction runs on the venue file at a time. SQLite
  // refuses the clause at prepare (`near "for": syntax error`), and the compiler cannot see it
  // inside a template, which is the reason it is worth a pattern.
  { name: "for update — SQLite has no row locks", pattern: /\bfor\s+update\b/ },
  // Measured against `node:sqlite` on Node v26.7.0, 2026-09-22: `select to_json(a) #>> '{}' from
  // t` is refused at prepare with `unrecognized token: "#"` (`ERR_SQLITE_ERROR`, errcode 1), and
  // with the operator removed the same statement gives `no such function: to_json`. Two separate
  // refusals, so two patterns — the operator alone is enough to refuse a statement whose function
  // name this list might not carry. Their one use in the source tree was rendering a `timestamptz`
  // as ISO-8601 text, which a `tsString` column does not need: it already holds the string the
  // writer bound.
  { name: "to_json() — SQLite has no such function", pattern: /\bto_json\s*\(/ },
  { name: "#>> — PostgreSQL JSON path operator", pattern: /#>>/ },
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
    else if (entry.endsWith(".ts") && !UNSWEPT.includes(relative(REPO, path))) {
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
