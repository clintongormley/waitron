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

const WORD = /[\w$]+/y;

/** Whether a `/` after `previous` — the last word or punctuation mark of code — opens a regular
 * expression. After a value (a name, a number, a closing bracket or a literal) it is a division. */
function opensRegex(previous: string): boolean {
  return REGEX_AFTER_WORD.has(previous) || !/^[\w$)\]}"'`/]/.test(previous);
}

/**
 * `source` with backtick citations blanked inside its comments, and nothing else changed.
 *
 * Comments are found by walking the source as the language reads it, so a `//` or `/*` inside a
 * string, a template literal or a regular expression is not a comment, and a `/*` inside a `//`
 * comment opens nothing. Without a parser, whether a `/` opens a regular expression is judged from
 * the token before it; a string or regular expression stops at the end of its line, so a misjudged
 * one reaches no further than that line.
 */
function scrubComments(source: string): string {
  let out = "";
  let i = 0;
  let previous = "";
  // One entry per open `${`: how many `{` inside it are still open.
  const substitutions: number[] = [];

  const copyTo = (end: number): void => {
    out += source.slice(i, end);
    i = Math.min(end, source.length);
  };
  const blankTo = (end: number): void => {
    out += blankBackticks(source.slice(i, end));
    i = end;
  };
  /** Copies a template literal's text from `i`, up to its closing backtick or its next `${`. */
  const copyTemplate = (): void => {
    let j = i;
    while (
      j < source.length &&
      source[j] !== "`" &&
      !(source[j] === "$" && source[j + 1] === "{")
    ) {
      j += source[j] === "\\" ? 2 : 1;
    }
    if (source[j] === "`") j += 1;
    else if (j < source.length) {
      j += 2;
      substitutions.push(0);
    }
    copyTo(j);
    previous = "`";
  };
  /** Copies a string or regular expression from its opening character at `i` to its closing
   * `quote`, or to the end of the line. */
  const copyLiteral = (quote: string): void => {
    let j = i + 1;
    let inClass = false;
    while (j < source.length && source[j] !== "\n" && (source[j] !== quote || inClass)) {
      if (source[j] === "\\") j += 1;
      else if (quote === "/" && source[j] === "[") inClass = true;
      else if (quote === "/" && source[j] === "]") inClass = false;
      j += 1;
    }
    copyTo(source[j] === quote ? j + 1 : j);
    previous = quote;
  };

  while (i < source.length) {
    const c = source[i]!;
    const pair = source.slice(i, i + 2);
    if (pair === "//") {
      const end = source.indexOf("\n", i);
      blankTo(end < 0 ? source.length : end);
    } else if (pair === "/*") {
      const close = source.indexOf("*/", i + 2);
      blankTo(close < 0 ? source.length : close + 2);
    } else if (c === '"' || c === "'" || (c === "/" && opensRegex(previous))) {
      copyLiteral(c);
    } else if (c === "`") {
      copyTo(i + 1);
      copyTemplate();
    } else if (/[\w$]/.test(c)) {
      WORD.lastIndex = i;
      const word = WORD.exec(source)![0];
      copyTo(i + word.length);
      previous = word;
    } else {
      copyTo(i + 1);
      if (/\s/.test(c)) continue;
      previous = c;
      const open = substitutions.length - 1;
      if (open < 0) continue;
      if (c === "{") substitutions[open]! += 1;
      else if (c === "}" && substitutions[open]! > 0) substitutions[open]! -= 1;
      else if (c === "}") {
        substitutions.pop();
        copyTemplate();
      }
    }
  }
  return out;
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
