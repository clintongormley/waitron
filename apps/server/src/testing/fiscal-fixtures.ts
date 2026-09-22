import { randomUUID } from "node:crypto";
import {
  invoiceSeries,
  locations,
  nodes,
  sales,
  tenants,
  tills,
  type Database,
  type Transaction,
} from "@waitron/db";
import { cadenas, envios, registroSif, registrosFacturacion } from "@waitron/fiscal-verifactu";

// Shared fiscal seeding for the fiscal-record suites. It lives under apps/server/src/testing/ because
// its consumers do (boot.mirror's fidelity seeding). Coverage-excluded (this package's vitest.config.ts
// `exclude`). Spanish fiscal column names are used verbatim because apps/* is english-only-exempt.
//
// Column shapes are the current migrated schema (the one taxpayer row keyed 1, vat_breakdown on
// sales, node-keyed series/sif/registro).
//
// Every row here is written through its TABLE DEFINITION rather than as raw SQL, so each column's
// own generator runs — `created_at`, `registrado_en`, `creado_en`, `actualizado_en` and
// `proximo_intento_en` are `$defaultFn` values on this engine, which a raw insert never reaches, and
// a raw insert stopped at `NOT NULL constraint failed: tenants.created_at`. It is also what encodes
// the JSON and list columns, whose `::jsonb` casts and `array[...]` constructors were PostgreSQL
// syntax this engine refuses (`unrecognized token: ":"`). Same change, and the same reason, as
// `packages/db/src/testing/seed.ts`.

/**
 * The sale's issue instant, carrying the `+01:00` that `issued_offset_minutes` (60) records.
 *
 * `sales.issued_at` is a `tsString` column, so it stores this spelling verbatim. The registro's
 * `fecha_hora_huso_gen_registro` is a `ts` column, so the same instant goes in as a `Date` and is
 * stored as the UTC `toISOString()` form — which is what PostgreSQL's `timestamptz` already did to
 * this literal, and the one timestamp spelling that compares correctly on this engine
 * (`packages/printing/src/runtime.ts` has the four-way measurement). The offset itself survives in
 * `offset_minutos`, which is why the huella can still be recomputed.
 */
const ISSUED_AT = "2026-07-20T19:20:30+01:00";

/** Deployment-environment stamp carried on a registro (stored verbatim, never HASHED — CLAUDE.md §5). */
export type Entorno = "production" | "preproduction";

/** The FK closure a `registros_facturacion` row hangs off. */
export interface FiscalIds {
  locationId: string;
  tillId: string;
  nodeId: string;
  seriesId: string;
  saleId: string;
  sifId: string;
}

/** A seeded registro plus the parent ids it references. */
export interface SeededFiscalRegistro extends FiscalIds {
  registroId: string;
  huella: string;
  entorno: Entorno;
  secuencia: number;
}

// registro_sif carries UNIQUE (nif, id_sistema_informatico, numero_instalacion). A suite gets ONE
// database for the whole file, so each seed call must be collision-free against
// every earlier one in the same file. A per-module counter gives each call a
// distinct-but-deterministic tax_id / numero_instalacion; callers may override. The taxpayer row
// itself is a singleton, so only the FIRST call in a database sets its tax id.
let seedSeq = 0;

/** Fresh random ids for one FK closure. Each test seeds its own so nothing collides on a fixed id. */
export function freshFiscalIds(overrides: Partial<FiscalIds> = {}): FiscalIds {
  return {
    locationId: overrides.locationId ?? randomUUID(),
    tillId: overrides.tillId ?? randomUUID(),
    nodeId: overrides.nodeId ?? randomUUID(),
    seriesId: overrides.seriesId ?? randomUUID(),
    saleId: overrides.saleId ?? randomUUID(),
    sifId: overrides.sifId ?? randomUUID(),
  };
}

export interface SeedParentsOptions {
  /** Reuse a fixed FK closure (e.g. to seed the SAME parents on two databases). Unset → all random. */
  ids?: Partial<FiscalIds>;
  /** registro_sif.numero_instalacion. Default: deterministic-unique per call. */
  numeroInstalacion?: number;
  /**
   * Skip the `sales` insert, leaving the rest of the closure. Used by the FK-order apply gate to seed a
   * mirror that is missing exactly the `sale_id` parent, so a delivered registro parks on `23503` until
   * {@link insertFiscalSale} plants the sale (Task 8).
   */
  skipSale?: boolean;
  /** The supplied ids already name a tenant, venue, till, node and series in this database. */
  reuseExistingParents?: boolean;
}

/**
 * Inserts the single `sales` row of a FK closure through the admin connection. Split out of
 * {@link seedFiscalParents} so a test can plant the sale AFTER a registro has already parked on the absent `sale_id` FK, the parent-arrives half of the FK-defer gate (Task 8).
 */
export async function insertFiscalSale(db: Database, ids: FiscalIds): Promise<void> {
  await db.insert(sales).values({
    id: ids.saleId,
    tillId: ids.tillId,
    nodeId: ids.nodeId,
    seriesId: ids.seriesId,
    invoiceNumber: 1,
    issuedAt: ISSUED_AT,
    issuedOffsetMinutes: 60,
    total: 0,
    vatBreakdown: [],
    locale: "es",
    invoiceLocales: ["es"],
    fiscalBackend: "verifactu",
    fiscalState: "recorded",
  });
}

/**
 * Seeds the FK closure `registros_facturacion` needs — tenant, location, till, node, invoice series,
 * sale, registro_sif — through `db`, and returns the ids. It stops SHORT of the registro itself so a
 * caller can insert that row itself, or seed the same parents on a mirror's target database without
 * also planting the ledger row there.
 *
 * Pass the clone's admin connection for these fixture inserts.
 */
export async function seedFiscalParents(
  db: Database,
  opts: SeedParentsOptions = {},
): Promise<FiscalIds> {
  const ids = freshFiscalIds(opts.ids);
  const n = seedSeq++;
  const taxId = `899${String(n).padStart(6, "0")}K`;
  const numeroInstalacion = opts.numeroInstalacion ?? n + 1;

  if (opts.reuseExistingParents !== true) {
    // The taxpayer row is a singleton keyed 1, so repeated seeding in one database is a no-op
    // rather than a second taxpayer.
    await db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId, legalName: "Waitron SL" })
      .onConflictDoNothing({ target: tenants.id });
    await db.insert(locations).values({
      id: ids.locationId,
      name: "Local principal",
      invoiceLocales: ["es"],
      operationDescription: "Venta en establecimiento",
    });
    await db.insert(tills).values({ id: ids.tillId, locationId: ids.locationId, name: "Caja 1" });
    await db.insert(nodes).values({ id: ids.nodeId, locationId: ids.locationId, name: "Node 1" });
    await db.insert(invoiceSeries).values({ id: ids.seriesId, nodeId: ids.nodeId, code: "A" });
  }
  if (!opts.skipSale) await insertFiscalSale(db, ids);
  await db.insert(registroSif).values({
    id: ids.sifId,
    nodeId: ids.nodeId,
    nif: "89890001K",
    idSistemaInformatico: "WAITRON01",
    numeroInstalacion,
  });
  return ids;
}

/** The four-part Encadenamiento pointer to the predecessor registro. */
export interface AnteriorPointer {
  idEmisorFactura: string;
  numSerieFactura: string;
  /** ISO date (yyyy-mm-dd). */
  fechaExpedicionFactura: string;
  huella: string;
}

export interface RegistroOptions {
  /**
   * Explicit registros_facturacion.id. Default: a fresh random uuid. Set it to plant a registro on a
   * mirror with the SAME id a delivered `cadenas.ultimo_registro_id` references — the parent-arrives
   * half of the nullable-FK defer gate (Task 8), where the parent can only reach the mirror by direct
   * insert (the ledger is append-only, so it cannot be re-captured under its own id).
   */
  id?: string;
  /** deployment environment stamped on the row — stored verbatim, never hashed. Default "production". */
  entorno?: Entorno;
  /** The 64-char huella. Default `"F".repeat(64)`. */
  huella?: string;
  /** registros_facturacion.secuencia (and cadenas.secuencia). Default 1. */
  secuencia?: number;
  /** num_serie_factura. Default `A/${secuencia}`. */
  numSerie?: string;
  /**
   * The predecessor pointer. Set → `primer_registro=false` and the four `anterior_*` columns carry
   * these values (the registros_encadenamiento_ck "all four set" branch). Unset → `primer_registro=true`
   * and all four are NULL (the "all four null" branch). Either way the columns replicate verbatim.
   */
  anterior?: AnteriorPointer;
}

/**
 * Inserts one `registros_facturacion` row through `conn` (a raw connection OR a transaction) against
 * the given parent `ids`, returning the row id + the values a verbatim-copy assertion pins. `secuencia`
 * / `numSerie` vary per row so two registros can share a tenant without tripping
 * registros_identidad_uq / registros_tenant_node_secuencia_uq.
 *
 * `entorno` is ALWAYS set: the fiscal invariant is that entorno is never HASHED, not that it is never
 * stored — a mirror must carry it so `drain` on the far side can still refuse the wrong environment.
 */
export async function insertFiscalRegistro(
  conn: Database | Transaction,
  ids: FiscalIds,
  opts: RegistroOptions = {},
): Promise<{ registroId: string; huella: string; entorno: Entorno; secuencia: number }> {
  const secuencia = opts.secuencia ?? 1;
  const huella = opts.huella ?? "F".repeat(64);
  const entorno: Entorno = opts.entorno ?? "production";
  const numSerie = opts.numSerie ?? `A/${secuencia}`;
  const registroId = opts.id ?? randomUUID();
  const a = opts.anterior;
  const [row] = await conn
    .insert(registrosFacturacion)
    .values({
      id: registroId,
      tillId: ids.tillId,
      nodeId: ids.nodeId,
      sifId: ids.sifId,
      saleId: ids.saleId,
      secuencia,
      tipoRegistro: "alta",
      idEmisorFactura: "89890001K",
      numSerieFactura: numSerie,
      fechaExpedicionFactura: "2026-07-20",
      nombreRazonEmisor: "Waitron SL",
      tipoFactura: "F2",
      descripcionOperacion: "Venta en establecimiento",
      desglose: [],
      cuotaTotal: "12.35",
      importeTotal: "123.45",
      primerRegistro: a === undefined,
      sistemaInformatico: {},
      anteriorIdEmisorFactura: a?.idEmisorFactura ?? null,
      anteriorNumSerieFactura: a?.numSerieFactura ?? null,
      anteriorFechaExpedicionFactura: a?.fechaExpedicionFactura ?? null,
      anteriorHuella: a?.huella ?? null,
      fechaHoraHusoGenRegistro: new Date(ISSUED_AT),
      offsetMinutos: 60,
      tipoHuella: "01",
      huella,
      entorno,
    })
    .returning({ id: registrosFacturacion.id });
  return { registroId: row!.id, huella, entorno, secuencia };
}

export interface SeedFiscalRegistroOptions extends SeedParentsOptions, RegistroOptions {
  /** Also seed a `cadenas` chain-head row pointing at this registro (Tasks 7-9). */
  cadena?: boolean;
  /** Also seed an `envios` sidecar row for this registro. `true` → estado 'pendiente' (Tasks 7-9). */
  envio?: boolean | { estado?: string };
}

/**
 * The all-in-one: seed the FK closure AND the registro (optionally its `cadenas`/`envios` companions)
 * through `db`, returning the parent ids + the registro's id/huella/entorno/secuencia — a ready-made
 * fiscal chain for a fidelity seed. A caller that needs the same parents on two databases composes
 * {@link seedFiscalParents} + {@link insertFiscalRegistro} directly instead.
 *
 * The registro and its companion `cadenas`/`envios` FK children are inserted directly through `db`.
 */
export async function seedFiscalRegistro(
  db: Database,
  opts: SeedFiscalRegistroOptions = {},
): Promise<SeededFiscalRegistro> {
  const ids = await seedFiscalParents(db, opts);
  const registro = await insertFiscalRegistro(db, ids, opts);

  if (opts.cadena) {
    await db.insert(cadenas).values({
      nodeId: ids.nodeId,
      secuencia: registro.secuencia,
      ultimoRegistroId: registro.registroId,
      ultimaHuella: registro.huella,
    });
  }
  if (opts.envio) {
    const estado =
      typeof opts.envio === "object" ? (opts.envio.estado ?? "pendiente") : "pendiente";
    await db.insert(envios).values({ registroId: registro.registroId, estado });
  }

  return { ...ids, ...registro };
}
