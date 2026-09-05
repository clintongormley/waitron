/**
 * The English-only vocabulary guard's suite. It scans the twenty generic packages' `src/`, so it
 * polices the tree rather than any one package, and lives in the repo-level Vitest project for that
 * reason — see the repo-root `vitest.config.ts` for what that project is and which two gates run it.
 *
 * The forbidden set is ASSEMBLED here, not listed in one place (SP-3b): `packages/db/src/english-only.ts`
 * holds only the base list of generic Spanish no module owns, and every Spanish-by-design module
 * declares its own terms on its descriptor's `vocabulary` seat (`@waitron/composition`). This
 * suite derives each owner's package dir from `migrations.from` (`@waitron/module`'s
 * `packageDirOf`, which `module-graph-honesty.test.ts` reads through as well), asserts no owner is
 * generic, and proves each declaration fires on its owner's real source. `ALL_MODULES` is imported
 * for runtime values only — the root project is not typechecked (CLAUDE.md §2).
 *
 * `english-only.ts` lives under `packages/db/src` so that package's `typecheck` covers it — the
 * root project typechecks nothing (CLAUDE.md §2). Nothing in `packages/db` imports it; the root
 * config measures its coverage and `packages/db`'s config excludes it.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import {
  GENERIC_PACKAGES,
  PACKAGES_ROOT,
  SELF,
  SPANISH_WORDS,
  findSpanish,
  readSource,
  sourceFilesIn,
} from "../packages/db/src/english-only.js";
import { forbiddenVocabulary, vocabularyOwners } from "../packages/module/src/vocabulary.js";

const OWNERS = vocabularyOwners(ALL_MODULES);
const FORBIDDEN = forbiddenVocabulary(SPANISH_WORDS, ALL_MODULES);

/** The tokeniser's own tests run against a FIXED set, so a change to a module's declaration
 * cannot redden a test that is about tokenising. Assembly is tested separately. */
const FIXTURE: ReadonlySet<string> = new Set([
  "huella",
  "registros",
  "facturacion",
  "numero",
  "instalacion",
  "anulacion",
  "envio",
  "cadena",
  "serie",
  "importe",
  "alta",
  "tipo",
  "operacion",
  "mesa",
  "empleado",
  "fichaje",
  "descripcion",
]);

/**
 * Per-owner vacuous-pass anchors: terms each declaration MUST find in its owner's real source. A new
 * owner must add a row here (the "every owner has an anchor" test below insists), so a declaration
 * can never pass empty — the same reason module-graph-honesty pins its three known edges. The
 * declaration file itself (`vocabulary.ts`, where every term is a string literal) is excluded from
 * the scan, so an anchor must occur in the owner's REAL source.
 */
const ANCHORS: Record<string, readonly string[]> = {
  fiscal: ["huella", "registro", "facturacion"],
  "workforce-es": ["convenio", "jornada", "trabajador"],
};

const discovered = GENERIC_PACKAGES.flatMap((name) =>
  sourceFilesIn(name).map((file) => [`${name}: ${file.replace(PACKAGES_ROOT, "")}`, file] as const),
);

describe("configuration", () => {
  it("scopes itself to the twenty generic packages", () => {
    expect([...GENERIC_PACKAGES]).toEqual([
      "db",
      "core",
      "fiscal",
      "shared",
      "payments",
      "scheduler",
      "credentials",
      "workforce",
      "reporting",
      "identity",
      "catalogue",
      "sync",
      "membership",
      "module",
      "layouts",
      "recipes",
      "purchasing",
      "printing",
      "diagnostics",
      "sync-enrolment",
    ]);
  });

  it("derives the vocabulary owners from the descriptors, in ALL_MODULES order", () => {
    // The vacuous-pass anchor for the derivation itself: these are the two Spanish-by-design
    // packages, resolved from `migrations.from` — `fiscal` names the SLOT, `fiscal-verifactu` the
    // package filling it. A third owner appears here the day a module declares vocabulary.
    expect(OWNERS.map((o) => [o.module, o.packageDir])).toEqual([
      ["workforce-es", "workforce-es"],
      ["fiscal", "fiscal-verifactu"],
    ]);
  });

  it("never scans a vocabulary owner's package", () => {
    // A module's terms are legitimate inside its own package by definition (spec §2); listing that
    // package as generic would make the guard fail on the vocabulary it exists to define.
    for (const owner of OWNERS) {
      expect(GENERIC_PACKAGES).not.toContain(owner.packageDir);
    }
  });

  it("excludes only the files that define a forbidden-vocabulary list, by exact name", () => {
    // A wildcard here (say, *.test.ts) would silently drop every test file in packages/db out of
    // scope, which is where fixture names live.
    expect([...SELF]).toEqual(["english-only.ts", "no-regime-vocabulary.test.ts"]);
  });

  it("cannot reach this suite, so it needs no exemption", () => {
    const scanned = GENERIC_PACKAGES.flatMap((name) => sourceFilesIn(name));
    expect(scanned.some((file) => file.endsWith("english-only.test.ts"))).toBe(false);
    expect(scanned.length).toBeGreaterThan(0);
  });

  it("returns nothing for a package that does not exist on disk", () => {
    // A name in GENERIC_PACKAGES with no directory yet is silence, not a crash: the guard has to be
    // in place BEFORE a generic package is created. Deleting the `existsSync` line makes this throw.
    expect(sourceFilesIn("no-such-package")).toEqual([]);
  });

  it("discovers source files in every generic package that exists on disk", () => {
    // A guard whose file list is empty passes every assertion below it. This stops that.
    for (const name of GENERIC_PACKAGES) {
      const dir = join(PACKAGES_ROOT, name, "src");
      if (!existsSync(dir)) continue;
      expect(sourceFilesIn(name).length).toBeGreaterThan(0);
    }
    expect(discovered.length).toBeGreaterThan(0);
  });
});

describe("each module's vocabulary declaration", () => {
  it("is non-empty, guard-shaped and free of duplicates", () => {
    // The tokeniser emits lowercase unaccented a–z runs; a declared term of any other shape can
    // never match and would be dead weight. An empty declaration is a mistake, not a module with
    // nothing to say (a module with nothing to say omits the seat).
    expect(OWNERS.length).toBeGreaterThan(0);
    for (const owner of OWNERS) {
      expect(owner.terms.length, owner.module).toBeGreaterThan(0);
      for (const term of owner.terms) expect(term, owner.module).toMatch(/^[a-z]+$/);
      expect(new Set(owner.terms).size, owner.module).toBe(owner.terms.length);
    }
  });

  it("has one declaring home per word: the base list re-absorbs no module's term", () => {
    // Two MODULES may share a word (a second fiscal regime will also say `huella`); the base list
    // may not — that is what stops the central list quietly growing back (spec §2).
    const clashes = OWNERS.flatMap((o) =>
      o.terms.filter((t) => SPANISH_WORDS.has(t)).map((t) => `${t} (owned by ${o.module})`),
    );
    expect(clashes).toEqual([]);
  });

  it("every owner has a vacuous-pass anchor", () => {
    expect(Object.keys(ANCHORS).sort()).toEqual(OWNERS.map((o) => o.module).sort());
  });

  it.each(OWNERS.map((o) => [o.module, o] as const))(
    "%s: fires on its owner's own source, so the declaration is not decorative",
    (module, owner) => {
      // Proves two things at once: the declaration matches vocabulary that actually occurs in the
      // owner's REAL source, and the owner is excluded by SCOPE — not by a list too weak to fire
      // on it. Delete an anchor term from the module's list and this goes red.
      // The declaration file is excluded: every declared term is a literal there, so it would
      // satisfy any anchor and prove nothing about the package's real source.
      const files = sourceFilesIn(owner.packageDir).filter((f) => !f.endsWith("/vocabulary.ts"));
      expect(files.length).toBeGreaterThan(0);
      const own = new Set(owner.terms);
      const fired = new Set(
        files.flatMap((f) => findSpanish(readSource(f), own)).map((v) => v.word),
      );
      expect([...fired]).toEqual(expect.arrayContaining([...ANCHORS[module]!]));
    },
  );
});

describe("findSpanish", () => {
  it("flags a Spanish identifier", () => {
    const found = findSpanish("const ultimaHuella = head.lastHash;", FIXTURE);
    expect(found.map((v) => v.word)).toEqual(["huella"]);
  });

  it("flags a Spanish table name inside a string literal", () => {
    // The load-bearing case. No ESLint selector can see into this string, and this is the mistake
    // that reaches a migration and then a database.
    const found = findSpanish(
      'export const records = pgTable("registros_facturacion", {});',
      FIXTURE,
    );
    expect(found.map((v) => v.word)).toEqual(["registros", "facturacion"]);
  });

  it("flags a Spanish column name inside an object key", () => {
    const found = findSpanish('  numeroInstalacion: text("numero_instalacion"),', FIXTURE);
    expect(found.map((v) => v.word)).toEqual(["numero", "instalacion", "numero", "instalacion"]);
  });

  it("flags accented forms as well as unaccented", () => {
    // Both spellings occur in the sources — the XSDs are accented, the column names are not.
    expect(findSpanish("const anulación = 1;", FIXTURE).map((v) => v.word)).toEqual(["anulacion"]);
    expect(findSpanish("const anulacion = 1;", FIXTURE).map((v) => v.word)).toEqual(["anulacion"]);
    expect(findSpanish("const envío = 1;", FIXTURE).map((v) => v.word)).toEqual(["envio"]);
  });

  it("reports the line number", () => {
    const found = findSpanish("const ok = 1;\nconst cadena = 2;\n", FIXTURE);
    expect(found).toEqual([{ line: 2, word: "cadena", text: "const cadena = 2;" }]);
  });

  it("does not flag English words that contain a Spanish word", () => {
    // The whole difference between a guard people keep and a guard people disable. `series`
    // contains `serie`; `imported` contains `importe`; `delta` contains `alta`.
    expect(
      findSpanish(
        "import { invoiceSeries } from './series.js';\n" +
          "const importedRows = delta.filter((r) => r.renumbered);\n",
        FIXTURE,
      ),
    ).toEqual([]);
  });

  it("does not flag words shared by both languages", () => {
    // total, base, local, error, real: identical in Spanish and English, and all five appear in the
    // naming contract. Flagging them would make the guard fire on `sales.total` on its first day.
    // On the ASSEMBLED set: the claim is that no module declares one of these, not that the
    // tokeniser skips a word nobody listed.
    expect(findSpanish("const { total, base, locale, error } = row;", FORBIDDEN)).toEqual([]);
  });

  it("does not flag NIF", () => {
    // tenants.nif is in the naming contract: a legal identifier and an acronym, not vocabulary.
    // On the ASSEMBLED set: the claim is that no module declares `nif`, not that the tokeniser
    // skips a word nobody listed.
    expect(findSpanish('nif: text("nif").notNull(),', FORBIDDEN)).toEqual([]);
  });

  it("ignores Spanish inside line and block comments", () => {
    // Comments explaining the regime are legitimate and wanted; the constraint is on identifiers
    // and table/column names.
    expect(findSpanish("// mirrors AEAT's registro de alta and its huella", FIXTURE)).toEqual([]);
    expect(
      findSpanish("/*\n * The cadena head. Spanish stays in the module.\n */", FIXTURE),
    ).toEqual([]);
  });

  it("still flags code on a line that also carries a comment", () => {
    const found = findSpanish("const cadena = 1; // the chain head", FIXTURE);
    expect(found.map((v) => v.word)).toEqual(["cadena"]);
  });

  it("scans with exactly the set it is handed — the base list alone knows no fiscal term", () => {
    // The parameter is required, with no default, so a caller can never silently narrow to the base
    // list: here the narrowing is deliberate and visible. `mesa` is base vocabulary, `huella` is
    // fiscal's.
    expect(
      findSpanish("const mesa = 1; const huella = 2;", SPANISH_WORDS).map((v) => v.word),
    ).toEqual(["mesa"]);
    expect(findSpanish("const mesa = 1; const huella = 2;", FORBIDDEN).map((v) => v.word)).toEqual([
      "mesa",
      "huella",
    ]);
  });

  it("flags a labour term, so packages/workforce (English, under workforce-es) is guarded", () => {
    expect(
      findSpanish("const empleado = 1; const fichaje = 2;", FORBIDDEN).map((v) => v.word),
    ).toEqual(["empleado", "fichaje"]);
  });

  it("permits the operation_description column named in the naming contract", () => {
    // Passes on its own merits rather than through an exception list: the column was renamed out of
    // Spanish, so it tokenises to `operation` and `description` and there is nothing to forgive.
    expect(findSpanish('operationDescription: text("operation_description"),', FIXTURE)).toEqual(
      [],
    );
    // And the Spanish form it replaced is still caught, which stops the rename being reverted.
    expect(
      findSpanish('descriptionOperacion: text("description_operacion"),', FIXTURE).map(
        (v) => v.word,
      ),
    ).toEqual(["operacion", "operacion"]);
    expect(
      findSpanish('tipoOperacion: text("tipo_operacion"),', FIXTURE).map((v) => v.word),
    ).toEqual(["tipo", "operacion", "tipo", "operacion"]);
  });
});

describe.each(discovered)("%s", (_label, file) => {
  it("uses English vocabulary only", () => {
    const violations = findSpanish(readSource(file), FORBIDDEN);
    // Reported as formatted lines rather than a bare count: a failure needs to say which word on
    // which line, or the next person deletes the test.
    expect(violations.map((v) => `${v.line}: ${v.word} — ${v.text}`)).toEqual([]);
  });
});
