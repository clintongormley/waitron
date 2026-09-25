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

// Every row is written through its table definition, never raw SQL, so each column's `$defaultFn`
// runs and the JSON and list columns are encoded.

/**
 * The sale's issue instant, carrying the `+01:00` that `issued_offset_minutes` (60) records. The
 * registro stores the same instant as a UTC `Date`; the offset survives in `offset_minutos`.
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

// registro_sif carries UNIQUE (nif, id_sistema_informatico, numero_instalacion) and a suite shares
// one database, so each seed call takes a distinct numero_instalacion. Only the FIRST call in a
// database sets the taxpayer's tax id.
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
  /** Skip the `sales` insert, leaving the rest of the closure; {@link insertFiscalSale} plants it later. */
  skipSale?: boolean;
  /** The supplied ids already name a tenant, venue, till, node and series in this database. */
  reuseExistingParents?: boolean;
}

/** Inserts the single `sales` row of a FK closure. */
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
 * sale, registro_sif — through `db`, and returns the ids. It stops SHORT of the registro itself.
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
  /** Explicit registros_facturacion.id. Default: a fresh random uuid. */
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
   * and all four are NULL (the "all four null" branch).
   */
  anterior?: AnteriorPointer;
}

/**
 * Inserts one `registros_facturacion` row against the given parent `ids`. Vary `secuencia` / `numSerie`
 * per row so two registros do not trip registros_identidad_uq / registros_tenant_node_secuencia_uq.
 *
 * `entorno` is ALWAYS set: the invariant is that entorno is never HASHED, not that it is never
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
  /** Also seed a `cadenas` chain-head row pointing at this registro. */
  cadena?: boolean;
  /** Also seed an `envios` sidecar row for this registro. `true` → estado 'pendiente'. */
  envio?: boolean | { estado?: string };
}

/**
 * Seeds the FK closure AND the registro (optionally its `cadenas`/`envios` companions). A caller that
 * needs the same parents on two databases composes {@link seedFiscalParents} + {@link insertFiscalRegistro}.
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
