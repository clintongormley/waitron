import { eq } from "drizzle-orm";
import { invoiceSeries, locations, nodes, sales, tenants, tills } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import {
  nodeId as brandNodeId,
  saleId as brandSaleId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, SaleId, TillId } from "@waitron/shared";
import type { AltaInput, AnulacionInput, SistemaInformatico } from "@waitron/verifactu";
import { registerSif } from "../registro-sif.js";
import type { PendingRegistro } from "../chain.js";
import type { Entorno } from "../registro-row.js";

export const TEST_NIF = "89890001K";

export const TEST_SISTEMA: SistemaInformatico = {
  NombreRazon: "Waitron SL",
  NIF: TEST_NIF,
  NombreSistemaInformatico: "Waitron POS",
  IdSistemaInformatico: "WT",
  Version: "1.0.0",
  NumeroInstalacion: "1",
  TipoUsoPosibleSoloVerifactu: "S",
  TipoUsoPosibleMultiOT: "S",
  IndicadorMultiplesOT: "N",
};

/**
 * A seeded fiscal fixture: one NODE (the SIF/chain/series owner) with one TILL under it, where a
 * sale rings.
 */
export interface SeededTill {
  tillId: TillId;
  nodeId: NodeId;
  seriesId: string;
  sifId: string;
}

// Module-scope, so each call's NIF is unique for the process and never collides in
// `registro_sif_instalacion_uq`.
let nifSequence = 0;

/** A fresh, plausible-looking NIF. Nothing validates its checksum digit. */
function freshNif(): string {
  nifSequence += 1;
  return `${String(10_000_000 + nifSequence).padStart(8, "0")}K`;
}

/**
 * Makes sure the one taxpayer row exists, and leaves it alone if it does. The NIF each fixture
 * registers its SIF under is passed explicitly, so a second NIF never needs a second row.
 */
async function ensureTaxpayer(tx: Transaction, nif: string): Promise<void> {
  // Through the builder: `created_at` is a `$defaultFn` only the insert builder runs. An untargeted
  // conflict clause is exact here because `tenants_singleton_ck` pins the id to 1.
  await tx
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: nif, legalName: "Waitron SL" })
    .onConflictDoNothing();
}

/** Inserts one location and returns its id — the FK a node and a till both need. */
async function insertLocation(tx: Transaction, label: string): Promise<string> {
  const [locationRow] = await tx
    .insert(locations)
    .values({
      name: "Sala " + label,
      invoiceLocales: ["es"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  if (locationRow === undefined) throw new Error("seedTill: location insert returned no row");
  return locationRow.id;
}

/** Inserts one node under an existing location and returns its id — the SIF/chain/series owner. */
async function insertNode(tx: Transaction, location: string, label: string): Promise<NodeId> {
  const [nodeRow] = await tx
    .insert(nodes)
    .values({ locationId: location, name: "Node " + label })
    .returning({ id: nodes.id });
  if (nodeRow === undefined) throw new Error("seedTill: node insert returned no row");
  return brandNodeId(nodeRow.id);
}

/** Inserts one till under an existing location and returns its id — where a sale rings. */
async function insertTill(tx: Transaction, location: string, label: string): Promise<TillId> {
  const [tillRow] = await tx
    .insert(tills)
    .values({ locationId: location, name: "Till " + label })
    .returning({ id: tills.id });
  if (tillRow === undefined) throw new Error("seedTill: till insert returned no row");
  return brandTillId(tillRow.id);
}

/** Adds one node (+ location + till + a node-keyed series + a live SIF registration). */
async function addTill(tx: Transaction, nif: string, label: string): Promise<SeededTill> {
  const location = await insertLocation(tx, label);
  const node = await insertNode(tx, location, label);
  const tillId = await insertTill(tx, location, label);

  const [seriesRow] = await tx
    .insert(invoiceSeries)
    .values({ nodeId: node, code: "G" + label, purpose: "standard", nextNumber: 1 })
    .returning({ id: invoiceSeries.id });
  if (seriesRow === undefined) throw new Error("seedTill: series insert returned no row");

  const sif = await registerSif(tx, {
    nodeId: node,
    nif,
    idSistemaInformatico: TEST_SISTEMA.IdSistemaInformatico,
  });

  return { tillId, nodeId: node, seriesId: seriesRow.id, sifId: sif.id };
}

/**
 * Inserts location → node → till → node-keyed series and registers a live Veri*Factu SIF identity
 * for the node, returning every id `appendToChain` needs. Each call gets its OWN fresh NIF and
 * node.
 */
export async function seedTill(db: Database, label = "A"): Promise<SeededTill> {
  const nif = freshNif();
  return db.transaction(async (tx) => {
    await ensureTaxpayer(tx, nif);
    return addTill(tx, nif, label);
  });
}

/**
 * Adds a SECOND till (+ its own node-keyed series) under the SAME node of an already-seeded
 * fixture, sharing the original's `nodeId`/`sifId`: for "two tills, one node → one chain".
 */
export async function addTillToNode(
  db: Database,
  seed: SeededTill,
  label: string,
): Promise<SeededTill> {
  return db.transaction(async (tx) => {
    const [locationRow] = await tx
      .select({ locationId: nodes.locationId })
      .from(nodes)
      .where(eq(nodes.id, seed.nodeId));
    if (locationRow === undefined) throw new Error("addTillToNode: node not found");
    const tillId = await insertTill(tx, locationRow.locationId, label);
    const [seriesRow] = await tx
      .insert(invoiceSeries)
      .values({ nodeId: seed.nodeId, code: "G" + label, purpose: "standard", nextNumber: 1 })
      .returning({ id: invoiceSeries.id });
    if (seriesRow === undefined) throw new Error("addTillToNode: series insert returned no row");
    return {
      tillId,
      nodeId: seed.nodeId,
      seriesId: seriesRow.id,
      sifId: seed.sifId,
    };
  });
}

/** Inserts one location + node, deliberately WITHOUT registering a SIF. */
async function addBareNode(tx: Transaction, label: string): Promise<NodeId> {
  const location = await insertLocation(tx, label);
  return insertNode(tx, location, label);
}

export interface SifContentionFixture {
  nif: string;
  nodeIds: NodeId[];
}

/**
 * `count` DISTINCT nodes sharing ONE NIF, with NO SIF registered yet, so a test can fire every
 * `registerSif` itself, concurrently, against the one `contadores_instalacion` allocator.
 */
export async function seedNodesForSifContention(
  db: Database,
  count: number,
): Promise<SifContentionFixture> {
  const nif = freshNif();
  return db.transaction(async (tx) => {
    await ensureTaxpayer(tx, nif);
    const nodeIds: NodeId[] = [];
    for (let i = 0; i < count; i++) {
      nodeIds.push(await addBareNode(tx, `N${i}`));
    }
    return { nif, nodeIds };
  });
}

/**
 * Inserts one core `sales` row and returns its id — the FK `registros_facturacion.sale_id` needs.
 * A zero, unsettled sale: nothing ties `registros_facturacion.importe_total` to `sales.total`.
 */
export async function seedSale(
  db: Database | Transaction,
  till: SeededTill,
  invoiceNumber: number,
): Promise<SaleId> {
  const [row] = await db
    .insert(sales)
    .values({
      tillId: till.tillId,
      nodeId: till.nodeId,
      seriesId: till.seriesId,
      invoiceNumber,
      issuedAt: "2026-07-20T19:20:30+02:00",
      issuedOffsetMinutes: 120,
      total: 0,
      vatBreakdown: [],
      locale: "es",
      invoiceLocales: ["es"],
      fiscalBackend: "verifactu",
      fiscalState: "recorded",
    })
    .returning({ id: sales.id });
  if (row === undefined) throw new Error("seedSale inserted nothing");
  return brandSaleId(row.id);
}

/**
 * A minimal alta ready for appendToChain — Encadenamiento is chain-owned, not this fixture's.
 * `tillId` rides beside `input`, never inside it: it is not an AEAT field and must never be hashed.
 * The return type is the NARROWED branch so a caller's `.input` is not the union of both shapes.
 */
export function altaFor(
  tillId: TillId,
  saleId: SaleId,
  invoiceNumber: number,
  seconds: number,
  entorno: Entorno = "production",
): Extract<PendingRegistro, { tipo: "alta" }> {
  const input: Omit<AltaInput, "Encadenamiento"> = {
    IDEmisorFactura: TEST_NIF,
    NumSerieFactura: `A/${invoiceNumber}`,
    FechaExpedicionFactura: new Date("2026-07-20T00:00:00+02:00"),
    NombreRazonEmisor: "Waitron SL",
    TipoFactura: "F2",
    DescripcionOperacion: "Venta en establecimiento",
    Desglose: [
      {
        BaseImponibleOimporteNoSujeto: "102.02",
        CuotaRepercutida: "21.43",
        TipoImpositivo: "21.00",
        CalificacionOperacion: "S1",
      },
    ],
    CuotaTotal: "21.43",
    ImporteTotal: "123.45",
    SistemaInformatico: TEST_SISTEMA,
    generadoEn: new Date(Date.UTC(2026, 6, 20, 17, 20, seconds)),
    offsetMinutes: 120,
  };
  return { tipo: "alta", saleId, tillId, entorno, input };
}

/** A minimal anulación against an already-issued invoice; see `altaFor`. */
export function anulacionFor(
  tillId: TillId,
  saleId: SaleId,
  invoiceNumber: number,
  seconds: number,
  entorno: Entorno = "production",
): Extract<PendingRegistro, { tipo: "anulacion" }> {
  const input: Omit<AnulacionInput, "Encadenamiento"> = {
    IDEmisorFacturaAnulada: TEST_NIF,
    NumSerieFacturaAnulada: `A/${invoiceNumber}`,
    FechaExpedicionFacturaAnulada: new Date("2026-07-20T00:00:00+02:00"),
    SistemaInformatico: TEST_SISTEMA,
    generadoEn: new Date(Date.UTC(2026, 6, 20, 17, 20, seconds)),
    offsetMinutes: 120,
  };
  return { tipo: "anulacion", saleId, tillId, entorno, input };
}
