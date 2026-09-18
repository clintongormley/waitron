import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract: `packages/db/src/schema/columns.ts` is the only file that names the storage engine's
 * column types. Every other file gets its columns from that vocabulary, so the SQLite switch
 * (task F1) replaces one file rather than every column declaration in the tree.
 *
 * The forbidden set is DERIVED from the vocabulary's own `drizzle-orm/pg-core` import block rather
 * than written down here, because a list written down here is stale the moment a helper is added:
 * whatever that file imports from the engine is, by definition, what no other file may import from
 * it. A consequence worth knowing before it surprises someone: if the vocabulary ever imports a
 * CONSTRAINT builder (`check`, `index`, `foreignKey`, …) to build a helper, this guard starts
 * reporting every table file that imports that same name directly. That is a decision to make then
 * — either the vocabulary owns the builder and the table files move onto it, or the helper is
 * written without the import — not a case to except quietly.
 *
 * `customType` is in the set deliberately, by the same reasoning rather than by omission. It is a
 * builder FACTORY, and the three hand-rolled `bytea` blocks the vocabulary's `binary` helper
 * replaced (in `print-jobs.ts`, `tenant-credentials.ts` and `images.ts`, all three now gone) were
 * each written with it. A table file calling `customType(` is doing the thing this guard exists to
 * stop, so the vocabulary is the one place it may be imported.
 *
 * Three gaps, stated here because a failing test can never restore a missing hedge:
 *
 * 1. **It reads TEXT, not code.** It matches an import SPECIFIER, so a builder reached through a
 *    namespace import (`import * as pg from "drizzle-orm/pg-core"`, then `pg.text(…)`) is invisible
 *    to it. Pinned as a control below rather than only claimed. A namespace import is not itself
 *    reported, because `check`, `index` and the other constraint builders are imported from that
 *    module legitimately all over the tree and a namespace import of them would be a false report.
 *    An import renamed on the way in (`text as t`) IS caught — the specifier still spells `text`.
 * 2. **It reads the import, not the call.** A file that imports nothing from the engine but builds
 *    a column some other way is not seen.
 * 3. **The allowance is a hand-written pair of file and builder.** It is scoped to the builder, not
 *    the file, so a `numeric("cuota_total")` added to the same file later is still reported — but
 *    nothing stops a future entry being added to the list instead of fixing the file. The list
 *    shrinks; it does not grow.
 */

const repoRoot = join(import.meta.dirname, "..");
const ROOTS = ["packages", "apps"];

/** The vocabulary itself — the one file allowed to name the engine's column types. */
const VOCABULARY = "packages/db/src/schema/columns.ts";

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
 * The `isFile()` check is not decoration: a failing browser test writes its screenshot into a
 * DIRECTORY named after the test file, so a tree walk that trusts the extension hands a directory
 * to `readFileSync` and the guard dies with `EISDIR` instead of reporting on the repository
 * (root `CLAUDE.md` §4).
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
 * The names a file imports from `drizzle-orm/pg-core`, as they are spelled in that module.
 *
 * `[^}]*` spans newlines, which is what makes this read an import block prettier has wrapped over
 * several lines. Both shapes are in the tree, the vocabulary's own among the wrapped ones, and a
 * pattern that stopped at the end of a line would silently read only the one-line ones — the
 * dangerous direction for a guard. A renamed import yields the IMPORTED name (`text as t` → `text`),
 * which is the name the rule is about.
 */
function importedFromPgCore(text: string): string[] {
  const pattern = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"drizzle-orm\/pg-core"/g;
  const names: string[] = [];
  for (const match of text.matchAll(pattern)) {
    for (const specifier of match[1]!.split(",")) {
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

/** What the vocabulary itself takes from the engine — the rule, read from the vocabulary. */
function engineNames(): Set<string> {
  return new Set(importedFromPgCore(readFileSync(join(repoRoot, VOCABULARY), "utf8")));
}

/**
 * `"<file> imports <name>"` for every direct engine import in one file's text that the rule does
 * not allow. Takes the text rather than reading it, so the controls below run this same function
 * over a fixture string instead of a reimplementation of it.
 */
function offendingImports(file: string, text: string, forbidden: ReadonlySet<string>): string[] {
  if (file === VOCABULARY) return [];
  return importedFromPgCore(text)
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

describe("the column vocabulary is the only place the engine's column types are named", () => {
  it("no file outside the vocabulary imports a column builder from drizzle", () => {
    expect(offenders(allSources(), engineNames())).toEqual([]);
  });

  it("the rule it reads is not empty — the vocabulary still imports from the engine", () => {
    // Without this, renaming the vocabulary or reshaping its import block empties the forbidden set
    // and the check above passes while asserting nothing.
    expect([...engineNames()]).not.toEqual([]);
  });

  it("reaches both roots", () => {
    const files = allSources();
    for (const root of ROOTS) {
      expect(files.some((file) => file.startsWith(`${root}/`))).toBe(true);
    }
  });

  it("the one allowance is still earned", () => {
    // An allowance for something a file no longer does is an allowance nobody will notice covering
    // the next offender. If this fails, delete the entry rather than the assertion.
    for (const entry of ALLOWED) {
      const imported = importedFromPgCore(readFileSync(join(repoRoot, entry.file), "utf8"));
      expect(imported).toContain(entry.name);
    }
  });
});

describe("negative controls", () => {
  const FORBIDDEN = new Set(["text", "uuid", "numeric", "customType"]);
  const other = "packages/x/src/schema/x.ts";
  const report = (source: string, file = other) => offendingImports(file, source, FORBIDDEN);

  it("reports a column builder imported straight from the engine", () => {
    expect(report(`import { text } from "drizzle-orm/pg-core";`)).toEqual([
      `${other} imports text`,
    ]);
  });

  it("reports one renamed on the way in", () => {
    expect(report(`import { text as t } from "drizzle-orm/pg-core";`)).toEqual([
      `${other} imports text`,
    ]);
  });

  it("reports a builder factory", () => {
    expect(report(`import { customType } from "drizzle-orm/pg-core";`)).toEqual([
      `${other} imports customType`,
    ]);
  });

  it("reads an import block prettier wrapped over several lines", () => {
    expect(report(`import {\n  check,\n  index,\n  uuid,\n} from "drizzle-orm/pg-core";`)).toEqual([
      `${other} imports uuid`,
    ]);
  });

  it("leaves the constraint builders alone", () => {
    expect(report(`import { check, foreignKey, index } from "drizzle-orm/pg-core";`)).toEqual([]);
  });

  it("leaves a same-named import from the vocabulary alone", () => {
    expect(report(`import { label, table } from "./columns.js";`)).toEqual([]);
  });

  it("does not see a namespace import — gap 1, pinned rather than claimed", () => {
    expect(report(`import * as pg from "drizzle-orm/pg-core";\nconst c = pg.text("c");`)).toEqual(
      [],
    );
  });

  it("exempts the vocabulary itself", () => {
    expect(report(`import { text, uuid } from "drizzle-orm/pg-core";`, VOCABULARY)).toEqual([]);
  });

  it("allows the one allowed builder in the one allowed file", () => {
    expect(report(`import { check, text } from "drizzle-orm/pg-core";`, ALLOWED[0]!.file)).toEqual(
      [],
    );
  });

  it("does not allow a DIFFERENT builder in that same file", () => {
    expect(
      report(`import { numeric, text } from "drizzle-orm/pg-core";`, ALLOWED[0]!.file),
    ).toEqual([`${ALLOWED[0]!.file} imports numeric`]);
  });
});
