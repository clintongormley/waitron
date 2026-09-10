import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";

// Shared fiscal seeding for the fiscal-record suites. It lives under apps/server/src/testing/ because
// its consumers do (boot.mirror's fidelity seeding). Coverage-excluded (this package's vitest.config.ts
// `exclude`). Spanish fiscal column names are used verbatim because apps/* is english-only-exempt.
//
// Column shapes are the current migrated schema (country/tax_id on tenants, vat_breakdown on sales,
// node-keyed series/sif/registro).

/** Deployment-environment stamp carried on a registro (never HASHED, but replicated verbatim). */
export type Entorno = "production" | "preproduction";

/** The FK closure a `registros_facturacion` row hangs off. */
export interface FiscalIds {
  tenantId: string;
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

// tenants carries UNIQUE (country, tax_id) and registro_sif UNIQUE (nif, id_sistema_informatico,
// numero_instalacion). Suites share ONE cloned database (one useTemplateDb clone per file), so each
// seed call must be collision-free against every earlier one in the same file. A per-module counter
// gives each call a distinct-but-deterministic tax_id / numero_instalacion; callers may override.
let seedSeq = 0;

/** Fresh random ids for one FK closure. Each test seeds its own so nothing collides on a fixed id. */
export function freshFiscalIds(overrides: Partial<FiscalIds> = {}): FiscalIds {
  return {
    tenantId: overrides.tenantId ?? randomUUID(),
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
  await db.execute(sql`
    insert into sales (
      id, tenant_id, till_id, node_id, series_id, invoice_number,
      issued_at, issued_offset_minutes, total, vat_breakdown,
      locale, invoice_locales, fiscal_backend, fiscal_state
    ) values (
      ${ids.saleId}, ${ids.tenantId}, ${ids.tillId}, ${ids.nodeId}, ${ids.seriesId}, 1,
      '2026-07-20T19:20:30+01:00', 60, '0.00', '[]'::jsonb,
      'es', array['es'], 'verifactu', 'recorded'
    )`);
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
    await db.execute(sql`
      insert into tenants (id, country, tax_id, legal_name)
      values (${ids.tenantId}, 'ES', ${taxId}, 'Waitron SL')`);
    await db.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values (${ids.locationId}, ${ids.tenantId}, 'Local principal', array['es'], 'Venta en establecimiento')`);
    await db.execute(sql`
      insert into tills (id, tenant_id, location_id, name)
      values (${ids.tillId}, ${ids.tenantId}, ${ids.locationId}, 'Caja 1')`);
    await db.execute(sql`
      insert into nodes (id, tenant_id, location_id, name)
      values (${ids.nodeId}, ${ids.tenantId}, ${ids.locationId}, 'Node 1')`);
    await db.execute(sql`
      insert into invoice_series (id, tenant_id, node_id, code)
      values (${ids.seriesId}, ${ids.tenantId}, ${ids.nodeId}, 'A')`);
  }
  if (!opts.skipSale) await insertFiscalSale(db, ids);
  await db.execute(sql`
    insert into registro_sif (id, tenant_id, node_id, nif, id_sistema_informatico, numero_instalacion)
    values (${ids.sifId}, ${ids.tenantId}, ${ids.nodeId}, '89890001K', 'WAITRON01', ${numeroInstalacion})`);
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
  /** deployment environment stamped on the row — replicated verbatim (never hashed). Default "production". */
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
  const { rows } = await conn.execute<{ id: string }>(sql`
    insert into registros_facturacion (
      id, tenant_id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      tipo_factura, descripcion_operacion, desglose, cuota_total, importe_total,
      primer_registro, sistema_informatico,
      anterior_id_emisor_factura, anterior_num_serie_factura,
      anterior_fecha_expedicion_factura, anterior_huella,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella, entorno
    ) values (
      ${registroId}, ${ids.tenantId}, ${ids.tillId}, ${ids.nodeId}, ${ids.sifId}, ${ids.saleId}, ${secuencia}, 'alta',
      '89890001K', ${numSerie}, '2026-07-20', 'Waitron SL',
      'F2', 'Venta en establecimiento', '[]'::jsonb, '12.35', '123.45',
      ${a === undefined}, '{}'::jsonb,
      ${a?.idEmisorFactura ?? null}, ${a?.numSerieFactura ?? null},
      ${a?.fechaExpedicionFactura ?? null}, ${a?.huella ?? null},
      '2026-07-20T19:20:30+01:00', 60, '01', ${huella}, ${entorno}
    ) returning id`);
  return { registroId: rows[0]!.id, huella, entorno, secuencia };
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
    await db.execute(sql`
      insert into cadenas (tenant_id, node_id, secuencia, ultimo_registro_id, ultima_huella)
      values (${ids.tenantId}, ${ids.nodeId}, ${registro.secuencia}, ${registro.registroId}, ${registro.huella})`);
  }
  if (opts.envio) {
    const estado =
      typeof opts.envio === "object" ? (opts.envio.estado ?? "pendiente") : "pendiente";
    await db.execute(sql`
      insert into envios (registro_id, tenant_id, estado)
      values (${registro.registroId}, ${ids.tenantId}, ${estado})`);
  }

  return { ...ids, ...registro };
}
