import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/** `<repo>/packages`. Derived, so the guard survives being run from anywhere. */
export const PACKAGES_ROOT = join(import.meta.dirname, "..", "..");

/** English throughout — identifiers and table/column names alike (spec §2). */
export const GENERIC_PACKAGES = [
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
] as const;

// There is no exempt-package list. A package is Spanish by design exactly when a module DECLARES
// vocabulary (`WaitronModule.vocabulary`, the seat the composition root wires in
// `apps/server/src/modules.ts`), and `vocabularyOwners` below derives that module's package from its
// `migrations.from`; the root suite asserts no owner is generic. `packages/verifactu` — the AEAT
// library, no descriptor of its own — is in no list at all, like `provisioning` and `tunnel`: not
// generic, never scanned.

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
// still applies to every package under `packages/`, `apps/server` still imports the generic layer
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
 * `no-regime-vocabulary.test.ts` (Task 11) has the identical structural problem one level down:
 * it is a SEPARATE guard, one this guard's forbidden set cannot substitute for, because it
 * exists to catch regime vocabulary written in ENGLISH — `chain`, `hash`, `sif` — which is not
 * Spanish and this guard has no way to see. Its own forbidden-term list necessarily contains a few
 * words that overlap this one's (`huella`, `registro`, `cadena`, `encadenamiento`, `incidencia`,
 * all literal Spanish-language string entries), and without this exclusion this guard would flag
 * that list as a Spanish violation — of a file whose entire purpose is to name violations, in a
 * different and narrower sense than this file's own.
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
 * assembles the forbidden set with `forbiddenVocabulary` and asserts this list and the module
 * declarations are DISJOINT — a word has one declaring home, so a fiscal term added here is a
 * failing test, not a second copy. Add a term here only if no module owns it.
 *
 * Singular and plural are listed separately and nothing is stemmed — stemming `series` to `serie`
 * would fire on `invoice_series`, which is in the naming contract. Words identical in both languages
 * are deliberately absent: total, base, local/locale, error, real, id. All appear in the naming
 * contract, and a guard that fires on `sales.total` on day one is a guard that gets deleted on day
 * two. `nif` is absent for the same reason — an acronym for a legal identifier, not vocabulary.
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

/** Replaces block comments with equivalent whitespace, preserving line numbers. */
function blankBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
}

/**
 * Drops a `//` comment. The `[^:]` guard keeps `https://…` in a string
 * literal from being mistaken for one — a URL is the one place a `//` appears
 * in code rather than before a comment.
 */
function dropLineComment(line: string): string {
  return line.replace(/(^|[^:])\/\/.*$/, "$1");
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
  const lines = blankBlockComments(source).split("\n");
  lines.forEach((line, index) => {
    for (const token of tokenise(dropLineComment(line))) {
      if (words.has(token)) {
        violations.push({ line: index + 1, word: token, text: line.trim() });
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
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts"))
    .filter((entry) => !SELF.some((name) => entry.endsWith(name)))
    .map((entry) => join(root, entry))
    .sort();
}

/**
 * The two descriptor fields the guard reads. Structural on purpose: importing `WaitronModule` from
 * `@waitron/module` would give packages/db a dev-only dependency cycle (module → migrations → db).
 */
export interface VocabularyDeclaration {
  readonly name: string;
  readonly migrations: { readonly from: string };
  readonly vocabulary?: readonly string[];
}

export interface VocabularyOwner {
  /** The descriptor's name — the SLOT for a swappable module (`fiscal`), not the package. */
  readonly module: string;
  /** `packages/<packageDir>`, derived from `migrations.from`. */
  readonly packageDir: string;
  readonly terms: readonly string[];
}

/** `../<pkg>/drizzle` — the shape every descriptor's `migrations.from` has (module-graph-honesty
 * derives its package map from the same string). */
const MIGRATIONS_FROM = /^\.\.\/([^/]+)\/drizzle$/;

/**
 * Every module that declares a `vocabulary`, with its package dir derived from `migrations.from`.
 * A declaring module whose `from` has any other shape is refused loudly: the derivation would
 * otherwise exempt nothing and scan nothing, silently. An empty declaration is returned as an owner
 * with no terms so the suite can reject it by name.
 */
export function vocabularyOwners(modules: readonly VocabularyDeclaration[]): VocabularyOwner[] {
  const owners: VocabularyOwner[] = [];
  for (const module of modules) {
    if (module.vocabulary === undefined) continue;
    const match = MIGRATIONS_FROM.exec(module.migrations.from);
    if (match === null) {
      throw new Error(
        `english-only: module ${module.name} declares vocabulary but its migrations.from ` +
          `(${module.migrations.from}) is not ../<pkg>/drizzle`,
      );
    }
    owners.push({ module: module.name, packageDir: match[1]!, terms: module.vocabulary });
  }
  return owners;
}

/** The forbidden set: `base` ∪ every module's declared terms. Returns a new set; `base` is untouched. */
export function forbiddenVocabulary(
  base: ReadonlySet<string>,
  modules: readonly VocabularyDeclaration[],
): Set<string> {
  const words = new Set(base);
  for (const owner of vocabularyOwners(modules)) {
    for (const term of owner.terms) words.add(term);
  }
  return words;
}
