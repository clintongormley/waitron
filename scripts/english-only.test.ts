/**
 * The English-only guard's suite, over every tracked text file under `apps/` and `packages/` that
 * `isHome` does not place in a home for non-English text.
 *
 * The forbidden set is ASSEMBLED here: `packages/db/src/english-only.ts` holds only the base list
 * of generic Spanish no module owns, and every Spanish-by-design module declares its own terms on
 * its descriptor's `vocabulary` seat. `english-only.ts` lives under `packages/db/src` so that
 * package's `typecheck` covers it; the root config measures its coverage and `packages/db`'s config
 * excludes it.
 *
 * Weaker than its name: see conventions-data.md → "What the guard does not see".
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import {
  KEEPS_NON_ENGLISH,
  SPANISH_WORDS,
  type Violation,
  findAccented,
  findSpanish,
  isHome,
  readText,
} from "../packages/db/src/english-only.js";
import { forbiddenVocabulary, vocabularyOwners } from "../packages/module/src/vocabulary.js";
import { STILL_TO_CLEAN } from "./english-only-still-to-clean.js";

const OWNERS = vocabularyOwners(ALL_MODULES);
const FORBIDDEN = forbiddenVocabulary(SPANISH_WORDS, ALL_MODULES);

const repoRoot = join(import.meta.dirname, "..");

/**
 * `STILL_TO_CLEAN`'s length, pinned equal so a change in either direction fails: deleting entries
 * lowers this in the same change, and adding one has to raise it where the diff shows it.
 */
const STILL_TO_CLEAN_COUNT = 1181;

// A per-call kill timeout for a hung `git` (Vitest's timer cannot interrupt a blocking child), and
// a per-test bound above it for the case that builds a repository.
const GIT_SPAWN_TIMEOUT_MS = 30_000;
const SPAWN_TEST_TIMEOUT_MS = 60_000;

const GIT_LOCATION_OVERRIDES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];

function isolatedGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of GIT_LOCATION_OVERRIDES) delete env[name];
  return env;
}

/** Every file `git ls-files` lists under `apps/` and `packages/` at `root`, repo-relative. */
function trackedFiles(root: string): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", "apps", "packages"], {
    cwd: root,
    encoding: "utf8",
    env: isolatedGitEnv(),
    timeout: GIT_SPAWN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean)
    .sort();
}

/** The scanned files at `root`: tracked, outside every home, and text (no NUL byte). */
function scannedTexts(root: string): Map<string, string> {
  const texts = new Map<string, string>();
  for (const path of trackedFiles(root)) {
    if (isHome(path)) continue;
    const text = readText(join(root, path));
    if (text !== undefined) texts.set(path, text);
  }
  return texts;
}

function findings(source: string): Violation[] {
  return [...findSpanish(source, FORBIDDEN), ...findAccented(source)];
}

const TRACKED = trackedFiles(repoRoot);
const SCANNED = scannedTexts(repoRoot);
const STILL_LISTED: ReadonlySet<string> = new Set(STILL_TO_CLEAN);

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
 * Per-owner vacuous-pass anchors: terms each declaration MUST find in its owner's real source. A
 * new owner must add a row here (the "every owner has an anchor" test below insists). The
 * declaration file itself (`vocabulary.ts`) is excluded from the scan, so an anchor must occur in
 * the owner's REAL source.
 */
const ANCHORS: Record<string, readonly string[]> = {
  "fiscal-verifactu": ["huella", "registro", "facturacion"],
  "workforce-es": ["convenio", "jornada", "trabajador"],
};

describe("configuration", () => {
  it(
    "reads tracked text files only: never an untracked screenshot or a file holding a NUL byte",
    () => {
      const root = mkdtempSync(join(tmpdir(), "waitron-vocabulary-"));
      try {
        const git = (...args: string[]) =>
          execFileSync(
            "git",
            [
              "-c",
              "user.name=t",
              "-c",
              "user.email=t@example.com",
              "-c",
              "commit.gpgsign=false",
              "-c",
              "core.hooksPath=/dev/null",
              ...args,
            ],
            { cwd: root, env: isolatedGitEnv(), timeout: GIT_SPAWN_TIMEOUT_MS, stdio: "pipe" },
          );
        const source = join(root, "packages", "x", "src");
        const screenshotDirectory = join(source, "__screenshots__", "widget.test.ts");
        mkdirSync(screenshotDirectory, { recursive: true });
        writeFileSync(join(source, "widget.test.ts"), "export const count = 1;\n");
        writeFileSync(join(screenshotDirectory, "nested.ts"), "export const total = 2;\n");
        writeFileSync(join(source, "binary.png"), Buffer.from([0x89, 0x50, 0x00, 0xc3, 0xa9]));
        git("init", "-q");
        git("add", "packages");
        git("commit", "-q", "-m", "fixture");
        writeFileSync(join(screenshotDirectory, "failure.png"), "Café\n");
        writeFileSync(join(source, "untracked.ts"), "const mesa = 1;\n");

        expect([...scannedTexts(root)]).toEqual([
          ["packages/x/src/__screenshots__/widget.test.ts/nested.ts", "export const total = 2;\n"],
          ["packages/x/src/widget.test.ts", "export const count = 1;\n"],
        ]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it.each([
    ["packages/fiscal-verifactu/src/huella.ts", "packages/fiscal/src/chain.ts"],
    ["packages/country-es/src/holidays.ts", "packages/country-gb/src/holidays.ts"],
    ["packages/workforce-es/src/convenio.ts", "packages/workforce/src/shifts.ts"],
    ["packages/reporting/src/dr303-layout.ts", "packages/reporting-extra/src/form.ts"],
    ["apps/till/src/i18n/allergen-names.ts", "apps/till/src/i18n-helpers.ts"],
    ["packages/recovery-pack/src/i18n/pack-words.ts", "apps/till/src/i18n.ts"],
    [
      "packages/payments-stripe/src/dashboard/strings.ts",
      "packages/payments-stripe/src/dashboard/strings.test.ts",
    ],
    [
      "packages/payments-sumup/src/dashboard/strings.ts",
      "packages/dashboard-kit/src/table-strings.ts",
    ],
    ["apps/server/src/guide/es/orders.md", "apps/server/src/guide/en/orders.md"],
    ["apps/server/src/guide/ca/orders.md", "apps/server/src/guide/es.ts"],
    [
      "packages/adjustments/src/starter-content.ts",
      "packages/adjustments/src/dashboard/starter-content.ts",
    ],
    ["packages/catalogue/src/starter-content.ts", "packages/catalogue/src/starter-content.test.ts"],
    ["packages/catalogue/src/starter-content.ts", "packages/catalogue/src/my-starter-content.ts"],
    ["packages/catalogue/src/starter-content.ts", "apps/server/src/starter-content.ts"],
    ["packages/db/src/english-only.ts", "packages/core/src/english-only.ts"],
    ["packages/fiscal/src/no-regime-vocabulary.test.ts", "packages/db/src/english-only.test.ts"],
    [
      "packages/fiscal-verifactu/src/x.test.ts",
      "packages/provisioning/src/provisioning.e2e.test.ts",
    ],
  ])("treats %s as a home and still scans %s", (home, scanned) => {
    expect(isHome(home)).toBe(true);
    expect(isHome(scanned)).toBe(false);
  });

  it("would flag each home's real text if scanned, so its pass is the exclusion", () => {
    for (const path of [
      "packages/payments-stripe/src/dashboard/strings.ts",
      "packages/payments-sumup/src/dashboard/strings.ts",
      "packages/recovery-pack/src/i18n/pack-words.ts",
      "packages/adjustments/src/starter-content.ts",
    ]) {
      expect(TRACKED, path).toContain(path);
      expect(SCANNED.has(path), path).toBe(false);
      expect(findings(readText(join(repoRoot, path))!).length, path).toBeGreaterThan(0);
    }
  });

  it("scans the home packages' neighbours, provisioning's tests and apps", () => {
    for (const path of [
      "packages/adjustments/src/provisioning.ts",
      "packages/payments-stripe/src/index.ts",
      "apps/server/src/log-personal-data.ts",
    ]) {
      expect(SCANNED.has(path), path).toBe(true);
    }
    expect([...SCANNED.keys()].some((p) => /^packages\/provisioning\/.*\.test\.ts$/.test(p))).toBe(
      true,
    );
    expect([...SCANNED.keys()].some((p) => p.startsWith("apps/server/src/guide/en/"))).toBe(true);
  });

  it("scans something in every package and app that is not a home", () => {
    // A guard whose file list is empty passes every per-file case. This stops that.
    const owners = new Set(TRACKED.map((p) => p.split("/").slice(0, 2).join("/")));
    for (const owner of owners) {
      if (isHome(`${owner}/src/x.ts`)) continue;
      expect(
        [...SCANNED.keys()].some((p) => p.startsWith(`${owner}/`)),
        owner,
      ).toBe(true);
    }
    expect(owners.size).toBeGreaterThan(10);
  });

  it("cannot reach this suite or its list, so neither needs an exemption", () => {
    expect([...SCANNED.keys()].some((p) => p.startsWith("scripts/"))).toBe(false);
    expect(SCANNED.size).toBeGreaterThan(0);
  });

  it("derives the vocabulary owners from the descriptors, in ALL_MODULES order", () => {
    // The vacuous-pass anchor for the derivation itself: each descriptor `name` paired with the
    // package its `migrations.from` resolves to.
    expect(OWNERS.map((o) => [o.module, o.packageDir])).toEqual([
      ["workforce-es", "workforce-es"],
      ["fiscal-verifactu", "fiscal-verifactu"],
    ]);
  });

  it("never scans a vocabulary owner's package", () => {
    // A module's terms are legitimate inside its own package by definition (spec §2).
    for (const owner of OWNERS) {
      const own = TRACKED.filter((p) => p.startsWith(`packages/${owner.packageDir}/`));
      expect(own.length, owner.module).toBeGreaterThan(0);
      expect(
        own.filter((p) => SCANNED.has(p)),
        owner.module,
      ).toEqual([]);
    }
  });
});

describe("the lists", () => {
  it("keeps exactly the files whose job needs non-English text, each with a reason", () => {
    expect(Object.keys(KEEPS_NON_ENGLISH).sort()).toEqual([
      "apps/server/scripts/bench/measure.ts",
      "apps/server/scripts/bench/trading-day.test.ts",
      "apps/server/scripts/receipt-look.ts",
      "apps/server/src/first-setup-database-holdings.test.ts",
      "apps/server/src/first-setup-start-again-hour.test.ts",
      "apps/server/src/invoice-corrections.test.ts",
      "apps/server/src/log-personal-data.ts",
      "apps/server/src/return-records.real.test.ts",
      "apps/server/src/start-again-full-disk.e2e.test.ts",
      "packages/db/src/immutability.sql.md",
      "packages/identity/src/passkey-providers.ts",
      "packages/migrations/migrations.manifest.json",
      "packages/shared/src/locales.ts",
    ]);
    for (const [path, keep] of Object.entries(KEEPS_NON_ENGLISH)) {
      expect(keep.reason, path).toMatch(/^[^\n]{10,}$/);
      expect(Number.isInteger(keep.findings) && keep.findings >= 1, path).toBe(true);
    }
  });

  it("keeps the still-to-clean list sorted and free of duplicates", () => {
    expect(STILL_TO_CLEAN).toEqual([...new Set(STILL_TO_CLEAN)].sort());
  });

  it("names only tracked, scanned text files, and no file on both lists", () => {
    const unscanned = [...STILL_TO_CLEAN, ...Object.keys(KEEPS_NON_ENGLISH)].filter(
      (p) => !SCANNED.has(p),
    );
    expect(unscanned).toEqual([]);
    expect(STILL_TO_CLEAN.filter((p) => p in KEEPS_NON_ENGLISH)).toEqual([]);
  });

  it("holds the still-to-clean list at its pinned count", () => {
    expect(
      STILL_TO_CLEAN.length,
      "STILL_TO_CLEAN_COUNT must equal the list's length. After deleting cleaned entries, lower it " +
        "to match. Do not add a file to the list: clean the file instead. An addition only passes by " +
        "raising the count, which the diff shows.",
    ).toBe(STILL_TO_CLEAN_COUNT);
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
      // The declaration matches vocabulary that occurs in the owner's REAL source, and the owner is
      // excluded by SCOPE, not by a list too weak to fire on it. The declaration file is excluded:
      // every declared term is a literal there.
      const files = TRACKED.filter(
        (f) =>
          f.startsWith(`packages/${owner.packageDir}/src/`) &&
          f.endsWith(".ts") &&
          !f.endsWith("/vocabulary.ts"),
      );
      expect(files.length).toBeGreaterThan(0);
      const own = new Set(owner.terms);
      const fired = new Set(
        files.flatMap((f) => findSpanish(readText(join(repoRoot, f))!, own)).map((v) => v.word),
      );
      expect([...fired]).toEqual(expect.arrayContaining([...ANCHORS[module]!]));
    },
  );
});

describe("findSpanish", () => {
  const located = (source: string): string[] =>
    findSpanish(source, FIXTURE).map((v) => `${v.line}: ${v.word}`);

  it("flags a Spanish identifier", () => {
    const found = findSpanish("const ultimaHuella = head.lastHash;", FIXTURE);
    expect(found.map((v) => v.word)).toEqual(["huella"]);
  });

  it("flags a Spanish table name inside a string literal", () => {
    // No ESLint selector can see into this string, and this is the mistake that reaches a migration
    // and then a database.
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
    // `series` contains `serie`; `imported` contains `importe`; `delta` contains `alta`.
    expect(
      findSpanish(
        "import { invoiceSeries } from './series.js';\n" +
          "const importedRows = delta.filter((r) => r.renumbered);\n",
        FIXTURE,
      ),
    ).toEqual([]);
  });

  it("does not flag words shared by both languages", () => {
    // total, base, local, error, real: identical in Spanish and English. On the ASSEMBLED set:
    // no module declares one of these, which is a different claim from the tokeniser skipping them.
    expect(findSpanish("const { total, base, locale, error } = row;", FORBIDDEN)).toEqual([]);
  });

  it("does not flag NIF", () => {
    // tenants.nif is a legal identifier and an acronym, not vocabulary. On the ASSEMBLED set: the
    // claim is that no module declares `nif`.
    expect(findSpanish('nif: text("nif").notNull(),', FORBIDDEN)).toEqual([]);
  });

  it("flags bare Spanish prose in a line comment", () => {
    // Generic code describes regime-neutral operations, so its comments must be English too.
    expect(findSpanish("// the cadena head is per node", FIXTURE).map((v) => v.word)).toEqual([
      "cadena",
    ]);
  });

  it("flags bare Spanish prose in a block comment", () => {
    expect(
      findSpanish("/*\n * mirrors the huella chain shape\n */", FIXTURE).map((v) => v.word),
    ).toEqual(["huella"]);
  });

  it("exempts a Spanish term quoted in guillemets in a comment", () => {
    // «…» is a verbatim regulatory quote — the source's own words.
    expect(findSpanish("// AEAT: «se conserva la cadena original»", FIXTURE)).toEqual([]);
  });

  it("exempts a Spanish term in a backtick citation in a comment", () => {
    // A backticked term cites a specific identifier, wire field or owned term.
    expect(findSpanish("// the `cadena` row is owned by the fiscal module", FIXTURE)).toEqual([]);
  });

  it("exempts a multi-line guillemet quote spanning a block comment", () => {
    // A quote that wraps across lines, so quotation blanking runs on the whole source before the
    // line split.
    expect(findSpanish("/*\n * AEAT: «la cadena\n * y su huella»\n */", FIXTURE)).toEqual([]);
  });

  it("still flags a Spanish table name in a sql template literal in code", () => {
    // The backtick exemption is COMMENT-ONLY. In code a backtick opens a TEMPLATE LITERAL, and a
    // Spanish table name in `sql`…`` is the case the guard exists to catch.
    expect(
      findSpanish("await db.execute(sql`select from registros_facturacion`);", FIXTURE).map(
        (v) => v.word,
      ),
    ).toEqual(["registros", "facturacion"]);
  });

  it("still flags code on a line that also carries a comment", () => {
    const found = findSpanish("const cadena = 1; // the chain head", FIXTURE);
    expect(found.map((v) => v.word)).toEqual(["cadena"]);
  });

  it("flags Spanish in BOTH the code and the comment on one line", () => {
    // Comment prose is scanned, so a line's code hit and its comment hit are both reported.
    expect(findSpanish("const mesa = 1; // the mesa number", FIXTURE).map((v) => v.word)).toEqual([
      "mesa",
      "mesa",
    ]);
  });

  it("does not read a glob path in a line comment as a block comment's opener", () => {
    const source = [
      "// reads drizzle/meta/*_snapshot.json",
      "const query = sql`select from registros_facturacion`;",
      "/* a real block comment */",
    ].join("\n");
    expect(located(source)).toEqual(["2: registros", "2: facturacion"]);
  });

  it("keeps a cited word cited when a glob path in a line comment precedes it", () => {
    const source = [
      "// reads drizzle/meta/*_snapshot.json",
      'const tick = "`";',
      "// the `cadena` row is owned by the fiscal module",
      "/* a real block comment */",
    ].join("\n");
    expect(findSpanish(source, FIXTURE)).toEqual([]);
  });

  it("does not read a comment opener inside a string as a comment", () => {
    const blockOpener = [
      'const opener = "/*";',
      "const query = sql`select from registros`;",
      'const closer = "*/";',
    ].join("\n");
    expect(located(blockOpener)).toEqual(["2: registros"]);
    const lineOpener = "const path = 'a//b'; const query = sql`select from registros`;";
    expect(findSpanish(lineOpener, FIXTURE).map((v) => v.word)).toEqual(["registros"]);
  });

  it("does not read a comment opener inside a template literal as a comment", () => {
    expect(findSpanish("const path = `a//b`; // the `cadena` row", FIXTURE)).toEqual([]);
    const nested = "const query = `${'/*'}`; const later = sql`select from registros`; // */";
    expect(findSpanish(nested, FIXTURE).map((v) => v.word)).toEqual(["registros"]);
    // The template resumes after its `${…}`, so the `//` inside it is still not a comment.
    expect(findSpanish("const path = `${root}//x`; // the `cadena` row", FIXTURE)).toEqual([]);
  });

  it("does not read a comment opener inside a regular expression as a comment", () => {
    const source = [
      "const opener = /[/*]/;",
      "const query = sql`select from registros`;",
      "/* a real block comment */",
    ].join("\n");
    expect(located(source)).toEqual(["2: registros"]);
    // A `/` inside a character class does not end the expression.
    expect(findSpanish("const tick = /[/`]/;\n// the `cadena` row", FIXTURE)).toEqual([]);
    // After a keyword such as `return`, a `/` opens an expression rather than dividing.
    expect(findSpanish("return /`/;\n// the `cadena` row", FIXTURE)).toEqual([]);
    expect(findSpanish("return\u00a0/`/;\n// the `cadena` row", FIXTURE)).toEqual([]);
  });

  it("does not end a string or template at an escaped quote or backtick", () => {
    expect(findSpanish('const s = "say \\"`\\""; // the `cadena` row', FIXTURE)).toEqual([]);
    expect(findSpanish("const t = `a\\`b // c`; // the `cadena` row", FIXTURE)).toEqual([]);
  });

  it("does not end a template's `${…}` part at a brace nested inside it", () => {
    const nested = "const t = `${ { a: 1 }.a // the `cadena` field\n}`;";
    expect(findSpanish(nested, FIXTURE)).toEqual([]);
  });

  it("ends an unterminated string at its line and an unterminated comment or template at the end", () => {
    expect(findSpanish('const s = "unclosed\n// the `cadena` row', FIXTURE)).toEqual([]);
    expect(findSpanish("/* the `cadena` row", FIXTURE)).toEqual([]);
    expect(findSpanish("const t = `the cadena", FIXTURE).map((v) => v.word)).toEqual(["cadena"]);
  });

  it("reads a slash after a value as division, not as a regular expression", () => {
    expect(findSpanish("const half = total / 2; // the `cadena` row", FIXTURE)).toEqual([]);
    expect(findSpanish("const half = count(ok) / 2; // the `cadena` row", FIXTURE)).toEqual([]);
    expect(findSpanish("const half = list[0] / 2; // the `cadena` row", FIXTURE)).toEqual([]);
    expect(findSpanish("const o = { if: (a) / 2 }; // the `cadena` row", FIXTURE)).toEqual([]);
    expect(
      findSpanish("const v = obj.value\nreturn /`/.test(s); // the `cadena` row", FIXTURE),
    ).toEqual([]);
    for (const literal of ['"4"', "`4`", "/4/"]) {
      const source = `const half = ${literal} / 2; // the \`cadena\` row`;
      expect(findSpanish(source, FIXTURE), literal).toEqual([]);
    }
    expect(findSpanish("const cafè = 1;\ncafè / 2; // the `cadena` row", FIXTURE)).toEqual([]);
  });

  it.each(["if", "while", "for", "with"])(
    "opens a regular expression after the parenthesised head of `%s`",
    (head) => {
      const backtick = [
        `${head} (ok) /\`/.test(value);`,
        "const path = `https://${sql`registros`}`;",
      ].join("\n");
      expect(located(backtick)).toEqual(["2: registros"]);
      const opener = [`${head} (check(ok)) /\\/*/.test(value);`, "const q = sql`registros`;"];
      expect(located(opener.join("\n"))).toEqual(["2: registros"]);
    },
  );

  it("opens a regular expression after a closing brace", () => {
    const source = ["if (ok) {}", "/`/.test(value);", "const path = `https://${sql`registros`}`;"];
    expect(located(source.join("\n"))).toEqual(["3: registros"]);
  });

  it.each(["const m = [...await /`/.exec(s)];", "f(...typeof /`/);"])(
    "opens a regular expression after a keyword that follows a spread: %s",
    (spread) => {
      const source = [spread, "const path = `https://${sql`registros`}`;"];
      expect(located(source.join("\n"))).toEqual(["2: registros"]);
    },
  );

  it("opens a regular expression at the start of a template's `${…}` part", () => {
    const opener = ['const s = String.raw`${/\\/*/.source}` + "`";', "const q = sql`registros`;"];
    expect(located(opener.join("\n"))).toEqual(["2: registros"]);
    const backtick = [
      "function f() {",
      "  const s = String.raw`${/`/.source}`;",
      "}",
      "const path = `https://${sql`registros`}`;",
    ];
    expect(located(backtick.join("\n"))).toEqual(["4: registros"]);
  });

  it.each(["value!", "value++", "value--", "obj.return", "obj?.return", "x.in"])(
    "reads a slash after `%s` as division",
    (value) => {
      expect(findSpanish(`const half = ${value} / 2; // the \`cadena\` row`, FIXTURE)).toEqual([]);
    },
  );

  it("opens a regular expression after a prefix `!` or `+`", () => {
    expect(findSpanish("!/`/.test(s); // the `cadena` row", FIXTURE)).toEqual([]);
    expect(findSpanish("return!/`/.test(s); // the `cadena` row", FIXTURE)).toEqual([]);
    expect(findSpanish("value\n!/`/.test(s); // the `cadena` row", FIXTURE)).toEqual([]);
    expect(findSpanish("const n = 1 + /`/.source.length; // the `cadena` row", FIXTURE)).toEqual(
      [],
    );
  });

  it.each([
    ["CR", "\r"],
    ["U+2028", "\u2028"],
    ["U+2029", "\u2029"],
  ])("ends a line comment and a regular expression at line terminator %s", (_name, terminator) => {
    expect(located(`// note${terminator}const q = sql\`registros\`;`)).toEqual(["1: registros"]);
    expect(findSpanish(`const r = /abc${terminator}// the \`cadena\` row`, FIXTURE)).toEqual([]);
  });

  it("ends a string at a carriage return, but not at U+2028, and continues it after an escaped CRLF", () => {
    expect(findSpanish('const s = "unclosed\r// the `cadena` row', FIXTURE)).toEqual([]);
    expect(findSpanish('const s = "a\u2028`"; // the `cadena` row', FIXTURE)).toEqual([]);
    expect(findSpanish('const s = "a\\\r\n`"; // the `cadena` row', FIXTURE)).toEqual([]);
  });

  it("reports an uncited word at its own line after a glob path in a line comment", () => {
    const source = [
      "// drizzle/meta/*_snapshot.json",
      'const tick = "`";',
      "const count = 1;",
      "// the cadena head is per node",
      "// owned by `registros`",
      "/* a real block comment */",
    ].join("\n");
    expect(located(source)).toEqual(["4: cadena"]);
  });

  it("scans with exactly the set it is handed — the base list alone knows no fiscal term", () => {
    // The parameter is required, with no default, so a caller can never silently narrow to the
    // base list: here the narrowing is deliberate. `mesa` is base vocabulary, `huella` fiscal's.
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

describe("findAccented", () => {
  it.each([
    "á",
    "é",
    "í",
    "ó",
    "ú",
    "ñ",
    "Á",
    "É",
    "Í",
    "Ó",
    "Ú",
    "Ñ",
    "¿",
    "¡",
    "à",
    "è",
    "ò",
    "ç",
    "À",
    "È",
    "Ò",
    "Ç",
    "ü",
    "Ü",
  ])("flags %s", (letter) => {
    expect(findAccented(`const label = "x${letter}y";`).map((v) => v.word)).toEqual([letter]);
  });

  it("reports each line once, with its number and text", () => {
    expect(findAccented('const ok = 1;\nconst s = "Café niño";\n')).toEqual([
      { line: 2, word: "é", text: 'const s = "Café niño";' },
    ]);
  });

  it("flags a decomposed accent as well as a composed one", () => {
    expect(findAccented('const s = "Café";').map((v) => v.word)).toEqual(["é"]);
  });

  it("does not flag plain ASCII or letters outside the set", () => {
    expect(findAccented("const s = 'naïve façade'.length; // ø ß → ê")).toEqual([
      expect.objectContaining({ word: "ç" }),
    ]);
    expect(findAccented("const s = 'naive facade'; // o s -> e")).toEqual([]);
  });

  it("flags accented prose in a comment", () => {
    expect(findAccented("// the año is fixed").map((v) => v.line)).toEqual([1]);
  });

  it("exempts a guillemet quote and a backtick citation in a comment", () => {
    expect(findAccented("// AEAT: «Facturación»\n// the `año` field")).toEqual([]);
  });

  it("still flags an accented letter in a template literal in code", () => {
    expect(findAccented("const q = sql`select año`;").map((v) => v.word)).toEqual(["ñ"]);
  });
});

describe.each([...SCANNED])("%s", (path, source) => {
  const keep = KEEPS_NON_ENGLISH[path];
  if (keep !== undefined) {
    it("holds exactly its kept number of findings", () => {
      expect(
        findings(source).map((v) => `${v.line}: ${v.word} — ${v.text}`),
        "a kept file's findings changed: clean any new text, or set `findings` to the new count (delete the keep when none are left)",
      ).toHaveLength(keep.findings);
    });
  } else if (STILL_LISTED.has(path)) {
    it("still holds non-English text, so it stays listed", () => {
      expect(
        findings(source).length,
        "nothing left to clean: delete it from the list",
      ).toBeGreaterThan(0);
    });
  } else {
    it("uses English only", () => {
      // Reported as formatted lines rather than a bare count: a failure needs to say which word on
      // which line, or the next person deletes the test.
      expect(findings(source).map((v) => `${v.line}: ${v.word} — ${v.text}`)).toEqual([]);
    });
  }
});
