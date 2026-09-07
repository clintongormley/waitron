import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/** `<repo>/packages`. Derived, so the guard survives being run from anywhere. */
export const PACKAGES_ROOT = join(import.meta.dirname, "..", "..");

/**
 * English throughout — identifiers, table/column names AND comments alike (spec §2). A package
 * neither listed here nor owning a module's declared `vocabulary` (`@waitron/module`'s
 * `vocabularyOwners`, read by the root suite) is never scanned — `packages/verifactu` (the AEAT
 * wire library, no descriptor of its own) and `reporting` (the Spanish modelo-303 form) among them.
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
  "scheduler",
  "credentials",
  "workforce",
  "identity",
  "catalogue",
  "sync",
  "tunnel",
  "membership",
  "module",
  "layouts",
  "recipes",
  "purchasing",
  "printing",
  "diagnostics",
  "sync-enrolment",
  "composition",
  "fiscal-none",
  "provisioning",
  "ui",
  // Generic browser infrastructure, same as `ui`: the dashboard module-UI kit (i18n + code-message
  // registries + request helper) and the app-side module registry. Neither names a regime, so both
  // are English-only; user-facing translation VALUES (a `{ en, es }` copy entry) are not vocabulary.
  "dashboard-kit",
  "dashboard-modules",
] as const;

/**
 * Packages whose TEST files are excluded from the scan — a documented, production-only INTERIM, and
 * the guard's ONLY test exemption. `provisioning`'s e2e/pg tests provision a REAL Spanish Veri*Factu
 * venue, so their Spanish is domain data, not fixture sloppiness: the unrenameable fiscal TABLES in
 * SQL (`registros_facturacion`, `registro_sif`, `cadenas`) AND realistic Spanish venue data for an
 * es-ES venue — localized default names the code itself resolves (`Mostrador`/`Counter` from
 * `@waitron/layouts`' `nameByLocale`, asserted by `venue-plan.test.ts`), a `"Caja 1"` till name, an
 * operation description in Spanish. Scanning these would force either renaming real tables or
 * anglicising a Spanish venue's own data, both wrong. So the skip is whole-file (the table names are
 * interleaved through the SQL) and deliberately covers the venue data too. `ui` is the contrast: its
 * tests are NOT provisioning a Spanish venue, so their Spanish was gratuitous and was reworded, no
 * exemption. Removal condition: run provisioning's tests against `fiscal-none` so they never touch
 * the Spanish fiscal schema, then delete this set (design §6 step 5).
 */
export const PRODUCTION_ONLY: ReadonlySet<string> = new Set(["provisioning"]);

// -----------------------------------------------------------------------------------------------
// Decision record: apps/* is OUT OF SCOPE for this guard. Prose, not another `as const` array,
// deliberately — see below for why. This block documents the DECISION and belongs to no
// declaration; it is not part of the doc comment on `SELF` immediately following it.
// -----------------------------------------------------------------------------------------------
//
// `apps/*` — `apps/server` today, more later — is deliberately OUT OF SCOPE, a decision recorded
// here rather than left as the silent gap `packages/scheduler`'s own design already flagged this
// trap for (`GENERIC_PACKAGES` enumerates `packages/<name>`, so anything under `apps/` was never
// reachable by `sourceFilesIn` in the first place — extending it needs a second dimension, not a
// list entry, which is why this is prose and not another `as const` array).
//
// The generic/regime split this guard enforces (spec §2) is a property of a LIBRARY: a package
// that names only its own domain's vocabulary, so that a second regime could be added beside
// Veri*Factu without touching it. `apps/server` is not that — it is the COMPOSITION ROOT, and a
// composition root's job is to wire the generic layer to a specific regime for real: its structured
// logs name `drain` (Veri*Factu's own duty), its `aeat-transport.ts` picks AEAT's own SOAP endpoint
// via `aeatEndpointFor` (deployment-wide `WAITRON_ENV` selects the family; the lookup itself is
// still AEAT-specific), and its coverage comments cite `envios`-derived counters by name. It
// necessarily speaks both vocabularies in the
// same file, on purpose — `boot.ts` importing `@waitron/fiscal-verifactu` IS the point of the
// package existing. An exemption list that tried to cover everything a composition root legitimately
// says would end up listing most of the assembled forbidden set, which asserts nothing.
//
// This is not a loophole for a NEW generic package to hide Spanish vocabulary behind: the guard
// still scans every package in `GENERIC_PACKAGES` and reads every module's declared vocabulary
// owner (a package in neither is out of scope by omission, not by exemption — see the list's own
// doc comment), `apps/server` still imports the generic layer
// through the same interfaces (`DrainDeps`, `PeriodDuty`) as everything else, and its own `src/`
// mixes English identifiers with the Spanish ones its logs and comments cite deliberately — nothing
// here weakens THAT boundary. Only the identifier-naming guard stops at the composition root's own
// door.
// -----------------------------------------------------------------------------------------------

/**
 * Files that exist to enumerate forbidden vocabulary in plain text, excluded by exact name from
 * the scan that vocabulary feeds — this file, plus `packages/fiscal`'s narrower one.
 *
 * `english-only.ts` contains the guard's base wordlist in plain text, so scanning it would fail
 * on the vocabulary it exists to define. Its suite (`scripts/english-only.test.ts`, the repo-level
 * Vitest project) carries fiscal words in its fixtures but needs no entry here: `sourceFilesIn`
 * only ever walks `packages/<name>/src`, so the suite is out of scope by location.
 * `no-regime-vocabulary.test.ts` has the identical structural problem one level down: it is a
 * SEPARATE guard, one this guard's forbidden set cannot substitute for, because it exists to catch
 * regime vocabulary written in ENGLISH — `chain`, `hash`, `sif` — which is not Spanish and this
 * guard has no way to see. Its own forbidden-term list necessarily contains a few words the fiscal
 * module declares (`huella`, `registro`, `cadena`, `encadenamiento`, `incidencia`, all literal
 * Spanish-language string entries), and without this exclusion this guard would flag that list as a
 * Spanish violation — of a file whose entire purpose is to name violations, in a different and
 * narrower sense than this file's own.
 *
 * Excluded by name rather than by a `*.test.ts` pattern: reading text executes nothing, so test
 * files stay in scope, and a Spanish fixture name in packages/db is exactly as wrong as a Spanish
 * column.
 */
export const SELF = ["english-only.ts", "no-regime-vocabulary.test.ts"] as const;

/**
 * There is deliberately no exception list.
 *
 * An earlier draft of the naming contract called the `locations` column
 * `description_operacion`, which contains a listed word and would have forced
 * one — and an exception list with a single entry is the shape that grows. The
 * column was renamed to `operation_description` instead, which tokenises to
 * `operation` and `description`, neither of them Spanish, so the guard needs no
 * help to accept it. If a future column appears to need an exception, rename
 * the column: that is the cheaper of the two edits and it keeps the guard's
 * answer unambiguous.
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
 * and `` sql`… registros_facturacion` `` is the load-bearing case the guard exists to catch.
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
 * `[^:]` guard keeps `https://…` in a string literal from being read as a comment — a URL is the
 * one place a `//` appears in code rather than before a comment.
 *
 * Comment boundaries are matched by regex, not parsed, so a `//` (or, in `scrubBlockComments`, a
 * `/*`) INSIDE a string literal earlier on the same line is misread as a comment start — a
 * pre-existing text-heuristic limit (the guard reads text, the same reason a `from "./errors.js"`
 * in a comment fools `errors-reachable`). It predates comment-scanning and is not tightened here.
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

/**
 * Every `.ts` file under a package's `src`, discovered rather than listed.
 *
 * Returns `[]` for a package that does not exist yet — `core`, `fiscal` and
 * `shared` arrive in later tasks, and this guard must be in place before them
 * rather than retrofitted after the first Spanish name has already landed.
 */
export function sourceFilesIn(packageName: string): string[] {
  const root = join(PACKAGES_ROOT, packageName, "src");
  if (!existsSync(root)) return [];
  const productionOnly = PRODUCTION_ONLY.has(packageName);
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts"))
    .filter((entry) => !SELF.some((name) => entry.endsWith(name)))
    .filter((entry) => !(productionOnly && entry.endsWith(".test.ts")))
    .map((entry) => join(root, entry))
    .sort();
}
