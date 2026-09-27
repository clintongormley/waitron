import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

/** `<repo>/packages`. Derived, so the guard survives being run from anywhere. */
export const PACKAGES_ROOT = join(import.meta.dirname, "..", "..");

/**
 * English throughout — identifiers, table/column names AND comments alike. A package
 * neither listed here nor owning a module's declared `vocabulary` (`@waitron/module`'s
 * `vocabularyOwners`, read by the root suite) is never scanned — `reporting` (the Spanish
 * modelo-303 form) among them.
 * `apps/*` is out of scope by the composition-root decision recorded below.
 */
export const GENERIC_PACKAGES = [
  "db",
  "migrations",
  "core",
  "fiscal",
  "shared",
  "payments",
  "payments-stripe",
  "payments-sumup",
  "scheduler",
  "credentials",
  "workforce",
  "identity",
  "catalogue",
  "media",
  "tunnel",
  "membership",
  "module",
  "layouts",
  "recipes",
  "purchasing",
  "printing",
  "print-agent",
  "diagnostics",
  "sync-enrolment",
  "stream",
  "adjustments",
  "composition",
  "fiscal-none",
  "provisioning",
  "ui",
  // Generic browser infrastructure, same as `ui`: the dashboard module-UI kit (i18n + code-message
  // registries + request helper) and the app-side module registry. Neither names a regime, so both
  // are English-only; user-facing translation VALUES (a `{ en, es }` copy entry) are not vocabulary.
  "dashboard-kit",
  "dashboard-modules",
  // Browser-safe country contract and installed-pack registry. Country-specific implementations are
  // deliberately outside this generic vocabulary boundary.
  "country",
  "country-packs",
] as const;

/**
 * Packages whose TEST files are excluded from the scan — the guard's ONLY test exemption.
 * `provisioning`'s tests provision a REAL Spanish Veri*Factu venue, so their Spanish is domain
 * data, not fixture sloppiness: the unrenameable fiscal TABLES in SQL (`registros_facturacion`,
 * `registro_sif`, `cadenas`) AND realistic Spanish venue data for an es-ES venue. The skip is
 * whole-file because the table names are interleaved through the SQL. Removal condition: run
 * provisioning's tests against `fiscal-none` so they never touch the Spanish fiscal schema, then
 * delete this set.
 */
export const PRODUCTION_ONLY: ReadonlySet<string> = new Set(["provisioning"]);

// Decision record: apps/* is OUT OF SCOPE for this guard. `GENERIC_PACKAGES` enumerates
// `packages/<name>`, so nothing under `apps/` is reachable by `sourceFilesIn`. The generic/regime
// split this guard enforces is a property of a LIBRARY: a package that names only its own domain's
// vocabulary, so that a second regime could be added beside Veri*Factu without touching it.
// `apps/server` is the COMPOSITION ROOT, whose job is to wire the generic layer to a specific
// regime for real, so it necessarily speaks both vocabularies. An exemption list that tried to
// cover everything a composition root legitimately says would end up listing most of the assembled
// forbidden set, which asserts nothing.

/**
 * Files that exist to enumerate forbidden vocabulary in plain text, excluded by exact name from
 * the scan that vocabulary feeds — this file, plus `packages/fiscal`'s narrower one, whose own
 * forbidden-term list necessarily contains words the fiscal module declares.
 *
 * Excluded by name rather than by a `*.test.ts` pattern: test files stay in scope, and a Spanish
 * fixture name in packages/db is exactly as wrong as a Spanish column.
 */
export const SELF = ["english-only.ts", "no-regime-vocabulary.test.ts"] as const;

/**
 * Dashboard i18n translation catalogues, excluded by exact suffix from the scan.
 *
 * A module's dashboard panel keeps its own `{ en, es }` copy in `src/dashboard/strings.ts`, and
 * those `es` values are translation, not vocabulary.
 *
 * NARROW, by design: only the exact suffix `dashboard/strings.ts`, so the guard still scans every
 * other file in these packages, a `dashboard/*.ts` widget that is NOT the catalogue included.
 */
export const I18N_CATALOGUES = ["dashboard/strings.ts"] as const;

/**
 * There is deliberately no exception list: an exception list with a single entry is the shape that
 * grows. If a future column appears to need an exception, rename the column.
 */

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

export function readSource(file: string): string {
  return readFileSync(file, "utf8");
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

/** Words after which a `/` starts a regular expression rather than a division. */
const REGEX_AFTER_WORD: ReadonlySet<string> = new Set([
  "return",
  "typeof",
  "instanceof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "yield",
  "await",
]);

/** Keywords whose parenthesised head is followed by a statement, so a `/` after its `)` opens a
 * regular expression. */
const STATEMENT_HEADS: ReadonlySet<string> = new Set(["if", "while", "for", "with"]);

const LF = 0x0a;
const CR = 0x0d;
const BANG = 0x21;
const DOUBLE_QUOTE = 0x22;
const DOLLAR = 0x24;
const QUOTE = 0x27;
const PAREN_OPEN = 0x28;
const PAREN_CLOSE = 0x29;
const STAR = 0x2a;
const PLUS = 0x2b;
const MINUS = 0x2d;
const DOT = 0x2e;
const SLASH = 0x2f;
const BRACKET_OPEN = 0x5b;
const BACKSLASH = 0x5c;
const BRACKET_CLOSE = 0x5d;
const BACKTICK = 0x60;
const BRACE_OPEN = 0x7b;
const BRACE_CLOSE = 0x7d;

function isSpace(code: number): boolean {
  return (
    code === 0x20 ||
    (code >= 0x09 && code <= 0x0d) ||
    (code > 0x7f && /\s/.test(String.fromCharCode(code)))
  );
}

/** A character of a name or number. Any non-ASCII character that is not a space counts, as an
 * accented letter in a name does. */
function isWordPart(code: number): boolean {
  return (
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x5f ||
    code === DOLLAR ||
    (code > 0x7f && !isSpace(code))
  );
}

/** The characters that end a line comment or a regular expression. A string may hold U+2028 and
 * U+2029, so only LF and CR end one. */
function isLineTerminator(code: number): boolean {
  return code === LF || code === CR || code === 0x2028 || code === 0x2029;
}

/**
 * `source` with backtick citations blanked inside its comments, and nothing else changed.
 *
 * Comments are found by walking the source, guessing as described below, so a `//` or `/*` inside
 * a string, a template literal or a regular expression is not a comment, and a `/*` inside a `//`
 * comment opens nothing. Without a parser, whether a `/` opens a regular expression is guessed from
 * what precedes it, and known wrong guesses include: a regular expression after the `)` of
 * `for await (…)`, or after a word `REGEX_AFTER_WORD` does not list (`export default /x/`), is read
 * as a division; a division after a name spelled like a listed word (a variable called `of`), or
 * after a `!` parted from its value by a space, is read as a regular expression. A wrong guess is
 * not confined to its line: a quote, backtick or `/*` in the misread text can open a string,
 * template or comment the source does not have, and either direction can then hide a word in code
 * on a later line, or report a cited word in a comment.
 */
function scrubComments(source: string): string {
  const parts: string[] = [];
  let copiedFrom = 0;
  let i = 0;
  let regexAllowed = true;
  let afterDot = false;
  // The word just read, while no other token has followed it; "" for a property name.
  let lastWord = "";
  // One entry per open `(`: whether a statement follows its `)`.
  const parens: boolean[] = [];
  // One entry per open `${`: how many `{` inside it are still open.
  const substitutions: number[] = [];

  const blank = (start: number, end: number): void => {
    parts.push(source.slice(copiedFrom, start), blankBackticks(source.slice(start, end)));
    copiedFrom = end;
  };
  /** Skips a template literal's text from `i` to past its closing backtick or its next `${`. */
  const skipTemplate = (): void => {
    while (i < source.length) {
      const code = source.charCodeAt(i);
      if (code === BACKTICK) {
        i += 1;
        regexAllowed = false;
        return;
      }
      if (code === DOLLAR && source.charCodeAt(i + 1) === BRACE_OPEN) {
        i += 2;
        substitutions.push(0);
        regexAllowed = true;
        return;
      }
      i += code === BACKSLASH ? 2 : 1;
    }
  };
  /** Skips a string from its opening quote at `i` to past its closing quote, or to an LF or CR. */
  const skipString = (quote: number): void => {
    i += 1;
    while (i < source.length) {
      const code = source.charCodeAt(i);
      if (code === quote) {
        i += 1;
        return;
      }
      if (code === LF || code === CR) return;
      i += code !== BACKSLASH ? 1 : source.startsWith("\r\n", i + 1) ? 3 : 2;
    }
  };
  /** Skips a regular expression from its opening `/` at `i` to past its closing `/`, or to its
   * line's end. */
  const skipRegex = (): void => {
    let inClass = false;
    i += 1;
    while (i < source.length) {
      const code = source.charCodeAt(i);
      if (isLineTerminator(code)) return;
      if (code === SLASH && !inClass) {
        i += 1;
        return;
      }
      if (code === BACKSLASH) i += 1;
      else if (code === BRACKET_OPEN) inClass = true;
      else if (code === BRACKET_CLOSE) inClass = false;
      i += 1;
    }
  };

  while (i < source.length) {
    const code = source.charCodeAt(i);
    if (code === SLASH && source.charCodeAt(i + 1) === SLASH) {
      const start = i;
      i += 2;
      while (i < source.length && !isLineTerminator(source.charCodeAt(i))) i += 1;
      blank(start, i);
      continue;
    }
    if (code === SLASH && source.charCodeAt(i + 1) === STAR) {
      const close = source.indexOf("*/", i + 2);
      const start = i;
      i = close < 0 ? source.length : close + 2;
      blank(start, i);
      continue;
    }
    if (isSpace(code)) {
      i += 1;
      continue;
    }
    if (isWordPart(code)) {
      const start = i;
      do i += 1;
      while (i < source.length && isWordPart(source.charCodeAt(i)));
      // A name after a `.`, but not after a spread's `...`, is a property, so a value even when it
      // is spelled like a keyword.
      lastWord = afterDot ? "" : source.slice(start, i);
      regexAllowed = REGEX_AFTER_WORD.has(lastWord);
      afterDot = false;
      continue;
    }
    const wordBefore = lastWord;
    lastWord = "";
    afterDot = false;
    if (code === QUOTE || code === DOUBLE_QUOTE) {
      skipString(code);
      regexAllowed = false;
    } else if (code === SLASH && regexAllowed) {
      skipRegex();
      regexAllowed = false;
    } else if (code === BACKTICK) {
      i += 1;
      skipTemplate();
    } else if ((code === PLUS || code === MINUS) && source.charCodeAt(i + 1) === code) {
      // `++` and `--` leave the guess alone: postfix after a value, prefix before one.
      i += 2;
    } else if (code === BANG && !isSpace(source.charCodeAt(i - 1))) {
      // A `!` touching what precedes it keeps the guess: after a value it is a non-null assertion.
      i += 1;
    } else {
      i += 1;
      afterDot = code === DOT && source.charCodeAt(i - 2) !== DOT;
      // A `/` dividing what a `}` ends is a type error (TS2362: arithmetic on an object, a function
      // or a class), so after `}` it opens a regular expression.
      regexAllowed = code !== BRACKET_CLOSE;
      if (code === PAREN_OPEN) parens.push(STATEMENT_HEADS.has(wordBefore));
      else if (code === PAREN_CLOSE) regexAllowed = parens.pop() === true;
      else if (code === BRACE_OPEN && substitutions.length > 0) {
        substitutions[substitutions.length - 1]! += 1;
      } else if (code === BRACE_CLOSE && substitutions.length > 0) {
        const open = substitutions.length - 1;
        if (substitutions[open]! > 0) substitutions[open]! -= 1;
        else {
          substitutions.pop();
          skipTemplate();
        }
      }
    }
  }
  parts.push(source.slice(copiedFrom));
  return parts.join("");
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
 * Every token of `words` in `source`, in order, with its line. `words` is REQUIRED with no default,
 * so no caller can silently narrow to the base list: the root suite passes the assembled set
 * (`forbiddenVocabulary`), a package-local caller passes whatever it can legitimately know.
 */
export function findSpanish(source: string, words: ReadonlySet<string>): Violation[] {
  const violations: Violation[] = [];
  const originalLines = source.split("\n");
  const preparedLines = scrubComments(blankGuillemets(source)).split("\n");
  preparedLines.forEach((line, index) => {
    for (const token of tokenise(line)) {
      if (words.has(token)) {
        violations.push({ line: index + 1, word: token, text: originalLines[index]!.trim() });
      }
    }
  });
  return violations;
}

/** Every `.ts` file under a package's `src`, discovered rather than listed; `[]` for a package
 * that does not exist. */
export function sourceFilesIn(packageName: string): string[] {
  const root = join(PACKAGES_ROOT, packageName, "src");
  if (!existsSync(root)) return [];
  const productionOnly = PRODUCTION_ONLY.has(packageName);
  // SELF and I18N_CATALOGUES match by `endsWith`: SELF names whole basenames that are unique
  // tree-wide, and I18N_CATALOGUES is a deliberate path SUFFIX.
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts"))
    .filter((entry) => !SELF.some((name) => entry.endsWith(name)))
    .filter((entry) => !I18N_CATALOGUES.some((suffix) => entry.endsWith(suffix)))
    .filter((entry) => !(productionOnly && entry.endsWith(".test.ts")))
    .map((entry) => join(root, entry))
    .filter((entry) => statSync(entry).isFile())
    .sort();
}
