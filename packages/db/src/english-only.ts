import { readFileSync } from "node:fs";
import { mapComments } from "@waitron/shared";

const SPAIN_PACKAGES: ReadonlySet<string> = new Set([
  "fiscal-verifactu",
  "country-es",
  "workforce-es",
  "reporting",
]);

const WORD_LISTS: ReadonlySet<string> = new Set([
  "packages/db/src/english-only.ts",
  "packages/fiscal/src/no-regime-vocabulary.test.ts",
]);

/**
 * Places whose job is non-English text, never scanned: the packages written for Spain (CLAUDE.md
 * §3), translation files (anything in an `i18n` folder, or a file named `strings.ts`), the guide in every
 * language but English, a package's starter-content translations (A918), and the two files that
 * exist to list forbidden words. Takes a repo-relative path with `/` separators.
 */
export function isHome(path: string): boolean {
  const segments = path.split("/");
  const name = segments.at(-1)!;
  return (
    (segments[0] === "packages" && SPAIN_PACKAGES.has(segments[1]!)) ||
    segments.slice(0, -1).includes("i18n") ||
    name === "strings.ts" ||
    /^apps\/server\/src\/guide\/(?!en\/)[^/]+\//.test(path) ||
    /^packages\/[^/]+\/src\/starter-content\.ts$/.test(path) ||
    WORD_LISTS.has(path)
  );
}

export interface Keep {
  reason: string;
  /** How many findings the file holds today; one more, or one fewer, fails the suite. */
  findings: number;
}

/**
 * Files outside the homes whose job needs non-English text, with why. Each is held to its number of
 * findings, not to which lines hold them.
 */
export const KEEPS_NON_ENGLISH: Readonly<Record<string, Keep>> = {
  "packages/shared/src/locales.ts": {
    reason: "a language's own name in the language picker",
    findings: 1,
  },
  "packages/identity/src/passkey-providers.ts": {
    reason: "a passkey provider's own product name",
    findings: 1,
  },
  "packages/migrations/migrations.manifest.json": {
    reason: "names the Veri*Factu tables, whose Spanish names cannot change",
    findings: 2,
  },
  "packages/db/src/immutability.sql.md": {
    reason: "names the Veri*Factu tables, whose Spanish names cannot change",
    findings: 2,
  },
  "apps/server/src/log-personal-data.ts": {
    reason: "AEAT's wire field name `idEmisorFactura`",
    findings: 2,
  },
  "apps/server/scripts/receipt-look.ts": { reason: "AEAT's QR address parameters", findings: 2 },
};

/** There is deliberately no list of forgiven words: if a column's name needs one, rename the column. */

/**
 * The guard's BASE list: generic Spanish a generic package might reach for, owned by no module.
 * Every domain term lives on its module's `vocabulary` seat instead (`FISCAL_VOCABULARY` in
 * packages/fiscal-verifactu, `WORKFORCE_ES_VOCABULARY` in packages/workforce-es); the root suite
 * assembles the forbidden set with `@waitron/module`'s `forbiddenVocabulary` and asserts this list
 * and the module declarations are DISJOINT — a word has one declaring home, so a fiscal term added
 * here is a failing test, not a second copy. Add a term here only if no module owns it.
 * `estado`/`estados` and `tipo`/`tipos` stay here although fiscal columns spell them: they are
 * generic Spanish for *state* and *kind* that any package might reach for; a fiscal column of the
 * same spelling is coincidence, not ownership.
 *
 * Singular and plural are listed separately and nothing is stemmed — stemming `series` to `serie`
 * would fire on `invoice_series`, which is in the naming contract. Words identical in both
 * languages are deliberately absent: total, base, local/locale, error, real, id. All appear in the
 * naming contract, and a guard that fires on `sales.total` on day one is a guard that gets deleted
 * on day two. `nif` is absent for the same reason — an acronym for a legal
 * identifier, not vocabulary.
 */
export const SPANISH_WORDS: ReadonlySet<string> = new Set([
  // POS vocabulary a generic package might reach for
  "venta",
  "ventas",
  "pedido",
  "pedidos",
  "linea",
  "lineas",
  "cantidad",
  "precio",
  "precios",
  "pago",
  "pagos",
  "cobro",
  "cobros",
  "mesa",
  "mesas",
  "caja",
  "cajas",
  "estado",
  "estados",
  "tipo",
  "tipos",
  "descripcion",
  "descripciones",
]);

export interface Violation {
  line: number;
  word: string;
  text: string;
}

/** The file's text, or `undefined` when it holds a NUL byte and so is binary. */
export function readText(file: string): string | undefined {
  const bytes = readFileSync(file);
  return bytes.includes(0) ? undefined : bytes.toString("utf8");
}

/**
 * Blanks `«…»` guillemet quotes with equal-width whitespace, preserving newlines and line numbers.
 * A verbatim regulatory quote is the source's own words (CLAUDE.md §1) and is left out of the scan.
 * Run on the WHOLE source so a quote that wraps across lines — a citation split over a block comment
 * or successive `//` lines, e.g. `core/record-correction.ts` — is blanked as one span.
 */
function blankGuillemets(source: string): string {
  return source.replace(/«[^»]*»/g, (match) => match.replace(/[^\n]/g, " "));
}

/**
 * Blanks `` `…` `` backtick citations with equal-width whitespace. Applied ONLY to comment text: a
 * backticked term cites a specific identifier, wire-protocol field or owned term (a quotation of a
 * name), so it is exempt. It is NEVER applied to code — there a backtick opens a TEMPLATE LITERAL,
 * such as `` sql`… registros_facturacion` ``, which the guard exists to catch.
 */
function blankBackticks(comment: string): string {
  return comment.replace(/`[^`]*`/g, (match) => match.replace(/[^\n]/g, " "));
}

/**
 * Splits a line into lowercase, unaccented word tokens.
 *
 * Whole tokens, never substrings: `series` must not match `serie`, `imported`
 * must not match `importe`, `delta` must not match `alta`. Accents are removed
 * via NFD so `anulación` and `anulacion` are the same token — and `ñ`
 * decomposes to `n`, so `año` reads as `ano`.
 *
 * camelCase and PascalCase are split, including the acronym boundary in
 * `IDFactura`, so `ultimaHuella` and `ultima_huella` tokenise identically.
 */
function tokenise(line: string): string[] {
  return line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

/**
 * Every token of `words` in `source`, in order, with its line. Comments are found by `mapComments`,
 * whose wrong guesses about a `/` can hide a word in code on a later line, or report a cited word in
 * a comment. `words` is REQUIRED with no default,
 * so no caller can silently narrow to the base list: the root suite passes the assembled set
 * (`forbiddenVocabulary`), a package-local caller passes whatever it can legitimately know.
 */
export function findSpanish(source: string, words: ReadonlySet<string>): Violation[] {
  const violations: Violation[] = [];
  const originalLines = source.split("\n");
  prepareLines(source).forEach((line, index) => {
    for (const token of tokenise(line)) {
      if (words.has(token)) {
        violations.push({ line: index + 1, word: token, text: originalLines[index]!.trim() });
      }
    }
  });
  return violations;
}

/** The source split into lines, with quotes and comment citations blanked to equal width. */
function prepareLines(source: string): string[] {
  return mapComments(blankGuillemets(source), blankBackticks).split("\n");
}

const ACCENTED = /[áéíóúñÁÉÍÓÚÑ¿¡àèòçÀÈÒÇüÜ]/;

/**
 * Every line of `source` holding one of the accented letters or inverted marks Spanish and Catalan
 * use, outside the same quotes and comment citations `findSpanish` skips; `word` is the first one.
 */
export function findAccented(source: string): Violation[] {
  const originalLines = source.split("\n");
  return prepareLines(source).flatMap((line, index) => {
    const letter = ACCENTED.exec(line.normalize("NFC"))?.[0];
    return letter === undefined
      ? []
      : [{ line: index + 1, word: letter, text: originalLines[index]!.trim() }];
  });
}
