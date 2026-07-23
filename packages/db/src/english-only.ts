import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/** `<repo>/packages`. Derived, so the guard survives being run from anywhere. */
export const PACKAGES_ROOT = join(import.meta.dirname, "..", "..");

/** English throughout — identifiers and table/column names alike (spec §2). */
export const GENERIC_PACKAGES = ["db", "core", "fiscal", "shared", "payments"] as const;

/** Spanish by design: these mirror AEAT's spec, XML and conformance vectors. */
export const EXEMPT_PACKAGES = ["verifactu", "fiscal-verifactu"] as const;

/**
 * Files that exist to enumerate forbidden vocabulary in plain text, excluded by exact name from
 * the scan that vocabulary feeds — this guard's own two files, plus `packages/fiscal`'s narrower
 * one.
 *
 * `english-only.ts`/`english-only.test.ts` contain the entire Spanish wordlist in plain text, so
 * scanning them would fail on the vocabulary they exist to define.
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
export const SELF = [
  "english-only.ts",
  "english-only.test.ts",
  "no-regime-vocabulary.test.ts",
] as const;

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
