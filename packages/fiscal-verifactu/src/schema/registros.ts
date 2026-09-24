import { sql } from "drizzle-orm";
import { check, index, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  day,
  flag,
  id,
  json,
  label,
  newId,
  nodes,
  now,
  sales,
  table,
  tills,
  ts,
} from "@waitron/db";
import { registroSif } from "./sif.js";

/**
 * Query keys live in columns and structured, non-hashed payloads in `json` columns. Huella inputs
 * keep their original text representation.
 */
export const registrosFacturacion = table(
  "registros_facturacion",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // The till the sale rang at: informational only. The chain key is `node_id`.
    tillId: id("till_id")
      .notNull()
      /* v8 ignore start */
      .references(() => tills.id),
    /* v8 ignore stop */
    // The node that owns this record's chain: the chain key.
    nodeId: id("node_id")
      .notNull()
      /* v8 ignore start */
      .references(() => nodes.id),
    /* v8 ignore stop */
    // Which SIF identity generated this record. A new NúmeroInstalación is a new SIF, therefore a
    // new chain, and this column is what makes "which chain" a fact on the row
    // rather than an inference from dates.
    sifId: id("sif_id")
      .notNull()
      /* v8 ignore start */
      .references(() => registroSif.id),
    /* v8 ignore stop */
    saleId: id("sale_id")
      .notNull()
      /* v8 ignore start */
      .references(() => sales.id),
    /* v8 ignore stop */
    // OUR ordering aid for the outbox. NOT AEAT's — AEAT has no sequence number. It is never a
    // substitute for the four-part predecessor pointer below, and it is NEVER derived from or
    // validated against the invoice counter: chain position is chronological by generation within
    // the SIF and is unrelated to invoice number. AEAT's own sample chains invoice 12345 to
    // predecessor invoice 44.
    secuencia: count("secuencia").notNull(),
    tipoRegistro: label("tipo_registro").notNull(),
    idEmisorFactura: label("id_emisor_factura").notNull(),
    numSerieFactura: label("num_serie_factura").notNull(),
    fechaExpedicionFactura: day("fecha_expedicion_factura").notNull(),
    nombreRazonEmisor: label("nombre_razon_emisor").notNull(),
    // Null on an anulación — RegistroAnulacion carries no TipoFactura at all.
    tipoFactura: label("tipo_factura"),
    // AEAT's rectificativa and substitution blocks, copied from the RegistroAlta when present. Not
    // huella inputs, so `json` is safe; a hashed field would need `text`.
    tipoRectificativa: label("tipo_rectificativa"),
    facturasRectificadas: json("facturas_rectificadas"),
    facturasSustituidas: json("facturas_sustituidas"),
    importeRectificacion: json("importe_rectificacion"),
    // RegistroAlta["Destinatarios"]: NULL on a simplified F2 alta and on an anulación. Not a huella
    // input either.
    destinatarios: json("destinatarios"),
    descripcionOperacion: label("descripcion_operacion"),
    desglose: json("desglose"),
    // Plain `text`, never `money` or `label()`: `@waitron/verifactu`'s `buildCadena` hashes
    // `CuotaTotal`/`ImporteTotal` byte-for-byte, so the stored bytes ARE the huella's input and
    // must not pass through any helper that could re-render them. `ImporteSgn12.2Type` allows 12
    // integer digits. NULL on an anulación, whose record hashes neither field. These are the only
    // two lines in this file importing a builder straight from drizzle; nothing catches a
    // substitution by `label()`, which emits `text` today.
    cuotaTotal: text("cuota_total"),
    importeTotal: text("importe_total"),
    // The Encadenamiento xsd:choice, flattened. Exactly one arm, enforced by CHECK below.
    primerRegistro: flag("primer_registro").notNull(),
    anteriorIdEmisorFactura: label("anterior_id_emisor_factura"),
    anteriorNumSerieFactura: label("anterior_num_serie_factura"),
    anteriorFechaExpedicionFactura: day("anterior_fecha_expedicion_factura"),
    anteriorHuella: label("anterior_huella"),
    sistemaInformatico: json("sistema_informatico").notNull(),
    fechaHoraHusoGenRegistro: ts("fecha_hora_huso_gen_registro").notNull(),
    // A `ts` column stores UTC (`toISOString`), so the original `+01:00` is gone once stored. The
    // huella hashes the literal INCLUDING that offset, so without this column a stored registro
    // cannot be re-hashed.
    offsetMinutos: count("offset_minutos").notNull(),
    tipoHuella: label("tipo_huella").notNull(),
    huella: label("huella").notNull(),
    // Which environment this registro was GENERATED for, so `drain` can refuse to submit it to the
    // other one. A fact about the record, not the attempt to send it, so not on `envios`.
    //
    // NOT part of the huella. `entorno` is ours, never AEAT's: it is absent from the RegistroAlta/
    // RegistroAnulacion `toRegistroRow` builds off of, and `verify.test.ts` pins that two records
    // differing only here hash identically. Never read by `fromRegistroRow` for exactly that
    // reason — a value that reached recomputation would make one environment's chain unverifiable
    // under the other.
    entorno: label("entorno"),
    creadoEn: ts("creado_en").notNull().$defaultFn(now),
  },
  /* v8 ignore start */
  (t) => [
    // THE backstop against two writers claiming one chain position. Keyed on the node: two tills
    // of one node share one sequence. See chain.node-rekey.concurrency.test.ts.
    uniqueIndex("registros_tenant_node_secuencia_uq").on(t.nodeId, t.secuencia),
    // AEAT record identity is IDEmisorFactura + NumSerieFactura + FechaExpedicionFactura, and a
    // duplicate returns error 3000. `tipo_registro` joins the key because an alta and its
    // anulación legitimately share the triple.
    uniqueIndex("registros_identidad_uq").on(
      t.idEmisorFactura,
      t.numSerieFactura,
      t.fechaExpedicionFactura,
      t.tipoRegistro,
    ),
    index("registros_sale_idx").on(t.saleId),
    index("registros_node_secuencia_idx").on(t.nodeId, t.secuencia),
    check("registros_tipo_registro_ck", sql`${t.tipoRegistro} in ('alta', 'anulacion')`),
    check("registros_tipo_huella_ck", sql`${t.tipoHuella} = '01'`),
    // Uppercase SHA-256 hex; `glob` is the case-SENSITIVE matcher. Does NOT refuse a value holding
    // a NUL byte: `length()` and `glob` both stop at the first NUL.
    check(
      "registros_huella_ck",
      sql`length(${t.huella}) = 64 and ${t.huella} not glob '*[^0-9A-F]*'`,
    ),
    check("registros_secuencia_ck", sql`${t.secuencia} > 0`),
    check(
      "registros_entorno_ck",
      sql`${t.entorno} is null or ${t.entorno} in ('production', 'preproduction')`,
    ),
    check(
      "registros_tipo_rectificativa_ck",
      sql`${t.tipoRectificativa} is null or ${t.tipoRectificativa} in ('S', 'I')`,
    ),
    // A rectification type requires an R1–R5 invoice type. Explicit NOT NULL rejects
    // anulación rows: SQL CHECK accepts NULL results as well as true.
    // `glob` matches the WHOLE value and is case-sensitive. Same NUL gap as registros_huella_ck.
    check(
      "registros_tipo_factura_rectificativa_ck",
      sql`${t.tipoRectificativa} is null or (${t.tipoFactura} is not null and ${t.tipoFactura} glob 'R[1-5]')`,
    ),
    // A substitution block requires F3. Explicit NOT NULL rejects anulación rows
    // because SQL CHECK accepts NULL results as well as true.
    check(
      "registros_facturas_sustituidas_f3_ck",
      sql`${t.facturasSustituidas} is null or (${t.tipoFactura} is not null and ${t.tipoFactura} = 'F3')`,
    ),
    check(
      "registros_encadenamiento_ck",
      sql`(${t.primerRegistro}
             and ${t.anteriorIdEmisorFactura} is null
             and ${t.anteriorNumSerieFactura} is null
             and ${t.anteriorFechaExpedicionFactura} is null
             and ${t.anteriorHuella} is null)
           or (not ${t.primerRegistro}
             and ${t.anteriorIdEmisorFactura} is not null
             and ${t.anteriorNumSerieFactura} is not null
             and ${t.anteriorFechaExpedicionFactura} is not null
             and ${t.anteriorHuella} is not null)`,
    ),
  ],
  /* v8 ignore stop */
);
