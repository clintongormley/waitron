/**
 * The English-only vocabulary guard's suite. It scans the eighteen generic packages' `src/`, so it
 * polices the tree rather than any one package, and it lives in the repo-level Vitest project for
 * that reason — see the repo-root `vitest.config.ts` for what that project is and which two gates
 * run it.
 *
 * It sat in `packages/db/src` until 2026-08-01, next to the module it imports. What moved is the
 * SUITE alone: `english-only.ts` stays where two other files reach for it —
 * `packages/db/src/schema/series.test.ts` imports `findSpanish`, and
 * `packages/fiscal-verifactu/src/vocabulary-scope.test.ts` reads its source text by relative path
 * — and `packages/db`'s own coverage config excludes it in the same change, because the root
 * project measures it now.
 *
 * What the move bought, measured on 2026-08-01 rather than reasoned about:
 * `pnpm --filter "...@waitron/payments" ls -r --depth -1 --json` lists six packages, none of them
 * `@waitron/db`, and `--filter "...@waitron/ui"` lists one. Neither gate loaded this file on
 * either shape of push while it lived in `packages/db`.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXEMPT_PACKAGES,
  GENERIC_PACKAGES,
  PACKAGES_ROOT,
  SELF,
  findSpanish,
  readSource,
  sourceFilesIn,
} from "../packages/db/src/english-only.js";

const discovered = GENERIC_PACKAGES.flatMap((name) =>
  sourceFilesIn(name).map((file) => [`${name}: ${file.replace(PACKAGES_ROOT, "")}`, file] as const),
);

describe("configuration", () => {
  it("scopes itself to the eighteen generic packages", () => {
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
      "layouts",
      "recipes",
      "purchasing",
      "printing",
      "diagnostics",
    ]);
  });

  it("exempts the three Spanish packages", () => {
    // Spec §2: verifactu/fiscal-verifactu mirror AEAT 1:1 and translating there would only obscure;
    // workforce-es is the registro-de-jornada Spain module (sub-project 16), Spanish by the same
    // logic. None of the three may also be a generic package.
    expect([...EXEMPT_PACKAGES]).toEqual(["verifactu", "fiscal-verifactu", "workforce-es"]);
    for (const name of EXEMPT_PACKAGES) {
      expect(GENERIC_PACKAGES).not.toContain(name);
    }
  });

  it("excludes only the files that define a forbidden-vocabulary list, by exact name", () => {
    // A wildcard here (say, *.test.ts) would silently drop every test file in
    // packages/db out of scope, which is where fixture names live.
    //
    // This file was the third entry until 2026-08-01. It carries the wordlist
    // in its fixtures just as `english-only.ts` does, and needed exempting for
    // exactly that reason while it lived in `packages/db/src`; from `scripts/`
    // it is out of scope by location, since `sourceFilesIn` only ever walks
    // `packages/<name>/src`.
    expect([...SELF]).toEqual(["english-only.ts", "no-regime-vocabulary.test.ts"]);
  });

  it("no longer needs to exempt this suite, because the scan cannot reach it", () => {
    // The assertion above only says the name is gone from the list. This says
    // the exemption is not needed — the reason it was dropped rather than the
    // fact that it was.
    const scanned = GENERIC_PACKAGES.flatMap((name) => sourceFilesIn(name));
    expect(scanned.some((file) => file.endsWith("english-only.test.ts"))).toBe(false);
    expect(scanned.length).toBeGreaterThan(0);
  });

  it("returns nothing for a package that does not exist on disk", () => {
    // Documented behaviour of `sourceFilesIn` with no test until 2026-08-01:
    // the guard has to be in place BEFORE a generic package is created, so a
    // name in GENERIC_PACKAGES with no directory yet is silence, not a crash.
    // Deleting the `existsSync` line it turns on makes this throw ENOENT.
    expect(sourceFilesIn("no-such-package")).toEqual([]);
  });

  it("discovers source files in every generic package that exists on disk", () => {
    // A guard whose file list is empty passes every assertion below it. This
    // is the assertion that stops that.
    for (const name of GENERIC_PACKAGES) {
      const dir = join(PACKAGES_ROOT, name, "src");
      if (!existsSync(dir)) continue;
      expect(sourceFilesIn(name).length).toBeGreaterThan(0);
    }
    expect(discovered.length).toBeGreaterThan(0);
  });
});

describe("findSpanish", () => {
  it("flags a Spanish identifier", () => {
    const found = findSpanish("const ultimaHuella = head.lastHash;");
    expect(found.map((v) => v.word)).toEqual(["huella"]);
  });

  it("flags a Spanish table name inside a string literal", () => {
    // The load-bearing case. No ESLint selector can see into this string, and
    // this is the mistake that reaches a migration and then a database.
    const found = findSpanish('export const records = pgTable("registros_facturacion", {});');
    expect(found.map((v) => v.word)).toEqual(["registros", "facturacion"]);
  });

  it("flags a Spanish column name inside an object key", () => {
    const found = findSpanish('  numeroInstalacion: text("numero_instalacion"),');
    expect(found.map((v) => v.word)).toEqual(["numero", "instalacion", "numero", "instalacion"]);
  });

  it("flags accented forms as well as unaccented", () => {
    // Both spellings occur in the sources — the XSDs are accented, the column
    // names in the naming contract are not.
    expect(findSpanish("const anulación = 1;").map((v) => v.word)).toEqual(["anulacion"]);
    expect(findSpanish("const anulacion = 1;").map((v) => v.word)).toEqual(["anulacion"]);
    expect(findSpanish("const envío = 1;").map((v) => v.word)).toEqual(["envio"]);
  });

  it("reports the line number", () => {
    const found = findSpanish("const ok = 1;\nconst cadena = 2;\n");
    expect(found).toEqual([{ line: 2, word: "cadena", text: "const cadena = 2;" }]);
  });

  it("does not flag English words that contain a Spanish word", () => {
    // The whole difference between a guard people keep and a guard people
    // disable. `series` contains `serie`; `imported` contains `importe`;
    // `delta` contains `alta`; `number` is not `numero` but `renumbered`
    // would trip a substring match.
    expect(
      findSpanish(
        "import { invoiceSeries } from './series.js';\n" +
          "const importedRows = delta.filter((r) => r.renumbered);\n",
      ),
    ).toEqual([]);
  });

  it("does not flag words shared by both languages", () => {
    // total, base, local, error, real: identical in Spanish and English, and
    // all five appear in the naming contract. Flagging them would make the
    // guard fire on `sales.total` on its first day.
    expect(findSpanish("const { total, base, locale, error } = row;")).toEqual([]);
  });

  it("does not flag NIF", () => {
    // tenants.nif is in the naming contract. It is a legal identifier and an
    // acronym, not vocabulary — "tax id" would be a less precise column name,
    // not a more English one.
    expect(findSpanish('nif: text("nif").notNull(),')).toEqual([]);
  });

  it("ignores Spanish inside line and block comments", () => {
    // Comments explaining the regime are legitimate and wanted — the whole
    // reason this layer exists is that a reader needs to know what the module
    // on the other side of the interface is doing. The constraint in spec §2
    // is on identifiers and table/column names.
    expect(findSpanish("// mirrors AEAT's registro de alta and its huella")).toEqual([]);
    expect(findSpanish("/*\n * The cadena head. Spanish stays in the module.\n */")).toEqual([]);
  });

  it("still flags code on a line that also carries a comment", () => {
    // Stripping a comment must not take the code with it.
    const found = findSpanish("const cadena = 1; // the chain head");
    expect(found.map((v) => v.word)).toEqual(["cadena"]);
  });

  it("permits the operation_description column named in the naming contract", () => {
    // Passes on its own merits rather than through an exception list: the
    // column was renamed out of Spanish, so it tokenises to `operation` and
    // `description` and there is nothing for the guard to forgive.
    expect(findSpanish('operationDescription: text("operation_description"),')).toEqual([]);
    // And the Spanish form it replaced is still caught, which is what stops
    // the rename from being quietly reverted.
    expect(
      findSpanish('descriptionOperacion: text("description_operacion"),').map((v) => v.word),
    ).toEqual(["operacion", "operacion"]);
    expect(findSpanish('tipoOperacion: text("tipo_operacion"),').map((v) => v.word)).toEqual([
      "tipo",
      "operacion",
      "tipo",
      "operacion",
    ]);
  });
});

describe("the labour vocabulary (sub-project 16) fires", () => {
  it("flags Spanish labour identifiers and column names, so packages/workforce is guarded", () => {
    // The list carried fiscal/POS terms but no labour terms until sub-project 16 added them. This
    // proves the additions actually fire — a token added to SPANISH_WORDS but never matched would
    // be dead weight. The negative direction (they stay silent on the eighteen generics, including the
    // new English packages/workforce) is proven by the describe.each block at the bottom passing.
    expect(findSpanish('jornadaLaboral: text("jornada_laboral"),').map((v) => v.word)).toEqual([
      "jornada",
      "jornada",
    ]);
    expect(findSpanish("const fichaje = 1; const empleado = 2;").map((v) => v.word)).toEqual([
      "fichaje",
      "empleado",
    ]);
  });

  it("does not flag English words that merely contain a new labour token", () => {
    // Whole-token matching, same guarantee the fiscal tokens carry: `contract` is not `contrato`,
    // `permission` is not `permiso`, `baja` is not a substring match of anything English here.
    expect(findSpanish("const contract = permission ?? baseline;")).toEqual([]);
  });
});

describe("the wordlist is not decorative", () => {
  it("flags real Spanish code in packages/verifactu", () => {
    // Proves two things at once: the wordlist matches vocabulary that actually
    // occurs in this repo rather than a plausible-looking list, and the scope
    // is what exempts the Spanish packages — not a wordlist too weak to fire
    // on them. A guard that would pass on packages/verifactu is a guard that
    // would pass on a Spanish packages/db too.
    const files = sourceFilesIn("verifactu");
    expect(files.length).toBeGreaterThan(0);
    const words = new Set(
      files.flatMap((file) => findSpanish(readSource(file))).map((v) => v.word),
    );
    expect(words.has("huella")).toBe(true);
    expect(words.has("registro")).toBe(true);
  });
});

describe.each(discovered)("%s", (_label, file) => {
  it("uses English vocabulary only", () => {
    const violations = findSpanish(readSource(file));
    // Reported as formatted lines rather than a bare count: a failure needs to
    // say which word on which line, or the next person deletes the test.
    expect(violations.map((v) => `${v.line}: ${v.word} — ${v.text}`)).toEqual([]);
  });
});
