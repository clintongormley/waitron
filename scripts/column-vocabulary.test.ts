import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract: `packages/db/src/schema/columns.ts` is the only file that names the storage engine's
 * column and table types. Every other file gets them from that vocabulary, so the next engine
 * change replaces one file rather than every column declaration in the tree.
 *
 * The forbidden set is DERIVED from the vocabulary's own `drizzle-orm/sqlite-core` import block
 * rather than written down here: whatever that file imports from the engine is what no other file
 * may import from it. If the vocabulary ever imports a CONSTRAINT builder (`check`, `index`,
 * `foreignKey`, …) to build a helper, this guard starts reporting every table file that imports
 * that same name directly. That is a decision to make then, not a case to except quietly.
 *
 * `customType` (a builder FACTORY) and `sqliteTable` (the TABLE builder, which the vocabulary
 * re-exports as `table`) are in that set deliberately: a table file calling either is doing what
 * this guard exists to stop.
 *
 * Four gaps:
 *
 * 1. **It reads TEXT, not code.** It matches an import SPECIFIER, so a builder reached through a
 *    namespace import (`import * as pg from "drizzle-orm/sqlite-core"`, then `pg.text(…)`) is
 *    invisible to it. A namespace import is not itself reported, because the constraint builders
 *    are imported from that module legitimately all over the tree. An import renamed on the way in
 *    (`text as t`) IS caught.
 * 2. **It reads the import, not the call.** A file that imports nothing from the engine but builds
 *    a column some other way is not seen.
 * 3. **Its scope is `packages/` and `apps/`, and it includes their test files.** `bench/`,
 *    `deploy/` and `scripts/` are outside it. A test that declares a probe table with a builder
 *    imported straight from the engine IS reported, which is deliberate — a probe table is a table.
 *    Four shapes of import are also outside it: a star re-export
 *    (`export * from "drizzle-orm/sqlite-core"`), a dynamic `await import(…)` or `require(…)`, a
 *    subpath (`drizzle-orm/sqlite-core/…`), and a side-effect import. And because it does not
 *    require the word `import`, prose in a COMMENT shaped like
 *    `{ text } from "drizzle-orm/sqlite-core"` is reported as an offender.
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
 * The driver adapter, which sits BELOW the vocabulary and exists to name the engine: `@waitron/db`
 * imports `@waitron/store`, so the store cannot import the vocabulary back, and its suites declare
 * their probe tables straight from the engine.
 *
 * WIDER than `ALLOWED` below: a whole directory and every builder in it. Nothing in this file
 * narrows it: a product table declared there would pass this guard, though it would already be in
 * the wrong package. Nothing outside `src/` of that package is exempt.
 */
const ENGINE_ADAPTER = "packages/store/src/";

/**
 * The one legitimate direct import in the tree, scoped to the single builder.
 *
 * `registros_facturacion.cuota_total` and `importe_total` store the exact bytes that went into the
 * Veri*Factu huella, so they must not pass through a helper that could ever re-render them (the
 * comment above the two declarations in that file). Scoped to `text` on purpose: a different
 * builder appearing in that file is a new decision.
 */
const ALLOWED: ReadonlyArray<{ readonly file: string; readonly name: string }> = [
  { file: "packages/fiscal-verifactu/src/schema/registros.ts", name: "text" },
];

/**
 * Every `.ts` file under `dir`. The DIRECTORY branch is taken first: a failing browser test writes
 * its screenshot into a directory named after the test file, and a walk that dispatched on the
 * extension would hand that directory to `readFileSync` and die with `EISDIR`.
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
 * A block comment, written so it cannot match ACROSS two of them: a lazy `[\s\S]*?` could swallow
 * several comments at once, which allows a false match and backtracks exponentially when the
 * pattern around it fails.
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
 * brace. A plain `[^{}]*` ends the capture at a `}` inside a comment, nothing matches, and the
 * offender is reported by nothing; prettier leaves that shape alone.
 */
const SPECIFIERS = `\\{((?:[^{}/]|${BLOCK_COMMENT}|${LINE_COMMENT})*)\\}`;

/**
 * An import (or re-export) of named bindings from the engine's module, in any of the shapes the
 * tree can hold: wrapped over several lines by prettier, quoted either way, with comments between
 * the tokens. It deliberately does not require the word `import`, so a re-export is read too; the
 * price is stated in the gap list.
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
 * about. Comments inside the braces are removed first: prettier moves a comment written on either
 * side of the braces to INSIDE them. One it leaves alone is between `from` and the module's name,
 * which the second `GAP` covers; a comment before the `import` keyword is outside the match.
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
 * hand; it GROWS as builders are retired, where `ALLOWED` above only shrinks. It is per-ENGINE, and
 * nothing has yet been retired from `drizzle-orm/sqlite-core`. This guard does not read imports
 * from `drizzle-orm/pg-core` at all.
 *
 * It cannot cover the names the vocabulary never imported at all — `blob`, a real
 * `drizzle-orm/sqlite-core` column builder the vocabulary does not use, is in no
 * forbidden set here.
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
    // and the check above passes while asserting nothing. It asks for the DERIVED half alone,
    // because a `RETIRED` entry would keep `engineNames()` non-empty while the derivation broke.
    expect(importedFromEngine(readFileSync(join(repoRoot, VOCABULARY), "utf8"))).not.toEqual([]);
  });

  it("reaches both roots", () => {
    const files = allSources();
    for (const root of ROOTS) {
      expect(files.some((file) => file.startsWith(`${root}/`))).toBe(true);
    }
  });

  it("still forbids a builder a future `RETIRED` entry names", () => {
    // `RETIRED` is empty, so this pins the MECHANISM the next retirement will rely on: a name in
    // the forbidden set is reported from a real import line. Only the import is read; the
    // declaration below it shows what the import was for.
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
    expect(
      report(`import { /* keep the exact bytes */ text } from "drizzle-orm/sqlite-core";`),
    ).toEqual([`${other} imports text`]);
  });

  it("reports one behind a comment that itself contains a closing brace", () => {
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
    // `startsWith` on a prefix with no trailing separator would swallow a sibling package; the
    // constant carries the separator.
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
