import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract: `packages/db/src/schema/columns.ts` is the only file that names the storage engine's
 * column and table types. Every other file gets them from that vocabulary, so the SQLite switch
 * (task F1) replaces one file rather than every column declaration in the tree.
 *
 * It lives in the ROOT Vitest project rather than beside the vocabulary in `packages/db`, which is
 * where the plan first put it, because CI expands a changed package to its DEPENDENTS: measured
 * 2026-09-18, `pnpm --filter "...@waitron/bookings" ls --depth -1 --json` lists seven packages and
 * `@waitron/db` is not among them, so a pull request adding a table file in `packages/bookings`
 * would never have run the check meant to read it. The repo-root `vitest.config.ts` header carries
 * the same reasoning and the 2026-08-01 measurements behind it.
 *
 * The forbidden set is DERIVED from the vocabulary's own `drizzle-orm/sqlite-core` import block rather
 * than written down here, because a list written down here is stale the moment a helper is added:
 * whatever that file imports from the engine is, by definition, what no other file may import from
 * it. A consequence worth knowing before it surprises someone: if the vocabulary ever imports a
 * CONSTRAINT builder (`check`, `index`, `foreignKey`, …) to build a helper, this guard starts
 * reporting every table file that imports that same name directly. That is a decision to make then
 * — either the vocabulary owns the builder and the table files move onto it, or the helper is
 * written without the import — not a case to except quietly.
 *
 * Two names in that set are not column builders, and both are there deliberately rather than by
 * omission. `customType` is a builder FACTORY: the three hand-rolled `bytea` blocks the
 * vocabulary's `binary` helper replaced (in `print-jobs.ts`, `tenant-credentials.ts` and
 * `images.ts`, all three now gone) were each written with it, so a table file calling `customType(`
 * is doing the very thing this guard exists to stop — and the vocabulary itself is written with two
 * of them, for `ts` and `binary`. `sqliteTable` is the TABLE builder, and the vocabulary re-exports
 * it as `table`; a table file naming `sqliteTable` directly is a file the NEXT engine change would
 * have to visit, which is what this whole arrangement exists to avoid. Nothing outside the
 * vocabulary imports either one today.
 *
 * **The module it reads is the engine's, and the engine changed** (task F1, 2026-09-21): it was
 * `drizzle-orm/pg-core` and is now `drizzle-orm/sqlite-core`. That swap is why the anti-vacuity
 * case below asks for the DERIVED names alone — with the old specifier against the new vocabulary
 * the derived set is empty, and the suite reported 24 passed while checking nothing.
 *
 * Four gaps, stated here because a failing test can never restore a missing hedge:
 *
 * 1. **It reads TEXT, not code.** It matches an import SPECIFIER, so a builder reached through a
 *    namespace import (`import * as pg from "drizzle-orm/sqlite-core"`, then `pg.text(…)`) is invisible
 *    to it. Pinned as a control below rather than only claimed. A namespace import is not itself
 *    reported, because `check`, `index` and the other constraint builders are imported from that
 *    module legitimately all over the tree and a namespace import of them would be a false report.
 *    An import renamed on the way in (`text as t`) IS caught — the specifier still spells `text`.
 * 2. **It reads the import, not the call.** A file that imports nothing from the engine but builds
 *    a column some other way is not seen.
 * 3. **Its scope is `packages/` and `apps/`, and it includes their test files.** `bench/`,
 *    `deploy/` and `scripts/` are outside it. A test that declares a probe table with a builder
 *    imported straight from the engine IS reported, which is deliberate — a probe table is a table
 *    — but it is a failure the next author will meet without warning. Four shapes of import are
 *    also outside it, the first two of which a reader might assume are covered because named
 *    re-exports ARE read: a star re-export (`export * from "drizzle-orm/sqlite-core"`), a dynamic
 *    `await import(…)` or `require(…)`, a subpath (`drizzle-orm/sqlite-core/…`), and a side-effect
 *    import. And the price of not requiring the word `import`, stated rather than papered over:
 *    prose in a COMMENT shaped like `{ text } from "drizzle-orm/sqlite-core"` is reported as an
 *    offender. Nothing in the tree trips it (checked 2026-09-18).
 * 4. **The allowance is a hand-written pair of file and builder.** It is scoped to the builder, not
 *    the file, so an `integer("cuota_total")` added to the same file later is still reported — but
 *    nothing stops a future entry being added to the list instead of fixing the file. The list
 *    shrinks; it does not grow.
 */

const repoRoot = join(import.meta.dirname, "..");
const ROOTS = ["packages", "apps"];

/** The vocabulary itself — the one file allowed to name the engine's column and table types. */
const VOCABULARY = "packages/db/src/schema/columns.ts";

/**
 * The driver adapter, which sits BELOW the vocabulary and exists to name the engine.
 *
 * `@waitron/store` is what teaches Drizzle to drive `node:sqlite`; `@waitron/db` imports it, so it
 * cannot import the vocabulary back — its `package.json` declares one dependency, `drizzle-orm`,
 * and nothing from this workspace, and `scripts/workspace-cycles.test.ts` is what would fail if
 * that were added. Its suites therefore declare their probe tables with `sqliteTable`, `text` and
 * `integer` straight from the engine, because there is no other way for them to reach a column at
 * all.
 *
 * This exemption is WIDER than `ALLOWED` below: that one is a hand-written pair of file and
 * builder, this one is a whole directory and every builder in it. What narrows it is the package
 * itself — a PRODUCT table declared there would be in the wrong package before it was an exempted
 * import. Nothing outside `src/` of that package is exempt.
 */
const ENGINE_ADAPTER = "packages/store/src/";

/**
 * The one legitimate direct import in the tree, scoped to the single builder.
 *
 * `registros_facturacion.cuota_total` and `importe_total` store the exact bytes that went into the
 * Veri*Factu huella, so they must not pass through a helper that could ever re-render them — the
 * reasoning is written out in that file, in the comment above the two declarations
 * (`grep -n cuotaTotal`). Scoped to `text` on purpose: a different builder appearing in that file is a new
 * decision, not something this entry covers.
 */
const ALLOWED: ReadonlyArray<{ readonly file: string; readonly name: string }> = [
  { file: "packages/fiscal-verifactu/src/schema/registros.ts", name: "text" },
];

/**
 * Every `.ts` file under `dir`, discovered rather than listed.
 *
 * The shape to keep is that the DIRECTORY branch is taken first: a failing browser test writes its
 * screenshot into a directory named after the test file, and a walk that dispatched on the
 * extension would hand that directory to `readFileSync` and die with `EISDIR` instead of reporting
 * on the repository (root `CLAUDE.md` §4). The `isFile()` call then only has to drop an entry
 * `statSync` reports as neither file nor directory — a socket, a fifo, a device node. A symlink to
 * a real source file is followed and kept, `statSync` being the dereferencing one.
 */
function sourceFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...sourceFilesIn(full));
    else if (stats.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Every `.ts` file under `packages/` and `apps/`, as repo-relative paths. */
function allSources(): string[] {
  return ROOTS.flatMap((root) => sourceFilesIn(join(repoRoot, root)))
    .map((file) => relative(repoRoot, file))
    .sort();
}

/**
 * A block comment, written so it cannot match ACROSS two of them.
 *
 * The lazy `[\s\S]*?` this replaced could: one alternative swallowed several comments at once,
 * which both allows a false match and backtracks exponentially when the pattern around it fails.
 * Measured 2026-09-18 on the lazy form — a brace followed by N block comments and no `from` took
 * 253ms at N=24, 1.25s at N=30 and 5.3s at N=32. The whole scan of the real tree takes ~75ms either
 * way; this is about the shape being wrong, not about today's runtime.
 */
const BLOCK_COMMENT = String.raw`/\*(?:[^*]|\*(?!/))*\*/`;

/** A line comment, up to and including its newline. */
const LINE_COMMENT = String.raw`//[^\n]*\n`;

/**
 * Whitespace or a comment, between the tokens of an import statement.
 *
 * Written out because every one of these positions is a place a comment can sit and a pattern built
 * from `\s` alone would stop matching — silently, which for a guard is the dangerous direction.
 */
const GAP = `(?:\\s|${BLOCK_COMMENT}|${LINE_COMMENT})*`;

/**
 * The text between an import's braces: names, commas, and comments that may themselves CONTAIN a
 * brace.
 *
 * A plain `[^{}]*` is the version a review seat broke on 2026-09-18, by writing a closing brace
 * INSIDE the comment: the capture ends there rather than at the real brace, nothing matches, and the
 * offender is reported by nothing. Prettier leaves that shape byte-for-byte alone, so
 * `format:check` does not undo it. Both halves of the trick — a `}` in the comment and a `{` in the
 * comment — are controls below.
 */
const SPECIFIERS = `\\{((?:[^{}/]|${BLOCK_COMMENT}|${LINE_COMMENT})*)\\}`;

/**
 * An import (or re-export) of named bindings from the engine's module, in any of the shapes the
 * tree can hold: wrapped over several lines by prettier, quoted either way, with comments between
 * the tokens. It deliberately does not require the word `import`, so
 * `export { text } from "drizzle-orm/sqlite-core"` is read too — a re-export smuggles a builder just as
 * well as an import. The price of dropping that word is stated in the gap list: prose in a comment
 * of the same shape would be reported (nothing in the tree trips it, checked 2026-09-18).
 */
const NAMED_FROM_ENGINE = new RegExp(
  SPECIFIERS + GAP + "from" + GAP + String.raw`["']drizzle-orm/sqlite-core["']`,
  "g",
);

/**
 * `source` with its comments removed. Used ONLY on the text between an import's braces, where there
 * are no string or template literals to confuse it — running it over a whole file would need a
 * scanner that knows about `"…"`, `` `…` `` and regex literals, and getting that wrong deletes real
 * code and reports nothing.
 */
function withoutComments(source: string): string {
  return source.replace(new RegExp(BLOCK_COMMENT, "g"), " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * The names a file imports from `drizzle-orm/sqlite-core`, as they are spelled in that module.
 *
 * A renamed import yields the IMPORTED name (`text as t` → `text`), which is the name the rule is
 * about. Comments inside the braces are removed first, and that is not hypothetical: a review seat
 * on 2026-09-18 planted a block comment between the opening brace and the name, and an earlier
 * version of this function read the whole thing — comment and name together — as the specifier,
 * matched nothing, and let the offender through with the suite still reporting 14 passed. A second
 * seat then broke the repair the same way with a brace INSIDE the comment; both shapes are controls
 * below.
 *
 * Where a comment can sit, measured 2026-09-18 with `pnpm exec prettier --parser typescript`:
 * prettier moves one written on either side of the braces to INSIDE them, so in a formatted tree —
 * and `pnpm format:check` gates every push — that is the position that arises. One it leaves alone
 * is between `from` and the module's name; the second `GAP` covers that, and a comment before the
 * `import` keyword is outside the match entirely.
 */
function importedFromEngine(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(NAMED_FROM_ENGINE)) {
    for (const specifier of withoutComments(match[1]!).split(",")) {
      const imported = specifier
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]!
        .trim();
      if (imported) names.push(imported);
    }
  }
  return names;
}

/**
 * Builders the vocabulary once imported from THIS engine and does not any more.
 *
 * The derived set has one failure mode, and it is the quiet one: when the vocabulary stops using a
 * builder, that builder leaves the forbidden set, so it becomes legal in every table file on the
 * same day it stops being used in the vocabulary. This list is what holds such a name forbidden by
 * hand; it GROWS as builders are retired, where `ALLOWED` above only shrinks.
 *
 * It is EMPTY, and that is a consequence of the storage swap rather than an oversight. The list is
 * per-ENGINE: its one entry was `numeric`, a `drizzle-orm/pg-core` builder retired by task P6, and
 * a name imported from a module this guard no longer reads can never be reported by it. Nothing
 * has yet been retired from `drizzle-orm/sqlite-core`. The separate rule that no file may import
 * from the PostgreSQL module AT ALL is not stated here and is not enforced by anything today —
 * the tree's `*.test.ts` files still import it while task F1's step group 7 converts them.
 *
 * It cannot cover the names the vocabulary never imported at all — root `CLAUDE.md` §3 states that
 * gap, with `bigserial` as the standing example.
 */
const RETIRED: ReadonlySet<string> = new Set([]);

/** What the vocabulary takes from the engine, plus what it has taken in the past. */
function engineNames(): Set<string> {
  return new Set([
    ...importedFromEngine(readFileSync(join(repoRoot, VOCABULARY), "utf8")),
    ...RETIRED,
  ]);
}

/**
 * `"<file> imports <name>"` for every direct engine import in one file's text that the rule does
 * not allow. Takes the text rather than reading it, so the controls below run this same function
 * over a fixture string instead of a reimplementation of it.
 */
function offendingImports(file: string, text: string, forbidden: ReadonlySet<string>): string[] {
  if (file === VOCABULARY || file.startsWith(ENGINE_ADAPTER)) return [];
  return importedFromEngine(text)
    .filter((name) => forbidden.has(name))
    .filter((name) => !ALLOWED.some((entry) => entry.file === file && entry.name === name))
    .map((name) => `${file} imports ${name}`);
}

/** The same over every file in the tree. */
function offenders(files: readonly string[], forbidden: ReadonlySet<string>): string[] {
  return files.flatMap((file) =>
    offendingImports(file, readFileSync(join(repoRoot, file), "utf8"), forbidden),
  );
}

describe("the column vocabulary is the only place the engine's column and table types are named", () => {
  it("no file outside the vocabulary imports a column or table builder from drizzle", () => {
    expect(offenders(allSources(), engineNames())).toEqual([]);
  });

  it("the rule it reads is not empty — the vocabulary still imports from the engine", () => {
    // Without this, renaming the vocabulary or reshaping its import block empties the forbidden set
    // and the check above passes while asserting nothing. It asks for the DERIVED half alone: a
    // hand-written `RETIRED` entry is enough to keep `engineNames()` non-empty, so asserting on the
    // union would have let the derivation break silently — which is exactly what the SQLite switch
    // did to it, the vocabulary's import moving to another module while this assertion stayed green.
    expect(importedFromEngine(readFileSync(join(repoRoot, VOCABULARY), "utf8"))).not.toEqual([]);
  });

  it("reaches both roots", () => {
    const files = allSources();
    for (const root of ROOTS) {
      expect(files.some((file) => file.startsWith(`${root}/`))).toBe(true);
    }
  });

  it("still forbids a builder a future `RETIRED` entry names", () => {
    // `RETIRED` is empty today (see its note: the list is per-engine and the storage swap changed
    // the engine), so there is no real name to ask `engineNames()` for. What this pins is the
    // MECHANISM the next retirement will rely on: a name in the forbidden set is reported from a
    // real import line, by the same function the tree-wide check at the top of this block uses. It
    // is the import that is read — `offendingImports` never looks at the declaration below it,
    // which is there only to show what the import was for.
    const fixture = [
      `import { blob } from "drizzle-orm/sqlite-core";`,
      `export const bytes = blob("bytes", { mode: "buffer" });`,
    ].join("\n");
    const file = "packages/x/src/schema/x.ts";
    const forbidden = new Set([...engineNames(), "blob"]);
    expect(offendingImports(file, fixture, forbidden)).toEqual([`${file} imports blob`]);
  });

  it("the one allowance is still earned", () => {
    // An allowance for something a file no longer does is an allowance nobody will notice covering
    // the next offender. If this fails, delete the entry rather than the assertion.
    for (const entry of ALLOWED) {
      const imported = importedFromEngine(readFileSync(join(repoRoot, entry.file), "utf8"));
      expect(imported).toContain(entry.name);
    }
  });
});

describe("negative controls", () => {
  const FORBIDDEN = new Set(["text", "integer", "blob", "customType", "sqliteTable"]);
  const other = "packages/x/src/schema/x.ts";
  const report = (source: string, file = other) => offendingImports(file, source, FORBIDDEN);

  it("reports a column builder imported straight from the engine", () => {
    expect(report(`import { text } from "drizzle-orm/sqlite-core";`)).toEqual([
      `${other} imports text`,
    ]);
  });

  it("reports one renamed on the way in", () => {
    expect(report(`import { text as t } from "drizzle-orm/sqlite-core";`)).toEqual([
      `${other} imports text`,
    ]);
  });

  it("reports a builder factory", () => {
    expect(report(`import { customType } from "drizzle-orm/sqlite-core";`)).toEqual([
      `${other} imports customType`,
    ]);
  });

  it("reads an import block prettier wrapped over several lines", () => {
    expect(
      report(`import {\n  check,\n  index,\n  integer,\n} from "drizzle-orm/sqlite-core";`),
    ).toEqual([`${other} imports integer`]);
  });

  it("leaves the constraint builders alone", () => {
    expect(report(`import { check, foreignKey, index } from "drizzle-orm/sqlite-core";`)).toEqual(
      [],
    );
  });

  it("leaves a same-named import from the vocabulary alone", () => {
    expect(report(`import { label, table } from "./columns.js";`)).toEqual([]);
  });

  it("reports one hidden behind a comment inside the braces", () => {
    // The shape a review seat planted on 2026-09-18 that an earlier version of the parser missed.
    expect(
      report(`import { /* keep the exact bytes */ text } from "drizzle-orm/sqlite-core";`),
    ).toEqual([`${other} imports text`]);
  });

  it("reports one behind a comment that itself contains a closing brace", () => {
    // The shape the second review seat broke the first repair with, on the same day.
    expect(report(`import { /* } */ text } from "drizzle-orm/sqlite-core";`)).toEqual([
      `${other} imports text`,
    ]);
  });

  it("reports one behind a comment that itself contains an opening brace", () => {
    expect(report(`import { /* { */ text } from "drizzle-orm/sqlite-core";`)).toEqual([
      `${other} imports text`,
    ]);
  });

  it("reports the table builder, which the vocabulary also owns", () => {
    expect(report(`import { sqliteTable } from "drizzle-orm/sqlite-core";`)).toEqual([
      `${other} imports sqliteTable`,
    ]);
  });

  it("reports one with a comment between the brace and `from`", () => {
    expect(report(`import { integer } /* why */ from "drizzle-orm/sqlite-core";`)).toEqual([
      `${other} imports integer`,
    ]);
  });

  it("reports one whose module specifier is single-quoted", () => {
    expect(report(`import { text } from 'drizzle-orm/sqlite-core';`)).toEqual([
      `${other} imports text`,
    ]);
  });

  it("reports a type-only import of a builder", () => {
    expect(report(`import type { text } from "drizzle-orm/sqlite-core";`)).toEqual([
      `${other} imports text`,
    ]);
  });

  it("reports a re-export, which smuggles a builder just as well", () => {
    expect(report(`export { integer } from "drizzle-orm/sqlite-core";`)).toEqual([
      `${other} imports integer`,
    ]);
  });

  it("does not see a namespace import — gap 1, pinned rather than claimed", () => {
    expect(
      report(`import * as pg from "drizzle-orm/sqlite-core";\nconst c = pg.text("c");`),
    ).toEqual([]);
  });

  it("exempts the vocabulary itself", () => {
    expect(report(`import { text, integer } from "drizzle-orm/sqlite-core";`, VOCABULARY)).toEqual(
      [],
    );
  });

  it("exempts the driver adapter, which sits below the vocabulary", () => {
    const file = `${ENGINE_ADAPTER}x.test.ts`;
    expect(report(`import { sqliteTable, text } from "drizzle-orm/sqlite-core";`, file)).toEqual(
      [],
    );
  });

  it("does not exempt a package whose name merely starts the same way", () => {
    // `startsWith` on a prefix with no trailing separator would swallow a sibling: root
    // `CLAUDE.md` §4 records `packages/sync` reading coverage for files belonging to
    // `packages/sync-enrolment` for exactly that reason. The constant carries the separator, and
    // this is the control that says so.
    const file = "packages/store-x/src/a.ts";
    expect(report(`import { text } from "drizzle-orm/sqlite-core";`, file)).toEqual([
      `${file} imports text`,
    ]);
  });

  it("allows the one allowed builder in the one allowed file", () => {
    expect(
      report(`import { check, text } from "drizzle-orm/sqlite-core";`, ALLOWED[0]!.file),
    ).toEqual([]);
  });

  it("does not allow a DIFFERENT builder in that same file", () => {
    expect(
      report(`import { integer, text } from "drizzle-orm/sqlite-core";`, ALLOWED[0]!.file),
    ).toEqual([`${ALLOWED[0]!.file} imports integer`]);
  });
});
