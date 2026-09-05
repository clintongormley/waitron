/**
 * The Spanish terms this module OWNS (module-system architecture §3; SP-3b spec §2–§3): legitimate
 * inside this package, forbidden in every generic package. Declared here and wired onto the
 * `fiscal` descriptor's `vocabulary` seat by the composition list (`@waitron/composition`);
 * interpreted only by the root english-only suite, which assembles the forbidden set from every
 * module's declaration. Nothing at runtime consults it.
 *
 * Tokens, not words — the guard's tokeniser contract (`packages/db/src/english-only.ts`): lowercase
 * ASCII, accents already removed (`anulación` and `anulacion` are one token), singular and plural
 * listed separately, nothing stemmed (stemming `series` to `serie` would fire on `invoice_series`).
 * Words identical in both languages (total, base, local, error, real, id) and the acronym `nif` are
 * deliberately absent: a guard that fires on `sales.total` on day one is deleted on day two.
 */
export const FISCAL_VOCABULARY: readonly string[] = [
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
  // time — AEAT's FechaHoraHusoGenRegistro
  "fecha",
  "fechas",
  "hora",
  "huso",
  // registros_facturacion.entorno — Waitron's own environment stamp, on a fiscal column
  "entorno",
  "entornos",
];
