import { formatDateTime } from "@waitron/verifactu";
import type {
  Encadenamiento,
  RegistroAlta,
  RegistroAnulacion,
  SistemaInformatico,
  TipoHuella,
} from "@waitron/verifactu";
import { registrosFacturacion } from "./schema/registros.js";

/**
 * The insertable row shape, derived from the table's own schema rather than hand-duplicated.
 * `typeof table.$inferInsert` is the single source of truth for these columns; a hand-written
 * mirror interface would drift silently the next time a column is added or renamed in
 * ./schema/registros.ts, and nothing here would notice until an insert failed at runtime.
 */
export type RegistroRowInsert = typeof registrosFacturacion.$inferInsert;

export interface RegistroRowContext {
  tenantId: string;
  tillId: string;
  /** Which SIF identity generated this record — findings §1's "a new NúmeroInstalación is a new
   * chain" made a database fact. Resolved by the caller via `currentSif` (./registro-sif.ts),
   * never re-derived here: this file only flattens an already-built record into columns. */
  sifId: string;
  saleId: string;
  secuencia: number;
  /**
   * From the SAME `PendingRegistro.input` the record was built from — never re-derived. A
   * `timestamptz` column normalises to UTC on storage and renders back in the reading session's
   * zone, so the ORIGINAL offset the huella hashed cannot be recovered from the column alone
   * (./schema/registros.ts's own note on `offset_minutos`). Storing this value beside it is what
   * lets a later reader call `formatDateTime(storedInstant, storedOffsetMinutes)` and reproduce
   * the exact literal that was hashed, rather than a value merely equal to it in wall-clock terms.
   */
  offsetMinutes: number;
}

/**
 * `@waitron/verifactu`'s own `isAlta` (types.ts) is not part of that package's value exports — its
 * barrel re-exports types.ts's types only, wildcard, type-only, which strips the runtime function
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
 * `fecha_hora_huso_gen_registro` (a `timestamptz` cannot retain which offset was originally
 * written), a calendar day has exactly one value no matter which order its digits are printed in,
 * so storing it as a real `date` and reformatting on the way in and out never risks producing a
 * literal other than the one that was hashed.
 */
function toIsoDate(ddMmYyyy: string): string {
  const [dd, mm, yyyy] = ddMmYyyy.split("-");
  return `${yyyy}-${mm}-${dd}`;
}

/** The inverse of toIsoDate, for reading a stored predecessor back into a RegistroAnterior pointer. */
function toAeatDate(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split("-");
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Flattens a built record into columns. Every hashed field is stored as the EXACT literal
 * `computeHuella` folded in — this is the concrete meaning of Global Constraint's "nothing
 * formatted is ever stored" rule as applied to this one table (./schema/registros.ts's own note:
 * that rule is inverted here on purpose, because AEAT recomputes the huella from the literal it
 * receives, and a re-derived value that merely equals the original is not good enough).
 *
 * The four `anterior_*` columns use the ALTA-style field names (`IDEmisorFactura`, not
 * `IDEmisorFacturaAnulada`) regardless of which record type is doing the pointing:
 * `RegistroAnterior`'s sub-elements are named that way in BOTH record types (@waitron/verifactu's
 * types.ts), so one set of columns serves both directions without a second, anulación-flavoured
 * copy of the same four fields.
 */
export function toRegistroRow(
  record: RegistroAlta | RegistroAnulacion,
  ctx: RegistroRowContext,
): RegistroRowInsert {
  const anterior = record.Encadenamiento.RegistroAnterior;
  const common = {
    tenantId: ctx.tenantId,
    tillId: ctx.tillId,
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
    // The exact instant `generadoEn` + `offsetMinutes` produced. Postgres stores it as an absolute
    // instant (correct regardless of offset); `ctx.offsetMinutes` beside it is what makes the
    // ORIGINAL literal reproducible later, per this interface's own doc comment above.
    fechaHoraHusoGenRegistro: new Date(record.FechaHoraHusoGenRegistro),
    offsetMinutos: ctx.offsetMinutes,
    tipoHuella: record.TipoHuella,
    huella: record.Huella,
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
    // RegistroAnulacion carries no NombreRazonEmisor of its own (@waitron/verifactu's types.ts) —
    // this column is NOT NULL regardless of tipo_registro, purely for this package's own querying
    // convenience, so it falls back to the one emisor name every record DOES carry.
    nombreRazonEmisor: record.SistemaInformatico.NombreRazon,
    tipoFactura: null,
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
 * The raw shape of one `select * from registros_facturacion` row — snake_case columns, exactly as
 * an UNTYPED `tx.execute(sql\`...\`)` hands them back. Deliberately NOT `typeof
 * registrosFacturacion.$inferSelect` (camelCase, the shape Drizzle's own typed `.select()` query
 * builder produces): a raw `sql` execution is not tied to any schema column, so Drizzle has no
 * `PgColumn` to run `mapFromDriverValue` through and returns whatever the driver itself gives back
 * (chain.test.ts's own "stores the exact literals" test makes the identical observation for
 * `fecha_hora_huso_gen_registro`). Verified live against PGlite: `date` and `jsonb` columns come
 * back already as a plain ISO string and a parsed object/array respectively; `timestamptz` comes
 * back as a non-ISO `"YYYY-MM-DD HH:MM:SS±HH"` string in the reading session's own zone — which is
 * exactly why `fromRegistroRow` below never reads it directly and instead rebuilds the literal via
 * `formatDateTime` + the stored `offset_minutos`, per this file's own note on that column above.
 *
 * A `type` alias over an object literal, deliberately not an `interface`: `Transaction["execute"]`
 * constrains its row generic to `Record<string, unknown>` (packages/db/src/client.ts's own
 * `SharedQueryResultHKT`), and TypeScript only infers the implicit string index signature that
 * satisfies that constraint for a fresh object-literal type — an `interface` of the identical
 * shape is NOT considered index-signature-compatible and fails `tsc` with "Index signature for
 * type 'string' is missing", which is exactly what using `interface` here produced. Every other
 * `db.execute<T>()`/`tx.execute<T>()` call site in this package (chain.test.ts's `records()`, this
 * task's own verify.test.ts) sidesteps the same trap by using an inline object literal type for
 * the same reason.
 */
export type RegistroRow = {
  id: string;
  tenant_id: string;
  till_id: string;
  sif_id: string;
  sale_id: string;
  secuencia: number;
  tipo_registro: string;
  id_emisor_factura: string;
  num_serie_factura: string;
  fecha_expedicion_factura: string;
  nombre_razon_emisor: string;
  tipo_factura: string | null;
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
  fecha_hora_huso_gen_registro: string;
  offset_minutos: number;
  tipo_huella: TipoHuella;
  huella: string;
  creado_en: string;
};

/**
 * Rebuilds a record from its stored columns, for recomputation only (art. 7.i, ./verify.ts).
 *
 * Every value is returned exactly as stored — no reformatting, no numeric round-trip. That is the
 * whole point: the huella is SHA-256 over the literal that was serialised, so re-deriving "123.10"
 * from a numeric 123.1 would produce a different hash and report a corrupt chain on untouched
 * rows. `FechaHoraHusoGenRegistro` is the one field that genuinely needs reconstruction rather than
 * a straight column read: `fecha_hora_huso_gen_registro` is a `timestamptz` and therefore renders
 * in the READING SESSION's zone, not the original one the huella hashed — `offset_minutos` beside
 * it (this file's own note on `RegistroRowContext.offsetMinutes`, and ./schema/registros.ts's
 * identical note on the column) is what makes the ORIGINAL literal reproducible via
 * `formatDateTime`, exactly as chain.test.ts's own "stores the exact literals" test already
 * verifies for the write path.
 */
export function fromRegistroRow(row: RegistroRow): RegistroAlta | RegistroAnulacion {
  // Casts, not `?? ""` runtime fallbacks, for the four `anterior_*` columns: this branch only
  // runs when `row.primer_registro` is false, and `registros_encadenamiento_ck`
  // (./schema/registros.ts) guarantees all four are NOT NULL together whenever that is the case —
  // a real database invariant, not merely an assumption. Of the four, only `.Huella` is ever
  // actually read for hashing purposes: `@waitron/verifactu`'s own `huellaAnteriorOf` (huella.ts)
  // extracts nothing else off `RegistroAnterior`, so `IDEmisorFactura`/`NumSerieFactura`/
  // `FechaExpedicionFactura` here are dead data for recomputation regardless of their value.
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
    // DescripcionOperacion and Desglose are not huella inputs at all — huella.ts's
    // buildCadenaAlta hashes exactly eight named fields and neither is among them — so a plain
    // cast is enough; their actual value cannot affect recomputation either way.
    DescripcionOperacion: row.descripcion_operacion as string,
    Desglose: row.desglose as RegistroAlta["Desglose"],
    // CuotaTotal/ImporteTotal ARE huella inputs, but huella.ts's own `trimValue` (invoked on every
    // field by `joinCampos`, these two included) already maps `null`/`undefined` to `""` — so even
    // in the hypothetical case either were stored null, recomputing through the cast below goes
    // through the exact same "no value" path AEAT's own hashing already defines, and a `?? ""`
    // fallback here would only be duplicating what trimValue does for us one line downstream.
    CuotaTotal: row.cuota_total as string,
    ImporteTotal: row.importe_total as string,
  };
}
