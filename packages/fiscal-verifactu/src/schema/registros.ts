import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sales, tenants, tills } from "@waitron/db";
import { registroSif } from "./sif.js";

/**
 * The immutable registro de facturación. Real columns, not an opaque payload, because this is
 * the table the module queries: the outbox drains by `(tenant_id, estado, proximo_intento_en)`,
 * reconciliation filters by período de imputación, and art. 7.i verification walks predecessors
 * by identity. A jsonb blob would make every one of those a full scan plus a deserialise.
 *
 * Two columns are jsonb, and the rule that puts them there is narrow: a value earns its own
 * column when something queries, joins or constrains it.
 *
 * `jsonb`, not `text`, is safe for both because NEITHER is part of the huella input:
 * `buildCadenaAlta`/`buildCadenaAnulacion` (`packages/verifactu/src/huella.ts`) hash exactly 8
 * and 5 named fields respectively, and `Desglose`/`SistemaInformatico` are not among them. jsonb's
 * key-reordering-on-storage is therefore harmless here — these values are only ever
 * re-serialised into XML, never digested. (A field that WERE part of the huella input would need
 * `text`, for the same byte-identity reason `cuota_total`/`importe_total` below are `text` —
 * jsonb must never be used for anything this package hashes.)
 *
 * - `desglose` is a repeating group of 1–12 entries containing an xsd:choice. In columns that
 *   means a child table — and a child table of an immutable parent needs its own revocation, its
 *   own pair of triggers and its own RLS policy, all to serve a query nobody makes. It is never
 *   filtered on.
 * - `sistema_informatico` is a nine-field snapshot. The identity-bearing parts of it —
 *   `numero_instalacion` and `id_sistema_informatico` — are already real, unique-constrained
 *   columns on `registro_sif`. This is a frozen copy of a row that also exists relationally, and
 *   splitting it into nine columns invites exactly the backfill that would silently diverge from
 *   what was actually sent to AEAT.
 */
export const registrosFacturacion = pgTable(
  "registros_facturacion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    tillId: uuid("till_id")
      .notNull()
      .references(() => tills.id),
    // Which SIF identity generated this record. A new NúmeroInstalación is a new SIF, therefore a
    // new chain (findings §1), and this column is what makes "which chain" a fact on the row
    // rather than an inference from dates.
    sifId: uuid("sif_id")
      .notNull()
      .references(() => registroSif.id),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id),
    // OUR ordering aid for the outbox. NOT AEAT's — AEAT has no sequence number. It is never a
    // substitute for the four-part predecessor pointer below, and it is NEVER derived from or
    // validated against the invoice counter (spec §3, findings §1): chain position is
    // chronological by generation within the SIF and is unrelated to invoice number. AEAT's own
    // sample chains invoice 12345 to predecessor invoice 44.
    secuencia: integer("secuencia").notNull(),
    tipoRegistro: text("tipo_registro").notNull(),
    idEmisorFactura: text("id_emisor_factura").notNull(),
    numSerieFactura: text("num_serie_factura").notNull(),
    fechaExpedicionFactura: date("fecha_expedicion_factura").notNull(),
    nombreRazonEmisor: text("nombre_razon_emisor").notNull(),
    // Null on an anulación — RegistroAnulacion carries no TipoFactura at all.
    tipoFactura: text("tipo_factura"),
    descripcionOperacion: text("descripcion_operacion"),
    desglose: jsonb("desglose"),
    // `text`, NOT `numeric(12,2)` — deliberately, and load-bearing. `packages/verifactu/src/
    // huella.ts`'s `buildCadena` reads `CuotaTotal`/`ImporteTotal` verbatim as strings and hashes
    // them byte-for-byte; it never re-runs `formatAmountExact`. The stored column value therefore IS
    // the huella's input, and the stored bytes must equal the hashed bytes — which only `text`
    // guarantees. `numeric` would silently re-render on read (and `numeric(12,2)` is additionally
    // too narrow: `ImporteSgn12.2Type` allows 12 integer digits, i.e. up to
    // "999999999999.99", while `numeric(12,2)` is 10 integer + 2 decimal and overflows on
    // anything over 10 integer digits with SQLSTATE 22003). Nullable exactly as before: an
    // anulación's `RegistroAnulacion` hashes neither field, so NULL is correct there.
    cuotaTotal: text("cuota_total"),
    importeTotal: text("importe_total"),
    // The Encadenamiento xsd:choice, flattened. Exactly one arm, enforced by CHECK below.
    primerRegistro: boolean("primer_registro").notNull(),
    anteriorIdEmisorFactura: text("anterior_id_emisor_factura"),
    anteriorNumSerieFactura: text("anterior_num_serie_factura"),
    anteriorFechaExpedicionFactura: date("anterior_fecha_expedicion_factura"),
    anteriorHuella: text("anterior_huella"),
    sistemaInformatico: jsonb("sistema_informatico").notNull(),
    fechaHoraHusoGenRegistro: timestamp("fecha_hora_huso_gen_registro", {
      withTimezone: true,
    }).notNull(),
    // timestamptz normalises to UTC and renders in the SESSION's zone, so the original `+01:00`
    // is gone the moment it is stored. The huella hashes the literal INCLUDING that offset, so
    // without this column a stored registro cannot be re-hashed and art. 7.i verification would
    // compare against a value it can no longer reproduce.
    offsetMinutos: integer("offset_minutos").notNull(),
    tipoHuella: text("tipo_huella").notNull(),
    huella: text("huella").notNull(),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  // Drizzle invokes this extraConfig callback lazily — via `drizzle(client, { schema })`
  // walking each table for its metadata — not merely from `pgTable(...)` running at import
  // time. Every test in this package obtains its database through `@waitron/db`'s
  // `createPgliteDb()`, which is wired to CORE's schema (packages/db/src/client.ts) and talks
  // to this package's own tables only via raw `sql` execution, so this callback body never
  // runs inside this package's own test process. It runs for real in exactly one place today:
  // `drizzle-kit generate`, in its own separate CLI process, the same reason
  // packages/db/src/schema/sales.ts's two-argument `.references(..., { onDelete })` thunks
  // carry `/* v8 ignore next */`. The ignore markers bracket the WHOLE arrow function, not just
  // its returned array's elements: v8 also tracks "was this function ever called", and a range
  // that opened only after the arrow function's own `(t) => [` left the function's closing
  // bracket itself separately reported as an uncovered line.
  /* v8 ignore start */
  (t) => [
    // THE non-negotiable backstop against two writers claiming one chain position — a real risk
    // with a PWA that can have several tabs open. Measured on real Postgres, a naive
    // read-then-write committed 3 of 20 concurrent appends and the chain stayed intact ONLY
    // because of this constraint.
    uniqueIndex("registros_tenant_till_secuencia_uq").on(t.tenantId, t.tillId, t.secuencia),
    // AEAT record identity is IDEmisorFactura + NumSerieFactura + FechaExpedicionFactura, and a
    // duplicate returns error 3000. `tipo_registro` joins the key because an alta and its
    // anulación legitimately share the triple.
    uniqueIndex("registros_identidad_uq").on(
      t.tenantId,
      t.idEmisorFactura,
      t.numSerieFactura,
      t.fechaExpedicionFactura,
      t.tipoRegistro,
    ),
    index("registros_sale_idx").on(t.tenantId, t.saleId),
    index("registros_till_secuencia_idx").on(t.tenantId, t.tillId, t.secuencia),
    check("registros_tipo_registro_ck", sql`${t.tipoRegistro} in ('alta', 'anulacion')`),
    check("registros_tipo_huella_ck", sql`${t.tipoHuella} = '01'`),
    check("registros_huella_ck", sql`${t.huella} ~ '^[0-9A-F]{64}$'`),
    check("registros_secuencia_ck", sql`${t.secuencia} > 0`),
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
).enableRLS();
