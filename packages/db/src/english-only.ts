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
  "layouts",
  "recipes",
] as const;

/** Spanish by design: `verifactu`/`fiscal-verifactu` mirror AEAT's spec, XML and conformance
 * vectors; `workforce-es` is the Spain module for the registro de jornada, where the ET/RD-ley 8/2019
 * vocabulary (jornada, trabajador, conservación, Inspección) IS the domain language (sub-project 16,
 * mirroring the fiscal-verifactu precedent). */
export const EXEMPT_PACKAGES = ["verifactu", "fiscal-verifactu", "workforce-es"] as const;

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
// says would end up listing most of `SPANISH_WORDS` below, which asserts nothing.
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
 * `english-only.ts` contains the entire Spanish wordlist in plain text, so scanning it would fail
 * on the vocabulary it exists to define. Its suite carries the same wordlist in its fixtures and
 * was listed here for the same reason until 2026-08-01, when it moved to
 * `scripts/english-only.test.ts` — the repo-level Vitest project, so that a push touching neither
 * `packages/db` nor a package that depends on it still runs it. `sourceFilesIn` only ever walks
 * `packages/<name>/src`, so the suite is now out of scope by location and naming it here would be
 * an exemption matching nothing.
 * `no-regime-vocabulary.test.ts` (Task 11) has the identical structural problem one level down:
 * it is a SEPARATE guard, one this file's own `SPANISH_WORDS` cannot substitute for, because it
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
 * Spanish vocabulary drawn from the spec, the findings and the naming
 * contract's module tables. Singular and plural are listed separately and
 * nothing is stemmed — stemming `series` to `serie` would fire on
 * `invoice_series`, which is in the naming contract.
 *
 * Words identical in both languages are deliberately absent: total, base,
 * local/locale, error, real, id. All appear in the naming contract, and a
 * guard that fires on `sales.total` on day one is a guard that gets deleted on
 * day two. `nif` is absent for the same reason — an acronym for a legal
 * identifier, not vocabulary.
 */
export const SPANISH_WORDS = new Set([
  // chain and record vocabulary — the naming contract's module tables
  "registro",
  "registros",
  "huella",
  "huellas",
  "cadena",
  "cadenas",
  "encadenamiento",
  "secuencia",
  "secuencias",
  "primer",
  "primero",
  // invoice vocabulary
  "factura",
  "facturas",
  "facturacion",
  "alta",
  "altas",
  "anulacion",
  "anulaciones",
  "rectificativa",
  "rectificativas",
  "desglose",
  "desgloses",
  "serie",
  "numero",
  "numeros",
  "importe",
  "importes",
  "cuota",
  "cuotas",
  "impuesto",
  "impuestos",
  "iva",
  // parties and identity
  "obligado",
  "obligados",
  "emisor",
  "emisores",
  "destinatario",
  "destinatarios",
  "tercero",
  "terceros",
  "cliente",
  "clientes",
  "usuario",
  "usuarios",
  "empresa",
  "empresas",
  "nombre",
  "nombres",
  "razon",
  "tributario",
  "instalacion",
  "informatico",
  "informatica",
  "sistema",
  // submission vocabulary
  "envio",
  "envios",
  "incidencia",
  "incidencias",
  "suministro",
  "consulta",
  "respuesta",
  "cabecera",
  "detalle",
  "detalles",
  "presentacion",
  "expedicion",
  "periodo",
  "ejercicio",
  "operacion",
  "operaciones",
  // time
  "fecha",
  "fechas",
  "hora",
  "huso",
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
  // deployment-environment vocabulary (packages/fiscal-verifactu's registros_facturacion.entorno)
  "entorno",
  "entornos",
  "descripcion",
  "descripciones",
  // workforce / registro de jornada vocabulary (sub-project 16). The list above carried
  // fiscal/POS terms but no labour terms, so packages/workforce — an English generic package — was
  // guarded against Spanish invoice vocabulary but not against Spanish LABOUR vocabulary. These arm
  // it before the first Spanish labour name can land (packages/workforce-es and the Slice 2/3
  // tables), the same "in place before the package" posture `sourceFilesIn` documents below.
  // Verified not to collide with any existing generic-package identifier by running the guard over
  // all eleven generics with this list in place; a firing check lives in scripts/english-only.test.ts.
  "jornada",
  "jornadas",
  "empleado",
  "empleados",
  "trabajador",
  "trabajadores",
  "trabajo",
  "fichaje",
  "fichajes",
  "presencia",
  "descanso",
  "descansos",
  "ausencia",
  "ausencias",
  "turno",
  "turnos",
  "horario",
  "horarios",
  "nocturnidad",
  "festivo",
  "festivos",
  "vacaciones",
  "permiso",
  "permisos",
  "baja",
  "bajas",
  "finiquito",
  "contrato",
  "contratos",
  "salario",
  "salarios",
  "nomina",
  "nominas",
  "convenio",
  "convenios",
  "retribucion",
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

/** Every Spanish token in `source`, in order, with its line. */
export function findSpanish(source: string): Violation[] {
  const violations: Violation[] = [];
  const lines = blankBlockComments(source).split("\n");
  lines.forEach((line, index) => {
    for (const token of tokenise(dropLineComment(line))) {
      if (SPANISH_WORDS.has(token)) {
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
