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

/** Blanks backtick citations inside every block comment; the rest of the comment prose, and all
 * code, is left for the scan. */
function scrubBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, blankBackticks);
}

/**
 * Keeps a line's code part unchanged and blanks backtick citations in its `//` comment tail. The
 * `[^:]` guard keeps `https://…` in a string literal from being read as a comment.
 *
 * Comment boundaries are matched by regex, not parsed, so a `//` (or, in `scrubBlockComments`, a
 * `/*`) INSIDE a string literal earlier on the same line is misread as a comment start.
 */
function scrubLineComment(line: string): string {
  return line.replace(/(^|[^:])(\/\/.*)$/, (_match, pre, comment) => pre + blankBackticks(comment));
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
  const preparedLines = scrubBlockComments(blankGuillemets(source)).split("\n");
  preparedLines.forEach((line, index) => {
    for (const token of tokenise(scrubLineComment(line))) {
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
