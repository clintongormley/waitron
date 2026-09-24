import { getTableColumns } from "drizzle-orm";
import { formatDateTime } from "@waitron/verifactu";
import type {
  DesgloseRectificacion,
  Encadenamiento,
  RegistroAlta,
  RegistroAnulacion,
  SistemaInformatico,
  TipoHuella,
} from "@waitron/verifactu";
import { registrosFacturacion } from "./schema/registros.js";

/** The insertable row shape, derived from the table's own schema rather than hand-duplicated. */
export type RegistroRowInsert = typeof registrosFacturacion.$inferInsert;

/**
 * Which deployment a registro was generated for. A package-local union, deliberately NOT
 * `apps/server`'s `DeploymentEnvironment` type — this package must never import from `apps/server`
 * — but a union all the same, not a bare `string`, so an unrepresentable value is a `tsc` error
 * instead of a `registros_entorno_ck` refusal inside a sale's transaction.
 */
export type Entorno = "production" | "preproduction";

export interface RegistroRowContext {
  /** The till the sale rang at — an informational SNAPSHOT column on the immutable record; `nodeId`
   * below is the chain key. Travels on the `PendingRegistro`, NOT an `appendToChain` parameter. */
  tillId: string;
  /** The node that owns this record's chain — the CHAIN KEY. This is the `appendToChain`
   * parameter, stamped onto `node_id`. */
  nodeId: string;
  /** Which SIF identity generated this record. Resolved by the caller via `currentSif`
   * (./registro-sif.ts), never re-derived here. */
  sifId: string;
  saleId: string;
  secuencia: number;
  /**
   * From the SAME `PendingRegistro.input` the record was built from — never re-derived. The
   * instant column beside it stores UTC and nothing else — a record generated at `+02:00` stores
   * the literal `2026-07-21T17:20:30.000Z` — so the ORIGINAL offset the huella hashed cannot be
   * recovered from the column alone. Storing this value beside it is what lets a later reader call
   * `formatDateTime(storedInstant, storedOffsetMinutes)` and reproduce the exact literal that was
   * hashed, rather than a value merely equal to it in wall-clock terms.
   */
  offsetMinutes: number;
  /**
   * Which environment this registro was generated for. OURS, never AEAT's: it is written straight
   * onto the column and MUST NEVER be folded into `record` before it reaches `computeHuella`, or
   * every chain would be unverifiable under the other environment. verify.test.ts pins that two
   * records differing only in `entorno` hash identically.
   */
  entorno: Entorno;
}

/**
 * `@waitron/verifactu`'s own `isAlta` is not part of that package's value exports — its
 * barrel re-exports the package's types only, wildcard, type-only, which strips the runtime function
 * and keeps just its type. Reimplemented here with the identical discriminator (`RegistroAnulacion`
 * carries no `TipoFactura` at all) rather than widening that package's public surface for one
 * internal call site.
 */
function isAlta(record: RegistroAlta | RegistroAnulacion): record is RegistroAlta {
  return "TipoFactura" in record;
}

/**
 * AEAT's `sf:fecha` ("DD-MM-YYYY", what the huella hashes) reordered to this column's real `date`
 * type ("YYYY-MM-DD"). A pure digit reordering, and lossless in both directions — unlike the
 * money columns (more than one literal, "123.1" vs "123.10", can hash to the same value) or
 * `fecha_hora_huso_gen_registro` (an instant stored as UTC cannot retain which offset was
 * originally written), a calendar day has exactly one value no matter which order its digits are printed in,
 * so storing it as a real `date` and reformatting on the way in and out never risks producing a
 * literal other than the one that was hashed.
 */
function toIsoDate(ddMmYyyy: string): string {
  const [dd, mm, yyyy] = ddMmYyyy.split("-");
  return `${yyyy}-${mm}-${dd}`;
}

/** The inverse of toIsoDate, for reading a stored predecessor back into a RegistroAnterior pointer. */
export function toAeatDate(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split("-");
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Flattens a built record into columns. Every hashed field is stored as the EXACT literal
 * `computeHuella` folded in, because AEAT recomputes the huella from the literal it receives, and a
 * re-derived value that merely equals the original is not good enough.
 *
 * The four `anterior_*` columns use the ALTA-style field names (`IDEmisorFactura`, not
 * `IDEmisorFacturaAnulada`) regardless of which record type is doing the pointing:
 * `RegistroAnterior`'s sub-elements are named that way in BOTH record types (@waitron/verifactu),
 * so one set of columns serves both directions without a second, anulación-flavoured
 * copy of the same four fields.
 */
export function toRegistroRow(
  record: RegistroAlta | RegistroAnulacion,
  ctx: RegistroRowContext,
): RegistroRowInsert {
  const anterior = record.Encadenamiento.RegistroAnterior;
  const common = {
    tillId: ctx.tillId,
    nodeId: ctx.nodeId,
    sifId: ctx.sifId,
    saleId: ctx.saleId,
    secuencia: ctx.secuencia,
    primerRegistro: anterior === undefined,
    anteriorIdEmisorFactura: anterior?.IDEmisorFactura ?? null,
    anteriorNumSerieFactura: anterior?.NumSerieFactura ?? null,
    anteriorFechaExpedicionFactura:
      anterior !== undefined ? toIsoDate(anterior.FechaExpedicionFactura) : null,
    anteriorHuella: anterior?.Huella ?? null,
    sistemaInformatico: record.SistemaInformatico,
    // The column stores this instant as UTC; `ctx.offsetMinutes` beside it is what makes the
    // ORIGINAL literal reproducible later.
    fechaHoraHusoGenRegistro: new Date(record.FechaHoraHusoGenRegistro),
    offsetMinutos: ctx.offsetMinutes,
    tipoHuella: record.TipoHuella,
    huella: record.Huella,
    entorno: ctx.entorno,
  };

  if (isAlta(record)) {
    return {
      ...common,
      tipoRegistro: "alta",
      idEmisorFactura: record.IDFactura.IDEmisorFactura,
      numSerieFactura: record.IDFactura.NumSerieFactura,
      fechaExpedicionFactura: toIsoDate(record.IDFactura.FechaExpedicionFactura),
      nombreRazonEmisor: record.NombreRazonEmisor,
      tipoFactura: record.TipoFactura,
      // The four AEAT rectificativa fields, stored as-built so the drainer re-serialises the whole
      // rectificativa (fromRegistroRow reads them back). None is hashed, so storing them here does
      // not affect this record's huella.
      tipoRectificativa: record.TipoRectificativa ?? null,
      facturasRectificadas: record.FacturasRectificadas ?? null,
      facturasSustituidas: record.FacturasSustituidas ?? null,
      importeRectificacion: record.ImporteRectificacion ?? null,
      // The recipient, stored as-built so the drainer re-serialises the mandatory Destinatarios.
      // Not a huella input (`@waitron/verifactu` hashes 8 named fields, none of them the
      // recipient). NULL on a simplified F2 alta; set on an F3 canje and on an F1 full invoice.
      destinatarios: record.Destinatarios ?? null,
      descripcionOperacion: record.DescripcionOperacion,
      desglose: record.Desglose,
      cuotaTotal: record.CuotaTotal,
      importeTotal: record.ImporteTotal,
    };
  }

  return {
    ...common,
    tipoRegistro: "anulacion",
    idEmisorFactura: record.IDFactura.IDEmisorFacturaAnulada,
    numSerieFactura: record.IDFactura.NumSerieFacturaAnulada,
    fechaExpedicionFactura: toIsoDate(record.IDFactura.FechaExpedicionFacturaAnulada),
    // RegistroAnulacion carries no NombreRazonEmisor of its own (@waitron/verifactu) —
    // this column is NOT NULL regardless of tipo_registro, purely for this package's own querying
    // convenience, so it falls back to the one emisor name every record DOES carry.
    nombreRazonEmisor: record.SistemaInformatico.NombreRazon,
    tipoFactura: null,
    // A RegistroAnulacion carries none of the four rectificativa fields — they belong to a
    // registro de alta whose TipoFactura is R1–R5, never to an anulación.
    tipoRectificativa: null,
    facturasRectificadas: null,
    facturasSustituidas: null,
    importeRectificacion: null,
    // A RegistroAnulacion carries no recipient either — Destinatarios belongs to a registro de alta
    // whose TipoFactura is a full invoice (F1/F3), never to an anulación.
    destinatarios: null,
    descripcionOperacion: null,
    desglose: null,
    cuotaTotal: null,
    importeTotal: null,
  };
}

/** The four-part predecessor pointer, read off a previously stored row's own identity columns. */
export function pointerTo(row: {
  idEmisorFactura: string;
  numSerieFactura: string;
  fechaExpedicionFactura: string;
  huella: string;
}): {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: string;
  Huella: string;
} {
  return {
    IDEmisorFactura: row.idEmisorFactura,
    NumSerieFactura: row.numSerieFactura,
    FechaExpedicionFactura: toAeatDate(row.fechaExpedicionFactura),
    Huella: row.huella,
  };
}

/**
 * One `select * from registros_facturacion` row after {@link decodeRegistroRow} — snake_case
 * columns, each value in the shape Drizzle's read mapping produces. Deliberately NOT `typeof
 * registrosFacturacion.$inferSelect` (camelCase, the shape Drizzle's own typed `.select()` query
 * builder produces): a raw `sql` execution is not tied to any schema column, so Drizzle has no
 * column to run `mapFromDriverValue` through and hands back whatever the driver gives it.
 *
 * Which is why this type describes the DECODED row and not the driver's: a raw row reaching a
 * consumer of this type undecoded has its JSON columns as text and `primer_registro` as a number.
 *
 * A `type` alias, deliberately not an `interface`: `Transaction["execute"]` constrains its row
 * generic to `Record<string, unknown>`, and TypeScript gives the implicit string index signature
 * that satisfies it only to an object-literal type, never to an `interface`.
 */
export type RegistroRow = {
  id: string;
  till_id: string;
  node_id: string;
  sif_id: string;
  sale_id: string;
  secuencia: number;
  tipo_registro: string;
  id_emisor_factura: string;
  num_serie_factura: string;
  fecha_expedicion_factura: string;
  nombre_razon_emisor: string;
  tipo_factura: string | null;
  // The four AEAT rectificativa and substitution fields, stored so the drainer can re-serialise
  // them — without which AEAT rejects the filing missing its mandatory TipoRectificativa (error
  // 1114). None is a huella input (`@waitron/verifactu` hashes 8 named fields, none of these), so
  // rehydrating them cannot change a recomputed huella.
  tipo_rectificativa: string | null;
  facturas_rectificadas: RegistroAlta["FacturasRectificadas"] | null;
  facturas_sustituidas: RegistroAlta["FacturasSustituidas"] | null;
  importe_rectificacion: DesgloseRectificacion | null;
  // The recipient. NULL on a simplified F2 alta and on an anulación; set on an F3 canje and on an
  // F1 full invoice so the drainer can re-serialise it. Not a huella input, so rehydrating it
  // cannot change a recomputed huella.
  destinatarios: RegistroAlta["Destinatarios"] | null;
  descripcion_operacion: string | null;
  desglose: RegistroAlta["Desglose"] | null;
  cuota_total: string | null;
  importe_total: string | null;
  primer_registro: boolean;
  anterior_id_emisor_factura: string | null;
  anterior_num_serie_factura: string | null;
  anterior_fecha_expedicion_factura: string | null;
  anterior_huella: string | null;
  sistema_informatico: SistemaInformatico;
  fecha_hora_huso_gen_registro: Date;
  offset_minutos: number;
  tipo_huella: TipoHuella;
  huella: string;
  // Never read by fromRegistroRow below: a value that reached recomputation would make one
  // environment's chain unverifiable under the other.
  entorno: string | null;
  creado_en: Date;
};

/**
 * Drizzle's own read mapping, re-applied to a row that came back from a raw `tx.execute`.
 *
 * A raw `select` is tied to no schema column, so no `mapFromDriverValue` runs on its way out and
 * the row arrives as the ENGINE stored it: JSON columns as text, `primer_registro` as `0`/`1`, and
 * instants as ISO strings. The "hands back exactly what drizzle's own typed select hands back" case
 * in ./registro-row.roundtrip.test.ts compares the two rows side by side.
 *
 * READ SIDE ONLY, and that is the constraint that matters on this table (CLAUDE.md §5): nothing
 * here reaches a write path or a huella input. The two amount columns the huella hashes are
 * `text`, whose mapping is the identity, and the generated-at literal is still rebuilt below from
 * `offset_minutos` rather than read off the column.
 *
 * A column the row carries that this table does not declare passes through untouched — ./drain.ts's
 * claim selects `r.*, e.intentos`, and `intentos` belongs to `envios`.
 */
export function decodeRegistroRow<Row extends RegistroRow = RegistroRow>(
  raw: Record<string, unknown>,
): Row {
  const decoded: Record<string, unknown> = { ...raw };
  for (const column of REGISTRO_COLUMNS) {
    const value = raw[column.name];
    // `undefined` is a column this selection did not ask for. The null skip copies drizzle's own
    // `mapResultRow`; without it a null instant would decode to `new Date(null)`, the epoch.
    if (value === undefined || value === null) continue;
    decoded[column.name] = column.mapFromDriverValue(value);
  }
  return decoded as Row;
}

/** Keyed by the SQL column name, which is what a raw row is keyed by — `getTableColumns` returns
 * the camelCase property names Drizzle's typed select uses. */
const REGISTRO_COLUMNS = Object.values(getTableColumns(registrosFacturacion));

/**
 * Rebuilds a record from its stored columns, for recomputation only (art. 7.i, ./verify.ts).
 *
 * Every value is returned exactly as stored — no reformatting, no numeric round-trip. That is the
 * whole point: the huella is SHA-256 over the literal that was serialised, so re-deriving "123.10"
 * from a numeric 123.1 would produce a different hash and report a corrupt chain on untouched
 * rows. `FechaHoraHusoGenRegistro` is the one field that genuinely needs reconstruction rather than
 * a straight column read: `fecha_hora_huso_gen_registro` holds the instant as UTC and nothing
 * else, so on its own it cannot say which offset the huella hashed — `offset_minutos` beside
 * it is what makes the ORIGINAL literal reproducible via `formatDateTime`.
 */
export function fromRegistroRow(row: RegistroRow): RegistroAlta | RegistroAnulacion {
  // Casts, not `?? ""` runtime fallbacks, for the four `anterior_*` columns: this branch only
  // runs when `row.primer_registro` is false, and `registros_encadenamiento_ck`
  // (./schema/registros.ts) guarantees all four are NOT NULL together whenever that is the case.
  // Of the four, only `.Huella` is read for hashing (`@waitron/verifactu`'s `huellaAnteriorOf`).
  const encadenamiento: Encadenamiento = row.primer_registro
    ? { PrimerRegistro: "S" }
    : {
        RegistroAnterior: {
          IDEmisorFactura: row.anterior_id_emisor_factura as string,
          NumSerieFactura: row.anterior_num_serie_factura as string,
          FechaExpedicionFactura: toAeatDate(row.anterior_fecha_expedicion_factura as string),
          Huella: row.anterior_huella as string,
        },
      };

  const common = {
    IDVersion: "1.0" as const,
    Encadenamiento: encadenamiento,
    SistemaInformatico: row.sistema_informatico,
    // `new Date` on a value `decodeRegistroRow` has already made a `Date` is a copy; it is what
    // also keeps this correct for a row that reached here undecoded, where the column is its ISO
    // string. Either way the instant is the same one, and the literal below is rebuilt from it.
    FechaHoraHusoGenRegistro: formatDateTime(
      new Date(row.fecha_hora_huso_gen_registro),
      row.offset_minutos,
    ),
    TipoHuella: row.tipo_huella,
    Huella: row.huella,
  };

  if (row.tipo_registro === "anulacion") {
    return {
      ...common,
      IDFactura: {
        IDEmisorFacturaAnulada: row.id_emisor_factura,
        NumSerieFacturaAnulada: row.num_serie_factura,
        FechaExpedicionFacturaAnulada: toAeatDate(row.fecha_expedicion_factura),
      },
    };
  }

  return {
    ...common,
    IDFactura: {
      IDEmisorFactura: row.id_emisor_factura,
      NumSerieFactura: row.num_serie_factura,
      FechaExpedicionFactura: toAeatDate(row.fecha_expedicion_factura),
    },
    NombreRazonEmisor: row.nombre_razon_emisor,
    TipoFactura: row.tipo_factura as RegistroAlta["TipoFactura"],
    // The four AEAT rectificativa fields, spread back on ONLY when stored non-null — matching
    // buildAltaRecord's own conditional-spread shape (in `@waitron/verifactu`),
    // so an absent field is OMITTED, never set to null: a `TipoRectificativa: null` would
    // serialise a spurious empty element. None is a huella input (`@waitron/verifactu` hashes 8
    // named fields, none of them), so adding them here cannot change the recomputed huella verify.ts
    // checks; they exist so the drainer files a complete rectificativa (its mandatory
    // TipoRectificativa, AEAT rule 1114).
    ...(row.tipo_rectificativa !== null && {
      TipoRectificativa: row.tipo_rectificativa as "S" | "I",
    }),
    ...(row.facturas_rectificadas !== null && {
      FacturasRectificadas: row.facturas_rectificadas,
    }),
    ...(row.facturas_sustituidas !== null && {
      FacturasSustituidas: row.facturas_sustituidas,
    }),
    ...(row.importe_rectificacion !== null && {
      ImporteRectificacion: row.importe_rectificacion,
    }),
    // The recipient, spread back on ONLY when stored non-null, for the same reason as the four
    // rectificativa fields above. Not a huella input; it exists so the drainer files a complete F3
    // or F1 with its mandatory recipient.
    ...(row.destinatarios !== null && {
      Destinatarios: row.destinatarios,
    }),
    // DescripcionOperacion and Desglose are not huella inputs at all — `@waitron/verifactu`'s
    // buildCadenaAlta hashes exactly eight named fields and neither is among them — so a plain
    // cast is enough; their actual value cannot affect recomputation either way.
    DescripcionOperacion: row.descripcion_operacion as string,
    Desglose: row.desglose as RegistroAlta["Desglose"],
    // CuotaTotal/ImporteTotal ARE huella inputs, but `@waitron/verifactu`'s `trimValue` already
    // maps `null`/`undefined` to `""`, so a `?? ""` fallback here would only duplicate it.
    CuotaTotal: row.cuota_total as string,
    ImporteTotal: row.importe_total as string,
  };
}
