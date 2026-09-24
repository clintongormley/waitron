import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Nothing else in the tree refuses PostgreSQL-only SQL written inside a `sql` template: `tsc` never
 * looks inside one, and a statement the engine cannot parse is refused at PREPARE, at run time, in
 * whichever request first reaches it. It plants a residual statement in its negative control below;
 * `scripts/` is not one of {@link ROOTS}, so it is out of its own scope.
 *
 * WEAKER THAN ITS NAME:
 *
 * - It reads TEXT. It finds the templates by scanning for the characters `sql` followed by a
 *   backtick, so a fragment built as a plain string and handed to `sql.raw`, or assembled from
 *   pieces, is invisible to it.
 * - It scans a HAND-WRITTEN list of directories ({@link ROOTS}), not the workspace. Every directory
 *   not on that list is out of scope, which is most of the tree.
 * - `packages/workforce/test` is deliberately NOT a root, and that is a hole rather than a
 *   judgement: it holds no `sql` template, so adding it would fail this file's own "every root
 *   yields templates" control.
 * - A file can be excluded BY NAME ({@link UNSWEPT}), and nothing re-checks that an exclusion is
 *   still earning its place.
 * - Its list of PostgreSQL-only constructs is hand-written; a construct not on it passes.
 * - It over-reports in one direction: the scan leaves `${…}` in place, so a JavaScript `Date.now()`
 *   interpolated into a template matches the `now()` pattern. Hoist the expression to a `const`
 *   above the template rather than weakening the pattern.
 * - It sees the WRITTEN statement, not the one that runs: a raw `insert` leaning on a column
 *   default that is a JavaScript `$defaultFn` generator (a raw insert never reaches one, so the row
 *   is refused NOT NULL at run time), and a raw `select` of a `json` or boolean column, which skips
 *   drizzle's read mapping and hands back the stored TEXT or a 0/1, are both invisible here.
 */

const REPO = fileURLToPath(new URL("../", import.meta.url));

/**
 * The directories scanned. They are `src`/`test` directories rather than package roots because
 * {@link sourceFiles} recurses into every subdirectory, and a package ROOT contains `node_modules`,
 * where drizzle's own `.d.ts` examples carry `::date` casts.
 */
const ROOTS: readonly string[] = [
  join(REPO, "apps/server/src"),
  join(REPO, "packages/reporting/src"),
  join(REPO, "packages/reporting/test"),
  join(REPO, "packages/workforce/src"),
  join(REPO, "packages/scheduler/src"),
];

/**
 * Files that still carry PostgreSQL-only SQL, and the reason each is left alone. Nothing checks an
 * entry is still earning its place: one that stops offending sits here silently, covering whatever
 * offends next in the same file.
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
  // `json_group_array` / `json_object` are SQLite's; `information_schema` does not exist here (the
  // PRAGMA functions replace it); LATERAL is refused at prepare.
  {
    name: "PostgreSQL-only function or clause",
    pattern:
      /\b(?:to_jsonb|jsonb_populate_record|json_agg|jsonb_agg|json_build_object|bool_or|bool_and|string_agg|lateral|information_schema)\b/,
  },
  // `near "at": syntax error`. A timestamp column is TEXT here and carries no zone to convert, so
  // there is nothing for this clause to do; a read hands back the stored string.
  { name: "at time zone — SQLite has no zone conversion", pattern: /\bat\s+time\s+zone\b/ },
  // `no such function: to_char`.
  { name: "to_char() — SQLite has no such function", pattern: /\bto_char\s*\(/ },
  // Row locks are gone tree-wide: one write transaction runs on the venue file at a time. SQLite
  // refuses the clause at prepare (`near "for": syntax error`), and the compiler cannot see it
  // inside a template, which is the reason it is worth a pattern.
  { name: "for update — SQLite has no row locks", pattern: /\bfor\s+update\b/ },
  // Two separate refusals, so two patterns: the operator alone refuses a statement whose function
  // name this list might not carry.
  { name: "to_json() — SQLite has no such function", pattern: /\bto_json\s*\(/ },
  { name: "#>> — PostgreSQL JSON path operator", pattern: /#>>/ },
];

/**
 * Every `.ts` file under `dir`, tests included, {@link UNSWEPT} excepted: a suite's own fixture
 * reaches the engine exactly the way a request handler does.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    // The directory branch comes first: a failed browser run leaves a DIRECTORY named `*.test.ts`,
    // and `readFileSync` on one throws `EISDIR`.
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith(".ts") && !UNSWEPT.includes(relative(REPO, path))) {
      out.push(path);
    }
  }
  return out;
}

/**
 * The body of every `sql`…`` template in `source`, with its line number. A `${…}` interpolation is
 * left in place.
 */
function sqlTemplates(source: string): { line: number; body: string }[] {
  const found: { line: number; body: string }[] = [];
  // `sql`, an optional `.raw`, and an optional type argument: a scan that missed the typed form
  // (`sql<number>`) would miss every `::int` in a select list.
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
    // Without this, a scan that silently found NO templates at all would pass the cases above.
    const planted = "const q = sql`update devices set last_seen_at = now()`;";
    expect(sqlTemplates(planted)).toHaveLength(1);
    expect(FORBIDDEN.some(({ pattern }) => pattern.test(sqlTemplates(planted)[0]!.body))).toBe(
      true,
    );
  });

  it("actually reads files under every root, not an empty directory list", () => {
    // A root spelled wrongly, or a package moved, would leave `sourceFiles` returning nothing. Each
    // root must yield files AND `sql` templates, which say the scan reached SQL.
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
